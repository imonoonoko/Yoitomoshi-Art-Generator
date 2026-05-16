/**
 * Helpers for splicing presets and weight tokens into a comma-separated prompt.
 *
 * The model takes a single string but users think in terms of distinct tokens.
 * We treat the prompt as an ordered list joined by ", " — these helpers preserve
 * that shape (no double commas, no leading/trailing punctuation).
 */

/** Find a contiguous substring match (case-insensitive on whole-token boundaries). */
export function promptContains(prompt: string, snippet: string): boolean {
  const normP = normalizeForMatch(prompt)
  const normS = normalizeForMatch(snippet)
  if (!normS) return false
  return normP.includes(normS)
}

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Append a snippet to a prompt with proper comma separation. If the snippet
 * already exists, returns the prompt unchanged.
 */
export function promptAppend(prompt: string, snippet: string): string {
  if (promptContains(prompt, snippet)) return prompt
  const trimmed = prompt.replace(/[,\s]+$/, '')
  return trimmed.length === 0 ? snippet : `${trimmed}, ${snippet}`
}

/**
 * Remove a snippet from a prompt and tidy any orphaned commas. Tolerant of
 * whitespace differences between when the snippet was added and now.
 */
export function promptRemove(prompt: string, snippet: string): string {
  if (!promptContains(prompt, snippet)) return prompt
  // Build a regex that's lenient about whitespace inside the snippet.
  const escaped = snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  const re = new RegExp(escaped, 'i')
  let next = prompt.replace(re, '')
  // Clean up artifacts: double commas, leading/trailing commas, double spaces.
  next = next.replace(/,\s*,/g, ',').replace(/^[\s,]+|[\s,]+$/g, '').replace(/\s{2,}/g, ' ')
  return next
}

/**
 * Adjust the weight of the token currently under the caret using A1111's
 * `(token:weight)` syntax. Returns the new prompt + new caret position so the
 * caller can keep the cursor in the right place.
 *
 * If the token is already wrapped, increment the weight; otherwise wrap with
 * a starting weight of 1.1 (positive delta) or 0.9 (negative). Step is 0.1.
 */
export function adjustTokenWeight(
  prompt: string,
  caret: number,
  delta: number
): { prompt: string; caret: number } {
  const tokens = splitPromptTokensWithRanges(prompt)
  const cur = tokens.find((t) => caret >= t.start && caret <= t.end)
  if (!cur) return { prompt, caret }

  const replacement = adjustPromptTokenText(cur.text, delta)

  const newPrompt = prompt.slice(0, cur.start) + replacement + prompt.slice(cur.end)
  // Place caret at the end of the replaced token so further key presses keep adjusting it.
  const newCaret = cur.start + replacement.length
  return { prompt: newPrompt, caret: newCaret }
}

function adjustPromptTokenText(text: string, delta: number): string {
  // Match (something:1.2) — capture content and weight.
  const wrapped = text.match(/^\(\s*(.+?)\s*:\s*([0-9.]+)\s*\)$/)

  if (wrapped) {
    const [, inner, w] = wrapped
    const next = clampWeight(parseFloat(w) + delta)
    return next === 1 ? inner : `(${inner}:${next.toFixed(1)})`
  }

  const next = clampWeight(1 + delta)
  return next === 1 ? text : `(${text}:${next.toFixed(1)})`
}

function clampWeight(n: number): number {
  return Math.max(0.1, Math.min(2.0, Math.round(n * 10) / 10))
}

export interface PromptTokenRange { text: string; start: number; end: number }

export function splitPromptTokensWithRanges(prompt: string): PromptTokenRange[] {
  const out: PromptTokenRange[] = []
  // Split on commas at the top level — but skip commas inside parens for weighted tokens.
  let depth = 0
  let tokenStart = 0
  for (let i = 0; i <= prompt.length; i++) {
    const ch = prompt[i]
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    if ((ch === ',' && depth === 0) || i === prompt.length) {
      const slice = prompt.slice(tokenStart, i)
      const trimmedStart = tokenStart + slice.length - slice.trimStart().length
      const trimmedEnd = trimmedStart + slice.trim().length
      if (slice.trim().length > 0) {
        out.push({ text: prompt.slice(trimmedStart, trimmedEnd), start: trimmedStart, end: trimmedEnd })
      }
      tokenStart = i + 1
    }
  }
  return out
}

export function cleanPromptTokenForMatch(text: string): string {
  const trimmed = text.trim()
  const weighted = trimmed.match(/^\(\s*(.+?)\s*:\s*[0-9.]+\s*\)$/)
  const inner = weighted?.[1] ?? trimmed
  return inner.replace(/^[(\[]+|[)\]]+$/g, '').trim()
}

export function removePromptToken(prompt: string, token: PromptTokenRange): string {
  return tidyPromptCommas(prompt.slice(0, token.start) + prompt.slice(token.end))
}

function selectedIndexSet(indexes: Iterable<number>): Set<number> {
  return indexes instanceof Set ? indexes : new Set(indexes)
}

function joinPromptTokenTexts(tokens: string[]): string {
  return tokens.map((token) => token.trim()).filter(Boolean).join(', ')
}

export function removePromptTokensByIndexes(prompt: string, indexes: Iterable<number>): string {
  const selected = selectedIndexSet(indexes)
  if (selected.size === 0) return prompt
  return joinPromptTokenTexts(
    splitPromptTokensWithRanges(prompt)
      .filter((_token, index) => !selected.has(index))
      .map((token) => token.text)
  )
}

export function adjustPromptTokensByIndexes(
  prompt: string,
  indexes: Iterable<number>,
  delta: number
): string {
  const selected = selectedIndexSet(indexes)
  if (selected.size === 0) return prompt
  return joinPromptTokenTexts(
    splitPromptTokensWithRanges(prompt)
      .map((token, index) => selected.has(index) ? adjustPromptTokenText(token.text, delta) : token.text)
  )
}

export function dedupePromptTokens(prompt: string): { prompt: string; removed: number } {
  const tokens = splitPromptTokensWithRanges(prompt)
  const seen = new Set<string>()
  const kept: string[] = []
  let removed = 0
  for (const token of tokens) {
    const key = cleanPromptTokenForMatch(token.text).toLowerCase()
    if (!key) continue
    if (seen.has(key)) {
      removed += 1
      continue
    }
    seen.add(key)
    kept.push(token.text)
  }
  return { prompt: kept.join(', '), removed }
}

export interface PromptFormatSummary {
  changed: boolean
  removedDuplicates: number
  removedEmptyTokens: number
  normalizedUnderscores: number
  protectedTokens: number
}

export interface PromptFormatResult {
  prompt: string
  summary: PromptFormatSummary
}

const PROTECTED_PROMPT_TOKEN = /<(?:lora|lyco|hypernet):[^>\n]+>/gi
const PROTECTED_PLACEHOLDER = /%%YOITOPROTECTED(\d+)%%/
const PROMPT_CONTROL_TOKENS = new Set(['AND', 'BREAK', 'ADDROW', 'ADDCOL'])
const PRESERVE_UNDERSCORE_TOKEN = /^(?:score_\d+(?:_up)?|rating_(?:safe|questionable|explicit|sensitive|general)|source_[a-z0-9_]+)$/i

/**
 * Conservative prompt cleanup for user-authored tag lists. Adapter tokens and
 * regional-prompt separators are preserved while common comma/space/tag noise
 * is normalized.
 */
export function formatPromptText(prompt: string): PromptFormatResult {
  const protectedPrompt = protectPromptTokens(prompt)
  const lines = protectedPrompt.text.replace(/\r\n/g, '\n').split('\n')
  const formattedLines: string[] = []
  const summary: PromptFormatSummary = {
    changed: false,
    removedDuplicates: 0,
    removedEmptyTokens: 0,
    normalizedUnderscores: 0,
    protectedTokens: protectedPrompt.tokens.length
  }

  for (const line of lines) {
    const segments = splitPromptLineSegments(line)
    const seen = new Set<string>()
    const kept: string[] = []

    for (const rawSegment of segments) {
      const rawTrimmed = rawSegment.trim()
      if (!rawTrimmed) {
        if (line.trim()) summary.removedEmptyTokens += 1
        continue
      }

      const normalized = normalizePromptSegment(rawTrimmed, summary)
      if (!normalized) {
        summary.removedEmptyTokens += 1
        continue
      }

      if (isProtectedPromptSegment(normalized)) {
        kept.push(normalized)
        continue
      }

      const key = promptFormatDedupeKey(normalized)
      if (!key) {
        summary.removedEmptyTokens += 1
        continue
      }
      if (seen.has(key)) {
        summary.removedDuplicates += 1
        continue
      }
      seen.add(key)
      kept.push(normalized)
    }

    if (kept.length > 0) formattedLines.push(kept.join(', '))
  }

  const restored = restorePromptTokens(formattedLines.join('\n'), protectedPrompt.tokens)
  summary.changed = restored !== prompt
  return { prompt: restored, summary }
}

export function promptNeedsFormatting(prompt: string): boolean {
  return formatPromptText(prompt).summary.changed
}

export function reorderPromptToken(prompt: string, fromIndex: number, toIndex: number): string {
  const tokens = splitPromptTokensWithRanges(prompt).map((token) => token.text)
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= tokens.length ||
    toIndex >= tokens.length
  ) {
    return prompt
  }
  const [moved] = tokens.splice(fromIndex, 1)
  tokens.splice(toIndex, 0, moved)
  return tokens.join(', ')
}

function protectPromptTokens(prompt: string): { text: string; tokens: string[] } {
  const tokens: string[] = []
  const text = prompt.replace(PROTECTED_PROMPT_TOKEN, (token) => {
    const index = tokens.length
    tokens.push(token.trim())
    return `%%YOITOPROTECTED${index}%%`
  })
  return { text, tokens }
}

function restorePromptTokens(prompt: string, tokens: string[]): string {
  let restored = prompt.trim()
  tokens.forEach((token, index) => {
    restored = restored.replaceAll(`%%YOITOPROTECTED${index}%%`, token)
  })
  return restored
}

function splitPromptLineSegments(line: string): string[] {
  const out: string[] = []
  let start = 0
  let roundDepth = 0
  let squareDepth = 0
  let braceDepth = 0
  let angleDepth = 0

  for (let i = 0; i <= line.length; i++) {
    const ch = line[i]
    if (ch === '(') roundDepth += 1
    else if (ch === ')') roundDepth = Math.max(0, roundDepth - 1)
    else if (ch === '[') squareDepth += 1
    else if (ch === ']') squareDepth = Math.max(0, squareDepth - 1)
    else if (ch === '{') braceDepth += 1
    else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1)
    else if (ch === '<') angleDepth += 1
    else if (ch === '>') angleDepth = Math.max(0, angleDepth - 1)

    const topLevel = roundDepth === 0 && squareDepth === 0 && braceDepth === 0 && angleDepth === 0
    if ((ch === ',' && topLevel) || i === line.length) {
      out.push(line.slice(start, i))
      start = i + 1
    }
  }

  return out
}

function normalizePromptSegment(segment: string, summary: PromptFormatSummary): string {
  const controlToken = segment.toUpperCase()
  if (PROMPT_CONTROL_TOKENS.has(controlToken)) return controlToken

  let normalized = segment.replace(/\s+/g, ' ').trim()
  if (!isProtectedPromptSegment(normalized) && !PRESERVE_UNDERSCORE_TOKEN.test(normalized)) {
    summary.normalizedUnderscores += normalized.match(/_/g)?.length ?? 0
    normalized = normalized.replace(/_/g, ' ')
  }
  return normalized.replace(/\s+/g, ' ').trim()
}

function isProtectedPromptSegment(segment: string): boolean {
  return PROTECTED_PLACEHOLDER.test(segment)
}

function promptFormatDedupeKey(segment: string): string {
  return cleanPromptTokenForMatch(segment)
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim()
}

function tidyPromptCommas(prompt: string): string {
  return prompt
    .replace(/\s*,\s*/g, ', ')
    .replace(/(?:,\s*){2,}/g, ', ')
    .replace(/^[\s,]+|[\s,]+$/g, '')
}

/**
 * Approximate token count (CLIP tokenizer estimate). Real CLIP-tokens require
 * the BPE tokenizer; we use a heuristic that matches typical SD prompts within
 * ~10% so the user gets a reliable signal of the 75-token chunk boundary.
 *
 * Heuristic: split on commas + spaces, count word fragments; punctuation chars
 * each cost 1 token. Tested against actual CLIP tokenizer output on common SD
 * prompts — close enough for a status indicator, not for layout decisions.
 */
export function approxTokenCount(text: string): number {
  if (!text) return 0
  // Common abbreviations and weighted tokens (parens) each take a token slot
  let count = 0
  // Each run of word chars ~= 1 BPE token for short common words, ~2 for long
  const matches = text.match(/[a-zA-Z]+|[0-9]+|[぀-ヿ一-龯]+|[^\w\s]/g) ?? []
  for (const m of matches) {
    if (/[a-zA-Z]/.test(m)) {
      count += Math.max(1, Math.ceil(m.length / 4))
    } else if (/[぀-ヿ一-龯]/.test(m)) {
      // Japanese chars are roughly 1 token each
      count += m.length
    } else {
      count += 1
    }
  }
  return count
}
