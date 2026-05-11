import type {
  SdModel,
  SdSampler,
  SdVae,
  Txt2ImgRequest,
  Txt2ImgResponse,
  Img2ImgRequest,
  Img2ImgResponse,
  GenerationProgress,
  InterrogateResult,
  ControlNetDetectRequest,
  ControlNetDetectResult
} from '../src/shared/types.js'

/**
 * Thin REST client for Forge's A1111-compatible API.
 * Lives in main process so credentials/tokens are never exposed to renderer.
 */
export class ForgeApi {
  constructor(private baseUrl: string) {}

  setBaseUrl(url: string): void {
    this.baseUrl = url
  }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const r = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers
      }
    })
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      // Print the full body to the main-process console so we can read
      // the stacktrace Forge attached, then surface a truncated message
      // back to the renderer (UI strings stay readable).
      console.error(`[forge-api] ${path} ${r.status}:`, text)
      throw new Error(`Forge API ${path} failed: ${r.status} ${text.slice(0, 500)}`)
    }
    return r.json() as Promise<T>
  }

  async listModels(): Promise<SdModel[]> {
    type Raw = {
      title: string
      model_name: string
      filename: string
      hash: string | null
      sha256: string | null
    }
    const raw = await this.req<Raw[]>('/sdapi/v1/sd-models')
    return raw.map((m) => ({
      title: m.title,
      modelName: m.model_name,
      filename: m.filename,
      hash: m.hash,
      sha256: m.sha256
    }))
  }

  async refreshModels(): Promise<void> {
    await this.req<unknown>('/sdapi/v1/refresh-checkpoints', { method: 'POST' })
  }

  /**
   * ControlNet model + preprocessor list. The endpoints are mounted by the
   * sd_forge_controlnet extension, so they require Forge's `--api` flag and
   * the extension to have loaded successfully. We swallow errors and return
   * empty lists so the renderer can render a "no models" empty state rather
   * than crashing.
   */
  async listControlnetModels(): Promise<string[]> {
    type Resp = { model_list: string[] }
    try {
      const r = await this.req<Resp>('/controlnet/model_list')
      return r.model_list ?? []
    } catch {
      return []
    }
  }

  async listControlnetModules(): Promise<string[]> {
    type Resp = { module_list: string[] }
    try {
      const r = await this.req<Resp>('/controlnet/module_list')
      return r.module_list ?? []
    } catch {
      return []
    }
  }

  async controlnetDetect(opts: ControlNetDetectRequest): Promise<ControlNetDetectResult> {
    type Resp = { images?: string[]; info?: string }
    const image = opts.image.replace(/^data:image\/[a-z]+;base64,/, '')
    const module = opts.module || 'None'
    if (module === 'None') {
      return { image: opts.image.startsWith('data:') ? opts.image : `data:image/png;base64,${image}`, module }
    }
    const r = await this.req<Resp>('/controlnet/detect', {
      method: 'POST',
      body: JSON.stringify({
        controlnet_module: module,
        controlnet_input_images: [image],
        controlnet_processor_res: opts.processorRes,
        controlnet_threshold_a: opts.thresholdA,
        controlnet_threshold_b: opts.thresholdB,
        controlnet_resize_mode: opts.resizeMode
      })
    })
    const first = r.images?.[0]
    if (!first) throw new Error('ControlNet preprocessor returned no image')
    return {
      image: first.startsWith('data:') ? first : `data:image/png;base64,${first}`,
      module
    }
  }

  /**
   * Installed upscalers (built-in: Lanczos / Nearest / ESRGAN_4x / R-ESRGAN /
   * SwinIR + any user-dropped .pth in webui/models/ESRGAN/). Used by the
   * Upscale tab. Forge exposes this via /sdapi/v1/upscalers.
   */
  async listUpscalers(): Promise<string[]> {
    type Raw = { name: string; model_name?: string }
    try {
      const r = await this.req<Raw[]>('/sdapi/v1/upscalers')
      return r.map((u) => u.name)
    } catch {
      return ['None', 'Lanczos', 'Nearest']
    }
  }

  /**
   * Simple (non-diffusion) upscale via /sdapi/v1/extra-single-image.
   *
   * @param image base64 PNG WITHOUT the data: prefix
   * @param upscaler primary upscaler name
   * @param resize multiplier (e.g. 2 = 2× output)
   */
  async extraSingleImage(opts: {
    image: string
    upscaler: string
    resize: number
    /** Optional second upscaler for blended output. "None" disables. */
    upscaler2?: string
    /** 0..1 — visibility of the second upscaler in the blend. */
    upscaler2Visibility?: number
  }): Promise<{ image: string }> {
    type Resp = { image: string }
    const r = await this.req<Resp>('/sdapi/v1/extra-single-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: opts.image,
        resize_mode: 0,                 // multiplier mode (vs target dimensions)
        upscaling_resize: opts.resize,
        upscaler_1: opts.upscaler,
        upscaler_2: opts.upscaler2 ?? 'None',
        extras_upscaler_2_visibility: opts.upscaler2Visibility ?? 0,
        // Must be true — Forge's run_postprocessing only appends the result
        // image to the response when this is set (or when extras_mode != 2,
        // which it is for single-image, so technically true here either way,
        // but keeping it explicit avoids ambiguity if future changes affect
        // the conditional).
        show_extras_results: true,
        upscale_first: false
      })
    })
    return { image: r.image }
  }

  async listVaes(): Promise<SdVae[]> {
    type Raw = { model_name: string; filename: string }
    // Forge renames A1111's /sdapi/v1/sd-vae to /sdapi/v1/sd-modules — the
    // operationId is "Get Sd Vaes And Text Encoders" so it includes both VAE
    // files and (for Flux/SD3) text-encoder modules. We pass them through
    // verbatim; the user picks whichever entry matches their model's needs.
    //
    // We prepend "Automatic" and "None" so the user can fall back to the
    // checkpoint's built-in VAE without leaving the dropdown.
    let raw: Raw[] = []
    try {
      raw = await this.req<Raw[]>('/sdapi/v1/sd-modules')
    } catch {
      // Fallback for older Forge that exposed /sdapi/v1/sd-vae instead.
      try {
        raw = await this.req<Raw[]>('/sdapi/v1/sd-vae')
      } catch { /* swallow */ }
    }
    return [
      { modelName: 'Automatic', filename: '' },
      { modelName: 'None', filename: '' },
      ...raw.map((v) => ({ modelName: v.model_name, filename: v.filename }))
    ]
  }

  async refreshVaes(): Promise<void> {
    try {
      await this.req<unknown>('/sdapi/v1/refresh-vae', { method: 'POST' })
    } catch {
      // Endpoint may not exist on older builds — silent fallback.
    }
  }

  async listSamplers(): Promise<SdSampler[]> {
    type Raw = { name: string; aliases: string[]; options: Record<string, unknown> }
    const raw = await this.req<Raw[]>('/sdapi/v1/samplers')
    return raw.map((s) => ({ name: s.name, aliases: s.aliases }))
  }

  async listSchedulers(): Promise<string[]> {
    try {
      type Raw = { name: string; label: string }
      const raw = await this.req<Raw[]>('/sdapi/v1/schedulers')
      return raw.map((s) => s.name)
    } catch {
      // Older Forge builds don't expose schedulers separately.
      return []
    }
  }

  async getCurrentModel(): Promise<string | null> {
    type Options = { sd_model_checkpoint?: string }
    const opt = await this.req<Options>('/sdapi/v1/options')
    return opt.sd_model_checkpoint ?? null
  }

  async setCurrentModel(modelTitle: string): Promise<void> {
    await this.req<unknown>('/sdapi/v1/options', {
      method: 'POST',
      body: JSON.stringify({ sd_model_checkpoint: modelTitle })
    })
  }

  async txt2img(req: Txt2ImgRequest): Promise<Txt2ImgResponse> {
    return this.req<Txt2ImgResponse>('/sdapi/v1/txt2img', {
      method: 'POST',
      body: JSON.stringify(req)
    })
  }

  async img2img(req: Img2ImgRequest): Promise<Img2ImgResponse> {
    return this.req<Img2ImgResponse>('/sdapi/v1/img2img', {
      method: 'POST',
      body: JSON.stringify(req)
    })
  }

  /**
   * Image → tags via Forge's built-in interrogator. `deepdanbooru` returns
   * comma-separated booru-style tags ("1girl, smile, blue eyes"); `clip`
   * returns a natural-language caption ("a portrait of a woman smiling").
   * We normalize both into a tags[] array for the renderer.
   */
  async interrogate(
    imageBase64: string,
    model: 'clip' | 'deepdanbooru' = 'deepdanbooru'
  ): Promise<InterrogateResult> {
    const cleaned = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '')
    type Resp = { caption: string }
    const r = await this.req<Resp>('/sdapi/v1/interrogate', {
      method: 'POST',
      body: JSON.stringify({ image: cleaned, model })
    })
    const tags =
      model === 'deepdanbooru'
        ? r.caption.split(',').map((t) => t.trim()).filter(Boolean)
        : [r.caption.trim()]
    return { caption: r.caption, tags, model }
  }

  async progress(): Promise<GenerationProgress> {
    return this.req<GenerationProgress>('/sdapi/v1/progress?skip_current_image=false')
  }

  async interrupt(): Promise<void> {
    await this.req<unknown>('/sdapi/v1/interrupt', { method: 'POST' })
  }

  async ping(): Promise<boolean> {
    try {
      await this.req<unknown>('/sdapi/v1/options')
      return true
    } catch {
      return false
    }
  }

  /**
   * Tune Forge's live-preview cadence.
   *
   * Forge's default `show_progress_every_n_steps=10` means a 25-step generation
   * only shows 2 previews — feels janky. We set it to 5 (preview every 5 steps)
   * which is a good visual/perf balance for the user's RTX 4060 Ti.
   */
  async configureLivePreviews(): Promise<void> {
    await this.req<unknown>('/sdapi/v1/options', {
      method: 'POST',
      body: JSON.stringify({
        live_previews_enable: true,
        show_progress_every_n_steps: 5,
        live_preview_content: 'Combined',
        live_preview_refresh_period: 500
      })
    })
  }
}
