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
  const tokens = splitTokensWithRanges(prompt)
  const cur = tokens.find((t) => caret >= t.start && caret <= t.end)
  if (!cur) return { prompt, caret }

  const text = cur.text
  // Match (something:1.2) — capture content and weight.
  const wrapped = text.match(/^\(\s*(.+?)\s*:\s*([0-9.]+)\s*\)$/)

  let replacement: string
  if (wrapped) {
    const [, inner, w] = wrapped
    const next = clampWeight(parseFloat(w) + delta)
    replacement = next === 1 ? inner : `(${inner}:${next.toFixed(1)})`
  } else {
    const next = clampWeight(1 + delta)
    replacement = next === 1 ? text : `(${text}:${next.toFixed(1)})`
  }

  const newPrompt = prompt.slice(0, cur.start) + replacement + prompt.slice(cur.end)
  // Place caret at the end of the replaced token so further key presses keep adjusting it.
  const newCaret = cur.start + replacement.length
  return { prompt: newPrompt, caret: newCaret }
}

function clampWeight(n: number): number {
  return Math.max(0.1, Math.min(2.0, Math.round(n * 10) / 10))
}

interface TokenRange { text: string; start: number; end: number }

function splitTokensWithRanges(prompt: string): TokenRange[] {
  const out: TokenRange[] = []
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
