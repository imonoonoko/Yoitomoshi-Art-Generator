import type { Img2ImgRequest, Txt2ImgRequest } from '@shared/types'
import {
  buildPromptWithLoras,
  stripLoraTokens
} from './lora-suggest'
import { buildAlwaysOnScripts } from './extension-payload'
import { normalizeGenerationParams } from './store'
import type { AppState, GenerationParams, WorkspaceTab } from './store'
import {
  buildDynamicPromptContext,
  hasDynamicPromptSyntax,
  randomPromptSeed,
  resolveDynamicPrompt,
  type DynamicPromptIssue,
  type DynamicPromptMeta
} from './dynamic-prompts'

export interface GenerationPlan {
  endpoint: Extract<WorkspaceTab, 'txt2img' | 'img2img'>
  model: string
  strippedPrompt: string
  finalPrompt: string
  dynamicPrompt: DynamicPromptMeta | null
  dynamicPromptIssues: DynamicPromptIssue[]
  params: GenerationParams
  baseReq: Txt2ImgRequest
}

export function buildGenerationPlan(
  state: AppState,
  opts?: {
    endpoint?: Extract<WorkspaceTab, 'txt2img' | 'img2img'>
    params?: Partial<GenerationParams>
    prompt?: string
    negativePrompt?: string
    dynamicPromptSeed?: number
  }
): GenerationPlan | null {
  const model = state.selectedModelTitle
  if (!model) return null

  const endpoint = opts?.endpoint ?? (
    state.currentTab === 'img2img' ? 'img2img' : 'txt2img'
  )
  const params = normalizeGenerationParams({ ...state.params, ...opts?.params }, state.params)
  const templatePrompt = opts?.prompt ?? state.prompt
  const templateNegativePrompt = opts?.negativePrompt ?? state.negativePrompt
  const hasDynamic = hasDynamicPromptSyntax(templatePrompt) || hasDynamicPromptSyntax(templateNegativePrompt)
  const promptSeed = opts?.dynamicPromptSeed ?? (hasDynamic
    ? params.seed >= 0 ? params.seed : randomPromptSeed()
    : 0)
  const dynamicContext = buildDynamicPromptContext({
    library: state.library,
    customLibrary: state.customLibrary,
    history: state.history,
    recentTags: state.recentTags,
    favorites: state.favorites
  })
  const resolvedPrompt = hasDynamic
    ? resolveDynamicPrompt(templatePrompt, dynamicContext, promptSeed)
    : null
  const resolvedNegativePrompt = hasDynamic
    ? resolveDynamicPrompt(templateNegativePrompt, dynamicContext, promptSeed + 1)
    : null
  const promptForRequest = resolvedPrompt?.prompt ?? templatePrompt
  const negativePromptForRequest = resolvedNegativePrompt?.prompt ?? templateNegativePrompt
  const stripped = stripLoraTokens(promptForRequest)
  const finalPrompt = buildPromptWithLoras(
    stripped.prompt,
    state.activeLoras.map((a) => ({ name: a.name, tokenName: a.tokenName, weight: a.weight }))
  )
  const dynamicPrompt: DynamicPromptMeta | null = hasDynamic
    ? {
        templatePrompt,
        templateNegativePrompt,
        resolvedPrompt: finalPrompt,
        resolvedNegativePrompt: negativePromptForRequest,
        promptSeed,
        usedWildcards: Array.from(new Set([
          ...(resolvedPrompt?.usedWildcards ?? []),
          ...(resolvedNegativePrompt?.usedWildcards ?? [])
        ])).sort((a, b) => a.localeCompare(b))
      }
    : null
  const dynamicPromptIssues = [
    ...(resolvedPrompt?.issues ?? []),
    ...(resolvedNegativePrompt?.issues ?? [])
  ]

  const overrides: Record<string, string | number> = {
    sd_model_checkpoint: model,
    CLIP_stop_at_last_layers: params.clipSkip
  }
  if (state.selectedVae && state.selectedVae !== 'Automatic') {
    overrides.sd_vae = state.selectedVae
  }

  const alwayson = buildAlwaysOnScripts(state)
  const baseReq: Txt2ImgRequest = {
    prompt: finalPrompt,
    negative_prompt: negativePromptForRequest,
    steps: params.steps,
    cfg_scale: params.cfgScale,
    width: params.width,
    height: params.height,
    sampler_name: params.sampler,
    scheduler: params.scheduler || undefined,
    seed: params.seed,
    batch_size: params.batchSize,
    n_iter: params.iterations,
    override_settings: overrides,
    override_settings_restore_afterwards: false,
    ...(alwayson ? { alwayson_scripts: alwayson } : {})
  }

  return {
    endpoint,
    model,
    strippedPrompt: stripped.prompt,
    finalPrompt,
    dynamicPrompt,
    dynamicPromptIssues,
    params,
    baseReq
  }
}

export function buildImg2ImgRequest(
  plan: GenerationPlan,
  inputImage: string,
  denoisingStrength = plan.params.denoisingStrength,
  maskImage?: string | null
): Img2ImgRequest {
  return {
    ...plan.baseReq,
    init_images: [stripImageDataUrl(inputImage)],
    denoising_strength: denoisingStrength,
    resize_mode: 1,
    ...(maskImage
      ? {
          mask: stripImageDataUrl(maskImage),
          inpainting_fill: 1,
          mask_blur: 8
        }
      : {})
  }
}

export function imageDataUrlFromPngBase64(pngBase64: string): string {
  return `data:image/png;base64,${pngBase64}`
}

export function stripImageDataUrl(image: string): string {
  return image.replace(/^data:image\/[a-z]+;base64,/, '')
}

export function generatedSeedFromInfo(
  info: string,
  imageIndex: number,
  fallbackSeed: number
): number {
  try {
    const parsed = JSON.parse(info) as {
      seed?: unknown
      all_seeds?: unknown
    }
    const raw = Array.isArray(parsed.all_seeds)
      ? parsed.all_seeds[imageIndex]
      : parsed.seed
    const n = typeof raw === 'number' ? raw : Number(raw)
    return Number.isFinite(n) ? Math.trunc(n) : fallbackSeed
  } catch {
    return fallbackSeed
  }
}

/**
 * Down-sample an image data URL into a small JPEG for history thumbnails.
 */
export async function makeThumbnail(dataUrl: string, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const ratio = Math.min(maxSize / img.width, maxSize / img.height, 1)
      const w = Math.round(img.width * ratio)
      const h = Math.round(img.height * ratio)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', 0.78))
    }
    img.onerror = reject
    img.src = dataUrl
  })
}
