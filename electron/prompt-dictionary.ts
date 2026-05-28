import type {
  PromptCategory,
  PromptDictionaryEntry,
  PromptDictionarySearchRequest,
  PromptDictionarySearchResult,
  PromptGroupTag,
  PromptTagPolarity
} from '../src/shared/types.js'
import type { PromptLibrary } from './prompt-library.js'
import {
  searchPromptDictionaryDatabase,
  type PromptDictionaryDatabaseSearchOptions
} from './prompt-dictionary-db.js'

const DEFAULT_LIMIT = 36
const MAX_LIMIT = 120

interface IndexedPromptDictionaryEntry extends PromptDictionaryEntry {
  haystack: string
  tagKey: string
  normalizedTag: string
}

interface ScoredEntry {
  entry: IndexedPromptDictionaryEntry
  score: number
}

interface QueryTerm {
  raw: string
  alternatives: QueryAlternative[]
}

interface QueryAlternative {
  value: string
  weight: number
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

export function searchPromptDictionary(
  library: PromptLibrary,
  customLibrary: PromptCategory[],
  request: PromptDictionarySearchRequest,
  options?: PromptDictionaryDatabaseSearchOptions
): PromptDictionarySearchResult {
  if (options) {
    const databaseResult = searchPromptDictionaryDatabase(options, request)
    if (databaseResult && databaseResult.searchableCount > 0) {
      return mergeSearchResults(
        databaseResult,
        searchPromptDictionaryInMemory([], customLibrary, request),
        clampLimit(request.limit)
      )
    }
  }

  return searchPromptDictionaryInMemory(library.categories, customLibrary, request)
}

function searchPromptDictionaryInMemory(
  baseLibrary: PromptCategory[],
  customLibrary: PromptCategory[],
  request: PromptDictionarySearchRequest
): PromptDictionarySearchResult {
  const query = request.query.trim()
  const limit = clampLimit(request.limit)
  const entries = buildDictionaryEntries(baseLibrary, customLibrary)
    .filter((entry) => matchesSearchFilters(entry, request))
  const terms = tokenizeQuery(query)
  const requestedPolarity = normalizeRequestedPolarity(request.polarity)
  const normalizedQuery = normalizeLatin(query)

  if (terms.length === 0 || limit <= 0) {
    return {
      query,
      total: 0,
      returned: 0,
      searchableCount: entries.length,
      entries: []
    }
  }

  const scored = entries
    .map((entry) => ({ entry, score: scoreEntry(entry, normalizedQuery, terms, requestedPolarity) }))
    .filter((item): item is ScoredEntry => item.score > 0)
    .sort((a, b) =>
      b.score - a.score ||
      sourceRank(b.entry.sourceKind) - sourceRank(a.entry.sourceKind) ||
      a.entry.en.localeCompare(b.entry.en)
    )

  const out = scored.slice(0, limit).map(({ entry, score }) => ({
    en: entry.en,
    ja: entry.ja,
    meaning: entry.meaning,
    aliases: entry.aliases,
    category: entry.category,
    group: entry.group,
    polarity: entry.polarity,
    sourceKind: entry.sourceKind,
    sourceId: entry.sourceId,
    sourceLabel: entry.sourceLabel,
    adultLevel: entry.adultLevel,
    postCount: entry.postCount,
    score
  }))

  return {
    query,
    total: scored.length,
    returned: out.length,
    searchableCount: entries.length,
    entries: out
  }
}

function mergeSearchResults(
  base: PromptDictionarySearchResult,
  custom: PromptDictionarySearchResult,
  limit: number
): PromptDictionarySearchResult {
  const byTag = new Map<string, PromptDictionaryEntry>()
  for (const entry of base.entries) {
    byTag.set(normalizeKey(entry.en), entry)
  }
  for (const entry of custom.entries) {
    byTag.set(normalizeKey(entry.en), {
      ...entry,
      score: entry.score + 6
    })
  }

  const entries = [...byTag.values()]
    .sort((a, b) =>
      b.score - a.score ||
      sourceRank(b.sourceKind) - sourceRank(a.sourceKind) ||
      a.en.localeCompare(b.en)
    )
    .slice(0, limit)

  return {
    query: base.query,
    total: Math.max(byTag.size, base.total + custom.total),
    returned: entries.length,
    searchableCount: base.searchableCount + custom.searchableCount,
    entries
  }
}

function clampLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_LIMIT
  return Math.max(0, Math.min(MAX_LIMIT, Math.floor(value ?? DEFAULT_LIMIT)))
}

function buildDictionaryEntries(base: PromptCategory[], custom: PromptCategory[]): IndexedPromptDictionaryEntry[] {
  const byTag = new Map<string, IndexedPromptDictionaryEntry>()
  for (const category of base) addCategoryEntries(byTag, category, 'built-in')
  for (const category of custom) addCategoryEntries(byTag, category, 'custom')
  return [...byTag.values()]
}

function addCategoryEntries(
  byTag: Map<string, IndexedPromptDictionaryEntry>,
  category: PromptCategory,
  sourceKind: PromptDictionaryEntry['sourceKind']
): void {
  for (const group of category.groups) {
    for (const tag of group.tags) {
      const en = normalizeDisplayTag(tag.en)
      const key = normalizeKey(en)
      if (!key) continue
      const next = createEntry(category.name, group.name, tag, sourceKind)
      const previous = byTag.get(key)
      byTag.set(key, previous ? mergeEntries(previous, next) : next)
    }
  }
}

function createEntry(
  category: string,
  group: string,
  tag: PromptGroupTag,
  sourceKind: PromptDictionaryEntry['sourceKind']
): IndexedPromptDictionaryEntry {
  const en = normalizeDisplayTag(tag.en)
  const ja = (tag.ja ?? '').trim()
  const aliases = Array.from(new Set([
    ...(tag.aliases ?? []).map((alias) => alias.trim()).filter(Boolean),
    category,
    group
  ]))
  const entry: PromptDictionaryEntry = {
    en,
    ja,
    meaning: ja,
    aliases,
    category,
    group,
    polarity: normalizePolarity(tag.polarity),
    sourceKind,
    sourceId: sourceKind === 'custom' ? 'custom-library' : 'prompt-library-ja',
    sourceLabel: sourceKind === 'custom' ? 'Custom Library' : 'Prompt Library',
    adultLevel: 0,
    postCount: null,
    score: 0
  }
  return indexEntry(entry)
}

function mergeEntries(
  previous: IndexedPromptDictionaryEntry,
  next: IndexedPromptDictionaryEntry
): IndexedPromptDictionaryEntry {
  if (next.sourceKind === 'custom') {
    return indexEntry({
      ...previous,
      ja: next.ja || previous.ja,
      meaning: next.meaning || previous.meaning,
      aliases: Array.from(new Set([...previous.aliases, ...next.aliases])),
      category: next.category || previous.category,
      group: next.group || previous.group,
      polarity: next.polarity ?? previous.polarity,
      sourceKind: 'custom',
      sourceId: next.sourceId || previous.sourceId,
      sourceLabel: 'Custom Library'
    })
  }
  return indexEntry({
    ...previous,
    aliases: Array.from(new Set([...previous.aliases, ...next.aliases]))
  })
}

function indexEntry(entry: PromptDictionaryEntry): IndexedPromptDictionaryEntry {
  const normalizedTag = normalizeLatin(entry.en)
  const haystack = [
    entry.en,
    normalizedTag,
    entry.ja,
    entry.meaning ?? '',
    entry.category,
    entry.group,
    ...entry.aliases
  ].join(' ').toLowerCase()
  return {
    ...entry,
    normalizedTag,
    tagKey: normalizeKey(entry.en),
    haystack
  }
}

function scoreEntry(
  entry: IndexedPromptDictionaryEntry,
  normalizedQuery: string,
  terms: QueryTerm[],
  requestedPolarity: PromptTagPolarity | null
): number {
  let score = 0
  for (const term of terms) {
    const best = Math.max(...term.alternatives.map((alternative) =>
      scoreAlternativeWithWeight(entry, term.raw, alternative)
    ))
    if (best <= 0) return 0
    score += best
  }

  score += wholeQueryScore(entry, normalizedQuery)
  if (entry.sourceKind === 'custom') score += 6
  if (requestedPolarity) {
    if (entry.polarity === requestedPolarity) score += 18
    else if (entry.polarity === 'both') score += 10
    else score -= 8
  } else {
    if (entry.polarity === 'positive') score += 2
    if (entry.polarity === 'negative') score -= 1
  }
  return score
}

function wholeQueryScore(entry: IndexedPromptDictionaryEntry, normalizedQuery: string): number {
  if ([...normalizedQuery].length < 2) return 0
  const tagKey = normalizeLatin(entry.tagKey)
  const aliases = entry.aliases.map(normalizeLatin)

  if (entry.normalizedTag === normalizedQuery || tagKey === normalizedQuery) return 90
  if (entry.normalizedTag.startsWith(normalizedQuery) || tagKey.startsWith(normalizedQuery)) return 72
  if (aliases.some((alias) => alias === normalizedQuery)) return 58
  if (aliases.some((alias) => alias.startsWith(normalizedQuery))) return 46
  if (entry.normalizedTag.includes(normalizedQuery) || tagKey.includes(normalizedQuery)) return 32
  if (aliases.some((alias) => alias.includes(normalizedQuery))) return 22
  return 0
}

function scoreAlternativeWithWeight(
  entry: IndexedPromptDictionaryEntry,
  rawTerm: string,
  alternative: QueryAlternative
): number {
  const base = scoreAlternative(entry, rawTerm, alternative.value)
  return base > 0 ? base + alternative.weight : 0
}

function scoreAlternative(entry: IndexedPromptDictionaryEntry, rawTerm: string, alternative: string): number {
  const term = alternative.toLowerCase()
  const latinTerm = normalizeLatin(term)
  const raw = rawTerm.toLowerCase()
  const rawLatin = normalizeLatin(raw)
  if (!entry.haystack.includes(raw) && !entry.haystack.includes(rawLatin) && !entry.haystack.includes(term) && !entry.haystack.includes(latinTerm)) {
    return 0
  }

  if (entry.tagKey === term || entry.normalizedTag === latinTerm) return 120
  if (entry.tagKey.startsWith(term) || entry.normalizedTag.startsWith(latinTerm)) return 86
  if (entry.tagKey.includes(term) || entry.normalizedTag.includes(latinTerm)) return 58
  if (entry.aliases.some((alias) => alias.toLowerCase() === term || alias.toLowerCase() === raw)) return 48
  if (entry.aliases.some((alias) => alias.toLowerCase().includes(term) || alias.toLowerCase().includes(raw))) return 36
  if (entry.ja.includes(rawTerm) || (entry.meaning ?? '').includes(rawTerm)) return 28
  if (entry.category.includes(rawTerm) || entry.group.includes(rawTerm)) return 18
  return 8
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

function normalizeDisplayTag(value: string): string {
  return value.trim()
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeLatin(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
}

function normalizePolarity(value: PromptTagPolarity | undefined): PromptTagPolarity {
  if (value === 'negative' || value === 'both') return value
  return 'positive'
}

function sourceRank(kind: PromptDictionaryEntry['sourceKind']): number {
  return kind === 'custom' ? 1 : 0
}

function normalizeRequestedPolarity(value: PromptTagPolarity | undefined): PromptTagPolarity | null {
  if (value === 'positive' || value === 'negative' || value === 'both') return value
  return null
}

function matchesSearchFilters(entry: PromptDictionaryEntry, request: PromptDictionarySearchRequest): boolean {
  if (request.adult === 'safe' && entry.adultLevel > 0) return false
  if (request.adult === 'adult' && entry.adultLevel <= 0) return false
  if (request.sourceIds?.length) {
    const wanted = new Set(request.sourceIds)
    if (!wanted.has(entry.sourceId)) return false
  }
  return true
}
