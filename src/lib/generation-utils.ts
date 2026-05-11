import type { Img2ImgRequest, Txt2ImgRequest } from '@shared/types'
import {
  buildPromptWithLoras,
  stripLoraTokens
} from './lora-suggest'
import { buildAlwaysOnScripts } from './extension-payload'
import type { AppState, GenerationParams, WorkspaceTab } from './store'

export interface GenerationPlan {
  endpoint: Extract<WorkspaceTab, 'txt2img' | 'img2img'>
  model: string
  strippedPrompt: string
  finalPrompt: string
  params: GenerationParams
  baseReq: Txt2ImgRequest
}

export function buildGenerationPlan(
  state: AppState,
  opts?: {
    endpoint?: Extract<WorkspaceTab, 'txt2img' | 'img2img'>
    params?: Partial<GenerationParams>
  }
): GenerationPlan | null {
  const model = state.selectedModelTitle
  if (!model) return null

  const endpoint = opts?.endpoint ?? (
    state.currentTab === 'img2img' ? 'img2img' : 'txt2img'
  )
  const params = { ...state.params, ...opts?.params }
  const stripped = stripLoraTokens(state.prompt)
  const finalPrompt = buildPromptWithLoras(
    stripped.prompt,
    state.activeLoras.map((a) => ({ name: a.name, weight: a.weight }))
  )

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
    negative_prompt: state.negativePrompt,
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
