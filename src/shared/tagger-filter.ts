export const DEFAULT_TAGGER_MIN_SCORE = 0.4

export const DEFAULT_TAGGER_BLACKLIST = [
  'blurry',
  'blurry background',
  'blurry foreground',
  'bokeh',
  'chromatic aberration',
  'motion blur',
  'depth of field',
  'transparent background',
  'photo background',
  'simple background',
  'white background',
  'black background',
  'pixel art',
  'low poly',
  '3d',
  'cgi',
  'blue theme',
  'brown theme',
  'green theme',
  'pink theme',
  'horror theme',
  'text',
  'signature',
  'watermark'
]

export function normalizeTaggerFilterToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/[_/-]+/g, ' ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseTaggerBlacklist(value: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of value.split(/[,\n]+/)) {
    const normalized = normalizeTaggerFilterToken(raw)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}
