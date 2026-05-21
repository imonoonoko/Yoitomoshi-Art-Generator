import type {
  CheckpointPromptFamily,
  CheckpointPromptProfile,
  CheckpointPromptProfileMode,
  CivitaiRecommended,
  ModelLibraryEntry,
  SdModel
} from '@shared/types'
import { formatPromptText, splitPromptTokensWithRanges } from './prompt-utils'

export interface CheckpointPromptContext {
  title?: string | null
  name?: string | null
  path?: string | null
  sha256?: string | null
  baseModel?: string | null
}

export interface CheckpointPromptFormatResult {
  prompt: string
  family: CheckpointPromptFamily
  profile: CheckpointPromptProfile | null
  changed: boolean
  modelChanged: boolean
  addedTokens: string[]
}

const DEFAULT_POSITIVE_PREFIX: Record<CheckpointPromptFamily, string[]> = {
  pony: ['score_9', 'score_8_up', 'score_7_up', 'source_anime'],
  illustrious: ['masterpiece', 'best quality'],
  noobai: ['masterpiece', 'best quality'],
  animagine: ['masterpiece', 'best quality'],
  sdxl: [],
  sd15: [],
  flux: [],
  custom: []
}

export function checkpointPromptContextFromModel(
  model: SdModel | null | undefined,
  recommendation?: CivitaiRecommended | null
): CheckpointPromptContext {
  return {
    title: model?.title ?? null,
    name: model?.modelName ?? null,
    path: model?.filename ?? null,
    sha256: model?.sha256 ?? null,
    baseModel: recommendation?.baseModel ?? null
  }
}

export function checkpointPromptContextFromLibraryEntry(entry: ModelLibraryEntry): CheckpointPromptContext {
  return {
    title: entry.name,
    name: stripModelFileExtension(entry.name),
    path: entry.path,
    sha256: validSha256(entry.sha256 ?? entry.civitai?.expectedSha256 ?? entry.sourceMeta?.expectedSha256 ?? null),
    baseModel: entry.sourceMeta?.baseModel ?? null
  }
}

export function inferCheckpointPromptFamily(context: CheckpointPromptContext): CheckpointPromptFamily {
  const text = [
    context.baseModel,
    context.title,
    context.name,
    context.path
  ].filter(Boolean).join(' ')
  if (/pony/i.test(text)) return 'pony'
  if (/noobai|noob.ai/i.test(text)) return 'noobai'
  if (/animagine/i.test(text)) return 'animagine'
  if (/illustrious|ilxl|ilsfw|n4mik4/i.test(text)) return 'illustrious'
  if (/sd\s*1\.5|sd1\.5|sd15|v1-?5/i.test(text)) return 'sd15'
  if (/flux/i.test(text)) return 'flux'
  if (/sdxl|xl(?:[_\-.]|$)/i.test(text)) return 'sdxl'
  return 'custom'
}

export function findCheckpointPromptProfile(
  profiles: Map<string, CheckpointPromptProfile>,
  context: CheckpointPromptContext
): CheckpointPromptProfile | undefined {
  for (const key of checkpointPromptProfileKeys(context)) {
    const hit = profiles.get(key)
    if (hit) return hit
  }
  const sha = validSha256(context.sha256)
  const normalizedNames = new Set(
    [context.title, context.name, context.path]
      .filter((value): value is string => Boolean(value))
      .map(normalizeCheckpointIdentity)
  )
  for (const item of profiles.values()) {
    if (sha && item.checkpointSha256?.toLowerCase() === sha) return item
    if (normalizedNames.has(normalizeCheckpointIdentity(item.checkpointTitle))) return item
    if (item.checkpointName && normalizedNames.has(normalizeCheckpointIdentity(item.checkpointName))) return item
    if (item.checkpointPath && normalizedNames.has(normalizeCheckpointIdentity(item.checkpointPath))) return item
  }
  return undefined
}

export function preferredCheckpointPromptProfileId(context: CheckpointPromptContext): string {
  const sha = validSha256(context.sha256)
  if (sha) return `sha256:${sha}`
  const name = context.name ?? context.title ?? context.path ?? 'checkpoint'
  return `name:${normalizeCheckpointIdentity(name)}`
}

export function checkpointPromptProfileKeys(context: CheckpointPromptContext): string[] {
  const keys = [preferredCheckpointPromptProfileId(context)]
  for (const value of [context.title, context.name, context.path]) {
    if (!value) continue
    keys.push(`name:${normalizeCheckpointIdentity(value)}`)
  }
  return Array.from(new Set(keys))
}

export function defaultCheckpointPromptProfile(context: CheckpointPromptContext): CheckpointPromptProfile {
  const family = inferCheckpointPromptFamily(context)
  const title = context.title ?? context.name ?? 'checkpoint'
  return {
    id: preferredCheckpointPromptProfileId(context),
    checkpointTitle: title,
    checkpointName: context.name ?? stripModelFileExtension(title),
    checkpointPath: context.path ?? undefined,
    checkpointSha256: validSha256(context.sha256),
    family,
    positivePrefix: DEFAULT_POSITIVE_PREFIX[family],
    positiveAppend: [],
    negativeAppend: [],
    mode: family === 'custom' || family === 'sdxl' || family === 'sd15' || family === 'flux' ? 'manual' : 'suggest',
    updatedAt: Date.now()
  }
}

export function checkpointPromptProfileSuggests(profile: CheckpointPromptProfile | null | undefined): boolean {
  return profile != null && profile.mode !== 'manual'
}

export function formatPromptForCheckpoint(
  prompt: string,
  target: 'positive' | 'negative',
  context: CheckpointPromptContext,
  savedProfile?: CheckpointPromptProfile | null
): CheckpointPromptFormatResult {
  const profile = savedProfile ?? defaultCheckpointPromptProfile(context)
  const family = profile.family
  const normal = formatPromptText(prompt).prompt
  const modelTokens = target === 'positive'
    ? [...profile.positivePrefix, ...profile.positiveAppend]
    : [...profile.negativeAppend]
  const merged = mergePromptTokens(
    target === 'positive' ? profile.positivePrefix : [],
    normal,
    target === 'positive' ? profile.positiveAppend : profile.negativeAppend
  )
  const formatted = formatPromptText(merged).prompt
  return {
    prompt: formatted,
    family,
    profile,
    changed: formatted !== prompt,
    modelChanged: formatted !== normal && modelTokens.some((token) => !promptHasToken(normal, token)),
    addedTokens: modelTokens.filter((token) => !promptHasToken(normal, token))
  }
}

export function normalizeCheckpointProfileMode(value: string): CheckpointPromptProfileMode {
  return value === 'manual' || value === 'auto' || value === 'suggest' ? value : 'suggest'
}

export function normalizeCheckpointProfileFamily(value: string): CheckpointPromptFamily {
  return value === 'pony' ||
    value === 'illustrious' ||
    value === 'noobai' ||
    value === 'animagine' ||
    value === 'sdxl' ||
    value === 'sd15' ||
    value === 'flux' ||
    value === 'custom'
    ? value
    : 'custom'
}

export function splitProfileTagText(value: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of value.split(/[,\n]/)) {
    const tag = raw.trim()
    const key = tag.toLowerCase().replace(/\s+/g, ' ')
    if (!tag || seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  return out
}

export function joinProfileTags(tags: string[]): string {
  return tags.join(', ')
}

function mergePromptTokens(prefix: string[], prompt: string, append: string[]): string {
  const tokens = splitPromptTokensWithRanges(prompt).map((token) => token.text)
  const out: string[] = []
  const seen = new Set<string>()
  for (const token of [...prefix, ...tokens, ...append]) {
    const trimmed = token.trim()
    const key = promptTokenKey(trimmed)
    if (!trimmed || !key || seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out.join(', ')
}

function promptHasToken(prompt: string, token: string): boolean {
  const key = promptTokenKey(token)
  if (!key) return true
  return splitPromptTokensWithRanges(prompt).some((item) => promptTokenKey(item.text) === key)
}

function promptTokenKey(token: string): string {
  return token.trim().toLowerCase().replace(/[_\s]+/g, ' ')
}

function normalizeCheckpointIdentity(value: string): string {
  const normalized = stripForgeHash(value.trim().replace(/\\/g, '/'))
  const base = normalized.split('/').pop() ?? normalized
  return stripModelFileExtension(base).toLowerCase()
}

function stripForgeHash(value: string): string {
  return value.replace(/\s+\[[0-9a-fA-F]{6,}\]$/, '').trim()
}

function stripModelFileExtension(value: string): string {
  return value.trim().replace(/\.(safetensors|ckpt|pt|pth|bin)$/i, '')
}

function validSha256(value: string | null | undefined): string | null {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null
}
