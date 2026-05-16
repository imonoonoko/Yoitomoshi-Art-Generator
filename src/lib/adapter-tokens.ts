export type AdapterTokenKind = 'lora' | 'lyco' | 'hypernet'

export interface ParsedAdapterToken {
  kind: AdapterTokenKind
  name: string
  weight: number
  teWeight: number | null
  unetWeight: number | null
  dyn: number | null
  raw: string
  args: string[]
  start: number
  end: number
  complex: boolean
}

const ADAPTER_TOKEN_RE = /<(lora|lyco|hypernet):([^>\n]+)>/gi

export function parseAdapterTokens(prompt: string): ParsedAdapterToken[] {
  const tokens: ParsedAdapterToken[] = []
  let match: RegExpExecArray | null
  ADAPTER_TOKEN_RE.lastIndex = 0
  while ((match = ADAPTER_TOKEN_RE.exec(prompt)) !== null) {
    const parsed = parseAdapterTokenBody(
      match[1].toLowerCase() as AdapterTokenKind,
      match[2],
      match[0],
      match.index,
      ADAPTER_TOKEN_RE.lastIndex
    )
    if (parsed) tokens.push(parsed)
  }
  return tokens
}

export function stripAdapterTokens(
  prompt: string,
  kinds: Set<AdapterTokenKind> = new Set(['lora', 'lyco'])
): { prompt: string; tokens: ParsedAdapterToken[] } {
  const tokens = parseAdapterTokens(prompt).filter((token) => kinds.has(token.kind))
  if (tokens.length === 0) return { prompt, tokens }
  let cursor = 0
  let out = ''
  for (const token of tokens) {
    out += prompt.slice(cursor, token.start)
    cursor = token.end
  }
  out += prompt.slice(cursor)
  return {
    prompt: out.replace(/,\s*,/g, ',').replace(/\s{2,}/g, ' ').replace(/^[\s,]+|[\s,]+$/g, ''),
    tokens
  }
}

function parseAdapterTokenBody(
  kind: AdapterTokenKind,
  body: string,
  raw: string,
  start: number,
  end: number
): ParsedAdapterToken | null {
  const parts = body.split(':').map((part) => part.trim()).filter(Boolean)
  const name = parts.shift() ?? ''
  if (!name) return null

  let weight: number | null = null
  let teWeight: number | null = null
  let unetWeight: number | null = null
  let dyn: number | null = null
  const args: string[] = []

  for (const part of parts) {
    args.push(part)
    const keyValue = part.match(/^([a-z_]+)\s*=\s*(-?\d+(?:\.\d+)?)$/i)
    if (keyValue) {
      const key = keyValue[1].toLowerCase()
      const value = Number(keyValue[2])
      if (!Number.isFinite(value)) continue
      if (key === 'te' || key === 'text' || key === 'text_encoder') teWeight = value
      else if (key === 'unet' || key === 'model') unetWeight = value
      else if (key === 'dyn') dyn = value
      continue
    }
    const numeric = Number(part)
    if (Number.isFinite(numeric) && weight == null) weight = numeric
  }

  const fallbackWeight = unetWeight ?? teWeight ?? weight ?? 1
  return {
    kind,
    name,
    weight: fallbackWeight,
    teWeight,
    unetWeight,
    dyn,
    raw,
    args,
    start,
    end,
    complex: kind !== 'lora' || teWeight != null || unetWeight != null || dyn != null || args.length > 1
  }
}
