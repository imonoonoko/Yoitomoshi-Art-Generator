/**
 * Tokenize a prompt for syntax highlighting.
 *
 * Patterns we color:
 *   <lora:name:weight>      → warn (yellow)         — LoRA reference
 *   <hypernet:...>          → accent                — hypernetwork (rare on Forge but valid)
 *   <lyco:...>              → accent                — LyCORIS (alternate LoRA)
 *   (text:N.N)              → ok (green)            — explicit positive weight
 *   (text)                  → ok-dim (faint green)  — implicit ×1.1
 *   [text:N.N] / [text]     → err (red-ish)         — explicit / implicit ×0.9
 *   {a|b|c}                 → purple                — wildcards (Forge supports via extension)
 *   BREAK                   → pink (bold)           — A1111 chunk break keyword
 *   #...\n                  → ink-3                 — line comments (some workflows use these)
 *
 * The tokenizer is deliberately non-greedy and does NOT try to perfectly match
 * nested parentheses (regex can't); instead it matches the innermost forms,
 * which covers ~95% of real prompts and lets multi-nested cases fall through
 * as plain text rather than producing incorrect coloring.
 */

export interface HighlightToken {
  text: string
  /** Tailwind class applied to a <span> wrapping the token. Empty = no class. */
  className: string
}

const PATTERN = new RegExp(
  [
    '<(?:lora|lyco|hypernet):[^>\\n]+>',
    '\\([^()\\n]+:\\d+(?:\\.\\d+)?\\)',
    '\\([^()\\n]+\\)',
    '\\[[^\\[\\]\\n]+:\\d+(?:\\.\\d+)?\\]',
    '\\[[^\\[\\]\\n]+\\]',
    '\\{[^{}\\n]+\\}',
    '\\bBREAK\\b',
    '#[^\\n]*'
  ].join('|'),
  'g'
)

function classify(match: string): string {
  if (match.startsWith('<lora:')) return 'text-warn'
  if (match.startsWith('<lyco:')) return 'text-warn'
  if (match.startsWith('<hypernet:')) return 'text-accent'
  if (match.startsWith('(') && /:\d+(?:\.\d+)?\)$/.test(match)) return 'text-ok'
  if (match.startsWith('(')) return 'text-ok/70'
  if (match.startsWith('[') && /:\d+(?:\.\d+)?\]$/.test(match)) return 'text-err'
  if (match.startsWith('[')) return 'text-err/70'
  if (match.startsWith('{')) return 'text-purple-300'
  if (match === 'BREAK') return 'text-pink-400 font-semibold'
  if (match.startsWith('#')) return 'text-ink-3 italic'
  return ''
}

export function highlightPrompt(text: string): HighlightToken[] {
  if (!text) return [{ text: '', className: '' }]
  const tokens: HighlightToken[] = []
  let last = 0
  // Reset lastIndex defensively (regex literal is module-scoped + has 'g' flag).
  PATTERN.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = PATTERN.exec(text)) !== null) {
    if (m.index > last) {
      tokens.push({ text: text.slice(last, m.index), className: '' })
    }
    tokens.push({ text: m[0], className: classify(m[0]) })
    last = m.index + m[0].length
  }
  if (last < text.length) tokens.push({ text: text.slice(last), className: '' })
  // Always end with a trailing newline if the source did — otherwise the mirror
  // <pre> collapses the final blank line and shifts the caret upward.
  if (text.endsWith('\n')) {
    tokens.push({ text: '​', className: '' })
  }
  return tokens
}
