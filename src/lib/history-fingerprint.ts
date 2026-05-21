import type { HistoryItem } from '@shared/types'
import { cleanPromptTokenForMatch, splitPromptTokensWithRanges } from './prompt-utils'

export interface HistoryExperimentGroup {
  fingerprint: string
  items: HistoryItem[]
  latestAt: number
  modelCount: number
  loraStateCount: number
  sizeCount: number
  seedCount: number
  keyTags: string[]
}

interface BuildOptions {
  minItems?: number
  maxGroups?: number
}

const IGNORED_TAGS = new Set([
  'masterpiece',
  'best quality',
  'high quality',
  'low quality',
  'worst quality',
  'highly detailed',
  'ultra detailed',
  'absurdres',
  '8k',
  'solo',
  'nsfw'
])

const VOLATILE_PREFIXES = ['score ', 'rating ', 'source ']

export function buildHistoryExperimentGroups(
  history: HistoryItem[],
  options: BuildOptions = {}
): HistoryExperimentGroup[] {
  const minItems = options.minItems ?? 2
  const maxGroups = options.maxGroups ?? 6
  const grouped = new Map<string, HistoryItem[]>()

  for (const item of history) {
    const fingerprint = promptFingerprint(item.prompt)
    if (!fingerprint) continue
    const list = grouped.get(fingerprint) ?? []
    list.push(item)
    grouped.set(fingerprint, list)
  }

  return Array.from(grouped.entries())
    .map(([fingerprint, items]) => buildGroup(fingerprint, items))
    .filter((group) => group.items.length >= minItems)
    .sort((a, b) => b.latestAt - a.latestAt || b.items.length - a.items.length)
    .slice(0, maxGroups)
}

export function promptFingerprint(prompt: string): string {
  const tokens = normalizePromptTokens(prompt)
  if (tokens.length === 0) return ''
  return tokens.slice(0, 32).join('|')
}

export function normalizePromptTokens(prompt: string): string[] {
  const stripped = prompt
    .replace(/<(?:lora|lyco|hypernet):[^>\n]+>/gi, ' ')
    .replace(/\r\n/g, '\n')

  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of splitPromptTokensWithRanges(stripped)) {
    const token = normalizeToken(raw.text)
    if (!token) continue
    if (IGNORED_TAGS.has(token)) continue
    if (VOLATILE_PREFIXES.some((prefix) => token.startsWith(prefix))) continue
    if (seen.has(token)) continue
    seen.add(token)
    out.push(token)
  }
  return out
}

function buildGroup(fingerprint: string, items: HistoryItem[]): HistoryExperimentGroup {
  const sorted = [...items].sort((a, b) => b.createdAt - a.createdAt)
  const models = new Set(sorted.map((item) => item.params.model ?? 'none'))
  const loraStates = new Set(sorted.map((item) =>
    (item.params.activeLoras ?? []).map((lora) => lora.name).sort().join('+') || 'none'
  ))
  const sizes = new Set(sorted.map((item) => `${item.params.width}x${item.params.height}`))
  const seeds = new Set(sorted.map((item) => String(item.params.seed)))
  return {
    fingerprint,
    items: sorted,
    latestAt: sorted[0]?.createdAt ?? 0,
    modelCount: models.size,
    loraStateCount: loraStates.size,
    sizeCount: sizes.size,
    seedCount: seeds.size,
    keyTags: fingerprint.split('|').slice(0, 5)
  }
}

function normalizeToken(raw: string): string {
  const cleaned = cleanPromptTokenForMatch(raw)
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  if (!cleaned || cleaned.length < 2) return ''
  if (/^\d+$/.test(cleaned)) return ''
  return cleaned
}
