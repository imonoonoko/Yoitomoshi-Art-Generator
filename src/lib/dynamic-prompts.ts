import type { HistoryDynamicPromptMeta, HistoryItem, PromptCategory } from '@shared/types'

export type DynamicPromptIssueSeverity = 'error' | 'warn'

export interface DynamicPromptIssue {
  severity: DynamicPromptIssueSeverity
  code: 'unclosed_variant' | 'empty_variant' | 'missing_wildcard' | 'empty_wildcard' | 'generation_limit'
  message: string
  token?: string
}

export interface DynamicWildcardSource {
  name: string
  label: string
  values: string[]
  source: 'prompt-library' | 'history-review' | 'recent' | 'favorites'
}

export interface DynamicPromptContext {
  wildcards: Map<string, DynamicWildcardSource>
}

export type DynamicPromptMeta = HistoryDynamicPromptMeta

export interface DynamicPromptResolution {
  template: string
  prompt: string
  seed: number
  used: boolean
  usedWildcards: string[]
  issues: DynamicPromptIssue[]
}

export interface DynamicPromptPreview {
  prompts: string[]
  estimate: number
  truncated: boolean
  usedWildcards: string[]
  issues: DynamicPromptIssue[]
}

interface ResolveState {
  rng: () => number
  context: DynamicPromptContext
  issues: DynamicPromptIssue[]
  usedWildcards: Set<string>
  depth: number
}

interface VariantOption {
  text: string
  weight: number
}

const MAX_DEPTH = 24
const MAX_ESTIMATE = 10_000
const DEFAULT_PREVIEW_LIMIT = 8
const BUILTIN_ALIAS_RULES: Array<{ aliases: string[]; match: RegExp }> = [
  { aliases: ['quality'], match: /品質|quality|finish/i },
  { aliases: ['composition'], match: /構図|見せ方|composition|shot|angle/i },
  { aliases: ['camera'], match: /カメラ|レンズ|camera|lens/i },
  { aliases: ['lighting'], match: /照明|色|lighting|light|color/i },
  { aliases: ['atmosphere'], match: /雰囲気|atmosphere|mood/i },
  { aliases: ['background'], match: /背景|場所|background|location|scene/i },
  { aliases: ['clothing'], match: /衣装|服|clothes|clothing|fashion|costume/i },
  { aliases: ['expression'], match: /表情|expression|face/i },
  { aliases: ['pose'], match: /ポーズ|pose|gesture/i },
  { aliases: ['negative'], match: /negative|ネガティブ|崩れ|不要|品質/i }
]

export function buildDynamicPromptContext(input: {
  library: PromptCategory[]
  customLibrary: PromptCategory[]
  history: HistoryItem[]
  recentTags: string[]
  favorites: Set<string>
}): DynamicPromptContext {
  const wildcards = new Map<string, DynamicWildcardSource>()
  const add = (name: string, label: string, values: string[], source: DynamicWildcardSource['source']): void => {
    const key = normalizeWildcardName(name)
    const cleanValues = dedupeValues(values)
    if (!key || cleanValues.length === 0) return
    const existing = wildcards.get(key)
    if (existing) {
      wildcards.set(key, {
        ...existing,
        values: dedupeValues([...existing.values, ...cleanValues])
      })
      return
    }
    wildcards.set(key, { name: key, label, values: cleanValues, source })
  }

  for (const cat of [...input.library, ...input.customLibrary]) {
    const categoryValues: string[] = []
    const catSlug = slugName(cat.name)
    for (const group of cat.groups) {
      const values = group.tags.map((tag) => tag.en)
      categoryValues.push(...values)
      const groupSlug = slugName(group.name)
      add(groupSlug, group.name, values, 'prompt-library')
      if (catSlug && groupSlug) add(`${catSlug}/${groupSlug}`, `${cat.name} / ${group.name}`, values, 'prompt-library')
      for (const rule of BUILTIN_ALIAS_RULES) {
        if (rule.match.test(group.name)) {
          for (const alias of rule.aliases) add(alias, group.name, values, 'prompt-library')
        }
      }
    }
    add(catSlug, cat.name, categoryValues, 'prompt-library')
  }

  const accepted: string[] = []
  const rejected: string[] = []
  for (const item of input.history) {
    accepted.push(...(item.tagReview?.acceptedTags ?? []))
    rejected.push(...(item.tagReview?.rejectedTags ?? []))
  }
  add('reviewed/accepted', 'History review accepted', accepted, 'history-review')
  add('reviewed/rejected', 'History review rejected', rejected, 'history-review')
  add('history/accepted', 'History review accepted', accepted, 'history-review')
  add('history/rejected', 'History review rejected', rejected, 'history-review')
  add('recent', 'Recent tags', input.recentTags, 'recent')
  add('favorites', 'Favorite tags', [...input.favorites], 'favorites')

  return { wildcards }
}

export function hasDynamicPromptSyntax(template: string): boolean {
  return /{[^{}|]*\||__[^_\s][\s\S]*?__/.test(template)
}

export function resolveDynamicPrompt(
  template: string,
  context: DynamicPromptContext,
  seed = randomPromptSeed()
): DynamicPromptResolution {
  const issues: DynamicPromptIssue[] = []
  const usedWildcards = new Set<string>()
  const prompt = resolveText(template, {
    rng: seededRandom(seed),
    context,
    issues,
    usedWildcards,
    depth: 0
  })
  return {
    template,
    prompt: tidyResolvedPrompt(prompt),
    seed,
    used: hasDynamicPromptSyntax(template),
    usedWildcards: [...usedWildcards].sort((a, b) => a.localeCompare(b)),
    issues
  }
}

export function previewDynamicPrompts(
  template: string,
  context: DynamicPromptContext,
  opts: { count?: number; seed?: number } = {}
): DynamicPromptPreview {
  const count = Math.max(1, Math.min(32, Math.round(opts.count ?? DEFAULT_PREVIEW_LIMIT)))
  const seed = opts.seed ?? 1001
  const prompts: string[] = []
  const issues: DynamicPromptIssue[] = []
  const usedWildcards = new Set<string>()

  for (let i = 0; i < count; i += 1) {
    const result = resolveDynamicPrompt(template, context, seed + i)
    prompts.push(result.prompt)
    result.issues.forEach((issue) => issues.push(issue))
    result.usedWildcards.forEach((name) => usedWildcards.add(name))
  }

  const estimate = estimateDynamicPromptCount(template, context)
  const truncated = estimate > count
  if (estimate > MAX_ESTIMATE) {
    issues.push({
      severity: 'warn',
      code: 'generation_limit',
      message: `Estimated combinations exceed ${MAX_ESTIMATE.toLocaleString()}. Use a small preview count first.`
    })
  }

  return {
    prompts: dedupeValues(prompts).slice(0, count),
    estimate,
    truncated,
    usedWildcards: [...usedWildcards].sort((a, b) => a.localeCompare(b)),
    issues: dedupeIssues(issues)
  }
}

export function estimateDynamicPromptCount(template: string, context: DynamicPromptContext): number {
  const count = estimateText(template, context, 0)
  return Math.max(1, Math.min(MAX_ESTIMATE + 1, count))
}

export function randomPromptSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647)
}

export function normalizeWildcardName(name: string): string {
  return name
    .trim()
    .replace(/^__|__$/g, '')
    .replace(/\\/g, '/')
    .replace(/\.txt$/i, '')
    .replace(/\s+/g, '_')
    .replace(/\/+/g, '/')
    .toLowerCase()
}

function resolveText(text: string, state: ResolveState): string {
  if (state.depth > MAX_DEPTH) return text
  let out = ''
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '{') {
      const end = findMatchingBrace(text, i)
      if (end < 0) {
        state.issues.push({
          severity: 'error',
          code: 'unclosed_variant',
          message: 'Dynamic prompt variant is missing a closing brace.',
          token: text.slice(i)
        })
        out += text.slice(i)
        break
      }
      out += resolveVariant(text.slice(i + 1, end), state)
      i = end
      continue
    }

    if (text[i] === '_' && text[i + 1] === '_') {
      const end = text.indexOf('__', i + 2)
      if (end >= 0) {
        out += resolveWildcard(text.slice(i + 2, end), state)
        i = end + 1
        continue
      }
    }

    out += text[i]
  }
  return out
}

function resolveVariant(body: string, state: ResolveState): string {
  const spec = parseVariantSpec(body)
  const options = splitTopLevel(spec.body, '|')
    .map(parseWeightedOption)
    .filter((option) => option.text.trim().length > 0)

  if (options.length === 0) {
    state.issues.push({
      severity: 'warn',
      code: 'empty_variant',
      message: 'Dynamic prompt variant has no selectable values.',
      token: `{${body}}`
    })
    return ''
  }

  const count = Math.min(options.length, randomInt(state.rng, spec.minCount, spec.maxCount))
  const picked = pickWeighted(options, count, state.rng)
  return picked
    .map((option) => resolveText(option.text, { ...state, depth: state.depth + 1 }))
    .join(spec.separator)
}

function resolveWildcard(rawName: string, state: ResolveState): string {
  const name = normalizeWildcardName(rawName)
  const source = state.context.wildcards.get(name)
  if (!source) {
    state.issues.push({
      severity: 'error',
      code: 'missing_wildcard',
      message: `Wildcard "${name}" was not found.`,
      token: `__${rawName}__`
    })
    return `__${rawName}__`
  }
  if (source.values.length === 0) {
    state.issues.push({
      severity: 'warn',
      code: 'empty_wildcard',
      message: `Wildcard "${name}" has no values.`,
      token: `__${rawName}__`
    })
    return ''
  }
  state.usedWildcards.add(source.name)
  const value = source.values[randomInt(state.rng, 0, source.values.length - 1)] ?? ''
  return resolveText(value, { ...state, depth: state.depth + 1 })
}

function parseVariantSpec(body: string): { minCount: number; maxCount: number; separator: string; body: string } {
  const match = body.match(/^\s*(\d+)(?:\s*-\s*(\d+))?\s*\$\$(?:([\s\S]*?)\$\$)?([\s\S]*)$/)
  if (!match) return { minCount: 1, maxCount: 1, separator: ', ', body }
  const min = Math.max(1, parseInt(match[1], 10))
  const max = Math.max(min, match[2] ? parseInt(match[2], 10) : min)
  return {
    minCount: min,
    maxCount: max,
    separator: match[3] ?? ', ',
    body: match[4] ?? ''
  }
}

function parseWeightedOption(raw: string): VariantOption {
  const match = raw.match(/^\s*([0-9]*\.?[0-9]+)\s*::\s*([\s\S]*)$/)
  if (!match) return { text: raw.trim(), weight: 1 }
  const weight = Number(match[1])
  return {
    text: match[2].trim(),
    weight: Number.isFinite(weight) && weight > 0 ? weight : 1
  }
}

function pickWeighted(options: VariantOption[], count: number, rng: () => number): VariantOption[] {
  const pool = [...options]
  const picked: VariantOption[] = []
  for (let i = 0; i < count && pool.length > 0; i += 1) {
    const total = pool.reduce((sum, item) => sum + item.weight, 0)
    let cursor = rng() * total
    let index = 0
    for (; index < pool.length; index += 1) {
      cursor -= pool[index].weight
      if (cursor <= 0) break
    }
    picked.push(pool.splice(Math.min(index, pool.length - 1), 1)[0])
  }
  return picked
}

function findMatchingBrace(text: string, start: number): number {
  let depth = 0
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function splitTopLevel(text: string, delimiter: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '{') depth += 1
    else if (ch === '}') depth = Math.max(0, depth - 1)
    else if (ch === delimiter && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

function estimateText(text: string, context: DynamicPromptContext, depth: number): number {
  if (depth > MAX_DEPTH) return 1
  let total = 1
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '{') {
      const end = findMatchingBrace(text, i)
      if (end < 0) return total
      total = cappedProduct(total, estimateVariant(text.slice(i + 1, end), context, depth + 1))
      i = end
      continue
    }
    if (text[i] === '_' && text[i + 1] === '_') {
      const end = text.indexOf('__', i + 2)
      if (end >= 0) {
        const source = context.wildcards.get(normalizeWildcardName(text.slice(i + 2, end)))
        total = cappedProduct(total, Math.max(1, source?.values.length ?? 1))
        i = end + 1
      }
    }
  }
  return total
}

function estimateVariant(body: string, context: DynamicPromptContext, depth: number): number {
  const spec = parseVariantSpec(body)
  const options = splitTopLevel(spec.body, '|').filter((part) => part.trim().length > 0)
  if (options.length === 0) return 1
  const optionCounts = options.map((part) => estimateText(parseWeightedOption(part).text, context, depth + 1))
  const optionSum = optionCounts.reduce((sum, count) => Math.min(MAX_ESTIMATE + 1, sum + count), 0)
  const chooseCount = Math.min(options.length, spec.maxCount)
  if (chooseCount <= 1) return Math.max(1, optionSum)
  return cappedProduct(permutationCount(options.length, chooseCount), Math.max(1, Math.ceil(optionSum / options.length)))
}

function permutationCount(size: number, count: number): number {
  let out = 1
  for (let i = 0; i < count; i += 1) out = cappedProduct(out, size - i)
  return out
}

function cappedProduct(a: number, b: number): number {
  return Math.min(MAX_ESTIMATE + 1, a * b)
}

function seededRandom(seed: number): () => number {
  let x = Math.trunc(seed) || 1
  return () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    return ((x >>> 0) % 1_000_000) / 1_000_000
  }
}

function randomInt(rng: () => number, min: number, max: number): number {
  if (max <= min) return min
  return min + Math.floor(rng() * (max - min + 1))
}

function dedupeValues(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of values) {
    const value = raw.trim().replace(/\s+/g, ' ')
    const key = value.toLowerCase()
    if (!value || seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

function dedupeIssues(issues: DynamicPromptIssue[]): DynamicPromptIssue[] {
  const seen = new Set<string>()
  const out: DynamicPromptIssue[] = []
  for (const issue of issues) {
    const key = `${issue.code}:${issue.token ?? issue.message}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(issue)
  }
  return out
}

function slugName(name: string): string {
  return normalizeWildcardName(
    name
      .replace(/[・、。/]+/g, ' ')
      .replace(/[^\p{Letter}\p{Number}\s_-]+/gu, '')
      .trim()
  )
}

function tidyResolvedPrompt(prompt: string): string {
  return prompt
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/,\s*,+/g, ',')
    .replace(/^[,\s]+|[,\s]+$/g, '')
}
