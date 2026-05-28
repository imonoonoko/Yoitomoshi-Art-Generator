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
const promotedSnapshotPath = path.join(resourcesDir, 'prompt-dictionary', 'promoted-candidates.danbooru-adult-tags.json')
const dbDir = path.join(dataRoot, 'prompt-dictionary')
const dbPath = path.join(dbDir, 'ingest.sqlite')
const sourceId = 'danbooru-adult-post-tags'
const PARSER_VERSION = 'danbooru-adult-tag-importer-v1'

const DEFAULT_PAGES = 8
const DEFAULT_LIMIT = 100
const DEFAULT_MIN_COUNT = 2
const DEFAULT_PROMOTE_LIMIT = 4000
const DEFAULT_TAG_SEARCH_LIMIT = 100
const DEFAULT_RATINGS = ['e', 'q']
const DEFAULT_TAG_PATTERNS = [
  '*ahegao*',
  '*anal*',
  '*anus*',
  '*areola*',
  '*bdsm*',
  '*blowjob*',
  '*bottomless*',
  '*bondage*',
  '*breast*',
  '*butt*',
  '*cleavage*',
  '*clitoris*',
  '*cum*',
  '*cunnilingus*',
  '*dildo*',
  '*ejaculat*',
  '*erection*',
  '*fellatio*',
  '*genital*',
  '*groin*',
  '*lingerie*',
  '*masturbat*',
  '*nakadashi*',
  '*nipple*',
  '*nude*',
  '*orgasm*',
  '*panties*',
  '*penis*',
  '*pubic*',
  '*pussy*',
  '*semen*',
  '*sex*',
  '*sex_toy*',
  '*sexy*',
  '*spread_legs*',
  '*topless*',
  '*underwear*',
  '*vagina*',
  '*vibrator*'
]

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
  const tagSearchLimit = Math.max(1, Math.min(100, positiveInteger(args.tagSearchLimit, positiveInteger(source.defaultQuery?.tagSearchLimit, DEFAULT_TAG_SEARCH_LIMIT))))
  const minCount = Math.max(1, positiveInteger(args.minCount, DEFAULT_MIN_COUNT))
  const promoteLimit = Math.max(1, positiveInteger(args.promoteLimit, DEFAULT_PROMOTE_LIMIT))
  const ratings = parseRatings(args.ratings, source.defaultQuery?.ratings)
  const tagPatterns = collectTagPatterns(args)
  const rateLimitMs = Math.max(0, Number.isFinite(args.rateLimitMs) ? Math.floor(args.rateLimitMs) : Math.ceil(1000 / Math.max(0.2, source.rateLimitRps || 0.2)))
  const baseUrl = cleanString(source.baseUrl || 'https://danbooru.donmai.us').replace(/\/+$/, '')
  const stats = {
    runId,
    dbPath,
    sourceId,
    ratings,
    pages,
    limit,
    tagSearchLimit,
    tagPatternCount: tagPatterns.length,
    fetchedPostPages: 0,
    fetchedPosts: 0,
    fetchedTagSearches: 0,
    fetchedTagRows: 0,
    adultTagTouches: 0,
    skippedTags: 0,
    acceptedCandidates: 0,
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

    createRun(db, runId, sourceId, startedAt, { ratings, pages, limit, tagSearchLimit, tagPatterns, minCount, promoteLimit, rateLimitMs })
    const aggregate = new Map()

    for (const rating of ratings) {
      for (let page = 1; page <= pages; page += 1) {
        const rows = await fetchJson(buildPostsUrl(baseUrl, rating, page, limit))
        if (!Array.isArray(rows)) throw new Error(`Unexpected posts response for rating:${rating} page:${page}`)
        stats.fetchedPostPages += 1
        stats.fetchedPosts += rows.length
        for (const post of rows) addPostTags(aggregate, post, rating, stats)
        if (page < pages) await sleep(rateLimitMs)
      }
      await sleep(rateLimitMs)
    }

    for (let index = 0; index < tagPatterns.length; index += 1) {
      const pattern = tagPatterns[index]
      const rows = await fetchJson(buildTagsUrl(baseUrl, pattern, tagSearchLimit))
      if (!Array.isArray(rows)) throw new Error(`Unexpected tags response for pattern:${pattern}`)
      stats.fetchedTagSearches += 1
      stats.fetchedTagRows += rows.length
      for (const row of rows) addTagMetadata(aggregate, row, pattern, stats)
      if (index < tagPatterns.length - 1) await sleep(rateLimitMs)
    }

    upsertAggregate(db, source, aggregate, minCount)
    stats.acceptedCandidates = acceptCandidates(db, sourceId, minCount, promoteLimit)
    stats.exportedEntries = writePromotedSnapshot(db, source, promoteLimit)
    finishRun(db, runId, 'completed', '', stats.fetchedPosts + stats.fetchedTagRows, aggregate.size, null)
    console.log(JSON.stringify(stats, null, 2))
  } catch (error) {
    finishRun(db, runId, 'failed', '', stats.fetchedPosts + stats.fetchedTagRows, 0, error?.message ?? String(error))
    throw error
  } finally {
    db.close()
  }
}

function buildPostsUrl(baseUrl, rating, page, limit) {
  const url = new URL('/posts.json', baseUrl)
  url.searchParams.set('tags', `rating:${rating}`)
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('page', String(page))
  url.searchParams.set('only', 'id,rating,tag_string_general,tag_string_meta,created_at')
  return url
}

function buildTagsUrl(baseUrl, pattern, limit) {
  const url = new URL('/tags.json', baseUrl)
  url.searchParams.set('search[name_matches]', pattern)
  url.searchParams.set('search[order]', 'count')
  url.searchParams.set('search[hide_empty]', 'yes')
  url.searchParams.set('limit', String(limit))
  return url
}

function addPostTags(aggregate, post, rating, stats) {
  const tags = splitTags(`${post?.tag_string_general || ''} ${post?.tag_string_meta || ''}`)
  for (const tag of tags) {
    const normalized = normalizeTag(tag)
    if (!shouldImportAdultTag(normalized)) {
      stats.skippedTags += 1
      continue
    }
    touchAggregate(aggregate, normalized, 1, `rating:${rating}`, Number(post?.id ?? 0), Number(post?.id ?? 0))
    stats.adultTagTouches += 1
  }
}

function addTagMetadata(aggregate, row, pattern, stats) {
  const normalized = normalizeTag(row?.name)
  if (!shouldImportAdultTag(normalized)) {
    stats.skippedTags += 1
    return
  }
  const count = Math.max(1, Math.min(1000000, Number(row?.post_count ?? 0)))
  touchAggregate(aggregate, normalized, count, `tag-search:${pattern}`, Number(row?.id ?? 0), count)
  stats.adultTagTouches += count
}

function touchAggregate(aggregate, tag, occurrenceCount, sourceKey, sourceRecordId, postCount) {
  const current = aggregate.get(tag) ?? {
    tag,
    occurrenceCount: 0,
    postCount: 0,
    sources: new Set(),
    sourceRecordIds: new Set()
  }
  current.occurrenceCount += occurrenceCount
  current.postCount = Math.max(current.postCount, postCount)
  current.sources.add(sourceKey)
  if (sourceRecordId) current.sourceRecordIds.add(sourceRecordId)
  aggregate.set(tag, current)
}

function upsertAggregate(db, source, aggregate, minCount) {
  const now = new Date().toISOString()
  const candidateInsert = db.prepare(`
    INSERT INTO candidate_tags(
      canonical_tag, display_tag, token_kind, positive_count, negative_count,
      source_count, evidence_count, confidence, adult_level, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 0, 1, ?, ?, 2, ?, ?, ?)
    ON CONFLICT(canonical_tag) DO UPDATE SET
      display_tag = excluded.display_tag,
      token_kind = CASE
        WHEN candidate_tags.token_kind = 'tag' THEN candidate_tags.token_kind
        ELSE excluded.token_kind
      END,
      positive_count = candidate_tags.positive_count + excluded.positive_count,
      evidence_count = candidate_tags.evidence_count + excluded.evidence_count,
      confidence = MAX(candidate_tags.confidence, excluded.confidence),
      adult_level = MAX(candidate_tags.adult_level, 2),
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
      const confidence = Math.min(1, 0.78 + Math.min(0.18, Math.log10(Math.max(1, item.occurrenceCount)) / 10))
      const status = item.occurrenceCount >= minCount ? 'accepted' : 'needs-review'
      candidateInsert.run(item.tag, item.tag, 'tag', item.occurrenceCount, item.occurrenceCount, confidence, status, now, now, minCount)
      const candidate = candidateSelect.get(item.tag)
      if (!candidate) throw new Error(`Failed to upsert candidate: ${item.tag}`)
      evidenceInsert.run(
        candidate.candidate_id,
        source.sourceId,
        item.occurrenceCount,
        PARSER_VERSION,
        [...item.sources].sort().slice(0, 8).join(', '),
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
      AND c.adult_level > 0
      AND se.evidence_count >= ?
    ORDER BY se.evidence_count DESC, c.confidence DESC, c.canonical_tag ASC
    LIMIT ?
  `).all(sourceIdValue, minCount, promoteLimit)
  const update = db.prepare(`
    UPDATE candidate_tags
    SET status = 'accepted', adult_level = MAX(adult_level, 2), updated_at = ?
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
      SELECT
        candidate_id,
        SUM(occurrence_count) AS evidence_count
      FROM candidate_evidence
      WHERE source_id = ?
      GROUP BY candidate_id
    )
    SELECT
      c.canonical_tag,
      c.display_tag,
      c.token_kind,
      se.evidence_count,
      c.confidence,
      c.status
    FROM candidate_tags c
    JOIN source_evidence se ON se.candidate_id = c.candidate_id
    WHERE c.status IN ('accepted', 'promoted')
      AND c.adult_level > 0
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
      adultLevel: 2,
      status: cleanString(row.status || 'accepted'),
      ja: '',
      meaning: 'Danbooru adult tag vocabulary candidate.',
      curationStatus: 'needs-review'
    })).filter((entry) => entry.tag && !isExcludedAdultTag(entry.canonicalTag))
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
      adult_level = MAX(adult_level, CASE
        WHEN canonical_tag GLOB '*nude*'
          OR canonical_tag GLOB '*breast*'
          OR canonical_tag GLOB '*nipple*'
          OR canonical_tag GLOB '*pussy*'
          OR canonical_tag GLOB '*penis*'
          OR canonical_tag GLOB '*sex*'
        THEN 2 ELSE 0 END),
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

function collectTagPatterns(parsedArgs) {
  const patterns = [...DEFAULT_TAG_PATTERNS]
  for (const value of parsedArgs.tagPatterns) patterns.push(value)
  if (parsedArgs.tagPatternsFile) {
    const lines = fs.readFileSync(parsedArgs.tagPatternsFile, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
    patterns.push(...lines)
  }
  return [...new Set(patterns.map(cleanString).filter(Boolean))]
}

function parseRatings(value, fallback) {
  const raw = cleanString(value || (Array.isArray(fallback) ? fallback.join(',') : '') || DEFAULT_RATINGS.join(','))
  const ratings = raw.split(/[,/| ]+/).map((item) => item.trim().toLowerCase()).filter(Boolean)
  const allowed = new Set(['e', 'q'])
  return [...new Set(ratings.filter((rating) => allowed.has(rating)))]
}

function parseArgs(argv) {
  const out = { tagPatterns: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--pages') out.pages = Number(argv[++index])
    else if (arg === '--limit') out.limit = Number(argv[++index])
    else if (arg === '--ratings') out.ratings = argv[++index]
    else if (arg === '--min-count') out.minCount = Number(argv[++index])
    else if (arg === '--promote-limit') out.promoteLimit = Number(argv[++index])
    else if (arg === '--tag-search-limit') out.tagSearchLimit = Number(argv[++index])
    else if (arg === '--tag-pattern') out.tagPatterns.push(argv[++index])
    else if (arg === '--tag-patterns-file') out.tagPatternsFile = argv[++index]
    else if (arg === '--rate-limit-ms') out.rateLimitMs = Number(argv[++index])
    else if (arg === '--data-root') out.dataRoot = argv[++index]
    else if (arg === '--resources-dir') out.resourcesDir = argv[++index]
    else if (arg === '--reset-source') out.resetSource = true
    else if (arg === '--export-only') out.exportOnly = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return out
}

function splitTags(value) {
  return cleanString(value).split(/\s+/).map(normalizeTag).filter(Boolean)
}

function normalizeTag(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
}

function shouldImportAdultTag(tag) {
  if (!tag || tag.length < 2 || tag.length > 90) return false
  if (!/^[a-z0-9_:+.-]+$/.test(tag)) return false
  if (isExcludedAdultTag(tag)) return false
  return ADULT_TOKEN_PATTERNS.some((pattern) => pattern.test(tag))
}

function isExcludedAdultTag(tag) {
  return EXCLUDED_ADULT_TOKEN_PATTERNS.some((pattern) => pattern.test(cleanString(tag).toLowerCase()))
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
  /(^|_)buttocks($|_)/,
  /(^|_)cameltoe($|_)/,
  /(^|_)cleavage($|_)/,
  /(^|_)clitoris($|_)/,
  /(^|_)cum($|_)/,
  /(^|_)cunnilingus($|_)/,
  /(^|_)dildo($|_)/,
  /(^|_)ejaculat(?:e|es|ed|ing|ion)($|_)/,
  /(^|_)erection($|_)/,
  /(^|_)fellatio($|_)/,
  /(^|_)genitals?($|_)/,
  /(^|_)groin($|_)/,
  /(^|_)lingerie($|_)/,
  /(^|_)masturbat(?:e|es|ed|ing|ion)($|_)/,
  /(^|_)nakadashi($|_)/,
  /(^|_)naked($|_)/,
  /(^|_)nipples?($|_)/,
  /(^|_)nude($|_)/,
  /(^|_)nudity($|_)/,
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

const EXCLUDED_ADULT_TOKEN_PATTERNS = [
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
