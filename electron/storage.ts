import { safeStorage } from 'electron'
import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  AppSettings,
  CivitaiCommunityStats,
  CivitaiDownloadRequest,
  CivitaiRecommended,
  DownloadJob,
  DownloadJobStatus,
  GeneratedVideoSaveRequest,
  GeneratedVideoSaveResult,
  HistoryItem,
  HistoryProRecipeReview,
  HistoryTagReview,
  HistoryLabel,
  CheckpointPromptFamily,
  CheckpointNegativeStrategy,
  CheckpointPromptProfile,
  CheckpointPromptProfileMode,
  CheckpointPromptStyle,
  LoraCivitaiMetadata,
  LoraPromptOverride,
  LoraUsageRecord,
  ModelLibraryEntry,
  ModelSourceMetadata,
  PersonalEnvironmentHealthReport,
  PromptCategory,
  PromptGroup,
  PromptGroupTag,
  PromptLibraryDocumentV2,
  PromptComposerSlotKey,
  PromptComposerSlotTemplate,
  PromptComposerSlotTemplateSaveInput,
  PromptComposerSlots,
  PromptTagPolarity,
  PromptTagSource,
  PromptTagSourceKind,
  PromptPreset,
  QuickPreset,
  StartupMetrics,
  StartupMetricsSample,
  CharacterCompositeSaveRequest,
  CharacterCompositeSaveResult,
  UpscaleComparisonSaveRequest,
  UpscaleComparisonSaveResult,
  WorkspaceFile,
  WorkspaceSnapshot,
  WorkspaceSummary
} from '../src/shared/types.js'
import { BUILT_IN_QUICK_PRESETS } from './quick-presets.js'

const DOWNLOAD_JOB_STATUSES = new Set<DownloadJobStatus>([
  'running',
  'completed',
  'failed',
  'canceled'
])
const HISTORY_LABELS = new Set<HistoryLabel>(['favorite', 'candidate', 'rejected', 'asset', 'social', 'reference'])
const MAX_HISTORY_REVIEW_TAGS = 120
const MAX_HISTORY_REVIEW_TAG_LENGTH = 80
const MAX_HISTORY_PRO_RECIPE_ITEMS = 24
const MAX_HISTORY_PRO_RECIPE_ITEM_LENGTH = 220
const MAX_LORA_PROMPT_OVERRIDES = 1000
const MAX_LORA_OVERRIDE_PROMPT_CHARS = 4000
const MAX_CHECKPOINT_PROMPT_PROFILES = 1000
const MAX_CHECKPOINT_PROFILE_TAGS = 80
const MAX_CHECKPOINT_PROFILE_TAG_CHARS = 160
const MAX_CHECKPOINT_PROFILE_NOTES = 24
const MAX_CHECKPOINT_PROFILE_NOTE_CHARS = 260
const MAX_CHECKPOINT_PROFILE_ASPECT_RATIOS = 8
const MAX_CHECKPOINT_PROFILE_RELATED_MODELS = 24
const MAX_PROMPT_COMPOSER_SLOT_TEMPLATES = 200
const MAX_PROMPT_COMPOSER_SLOT_CHARS = 1200
const MAX_PROMPT_COMPOSER_TEMPLATE_NAME_CHARS = 100
const MAX_PROMPT_COMPOSER_TEMPLATE_NOTES_CHARS = 500
const MAX_TAG_LIBRARY_BACKUPS = 40
const PROMPT_COMPOSER_SLOT_KEYS = new Set<PromptComposerSlotKey>([
  'qualityPrefix',
  'subject',
  'composition',
  'expressionPose',
  'lighting',
  'color',
  'clothingProps',
  'background',
  'textureStyle',
  'finishing',
  'avoidFailures'
])
const PROMPT_TAG_SOURCE_KINDS = new Set<PromptTagSourceKind>([
  'built-in',
  'manual',
  'import',
  'civitai',
  'tagger',
  'history',
  'migration'
])

function normalizePromptTagCanonical(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function normalizePromptTagLookupKey(value: string): string {
  return normalizePromptTagCanonical(value).toLowerCase()
}

function sanitizePromptTagStringList(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string') continue
    const cleaned = normalizePromptTagCanonical(value)
    const key = normalizePromptTagLookupKey(cleaned)
    if (!cleaned || seen.has(key)) continue
    seen.add(key)
    out.push(cleaned)
  }
  return out.slice(0, 80)
}

function sanitizePromptTagAliases(values: unknown, canonical: string): string[] {
  const canonicalKey = normalizePromptTagLookupKey(canonical)
  return sanitizePromptTagStringList(values).filter((alias) => normalizePromptTagLookupKey(alias) !== canonicalKey)
}

function sanitizePromptTagPolarity(
  value: unknown,
  categoryName: string,
  groupName: string
): PromptTagPolarity {
  if (value === 'positive' || value === 'negative' || value === 'both') return value
  const haystack = `${categoryName} ${groupName}`.toLowerCase()
  return haystack.includes('negative') || haystack.includes('ネガティブ') ? 'negative' : 'positive'
}

function sanitizePromptTagSources(values: unknown, createdAt: string | null): PromptTagSource[] {
  if (!Array.isArray(values)) {
    return [{ kind: createdAt ? 'migration' : 'manual', confidence: 1, ...(createdAt ? { at: createdAt } : {}) }]
  }
  const out: PromptTagSource[] = []
  for (const value of values) {
    if (!value || typeof value !== 'object') continue
    const source = value as Partial<PromptTagSource>
    if (!source.kind || !PROMPT_TAG_SOURCE_KINDS.has(source.kind)) continue
    const cleaned: PromptTagSource = { kind: source.kind }
    if (typeof source.model === 'string' && source.model.trim()) cleaned.model = source.model.trim().slice(0, 160)
    if (typeof source.confidence === 'number' && Number.isFinite(source.confidence)) {
      cleaned.confidence = Math.max(0, Math.min(1, source.confidence))
    }
    if (typeof source.at === 'string' && source.at.trim()) cleaned.at = source.at.trim()
    out.push(cleaned)
  }
  return out.length > 0 ? out.slice(0, 12) : [{ kind: 'manual', confidence: 1 }]
}

/**
 * Filesystem-backed JSON storage. Phase 1 stays JSON-only — when history grows past
 * a few thousand entries we'll migrate to SQLite, but for now JSON keeps the install
 * portable (no native modules to rebuild for Electron).
 *
 * Layout under <project>/userdata/:
 *   settings.json           — app-wide settings
 *   secrets.local.json      — local-only encrypted/encoded secrets
 *   civitai/<sha256>.json   — cached model metadata
 *   history/index.json      — array of HistoryItem
 *   history/<id>.png        — full-resolution generated image
 *   presets.json            — array of PromptPreset
 */
export class Storage {
  private root: string
  private projectRoot: string

  constructor(paths: { dataRoot: string; projectRoot: string }) {
    this.root = paths.dataRoot
    this.projectRoot = paths.projectRoot
    mkdirSync(this.root, { recursive: true })
    mkdirSync(join(this.root, 'civitai'), { recursive: true })
    mkdirSync(join(this.root, 'history'), { recursive: true })
    mkdirSync(join(this.root, 'model-library'), { recursive: true })
    mkdirSync(join(this.root, 'model-library', 'previews'), { recursive: true })
    mkdirSync(join(this.root, 'downloads'), { recursive: true })
    mkdirSync(join(this.root, 'workspaces'), { recursive: true })
    mkdirSync(join(this.root, 'upscale-comparisons'), { recursive: true })
    mkdirSync(join(this.root, 'character-composites'), { recursive: true })
    mkdirSync(join(this.root, 'videos'), { recursive: true })
  }

  getDataRoot(): string {
    return this.root
  }

  private startupMetricsPath(): string {
    return join(this.root, 'startup-metrics.jsonl')
  }

  saveStartupMetricsSample(metrics: StartupMetrics): StartupMetricsSample {
    const sample = buildStartupMetricsSample(metrics)
    writeFileSync(this.startupMetricsPath(), `${JSON.stringify(sample)}\n`, { flag: 'a' })
    return sample
  }

  listStartupMetricsSamples(limit = 8): StartupMetricsSample[] {
    const path = this.startupMetricsPath()
    if (!existsSync(path)) return []
    const rows = readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)

    const parsed: StartupMetricsSample[] = []
    for (const row of rows) {
      try {
        const sample = normalizeStartupMetricsSample(JSON.parse(row))
        if (sample) parsed.push(sample)
      } catch {
        // Ignore malformed historical lines; diagnostics must never block startup.
      }
    }
    return parsed.slice(-Math.max(1, limit)).reverse()
  }

  // -- workspace snapshots ----------------------------------------------
  private workspacesDir(): string {
    return join(this.root, 'workspaces')
  }

  private workspacePath(id: string): string {
    const safeId = id.replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 120)
    return join(this.workspacesDir(), `${safeId}.yoitoart`)
  }

  listWorkspaces(): WorkspaceSummary[] {
    const dir = this.workspacesDir()
    if (!existsSync(dir)) return []
    const out: WorkspaceSummary[] = []
    for (const fname of readdirSync(dir)) {
      if (!fname.endsWith('.yoitoart')) continue
      try {
        const full = join(dir, fname)
        const workspace = normalizeWorkspaceFile(JSON.parse(readFileSync(full, 'utf8')))
        if (!workspace) continue
        out.push({
          id: workspace.id,
          name: workspace.name,
          updatedAt: workspace.updatedAt,
          model: workspace.snapshot.selectedModelTitle,
          promptPreview: workspace.snapshot.prompt.slice(0, 140),
          path: full
        })
      } catch {
        // Ignore corrupt snapshots; the file remains for manual recovery.
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  saveWorkspace(input: { id?: string; name: string; snapshot: WorkspaceSnapshot }): WorkspaceFile {
    const now = Date.now()
    const id = input.id?.replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 120) || randomUUID()
    const previous = input.id ? this.loadWorkspace(id) : null
    const workspace: WorkspaceFile = {
      id,
      name: sanitizeWorkspaceName(input.name),
      version: 1,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      snapshot: input.snapshot
    }
    writeFileSync(this.workspacePath(id), JSON.stringify(workspace, null, 2))
    return workspace
  }

  loadWorkspace(id: string): WorkspaceFile | null {
    const path = this.workspacePath(id)
    if (!existsSync(path)) return null
    try {
      return normalizeWorkspaceFile(JSON.parse(readFileSync(path, 'utf8')))
    } catch {
      return null
    }
  }

  deleteWorkspace(id: string): void {
    const path = this.workspacePath(id)
    if (existsSync(path)) unlinkSync(path)
  }

  saveUpscaleComparison(input: UpscaleComparisonSaveRequest): UpscaleComparisonSaveResult {
    const id = randomUUID()
    const dir = join(this.root, 'upscale-comparisons', id)
    mkdirSync(dir, { recursive: true })

    const manifest = {
      id,
      createdAt: Date.now(),
      inputFilename: input.inputFilename,
      inputImagePath: input.inputImageDataUrl ? join(dir, 'input.png') : null,
      method: input.method,
      scale: input.scale,
      criteria: input.criteria,
      candidates: input.candidates.map((candidate, index) => ({
        method: candidate.method ?? input.method,
        scale: candidate.scale ?? input.scale,
        upscaler: candidate.upscaler ?? null,
        denoise: candidate.denoise,
        tileControlNetEnabled: candidate.tileControlNetEnabled,
        tileWidth: candidate.tileWidth ?? null,
        tileHeight: candidate.tileHeight ?? null,
        tileOverlap: candidate.tileOverlap ?? null,
        ultimateMaskBlur: candidate.ultimateMaskBlur ?? null,
        ultimatePadding: candidate.ultimatePadding ?? null,
        ultimateRedrawMode: candidate.ultimateRedrawMode ?? null,
        ultimateSeamsFixType: candidate.ultimateSeamsFixType ?? null,
        tileControlNetModule: candidate.tileControlNetModule ?? null,
        tileControlNetModel: candidate.tileControlNetModel ?? null,
        tileControlNetWeight: candidate.tileControlNetWeight ?? null,
        imagePath: join(dir, `candidate-${index + 1}-${candidate.tileControlNetEnabled ? 'tile-on' : 'tile-off'}-d${String(candidate.denoise).replace('.', '')}.png`)
      }))
    }

    if (input.inputImageDataUrl && manifest.inputImagePath) {
      writeFileSync(manifest.inputImagePath, dataUrlToBuffer(input.inputImageDataUrl))
    }
    input.candidates.forEach((candidate, index) => {
      writeFileSync(manifest.candidates[index].imagePath, dataUrlToBuffer(candidate.imageDataUrl))
    })

    const manifestPath = join(dir, 'comparison.json')
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    return { id, dir, manifestPath }
  }

  saveGeneratedVideo(input: GeneratedVideoSaveRequest): GeneratedVideoSaveResult {
    const id = randomUUID()
    const createdAt = Date.now()
    const dir = join(this.root, 'videos', id)
    mkdirSync(dir, { recursive: true })

    const ext = input.format.toLowerCase()
    const filePath = join(dir, `video.${ext}`)
    const bytes = Buffer.from(input.base64.replace(/^data:[^;]+;base64,/i, '').replace(/\s/g, ''), 'base64')
    writeFileSync(filePath, bytes)

    const manifest = {
      id,
      createdAt,
      format: input.format,
      filePath,
      sizeBytes: bytes.length,
      prompt: input.prompt,
      negativePrompt: input.negativePrompt,
      model: input.model,
      motionModule: input.motionModule,
      width: input.width,
      height: input.height,
      frames: input.frames,
      fps: input.fps,
      seed: input.seed
    }
    const manifestPath = join(dir, 'video.json')
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

    return {
      id,
      createdAt,
      filePath,
      manifestPath,
      format: input.format,
      sizeBytes: bytes.length
    }
  }

  saveCharacterComposite(input: CharacterCompositeSaveRequest): CharacterCompositeSaveResult {
    const id = randomUUID()
    const dir = join(this.root, 'character-composites', id)
    mkdirSync(dir, { recursive: true })

    const files = {
      base: 'base.png',
      character: 'character.png',
      composite: 'placed-composite.png',
      mask: 'inpaint-mask.png',
      generated: input.generatedImageDataUrl ? 'generated-after.png' : null
    }
    writeFileSync(join(dir, files.base), dataUrlToBuffer(input.baseImageDataUrl))
    writeFileSync(join(dir, files.character), dataUrlToBuffer(input.characterImageDataUrl))
    writeFileSync(join(dir, files.composite), dataUrlToBuffer(input.compositeImageDataUrl))
    writeFileSync(join(dir, files.mask), dataUrlToBuffer(input.maskImageDataUrl))
    if (input.generatedImageDataUrl && files.generated) {
      writeFileSync(join(dir, files.generated), dataUrlToBuffer(input.generatedImageDataUrl))
    }

    const manifest = {
      id,
      createdAt: Date.now(),
      baseFilename: input.baseFilename ?? null,
      characterFilename: input.characterFilename ?? null,
      presetId: input.presetId,
      prompt: input.prompt,
      negativePrompt: input.negativePrompt,
      denoise: input.denoise,
      controlNet: input.controlNet,
      transform: input.transform,
      notes: input.notes ?? '',
      files
    }

    const manifestPath = join(dir, 'character-composite.json')
    const reportPath = join(dir, 'character-composite-report.html')
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    writeFileSync(reportPath, renderCharacterCompositeReport(manifest))
    return { id, dir, manifestPath, reportPath }
  }

  // -- model library -----------------------------------------------------
  private modelLibraryPath(): string {
    return join(this.root, 'model-library', 'index.json')
  }

  listModelLibrary(): ModelLibraryEntry[] {
    if (!existsSync(this.modelLibraryPath())) return []
    try {
      const raw = JSON.parse(readFileSync(this.modelLibraryPath(), 'utf8').replace(/^\uFEFF/, ''))
      if (!Array.isArray(raw)) return []
      const normalized = raw
        .map((entry) => normalizeModelLibraryEntry(entry))
        .filter((entry): entry is ModelLibraryEntry => entry !== null)
      if (normalized.length !== raw.length) this.saveModelLibrary(normalized)
      return normalized
    } catch {
      return []
    }
  }

  saveModelLibrary(entries: ModelLibraryEntry[]): void {
    writeFileSync(this.modelLibraryPath(), JSON.stringify(entries, null, 2))
  }

  upsertModelLibraryEntry(entry: ModelLibraryEntry): ModelLibraryEntry {
    const all = this.listModelLibrary()
    const idx = all.findIndex((item) => item.id === entry.id || item.path === entry.path)
    const next = idx >= 0
      ? { ...all[idx], ...entry, installedAt: all[idx].installedAt }
      : entry
    if (idx >= 0) all[idx] = next
    else all.unshift(next)
    this.saveModelLibrary(all)
    return next
  }

  previewPathForModel(id: string, extension = '.jpg'): string {
    const safeId = id.replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 180) || randomUUID()
    const ext = extension.startsWith('.') ? extension : `.${extension}`
    return join(this.root, 'model-library', 'previews', `${safeId}${ext}`)
  }

  saveModelPreview(id: string, bytes: Buffer, extension = '.jpg'): string {
    const path = this.previewPathForModel(id, extension)
    writeFileSync(path, bytes)
    return path
  }

  // -- download jobs -----------------------------------------------------
  private downloadJobsPath(): string {
    return join(this.root, 'downloads', 'jobs.json')
  }

  listDownloadJobs(): DownloadJob[] {
    if (!existsSync(this.downloadJobsPath())) return []
    try {
      const raw = JSON.parse(readFileSync(this.downloadJobsPath(), 'utf8').replace(/^\uFEFF/, ''))
      if (!Array.isArray(raw)) return []
      const normalized = raw
        .map((job) => normalizeDownloadJob(job))
        .filter((job): job is DownloadJob => job !== null)
      if (normalized.length !== raw.length) this.saveDownloadJobs(normalized)
      return normalized
    } catch {
      return []
    }
  }

  getDownloadJob(id: string): DownloadJob | null {
    return this.listDownloadJobs().find((job) => job.id === id) ?? null
  }

  createDownloadJob(req: CivitaiDownloadRequest, destPath: string, partialPath: string): DownloadJob {
    const now = Date.now()
    const existing = this.listDownloadJobs().find((job) => job.url === req.url && job.destPath === destPath)
    if (existing) {
      return this.updateDownloadJob(existing.id, {
        status: 'running',
        updatedAt: now,
        error: undefined,
        source: req.source ?? existing.source
      }) ?? existing
    }
    const job: DownloadJob = {
      id: randomUUID(),
      url: req.url,
      filename: req.filename,
      assetType: req.assetType,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      bytesDownloaded: 0,
      totalBytes: 0,
      destPath,
      partialPath,
      sha256: null,
      expectedSha256: req.expectedSha256,
      source: req.source
    }
    const all = this.listDownloadJobs()
    all.unshift(job)
    this.saveDownloadJobs(all)
    return job
  }

  updateDownloadJob(id: string, patch: Partial<DownloadJob>): DownloadJob | null {
    const all = this.listDownloadJobs()
    const idx = all.findIndex((job) => job.id === id)
    if (idx < 0) return null
    const next = { ...all[idx], ...patch, id, updatedAt: patch.updatedAt ?? Date.now() }
    all[idx] = next
    this.saveDownloadJobs(all)
    return next
  }

  deleteDownloadJob(id: string, opts: { deletePartial?: boolean } = {}): DownloadJob | null {
    const all = this.listDownloadJobs()
    const idx = all.findIndex((job) => job.id === id)
    if (idx < 0) return null
    const [removed] = all.splice(idx, 1)
    if (opts.deletePartial !== false && removed.partialPath && existsSync(removed.partialPath)) {
      try { unlinkSync(removed.partialPath) } catch { /* ignore */ }
    }
    this.saveDownloadJobs(all)
    return removed
  }

  private saveDownloadJobs(jobs: DownloadJob[]): void {
    writeFileSync(this.downloadJobsPath(), JSON.stringify(jobs.slice(0, 200), null, 2))
  }

  // -- settings -----------------------------------------------------------
  getSettings(): AppSettings {
    const path = join(this.root, 'settings.json')
    if (!existsSync(path)) {
      const defaults = defaultSettings(this.projectRoot)
      this.setSettings(defaults)
      return defaults
    }
    const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    const hadInlineSecret = typeof parsed.civitaiApiKey === 'string' && parsed.civitaiApiKey.length > 0
    const settings = normalizeSettings({ ...defaultSettings(this.projectRoot), ...parsed }, this.projectRoot)
    const storedSecret = this.readSecrets().civitaiApiKey
    const secretKey = this.getSecret('civitaiApiKey')
    if (secretKey) {
      settings.civitaiApiKey = secretKey
      if (storedSecret?.startsWith('plain:') && safeStorage.isEncryptionAvailable()) {
        this.setSecret('civitaiApiKey', secretKey)
      }
    } else if (settings.civitaiApiKey) {
      // One-time migration from older settings.json files that stored the key
      // directly. setSettings() writes settings.json with civitaiApiKey=null.
      this.setSecret('civitaiApiKey', settings.civitaiApiKey)
    }
    if (
      hadInlineSecret ||
      JSON.stringify({ ...settings, civitaiApiKey: null }) !== JSON.stringify({ ...parsed, civitaiApiKey: null })
    ) {
      this.setSettings(settings)
    }
    return settings
  }

  diagnoseSettingsFile(): PersonalEnvironmentHealthReport['settings'] {
    const path = join(this.root, 'settings.json')
    const defaults = defaultSettings(this.projectRoot)
    const issues: string[] = []
    if (!existsSync(path)) {
      const forgePath = defaults.forgePath
      return {
        path,
        exists: false,
        parseOk: true,
        normalizedChanged: false,
        inlineSecretPresent: false,
        forgePath,
        forgePathExists: existsSync(forgePath),
        webuiExists: existsSync(join(forgePath, 'webui')),
        launchPyExists: existsSync(join(forgePath, 'webui', 'launch.py')),
        forgePort: defaults.forgePort,
        autoStartForge: defaults.autoStartForge,
        forgeExtraArgs: defaults.forgeExtraArgs,
        issues: ['settings.json is missing; defaults will be recreated']
      }
    }

    let parsed: Partial<AppSettings>
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as Partial<AppSettings>
    } catch (e) {
      const forgePath = defaults.forgePath
      return {
        path,
        exists: true,
        parseOk: false,
        normalizedChanged: false,
        inlineSecretPresent: false,
        forgePath,
        forgePathExists: existsSync(forgePath),
        webuiExists: existsSync(join(forgePath, 'webui')),
        launchPyExists: existsSync(join(forgePath, 'webui', 'launch.py')),
        forgePort: defaults.forgePort,
        autoStartForge: defaults.autoStartForge,
        forgeExtraArgs: defaults.forgeExtraArgs,
        issues: [`settings.json parse failed: ${(e as Error).message}`]
      }
    }

    const settings = normalizeSettings({ ...defaults, ...parsed }, this.projectRoot)
    const normalizedChanged =
      JSON.stringify({ ...settings, civitaiApiKey: null }) !== JSON.stringify({ ...parsed, civitaiApiKey: null })
    const inlineSecretPresent = typeof parsed.civitaiApiKey === 'string' && parsed.civitaiApiKey.length > 0
    const webuiExists = existsSync(join(settings.forgePath, 'webui'))
    const launchPyExists = existsSync(join(settings.forgePath, 'webui', 'launch.py'))
    if (!existsSync(settings.forgePath)) issues.push(`Forge path does not exist: ${settings.forgePath}`)
    if (!webuiExists) issues.push('Forge webui folder is missing')
    if (!launchPyExists) issues.push('Forge launch.py is missing')
    if (normalizedChanged) issues.push('settings.json contains values that will be normalized on next save')
    if (inlineSecretPresent) issues.push('Civitai API key is still present in settings.json and will be migrated to secrets.local.json')

    return {
      path,
      exists: true,
      parseOk: true,
      normalizedChanged,
      inlineSecretPresent,
      forgePath: settings.forgePath,
      forgePathExists: existsSync(settings.forgePath),
      webuiExists,
      launchPyExists,
      forgePort: settings.forgePort,
      autoStartForge: settings.autoStartForge,
      forgeExtraArgs: settings.forgeExtraArgs,
      issues
    }
  }

  setSettings(s: AppSettings): void {
    const settings = normalizeSettings({ ...defaultSettings(this.projectRoot), ...s }, this.projectRoot)
    this.setSecret('civitaiApiKey', settings.civitaiApiKey)
    writeFileSync(
      join(this.root, 'settings.json'),
      JSON.stringify({ ...settings, civitaiApiKey: null }, null, 2)
    )
  }

  // -- local secrets ------------------------------------------------------
  private secretsPath(): string {
    return join(this.root, 'secrets.local.json')
  }

  private readSecrets(): Record<string, string> {
    if (!existsSync(this.secretsPath())) return {}
    try {
      const raw = JSON.parse(readFileSync(this.secretsPath(), 'utf8')) as unknown
      if (!raw || typeof raw !== 'object') return {}
      return Object.fromEntries(
        Object.entries(raw as Record<string, unknown>).filter(([, v]) => typeof v === 'string')
      ) as Record<string, string>
    } catch {
      return {}
    }
  }

  private writeSecrets(secrets: Record<string, string>): void {
    writeFileSync(this.secretsPath(), JSON.stringify(secrets, null, 2))
  }

  private getSecret(key: string): string | null {
    const stored = this.readSecrets()[key]
    if (!stored) return null
    if (stored.startsWith('safe:')) {
      try {
        return safeStorage.decryptString(Buffer.from(stored.slice(5), 'base64'))
      } catch {
        return null
      }
    }
    if (stored.startsWith('plain:')) {
      try {
        return Buffer.from(stored.slice(6), 'base64').toString('utf8')
      } catch {
        return null
      }
    }
    return stored
  }

  private setSecret(key: string, value: string | null): void {
    const secrets = this.readSecrets()
    if (!value) {
      delete secrets[key]
      this.writeSecrets(secrets)
      return
    }

    let stored: string
    if (safeStorage.isEncryptionAvailable()) {
      stored = `safe:${safeStorage.encryptString(value).toString('base64')}`
    } else {
      // Fallback is only obfuscation, not cryptographic protection. The file
      // is still local-only and ignored by Git; safeStorage rewrites it on
      // the next save where OS encryption is available.
      stored = `plain:${Buffer.from(value, 'utf8').toString('base64')}`
    }
    secrets[key] = stored
    this.writeSecrets(secrets)
  }

  // -- Civitai cache ------------------------------------------------------
  getCivitai(sha256: string): CivitaiRecommended | null {
    const path = join(this.root, 'civitai', `${sha256}.json`)
    if (!existsSync(path)) return null
    try {
      const data = JSON.parse(readFileSync(path, 'utf8')) as Partial<CivitaiRecommended>
      // Schema migration: entries cached before Phase 3-5.1 are missing
      // modelVersionId / recommendedLoras / recommendedVae / modelId. Force a
      // re-fetch so the user sees the new fields populated.
      if (
        typeof data.modelVersionId !== 'number' ||
        typeof data.modelId !== 'number' ||
        !('recommendedLoras' in data) ||
        !('recommendedVae' in data)
      ) {
        return null
      }
      return data as CivitaiRecommended
    } catch {
      return null
    }
  }

  /**
   * Enumerate every cached checkpoint recommendation. Used by the model-update
   * checker to walk all installed models that have known Civitai entries.
   *
   * Skips lora-* and community-* files in the same directory.
   */
  listAllCivitai(): Array<CivitaiRecommended & { sha256: string }> {
    const dir = join(this.root, 'civitai')
    if (!existsSync(dir)) return []
    const out: Array<CivitaiRecommended & { sha256: string }> = []
    for (const fname of readdirSync(dir)) {
      if (!fname.endsWith('.json')) continue
      if (fname.startsWith('lora-') || fname.startsWith('community-')) continue
      const sha256 = fname.replace(/\.json$/, '')
      const data = this.getCivitai(sha256)
      if (data) out.push({ ...data, sha256 })
    }
    return out
  }

  saveCivitai(sha256: string, data: CivitaiRecommended): void {
    writeFileSync(
      join(this.root, 'civitai', `${sha256}.json`),
      JSON.stringify(data, null, 2)
    )
  }

  // -- history ------------------------------------------------------------
  private historyIndexPath(): string {
    return join(this.root, 'history', 'index.json')
  }

  listHistory(): HistoryItem[] {
    const path = this.historyIndexPath()
    if (!existsSync(path)) return []
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
      if (!Array.isArray(raw)) return []
      return raw.map((item) => normalizeHistoryItem(item)).filter((item): item is HistoryItem => Boolean(item))
    } catch {
      return []
    }
  }

  addHistory(args: {
    pngBase64: string
    thumbDataUrl: string
    prompt: string
    negativePrompt: string
    params: HistoryItem['params']
    dynamicPrompt?: HistoryItem['dynamicPrompt']
  }): HistoryItem {
    const id = randomUUID()
    const imagePath = join(this.root, 'history', `${id}.png`)
    writeFileSync(imagePath, Buffer.from(args.pngBase64, 'base64'))

    const item: HistoryItem = {
      id,
      createdAt: Date.now(),
      prompt: args.prompt,
      negativePrompt: args.negativePrompt,
      ...(args.dynamicPrompt ? { dynamicPrompt: args.dynamicPrompt } : {}),
      params: args.params,
      imagePath,
      thumbDataUrl: args.thumbDataUrl
    }
    const all = this.listHistory()
    all.unshift(item)
    // Keep last 500 — 500 PNGs + thumbnails is ~1GB at 1024² which is reasonable.
    const trimmed = all.slice(0, 500)
    writeFileSync(this.historyIndexPath(), JSON.stringify(trimmed, null, 2))

    // Delete files for items that fell off the end.
    const keptIds = new Set(trimmed.map((h) => h.id))
    for (const fname of readdirSync(join(this.root, 'history'))) {
      if (fname === 'index.json') continue
      const fid = fname.replace(/\.png$/, '')
      if (!keptIds.has(fid)) {
        try { unlinkSync(join(this.root, 'history', fname)) } catch { /* ignore */ }
      }
    }
    return item
  }

  deleteHistory(id: string): void {
    const all = this.listHistory().filter((h) => h.id !== id)
    writeFileSync(this.historyIndexPath(), JSON.stringify(all, null, 2))
    try { unlinkSync(join(this.root, 'history', `${id}.png`)) } catch { /* ignore */ }
  }

  setHistoryLabel(id: string, label: HistoryLabel | null): HistoryItem | null {
    if (label !== null && !HISTORY_LABELS.has(label)) {
      throw new Error('Invalid history label')
    }
    const all = this.listHistory()
    const index = all.findIndex((h) => h.id === id)
    if (index < 0) return null
    all[index] = { ...all[index], label }
    writeFileSync(this.historyIndexPath(), JSON.stringify(all, null, 2))
    return all[index]
  }

  setHistoryTagReview(id: string, review: HistoryTagReview | null): HistoryItem | null {
    const all = this.listHistory()
    const index = all.findIndex((h) => h.id === id)
    if (index < 0) return null
    const nextReview = review ? sanitizeHistoryTagReview(review) : null
    all[index] = { ...all[index], tagReview: nextReview }
    writeFileSync(this.historyIndexPath(), JSON.stringify(all, null, 2))
    return all[index]
  }

  setHistoryProRecipeReview(id: string, review: HistoryProRecipeReview | null): HistoryItem | null {
    const all = this.listHistory()
    const index = all.findIndex((h) => h.id === id)
    if (index < 0) return null
    const nextReview = review ? sanitizeHistoryProRecipeReview(review) : null
    all[index] = { ...all[index], proRecipeReview: nextReview }
    writeFileSync(this.historyIndexPath(), JSON.stringify(all, null, 2))
    return all[index]
  }

  readHistoryImageDataUrl(id: string): string | null {
    const item = this.listHistory().find((h) => h.id === id)
    if (!item || !existsSync(item.imagePath)) return null
    const pngBase64 = readFileSync(item.imagePath).toString('base64')
    return `data:image/png;base64,${pngBase64}`
  }

  // -- presets ------------------------------------------------------------
  private presetsPath(): string {
    return join(this.root, 'presets.json')
  }

  listPresets(): PromptPreset[] {
    if (!existsSync(this.presetsPath())) return []
    try {
      return JSON.parse(readFileSync(this.presetsPath(), 'utf8')) as PromptPreset[]
    } catch {
      return []
    }
  }

  savePreset(input: { id?: string; name: string; prompt: string; negativePrompt: string }): PromptPreset {
    const all = this.listPresets()
    const now = Date.now()
    if (input.id) {
      const idx = all.findIndex((p) => p.id === input.id)
      if (idx >= 0) {
        all[idx] = { ...all[idx], ...input, id: input.id, updatedAt: now }
        writeFileSync(this.presetsPath(), JSON.stringify(all, null, 2))
        return all[idx]
      }
    }
    const created: PromptPreset = {
      id: randomUUID(),
      name: input.name,
      prompt: input.prompt,
      negativePrompt: input.negativePrompt,
      createdAt: now,
      updatedAt: now
    }
    all.unshift(created)
    writeFileSync(this.presetsPath(), JSON.stringify(all, null, 2))
    return created
  }

  deletePreset(id: string): void {
    const all = this.listPresets().filter((p) => p.id !== id)
    writeFileSync(this.presetsPath(), JSON.stringify(all, null, 2))
  }

  // -- tag favorites ------------------------------------------------------
  // Stored as a flat array of english tag strings. Cross-category, so a starred
  // tag from the Person category appears under the Favorites pill regardless of
  // which category the user is currently browsing.
  private favoritesPath(): string {
    return join(this.root, 'favorites.json')
  }

  getFavorites(): string[] {
    if (!existsSync(this.favoritesPath())) return []
    try {
      const raw = JSON.parse(readFileSync(this.favoritesPath(), 'utf8'))
      return Array.isArray(raw) ? raw.filter((s) => typeof s === 'string') : []
    } catch {
      return []
    }
  }

  setFavorites(tags: string[]): void {
    // Dedup and trim to avoid runaway growth.
    const dedup = Array.from(new Set(tags)).slice(0, 1000)
    writeFileSync(this.favoritesPath(), JSON.stringify(dedup, null, 2))
  }

  // -- quick presets ------------------------------------------------------
  // Built-ins are merged in on read so users always see the bundled defaults
  // even if they've never customized. Their `id` collides on purpose so
  // user overrides (with the same id) can replace them.
  private quickPresetsPath(): string {
    return join(this.root, 'quick-presets.json')
  }

  listQuickPresets(): QuickPreset[] {
    let user: QuickPreset[] = []
    if (existsSync(this.quickPresetsPath())) {
      try {
        user = JSON.parse(readFileSync(this.quickPresetsPath(), 'utf8'))
      } catch { /* ignore corrupted file */ }
    }
    // User overrides built-ins by id; new user-defined presets are merged in.
    const map = new Map<string, QuickPreset>()
    for (const p of BUILT_IN_QUICK_PRESETS) map.set(p.id, p)
    for (const p of user) map.set(p.id, p)
    return Array.from(map.values()).sort(
      (a, b) => b.order - a.order || a.name.localeCompare(b.name)
    )
  }

  saveQuickPreset(input: Omit<QuickPreset, 'id' | 'builtIn' | 'order'> & {
    id?: string
    order?: number
  }): QuickPreset {
    const all: QuickPreset[] = []
    if (existsSync(this.quickPresetsPath())) {
      try {
        all.push(...JSON.parse(readFileSync(this.quickPresetsPath(), 'utf8')))
      } catch { /* ignore */ }
    }
    const id = input.id ?? randomUUID()
    const idx = all.findIndex((p) => p.id === id)
    const created: QuickPreset = {
      id,
      name: input.name,
      text: input.text,
      target: input.target,
      builtIn: false,
      order: input.order ?? 0
    }
    if (idx >= 0) all[idx] = created
    else all.push(created)
    writeFileSync(this.quickPresetsPath(), JSON.stringify(all, null, 2))
    return created
  }

  deleteQuickPreset(id: string): void {
    const all: QuickPreset[] = existsSync(this.quickPresetsPath())
      ? JSON.parse(readFileSync(this.quickPresetsPath(), 'utf8'))
      : []
    const filtered = all.filter((p) => p.id !== id)
    writeFileSync(this.quickPresetsPath(), JSON.stringify(filtered, null, 2))
  }

  private promptComposerSlotTemplatesPath(): string {
    return join(this.root, 'prompt-composer-slot-templates.json')
  }

  listPromptComposerSlotTemplates(): PromptComposerSlotTemplate[] {
    if (!existsSync(this.promptComposerSlotTemplatesPath())) return []
    try {
      const raw = JSON.parse(readFileSync(this.promptComposerSlotTemplatesPath(), 'utf8'))
      if (!Array.isArray(raw)) return []
      return raw
        .map((item) => normalizePromptComposerSlotTemplate(item))
        .filter((item): item is PromptComposerSlotTemplate => Boolean(item))
        .slice(0, MAX_PROMPT_COMPOSER_SLOT_TEMPLATES)
    } catch {
      return []
    }
  }

  savePromptComposerSlotTemplate(input: PromptComposerSlotTemplateSaveInput): PromptComposerSlotTemplate {
    const all = this.listPromptComposerSlotTemplates()
    const id = cleanStorageString(input.id, 300) ?? randomUUID()
    const existing = all.find((item) => item.id === id) ?? null
    const now = Date.now()
    const normalized = normalizePromptComposerSlotTemplate({
      ...input,
      id,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastUsedAt: input.lastUsedAt ?? existing?.lastUsedAt ?? null
    })
    if (!normalized) throw new Error('Invalid Prompt Composer slot template')
    const idx = all.findIndex((item) => item.id === normalized.id)
    if (idx >= 0) all[idx] = normalized
    else all.unshift(normalized)
    writeFileSync(
      this.promptComposerSlotTemplatesPath(),
      JSON.stringify(all.slice(0, MAX_PROMPT_COMPOSER_SLOT_TEMPLATES), null, 2)
    )
    return normalized
  }

  deletePromptComposerSlotTemplate(id: string): void {
    if (typeof id !== 'string' || id.length === 0 || id.length > 300) return
    const all = this.listPromptComposerSlotTemplates()
    const filtered = all.filter((item) => item.id !== id)
    writeFileSync(this.promptComposerSlotTemplatesPath(), JSON.stringify(filtered, null, 2))
  }

  // -- LoRA Civitai cache (separate file from checkpoint civitai cache) ----
  // Stored under userdata/civitai/lora-<sha>.json so the same SHA-256 doesn't
  // collide with a checkpoint cache entry when by some chance the user has
  // both with the same hash (extremely unlikely but cleaner namespacing).
  getLoraCivitai(sha256: string): LoraCivitaiMetadata | null {
    const path = join(this.root, 'civitai', `lora-${sha256}.json`)
    if (!existsSync(path)) return null
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as LoraCivitaiMetadata
    } catch {
      return null
    }
  }

  saveLoraCivitai(sha256: string, data: LoraCivitaiMetadata): void {
    writeFileSync(
      join(this.root, 'civitai', `lora-${sha256}.json`),
      JSON.stringify(data, null, 2)
    )
  }

  // -- LoRA favorites + usage log -----------------------------------------
  private loraFavoritesPath(): string {
    return join(this.root, 'lora-favorites.json')
  }

  getLoraFavorites(): string[] {
    if (!existsSync(this.loraFavoritesPath())) return []
    try {
      const raw = JSON.parse(readFileSync(this.loraFavoritesPath(), 'utf8'))
      return Array.isArray(raw) ? raw.filter((s) => typeof s === 'string') : []
    } catch {
      return []
    }
  }

  setLoraFavorites(names: string[]): void {
    const dedup = Array.from(new Set(names)).slice(0, 500)
    writeFileSync(this.loraFavoritesPath(), JSON.stringify(dedup, null, 2))
  }

  private loraPromptOverridesPath(): string {
    return join(this.root, 'lora-prompt-overrides.json')
  }

  listLoraPromptOverrides(): LoraPromptOverride[] {
    if (!existsSync(this.loraPromptOverridesPath())) return []
    try {
      const raw = JSON.parse(readFileSync(this.loraPromptOverridesPath(), 'utf8'))
      if (!Array.isArray(raw)) return []
      return raw
        .map((item) => normalizeLoraPromptOverride(item))
        .filter((item): item is LoraPromptOverride => Boolean(item))
        .slice(0, MAX_LORA_PROMPT_OVERRIDES)
    } catch {
      return []
    }
  }

  saveLoraPromptOverride(input: LoraPromptOverride): LoraPromptOverride {
    const normalized = normalizeLoraPromptOverride(input)
    if (!normalized) throw new Error('Invalid LoRA prompt override')
    const all = this.listLoraPromptOverrides()
    const idx = all.findIndex((item) => item.id === normalized.id)
    if (idx >= 0) all[idx] = normalized
    else all.unshift(normalized)
    writeFileSync(
      this.loraPromptOverridesPath(),
      JSON.stringify(all.slice(0, MAX_LORA_PROMPT_OVERRIDES), null, 2)
    )
    return normalized
  }

  deleteLoraPromptOverride(id: string): void {
    if (typeof id !== 'string' || id.length === 0 || id.length > 300) return
    const all = this.listLoraPromptOverrides()
    const filtered = all.filter((item) => item.id !== id)
    writeFileSync(this.loraPromptOverridesPath(), JSON.stringify(filtered, null, 2))
  }

  private checkpointPromptProfilesPath(): string {
    return join(this.root, 'checkpoint-prompt-profiles.json')
  }

  listCheckpointPromptProfiles(): CheckpointPromptProfile[] {
    if (!existsSync(this.checkpointPromptProfilesPath())) return []
    try {
      const raw = JSON.parse(readFileSync(this.checkpointPromptProfilesPath(), 'utf8'))
      if (!Array.isArray(raw)) return []
      return raw
        .map((item) => normalizeCheckpointPromptProfile(item))
        .filter((item): item is CheckpointPromptProfile => Boolean(item))
        .slice(0, MAX_CHECKPOINT_PROMPT_PROFILES)
    } catch {
      return []
    }
  }

  saveCheckpointPromptProfile(input: CheckpointPromptProfile): CheckpointPromptProfile {
    const normalized = normalizeCheckpointPromptProfile(input)
    if (!normalized) throw new Error('Invalid checkpoint prompt profile')
    const all = this.listCheckpointPromptProfiles()
    const idx = all.findIndex((item) => item.id === normalized.id)
    if (idx >= 0) all[idx] = normalized
    else all.unshift(normalized)
    writeFileSync(
      this.checkpointPromptProfilesPath(),
      JSON.stringify(all.slice(0, MAX_CHECKPOINT_PROMPT_PROFILES), null, 2)
    )
    return normalized
  }

  deleteCheckpointPromptProfile(id: string): void {
    if (typeof id !== 'string' || id.length === 0 || id.length > 300) return
    const all = this.listCheckpointPromptProfiles()
    const filtered = all.filter((item) => item.id !== id)
    writeFileSync(this.checkpointPromptProfilesPath(), JSON.stringify(filtered, null, 2))
  }

  private loraUsagePath(): string {
    return join(this.root, 'lora-usage.json')
  }

  /**
   * Append a record of a LoRA being used in a generation. The suggestion
   * engine reads this back to boost LoRAs the user has paired with the
   * current checkpoint or a similar prompt recently.
   *
   * Bounded to the most recent 2000 entries — older ones drop off the tail.
   */
  recordLoraUsage(record: LoraUsageRecord): void {
    const all = this.listLoraUsage()
    all.unshift(record)
    const trimmed = all.slice(0, 2000)
    writeFileSync(this.loraUsagePath(), JSON.stringify(trimmed, null, 2))
  }

  listLoraUsage(): LoraUsageRecord[] {
    if (!existsSync(this.loraUsagePath())) return []
    try {
      return JSON.parse(readFileSync(this.loraUsagePath(), 'utf8')) as LoraUsageRecord[]
    } catch {
      return []
    }
  }

  // -- hidden quick presets ----------------------------------------------
  // Built-in presets can't be deleted (they live in code), but the user can
  // mark them as hidden via this set so they don't clutter the bar. Custom
  // presets already have a delete affordance, but we accept hides for them
  // too (cheap to support).
  private hiddenQuickPresetsPath(): string {
    return join(this.root, 'hidden-quick-presets.json')
  }

  getHiddenQuickPresets(): string[] {
    if (!existsSync(this.hiddenQuickPresetsPath())) return []
    try {
      const raw = JSON.parse(readFileSync(this.hiddenQuickPresetsPath(), 'utf8'))
      return Array.isArray(raw) ? raw.filter((s) => typeof s === 'string') : []
    } catch {
      return []
    }
  }

  setHiddenQuickPresets(ids: string[]): void {
    const dedup = Array.from(new Set(ids)).slice(0, 200)
    writeFileSync(this.hiddenQuickPresetsPath(), JSON.stringify(dedup, null, 2))
  }

  // -- custom prompt library ---------------------------------------------
  // User-added categories / subcategories / tags. Stored as the same shape
  // the built-in YAML parses to so the renderer can merge and display them
  // seamlessly. Each top-level entry is marked `editable: true` on read so
  // the UI knows which entries to render edit/delete controls on.
  private customLibraryPath(): string {
    return join(this.root, 'custom-prompt-library.json')
  }

  private customLibraryBackupDir(): string {
    return join(this.root, 'backups', 'tag-library')
  }

  getCustomLibrary(): PromptCategory[] {
    if (!existsSync(this.customLibraryPath())) return []
    try {
      const raw = JSON.parse(readFileSync(this.customLibraryPath(), 'utf8').replace(/^\uFEFF/, ''))
      return this.extractCustomLibraryCategories(raw).map((c) => ({ ...c, editable: true }))
    } catch {
      return []
    }
  }

  saveCustomLibrary(cats: PromptCategory[]): void {
    // Strip the `editable` marker before persisting — it's a render-time hint,
    // re-applied on read.
    const updatedAt = new Date().toISOString()
    const cleaned = this.normalizeCustomLibraryCategories(cats, updatedAt)
    const document: PromptLibraryDocumentV2 = {
      schemaVersion: 2,
      updatedAt,
      categories: cleaned
    }
    this.backupCustomLibraryIfPresent()
    this.atomicWriteJson(this.customLibraryPath(), document)
  }

  private extractCustomLibraryCategories(raw: unknown): PromptCategory[] {
    if (Array.isArray(raw)) return this.normalizeCustomLibraryCategories(raw as PromptCategory[], null)
    if (!raw || typeof raw !== 'object') return []
    const doc = raw as Partial<PromptLibraryDocumentV2>
    if (doc.schemaVersion === 2 && Array.isArray(doc.categories)) {
      return this.normalizeCustomLibraryCategories(doc.categories, null)
    }
    return []
  }

  private normalizeCustomLibraryCategories(cats: PromptCategory[], createdAt: string | null): PromptCategory[] {
    const out: PromptCategory[] = []
    for (const cat of cats) {
      if (!cat || typeof cat.name !== 'string' || !Array.isArray(cat.groups)) continue
      const catName = cat.name.trim()
      if (!catName) continue
      const groups: PromptGroup[] = []
      for (const group of cat.groups) {
        if (!group || typeof group.name !== 'string' || !Array.isArray(group.tags)) continue
        const groupName = group.name.trim()
        if (!groupName) continue
        const tags = group.tags
          .map((tag) => this.normalizePromptTag(tag, catName, groupName, createdAt))
          .filter((tag): tag is PromptGroupTag => tag !== null)
        groups.push({
          name: groupName,
          color: typeof group.color === 'string' && group.color.trim() ? group.color : 'rgba(120, 120, 130, .35)',
          tags
        })
      }
      out.push({ name: catName, groups })
    }
    return out
  }

  private normalizePromptTag(
    tag: PromptGroupTag,
    categoryName: string,
    groupName: string,
    createdAt: string | null
  ): PromptGroupTag | null {
    if (!tag || typeof tag.en !== 'string') return null
    const en = tag.en.trim()
    if (!en) return null
    const canonical = normalizePromptTagCanonical(tag.canonical || en)
    return {
      en,
      ja: typeof tag.ja === 'string' ? tag.ja.trim() : '',
      canonical,
      aliases: sanitizePromptTagAliases(tag.aliases, canonical),
      polarity: sanitizePromptTagPolarity(tag.polarity, categoryName, groupName),
      modelFamilies: sanitizePromptTagStringList(tag.modelFamilies),
      source: sanitizePromptTagSources(tag.source, createdAt),
      usage: {
        count: Number.isFinite(tag.usage?.count) ? Math.max(0, Math.round(tag.usage?.count ?? 0)) : 0,
        lastUsedAt: typeof tag.usage?.lastUsedAt === 'number' && Number.isFinite(tag.usage.lastUsedAt)
          ? tag.usage.lastUsedAt
          : null
      }
    }
  }

  private backupCustomLibraryIfPresent(): void {
    const source = this.customLibraryPath()
    if (!existsSync(source)) return
    const dir = this.customLibraryBackupDir()
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)
    const backupPath = join(dir, `custom-prompt-library-${stamp}-${randomUUID().slice(0, 8)}.json`)
    copyFileSync(source, backupPath)
    this.pruneCustomLibraryBackups(dir)
  }

  private pruneCustomLibraryBackups(dir: string): void {
    const backups = readdirSync(dir)
      .filter((name) => /^custom-prompt-library-\d{14}-[a-f0-9]{8}\.json$/i.test(name))
      .sort()
    const removeCount = backups.length - MAX_TAG_LIBRARY_BACKUPS
    if (removeCount <= 0) return
    for (const name of backups.slice(0, removeCount)) {
      try { unlinkSync(join(dir, name)) } catch { /* ignore stale backup cleanup failures */ }
    }
  }

  private atomicWriteJson(path: string, value: unknown): void {
    const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`
    writeFileSync(tempPath, JSON.stringify(value, null, 2))
    renameSync(tempPath, path)
  }

  // -- Civitai community stats cache -------------------------------------
  // Mining /api/v1/images for a popular checkpoint takes 3-10 seconds and
  // returns hundreds of images — cache for 14 days so we don't re-do this
  // on every model selection.
  private communityStatsPath(modelVersionId: number): string {
    return join(this.root, 'civitai', `community-${modelVersionId}.json`)
  }

  getCommunityStats(modelVersionId: number): CivitaiCommunityStats | null {
    const path = this.communityStatsPath(modelVersionId)
    if (!existsSync(path)) return null
    try {
      const stats = JSON.parse(readFileSync(path, 'utf8')) as CivitaiCommunityStats
      const ageMs = Date.now() - stats.fetchedAt
      const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000
      if (ageMs > FOURTEEN_DAYS) return null
      // Schema migration: pre-Phase-5.2 entries lack `civitai` pointers on
      // top LoRA/VAE items. Force a re-mine so the UI can offer download
      // buttons for community-popular items.
      const needsMigration =
        (stats.topVaes.length > 0 && !('civitai' in stats.topVaes[0])) ||
        (stats.topLoras.length > 0 && !('civitai' in stats.topLoras[0]))
      if (needsMigration) return null
      return stats
    } catch {
      return null
    }
  }

  saveCommunityStats(stats: CivitaiCommunityStats): void {
    writeFileSync(
      this.communityStatsPath(stats.modelVersionId),
      JSON.stringify(stats, null, 2)
    )
  }

  // -- Civitai update-check cache (24h TTL) ------------------------------
  // Stores the last update-check result so we don't hit /models/:id for every
  // installed checkpoint on each app launch. Bumped to 24h since Civitai
  // model-version releases are infrequent (days to months between versions).
  private updateCheckPath(): string {
    return join(this.root, 'civitai', 'update-check.json')
  }

  getUpdateCheck(): { checkedAt: number; updates: import('../src/shared/types.js').ModelUpdateInfo[] } | null {
    if (!existsSync(this.updateCheckPath())) return null
    try {
      const raw = JSON.parse(readFileSync(this.updateCheckPath(), 'utf8'))
      const ageMs = Date.now() - (raw.checkedAt ?? 0)
      const TWENTY_FOUR_H = 24 * 60 * 60 * 1000
      if (ageMs > TWENTY_FOUR_H) return null
      return raw
    } catch {
      return null
    }
  }

  saveUpdateCheck(updates: import('../src/shared/types.js').ModelUpdateInfo[]): void {
    writeFileSync(
      this.updateCheckPath(),
      JSON.stringify({ checkedAt: Date.now(), updates }, null, 2)
    )
  }

  // -- Civitai tag cache (24h TTL) ---------------------------------------
  private tagCachePath(): string {
    return join(this.root, 'civitai', 'tags.json')
  }

  getCachedTags(): import('../src/shared/types.js').CivitaiTag[] | null {
    if (!existsSync(this.tagCachePath())) return null
    try {
      const raw = JSON.parse(readFileSync(this.tagCachePath(), 'utf8'))
      const ageMs = Date.now() - (raw.cachedAt ?? 0)
      const TWENTY_FOUR_H = 24 * 60 * 60 * 1000
      if (ageMs > TWENTY_FOUR_H) return null
      return raw.tags
    } catch {
      return null
    }
  }

  saveCachedTags(tags: import('../src/shared/types.js').CivitaiTag[]): void {
    writeFileSync(
      this.tagCachePath(),
      JSON.stringify({ cachedAt: Date.now(), tags }, null, 2)
    )
  }
}

function sanitizeHistoryTagReview(review: HistoryTagReview): HistoryTagReview {
  return {
    acceptedTags: sanitizeHistoryReviewTags(review.acceptedTags),
    rejectedTags: sanitizeHistoryReviewTags(review.rejectedTags),
    sourceModel: review.sourceModel === 'pixai-onnx' ? 'pixai-onnx' : 'manual',
    updatedAt: Number.isFinite(review.updatedAt) ? Math.max(0, Math.floor(review.updatedAt)) : Date.now()
  }
}

function normalizeHistoryItem(raw: unknown): HistoryItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const item = raw as HistoryItem
  const obj = raw as Record<string, unknown>
  if (!('proRecipeReview' in obj)) return item
  return { ...item, proRecipeReview: sanitizeHistoryProRecipeReview(obj.proRecipeReview) }
}

function sanitizeHistoryProRecipeReview(raw: unknown): HistoryProRecipeReview | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const scores = sanitizeHistoryProRecipeScores(obj.scores)
  const parentHistoryId = typeof obj.parentHistoryId === 'string'
    ? obj.parentHistoryId.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) || null
    : null
  const rating = sanitizeHistoryProRecipeScore(obj.rating)
  return {
    ...(rating == null ? {} : { rating }),
    strengths: sanitizeHistoryProRecipeList(obj.strengths),
    issues: sanitizeHistoryProRecipeList(obj.issues),
    nextActions: sanitizeHistoryProRecipeList(obj.nextActions),
    ...(scores ? { scores } : {}),
    ...(parentHistoryId ? { parentHistoryId } : {}),
    updatedAt: typeof obj.updatedAt === 'number' && Number.isFinite(obj.updatedAt)
      ? Math.max(0, Math.floor(obj.updatedAt))
      : Date.now()
  }
}

function sanitizeHistoryProRecipeList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const items: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const text = item.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_HISTORY_PRO_RECIPE_ITEM_LENGTH)
    const key = text.toLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    items.push(text)
    if (items.length >= MAX_HISTORY_PRO_RECIPE_ITEMS) break
  }
  return items
}

function sanitizeHistoryProRecipeScores(raw: unknown): HistoryProRecipeReview['scores'] | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const obj = raw as Record<string, unknown>
  const scores: NonNullable<HistoryProRecipeReview['scores']> = {}
  for (const key of ['thumbnail', 'composition', 'lighting', 'color', 'anatomy', 'styleConsistency', 'reusePotential'] as const) {
    const score = sanitizeHistoryProRecipeScore(obj[key])
    if (score != null) scores[key] = score
  }
  return Object.keys(scores).length > 0 ? scores : undefined
}

function sanitizeHistoryProRecipeScore(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  return Math.max(0, Math.min(5, Math.round(raw)))
}

function sanitizeHistoryReviewTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const tags: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const tag = item.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_HISTORY_REVIEW_TAG_LENGTH)
    const key = tag.toLowerCase()
    if (!tag || seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
    if (tags.length >= MAX_HISTORY_REVIEW_TAGS) break
  }
  return tags
}

function normalizeSourceMetadata(raw: unknown): ModelSourceMetadata | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const obj = raw as Record<string, unknown>
  const provider = obj.provider
  if (provider !== 'civitai' && provider !== 'huggingface' && provider !== 'local') return undefined
  const out: ModelSourceMetadata = { provider }
  for (const key of ['name', 'creator', 'pageUrl', 'downloadUrl', 'versionName', 'baseModel', 'repoId', 'filePath', 'description'] as const) {
    const value = obj[key]
    if (typeof value === 'string' && value.length <= (key === 'description' ? 4000 : 2048)) out[key] = value
    else if (key === 'description' && value === null) out.description = null
  }
  if (Array.isArray(obj.tags)) {
    out.tags = obj.tags
      .filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 80)
      .slice(0, 40)
  }
  if (Array.isArray(obj.trainedWords)) {
    out.trainedWords = obj.trainedWords
      .filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 120)
      .slice(0, 40)
  }
  if (Array.isArray(obj.recommendedPrompts)) {
    out.recommendedPrompts = obj.recommendedPrompts
      .filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 400)
      .slice(0, 12)
  }
  const thumbnailUrl = obj.thumbnailUrl
  if (typeof thumbnailUrl === 'string' && thumbnailUrl.length <= 2048) out.thumbnailUrl = thumbnailUrl
  else if (thumbnailUrl === null) out.thumbnailUrl = null
  const previewPath = obj.previewPath
  if (typeof previewPath === 'string' && previewPath.length <= 2000) out.previewPath = previewPath
  else if (previewPath === null) out.previewPath = null
  const expectedSha256 = obj.expectedSha256
  if (typeof expectedSha256 === 'string' && /^[a-f0-9]{64}$/i.test(expectedSha256)) out.expectedSha256 = expectedSha256
  else if (expectedSha256 === null) out.expectedSha256 = null
  for (const key of ['modelId', 'modelVersionId'] as const) {
    const value = obj[key]
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
    else if (key === 'modelVersionId' && value === null) out[key] = null
  }
  return out
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const raw = dataUrl.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '')
  return Buffer.from(raw, 'base64')
}

function renderCharacterCompositeReport(manifest: {
  id: string
  createdAt: number
  baseFilename: string | null
  characterFilename: string | null
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
  transform: CharacterCompositeSaveRequest['transform']
  notes: string
  files: {
    base: string
    character: string
    composite: string
    mask: string
    generated: string | null
  }
}): string {
  const createdAt = new Date(manifest.createdAt).toLocaleString('ja-JP')
  const generatedCard = manifest.files.generated
    ? imageCard('After', manifest.files.generated, 'Generated result')
    : '<section class="card muted"><h2>After</h2><p>No generated result was attached when this package was saved.</p></section>'
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Character Composite Report - ${escapeHtml(manifest.id)}</title>
  <style>
    :root { color-scheme: dark; --bg: #121417; --panel: #1b2026; --line: #303843; --ink: #eef2f7; --muted: #aab4c0; --accent: #7fd7c4; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--ink); font-family: "Segoe UI", sans-serif; line-height: 1.55; }
    main { max-width: 1160px; margin: 0 auto; padding: 28px; }
    header { display: grid; gap: 8px; margin-bottom: 20px; }
    h1 { margin: 0; font-size: 28px; letter-spacing: 0; }
    h2 { margin: 0 0 10px; font-size: 16px; }
    p { margin: 0; color: var(--muted); }
    code { color: var(--accent); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
    .card { border: 1px solid var(--line); border-radius: 8px; background: var(--panel); padding: 14px; }
    .card img { width: 100%; display: block; border-radius: 6px; background: #0a0c0f; object-fit: contain; max-height: 520px; }
    .muted { color: var(--muted); }
    .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; margin: 18px 0; }
    .kv { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; background: #161a20; }
    .kv b { display: block; font-size: 12px; color: var(--muted); margin-bottom: 3px; }
    pre { white-space: pre-wrap; word-break: break-word; margin: 0; color: var(--ink); }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>AI Character Composite Report</h1>
      <p>Saved at ${escapeHtml(createdAt)} / package <code>${escapeHtml(manifest.id)}</code></p>
    </header>
    <section class="grid">
      ${imageCard('Base', manifest.files.base, manifest.baseFilename ?? 'Base image')}
      ${imageCard('Character', manifest.files.character, manifest.characterFilename ?? 'Character image')}
      ${imageCard('Placed Composite', manifest.files.composite, 'img2img input')}
      ${imageCard('Inpaint Mask', manifest.files.mask, 'white area will be redrawn')}
      ${generatedCard}
    </section>
    <section class="meta">
      <div class="kv"><b>Preset</b>${escapeHtml(manifest.presetId)}</div>
      <div class="kv"><b>Denoise</b>${manifest.denoise}</div>
      <div class="kv"><b>Structure ControlNet</b>${escapeHtml(manifest.controlNet.structureModule)} / ${escapeHtml(manifest.controlNet.structureModel)}</div>
      <div class="kv"><b>Reference ControlNet</b>${escapeHtml(manifest.controlNet.referenceModule ?? 'None')} / ${escapeHtml(manifest.controlNet.referenceModel ?? 'None')}</div>
      <div class="kv"><b>Transform</b>x ${manifest.transform.x}%, y ${manifest.transform.y}%, width ${manifest.transform.widthPct}%, rot ${manifest.transform.rotation}deg, flip ${manifest.transform.flipX ? 'on' : 'off'}</div>
      <div class="kv"><b>Mask</b>expand ${manifest.transform.maskExpand}px, feather ${manifest.transform.maskFeather}px, auto tone ${manifest.transform.autoTone ? 'on' : 'off'}</div>
    </section>
    <section class="card">
      <h2>Prompt</h2>
      <pre>${escapeHtml(manifest.prompt)}</pre>
    </section>
    <section class="card" style="margin-top: 14px;">
      <h2>Negative Prompt</h2>
      <pre>${escapeHtml(manifest.negativePrompt)}</pre>
    </section>
  </main>
</body>
</html>`
}

function imageCard(title: string, src: string, caption: string): string {
  return `<section class="card"><h2>${escapeHtml(title)}</h2><img src="${escapeHtml(src)}" alt="${escapeHtml(title)}" /><p>${escapeHtml(caption)}</p></section>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function normalizeModelLibraryEntry(raw: unknown): ModelLibraryEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.path !== 'string' || typeof obj.name !== 'string') return null
  const now = Date.now()
  const sourceMeta = normalizeSourceMetadata(obj.sourceMeta)
  const oldCivitai = obj.civitai && typeof obj.civitai === 'object' && !Array.isArray(obj.civitai)
    ? obj.civitai as Record<string, unknown>
    : null
  return {
    id: typeof obj.id === 'string' && obj.id ? obj.id : `${String(obj.type ?? 'Unknown')}:${obj.path.toLowerCase()}`,
    name: obj.name,
    type: typeof obj.type === 'string' ? obj.type as ModelLibraryEntry['type'] : 'Unknown',
    path: obj.path,
    sizeBytes: typeof obj.sizeBytes === 'number' && Number.isFinite(obj.sizeBytes) ? obj.sizeBytes : 0,
    sha256: typeof obj.sha256 === 'string' ? obj.sha256 : null,
    source: obj.source === 'civitai' || obj.source === 'huggingface' || obj.source === 'manual' || obj.source === 'local' ? obj.source : 'local',
    installedAt: typeof obj.installedAt === 'number' && Number.isFinite(obj.installedAt) ? obj.installedAt : now,
    lastSeenAt: typeof obj.lastSeenAt === 'number' && Number.isFinite(obj.lastSeenAt) ? obj.lastSeenAt : now,
    lastModifiedAt: typeof obj.lastModifiedAt === 'number' && Number.isFinite(obj.lastModifiedAt) ? obj.lastModifiedAt : null,
    sourceMeta,
    previewPath: typeof obj.previewPath === 'string' ? obj.previewPath : sourceMeta?.previewPath ?? null,
    favorite: obj.favorite === true,
    notes: typeof obj.notes === 'string' && obj.notes.length <= 4000 ? obj.notes : '',
    civitai: oldCivitai
      ? {
          url: typeof oldCivitai.url === 'string' ? oldCivitai.url : undefined,
          expectedSha256: typeof oldCivitai.expectedSha256 === 'string' ? oldCivitai.expectedSha256 : null
        }
      : undefined
  }
}

function normalizeDownloadJob(raw: unknown): DownloadJob | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (
    typeof obj.url !== 'string' ||
    typeof obj.filename !== 'string' ||
    typeof obj.assetType !== 'string' ||
    typeof obj.destPath !== 'string' ||
    typeof obj.partialPath !== 'string'
  ) {
    return null
  }
  const now = Date.now()
  const status = typeof obj.status === 'string' && DOWNLOAD_JOB_STATUSES.has(obj.status as DownloadJobStatus)
    ? obj.status as DownloadJobStatus
    : 'failed'
  return {
    id: typeof obj.id === 'string' && obj.id ? obj.id : randomUUID(),
    url: obj.url,
    filename: obj.filename,
    assetType: obj.assetType as DownloadJob['assetType'],
    status,
    createdAt: typeof obj.createdAt === 'number' && Number.isFinite(obj.createdAt) ? obj.createdAt : now,
    updatedAt: typeof obj.updatedAt === 'number' && Number.isFinite(obj.updatedAt) ? obj.updatedAt : now,
    bytesDownloaded: typeof obj.bytesDownloaded === 'number' && Number.isFinite(obj.bytesDownloaded) ? obj.bytesDownloaded : 0,
    totalBytes: typeof obj.totalBytes === 'number' && Number.isFinite(obj.totalBytes) ? obj.totalBytes : 0,
    destPath: obj.destPath,
    partialPath: obj.partialPath,
    sha256: typeof obj.sha256 === 'string' ? obj.sha256 : null,
    expectedSha256: typeof obj.expectedSha256 === 'string' ? obj.expectedSha256 : null,
    source: normalizeSourceMetadata(obj.source),
    error: typeof obj.error === 'string' ? obj.error : undefined
  }
}

function sanitizeWorkspaceName(raw: string): string {
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return (cleaned || 'Untitled workspace').slice(0, 120)
}

function normalizeWorkspaceFile(raw: unknown): WorkspaceFile | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const snapshot = obj.snapshot
  if (
    typeof obj.id !== 'string' ||
    typeof obj.name !== 'string' ||
    typeof obj.createdAt !== 'number' ||
    typeof obj.updatedAt !== 'number' ||
    !snapshot ||
    typeof snapshot !== 'object' ||
    Array.isArray(snapshot)
  ) {
    return null
  }
  return {
    id: obj.id,
    name: sanitizeWorkspaceName(obj.name),
    version: 1,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
    snapshot: snapshot as WorkspaceSnapshot
  }
}

function normalizeLoraPromptOverride(raw: unknown): LoraPromptOverride | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const id = cleanStorageString(obj.id, 300)
  const loraName = cleanStorageString(obj.loraName, 500)
  if (!id || !loraName) return null
  const weight = safeNumber(obj.weight)
  return {
    id,
    loraName,
    loraAlias: cleanStorageString(obj.loraAlias, 500) ?? undefined,
    loraPath: cleanStorageString(obj.loraPath, 2000) ?? undefined,
    loraSha256: cleanSha256(obj.loraSha256),
    positivePrompt: cleanStorageString(obj.positivePrompt, MAX_LORA_OVERRIDE_PROMPT_CHARS, true) ?? '',
    negativePrompt: cleanStorageString(obj.negativePrompt, MAX_LORA_OVERRIDE_PROMPT_CHARS, true) ?? '',
    weight: weight === null ? null : Math.max(-1, Math.min(2, Math.round(weight * 100) / 100)),
    sampler: cleanStorageString(obj.sampler, 120) ?? undefined,
    steps: normalizeOptionalNumber(obj.steps, 1, 150, true),
    cfgScale: normalizeOptionalNumber(obj.cfgScale, 1, 30, false),
    clipSkip: normalizeOptionalNumber(obj.clipSkip, 1, 12, true),
    autoApply: obj.autoApply !== false,
    updatedAt: safeNumber(obj.updatedAt) ?? Date.now()
  }
}

function normalizePromptComposerSlotTemplate(raw: unknown): PromptComposerSlotTemplate | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const id = cleanStorageString(obj.id, 300)
  const name = cleanStorageString(obj.name, MAX_PROMPT_COMPOSER_TEMPLATE_NAME_CHARS)
  const slots = normalizePromptComposerSlots(obj.slots)
  if (!id || !name || Object.keys(slots).length === 0) return null
  return {
    id,
    name,
    slots,
    family: normalizeNullableCheckpointPromptFamily(obj.family),
    promptStyle: normalizeNullableCheckpointPromptStyle(obj.promptStyle),
    negativeStrategy: normalizeNullableCheckpointNegativeStrategy(obj.negativeStrategy),
    notes: cleanStorageString(obj.notes, MAX_PROMPT_COMPOSER_TEMPLATE_NOTES_CHARS, true) ?? '',
    createdAt: safeNumber(obj.createdAt) ?? Date.now(),
    updatedAt: safeNumber(obj.updatedAt) ?? Date.now(),
    lastUsedAt: safeNumber(obj.lastUsedAt)
  }
}

function normalizePromptComposerSlots(raw: unknown): PromptComposerSlots {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const obj = raw as Record<string, unknown>
  const out: PromptComposerSlots = {}
  for (const [key, value] of Object.entries(obj)) {
    if (!PROMPT_COMPOSER_SLOT_KEYS.has(key as PromptComposerSlotKey)) continue
    const text = cleanStorageString(value, MAX_PROMPT_COMPOSER_SLOT_CHARS, true)
    if (!text) continue
    out[key as PromptComposerSlotKey] = text
  }
  return out
}

function normalizeOptionalNumber(value: unknown, min: number, max: number, integer: boolean): number | null {
  const number = safeNumber(value)
  if (number === null) return null
  const rounded = integer ? Math.round(number) : Math.round(number * 100) / 100
  return Math.max(min, Math.min(max, rounded))
}

function normalizeCheckpointPromptProfile(raw: unknown): CheckpointPromptProfile | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const id = cleanStorageString(obj.id, 300)
  const checkpointTitle = cleanStorageString(obj.checkpointTitle, 500)
  if (!id || !checkpointTitle) return null
  return {
    id,
    checkpointTitle,
    checkpointName: cleanStorageString(obj.checkpointName, 500) ?? undefined,
    checkpointPath: cleanStorageString(obj.checkpointPath, 2000) ?? undefined,
    checkpointSha256: cleanSha256(obj.checkpointSha256),
    baseModel: cleanStorageString(obj.baseModel, 120) ?? undefined,
    family: normalizeCheckpointPromptFamily(obj.family),
    promptStyle: normalizeCheckpointPromptStyle(obj.promptStyle),
    negativeStrategy: normalizeCheckpointNegativeStrategy(obj.negativeStrategy),
    positivePrefix: normalizePromptTagList(obj.positivePrefix),
    positiveAppend: normalizePromptTagList(obj.positiveAppend),
    negativeAppend: normalizePromptTagList(obj.negativeAppend),
    sampler: cleanStorageString(obj.sampler, 120) ?? undefined,
    steps: normalizeOptionalNumber(obj.steps, 1, 150, true),
    cfgScale: normalizeOptionalNumber(obj.cfgScale, 1, 30, false),
    width: normalizeOptionalNumber(obj.width, 64, 4096, true),
    height: normalizeOptionalNumber(obj.height, 64, 4096, true),
    clipSkip: normalizeOptionalNumber(obj.clipSkip, 1, 12, true),
    recommendedAspectRatios: normalizeCheckpointAspectRatios(obj.recommendedAspectRatios),
    recommendedLoraCount: normalizeCheckpointLoraCount(obj.recommendedLoraCount),
    relatedModels: normalizeCheckpointRelatedModels(obj.relatedModels),
    compatibilityNotes: normalizeCheckpointNotes(obj.compatibilityNotes),
    recipeNotes: normalizeCheckpointNotes(obj.recipeNotes),
    mode: normalizeCheckpointPromptMode(obj.mode),
    updatedAt: safeNumber(obj.updatedAt) ?? Date.now()
  }
}

function normalizeCheckpointPromptFamily(value: unknown): CheckpointPromptFamily {
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

function normalizeNullableCheckpointPromptFamily(value: unknown): CheckpointPromptFamily | null {
  return value == null ? null : normalizeCheckpointPromptFamily(value)
}

function normalizeCheckpointPromptMode(value: unknown): CheckpointPromptProfileMode {
  return value === 'manual' || value === 'auto' || value === 'suggest' ? value : 'suggest'
}

function normalizeCheckpointPromptStyle(value: unknown): CheckpointPromptStyle {
  return value === 'tag' || value === 'natural' || value === 'structured' || value === 'hybrid' ? value : 'tag'
}

function normalizeNullableCheckpointPromptStyle(value: unknown): CheckpointPromptStyle | null {
  return value == null ? null : normalizeCheckpointPromptStyle(value)
}

function normalizeCheckpointNegativeStrategy(value: unknown): CheckpointNegativeStrategy {
  return value === 'classic' || value === 'minimal' || value === 'positive-replacement' ? value : 'classic'
}

function normalizeNullableCheckpointNegativeStrategy(value: unknown): CheckpointNegativeStrategy | null {
  return value == null ? null : normalizeCheckpointNegativeStrategy(value)
}

function normalizeCheckpointAspectRatios(value: unknown): CheckpointPromptProfile['recommendedAspectRatios'] {
  if (!Array.isArray(value)) return []
  const out: NonNullable<CheckpointPromptProfile['recommendedAspectRatios']> = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const obj = item as Record<string, unknown>
    const label = cleanStorageString(obj.label, 80) || 'Ratio'
    const width = normalizeOptionalNumber(obj.width, 64, 4096, true)
    const height = normalizeOptionalNumber(obj.height, 64, 4096, true)
    if (!width || !height) continue
    out.push({ label, width, height })
    if (out.length >= MAX_CHECKPOINT_PROFILE_ASPECT_RATIOS) break
  }
  return out
}

function normalizeCheckpointLoraCount(value: unknown): CheckpointPromptProfile['recommendedLoraCount'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const obj = value as Record<string, unknown>
  const min = normalizeOptionalNumber(obj.min, 0, 12, true)
  const max = normalizeOptionalNumber(obj.max, 0, 12, true)
  if (min == null || max == null) return null
  return { min: Math.min(min, max), max: Math.max(min, max) }
}

function normalizeCheckpointRelatedModels(value: unknown): CheckpointPromptProfile['relatedModels'] {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  return {
    loras: normalizeCheckpointRelatedModelList(source.loras, 'lora'),
    vaes: normalizeCheckpointRelatedModelList(source.vaes, 'vae'),
    controlNets: normalizeCheckpointRelatedModelList(source.controlNets, 'controlnet')
  }
}

function normalizeCheckpointRelatedModelList(
  value: unknown,
  kind: NonNullable<CheckpointPromptProfile['relatedModels']>['loras'][number]['kind']
): NonNullable<CheckpointPromptProfile['relatedModels']>['loras'] {
  if (!Array.isArray(value)) return []
  const out: NonNullable<CheckpointPromptProfile['relatedModels']>['loras'] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const obj = item as Record<string, unknown>
    const name = cleanStorageString(obj.name, 220)
    if (!name) continue
    const path = cleanStorageString(obj.path, 2000) ?? null
    const sha256 = cleanSha256(obj.sha256)
    const role = cleanStorageString(obj.role, 80) ?? null
    const weight = normalizeOptionalNumber(obj.weight, -2, 2, false)
    const notes = normalizeCheckpointNotes(obj.notes).slice(0, 6)
    const key = [kind, name.toLowerCase(), path?.toLowerCase() ?? '', sha256 ?? ''].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      kind,
      name,
      path,
      sha256,
      role,
      weight,
      notes
    })
    if (out.length >= MAX_CHECKPOINT_PROFILE_RELATED_MODELS) break
  }
  return out
}

function normalizeCheckpointNotes(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\n/)
      : []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const note = cleanStorageString(item, MAX_CHECKPOINT_PROFILE_NOTE_CHARS)
    if (!note) continue
    const key = note.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(note)
    if (out.length >= MAX_CHECKPOINT_PROFILE_NOTES) break
  }
  return out
}

function normalizePromptTagList(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,\n]/)
      : []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const tag = cleanStorageString(item, MAX_CHECKPOINT_PROFILE_TAG_CHARS)
    if (!tag) continue
    const key = tag.toLowerCase().replace(/\s+/g, ' ')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
    if (out.length >= MAX_CHECKPOINT_PROFILE_TAGS) break
  }
  return out
}

function cleanStorageString(value: unknown, maxChars: number, allowNewlines = false): string | null {
  if (typeof value !== 'string') return null
  const control = allowNewlines ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g
  const cleaned = value.replace(control, '').trim()
  return cleaned.slice(0, maxChars)
}

function cleanSha256(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return /^[a-f0-9]{64}$/.test(trimmed) ? trimmed : null
}

function elapsedMs(startedAt: number, value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null
  return Math.max(0, Math.round(value - startedAt))
}

function buildStartupMetricsSample(metrics: StartupMetrics): StartupMetricsSample {
  return {
    capturedAt: Date.now(),
    processStartedAt: metrics.processStartedAt,
    appReadyMs: elapsedMs(metrics.processStartedAt, metrics.appReadyAt),
    ipcRegisteredMs: elapsedMs(metrics.processStartedAt, metrics.ipcRegisteredAt),
    rendererLoadedMs: elapsedMs(metrics.processStartedAt, metrics.rendererLoadedAt),
    windowShownMs: elapsedMs(metrics.processStartedAt, metrics.windowShownAt),
    forgeAutoStartRequestedMs: elapsedMs(metrics.processStartedAt, metrics.forgeAutoStartRequestedAt),
    forgeReadyMs: elapsedMs(metrics.processStartedAt, metrics.forgeReadyAt),
    forgeLastStatusKind: metrics.forgeLastStatusKind
  }
}

function normalizeStartupMetricsSample(raw: unknown): StartupMetricsSample | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const capturedAt = safeNumber(obj.capturedAt)
  const processStartedAt = safeNumber(obj.processStartedAt)
  if (capturedAt === null || processStartedAt === null) return null

  const status =
    obj.forgeLastStatusKind === 'stopped' ||
    obj.forgeLastStatusKind === 'starting' ||
    obj.forgeLastStatusKind === 'ready' ||
    obj.forgeLastStatusKind === 'error'
      ? obj.forgeLastStatusKind
      : null

  return {
    capturedAt,
    processStartedAt,
    appReadyMs: safeNumber(obj.appReadyMs),
    ipcRegisteredMs: safeNumber(obj.ipcRegisteredMs),
    rendererLoadedMs: safeNumber(obj.rendererLoadedMs),
    windowShownMs: safeNumber(obj.windowShownMs),
    forgeAutoStartRequestedMs: safeNumber(obj.forgeAutoStartRequestedMs),
    forgeReadyMs: safeNumber(obj.forgeReadyMs),
    forgeLastStatusKind: status
  }
}

function safeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function defaultSettings(projectRoot: string): AppSettings {
  return {
    forgePath: defaultForgePath(projectRoot),
    forgePort: 7860,
    autoStartForge: true,
    outputDir: '',
    civitaiApiKey: null,
    uiLanguage: 'ja',
    forgeExtraArgs: '',
    framePackPath: ''
  }
}

function defaultForgePath(projectRoot: string): string {
  return join(projectRoot, 'runtime', 'forge')
}

function legacySiblingForgePath(projectRoot: string): string {
  return resolve(projectRoot, '..', 'webui_forge_cu121_torch231')
}

function normalizeSettings(settings: AppSettings, projectRoot: string): AppSettings {
  const defaults = defaultSettings(projectRoot)
  const integrated = defaultForgePath(projectRoot)
  const legacy = legacySiblingForgePath(projectRoot)
  let forgePath = typeof settings.forgePath === 'string' && settings.forgePath
    ? settings.forgePath
    : defaults.forgePath
  const configured = resolve(forgePath)

  if (
    existsSync(integrated) &&
    (configured.toLowerCase() === legacy.toLowerCase() || !existsSync(configured))
  ) {
    forgePath = integrated
  }

  const uiLanguage = settings.uiLanguage === 'en' ||
    settings.uiLanguage === 'ru' ||
    settings.uiLanguage === 'pt' ||
    settings.uiLanguage === 'ja'
    ? settings.uiLanguage
    : defaults.uiLanguage

  return {
    forgePath,
    forgePort: Number.isInteger(settings.forgePort) ? settings.forgePort : defaults.forgePort,
    autoStartForge: typeof settings.autoStartForge === 'boolean' ? settings.autoStartForge : defaults.autoStartForge,
    outputDir: typeof settings.outputDir === 'string' ? settings.outputDir : defaults.outputDir,
    civitaiApiKey: typeof settings.civitaiApiKey === 'string' ? settings.civitaiApiKey : null,
    uiLanguage,
    forgeExtraArgs: typeof settings.forgeExtraArgs === 'string' ? settings.forgeExtraArgs : defaults.forgeExtraArgs,
    framePackPath: typeof settings.framePackPath === 'string' ? settings.framePackPath : defaults.framePackPath
  }
}
