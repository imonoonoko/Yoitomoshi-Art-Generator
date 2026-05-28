import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type {
  PromptDictionaryIngestStatus,
  PromptDictionarySourceDefinition
} from '../src/shared/types.js'
import { loadPromptDictionarySourceRegistry } from './prompt-dictionary-source-registry.js'

const INGEST_RELATIVE_PATH = join('prompt-dictionary', 'ingest.sqlite')
const SCHEMA_RELATIVE_PATH = join('prompt-dictionary', 'ingest-schema.sql')
const nodeRequire = createRequire(import.meta.url)

type SqliteBindable = string | number | bigint | null

interface SqliteStatement {
  all(...values: SqliteBindable[]): unknown[]
  get(...values: SqliteBindable[]): unknown
  run(...values: SqliteBindable[]): unknown
}

interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  close(): void
}

interface DatabaseSyncConstructor {
  new(path: string, options?: { readOnly?: boolean; timeout?: number; defensive?: boolean }): SqliteDatabase
}

export interface PromptDictionaryIngestPaths {
  resourcesDir: string
  dataRoot: string
}

interface CountRow {
  count?: number
}

interface LastRunRow {
  lastRunAt?: string | null
}

interface LatestDecisionRow {
  latestMeaningDecisionAt?: string | null
}

export function promptDictionaryIngestDatabasePath(dataRoot: string): string {
  return join(dataRoot, INGEST_RELATIVE_PATH)
}

export function initializePromptDictionaryIngestDatabase(paths: PromptDictionaryIngestPaths): PromptDictionaryIngestStatus {
  const registry = loadPromptDictionarySourceRegistry(paths.resourcesDir)
  const dbPath = promptDictionaryIngestDatabasePath(paths.dataRoot)
  mkdirSync(join(paths.dataRoot, 'prompt-dictionary'), { recursive: true })

  const DatabaseSync = loadDatabaseSync()
  const db = new DatabaseSync(dbPath, { timeout: 3000 })
  try {
    db.exec('PRAGMA foreign_keys=ON')
    db.exec(readIngestSchema(paths.resourcesDir))
    snapshotSources(db, registry.sources)
    db.prepare('INSERT OR REPLACE INTO ingest_meta(key, value) VALUES (?, ?)').run('initialized_at', new Date().toISOString())
    return readPromptDictionaryIngestStatusFromOpenDb(db, dbPath, registry.sources, registry.warnings)
  } finally {
    db.close()
  }
}

export function inspectPromptDictionaryIngestDatabase(paths: PromptDictionaryIngestPaths): PromptDictionaryIngestStatus {
  const registry = loadPromptDictionarySourceRegistry(paths.resourcesDir)
  const dbPath = promptDictionaryIngestDatabasePath(paths.dataRoot)
  if (!existsSync(dbPath)) {
    return initializePromptDictionaryIngestDatabase(paths)
  }

  const DatabaseSync = loadDatabaseSync()
  const db = new DatabaseSync(dbPath, { timeout: 3000 })
  try {
    db.exec('PRAGMA foreign_keys=ON')
    db.exec(readIngestSchema(paths.resourcesDir))
    snapshotSources(db, registry.sources)
    return readPromptDictionaryIngestStatusFromOpenDb(db, dbPath, registry.sources, registry.warnings)
  } finally {
    db.close()
  }
}

function snapshotSources(db: SqliteDatabase, sources: PromptDictionarySourceDefinition[]): void {
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

function readPromptDictionaryIngestStatusFromOpenDb(
  db: SqliteDatabase,
  dbPath: string,
  sources: PromptDictionarySourceDefinition[],
  warnings: string[]
): PromptDictionaryIngestStatus {
  const initializedAt = readMeta(db, 'initialized_at') ?? ''
  const lastRun = db.prepare('SELECT MAX(started_at) AS lastRunAt FROM import_runs').get() as LastRunRow | undefined
  return {
    dbPath,
    schemaVersion: Number(readMeta(db, 'schema_version') ?? 1),
    initializedAt,
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
    warnings
  }
}

function countRows(db: SqliteDatabase, tableName: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as CountRow | undefined
  return Number(row?.count ?? 0)
}

function countSourcesByMode(db: SqliteDatabase, allowedMode: string): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM source_registry_snapshot WHERE allowed_mode = ?').get(allowedMode) as CountRow | undefined
  return Number(row?.count ?? 0)
}

function countReviewableMeaningDecisions(db: SqliteDatabase): number {
  const row = db.prepare(`
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
  `).get() as CountRow | undefined
  return Number(row?.count ?? 0)
}

function readLatestMeaningDecisionAt(db: SqliteDatabase): string | null {
  const row = db.prepare('SELECT MAX(generated_at) AS latestMeaningDecisionAt FROM meaning_enrichment_decisions').get() as LatestDecisionRow | undefined
  return typeof row?.latestMeaningDecisionAt === 'string' ? row.latestMeaningDecisionAt : null
}

function readMeta(db: SqliteDatabase, key: string): string | null {
  const row = db.prepare('SELECT value FROM ingest_meta WHERE key = ?').get(key) as { value?: string } | undefined
  return typeof row?.value === 'string' ? row.value : null
}

function readIngestSchema(resourcesDir: string): string {
  return readFileSync(join(resourcesDir, SCHEMA_RELATIVE_PATH), 'utf8')
}

function loadDatabaseSync(): DatabaseSyncConstructor {
  const sqlite = nodeRequire('node:sqlite') as { DatabaseSync?: DatabaseSyncConstructor }
  if (!sqlite.DatabaseSync) {
    throw new Error('node:sqlite DatabaseSync is not available in this Electron runtime')
  }
  return sqlite.DatabaseSync
}
