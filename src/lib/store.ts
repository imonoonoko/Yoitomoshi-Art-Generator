import { create } from 'zustand'
import type {
  ActiveLora,
  AppSettings,
  CivitaiAssetType,
  CivitaiCommunityStats,
  CivitaiRecommended,
  CivitaiTag,
  DroppedImageInsight,
  ForgeStatus,
  ModelUpdateInfo,
  GenerationProgress,
  HistoryItem,
  LoraCivitaiMetadata,
  LoraUsageRecord,
  PromptCategory,
  PromptPreset,
  QuickPreset,
  ScoredLora,
  SdLora,
  SdModel,
  SdSampler,
  SdVae
} from '@shared/types'

/**
 * Top-level workspace tabs. Kept intentionally small — each tab hosts
 * collapsible feature panels (ControlNet, adetailer, FreeU, etc.) rather
 * than splitting into many tabs.
 */
export type WorkspaceTab = 'txt2img' | 'img2img' | 'upscale' | 'tools'
export type GenerationWorkspaceMode = 'create' | 'refine' | 'advanced'

/**
 * Dynamic Thresholding (CFG-Fix) settings — Forge's built-in
 * `sd_forge_dynamic_thresholding`. Lets users push CFG scale higher than
 * usual without burnt/over-saturated outputs by clipping latent values
 * against a "mimic" CFG schedule. Most users only touch enabled +
 * mimicScale + thresholdPercentile; the rest are exposed as advanced
 * controls.
 */
export interface DynThresState {
  enabled: boolean
  mimicScale: number
  thresholdPercentile: number
  mimicMode: string
  mimicScaleMin: number
  cfgMode: string
  cfgScaleMin: number
  schedVal: number
  separateFeatureChannels: 'enable' | 'disable'
  scalingStartpoint: 'MEAN' | 'ZERO'
  variabilityMeasure: 'AD' | 'STD'
  interpolatePhi: number
}

export const DEFAULT_DYN_THRES: DynThresState = {
  enabled: false,
  mimicScale: 7,
  thresholdPercentile: 1,
  mimicMode: 'Constant',
  mimicScaleMin: 0,
  cfgMode: 'Constant',
  cfgScaleMin: 0,
  schedVal: 1,
  separateFeatureChannels: 'enable',
  scalingStartpoint: 'MEAN',
  variabilityMeasure: 'AD',
  interpolatePhi: 1
}

/**
 * FreeU — Forge built-in `sd_forge_freeu`. Boosts image quality "for free" by
 * rescaling UNet skip + backbone activations during sampling. Defaults below
 * match Forge's own UI defaults (the FreeU paper's recommended starting
 * point for SD 1.x; SDXL benefits from slightly different values).
 */
export interface FreeUState {
  enabled: boolean
  b1: number   // backbone scale 1
  b2: number   // backbone scale 2
  s1: number   // skip scale 1
  s2: number   // skip scale 2
  startStep: number  // 0..1 fraction of sampling — when to start applying
  endStep: number    // 0..1 fraction — when to stop
}

export const DEFAULT_FREEU: FreeUState = {
  enabled: false,
  b1: 1.01,
  b2: 1.02,
  s1: 0.99,
  s2: 0.95,
  startStep: 0,
  endStep: 1
}

/**
 * ADetailer (https://github.com/Bing-su/adetailer) settings.
 *
 * Pipeline: after the main generation, ADetailer detects target regions
 * (face / hand / person) using YOLOv8 / mediapipe models, then inpaints
 * each region with custom prompt + denoise. The most common use case is
 * two units: one for faces, one for hands.
 *
 * Note: this extension is NOT in Forge built-ins. The bundled distribution
 * git-clones it into webui/extensions/. If absent, generation still works
 * but the alwayson_scripts entry is silently ignored by Forge.
 */
export interface AdetailerUnitState {
  /** Detector model. Common choices: face_yolov8n.pt / hand_yolov8n.pt / person_yolov8n-seg.pt / mediapipe_face_full / yolov8x-worldv2.pt */
  model: string
  /**
   * Comma-separated class names to filter detection.
   *
   * Only meaningful for **YOLO-world models** (e.g. `yolov8x-worldv2.pt`)
   * which support open-vocabulary detection by class name. Examples:
   *   - "left hand, right hand"  — separate left vs right hands
   *   - "eye"                    — only eyes
   *   - "person, cat"            — person + cats
   *
   * Empty string = no filter (use the model's default classes).
   * Maps to ADetailer's `ad_model_classes` field.
   */
  modelClasses: string
  prompt: string
  negativePrompt: string
  confidence: number          // 0..1 — minimum detection confidence
  denoisingStrength: number   // 0..1 — inpaint denoise per detected region
  maskBlur: number            // 0..32 — mask edge softening
  inpaintOnlyMaskedPadding: number  // 0..256 — context pixels around the mask
  dilateErode: number         // mask grow/shrink (negative = erode, positive = dilate)
}

export interface AdetailerState {
  enabled: boolean
  skipImg2img: boolean        // when running img2img, skip the first pass entirely
  units: AdetailerUnitState[] // 1..4 typical
}

export const DEFAULT_ADETAILER_UNIT: AdetailerUnitState = {
  model: 'face_yolov8n.pt',
  modelClasses: '',
  prompt: '',
  negativePrompt: '',
  confidence: 0.3,
  denoisingStrength: 0.4,
  maskBlur: 4,
  inpaintOnlyMaskedPadding: 32,
  dilateErode: 4
}

export const DEFAULT_ADETAILER: AdetailerState = {
  enabled: false,
  skipImg2img: false,
  units: [DEFAULT_ADETAILER_UNIT]
}

/**
 * ControlNet — Forge built-in `sd_forge_controlnet`. Lets the user steer
 * generation with structural guidance (pose / depth / edges / segmentation /
 * tile / etc.). Up to 3 simultaneous units stack their guidance.
 *
 * Notes on the per-unit `image`: stored as a data URL (full prefix). When
 * sending to the API we strip the `data:image/...;base64,` prefix because
 * Forge's controlnet endpoint expects the raw base64.
 *
 * `controlMode` integer values map to:
 *   0 = Balanced (default)
 *   1 = My prompt is more important
 *   2 = ControlNet is more important
 *
 * `resizeMode` integer values map to:
 *   0 = Just Resize
 *   1 = Crop and Resize (Inner Fit, Forge default)
 *   2 = Resize and Fill (Outer Fit)
 */
export interface ControlNetUnitState {
  enabled: boolean
  module: string         // preprocessor name, e.g. "openpose_full" / "canny" / "None"
  model: string          // model filename, e.g. "control_v11p_sd15_openpose [cab727d4]"
  image: string | null   // data URL (with prefix) — null when no image set
  imagePath: string | null
  weight: number         // 0..2, default 1
  guidanceStart: number  // 0..1, default 0
  guidanceEnd: number    // 0..1, default 1
  pixelPerfect: boolean
  controlMode: 0 | 1 | 2
  resizeMode: 0 | 1 | 2
  processorRes: number   // -1 = auto
  thresholdA: number     // -1 = default (preprocessor-specific)
  thresholdB: number     // -1 = default
}

export interface ControlNetState {
  enabled: boolean
  units: ControlNetUnitState[]
}

export const DEFAULT_CONTROLNET_UNIT: ControlNetUnitState = {
  enabled: false,
  module: 'None',
  model: 'None',
  image: null,
  imagePath: null,
  weight: 1.0,
  guidanceStart: 0,
  guidanceEnd: 1,
  pixelPerfect: false,
  controlMode: 0,
  resizeMode: 1,
  processorRes: -1,
  thresholdA: -1,
  thresholdB: -1
}

export const DEFAULT_CONTROLNET: ControlNetState = {
  enabled: false,
  units: [DEFAULT_CONTROLNET_UNIT]
}

export type RegionalPrompterSplitMode = 'Columns' | 'Rows'
export type RegionalPrompterCalcMode = 'Attention' | 'Latent'

export interface RegionalPrompterState {
  enabled: boolean
  splitMode: RegionalPrompterSplitMode
  ratios: string
  baseRatios: string
  useBase: boolean
  useCommon: boolean
  useCommonNegative: boolean
  calcMode: RegionalPrompterCalcMode
  commonPrompt: string
  basePrompt: string
  regionPrompts: string[]
  flip: boolean
}

export const DEFAULT_REGIONAL_PROMPTER: RegionalPrompterState = {
  enabled: false,
  splitMode: 'Columns',
  ratios: '1,1',
  baseRatios: '0.2',
  useBase: false,
  useCommon: true,
  useCommonNegative: false,
  calcMode: 'Attention',
  commonPrompt: 'masterpiece, best quality',
  basePrompt: '',
  regionPrompts: ['left side subject', 'right side subject'],
  flip: false
}

export interface FabricFeedbackItem {
  filename: string
  path: string | null
  image: string
  sourceLabel: string
  addedAt: number
}

export interface FabricState {
  enabled: boolean
  positive: FabricFeedbackItem[]
  negative: FabricFeedbackItem[]
  start: number
  end: number
  minWeight: number
  maxWeight: number
  negativeWeight: number
  feedbackDuringHighResFix: boolean
  tomeEnabled: boolean
  tomeRatio: number
  tomeMaxTokens: number
  tomeSeed: number
  burnoutProtection: boolean
}

export const DEFAULT_FABRIC: FabricState = {
  enabled: false,
  positive: [],
  negative: [],
  start: 0,
  end: 0.8,
  minWeight: 0,
  maxWeight: 0.8,
  negativeWeight: 0.5,
  feedbackDuringHighResFix: false,
  tomeEnabled: false,
  tomeRatio: 0.5,
  tomeMaxTokens: 8192,
  tomeSeed: -1,
  burnoutProtection: false
}

/**
 * Upscale workspace state. Three paths:
 *   - 'simple': pure neural upscaler via /sdapi/v1/extra-single-image. Fast,
 *     no detail synthesis. Best when you just want to enlarge.
 *   - 'diffusion': img2img + MultiDiffusion alwayson_scripts. Slow but adds
 *     coherent detail at high resolution by tiling the diffusion process.
 *   - 'ultimate': img2img with selectable `Ultimate SD upscale` script —
 *     tile-based redraw with seam fix, often higher quality than Diffusion
 *     at the cost of fewer parameter knobs the user can tune.
 *
 * Result image is stored back here so the user can save / re-upscale / send
 * to img2img / etc. without re-running the upscale.
 */
export type UpscaleMethod = 'simple' | 'diffusion' | 'ultimate'

export interface UpscaleState {
  method: UpscaleMethod
  inputImage: string | null     // data URL (with prefix)
  inputFilename: string | null
  inputImagePath: string | null
  inputHistoryId: string | null
  upscaler: string              // primary upscaler name (e.g. "R-ESRGAN 4x+")
  upscaler2: string             // 'None' = single upscaler
  upscaler2Visibility: number   // 0..1
  scale: number                 // multiplier — 2 / 4 / fractional all OK
  // Diffusion path additions (multidiffusion + img2img):
  denoise: number               // 0..1, default 0.4 — too high blurs the source
  tileWidth: number             // default 768
  tileHeight: number            // default 768
  tileOverlap: number           // default 64
  diffusionMethod: 'MultiDiffusion' | 'Mixture of Diffusers'
  // Ultimate SD upscale specifics. Sub-set of the script's full param list
  // — we expose the controls users actually touch and leave the rest at the
  // script's defaults (seams fix is hidden behind 'None' = off; the seams
  // fix slider values are kept so they can be enabled later via UI).
  ultimateTileWidth: number     // 0..2048, default 512
  ultimateTileHeight: number    // 0..2048, default 0 (= same as tile width)
  ultimateMaskBlur: number      // 0..64, default 16 (was 8 — wider blur reduces seams)
  ultimatePadding: number       // 0..512, default 64 (was 32 — more context per tile = less drift)
  ultimateRedrawMode: 0 | 1 | 2 // 0=Linear, 1=Chess (default), 2=None
  /**
   * Seams-fix pass run after the main redraw. Index into the script's
   * `seams_fix_types` choices:
   *   0 = None
   *   1 = Band pass
   *   2 = Half tile offset pass
   *   3 = Half tile offset pass + intersections (best for content-drift)
   * Default 3 because the visible drift between tiles is exactly what this
   * pass is designed to eliminate.
   */
  ultimateSeamsFixType: 0 | 1 | 2 | 3
  // Optional Tile ControlNet pass for diffusion-based upscale. This is kept
  // separate from the main ControlNet panel so normal txt2img/img2img units
  // never bleed into upscale jobs.
  tileControlNetEnabled: boolean
  tileControlNetModule: string
  tileControlNetModel: string
  tileControlNetWeight: number
  tileControlNetGuidanceStart: number
  tileControlNetGuidanceEnd: number
  // Output:
  outputImage: string | null    // data URL of the upscaled result
  outputImagePath: string | null
  outputHistoryId: string | null
  isRunning: boolean
}

export const DEFAULT_UPSCALE: UpscaleState = {
  method: 'simple',
  inputImage: null,
  inputFilename: null,
  inputImagePath: null,
  inputHistoryId: null,
  upscaler: 'R-ESRGAN 4x+',
  upscaler2: 'None',
  upscaler2Visibility: 0,
  scale: 2,
  // 0.25 is the community-recommended sweet spot for "preserve character +
  // add a little detail" upscale. 0.40 is enough to drift each tile into a
  // different interpretation of the prompt, which is exactly the bug we hit.
  denoise: 0.25,
  tileWidth: 768,
  tileHeight: 768,
  tileOverlap: 96,                  // was 64 — wider overlap blends tile seams better
  // "Mixture of Diffusers" averages latents at tile boundaries, which is
  // dramatically better at preserving continuity than vanilla MultiDiffusion.
  // The MultiDiffusion paper and Forge's own implementation both note this.
  diffusionMethod: 'Mixture of Diffusers',
  ultimateTileWidth: 512,
  ultimateTileHeight: 0,
  ultimateMaskBlur: 16,
  ultimatePadding: 64,
  ultimateRedrawMode: 1,            // Chess — alternating tile offsets break grid patterns
  ultimateSeamsFixType: 3,          // Half tile offset pass + intersections
  tileControlNetEnabled: false,
  // Prefer tile_resample when installed; if the live Forge catalog lacks it,
  // UpscaleWorkspace falls back to another tile module or "None".
  tileControlNetModule: 'tile_resample',
  tileControlNetModel: 'None',
  tileControlNetWeight: 0.6,
  tileControlNetGuidanceStart: 0,
  tileControlNetGuidanceEnd: 1,
  outputImage: null,
  outputImagePath: null,
  outputHistoryId: null,
  isRunning: false
}

export interface GenerationParams {
  steps: number
  cfgScale: number
  width: number
  height: number
  sampler: string
  scheduler: string
  seed: number
  batchSize: number
  iterations: number
  clipSkip: number
  /** img2img only — ignored by txt2img path */
  denoisingStrength: number
}

export interface AppState {
  // Active workspace tab. Determines which generation endpoint is used and
  // which side panels are visible. New tabs cost top-level UI complexity, so
  // resist adding them — host new features as collapsible panels inside an
  // existing tab instead.
  currentTab: WorkspaceTab
  setCurrentTab(t: WorkspaceTab): void
  generationMode: GenerationWorkspaceMode
  setGenerationMode(mode: GenerationWorkspaceMode): void

  // Extension-feature settings. Each lives as a flat slice with a `patch*`
  // setter so panels can update individual fields without spreading the
  // full slice. Future extensions (FreeU, ADetailer, ControlNet) follow
  // the same pattern.
  dynThres: DynThresState
  patchDynThres(patch: Partial<DynThresState>): void

  freeu: FreeUState
  patchFreeu(patch: Partial<FreeUState>): void

  adetailer: AdetailerState
  patchAdetailer(patch: Partial<AdetailerState>): void
  patchAdetailerUnit(index: number, patch: Partial<AdetailerUnitState>): void
  addAdetailerUnit(): void
  removeAdetailerUnit(index: number): void

  controlnet: ControlNetState
  controlnetModelList: string[]                                // populated lazily once Forge is ready
  controlnetModuleList: string[]
  setControlnetCatalogs(models: string[], modules: string[]): void
  patchControlnet(patch: Partial<ControlNetState>): void
  patchControlnetUnit(index: number, patch: Partial<ControlNetUnitState>): void
  addControlnetUnit(): void
  removeControlnetUnit(index: number): void

  regionalPrompter: RegionalPrompterState
  patchRegionalPrompter(patch: Partial<RegionalPrompterState>): void

  fabric: FabricState
  patchFabric(patch: Partial<FabricState>): void

  upscale: UpscaleState
  upscalerList: string[]                                       // populated when Forge ready
  setUpscalerList(names: string[]): void
  patchUpscale(patch: Partial<UpscaleState>): void

  // Forge connection
  forgeStatus: ForgeStatus
  setForgeStatus(s: ForgeStatus): void

  // Catalog
  models: SdModel[]
  samplers: SdSampler[]
  schedulers: string[]
  vaes: SdVae[]
  /** Selected VAE name. "Automatic" = use checkpoint built-in. */
  selectedVae: string
  selectedModelTitle: string | null
  setModels(m: SdModel[]): void
  setSamplers(s: SdSampler[]): void
  setSchedulers(s: string[]): void
  setVaes(v: SdVae[]): void
  setSelectedVae(name: string): void
  setSelectedModel(title: string | null): void

  // Civitai recommendation for the currently selected model
  recommendation: CivitaiRecommended | null
  recommendationLoading: boolean
  setRecommendation(r: CivitaiRecommended | null): void
  setRecommendationLoading(b: boolean): void
  /** Community-mined stats for the current checkpoint (loads in background after recommendation). */
  communityStats: CivitaiCommunityStats | null
  communityStatsLoading: boolean
  setCommunityStats(s: CivitaiCommunityStats | null): void
  setCommunityStatsLoading(b: boolean): void

  // Prompts + params
  prompt: string
  negativePrompt: string
  params: GenerationParams
  setPrompt(p: string): void
  setNegativePrompt(p: string): void
  patchParams(p: Partial<GenerationParams>): void

  // Generation
  isGenerating: boolean
  progress: GenerationProgress | null
  lastImage: string | null    // data: URL
  setGenerating(b: boolean): void
  setProgress(p: GenerationProgress | null): void
  lastImageHistoryId: string | null
  setLastImage(s: string | null, historyId?: string | null): void

  // Input image (img2img). Set → generation switches to img2img mode.
  inputImage: string | null   // full data URL, with prefix
  inputImageFilename: string | null
  inputImagePath: string | null
  inputImageHistoryId: string | null
  setInputImage(image: string | null, filename?: string | null, sourcePath?: string | null, historyId?: string | null): void
  inpaintMaskImage: string | null
  setInpaintMaskImage(image: string | null): void

  // Tags extracted via interrogator from the input image (or any uploaded image)
  extractedTags: string[]
  setExtractedTags(tags: string[]): void

  // PNG metadata identification — populated when user drops an AI image and
  // we cross-reference its embedded model/LoRA/VAE names against Civitai.
  droppedInsight: DroppedImageInsight | null
  droppedInsightLoading: boolean
  setDroppedInsight(i: DroppedImageInsight | null): void
  setDroppedInsightLoading(b: boolean): void

  // Catalog state
  history: HistoryItem[]
  presets: PromptPreset[]
  setHistory(h: HistoryItem[]): void
  setPresets(p: PromptPreset[]): void

  // Library
  library: PromptCategory[]                  // built-in (read-only) from YAML
  customLibrary: PromptCategory[]            // user-added (editable)
  autocomplete: Map<string, string>          // merged index of both sources
  setLibrary(c: PromptCategory[], ac: Map<string, string>): void
  setCustomLibrary(c: PromptCategory[]): void

  // Tag favorites (en strings, set across all categories)
  favorites: Set<string>
  setFavorites(f: Set<string>): void
  toggleFavorite(en: string): void

  // Recently-used tags (in-memory, MRU max 60)
  recentTags: string[]
  pushRecentTag(en: string): void

  // Quick presets (positive + negative bundled snippets)
  quickPresets: QuickPreset[]
  setQuickPresets(p: QuickPreset[]): void
  hiddenQuickPresetIds: Set<string>
  setHiddenQuickPresetIds(s: Set<string>): void
  toggleHiddenQuickPreset(id: string): void

  // -- LoRA --
  loras: SdLora[]
  loraMeta: Map<string, LoraCivitaiMetadata>      // by lora.name
  activeLoras: ActiveLora[]
  loraFavorites: Set<string>
  loraSuggestions: ScoredLora[]
  loraUsage: LoraUsageRecord[]
  setLoras(l: SdLora[]): void
  upsertLoraMeta(name: string, m: LoraCivitaiMetadata): void
  setActiveLoras(a: ActiveLora[]): void
  toggleActiveLora(lora: SdLora, weight?: number, triggerWords?: string[]): void
  patchActiveLora(name: string, patch: Partial<ActiveLora>): void
  removeActiveLora(name: string): void
  setLoraFavorites(f: Set<string>): void
  toggleLoraFavorite(name: string): void
  setLoraSuggestions(s: ScoredLora[]): void
  setLoraUsage(u: LoraUsageRecord[]): void

  // Settings
  settings: AppSettings | null
  setSettings(s: AppSettings): void

  // Civitai search modal — globally accessible so any component (LoraPanel,
  // TitleBar, RecommendationCard) can open it with a type pre-filter.
  civitaiSearch: { open: boolean; initialType: CivitaiAssetType | null }
  openCivitaiSearch(type?: CivitaiAssetType | null): void
  closeCivitaiSearch(): void

  // Civitai update notifications — installed checkpoints with newer versions.
  // Keyed by checkpoint title (matches SdModel.title) so the dropdown can
  // light up the right rows. Loaded asynchronously after Forge ready.
  modelUpdates: Map<string, ModelUpdateInfo>
  setModelUpdates(updates: ModelUpdateInfo[]): void

  // Civitai popular tags for the search modal's tag-chip row.
  civitaiTags: CivitaiTag[]
  setCivitaiTags(tags: CivitaiTag[]): void
}

export const defaultParams: GenerationParams = {
  steps: 25,
  cfgScale: 7,
  width: 768,
  height: 1024,
  sampler: 'DPM++ 2M Karras',
  scheduler: '',
  seed: -1,
  batchSize: 1,
  iterations: 1,
  clipSkip: 1,
  denoisingStrength: 0.65
}

export function normalizeClipSkip(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.max(1, Math.min(12, Math.round(n)))
}

export function normalizeGenerationParams(
  params: Partial<GenerationParams>,
  fallback: GenerationParams = defaultParams
): GenerationParams {
  return {
    steps: finiteInt(params.steps, fallback.steps),
    cfgScale: finiteNumber(params.cfgScale, fallback.cfgScale),
    width: finiteInt(params.width, fallback.width),
    height: finiteInt(params.height, fallback.height),
    sampler: nonEmptyString(params.sampler, fallback.sampler),
    scheduler: typeof params.scheduler === 'string' ? params.scheduler : fallback.scheduler,
    seed: finiteInt(params.seed, fallback.seed),
    batchSize: finiteInt(params.batchSize, fallback.batchSize),
    iterations: finiteInt(params.iterations, fallback.iterations),
    clipSkip: normalizeClipSkip(params.clipSkip ?? fallback.clipSkip),
    denoisingStrength: finiteNumber(params.denoisingStrength, fallback.denoisingStrength)
  }
}

function mergeGenerationParams(
  current: GenerationParams,
  patch: Partial<GenerationParams>
): GenerationParams {
  const next: Partial<GenerationParams> = { ...current }
  for (const [key, value] of Object.entries(patch) as Array<[keyof GenerationParams, unknown]>) {
    if (value === undefined || value === null) continue
    ;(next as Record<keyof GenerationParams, unknown>)[key] = value
  }
  return normalizeGenerationParams(next, current)
}

function finiteNumber(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function finiteInt(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n) : fallback
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

export const useStore = create<AppState>((set) => ({
  currentTab: 'txt2img',
  setCurrentTab: (t) => set({ currentTab: t }),
  generationMode: 'create',
  setGenerationMode: (mode) => set({ generationMode: mode }),

  dynThres: DEFAULT_DYN_THRES,
  patchDynThres: (patch) => set((s) => ({ dynThres: { ...s.dynThres, ...patch } })),

  freeu: DEFAULT_FREEU,
  patchFreeu: (patch) => set((s) => ({ freeu: { ...s.freeu, ...patch } })),

  adetailer: DEFAULT_ADETAILER,
  patchAdetailer: (patch) => set((s) => ({ adetailer: { ...s.adetailer, ...patch } })),
  patchAdetailerUnit: (index, patch) => set((s) => ({
    adetailer: {
      ...s.adetailer,
      units: s.adetailer.units.map((u, i) => i === index ? { ...u, ...patch } : u)
    }
  })),
  addAdetailerUnit: () => set((s) => ({
    adetailer: {
      ...s.adetailer,
      // Cap at 4 — that's what ADetailer's own UI does, more units rarely help.
      units: s.adetailer.units.length >= 4
        ? s.adetailer.units
        : [...s.adetailer.units, { ...DEFAULT_ADETAILER_UNIT, model: 'hand_yolov8n.pt' }]
    }
  })),
  removeAdetailerUnit: (index) => set((s) => ({
    adetailer: {
      ...s.adetailer,
      units: s.adetailer.units.length <= 1
        ? s.adetailer.units // never remove the last one — keep at least one slot
        : s.adetailer.units.filter((_, i) => i !== index)
    }
  })),

  controlnet: DEFAULT_CONTROLNET,
  controlnetModelList: [],
  controlnetModuleList: [],
  setControlnetCatalogs: (models, modules) => set({ controlnetModelList: models, controlnetModuleList: modules }),
  patchControlnet: (patch) => set((s) => ({ controlnet: { ...s.controlnet, ...patch } })),
  patchControlnetUnit: (index, patch) => set((s) => ({
    controlnet: {
      ...s.controlnet,
      units: s.controlnet.units.map((u, i) => i === index ? { ...u, ...patch } : u)
    }
  })),
  addControlnetUnit: () => set((s) => ({
    controlnet: {
      ...s.controlnet,
      // Forge defaults to control_net_unit_count=3; cap matches that so the
      // user doesn't add units Forge will silently ignore.
      units: s.controlnet.units.length >= 3
        ? s.controlnet.units
        : [...s.controlnet.units, DEFAULT_CONTROLNET_UNIT]
    }
  })),
  removeControlnetUnit: (index) => set((s) => ({
    controlnet: {
      ...s.controlnet,
      units: s.controlnet.units.length <= 1
        ? s.controlnet.units
        : s.controlnet.units.filter((_, i) => i !== index)
    }
  })),

  regionalPrompter: DEFAULT_REGIONAL_PROMPTER,
  patchRegionalPrompter: (patch) => set((s) => ({
    regionalPrompter: { ...s.regionalPrompter, ...patch }
  })),

  fabric: DEFAULT_FABRIC,
  patchFabric: (patch) => set((s) => ({
    fabric: { ...s.fabric, ...patch }
  })),

  upscale: DEFAULT_UPSCALE,
  upscalerList: [],
  setUpscalerList: (names) => set({ upscalerList: names }),
  patchUpscale: (patch) => set((s) => ({ upscale: { ...s.upscale, ...patch } })),

  forgeStatus: { kind: 'stopped' },
  setForgeStatus: (s) => set({ forgeStatus: s }),

  models: [],
  samplers: [],
  schedulers: [],
  vaes: [],
  selectedVae: 'Automatic',
  selectedModelTitle: null,
  setModels: (m) => set({ models: m }),
  setSamplers: (s) => set({ samplers: s }),
  setSchedulers: (s) => set({ schedulers: s }),
  setVaes: (v) => set({ vaes: v }),
  setSelectedVae: (name) => set({ selectedVae: name }),
  setSelectedModel: (title) => set({ selectedModelTitle: title }),

  recommendation: null,
  recommendationLoading: false,
  setRecommendation: (r) => set({ recommendation: r }),
  setRecommendationLoading: (b) => set({ recommendationLoading: b }),
  communityStats: null,
  communityStatsLoading: false,
  setCommunityStats: (s) => set({ communityStats: s }),
  setCommunityStatsLoading: (b) => set({ communityStatsLoading: b }),

  prompt: '',
  negativePrompt: '',
  params: defaultParams,
  setPrompt: (p) => set({ prompt: p }),
  setNegativePrompt: (p) => set({ negativePrompt: p }),
  patchParams: (p) => set((s) => ({ params: mergeGenerationParams(s.params, p) })),

  isGenerating: false,
  progress: null,
  lastImage: null,
  lastImageHistoryId: null,
  setGenerating: (b) => set({ isGenerating: b, progress: b ? null : null }),
  setProgress: (p) => set({ progress: p }),
  setLastImage: (s, historyId = null) => set({ lastImage: s, lastImageHistoryId: s ? historyId ?? null : null }),

  inputImage: null,
  inputImageFilename: null,
  inputImagePath: null,
  inputImageHistoryId: null,
  setInputImage: (image, filename = null, sourcePath = null, historyId = null) =>
    // Always clear the extracted tags AND any PNG insight when the input
    // image changes — both are tied to the previously-set image.
    set({
      inputImage: image,
      inputImageFilename: image ? filename : null,
      inputImagePath: image ? sourcePath ?? null : null,
      inputImageHistoryId: image ? historyId ?? null : null,
      inpaintMaskImage: null,
      extractedTags: [],
      droppedInsight: null,
      droppedInsightLoading: false
    }),
  inpaintMaskImage: null,
  setInpaintMaskImage: (image) => set({ inpaintMaskImage: image }),

  extractedTags: [],
  setExtractedTags: (tags) => set({ extractedTags: tags }),

  droppedInsight: null,
  droppedInsightLoading: false,
  setDroppedInsight: (i) => set({ droppedInsight: i }),
  setDroppedInsightLoading: (b) => set({ droppedInsightLoading: b }),

  history: [],
  presets: [],
  setHistory: (h) => set({ history: h }),
  setPresets: (p) => set({ presets: p }),

  library: [],
  customLibrary: [],
  autocomplete: new Map(),
  setLibrary: (c, ac) => set({ library: c, autocomplete: ac }),
  setCustomLibrary: (c) =>
    set((s) => {
      // Rebuild autocomplete to include user-added tags. Built-in tags take
      // precedence (the YAML translations are curated); user duplicates only
      // add when they introduce a new key.
      const next = new Map(s.autocomplete)
      for (const cat of c) {
        for (const g of cat.groups) {
          for (const t of g.tags) {
            if (!next.has(t.en)) next.set(t.en, t.ja ?? '')
          }
        }
      }
      return { customLibrary: c, autocomplete: next }
    }),

  favorites: new Set(),
  setFavorites: (f) => set({ favorites: f }),
  toggleFavorite: (en) =>
    set((s) => {
      const next = new Set(s.favorites)
      if (next.has(en)) next.delete(en)
      else next.add(en)
      return { favorites: next }
    }),

  recentTags: [],
  pushRecentTag: (en) =>
    set((s) => {
      const filtered = s.recentTags.filter((t) => t !== en)
      return { recentTags: [en, ...filtered].slice(0, 60) }
    }),

  quickPresets: [],
  setQuickPresets: (p) => set({ quickPresets: p }),
  hiddenQuickPresetIds: new Set(),
  setHiddenQuickPresetIds: (s) => set({ hiddenQuickPresetIds: s }),
  toggleHiddenQuickPreset: (id) =>
    set((s) => {
      const next = new Set(s.hiddenQuickPresetIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { hiddenQuickPresetIds: next }
    }),

  loras: [],
  loraMeta: new Map(),
  activeLoras: [],
  loraFavorites: new Set(),
  loraSuggestions: [],
  loraUsage: [],
  setLoras: (l) => set({ loras: l }),
  upsertLoraMeta: (name, m) =>
    set((s) => {
      const next = new Map(s.loraMeta)
      next.set(name, m)
      return { loraMeta: next }
    }),
  setActiveLoras: (a) => set({ activeLoras: a }),
  toggleActiveLora: (lora, weight = 0.8, triggerWords = []) =>
    set((s) => {
      const exists = s.activeLoras.some((a) => a.name === lora.name)
      return {
        activeLoras: exists
          ? s.activeLoras.filter((a) => a.name !== lora.name)
          : [...s.activeLoras, {
              name: lora.name,
              tokenName: lora.tokenName ?? lora.name,
              sourceRoot: lora.sourceRoot,
              adapterSubtype: lora.adapterSubtype,
              weight,
              triggerWords
            }]
      }
    }),
  patchActiveLora: (name, patch) =>
    set((s) => ({
      activeLoras: s.activeLoras.map((a) => (a.name === name ? { ...a, ...patch } : a))
    })),
  removeActiveLora: (name) =>
    set((s) => ({ activeLoras: s.activeLoras.filter((a) => a.name !== name) })),
  setLoraFavorites: (f) => set({ loraFavorites: f }),
  toggleLoraFavorite: (name) =>
    set((s) => {
      const next = new Set(s.loraFavorites)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return { loraFavorites: next }
    }),
  setLoraSuggestions: (s) => set({ loraSuggestions: s }),
  setLoraUsage: (u) => set({ loraUsage: u }),

  settings: null,
  setSettings: (s) => set({ settings: s }),

  civitaiSearch: { open: false, initialType: null },
  openCivitaiSearch: (type = null) =>
    set({ civitaiSearch: { open: true, initialType: type } }),
  closeCivitaiSearch: () =>
    set((s) => ({ civitaiSearch: { open: false, initialType: s.civitaiSearch.initialType } })),

  modelUpdates: new Map(),
  setModelUpdates: (updates) => {
    // Map by title would be ideal, but we only have sha256/modelId — match
    // against models[] at consumption time. Store the raw list in a Map
    // keyed by sha256 for fast lookup.
    const m = new Map<string, ModelUpdateInfo>()
    for (const u of updates) m.set(u.sha256, u)
    set({ modelUpdates: m })
  },

  civitaiTags: [],
  setCivitaiTags: (tags) => set({ civitaiTags: tags })
}))
