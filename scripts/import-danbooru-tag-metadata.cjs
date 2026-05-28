const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')

const projectRoot = path.resolve(__dirname, '..')
const args = parseArgs(process.argv.slice(2))
const resourcesDir = path.resolve(args.resourcesDir ?? path.join(projectRoot, 'resources'))
const dataRoot = path.resolve(args.dataRoot ?? path.join(projectRoot, 'userdata'))
const registryPath = path.join(resourcesDir, 'prompt-dictionary', 'sources.json')
const schemaPath = path.join(resourcesDir, 'prompt-dictionary', 'ingest-schema.sql')
const promotedSnapshotPath = path.join(resourcesDir, 'prompt-dictionary', 'promoted-candidates.danbooru-tag-metadata.json')
const dbDir = path.join(dataRoot, 'prompt-dictionary')
const dbPath = path.join(dbDir, 'ingest.sqlite')
const sourceId = 'danbooru-tag-metadata'
const PARSER_VERSION = 'danbooru-tag-metadata-importer-v1'

const DEFAULT_PAGES = 18
const DEFAULT_LIMIT = 100
const DEFAULT_MIN_COUNT = 1
const DEFAULT_PROMOTE_LIMIT = 5000
const DEFAULT_CATEGORIES = [0, 5]

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
  const pages = positiveInteger(args.pages, positiveInteger(source.defaultQuery?.pages, DEFAULT_PAGES))
  const limit = Math.max(1, Math.min(100, positiveInteger(args.limit, positiveInteger(source.defaultQuery?.limit, DEFAULT_LIMIT))))
  const minCount = Math.max(1, positiveInteger(args.minCount, DEFAULT_MIN_COUNT))
  const promoteLimit = Math.max(1, positiveInteger(args.promoteLimit, DEFAULT_PROMOTE_LIMIT))
  const categories = parseCategories(args.categories, source.defaultQuery?.categories)
  const rateLimitMs = Math.max(0, Number.isFinite(args.rateLimitMs) ? Math.floor(args.rateLimitMs) : Math.ceil(1000 / Math.max(0.2, source.rateLimitRps || 0.2)))
  const baseUrl = cleanString(source.baseUrl || 'https://danbooru.donmai.us').replace(/\/+$/, '')
  const stats = {
    runId,
    dbPath,
    sourceId,
    categories,
    pages,
    limit,
    fetchedPages: 0,
    fetchedRows: 0,
    acceptedCandidates: 0,
    skippedRows: 0,
    exportedEntries: 0,
    promotedSnapshotPath
  }

  try {
    db.exec('PRAGMA foreign_keys=ON')
    db.exec(fs.readFileSync(schemaPath, 'utf8'))
    snapshotSources(db, registry.sources)
    db.prepare('INSERT OR REPLACE INTO ingest_meta(key, value) VALUES (?, ?)').run('initialized_at', startedAt)
    if (args.exportOnly) {
      stats.exportedEntries = writePromotedSnapshot(db, source, promoteLimit)
      console.log(JSON.stringify({ ...stats, exportOnly: true }, null, 2))
      return
    }

    if (args.resetSource) {
      resetSourceData(db, sourceId)
      stats.resetSource = true
    }

    createRun(db, runId, sourceId, startedAt, { categories, pages, limit, minCount, promoteLimit, rateLimitMs })
    const rows = []
    for (const category of categories) {
      for (let page = 1; page <= pages; page += 1) {
        const pageRows = await fetchJson(buildTagsUrl(baseUrl, category, page, limit))
        if (!Array.isArray(pageRows)) throw new Error(`Unexpected tags response for category:${category} page:${page}`)
        stats.fetchedPages += 1
        stats.fetchedRows += pageRows.length
        rows.push(...pageRows)
        if (page < pages) await sleep(rateLimitMs)
      }
      await sleep(rateLimitMs)
    }

    const aggregate = collectTagRows(rows, stats)
    upsertAggregate(db, source, aggregate, minCount)
    stats.acceptedCandidates = acceptCandidates(db, sourceId, minCount, promoteLimit)
    stats.exportedEntries = writePromotedSnapshot(db, source, promoteLimit)
    finishRun(db, runId, 'completed', '', stats.fetchedRows, aggregate.size, null)
    console.log(JSON.stringify(stats, null, 2))
  } catch (error) {
    finishRun(db, runId, 'failed', '', stats.fetchedRows, 0, error?.message ?? String(error))
    throw error
  } finally {
    db.close()
  }
}

function buildTagsUrl(baseUrl, category, page, limit) {
  const url = new URL('/tags.json', baseUrl)
  url.searchParams.set('search[category]', String(category))
  url.searchParams.set('search[order]', 'count')
  url.searchParams.set('search[hide_empty]', 'yes')
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('page', String(page))
  return url
}

function collectTagRows(rows, stats) {
  const byTag = new Map()
  for (const row of rows) {
    const tag = normalizeTag(row?.name)
    const postCount = Math.max(1, Number(row?.post_count ?? 0))
    const category = Number(row?.category ?? 0)
    if (!shouldImportTag(tag, category)) {
      stats.skippedRows += 1
      continue
    }
    const previous = byTag.get(tag)
    const next = {
      tag,
      postCount: Math.max(postCount, previous?.postCount ?? 0),
      category,
      deprecated: Boolean(row?.is_deprecated),
      tokenKind: inferTokenKind(tag, category),
      adultLevel: adultLevelForTag(tag)
    }
    byTag.set(tag, next)
  }
  return byTag
}

function upsertAggregate(db, source, aggregate, minCount) {
  const now = new Date().toISOString()
  const candidateInsert = db.prepare(`
    INSERT INTO candidate_tags(
      canonical_tag, display_tag, token_kind, positive_count, negative_count,
      source_count, evidence_count, confidence, adult_level, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 0, 1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(canonical_tag) DO UPDATE SET
      display_tag = excluded.display_tag,
      token_kind = CASE
        WHEN candidate_tags.token_kind = 'tag' THEN candidate_tags.token_kind
        ELSE excluded.token_kind
      END,
      positive_count = candidate_tags.positive_count + excluded.positive_count,
      evidence_count = candidate_tags.evidence_count + excluded.evidence_count,
      confidence = MAX(candidate_tags.confidence, excluded.confidence),
      adult_level = MAX(candidate_tags.adult_level, excluded.adult_level),
      status = CASE
        WHEN candidate_tags.status IN ('hidden', 'rejected', 'promoted') THEN candidate_tags.status
        WHEN candidate_tags.evidence_count + excluded.evidence_count >= ? THEN 'accepted'
        ELSE candidate_tags.status
      END,
      updated_at = excluded.updated_at
  `)
  const candidateSelect = db.prepare('SELECT candidate_id FROM candidate_tags WHERE canonical_tag = ?')
  const evidenceInsert = db.prepare(`
    INSERT INTO candidate_evidence(candidate_id, source_id, raw_record_id, polarity, occurrence_count, model_family, sample_text, created_at)
    VALUES (?, ?, NULL, 'positive', ?, ?, ?, ?)
  `)
  db.exec('BEGIN')
  try {
    for (const item of aggregate.values()) {
      const confidence = Math.min(1, 0.76 + Math.min(0.18, Math.log10(Math.max(1, item.postCount)) / 12))
      const status = item.postCount >= minCount ? 'accepted' : 'needs-review'
      candidateInsert.run(item.tag, item.tag, item.tokenKind, item.postCount, item.postCount, confidence, item.adultLevel, status, now, now, minCount)
      const candidate = candidateSelect.get(item.tag)
      if (!candidate) throw new Error(`Failed to upsert candidate: ${item.tag}`)
      evidenceInsert.run(
        candidate.candidate_id,
        source.sourceId,
        item.postCount,
        `${PARSER_VERSION}:category-${item.category}`,
        item.deprecated ? 'deprecated' : 'active',
        now
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function acceptCandidates(db, sourceIdValue, minCount, promoteLimit) {
  const rows = db.prepare(`
    WITH source_evidence AS (
      SELECT candidate_id, SUM(occurrence_count) AS evidence_count
      FROM candidate_evidence
      WHERE source_id = ?
      GROUP BY candidate_id
    )
    SELECT c.candidate_id
    FROM candidate_tags c
    JOIN source_evidence se ON se.candidate_id = c.candidate_id
    WHERE c.status IN ('new', 'needs-review', 'accepted')
      AND se.evidence_count >= ?
    ORDER BY se.evidence_count DESC, c.confidence DESC, c.canonical_tag ASC
    LIMIT ?
  `).all(sourceIdValue, minCount, promoteLimit)
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

function writePromotedSnapshot(db, source, promoteLimit) {
  const rows = db.prepare(`
    WITH source_evidence AS (
      SELECT candidate_id, SUM(occurrence_count) AS evidence_count
      FROM candidate_evidence
      WHERE source_id = ?
      GROUP BY candidate_id
    )
    SELECT
      c.canonical_tag,
      c.display_tag,
      c.token_kind,
      c.adult_level,
      c.confidence,
      c.status,
      se.evidence_count
    FROM candidate_tags c
    JOIN source_evidence se ON se.candidate_id = c.candidate_id
    WHERE c.status IN ('accepted', 'promoted')
      AND c.token_kind IN ('tag', 'phrase', 'quality', 'negative')
      AND se.evidence_count >= 1
    ORDER BY se.evidence_count DESC, c.confidence DESC, c.canonical_tag ASC
    LIMIT ?
  `).all(source.sourceId, promoteLimit)
  const snapshot = {
    schemaVersion: 1,
    sourceId: source.sourceId,
    sourceLabel: source.displayName,
    exportedAt: new Date().toISOString(),
    rawPromptRecords: Number(db.prepare('SELECT COUNT(*) AS count FROM candidate_evidence WHERE source_id = ?').get(source.sourceId)?.count ?? 0),
    entries: rows.map((row) => ({
      tag: cleanString(row.display_tag || row.canonical_tag),
      canonicalTag: cleanString(row.canonical_tag || row.display_tag),
      tokenKind: cleanString(row.token_kind || 'tag'),
      positiveCount: Number(row.evidence_count ?? 0),
      negativeCount: 0,
      evidenceCount: Number(row.evidence_count ?? 0),
      confidence: Number(row.confidence ?? 0),
      adultLevel: Number(row.adult_level ?? 0),
      status: cleanString(row.status || 'accepted'),
      ja: '',
      meaning: 'Danbooru public tag metadata vocabulary candidate.',
      curationStatus: 'needs-review'
    })).filter((entry) => entry.tag && !isUnsafeTag(entry.canonicalTag))
  }
  fs.writeFileSync(promotedSnapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  return snapshot.entries.length
}

async function fetchJson(url, attempt = 0) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Yoitomoshi-Art-Generator prompt dictionary importer'
    }
  })
  if ((response.status === 429 || response.status >= 500) && attempt < 4) {
    const retryAfterSeconds = Number(response.headers.get('retry-after'))
    const waitMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : 5000 * (attempt + 1)
    await sleep(waitMs)
    return fetchJson(url, attempt + 1)
  }
  if (!response.ok) throw new Error(`Danbooru API request failed: ${response.status} ${response.statusText}`)
  return response.json()
}

function resetSourceData(db, sourceIdValue) {
  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM candidate_evidence WHERE source_id = ?').run(sourceIdValue)
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
      positive_count = COALESCE((SELECT SUM(occurrence_count) FROM candidate_evidence e WHERE e.candidate_id = candidate_tags.candidate_id AND e.polarity = 'positive'), 0),
      negative_count = COALESCE((SELECT SUM(occurrence_count) FROM candidate_evidence e WHERE e.candidate_id = candidate_tags.candidate_id AND e.polarity = 'negative'), 0),
      source_count = COALESCE((SELECT COUNT(DISTINCT source_id) FROM candidate_evidence e WHERE e.candidate_id = candidate_tags.candidate_id), 0),
      evidence_count = COALESCE((SELECT SUM(occurrence_count) FROM candidate_evidence e WHERE e.candidate_id = candidate_tags.candidate_id), 0),
      updated_at = ?
  `).run(now)
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

function parseArgs(argv) {
  const out = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--pages') out.pages = Number(argv[++index])
    else if (arg === '--limit') out.limit = Number(argv[++index])
    else if (arg === '--categories') out.categories = argv[++index]
    else if (arg === '--min-count') out.minCount = Number(argv[++index])
    else if (arg === '--promote-limit') out.promoteLimit = Number(argv[++index])
    else if (arg === '--rate-limit-ms') out.rateLimitMs = Number(argv[++index])
    else if (arg === '--data-root') out.dataRoot = argv[++index]
    else if (arg === '--resources-dir') out.resourcesDir = argv[++index]
    else if (arg === '--reset-source') out.resetSource = true
    else if (arg === '--export-only') out.exportOnly = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return out
}

function parseCategories(value, fallback) {
  const raw = cleanString(value || (Array.isArray(fallback) ? fallback.join(',') : '') || DEFAULT_CATEGORIES.join(','))
  const categories = raw.split(/[,/| ]+/).map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 0)
  return [...new Set(categories.length ? categories : DEFAULT_CATEGORIES)]
}

function shouldImportTag(tag, category) {
  if (!tag || tag.length < 2 || tag.length > 90) return false
  if (!/^[a-z0-9_:+.-]+$/.test(tag)) return false
  if (/^(bad_)?(pixiv|twitter|artist|commentary|source)_/.test(tag)) return false
  if (/(^|_)(request|username|id|commentary|source_request)($|_)/.test(tag)) return false
  if (isUnsafeTag(tag)) return false
  if (GENERAL_NOISE_TAGS.has(tag)) return false
  return category === 0 || category === 5
}

function inferTokenKind(tag, category) {
  if (/(^|_)(highres|absurdres|masterpiece|best_quality|low_quality|worst_quality|normal_quality|detailed|aesthetic)($|_)/.test(tag)) return 'quality'
  if (category === 5) return 'tag'
  return tag.includes('_') ? 'tag' : 'phrase'
}

function adultLevelForTag(tag) {
  return ADULT_TOKEN_PATTERNS.some((pattern) => pattern.test(tag)) ? 2 : 0
}

function isUnsafeTag(tag) {
  return UNSAFE_TAG_PATTERNS.some((pattern) => pattern.test(cleanString(tag).toLowerCase()))
}

function normalizeTag(value) {
  return cleanString(value).toLowerCase().replace(/\s+/g, '_').replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '')
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const GENERAL_NOISE_TAGS = new Set([
  'commentary_request',
  'commentary',
  'english_commentary',
  'japanese_commentary',
  'translation_request',
  'translated',
  'tagme',
  'bad_id',
  'bad_pixiv_id',
  'pixiv_id',
  'twitter_username',
  'dated',
  'duplicate',
  'sample',
  'md5_mismatch',
  'revision'
])

const ADULT_TOKEN_PATTERNS = [
  /(^|_)ahegao($|_)/,
  /(^|_)anal($|_)/,
  /(^|_)anus($|_)/,
  /(^|_)areolae?($|_)/,
  /(^|_)bdsm($|_)/,
  /(^|_)blowjob($|_)/,
  /(^|_)bottomless($|_)/,
  /(^|_)bondage($|_)/,
  /(^|_)breasts?($|_)/,
  /(^|_)butt($|_)/,
  /(^|_)cleavage($|_)/,
  /(^|_)cum($|_)/,
  /(^|_)dildo($|_)/,
  /(^|_)ejaculat(?:e|es|ed|ing|ion)($|_)/,
  /(^|_)erection($|_)/,
  /(^|_)fellatio($|_)/,
  /(^|_)genitals?($|_)/,
  /(^|_)groin($|_)/,
  /(^|_)lingerie($|_)/,
  /(^|_)masturbat(?:e|es|ed|ing|ion)($|_)/,
  /(^|_)naked($|_)/,
  /(^|_)nipples?($|_)/,
  /(^|_)nude($|_)/,
  /(^|_)orgasm($|_)/,
  /(^|_)panties($|_)/,
  /(^|_)penis($|_)/,
  /(^|_)pubic(_hair)?($|_)/,
  /(^|_)pussy($|_)/,
  /(^|_)semen($|_)/,
  /(^|_)sex($|_)/,
  /(^|_)sex_toy($|_)/,
  /(^|_)sexy($|_)/,
  /(^|_)spread_legs($|_)/,
  /(^|_)topless($|_)/,
  /(^|_)underwear($|_)/,
  /(^|_)vagina($|_)/,
  /(^|_)vibrator($|_)/
]

const UNSAFE_TAG_PATTERNS = [
  /(^|_)child(?:ren)?($|_)/,
  /(^|_)underage($|_)/,
  /(^|_)minor($|_)/,
  /(^|_)toddler($|_)/,
  /(^|_)baby($|_)/,
  /(^|_)loli($|_)/,
  /(^|_)shota($|_)/,
  /(^|_)rape($|_)/,
  /(^|_)raping($|_)/,
  /(^|_)forced($|_)/,
  /(^|_)unconscious($|_)/,
  /(^|_)sleeping_sex($|_)/,
  /(^|_)bestiality($|_)/,
  /(^|_)zoophilia($|_)/
]

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
