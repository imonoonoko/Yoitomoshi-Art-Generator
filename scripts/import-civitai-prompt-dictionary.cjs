const fs = require('node:fs')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')

const projectRoot = path.resolve(__dirname, '..')
const args = parseArgs(process.argv.slice(2))
const resourcesDir = path.resolve(args.resourcesDir ?? path.join(projectRoot, 'resources'))
const dataRoot = path.resolve(args.dataRoot ?? path.join(projectRoot, 'userdata'))
const registryPath = path.join(resourcesDir, 'prompt-dictionary', 'sources.json')
const schemaPath = path.join(resourcesDir, 'prompt-dictionary', 'ingest-schema.sql')
const dbDir = path.join(dataRoot, 'prompt-dictionary')
const dbPath = path.join(dbDir, 'ingest.sqlite')
const sourceId = cleanString(args.sourceId) || 'civitai-public-images'
const promotedSnapshotPath = path.join(
  resourcesDir,
  'prompt-dictionary',
  sourceId === 'civitai-public-images'
    ? 'promoted-candidates.civitai.json'
    : `promoted-candidates.${sourceId.replace(/[^a-z0-9_-]+/gi, '-')}.json`
)

const DEFAULT_PAGES = 12
const DEFAULT_LIMIT = 100
const DEFAULT_MIN_COUNT = 2
const DEFAULT_PROMOTE_LIMIT = 3500
const PARSER_VERSION = 'civitai-prompt-tokenizer-v1'

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

async function main() {
  const registry = loadRegistry()
  const source = registry.sources.find((item) => item.sourceId === sourceId)
  if (!source) throw new Error(`Source not found in registry: ${sourceId}`)
  if (source.allowedMode === 'disabled') throw new Error(`Source is disabled: ${sourceId}`)
  if (source.sourceType !== 'api') throw new Error(`Source is not an API source: ${sourceId}`)
  if (source.storesImages) throw new Error(`Source must not store images: ${sourceId}`)

  fs.mkdirSync(dbDir, { recursive: true })
  const db = new DatabaseSync(dbPath, { timeout: 3000 })
  const runId = randomUUID()
  const startedAt = new Date().toISOString()
  const pages = positiveInteger(args.pages, DEFAULT_PAGES)
  const limit = Math.max(1, Math.min(200, positiveInteger(args.limit, DEFAULT_LIMIT)))
  const minCount = Math.max(1, positiveInteger(args.minCount, DEFAULT_MIN_COUNT))
  const promoteLimit = Math.max(1, positiveInteger(args.promoteLimit, DEFAULT_PROMOTE_LIMIT))
  const nsfw = normalizeNsfwMode(args.nsfw, source.defaultQuery?.nsfw)
  const sort = cleanString(args.sort || source.defaultQuery?.sort || 'Newest')
  const period = cleanString(args.period || source.defaultQuery?.period || 'Month')
  const rateLimitMs = Math.max(0, Number.isFinite(args.rateLimitMs) ? Math.floor(args.rateLimitMs) : Math.ceil(1000 / Math.max(0.2, source.rateLimitRps || 0.5)))

  const stats = {
    runId,
    dbPath,
    sourceId,
    pagesRequested: pages,
    limit,
    fetchedItems: 0,
    insertedRecords: 0,
    skippedExistingRecords: 0,
    recordsWithoutPrompt: 0,
    parsedTokens: 0,
    candidateTouches: 0,
    acceptedCandidates: 0,
    candidateTags: 0,
    rawPromptRecords: 0,
    cursorAfter: ''
  }

  try {
    db.exec('PRAGMA foreign_keys=ON')
    db.exec(fs.readFileSync(schemaPath, 'utf8'))
    snapshotSources(db, registry.sources)
    db.prepare('INSERT OR REPLACE INTO ingest_meta(key, value) VALUES (?, ?)').run('initialized_at', startedAt)
    if (args.exportOnly) {
      const exported = writePromotedSnapshot(db, source)
      console.log(JSON.stringify({
        dbPath,
        sourceId,
        exportOnly: true,
        promotedSnapshotPath,
        exportedEntries: exported
      }, null, 2))
      return
    }
    createRun(db, runId, sourceId, startedAt, { pages, limit, minCount, promoteLimit, rateLimitMs, nsfw, sort, period })

    let nextUrl = buildCivitaiUrl(source, { limit, page: positiveInteger(args.startPage, 1), nsfw, sort, period })
    for (let pageIndex = 0; pageIndex < pages && nextUrl; pageIndex += 1) {
      const data = await fetchJson(nextUrl)
      const items = Array.isArray(data.items) ? data.items : []
      stats.fetchedItems += items.length
      for (const item of items) {
        const inserted = importImageRecord(db, source, item, minCount)
        stats.insertedRecords += inserted.insertedRecord ? 1 : 0
        stats.skippedExistingRecords += inserted.skippedExisting ? 1 : 0
        stats.recordsWithoutPrompt += inserted.withoutPrompt ? 1 : 0
        stats.parsedTokens += inserted.parsedTokens
        stats.candidateTouches += inserted.candidateTouches
      }
      nextUrl = typeof data.metadata?.nextPage === 'string' ? data.metadata.nextPage : ''
      if (nextUrl) nextUrl = ensureCivitaiQuery(nextUrl, { limit, nsfw, sort, period })
      stats.cursorAfter = nextUrl
      if (pageIndex < pages - 1 && nextUrl && rateLimitMs > 0) await sleep(rateLimitMs)
    }

    stats.acceptedCandidates = acceptCandidates(db, minCount, promoteLimit)
    stats.candidateTags = countRows(db, 'candidate_tags')
    stats.rawPromptRecords = countSourceRows(db, 'raw_prompt_records', sourceId)
    stats.exportedEntries = writePromotedSnapshot(db, source)
    stats.promotedSnapshotPath = promotedSnapshotPath
    finishRun(db, runId, 'completed', stats.cursorAfter, stats.fetchedItems, stats.insertedRecords, null)
    writeCursor(db, sourceId, stats.cursorAfter)
    console.log(JSON.stringify(stats, null, 2))
  } catch (error) {
    finishRun(db, runId, 'failed', stats.cursorAfter, stats.fetchedItems, stats.insertedRecords, error?.message ?? String(error))
    throw error
  } finally {
    db.close()
  }
}

function importImageRecord(db, source, item, minCount) {
  const sourceRecordId = String(item?.id ?? '').trim()
  if (!sourceRecordId) return emptyImportResult()
  const existing = db.prepare('SELECT id FROM raw_prompt_records WHERE source_id = ? AND source_record_id = ?').get(source.sourceId, sourceRecordId)
  if (existing) return { ...emptyImportResult(), skippedExisting: true }

  const meta = item && typeof item.meta === 'object' && item.meta ? item.meta : {}
  const positivePrompt = readPromptField(meta, ['prompt', 'Prompt', 'positivePrompt', 'Positive prompt'])
  const negativePrompt = readPromptField(meta, ['negativePrompt', 'Negative prompt', 'negative_prompt'])
  if (!positivePrompt && !negativePrompt) {
    return { ...emptyImportResult(), withoutPrompt: true }
  }

  const adultLevel = adultLevelForImage(item)
  const resources = extractResources(meta, positivePrompt)
  const recordHash = hashRecord(source.sourceId, sourceRecordId, positivePrompt, negativePrompt)
  const now = new Date().toISOString()
  const rawJson = {
    id: item.id ?? null,
    postId: item.postId ?? null,
    username: typeof item.username === 'string' ? item.username : '',
    nsfw: item.nsfw === true,
    nsfwLevel: typeof item.nsfwLevel === 'string' ? item.nsfwLevel : '',
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : null,
    modelVersionIds: Array.isArray(item.modelVersionIds) ? item.modelVersionIds : [],
    baseModel: typeof item.baseModel === 'string' ? item.baseModel : '',
    metaKeys: Object.keys(meta).filter((key) => key !== 'prompt' && key !== 'negativePrompt')
  }

  const insertRecord = db.prepare(`
    INSERT INTO raw_prompt_records(
      source_id, source_record_id, record_hash, positive_prompt, negative_prompt,
      model_family, resources_json, adult_level, fetched_at, source_created_at, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const result = insertRecord.run(
    source.sourceId,
    sourceRecordId,
    recordHash,
    source.storesRawPrompts ? positivePrompt : '',
    source.storesRawPrompts ? negativePrompt : '',
    guessModelFamily(meta, item),
    JSON.stringify(resources),
    adultLevel,
    now,
    typeof item.createdAt === 'string' ? item.createdAt : null,
    JSON.stringify(rawJson)
  )
  const rawRecordId = Number(result.lastInsertRowid)

  let parsedTokens = 0
  let candidateTouches = 0
  const positiveTokens = parsePromptTokens(positivePrompt, 'positive')
  const negativeTokens = parsePromptTokens(negativePrompt, 'negative')
  for (const token of [...positiveTokens, ...negativeTokens]) {
    parsedTokens += 1
    insertParseResult(db, rawRecordId, token)
    if (token.tokenKind === 'resource' || token.tokenKind === 'meta') continue
    if (token.adultLevel > 0) token.adultLevel = Math.max(token.adultLevel, adultLevel)
    upsertCandidate(db, source.sourceId, rawRecordId, token, minCount)
    candidateTouches += 1
  }
  db.prepare('UPDATE raw_prompt_records SET parse_status = ? WHERE id = ?').run('parsed', rawRecordId)

  return {
    insertedRecord: true,
    skippedExisting: false,
    withoutPrompt: false,
    parsedTokens,
    candidateTouches
  }
}

function emptyImportResult() {
  return {
    insertedRecord: false,
    skippedExisting: false,
    withoutPrompt: false,
    parsedTokens: 0,
    candidateTouches: 0
  }
}

function insertParseResult(db, rawRecordId, token) {
  db.prepare(`
    INSERT OR IGNORE INTO prompt_parse_results(
      raw_record_id, polarity, raw_token, canonical_candidate, token_kind,
      weight, prompt_position, confidence, parser_version, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    rawRecordId,
    token.polarity,
    token.rawToken,
    token.canonical,
    token.tokenKind,
    token.weight,
    token.position,
    token.confidence,
    PARSER_VERSION,
    new Date().toISOString()
  )
}

function upsertCandidate(db, sourceIdValue, rawRecordId, token, minCount) {
  const now = new Date().toISOString()
  const positiveCount = token.polarity === 'positive' ? 1 : 0
  const negativeCount = token.polarity === 'negative' ? 1 : 0
  db.prepare(`
    INSERT INTO candidate_tags(
      canonical_tag, display_tag, token_kind, positive_count, negative_count,
      source_count, evidence_count, confidence, adult_level, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?)
    ON CONFLICT(canonical_tag) DO UPDATE SET
      display_tag = excluded.display_tag,
      token_kind = CASE
        WHEN candidate_tags.token_kind = 'tag' THEN candidate_tags.token_kind
        ELSE excluded.token_kind
      END,
      positive_count = candidate_tags.positive_count + excluded.positive_count,
      negative_count = candidate_tags.negative_count + excluded.negative_count,
      evidence_count = candidate_tags.evidence_count + excluded.evidence_count,
      confidence = MAX(candidate_tags.confidence, excluded.confidence),
      adult_level = MAX(candidate_tags.adult_level, excluded.adult_level),
      status = CASE
        WHEN candidate_tags.status IN ('hidden', 'rejected', 'promoted') THEN candidate_tags.status
        WHEN candidate_tags.adult_level > 0 OR excluded.adult_level > 0 THEN 'needs-review'
        WHEN candidate_tags.evidence_count + excluded.evidence_count >= ? THEN 'accepted'
        ELSE candidate_tags.status
      END,
      updated_at = excluded.updated_at
  `).run(
    token.canonical,
    token.display,
    token.tokenKind,
    positiveCount,
    negativeCount,
    token.confidence,
    token.adultLevel,
    token.adultLevel > 0 ? 'needs-review' : (minCount <= 1 ? 'accepted' : 'new'),
    now,
    now,
    minCount
  )

  const candidate = db.prepare('SELECT candidate_id FROM candidate_tags WHERE canonical_tag = ?').get(token.canonical)
  const candidateId = Number(candidate?.candidate_id ?? 0)
  if (!candidateId) return
  db.prepare(`
    INSERT INTO candidate_evidence(
      candidate_id, source_id, raw_record_id, polarity, occurrence_count,
      model_family, sample_text, created_at
    ) VALUES (?, ?, ?, ?, 1, ?, ?, ?)
  `).run(candidateId, sourceIdValue, rawRecordId, token.polarity, '', token.sampleText, now)

  const existingTranslation = db.prepare('SELECT job_id FROM translation_jobs WHERE candidate_id = ? LIMIT 1').get(candidateId)
  if (!existingTranslation) {
    const ja = draftJapaneseLabel(token.display)
    db.prepare(`
      INSERT INTO translation_jobs(
        candidate_id, source_text, ja_label, ja_meaning, status, provider, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      candidateId,
      token.display,
      ja,
      draftJapaneseMeaning(token.display, ja),
      ja ? 'machine-draft' : 'needs-review',
      ja ? 'yoitomoshi-heuristic-v1' : '',
      now,
      now
    )
  }
}

function acceptCandidates(db, minCount, promoteLimit) {
  const rows = db.prepare(`
    SELECT candidate_id
    FROM candidate_tags
    WHERE status IN ('new', 'needs-review', 'accepted')
      AND evidence_count >= ?
      AND token_kind IN ('tag', 'phrase', 'quality', 'negative')
    ORDER BY evidence_count DESC, confidence DESC, canonical_tag ASC
    LIMIT ?
  `).all(minCount, promoteLimit)
  const update = db.prepare(`
    UPDATE candidate_tags
    SET status = 'accepted', updated_at = ?
    WHERE candidate_id = ? AND status NOT IN ('hidden', 'rejected', 'promoted')
  `)
  const now = new Date().toISOString()
  db.exec('BEGIN')
  try {
    for (const row of rows) update.run(now, row.candidate_id)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return rows.length
}

function writePromotedSnapshot(db, source) {
  const rows = db.prepare(`
    WITH source_evidence AS (
      SELECT
        candidate_id,
        SUM(occurrence_count) AS evidence_count,
        SUM(CASE WHEN polarity = 'positive' THEN occurrence_count ELSE 0 END) AS positive_count,
        SUM(CASE WHEN polarity = 'negative' THEN occurrence_count ELSE 0 END) AS negative_count
      FROM candidate_evidence
      WHERE source_id = ?
      GROUP BY candidate_id
    )
    SELECT
      c.candidate_id,
      c.canonical_tag,
      c.display_tag,
      c.token_kind,
      COALESCE(se.positive_count, 0) AS positive_count,
      COALESCE(se.negative_count, 0) AS negative_count,
      COALESCE(se.evidence_count, 0) AS evidence_count,
      c.confidence,
      c.adult_level,
      c.status,
      COALESCE((
        SELECT t.ja_label
        FROM translation_jobs t
        WHERE t.candidate_id = c.candidate_id
        ORDER BY
          CASE t.status
            WHEN 'curated' THEN 1
            WHEN 'source-derived' THEN 2
            WHEN 'machine-draft' THEN 3
            WHEN 'needs-review' THEN 4
            ELSE 5
          END,
          t.updated_at DESC
        LIMIT 1
      ), '') AS ja_label,
      COALESCE((
        SELECT t.ja_meaning
        FROM translation_jobs t
        WHERE t.candidate_id = c.candidate_id
        ORDER BY
          CASE t.status
            WHEN 'curated' THEN 1
            WHEN 'source-derived' THEN 2
            WHEN 'machine-draft' THEN 3
            WHEN 'needs-review' THEN 4
            ELSE 5
          END,
          t.updated_at DESC
        LIMIT 1
      ), '') AS ja_meaning,
      COALESCE((
        SELECT t.status
        FROM translation_jobs t
        WHERE t.candidate_id = c.candidate_id
        ORDER BY
          CASE t.status
            WHEN 'curated' THEN 1
            WHEN 'source-derived' THEN 2
            WHEN 'machine-draft' THEN 3
            WHEN 'needs-review' THEN 4
            ELSE 5
          END,
          t.updated_at DESC
        LIMIT 1
      ), 'needs-review') AS curation_status
    FROM candidate_tags c
    JOIN source_evidence se ON se.candidate_id = c.candidate_id
    WHERE c.status IN ('accepted', 'promoted')
      AND c.token_kind IN ('tag', 'phrase', 'quality', 'negative')
    ORDER BY se.evidence_count DESC, c.confidence DESC, c.canonical_tag ASC
  `).all(source.sourceId)
  const snapshot = {
    schemaVersion: 1,
    sourceId: source.sourceId,
    sourceLabel: source.displayName,
    exportedAt: new Date().toISOString(),
    rawPromptRecords: countSourceRows(db, 'raw_prompt_records', source.sourceId),
    entries: rows.map((row) => ({
      tag: String(row.display_tag || row.canonical_tag || '').trim(),
      canonicalTag: String(row.canonical_tag || '').trim(),
      tokenKind: String(row.token_kind || 'tag'),
      positiveCount: Number(row.positive_count ?? 0),
      negativeCount: Number(row.negative_count ?? 0),
      evidenceCount: Number(row.evidence_count ?? 0),
      confidence: Number(row.confidence ?? 0),
      adultLevel: Number(row.adult_level ?? 0),
      status: String(row.status || 'accepted'),
      ja: String(row.ja_label || '').trim(),
      meaning: String(row.ja_meaning || '').trim(),
      curationStatus: String(row.curation_status || 'needs-review')
    })).filter((entry) => entry.tag && entry.evidenceCount >= 2)
  }
  fs.writeFileSync(promotedSnapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  return snapshot.entries.length
}

function parsePromptTokens(prompt, polarity) {
  if (!prompt || typeof prompt !== 'string') return []
  const tokens = splitPrompt(prompt)
  const out = []
  let position = 0
  for (const rawToken of tokens) {
    const parsed = normalizePromptToken(rawToken, polarity, position)
    position += 1
    if (!parsed) continue
    out.push(parsed)
  }
  return out
}

function splitPrompt(prompt) {
  const out = []
  let current = ''
  let angleDepth = 0
  for (const char of prompt.replace(/\r?\n/g, ',')) {
    if (char === '<') angleDepth += 1
    if (char === '>') angleDepth = Math.max(0, angleDepth - 1)
    if ((char === ',' || char === '，' || char === '、') && angleDepth === 0) {
      if (current.trim()) out.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) out.push(current.trim())
  return out
}

function normalizePromptToken(rawToken, polarity, position) {
  const raw = rawToken.trim()
  if (!raw) return null
  const lora = raw.match(/^<\s*(lora|lyco|hypernet|embedding):([^:>]+)(?::([^>]+))?>$/i)
  if (lora) {
    return {
      rawToken: raw,
      display: lora[2].trim(),
      canonical: canonicalizeTag(lora[2]),
      polarity,
      tokenKind: 'resource',
      weight: parseWeight(lora[3]),
      position,
      confidence: 0.95,
      adultLevel: 0,
      sampleText: raw
    }
  }

  let value = raw
  const weight = extractWeight(value)
  value = weight.cleaned
  value = value
    .replace(/^[([{]+/g, '')
    .replace(/[)\]}]+$/g, '')
    .replace(/^"+|"+$/g, '')
    .replace(/^'+|'+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!value || value.length > 90) return null
  if (/^https?:\/\//i.test(value)) return null
  if (/^[\d\s:._-]+$/.test(value)) return null
  if (/[{}|]/.test(value)) return null
  if (value.split(/\s+/).length > 5) return null
  if (looksLikeSentence(value)) return null

  const canonical = canonicalizeTag(value)
  if (!canonical || canonical.length < 2 || canonical.length > 90) return null
  if (TOKEN_STOPLIST.has(canonical)) return null

  const display = canonical
  const tokenKind = inferTokenKind(display, polarity)
  const adultLevel = adultLevelForToken(display)
  const confidence = confidenceForToken(display, tokenKind, weight.value)
  if (confidence < 0.35) return null

  return {
    rawToken: raw,
    display,
    canonical,
    polarity,
    tokenKind,
    weight: weight.value,
    position,
    confidence,
    adultLevel,
    sampleText: raw.slice(0, 160)
  }
}

function extractWeight(value) {
  const trimmed = value.trim()
  const weighted = trimmed.match(/^\(+\s*(.+?)\s*:\s*([+-]?\d+(?:\.\d+)?)\s*\)+$/)
  if (weighted) {
    return {
      cleaned: weighted[1],
      value: parseWeight(weighted[2])
    }
  }
  return {
    cleaned: trimmed,
    value: null
  }
}

function parseWeight(value) {
  if (value == null) return null
  const parsed = Number(String(value).trim())
  return Number.isFinite(parsed) ? parsed : null
}

function canonicalizeTag(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/\s*\/\s*/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
}

function looksLikeSentence(value) {
  if (/[.!?。！？]/.test(value)) return true
  if (/\b(and|with|while|because|that|which)\b/i.test(value) && value.split(/\s+/).length > 3) return true
  return false
}

function inferTokenKind(tag, polarity) {
  if (polarity === 'negative') return 'negative'
  if (/^(masterpiece|best_quality|high_quality|score_\d|score_\d_up|absurdres|highres|ultra_detailed|detailed)$/.test(tag)) return 'quality'
  if (/^(rating|source|user|commentary|pixiv_id|twitter_username):/i.test(tag)) return 'meta'
  if (/(hair|eyes?|mouth|smile|skin|hands?|fingers?|arms?|legs?|breasts?|face|body|tail|ears?)$/.test(tag)) return 'tag'
  if (/(dress|shirt|skirt|jacket|coat|uniform|kimono|boots|shoes|gloves|hat|ribbon|bow|socks|pantyhose)$/.test(tag)) return 'tag'
  if (/(background|lighting|light|shadow|sky|room|street|forest|water|flower|clouds?)$/.test(tag)) return 'tag'
  return tag.includes('_') ? 'tag' : 'phrase'
}

function confidenceForToken(tag, tokenKind, weight) {
  let score = 0.72
  if (tag.includes('_')) score += 0.08
  if (tokenKind === 'quality') score += 0.08
  if (tokenKind === 'phrase') score -= 0.1
  if (typeof weight === 'number') score += 0.03
  if (tag.length <= 3) score -= 0.16
  return Math.max(0, Math.min(1, score))
}

function adultLevelForImage(item) {
  const level = String(item?.nsfwLevel ?? '').toLowerCase()
  if (item?.nsfw === true) return 2
  if (level === 'x' || level === 'mature') return 2
  if (level === 'soft') return 1
  return 0
}

function adultLevelForToken(tag) {
  if (ADULT_TOKEN_PATTERNS.some((pattern) => pattern.test(tag))) return 2
  return 0
}

function readPromptField(meta, names) {
  for (const name of names) {
    const value = meta?.[name]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function extractResources(meta, prompt) {
  const resources = []
  if (Array.isArray(meta?.resources)) {
    for (const resource of meta.resources) {
      if (!resource || typeof resource !== 'object') continue
      resources.push({
        type: typeof resource.type === 'string' ? resource.type : '',
        name: typeof resource.name === 'string' ? resource.name : '',
        modelVersionId: Number.isFinite(resource.modelVersionId) ? resource.modelVersionId : null
      })
    }
  }
  for (const match of String(prompt ?? '').matchAll(/<\s*(lora|lyco|hypernet|embedding):([^:>]+)(?::([^>]+))?>/gi)) {
    resources.push({
      type: match[1].toLowerCase(),
      name: match[2].trim(),
      weight: parseWeight(match[3])
    })
  }
  return resources.slice(0, 80)
}

function guessModelFamily(meta, item) {
  const haystack = [
    meta?.Model,
    meta?.model,
    meta?.Version,
    item?.baseModel
  ].filter(Boolean).join(' ').toLowerCase()
  if (haystack.includes('pony')) return 'pony'
  if (haystack.includes('illustrious')) return 'illustrious'
  if (haystack.includes('animagine')) return 'animagine'
  if (haystack.includes('flux')) return 'flux'
  if (haystack.includes('sdxl') || haystack.includes('xl')) return 'sdxl'
  if (haystack.includes('1.5') || haystack.includes('sd15')) return 'sd15'
  return ''
}

function draftJapaneseLabel(tag) {
  if (JA_FULL_TAGS[tag]) return JA_FULL_TAGS[tag]
  const parts = tag.split('_').filter(Boolean)
  if (parts.length === 0 || parts.length > 4) return ''
  const translated = parts.map((part) => JA_PARTS[part] ?? '')
  if (translated.every(Boolean)) return translated.join('')
  return ''
}

function draftJapaneseMeaning(tag, ja) {
  if (ja) return `${ja}を表す生成用タグ。Civitai公開プロンプトから抽出した機械ドラフト。`
  return `${tag} を表す生成用タグ候補。Civitai公開プロンプトから抽出。日本語訳はレビュー待ち。`
}

async function fetchJson(url, attempt = 0) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Yoitomoshi-Art-Generator prompt dictionary importer'
    }
  })
  if (response.status === 429 && attempt < 5) {
    const retryAfterSeconds = Number(response.headers.get('retry-after'))
    const waitMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : 15000 * (attempt + 1)
    await sleep(waitMs)
    return fetchJson(url, attempt + 1)
  }
  if (!response.ok) {
    throw new Error(`Civitai API request failed: ${response.status} ${response.statusText}`)
  }
  return response.json()
}

function buildCivitaiUrl(source, options) {
  const url = new URL(source.baseUrl || 'https://civitai.com/api/v1/images')
  const defaults = source.defaultQuery && typeof source.defaultQuery === 'object' ? source.defaultQuery : {}
  for (const [key, value] of Object.entries(defaults)) url.searchParams.set(key, String(value))
  url.searchParams.set('limit', String(options.limit))
  url.searchParams.set('page', String(options.page))
  if (options.nsfw !== '') url.searchParams.set('nsfw', String(options.nsfw))
  url.searchParams.set('withMeta', 'true')
  if (options.sort) url.searchParams.set('sort', options.sort)
  if (options.period) url.searchParams.set('period', options.period)
  return url.toString()
}

function ensureCivitaiQuery(rawUrl, options) {
  const url = new URL(rawUrl)
  url.protocol = 'https:'
  url.searchParams.set('limit', String(options.limit))
  if (options.nsfw !== '') url.searchParams.set('nsfw', String(options.nsfw))
  url.searchParams.set('withMeta', 'true')
  if (options.sort) url.searchParams.set('sort', options.sort)
  if (options.period) url.searchParams.set('period', options.period)
  return url.toString()
}

function createRun(db, runId, sourceIdValue, startedAt, config) {
  db.prepare(`
    INSERT INTO import_runs(run_id, source_id, status, started_at, config_json)
    VALUES (?, ?, 'running', ?, ?)
  `).run(runId, sourceIdValue, startedAt, JSON.stringify(config))
}

function finishRun(db, runId, status, cursorAfter, fetchedCount, rawRecordCount, errorMessage) {
  db.prepare(`
    UPDATE import_runs
    SET status = ?, finished_at = ?, cursor_after = ?, fetched_count = ?,
      raw_record_count = ?, error_message = ?
    WHERE run_id = ?
  `).run(status, new Date().toISOString(), cursorAfter ?? '', fetchedCount, rawRecordCount, errorMessage, runId)
}

function writeCursor(db, sourceIdValue, cursor) {
  db.prepare(`
    INSERT INTO import_cursors(source_id, cursor, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at
  `).run(sourceIdValue, cursor ?? '', new Date().toISOString())
}

function snapshotSources(db, sources) {
  const now = new Date().toISOString()
  const insert = db.prepare(`
    INSERT INTO source_registry_snapshot(
      source_id, display_name, source_type, allowed_mode, base_url, terms_url,
      license_note, rate_limit_rps, stores_raw_prompts, stores_images,
      adult_policy, checked_at, source_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET
      display_name = excluded.display_name,
      source_type = excluded.source_type,
      allowed_mode = excluded.allowed_mode,
      base_url = excluded.base_url,
      terms_url = excluded.terms_url,
      license_note = excluded.license_note,
      rate_limit_rps = excluded.rate_limit_rps,
      stores_raw_prompts = excluded.stores_raw_prompts,
      stores_images = excluded.stores_images,
      adult_policy = excluded.adult_policy,
      checked_at = excluded.checked_at,
      source_json = excluded.source_json,
      updated_at = excluded.updated_at
  `)
  db.exec('BEGIN')
  try {
    for (const source of sources) {
      insert.run(
        source.sourceId,
        source.displayName,
        source.sourceType,
        source.allowedMode,
        source.baseUrl,
        source.termsUrl,
        source.licenseNote,
        source.rateLimitRps,
        source.storesRawPrompts ? 1 : 0,
        source.storesImages ? 1 : 0,
        source.adultPolicy,
        source.checkedAt,
        JSON.stringify(source),
        now
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function loadRegistry() {
  const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8'))
  if (!Array.isArray(parsed.sources)) throw new Error('sources.json must contain sources')
  return parsed
}

function countRows(db, tableName) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get()?.count ?? 0)
}

function countSourceRows(db, tableName, sourceIdValue) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${tableName} WHERE source_id = ?`).get(sourceIdValue)?.count ?? 0)
}

function hashRecord(...parts) {
  return createHash('sha256').update(parts.join('\0')).digest('hex')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--pages') out.pages = Number(argv[++i])
    else if (arg === '--limit') out.limit = Number(argv[++i])
    else if (arg === '--start-page') out.startPage = Number(argv[++i])
    else if (arg === '--min-count') out.minCount = Number(argv[++i])
    else if (arg === '--promote-limit') out.promoteLimit = Number(argv[++i])
    else if (arg === '--rate-limit-ms') out.rateLimitMs = Number(argv[++i])
    else if (arg === '--nsfw') out.nsfw = argv[++i]
    else if (arg === '--sort') out.sort = argv[++i]
    else if (arg === '--period') out.period = argv[++i]
    else if (arg === '--source-id') out.sourceId = argv[++i]
    else if (arg === '--data-root') out.dataRoot = argv[++i]
    else if (arg === '--resources-dir') out.resourcesDir = argv[++i]
    else if (arg === '--export-only') out.exportOnly = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return out
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function normalizeNsfwMode(value, fallback) {
  const raw = cleanString(value === undefined ? fallback : value).toLowerCase()
  if (raw === 'true' || raw === '1' || raw === 'yes' || raw === 'adult') return true
  if (raw === 'false' || raw === '0' || raw === 'no' || raw === 'sfw') return false
  return ''
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
}

const TOKEN_STOPLIST = new Set([
  'and',
  'or',
  'the',
  'a',
  'an',
  'by',
  'with',
  'from',
  'for',
  'to',
  'of',
  'in',
  'on',
  'as',
  'very',
  'extremely',
  'image',
  'picture',
  'prompt',
  'negative_prompt',
  'none',
  'null',
  'undefined',
  'unknown'
])

const ADULT_TOKEN_PATTERNS = [
  /\bnsfw\b/,
  /\bnude\b/,
  /\bnudity\b/,
  /\bsex\b/,
  /\berotic\b/,
  /\bpussy\b/,
  /\bpenis\b/,
  /\bvagina\b/,
  /\bnipple/,
  /\bareola/,
  /\bcum\b/,
  /\bblowjob\b/,
  /\bbreast_grab\b/,
  /\bspread_legs\b/
]

const JA_FULL_TAGS = {
  '1girl': '1人の女の子',
  '1boy': '1人の男の子',
  '2girls': '2人の女の子',
  'solo': '単独',
  'masterpiece': '傑作',
  'best_quality': '最高品質',
  'high_quality': '高品質',
  'low_quality': '低品質',
  'worst_quality': '最低品質',
  'normal_quality': '通常品質',
  'highres': '高解像度',
  'absurdres': '超高解像度',
  'ultra_detailed': '超詳細',
  'detailed': '詳細',
  'looking_at_viewer': 'こちらを見る',
  'black_hair': '黒髪',
  'brown_hair': '茶髪',
  'blonde_hair': '金髪',
  'white_hair': '白髪',
  'silver_hair': '銀髪',
  'blue_hair': '青髪',
  'pink_hair': 'ピンク髪',
  'red_hair': '赤髪',
  'green_hair': '緑髪',
  'purple_hair': '紫髪',
  'long_hair': '長髪',
  'short_hair': '短髪',
  'medium_hair': '中くらいの髪',
  'blue_eyes': '青い目',
  'red_eyes': '赤い目',
  'green_eyes': '緑の目',
  'brown_eyes': '茶色の目',
  'purple_eyes': '紫の目',
  'yellow_eyes': '黄色の目',
  'closed_eyes': '閉じた目',
  'smile': '笑顔',
  'open_mouth': '開いた口',
  'closed_mouth': '閉じた口',
  'blush': '赤面',
  'standing': '立つ',
  'sitting': '座る',
  'running': '走る',
  'walking': '歩く',
  'lying': '横たわる',
  'dress': 'ドレス',
  'skirt': 'スカート',
  'shirt': 'シャツ',
  'jacket': 'ジャケット',
  'school_uniform': '学校制服',
  'kimono': '着物',
  'ribbon': 'リボン',
  'bow': '蝶結び',
  'hat': '帽子',
  'gloves': '手袋',
  'boots': 'ブーツ',
  'simple_background': 'シンプル背景',
  'white_background': '白背景',
  'black_background': '黒背景',
  'outdoors': '屋外',
  'indoors': '屋内',
  'sky': '空',
  'clouds': '雲',
  'night': '夜',
  'day': '昼',
  'sunlight': '日光',
  'backlighting': '逆光',
  'soft_lighting': '柔らかい光',
  'depth_of_field': '被写界深度',
  'blurry_background': 'ぼかした背景',
  'bad_anatomy': '悪い解剖',
  'bad_hands': '崩れた手',
  'extra_fingers': '余分な指',
  'missing_fingers': '欠けた指',
  'text': '文字',
  'watermark': '透かし',
  'signature': '署名'
}

const JA_PARTS = {
  black: '黒',
  white: '白',
  brown: '茶色',
  blonde: '金',
  blue: '青',
  red: '赤',
  green: '緑',
  purple: '紫',
  pink: 'ピンク',
  yellow: '黄色',
  silver: '銀',
  long: '長い',
  short: '短い',
  medium: '中くらいの',
  hair: '髪',
  eyes: '目',
  eye: '目',
  mouth: '口',
  closed: '閉じた',
  open: '開いた',
  smile: '笑顔',
  girl: '女の子',
  boy: '男の子',
  girls: '女の子',
  boys: '男の子',
  solo: '単独',
  simple: 'シンプル',
  background: '背景',
  lighting: '光',
  light: '光',
  soft: '柔らかい',
  hard: '強い',
  hand: '手',
  hands: '手',
  finger: '指',
  fingers: '指',
  arm: '腕',
  arms: '腕',
  leg: '脚',
  legs: '脚',
  dress: 'ドレス',
  skirt: 'スカート',
  shirt: 'シャツ',
  school: '学校',
  uniform: '制服',
  bad: '悪い',
  extra: '余分な',
  missing: '欠けた',
  blurry: 'ぼやけた',
  detailed: '詳細',
  quality: '品質',
  high: '高い',
  low: '低い'
}
