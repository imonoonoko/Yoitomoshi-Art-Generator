// Types shared between main and renderer processes via IPC.

export type ForgeStatus =
  | { kind: 'stopped' }
  | { kind: 'starting'; phase: string; logTail: string[] }
  | { kind: 'ready'; port: number; url: string; brokenExtensions: string[] }
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

export interface SdLora {
  name: string                  // unique identifier (filename stem in Forge)
  alias: string                 // display name (often = name)
  path: string                  // absolute path on disk
  /** Metadata embedded in the safetensors file (training info, ss_*) */
  metadata?: Record<string, unknown>
}

export interface LoraCivitaiMetadata {
  modelName: string
  versionName: string
  baseModel: string
  trainedWords: string[]        // trigger words to insert with this LoRA
  /** Civitai's category tags ("character", "style", "concept", "clothing"…) */
  tags: string[]
  thumbnailUrl: string | null
  civitaiUrl: string | null
  fetchedAt: number
}

/** A LoRA the user has activated for the next generation. */
export interface ActiveLora {
  name: string                  // SdLora.name
  weight: number                // 0.0..1.5 typical, slider clamped to 0..2
  /** Trigger words captured at activation; used for auto-insertion / removal. */
  triggerWords: string[]
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
  textinfo: string | null
}

export interface HistoryItem {
  id: string
  createdAt: number
  label?: HistoryLabel | null
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
    model: string | null
    vae?: string | null
    clipSkip?: number
    denoisingStrength?: number
    activeLoras?: ActiveLora[]
  }
  imagePath: string          // absolute path on disk
  thumbDataUrl: string       // small embedded thumbnail
}

export type HistoryLabel = 'favorite' | 'candidate' | 'rejected' | 'asset'

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

export interface PromptGroupTag {
  en: string
  ja: string
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
  civitai?: {
    url?: string
    expectedSha256?: string | null
  }
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

export interface ModelHashResult {
  entryId: string
  path: string
  sha256: string
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

export interface WorkspaceImageReferences {
  inputImage?: WorkspaceImageReference | null
  inpaintMask?: WorkspaceImageReference | null
  lastImage?: WorkspaceImageReference | null
  upscaleInputImage?: WorkspaceImageReference | null
  upscaleOutputImage?: WorkspaceImageReference | null
  controlnetUnits?: Array<WorkspaceImageReference | null>
}

export interface WorkspaceSnapshot {
  imageSaveMode?: WorkspaceImageSaveMode
  imageReferences?: WorkspaceImageReferences
  currentTab: 'txt2img' | 'img2img' | 'upscale' | 'tools'
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
  controlnet: Record<string, unknown>
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

export interface UpscaleComparisonCandidate {
  denoise: number
  tileControlNetEnabled: boolean
  imageDataUrl: string
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
