const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const projectRoot = path.resolve(__dirname, '..')
const args = parseArgs(process.argv.slice(2))
const resourcesDir = path.resolve(args.resourcesDir ?? path.join(projectRoot, 'resources'))
const dataRoot = path.resolve(args.dataRoot ?? path.join(projectRoot, 'userdata'))
const registryPath = path.join(resourcesDir, 'prompt-dictionary', 'sources.json')
const schemaPath = path.join(resourcesDir, 'prompt-dictionary', 'ingest-schema.sql')
const dbDir = path.join(dataRoot, 'prompt-dictionary')
const dbPath = path.join(dbDir, 'ingest.sqlite')

main()

function main() {
  const registry = loadRegistry()
  fs.mkdirSync(dbDir, { recursive: true })
  const db = new DatabaseSync(dbPath, { timeout: 3000 })
  try {
    db.exec('PRAGMA foreign_keys=ON')
    db.exec(fs.readFileSync(schemaPath, 'utf8'))
    snapshotSources(db, registry.sources)
    db.prepare('INSERT OR REPLACE INTO ingest_meta(key, value) VALUES (?, ?)').run('initialized_at', new Date().toISOString())
    const status = readStatus(db, registry)
    if (args.json) {
      console.log(JSON.stringify(status, null, 2))
    } else {
      console.log([
        `dbPath=${status.dbPath}`,
        `sources=${status.registrySourceCount}`,
        `enabled=${status.enabledSourceCount}`,
        `disabled=${status.disabledSourceCount}`,
        `rawPromptRecords=${status.rawPromptRecordCount}`,
        `candidateTags=${status.candidateTagCount}`
      ].join('\n'))
      if (status.warnings.length) {
        console.warn(`warnings=${status.warnings.join('; ')}`)
      }
    }
  } finally {
    db.close()
  }
}

function loadRegistry() {
  const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8'))
  if (!Number.isInteger(parsed.schemaVersion) || parsed.schemaVersion < 1) {
    throw new Error('sources.json schemaVersion must be a positive integer')
  }
  if (typeof parsed.updatedAt !== 'string' || !parsed.updatedAt.trim()) {
    throw new Error('sources.json updatedAt is required')
  }
  if (!Array.isArray(parsed.sources)) {
    throw new Error('sources.json sources must be an array')
  }
  const seen = new Set()
  const warnings = []
  const sources = parsed.sources.map((source) => normalizeSource(source, seen, warnings))
  return {
    schemaVersion: parsed.schemaVersion,
    updatedAt: parsed.updatedAt.trim(),
    registryPath,
    sources,
    warnings
  }
}

function normalizeSource(source, seen, warnings) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('source must be an object')
  }
  const sourceId = readIdentifier(source.sourceId, 'sourceId')
  if (seen.has(sourceId)) throw new Error(`duplicate sourceId: ${sourceId}`)
  seen.add(sourceId)
  const sourceType = readEnum(source.sourceType, ['api', 'dataset', 'local', 'manual', 'blocked'], `${sourceId}.sourceType`)
  const allowedMode = readEnum(source.allowedMode, ['enabled', 'manual-only', 'disabled'], `${sourceId}.allowedMode`)
  const storesImages = source.storesImages === true
  if (storesImages) throw new Error(`source must not store images: ${sourceId}`)
  if (sourceType === 'blocked' && allowedMode !== 'disabled') {
    warnings.push(`${sourceId}: blocked source should use allowedMode=disabled`)
  }
  return {
    sourceId,
    displayName: readString(source.displayName, `${sourceId}.displayName`),
    sourceType,
    allowedMode,
    baseUrl: optionalString(source.baseUrl),
    termsUrl: optionalString(source.termsUrl),
    licenseNote: optionalString(source.licenseNote),
    rateLimitRps: readRateLimit(source.rateLimitRps, `${sourceId}.rateLimitRps`),
    storesRawPrompts: source.storesRawPrompts === true,
    storesImages,
    adultPolicy: optionalString(source.adultPolicy),
    checkedAt: readString(source.checkedAt, `${sourceId}.checkedAt`),
    ...(source.defaultQuery && typeof source.defaultQuery === 'object' && !Array.isArray(source.defaultQuery)
      ? { defaultQuery: source.defaultQuery }
      : {})
  }
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

function readStatus(db, registry) {
  const lastRun = db.prepare('SELECT MAX(started_at) AS lastRunAt FROM import_runs').get()
  return {
    dbPath,
    schemaVersion: Number(readMeta(db, 'schema_version') ?? 1),
    initializedAt: readMeta(db, 'initialized_at') ?? '',
    registrySourceCount: countRows(db, 'source_registry_snapshot'),
    enabledSourceCount: countSourcesByMode(db, 'enabled'),
    disabledSourceCount: countSourcesByMode(db, 'disabled'),
    rawPromptRecordCount: countRows(db, 'raw_prompt_records'),
    candidateTagCount: countRows(db, 'candidate_tags'),
    translationJobCount: countRows(db, 'translation_jobs'),
    meaningDecisionCount: countRows(db, 'meaning_enrichment_decisions'),
    meaningReviewableCount: countReviewableMeaningDecisions(db),
    latestMeaningDecisionAt: readLatestMeaningDecisionAt(db),
    lastRunAt: lastRun?.lastRunAt ?? null,
    warnings: registry.warnings
  }
}

function countRows(db, tableName) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get()?.count ?? 0)
}

function countSourcesByMode(db, allowedMode) {
  return Number(
    db.prepare('SELECT COUNT(*) AS count FROM source_registry_snapshot WHERE allowed_mode = ?').get(allowedMode)?.count ?? 0
  )
}

function countReviewableMeaningDecisions(db) {
  return Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM meaning_enrichment_decisions d
    JOIN (
      SELECT canonical_tag, MAX(decision_id) AS decision_id
      FROM meaning_enrichment_decisions
      GROUP BY canonical_tag
    ) latest ON latest.decision_id = d.decision_id
    WHERE d.applied = 0
      AND (
        d.decision = 'preview-only'
        OR d.reason IN ('low-confidence', 'redirect-only', 'ambiguous-provider-result', 'usage-evidence-only')
      )
  `).get()?.count ?? 0)
}

function readLatestMeaningDecisionAt(db) {
  const value = db.prepare('SELECT MAX(generated_at) AS latestMeaningDecisionAt FROM meaning_enrichment_decisions').get()?.latestMeaningDecisionAt
  return typeof value === 'string' ? value : null
}

function readMeta(db, key) {
  const row = db.prepare('SELECT value FROM ingest_meta WHERE key = ?').get(key)
  return typeof row?.value === 'string' ? row.value : null
}

function parseArgs(argv) {
  const out = { json: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json') {
      out.json = true
    } else if (arg === '--data-root') {
      out.dataRoot = argv[++i]
    } else if (arg === '--resources-dir') {
      out.resourcesDir = argv[++i]
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return out
}

function readIdentifier(input, fieldName) {
  const value = readString(input, fieldName)
  if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(value)) {
    throw new Error(`invalid ${fieldName}: ${value}`)
  }
  return value
}

function readString(input, fieldName) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error(`${fieldName} must be a non-empty string`)
  }
  return input.trim()
}

function optionalString(input) {
  return typeof input === 'string' ? input.trim() : ''
}

function readEnum(input, allowed, fieldName) {
  if (typeof input !== 'string' || !allowed.includes(input)) {
    throw new Error(`${fieldName} has invalid value: ${String(input)}`)
  }
  return input
}

function readRateLimit(input, fieldName) {
  if (input == null) return 0
  if (typeof input !== 'number' || !Number.isFinite(input) || input < 0 || input > 10) {
    throw new Error(`${fieldName} must be a number between 0 and 10`)
  }
  return input
}
