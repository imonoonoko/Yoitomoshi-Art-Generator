const fs = require('node:fs')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const yaml = require('js-yaml')
const { DatabaseSync } = require('node:sqlite')

const projectRoot = path.resolve(__dirname, '..')
const args = parseArgs(process.argv.slice(2))
const resourcesDir = path.resolve(args.resourcesDir ?? path.join(projectRoot, 'resources'))
const dataRoot = path.resolve(args.dataRoot ?? path.join(projectRoot, 'userdata'))
const registryPath = path.join(resourcesDir, 'prompt-dictionary', 'sources.json')
const schemaPath = path.join(resourcesDir, 'prompt-dictionary', 'ingest-schema.sql')
const dbDir = path.join(dataRoot, 'prompt-dictionary')
const dbPath = path.join(dbDir, 'ingest.sqlite')
const promotedSnapshotPath = path.resolve(args.output ?? path.join(dbDir, 'promoted-candidates.local.json'))
const sourceId = 'local-user-prompts'
const PARSER_VERSION = 'local-prompt-tokenizer-v1'

const DEFAULT_MIN_COUNT = 2
const DEFAULT_PROMOTE_LIMIT = 5000
const DEFAULT_MAX_HISTORY = 500

function main() {
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
  const maxHistory = Math.max(0, positiveInteger(args.maxHistory, DEFAULT_MAX_HISTORY))
  const translationIndex = loadTranslationIndex()
  const records = collectLocalRecords(maxHistory, translationIndex)
  const stats = {
    runId,
    dbPath,
    sourceId,
    collectedRecords: records.length,
    insertedRecords: 0,
    skippedExistingRecords: 0,
    recordsWithoutPrompt: 0,
    parsedTokens: 0,
    candidateTouches: 0,
    acceptedCandidates: 0,
    candidateTags: 0,
    rawPromptRecords: 0,
    exportedEntries: 0,
    promotedSnapshotPath
  }

  try {
    db.exec('PRAGMA foreign_keys=ON')
    db.exec(fs.readFileSync(schemaPath, 'utf8'))
    snapshotSources(db, registry.sources)
    db.prepare('INSERT OR REPLACE INTO ingest_meta(key, value) VALUES (?, ?)').run('initialized_at', startedAt)
    if (args.exportOnly) {
      stats.exportedEntries = writePromotedSnapshot(db, source, translationIndex)
      console.log(JSON.stringify({ ...stats, exportOnly: true }, null, 2))
      return
    }

    createRun(db, runId, sourceId, startedAt, { minCount, promoteLimit, maxHistory })
    for (const record of records) {
      const imported = importLocalRecord(db, source, record, translationIndex, minCount)
      stats.insertedRecords += imported.insertedRecord ? 1 : 0
      stats.skippedExistingRecords += imported.skippedExisting ? 1 : 0
      stats.recordsWithoutPrompt += imported.withoutPrompt ? 1 : 0
      stats.parsedTokens += imported.parsedTokens
      stats.candidateTouches += imported.candidateTouches
    }
    stats.acceptedCandidates = acceptCandidates(db, minCount, promoteLimit)
    stats.candidateTags = countRows(db, 'candidate_tags')
    stats.rawPromptRecords = countRows(db, 'raw_prompt_records')
    stats.exportedEntries = writePromotedSnapshot(db, source, translationIndex)
    finishRun(db, runId, 'completed', '', records.length, stats.insertedRecords, null)
    console.log(JSON.stringify(stats, null, 2))
  } catch (error) {
    finishRun(db, runId, 'failed', '', records.length, stats.insertedRecords, error?.message ?? String(error))
    throw error
  } finally {
    db.close()
  }
}

function collectLocalRecords(maxHistory, translationIndex) {
  const records = []
  for (const item of readJsonArray(path.join(dataRoot, 'history', 'index.json')).slice(0, maxHistory)) {
    const id = cleanString(item.id) || hashText(JSON.stringify([item.createdAt, item.prompt, item.negativePrompt]))
    records.push({
      recordId: `history:${id}`,
      kind: 'history',
      positivePrompt: cleanString(item.prompt),
      negativePrompt: cleanString(item.negativePrompt),
      createdAt: typeof item.createdAt === 'number' ? new Date(item.createdAt).toISOString() : null,
      modelFamily: guessModelFamily(item.params?.model),
      resources: Array.isArray(item.params?.activeLoras)
        ? item.params.activeLoras.map((lora) => ({ type: 'lora', name: cleanString(lora.name), weight: lora.weight ?? null })).filter((x) => x.name)
        : [],
      raw: {
        kind: 'history',
        id,
        model: item.params?.model ?? null,
        sampler: item.params?.sampler ?? null,
        width: item.params?.width ?? null,
        height: item.params?.height ?? null
      }
    })
  }

  for (const item of readJsonArray(path.join(dataRoot, 'presets.json'))) {
    const id = cleanString(item.id) || hashText(JSON.stringify(item))
    records.push({
      recordId: `preset:${id}`,
      kind: 'preset',
      positivePrompt: cleanString(item.prompt),
      negativePrompt: cleanString(item.negativePrompt),
      createdAt: typeof item.updatedAt === 'number' ? new Date(item.updatedAt).toISOString() : null,
      modelFamily: '',
      resources: [],
      raw: { kind: 'preset', id, name: cleanString(item.name) }
    })
  }

  for (const item of readJsonArray(path.join(dataRoot, 'quick-presets.json'))) {
    const id = cleanString(item.id) || hashText(JSON.stringify(item))
    records.push({
      recordId: `quick-preset:${id}`,
      kind: 'quick-preset',
      positivePrompt: item.target === 'negative' ? '' : cleanString(item.text),
      negativePrompt: item.target === 'negative' ? cleanString(item.text) : '',
      createdAt: null,
      modelFamily: '',
      resources: [],
      raw: { kind: 'quick-preset', id, name: cleanString(item.name), target: item.target }
    })
  }

  for (const tag of collectCustomLibraryTags()) {
    const canonical = canonicalizeTag(tag.en)
    const translated = {
      ja: cleanString(tag.ja),
      meaning: cleanString(tag.ja) ? `${cleanString(tag.ja)}を表すユーザー辞書タグ。` : '',
      aliases: Array.isArray(tag.aliases) ? tag.aliases.map(cleanString).filter(Boolean) : []
    }
    if (canonical) translationIndex.set(canonical, translated)
    records.push({
      recordId: `custom-library:${hashText(`${canonical}\0${translated.ja}`)}`,
      kind: 'custom-library',
      positivePrompt: cleanString(tag.en),
      negativePrompt: tag.polarity === 'negative' ? cleanString(tag.en) : '',
      createdAt: null,
      modelFamily: '',
      resources: [],
      curatedTags: [{ tag: cleanString(tag.en), ja: translated.ja, aliases: translated.aliases, polarity: tag.polarity ?? 'positive' }],
      raw: { kind: 'custom-library', category: tag.category, group: tag.group, tag: tag.en }
    })
  }

  for (const item of readJsonArray(path.join(dataRoot, 'lora-prompt-overrides.json'))) {
    const id = cleanString(item.id) || hashText(JSON.stringify(item))
    records.push({
      recordId: `lora-override:${id}`,
      kind: 'lora-override',
      positivePrompt: cleanString(item.prompt || item.positivePrompt),
      negativePrompt: cleanString(item.negativePrompt),
      createdAt: null,
      modelFamily: '',
      resources: [{ type: 'lora-override', name: cleanString(item.name || item.loraName || id) }],
      raw: { kind: 'lora-override', id, name: cleanString(item.name || item.loraName) }
    })
  }

  for (const item of readJsonArray(path.join(dataRoot, 'checkpoint-prompt-profiles.json'))) {
    const id = cleanString(item.id) || hashText(JSON.stringify(item))
    const positiveParts = [
      ...stringList(item.positiveTags),
      ...stringList(item.tags),
      cleanString(item.prompt),
      cleanString(item.positivePrompt)
    ].filter(Boolean)
    const negativeParts = [
      ...stringList(item.negativeTags),
      cleanString(item.negativePrompt)
    ].filter(Boolean)
    records.push({
      recordId: `checkpoint-profile:${id}`,
      kind: 'checkpoint-profile',
      positivePrompt: positiveParts.join(', '),
      negativePrompt: negativeParts.join(', '),
      createdAt: null,
      modelFamily: cleanString(item.promptFamily || item.modelFamily),
      resources: [],
      raw: { kind: 'checkpoint-profile', id, name: cleanString(item.name || item.checkpointTitle) }
    })
  }

  return records.filter((record) => record.positivePrompt || record.negativePrompt || record.curatedTags?.length)
}

function importLocalRecord(db, source, record, translationIndex, minCount) {
  const existing = db.prepare('SELECT id FROM raw_prompt_records WHERE source_id = ? AND source_record_id = ?').get(source.sourceId, record.recordId)
  if (existing) return { insertedRecord: false, skippedExisting: true, withoutPrompt: false, parsedTokens: 0, candidateTouches: 0 }
  if (!record.positivePrompt && !record.negativePrompt && !record.curatedTags?.length) {
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
    JSON.stringify(record.resources ?? []),
    adultLevel,
    now,
    record.createdAt ?? null,
    JSON.stringify(record.raw ?? { kind: record.kind })
  )
  const rawRecordId = Number(result.lastInsertRowid)
  let parsedTokens = 0
  let candidateTouches = 0
  const parsed = [
    ...parsePromptTokens(record.positivePrompt, 'positive'),
    ...parsePromptTokens(record.negativePrompt, 'negative'),
    ...(record.curatedTags ?? []).map((tag, index) => tokenFromCuratedTag(tag, index))
  ].filter(Boolean)
  for (const token of parsed) {
    parsedTokens += 1
    insertParseResult(db, rawRecordId, token)
    if (token.tokenKind === 'resource' || token.tokenKind === 'meta') continue
    upsertCandidate(db, source.sourceId, rawRecordId, token, translationIndex, minCount)
    candidateTouches += 1
  }
  db.prepare('UPDATE raw_prompt_records SET parse_status = ? WHERE id = ?').run('parsed', rawRecordId)
  return { insertedRecord: true, skippedExisting: false, withoutPrompt: false, parsedTokens, candidateTouches }
}

function tokenFromCuratedTag(tag, index) {
  const canonical = canonicalizeTag(tag.tag)
  if (!canonical) return null
  return {
    rawToken: tag.tag,
    display: canonical,
    canonical,
    polarity: tag.polarity === 'negative' ? 'negative' : 'positive',
    tokenKind: tag.polarity === 'negative' ? 'negative' : inferTokenKind(canonical, 'positive'),
    weight: null,
    position: 10000 + index,
    confidence: 1,
    adultLevel: adultLevelForToken(canonical),
    sampleText: tag.tag,
    curatedJa: cleanString(tag.ja),
    aliases: Array.isArray(tag.aliases) ? tag.aliases.map(cleanString).filter(Boolean) : [],
    forceAccept: true
  }
}

function insertParseResult(db, rawRecordId, token) {
  db.prepare(`
    INSERT OR IGNORE INTO prompt_parse_results(
      raw_record_id, polarity, raw_token, canonical_candidate, token_kind,
      weight, prompt_position, confidence, parser_version, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(rawRecordId, token.polarity, token.rawToken, token.canonical, token.tokenKind, token.weight, token.position, token.confidence, PARSER_VERSION, new Date().toISOString())
}

function upsertCandidate(db, sourceIdValue, rawRecordId, token, translationIndex, minCount) {
  const now = new Date().toISOString()
  const positiveCount = token.polarity === 'positive' ? 1 : 0
  const negativeCount = token.polarity === 'negative' ? 1 : 0
  const initialStatus = token.forceAccept ? 'accepted' : (minCount <= 1 ? 'accepted' : 'new')
  db.prepare(`
    INSERT INTO candidate_tags(
      canonical_tag, display_tag, token_kind, positive_count, negative_count,
      source_count, evidence_count, confidence, adult_level, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?)
    ON CONFLICT(canonical_tag) DO UPDATE SET
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

  const translated = token.curatedJa
    ? { ja: token.curatedJa, meaning: `${token.curatedJa}を表すユーザー辞書タグ。`, aliases: token.aliases ?? [], status: 'curated', provider: 'local-custom-library' }
    : translationForToken(token.display, translationIndex)
  upsertTranslationJob(db, candidateId, token.display, translated, now)
}

function upsertTranslationJob(db, candidateId, sourceText, translated, now) {
  const existing = db.prepare('SELECT job_id, ja_label, status FROM translation_jobs WHERE candidate_id = ? ORDER BY updated_at DESC LIMIT 1').get(candidateId)
  if (!existing) {
    db.prepare(`
      INSERT INTO translation_jobs(candidate_id, source_text, ja_label, ja_meaning, status, provider, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(candidateId, sourceText, translated.ja, translated.meaning, translated.status, translated.provider, now, now)
    return
  }
  if (translated.ja && !cleanString(existing.ja_label)) {
    db.prepare(`
      UPDATE translation_jobs
      SET ja_label = ?, ja_meaning = ?, status = ?, provider = ?, updated_at = ?
      WHERE job_id = ?
    `).run(translated.ja, translated.meaning, translated.status, translated.provider, now, existing.job_id)
  }
}

function acceptCandidates(db, minCount, promoteLimit) {
  const rows = db.prepare(`
    SELECT c.candidate_id
    FROM candidate_tags c
    WHERE c.status IN ('new', 'needs-review', 'accepted')
      AND c.token_kind IN ('tag', 'phrase', 'quality', 'negative')
      AND (
        c.evidence_count >= ?
        OR EXISTS (
          SELECT 1 FROM translation_jobs t
          WHERE t.candidate_id = c.candidate_id AND t.status = 'curated'
        )
      )
    ORDER BY c.evidence_count DESC, c.confidence DESC, c.canonical_tag ASC
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

function writePromotedSnapshot(db, source, translationIndex) {
  const rows = db.prepare(`
    WITH local_evidence AS (
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
      COALESCE(le.positive_count, 0) AS positive_count,
      COALESCE(le.negative_count, 0) AS negative_count,
      COALESCE(le.evidence_count, 0) AS evidence_count,
      c.confidence,
      c.adult_level,
      c.status,
      COALESCE((
        SELECT t.ja_label FROM translation_jobs t
        WHERE t.candidate_id = c.candidate_id
        ORDER BY CASE t.status WHEN 'curated' THEN 1 WHEN 'source-derived' THEN 2 WHEN 'machine-draft' THEN 3 ELSE 4 END, t.updated_at DESC
        LIMIT 1
      ), '') AS ja_label,
      COALESCE((
        SELECT t.ja_meaning FROM translation_jobs t
        WHERE t.candidate_id = c.candidate_id
        ORDER BY CASE t.status WHEN 'curated' THEN 1 WHEN 'source-derived' THEN 2 WHEN 'machine-draft' THEN 3 ELSE 4 END, t.updated_at DESC
        LIMIT 1
      ), '') AS ja_meaning,
      COALESCE((
        SELECT t.status FROM translation_jobs t
        WHERE t.candidate_id = c.candidate_id
        ORDER BY CASE t.status WHEN 'curated' THEN 1 WHEN 'source-derived' THEN 2 WHEN 'machine-draft' THEN 3 ELSE 4 END, t.updated_at DESC
        LIMIT 1
      ), 'needs-review') AS curation_status
    FROM candidate_tags c
    JOIN local_evidence le ON le.candidate_id = c.candidate_id
    WHERE c.status IN ('accepted', 'promoted')
      AND c.token_kind IN ('tag', 'phrase', 'quality', 'negative')
    ORDER BY le.evidence_count DESC, c.confidence DESC, c.canonical_tag ASC
  `).all(source.sourceId)
  const snapshot = {
    schemaVersion: 1,
    sourceId: source.sourceId,
    sourceLabel: source.displayName,
    exportedAt: new Date().toISOString(),
    rawPromptRecords: db.prepare('SELECT COUNT(*) AS count FROM raw_prompt_records WHERE source_id = ?').get(source.sourceId).count,
    entries: rows.map((row) => {
      const tag = cleanString(row.display_tag || row.canonical_tag)
      const translated = translationIndex.get(canonicalizeTag(tag)) ?? {}
      const ja = cleanString(row.ja_label) || translated.ja || draftJapaneseLabel(canonicalizeTag(tag))
      const curationStatus = cleanString(row.curation_status)
      const finalCurationStatus = ja
        ? (curationStatus && curationStatus !== 'needs-review' ? curationStatus : 'machine-draft')
        : (curationStatus || 'needs-review')
      return {
        tag,
        canonicalTag: cleanString(row.canonical_tag || tag),
        tokenKind: cleanString(row.token_kind || 'tag'),
        positiveCount: Number(row.positive_count ?? 0),
        negativeCount: Number(row.negative_count ?? 0),
        evidenceCount: Number(row.evidence_count ?? 0),
        confidence: Number(row.confidence ?? 0),
        adultLevel: Number(row.adult_level ?? 0),
        status: cleanString(row.status || 'accepted'),
        ja,
        meaning: cleanString(row.ja_meaning) || translated.meaning || draftJapaneseMeaning(tag, ja),
        curationStatus: finalCurationStatus,
        aliases: translated.aliases ?? []
      }
    }).filter((entry) => entry.tag && entry.evidenceCount > 0 && !isLocalNoiseToken(entry.canonicalTag || entry.tag))
  }
  fs.writeFileSync(promotedSnapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  return snapshot.entries.length
}

function loadTranslationIndex() {
  const index = new Map()
  for (const file of ['prompt-library.ja.yaml', 'prompt-library.yoitomoshi.ja.yaml', 'prompt-dictionary.yoitomoshi.ja.yaml']) {
    const fullPath = path.join(resourcesDir, file)
    if (!fs.existsSync(fullPath)) continue
    const parsed = yaml.load(fs.readFileSync(fullPath, 'utf8'))
    if (!Array.isArray(parsed)) continue
    for (const category of parsed) {
      if (!category || !Array.isArray(category.groups)) continue
      for (const group of category.groups) {
        if (!group || !group.tags || typeof group.tags !== 'object') continue
        if (Array.isArray(group.tags)) {
          for (const tag of group.tags) addTranslation(index, tag.en, tag.ja, category.name, group.name, tag.aliases)
        } else {
          for (const [en, ja] of Object.entries(group.tags)) addTranslation(index, en, ja, category.name, group.name, [])
        }
      }
    }
  }
  for (const tag of collectCustomLibraryTags()) addTranslation(index, tag.en, tag.ja, tag.category, tag.group, tag.aliases)
  const civitaiSnapshot = path.join(resourcesDir, 'prompt-dictionary', 'promoted-candidates.civitai.json')
  if (fs.existsSync(civitaiSnapshot)) {
    const parsed = JSON.parse(fs.readFileSync(civitaiSnapshot, 'utf8'))
    if (Array.isArray(parsed.entries)) {
      for (const entry of parsed.entries) addTranslation(index, entry.tag, entry.ja, '', '', entry.aliases)
    }
  }
  return index
}

function addTranslation(index, en, ja, category, group, aliases) {
  const canonical = canonicalizeTag(en)
  if (!canonical) return
  const label = cleanString(ja)
  const existing = index.get(canonical) ?? {}
  index.set(canonical, {
    ja: existing.ja || label,
    meaning: existing.meaning || (label ? `${label}を表す生成用タグ。` : ''),
    aliases: Array.from(new Set([...(existing.aliases ?? []), ...stringList(aliases), cleanString(category), cleanString(group)].filter(Boolean)))
  })
}

function collectCustomLibraryTags() {
  const out = []
  const doc = readJson(path.join(dataRoot, 'custom-prompt-library.json'))
  const categories = Array.isArray(doc) ? doc : Array.isArray(doc?.categories) ? doc.categories : []
  for (const category of categories) {
    if (!category || !Array.isArray(category.groups)) continue
    for (const group of category.groups) {
      if (!group || !Array.isArray(group.tags)) continue
      for (const tag of group.tags) {
        if (!tag || typeof tag.en !== 'string') continue
        out.push({
          en: cleanString(tag.en),
          ja: cleanString(tag.ja),
          aliases: Array.isArray(tag.aliases) ? tag.aliases.map(cleanString).filter(Boolean) : [],
          polarity: tag.polarity === 'negative' ? 'negative' : 'positive',
          category: cleanString(category.name),
          group: cleanString(group.name)
        })
      }
    }
  }
  return out
}

function translationForToken(tag, index) {
  const found = index.get(canonicalizeTag(tag))
  if (found?.ja) return { ja: found.ja, meaning: found.meaning || draftJapaneseMeaning(tag, found.ja), status: 'source-derived', provider: 'local-library-map' }
  const ja = draftJapaneseLabel(tag)
  return {
    ja,
    meaning: draftJapaneseMeaning(tag, ja),
    status: ja ? 'machine-draft' : 'needs-review',
    provider: ja ? 'yoitomoshi-heuristic-v1' : ''
  }
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
  const raw = rawToken.trim()
  if (!raw) return null
  const lora = raw.match(/^<\s*(lora|lyco|hypernet|embedding):([^:>]+)(?::([^>]+))?>$/i)
  if (lora) return { rawToken: raw, display: lora[2].trim(), canonical: canonicalizeTag(lora[2]), polarity, tokenKind: 'resource', weight: parseWeight(lora[3]), position, confidence: 0.95, adultLevel: 0, sampleText: raw }
  let value = raw.replace(/<\s*(lora|lyco|hypernet|embedding):[^>]+>/gi, ' ').trim()
  if (!value) return null
  const weight = extractWeight(value)
  value = weight.cleaned.replace(/^[([{]+/g, '').replace(/[)\]}]+$/g, '').replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '').replace(/\s+/g, ' ').trim()
  if (!value || value.length > 90) return null
  if (/^https?:\/\//i.test(value) || /^[\d\s:._-]+$/.test(value) || /[{}|]/.test(value)) return null
  if (value.split(/\s+/).length > 5 || looksLikeSentence(value)) return null
  const canonical = canonicalizeTag(value)
  if (!canonical || canonical.length < 2 || TOKEN_STOPLIST.has(canonical)) return null
  if (isLocalNoiseToken(canonical)) return null
  const tokenKind = inferTokenKind(canonical, polarity)
  const confidence = confidenceForToken(canonical, tokenKind, weight.value)
  if (confidence < 0.35) return null
  return { rawToken: raw, display: canonical, canonical, polarity, tokenKind, weight: weight.value, position, confidence, adultLevel: adultLevelForToken(canonical), sampleText: raw.slice(0, 160) }
}

function extractWeight(value) {
  const weighted = value.trim().match(/^\(+\s*(.+?)\s*:\s*([+-]?\d+(?:\.\d+)?)\s*\)+$/)
  return weighted ? { cleaned: weighted[1], value: parseWeight(weighted[2]) } : { cleaned: value.trim(), value: null }
}

function parseWeight(value) {
  const parsed = Number(String(value ?? '').trim())
  return Number.isFinite(parsed) ? parsed : null
}

function inferTokenKind(tag, polarity) {
  if (polarity === 'negative') return 'negative'
  if (/^(masterpiece|best_quality|high_quality|amazing_quality|score_\d|score_\d_up|absurdres|highres|ultra_detailed|detailed|very_aesthetic)$/.test(tag)) return 'quality'
  if (/^(rating|source|user|commentary|pixiv_id|twitter_username):/i.test(tag)) return 'meta'
  if (/(hair|eyes?|mouth|smile|skin|hands?|fingers?|arms?|legs?|breasts?|face|body|tail|ears?)$/.test(tag)) return 'tag'
  if (/(dress|shirt|skirt|jacket|coat|uniform|kimono|boots|shoes|gloves|hat|ribbon|bow|socks|pantyhose|apron)$/.test(tag)) return 'tag'
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
  return splitPrompt(prompt).some((token) => adultLevelForToken(canonicalizeTag(token)) > 0) ? 2 : 0
}

function adultLevelForToken(tag) {
  return ADULT_TOKEN_PATTERNS.some((pattern) => pattern.test(tag)) ? 2 : 0
}

function isLocalNoiseToken(tag) {
  return LOCAL_NOISE_TOKEN_PATTERNS.some((pattern) => pattern.test(tag))
}

function draftJapaneseLabel(tag) {
  if (JA_FULL_TAGS[tag]) return JA_FULL_TAGS[tag]
  const parts = tag.split('_').filter(Boolean)
  if (parts.length === 0 || parts.length > 4) return ''
  const translated = parts.map((part) => JA_PARTS[part] ?? '')
  return translated.every(Boolean) ? translated.join('') : ''
}

function draftJapaneseMeaning(tag, ja) {
  if (ja) return `${ja}を表す生成用タグ。ローカル履歴/ユーザー辞書から抽出したドラフト。`
  return `${tag} を表す生成用タグ候補。ローカル履歴/ユーザー辞書から抽出。日本語訳はレビュー待ち。`
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

function loadRegistry() {
  const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8'))
  if (!Array.isArray(parsed.sources)) throw new Error('sources.json must contain sources')
  return parsed
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')) } catch { return null }
}

function readJsonArray(filePath) {
  const parsed = readJson(filePath)
  return Array.isArray(parsed) ? parsed : []
}

function stringList(value) {
  if (!Array.isArray(value)) return []
  return value.map(cleanString).filter(Boolean)
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
}

function canonicalizeTag(value) {
  return cleanString(value).toLowerCase().replace(/[“”]/g, '"').replace(/[’]/g, "'").replace(/\s*\/\s*/g, '_').replace(/\s+/g, '_').replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '')
}

function looksLikeSentence(value) {
  return /[.!?。！？]/.test(value) || (/\b(and|with|while|because|that|which)\b/i.test(value) && value.split(/\s+/).length > 3)
}

function guessModelFamily(value) {
  const haystack = cleanString(value).toLowerCase()
  if (haystack.includes('pony')) return 'pony'
  if (haystack.includes('illustrious')) return 'illustrious'
  if (haystack.includes('animagine')) return 'animagine'
  if (haystack.includes('flux')) return 'flux'
  if (haystack.includes('sdxl') || haystack.includes('xl')) return 'sdxl'
  if (haystack.includes('1.5') || haystack.includes('sd15')) return 'sd15'
  return ''
}

function countRows(db, tableName) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get()?.count ?? 0)
}

function hashText(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--min-count') out.minCount = Number(argv[++i])
    else if (arg === '--promote-limit') out.promoteLimit = Number(argv[++i])
    else if (arg === '--max-history') out.maxHistory = Number(argv[++i])
    else if (arg === '--data-root') out.dataRoot = argv[++i]
    else if (arg === '--resources-dir') out.resourcesDir = argv[++i]
    else if (arg === '--output') out.output = argv[++i]
    else if (arg === '--export-only') out.exportOnly = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return out
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback
}

const TOKEN_STOPLIST = new Set(['and', 'or', 'the', 'a', 'an', 'by', 'with', 'from', 'for', 'to', 'of', 'in', 'on', 'as', 'very', 'extremely', 'image', 'picture', 'prompt', 'negative_prompt', 'none', 'null', 'undefined', 'unknown', 'automatic'])

const ADULT_TOKEN_PATTERNS = [
  /(^|_)nsfw(_|$)/,
  /(^|_)nude(_|$)/,
  /(^|_)nudity(_|$)/,
  /(^|_)sex(_|$)/,
  /(^|_)erotic(_|$)/,
  /(^|_)ahegao(_|$)/,
  /(^|_)pussy(_|$)/,
  /(^|_)penis(_|$)/,
  /(^|_)vagina(_|$)/,
  /(^|_)anus(_|$)/,
  /(^|_)anal(_|$)/,
  /(^|_)nipple/,
  /(^|_)areola/,
  /(^|_)cum(_|$)/,
  /(^|_)ejaculation(_|$)/,
  /(^|_)blowjob(_|$)/,
  /(^|_)masturbation(_|$)/,
  /(^|_)sex_toy(_|$)/,
  /(^|_)dildo(_|$)/,
  /(^|_)vibrator(_|$)/,
  /(^|_)butt_plug(_|$)/,
  /(^|_)hitachi_magic_wand(_|$)/,
  /(^|_)panties(_|$)/,
  /(^|_)underwear(_|$)/,
  /(^|_)breasts?(_|$)/,
  /(^|_)ass(_|$)/,
  /(^|_)bdsm(_|$)/,
  /(^|_)orgasm(_|$)/,
  /(^|_)gagged(_|$)/,
  /(^|_)bound(_|$)/,
  /(^|_)restraints?(_|$)/,
  /(^|_)topless(_|$)/,
  /(^|_)underbutt(_|$)/,
  /(^|_)lingerie(_|$)/,
  /(^|_)object_insertion(_|$)/,
  /(^|_)clothing_aside(_|$)/,
  /(^|_)glory_wall(_|$)/,
  /(^|_)milking_machine(_|$)/,
  /(^|_)whale_tail(_|$)/
]

const LOCAL_NOISE_TOKEN_PATTERNS = [
  /^yoitomoshi_/,
  /(^|_)(qa|smoke|regression|validation|preflight|fixture)(_|$)/,
  /(^|_)(dom_qa|qa_dom|test_case|test_fixture)(_|$)/,
  /(^|_)comfy_v2(_|$)/
]

const JA_FULL_TAGS = {
  '1girl': '1人の女の子',
  '1boy': '1人の男の子',
  '2girls': '2人の女の子',
  'solo': '単独',
  'masterpiece': '傑作',
  'best_quality': '最高品質',
  'amazing_quality': '非常に高品質',
  'high_quality': '高品質',
  'low_quality': '低品質',
  'worst_quality': '最低品質',
  'very_aesthetic': '美麗',
  'high_resolution': '高解像度',
  'highres': '高解像度',
  'black_hair': '黒髪',
  'blue_eyes': '青い目',
  'bad_anatomy': '悪い解剖',
  'bad_hands': '崩れた手',
  'extra_fingers': '余分な指',
  'text': '文字',
  'logo': 'ロゴ',
  'watermark': '透かし',
  'signature': '署名'
}

Object.assign(JA_FULL_TAGS, {
  anatomical_distortion: '解剖学的な歪み',
  anime_coloring: 'アニメ塗り',
  arms_out: '腕を広げる',
  bad_composition: '悪い構図',
  beautiful_girl: '美しい女の子',
  blue_hair_highlights: '青い髪のハイライト',
  blue_plaid_skirt: '青いチェック柄スカート',
  blue_sundress: '青いサンドレス',
  cat_ear_legwear: '猫耳風レッグウェア',
  cel_shading: 'セル塗り',
  cinematic_wide_angle_shot: '映画的な広角ショット',
  clear_blue_eyes: '澄んだ青い目',
  closed_mouth_light_smile: '口を閉じた軽い笑み',
  colorful_rope_corners: 'カラフルなロープ装飾',
  contorted_pose: 'ねじれたポーズ',
  cropped_length_exposing_midriff: '丈が短く腹部が見える服',
  delicate_eyelashes: '繊細なまつげ',
  detailed_outfit: '細かく描かれた衣装',
  displeased_expression: '不満げな表情',
  dramatic_spotlights_from_above: '上からのドラマチックなスポットライト',
  elegant_anime_illustration: '上品なアニメイラスト',
  flower_garden: '花園',
  fluffy_pajamas: 'ふわふわのパジャマ',
  flushed_face: '赤らんだ顔',
  glossy_dark_hair: '艶のある暗い髪',
  glossy_fabric: '光沢のある布地',
  glossy_reflections: '光沢のある反射',
  harsh_shadow: '強い影',
  'head-mounted_display': 'ヘッドマウントディスプレイ',
  high_contrast_clothing: '高コントラストの衣装',
  high_energy_atmosphere: '活気のある雰囲気',
  hair_over_face: '髪で顔が隠れている',
  holding_skirt: 'スカートを持つ',
  hyper_detailed: '非常に細密',
  in_empty_imperial_room: '空の格式ある部屋の中',
  intense_dynamic_action_pose: '激しい動きのアクションポーズ',
  intricate_lines: '緻密な線',
  lifting_skirt: 'スカートを持ち上げる',
  looking_down_at_camera: 'カメラを見下ろす',
  low_angle_shot: 'ローアングルショット',
  low_angle_view: 'ローアングル視点',
  maid_dress: 'メイド服',
  messy_composition: '乱れた構図',
  messy_lineart: '乱れた線画',
  muddy_colors: '濁った色',
  night_market: '夜市',
  no_lineart: '線画なし',
  noisy_background: 'ノイズのある背景',
  overexposed_colors: '露出過多の色',
  overrendered_skin: '描き込み過多の肌',
  pillow_grab: '枕をつかんでいる',
  perfect_proportions: '完璧なプロポーション',
  pov: '一人称視点',
  quiet_expression: '静かな表情',
  quiet_room: '静かな部屋',
  reaching_towards_viewer: '見る人に向かって手を伸ばす',
  refined_lineart: '洗練された線画',
  reflective_glossy_surface: '反射する光沢面',
  revealing_thighs: '太ももを見せる',
  scene_outfit_expression: 'シーン・衣装・表情',
  selfie: '自撮り',
  sitting_backwards_on_chiar: '椅子に後ろ向きに座る',
  slim_waist: '細い腰',
  soft_blush: '柔らかな赤面',
  subtle_wrinkles: '控えめなしわ',
  swimming_suit: '水着',
  thick_outline: '太い輪郭線',
  tie_hair: '髪を結ぶ',
  twisted_body: 'ねじれた体',
  very_fine: '非常に繊細',
  visible_thighs: '見える太もも',
  warming_up: 'ウォームアップ',
  white_choker: '白いチョーカー',
  white_pajamas: '白いパジャマ'
})

Object.assign(JA_FULL_TAGS, {
  corruption: '破綻',
  easynegativev2: 'EasyNegativeV2',
  mind_control: '精神操作',
  mlegs: '脚の崩れ候補',
  sensitive: 'センシティブ',
  tube: 'チューブ'
})

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
  grey: '灰色',
  gray: '灰色',
  long: '長い',
  short: '短い',
  hair: '髪',
  eyes: '目',
  eye: '目',
  hands: '手',
  hand: '手',
  fingers: '指',
  finger: '指',
  bad: '悪い',
  extra: '余分な',
  missing: '欠けた',
  blurry: 'ぼやけた',
  covered: '隠れた',
  face: '顔',
  quality: '品質',
  high: '高い',
  low: '低い',
  dress: 'ドレス',
  shirt: 'シャツ',
  school: '学校',
  uniform: '制服',
  background: '背景',
  lighting: '光'
}

Object.assign(JA_PARTS, {
  anatomical: '解剖学的',
  distortion: '歪み',
  anime: 'アニメ',
  coloring: '塗り',
  arms: '腕',
  out: '外へ',
  composition: '構図',
  beautiful: '美しい',
  girl: '女の子',
  highlights: 'ハイライト',
  plaid: 'チェック柄',
  skirt: 'スカート',
  sundress: 'サンドレス',
  cat: '猫',
  ear: '耳',
  legwear: 'レッグウェア',
  cel: 'セル',
  shading: '陰影',
  cinematic: '映画的',
  wide: '広い',
  angle: '角度',
  shot: 'ショット',
  clear: '澄んだ',
  closed: '閉じた',
  mouth: '口',
  light: '軽い',
  smile: '笑み',
  colorful: 'カラフル',
  rope: 'ロープ',
  corners: '角',
  contorted: 'ねじれた',
  pose: 'ポーズ',
  cropped: '短く切った',
  length: '丈',
  exposing: '露出',
  midriff: '腹部',
  delicate: '繊細な',
  eyelashes: 'まつげ',
  detailed: '細かい',
  outfit: '衣装',
  displeased: '不満げ',
  expression: '表情',
  dramatic: 'ドラマチック',
  spotlights: 'スポットライト',
  above: '上',
  elegant: '上品な',
  illustration: 'イラスト',
  digit: '指',
  flower: '花',
  garden: '庭',
  fluffy: 'ふわふわの',
  pajamas: 'パジャマ',
  futon: '布団',
  flushed: '赤らんだ',
  glossy: '光沢のある',
  dark: '暗い',
  fabric: '布地',
  reflections: '反射',
  harsh: '強い',
  shadow: '影',
  mounted: '装着',
  display: 'ディスプレイ',
  contrast: 'コントラスト',
  clothing: '衣装',
  energy: 'エネルギー',
  atmosphere: '雰囲気',
  holding: '持つ',
  hyper: '非常に',
  empty: '空の',
  imperial: '格式ある',
  room: '部屋',
  intense: '激しい',
  dynamic: '動的な',
  action: 'アクション',
  intricate: '緻密な',
  lines: '線',
  lifting: '持ち上げる',
  looking: '見る',
  down: '下',
  at: 'へ',
  over: 'かかった',
  pillow: '枕',
  grab: 'つかむ',
  camera: 'カメラ',
  maid: 'メイド',
  messy: '乱れた',
  lineart: '線画',
  muddy: '濁った',
  colors: '色',
  night: '夜',
  market: '市場',
  noisy: 'ノイズのある',
  overexposed: '露出過多',
  overrendered: '描き込み過多',
  perfect: '完璧な',
  proportions: 'プロポーション',
  quiet: '静かな',
  reaching: '手を伸ばす',
  towards: '向かって',
  viewer: '見る人',
  refined: '洗練された',
  reflective: '反射する',
  surface: '表面',
  revealing: '見せる',
  thighs: '太もも',
  scene: 'シーン',
  selfie: '自撮り',
  slim: '細い',
  waist: '腰',
  soft: '柔らかな',
  blush: '赤面',
  subtle: '控えめな',
  wrinkles: 'しわ',
  swimming: '水泳',
  suit: '服',
  thick: '太い',
  outline: '輪郭線',
  tie: '結ぶ',
  twisted: 'ねじれた',
  visible: '見える',
  warming: 'ウォームアップ',
  choker: 'チョーカー'
})

main()
