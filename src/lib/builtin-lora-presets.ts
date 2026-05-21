import type { CivitaiRecommended, LoraCivitaiMetadata, LoraPromptOverride, SdLora, SdSampler } from '@shared/types'
import type { GenerationParams } from './store'

export interface BuiltInLoraTarget {
  name: string
  tokenName?: string
  alias?: string
  path?: string
  sha256?: string | null
}

export interface BuiltInLoraPresetContext {
  selectedModelTitle?: string | null
  recommendation?: CivitaiRecommended | null
}

export interface BuiltInLoraPromptPreset {
  override: LoraPromptOverride
  generationParams: Pick<GenerationParams, 'steps' | 'cfgScale' | 'sampler' | 'clipSkip'>
}

const ONOKO_STANDARD_POSITIVE = [
  '0n0k0',
  'black hair',
  'blue eyes',
  'looking at viewer',
  'face visible',
  'masterpiece',
  'best quality'
]

const ONOKO_PONY_POSITIVE = [
  'score_9',
  'score_8_up',
  'score_7_up',
  'source_anime',
  ...ONOKO_STANDARD_POSITIVE
]

const ONOKO_NEGATIVE = [
  'lowres',
  'bad anatomy',
  'bad hands',
  'extra fingers',
  'malformed face',
  'text',
  'logo',
  'watermark',
  'signature',
  'jpeg artifacts',
  'multiple girls',
  '2girls',
  'white hair',
  'silver hair',
  'gray hair',
  'blonde hair',
  'brown hair',
  'covered face',
  'hair over face',
  'blurry face'
]

export function getBuiltInLoraPromptPreset(
  lora: SdLora | BuiltInLoraTarget,
  meta: LoraCivitaiMetadata | null | undefined,
  context: BuiltInLoraPresetContext = {}
): BuiltInLoraPromptPreset | null {
  if (!isOnokoSdxlLora(lora, meta)) return null
  const pony = isPonyCheckpointContext(context)
  const positive = pony ? ONOKO_PONY_POSITIVE : ONOKO_STANDARD_POSITIVE
  return {
    override: {
      id: 'builtin:onoko-0n0k0-sdxl-v3',
      loraName: lora.name,
      loraAlias: lora.alias ?? lora.name,
      loraPath: lora.path,
      loraSha256: validSha256(lora.sha256 ?? meta?.availability?.primaryFileSha256 ?? null),
      positivePrompt: positive.join(', '),
      negativePrompt: ONOKO_NEGATIVE.join(', '),
      weight: pony ? 0.95 : 0.85,
      sampler: 'Euler a',
      steps: 28,
      cfgScale: 7,
      clipSkip: 2,
      autoApply: true,
      updatedAt: 0
    },
    generationParams: {
      sampler: 'Euler a',
      steps: 28,
      cfgScale: 7,
      clipSkip: 2
    }
  }
}

export function resolvePresetSampler(samplers: SdSampler[], preferred: string): string | null {
  const normalizedPreferred = preferred.toLowerCase()
  const exact = samplers.find((sampler) => sampler.name.toLowerCase() === normalizedPreferred)
  if (exact) return exact.name
  const alias = samplers.find((sampler) =>
    sampler.aliases.some((value) => value.toLowerCase() === normalizedPreferred)
  )
  return alias?.name ?? null
}

export function loraGenerationParamsFromOverride(
  override: LoraPromptOverride | null | undefined
): Partial<Pick<GenerationParams, 'steps' | 'cfgScale' | 'sampler' | 'clipSkip'>> {
  if (!override) return {}
  return {
    ...(override.sampler ? { sampler: override.sampler } : {}),
    ...(override.steps != null ? { steps: override.steps } : {}),
    ...(override.cfgScale != null ? { cfgScale: override.cfgScale } : {}),
    ...(override.clipSkip != null ? { clipSkip: override.clipSkip } : {})
  }
}

function isOnokoSdxlLora(lora: SdLora | BuiltInLoraTarget, meta: LoraCivitaiMetadata | null | undefined): boolean {
  const text = [
    lora.name,
    lora.tokenName,
    lora.alias,
    lora.path,
    meta?.modelName,
    meta?.versionName,
    ...(meta?.trainedWords ?? [])
  ].filter(Boolean).join(' ').toLowerCase()
  return text.includes('0n0k0') && (text.includes('onoko') || text.includes('ai girl'))
}

function isPonyCheckpointContext(context: BuiltInLoraPresetContext): boolean {
  const text = [
    context.selectedModelTitle,
    context.recommendation?.baseModel,
    context.recommendation?.modelName,
    context.recommendation?.versionName
  ].filter(Boolean).join(' ')
  return /pony/i.test(text)
}

function validSha256(value: string | null | undefined): string | null {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null
}
