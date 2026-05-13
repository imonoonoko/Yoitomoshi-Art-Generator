import { useEffect, useState } from 'react'
import { Activity, AlertTriangle, ChevronDown, Database, Download, ExternalLink, FileSearch, FolderOpen, GitMerge, Package, Play, RefreshCw, Save, Search, ShieldCheck, Square, Tag, Trash2, Wrench } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore } from '@/lib/store'
import { useT, t as tStatic } from '@/lib/i18n'
import { api } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { promptAppend } from '@/lib/prompt-utils'
import { buildWorkspaceSnapshot } from '@/lib/workspace-snapshot'
import { TAGGER_CATALOG, taggerTierLabel, type TaggerCatalogItem } from '@/lib/tagger-catalog'
import { DEFAULT_TAGGER_BLACKLIST, DEFAULT_TAGGER_MIN_SCORE, parseTaggerBlacklist } from '@shared/tagger-filter'
import type {
  DownloadJob,
  HuggingFaceSearchFile,
  LibraryIntegrityReport,
  ModelFormatConversionResult,
  ModelLibrarySummary,
  ModelMergerEstimate,
  ModelMergerProgress,
  ModelMergerRequest,
  ModelMergerResult,
  ModelMergerSupportReport,
  StartupMetrics,
  StartupMetricsSample,
  TaggerRunResult,
  WorkspaceImageReference,
  WorkspaceImageSaveMode,
  WorkspaceSummary
} from '@shared/types'

/**
 * Tools tab — local utilities that don't need a generation pipeline.
 *
 * Currently shipping:
 *   - Model Inspector: read a .safetensors header and report kind / size /
 *     embedded metadata. Replaces the most-used model-toolkit feature for
 *     quick "what is this file?" answers without any Python.
 *
 * Placeholders for future:
 *   - Model Merger (SuperMerger port — needs Python tensor ops)
 *   - Format converter (.ckpt ↔ .safetensors etc.)
 *   - LoRA extractor
 *
 * Each section is a self-contained card so they can be added/removed
 * independently. The Tools tab fills the entire content area with a
 * single-column scrolling layout for clarity.
 */
export function ToolsWorkspace(): JSX.Element {
  const t = useT()
  return (
    <main className="flex-1 overflow-auto p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <h2 className="text-lg font-semibold text-ink-1">{t('tools.title')}</h2>
        <ToolSection title={t('tools.workspace.title')} icon={<Save className="h-4 w-4" />} defaultOpen>
          <WorkspaceCard />
        </ToolSection>
        <ToolSection title={t('tools.startup.title')} icon={<Activity className="h-4 w-4" />} defaultOpen>
          <StartupDiagnosticsCard />
        </ToolSection>
        <ToolSection title={t('tools.health.title')} icon={<ShieldCheck className="h-4 w-4" />} defaultOpen>
          <CatalogHealthCard />
        </ToolSection>
        <ToolSection title={t('tools.tagger.title')} icon={<Tag className="h-4 w-4" />} defaultOpen testId="tagger">
          <TaggerCatalogCard />
        </ToolSection>
        <ToolSection title={t('tools.library.title')} icon={<Database className="h-4 w-4" />} testId="library">
          <ModelLibraryCard />
        </ToolSection>
        <ToolSection title={t('tools.modelHealth.title')} icon={<AlertTriangle className="h-4 w-4" />}>
          <ModelHealthScanCard />
        </ToolSection>
        <ToolSection title={t('tools.inspector.title')} icon={<FileSearch className="h-4 w-4" />}>
          <ModelInspectorCard />
        </ToolSection>
        <ToolSection title={t('tools.merger.title')} icon={<GitMerge className="h-4 w-4" />}>
          <ModelMergerCard />
        </ToolSection>
        <ToolSection title={t('tools.converter.title')} icon={<Package className="h-4 w-4" />}>
          <FormatConverterCard />
        </ToolSection>
      </div>
    </main>
  )
}

function ToolSection({
  title,
  icon,
  defaultOpen = false,
  testId,
  children
}: {
  title: string
  icon: React.ReactNode
  defaultOpen?: boolean
  testId?: string
  children: React.ReactNode
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="space-y-2">
      <button
        className="w-full flex items-center gap-2 rounded border border-line bg-bg-1 px-3 py-2 text-left text-sm text-ink-1 hover:bg-bg-2"
        onClick={() => setOpen((value) => !value)}
        data-testid={testId ? `tool-section-${testId}-toggle` : undefined}
      >
        <span className="text-accent">{icon}</span>
        <span className="font-semibold">{title}</span>
        <ChevronDown className={cn('ml-auto h-4 w-4 text-ink-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && children}
    </section>
  )
}

function WorkspaceCard(): JSX.Element {
  const t = useT()
  const [name, setName] = useState('')
  const [imageSaveMode, setImageSaveMode] = useState<WorkspaceImageSaveMode>('embed')
  const [busy, setBusy] = useState(false)
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])

  async function load(): Promise<void> {
    setWorkspaces(await api.storage.listWorkspaces())
  }

  useEffect(() => {
    void load().catch((e) => toast.error(tStatic('tools.workspace.loadFailed', { message: (e as Error).message })))
  }, [])

  async function save(): Promise<void> {
    if (busy) return
    const s = useStore.getState()
    const snapshot = buildWorkspaceSnapshot(s, imageSaveMode)
    setBusy(true)
    try {
      await api.storage.saveWorkspace({
        name: name.trim() || tStatic('tools.workspace.defaultName'),
        snapshot
      })
      setName('')
      await load()
      toast.success(tStatic('tools.workspace.saved'))
    } catch (e) {
      toast.error(tStatic('tools.workspace.saveFailed', { message: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  async function restore(id: string): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const workspace = await api.storage.loadWorkspace(id)
      if (!workspace) throw new Error('Workspace not found')
      const snap = workspace.snapshot
      const s = useStore.getState()
      const refs = snap.imageReferences
      const missingReferences: string[] = []
      const [
        inputRef,
        lastRef,
        upscaleInputRef,
        upscaleOutputRef,
        controlnetRefs,
        fabricPositiveImages,
        fabricNegativeImages
      ] = await Promise.all([
        snap.inputImageDataUrl ? Promise.resolve(snap.inputImageDataUrl) : resolveImageReference(refs?.inputImage, 'inputImage', missingReferences),
        snap.lastImageDataUrl ? Promise.resolve(snap.lastImageDataUrl) : resolveImageReference(refs?.lastImage, 'lastImage', missingReferences),
        snap.upscaleInputImageDataUrl ? Promise.resolve(snap.upscaleInputImageDataUrl) : resolveImageReference(refs?.upscaleInputImage, 'upscaleInputImage', missingReferences),
        snap.upscaleOutputImageDataUrl ? Promise.resolve(snap.upscaleOutputImageDataUrl) : resolveImageReference(refs?.upscaleOutputImage, 'upscaleOutputImage', missingReferences),
        Promise.all((refs?.controlnetUnits ?? []).map((ref, index) => resolveImageReference(ref, `controlnet-${index + 1}`, missingReferences))),
        Promise.all((refs?.fabricPositive ?? []).map((ref, index) => resolveImageReference(ref, `fabric-positive-${index + 1}`, missingReferences))),
        Promise.all((refs?.fabricNegative ?? []).map((ref, index) => resolveImageReference(ref, `fabric-negative-${index + 1}`, missingReferences)))
      ])
      const rawControlnet = snap.controlnet as Partial<typeof s.controlnet> & { units?: typeof s.controlnet.units }
      const restoredControlnet = {
        ...rawControlnet,
        ...(Array.isArray(rawControlnet.units)
          ? {
              units: rawControlnet.units.map((unit, index) => ({
                ...unit,
                image: unit.image ?? controlnetRefs[index] ?? null
              }))
            }
          : {})
      }
      const restoredFabric = restoreFabricImages(
        snap.fabric as Partial<typeof s.fabric> | undefined,
        fabricPositiveImages,
        fabricNegativeImages,
        refs?.fabricPositive,
        refs?.fabricNegative
      )
      s.setCurrentTab(snap.currentTab)
      s.setPrompt(snap.prompt)
      s.setNegativePrompt(snap.negativePrompt)
      s.patchParams(snap.params)
      s.setSelectedModel(snap.selectedModelTitle)
      s.setSelectedVae(snap.selectedVae)
      s.setActiveLoras(snap.activeLoras)
      s.setInputImage(inputRef ?? null, snap.inputImageFilename, imageFilePath(refs?.inputImage), imageHistoryId(refs?.inputImage))
      s.setInpaintMaskImage(snap.inpaintMaskImage)
      s.setLastImage(lastRef ?? null, imageHistoryId(refs?.lastImage))
      s.patchUpscale({
        ...(snap.upscale as Partial<typeof s.upscale>),
        inputImage: upscaleInputRef ?? null,
        inputFilename: imageReferenceFilename(refs?.upscaleInputImage) ?? (snap.upscale as Partial<typeof s.upscale>).inputFilename ?? null,
        inputImagePath: imageFilePath(refs?.upscaleInputImage),
        inputHistoryId: imageHistoryId(refs?.upscaleInputImage),
        outputImage: upscaleOutputRef ?? null,
        outputImagePath: imageFilePath(refs?.upscaleOutputImage),
        outputHistoryId: imageHistoryId(refs?.upscaleOutputImage),
        isRunning: false
      })
      s.patchControlnet(restoredControlnet as Partial<typeof s.controlnet>)
      if (snap.regionalPrompter) s.patchRegionalPrompter(snap.regionalPrompter as Partial<typeof s.regionalPrompter>)
      if (restoredFabric) s.patchFabric(restoredFabric)
      s.patchAdetailer(snap.adetailer as Partial<typeof s.adetailer>)
      s.patchDynThres(snap.dynThres as Partial<typeof s.dynThres>)
      s.patchFreeu(snap.freeu as Partial<typeof s.freeu>)
      if (missingReferences.length > 0) {
        toast(tStatic('tools.workspace.referencesMissing', { count: missingReferences.length }), { icon: '!' })
      } else {
        toast.success(tStatic('tools.workspace.restored'))
      }
    } catch (e) {
      toast.error(tStatic('tools.workspace.restoreFailed', { message: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      await api.storage.deleteWorkspace(id)
      await load()
      toast.success(tStatic('tools.workspace.deleted'))
    } catch (e) {
      toast.error(tStatic('tools.workspace.deleteFailed', { message: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Save className="h-5 w-5 text-accent" />
        <h3 className="text-sm font-semibold text-ink-1">{t('tools.workspace.title')}</h3>
      </div>
      <p className="text-xs text-ink-3 leading-relaxed">{t('tools.workspace.body')}</p>
      <div className="flex gap-2">
        <input
          className="input text-xs"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('tools.workspace.namePlaceholder')}
        />
        <button className="btn btn-primary text-xs shrink-0" onClick={() => { void save() }} disabled={busy}>
          <Save className="h-3.5 w-3.5" />
          {t('common.save')}
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <WorkspaceModeOption
          value="embed"
          checked={imageSaveMode === 'embed'}
          title={t('tools.workspace.mode.embed')}
          body={t('tools.workspace.mode.embedHint')}
          onChange={setImageSaveMode}
        />
        <WorkspaceModeOption
          value="references"
          checked={imageSaveMode === 'references'}
          title={t('tools.workspace.mode.references')}
          body={t('tools.workspace.mode.referencesHint')}
          onChange={setImageSaveMode}
        />
        <WorkspaceModeOption
          value="settings-only"
          checked={imageSaveMode === 'settings-only'}
          title={t('tools.workspace.mode.settingsOnly')}
          body={t('tools.workspace.mode.settingsOnlyHint')}
          onChange={setImageSaveMode}
        />
      </div>
      {workspaces.length > 0 && (
        <div className="border-t border-line pt-3 space-y-1.5">
          {workspaces.slice(0, 6).map((workspace) => (
            <div
              key={workspace.id}
              className="rounded-md border border-line bg-bg-2/50 p-2 text-xs"
              data-testid={`workspace-row-${workspace.id}`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium text-ink-1 truncate">{workspace.name}</span>
                <span className="ml-auto font-mono text-[10px] text-ink-3 shrink-0">
                  {new Date(workspace.updatedAt).toLocaleDateString()}
                </span>
              </div>
              <div className="font-mono text-[10px] text-ink-3 truncate mt-0.5">
                {workspace.model ?? t('titlebar.modelNotSelected')} / {workspace.promptPreview || '-'}
              </div>
              <div className="mt-2 flex gap-1">
                <button
                  className="btn btn-ghost text-[10px] py-0.5"
                  onClick={() => { void restore(workspace.id) }}
                  disabled={busy}
                  data-testid={`workspace-restore-${workspace.id}`}
                >
                  {t('history.restore')}
                </button>
                <button
                  className="btn btn-ghost text-[10px] py-0.5 ml-auto"
                  onClick={() => { void remove(workspace.id) }}
                  disabled={busy}
                  data-testid={`workspace-delete-${workspace.id}`}
                >
                  <Trash2 className="h-3 w-3" />
                  {t('history.delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function WorkspaceModeOption({
  value,
  checked,
  title,
  body,
  onChange
}: {
  value: WorkspaceImageSaveMode
  checked: boolean
  title: string
  body: string
  onChange: (value: WorkspaceImageSaveMode) => void
}): JSX.Element {
  return (
    <label className={cn(
      'flex cursor-pointer items-start gap-2 rounded-md border p-2 text-xs transition-colors',
      checked ? 'border-accent bg-accent/10' : 'border-line bg-bg-2/50 hover:border-ink-3'
    )}>
      <input
        type="radio"
        className="mt-0.5"
        name="workspace-image-save-mode"
        checked={checked}
        onChange={() => onChange(value)}
      />
      <span className="min-w-0">
        <span className="block font-semibold text-ink-1">{title}</span>
        <span className="mt-0.5 block leading-relaxed text-ink-3">{body}</span>
      </span>
    </label>
  )
}

type StoreSnapshot = ReturnType<typeof useStore.getState>

function restoreFabricImages(
  rawFabric: Partial<StoreSnapshot['fabric']> | undefined,
  positiveImages: Array<string | null>,
  negativeImages: Array<string | null>,
  positiveRefs: Array<WorkspaceImageReference | null> | undefined,
  negativeRefs: Array<WorkspaceImageReference | null> | undefined
): Partial<StoreSnapshot['fabric']> | null {
  if (!rawFabric) return null
  const restored: Partial<StoreSnapshot['fabric']> = { ...rawFabric }
  if (Array.isArray(rawFabric.positive)) {
    restored.positive = rawFabric.positive.map((item, index) => ({
      ...item,
      path: item.path ?? imageFilePath(positiveRefs?.[index]) ?? null,
      image: item.image || positiveImages[index] || ''
    }))
  }
  if (Array.isArray(rawFabric.negative)) {
    restored.negative = rawFabric.negative.map((item, index) => ({
      ...item,
      path: item.path ?? imageFilePath(negativeRefs?.[index]) ?? null,
      image: item.image || negativeImages[index] || ''
    }))
  }
  return restored
}

async function resolveImageReference(
  ref: WorkspaceImageReference | null | undefined,
  label: string,
  missingReferences: string[]
): Promise<string | null> {
  if (!ref) return null
  try {
    const image = await api.storage.resolveImageReference(ref)
    if (!image) missingReferences.push(label)
    return image
  } catch {
    missingReferences.push(label)
    return null
  }
}

function imageFilePath(ref: WorkspaceImageReference | null | undefined): string | null {
  return ref?.kind === 'file' ? ref.path : null
}

function imageHistoryId(ref: WorkspaceImageReference | null | undefined): string | null {
  return ref?.kind === 'history' ? ref.historyId : null
}

function imageReferenceFilename(ref: WorkspaceImageReference | null | undefined): string | null {
  return ref?.filename ?? null
}

function StartupDiagnosticsCard(): JSX.Element {
  const t = useT()
  const [metrics, setMetrics] = useState<StartupMetrics | null>(null)
  const [samples, setSamples] = useState<StartupMetricsSample[]>([])
  const [busy, setBusy] = useState(false)

  async function load(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const [nextMetrics, nextSamples] = await Promise.all([
        api.app.getStartupMetrics(),
        api.app.listStartupMetricSamples()
      ])
      setMetrics(nextMetrics)
      setSamples(nextSamples)
    } catch (e) {
      toast.error(tStatic('tools.startup.loadFailed', { message: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rows = metrics
    ? [
        { label: t('tools.startup.appReady'), value: formatMetricMs(metrics, metrics.appReadyAt) },
        { label: t('tools.startup.ipcReady'), value: formatMetricMs(metrics, metrics.ipcRegisteredAt) },
        { label: t('tools.startup.rendererLoaded'), value: formatMetricMs(metrics, metrics.rendererLoadedAt) },
        { label: t('tools.startup.windowShown'), value: formatMetricMs(metrics, metrics.windowShownAt) },
        { label: t('tools.startup.forgeRequested'), value: formatMetricMs(metrics, metrics.forgeAutoStartRequestedAt) },
        { label: t('tools.startup.forgeReady'), value: formatMetricMs(metrics, metrics.forgeReadyAt) }
      ]
    : []

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Activity className="h-5 w-5 text-accent" />
        <h3 className="text-sm font-semibold text-ink-1">{t('tools.startup.title')}</h3>
        <button className="btn btn-ghost text-xs ml-auto" onClick={() => { void load() }} disabled={busy}>
          <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />
          {t('common.update')}
        </button>
      </div>
      <p className="text-xs text-ink-3 leading-relaxed">{t('tools.startup.body')}</p>
      {metrics ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
            {rows.map((row) => (
              <Stat key={row.label} label={row.label} value={row.value} />
            ))}
          </div>
          <div className="rounded-md border border-line bg-bg-2/60 p-2 text-[11px] text-ink-3">
            {t('tools.startup.status')}: {metrics.forgeLastStatusKind ?? '-'}
          </div>
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-ink-2">{t('tools.startup.recentSamples')}</h4>
            {samples.length > 0 ? (
              <div className="overflow-hidden rounded-md border border-line text-[11px]">
                {samples.map((sample) => (
                  <div
                    key={`${sample.processStartedAt}-${sample.capturedAt}`}
                    className="grid grid-cols-[minmax(0,1.3fr)_auto_auto] gap-2 border-b border-line/70 px-2 py-1.5 last:border-b-0"
                  >
                    <span className="truncate text-ink-3">{formatDateTime(sample.capturedAt)}</span>
                    <span className="text-ink-2">{formatDurationMaybe(sample.rendererLoadedMs)}</span>
                    <span className="text-ink-1">{formatDurationMaybe(sample.forgeReadyMs)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-line bg-bg-2/60 p-2 text-[11px] text-ink-3">
                {t('tools.startup.noSamples')}
              </div>
            )}
            <p className="text-[11px] text-ink-3">{t('tools.startup.sampleHint')}</p>
          </div>
        </>
      ) : (
        <div className="text-xs text-ink-3">{t('common.loading')}</div>
      )}
    </div>
  )
}

function TaggerCatalogCard(): JSX.Element {
  const t = useT()
  const inputImage = useStore((s) => s.inputImage)
  const lastImage = useStore((s) => s.lastImage)
  const prompt = useStore((s) => s.prompt)
  const setPrompt = useStore((s) => s.setPrompt)
  const setExtractedTags = useStore((s) => s.setExtractedTags)
  const [checkingId, setCheckingId] = useState<string | null>(null)
  const [fileResults, setFileResults] = useState<Record<string, HuggingFaceSearchFile[]>>({})
  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<TaggerRunResult | null>(null)
  const [minScore, setMinScore] = useState(DEFAULT_TAGGER_MIN_SCORE)
  const [excludeMeta, setExcludeMeta] = useState(true)
  const [blacklistText, setBlacklistText] = useState(DEFAULT_TAGGER_BLACKLIST.join(', '))
  const currentImage = inputImage ?? lastImage

  async function checkFiles(item: TaggerCatalogItem): Promise<void> {
    if (checkingId) return
    setCheckingId(item.id)
    try {
      const result = await api.huggingface.search({
        query: item.repoId,
        assetTypes: ['Tagger'],
        limit: 8
      })
      const matched = result.items.find((candidate) => candidate.repoId.toLowerCase() === item.repoId.toLowerCase()) ?? result.items[0]
      const files = matched?.files ?? []
      setFileResults((prev) => ({ ...prev, [item.id]: files }))
      if (files.length > 0) {
        toast.success(tStatic('tools.tagger.filesFound', { count: files.length }))
      } else {
        toast(tStatic('tools.tagger.filesMissing'), { icon: '!' })
      }
    } catch (e) {
      toast.error(tStatic('tools.tagger.fileCheckFailed', { message: (e as Error).message }))
    } finally {
      setCheckingId(null)
    }
  }

  async function runLocalPixAi(): Promise<void> {
    if (running) return
    if (!currentImage) {
      toast(tStatic('tools.tagger.noImage'), { icon: '!' })
      return
    }
    setRunning(true)
    try {
      const result = await api.tools.runTagger({
        image: currentImage,
        modelId: 'pixai-onnx',
        generalThreshold: 0.3,
        characterThreshold: 0.85,
        minScore,
        excludeMeta,
        blacklist: parseTaggerBlacklist(blacklistText),
        limit: 60
      })
      setRunResult(result)
      if (result.ok) {
        setExtractedTags(result.promptTags)
        toast.success(tStatic('tools.tagger.runDone', { count: result.promptTags.length }))
      } else {
        toast.error(tStatic('tools.tagger.runFailed', { message: result.message }))
      }
    } catch (e) {
      toast.error(tStatic('tools.tagger.runFailed', { message: (e as Error).message }))
    } finally {
      setRunning(false)
    }
  }

  function addTagToPrompt(tag: string): void {
    setPrompt(promptAppend(prompt, tag))
  }

  function addAllRunTags(): void {
    if (!runResult?.promptTags.length) return
    const next = runResult.promptTags.reduce((value, tag) => promptAppend(value, tag), prompt)
    setPrompt(next)
    toast.success(tStatic('tools.tagger.tagsAdded', { count: runResult.promptTags.length }))
  }

  return (
    <div className="card p-4 space-y-3" data-testid="tagger-catalog">
      <div className="flex items-center gap-2">
        <Tag className="h-5 w-5 text-accent" />
        <h3 className="text-sm font-semibold text-ink-1">{t('tools.tagger.title')}</h3>
      </div>
      <p className="text-xs text-ink-3 leading-relaxed">{t('tools.tagger.body')}</p>
      <div className="rounded-md border border-line bg-bg-2/50 p-2 text-[11px] text-ink-3">
        <div className="font-mono text-ink-2">{t('tools.tagger.activePath')}</div>
        <div className="mt-1">{t('tools.tagger.safeRule')}</div>
      </div>
      <div className="rounded-md border border-line bg-bg-2/50 p-2 text-xs space-y-2" data-testid="tagger-run-panel">
        <div className="flex items-center gap-2">
          <Play className={cn('h-3.5 w-3.5 text-accent', running && 'animate-pulse')} />
          <span className="font-semibold text-ink-1">{t('tools.tagger.localRun')}</span>
          <span className="ml-auto text-[10px] text-ink-3">
            {currentImage ? t('tools.tagger.imageReady') : t('tools.tagger.noImageShort')}
          </span>
        </div>
        <div className="rounded border border-line bg-bg-1/60 p-2 space-y-2" data-testid="tools-tagger-filter">
          <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
            <label className="min-w-0">
              <div className="flex items-baseline justify-between text-[10px] text-ink-3">
                <span>{t('taggerFilter.minScore')}</span>
                <span className="font-mono text-ink-1">{minScore.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0.3}
                max={0.8}
                step={0.01}
                value={minScore}
                onChange={(e) => setMinScore(parseFloat(e.target.value))}
                className="w-full accent-accent"
              />
            </label>
            <label className="flex items-center gap-1.5 text-[10px] text-ink-2">
              <input
                type="checkbox"
                checked={excludeMeta}
                onChange={(e) => setExcludeMeta(e.target.checked)}
                className="accent-accent"
              />
              {t('taggerFilter.excludeMeta')}
            </label>
          </div>
          <label className="block">
            <span className="text-[10px] text-ink-3">{t('taggerFilter.blacklist')}</span>
            <textarea
              className="input mt-1 min-h-12 text-[10px] font-mono"
              value={blacklistText}
              onChange={(e) => setBlacklistText(e.target.value)}
            />
          </label>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-primary flex-1 justify-center text-xs gap-1.5"
            onClick={() => { void runLocalPixAi() }}
            disabled={running || !currentImage}
            data-testid="tagger-run-current-image"
          >
            <Play className="h-3.5 w-3.5" />
            {running ? t('tools.tagger.running') : t('tools.tagger.runLocal')}
          </button>
          {runResult?.ok && runResult.promptTags.length > 0 && (
            <button type="button" className="btn text-xs" onClick={addAllRunTags}>
              {t('tools.tagger.addAll')}
            </button>
          )}
        </div>
        {runResult && (
          <div className="border-t border-line/70 pt-2 space-y-2" data-testid="tagger-run-result" data-tagger-status={runResult.status}>
            <div className={cn('text-[11px] leading-relaxed', runResult.ok ? 'text-ok' : 'text-warn')}>
              {runResult.message}
              {runResult.provider && ` / ${runResult.provider}`}
              {runResult.elapsedMs != null && ` / ${runResult.elapsedMs}ms`}
            </div>
            <div className="font-mono text-[10px] text-ink-3 truncate">{runResult.modelPath ?? runResult.modelDir}</div>
            {runResult.filter && (
              <div className="text-[10px] text-ink-3" data-testid="tagger-run-filter-summary">
                {t('taggerFilter.keptSuppressed', { kept: runResult.filter.kept, suppressed: runResult.filter.suppressed })}
              </div>
            )}
            {runResult.promptTags.length > 0 && (
              <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto">
                {runResult.promptTags.slice(0, 40).map((tag, index) => (
                  <button
                    key={`${tag}-${index}`}
                    type="button"
                    className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-1 hover:border-accent hover:bg-bg-3"
                    onClick={() => addTagToPrompt(tag)}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
            {(runResult.suppressedTags?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto" data-testid="tagger-run-suppressed">
                {runResult.suppressedTags?.slice(0, 32).map((tag, index) => (
                  <span key={`${tag.name}-${index}`} className="rounded border border-line bg-bg-3 px-1.5 py-0.5 text-[10px] text-ink-3">
                    {tag.name.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="space-y-2">
        {TAGGER_CATALOG.map((item, index) => {
          const files = fileResults[item.id]
          return (
            <div key={item.id} className="rounded-md border border-line bg-bg-2/40 p-3 text-xs space-y-2">
              <div className="flex items-start gap-2 min-w-0">
                <div className="h-6 w-6 rounded bg-bg-3 border border-line flex items-center justify-center font-mono text-[11px] text-ink-2 shrink-0">
                  {index + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold text-ink-1">{item.name}</span>
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px] border', taggerTierClass(item.tier))}>
                      {taggerTierLabel(item.tier)}
                    </span>
                    <span className="rounded border border-line bg-bg-3 px-1.5 py-0.5 text-[10px] text-ink-2">
                      {item.license}
                    </span>
                    <span className={cn(
                      'rounded border px-1.5 py-0.5 text-[10px]',
                      item.access === 'public' ? 'border-ok/40 text-ok bg-ok/10' : 'border-warn/40 text-warn bg-warn/10'
                    )}>
                      {item.access}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-ink-3 truncate">{item.repoId}</div>
                </div>
                <button
                  className="btn btn-icon btn-ghost shrink-0"
                  onClick={() => api.app.openExternal(`https://huggingface.co/${item.repoId}`)}
                  title={t('tools.tagger.openModel')}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Stat label="runtime" value={item.runtime} />
                <Stat label="tags" value={item.tagCount} />
                <Stat label="data" value={item.dataSnapshot} />
                <Stat label={t('tools.tagger.threshold')} value={item.thresholdHint} />
              </div>
              <p className="text-[11px] text-ink-2 leading-relaxed">{item.role}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <TaggerList title={t('tools.tagger.strengths')} items={item.strengths} />
                <TaggerList title={t('tools.tagger.cautions')} items={item.cautions} />
              </div>
              <div className="border-t border-line/70 pt-2 space-y-2">
                <button
                  className="btn btn-ghost text-[11px] py-1 gap-1.5"
                  onClick={() => { void checkFiles(item) }}
                  disabled={!!checkingId}
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', checkingId === item.id && 'animate-spin')} />
                  {t('tools.tagger.checkFiles')}
                </button>
                {files && (
                  <div className="space-y-1">
                    {files.length === 0 ? (
                      <div className="text-[11px] text-ink-3">{t('tools.tagger.filesMissing')}</div>
                    ) : (
                      files.slice(0, 5).map((file) => (
                        <div key={file.path} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 font-mono text-[10px] text-ink-3">
                          <span className="truncate">{file.path}</span>
                          <span>{file.sizeBytes ? formatBytes(file.sizeBytes) : '-'}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TaggerList({ title, items }: { title: string; items: string[] }): JSX.Element {
  return (
    <div className="rounded-md border border-line/70 bg-bg-1/40 p-2">
      <div className="text-[10px] text-ink-3 mb-1">{title}</div>
      <div className="space-y-1">
        {items.map((item) => (
          <div key={item} className="text-[11px] text-ink-2 leading-relaxed">{item}</div>
        ))}
      </div>
    </div>
  )
}

function taggerTierClass(tier: TaggerCatalogItem['tier']): string {
  switch (tier) {
    case 'standard': return 'border-ok/40 bg-ok/10 text-ok'
    case 'baseline': return 'border-accent/40 bg-accent-dim/40 text-accent'
    case 'experiment': return 'border-warn/40 bg-warn/10 text-warn'
    case 'research': return 'border-line bg-bg-3 text-ink-2'
    case 'defer': return 'border-err/40 bg-err/10 text-err'
  }
}

function isPartialIntegrityIssue(issue: LibraryIntegrityReport['issues'][number]): boolean {
  return Boolean(
    issue.path &&
    !issue.jobId &&
    issue.path.toLowerCase().includes('.partial') &&
    issue.message.toLowerCase().includes('partial')
  )
}

function ModelLibraryCard(): JSX.Element {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<ModelLibrarySummary | null>(null)
  const [jobs, setJobs] = useState<DownloadJob[]>([])
  const [integrity, setIntegrity] = useState<LibraryIntegrityReport | null>(null)
  const [hashingId, setHashingId] = useState<string | null>(null)
  const [deletingPartialPath, setDeletingPartialPath] = useState<string | null>(null)
  const [libraryQuery, setLibraryQuery] = useState('')
  const [libraryType, setLibraryType] = useState('all')

  async function load(): Promise<void> {
    const [nextSummary, nextJobs] = await Promise.all([
      api.tools.listModelLibrary(),
      api.tools.listDownloadJobs()
    ])
    setSummary(nextSummary)
    setJobs(nextJobs)
  }

  useEffect(() => {
    void load().catch((e) => {
      toast.error(tStatic('tools.library.loadFailed', { message: (e as Error).message }))
    })
  }, [])

  useEffect(() => {
    return api.civitai.onDownloadProgress(() => {
      void api.tools.listDownloadJobs().then(setJobs).catch(() => undefined)
    })
  }, [])

  async function rescan(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const next = await api.tools.rescanModelLibrary()
      const nextJobs = await api.tools.listDownloadJobs()
      setSummary(next)
      setJobs(nextJobs)
      toast.success(tStatic('tools.library.scanned', { count: next.totals.files }))
    } catch (e) {
      toast.error(tStatic('tools.library.scanFailed', { message: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  async function resume(job: DownloadJob): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      toast.success(tStatic('tools.library.resumeStarted', { name: job.filename }))
      void api.tools.resumeDownloadJob(job.id)
        .then(() => load())
        .catch((e: Error) => {
          toast.error(tStatic('tools.library.resumeFailed', { message: e.message }))
        })
    } catch (e) {
      toast.error(tStatic('tools.library.resumeFailed', { message: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  async function discard(job: DownloadJob): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      await api.tools.discardDownloadJob(job.id)
      await load()
      toast.success(tStatic('tools.library.discarded'))
    } catch (e) {
      toast.error(tStatic('tools.library.discardFailed', { message: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  async function openJob(job: DownloadJob): Promise<void> {
    try {
      await api.tools.openDownloadJobFolder(job.id)
    } catch (e) {
      toast.error(tStatic('tools.library.openFailed', { message: (e as Error).message }))
    }
  }

  async function checkIntegrity(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const report = await api.tools.checkLibraryIntegrity()
      setIntegrity(report)
      if (report.totals.issues === 0) {
        toast.success(tStatic('tools.library.integrityClean'))
      } else {
        toast(tStatic('tools.library.integrityIssues', { count: report.totals.issues }), { icon: '!' })
      }
    } catch (e) {
      toast.error(tStatic('tools.library.integrityFailed', { message: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  async function deletePartial(path: string): Promise<void> {
    if (deletingPartialPath) return
    setDeletingPartialPath(path)
    try {
      const result = await api.tools.deletePartialFile(path)
      const [nextReport, nextSummary, nextJobs] = await Promise.all([
        api.tools.checkLibraryIntegrity(),
        api.tools.listModelLibrary(),
        api.tools.listDownloadJobs()
      ])
      setIntegrity(nextReport)
      setSummary(nextSummary)
      setJobs(nextJobs)
      toast.success(tStatic('tools.library.partialDeleted', { size: formatBytes(result.sizeBytes) }))
    } catch (e) {
      toast.error(tStatic('tools.library.partialDeleteFailed', { message: (e as Error).message }))
    } finally {
      setDeletingPartialPath(null)
    }
  }

  async function hashEntry(entryId: string): Promise<void> {
    if (hashingId) return
    setHashingId(entryId)
    try {
      const result = await api.tools.hashModelLibraryEntry(entryId)
      const next = await api.tools.listModelLibrary()
      setSummary(next)
      toast.success(tStatic('tools.library.hashDone', { sha: result.sha256.slice(0, 12) }))
    } catch (e) {
      toast.error(tStatic('tools.library.hashFailed', { message: (e as Error).message }))
    } finally {
      setHashingId(null)
    }
  }

  async function recoverLibrary(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const result = await api.tools.recoverModelLibrary()
      await load()
      toast.success(tStatic('tools.library.recoveryDone', {
        jobs: result.recoveredJobs + result.completedJobsFixed,
        previews: result.previewsRefetched,
        hashes: result.hashesQueued
      }))
    } catch (e) {
      toast.error(tStatic('tools.library.recoveryFailed', { message: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  const typeEntries = Object.entries(summary?.byType ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 8)
  const libraryTypes = Object.keys(summary?.byType ?? {}).sort((a, b) => a.localeCompare(b))
  const normalizedQuery = libraryQuery.trim().toLocaleLowerCase()
  const filteredEntries = (summary?.entries ?? []).filter((entry) => {
    if (libraryType !== 'all' && entry.type !== libraryType) return false
    if (!normalizedQuery) return true
    return [
      entry.name,
      entry.type,
      entry.path,
      entry.source,
      entry.sourceMeta?.baseModel,
      entry.sourceMeta?.repoId,
      entry.sourceMeta?.creator,
      entry.sha256 ?? ''
    ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery))
  })
  const visibleEntries = filteredEntries.slice(0, 25)
  const recentJobs = jobs.slice(0, 5)

  return (
    <div className="card p-4 space-y-3" data-testid="model-library-card">
      <div className="flex items-center gap-2">
        <Database className="h-5 w-5 text-accent" />
        <h3 className="text-sm font-semibold text-ink-1">{t('tools.library.title')}</h3>
        <button
          className="btn btn-icon btn-ghost ml-auto"
          disabled={busy}
          onClick={() => { void rescan() }}
          title={t('tools.library.rescan')}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <HealthStat label={t('tools.library.files')} value={String(summary?.totals.files ?? 0)} ok={(summary?.totals.files ?? 0) > 0} />
        <HealthStat label={t('tools.library.size')} value={formatBytes(summary?.totals.totalBytes ?? 0)} ok={(summary?.totals.totalBytes ?? 0) > 0} />
      </div>

      {summary?.scanStats && (
        <div className="rounded-md border border-line bg-bg-2/50 p-2 text-xs space-y-2">
          <div className="text-[10px] text-ink-3">{t('tools.library.scanStats')}</div>
          <div className="grid grid-cols-3 gap-2">
            <Stat label={t('tools.library.scanNew')} value={String(summary.scanStats.newFiles)} />
            <Stat label={t('tools.library.scanUpdated')} value={String(summary.scanStats.updatedFiles)} />
            <Stat label={t('tools.library.scanUnchanged')} value={String(summary.scanStats.unchangedFiles)} />
            <Stat label={t('tools.library.scanRemoved')} value={String(summary.scanStats.removedFiles)} />
            <Stat label={t('tools.library.shaPreserved')} value={String(summary.scanStats.shaPreserved)} />
            <Stat label={t('tools.library.shaInvalidated')} value={String(summary.scanStats.shaInvalidated)} />
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button className="btn text-xs gap-1.5" onClick={() => { void checkIntegrity() }} disabled={busy}>
          <ShieldCheck className="h-3.5 w-3.5" />
          {t('tools.library.integrity')}
        </button>
        <button className="btn text-xs gap-1.5" onClick={() => { void recoverLibrary() }} disabled={busy}>
          <Wrench className="h-3.5 w-3.5" />
          {t('tools.library.recover')}
        </button>
        {summary?.entries.some((entry) => !entry.sha256) && (
          <button
            className="btn text-xs gap-1.5"
            onClick={() => {
              const target = summary.entries.find((entry) => !entry.sha256)
              if (target) void hashEntry(target.id)
            }}
            disabled={!!hashingId}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', hashingId && 'animate-spin')} />
            {hashingId ? t('tools.library.hashing') : t('tools.library.hashOne')}
          </button>
        )}
      </div>

      {integrity && (
        <div className="rounded-md border border-line bg-bg-2/50 p-2 text-xs space-y-1">
          <div className="grid grid-cols-3 gap-2">
            <Stat label={t('tools.library.integrityIssuesLabel')} value={String(integrity.totals.issues)} />
            <Stat label={t('tools.library.shaMissing')} value={String(integrity.totals.shaMissing)} />
            <Stat label={t('tools.library.partialDownloads')} value={String(integrity.totals.partialDownloads)} />
          </div>
          {integrity.issues.slice(0, 5).map((issue, index) => (
            <div
              key={`${issue.entryId ?? issue.jobId ?? issue.path ?? 'issue'}-${index}`}
              className="flex items-start gap-2 rounded border border-line/70 bg-bg-1/40 p-1.5"
            >
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[10px] text-ink-3 truncate">
                  [{issue.severity}] {issue.message}
                </div>
                {issue.path && <div className="font-mono text-[9px] text-ink-3 truncate">{issue.path}</div>}
              </div>
              {isPartialIntegrityIssue(issue) && issue.path && (
                <button
                  type="button"
                  className="btn btn-ghost shrink-0 px-1.5 py-0.5 text-[10px] gap-1"
                  onClick={() => { void deletePartial(issue.path!) }}
                  disabled={deletingPartialPath === issue.path}
                  data-testid={`library-delete-partial-${index}`}
                >
                  <Trash2 className="h-3 w-3" />
                  {deletingPartialPath === issue.path ? t('tools.library.deletingPartial') : t('tools.library.deletePartial')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {typeEntries.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          {typeEntries.map(([type, stat]) => (
            <div key={type} className="rounded-md border border-line bg-bg-2/50 p-2">
              <div className="text-[10px] text-ink-3">{type}</div>
              <div className="font-mono text-ink-1">{stat.files}</div>
              <div className="font-mono text-[10px] text-ink-3">{formatBytes(stat.totalBytes)}</div>
            </div>
          ))}
        </div>
      )}

      {(summary?.entries.length ?? 0) > 0 && (
        <div className="border-t border-line pt-3 space-y-2">
          <div className="flex items-center gap-2 text-xs text-ink-2">
            <Search className="h-3.5 w-3.5" />
            <span>{t('tools.library.entries')}</span>
            <span className="ml-auto font-mono text-[10px] text-ink-3">
              {t('tools.library.filtered', { shown: visibleEntries.length, total: filteredEntries.length })}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-2">
            <input
              className="input h-8 text-xs"
              value={libraryQuery}
              onChange={(event) => setLibraryQuery(event.target.value)}
              placeholder={t('tools.library.searchPlaceholder')}
            />
            <select
              className="input h-8 text-xs"
              value={libraryType}
              onChange={(event) => setLibraryType(event.target.value)}
              aria-label={t('tools.library.typeFilter')}
            >
              <option value="all">{t('tools.library.typeAll')}</option>
              {libraryTypes.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            {visibleEntries.length === 0 ? (
              <div className="text-xs text-ink-3">{t('tools.library.noEntries')}</div>
            ) : (
              visibleEntries.map((entry) => (
                <div key={entry.id} className="rounded-md border border-line bg-bg-2/50 p-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="rounded bg-bg-3 px-1.5 py-0.5 text-[10px] text-ink-2 shrink-0">{entry.type}</span>
                    <span className="font-mono text-[11px] text-ink-1 truncate">{entry.name}</span>
                    <span className="ml-auto font-mono text-[10px] text-ink-3 shrink-0">{formatBytes(entry.sizeBytes)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-ink-3 min-w-0">
                    <span className="shrink-0">{entry.source}</span>
                    {entry.sourceMeta?.baseModel && <span className="shrink-0">{entry.sourceMeta.baseModel}</span>}
                    <span className="font-mono truncate">{entry.sha256 ? entry.sha256.slice(0, 12) : t('tools.library.shaMissing')}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div className="border-t border-line pt-3 space-y-2">
        <div className="flex items-center gap-2 text-xs text-ink-2">
          <Download className="h-3.5 w-3.5" />
          <span>{t('tools.library.downloads')}</span>
        </div>
        {recentJobs.length === 0 ? (
          <div className="text-xs text-ink-3">{t('tools.library.noDownloads')}</div>
        ) : (
          <div className="space-y-1.5">
            {recentJobs.map((job) => (
              <div key={job.id} className="rounded-md border border-line bg-bg-2/50 p-2 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={cn('h-2 w-2 rounded-full shrink-0', statusColor(job.status))} />
                  <span className="font-mono text-[11px] text-ink-1 truncate">{job.filename}</span>
                  <span className="ml-auto text-[10px] text-ink-3 shrink-0">{t(`tools.library.status.${job.status}`)}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-ink-3">
                  <span>{job.assetType}</span>
                  {job.source?.provider && <span>{job.source.provider}</span>}
                  <span className="font-mono">{formatDownloadProgress(job)}</span>
                </div>
                <div className="mt-2 flex items-center gap-1">
                  {(job.status === 'failed' || job.status === 'canceled') && (
                    <button
                      className="btn btn-ghost text-[10px] py-0.5 gap-1"
                      onClick={() => { void resume(job) }}
                      disabled={busy}
                      title={t('tools.library.resume')}
                    >
                      <Play className="h-3 w-3" />
                      {t('tools.library.resume')}
                    </button>
                  )}
                  <button
                    className="btn btn-ghost text-[10px] py-0.5 gap-1"
                    onClick={() => { void openJob(job) }}
                    title={t('tools.library.openFolder')}
                  >
                    <FolderOpen className="h-3 w-3" />
                    {t('tools.library.openFolder')}
                  </button>
                  <button
                    className="btn btn-ghost text-[10px] py-0.5 gap-1 ml-auto"
                    onClick={() => { void discard(job) }}
                    disabled={busy}
                    title={t('tools.library.discard')}
                  >
                    <Trash2 className="h-3 w-3" />
                    {t('tools.library.discard')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CatalogHealthCard(): JSX.Element {
  const t = useT()
  const status = useStore((s) => s.forgeStatus)
  const models = useStore((s) => s.models)
  const loras = useStore((s) => s.loras)
  const vaes = useStore((s) => s.vaes)
  const controlnetModels = useStore((s) => s.controlnetModelList)
  const controlnetModules = useStore((s) => s.controlnetModuleList)
  const upscalers = useStore((s) => s.upscalerList)
  const openCivitaiSearch = useStore((s) => s.openCivitaiSearch)
  const [refreshing, setRefreshing] = useState(false)

  const tileModel = controlnetModels.find((m) => /tile|controlnet-tile|sdxl/i.test(m))
  const tileModule = controlnetModules.find((m) => /tile_resample|tile/i.test(m))
  const ready = status.kind === 'ready'

  async function refresh(): Promise<void> {
    if (!ready || refreshing) return
    setRefreshing(true)
    try {
      const [nextModels, nextLoras, nextVaes, nextControlnetModels, nextControlnetModules, nextUpscalers] =
        await Promise.all([
          api.forge.listModels(),
          api.forge.listLoras().catch(() => []),
          api.forge.listVaes().catch(() => []),
          api.forge.listControlnetModels().catch(() => []),
          api.forge.listControlnetModules().catch(() => []),
          api.forge.listUpscalers().catch(() => [])
        ])
      const s = useStore.getState()
      s.setModels(nextModels)
      s.setLoras(nextLoras)
      s.setVaes(nextVaes)
      s.setControlnetCatalogs(nextControlnetModels, nextControlnetModules)
      s.setUpscalerList(nextUpscalers)
      toast.success(tStatic('tools.health.refreshed'))
    } catch (e) {
      toast.error(tStatic('tools.health.refreshFailed', { message: (e as Error).message }))
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-accent" />
        <h3 className="text-sm font-semibold text-ink-1">{t('tools.health.title')}</h3>
        <button
          className="btn btn-icon btn-ghost ml-auto"
          disabled={!ready || refreshing}
          onClick={() => { void refresh() }}
          title={t('tools.health.refresh')}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
        <HealthStat label={t('tools.health.forge')} value={status.kind} ok={ready} />
        <HealthStat label={t('tools.health.checkpoints')} value={String(models.length)} ok={models.length > 0} />
        <HealthStat label={t('tools.health.loras')} value={String(loras.length)} ok />
        <HealthStat label={t('tools.health.vaes')} value={String(vaes.length)} ok={vaes.length > 0} />
        <HealthStat label={t('tools.health.controlnet')} value={String(controlnetModels.length)} ok={controlnetModels.length > 0} />
        <HealthStat label={t('tools.health.upscalers')} value={String(upscalers.length)} ok={upscalers.length > 0} />
      </div>

      <div className="border-t border-line pt-3 space-y-2 text-xs">
        <HealthLine
          ok={!!tileModel}
          label={t('tools.health.tileModel')}
          detail={tileModel ?? t('tools.health.missing')}
        />
        <HealthLine
          ok={!!tileModule}
          label={t('tools.health.tileModule')}
          detail={tileModule ?? t('tools.health.missing')}
        />
        {!tileModel && (
          <button
            className="btn text-xs py-1"
            onClick={() => openCivitaiSearch('Controlnet')}
          >
            <Search className="h-3.5 w-3.5" />
            {t('tools.health.searchControlNet')}
          </button>
        )}
      </div>
    </div>
  )
}

function HealthStat({ label, value, ok }: { label: string; value: string; ok: boolean }): JSX.Element {
  return (
    <div className="rounded-md border border-line bg-bg-2/50 p-2">
      <div className="text-[10px] text-ink-3">{label}</div>
      <div className={cn('font-mono text-sm', ok ? 'text-ok' : 'text-warn')}>{value}</div>
    </div>
  )
}

function HealthLine({ ok, label, detail }: { ok: boolean; label: string; detail: string }): JSX.Element {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className={cn('h-2 w-2 rounded-full shrink-0', ok ? 'bg-ok' : 'bg-warn')} />
      <span className="text-ink-2 shrink-0">{label}</span>
      <span className="font-mono text-[11px] text-ink-3 truncate">{detail}</span>
    </div>
  )
}

interface InspectionResult {
  filepath: string
  sizeBytes: number
  kind: string
  sampleKeys: string[]
  keyCount: number
  metadata: Record<string, string> | null
}

interface ModelHealthScanResult {
  root: string
  scannedAt: number
  totals: { files: number; totalBytes: number; issues: number }
  folders: Array<{
    id: string
    label: string
    path: string
    exists: boolean
    files: number
    totalBytes: number
  }>
  issues: Array<{
    severity: 'warn' | 'error'
    folder: string
    file: string | null
    message: string
  }>
}

function ModelHealthScanCard(): JSX.Element {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ModelHealthScanResult | null>(null)

  async function scan(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const next = await api.tools.scanModelHealth()
      setResult(next)
      if (next.totals.issues === 0) {
        toast.success(tStatic('tools.modelHealth.clean'))
      } else {
        toast(tStatic('tools.modelHealth.issueCount', { count: next.totals.issues }), { icon: '!' })
      }
    } catch (e) {
      toast.error(tStatic('tools.modelHealth.failed', { message: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 text-accent" />
        <h3 className="text-sm font-semibold text-ink-1">{t('tools.modelHealth.title')}</h3>
      </div>
      <p className="text-xs text-ink-3 leading-relaxed">{t('tools.modelHealth.body')}</p>
      <button className="btn gap-1.5" onClick={() => { void scan() }} disabled={busy}>
        <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />
        {busy ? t('tools.modelHealth.running') : t('tools.modelHealth.scan')}
      </button>

      {result && (
        <div className="border-t border-line pt-3 space-y-3 text-xs">
          <div className="font-mono text-[11px] text-ink-2 break-all">{result.root}</div>
          <div className="grid grid-cols-3 gap-2">
            <Stat label={t('tools.modelHealth.files')} value={String(result.totals.files)} />
            <Stat label={t('tools.modelHealth.size')} value={formatBytes(result.totals.totalBytes)} />
            <Stat label={t('tools.modelHealth.issues')} value={String(result.totals.issues)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {result.folders.map((folder) => (
              <div key={folder.id} className="rounded-md border border-line bg-bg-2/50 p-2">
                <div className="flex items-center gap-1.5">
                  <span className={cn('h-2 w-2 rounded-full', folder.exists ? 'bg-ok' : 'bg-warn')} />
                  <span className="text-ink-1">{folder.label}</span>
                </div>
                <div className="font-mono text-[10px] text-ink-3 mt-1">
                  {folder.exists
                    ? `${folder.files} / ${formatBytes(folder.totalBytes)}`
                    : t('tools.modelHealth.missingFolder')}
                </div>
              </div>
            ))}
          </div>
          {result.issues.length > 0 && (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {result.issues.slice(0, 40).map((issue, index) => (
                <div key={`${issue.folder}-${issue.file ?? 'folder'}-${index}`} className="rounded bg-bg-2/60 p-2">
                  <div className={cn('text-[10px] font-semibold', issue.severity === 'error' ? 'text-err' : 'text-warn')}>
                    {issue.severity.toUpperCase()} / {issue.folder}
                  </div>
                  {issue.file && <div className="font-mono text-[10px] text-ink-2 break-all">{issue.file}</div>}
                  <div className="text-ink-3">{issue.message}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ModelInspectorCard(): JSX.Element {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<InspectionResult | null>(null)

  async function pickAndInspect(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const filepath = await api.tools.pickModelFile()
      if (!filepath) return
      const r = await api.tools.inspectModel(filepath)
      setResult(r)
    } catch (e) {
      toast.error(`${t('tools.inspect.failed')}: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <FileSearch className="h-5 w-5 text-accent" />
        <h3 className="text-sm font-semibold text-ink-1">{t('tools.inspector.title')}</h3>
      </div>
      <p className="text-xs text-ink-3 leading-relaxed">{t('tools.inspector.body')}</p>
      <button className="btn gap-1.5" onClick={pickAndInspect} disabled={busy}>
        <Wrench className={busy ? 'h-3.5 w-3.5 animate-pulse' : 'h-3.5 w-3.5'} />
        {busy ? t('tools.inspector.running') : t('tools.inspector.pick')}
      </button>

      {result && (
        <div className="border-t border-line pt-3 space-y-2 text-xs">
          <div className="font-mono text-[11px] text-ink-2 break-all">{result.filepath}</div>
          <div className="grid grid-cols-2 gap-2">
            <Stat label={t('tools.inspector.kind')} value={result.kind} />
            <Stat label={t('tools.inspector.size')} value={formatBytes(result.sizeBytes)} />
          </div>
          {result.sampleKeys.length > 0 && (
            <div>
              <div className="text-[10px] text-ink-3 mb-1">{t('tools.inspector.sampleKeys')}</div>
              <div className="font-mono text-[10px] bg-bg-2/60 rounded p-2 space-y-0.5 max-h-32 overflow-y-auto">
                {result.sampleKeys.map((k) => (<div key={k}>{k}</div>))}
              </div>
            </div>
          )}
          {result.metadata && Object.keys(result.metadata).length > 0 && (
            <div>
              <div className="text-[10px] text-ink-3 mb-1">{t('tools.inspector.metadata')}</div>
              <div className="font-mono text-[10px] bg-bg-2/60 rounded p-2 max-h-48 overflow-y-auto space-y-0.5">
                {Object.entries(result.metadata).slice(0, 50).map(([k, v]) => (
                  <div key={k}><span className="text-ink-3">{k}</span>: <span className="text-ink-1">{truncate(v, 200)}</span></div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ModelMergerCard(): JSX.Element {
  const t = useT()
  const models = useStore((s) => s.models)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<ModelMergerSupportReport | null>(null)
  const [result, setResult] = useState<ModelMergerResult | null>(null)
  const [progress, setProgress] = useState<ModelMergerProgress | null>(null)
  const [estimate, setEstimate] = useState<ModelMergerEstimate | null>(null)
  const [estimateError, setEstimateError] = useState<string | null>(null)
  const [outputInspection, setOutputInspection] = useState<InspectionResult | null>(null)
  const [req, setReq] = useState<ModelMergerRequest>(() => ({
    primaryModelName: '',
    secondaryModelName: null,
    tertiaryModelName: null,
    interpMethod: 'Weighted sum',
    multiplier: 0.3,
    saveAsHalf: false,
    customName: `yoitomoshi-merge-${new Date().toISOString().slice(0, 10)}`,
    checkpointFormat: 'safetensors',
    configSource: 0,
    bakeInVae: 'None',
    discardWeights: '',
    saveMetadata: true,
    addMergeRecipe: true,
    copyMetadataFields: true,
    metadataJson: '{}'
  }))

  useEffect(() => {
    if (req.primaryModelName || models.length === 0) return
    setReq((current) => ({
      ...current,
      primaryModelName: models[0]?.title ?? '',
      secondaryModelName: models[1]?.title ?? current.secondaryModelName
    }))
  }, [models, req.primaryModelName, req.secondaryModelName])

  useEffect(() => api.tools.onModelMergerProgress(setProgress), [])

  useEffect(() => {
    const needsSecond = req.interpMethod === 'Weighted sum' || req.interpMethod === 'Add difference'
    const needsThird = req.interpMethod === 'Add difference'
    const ready =
      !!req.primaryModelName &&
      (!needsSecond || !!req.secondaryModelName) &&
      (!needsThird || !!req.tertiaryModelName) &&
      req.customName.trim().length > 0
    if (!ready) {
      setEstimate(null)
      setEstimateError(null)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void api.tools.estimateModelMerger(req)
        .then((next) => {
          if (cancelled) return
          setEstimate(next)
          setEstimateError(null)
        })
        .catch((e: Error) => {
          if (cancelled) return
          setEstimate(null)
          setEstimateError(e.message)
        })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [
    req.primaryModelName,
    req.secondaryModelName,
    req.tertiaryModelName,
    req.interpMethod,
    req.saveAsHalf,
    req.customName,
    req.checkpointFormat
  ])

  async function inspect(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const next = await api.tools.inspectMergerSupport()
      setReport(next)
      toast(next.available ? tStatic('tools.merger.ready') : tStatic('tools.merger.notReady'), { icon: next.available ? '✓' : '!' })
    } catch (e) {
      toast.error(tStatic('tools.merger.failed', { message: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  async function runMerge(): Promise<void> {
    if (busy) return
    setBusy(true)
    setResult(null)
    setOutputInspection(null)
    setProgress(null)
    try {
      const next = await api.tools.runModelMerger(req)
      setResult(next)
      toast.success(tStatic('tools.merger.done'))
      await api.tools.rescanModelLibrary().catch(() => null)
      if (next.outputPath) {
        try {
          setOutputInspection(await api.tools.inspectModel(next.outputPath))
        } catch (e) {
          toast.error(tStatic('tools.merger.inspectOutputFailed', { message: (e as Error).message }))
        }
      }
    } catch (e) {
      const message = (e as Error).message
      if (/cancel/i.test(message)) {
        toast(tStatic('tools.merger.cancelled'), { icon: '!' })
      } else {
        toast.error(tStatic('tools.merger.runFailed', { message }))
      }
    } finally {
      setBusy(false)
    }
  }

  async function cancelMerge(): Promise<void> {
    try {
      await api.tools.cancelModelMerger()
      toast(tStatic('tools.merger.cancelRequested'), { icon: '!' })
    } catch (e) {
      toast.error(tStatic('tools.merger.cancelFailed', { message: (e as Error).message }))
    }
  }

  const modelOptions = models.map((m) => m.title)
  const needsSecondary = req.interpMethod === 'Weighted sum' || req.interpMethod === 'Add difference'
  const needsTertiary = req.interpMethod === 'Add difference'
  const mergeRunning = progress?.running === true
  const canRun =
    !!req.primaryModelName &&
    (!needsSecondary || !!req.secondaryModelName) &&
    (!needsTertiary || !!req.tertiaryModelName) &&
    req.customName.trim().length > 0 &&
    !estimateError &&
    estimate?.canRun !== false

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <GitMerge className="h-5 w-5 text-accent" />
        <h3 className="text-sm font-semibold text-ink-1">{t('tools.merger.title')}</h3>
      </div>
      <p className="text-xs text-ink-3 leading-relaxed">{t('tools.merger.body')}</p>
      <button className="btn text-xs gap-1.5" onClick={() => { void inspect() }} disabled={busy}>
        <FileSearch className={cn('h-3.5 w-3.5', busy && 'animate-pulse')} />
        {t('tools.merger.inspect')}
      </button>
      {report && (
        <div className="border-t border-line pt-3 space-y-1 text-xs">
          <HealthLine ok={report.available} label={t('tools.merger.support')} detail={report.functionName ?? report.message} />
          <div className="font-mono text-[10px] text-ink-3 break-all">{report.extrasPath}</div>
          <div className="text-[10px] text-ink-3 leading-relaxed">{report.message}</div>
        </div>
      )}
      <div className="border-t border-line pt-3 space-y-2">
        <div className="grid grid-cols-1 gap-2">
          <SelectMini
            label={t('tools.merger.primary')}
            value={req.primaryModelName}
            options={modelOptions}
            onChange={(v) => setReq((current) => ({ ...current, primaryModelName: v }))}
          />
          <SelectMini
            label={t('tools.merger.secondary')}
            value={req.secondaryModelName ?? ''}
            options={['', ...modelOptions]}
            onChange={(v) => setReq((current) => ({ ...current, secondaryModelName: v || null }))}
          />
          {req.interpMethod === 'Add difference' && (
            <SelectMini
              label={t('tools.merger.tertiary')}
              value={req.tertiaryModelName ?? ''}
              options={['', ...modelOptions]}
              onChange={(v) => setReq((current) => ({ ...current, tertiaryModelName: v || null }))}
            />
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <SelectMini
            label={t('tools.merger.method')}
            value={req.interpMethod}
            options={['No interpolation', 'Weighted sum', 'Add difference']}
            onChange={(v) => setReq((current) => ({ ...current, interpMethod: v as ModelMergerRequest['interpMethod'] }))}
          />
          <SelectMini
            label={t('tools.merger.format')}
            value={req.checkpointFormat}
            options={['safetensors', 'ckpt']}
            onChange={(v) => setReq((current) => ({ ...current, checkpointFormat: v as ModelMergerRequest['checkpointFormat'] }))}
          />
        </div>

        <label className="block">
          <div className="flex items-baseline justify-between text-[10px] text-ink-3">
            <span>{t('tools.merger.multiplier')}</span>
            <span className="font-mono text-ink-1">{req.multiplier.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={req.multiplier}
            onChange={(e) => setReq((current) => ({ ...current, multiplier: parseFloat(e.target.value) }))}
            className="w-full accent-accent"
          />
        </label>

        <input
          className="input text-xs"
          value={req.customName}
          onChange={(e) => setReq((current) => ({ ...current, customName: e.target.value }))}
          placeholder={t('tools.merger.namePlaceholder')}
        />

        <div className="grid grid-cols-2 gap-2 text-[11px] text-ink-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={req.saveAsHalf}
              onChange={(e) => setReq((current) => ({ ...current, saveAsHalf: e.target.checked }))}
              className="accent-accent"
            />
            {t('tools.merger.saveAsHalf')}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={req.saveMetadata}
              onChange={(e) => setReq((current) => ({ ...current, saveMetadata: e.target.checked }))}
              className="accent-accent"
            />
            {t('tools.merger.saveMetadata')}
          </label>
        </div>

        <div className="flex gap-2">
          <button className="btn btn-primary flex-1 justify-center text-xs gap-1.5" onClick={() => { void runMerge() }} disabled={busy || mergeRunning || !canRun}>
            <GitMerge className={cn('h-3.5 w-3.5', (busy || mergeRunning) && 'animate-pulse')} />
            {busy || mergeRunning ? t('tools.merger.running') : t('tools.merger.run')}
          </button>
          {mergeRunning && (
            <button className="btn text-xs gap-1.5 shrink-0" onClick={() => { void cancelMerge() }}>
              <Square className="h-3.5 w-3.5" />
              {t('tools.merger.cancel')}
            </button>
          )}
        </div>
        <p className="text-[10px] text-warn leading-relaxed">{t('tools.merger.warning')}</p>

        {(estimate || estimateError) && (
          <div className="rounded-md border border-line bg-bg-2/50 p-2 text-xs space-y-2">
            <div className="flex items-center gap-1.5 text-ink-2">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>{t('tools.merger.preflight')}</span>
              {estimate && (
                <span className={cn('ml-auto text-[10px] font-semibold', estimate.canRun ? 'text-ok' : 'text-warn')}>
                  {estimate.canRun ? t('tools.merger.readyToRun') : t('tools.merger.blocked')}
                </span>
              )}
            </div>
            {estimateError && <div className="text-err break-all">{t('tools.merger.estimateFailed', { message: estimateError })}</div>}
            {estimate && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <Stat label={t('tools.merger.sourceSize')} value={formatBytes(estimate.totalSourceBytes)} />
                  <Stat label={t('tools.merger.estimatedOutput')} value={formatBytes(estimate.estimatedOutputBytes)} />
                  <Stat label={t('tools.merger.requiredFree')} value={formatBytes(estimate.requiredFreeBytes)} />
                  <Stat label={t('tools.merger.diskFree')} value={estimate.freeBytes == null ? '-' : formatBytes(estimate.freeBytes)} />
                </div>
                <HealthLine
                  ok={!estimate.outputExists}
                  label={t('tools.merger.output')}
                  detail={estimate.outputExists ? t('tools.merger.outputExists') : estimate.outputPath}
                />
                <div className="space-y-0.5">
                  {estimate.sourceModels.map((model) => (
                    <div key={`${model.role}-${model.path}`} className="font-mono text-[10px] text-ink-3 truncate">
                      {model.role}: {formatBytes(model.sizeBytes)} / {model.path}
                    </div>
                  ))}
                </div>
                {estimate.warnings.length > 0 && (
                  <div className="space-y-0.5">
                    {estimate.warnings.map((warning) => (
                      <div key={warning} className="text-warn">{warning}</div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {progress && (
          <div className="rounded-md border border-line bg-bg-2/50 p-2 text-xs space-y-2">
            <div className="flex items-center gap-1.5 text-ink-2">
              <Activity className={cn('h-3.5 w-3.5', progress.running && 'animate-pulse')} />
              <span>{t('tools.merger.log')}</span>
              <span className="ml-auto font-mono text-[10px] text-ink-3">
                {progress.running ? t('tools.merger.running') : t('tools.merger.finished')}
              </span>
            </div>
            {progress.error && <div className="text-err">{progress.error}</div>}
            {progress.logTail.length > 0 ? (
              <div className="font-mono text-[10px] bg-bg-1/70 rounded p-2 space-y-0.5 max-h-40 overflow-y-auto">
                {progress.logTail.map((line, index) => (
                  <div key={`${index}-${line}`} className="break-all">{truncate(line, 500)}</div>
                ))}
              </div>
            ) : (
              <div className="text-[10px] text-ink-3">{t('tools.merger.noLog')}</div>
            )}
          </div>
        )}

        {result && (
          <div className="rounded-md border border-line bg-bg-2/50 p-2 text-xs space-y-1">
            <div className="text-ink-2">{result.message}</div>
            {result.outputPath && <div className="font-mono text-[10px] text-ink-3 break-all">{result.outputPath}</div>}
          </div>
        )}

        {outputInspection && (
          <div className="rounded-md border border-line bg-bg-2/50 p-2 text-xs space-y-2">
            <div className="text-ink-2">{t('tools.merger.outputInspection')}</div>
            <div className="font-mono text-[10px] text-ink-3 break-all">{outputInspection.filepath}</div>
            <div className="grid grid-cols-2 gap-2">
              <Stat label={t('tools.inspector.kind')} value={outputInspection.kind} />
              <Stat label={t('tools.inspector.size')} value={formatBytes(outputInspection.sizeBytes)} />
            </div>
            {outputInspection.sampleKeys.length > 0 && (
              <div className="font-mono text-[10px] bg-bg-1/70 rounded p-2 space-y-0.5 max-h-32 overflow-y-auto">
                {outputInspection.sampleKeys.map((key) => <div key={key}>{key}</div>)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function SelectMini({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}): JSX.Element {
  return (
    <label className="block">
      <span className="block text-[10px] text-ink-3 mb-1">{label}</span>
      <select className="input text-xs" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => (
          <option key={option || 'none'} value={option}>{option || '-'}</option>
        ))}
      </select>
    </label>
  )
}

function FormatConverterCard(): JSX.Element {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ModelFormatConversionResult | null>(null)
  const [outputInspection, setOutputInspection] = useState<InspectionResult | null>(null)

  async function convert(): Promise<void> {
    if (busy) return
    setBusy(true)
    setOutputInspection(null)
    try {
      const next = await api.tools.convertModelFormat()
      if (!next) return
      setResult(next)
      toast.success(tStatic('tools.converter.done'))
      try {
        setOutputInspection(await api.tools.inspectModel(next.destPath))
      } catch (e) {
        toast.error(tStatic('tools.converter.inspectOutputFailed', { message: (e as Error).message }))
      }
    } catch (e) {
      toast.error(tStatic('tools.converter.failed', { message: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Package className="h-5 w-5 text-accent" />
        <h3 className="text-sm font-semibold text-ink-1">{t('tools.converter.title')}</h3>
      </div>
      <p className="text-xs text-ink-3 leading-relaxed">{t('tools.converter.body')}</p>
      <button className="btn text-xs gap-1.5" onClick={() => { void convert() }} disabled={busy}>
        <Wrench className={cn('h-3.5 w-3.5', busy && 'animate-pulse')} />
        {busy ? t('tools.converter.running') : t('tools.converter.pick')}
      </button>
      {result && (
        <div className="border-t border-line pt-3 space-y-1 text-xs">
          <Stat label={t('tools.converter.source')} value={result.sourcePath} />
          <Stat label={t('tools.converter.dest')} value={result.destPath} />
          {result.stdout && <div className="font-mono text-[10px] text-ink-3 break-all">{result.stdout}</div>}
        </div>
      )}
      {outputInspection && (
        <div className="border-t border-line pt-3 space-y-2 text-xs">
          <div className="text-ink-2">{t('tools.converter.outputInspection')}</div>
          <div className="grid grid-cols-2 gap-2">
            <Stat label={t('tools.inspector.kind')} value={outputInspection.kind} />
            <Stat label={t('tools.inspector.size')} value={formatBytes(outputInspection.sizeBytes)} />
          </div>
          {outputInspection.sampleKeys.length > 0 && (
            <div className="font-mono text-[10px] bg-bg-2/60 rounded p-2 space-y-0.5 max-h-32 overflow-y-auto">
              {outputInspection.sampleKeys.map((key) => <div key={key}>{key}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PlaceholderCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }): JSX.Element {
  return (
    <div className="card p-4 space-y-2 opacity-70">
      <div className="flex items-center gap-2 text-ink-2">
        {icon}
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <p className="text-xs text-ink-3 leading-relaxed">{body}</p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div className="text-[10px] text-ink-3">{label}</div>
      <div className="font-mono text-ink-1">{value}</div>
    </div>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatMetricMs(metrics: StartupMetrics, value: number | null): string {
  if (value === null) return '-'
  return formatDurationMs(value - metrics.processStartedAt)
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

function formatDurationMaybe(ms: number | null): string {
  return ms === null ? '-' : formatDurationMs(ms)
}

function formatDateTime(value: number): string {
  return new Date(value).toLocaleString()
}

function formatDownloadProgress(job: DownloadJob): string {
  if (job.totalBytes > 0) {
    return `${formatBytes(job.bytesDownloaded)} / ${formatBytes(job.totalBytes)}`
  }
  return formatBytes(job.bytesDownloaded)
}

function statusColor(status: DownloadJob['status']): string {
  if (status === 'completed') return 'bg-ok'
  if (status === 'failed') return 'bg-err'
  if (status === 'canceled') return 'bg-warn'
  return 'bg-accent'
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}
