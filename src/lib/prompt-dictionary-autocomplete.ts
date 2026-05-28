import type { PromptDictionaryEntry, PromptTagPolarity } from '@shared/types'

export const PROMPT_DICTIONARY_AUTOCOMPLETE_LIMIT = 12
export const PROMPT_DICTIONARY_AUTOCOMPLETE_DELAY_MS = 120

export interface PromptDictionaryAutocompleteSuggestion {
  en: string
  ja: string
  meaning?: string
  category?: string
  group?: string
  sourceId?: string
  sourceLabel?: string
  polarity?: PromptTagPolarity
  adultLevel?: number
  postCount?: number | null
  score?: number
}

export interface PromptDictionaryAutocompleteRange {
  query: string
  rawToken: string
  start: number
  end: number
}

const TOKEN_BOUNDARIES = new Set([',', '，', '、', '\n', '(', ')', '[', ']', '{', '}', '|', ';'])

export function currentAutocompleteRange(
  value: string,
  selectionStart: number | null | undefined,
  selectionEnd: number | null | undefined = selectionStart
): PromptDictionaryAutocompleteRange {
  const startCaret = clampCaret(value, selectionStart)
  const endCaret = clampCaret(value, selectionEnd ?? startCaret)
  const tokenStart = findTokenStart(value, startCaret)
  const tokenEnd = findTokenEnd(value, endCaret)
  const rawToken = value.slice(tokenStart, startCaret)
  return {
    query: normalizeAutocompleteQuery(rawToken),
    rawToken,
    start: tokenStart,
    end: tokenEnd
  }
}

export function shouldSearchAutocompleteQuery(query: string, forced: boolean): boolean {
  const trimmed = query.trim()
  const length = [...trimmed].length
  if (forced) return length > 0
  if (length === 0) return false
  if (/[\u3040-\u30ff\u3400-\u9fff]/.test(trimmed)) return length >= 1
  return length >= 2
}

export function insertAutocompleteSuggestion(
  value: string,
  range: PromptDictionaryAutocompleteRange,
  suggestion: PromptDictionaryAutocompleteSuggestion
): { value: string; caret: number } {
  const before = value.slice(0, range.start)
  const after = value.slice(range.end)
  const suffix = after.length > 0 && /^\s*(,|，|、|\n|\)|\]|\})/.test(after) ? '' : ', '
  const nextValue = `${before}${suggestion.en}${suffix}${after}`
  return {
    value: nextValue,
    caret: before.length + suggestion.en.length + suffix.length
  }
}

export function suggestionFromDictionary(entry: PromptDictionaryEntry): PromptDictionaryAutocompleteSuggestion {
  return {
    en: entry.en,
    ja: entry.ja,
    meaning: entry.meaning,
    category: entry.category,
    group: entry.group,
    sourceId: entry.sourceId,
    sourceLabel: entry.sourceLabel,
    polarity: entry.polarity,
    adultLevel: entry.adultLevel,
    postCount: entry.postCount,
    score: entry.score
  }
}

export function findLocalAutocompleteSuggestions(
  autocompleteMap: Map<string, string>,
  query: string,
  limit = PROMPT_DICTIONARY_AUTOCOMPLETE_LIMIT,
  excluded = new Set<string>()
): PromptDictionaryAutocompleteSuggestion[] {
  const normalizedQuery = normalizeSuggestionKey(query)
  if (normalizedQuery.length < 2 || autocompleteMap.size === 0 || limit <= 0) return []

  const scored: Array<{ suggestion: PromptDictionaryAutocompleteSuggestion; score: number }> = []
  for (const [en, ja] of autocompleteMap.entries()) {
    const key = normalizeSuggestionKey(en)
    if (!key || excluded.has(key)) continue
    const jaKey = ja.toLowerCase()
    const score = scoreLocalSuggestion(key, jaKey, normalizedQuery, query)
    if (score <= 0) continue
    scored.push({
      suggestion: { en, ja, sourceLabel: 'Prompt Library', score },
      score
    })
  }

  return scored
    .sort((a, b) => b.score - a.score || a.suggestion.en.localeCompare(b.suggestion.en))
    .slice(0, limit)
    .map((item) => item.suggestion)
}

export function mergeAutocompleteSuggestions(
  dictionarySuggestions: PromptDictionaryAutocompleteSuggestion[],
  localSuggestions: PromptDictionaryAutocompleteSuggestion[],
  limit = PROMPT_DICTIONARY_AUTOCOMPLETE_LIMIT,
  usageHints: string[] = []
): PromptDictionaryAutocompleteSuggestion[] {
  const hintRank = new Map<string, number>()
  usageHints.forEach((tag, index) => {
    const key = normalizeSuggestionKey(tag)
    if (key && !hintRank.has(key)) hintRank.set(key, index)
  })
  const byKey = new Map<string, { suggestion: PromptDictionaryAutocompleteSuggestion; order: number }>()
  let order = 0
  for (const suggestion of [...dictionarySuggestions, ...localSuggestions]) {
    const key = normalizeSuggestionKey(suggestion.en)
    if (!key) continue
    const previous = byKey.get(key)
    const current = { suggestion, order: order++ }
    if (!previous || autocompleteRank(current.suggestion, hintRank, current.order) > autocompleteRank(previous.suggestion, hintRank, previous.order)) {
      byKey.set(key, current)
    }
  }
  return [...byKey.values()]
    .sort((a, b) =>
      autocompleteRank(b.suggestion, hintRank, b.order) - autocompleteRank(a.suggestion, hintRank, a.order) ||
      a.order - b.order
    )
    .slice(0, limit)
    .map((item) => item.suggestion)
}

export function polarityFromAutocompleteMode(mode: string | null | undefined): PromptTagPolarity | undefined {
  const normalized = String(mode ?? '').toLowerCase()
  if (/(negative|rejected|blacklist|avoid|failure)/.test(normalized)) return 'negative'
  if (/(positive|accepted|tag-list|library-tag|prompt|slot|regional|character|lora)/.test(normalized)) return 'positive'
  return undefined
}

export function autocompleteSuggestionBadge(suggestion: PromptDictionaryAutocompleteSuggestion): string {
  if ((suggestion.adultLevel ?? 0) > 0) return 'adult'
  return suggestion.group || suggestion.category || suggestion.sourceLabel || ''
}

export function autocompleteSuggestionSubtext(suggestion: PromptDictionaryAutocompleteSuggestion): string {
  const primary = suggestion.ja || suggestion.meaning || suggestion.category || suggestion.group || suggestion.sourceLabel || ''
  const count = formatSuggestionPostCount(suggestion.postCount)
  if (primary && count) return `${primary} / ${count}`
  return primary || count
}

export function buildAutocompleteUsageHints(
  recentTags: readonly string[],
  acceptedTagGroups: ReadonlyArray<readonly string[]> = [],
  limit = 96
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  function add(tag: string): void {
    const normalized = normalizeSuggestionKey(tag)
    if (!normalized || seen.has(normalized) || out.length >= limit) return
    seen.add(normalized)
    out.push(tag)
  }
  recentTags.forEach(add)
  acceptedTagGroups.forEach((group) => group.forEach(add))
  return out
}

export function normalizeAutocompleteQuery(value: string): string {
  return value
    .replace(/<\s*(lora|lyco|hypernet|embedding):[^>]+>/gi, ' ')
    .replace(/^[\s([{]+/g, '')
    .replace(/[\s)\]}]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatSuggestionPostCount(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN) || (value ?? 0) <= 0) return ''
  const count = Number(value)
  if (count >= 1000000) return `${Math.round(count / 100000) / 10}M`
  if (count >= 1000) return `${Math.round(count / 100) / 10}k`
  return `${count}`
}

function autocompleteRank(
  suggestion: PromptDictionaryAutocompleteSuggestion,
  hintRank: Map<string, number>,
  order: number
): number {
  const key = normalizeSuggestionKey(suggestion.en)
  const hintedAt = hintRank.get(key)
  const hintBoost = hintedAt == null ? 0 : Math.max(8, 36 - hintedAt * 0.6)
  const sourceBoost = suggestion.sourceId === 'local-user-prompts' ? 4 : 0
  return (suggestion.score ?? 0) + hintBoost + sourceBoost - order * 0.001
}

export function normalizeSuggestionKey(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
}

function findTokenStart(value: string, caret: number): number {
  let index = caret - 1
  while (index >= 0 && !TOKEN_BOUNDARIES.has(value[index])) index -= 1
  let start = index + 1
  while (start < caret && /\s/.test(value[start])) start += 1
  return start
}

function findTokenEnd(value: string, caret: number): number {
  let end = caret
  while (end < value.length && !TOKEN_BOUNDARIES.has(value[end])) end += 1
  while (end > caret && /\s/.test(value[end - 1])) end -= 1
  return end
}

function clampCaret(value: string, caret: number | null | undefined): number {
  const next = typeof caret === 'number' && Number.isFinite(caret) ? caret : value.length
  return Math.max(0, Math.min(value.length, Math.floor(next)))
}

function scoreLocalSuggestion(key: string, jaKey: string, normalizedQuery: string, rawQuery: string): number {
  const raw = rawQuery.toLowerCase()
  if (key === normalizedQuery || jaKey === raw) return 120
  if (key.startsWith(normalizedQuery) || jaKey.startsWith(raw)) return 86
  if (key.includes(normalizedQuery) || jaKey.includes(raw)) return 48
  return 0
}
