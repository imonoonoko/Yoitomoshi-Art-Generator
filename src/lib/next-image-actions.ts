import type { ActiveLora, SdModel } from '@shared/types'
import type { GenerationParams } from './store'
import {
  cleanPromptTokenForMatch,
  dedupePromptTokens,
  promptAppend,
  splitPromptTokensWithRanges
} from './prompt-utils'

export type NextImageActionId =
  | 'continue-seed'
  | 'seed-compare'
  | 'expression-variant'
  | 'composition-variant'
  | 'background-variant'
  | 'reduce-failure'
  | 'without-lora'
  | 'switch-model'

export interface NextImageState {
  prompt: string
  negativePrompt: string
  params: GenerationParams
  activeLoras: ActiveLora[]
  models: SdModel[]
  selectedModelTitle: string | null
}

export interface NextImagePatch {
  prompt?: string
  negativePrompt?: string
  params?: Partial<GenerationParams>
  activeLoras?: ActiveLora[]
  selectedModelTitle?: string | null
}

export interface NextImagePreview {
  addedPositive: string[]
  removedPositive: string[]
  addedNegative: string[]
  paramChanges: string[]
}

export interface NextImageAction {
  id: NextImageActionId
  labelKey: string
  summaryKey: string
  icon: 'shuffle' | 'compare' | 'smile' | 'camera' | 'image' | 'shield' | 'layers' | 'model'
  kind: 'patch' | 'variation'
  patch?: NextImagePatch
  preview: NextImagePreview
}

interface TagFamily {
  tags: string[]
  fallback: string
}

const EXPRESSION_FAMILY: TagFamily = {
  tags: ['smile', 'grin', 'blush', 'displeased expression', 'scowl', 'looking away', 'looking at viewer', 'looking back'],
  fallback: 'smile'
}

const COMPOSITION_FAMILY: TagFamily = {
  tags: ['full body', 'cowboy shot', 'from below', 'from behind', 'low angle view', 'dynamic angle'],
  fallback: 'cowboy shot'
}

const BACKGROUND_FAMILY: TagFamily = {
  tags: ['outdoors', 'indoors', 'night', 'city street', 'sky', 'detailed background'],
  fallback: 'detailed background'
}

const FAILURE_NEGATIVE = [
  'bad hands',
  'missing fingers',
  'extra fingers',
  'blurry face',
  'extra limbs',
  'distorted body',
  'low quality',
  'text',
  'watermark'
]

export function buildNextImageActions(state: NextImageState): NextImageAction[] {
  const actions: NextImageAction[] = [
    continueSeedAction(state),
    seedCompareAction(),
    variantAction('expression-variant', state.prompt, EXPRESSION_FAMILY, 'nextImage.action.expression', 'nextImage.action.expressionSummary', 'smile'),
    variantAction('composition-variant', state.prompt, COMPOSITION_FAMILY, 'nextImage.action.composition', 'nextImage.action.compositionSummary', 'camera'),
    variantAction('background-variant', state.prompt, BACKGROUND_FAMILY, 'nextImage.action.background', 'nextImage.action.backgroundSummary', 'image'),
    reduceFailureAction(state.negativePrompt)
  ]

  if (state.activeLoras.length > 0) actions.push(withoutLoraAction(state))
  const modelAction = switchModelAction(state)
  if (modelAction) actions.push(modelAction)
  return actions
}

function continueSeedAction(state: NextImageState): NextImageAction {
  return {
    id: 'continue-seed',
    labelKey: 'nextImage.action.continue',
    summaryKey: 'nextImage.action.continueSummary',
    icon: 'shuffle',
    kind: 'patch',
    patch: { params: { seed: -1, batchSize: 1, iterations: 1 } },
    preview: {
      addedPositive: [],
      removedPositive: [],
      addedNegative: [],
      paramChanges: summarizeParamChanges(state.params, { seed: -1, batchSize: 1, iterations: 1 })
    }
  }
}

function seedCompareAction(): NextImageAction {
  return {
    id: 'seed-compare',
    labelKey: 'nextImage.action.seedCompare',
    summaryKey: 'nextImage.action.seedCompareSummary',
    icon: 'compare',
    kind: 'variation',
    preview: {
      addedPositive: [],
      removedPositive: [],
      addedNegative: [],
      paramChanges: ['Variation: seed x4']
    }
  }
}

function variantAction(
  id: Extract<NextImageActionId, 'expression-variant' | 'composition-variant' | 'background-variant'>,
  prompt: string,
  family: TagFamily,
  labelKey: string,
  summaryKey: string,
  icon: NextImageAction['icon']
): NextImageAction {
  const result = rotatePromptFamily(prompt, family)
  return {
    id,
    labelKey,
    summaryKey,
    icon,
    kind: 'patch',
    patch: { prompt: result.prompt },
    preview: {
      addedPositive: result.added ? [result.added] : [],
      removedPositive: result.removed ? [result.removed] : [],
      addedNegative: [],
      paramChanges: []
    }
  }
}

function reduceFailureAction(negativePrompt: string): NextImageAction {
  const next = appendMany(negativePrompt, FAILURE_NEGATIVE)
  return {
    id: 'reduce-failure',
    labelKey: 'nextImage.action.reduceFailure',
    summaryKey: 'nextImage.action.reduceFailureSummary',
    icon: 'shield',
    kind: 'patch',
    patch: { negativePrompt: next },
    preview: {
      addedPositive: [],
      removedPositive: [],
      addedNegative: diffAddedTags(negativePrompt, next),
      paramChanges: []
    }
  }
}

function withoutLoraAction(state: NextImageState): NextImageAction {
  const names = state.activeLoras.map((lora) => lora.name).slice(0, 3)
  return {
    id: 'without-lora',
    labelKey: 'nextImage.action.withoutLora',
    summaryKey: 'nextImage.action.withoutLoraSummary',
    icon: 'layers',
    kind: 'patch',
    patch: { activeLoras: [], params: { seed: -1, batchSize: 1, iterations: 1 } },
    preview: {
      addedPositive: [],
      removedPositive: [],
      addedNegative: [],
      paramChanges: [
        `LoRA off: ${names.join(', ')}${state.activeLoras.length > names.length ? '...' : ''}`,
        ...summarizeParamChanges(state.params, { seed: -1, batchSize: 1, iterations: 1 })
      ]
    }
  }
}

function switchModelAction(state: NextImageState): NextImageAction | null {
  const current = state.selectedModelTitle
  const candidates = state.models.map((model) => model.title).filter((title) => title && title !== current)
  const next = candidates[0]
  if (!next) return null
  return {
    id: 'switch-model',
    labelKey: 'nextImage.action.switchModel',
    summaryKey: 'nextImage.action.switchModelSummary',
    icon: 'model',
    kind: 'patch',
    patch: { selectedModelTitle: next, params: { seed: -1, batchSize: 1, iterations: 1 } },
    preview: {
      addedPositive: [],
      removedPositive: [],
      addedNegative: [],
      paramChanges: [
        `model: ${compactModelName(current)} -> ${compactModelName(next)}`,
        ...summarizeParamChanges(state.params, { seed: -1, batchSize: 1, iterations: 1 })
      ]
    }
  }
}

function rotatePromptFamily(prompt: string, family: TagFamily): { prompt: string; added: string; removed: string | null } {
  const tokens = splitPromptTokensWithRanges(prompt)
  const currentIndex = tokens.findIndex((token) => family.tags.some((tag) => tagKey(tag) === tagKey(token.text)))
  if (currentIndex >= 0) {
    const current = cleanPromptTokenForMatch(tokens[currentIndex].text)
    const familyIndex = Math.max(0, family.tags.findIndex((tag) => tagKey(tag) === tagKey(current)))
    const next = family.tags[(familyIndex + 1) % family.tags.length] ?? family.fallback
    const nextTokens = tokens.map((token, index) => index === currentIndex ? next : token.text)
    return {
      prompt: dedupePromptTokens(nextTokens.join(', ')).prompt,
      added: next,
      removed: current
    }
  }
  return {
    prompt: promptAppend(prompt, family.fallback),
    added: family.fallback,
    removed: null
  }
}

function appendMany(prompt: string, tags: string[]): string {
  let next = prompt
  for (const tag of tags) next = promptAppend(next, tag)
  return next
}

function diffAddedTags(before: string, after: string): string[] {
  const beforeKeys = new Set(splitPromptTokensWithRanges(before).map((token) => tagKey(token.text)))
  return splitPromptTokensWithRanges(after)
    .map((token) => cleanPromptTokenForMatch(token.text))
    .filter((tag) => tag && !beforeKeys.has(tagKey(tag)))
    .slice(0, 12)
}

function summarizeParamChanges(base: GenerationParams, patch: Partial<GenerationParams>): string[] {
  const changes: string[] = []
  for (const [key, value] of Object.entries(patch)) {
    const current = base[key as keyof GenerationParams]
    if (current !== value) changes.push(`${key}: ${current} -> ${value}`)
  }
  return changes
}

function tagKey(tag: string): string {
  return cleanPromptTokenForMatch(tag).replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
}

function compactModelName(title: string | null): string {
  if (!title) return 'none'
  return title.replace(/\s+\[[^\]]+\]$/, '').replace(/\.(?:safetensors|ckpt|pt)$/i, '')
}
