import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type {
  PromptDictionaryEntry,
  PromptDictionarySearchRequest,
  PromptDictionarySearchResult,
  PromptTagPolarity
} from '../src/shared/types.js'

const DEFAULT_LIMIT = 36
const MAX_LIMIT = 120
const DB_RELATIVE_PATH = join('prompt-dictionary', 'prompt-dictionary.sqlite')
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

interface PromptDictionaryDatabasePaths {
  resourcesDir: string
  dataRoot: string
}

interface OpenPromptDictionaryDatabase {
  db: SqliteDatabase
  basePath: string
  searchableCount: number
}

interface QueryAlternative {
  value: string
  weight: number
}

interface QueryTerm {
  raw: string
  alternatives: QueryAlternative[]
}

interface DictionaryRow {
  id: number
  tag: string
  normalized_tag: string
  category: string
  group_name: string
  polarity: string
  source_kind: string
  source_label: string
  ja_label: string
  ja_meaning: string
  post_count: number | null
  deprecated: number | null
  aliases: string | null
}

interface ScoredRow {
  row: DictionaryRow
  score: number
}

const QUERY_EXPANSIONS: Record<string, QueryAlternative[]> = {
  '手': [
    { value: 'hand', weight: 26 },
    { value: 'hands', weight: 26 },
    { value: 'finger', weight: 8 },
    { value: 'fingers', weight: 8 },
    { value: 'wrist', weight: 4 }
  ],
  '指': [{ value: 'finger', weight: 22 }, { value: 'fingers', weight: 22 }],
  '腕': [{ value: 'arm', weight: 22 }, { value: 'arms', weight: 22 }],
  '髪': [{ value: 'hair', weight: 22 }],
  '目': [{ value: 'eye', weight: 22 }, { value: 'eyes', weight: 22 }],
  '胸': [
    { value: 'breast', weight: 22 },
    { value: 'breasts', weight: 22 },
    { value: 'chest', weight: 12 },
    { value: 'cleavage', weight: 8 }
  ],
  'おっぱい': [{ value: 'breast', weight: 22 }, { value: 'breasts', weight: 22 }, { value: 'cleavage', weight: 8 }],
  '光': [{ value: 'light', weight: 22 }, { value: 'lighting', weight: 22 }, { value: 'glow', weight: 12 }, { value: 'backlit', weight: 8 }, { value: 'rim light', weight: 8 }],
  '座る': [{ value: 'sitting', weight: 22 }, { value: 'seated', weight: 16 }],
  '立つ': [{ value: 'standing', weight: 22 }],
  '走る': [{ value: 'running', weight: 22 }],
  '笑顔': [{ value: 'smile', weight: 22 }, { value: 'smiling', weight: 22 }],
  '着物': [{ value: 'kimono', weight: 22 }, { value: 'yukata', weight: 14 }]
}

let cachedDatabase: OpenPromptDictionaryDatabase | null = null

export type PromptDictionaryDatabaseSearchOptions = PromptDictionaryDatabasePaths

export function searchPromptDictionaryDatabase(
  paths: PromptDictionaryDatabaseSearchOptions,
  request: PromptDictionarySearchRequest
): PromptDictionarySearchResult | null {
  const opened = openPromptDictionaryDatabase(paths)
  if (!opened) return null

  const query = request.query.trim()
  const limit = clampLimit(request.limit)
  const terms = tokenizeQuery(query)

  if (terms.length === 0 || limit <= 0) {
    return {
      query,
      total: 0,
      returned: 0,
      searchableCount: opened.searchableCount,
      entries: []
    }
  }

  let aggregate: Map<number, ScoredRow> | null = null
  for (const term of terms) {
    const termRows = collectTermRows(opened.db, term)
    if (termRows.size === 0) {
      aggregate = new Map()
      break
    }
    if (!aggregate) {
      aggregate = termRows
      continue
    }

    const next = new Map<number, ScoredRow>()
    for (const [id, previous] of aggregate) {
      const current = termRows.get(id)
      if (!current) continue
      next.set(id, {
        row: current.row,
        score: previous.score + current.score
      })
    }
    aggregate = next
  }

  const scored = [...(aggregate ?? new Map()).values()]
    .map((item) => ({
      ...item,
      score: item.score + rowQualityScore(item.row)
    }))
    .sort((a, b) =>
      b.score - a.score ||
      (b.row.post_count ?? 0) - (a.row.post_count ?? 0) ||
      a.row.tag.localeCompare(b.row.tag)
    )

  const entries = scored.slice(0, limit).map(({ row, score }) => rowToEntry(row, score))

  return {
    query,
    total: scored.length,
    returned: entries.length,
    searchableCount: opened.searchableCount,
    entries
  }
}

export function promptDictionaryDatabasePath(resourcesDir: string): string {
  return join(resourcesDir, DB_RELATIVE_PATH)
}

function openPromptDictionaryDatabase(paths: PromptDictionaryDatabasePaths): OpenPromptDictionaryDatabase | null {
  const basePath = promptDictionaryDatabasePath(paths.resourcesDir)
  if (cachedDatabase?.basePath === basePath) return cachedDatabase
  if (!existsSync(basePath)) return null

  try {
    cachedDatabase?.db.close()
  } catch {
    // Best-effort close before replacing the cached handle.
  }
  cachedDatabase = null

  try {
    const DatabaseSync = loadDatabaseSync()
    const db = new DatabaseSync(basePath, { readOnly: true, timeout: 3000, defensive: true })
    db.exec('PRAGMA query_only=ON')
    const countRow = db.prepare('SELECT COUNT(*) AS count FROM dictionary_entries').get() as { count?: number } | undefined
    cachedDatabase = {
      db,
      basePath,
      searchableCount: Number(countRow?.count ?? 0)
    }
    return cachedDatabase
  } catch (error) {
    console.warn('[prompt-dictionary] SQLite database unavailable, falling back to YAML search:', error)
    return null
  }
}

function loadDatabaseSync(): DatabaseSyncConstructor {
  const sqlite = nodeRequire('node:sqlite') as { DatabaseSync?: DatabaseSyncConstructor }
  if (!sqlite.DatabaseSync) {
    throw new Error('node:sqlite DatabaseSync is not available in this Electron runtime')
  }
  return sqlite.DatabaseSync
}

function collectTermRows(db: SqliteDatabase, term: QueryTerm): Map<number, ScoredRow> {
  const rows = new Map<number, ScoredRow>()
  for (const alternative of term.alternatives) {
    const value = alternative.value.trim()
    if (!value) continue
    const normalized = normalizeLatin(value)
    const exactScore = 130 + alternative.weight
    const prefixScore = 92 + alternative.weight
    const containsScore = 52 + alternative.weight
    const ftsScore = 70 + alternative.weight
    const trigramScore = 44 + alternative.weight

    addRows(rows, queryRows(db, EXACT_SQL, [normalized, value.toLowerCase(), value], 80), exactScore)
    addRows(rows, queryRows(db, PREFIX_SQL, [
      `${escapeLike(normalized)}%`,
      `${escapeLike(value.toLowerCase())}%`,
      `${escapeLike(value)}%`,
      `${escapeLike(value)}%`,
      `${escapeLike(value)}%`
    ], 120), prefixScore)
    addRows(rows, queryRows(db, CONTAINS_SQL, [
      `%${escapeLike(normalized)}%`,
      `%${escapeLike(value.toLowerCase())}%`,
      `%${escapeLike(value)}%`,
      `%${escapeLike(value)}%`,
      `%${escapeLike(value)}%`
    ], 180), containsScore)

    const ftsQuery = buildFtsQuery(value)
    if (ftsQuery) {
      addRows(rows, queryRows(db, FTS_SQL, [ftsQuery], 180), ftsScore)
    }

    const trigramQuery = buildTrigramQuery(value)
    if (trigramQuery) {
      addRows(rows, queryRows(db, TRIGRAM_SQL, [trigramQuery], 180), trigramScore)
    }
  }
  return rows
}

function queryRows(db: SqliteDatabase, sql: string, values: SqliteBindable[], limit: number): DictionaryRow[] {
  return db.prepare(sql).all(...values, limit).map(toDictionaryRow).filter((row): row is DictionaryRow => row !== null)
}

function addRows(target: Map<number, ScoredRow>, rows: DictionaryRow[], score: number): void {
  for (const row of rows) {
    const previous = target.get(row.id)
    if (!previous || previous.score < score) {
      target.set(row.id, { row, score })
    }
  }
}

function toDictionaryRow(value: unknown): DictionaryRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const id = typeof row.id === 'number' ? row.id : Number(row.id)
  const tag = asString(row.tag)
  const normalizedTag = asString(row.normalized_tag)
  const category = asString(row.category)
  const groupName = asString(row.group_name)
  if (!Number.isFinite(id) || !tag || !normalizedTag || !category || !groupName) return null
  return {
    id,
    tag,
    normalized_tag: normalizedTag,
    category,
    group_name: groupName,
    polarity: asString(row.polarity) || 'positive',
    source_kind: asString(row.source_kind) || 'built-in',
    source_label: asString(row.source_label) || 'Prompt Dictionary',
    ja_label: asString(row.ja_label),
    ja_meaning: asString(row.ja_meaning),
    post_count: asNullableNumber(row.post_count),
    deprecated: asNullableNumber(row.deprecated),
    aliases: asString(row.aliases)
  }
}

function rowToEntry(row: DictionaryRow, score: number): PromptDictionaryEntry {
  const aliases = (row.aliases ?? '')
    .split('\u001f')
    .map((alias) => alias.trim())
    .filter(Boolean)
  const polarity = normalizePolarity(row.polarity)
  return {
    en: row.tag,
    ja: row.ja_label || row.ja_meaning,
    meaning: row.ja_meaning || row.ja_label,
    aliases,
    category: row.category,
    group: row.group_name,
    polarity,
    sourceKind: row.source_kind === 'custom' ? 'custom' : 'built-in',
    sourceLabel: row.source_label,
    score
  }
}

function rowQualityScore(row: DictionaryRow): number {
  let score = 0
  const postCount = row.post_count ?? 0
  if (postCount > 0) score += Math.min(12, Math.log10(postCount + 1) * 2)
  if (row.deprecated) score -= 28
  if (normalizePolarity(row.polarity) === 'positive') score += 2
  return score
}

function tokenizeQuery(query: string): QueryTerm[] {
  return query
    .trim()
    .split(/[\s,，、]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((raw) => ({
      raw,
      alternatives: uniqueAlternatives([
        { value: raw, weight: 0 },
        ...(QUERY_EXPANSIONS[raw] ?? [])
      ])
    }))
}

function uniqueAlternatives(alternatives: QueryAlternative[]): QueryAlternative[] {
  const byValue = new Map<string, QueryAlternative>()
  for (const alternative of alternatives) {
    const key = normalizeLatin(alternative.value)
    const previous = byValue.get(key)
    if (!previous || alternative.weight > previous.weight) byValue.set(key, alternative)
  }
  return [...byValue.values()]
}

function buildFtsQuery(value: string): string | null {
  const normalized = normalizeLatin(value)
  if (!/^[a-z0-9_\-\s]+$/i.test(normalized)) return null
  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9_-]+/gi, ''))
    .filter(Boolean)
  if (tokens.length === 0) return null
  return tokens.map((token) => `${escapeFtsToken(token)}*`).join(' ')
}

function buildTrigramQuery(value: string): string | null {
  const trimmed = value.trim()
  if ([...trimmed].length < 3) return null
  return `"${trimmed.replace(/"/g, '""')}"`
}

function escapeFtsToken(value: string): string {
  return value.replace(/"/g, '""')
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

function clampLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_LIMIT
  return Math.max(0, Math.min(MAX_LIMIT, Math.floor(value ?? DEFAULT_LIMIT)))
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function asNullableNumber(value: unknown): number | null {
  if (value == null) return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function normalizeLatin(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, ' ')
}

function normalizePolarity(value: string): PromptTagPolarity {
  if (value === 'negative' || value === 'both') return value
  return 'positive'
}

const SELECT_COLUMNS = `
  e.id,
  e.tag,
  e.normalized_tag,
  e.category,
  e.group_name,
  e.polarity,
  e.source_kind,
  e.source_label,
  e.post_count,
  e.deprecated,
  t.ja_label,
  t.ja_meaning,
  COALESCE((
    SELECT GROUP_CONCAT(a.alias, char(31))
    FROM dictionary_aliases a
    WHERE a.entry_id = e.id
    ORDER BY a.weight DESC, a.alias ASC
  ), '') AS aliases
`

const SELECT_FROM = `
  FROM dictionary_entries e
  JOIN dictionary_text t ON t.entry_id = e.id
`

const EXACT_SQL = `
  SELECT ${SELECT_COLUMNS}
  ${SELECT_FROM}
  WHERE e.normalized_tag = ?
    OR LOWER(e.tag) = ?
    OR t.ja_label = ?
  LIMIT ?
`

const PREFIX_SQL = `
  SELECT ${SELECT_COLUMNS}
  ${SELECT_FROM}
  WHERE e.normalized_tag LIKE ? ESCAPE '\\'
    OR LOWER(e.tag) LIKE ? ESCAPE '\\'
    OR t.ja_label LIKE ? ESCAPE '\\'
    OR t.ja_meaning LIKE ? ESCAPE '\\'
    OR EXISTS (
      SELECT 1 FROM dictionary_aliases a
      WHERE a.entry_id = e.id AND a.alias LIKE ? ESCAPE '\\'
    )
  LIMIT ?
`

const CONTAINS_SQL = `
  SELECT ${SELECT_COLUMNS}
  ${SELECT_FROM}
  WHERE e.normalized_tag LIKE ? ESCAPE '\\'
    OR LOWER(e.tag) LIKE ? ESCAPE '\\'
    OR t.ja_label LIKE ? ESCAPE '\\'
    OR t.ja_meaning LIKE ? ESCAPE '\\'
    OR EXISTS (
      SELECT 1 FROM dictionary_aliases a
      WHERE a.entry_id = e.id AND a.alias LIKE ? ESCAPE '\\'
    )
  LIMIT ?
`

const FTS_SQL = `
  SELECT ${SELECT_COLUMNS}
  ${SELECT_FROM}
  JOIN dictionary_fts f ON f.rowid = e.id
  WHERE dictionary_fts MATCH ?
  LIMIT ?
`

const TRIGRAM_SQL = `
  SELECT ${SELECT_COLUMNS}
  ${SELECT_FROM}
  JOIN dictionary_trigram_fts tri ON tri.rowid = e.id
  WHERE dictionary_trigram_fts MATCH ?
  LIMIT ?
`
