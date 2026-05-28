// Types shared between main and renderer processes via IPC.

export type ForgeStatus =
  | { kind: 'stopped' }
  | { kind: 'starting'; phase: string; logTail: string[] }
  | { kind: 'ready'; port: number; url: string; brokenExtensions: string[]; logTail?: string[] }
  | { kind: 'error'; message: string; logTail: string[] }

export interface StartupMetrics {
  processStartedAt: number
  appReadyAt: number | null
  windowCreatedAt: number | null
  rendererLoadStartedAt: number | null
  rendererLoadedAt: number | null
  readyToShowAt: number | null
  windowShownAt: number | null
  ipcRegisteredAt: number | null
  forgeAutoStartRequestedAt: number | null
  forgeLastStatusAt: number | null
  forgeReadyAt: number | null
  forgeLastStatusKind: ForgeStatus['kind'] | null
}

export interface StartupMetricsSample {
  capturedAt: number
  processStartedAt: number
  appReadyMs: number | null
  ipcRegisteredMs: number | null
  rendererLoadedMs: number | null
  windowShownMs: number | null
  forgeAutoStartRequestedMs: number | null
  forgeReadyMs: number | null
  forgeLastStatusKind: ForgeStatus['kind'] | null
}

export interface SdModel {
  title: string         // "model.safetensors [hash]"
  modelName: string     // base filename without extension
  filename: string      // full path
  hash: string | null   // short hash from Forge
  sha256: string | null // resolved later from Civitai or computed
}

export interface SdSampler {
  name: string
  aliases: string[]
}

export interface SdVae {
  /** Human-readable name as Forge reports it. "Automatic" / "None" are special. */
  modelName: string
  /** Absolute path on disk (empty for built-in / Automatic / None). */
  filename: string
}

export interface CivitaiRecommended {
  // Resolved from Civitai's modelVersion data
  modelName: string
  versionName: string
  /** Civitai modelVersion ID — needed to mine community images via /api/v1/images */
  modelVersionId: number
  /** Civitai parent model ID — used for update-check (compare latest version against ours). */
  modelId: number
  baseModel: string             // "SD 1.5" | "SDXL 1.0" | "Pony" | "Illustrious" etc.
  creator?: string | null
  description?: string | null
  tags?: string[]
  trainedWords: string[]        // trigger tokens
  // Inferred from Civitai's images metadata (median across non-NSFW samples)
  suggested: {
    sampler: string | null
    steps: number | null
    cfgScale: number | null
    width: number | null
    height: number | null
    clipSkip: number | null
    negativePrompt: string | null
  }
  /**
   * LoRAs that appear in this checkpoint's Civitai sample images.
   * Used as the dominant signal in LoRA auto-suggestion (+200 in scoring).
   */
  recommendedLoras: { name: string; weight: number; frequency: number }[]
  /**
   * VAE the model creator/community recommends for this checkpoint. Sourced
   * (in priority order) from:
   *   1. Civitai's structured `version.files[]` of type "VAE" — the
   *      "Optional Files" panel on the model page.
   *   2. The most-frequent `meta.VAE` value across the sample images.
   *
   * `downloadUrl` is set when (1) provided one (so the UI can offer a
   * one-click "推奨 VAE をダウンロード" button); for (2) it's null and the
   * user has to find the file themselves.
   */
  recommendedVae: { name: string; downloadUrl: string | null; sizeBytes: number | null } | null
  thumbnailUrl: string | null
  civitaiUrl: string | null
  fetchedAt: number
}

/**
 * Aggregated statistics from mining a checkpoint's community images via
 * `/api/v1/images?modelVersionId=`. Covers 100-1000+ images depending on
 * the model's popularity, vs. ~5-20 from the official sample set.
 *
 * Generated asynchronously after the basic recommendation loads, so callers
 * should expect this to be null on first render and populate later.
 */
export interface CivitaiCommunityStats {
  modelVersionId: number
  /** Number of community images aggregated. */
  sampleCount: number
  fetchedAt: number
  /** Top samplers across the sample set, sorted by frequency. */
  topSamplers: { name: string; freq: number }[]
  /** Steps distribution (median + interquartile range). */
  stepsDist: Distribution
  cfgDist: Distribution
  clipSkipDist: Distribution
  /** Most-common (width, height) pairs. */
  topSizes: { width: number; height: number; freq: number }[]
  /**
   * LoRAs aggregated from `meta.resources` (preferred) and prompt regex (fallback).
   * `civitai` is resolved via identifyByName at mining time so the UI can offer
   * one-click download for community-popular LoRAs the user doesn't have.
   */
  topLoras: { name: string; freq: number; medianWeight: number; civitai?: CivitaiQuickRef | null }[]
  topVaes: { name: string; freq: number; civitai?: CivitaiQuickRef | null }[]
  /**
   * Frequent positive-prompt phrases (1-3 grams) appearing in ≥30% of samples.
   * Useful for building model-specific "quick presets".
   */
  commonPositivePhrases: { phrase: string; freq: number }[]
  commonNegativePhrases: { phrase: string; freq: number }[]
}

export interface Distribution {
  /** Number of samples that contributed to this distribution. */
  n: number
  median: number | null
  /** Lower quartile (25th percentile). */
  q1: number | null
  /** Upper quartile (75th percentile). */
  q3: number | null
  min: number | null
  max: number | null
}

// -------------------- LoRA --------------------

export type AdapterSourceRoot = 'Lora' | 'LyCORIS'

export type AdapterSubtype =
  | 'LoRA'
  | 'LoCon'
  | 'LoHa'
  | 'LoKr'
  | 'DoRA'
  | 'GLoRA'
  | 'BOFT'
  | 'LyCORIS'
  | 'Unknown'

export interface SdLora {
  name: string                  // unique identifier in the app
  /** Name to put inside <lora:...>. Differs from name only when roots collide. */
  tokenName?: string
  alias: string                 // display name (often = name)
  path: string                  // absolute path on disk
  sourceRoot?: AdapterSourceRoot
  adapterSubtype?: AdapterSubtype
  sha256?: string | null
  baseModelHint?: string | null
  /** Metadata embedded in the safetensors file (training info, ss_*) */
  metadata?: Record<string, unknown>
}

export interface LoraCivitaiMetadata {
  modelId?: number
  modelVersionId?: number
  modelName: string
  versionName: string
  baseModel: string
  trainedWords: string[]        // trigger words to insert with this LoRA
  /** Plain-text Civitai model description, used to mine usage hints. */
  description?: string | null
  descriptionSource?: 'model' | 'version' | 'none'
  /** Positive prompt snippets inferred from the description's recommended prompt sections. */
  recommendedPrompts?: string[]
  /** Civitai's category tags ("character", "style", "concept", "clothing"…) */
  tags: string[]
  files?: CivitaiSearchFile[]
  availability?: {
    primaryFileSha256: string | null
    primaryFileName: string | null
    primaryFileFormat: string | null
    pickleScanResult: string | null
    virusScanResult: string | null
  }
  usage?: {
    allowNoCredit: boolean | null
    allowCommercialUse: string | null
    allowDerivatives: boolean | null
    allowDifferentLicense: boolean | null
  }
  thumbnailUrl: string | null
  civitaiUrl: string | null
  fetchedAt: number
}

/** A LoRA the user has activated for the next generation. */
export interface ActiveLora {
  name: string                  // SdLora.name
  tokenName?: string
  sourceRoot?: AdapterSourceRoot
  adapterSubtype?: AdapterSubtype
  weight: number                // 0.0..1.5 typical, slider clamped to 0..2
  /** Trigger words captured at activation; used for auto-insertion / removal. */
  triggerWords: string[]
}

export interface LoraPromptOverride {
  /** Stable storage key. Prefer sha256 when available, otherwise name/path fallback. */
  id: string
  loraName: string
  loraAlias?: string
  loraPath?: string
  loraSha256?: string | null
  /** Manual positive prompt snippets to append when this LoRA is selected. */
  positivePrompt: string
  /** Optional manual negative prompt snippets to append when this LoRA is selected. */
  negativePrompt: string
  /** Optional default LoRA weight. Null means use the app default. */
  weight: number | null
  /** Optional generation defaults to apply when this LoRA is selected. */
  sampler?: string
  steps?: number | null
  cfgScale?: number | null
  clipSkip?: number | null
  autoApply: boolean
  updatedAt: number
}

export type CheckpointPromptFamily =
  | 'pony'
  | 'illustrious'
  | 'noobai'
  | 'animagine'
  | 'sdxl'
  | 'sd15'
  | 'flux'
  | 'custom'

export type CheckpointPromptProfileMode = 'manual' | 'suggest' | 'auto'
export type CheckpointPromptStyle = 'tag' | 'natural' | 'structured' | 'hybrid'
export type CheckpointNegativeStrategy = 'classic' | 'minimal' | 'positive-replacement'

export interface CheckpointRecommendedAspectRatio {
  label: string
  width: number
  height: number
}

export type CheckpointRelatedModelKind = 'lora' | 'vae' | 'controlnet'

export interface CheckpointRelatedModelReference {
  kind: CheckpointRelatedModelKind
  name: string
  path?: string | null
  sha256?: string | null
  role?: string | null
  weight?: number | null
  notes?: string[]
}

export interface CheckpointRelatedModels {
  loras: CheckpointRelatedModelReference[]
  vaes: CheckpointRelatedModelReference[]
  controlNets: CheckpointRelatedModelReference[]
}

export interface CheckpointPromptProfile {
  /** Stable storage key. Prefer sha256 when available, otherwise checkpoint name fallback. */
  id: string
  checkpointTitle: string
  checkpointName?: string
  checkpointPath?: string
  checkpointSha256?: string | null
  baseModel?: string | null
  family: CheckpointPromptFamily
  promptStyle?: CheckpointPromptStyle
  negativeStrategy?: CheckpointNegativeStrategy
  /** Tags placed at the beginning of the positive prompt. */
  positivePrefix: string[]
  /** Tags appended after the user's positive prompt. */
  positiveAppend: string[]
  /** Tags appended to the negative prompt. */
  negativeAppend: string[]
  /** Optional generation defaults to apply/suggest with this checkpoint. */
  sampler?: string
  steps?: number | null
  cfgScale?: number | null
  width?: number | null
  height?: number | null
  clipSkip?: number | null
  recommendedAspectRatios?: CheckpointRecommendedAspectRatio[]
  recommendedLoraCount?: { min: number; max: number } | null
  relatedModels?: CheckpointRelatedModels
  compatibilityNotes?: string[]
  recipeNotes?: string[]
  /** manual = saved for button use only; suggest = Preflight suggests; auto = apply before generation. */
  mode: CheckpointPromptProfileMode
  updatedAt: number
}

/** Scored LoRA candidate for auto-suggestion. */
export interface ScoredLora {
  lora: SdLora
  meta: LoraCivitaiMetadata | null
  score: number
  /** Human-readable score breakdown for tooltip ("+200 モデル推奨, ...") */
  reasons: string[]
}

/**
 * One row in the local LoRA usage log. Stored per-generation in storage so the
 * suggestion engine can boost LoRAs the user has used recently with the same
 * checkpoint or on similar prompts.
 */
export interface LoraUsageRecord {
  loraName: string
  checkpointTitle: string
  promptDigest: string          // 40-char prefix of normalized prompt (for cheap similarity)
  weight: number
  timestamp: number
}

/**
 * Forge "alwayson_scripts" payload — the standard A1111/Forge mechanism for
 * extensions that hook every generation. The key is the script's `title()`,
 * the value's `args` are the positional arguments the script's `process_*`
 * methods expect (in the order returned by the script's `ui()` method).
 *
 * Example:
 *   alwayson_scripts: {
 *     "DynamicThresholding (CFG-Fix) Integrated": {
 *       args: [true, 7.0, 1.0, "Constant", 0.0, ...]
 *     }
 *   }
 */
export type AlwaysOnScripts = Record<string, { args: unknown[] }>

export type VideoOutputFormat = 'GIF' | 'MP4' | 'WEBP' | 'WEBM'

export interface VideoMotionModule {
  name: string
  path: string
  sizeBytes: number
}

export interface ForgeVideoSupportInfo {
  forgePath: string
  extension: {
    installed: boolean
    enabled: boolean
    name: string | null
    path: string | null
    disabledPath: string | null
  }
  modelDir: string | null
  motionModules: VideoMotionModule[]
  apiScript: {
    checked: boolean
    available: boolean
    txt2imgName: string | null
    img2imgName: string | null
  }
  warnings: string[]
}

export interface VideoRuntimeGpuInfo {
  name: string
  driverVersion: string | null
  memoryTotalMiB: number | null
  memoryUsedMiB: number | null
  memoryFreeMiB: number | null
  utilizationGpuPercent: number | null
  temperatureC: number | null
}

export interface VideoRuntimeDiagnostics {
  checkedAt: number
  dataRoot: string
  dataRootFreeBytes: number | null
  systemMemoryTotalBytes: number | null
  gpus: VideoRuntimeGpuInfo[]
  warnings: string[]
}

export interface FramePackSupportInfo {
  configuredPath: string | null
  pathExists: boolean
  runBatPath: string | null
  updateBatPath: string | null
  outputDir: string | null
  canLaunch: boolean
  warnings: string[]
}

export interface Txt2ImgRequest {
  prompt: string
  negative_prompt: string
  steps: number
  cfg_scale: number
  width: number
  height: number
  sampler_name: string
  scheduler?: string
  seed: number               // -1 for random
  batch_size: number
  n_iter: number
  /**
   * Per-request setting overrides — applied for the duration of this call
   * only. Common fields:
   *   - sd_model_checkpoint   pin generation to a specific checkpoint
   *   - sd_vae                override the checkpoint's built-in VAE
   *   - CLIP_stop_at_last_layers   "clip skip" value
   * Forge accepts arbitrary keys here (anything in shared.opts), so we keep
   * it open to extension instead of locking to a few known keys.
   */
  override_settings?: Record<string, string | number>
  override_settings_restore_afterwards?: boolean
  alwayson_scripts?: AlwaysOnScripts
  /**
   * Selectable script — one script is run as the primary pipeline (vs
   * `alwayson_scripts` which augment a regular generation). Used for
   * "Ultimate SD upscale" and similar workflow scripts that want to take
   * over the request rather than tweak it. Title must match the script's
   * `title()` exactly.
   */
  script_name?: string
  /** Positional arguments for the selectable script. */
  script_args?: unknown[]
}

export interface Img2ImgRequest extends Txt2ImgRequest {
  init_images: string[]      // base64-encoded (NO data: prefix)
  denoising_strength: number // 0..1
  resize_mode?: number       // 0=just resize, 1=crop and resize, 2=resize and fill
  mask?: string              // optional inpaint mask
  inpainting_fill?: number
  mask_blur?: number
}

export interface Txt2ImgResponse {
  images: string[]           // base64 PNGs
  parameters: Record<string, unknown>
  info: string               // JSON string with detailed metadata
}

export type Img2ImgResponse = Txt2ImgResponse

export interface InterrogateResult {
  caption: string            // raw return — comma-separated for danbooru, sentence for clip
  tags: string[]             // parsed from caption (danbooru-style)
  model: 'clip' | 'deepdanbooru'
}

export interface ControlNetDetectRequest {
  image: string
  module: string
  processorRes: number
  thresholdA: number
  thresholdB: number
  resizeMode: number
}

export interface ControlNetDetectResult {
  image: string
  module: string
}

export interface GenerationProgress {
  progress: number           // 0..1
  eta_relative: number
  state: {
    sampling_step: number
    sampling_steps: number
    job: string
  }
  current_image: string | null  // base64 preview
  current_image_mime?: string | null
  current_image_node_id?: string | null
  textinfo: string | null
}

export interface HistoryItem {
  id: string
  createdAt: number
  label?: HistoryLabel | null
  tagReview?: HistoryTagReview | null
  proRecipeReview?: HistoryProRecipeReview | null
  dynamicPrompt?: HistoryDynamicPromptMeta | null
  prompt: string
  negativePrompt: string
  params: {
    steps: number
    cfgScale: number
    width: number
    height: number
    sampler: string
    scheduler?: string
    seed: number
    batchSize?: number
    imageIndex?: number
    imageCount?: number
    iterationIndex?: number
    iterationCount?: number
    model: string | null
    vae?: string | null
    clipSkip?: number
    denoisingStrength?: number
    activeLoras?: ActiveLora[]
    upscale?: {
      engine: 'forge'
      method: string
      mode?: string | null
      scale: number
      upscaler?: string | null
      outputWidth?: number | null
      outputHeight?: number | null
      tileWidth?: number | null
      tileHeight?: number | null
      tileOverlap?: number | null
    } | null
    controlNet?: {
      module: string
      model: string
      resolvedModel?: string
      weight: number
      guidanceStart: number
      guidanceEnd: number
      ignoredUnitCount?: number
      unitCount?: number
      units?: Array<{
        module: string
        model: string
        resolvedModel?: string
        imageMode?: 'canny' | 'preprocessed'
        weight: number
        guidanceStart: number
        guidanceEnd: number
      }>
      warnings?: string[]
    } | null
  }
  imagePath: string          // absolute path on disk
  thumbDataUrl: string       // small embedded thumbnail
}

export interface HistoryDynamicPromptMeta {
  templatePrompt: string
  templateNegativePrompt?: string
  resolvedPrompt: string
  resolvedNegativePrompt?: string
  promptSeed: number
  usedWildcards: string[]
}

export type HistoryLabel = 'favorite' | 'candidate' | 'rejected' | 'asset' | 'social' | 'reference'

export interface HistoryTagReview {
  acceptedTags: string[]
  rejectedTags: string[]
  sourceModel: 'pixai-onnx' | 'manual'
  updatedAt: number
}

export interface HistoryProRecipeReview {
  rating?: number | null
  strengths: string[]
  issues: string[]
  nextActions: string[]
  scores?: {
    thumbnail?: number | null
    composition?: number | null
    lighting?: number | null
    color?: number | null
    anatomy?: number | null
    styleConsistency?: number | null
    reusePotential?: number | null
  }
  parentHistoryId?: string | null
  updatedAt: number
}

export interface PromptPreset {
  id: string
  name: string
  prompt: string
  negativePrompt: string
  createdAt: number
  updatedAt: number
}

/**
 * Quick preset = a small named snippet that the user toggles into either the
 * positive or the negative prompt with a single click. Distinct from PromptPreset
 * which is a full prompt+negative pair the user saves and loads as a whole.
 */
export interface QuickPreset {
  id: string
  name: string
  text: string
  target: 'positive' | 'negative'
  builtIn: boolean              // bundled defaults can't be edited but can be hidden
  /** Higher number = sorted earlier in the bar */
  order: number
}

export type PromptComposerSlotKey =
  | 'qualityPrefix'
  | 'subject'
  | 'composition'
  | 'expressionPose'
  | 'lighting'
  | 'color'
  | 'clothingProps'
  | 'background'
  | 'textureStyle'
  | 'finishing'
  | 'avoidFailures'

export type PromptComposerSlots = Partial<Record<PromptComposerSlotKey, string>>

export interface PromptComposerSlotTemplate {
  id: string
  name: string
  slots: PromptComposerSlots
  family: CheckpointPromptFamily | null
  promptStyle: CheckpointPromptStyle | null
  negativeStrategy: CheckpointNegativeStrategy | null
  notes: string
  createdAt: number
  updatedAt: number
  lastUsedAt: number | null
}

export interface PromptComposerSlotTemplateSaveInput {
  id?: string
  name: string
  slots: PromptComposerSlots
  family?: CheckpointPromptFamily | null
  promptStyle?: CheckpointPromptStyle | null
  negativeStrategy?: CheckpointNegativeStrategy | null
  notes?: string
  lastUsedAt?: number | null
}

export type PromptTagPolarity = 'positive' | 'negative' | 'both'

export type PromptTagSourceKind =
  | 'built-in'
  | 'manual'
  | 'import'
  | 'civitai'
  | 'tagger'
  | 'history'
  | 'migration'

export interface PromptTagSource {
  kind: PromptTagSourceKind
  model?: string
  confidence?: number
  at?: string
}

export interface PromptTagUsage {
  count: number
  lastUsedAt: number | null
}

export interface PromptGroupTag {
  en: string
  ja: string
  canonical?: string
  aliases?: string[]
  polarity?: PromptTagPolarity
  modelFamilies?: string[]
  source?: PromptTagSource[]
  usage?: PromptTagUsage
}

export interface PromptGroup {
  name: string
  color: string
  tags: PromptGroupTag[]
}

export interface PromptCategory {
  name: string
  groups: PromptGroup[]
  /** True for user-added categories from custom-prompt-library.json. */
  editable?: boolean
}

export interface PromptLibraryDocumentV2 {
  schemaVersion: 2
  updatedAt: string
  categories: PromptCategory[]
}

export interface PromptDictionarySearchRequest {
  query: string
  limit?: number
  polarity?: PromptTagPolarity
  adult?: 'all' | 'safe' | 'adult'
  sourceIds?: string[]
}

export interface PromptDictionaryEntry {
  en: string
  ja: string
  meaning?: string
  aliases: string[]
  category: string
  group: string
  polarity: PromptTagPolarity
  sourceKind: 'built-in' | 'custom'
  sourceId: string
  sourceLabel: string
  adultLevel: number
  postCount?: number | null
  score: number
}

export interface PromptDictionarySearchResult {
  query: string
  total: number
  returned: number
  searchableCount: number
  entries: PromptDictionaryEntry[]
}

export type PromptDictionarySourceType = 'api' | 'dataset' | 'local' | 'manual' | 'blocked'
export type PromptDictionarySourceAllowedMode = 'enabled' | 'manual-only' | 'disabled'
export type PromptDictionarySourceQueryValue =
  | string
  | number
  | boolean
  | Array<string | number | boolean>

export interface PromptDictionarySourceDefinition {
  sourceId: string
  displayName: string
  sourceType: PromptDictionarySourceType
  allowedMode: PromptDictionarySourceAllowedMode
  baseUrl: string
  termsUrl: string
  licenseNote: string
  rateLimitRps: number
  storesRawPrompts: boolean
  storesImages: boolean
  adultPolicy: string
  checkedAt: string
  defaultQuery?: Record<string, PromptDictionarySourceQueryValue>
}

export interface PromptDictionarySourceRegistryResult {
  schemaVersion: number
  updatedAt: string
  registryPath: string
  sources: PromptDictionarySourceDefinition[]
  warnings: string[]
}

export interface PromptDictionaryIngestStatus {
  dbPath: string
  schemaVersion: number
  initializedAt: string
  registrySourceCount: number
  enabledSourceCount: number
  disabledSourceCount: number
  rawPromptRecordCount: number
  candidateTagCount: number
  translationJobCount: number
  meaningDecisionCount: number
  meaningReviewableCount: number
  latestMeaningDecisionAt: string | null
  lastRunAt: string | null
  warnings: string[]
}

export type PromptTagTranslationProvider = 'google' | 'mymemory'

export interface PromptTagTranslationRequest {
  text: string
  provider: PromptTagTranslationProvider
  from?: 'en'
  to?: 'ja'
}

export interface PromptTagTranslationResult {
  text: string
  provider: PromptTagTranslationProvider
  sourceText: string
}

export type PromptTextTranslationProvider = 'deep-translator-google'
export type PromptTextTranslationSource = 'ja' | 'auto'
export type PromptTextTranslationTarget = 'en'
export type PromptTextTranslationMode = 'whole' | 'segments'

export interface PromptTextTranslationRuntimeStatus {
  python: string | null
  pythonExists: boolean
  helperPath: string
  helperExists: boolean
  runtimeRoot: string
  dependencyRoot: string
  dependencyRootExists: boolean
  deepTranslatorReady: boolean
  preparing: boolean
  warnings: string[]
}

export interface PromptTextTranslationRequest {
  text: string
  provider?: PromptTextTranslationProvider
  source?: PromptTextTranslationSource
  target?: PromptTextTranslationTarget
  mode?: PromptTextTranslationMode
}

export interface PromptTextTranslationResult {
  translatedText: string
  provider: PromptTextTranslationProvider
  sourceText: string
  source: PromptTextTranslationSource
  target: PromptTextTranslationTarget
  mode: PromptTextTranslationMode
  cacheHit: boolean
  warnings: string[]
}

/** UI display language. Selected from the settings modal; persisted to disk. */
export type UiLanguage = 'ja' | 'en' | 'ru' | 'pt'

export interface AppSettings {
  forgePath: string                    // e.g., C:\宵灯工房アート\Yoitomoshi-Art-Generator\runtime\forge
  forgePort: number                    // default 7860
  autoStartForge: boolean
  outputDir: string                    // where generated images are saved
  civitaiApiKey: string | null         // optional, for higher rate limit
  uiLanguage: UiLanguage
  forgeExtraArgs: string               // appended to launch command
  framePackPath: string                // optional external FramePack one-click/source folder
}

export interface ModelImportResult {
  imported: { source: string; dest: string; sizeBytes: number }[]
  skipped: { source: string; reason: string }[]
  destDir: string
}

// -------------------- Civitai search + download --------------------

/** Civitai-style asset categories we know how to route into Forge folders. */
export type CivitaiAssetType =
  | 'Checkpoint'
  | 'LORA'
  | 'LoCon'
  | 'TextualInversion'
  | 'Hypernetwork'
  | 'VAE'
  | 'Controlnet'
  | 'Tagger'
  | 'Other'

export interface CivitaiSearchOptions {
  query?: string
  types?: CivitaiAssetType[]
  sort?: 'Highest Rated' | 'Most Downloaded' | 'Newest'
  period?: 'AllTime' | 'Year' | 'Month' | 'Week' | 'Day'
  nsfw?: boolean
  baseModels?: string[]
  limit?: number
  /** Page-based pagination (used when no `query` is set). */
  page?: number
  /**
   * Cursor-based pagination — REQUIRED by Civitai when `query` is set
   * (page-based returns 400 in that case). First call leaves it null;
   * subsequent calls pass the `nextCursor` from the previous response.
   */
  cursor?: string | null
}

export interface CivitaiSearchFile {
  id: number
  name: string
  type: string                // "Model" | "VAE" | ...
  sizeKB: number | null
  downloadUrl: string | null
  primary: boolean
  hashes: { sha256: string | null }
}

export interface CivitaiSearchVersion {
  id: number
  name: string
  baseModel: string
  trainedWords: string[]
  files: CivitaiSearchFile[]
  thumbnailUrl: string | null
}

export interface CivitaiSearchItem {
  id: number
  name: string
  type: CivitaiAssetType
  nsfw: boolean
  tags: string[]
  creator: string
  downloadCount: number
  thumbsUpCount: number
  thumbsDownCount: number
  versions: CivitaiSearchVersion[]
  /** URL to the model's Civitai page. */
  pageUrl: string
  /**
   * Plain-text description (HTML stripped, truncated to 800 chars). Useful
   * for surfacing usage tips / recommended pairings without leaving the app.
   */
  description: string | null
}

export interface CivitaiSearchResult {
  items: CivitaiSearchItem[]
  totalItems: number
  totalPages: number
  currentPage: number
  /** Cursor / page number for the next page, null when at the end. */
  nextPage: number | null
  /**
   * Cursor for the next page when query-based search is in use. Null when
   * no further results or when page-based pagination was used instead.
   */
  nextCursor: string | null
}

export interface CivitaiDownloadRequest {
  /** Civitai-issued download URL (resolves redirects to a CDN). */
  url: string
  /** Filename to save as, without extension cleanup (Civitai gives sane names). */
  filename: string
  /** Civitai asset category — determines which Forge models/* folder to use. */
  assetType: CivitaiAssetType
  /** Optional: SHA256 from Civitai for integrity verification post-download. */
  expectedSha256: string | null
  source?: ModelSourceMetadata
}

export interface HuggingFaceSearchOptions {
  query?: string
  assetTypes?: CivitaiAssetType[]
  limit?: number
}

export interface HuggingFaceSearchFile {
  path: string
  name: string
  sizeBytes: number | null
  downloadUrl: string
  assetType: CivitaiAssetType
}

export interface HuggingFaceSearchItem {
  repoId: string
  name: string
  author: string
  downloads: number
  likes: number
  tags: string[]
  pageUrl: string
  files: HuggingFaceSearchFile[]
}

export interface HuggingFaceSearchResult {
  items: HuggingFaceSearchItem[]
}

/**
 * Identification result for an AI-generated PNG that was dropped into the app.
 *
 * Built by querying Civitai with the metadata we extracted from the file —
 * model hash → exact match, model name → fuzzy search, each LoRA name → fuzzy
 * search. Lets the user know "what was used to generate this image" and
 * provides a one-click jump to the Civitai page (or download trigger if the
 * model isn't installed locally).
 */
export interface DroppedImageInsight {
  /** Best-effort match for the checkpoint that produced the image. */
  checkpoint: {
    nameInMetadata: string | null
    hashInMetadata: string | null
    civitai: CivitaiQuickRef | null
  }
  /** Per-LoRA match status, one entry per `<lora:>` reference in the prompt. */
  loras: Array<{
    nameInPrompt: string
    weight: number
    civitai: CivitaiQuickRef | null
  }>
  /** VAE referenced in metadata. */
  vae: {
    nameInMetadata: string | null
    civitai: CivitaiQuickRef | null
  }
}

/** Compact Civitai pointer used in DroppedImageInsight (avoids transmitting full search items). */
export interface CivitaiQuickRef {
  modelId: number
  modelVersionId: number | null
  name: string
  type: CivitaiAssetType
  baseModel: string
  thumbnailUrl: string | null
  pageUrl: string
  /** Direct download URL of the primary file, when known. */
  downloadUrl: string | null
  /** SHA-256 of the primary file, when Civitai exposes it. */
  primaryFileSha256?: string | null
  /** Civitai-reported file name(s) — used for local-presence matching. */
  filenames: string[]
}

/** Top-level Civitai tag, used to populate the tag-chip row in search. */
export interface CivitaiTag {
  name: string
  /** Number of models tagged with this — used for ordering "popular tags". */
  modelCount: number
}

/**
 * Result of a model-update check — one entry per local checkpoint that has a
 * newer version available on Civitai. Stored via storage in 24h cache so we
 * don't hammer the API every app start.
 */
export interface ModelUpdateInfo {
  /** SHA-256 of the local file (matches CivitaiRecommended cache key). */
  sha256: string
  modelId: number
  modelName: string
  /** Currently-installed version (what we have locally). */
  oldVersionId: number
  oldVersionName: string
  /** Latest version on Civitai (different from oldVersionId means update available). */
  newVersionId: number
  newVersionName: string
  /** Civitai page URL for the new version (deep link). */
  newVersionUrl: string
  /** Direct download URL for the primary file of the new version, when known. */
  newVersionDownloadUrl: string | null
}

export interface CivitaiDownloadProgress {
  /** Echoed from the request — used by UI to match progress events to a card. */
  url: string
  bytesDownloaded: number
  totalBytes: number          // 0 = server didn't send Content-Length
  done: boolean
  error?: string
  /** Final destination path on success. */
  destPath?: string
}

export type ModelLibraryEntryType =
  | CivitaiAssetType
  | 'Upscaler'
  | 'Embedding'
  | 'LyCORIS'
  | 'TextEncoder'
  | 'Unsupported'
  | 'Unknown'

export type ModelSourceProvider =
  | 'civitai'
  | 'huggingface'
  | 'local'

export interface ModelSourceMetadata {
  provider: ModelSourceProvider
  name?: string
  creator?: string
  pageUrl?: string
  downloadUrl?: string
  thumbnailUrl?: string | null
  previewPath?: string | null
  expectedSha256?: string | null
  modelId?: number
  modelVersionId?: number | null
  versionName?: string
  baseModel?: string
  repoId?: string
  filePath?: string
  description?: string | null
  tags?: string[]
  trainedWords?: string[]
  recommendedPrompts?: string[]
}

export interface ModelLibraryEntry {
  id: string
  name: string
  type: ModelLibraryEntryType
  path: string
  sizeBytes: number
  sha256: string | null
  source: 'local' | 'civitai' | 'huggingface' | 'manual'
  installedAt: number
  lastSeenAt: number
  lastModifiedAt: number | null
  sourceMeta?: ModelSourceMetadata
  previewPath?: string | null
  favorite?: boolean
  notes?: string
  civitai?: {
    url?: string
    expectedSha256?: string | null
  }
}

export interface ModelLibraryCivitaiBatchRequest {
  entryIds?: string[]
  onlyMissing?: boolean
  limit?: number
}

export interface ModelLibraryCivitaiBatchResult {
  requested: number
  attempted: number
  updated: number
  skipped: number
  notFound: number
  failed: number
  errors: Array<{
    entryId: string
    name: string
    message: string
  }>
  entries: ModelLibraryEntry[]
}

export interface ModelLibrarySummary {
  root: string
  scannedAt: number
  totals: {
    files: number
    totalBytes: number
  }
  scanStats?: {
    newFiles: number
    updatedFiles: number
    unchangedFiles: number
    removedFiles: number
    shaPreserved: number
    shaInvalidated: number
  }
  byType: Record<string, { files: number; totalBytes: number }>
  entries: ModelLibraryEntry[]
}

export type LibraryIntegritySeverity = 'info' | 'warn' | 'error'

export interface LibraryIntegrityIssue {
  severity: LibraryIntegritySeverity
  entryId?: string
  jobId?: string
  path?: string
  message: string
}

export interface LibraryIntegrityReport {
  checkedAt: number
  totals: {
    entries: number
    jobs: number
    missingFiles: number
    sizeMismatches: number
    shaMissing: number
    shaMismatches: number
    partialDownloads: number
    issues: number
  }
  issues: LibraryIntegrityIssue[]
}

export interface PartialFileDeleteResult {
  path: string
  sizeBytes: number
  deleted: boolean
}

export type ModelAutoOrganizeDetectedKind =
  | 'lora'
  | 'checkpoint'
  | 'vae'
  | 'embedding'
  | 'controlnet'
  | 'tagger'
  | 'text_encoder'
  | 'unsupported_diffusion'
  | 'unknown'

export type ModelAutoOrganizeAction = 'move' | 'keep' | 'skip'

export interface ModelAutoOrganizeItem {
  source: string
  filename: string
  sizeBytes: number
  detectedKind: ModelAutoOrganizeDetectedKind
  adapterSubtype?: AdapterSubtype
  targetType: ModelLibraryEntryType | null
  targetLabel: string | null
  targetDir: string | null
  dest: string | null
  action: ModelAutoOrganizeAction
  reason: string
}

export interface ModelAutoOrganizePlan {
  sourceDir: string
  scannedAt: number
  totals: {
    scanned: number
    movable: number
    kept: number
    skipped: number
    totalBytes: number
    movableBytes: number
  }
  items: ModelAutoOrganizeItem[]
}

export interface ModelAutoOrganizeMovedItem {
  source: string
  dest: string
  sizeBytes: number
  detectedKind: ModelAutoOrganizeDetectedKind
  adapterSubtype?: AdapterSubtype
  targetType: ModelLibraryEntryType
}

export interface ModelAutoOrganizeResult extends ModelAutoOrganizePlan {
  moved: ModelAutoOrganizeMovedItem[]
  refreshed: {
    checkpoints: boolean
    loras: boolean
    vaes: boolean
  }
}

export interface ModelHashResult {
  entryId: string
  path: string
  sha256: string
}

export interface TaggerRunRequest {
  image: string
  modelId?: 'pixai-onnx'
  generalThreshold?: number
  characterThreshold?: number
  minScore?: number
  blacklist?: string[]
  excludeMeta?: boolean
  limit?: number
}

export interface TaggerRunTag {
  name: string
  score: number
  category: 'general' | 'character' | 'other'
}

export interface TaggerRunResult {
  ok: boolean
  status: 'ok' | 'missing-model' | 'missing-runtime' | 'failed'
  modelDir: string
  modelPath: string | null
  tagsPath: string | null
  provider: string | null
  elapsedMs: number | null
  tags: TaggerRunTag[]
  suppressedTags?: TaggerRunSuppressedTag[]
  promptTags: string[]
  filter?: {
    minScore: number
    excludeMeta: boolean
    blacklist: string[]
    kept: number
    suppressed: number
  }
  message: string
  stderr?: string
}

export interface TaggerRunSuppressedTag extends TaggerRunTag {
  reason: 'blacklist' | 'low-confidence' | 'meta'
}

export interface ModelFormatConversionResult {
  sourcePath: string
  destPath: string
  stdout: string
  stderr: string
}

export interface ModelMergerSupportReport {
  forgePath: string
  extrasPath: string
  available: boolean
  functionName: string | null
  message: string
}

export interface ModelMergerEstimate {
  outputDir: string
  outputPath: string
  outputExists: boolean
  sourceModels: Array<{
    role: 'primary' | 'secondary' | 'tertiary'
    title: string
    path: string
    sizeBytes: number
  }>
  totalSourceBytes: number
  largestSourceBytes: number
  estimatedOutputBytes: number
  requiredFreeBytes: number
  freeBytes: number | null
  enoughDisk: boolean | null
  canRun: boolean
  warnings: string[]
}

export type ModelMergerInterpMethod =
  | 'No interpolation'
  | 'Weighted sum'
  | 'Add difference'

export interface ModelMergerRequest {
  primaryModelName: string
  secondaryModelName: string | null
  tertiaryModelName: string | null
  interpMethod: ModelMergerInterpMethod
  multiplier: number
  saveAsHalf: boolean
  customName: string
  checkpointFormat: 'safetensors' | 'ckpt'
  configSource: 0 | 1 | 2 | 3
  bakeInVae: string
  discardWeights: string
  saveMetadata: boolean
  addMergeRecipe: boolean
  copyMetadataFields: boolean
  metadataJson: string
}

export interface ModelMergerResult {
  outputPath: string | null
  message: string
  stdout: string
  stderr: string
}

export interface ModelMergerProgress {
  running: boolean
  startedAt: number | null
  finishedAt?: number
  logTail: string[]
  outputPath?: string | null
  error?: string
}

export interface GeneratedVideoSaveRequest {
  base64: string
  format: VideoOutputFormat
  prompt: string
  negativePrompt: string
  model: string | null
  motionModule: string
  width: number
  height: number
  frames: number
  fps: number
  seed: number
}

export interface GeneratedVideoSaveResult {
  id: string
  createdAt: number
  filePath: string
  manifestPath: string
  format: VideoOutputFormat
  sizeBytes: number
}

export interface ImportedExternalVideoResult {
  sourcePath: string
  base64: string
  format: VideoOutputFormat
  saved: GeneratedVideoSaveResult
}

export type WorkspaceImageSaveMode = 'embed' | 'references' | 'settings-only'

export type WorkspaceImageReference =
  | {
      kind: 'history'
      historyId: string
      filename?: string | null
    }
  | {
      kind: 'file'
      path: string
      filename?: string | null
      sizeBytes?: number | null
      lastModifiedAt?: number | null
    }

export type ReferenceBoardKind = 'pose' | 'color' | 'character' | 'style' | 'material' | 'other'

export type ReferenceBoardSourceType = 'history' | 'input' | 'last' | 'file' | 'manual'

export interface ReferenceBoardItem {
  id: string
  kind: ReferenceBoardKind
  imageDataUrl: string | null
  filename?: string | null
  sourceType: ReferenceBoardSourceType
  sourceLabel?: string | null
  sourceHistoryId?: string | null
  sourcePath?: string | null
  note: string
  createdAt: number
}

export interface ReferenceBoardState {
  items: ReferenceBoardItem[]
}

export interface WorkspaceImageReferences {
  inputImage?: WorkspaceImageReference | null
  inpaintMask?: WorkspaceImageReference | null
  lastImage?: WorkspaceImageReference | null
  upscaleInputImage?: WorkspaceImageReference | null
  upscaleOutputImage?: WorkspaceImageReference | null
  controlnetUnits?: Array<WorkspaceImageReference | null>
  fabricPositive?: Array<WorkspaceImageReference | null>
  fabricNegative?: Array<WorkspaceImageReference | null>
  referenceBoard?: Array<WorkspaceImageReference | null>
}

export interface WorkspaceSnapshot {
  imageSaveMode?: WorkspaceImageSaveMode
  imageReferences?: WorkspaceImageReferences
  currentTab: 'txt2img' | 'img2img' | 'dictionary' | 'tags' | 'video' | 'upscale' | 'models' | 'tools'
  prompt: string
  negativePrompt: string
  params: {
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
    denoisingStrength: number
  }
  selectedModelTitle: string | null
  selectedVae: string
  activeLoras: ActiveLora[]
  inputImageDataUrl: string | null
  inputImageFilename: string | null
  inpaintMaskImage: string | null
  lastImageDataUrl: string | null
  upscaleInputImageDataUrl: string | null
  upscaleOutputImageDataUrl: string | null
  upscale: Record<string, unknown>
  video?: Record<string, unknown>
  controlnet: Record<string, unknown>
  regionalPrompter?: Record<string, unknown>
  fabric?: Record<string, unknown>
  referenceBoard?: ReferenceBoardState
  adetailer: Record<string, unknown>
  dynThres: Record<string, unknown>
  freeu: Record<string, unknown>
}

export interface WorkspaceFile {
  id: string
  name: string
  version: 1
  createdAt: number
  updatedAt: number
  snapshot: WorkspaceSnapshot
}

export interface WorkspaceSummary {
  id: string
  name: string
  updatedAt: number
  model: string | null
  promptPreview: string
  path: string
}

export type DownloadJobStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled'

export interface DownloadJob {
  id: string
  url: string
  filename: string
  assetType: CivitaiAssetType
  status: DownloadJobStatus
  createdAt: number
  updatedAt: number
  bytesDownloaded: number
  totalBytes: number
  destPath: string
  partialPath: string
  sha256: string | null
  expectedSha256: string | null
  source?: ModelSourceMetadata
  error?: string
}

export interface ModelLibraryRecoveryResult {
  recoveredJobs: number
  completedJobsFixed: number
  metadataRefetched: number
  previewsRefetched: number
  hashesQueued: number
  hashAlreadyRunning: boolean
}

export type PersonalHealthSeverity = 'info' | 'warn' | 'error'
export type PersonalHealthRecoveryStatus = 'applied' | 'skipped' | 'failed'

export interface PersonalHealthIssue {
  id: string
  area: 'settings' | 'process' | 'download' | 'library' | 'startup' | 'forge'
  severity: PersonalHealthSeverity
  title: string
  detail: string
  action?: string
}

export interface PersonalHealthProcess {
  pid: number
  name: string
  commandLine: string
}

export interface PersonalHealthStartupSignal {
  id: 'python' | 'extensions' | 'controlnet' | 'model' | 'api'
  label: string
  severity: PersonalHealthSeverity
  confidence: 'low' | 'medium' | 'high'
  evidence: string[]
}

export interface PersonalEnvironmentHealthReport {
  checkedAt: number
  settings: {
    path: string
    exists: boolean
    parseOk: boolean
    normalizedChanged: boolean
    inlineSecretPresent: boolean
    forgePath: string
    forgePathExists: boolean
    webuiExists: boolean
    launchPyExists: boolean
    forgePort: number
    autoStartForge: boolean
    forgeExtraArgs: string
    issues: string[]
  }
  processes: {
    currentPid: number
    forgeManagedByThisApp: boolean
    relatedForgeProcesses: PersonalHealthProcess[]
    relatedElectronProcesses: PersonalHealthProcess[]
  }
  downloads: {
    total: number
    running: number
    staleRunning: number
    failed: number
    partialIssues: number
    orphanPartials: number
  }
  library: {
    entries: number
    missingFiles: number
    shaMissing: number
    partialDownloads: number
    issues: number
  }
  startup: {
    recentSamples: number
    forgeReadyAvgMs: number | null
    forgeReadyMinMs: number | null
    forgeReadyMaxMs: number | null
    rendererLoadedAvgMs: number | null
    slowForgeReady: boolean
    signals: PersonalHealthStartupSignal[]
  }
  issues: PersonalHealthIssue[]
}

export interface PersonalHealthRecoveryAction {
  id: string
  area: PersonalHealthIssue['area']
  status: PersonalHealthRecoveryStatus
  title: string
  detail: string
}

export interface PersonalEnvironmentRecoveryResult {
  checkedAt: number
  settingsNormalized: boolean
  modelLibrary: ModelLibraryRecoveryResult
  actions: PersonalHealthRecoveryAction[]
  report: PersonalEnvironmentHealthReport
}

export interface UpscaleComparisonCandidate {
  denoise: number
  tileControlNetEnabled: boolean
  imageDataUrl: string
  method?: 'simple' | 'diffusion' | 'ultimate'
  scale?: number
  upscaler?: string | null
  tileWidth?: number | null
  tileHeight?: number | null
  tileOverlap?: number | null
  ultimateMaskBlur?: number | null
  ultimatePadding?: number | null
  ultimateRedrawMode?: 0 | 1 | 2 | null
  ultimateSeamsFixType?: 0 | 1 | 2 | 3 | null
  tileControlNetModule?: string | null
  tileControlNetModel?: string | null
  tileControlNetWeight?: number | null
}

export interface UpscaleComparisonSaveRequest {
  inputImageDataUrl: string | null
  inputFilename: string | null
  method: 'simple' | 'diffusion' | 'ultimate'
  scale: number
  criteria: string
  candidates: UpscaleComparisonCandidate[]
}

export interface UpscaleComparisonSaveResult {
  id: string
  dir: string
  manifestPath: string
}

export interface CharacterCompositeSaveRequest {
  baseImageDataUrl: string
  characterImageDataUrl: string
  compositeImageDataUrl: string
  maskImageDataUrl: string
  generatedImageDataUrl?: string | null
  baseFilename?: string | null
  characterFilename?: string | null
  presetId: string
  prompt: string
  negativePrompt: string
  denoise: number
  controlNet: {
    structureModule: string
    structureModel: string
    referenceModule?: string | null
    referenceModel?: string | null
  }
  transform: {
    x: number
    y: number
    widthPct: number
    rotation: number
    flipX: boolean
    maskExpand: number
    maskFeather: number
    autoTone: boolean
    characterReference: boolean
  }
  notes?: string
}

export interface CharacterCompositeSaveResult {
  id: string
  dir: string
  manifestPath: string
  reportPath: string
}

export interface CharacterCompositeIntegrationStatus {
  checkedAt: number
  forgePath: string
  extensionsDir: string
  controlNetDir: string
  disabledExtensions: string[]
  layerDiffuse: {
    installed: boolean
    disabled: boolean
    path: string | null
  }
  ipAdapter: {
    modelCount: number
    models: string[]
  }
  controlNet: {
    modelCount: number
    tileModelCount: number
    lineartModelCount: number
    cannyModelCount: number
    depthModelCount: number
    models: string[]
  }
  icLight: {
    installed: boolean
    path: string | null
  }
  recommendations: string[]
}

export interface FabricFeedbackImageSaveResult {
  filename: string
  path: string
}
