import { safeStorage } from 'electron'
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  AppSettings,
  CivitaiCommunityStats,
  CivitaiDownloadRequest,
  CivitaiRecommended,
  DownloadJob,
  DownloadJobStatus,
  HistoryItem,
  HistoryTagReview,
  HistoryLabel,
  LoraCivitaiMetadata,
  LoraUsageRecord,
  ModelLibraryEntry,
  ModelSourceMetadata,
  PromptCategory,
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
const HISTORY_LABELS = new Set<HistoryLabel>(['favorite', 'candidate', 'rejected', 'asset'])
const MAX_HISTORY_REVIEW_TAGS = 120
const MAX_HISTORY_REVIEW_TAG_LENGTH = 80

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
        denoise: candidate.denoise,
        tileControlNetEnabled: candidate.tileControlNetEnabled,
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

  setSettings(s: AppSettings): void {
    this.setSecret('civitaiApiKey', s.civitaiApiKey)
    writeFileSync(
      join(this.root, 'settings.json'),
      JSON.stringify({ ...s, civitaiApiKey: null }, null, 2)
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
      return JSON.parse(readFileSync(path, 'utf8')) as HistoryItem[]
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

  getCustomLibrary(): PromptCategory[] {
    if (!existsSync(this.customLibraryPath())) return []
    try {
      const raw = JSON.parse(readFileSync(this.customLibraryPath(), 'utf8'))
      if (!Array.isArray(raw)) return []
      return (raw as PromptCategory[]).map((c) => ({ ...c, editable: true }))
    } catch {
      return []
    }
  }

  saveCustomLibrary(cats: PromptCategory[]): void {
    // Strip the `editable` marker before persisting — it's a render-time hint,
    // re-applied on read.
    const cleaned = cats.map(({ editable: _editable, ...rest }) => rest)
    writeFileSync(this.customLibraryPath(), JSON.stringify(cleaned, null, 2))
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
  for (const key of ['name', 'creator', 'pageUrl', 'downloadUrl', 'versionName', 'baseModel', 'repoId', 'filePath'] as const) {
    const value = obj[key]
    if (typeof value === 'string' && value.length <= 2048) out[key] = value
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
    forgeExtraArgs: ''
  }
}

function defaultForgePath(projectRoot: string): string {
  return join(projectRoot, 'runtime', 'forge')
}

function legacySiblingForgePath(projectRoot: string): string {
  return resolve(projectRoot, '..', 'webui_forge_cu121_torch231')
}

function normalizeSettings(settings: AppSettings, projectRoot: string): AppSettings {
  const integrated = defaultForgePath(projectRoot)
  const legacy = legacySiblingForgePath(projectRoot)
  const configured = resolve(settings.forgePath)

  if (
    existsSync(integrated) &&
    (configured.toLowerCase() === legacy.toLowerCase() || !existsSync(configured))
  ) {
    return { ...settings, forgePath: integrated }
  }

  return settings
}
