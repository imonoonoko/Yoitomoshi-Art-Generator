import { useEffect, useRef, useState } from 'react'
import { Upload, X, Wand2, Download, Send, Sparkles, GitCompare, History } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore, type UpscaleState } from '@/lib/store'
import { useT, t as tStatic } from '@/lib/i18n'
import { api } from '@/lib/ipc'
import { buildAlwaysOnScripts } from '@/lib/extension-payload'
import { makeThumbnail } from '@/lib/generation-utils'
import { suggestUpscaleSettings, applyUpscaleSuggestion, type UpscaleSuggestion, type Genre, type UpscaleMetadata } from '@/lib/upscale-suggest'
import { Slider, SelectField } from './extensions/controls'
import { PromptEditor } from './PromptEditor'
import { cn } from '@/lib/utils'
import type { HistoryProRecipeReview, UpscaleComparisonCandidate } from '@shared/types'

const DEFAULT_COMPARE_CRITERIA = [
  'drift: 顔、髪型、服の形、手足、背景の主要配置が入力から別解釈になっていないか。',
  'seam: タイル境界に線、明度差、柄のズレ、顔や手の切断が出ていないか。',
  'detail: 低denoiseで眠い質感にならず、高denoiseで描き換わりすぎていないか。',
  '採用目安: drift/seamが最小で、元絵のシルエットを保つ候補を優先する。'
].join('\n')

const FINISH_ISSUE_ITEMS = [
  { id: 'face', labelKey: 'upscale.finish.face', issueKey: 'upscale.finish.issue.face' },
  { id: 'clothing', labelKey: 'upscale.finish.clothing', issueKey: 'upscale.finish.issue.clothing' },
  { id: 'line', labelKey: 'upscale.finish.line', issueKey: 'upscale.finish.issue.line' },
  { id: 'seam', labelKey: 'upscale.finish.seam', issueKey: 'upscale.finish.issue.seam' },
  { id: 'detail', labelKey: 'upscale.finish.detail', issueKey: 'upscale.finish.issue.detail' }
] as const

type FinishIssueId = typeof FINISH_ISSUE_ITEMS[number]['id']
type FinishIssueFlags = Record<FinishIssueId, boolean>

const DEFAULT_FINISH_ISSUES: FinishIssueFlags = {
  face: false,
  clothing: false,
  line: false,
  seam: false,
  detail: false
}

/**
 * Upscale tab — a one-screen workflow for enlarging an image. Two paths:
 *
 *   Simple   /sdapi/v1/extra-single-image — fast, pure neural upscaler.
 *            R-ESRGAN / SwinIR / etc. No diffusion, no detail synthesis.
 *
 *   Diffusion  img2img + MultiDiffusion alwayson_scripts. Slow but adds
 *              coherent detail at high resolution by tiling the diffusion
 *              process. Runs the prompt + denoise from the active main
 *              prompt panel — the user typically wants the same prompt
 *              that produced the source image, so we read directly from
 *              the global prompt state.
 *
 * Result is shown inline. The user can save it (downloads as PNG), send it
 * back to img2img for further editing, or feed it into another upscale pass.
 */
export function UpscaleWorkspace(): JSX.Element {
  const u = useStore((s) => s.upscale)
  const status = useStore((s) => s.forgeStatus)
  const upscalers = useStore((s) => s.upscalerList)
  const controlnetModels = useStore((s) => s.controlnetModelList)
  const controlnetModules = useStore((s) => s.controlnetModuleList)
  const setUpscalerList = useStore((s) => s.setUpscalerList)
  const setControlnetCatalogs = useStore((s) => s.setControlnetCatalogs)
  const patch = useStore((s) => s.patchUpscale)
  const openCivitaiSearch = useStore((s) => s.openCivitaiSearch)
  const setInputImage = useStore((s) => s.setInputImage)
  const setCurrentTab = useStore((s) => s.setCurrentTab)
  // Reuse the main prompt store fields here. The Diffusion / Ultimate paths
  // already pass `state.prompt` + `state.negativePrompt` through to img2img,
  // so editing here is exactly equivalent to editing in the txt2img tab —
  // saves the user from switching tabs to tweak a prompt for upscale.
  const prompt = useStore((s) => s.prompt)
  const negative = useStore((s) => s.negativePrompt)
  const setPrompt = useStore((s) => s.setPrompt)
  const setNegative = useStore((s) => s.setNegativePrompt)
  const t = useT()

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // Metadata-driven suggestion: when an input image is set, peek its PNG /
  // EXIF metadata + dimensions and propose method/upscaler/scale that suit
  // the source. The user can apply with one click, or ignore and use their
  // current settings.
  const [suggestion, setSuggestion] = useState<UpscaleSuggestion | null>(null)
  // Cached extracted metadata + dimensions so the genre-override toggle can
  // re-run `suggestUpscaleSettings` without re-extracting from the image.
  const [analyzed, setAnalyzed] = useState<UpscaleMetadata | null>(null)
  // Track which input we already suggested for, so re-renders don't
  // re-run extraction repeatedly.
  const [analyzedFor, setAnalyzedFor] = useState<string | null>(null)
  // User's genre override. `null` = use auto-detected. Persists per-input
  // so dismissing + re-toggling works as expected.
  const [forcedGenre, setForcedGenre] = useState<Genre | null>(null)
  const [compareBusy, setCompareBusy] = useState(false)
  const [compareSaving, setCompareSaving] = useState(false)
  const [compareCriteria, setCompareCriteria] = useState(DEFAULT_COMPARE_CRITERIA)
  const [compareCandidates, setCompareCandidates] = useState<UpscaleComparisonCandidate[]>([])
  const [historySaving, setHistorySaving] = useState(false)
  const [finishIssues, setFinishIssues] = useState<FinishIssueFlags>(DEFAULT_FINISH_ISSUES)
  const [finishMemo, setFinishMemo] = useState('')
  const [adoptedCandidateKey, setAdoptedCandidateKey] = useState<string | null>(null)

  useEffect(() => {
    if (status.kind !== 'ready') return
    let cancelled = false
    ;(async () => {
      if (upscalers.length === 0) {
        const nextUpscalers = await api.forge.listUpscalers().catch(() => [] as string[])
        if (!cancelled) {
          setUpscalerList(nextUpscalers)
          const TRIVIAL_UPSCALERS = new Set(['None', 'Lanczos', 'Nearest'])
          const currentUpscaler = useStore.getState().upscale.upscaler
          if (nextUpscalers.length > 0 && !nextUpscalers.includes(currentUpscaler)) {
            const better = nextUpscalers.find((name) => !TRIVIAL_UPSCALERS.has(name)) ?? nextUpscalers[0]
            useStore.getState().patchUpscale({ upscaler: better })
          }
        }
      }

      if (controlnetModels.length === 0 || controlnetModules.length === 0) {
        const [models, modules] = await Promise.all([
          fetchOptionalCatalog(() => api.forge.listControlnetModels(), [] as string[]),
          fetchOptionalCatalog(() => api.forge.listControlnetModules(), [] as string[])
        ])
        if (!cancelled) setControlnetCatalogs(models, modules)
      }
    })().catch(() => undefined)
    return () => { cancelled = true }
  }, [
    status.kind,
    upscalers.length,
    controlnetModels.length,
    controlnetModules.length,
    setUpscalerList,
    setControlnetCatalogs
  ])

  function readFile(file: File): void {
    if (!file.type.startsWith('image/')) {
      toast.error(t('upscale.notAnImage'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => patch({
      inputImage: reader.result as string,
      inputFilename: file.name,
      inputImagePath: filePathOf(file),
      inputHistoryId: null
    })
    reader.readAsDataURL(file)
  }

  // Analyze metadata whenever the input image changes.
  useEffect(() => {
    if (!u.inputImage || u.inputImage === analyzedFor) return
    let cancelled = false
    ;(async () => {
      try {
        const dims = await imageDimensions(u.inputImage!)
        // Try to extract A1111-style metadata. Best-effort: many images have
        // none (CDN-stripped), in which case we suggest from dimensions alone.
        let prompt: string | undefined
        let modelName: string | null | undefined
        try {
          const bytes = dataUrlToBytes(u.inputImage!)
          const file = new File([new Uint8Array(bytes)], u.inputFilename || 'input.png', { type: 'image/png' })
          const { extractPngMetadata } = await import('@/lib/png-metadata')
          const meta = await extractPngMetadata(file)
          if (meta) {
            prompt = meta.prompt
            modelName = meta.model ?? null
          }
        } catch {
          /* metadata extraction failed — fall through to dimensions-only suggestion */
        }
        if (cancelled) return
        const md: UpscaleMetadata = { prompt, modelName, width: dims.width, height: dims.height }
        setAnalyzed(md)
        setForcedGenre(null) // reset override when input changes
        const s = suggestUpscaleSettings(md, upscalers)
        setSuggestion(s)
        setAnalyzedFor(u.inputImage!)
      } catch {
        if (!cancelled) {
          setSuggestion(null)
          setAnalyzed(null)
        }
      }
    })()
    return () => { cancelled = true }
  }, [u.inputImage, u.inputFilename, upscalers, analyzedFor])

  // Recompute when the user changes the genre override.
  useEffect(() => {
    if (!analyzed) return
    const s = suggestUpscaleSettings(analyzed, upscalers, forcedGenre ?? undefined)
    setSuggestion(s)
  }, [forcedGenre, analyzed, upscalers])

  // Keep Tile ControlNet defaults aligned with the live Forge catalog. This
  // only auto-fills empty/invalid choices; once a user deliberately picks a
  // model or module, we leave it alone.
  useEffect(() => {
    const nextModel = chooseTileControlNetModel(controlnetModels, u.tileControlNetModel)
    const nextModule = chooseTileControlNetModule(controlnetModules, u.tileControlNetModule)
    const next: Partial<typeof u> = {}
    if (nextModel !== u.tileControlNetModel) next.tileControlNetModel = nextModel
    if (nextModule !== u.tileControlNetModule) next.tileControlNetModule = nextModule
    if (Object.keys(next).length > 0) patch(next)
  }, [controlnetModels, controlnetModules, u.tileControlNetModel, u.tileControlNetModule, patch])

  function applySuggestion(): void {
    if (!suggestion) return
    patch(applyUpscaleSuggestion(suggestion))
    toast.success(t('upscale.suggest.applied'))
  }

  function dismissSuggestion(): void {
    setSuggestion(null)
  }

  function setFinishIssue(id: FinishIssueId, checked: boolean): void {
    setFinishIssues((current) => ({ ...current, [id]: checked }))
  }

  function adoptCandidate(candidate: UpscaleComparisonCandidate): void {
    patch({
      outputImage: candidate.imageDataUrl,
      denoise: candidate.denoise,
      tileControlNetEnabled: candidate.tileControlNetEnabled
    })
    setAdoptedCandidateKey(upscaleCandidateKey(candidate))
  }

  async function runUpscale(): Promise<void> {
    if (!u.inputImage) {
      toast.error(t('upscale.needInput'))
      return
    }
    if (u.method !== 'simple' && u.tileControlNetEnabled && u.tileControlNetModel === 'None') {
      toast.error(t('upscale.tileControlNet.needModel'))
      return
    }
    patch({ isRunning: true, outputImage: null })
    setAdoptedCandidateKey(null)
    try {
      const qaMockOutput = readUpscaleQaMockOutput()
      if (qaMockOutput) {
        patch({ outputImage: qaMockOutput })
        setAdoptedCandidateKey(null)
        toast.success(t('upscale.done'))
        return
      }
      if (u.method === 'simple') {
        const raw = u.inputImage.replace(/^data:image\/[a-z]+;base64,/, '')
        const r = await api.forge.extraSingleImage({
          image: raw,
          upscaler: u.upscaler,
          resize: u.scale,
          upscaler2: u.upscaler2 === 'None' ? undefined : u.upscaler2,
          upscaler2Visibility: u.upscaler2Visibility
        })
        // Defensive: Forge silently falls back to "None" upscaler on unknown
        // names (linear stretch only) and `extra-single-image` can also
        // return an empty image field. Surface both as explicit failures
        // instead of showing a broken <img>.
        if (!r.image) {
          toast.error(t('upscale.noOutput'))
          return
        }
        patch({ outputImage: `data:image/png;base64,${r.image}` })
        setAdoptedCandidateKey(null)
        toast.success(t('upscale.done'))
      } else if (u.method === 'diffusion') {
        // Diffusion path: img2img with MultiDiffusion alwayson. We size the
        // output as input × scale, but Forge picks up the actual dimensions
        // from the request — multidiffusion tiles internally so we don't have
        // to subdivide ourselves.
        const dims = await imageDimensions(u.inputImage)
        const targetW = Math.round(dims.width * u.scale)
        const targetH = Math.round(dims.height * u.scale)
        const state = useStore.getState()
        const overrides: Record<string, string | number> = {}
        if (state.selectedModelTitle) overrides.sd_model_checkpoint = state.selectedModelTitle
        if (state.selectedVae && state.selectedVae !== 'Automatic') overrides.sd_vae = state.selectedVae
        const alwayson = buildAlwaysOnScripts(state, { forUpscaleDiffusion: true })

        const raw = u.inputImage.replace(/^data:image\/[a-z]+;base64,/, '')
        const res = await api.forge.img2img({
          prompt: state.prompt,
          negative_prompt: state.negativePrompt,
          steps: state.params.steps,
          cfg_scale: state.params.cfgScale,
          width: targetW,
          height: targetH,
          sampler_name: state.params.sampler,
          scheduler: state.params.scheduler || undefined,
          seed: state.params.seed,
          batch_size: 1,
          n_iter: 1,
          init_images: [raw],
          denoising_strength: u.denoise,
          resize_mode: 0, // Just Resize — multidiffusion tiles, we want the requested target dims exactly
          override_settings: overrides,
          override_settings_restore_afterwards: false,
          ...(alwayson ? { alwayson_scripts: alwayson } : {})
        })
        const first = res.images[0]
        if (first) {
          patch({ outputImage: `data:image/png;base64,${first}` })
          setAdoptedCandidateKey(null)
          toast.success(t('upscale.done'))
        } else {
          toast.error(t('upscale.noOutput'))
        }
      } else {
        // Ultimate SD upscale path: img2img with the selectable script
        // "Ultimate SD upscale". Unlike alwayson, this routes the entire
        // pipeline through the script — width/height in the request matter
        // less because the script uses its own `target_size_type` + scale.
        // We pin target_size_type = 2 ("Scale from image size") so the
        // scale slider drives output dims directly.
        const state = useStore.getState()
        const overrides: Record<string, string | number> = {}
        if (state.selectedModelTitle) overrides.sd_model_checkpoint = state.selectedModelTitle
        if (state.selectedVae && state.selectedVae !== 'Automatic') overrides.sd_vae = state.selectedVae
        const alwayson = buildAlwaysOnScripts(state, { forUpscaleUltimate: true })

        // upscaler_index is an integer index into Forge's `shared.sd_upscalers`.
        // Our `upscalers` list mirrors that order (it was fetched from the
        // same endpoint). Fall back to 0 (= None) if the user's selection
        // isn't in the catalog — but the trivial-upscaler warning UI should
        // have caught that case already.
        const upscalerIndex = upscalers.indexOf(u.upscaler) >= 0
          ? upscalers.indexOf(u.upscaler)
          : 0

        // Args list mirrors the script's `ui()` return order exactly:
        //   [info, tile_w, tile_h, mask_blur, padding, seams_fix_width,
        //    seams_fix_denoise, seams_fix_padding, upscaler_index,
        //    save_upscaled_image, redraw_mode, save_seams_fix_image,
        //    seams_fix_mask_blur, seams_fix_type, target_size_type,
        //    custom_width, custom_height, custom_scale]
        //
        // seams_fix_type is critical for content-drift between tiles: type 3
        // ("Half tile offset pass + intersections") runs an extra denoise
        // pass over the seam regions which fixes the "different character
        // top vs bottom" problem we used to hit at higher denoise.
        const scriptArgs: unknown[] = [
          null,                  // info (HTML, no input)
          u.ultimateTileWidth,
          u.ultimateTileHeight,
          u.ultimateMaskBlur,
          u.ultimatePadding,
          64,                    // seams_fix_width
          0.35,                  // seams_fix_denoise
          16,                    // seams_fix_padding
          upscalerIndex,
          true,                  // save_upscaled_image
          u.ultimateRedrawMode,
          false,                 // save_seams_fix_image
          4,                     // seams_fix_mask_blur
          u.ultimateSeamsFixType,
          2,                     // target_size_type = 2 = "Scale from image size"
          2048,                  // custom_width (unused when target_size_type = 2)
          2048,                  // custom_height (unused)
          u.scale                // custom_scale — drives output dims
        ]

        const raw = u.inputImage.replace(/^data:image\/[a-z]+;base64,/, '')
        const res = await api.forge.img2img({
          prompt: state.prompt,
          negative_prompt: state.negativePrompt,
          steps: state.params.steps,
          cfg_scale: state.params.cfgScale,
          // width/height matter less but must be valid; the script overrides.
          width: state.params.width,
          height: state.params.height,
          sampler_name: state.params.sampler,
          scheduler: state.params.scheduler || undefined,
          seed: state.params.seed,
          batch_size: 1,
          n_iter: 1,
          init_images: [raw],
          denoising_strength: u.denoise,
          resize_mode: 0,
          override_settings: overrides,
          override_settings_restore_afterwards: false,
          script_name: 'Ultimate SD upscale',
          script_args: scriptArgs,
          ...(alwayson ? { alwayson_scripts: alwayson } : {})
        })
        const first = res.images[0]
        if (first) {
          patch({ outputImage: `data:image/png;base64,${first}` })
          setAdoptedCandidateKey(null)
          toast.success(t('upscale.done'))
        } else {
          toast.error(t('upscale.noOutput'))
        }
      }
    } catch (e) {
      toast.error(tStatic('toast.generateFailed', { message: (e as Error).message }))
    } finally {
      patch({ isRunning: false })
    }
  }

  async function runDenoiseComparison(): Promise<void> {
    if (!u.inputImage) {
      toast.error(t('upscale.needInput'))
      return
    }
    if (u.method === 'simple') {
      toast.error(t('upscale.compareNeedsDiffusion'))
      return
    }
    setCompareBusy(true)
    setCompareCandidates([])
    setAdoptedCandidateKey(null)
    try {
      const denoises = [0.25, 0.35, 0.45]
      const tileStates = u.tileControlNetModel === 'None' ? [false] : [false, true]
      if (tileStates.length === 1) toast(t('upscale.compareTileModelMissing'), { icon: '!' })
      const out: UpscaleComparisonCandidate[] = []
      for (const tileControlNetEnabled of tileStates) {
        for (const denoise of denoises) {
          const imageDataUrl = await runUpscaleCandidate(denoise, tileControlNetEnabled)
          out.push(buildUpscaleComparisonCandidate(useStore.getState().upscale, denoise, tileControlNetEnabled, imageDataUrl))
          setCompareCandidates([...out])
        }
      }
      toast.success(tStatic('upscale.compareDone', { count: out.length }))
    } catch (e) {
      toast.error(tStatic('toast.generateFailed', { message: (e as Error).message }))
    } finally {
      setCompareBusy(false)
    }
  }

  async function saveComparison(): Promise<void> {
    if (compareSaving || compareCandidates.length === 0) return
    setCompareSaving(true)
    try {
      const result = await api.storage.saveUpscaleComparison({
        inputImageDataUrl: u.inputImage,
        inputFilename: u.inputFilename,
        method: u.method,
        scale: u.scale,
        criteria: compareCriteria,
        candidates: compareCandidates
      })
      toast.success(tStatic('upscale.compareSaved', { path: result.manifestPath }))
    } catch (e) {
      toast.error(tStatic('upscale.compareSaveFailed', { message: (e as Error).message }))
    } finally {
      setCompareSaving(false)
    }
  }

  async function runUpscaleCandidate(denoise: number, tileControlNetEnabled: boolean): Promise<string> {
    if (!u.inputImage) throw new Error('No input image')
    if (tileControlNetEnabled && u.tileControlNetModel === 'None') {
      throw new Error(t('upscale.tileControlNet.needModel'))
    }
    const state = useStore.getState()
    const stateForPayload = {
      ...state,
      upscale: {
        ...state.upscale,
        tileControlNetEnabled
      }
    }
    const overrides: Record<string, string | number> = {}
    if (state.selectedModelTitle) overrides.sd_model_checkpoint = state.selectedModelTitle
    if (state.selectedVae && state.selectedVae !== 'Automatic') overrides.sd_vae = state.selectedVae
    const raw = u.inputImage.replace(/^data:image\/[a-z]+;base64,/, '')

    if (u.method === 'diffusion') {
      const dims = await imageDimensions(u.inputImage)
      const alwayson = buildAlwaysOnScripts(stateForPayload, { forUpscaleDiffusion: true })
      const res = await api.forge.img2img({
        prompt: state.prompt,
        negative_prompt: state.negativePrompt,
        steps: state.params.steps,
        cfg_scale: state.params.cfgScale,
        width: Math.round(dims.width * u.scale),
        height: Math.round(dims.height * u.scale),
        sampler_name: state.params.sampler,
        scheduler: state.params.scheduler || undefined,
        seed: state.params.seed,
        batch_size: 1,
        n_iter: 1,
        init_images: [raw],
        denoising_strength: denoise,
        resize_mode: 0,
        override_settings: overrides,
        override_settings_restore_afterwards: false,
        ...(alwayson ? { alwayson_scripts: alwayson } : {})
      })
      const first = res.images[0]
      if (!first) throw new Error(t('upscale.noOutput'))
      return `data:image/png;base64,${first}`
    }

    const alwayson = buildAlwaysOnScripts(stateForPayload, { forUpscaleUltimate: true })
    const upscalerIndex = upscalers.indexOf(u.upscaler) >= 0 ? upscalers.indexOf(u.upscaler) : 0
    const scriptArgs: unknown[] = [
      null,
      u.ultimateTileWidth,
      u.ultimateTileHeight,
      u.ultimateMaskBlur,
      u.ultimatePadding,
      64,
      0.35,
      16,
      upscalerIndex,
      true,
      u.ultimateRedrawMode,
      false,
      4,
      u.ultimateSeamsFixType,
      2,
      2048,
      2048,
      u.scale
    ]
    const res = await api.forge.img2img({
      prompt: state.prompt,
      negative_prompt: state.negativePrompt,
      steps: state.params.steps,
      cfg_scale: state.params.cfgScale,
      width: state.params.width,
      height: state.params.height,
      sampler_name: state.params.sampler,
      scheduler: state.params.scheduler || undefined,
      seed: state.params.seed,
      batch_size: 1,
      n_iter: 1,
      init_images: [raw],
      denoising_strength: denoise,
      resize_mode: 0,
      override_settings: overrides,
      override_settings_restore_afterwards: false,
      script_name: 'Ultimate SD upscale',
      script_args: scriptArgs,
      ...(alwayson ? { alwayson_scripts: alwayson } : {})
    })
    const first = res.images[0]
    if (!first) throw new Error(t('upscale.noOutput'))
    return `data:image/png;base64,${first}`
  }

  async function saveOutputToHistory(): Promise<void> {
    if (!u.outputImage || historySaving) return
    setHistorySaving(true)
    try {
      const state = useStore.getState()
      const dims = await imageDimensions(u.outputImage)
      const adoptedCandidate = compareCandidates.find((candidate) => upscaleCandidateKey(candidate) === adoptedCandidateKey) ?? null
      const item = await api.storage.addHistory({
        pngBase64: dataUrlToBase64(u.outputImage),
        thumbDataUrl: await makeThumbnail(u.outputImage, 320),
        prompt: state.prompt,
        negativePrompt: state.negativePrompt,
        params: {
          steps: state.params.steps,
          cfgScale: state.params.cfgScale,
          width: dims.width,
          height: dims.height,
          sampler: state.params.sampler,
          scheduler: state.params.scheduler,
          seed: state.params.seed,
          batchSize: 1,
          imageIndex: 0,
          imageCount: 1,
          model: state.selectedModelTitle,
          vae: state.selectedVae,
          clipSkip: state.params.clipSkip,
          denoisingStrength: u.method === 'simple' ? undefined : u.denoise,
          activeLoras: state.activeLoras,
          upscale: {
            engine: 'forge',
            method: u.method,
            mode: null,
            scale: u.scale,
            upscaler: u.upscaler,
            outputWidth: dims.width,
            outputHeight: dims.height,
            tileWidth: u.method === 'simple' ? null : normalizeTileSize(u.method === 'ultimate' ? u.ultimateTileWidth : u.tileWidth, 512),
            tileHeight: u.method === 'simple' ? null : normalizeTileSize(u.method === 'ultimate' ? u.ultimateTileHeight || u.ultimateTileWidth : u.tileHeight, 512),
            tileOverlap: u.method === 'simple' ? null : normalizeTileOverlap(u.tileOverlap, u.method === 'ultimate' ? u.ultimateTileWidth || 512 : u.tileWidth, u.method === 'ultimate' ? u.ultimateTileHeight || u.ultimateTileWidth || 512 : u.tileHeight)
          }
        }
      })
      const updated = await api.storage.setHistoryProRecipeReview(
        item.id,
        buildUpscaleProRecipeReview(u, dims, finishIssues, finishMemo, adoptedCandidate)
      )
      if (!updated) throw new Error('Could not attach Pro Recipe review')
      useStore.getState().setHistory((await api.storage.listHistory()).slice(0, 500))
      toast.success(tStatic('upscale.savedToHistoryWithRecipe', { id: item.id.slice(0, 8) }))
    } catch (e) {
      toast.error(tStatic('upscale.historySaveFailed', { message: (e as Error).message }))
    } finally {
      setHistorySaving(false)
    }
  }

  function downloadOutput(): void {
    if (!u.outputImage) return
    const a = document.createElement('a')
    a.href = u.outputImage
    a.download = (u.inputFilename || 'upscaled')
      .replace(/\.[^.]+$/, '')
      .concat(`-x${u.scale}.png`)
    a.click()
  }

  function sendToImg2Img(): void {
    if (!u.outputImage) return
    setInputImage(u.outputImage, `upscaled-x${u.scale}.png`)
    setCurrentTab('img2img')
    toast.success(t('upscale.sentToImg2Img'))
  }

  function reuseAsInput(): void {
    if (!u.outputImage) return
    patch({ inputImage: u.outputImage, inputImagePath: null, inputHistoryId: null, outputImage: null })
  }

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      {/* Left controls panel */}
      <aside className="w-[380px] shrink-0 border-r border-line bg-bg-1 p-3 overflow-y-auto space-y-3">
        <h2 className="text-sm font-semibold text-ink-1">{t('upscale.title')}</h2>

        {/* Input image */}
        <div>
          <span className="label">{t('upscale.input')}</span>
          {u.inputImage ? (
            <div className="relative mt-1">
              <img
                src={u.inputImage}
                alt="upscale input"
                className="w-full max-h-48 object-contain rounded bg-bg-3"
              />
              <button
                type="button"
                className="absolute top-1 right-1 btn btn-icon btn-ghost bg-bg-1/80"
                onClick={() => patch({ inputImage: null, inputFilename: null, inputImagePath: null, inputHistoryId: null })}
                title={t('upscale.clearInput')}
                data-testid="upscale-clear-input"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <DropZone fileInputRef={fileInputRef} onFile={readFile} />
          )}
          {u.inputFilename && (
            <div className="text-[10px] text-ink-3 font-mono truncate mt-1">{u.inputFilename}</div>
          )}
        </div>

        {/* Metadata-driven suggestion banner.
            Shown whenever we have a usable suggestion. The genre toggle lets
            the user override our auto-detection when the prompt is in a
            language we don't catch (e.g. Japanese danbooru tags) or when
            they're upscaling an image without metadata at all.
            Dismissible. One-click apply. */}
        {suggestion && (
          <div className="card border-accent/50 bg-accent-dim/10 p-2 space-y-1.5 text-xs">
            <div className="flex items-start gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-accent shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-ink-1 font-medium leading-tight">
                  {t('upscale.suggest.title')}
                </div>
                <div className="text-[10px] text-ink-3 mt-0.5 leading-relaxed">
                  {t(suggestion.reasonKey, suggestion.reasonParams)}
                </div>
              </div>
              <button
                type="button"
                className="text-ink-3 hover:text-ink-1"
                onClick={dismissSuggestion}
                title={t('common.close')}
              >
                <X className="h-3 w-3" />
              </button>
            </div>

            {/* Genre override — Auto / Anime / Photo */}
            <div className="flex items-center gap-1 pl-5 text-[10px]">
              <span className="text-ink-3">{t('upscale.suggest.genre')}:</span>
              {(['auto', 'anime', 'photo'] as const).map((g) => {
                const active = (g === 'auto' && forcedGenre === null)
                  || (g !== 'auto' && forcedGenre === g)
                return (
                  <button
                    key={g}
                    type="button"
                    className={cn(
                      'px-1.5 py-0.5 rounded border text-[10px]',
                      active
                        ? 'border-accent bg-accent-dim/40 text-ink-0'
                        : 'border-line text-ink-2 hover:bg-bg-3'
                    )}
                    onClick={() => setForcedGenre(g === 'auto' ? null : g)}
                  >
                    {t(`upscale.suggest.genre.${g}`)}
                  </button>
                )
              })}
            </div>

            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] font-mono pl-5">
              <span className="text-ink-3">method <span className="text-ink-1">{suggestion.method}</span></span>
              <span className="text-ink-3">scale <span className="text-ink-1">×{suggestion.scale}</span></span>
              <span className="text-ink-3 col-span-2 truncate">upscaler <span className="text-ink-1">{suggestion.upscaler}</span></span>
              {suggestion.method !== 'simple' && (
                <span className="text-ink-3 col-span-2">
                  tile <span className="text-ink-1">{suggestion.tileWidth}×{suggestion.tileHeight}</span>
                  {' '}/ denoise <span className="text-ink-1">{suggestion.denoise.toFixed(2)}</span>
                </span>
              )}
            </div>
            <button
              className="btn btn-primary w-full text-[11px] py-1"
              onClick={applySuggestion}
            >
              {t('upscale.suggest.apply')}
            </button>
          </div>
        )}

        {/* Prompt fields — shared with txt2img / img2img store, so any edit
            here also affects the main prompt panel. Visible always so users
            can preview / tweak before switching to a diffusion-based method. */}
        <div className="space-y-1.5 border-t border-line pt-3">
          <span className="label">{t('prompt.label')}</span>
          <PromptEditor
            value={prompt}
            onChange={setPrompt}
            ariaLabel={t('prompt.label')}
            placeholder={t('prompt.placeholder')}
            rows={4}
          />
        </div>
        <div className="space-y-1.5">
          <span className="label">{t('prompt.negativeLabel')}</span>
          <PromptEditor
            value={negative}
            onChange={setNegative}
            tone="negative"
            ariaLabel={t('prompt.negativeLabel')}
            placeholder={t('prompt.negativePlaceholder')}
            rows={2}
          />
          <p className="text-[10px] text-ink-3 leading-relaxed">
            {t('upscale.promptSyncHint')}
          </p>
        </div>

        {/* Method tabs */}
        <div>
          <span className="label">{t('upscale.method')}</span>
          <div className="grid grid-cols-3 gap-1 mt-1">
            <MethodButton
              active={u.method === 'simple'}
              onClick={() => patch({ method: 'simple' })}
              label={t('upscale.simple')}
              hint={t('upscale.simpleHint')}
              testId="upscale-method-simple"
            />
            <MethodButton
              active={u.method === 'diffusion'}
              onClick={() => patch({ method: 'diffusion' })}
              label={t('upscale.diffusion')}
              hint={t('upscale.diffusionHint')}
              testId="upscale-method-diffusion"
            />
            <MethodButton
              active={u.method === 'ultimate'}
              onClick={() => patch({ method: 'ultimate' })}
              label={t('upscale.ultimate')}
              hint={t('upscale.ultimateHint')}
              testId="upscale-method-ultimate"
            />
          </div>
        </div>

        {/* Scale + upscaler */}
        <div className="grid grid-cols-2 gap-2">
          <ScalePresets value={u.scale} onChange={(v) => patch({ scale: v })} t={t} />
        </div>

        <SelectField
          label={t('upscale.upscaler')}
          value={u.upscaler}
          options={upscalers.length > 0 ? upscalers : [u.upscaler]}
          onChange={(v) => patch({ upscaler: v })}
        />
        {/* Warn the user when the selected upscaler is trivial — Forge will
            "complete" the request instantly with just a linear stretch, which
            looks worse than the source. Common pitfall when the dropdown
            defaulted to None because the previous default name didn't match
            the installed catalog. */}
        {(['None', 'Lanczos', 'Nearest'].includes(u.upscaler)) && (
          <p className="text-[10px] text-warn leading-relaxed -mt-1">
            {t('upscale.trivialUpscalerWarning')}
          </p>
        )}

        {u.method === 'simple' && (
          <>
            <SelectField
              label={t('upscale.upscaler2')}
              value={u.upscaler2}
              options={['None', ...upscalers.filter((x) => x !== u.upscaler)]}
              onChange={(v) => patch({ upscaler2: v })}
            />
            {u.upscaler2 !== 'None' && (
              <Slider
                label={t('upscale.upscaler2Visibility')}
                value={u.upscaler2Visibility}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => patch({ upscaler2Visibility: v })}
              />
            )}
          </>
        )}

        {u.method === 'diffusion' && (
          <div className="space-y-2 border-t border-line pt-2">
            <SelectField
              label={t('upscale.diffusionMethod')}
              value={u.diffusionMethod}
              options={['Mixture of Diffusers', 'MultiDiffusion']}
              onChange={(v) => patch({ diffusionMethod: v as 'MultiDiffusion' | 'Mixture of Diffusers' })}
            />
            <p className="text-[10px] text-ink-3 leading-relaxed -mt-1">
              {t('upscale.diffusionMethodHint')}
            </p>
            <Slider
              label={t('upscale.denoise')}
              value={u.denoise}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => patch({ denoise: v })}
            />
            <div className="grid grid-cols-2 gap-x-3">
              <Slider
                label={t('upscale.tileWidth')}
                value={u.tileWidth}
                min={64}
                max={2048}
                step={16}
                onChange={(v) => patch({ tileWidth: v })}
                precision={0}
              />
              <Slider
                label={t('upscale.tileHeight')}
                value={u.tileHeight}
                min={64}
                max={2048}
                step={16}
                onChange={(v) => patch({ tileHeight: v })}
                precision={0}
              />
            </div>
            <Slider
              label={t('upscale.tileOverlap')}
              value={u.tileOverlap}
              min={0}
              max={512}
              step={16}
              onChange={(v) => patch({ tileOverlap: v })}
              precision={0}
            />
            <p className="text-[10px] text-ink-3 leading-relaxed">
              {t('upscale.diffusionPromptHint')}
            </p>
          </div>
        )}

        {u.method === 'ultimate' && (
          <div className="space-y-2 border-t border-line pt-2">
            <Slider
              label={t('upscale.denoise')}
              value={u.denoise}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => patch({ denoise: v })}
            />
            <SelectField
              label={t('upscale.ultimateRedrawMode')}
              value={['Linear', 'Chess', 'None'][u.ultimateRedrawMode]}
              options={['Linear', 'Chess', 'None']}
              onChange={(v) =>
                patch({ ultimateRedrawMode: (['Linear', 'Chess', 'None'].indexOf(v)) as 0 | 1 | 2 })
              }
            />
            <SelectField
              label={t('upscale.ultimateSeamsFix')}
              value={['None', 'Band pass', 'Half tile offset pass', 'Half tile offset pass + intersections'][u.ultimateSeamsFixType]}
              options={['None', 'Band pass', 'Half tile offset pass', 'Half tile offset pass + intersections']}
              onChange={(v) => {
                const idx = ['None', 'Band pass', 'Half tile offset pass', 'Half tile offset pass + intersections'].indexOf(v)
                patch({ ultimateSeamsFixType: (idx >= 0 ? idx : 0) as 0 | 1 | 2 | 3 })
              }}
            />
            <div className="grid grid-cols-2 gap-x-3">
              <Slider
                label={t('upscale.tileWidth')}
                value={u.ultimateTileWidth}
                min={0}
                max={2048}
                step={64}
                onChange={(v) => patch({ ultimateTileWidth: v })}
                precision={0}
              />
              <Slider
                label={t('upscale.tileHeight')}
                value={u.ultimateTileHeight}
                min={0}
                max={2048}
                step={64}
                onChange={(v) => patch({ ultimateTileHeight: v })}
                precision={0}
              />
            </div>
            <div className="grid grid-cols-2 gap-x-3">
              <Slider
                label={t('upscale.maskBlur')}
                value={u.ultimateMaskBlur}
                min={0}
                max={64}
                step={1}
                onChange={(v) => patch({ ultimateMaskBlur: v })}
                precision={0}
              />
              <Slider
                label={t('upscale.padding')}
                value={u.ultimatePadding}
                min={0}
                max={512}
                step={1}
                onChange={(v) => patch({ ultimatePadding: v })}
                precision={0}
              />
            </div>
            <p className="text-[10px] text-ink-3 leading-relaxed">
              {t('upscale.ultimatePromptHint')}
            </p>
          </div>
        )}

        {u.method !== 'simple' && (
          <TileControlNetPanel
            enabled={u.tileControlNetEnabled}
            module={u.tileControlNetModule}
            model={u.tileControlNetModel}
            weight={u.tileControlNetWeight}
            guidanceStart={u.tileControlNetGuidanceStart}
            guidanceEnd={u.tileControlNetGuidanceEnd}
            modules={controlnetModules}
            models={controlnetModels}
            onPatch={patch}
            onOpenControlnetSearch={() => openCivitaiSearch('Controlnet')}
          />
        )}

        <button
          className="btn btn-primary w-full justify-center text-base font-semibold py-2.5 gap-2"
          onClick={runUpscale}
          disabled={!u.inputImage || u.isRunning}
          data-testid="upscale-run-button"
        >
          <Wand2 className={cn('h-5 w-5', u.isRunning && 'animate-pulse')} />
          {u.isRunning ? t('upscale.running') : t('upscale.run')}
        </button>
        {u.method !== 'simple' && (
          <button
            className="btn w-full justify-center text-xs gap-1.5"
            onClick={() => { void runDenoiseComparison() }}
            disabled={!u.inputImage || compareBusy || u.isRunning}
            data-testid="upscale-compare-run"
          >
            <GitCompare className={cn('h-3.5 w-3.5', compareBusy && 'animate-pulse')} />
            {compareBusy ? t('upscale.compareRunning') : t('upscale.compareRun')}
          </button>
        )}
      </aside>

      {/* Right preview pane */}
      <main className="flex-1 flex flex-col items-center justify-center p-6 overflow-auto">
        {u.outputImage ? (
          <div className="space-y-3 w-full max-w-4xl">
            {compareCandidates.length > 0 && (
              <DenoiseCompareGrid
                candidates={compareCandidates}
                criteria={compareCriteria}
                onCriteriaChange={setCompareCriteria}
                onSave={() => { void saveComparison() }}
                onUseCandidate={adoptCandidate}
                saving={compareSaving}
                selectedKey={adoptedCandidateKey}
              />
            )}
            <FinishChecklistPanel
              issues={finishIssues}
              memo={finishMemo}
              onIssueChange={setFinishIssue}
              onMemoChange={setFinishMemo}
            />
            <DimensionsCompare inputUrl={u.inputImage} outputUrl={u.outputImage} />
            <img
              src={u.outputImage}
              alt="upscaled output"
              data-testid="upscale-output-image"
              className="max-w-full max-h-[70vh] object-contain mx-auto rounded shadow-2xl"
            />
            <div className="flex justify-center gap-2">
              <button
                className="btn gap-1.5"
                onClick={() => { void saveOutputToHistory() }}
                disabled={historySaving}
                data-testid="upscale-save-history"
              >
                <History className={cn('h-3.5 w-3.5', historySaving && 'animate-pulse')} />
                {historySaving ? t('upscale.historySaving') : t('upscale.saveHistory')}
              </button>
              <button className="btn gap-1.5" onClick={downloadOutput}>
                <Download className="h-3.5 w-3.5" />
                {t('upscale.download')}
              </button>
              <button className="btn gap-1.5" onClick={sendToImg2Img}>
                <Send className="h-3.5 w-3.5" />
                {t('upscale.sendToImg2Img')}
              </button>
              <button className="btn gap-1.5" onClick={reuseAsInput} title={t('upscale.reuseAsInputHint')}>
                <Upload className="h-3.5 w-3.5" />
                {t('upscale.reuseAsInput')}
              </button>
            </div>
          </div>
        ) : compareCandidates.length > 0 ? (
          <div className="w-full max-w-5xl space-y-3">
            <DenoiseCompareGrid
              candidates={compareCandidates}
              criteria={compareCriteria}
              onCriteriaChange={setCompareCriteria}
              onSave={() => { void saveComparison() }}
              onUseCandidate={adoptCandidate}
              saving={compareSaving}
              selectedKey={adoptedCandidateKey}
            />
            <FinishChecklistPanel
              issues={finishIssues}
              memo={finishMemo}
              onIssueChange={setFinishIssue}
              onMemoChange={setFinishMemo}
            />
          </div>
        ) : u.inputImage ? (
          <p className="text-sm text-ink-3">{compareBusy ? t('upscale.compareRunning') : t('upscale.readyHint')}</p>
        ) : (
          <p className="text-sm text-ink-3">{t('upscale.noInputHint')}</p>
        )}
      </main>
    </div>
  )
}

function DenoiseCompareGrid({
  candidates,
  criteria,
  onCriteriaChange,
  onSave,
  onUseCandidate,
  saving,
  selectedKey
}: {
  candidates: UpscaleComparisonCandidate[]
  criteria: string
  onCriteriaChange: (value: string) => void
  onSave: () => void
  onUseCandidate: (candidate: UpscaleComparisonCandidate) => void
  saving: boolean
  selectedKey: string | null
}): JSX.Element {
  const t = useT()
  return (
    <div className="space-y-2" data-testid="upscale-compare-grid" data-candidate-count={candidates.length}>
      <div className="flex items-center gap-2 text-xs text-ink-2">
        <GitCompare className="h-3.5 w-3.5 text-accent" />
        <span>{t('upscale.compareTitle')}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {candidates.map((candidate, index) => {
          const key = upscaleCandidateKey(candidate)
          const selected = key === selectedKey
          return (
            <button
              key={key}
              className={cn(
                'rounded border bg-bg-2/50 p-2 text-left transition-colors hover:border-accent',
                selected ? 'border-accent ring-1 ring-accent/40' : 'border-line'
              )}
              onClick={() => onUseCandidate(candidate)}
              title={t('upscale.compareUse')}
              data-testid={`upscale-compare-candidate-${index}`}
              data-denoise={candidate.denoise}
              data-tile={candidate.tileControlNetEnabled ? 'on' : 'off'}
              data-selected={selected ? 'true' : 'false'}
            >
              <img src={candidate.imageDataUrl} alt={`denoise ${candidate.denoise}`} className="w-full aspect-square object-contain bg-bg-3 rounded" />
              <div className="mt-1 flex items-center gap-1 font-mono text-xs text-ink-1">
                <span>{candidate.tileControlNetEnabled ? 'Tile ON' : 'Tile OFF'}</span>
                <span className="ml-auto">d {candidate.denoise.toFixed(2)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-ink-3">
                {upscaleCandidateFacts(candidate).map((fact) => (
                  <span key={fact} className="rounded border border-line bg-bg-1 px-1 py-0.5">{fact}</span>
                ))}
              </div>
              <div className="mt-1 text-[10px] text-accent">
                {selected ? t('upscale.compareSelected') : t('upscale.compareUse')}
              </div>
            </button>
          )
        })}
      </div>
      <textarea
        className="input min-h-24 w-full resize-y text-xs leading-relaxed"
        value={criteria}
        onChange={(e) => onCriteriaChange(e.target.value)}
        aria-label={t('upscale.compareCriteria')}
        data-testid="upscale-compare-criteria"
      />
      <button className="btn justify-center text-xs gap-1.5" onClick={onSave} disabled={saving}>
        <Download className={cn('h-3.5 w-3.5', saving && 'animate-pulse')} />
        {saving ? t('upscale.compareSaving') : t('upscale.compareSave')}
      </button>
    </div>
  )
}

function FinishChecklistPanel({
  issues,
  memo,
  onIssueChange,
  onMemoChange
}: {
  issues: FinishIssueFlags
  memo: string
  onIssueChange: (id: FinishIssueId, checked: boolean) => void
  onMemoChange: (value: string) => void
}): JSX.Element {
  const t = useT()
  const issueCount = FINISH_ISSUE_ITEMS.filter((item) => issues[item.id]).length
  return (
    <section
      className="rounded border border-line bg-bg-2/50 p-3 space-y-2"
      data-testid="upscale-finish-checklist"
      data-issue-count={issueCount}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-ink-1">{t('upscale.finish.title')}</span>
        <span className={cn(
          'ml-auto rounded px-1.5 py-0.5 text-[10px]',
          issueCount > 0 ? 'bg-warn/15 text-warn' : 'bg-accent/10 text-accent'
        )}>
          {issueCount > 0
            ? t('upscale.finish.issueCount', { count: issueCount })
            : t('upscale.finish.clean')}
        </span>
      </div>
      <p className="text-[10px] text-ink-3 leading-relaxed">{t('upscale.finish.body')}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {FINISH_ISSUE_ITEMS.map((item) => (
          <label key={item.id} className="flex items-center gap-2 rounded border border-line bg-bg-1 px-2 py-1.5 text-[11px] text-ink-2">
            <input
              type="checkbox"
              className="accent-accent"
              checked={issues[item.id]}
              onChange={(event) => onIssueChange(item.id, event.target.checked)}
              data-testid={`upscale-finish-check-${item.id}`}
            />
            <span>{t(item.labelKey)}</span>
          </label>
        ))}
      </div>
      <textarea
        className="input min-h-16 w-full resize-y text-xs leading-relaxed"
        value={memo}
        onChange={(event) => onMemoChange(event.target.value)}
        placeholder={t('upscale.finish.memoPlaceholder')}
        data-testid="upscale-finish-memo"
      />
      <p className="text-[10px] text-ink-3 leading-relaxed">{t('upscale.finish.recipeHint')}</p>
    </section>
  )
}

interface DropZoneProps {
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onFile: (f: File) => void
}
function DropZone({ fileInputRef, onFile }: DropZoneProps): JSX.Element {
  const t = useT()
  const [over, setOver] = useState(false)
  return (
    <div
      className={cn(
        'mt-1 border border-dashed rounded p-4 text-center cursor-pointer transition-colors',
        over ? 'border-accent bg-accent-dim/10' : 'border-line hover:border-ink-2'
      )}
      onClick={() => fileInputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith('image/'))
        if (f) onFile(f)
      }}
    >
      <Upload className="h-5 w-5 mx-auto text-ink-3 mb-1" />
      <div className="text-[11px] text-ink-2">{t('inputImage.dropHint')}</div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        data-testid="upscale-input-file"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}

function buildUpscaleComparisonCandidate(
  u: UpscaleState,
  denoise: number,
  tileControlNetEnabled: boolean,
  imageDataUrl: string
): UpscaleComparisonCandidate {
  return {
    imageDataUrl,
    denoise,
    tileControlNetEnabled,
    method: u.method,
    scale: u.scale,
    upscaler: u.upscaler,
    tileWidth: u.method === 'ultimate' ? normalizeTileSize(u.ultimateTileWidth, 512) : normalizeTileSize(u.tileWidth, 768),
    tileHeight: u.method === 'ultimate'
      ? normalizeTileSize(u.ultimateTileHeight || u.ultimateTileWidth, 512)
      : normalizeTileSize(u.tileHeight, 768),
    tileOverlap: u.method === 'ultimate' ? null : normalizeTileOverlap(u.tileOverlap, u.tileWidth, u.tileHeight),
    ultimateMaskBlur: u.method === 'ultimate' ? u.ultimateMaskBlur : null,
    ultimatePadding: u.method === 'ultimate' ? u.ultimatePadding : null,
    ultimateRedrawMode: u.method === 'ultimate' ? u.ultimateRedrawMode : null,
    ultimateSeamsFixType: u.method === 'ultimate' ? u.ultimateSeamsFixType : null,
    tileControlNetModule: tileControlNetEnabled ? u.tileControlNetModule : null,
    tileControlNetModel: tileControlNetEnabled ? u.tileControlNetModel : null,
    tileControlNetWeight: tileControlNetEnabled ? u.tileControlNetWeight : null
  }
}

function upscaleCandidateKey(candidate: UpscaleComparisonCandidate): string {
  return [
    candidate.method ?? 'unknown',
    candidate.tileControlNetEnabled ? 'tile-on' : 'tile-off',
    candidate.denoise.toFixed(2),
    candidate.tileWidth ?? 'na',
    candidate.tileHeight ?? 'na',
    candidate.ultimatePadding ?? 'na',
    candidate.ultimateSeamsFixType ?? 'na'
  ].join(':')
}

function upscaleCandidateFacts(candidate: UpscaleComparisonCandidate): string[] {
  const facts = [
    candidate.method ?? 'upscale',
    `x${formatMaybeNumber(candidate.scale)}`,
    candidate.upscaler ?? 'upscaler'
  ]
  if (candidate.tileWidth && candidate.tileHeight) facts.push(`${candidate.tileWidth}x${candidate.tileHeight}`)
  if (candidate.tileOverlap != null) facts.push(`overlap ${candidate.tileOverlap}`)
  if (candidate.ultimatePadding != null) facts.push(`padding ${candidate.ultimatePadding}`)
  if (candidate.ultimateMaskBlur != null) facts.push(`blur ${candidate.ultimateMaskBlur}`)
  if (candidate.ultimateSeamsFixType != null) facts.push(`seam ${candidate.ultimateSeamsFixType}`)
  if (candidate.tileControlNetEnabled && candidate.tileControlNetWeight != null) facts.push(`CN ${candidate.tileControlNetWeight.toFixed(2)}`)
  return facts.filter((fact) => fact && fact !== 'x-').slice(0, 8)
}

function buildUpscaleProRecipeReview(
  u: UpscaleState,
  dims: { width: number; height: number },
  issues: FinishIssueFlags,
  memo: string,
  adoptedCandidate: UpscaleComparisonCandidate | null
): HistoryProRecipeReview {
  const issueLines = FINISH_ISSUE_ITEMS
    .filter((item) => issues[item.id])
    .map((item) => tStatic(item.issueKey))
  const settings = [
    `upscale:${u.method}`,
    `x${u.scale}`,
    `upscaler:${u.upscaler}`,
    u.method === 'simple' ? null : `denoise:${u.denoise.toFixed(2)}`,
    u.method === 'simple' ? null : `tile:${u.tileControlNetEnabled ? 'ON' : 'OFF'}`,
    u.method === 'ultimate' ? `ultimate:${u.ultimateTileWidth}x${u.ultimateTileHeight || u.ultimateTileWidth}/padding${u.ultimatePadding}/seam${u.ultimateSeamsFixType}` : null,
    adoptedCandidate ? `adopted:${adoptedCandidate.tileControlNetEnabled ? 'Tile ON' : 'Tile OFF'} d${adoptedCandidate.denoise.toFixed(2)}` : null,
    `${dims.width}x${dims.height}`
  ].filter((line): line is string => Boolean(line))
  const memoLine = memo.trim()
  return {
    rating: issueLines.length === 0 ? 4 : 3,
    strengths: [
      tStatic('upscale.finish.recipeStrength'),
      settings.join(' / ')
    ],
    issues: issueLines,
    nextActions: memoLine ? [memoLine] : [tStatic('upscale.finish.recipeNext')],
    scores: {
      reusePotential: issueLines.length === 0 ? 4 : 3
    },
    ...(u.inputHistoryId ? { parentHistoryId: u.inputHistoryId } : {}),
    updatedAt: Date.now()
  }
}

function formatMaybeNumber(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '-'
}

interface MethodButtonProps {
  active: boolean
  onClick: () => void
  label: string
  hint: string
  testId: string
}
function MethodButton({ active, onClick, label, hint, testId }: MethodButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        'rounded border px-2 py-2 text-left transition-colors',
        active
          ? 'border-accent bg-accent-dim/15 text-ink-1'
          : 'border-line text-ink-2 hover:border-ink-2'
      )}
      onClick={onClick}
      data-testid={testId}
    >
      <div className="text-xs font-medium">{label}</div>
      <div className="text-[10px] text-ink-3 leading-tight mt-0.5">{hint}</div>
    </button>
  )
}

interface TileControlNetPanelProps {
  enabled: boolean
  module: string
  model: string
  weight: number
  guidanceStart: number
  guidanceEnd: number
  modules: string[]
  models: string[]
  onPatch: (patch: Partial<UpscaleState>) => void
  onOpenControlnetSearch: () => void
}
function TileControlNetPanel({
  enabled,
  module,
  model,
  weight,
  guidanceStart,
  guidanceEnd,
  modules,
  models,
  onPatch,
  onOpenControlnetSearch
}: TileControlNetPanelProps): JSX.Element {
  const t = useT()
  const moduleOptions = uniqueOptions(['None', module, ...modules])
  const modelOptions = uniqueOptions(['None', model, ...models])
  const hasTileModel = models.some((m) => /tile/i.test(m))

  return (
    <div className="space-y-2 border-t border-line pt-2">
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          className="mt-0.5 accent-accent"
          checked={enabled}
          onChange={(e) => onPatch({ tileControlNetEnabled: e.target.checked })}
        />
        <span className="min-w-0">
          <span className="block text-[11px] font-medium text-ink-1">
            {t('upscale.tileControlNet.title')}
          </span>
          <span className="block text-[10px] text-ink-3 leading-relaxed">
            {t('upscale.tileControlNet.hint')}
          </span>
        </span>
      </label>

      {enabled && (
        <div className="space-y-2 pl-5">
          <div className="grid grid-cols-2 gap-2">
            <SelectField
              label={t('upscale.tileControlNet.module')}
              value={module}
              options={moduleOptions}
              onChange={(v) => onPatch({ tileControlNetModule: v })}
            />
            <SelectField
              label={t('upscale.tileControlNet.model')}
              value={model}
              options={modelOptions}
              onChange={(v) => onPatch({ tileControlNetModel: v })}
            />
          </div>

          {models.length === 0 ? (
            <p className="text-[10px] text-warn leading-relaxed">
              {t('upscale.tileControlNet.noCatalog')}
            </p>
          ) : !hasTileModel ? (
            <p className="text-[10px] text-warn leading-relaxed">
              {t('upscale.tileControlNet.noTileModel')}
            </p>
          ) : model === 'None' ? (
            <p className="text-[10px] text-warn leading-relaxed">
              {t('upscale.tileControlNet.needModel')}
            </p>
          ) : null}

          {(models.length === 0 || !hasTileModel) && (
            <button
              type="button"
              className="btn w-full justify-center text-[11px] py-1"
              onClick={onOpenControlnetSearch}
            >
              {t('upscale.tileControlNet.findModel')}
            </button>
          )}

          <Slider
            label={t('upscale.tileControlNet.weight')}
            value={weight}
            min={0}
            max={2}
            step={0.01}
            onChange={(v) => onPatch({ tileControlNetWeight: v })}
          />
          <div className="grid grid-cols-2 gap-x-3">
            <Slider
              label={t('upscale.tileControlNet.start')}
              value={guidanceStart}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => onPatch({ tileControlNetGuidanceStart: Math.min(v, guidanceEnd) })}
            />
            <Slider
              label={t('upscale.tileControlNet.end')}
              value={guidanceEnd}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => onPatch({ tileControlNetGuidanceEnd: Math.max(v, guidanceStart) })}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function chooseTileControlNetModel(models: string[], current: string): string {
  if (current !== 'None' && models.includes(current)) return current
  return models.find((m) => /tile/i.test(m)) ?? 'None'
}

function chooseTileControlNetModule(modules: string[], current: string): string {
  if (current && modules.includes(current)) return current
  return modules.find((m) => /^tile_resample$/i.test(m))
    ?? modules.find((m) => /tile/i.test(m))
    ?? (modules.includes('None') ? 'None' : modules[0] ?? 'None')
}

function uniqueOptions(options: string[]): string[] {
  return Array.from(new Set(options.filter(Boolean)))
}

function filePathOf(file: File): string | null {
  const path = (file as File & { path?: string }).path
  return typeof path === 'string' && path.length > 0 ? path : null
}

function normalizeTileSize(value: number, fallback: number): number {
  const raw = Number.isFinite(value) && value > 0 ? value : fallback
  return Math.max(64, Math.min(4096, Math.round(raw)))
}

function normalizeTileOverlap(value: number, tileWidth: number, tileHeight: number): number {
  const maxOverlap = Math.max(0, Math.min(tileWidth, tileHeight) - 1)
  const raw = Number.isFinite(value) ? value : 64
  return Math.max(0, Math.min(maxOverlap, Math.round(raw)))
}

interface ScalePresetsProps {
  value: number
  onChange: (v: number) => void
  t: ReturnType<typeof useT>
}
function ScalePresets({ value, onChange, t }: ScalePresetsProps): JSX.Element {
  const presets = [1.5, 2, 3, 4]
  return (
    <label className="block col-span-2">
      <span className="label">{t('upscale.scale')}</span>
      <div className="flex gap-1 mt-1">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            className={cn(
              'flex-1 btn text-xs',
              value === p && 'btn-primary'
            )}
            onClick={() => onChange(p)}
          >
            {p}×
          </button>
        ))}
        <input
          type="number"
          className="input text-xs w-20"
          min={1}
          max={8}
          step={0.5}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 2)}
        />
      </div>
    </label>
  )
}

/**
 * Decode a `data:image/png;base64,…` URL into raw bytes without going through
 * fetch. Electron's CSP blocks `fetch(dataUrl)` (data: not in connect-src),
 * but a direct atob is fine and avoids the CSP handshake.
 */
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const commaIdx = dataUrl.indexOf(',')
  if (commaIdx < 0) throw new Error('No base64 separator in data URL')
  const b64 = dataUrl.slice(commaIdx + 1)
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function dataUrlToBase64(dataUrl: string): string {
  const commaIdx = dataUrl.indexOf(',')
  if (commaIdx < 0) throw new Error('No base64 separator in data URL')
  return dataUrl.slice(commaIdx + 1)
}

function readUpscaleQaMockOutput(): string | null {
  try {
    const raw = window.localStorage.getItem('yoitomoshi:qa:upscale-output')
    if (!raw) return null
    if (raw.startsWith('data:image/')) return raw
    if (/^[A-Za-z0-9+/=]+$/.test(raw)) return `data:image/png;base64,${raw}`
  } catch {
    return null
  }
  return null
}

async function imageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = reject
    img.src = dataUrl
  })
}

async function fetchOptionalCatalog<T>(
  fn: () => Promise<T>,
  fallback: T,
  attempts = 6,
  delayMs = 500
): Promise<T> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const value = await fn()
      if (Array.isArray(value) && value.length === 0 && i < attempts - 1) {
        await delay(delayMs)
        continue
      }
      return value
    } catch {
      if (i === attempts - 1) return fallback
      await delay(delayMs)
    }
  }
  return fallback
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Compare input and output dimensions side-by-side as a sanity-check after
 * upscale completes. If the output is the same size as input (or smaller),
 * the upscale silently failed — usually because the picked upscaler isn't
 * actually installed and Forge fell back to a no-op stretch.
 */
function DimensionsCompare({ inputUrl, outputUrl }: { inputUrl: string | null; outputUrl: string }): JSX.Element {
  const [inDim, setInDim] = useState<{ width: number; height: number } | null>(null)
  const [outDim, setOutDim] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    if (inputUrl) imageDimensions(inputUrl).then((d) => { if (!cancelled) setInDim(d) }).catch(() => undefined)
    imageDimensions(outputUrl).then((d) => { if (!cancelled) setOutDim(d) }).catch(() => undefined)
    return () => { cancelled = true }
  }, [inputUrl, outputUrl])

  if (!inDim || !outDim) return <></>
  const ratio = (outDim.width / inDim.width).toFixed(2)
  const grew = outDim.width > inDim.width
  return (
    <div className="text-xs font-mono text-center text-ink-2">
      <span>{inDim.width}×{inDim.height}</span>
      <span className="mx-2">→</span>
      <span className={grew ? 'text-ok' : 'text-warn'}>{outDim.width}×{outDim.height}</span>
      <span className="ml-2 text-ink-3">×{ratio}</span>
    </div>
  )
}
