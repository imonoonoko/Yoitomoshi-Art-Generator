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
const promotedSnapshotPath = path.join(resourcesDir, 'prompt-dictionary', 'promoted-candidates.web.json')
const dbDir = path.join(dataRoot, 'prompt-dictionary')
const dbPath = path.join(dbDir, 'ingest.sqlite')
const sourceId = 'public-web-prompt-pages'
const PARSER_VERSION = 'public-web-prompt-tokenizer-v2'

const DEFAULT_MIN_COUNT = 1
const DEFAULT_PROMOTE_LIMIT = 6000
const DEFAULT_URLS = [
  'https://www.aipictors.com/home',
  'https://www.aipictors.com/r?tab=home',
  'https://legacy.aipictors.com/works/503968/',
  'https://legacy.aipictors.com/works/261025/',
  'https://hikari-aiart.com/aiart-pronpt-matome/',
  'https://www.kawasyo.online/stable-diffusion-prompt-list/',
  'https://minorgame.syowp.com/archives/stable-difussion-prompt.html',
  'https://stable-diffusion-art.com/pony-diffusion-prompt-tags/'
]

async function main() {
  const registry = loadRegistry()
  const source = registry.sources.find((item) => item.sourceId === sourceId)
  if (!source) throw new Error(`Source not found in registry: ${sourceId}`)
  if (source.allowedMode === 'disabled') throw new Error(`Source is disabled: ${sourceId}`)
  if (source.storesImages) throw new Error(`Source must not store images: ${sourceId}`)

  fs.mkdirSync(dbDir, { recursive: true })
  const db = new DatabaseSync(dbPath, { timeout: 3000 })
  const runId = randomUUID()
  const startedAt = new Date().toISOString()
  const minCount = Math.max(1, positiveInteger(args.minCount, DEFAULT_MIN_COUNT))
  const promoteLimit = Math.max(1, positiveInteger(args.promoteLimit, DEFAULT_PROMOTE_LIMIT))
  const rateLimitMs = Math.max(0, Number.isFinite(args.rateLimitMs) ? Math.floor(args.rateLimitMs) : Math.ceil(1000 / Math.max(0.2, source.rateLimitRps || 0.5)))
  const urls = collectUrls(args)
  const stats = {
    runId,
    dbPath,
    sourceId,
    requestedUrls: urls.length,
    fetchedPages: 0,
    failedPages: 0,
    extractedRecords: 0,
    insertedRecords: 0,
    skippedExistingRecords: 0,
    recordsWithoutPrompt: 0,
    parsedTokens: 0,
    candidateTouches: 0,
    acceptedCandidates: 0,
    candidateTags: 0,
    rawPromptRecords: 0,
    exportedEntries: 0,
    promotedSnapshotPath,
    pageStats: []
  }

  try {
    db.exec('PRAGMA foreign_keys=ON')
    db.exec(fs.readFileSync(schemaPath, 'utf8'))
    snapshotSources(db, registry.sources)
    db.prepare('INSERT OR REPLACE INTO ingest_meta(key, value) VALUES (?, ?)').run('initialized_at', startedAt)
    if (args.exportOnly) {
      stats.exportedEntries = writePromotedSnapshot(db, source)
      console.log(JSON.stringify({ ...stats, exportOnly: true }, null, 2))
      return
    }

    if (args.resetSource) {
      resetSourceData(db, sourceId)
      stats.resetSource = true
    }

    createRun(db, runId, sourceId, startedAt, { minCount, promoteLimit, rateLimitMs, urls })
    for (let index = 0; index < urls.length; index += 1) {
      const url = urls[index]
      try {
        const html = await fetchText(url)
        stats.fetchedPages += 1
        const records = extractPromptRecords(url, html)
        stats.extractedRecords += records.length
        const pageStat = { url, records: records.length, inserted: 0, skipped: 0, tokens: 0 }
        for (const record of records) {
          const imported = importWebRecord(db, source, record, minCount)
          pageStat.inserted += imported.insertedRecord ? 1 : 0
          pageStat.skipped += imported.skippedExisting ? 1 : 0
          pageStat.tokens += imported.parsedTokens
          stats.insertedRecords += imported.insertedRecord ? 1 : 0
          stats.skippedExistingRecords += imported.skippedExisting ? 1 : 0
          stats.recordsWithoutPrompt += imported.withoutPrompt ? 1 : 0
          stats.parsedTokens += imported.parsedTokens
          stats.candidateTouches += imported.candidateTouches
        }
        stats.pageStats.push(pageStat)
      } catch (error) {
        stats.failedPages += 1
        stats.pageStats.push({ url, error: error?.message ?? String(error) })
      }
      if (index < urls.length - 1 && rateLimitMs > 0) await sleep(rateLimitMs)
    }

    stats.acceptedCandidates = acceptCandidates(db, minCount, promoteLimit)
    stats.candidateTags = countRows(db, 'candidate_tags')
    stats.rawPromptRecords = db.prepare('SELECT COUNT(*) AS count FROM raw_prompt_records WHERE source_id = ?').get(sourceId).count
    stats.exportedEntries = writePromotedSnapshot(db, source)
    finishRun(db, runId, 'completed', '', urls.length, stats.insertedRecords, null)
    console.log(JSON.stringify(stats, null, 2))
  } catch (error) {
    finishRun(db, runId, 'failed', '', urls.length, stats.insertedRecords, error?.message ?? String(error))
    throw error
  } finally {
    db.close()
  }
}

function importWebRecord(db, source, record, minCount) {
  const existing = db.prepare('SELECT id FROM raw_prompt_records WHERE source_id = ? AND source_record_id = ?').get(source.sourceId, record.recordId)
  if (existing) return { insertedRecord: false, skippedExisting: true, withoutPrompt: false, parsedTokens: 0, candidateTouches: 0 }
  if (!record.positivePrompt && !record.negativePrompt) {
    return { insertedRecord: false, skippedExisting: false, withoutPrompt: true, parsedTokens: 0, candidateTouches: 0 }
  }

  const adultLevel = Math.max(adultLevelForPrompt(record.positivePrompt), adultLevelForPrompt(record.negativePrompt))
  const now = new Date().toISOString()
  const result = db.prepare(`
    INSERT INTO raw_prompt_records(
      source_id, source_record_id, record_hash, positive_prompt, negative_prompt,
      model_family, resources_json, adult_level, fetched_at, source_created_at, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    source.sourceId,
    record.recordId,
    hashText([source.sourceId, record.recordId, record.positivePrompt, record.negativePrompt].join('\0')),
    source.storesRawPrompts ? record.positivePrompt : '',
    source.storesRawPrompts ? record.negativePrompt : '',
    record.modelFamily ?? '',
    '[]',
    adultLevel,
    now,
    null,
    JSON.stringify(record.raw ?? {})
  )
  const rawRecordId = Number(result.lastInsertRowid)

  let parsedTokens = 0
  let candidateTouches = 0
  for (const token of [
    ...parsePromptTokens(record.positivePrompt, 'positive'),
    ...parsePromptTokens(record.negativePrompt, 'negative')
  ]) {
    parsedTokens += 1
    insertParseResult(db, rawRecordId, token)
    if (token.tokenKind === 'resource' || token.tokenKind === 'meta') continue
    upsertCandidate(db, source.sourceId, rawRecordId, token, minCount)
    candidateTouches += 1
  }
  db.prepare('UPDATE raw_prompt_records SET parse_status = ? WHERE id = ?').run('parsed', rawRecordId)
  return { insertedRecord: true, skippedExisting: false, withoutPrompt: false, parsedTokens, candidateTouches }
}

function insertParseResult(db, rawRecordId, token) {
  db.prepare(`
    INSERT OR IGNORE INTO prompt_parse_results(
      raw_record_id, polarity, raw_token, canonical_candidate, token_kind,
      weight, prompt_position, confidence, parser_version, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(rawRecordId, token.polarity, token.rawToken, token.canonical, token.tokenKind, token.weight, token.position, token.confidence, PARSER_VERSION, new Date().toISOString())
}

function upsertCandidate(db, sourceIdValue, rawRecordId, token, minCount) {
  const now = new Date().toISOString()
  const positiveCount = token.polarity === 'positive' ? 1 : 0
  const negativeCount = token.polarity === 'negative' ? 1 : 0
  const initialStatus = minCount <= 1 ? 'accepted' : 'new'
  db.prepare(`
    INSERT INTO candidate_tags(
      canonical_tag, display_tag, token_kind, positive_count, negative_count,
      source_count, evidence_count, confidence, adult_level, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?)
    ON CONFLICT(canonical_tag) DO UPDATE SET
      display_tag = excluded.display_tag,
      positive_count = candidate_tags.positive_count + excluded.positive_count,
      negative_count = candidate_tags.negative_count + excluded.negative_count,
      evidence_count = candidate_tags.evidence_count + excluded.evidence_count,
      confidence = MAX(candidate_tags.confidence, excluded.confidence),
      adult_level = MAX(candidate_tags.adult_level, excluded.adult_level),
      status = CASE
        WHEN candidate_tags.status IN ('hidden', 'rejected', 'promoted') THEN candidate_tags.status
        WHEN excluded.status = 'accepted' THEN 'accepted'
        WHEN candidate_tags.evidence_count + excluded.evidence_count >= ? THEN 'accepted'
        ELSE candidate_tags.status
      END,
      updated_at = excluded.updated_at
  `).run(token.canonical, token.display, token.tokenKind, positiveCount, negativeCount, token.confidence, token.adultLevel, initialStatus, now, now, minCount)

  const candidate = db.prepare('SELECT candidate_id FROM candidate_tags WHERE canonical_tag = ?').get(token.canonical)
  const candidateId = Number(candidate?.candidate_id ?? 0)
  if (!candidateId) return
  db.prepare(`
    INSERT INTO candidate_evidence(candidate_id, source_id, raw_record_id, polarity, occurrence_count, model_family, sample_text, created_at)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?)
  `).run(candidateId, sourceIdValue, rawRecordId, token.polarity, '', token.sampleText, now)

  const existingTranslation = db.prepare('SELECT job_id FROM translation_jobs WHERE candidate_id = ? LIMIT 1').get(candidateId)
  if (!existingTranslation) {
    db.prepare(`
      INSERT INTO translation_jobs(candidate_id, source_text, ja_label, ja_meaning, status, provider, created_at, updated_at)
      VALUES (?, ?, '', ?, 'needs-review', '', ?, ?)
    `).run(candidateId, token.display, `${token.display} prompt tag candidate from public web prompt pages.`, now, now)
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
    WITH web_evidence AS (
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
      COALESCE(we.positive_count, 0) AS positive_count,
      COALESCE(we.negative_count, 0) AS negative_count,
      COALESCE(we.evidence_count, 0) AS evidence_count,
      c.confidence,
      c.adult_level,
      c.status,
      COALESCE((SELECT t.ja_label FROM translation_jobs t WHERE t.candidate_id = c.candidate_id ORDER BY t.updated_at DESC LIMIT 1), '') AS ja_label,
      COALESCE((SELECT t.ja_meaning FROM translation_jobs t WHERE t.candidate_id = c.candidate_id ORDER BY t.updated_at DESC LIMIT 1), '') AS ja_meaning,
      COALESCE((SELECT t.status FROM translation_jobs t WHERE t.candidate_id = c.candidate_id ORDER BY t.updated_at DESC LIMIT 1), 'needs-review') AS curation_status
    FROM candidate_tags c
    JOIN web_evidence we ON we.candidate_id = c.candidate_id
    WHERE c.status IN ('accepted', 'promoted')
      AND c.token_kind IN ('tag', 'phrase', 'quality', 'negative')
    ORDER BY we.evidence_count DESC, c.confidence DESC, c.canonical_tag ASC
    LIMIT ?
  `).all(source.sourceId, Math.max(1, positiveInteger(args.promoteLimit, DEFAULT_PROMOTE_LIMIT)))

  const snapshot = {
    schemaVersion: 1,
    sourceId: source.sourceId,
    sourceLabel: source.displayName,
    exportedAt: new Date().toISOString(),
    rawPromptRecords: db.prepare('SELECT COUNT(*) AS count FROM raw_prompt_records WHERE source_id = ?').get(source.sourceId).count,
    entries: rows.map((row) => ({
      tag: cleanString(row.display_tag || row.canonical_tag),
      canonicalTag: cleanString(row.canonical_tag || row.display_tag),
      tokenKind: cleanString(row.token_kind || 'tag'),
      positiveCount: Number(row.positive_count ?? 0),
      negativeCount: Number(row.negative_count ?? 0),
      evidenceCount: Number(row.evidence_count ?? 0),
      confidence: Number(row.confidence ?? 0),
      adultLevel: Number(row.adult_level ?? 0),
      status: cleanString(row.status || 'accepted'),
      ja: cleanString(row.ja_label),
      meaning: cleanString(row.ja_meaning),
      curationStatus: cleanString(row.curation_status || 'needs-review')
    })).filter((entry) => entry.tag && entry.evidenceCount > 0 && !isNoiseToken(entry.canonicalTag || entry.tag))
  }
  fs.writeFileSync(promotedSnapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  return snapshot.entries.length
}

function extractPromptRecords(url, html) {
  const records = []
  const decoded = decodeHtmlEntities(String(html ?? '')).replace(/\u0000/g, '\n')
  const seen = new Set()

  for (const generationData of extractGenerationData(decoded)) {
    const positivePrompt = cleanString(generationData.prompt || generationData.positivePrompt)
    const negativePrompt = cleanString(generationData.negativePrompt || generationData.negative_prompt)
    if (!positivePrompt && !negativePrompt) continue
    pushRecord(records, seen, url, 'generation-data', positivePrompt, negativePrompt, {
      url,
      kind: 'generation-data',
      modelFamily: cleanString(generationData.baseModel?.baseModel || generationData.baseModel || generationData.Model || generationData.model),
      promptHash: hashText(`${positivePrompt}\0${negativePrompt}`)
    })
  }

  const visibleText = htmlToText(html)
  for (const line of visibleText.split(/\r?\n/)) {
    const prompt = normalizePromptLine(line)
    if (!prompt || !looksLikePromptLine(prompt)) continue
    pushRecord(records, seen, url, 'prompt-line', prompt, '', {
      url,
      kind: 'prompt-line',
      promptHash: hashText(prompt)
    })
  }

  return records
}

function pushRecord(records, seen, url, kind, positivePrompt, negativePrompt, raw) {
  const key = hashText([kind, positivePrompt, negativePrompt].join('\0'))
  if (seen.has(key)) return
  seen.add(key)
  records.push({
    recordId: `${kind}:${hashText(`${url}\0${records.length}\0${key}`).slice(0, 32)}`,
    positivePrompt,
    negativePrompt,
    modelFamily: raw.modelFamily ?? '',
    raw
  })
}

function extractGenerationData(text) {
  const out = []
  const marker = 'generation_data:'
  let offset = 0
  while (offset < text.length) {
    const index = text.indexOf(marker, offset)
    if (index < 0) break
    const braceIndex = text.indexOf('{', index + marker.length)
    if (braceIndex < 0) break
    const jsonText = readBalancedObject(text, braceIndex)
    if (!jsonText) {
      offset = index + marker.length
      continue
    }
    try {
      out.push(JSON.parse(jsonText))
    } catch {
      // Skip malformed embedded generation_data blocks.
    }
    offset = braceIndex + jsonText.length
  }
  return out
}

function readBalancedObject(text, start) {
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
    } else if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return ''
}

function htmlToText(html) {
  return decodeHtmlEntities(String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '\n')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '\n')
    .replace(/<!--[\s\S]*?-->/g, '\n')
    .replace(/<(br|p|div|li|tr|td|th|h[1-6]|blockquote|pre|code)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|li|tr|td|th|h[1-6]|blockquote|pre|code)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  ).replace(/\u0000/g, '\n')
}

function normalizePromptLine(line) {
  return cleanString(line)
    .replace(/\s+/g, ' ')
    .replace(/^[-*•\d.)\s]+/, '')
    .replace(/^(prompts?|positive prompts?|negative prompts?|prompt list)\s*[:：]/i, '')
    .replace(/^(呪文|プロンプト|ネガティブプロンプト)\s*[:：]/, '')
    .trim()
}

function looksLikePromptLine(line) {
  const value = cleanString(line)
  if (!value || value.length > 1200) return false
  if (!/[a-z]/i.test(value)) return false
  if (/https?:\/\//i.test(value)) return false
  if (/(copyright|privacy|cookie|google|twitter|facebook|discord|menu|search|subscribe|login|logout|comment|reply|wordpress|function|window\.|document\.|class=|href=|src=)/i.test(value)) return false
  const hasComma = /[,，、]/.test(value)
  const singlePromptToken = /^[([{"]*[a-z0-9][a-z0-9_\- '.:()"]{1,100}[)\]}"]*,?$/i.test(value) && (/,$/.test(value) || /:\s*[+-]?\d+(?:\.\d+)?\)?$/.test(value))
  if (!hasComma && !singlePromptToken) return false
  const tokens = parsePromptTokens(value, 'positive')
  return tokens.length > 0
}

function parsePromptTokens(prompt, polarity) {
  if (!prompt || typeof prompt !== 'string') return []
  const tokens = splitPrompt(prompt)
  const out = []
  let position = 0
  for (const rawToken of tokens) {
    const parsed = normalizePromptToken(rawToken, polarity, position)
    position += 1
    if (parsed) out.push(parsed)
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
  const raw = cleanString(rawToken)
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
    .replace(/<\s*(lora|lyco|hypernet|embedding):[^>]+>/gi, ' ')
    .replace(/^[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー・\s]+(?=[(（])/u, '')
    .trim()
  const weight = extractWeight(value)
  value = weight.cleaned
    .replace(/^[([{]+/g, '')
    .replace(/[)\]}]+$/g, '')
    .replace(/^"+|"+$/g, '')
    .replace(/^'+|'+$/g, '')
    .replace(/^[・:：;；,，、\s]+/g, '')
    .replace(/[・:：;；,，、\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  value = stripInlineGloss(value)

  if (!value || value.length > 90) return null
  if (!/[a-z]/i.test(value)) return null
  if (/^https?:\/\//i.test(value)) return null
  if (/^[\d\s:._-]+$/.test(value)) return null
  if (/[\[\]{}|]/.test(value)) return null
  if (containsJapanese(value)) return null
  if (looksLikeKeyboardNoise(value)) return null
  if (value.split(/\s+/).length > 5) return null
  if (looksLikeSentence(value)) return null

  const canonical = canonicalizeTag(value)
  if (!canonical || canonical.length < 2 || canonical.length > 90) return null
  if (TOKEN_STOPLIST.has(canonical)) return null
  if (isNoiseToken(canonical)) return null

  const tokenKind = inferTokenKind(canonical, polarity)
  const confidence = confidenceForToken(canonical, tokenKind, weight.value)
  if (confidence < 0.35) return null

  return {
    rawToken: raw,
    display: canonical,
    canonical,
    polarity,
    tokenKind,
    weight: weight.value,
    position,
    confidence,
    adultLevel: adultLevelForToken(canonical),
    sampleText: raw.slice(0, 160)
  }
}

function extractWeight(value) {
  const weighted = cleanString(value).match(/^\(+\s*(.+?)\s*:\s*([+-]?\d+(?:\.\d+)?)\s*\)+$/)
  return weighted ? { cleaned: weighted[1], value: parseWeight(weighted[2]) } : { cleaned: cleanString(value), value: null }
}

function parseWeight(value) {
  const parsed = Number(String(value ?? '').trim())
  return Number.isFinite(parsed) ? parsed : null
}

function canonicalizeTag(value) {
  return cleanString(value)
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

function stripInlineGloss(value) {
  let out = cleanString(value)
  const bilingual = out.match(/[:：]\s*([a-z0-9][a-z0-9_\-\s]{1,80})$/i)
  if (bilingual && containsJapanese(out.slice(0, bilingual.index))) {
    out = bilingual[1]
  }
  return out
    .replace(/\s*[（(][^（）()]*[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー][^（）()]*[）)]\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function containsJapanese(value) {
  return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー・]/u.test(String(value ?? ''))
}

function looksLikeKeyboardNoise(value) {
  const normalized = cleanString(value)
  return /^(esc|esckey|backkey|backspace|enter|shift|ctrl|control|alt|tab)$/i.test(normalized)
    || /(?:^|[_\s-])(?:esc|backspace|enter|shift|ctrl|control|alt|tab)(?:[_\s-]|$)/i.test(normalized)
}

function inferTokenKind(tag, polarity) {
  if (polarity === 'negative') return 'negative'
  if (/^(masterpiece|best_quality|high_quality|amazing_quality|score_\d|score_\d_up|absurdres|highres|ultra_detailed|detailed|very_aesthetic|rating_safe|rating_explicit|rating_questionable)$/.test(tag)) return 'quality'
  if (/^(rating|source|user|commentary|pixiv_id|twitter_username):/i.test(tag)) return 'meta'
  if (/(hair|eyes?|mouth|smile|skin|hands?|fingers?|arms?|legs?|breasts?|face|body|tail|ears?)$/.test(tag)) return 'tag'
  if (/(dress|shirt|skirt|jacket|coat|uniform|kimono|boots|shoes|gloves|hat|ribbon|bow|socks|thighhigh|pantyhose|apron|panties|underwear|lingerie)$/.test(tag)) return 'tag'
  if (/(background|lighting|light|shadow|sky|room|street|forest|water|flower|clouds?|indoors|outdoors)$/.test(tag)) return 'tag'
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

function adultLevelForPrompt(prompt) {
  return parsePromptTokens(prompt, 'positive').some((token) => token.adultLevel > 0) ? 2 : 0
}

function adultLevelForToken(tag) {
  return ADULT_TOKEN_PATTERNS.some((pattern) => pattern.test(tag)) ? 2 : 0
}

function isNoiseToken(tag) {
  const normalized = cleanString(tag).toLowerCase()
  return containsJapanese(normalized) || looksLikeKeyboardNoise(normalized) || WEB_NOISE_TOKEN_PATTERNS.some((pattern) => pattern.test(normalized))
}

async function fetchText(url, attempt = 0) {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent': 'Yoitomoshi-Art-Generator prompt dictionary importer'
    }
  })
  if (response.status === 429 && attempt < 4) {
    const retryAfterSeconds = Number(response.headers.get('retry-after'))
    const waitMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : 10000 * (attempt + 1)
    await sleep(waitMs)
    return fetchText(url, attempt + 1)
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
  return response.text()
}

function createRun(db, runId, sourceIdValue, startedAt, config) {
  db.prepare('INSERT INTO import_runs(run_id, source_id, status, started_at, config_json) VALUES (?, ?, ?, ?, ?)').run(runId, sourceIdValue, 'running', startedAt, JSON.stringify(config))
}

function finishRun(db, runId, status, cursorAfter, fetchedCount, rawRecordCount, errorMessage) {
  db.prepare(`
    UPDATE import_runs
    SET status = ?, finished_at = ?, cursor_after = ?, fetched_count = ?, raw_record_count = ?, error_message = ?
    WHERE run_id = ?
  `).run(status, new Date().toISOString(), cursorAfter ?? '', fetchedCount, rawRecordCount, errorMessage, runId)
}

function snapshotSources(db, sources) {
  const now = new Date().toISOString()
  const insert = db.prepare(`
    INSERT INTO source_registry_snapshot(
      source_id, display_name, source_type, allowed_mode, base_url, terms_url,
      license_note, rate_limit_rps, stores_raw_prompts, stores_images, adult_policy, checked_at, source_json, updated_at
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
      insert.run(source.sourceId, source.displayName, source.sourceType, source.allowedMode, source.baseUrl, source.termsUrl, source.licenseNote, source.rateLimitRps, source.storesRawPrompts ? 1 : 0, source.storesImages ? 1 : 0, source.adultPolicy, source.checkedAt, JSON.stringify(source), now)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function resetSourceData(db, sourceIdValue) {
  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM candidate_evidence WHERE source_id = ?').run(sourceIdValue)
    db.prepare('DELETE FROM raw_prompt_records WHERE source_id = ?').run(sourceIdValue)
    db.prepare('DELETE FROM import_cursors WHERE source_id = ?').run(sourceIdValue)
    db.prepare('DELETE FROM import_runs WHERE source_id = ?').run(sourceIdValue)

    const orphanRows = db.prepare(`
      SELECT c.candidate_id
      FROM candidate_tags c
      LEFT JOIN candidate_evidence e ON e.candidate_id = c.candidate_id
      WHERE e.evidence_id IS NULL
    `).all()
    const deleteTranslation = db.prepare('DELETE FROM translation_jobs WHERE candidate_id = ?')
    const deletePromotion = db.prepare('DELETE FROM promotion_decisions WHERE candidate_id = ?')
    const deleteCandidate = db.prepare('DELETE FROM candidate_tags WHERE candidate_id = ?')
    for (const row of orphanRows) {
      deleteTranslation.run(row.candidate_id)
      deletePromotion.run(row.candidate_id)
      deleteCandidate.run(row.candidate_id)
    }

    refreshCandidateAggregates(db)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function refreshCandidateAggregates(db) {
  const now = new Date().toISOString()
  db.prepare(`
    UPDATE candidate_tags
    SET
      positive_count = COALESCE((
        SELECT SUM(occurrence_count)
        FROM candidate_evidence e
        WHERE e.candidate_id = candidate_tags.candidate_id AND e.polarity = 'positive'
      ), 0),
      negative_count = COALESCE((
        SELECT SUM(occurrence_count)
        FROM candidate_evidence e
        WHERE e.candidate_id = candidate_tags.candidate_id AND e.polarity = 'negative'
      ), 0),
      source_count = COALESCE((
        SELECT COUNT(DISTINCT source_id)
        FROM candidate_evidence e
        WHERE e.candidate_id = candidate_tags.candidate_id
      ), 0),
      evidence_count = COALESCE((
        SELECT SUM(occurrence_count)
        FROM candidate_evidence e
        WHERE e.candidate_id = candidate_tags.candidate_id
      ), 0),
      updated_at = ?
  `).run(now)

  const rows = db.prepare('SELECT candidate_id, canonical_tag FROM candidate_tags').all()
  const updateAdult = db.prepare('UPDATE candidate_tags SET adult_level = ? WHERE candidate_id = ?')
  for (const row of rows) updateAdult.run(adultLevelForToken(row.canonical_tag), row.candidate_id)
}

function collectUrls(parsedArgs) {
  const urls = []
  for (const value of parsedArgs.urls) urls.push(value)
  if (parsedArgs.urlsFile) {
    const lines = fs.readFileSync(parsedArgs.urlsFile, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
    urls.push(...lines)
  }
  if (urls.length === 0) urls.push(...DEFAULT_URLS)
  return [...new Set(urls.map(cleanString).filter(Boolean))]
}

function loadRegistry() {
  const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8'))
  if (!Array.isArray(parsed.sources)) throw new Error('sources.json must contain sources')
  return parsed
}

function parseArgs(argv) {
  const out = { urls: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--url') out.urls.push(argv[++index])
    else if (arg === '--urls-file') out.urlsFile = argv[++index]
    else if (arg === '--min-count') out.minCount = Number(argv[++index])
    else if (arg === '--promote-limit') out.promoteLimit = Number(argv[++index])
    else if (arg === '--rate-limit-ms') out.rateLimitMs = Number(argv[++index])
    else if (arg === '--data-root') out.dataRoot = argv[++index]
    else if (arg === '--resources-dir') out.resourcesDir = argv[++index]
    else if (arg === '--export-only') out.exportOnly = true
    else if (arg === '--reset-source') out.resetSource = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return out
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function countRows(db, tableName) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get()?.count ?? 0)
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
}

function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
}

function hashText(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
  'home',
  'prompt',
  'prompts',
  'negative_prompt',
  'lowers',
  'none',
  'null',
  'undefined',
  'unknown'
])

const WEB_NOISE_TOKEN_PATTERNS = [
  /^yoitomoshi_/,
  /(^|_)(qa|smoke|regression|validation|preflight|fixture)(_|$)/,
  /(^|_)(menu|search|login|logout|subscribe|comment|reply|email|required|website)(_|$)/,
  /(^|_)(stable_diffusion|midjourney|comfyui|a1111|wordpress|google|twitter|facebook|discord)(_|$)/,
  /(^|_)data_(src|id|state|theme)(_|$)/,
  /^(home|top|close|back|next|previous)$/,
  /^wp_/,
  /^http/
]

const ADULT_TOKEN_PATTERNS = [
  /\bnsfw\b/,
  /\bnude\b/,
  /\bnudity\b/,
  /\bsex\b/,
  /\berotic\b/,
  /\bahegao\b/,
  /\bpussy\b/,
  /\bpenis\b/,
  /\bvagina\b/,
  /\banus\b/,
  /\banal\b/,
  /\bnipple/,
  /\bareola/,
  /\bcum\b/,
  /\bejaculation\b/,
  /\bblowjob\b/,
  /\bmasturbation\b/,
  /\bsex_toy\b/,
  /\bdildo\b/,
  /\bvibrator\b/,
  /\bbutt_plug\b/,
  /\bpanties\b/,
  /\bunderwear\b/,
  /\blingerie\b/,
  /\bbreasts?\b/,
  /\bass\b/,
  /\bbdsm\b/,
  /\borgasm\b/,
  /\btopless\b/
]

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
