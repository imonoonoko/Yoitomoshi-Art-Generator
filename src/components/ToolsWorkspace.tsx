import { useEffect, useState } from 'react'
import { Activity, AlertTriangle, ChevronDown, ClipboardPaste, Database, Download, ExternalLink, FileSearch, FolderOpen, GitMerge, ImageIcon, Package, Play, Plus, RefreshCw, Save, Search, Send, ShieldCheck, Shuffle, Square, Star, Tag, Trash2, Wrench } from 'lucide-react'
import toast from 'react-hot-toast'
import { DEFAULT_CONTROLNET_UNIT, useStore, type ControlNetUnitState } from '@/lib/store'
import { useT, t as tStatic } from '@/lib/i18n'
import { api } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { promptAppend } from '@/lib/prompt-utils'
import { stripAdapterTokens } from '@/lib/adapter-tokens'
import { getBuiltInLoraPromptPreset } from '@/lib/builtin-lora-presets'
import {
  checkpointPromptContextFromLibraryEntry,
  defaultCheckpointPromptProfile,
  findCheckpointPromptProfile,
  inferCheckpointPromptFamily,
  joinProfileTags,
  normalizeCheckpointNegativeStrategy,
  normalizeCheckpointProfileFamily,
  normalizeCheckpointProfileMode,
  normalizeCheckpointPromptStyle,
  preferredCheckpointPromptProfileId,
  splitProfileTagText
} from '@/lib/checkpoint-prompt-profile'
import { buildWorkspaceSnapshot } from '@/lib/workspace-snapshot'
import { TAGGER_CATALOG, taggerTierLabel, type TaggerCatalogItem } from '@/lib/tagger-catalog'
import { DEFAULT_TAGGER_BLACKLIST, DEFAULT_TAGGER_MIN_SCORE, parseTaggerBlacklist } from '@shared/tagger-filter'
import type {
  DownloadJob,
  CivitaiCommunityStats,
  HistoryItem,
  HuggingFaceSearchFile,
  LibraryIntegrityReport,
  CheckpointPromptProfile,
  LoraPromptOverride,
  ModelAutoOrganizePlan,
  ModelAutoOrganizeResult,
  ModelFormatConversionResult,
  ModelLibraryEntry,
  ModelLibrarySummary,
  ModelMergerEstimate,
  ModelMergerProgress,
  ModelMergerRequest,
  ModelMergerResult,
  ModelMergerSupportReport,
  PersonalEnvironmentHealthReport,
  PersonalEnvironmentRecoveryResult,
  ReferenceBoardItem,
  ReferenceBoardKind,
  StartupMetrics,
  StartupMetricsSample,
  TaggerRunResult,
  WorkspaceFile,
  WorkspaceImageReference,
  WorkspaceImageReferences,
  WorkspaceImageSaveMode,
  WorkspaceSummary
} from '@shared/types'

const STALE_DOWNLOAD_MS = 10 * 60 * 1000

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
        <ToolSection title={t('tools.personalHealth.title')} icon={<ShieldCheck className="h-4 w-4" />} defaultOpen testId="personal-health">
          <PersonalEnvironmentHealthCard />
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
        <ToolSection title={t('tools.referenceBoard.title')} icon={<ImageIcon className="h-4 w-4" />} defaultOpen testId="reference-board">
          <ReferenceBoardCard />
        </ToolSection>
        <ToolSection title={t('tools.modelHealth.title')} icon={<AlertTriangle className="h-4 w-4" />}>
          <ModelHealthScanCard />
        </ToolSection>
        <ToolSection title={t('tools.autoOrganize.title')} icon={<Shuffle className="h-4 w-4" />} testId="auto-organize">
          <ModelAutoOrganizerCard />
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

interface WorkspacePreflightIssue {
  key: string
  messageKey: string
  params: Record<string, string | number>
}

interface WorkspacePreflightResult {
  checkedAt: number
  issues: WorkspacePreflightIssue[]
}

export function WorkspaceCard({
  compact = false,
  restoreTab = true
}: {
  compact?: boolean
  restoreTab?: boolean
} = {}): JSX.Element {
  const t = useT()
  const [name, setName] = useState('')
  const [imageSaveMode, setImageSaveMode] = useState<WorkspaceImageSaveMode>('embed')
  const [busy, setBusy] = useState(false)
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [workspacePreflights, setWorkspacePreflights] = useState<Record<string, WorkspacePreflightResult>>({})

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

  async function runPreflight(id: string): Promise<WorkspacePreflightResult | null> {
    if (busy) return null
    setBusy(true)
    try {
      const workspace = await api.storage.loadWorkspace(id)
      if (!workspace) throw new Error('Workspace not found')
      const result = await inspectWorkspaceImport(workspace, useStore.getState(), true)
      setWorkspacePreflights((current) => ({ ...current, [id]: result }))
      if (result.issues.length > 0) {
        toast(tStatic('tools.workspace.preflightIssues', { count: result.issues.length }), { icon: '!' })
      } else {
        toast.success(tStatic('tools.workspace.preflightOk'))
      }
      return result
    } catch (e) {
      toast.error(tStatic('tools.workspace.restoreFailed', { message: (e as Error).message }))
      return null
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
      const preflight = await inspectWorkspaceImport(workspace, s, true)
      setWorkspacePreflights((current) => ({ ...current, [id]: preflight }))
      const refs = snap.imageReferences
      const missingReferences: string[] = []
      const [
        inputRef,
        lastRef,
        upscaleInputRef,
        upscaleOutputRef,
        controlnetRefs,
        fabricPositiveImages,
        fabricNegativeImages,
        referenceBoardImages
      ] = await Promise.all([
        snap.inputImageDataUrl ? Promise.resolve(snap.inputImageDataUrl) : resolveImageReference(refs?.inputImage, 'inputImage', missingReferences),
        snap.lastImageDataUrl ? Promise.resolve(snap.lastImageDataUrl) : resolveImageReference(refs?.lastImage, 'lastImage', missingReferences),
        snap.upscaleInputImageDataUrl ? Promise.resolve(snap.upscaleInputImageDataUrl) : resolveImageReference(refs?.upscaleInputImage, 'upscaleInputImage', missingReferences),
        snap.upscaleOutputImageDataUrl ? Promise.resolve(snap.upscaleOutputImageDataUrl) : resolveImageReference(refs?.upscaleOutputImage, 'upscaleOutputImage', missingReferences),
        Promise.all((refs?.controlnetUnits ?? []).map((ref, index) => resolveImageReference(ref, `controlnet-${index + 1}`, missingReferences))),
        Promise.all((refs?.fabricPositive ?? []).map((ref, index) => resolveImageReference(ref, `fabric-positive-${index + 1}`, missingReferences))),
        Promise.all((refs?.fabricNegative ?? []).map((ref, index) => resolveImageReference(ref, `fabric-negative-${index + 1}`, missingReferences))),
        Promise.all((refs?.referenceBoard ?? []).map((ref, index) => resolveImageReference(ref, `reference-board-${index + 1}`, missingReferences)))
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
      const restoredReferenceBoardItems = (snap.referenceBoard?.items ?? []).map((item, index) => {
        const ref = refs?.referenceBoard?.[index]
        return {
          ...item,
          imageDataUrl: item.imageDataUrl ?? referenceBoardImages[index] ?? null,
          filename: item.filename ?? imageReferenceFilename(ref),
          sourceHistoryId: item.sourceHistoryId ?? imageHistoryId(ref),
          sourcePath: item.sourcePath ?? imageFilePath(ref)
        }
      })
      if (restoreTab) s.setCurrentTab(snap.currentTab)
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
      if (snap.video) s.patchVideo({ ...(snap.video as Partial<typeof s.video>), lastResult: null })
      s.patchControlnet(restoredControlnet as Partial<typeof s.controlnet>)
      if (snap.regionalPrompter) s.patchRegionalPrompter(snap.regionalPrompter as Partial<typeof s.regionalPrompter>)
      if (restoredFabric) s.patchFabric(restoredFabric)
      s.setReferenceBoardItems(restoredReferenceBoardItems)
      s.patchAdetailer(snap.adetailer as Partial<typeof s.adetailer>)
      s.patchDynThres(snap.dynThres as Partial<typeof s.dynThres>)
      s.patchFreeu(snap.freeu as Partial<typeof s.freeu>)
      if (preflight.issues.length > 0) {
        toast(tStatic('tools.workspace.preflightIssues', { count: preflight.issues.length }), { icon: '!' })
      } else if (missingReferences.length > 0) {
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
    <div className={cn('card space-y-3', compact ? 'p-3' : 'p-4')}>
      <div className="flex items-center gap-2">
        <Save className="h-5 w-5 text-accent" />
        <h3 className="text-sm font-semibold text-ink-1">{t('tools.workspace.title')}</h3>
        <button
          type="button"
          className="btn btn-icon btn-ghost ml-auto"
          onClick={() => { void load() }}
          disabled={busy}
          title={t('common.refresh')}
          data-testid="workspace-refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
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
      <div className={cn('grid gap-2', compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-3')}>
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
          {workspaces.slice(0, compact ? 4 : 6).map((workspace) => {
            const preflight = workspacePreflights[workspace.id]
            return (
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
                {preflight && (
                  <div
                    className={cn(
                      'mt-2 rounded border px-2 py-1 text-[10px]',
                      preflight.issues.length > 0
                        ? 'border-warn/40 bg-warn/10 text-ink-1'
                        : 'border-accent/30 bg-accent/10 text-ink-1'
                    )}
                    data-testid={`workspace-preflight-${workspace.id}`}
                    data-workspace-preflight-status={preflight.issues.length > 0 ? 'warn' : 'ok'}
                    data-workspace-preflight-issues={preflight.issues.length}
                  >
                    <div className="font-semibold">
                      {preflight.issues.length > 0
                        ? t('tools.workspace.preflightIssues', { count: preflight.issues.length })
                        : t('tools.workspace.preflightOk')}
                    </div>
                    {preflight.issues.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {preflight.issues.slice(0, 4).map((issue) => (
                          <li key={issue.key} className="truncate">
                            {t(issue.messageKey, issue.params)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
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
                    className="btn btn-ghost text-[10px] py-0.5"
                    onClick={() => { void runPreflight(workspace.id) }}
                    disabled={busy}
                    data-testid={`workspace-preflight-run-${workspace.id}`}
                  >
                    <FileSearch className="h-3 w-3" />
                    {t('tools.workspace.preflight')}
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
            )
          })}
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

async function inspectWorkspaceImport(
  workspace: WorkspaceFile,
  store: StoreSnapshot,
  resolveReferences: boolean
): Promise<WorkspacePreflightResult> {
  const snap = workspace.snapshot
  const issues: WorkspacePreflightIssue[] = []
  const modelTitle = snap.selectedModelTitle?.trim()
  if (modelTitle && !hasModel(store, modelTitle)) {
    issues.push(issue('model', modelTitle, 'tools.workspace.issueModel'))
  }

  const vae = snap.selectedVae?.trim()
  if (vae && !isBuiltinVae(vae) && !store.vaes.some((item) => item.modelName === vae)) {
    issues.push(issue('vae', vae, 'tools.workspace.issueVae'))
  }

  for (const active of snap.activeLoras ?? []) {
    const adapterName = active.tokenName || active.name
    if (adapterName && !hasAdapter(store, active.name, active.tokenName, active.sourceRoot)) {
      issues.push(issue('adapter', adapterName, 'tools.workspace.issueAdapter'))
    }
  }

  if (resolveReferences) {
    for (const ref of collectWorkspaceImageReferences(snap.imageReferences)) {
      const restored = await resolveWorkspaceImageForPreflight(ref.reference)
      if (!restored) {
        issues.push(issue(`reference-${ref.label}`, ref.label, 'tools.workspace.issueReference'))
      }
    }
  }

  return { checkedAt: Date.now(), issues }
}

function issue(kind: string, name: string, messageKey: string): WorkspacePreflightIssue {
  return {
    key: `${kind}:${name}`,
    messageKey,
    params: { name }
  }
}

function hasModel(store: StoreSnapshot, selectedModelTitle: string): boolean {
  return store.models.some((model) =>
    model.title === selectedModelTitle ||
    model.modelName === selectedModelTitle ||
    model.filename === selectedModelTitle
  )
}

function hasAdapter(
  store: StoreSnapshot,
  name: string,
  tokenName: string | undefined,
  sourceRoot: string | undefined
): boolean {
  const wantedName = normalizeLookup(name)
  const wantedToken = normalizeLookup(tokenName)
  const wantedRoot = normalizeLookup(sourceRoot)
  if (wantedName && store.loras.some((lora) => normalizeLookup(lora.name) === wantedName)) {
    return true
  }
  if (wantedRoot && wantedToken) {
    return store.loras.some((lora) =>
      normalizeLookup(lora.sourceRoot) === wantedRoot &&
      normalizeLookup(lora.tokenName ?? lora.name) === wantedToken
    )
  }
  return store.loras.some((lora) => {
    const keys = [lora.name, lora.tokenName, lora.alias].filter(Boolean).map((value) => normalizeLookup(value))
    return keys.includes(wantedToken || wantedName)
  })
}

function isBuiltinVae(value: string): boolean {
  return ['automatic', 'none'].includes(value.toLowerCase())
}

function normalizeLookup(value: string | undefined): string {
  return String(value ?? '').trim().toLowerCase()
}

function collectWorkspaceImageReferences(
  refs: WorkspaceImageReferences | undefined
): Array<{ label: string; reference: WorkspaceImageReference }> {
  if (!refs) return []
  const entries: Array<{ label: string; reference: WorkspaceImageReference }> = []
  const push = (label: string, ref: WorkspaceImageReference | null | undefined): void => {
    if (ref) entries.push({ label, reference: ref })
  }
  push('inputImage', refs.inputImage)
  push('inpaintMask', refs.inpaintMask)
  push('lastImage', refs.lastImage)
  push('upscaleInputImage', refs.upscaleInputImage)
  push('upscaleOutputImage', refs.upscaleOutputImage)
  for (const [index, ref] of (refs.controlnetUnits ?? []).entries()) {
    push(`controlnet-${index + 1}`, ref)
  }
  for (const [index, ref] of (refs.fabricPositive ?? []).entries()) {
    push(`fabric-positive-${index + 1}`, ref)
  }
  for (const [index, ref] of (refs.fabricNegative ?? []).entries()) {
    push(`fabric-negative-${index + 1}`, ref)
  }
  for (const [index, ref] of (refs.referenceBoard ?? []).entries()) {
    push(`reference-board-${index + 1}`, ref)
  }
  return entries
}

async function resolveWorkspaceImageForPreflight(ref: WorkspaceImageReference): Promise<boolean> {
  try {
    const image = await api.storage.resolveImageReference(ref)
    return Boolean(image)
  } catch {
    return false
  }
}

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

const REFERENCE_BOARD_KINDS: ReferenceBoardKind[] = ['pose', 'color', 'character', 'style', 'material', 'other']
const REFERENCE_BOARD_HISTORY_LABELS = new Set(['reference', 'asset', 'favorite', 'candidate', 'social'])

function ReferenceBoardCard(): JSX.Element {
  const t = useT()
  const items = useStore((s) => s.referenceBoardItems)
  const upsertItem = useStore((s) => s.upsertReferenceBoardItem)
  const updateItem = useStore((s) => s.updateReferenceBoardItem)
  const deleteItem = useStore((s) => s.deleteReferenceBoardItem)
  const setHistory = useStore((s) => s.setHistory)
  const hasPreview = useStore((s) => Boolean(s.lastImage))
  const hasInput = useStore((s) => Boolean(s.inputImage))
  const controlnet = useStore((s) => s.controlnet)
  const [kind, setKind] = useState<ReferenceBoardKind>('pose')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  function upsertReference(input: Omit<ReferenceBoardItem, 'id' | 'kind' | 'note' | 'createdAt'>): void {
    const latestItems = useStore.getState().referenceBoardItems
    const existing = latestItems.find((item) =>
      (input.sourceHistoryId && item.sourceHistoryId === input.sourceHistoryId) ||
      (input.sourcePath && item.sourcePath === input.sourcePath)
    )
    upsertItem({
      id: existing?.id ?? makeReferenceBoardId(),
      kind,
      imageDataUrl: input.imageDataUrl,
      filename: input.filename,
      sourceType: input.sourceType,
      sourceLabel: input.sourceLabel,
      sourceHistoryId: input.sourceHistoryId,
      sourcePath: input.sourcePath,
      note: note.trim() || existing?.note || '',
      createdAt: existing?.createdAt ?? Date.now()
    })
  }

  function addPreview(): void {
    const state = useStore.getState()
    if (!state.lastImage) {
      toast(tStatic('tools.referenceBoard.noImage'), { icon: '!' })
      return
    }
    upsertReference({
      imageDataUrl: state.lastImage,
      filename: 'last-generation.png',
      sourceType: 'last',
      sourceLabel: tStatic('tools.referenceBoard.source.last'),
      sourceHistoryId: state.lastImageHistoryId,
      sourcePath: null
    })
    toast.success(tStatic('tools.referenceBoard.added'))
  }

  function addInput(): void {
    const state = useStore.getState()
    if (!state.inputImage) {
      toast(tStatic('tools.referenceBoard.noImage'), { icon: '!' })
      return
    }
    upsertReference({
      imageDataUrl: state.inputImage,
      filename: state.inputImageFilename ?? 'input-image.png',
      sourceType: 'input',
      sourceLabel: tStatic('tools.referenceBoard.source.input'),
      sourceHistoryId: state.inputImageHistoryId,
      sourcePath: state.inputImagePath
    })
    toast.success(tStatic('tools.referenceBoard.added'))
  }

  async function importLabeledHistory(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const history = await api.storage.listHistory()
      setHistory(history)
      const labeled = history
        .filter((item) => item.label && REFERENCE_BOARD_HISTORY_LABELS.has(item.label))
        .slice(0, 24)
      let imported = 0
      for (const item of labeled) {
        const image = await api.storage.readHistoryImage(item.id).catch(() => null)
        if (!image && !item.thumbDataUrl) continue
        upsertReference({
          imageDataUrl: image ?? item.thumbDataUrl,
          filename: referenceHistoryFilename(item),
          sourceType: 'history',
          sourceLabel: historySourceLabel(item),
          sourceHistoryId: item.id,
          sourcePath: null
        })
        const existing = useStore.getState().referenceBoardItems.find((candidate) => candidate.sourceHistoryId === item.id)
        if (existing && !existing.note) {
          updateItem(existing.id, { note: referenceNoteFromHistory(item) })
        }
        imported += 1
      }
      if (imported === 0) {
        toast(tStatic('tools.referenceBoard.importEmpty'), { icon: '!' })
      } else {
        toast.success(tStatic('tools.referenceBoard.imported', { count: imported }))
      }
    } catch (e) {
      toast.error(tStatic('tools.referenceBoard.importFailed', { message: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  function sendToImg2Img(item: ReferenceBoardItem): void {
    if (!item.imageDataUrl) {
      toast(tStatic('tools.referenceBoard.noImage'), { icon: '!' })
      return
    }
    const state = useStore.getState()
    state.setInputImage(item.imageDataUrl, item.filename ?? 'reference-board.png', item.sourcePath ?? null, item.sourceHistoryId ?? null)
    state.setCurrentTab('img2img')
    toast.success(tStatic('tools.referenceBoard.sentImg2Img'))
  }

  function sendToInpaint(item: ReferenceBoardItem): void {
    if (!item.imageDataUrl) {
      toast(tStatic('tools.referenceBoard.noImage'), { icon: '!' })
      return
    }
    const state = useStore.getState()
    state.setInputImage(item.imageDataUrl, item.filename ?? 'reference-board.png', item.sourcePath ?? null, item.sourceHistoryId ?? null)
    state.setInpaintMaskImage(null)
    state.setCurrentTab('img2img')
    toast.success(tStatic('tools.referenceBoard.sentInpaint'))
  }

  function sendToControlNet(item: ReferenceBoardItem): void {
    if (!item.imageDataUrl) {
      toast(tStatic('tools.referenceBoard.noImage'), { icon: '!' })
      return
    }
    const state = useStore.getState()
    const unit = buildReferenceBoardControlNetUnit(item, state.controlnetModuleList, state.controlnetModelList)
    const currentUnits = state.controlnet.units.length > 0 ? state.controlnet.units : [DEFAULT_CONTROLNET_UNIT]
    state.patchControlnet({
      enabled: true,
      units: currentUnits.map((current, index) => index === 0 ? unit : current)
    })
    toast.success(tStatic('tools.referenceBoard.sentControlNet'))
  }

  return (
    <div
      className="card p-4 space-y-3"
      data-testid="reference-board"
      data-reference-board-count={items.length}
      data-controlnet-enabled={controlnet.enabled ? 'true' : 'false'}
      data-controlnet-unit-module={controlnet.units[0]?.module ?? 'None'}
      data-controlnet-unit-has-image={controlnet.units[0]?.image ? 'true' : 'false'}
    >
      <div className="flex items-start gap-2">
        <ImageIcon className="h-5 w-5 text-accent shrink-0" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink-1">{t('tools.referenceBoard.title')}</h3>
          <p className="text-xs text-ink-3 leading-relaxed">{t('tools.referenceBoard.body')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[150px_1fr] gap-2">
        <select
          className="input text-xs"
          value={kind}
          onChange={(event) => setKind(event.target.value as ReferenceBoardKind)}
          data-testid="reference-board-kind"
        >
          {REFERENCE_BOARD_KINDS.map((value) => (
            <option key={value} value={value}>{t(`tools.referenceBoard.kind.${value}`)}</option>
          ))}
        </select>
        <input
          className="input text-xs"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={t('tools.referenceBoard.notePlaceholder')}
          data-testid="reference-board-new-note"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="btn text-xs gap-1.5" onClick={addPreview} disabled={!hasPreview} data-testid="reference-board-add-preview">
          <Plus className="h-3.5 w-3.5" />
          {t('tools.referenceBoard.addPreview')}
        </button>
        <button className="btn text-xs gap-1.5" onClick={addInput} disabled={!hasInput} data-testid="reference-board-add-input">
          <Plus className="h-3.5 w-3.5" />
          {t('tools.referenceBoard.addInput')}
        </button>
        <button className="btn text-xs gap-1.5" onClick={() => { void importLabeledHistory() }} disabled={busy} data-testid="reference-board-import-labeled">
          <ClipboardPaste className="h-3.5 w-3.5" />
          {busy ? t('common.loading') : t('tools.referenceBoard.importLabeled')}
        </button>
      </div>

      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-line bg-bg-2/50 p-3 text-xs text-ink-3">
          {t('tools.referenceBoard.empty')}
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {items.map((item, index) => (
            <div
              key={item.id}
              className="rounded-md border border-line bg-bg-2/60 p-2 space-y-2"
              data-testid={`reference-board-item-${index}`}
              data-reference-id={item.id}
              data-reference-kind={item.kind}
              data-has-image={item.imageDataUrl ? 'true' : 'false'}
            >
              <div className="flex gap-2">
                <div className="h-20 w-16 shrink-0 overflow-hidden rounded border border-line bg-bg-0">
                  {item.imageDataUrl ? (
                    <img className="h-full w-full object-cover" src={item.imageDataUrl} alt="" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[10px] text-ink-3">
                      {t('tools.referenceBoard.imageMissing')}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <select
                    className="input text-[11px] py-1"
                    value={item.kind}
                    onChange={(event) => updateItem(item.id, { kind: event.target.value as ReferenceBoardKind })}
                    data-testid={`reference-board-item-kind-${index}`}
                  >
                    {REFERENCE_BOARD_KINDS.map((value) => (
                      <option key={value} value={value}>{t(`tools.referenceBoard.kind.${value}`)}</option>
                    ))}
                  </select>
                  <div className="truncate text-[10px] text-ink-3">
                    {item.sourceLabel ?? t('tools.referenceBoard.source.manual')}
                  </div>
                  <textarea
                    className="input min-h-[44px] resize-none text-[11px] leading-snug"
                    value={item.note}
                    onChange={(event) => updateItem(item.id, { note: event.target.value })}
                    placeholder={t('tools.referenceBoard.itemNotePlaceholder')}
                    data-testid={`reference-board-note-${index}`}
                  />
                </div>
              </div>
              <div className="grid grid-cols-4 gap-1">
                <button className="btn btn-ghost text-[10px] px-1 py-1" onClick={() => sendToImg2Img(item)} disabled={!item.imageDataUrl} data-testid={`reference-board-send-img2img-${index}`}>
                  img2img
                </button>
                <button className="btn btn-ghost text-[10px] px-1 py-1" onClick={() => sendToInpaint(item)} disabled={!item.imageDataUrl} data-testid={`reference-board-send-inpaint-${index}`}>
                  Inpaint
                </button>
                <button className="btn btn-ghost text-[10px] px-1 py-1" onClick={() => sendToControlNet(item)} disabled={!item.imageDataUrl} data-testid={`reference-board-send-controlnet-${index}`}>
                  <Send className="h-3 w-3" />
                  CN
                </button>
                <button className="btn btn-ghost text-[10px] px-1 py-1" onClick={() => deleteItem(item.id)} data-testid={`reference-board-delete-${index}`}>
                  <Trash2 className="h-3 w-3" />
                  {t('common.delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function makeReferenceBoardId(): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `ref-${Date.now().toString(36)}-${random}`
}

function referenceHistoryFilename(item: HistoryItem): string {
  return `history-${new Date(item.createdAt).toISOString().slice(0, 10)}.png`
}

function historySourceLabel(item: HistoryItem): string {
  if (item.label) return tStatic(`history.label.${item.label}`)
  return tStatic('tools.referenceBoard.source.history')
}

function referenceNoteFromHistory(item: HistoryItem): string {
  const review = item.proRecipeReview
  const lines = [
    ...(review?.strengths ?? []),
    ...(review?.issues ?? []).map((line) => `${tStatic('tools.referenceBoard.issuePrefix')}${line}`),
    ...(review?.nextActions ?? []).map((line) => `${tStatic('tools.referenceBoard.nextPrefix')}${line}`)
  ].filter(Boolean)
  return lines[0] ?? item.prompt.slice(0, 120)
}

function buildReferenceBoardControlNetUnit(
  item: ReferenceBoardItem,
  modules: string[],
  models: string[]
): ControlNetUnitState {
  const preset = controlNetPresetForReference(item.kind, modules, models)
  return {
    ...DEFAULT_CONTROLNET_UNIT,
    enabled: true,
    image: item.imageDataUrl,
    imagePath: item.sourcePath ?? null,
    pixelPerfect: true,
    guidanceStart: 0,
    guidanceEnd: 1,
    processorRes: -1,
    thresholdA: -1,
    thresholdB: -1,
    resizeMode: preset.resizeMode,
    controlMode: preset.controlMode,
    module: preset.module,
    model: preset.model,
    weight: preset.weight
  }
}

function controlNetPresetForReference(
  kind: ReferenceBoardKind,
  modules: string[],
  models: string[]
): {
  module: string
  model: string
  weight: number
  controlMode: ControlNetUnitState['controlMode']
  resizeMode: ControlNetUnitState['resizeMode']
} {
  if (kind === 'pose') {
    return {
      module: pickControlNetModule(modules, ['openpose_full', 'openpose', 'dw_openpose_full', 'dw_openpose'], 'openpose_full'),
      model: pickControlNetModel(models, [['openpose'], ['pose']], 'None'),
      weight: 1,
      controlMode: 2,
      resizeMode: 1
    }
  }
  if (kind === 'material') {
    return {
      module: pickControlNetModule(modules, ['lineart_anime', 'lineart_realistic', 'lineart_standard', 'canny'], 'lineart_anime'),
      model: pickControlNetModel(models, [['mistoline'], ['lineart'], ['canny']], 'None'),
      weight: 0.8,
      controlMode: 2,
      resizeMode: 1
    }
  }
  return {
    module: pickControlNetModule(modules, ['reference_only', 'reference_adain+attn', 'reference_adain', 'None'], 'reference_only'),
    model: 'None',
    weight: kind === 'color' ? 0.55 : 0.65,
    controlMode: 1,
    resizeMode: 0
  }
}

function pickControlNetModule(modules: string[], candidates: string[], fallback: string): string {
  if (modules.length === 0) return fallback
  for (const candidate of candidates) {
    const exact = modules.find((moduleName) => moduleName === candidate)
    if (exact) return exact
    const fuzzy = modules.find((moduleName) => normalizeControlNetLookup(moduleName).includes(normalizeControlNetLookup(candidate)))
    if (fuzzy) return fuzzy
  }
  return fallback
}

function pickControlNetModel(models: string[], groups: string[][], fallback: string): string {
  for (const group of groups) {
    const found = models.find((model) => {
      const normalized = normalizeControlNetLookup(model)
      return group.every((keyword) => normalized.includes(normalizeControlNetLookup(keyword)))
    })
    if (found) return found
  }
  return fallback
}

function normalizeControlNetLookup(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ')
}

function PersonalEnvironmentHealthCard(): JSX.Element {
  const t = useT()
  const [report, setReport] = useState<PersonalEnvironmentHealthReport | null>(null)
  const [recoveryResult, setRecoveryResult] = useState<PersonalEnvironmentRecoveryResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [recovering, setRecovering] = useState(false)

  async function load(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      setReport(await api.tools.inspectPersonalHealth())
    } catch (e) {
      toast.error(tStatic('tools.personalHealth.loadFailed', { message: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  async function recover(): Promise<void> {
    if (recovering) return
    setRecovering(true)
    try {
      const result = await api.tools.runPersonalHealthRecovery()
      setRecoveryResult(result)
      setReport(result.report)
      const applied = result.actions.filter((action) => action.status === 'applied').length
      const skipped = result.actions.filter((action) => action.status === 'skipped').length
      const failed = result.actions.filter((action) => action.status === 'failed').length
      toast.success(tStatic('tools.personalHealth.recoveryDone', {
        applied,
        skipped,
        failed
      }))
    } catch (e) {
      toast.error(tStatic('tools.library.recoveryFailed', { message: (e as Error).message }))
    } finally {
      setRecovering(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const issueCount = report?.issues.filter((issue) => issue.severity !== 'info').length ?? 0

  return (
    <div className="card p-4 space-y-3" data-testid="personal-health-card">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-accent" />
        <h3 className="text-sm font-semibold text-ink-1">{t('tools.personalHealth.title')}</h3>
        <button className="btn btn-ghost text-xs ml-auto" onClick={() => { void load() }} disabled={busy}>
          <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />
          {t('common.refresh')}
        </button>
      </div>
      <p className="text-xs text-ink-3 leading-relaxed">{t('tools.personalHealth.body')}</p>

      {report ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <HealthStat
              label={t('tools.personalHealth.settings')}
              value={report.settings.parseOk && report.settings.launchPyExists ? 'OK' : t('tools.personalHealth.needsReview')}
              ok={report.settings.parseOk && report.settings.launchPyExists}
            />
            <HealthStat
              label={t('tools.personalHealth.processes')}
              value={`${report.processes.relatedForgeProcesses.length}/${report.processes.relatedElectronProcesses.length}`}
              ok={report.processes.relatedForgeProcesses.length <= (report.processes.forgeManagedByThisApp ? 1 : 0) && report.processes.relatedElectronProcesses.length <= 1}
            />
            <HealthStat
              label={t('tools.personalHealth.downloads')}
              value={`${report.downloads.running}/${report.downloads.failed}/${report.downloads.orphanPartials}`}
              ok={report.downloads.staleRunning === 0 && report.downloads.failed === 0 && report.downloads.orphanPartials === 0}
            />
            <HealthStat
              label={t('tools.personalHealth.startup')}
              value={formatDurationMaybe(report.startup.forgeReadyAvgMs)}
              ok={!report.startup.slowForgeReady}
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <Stat label={t('tools.personalHealth.modelEntries')} value={String(report.library.entries)} />
            <Stat label={t('tools.personalHealth.libraryIssues')} value={String(report.library.issues)} />
            <Stat label={t('tools.personalHealth.shaMissing')} value={String(report.library.shaMissing)} />
            <Stat label={t('tools.personalHealth.partialIssues')} value={String(report.library.partialDownloads)} />
          </div>

          <div className="rounded-md border border-line bg-bg-2/60 p-2 text-[11px] text-ink-3">
            <div className="font-mono truncate">{report.settings.forgePath}</div>
            <div>
              {t('tools.personalHealth.settingsMeta', {
                port: report.settings.forgePort,
                auto: report.settings.autoStartForge ? 'ON' : 'OFF',
                args: report.settings.forgeExtraArgs || '-'
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className="btn text-xs gap-1.5"
              onClick={() => { void recover() }}
              disabled={recovering}
              data-testid="personal-health-recover"
            >
              <Wrench className="h-3.5 w-3.5" />
              {recovering ? t('tools.personalHealth.recovering') : t('tools.personalHealth.recover')}
            </button>
          </div>

          {recoveryResult && (
            <div className="space-y-1.5" data-testid="personal-health-recovery-result">
              <div className="text-xs font-semibold text-ink-2">{t('tools.personalHealth.recoveryActions')}</div>
              {recoveryResult.actions.slice(0, 8).map((action) => (
                <div key={action.id} className="rounded-md border border-line bg-bg-2/50 p-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold', healthRecoveryStatusClass(action.status))}>
                      {t(`tools.personalHealth.status.${action.status}`)}
                    </span>
                    <span className="font-semibold text-ink-1">{action.title}</span>
                    <span className="ml-auto text-[10px] uppercase text-ink-3">{action.area}</span>
                  </div>
                  <div className="mt-1 text-ink-3">{action.detail}</div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1.5" data-testid="personal-health-issues" data-issue-count={issueCount}>
            <div className="text-xs font-semibold text-ink-2">{t('tools.personalHealth.issues')}</div>
            {report.issues.length === 0 ? (
              <div className="rounded-md border border-line bg-bg-2/50 p-2 text-xs text-ok">
                {t('tools.personalHealth.clean')}
              </div>
            ) : (
              report.issues.slice(0, 8).map((issue) => (
                <div key={issue.id} className="rounded-md border border-line bg-bg-2/50 p-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className={cn('h-2 w-2 rounded-full', healthSeverityClass(issue.severity))} />
                    <span className="font-semibold text-ink-1">{issue.title}</span>
                    <span className="ml-auto text-[10px] uppercase text-ink-3">{issue.area}</span>
                  </div>
                  <div className="mt-1 text-ink-3">{issue.detail}</div>
                  {issue.action && <div className="mt-1 text-ink-2">{issue.action}</div>}
                </div>
              ))
            )}
          </div>

          <div className="space-y-1.5" data-testid="personal-health-startup-signals">
            <div className="text-xs font-semibold text-ink-2">{t('tools.personalHealth.startupSignals')}</div>
            {report.startup.signals.map((signal) => (
              <div key={signal.id} className="rounded-md border border-line bg-bg-2/50 p-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className={cn('h-2 w-2 rounded-full', healthSeverityClass(signal.severity))} />
                  <span className="font-semibold text-ink-1">{signal.label}</span>
                  <span className="ml-auto text-[10px] text-ink-3">{signal.confidence}</span>
                </div>
                <div className="mt-1 space-y-0.5">
                  {signal.evidence.slice(0, 2).map((line, index) => (
                    <div key={index} className="truncate font-mono text-[10px] text-ink-3">{line}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="text-xs text-ink-3">{t('common.loading')}</div>
      )}
    </div>
  )
}

function healthSeverityClass(severity: PersonalEnvironmentHealthReport['issues'][number]['severity']): string {
  if (severity === 'error') return 'bg-err'
  if (severity === 'warn') return 'bg-warn'
  return 'bg-accent'
}

function healthRecoveryStatusClass(status: PersonalEnvironmentRecoveryResult['actions'][number]['status']): string {
  if (status === 'applied') return 'border border-ok/40 bg-ok/10 text-ok'
  if (status === 'failed') return 'border border-err/40 bg-err/10 text-err'
  return 'border border-warn/40 bg-warn/10 text-warn'
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
              data-prompt-dictionary-autocomplete="tag-blacklist"
              data-testid="tagger-blacklist-input"
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

export function ModelLibraryCard(): JSX.Element {
  const t = useT()
  const promptOverrides = useStore((s) => s.loraPromptOverrides)
  const upsertPromptOverride = useStore((s) => s.upsertLoraPromptOverride)
  const deletePromptOverride = useStore((s) => s.deleteLoraPromptOverride)
  const checkpointPromptProfiles = useStore((s) => s.checkpointPromptProfiles)
  const upsertCheckpointPromptProfile = useStore((s) => s.upsertCheckpointPromptProfile)
  const deleteCheckpointPromptProfile = useStore((s) => s.deleteCheckpointPromptProfile)
  const selectedModelTitle = useStore((s) => s.selectedModelTitle)
  const recommendation = useStore((s) => s.recommendation)
  const setPrompt = useStore((s) => s.setPrompt)
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<ModelLibrarySummary | null>(null)
  const [jobs, setJobs] = useState<DownloadJob[]>([])
  const [integrity, setIntegrity] = useState<LibraryIntegrityReport | null>(null)
  const [hashingId, setHashingId] = useState<string | null>(null)
  const [deletingPartialPath, setDeletingPartialPath] = useState<string | null>(null)
  const [libraryQuery, setLibraryQuery] = useState('')
  const [libraryType, setLibraryType] = useState('all')
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [metadataBusyId, setMetadataBusyId] = useState<string | null>(null)
  const [metadataBatchBusy, setMetadataBatchBusy] = useState(false)
  const [recipeBusyId, setRecipeBusyId] = useState<string | null>(null)
  const [recipeStatsByEntry, setRecipeStatsByEntry] = useState<Record<string, CivitaiCommunityStats | null>>({})
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({})
  const [overrideDrafts, setOverrideDrafts] = useState<Record<string, ModelLibraryPromptOverrideDraft>>({})
  const [overrideBusyId, setOverrideBusyId] = useState<string | null>(null)
  const [checkpointProfileDrafts, setCheckpointProfileDrafts] = useState<Record<string, ModelLibraryCheckpointProfileDraft>>({})
  const [checkpointProfileBusyId, setCheckpointProfileBusyId] = useState<string | null>(null)

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

  async function toggleFavorite(entry: ModelLibraryEntry): Promise<void> {
    try {
      await api.tools.updateModelLibraryEntry(entry.id, { favorite: !entry.favorite })
      await load()
      toast.success(tStatic('tools.library.favoriteSaved'))
    } catch (e) {
      toast.error(tStatic('tools.library.favoriteFailed', { message: (e as Error).message }))
    }
  }

  async function saveNotes(entry: ModelLibraryEntry): Promise<void> {
    const notes = noteDrafts[entry.id] ?? entry.notes ?? ''
    if (notes === (entry.notes ?? '')) return
    try {
      await api.tools.updateModelLibraryEntry(entry.id, { notes })
      await load()
      toast.success(tStatic('tools.library.notesSaved'))
    } catch (e) {
      toast.error(tStatic('tools.library.notesFailed', { message: (e as Error).message }))
    }
  }

  function updateOverrideDraft(entry: ModelLibraryEntry, patch: Partial<ModelLibraryPromptOverrideDraft>): void {
    const builtIn = getBuiltInLoraPromptPreset(modelLibraryLoraTarget(entry), null, { selectedModelTitle, recommendation })?.override
    const current = overrideDrafts[entry.id] ?? modelLibraryPromptOverrideDraft(
      findModelLibraryPromptOverride(promptOverrides, entry) ?? builtIn
    )
    setOverrideDrafts((drafts) => ({
      ...drafts,
      [entry.id]: { ...current, ...patch }
    }))
  }

  function copyNotesToPromptOverride(entry: ModelLibraryEntry): void {
    const notes = noteDrafts[entry.id] ?? entry.notes ?? ''
    updateOverrideDraft(entry, {
      positivePrompt: stripAdapterTokens(notes).prompt
    })
  }

  function copyBuiltInToPromptOverride(entry: ModelLibraryEntry): void {
    const builtIn = getBuiltInLoraPromptPreset(modelLibraryLoraTarget(entry), null, { selectedModelTitle, recommendation })?.override
    if (!builtIn) return
    setOverrideDrafts((drafts) => ({
      ...drafts,
      [entry.id]: modelLibraryPromptOverrideDraft(builtIn)
    }))
  }

  async function savePromptOverride(entry: ModelLibraryEntry): Promise<void> {
    if (overrideBusyId) return
    setOverrideBusyId(entry.id)
    try {
      const existing = findModelLibraryPromptOverride(useStore.getState().loraPromptOverrides, entry)
      const builtIn = getBuiltInLoraPromptPreset(modelLibraryLoraTarget(entry), null, { selectedModelTitle, recommendation })?.override
      const draft = overrideDrafts[entry.id] ?? modelLibraryPromptOverrideDraft(existing ?? builtIn)
      const parsedWeight = draft.weight.trim() ? Number(draft.weight) : null
      const weight = parsedWeight != null && Number.isFinite(parsedWeight)
        ? Math.max(-1, Math.min(2, Math.round(parsedWeight * 100) / 100))
        : null
      const steps = parseOptionalDraftNumber(draft.steps, 1, 150, true)
      const cfgScale = parseOptionalDraftNumber(draft.cfgScale, 1, 30, false)
      const clipSkip = parseOptionalDraftNumber(draft.clipSkip, 1, 12, true)
      const positivePrompt = stripAdapterTokens(draft.positivePrompt).prompt
      const negativePrompt = stripAdapterTokens(draft.negativePrompt).prompt
      const item: LoraPromptOverride = {
        id: existing?.id ?? preferredModelLibraryPromptOverrideId(entry),
        loraName: modelLibraryAdapterName(entry),
        loraAlias: entry.sourceMeta?.name ?? modelLibraryAdapterName(entry),
        loraPath: entry.path,
        loraSha256: modelLibraryEntrySha(entry),
        positivePrompt,
        negativePrompt,
        weight,
        sampler: draft.sampler.trim() || undefined,
        steps,
        cfgScale,
        clipSkip,
        autoApply: draft.autoApply,
        updatedAt: Date.now()
      }
      const saved = await api.storage.saveLoraPromptOverride(item)
      upsertPromptOverride(saved)
      setOverrideDrafts((drafts) => ({
        ...drafts,
        [entry.id]: modelLibraryPromptOverrideDraft(saved)
      }))
      toast.success(tStatic('loraCard.promptOverrideSaved'))
    } catch (e) {
      toast.error(tStatic('toast.saveFailed', { message: (e as Error).message }))
    } finally {
      setOverrideBusyId(null)
    }
  }

  async function removePromptOverride(entry: ModelLibraryEntry): Promise<void> {
    if (overrideBusyId) return
    const existing = findModelLibraryPromptOverride(useStore.getState().loraPromptOverrides, entry)
    if (!existing) return
    setOverrideBusyId(entry.id)
    try {
      await api.storage.deleteLoraPromptOverride(existing.id)
      deletePromptOverride(existing.id)
      const builtIn = getBuiltInLoraPromptPreset(modelLibraryLoraTarget(entry), null, { selectedModelTitle, recommendation })?.override
      setOverrideDrafts((drafts) => ({
        ...drafts,
        [entry.id]: modelLibraryPromptOverrideDraft(builtIn)
      }))
      toast.success(tStatic('loraCard.promptOverrideDeleted'))
    } catch (e) {
      toast.error(tStatic('toast.deleteFailed', { message: (e as Error).message }))
    } finally {
      setOverrideBusyId(null)
    }
  }

  function updateCheckpointProfileDraft(entry: ModelLibraryEntry, patch: Partial<ModelLibraryCheckpointProfileDraft>): void {
    const current = checkpointProfileDrafts[entry.id] ?? modelLibraryCheckpointProfileDraft(
      findCheckpointPromptProfile(checkpointPromptProfiles, checkpointPromptContextFromLibraryEntry(entry)),
      entry
    )
    setCheckpointProfileDrafts((drafts) => ({
      ...drafts,
      [entry.id]: { ...current, ...patch }
    }))
  }

  function resetCheckpointProfileDraft(entry: ModelLibraryEntry): void {
    const profile = defaultCheckpointPromptProfile(checkpointPromptContextFromLibraryEntry(entry))
    setCheckpointProfileDrafts((drafts) => ({
      ...drafts,
      [entry.id]: modelLibraryCheckpointProfileDraft(profile, entry)
    }))
  }

  async function saveCheckpointProfile(entry: ModelLibraryEntry): Promise<void> {
    if (checkpointProfileBusyId) return
    setCheckpointProfileBusyId(entry.id)
    try {
      const context = checkpointPromptContextFromLibraryEntry(entry)
      const existing = findCheckpointPromptProfile(useStore.getState().checkpointPromptProfiles, context)
      const draft = checkpointProfileDrafts[entry.id] ?? modelLibraryCheckpointProfileDraft(existing, entry)
      const item: CheckpointPromptProfile = {
        id: existing?.id ?? preferredCheckpointPromptProfileId(context),
        checkpointTitle: entry.name,
        checkpointName: context.name ?? entry.name,
        checkpointPath: entry.path,
        checkpointSha256: context.sha256 ?? null,
        baseModel: draft.baseModel.trim() || context.baseModel || null,
        family: normalizeCheckpointProfileFamily(draft.family),
        promptStyle: normalizeCheckpointPromptStyle(draft.promptStyle),
        negativeStrategy: normalizeCheckpointNegativeStrategy(draft.negativeStrategy),
        positivePrefix: splitProfileTagText(draft.positivePrefix),
        positiveAppend: splitProfileTagText(draft.positiveAppend),
        negativeAppend: splitProfileTagText(draft.negativeAppend),
        sampler: draft.sampler.trim() || undefined,
        steps: parseOptionalDraftNumber(draft.steps, 1, 150, true),
        cfgScale: parseOptionalDraftNumber(draft.cfgScale, 1, 30, false),
        width: parseOptionalDraftNumber(draft.width, 64, 4096, true),
        height: parseOptionalDraftNumber(draft.height, 64, 4096, true),
        clipSkip: parseOptionalDraftNumber(draft.clipSkip, 1, 12, true),
        recommendedAspectRatios: parseAspectRatioDraft(draft.recommendedAspectRatios),
        recommendedLoraCount: parseLoraCountDraft(draft.recommendedLoraMin, draft.recommendedLoraMax),
        relatedModels: {
          loras: parseRelatedModelDraft(draft.relatedLoras, 'lora'),
          vaes: parseRelatedModelDraft(draft.relatedVaes, 'vae'),
          controlNets: parseRelatedModelDraft(draft.relatedControlNets, 'controlnet')
        },
        compatibilityNotes: splitProfileNoteText(draft.compatibilityNotes),
        recipeNotes: splitProfileNoteText(draft.recipeNotes),
        mode: normalizeCheckpointProfileMode(draft.mode),
        updatedAt: Date.now()
      }
      const saved = await api.storage.saveCheckpointPromptProfile(item)
      upsertCheckpointPromptProfile(saved)
      setCheckpointProfileDrafts((drafts) => ({
        ...drafts,
        [entry.id]: modelLibraryCheckpointProfileDraft(saved, entry)
      }))
      toast.success(tStatic('tools.library.checkpointProfileSaved'))
    } catch (e) {
      toast.error(tStatic('toast.saveFailed', { message: (e as Error).message }))
    } finally {
      setCheckpointProfileBusyId(null)
    }
  }

  async function removeCheckpointProfile(entry: ModelLibraryEntry): Promise<void> {
    if (checkpointProfileBusyId) return
    const existing = findCheckpointPromptProfile(
      useStore.getState().checkpointPromptProfiles,
      checkpointPromptContextFromLibraryEntry(entry)
    )
    if (!existing) return
    setCheckpointProfileBusyId(entry.id)
    try {
      await api.storage.deleteCheckpointPromptProfile(existing.id)
      deleteCheckpointPromptProfile(existing.id)
      setCheckpointProfileDrafts((drafts) => ({
        ...drafts,
        [entry.id]: modelLibraryCheckpointProfileDraft(undefined, entry)
      }))
      toast.success(tStatic('tools.library.checkpointProfileDeleted'))
    } catch (e) {
      toast.error(tStatic('toast.deleteFailed', { message: (e as Error).message }))
    } finally {
      setCheckpointProfileBusyId(null)
    }
  }

  async function refreshCivitai(entry: ModelLibraryEntry): Promise<void> {
    if (metadataBusyId) return
    setMetadataBusyId(entry.id)
    try {
      const next = await api.tools.refreshModelLibraryCivitai(entry.id)
      setNoteDrafts((current) => ({ ...current, [next.id]: next.notes ?? '' }))
      await load()
      toast.success(tStatic('tools.library.civitaiDone'))
    } catch (e) {
      toast.error(tStatic('tools.library.civitaiFailed', { message: (e as Error).message }))
    } finally {
      setMetadataBusyId(null)
    }
  }

  async function refreshCivitaiBatch(targets: ModelLibraryEntry[]): Promise<void> {
    if (metadataBatchBusy || targets.length === 0) return
    setMetadataBatchBusy(true)
    try {
      const result = await api.tools.refreshModelLibraryCivitaiBatch({
        entryIds: targets.map((entry) => entry.id),
        onlyMissing: true,
        limit: 120
      })
      setSummary({
        ...(summary ?? {
          root: '',
          scannedAt: Date.now(),
          totals: { files: result.entries.length, totalBytes: result.entries.reduce((sum, entry) => sum + entry.sizeBytes, 0) },
          byType: {},
          entries: []
        }),
        scannedAt: Date.now(),
        entries: result.entries
      })
      await load()
      toast.success(tStatic('tools.library.civitaiBatchDone', {
        updated: result.updated,
        skipped: result.skipped,
        failed: result.failed + result.notFound
      }))
    } catch (e) {
      toast.error(tStatic('tools.library.civitaiBatchFailed', { message: (e as Error).message }))
    } finally {
      setMetadataBatchBusy(false)
    }
  }

  async function loadRecipeStats(entry: ModelLibraryEntry): Promise<void> {
    const modelVersionId = entry.sourceMeta?.modelVersionId
    if (!modelVersionId || !Number.isFinite(modelVersionId)) {
      toast.error(tStatic('tools.library.recipeNoVersion'))
      return
    }
    setRecipeBusyId(entry.id)
    try {
      const stats = await api.civitai.mineCommunity(modelVersionId)
      setRecipeStatsByEntry((current) => ({ ...current, [entry.id]: stats }))
      if (stats) {
        toast.success(tStatic('tools.library.recipeLoaded', { count: stats.sampleCount }))
      } else {
        toast(tStatic('tools.library.recipeNoStats'), { icon: 'i' })
      }
    } catch (e) {
      toast.error(tStatic('tools.library.recipeFailed', { message: (e as Error).message }))
    } finally {
      setRecipeBusyId(null)
    }
  }

  function applyRecipePromptHint(text: string): void {
    const prompt = useStore.getState().prompt
    setPrompt(promptAppend(prompt, text))
    toast.success(tStatic('tools.library.recipeHintApplied'))
  }

  async function openEntryLocation(entry: ModelLibraryEntry): Promise<void> {
    try {
      await api.app.showItemInFolder(entry.path)
    } catch (e) {
      toast.error(tStatic('tools.library.openFailed', { message: (e as Error).message }))
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
  const filteredEntries = [...(summary?.entries ?? [])].filter((entry) => {
    if (favoriteOnly && !entry.favorite) return false
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
      entry.sourceMeta?.description,
      entry.sourceMeta?.tags?.join(' '),
      entry.notes,
      entry.sha256 ?? ''
    ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery))
  }).sort((a, b) =>
    Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) ||
    b.lastSeenAt - a.lastSeenAt ||
    a.name.localeCompare(b.name)
  )
  const visibleEntries = filteredEntries.slice(0, 60)
  const favoriteCount = (summary?.entries ?? []).filter((entry) => entry.favorite).length
  const missingCivitaiCount = (summary?.entries ?? []).filter(needsCivitaiInfo).length
  const filteredMissingCivitai = filteredEntries.filter(needsCivitaiInfo)
  const staleJobs = jobs.filter(isStaleDownloadJob)
  const runningJobs = jobs.filter((job) => job.status === 'running')
  const failedJobs = jobs.filter((job) => job.status === 'failed' || job.status === 'canceled')
  const partialIssues = integrity?.issues.filter(isPartialIntegrityIssue) ?? []
  const orphanPartialIssues = partialIssues.filter(isOrphanPartialIssue)
  const focusedPartialIssues = [
    ...orphanPartialIssues,
    ...partialIssues.filter((issue) => !isOrphanPartialIssue(issue))
  ].slice(0, 8)
  const nonPartialIssues = integrity?.issues.filter((issue) => !isPartialIntegrityIssue(issue)) ?? []
  const recentJobs = jobs.slice(0, 8)

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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <HealthStat label={t('tools.library.files')} value={String(summary?.totals.files ?? 0)} ok={(summary?.totals.files ?? 0) > 0} />
        <HealthStat label={t('tools.library.size')} value={formatBytes(summary?.totals.totalBytes ?? 0)} ok={(summary?.totals.totalBytes ?? 0) > 0} />
        <HealthStat label={t('tools.library.favorites')} value={String(favoriteCount)} ok={favoriteCount > 0} />
        <HealthStat label={t('tools.library.civitaiMissing')} value={String(missingCivitaiCount)} ok={missingCivitaiCount === 0} />
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

      <div className="flex flex-wrap gap-2">
        <button className="btn text-xs gap-1.5" onClick={() => { void checkIntegrity() }} disabled={busy} data-testid="model-library-integrity-check">
          <ShieldCheck className="h-3.5 w-3.5" />
          {t('tools.library.integrity')}
        </button>
        <button className="btn text-xs gap-1.5" onClick={() => { void recoverLibrary() }} disabled={busy} data-testid="model-library-recover">
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
        <button
          className="btn text-xs gap-1.5"
          onClick={() => { void refreshCivitaiBatch(filteredMissingCivitai) }}
          disabled={metadataBatchBusy || filteredMissingCivitai.length === 0}
          data-testid="model-library-civitai-batch"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', metadataBatchBusy && 'animate-spin')} />
          {metadataBatchBusy
            ? t('tools.library.fetchingCivitai')
            : t('tools.library.fetchCivitaiBatch', { count: filteredMissingCivitai.length })}
        </button>
      </div>

      <div className="rounded-md border border-line bg-bg-2/50 p-2 text-xs space-y-2" data-testid="model-library-download-recovery">
        <div className="flex items-center gap-2">
          <Download className="h-3.5 w-3.5 text-accent" />
          <span className="font-semibold text-ink-1">{t('tools.library.cleanupTitle')}</span>
          <span className="ml-auto text-[10px] text-ink-3">{t('tools.library.cleanupHint')}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Stat label={t('tools.library.runningJobs')} value={String(runningJobs.length)} />
          <Stat label={t('tools.library.staleJobs')} value={String(staleJobs.length)} />
          <Stat label={t('tools.library.failedJobs')} value={String(failedJobs.length)} />
          <Stat label={t('tools.library.orphanPartials')} value={integrity ? String(orphanPartialIssues.length) : '-'} />
        </div>
        {staleJobs.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded border border-warn/40 bg-warn/10 p-2" data-testid="model-library-stale-downloads">
            <AlertTriangle className="h-3.5 w-3.5 text-warn" />
            <span className="min-w-0 flex-1 text-[10px] text-ink-2">
              {t('tools.library.staleDownloadHint', { count: staleJobs.length })}
            </span>
            <button
              type="button"
              className="btn btn-ghost shrink-0 px-2 py-0.5 text-[10px] gap-1"
              onClick={() => { void recoverLibrary() }}
              disabled={busy}
              data-testid="model-library-stale-recover"
            >
              <Wrench className="h-3 w-3" />
              {t('tools.library.recoverStale')}
            </button>
          </div>
        )}
        {integrity ? (
          <div className="rounded border border-line/70 bg-bg-1/40 p-2 space-y-1" data-testid="model-library-partial-issues">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold text-ink-2">{t('tools.library.partialReviewTitle')}</span>
              <span className="ml-auto text-[10px] text-ink-3">{t('tools.library.partialReviewHint')}</span>
            </div>
            {focusedPartialIssues.length === 0 ? (
              <div className="text-[10px] text-ink-3">{t('tools.library.partialNone')}</div>
            ) : (
              focusedPartialIssues.map((issue, index) => (
                <div
                  key={`${issue.jobId ?? issue.path ?? 'partial'}-${index}`}
                  className="flex items-start gap-2 rounded border border-line/70 bg-bg-2/50 p-1.5"
                  data-testid={`model-library-partial-issue-${index}`}
                >
                  <span className={cn(
                    'shrink-0 rounded px-1.5 py-0.5 text-[9px]',
                    isOrphanPartialIssue(issue)
                      ? 'border border-warn/40 bg-warn/10 text-warn'
                      : 'border border-line bg-bg-3 text-ink-3'
                  )}>
                    {isOrphanPartialIssue(issue) ? t('tools.library.orphanPartialBadge') : t('tools.library.jobPartialBadge')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[10px] text-ink-3 truncate">{issue.message}</div>
                    {issue.path && <div className="font-mono text-[9px] text-ink-3 truncate">{issue.path}</div>}
                  </div>
                  {issue.path && (
                    <button
                      type="button"
                      className="btn btn-ghost shrink-0 px-1.5 py-0.5 text-[10px] gap-1"
                      onClick={() => { void deletePartial(issue.path!) }}
                      disabled={deletingPartialPath === issue.path}
                      data-testid={`model-library-delete-partial-${index}`}
                    >
                      <Trash2 className="h-3 w-3" />
                      {deletingPartialPath === issue.path ? t('tools.library.deletingPartial') : t('tools.library.deletePartial')}
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="text-[10px] text-ink-3">{t('tools.library.checkIntegrityForPartials')}</div>
        )}
      </div>

      {integrity && (
        <div className="rounded-md border border-line bg-bg-2/50 p-2 text-xs space-y-1">
          <div className="grid grid-cols-3 gap-2">
            <Stat label={t('tools.library.integrityIssuesLabel')} value={String(integrity.totals.issues)} />
            <Stat label={t('tools.library.shaMissing')} value={String(integrity.totals.shaMissing)} />
            <Stat label={t('tools.library.partialDownloads')} value={String(integrity.totals.partialDownloads)} />
          </div>
          {nonPartialIssues.slice(0, 5).map((issue, index) => (
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
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_120px] gap-2">
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
            <label className="flex h-8 items-center gap-1.5 rounded border border-line bg-bg-2 px-2 text-xs text-ink-2">
              <input
                type="checkbox"
                checked={favoriteOnly}
                onChange={(event) => setFavoriteOnly(event.target.checked)}
              />
              <Star className="h-3.5 w-3.5 text-warn" />
              {t('tools.library.favoriteOnly')}
            </label>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
            {visibleEntries.length === 0 ? (
              <div className="text-xs text-ink-3">{t('tools.library.noEntries')}</div>
            ) : (
              visibleEntries.map((entry, index) => {
                const previewSrc = modelPreviewSrc(entry)
                const pageUrl = modelPageUrl(entry)
                const description = entry.sourceMeta?.description || entry.notes || ''
                const notesValue = noteDrafts[entry.id] ?? entry.notes ?? ''
                const isAdapterEntry = isModelLibraryAdapterEntry(entry)
                const isCheckpointEntry = isModelLibraryCheckpointEntry(entry)
                const builtInPromptOverride = isAdapterEntry
                  ? getBuiltInLoraPromptPreset(modelLibraryLoraTarget(entry), null, { selectedModelTitle, recommendation })?.override
                  : undefined
                const promptOverride = isAdapterEntry ? findModelLibraryPromptOverride(promptOverrides, entry) : undefined
                const overrideDraft = overrideDrafts[entry.id] ?? modelLibraryPromptOverrideDraft(promptOverride ?? builtInPromptOverride)
                const overrideBusy = overrideBusyId === entry.id
                const checkpointContext = isCheckpointEntry ? checkpointPromptContextFromLibraryEntry(entry) : null
                const checkpointProfile = checkpointContext
                  ? findCheckpointPromptProfile(checkpointPromptProfiles, checkpointContext)
                  : undefined
                const checkpointProfileDraft = checkpointProfileDrafts[entry.id] ??
                  modelLibraryCheckpointProfileDraft(checkpointProfile, entry)
                const checkpointProfileBusy = checkpointProfileBusyId === entry.id
                const metadataBusy = metadataBusyId === entry.id
                const recipeBusy = recipeBusyId === entry.id
                const recipeStats = recipeStatsByEntry[entry.id] ?? null
                const trainedWords = entry.sourceMeta?.trainedWords ?? []
                const recommendedPrompts = entry.sourceMeta?.recommendedPrompts ?? []
                const hasPromptHints = trainedWords.length > 0 || recommendedPrompts.length > 0
                const canLoadRecipeStats = typeof entry.sourceMeta?.modelVersionId === 'number'
                return (
                  <div
                    key={entry.id}
                    className={cn('rounded-md border bg-bg-2/50 p-2 text-xs', entry.favorite ? 'border-warn/50' : 'border-line')}
                    data-testid={`model-library-entry-${index}`}
                  >
                    <div className="grid grid-cols-[72px_1fr] gap-2">
                      <div className="h-[72px] w-[72px] overflow-hidden rounded border border-line bg-bg-3 flex items-center justify-center">
                        {previewSrc ? (
                          <img
                            src={previewSrc}
                            alt=""
                            className="h-full w-full object-cover"
                            data-testid={`model-library-preview-${index}`}
                          />
                        ) : (
                          <ImageIcon className="h-5 w-5 text-ink-3" />
                        )}
                      </div>
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="rounded bg-bg-3 px-1.5 py-0.5 text-[10px] text-ink-2 shrink-0">{entry.type}</span>
                          <span className="font-mono text-[11px] text-ink-1 truncate">{entry.name}</span>
                          <span className="ml-auto font-mono text-[10px] text-ink-3 shrink-0">{formatBytes(entry.sizeBytes)}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-ink-3 min-w-0">
                          <span className="shrink-0">{entry.sourceMeta?.name ?? entry.source}</span>
                          {entry.sourceMeta?.baseModel && <span className="shrink-0">{entry.sourceMeta.baseModel}</span>}
                          {entry.sourceMeta?.creator && <span className="shrink-0">@{entry.sourceMeta.creator}</span>}
                          <span className="font-mono truncate">{entry.sha256 ? entry.sha256.slice(0, 12) : t('tools.library.shaMissing')}</span>
                        </div>
                        {description ? (
                          <div className="line-clamp-2 text-[10px] leading-relaxed text-ink-3">
                            {description}
                          </div>
                        ) : (
                          <div className="text-[10px] text-ink-3">{t('tools.library.noDescription')}</div>
                        )}
                        {hasPromptHints && (
                          <div className="flex flex-wrap gap-1" data-testid={`model-library-recipe-hints-${index}`}>
                            {trainedWords.slice(0, 5).map((word) => (
                              <button
                                key={`tw-${word}`}
                                type="button"
                                className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent hover:bg-accent/20"
                                onClick={() => applyRecipePromptHint(word)}
                                title={t('tools.library.recipeHintApply')}
                              >
                                {word}
                              </button>
                            ))}
                            {recommendedPrompts.slice(0, 2).map((hint, hintIndex) => (
                              <button
                                key={`rp-${hintIndex}-${hint}`}
                                type="button"
                                className="max-w-full truncate rounded border border-ok/30 bg-ok/10 px-1.5 py-0.5 text-[10px] text-ok hover:bg-ok/20"
                                onClick={() => applyRecipePromptHint(hint)}
                                title={hint}
                              >
                                {hint}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        className={cn('btn btn-ghost text-[10px] py-0.5 gap-1', entry.favorite && 'text-warn')}
                        onClick={() => { void toggleFavorite(entry) }}
                        title={entry.favorite ? t('tools.library.unfavorite') : t('tools.library.favorite')}
                        data-testid={`model-library-favorite-${index}`}
                      >
                        <Star className={cn('h-3 w-3', entry.favorite && 'fill-current')} />
                        {entry.favorite ? t('tools.library.unfavorite') : t('tools.library.favorite')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost text-[10px] py-0.5 gap-1"
                        onClick={() => { void refreshCivitai(entry) }}
                        disabled={Boolean(metadataBusyId)}
                        title={t('tools.library.fetchCivitai')}
                        data-testid={`model-library-fetch-civitai-${index}`}
                      >
                        <RefreshCw className={cn('h-3 w-3', metadataBusy && 'animate-spin')} />
                        {metadataBusy ? t('tools.library.fetchingCivitai') : t('tools.library.fetchCivitai')}
                      </button>
                      {canLoadRecipeStats && (
                        <button
                          type="button"
                          className="btn btn-ghost text-[10px] py-0.5 gap-1"
                          onClick={() => { void loadRecipeStats(entry) }}
                          disabled={Boolean(recipeBusyId)}
                          title={t('tools.library.recipeStats')}
                          data-testid={`model-library-recipe-stats-load-${index}`}
                        >
                          <Activity className={cn('h-3 w-3', recipeBusy && 'animate-pulse')} />
                          {recipeBusy ? t('tools.library.recipeLoading') : t('tools.library.recipeStats')}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost text-[10px] py-0.5 gap-1"
                        onClick={() => { void openEntryLocation(entry) }}
                        title={t('tools.library.openFolder')}
                        data-testid={`model-library-open-folder-${index}`}
                      >
                        <FolderOpen className="h-3 w-3" />
                        {t('tools.library.openFolder')}
                      </button>
                      {pageUrl && (
                        <button
                          type="button"
                          className="btn btn-ghost text-[10px] py-0.5 gap-1 ml-auto"
                          onClick={() => { void api.app.openExternal(pageUrl) }}
                          title={t('tools.library.openCivitai')}
                        >
                          <ExternalLink className="h-3 w-3" />
                          {t('tools.library.openCivitai')}
                        </button>
                      )}
                      {!entry.sha256 && (
                        <button
                          type="button"
                          className="btn btn-ghost text-[10px] py-0.5 gap-1"
                          onClick={() => { void hashEntry(entry.id) }}
                          disabled={hashingId === entry.id}
                        >
                          <RefreshCw className={cn('h-3 w-3', hashingId === entry.id && 'animate-spin')} />
                          {t('tools.library.hashOne')}
                        </button>
                      )}
                    </div>
                    {recipeStats && (
                      <ModelLibraryRecipeStats stats={recipeStats} index={index} />
                    )}
                    {isAdapterEntry && (
                      <div
                        className="mt-2 rounded-md border border-accent/30 bg-bg-1/60 p-2 space-y-2"
                        data-testid={`model-library-lora-prompt-${index}`}
                      >
                        <div className="flex flex-wrap items-center gap-2 text-[10px]">
                          <span className="rounded border border-accent/40 bg-accent-dim/40 px-1.5 py-0.5 font-semibold text-accent">
                            {t('loraCard.promptOverrideBadge')}
                          </span>
                          <label className="ml-auto flex items-center gap-1 text-ink-2">
                            <input
                              type="checkbox"
                              checked={overrideDraft.autoApply}
                              onChange={(event) => updateOverrideDraft(entry, { autoApply: event.target.checked })}
                            />
                            {t('loraCard.promptOverrideAutoApply')}
                          </label>
                        </div>
                        <textarea
                          className="input min-h-[54px] w-full resize-y text-xs"
                          value={overrideDraft.positivePrompt}
                          onChange={(event) => updateOverrideDraft(entry, { positivePrompt: event.target.value })}
                          placeholder={t('loraCard.promptOverridePositivePlaceholder')}
                          aria-label={t('loraCard.promptOverridePositive')}
                          data-prompt-dictionary-autocomplete="lora-positive"
                          data-testid={`model-library-lora-positive-prompt-${index}`}
                        />
                        <textarea
                          className="input min-h-[42px] w-full resize-y text-xs"
                          value={overrideDraft.negativePrompt}
                          onChange={(event) => updateOverrideDraft(entry, { negativePrompt: event.target.value })}
                          placeholder={t('loraCard.promptOverrideNegativePlaceholder')}
                          aria-label={t('loraCard.promptOverrideNegative')}
                          data-prompt-dictionary-autocomplete="lora-negative"
                          data-testid={`model-library-lora-negative-prompt-${index}`}
                        />
                        <div className="flex flex-wrap items-center gap-1.5">
                          <input
                            className="input h-7 w-24 text-xs"
                            type="number"
                            min="-1"
                            max="2"
                            step="0.05"
                            value={overrideDraft.weight}
                            onChange={(event) => updateOverrideDraft(entry, { weight: event.target.value })}
                            placeholder={t('loraCard.promptOverrideWeightAuto')}
                            aria-label={t('loraCard.promptOverrideWeight')}
                          />
                          <input
                            className="input h-7 w-20 text-xs"
                            type="number"
                            min="1"
                            max="150"
                            step="1"
                            value={overrideDraft.steps}
                            onChange={(event) => updateOverrideDraft(entry, { steps: event.target.value })}
                            placeholder={t('loraCard.promptOverrideSteps')}
                            aria-label={t('loraCard.promptOverrideSteps')}
                          />
                          <input
                            className="input h-7 w-20 text-xs"
                            type="number"
                            min="1"
                            max="30"
                            step="0.5"
                            value={overrideDraft.cfgScale}
                            onChange={(event) => updateOverrideDraft(entry, { cfgScale: event.target.value })}
                            placeholder={t('loraCard.promptOverrideCfg')}
                            aria-label={t('loraCard.promptOverrideCfg')}
                          />
                          <input
                            className="input h-7 w-20 text-xs"
                            type="number"
                            min="1"
                            max="12"
                            step="1"
                            value={overrideDraft.clipSkip}
                            onChange={(event) => updateOverrideDraft(entry, { clipSkip: event.target.value })}
                            placeholder={t('loraCard.promptOverrideClipSkip')}
                            aria-label={t('loraCard.promptOverrideClipSkip')}
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <input
                            className="input h-7 min-w-36 flex-1 text-xs"
                            type="text"
                            value={overrideDraft.sampler}
                            onChange={(event) => updateOverrideDraft(entry, { sampler: event.target.value })}
                            placeholder={t('loraCard.promptOverrideSampler')}
                            aria-label={t('loraCard.promptOverrideSampler')}
                          />
                          {builtInPromptOverride && (
                            <button
                              type="button"
                              className="btn btn-ghost text-[10px] py-0.5 gap-1"
                              onClick={() => copyBuiltInToPromptOverride(entry)}
                              title={t('tools.library.loraPromptPresetDefault')}
                            >
                              <RefreshCw className="h-3 w-3" />
                              {t('tools.library.loraPromptPresetDefault')}
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-ghost text-[10px] py-0.5 gap-1"
                            onClick={() => copyNotesToPromptOverride(entry)}
                            title={t('tools.library.loraPromptFromNotes')}
                          >
                            <ClipboardPaste className="h-3 w-3" />
                            {t('tools.library.loraPromptFromNotes')}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost text-[10px] py-0.5 gap-1 ml-auto"
                            onClick={() => { void savePromptOverride(entry) }}
                            disabled={Boolean(overrideBusyId)}
                          >
                            <Save className="h-3 w-3" />
                            {overrideBusy ? t('common.loading') : t('loraCard.promptOverrideSave')}
                          </button>
                          {promptOverride && (
                            <button
                              type="button"
                              className="btn btn-ghost text-[10px] py-0.5 gap-1 text-err"
                              onClick={() => { void removePromptOverride(entry) }}
                              disabled={Boolean(overrideBusyId)}
                              title={t('common.delete')}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                    {isCheckpointEntry && (
                      <div
                        className="mt-2 rounded-md border border-accent/30 bg-bg-1/60 p-2 space-y-2"
                        data-testid={`model-library-checkpoint-prompt-${index}`}
                      >
                        <div className="flex flex-wrap items-center gap-2 text-[10px]">
                          <span className="rounded border border-accent/40 bg-accent-dim/40 px-1.5 py-0.5 font-semibold text-accent">
                            {t('tools.library.checkpointProfile')}
                          </span>
                          <input
                            className="input h-7 w-36 text-[10px]"
                            value={checkpointProfileDraft.baseModel}
                            onChange={(event) => updateCheckpointProfileDraft(entry, { baseModel: event.target.value })}
                            placeholder={t('tools.library.checkpointProfileBaseModel')}
                            aria-label={t('tools.library.checkpointProfileBaseModel')}
                            data-testid={`model-profile-base-model-${index}`}
                          />
                          <select
                            className="input h-7 w-32 text-[10px]"
                            value={checkpointProfileDraft.family}
                            onChange={(event) => updateCheckpointProfileDraft(entry, { family: event.target.value })}
                            aria-label={t('tools.library.checkpointProfileFamily')}
                            data-testid={`model-profile-family-${index}`}
                          >
                            {['pony', 'illustrious', 'noobai', 'animagine', 'sdxl', 'sd15', 'flux', 'custom'].map((family) => (
                              <option key={family} value={family}>{family}</option>
                            ))}
                          </select>
                          <select
                            className="input h-7 w-28 text-[10px]"
                            value={checkpointProfileDraft.mode}
                            onChange={(event) => updateCheckpointProfileDraft(entry, { mode: event.target.value })}
                            aria-label={t('tools.library.checkpointProfileMode')}
                            data-testid={`model-profile-mode-${index}`}
                          >
                            <option value="suggest">{t('tools.library.checkpointProfileModeSuggest')}</option>
                            <option value="manual">{t('tools.library.checkpointProfileModeManual')}</option>
                            <option value="auto">{t('tools.library.checkpointProfileModeAuto')}</option>
                          </select>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5" data-testid={`model-profile-pro-guidance-${index}`}>
                          <select
                            className="input h-7 text-[10px]"
                            value={checkpointProfileDraft.promptStyle}
                            onChange={(event) => updateCheckpointProfileDraft(entry, { promptStyle: event.target.value })}
                            aria-label={t('tools.library.checkpointProfilePromptStyle')}
                            data-testid={`model-profile-prompt-style-${index}`}
                          >
                            <option value="tag">{t('tools.library.checkpointProfilePromptStyleTag')}</option>
                            <option value="natural">{t('tools.library.checkpointProfilePromptStyleNatural')}</option>
                            <option value="structured">{t('tools.library.checkpointProfilePromptStyleStructured')}</option>
                            <option value="hybrid">{t('tools.library.checkpointProfilePromptStyleHybrid')}</option>
                          </select>
                          <select
                            className="input h-7 text-[10px]"
                            value={checkpointProfileDraft.negativeStrategy}
                            onChange={(event) => updateCheckpointProfileDraft(entry, { negativeStrategy: event.target.value })}
                            aria-label={t('tools.library.checkpointProfileNegativeStrategy')}
                            data-testid={`model-profile-negative-strategy-${index}`}
                          >
                            <option value="classic">{t('tools.library.checkpointProfileNegativeClassic')}</option>
                            <option value="minimal">{t('tools.library.checkpointProfileNegativeMinimal')}</option>
                            <option value="positive-replacement">{t('tools.library.checkpointProfileNegativePositiveReplacement')}</option>
                          </select>
                          <input
                            className="input h-7 text-[10px]"
                            type="number"
                            min="0"
                            max="12"
                            value={checkpointProfileDraft.recommendedLoraMin}
                            onChange={(event) => updateCheckpointProfileDraft(entry, { recommendedLoraMin: event.target.value })}
                            placeholder={t('tools.library.checkpointProfileLoraMin')}
                            aria-label={t('tools.library.checkpointProfileLoraMin')}
                            data-testid={`model-profile-lora-min-${index}`}
                          />
                          <input
                            className="input h-7 text-[10px]"
                            type="number"
                            min="0"
                            max="12"
                            value={checkpointProfileDraft.recommendedLoraMax}
                            onChange={(event) => updateCheckpointProfileDraft(entry, { recommendedLoraMax: event.target.value })}
                            placeholder={t('tools.library.checkpointProfileLoraMax')}
                            aria-label={t('tools.library.checkpointProfileLoraMax')}
                            data-testid={`model-profile-lora-max-${index}`}
                          />
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                          <input
                            className="input h-7 text-[10px]"
                            value={checkpointProfileDraft.sampler}
                            onChange={(event) => updateCheckpointProfileDraft(entry, { sampler: event.target.value })}
                            placeholder={t('tools.library.checkpointProfileSampler')}
                            aria-label={t('tools.library.checkpointProfileSampler')}
                          />
                          <input
                            className="input h-7 text-[10px]"
                            type="number"
                            min="1"
                            max="150"
                            value={checkpointProfileDraft.steps}
                            onChange={(event) => updateCheckpointProfileDraft(entry, { steps: event.target.value })}
                            placeholder={t('tools.library.checkpointProfileSteps')}
                            aria-label={t('tools.library.checkpointProfileSteps')}
                          />
                          <input
                            className="input h-7 text-[10px]"
                            type="number"
                            min="1"
                            max="30"
                            step="0.1"
                            value={checkpointProfileDraft.cfgScale}
                            onChange={(event) => updateCheckpointProfileDraft(entry, { cfgScale: event.target.value })}
                            placeholder={t('tools.library.checkpointProfileCfg')}
                            aria-label={t('tools.library.checkpointProfileCfg')}
                          />
                          <input
                            className="input h-7 text-[10px]"
                            type="number"
                            min="64"
                            max="4096"
                            step="8"
                            value={checkpointProfileDraft.width}
                            onChange={(event) => updateCheckpointProfileDraft(entry, { width: event.target.value })}
                            placeholder={t('tools.library.checkpointProfileWidth')}
                            aria-label={t('tools.library.checkpointProfileWidth')}
                          />
                          <input
                            className="input h-7 text-[10px]"
                            type="number"
                            min="64"
                            max="4096"
                            step="8"
                            value={checkpointProfileDraft.height}
                            onChange={(event) => updateCheckpointProfileDraft(entry, { height: event.target.value })}
                            placeholder={t('tools.library.checkpointProfileHeight')}
                            aria-label={t('tools.library.checkpointProfileHeight')}
                          />
                          <input
                            className="input h-7 text-[10px]"
                            type="number"
                            min="1"
                            max="12"
                            value={checkpointProfileDraft.clipSkip}
                            onChange={(event) => updateCheckpointProfileDraft(entry, { clipSkip: event.target.value })}
                            placeholder={t('tools.library.checkpointProfileClipSkip')}
                            aria-label={t('tools.library.checkpointProfileClipSkip')}
                          />
                        </div>
                        <textarea
                          className="input min-h-[38px] w-full resize-y text-xs"
                          value={checkpointProfileDraft.positivePrefix}
                          onChange={(event) => updateCheckpointProfileDraft(entry, { positivePrefix: event.target.value })}
                          placeholder={t('tools.library.checkpointProfilePositivePrefixPlaceholder')}
                          aria-label={t('tools.library.checkpointProfilePositivePrefix')}
                          data-prompt-dictionary-autocomplete="profile-positive"
                          data-testid={`model-profile-positive-prefix-${index}`}
                        />
                        <textarea
                          className="input min-h-[38px] w-full resize-y text-xs"
                          value={checkpointProfileDraft.positiveAppend}
                          onChange={(event) => updateCheckpointProfileDraft(entry, { positiveAppend: event.target.value })}
                          placeholder={t('tools.library.checkpointProfilePositiveAppendPlaceholder')}
                          aria-label={t('tools.library.checkpointProfilePositiveAppend')}
                          data-prompt-dictionary-autocomplete="profile-positive"
                          data-testid={`model-profile-positive-append-${index}`}
                        />
                        <textarea
                          className="input min-h-[38px] w-full resize-y text-xs"
                          value={checkpointProfileDraft.negativeAppend}
                          onChange={(event) => updateCheckpointProfileDraft(entry, { negativeAppend: event.target.value })}
                          placeholder={t('tools.library.checkpointProfileNegativeAppendPlaceholder')}
                          aria-label={t('tools.library.checkpointProfileNegativeAppend')}
                          data-prompt-dictionary-autocomplete="profile-negative"
                          data-testid={`model-profile-negative-append-${index}`}
                        />
                        <textarea
                          className="input min-h-[38px] w-full resize-y text-xs"
                          value={checkpointProfileDraft.recommendedAspectRatios}
                          onChange={(event) => updateCheckpointProfileDraft(entry, { recommendedAspectRatios: event.target.value })}
                          placeholder={t('tools.library.checkpointProfileAspectRatiosPlaceholder')}
                          aria-label={t('tools.library.checkpointProfileAspectRatios')}
                          data-testid={`model-profile-aspect-ratios-${index}`}
                        />
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5" data-testid={`model-profile-related-models-${index}`}>
                          <label className="space-y-1">
                            <span className="text-[10px] text-ink-3">{t('tools.library.checkpointProfileRelatedLoras')}</span>
                            <textarea
                              className="input min-h-[52px] w-full resize-y text-xs"
                              value={checkpointProfileDraft.relatedLoras}
                              onChange={(event) => updateCheckpointProfileDraft(entry, { relatedLoras: event.target.value })}
                              placeholder={t('tools.library.checkpointProfileRelatedLorasPlaceholder')}
                              data-testid={`model-profile-related-loras-${index}`}
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-[10px] text-ink-3">{t('tools.library.checkpointProfileRelatedVaes')}</span>
                            <textarea
                              className="input min-h-[52px] w-full resize-y text-xs"
                              value={checkpointProfileDraft.relatedVaes}
                              onChange={(event) => updateCheckpointProfileDraft(entry, { relatedVaes: event.target.value })}
                              placeholder={t('tools.library.checkpointProfileRelatedVaesPlaceholder')}
                              data-testid={`model-profile-related-vaes-${index}`}
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-[10px] text-ink-3">{t('tools.library.checkpointProfileRelatedControlNets')}</span>
                            <textarea
                              className="input min-h-[52px] w-full resize-y text-xs"
                              value={checkpointProfileDraft.relatedControlNets}
                              onChange={(event) => updateCheckpointProfileDraft(entry, { relatedControlNets: event.target.value })}
                              placeholder={t('tools.library.checkpointProfileRelatedControlNetsPlaceholder')}
                              data-testid={`model-profile-related-controlnets-${index}`}
                            />
                          </label>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <textarea
                            className="input min-h-[52px] w-full resize-y text-xs"
                            value={checkpointProfileDraft.compatibilityNotes}
                            onChange={(event) => updateCheckpointProfileDraft(entry, { compatibilityNotes: event.target.value })}
                            placeholder={t('tools.library.checkpointProfileCompatibilityPlaceholder')}
                            aria-label={t('tools.library.checkpointProfileCompatibility')}
                            data-testid={`model-profile-compatibility-${index}`}
                          />
                          <textarea
                            className="input min-h-[52px] w-full resize-y text-xs"
                            value={checkpointProfileDraft.recipeNotes}
                            onChange={(event) => updateCheckpointProfileDraft(entry, { recipeNotes: event.target.value })}
                            placeholder={t('tools.library.checkpointProfileRecipePlaceholder')}
                            aria-label={t('tools.library.checkpointProfileRecipe')}
                            data-testid={`model-profile-recipe-notes-${index}`}
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            className="btn btn-ghost text-[10px] py-0.5 gap-1"
                            onClick={() => resetCheckpointProfileDraft(entry)}
                            title={t('tools.library.checkpointProfileDefault')}
                            data-testid={`model-profile-default-${index}`}
                          >
                            <RefreshCw className="h-3 w-3" />
                            {t('tools.library.checkpointProfileDefault')}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost text-[10px] py-0.5 gap-1 ml-auto"
                            onClick={() => { void saveCheckpointProfile(entry) }}
                            disabled={Boolean(checkpointProfileBusyId)}
                            data-testid={`model-profile-save-${index}`}
                          >
                            <Save className="h-3 w-3" />
                            {checkpointProfileBusy ? t('common.loading') : t('loraCard.promptOverrideSave')}
                          </button>
                          {checkpointProfile && (
                            <button
                              type="button"
                              className="btn btn-ghost text-[10px] py-0.5 gap-1 text-err"
                            onClick={() => { void removeCheckpointProfile(entry) }}
                            disabled={Boolean(checkpointProfileBusyId)}
                            title={t('common.delete')}
                            data-testid={`model-profile-delete-${index}`}
                          >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                    <textarea
                      className="input mt-2 min-h-[48px] w-full resize-y text-xs"
                      value={notesValue}
                      onChange={(event) => setNoteDrafts((current) => ({ ...current, [entry.id]: event.target.value }))}
                      onBlur={() => { void saveNotes(entry) }}
                      placeholder={t('tools.library.notesPlaceholder')}
                    />
                  </div>
                )
              })
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
            {recentJobs.map((job, index) => {
              const stale = isStaleDownloadJob(job)
              const canResume = canResumeDownloadJob(job)
              const canDiscard = canDiscardDownloadJob(job)
              return (
              <div
                key={job.id}
                className={cn('rounded-md border bg-bg-2/50 p-2 text-xs', stale ? 'border-warn/50' : 'border-line')}
                data-testid={`model-library-download-job-${index}`}
                data-download-status={job.status}
                data-stale={stale ? 'true' : 'false'}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={cn('h-2 w-2 rounded-full shrink-0', statusColor(job.status))} />
                  <span className="font-mono text-[11px] text-ink-1 truncate">{job.filename}</span>
                  {stale && (
                    <span className="rounded border border-warn/40 bg-warn/10 px-1.5 py-0.5 text-[9px] text-warn">
                      {t('tools.library.staleBadge')}
                    </span>
                  )}
                  <span className="ml-auto text-[10px] text-ink-3 shrink-0">{t(`tools.library.status.${job.status}`)}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-ink-3">
                  <span>{job.assetType}</span>
                  {job.source?.provider && <span>{job.source.provider}</span>}
                  <span className="font-mono">{formatDownloadProgress(job)}</span>
                  <span className="ml-auto font-mono">{t('tools.library.jobUpdated', { age: formatDurationMs(Date.now() - job.updatedAt) })}</span>
                </div>
                {job.error && (
                  <div className="mt-1 rounded border border-err/30 bg-err/10 px-1.5 py-1 text-[10px] text-ink-2">
                    {job.error}
                  </div>
                )}
                <div className="mt-2 flex items-center gap-1">
                  {canResume && (
                    <button
                      className="btn btn-ghost text-[10px] py-0.5 gap-1"
                      onClick={() => { void resume(job) }}
                      disabled={busy}
                      title={t('tools.library.resume')}
                      data-testid={`download-job-resume-${index}`}
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
                    disabled={busy || !canDiscard}
                    title={canDiscard ? t('tools.library.discard') : t('tools.library.discardActiveDisabled')}
                    data-testid={`download-job-discard-${index}`}
                  >
                    <Trash2 className="h-3 w-3" />
                    {t('tools.library.discard')}
                  </button>
                </div>
              </div>
            )})}
          </div>
        )}
      </div>
    </div>
  )
}

interface ModelLibraryPromptOverrideDraft {
  positivePrompt: string
  negativePrompt: string
  weight: string
  sampler: string
  steps: string
  cfgScale: string
  clipSkip: string
  autoApply: boolean
}

interface ModelLibraryCheckpointProfileDraft {
  family: string
  mode: string
  baseModel: string
  promptStyle: string
  negativeStrategy: string
  positivePrefix: string
  positiveAppend: string
  negativeAppend: string
  sampler: string
  steps: string
  cfgScale: string
  width: string
  height: string
  clipSkip: string
  recommendedAspectRatios: string
  recommendedLoraMin: string
  recommendedLoraMax: string
  relatedLoras: string
  relatedVaes: string
  relatedControlNets: string
  compatibilityNotes: string
  recipeNotes: string
}

function isModelLibraryAdapterEntry(entry: ModelLibraryEntry): boolean {
  return entry.type === 'LORA' || entry.type === 'LoCon' || entry.type === 'LyCORIS'
}

function isModelLibraryCheckpointEntry(entry: ModelLibraryEntry): boolean {
  return entry.type === 'Checkpoint'
}

function ModelLibraryRecipeStats({
  stats,
  index
}: {
  stats: CivitaiCommunityStats
  index: number
}): JSX.Element {
  const t = useT()
  const topSampler = stats.topSamplers[0]
  const topSize = stats.topSizes[0]
  return (
    <div
      className="mt-2 rounded-md border border-accent/30 bg-bg-1/65 p-2 text-[10px] space-y-2"
      data-testid={`model-library-recipe-stats-${index}`}
    >
      <div className="flex items-center gap-1.5">
        <Activity className="h-3 w-3 text-accent" />
        <span className="font-semibold text-ink-1">{t('tools.library.recipeStatsTitle')}</span>
        <span className="ml-auto font-mono text-ink-3">{t('tools.library.recipeStatsSamples', { count: stats.sampleCount })}</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <RecipeStatCell
          label="Sampler"
          value={topSampler ? `${topSampler.name} (${recipePct(topSampler.freq, stats.sampleCount)}%)` : '-'}
          testId={`model-library-recipe-sampler-${index}`}
        />
        <RecipeStatCell
          label="Size"
          value={topSize ? `${topSize.width}×${topSize.height} (${recipePct(topSize.freq, stats.sampleCount)}%)` : '-'}
          testId={`model-library-recipe-size-${index}`}
        />
        <RecipeStatCell label="Steps" value={recipeDistribution(stats.stepsDist)} />
        <RecipeStatCell label="CFG" value={recipeDistribution(stats.cfgDist)} />
      </div>
      {stats.topLoras.length > 0 && (
        <div className="flex flex-wrap gap-1" data-testid={`model-library-recipe-loras-${index}`}>
          {stats.topLoras.slice(0, 5).map((lora) => (
            <span key={lora.name} className="rounded border border-line bg-bg-2 px-1.5 py-0.5 text-ink-2">
              {lora.name} {recipePct(lora.freq, stats.sampleCount)}%
            </span>
          ))}
        </div>
      )}
      {stats.commonPositivePhrases.length > 0 && (
        <div className="flex flex-wrap gap-1" data-testid={`model-library-recipe-phrases-${index}`}>
          {stats.commonPositivePhrases.slice(0, 5).map((phrase) => (
            <span key={phrase.phrase} className="rounded border border-ok/30 bg-ok/10 px-1.5 py-0.5 text-ok">
              {phrase.phrase}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function RecipeStatCell({
  label,
  value,
  testId
}: {
  label: string
  value: string
  testId?: string
}): JSX.Element {
  return (
    <div className="rounded border border-line bg-bg-2/70 px-1.5 py-1" data-testid={testId}>
      <div className="text-ink-3">{label}</div>
      <div className="font-mono text-ink-1">{value}</div>
    </div>
  )
}

function recipeDistribution(dist: CivitaiCommunityStats['stepsDist']): string {
  if (dist.median == null) return '-'
  const median = Math.round(dist.median * 10) / 10
  if (dist.q1 == null || dist.q3 == null || dist.q1 === dist.q3) return String(median)
  return `${median} (${Math.round(dist.q1 * 10) / 10}-${Math.round(dist.q3 * 10) / 10})`
}

function recipePct(freq: number, total: number): number {
  if (!total) return 0
  return Math.round((freq / total) * 100)
}

function modelLibraryPromptOverrideDraft(override?: LoraPromptOverride): ModelLibraryPromptOverrideDraft {
  return {
    positivePrompt: override?.positivePrompt ?? '',
    negativePrompt: override?.negativePrompt ?? '',
    weight: override?.weight != null ? String(override.weight) : '',
    sampler: override?.sampler ?? '',
    steps: override?.steps != null ? String(override.steps) : '',
    cfgScale: override?.cfgScale != null ? String(override.cfgScale) : '',
    clipSkip: override?.clipSkip != null ? String(override.clipSkip) : '',
    autoApply: override?.autoApply !== false
  }
}

function modelLibraryLoraTarget(entry: ModelLibraryEntry): {
  name: string
  alias?: string
  path?: string
  sha256?: string | null
} {
  const name = modelLibraryAdapterName(entry)
  return {
    name,
    alias: entry.sourceMeta?.name ?? entry.name,
    path: entry.path,
    sha256: modelLibraryEntrySha(entry)
  }
}

function modelLibraryCheckpointProfileDraft(
  profile: CheckpointPromptProfile | undefined,
  entry: ModelLibraryEntry
): ModelLibraryCheckpointProfileDraft {
  const fallback = profile ?? defaultCheckpointPromptProfile(checkpointPromptContextFromLibraryEntry(entry))
  return {
    family: fallback.family ?? inferCheckpointPromptFamily(checkpointPromptContextFromLibraryEntry(entry)),
    mode: fallback.mode,
    baseModel: fallback.baseModel ?? entry.sourceMeta?.baseModel ?? '',
    promptStyle: fallback.promptStyle ?? 'tag',
    negativeStrategy: fallback.negativeStrategy ?? 'classic',
    positivePrefix: joinProfileTags(fallback.positivePrefix),
    positiveAppend: joinProfileTags(fallback.positiveAppend),
    negativeAppend: joinProfileTags(fallback.negativeAppend),
    sampler: fallback.sampler ?? '',
    steps: fallback.steps != null ? String(fallback.steps) : '',
    cfgScale: fallback.cfgScale != null ? String(fallback.cfgScale) : '',
    width: fallback.width != null ? String(fallback.width) : '',
    height: fallback.height != null ? String(fallback.height) : '',
    clipSkip: fallback.clipSkip != null ? String(fallback.clipSkip) : '',
    recommendedAspectRatios: formatAspectRatioDraft(fallback.recommendedAspectRatios),
    recommendedLoraMin: fallback.recommendedLoraCount?.min != null ? String(fallback.recommendedLoraCount.min) : '',
    recommendedLoraMax: fallback.recommendedLoraCount?.max != null ? String(fallback.recommendedLoraCount.max) : '',
    relatedLoras: formatRelatedModelDraft(fallback.relatedModels?.loras),
    relatedVaes: formatRelatedModelDraft(fallback.relatedModels?.vaes),
    relatedControlNets: formatRelatedModelDraft(fallback.relatedModels?.controlNets),
    compatibilityNotes: (fallback.compatibilityNotes ?? []).join('\n'),
    recipeNotes: (fallback.recipeNotes ?? []).join('\n')
  }
}

function findModelLibraryPromptOverride(
  overrides: Map<string, LoraPromptOverride>,
  entry: ModelLibraryEntry
): LoraPromptOverride | undefined {
  for (const key of modelLibraryPromptOverrideKeys(entry)) {
    const hit = overrides.get(key)
    if (hit) return hit
  }
  const sha = modelLibraryEntrySha(entry)
  const adapterName = modelLibraryAdapterName(entry).toLowerCase()
  const entryName = entry.name.toLowerCase()
  const entryPath = entry.path.toLowerCase()
  for (const item of overrides.values()) {
    if (sha && item.loraSha256?.toLowerCase() === sha) return item
    if (item.loraName.toLowerCase() === adapterName || item.loraName.toLowerCase() === entryName) return item
    if (item.loraPath?.toLowerCase() === entryPath) return item
  }
  return undefined
}

function preferredModelLibraryPromptOverrideId(entry: ModelLibraryEntry): string {
  const sha = modelLibraryEntrySha(entry)
  return sha ? `sha256:${sha}` : `name:${modelLibraryAdapterName(entry).toLowerCase()}`
}

function modelLibraryPromptOverrideKeys(entry: ModelLibraryEntry): string[] {
  const keys = [
    preferredModelLibraryPromptOverrideId(entry),
    `name:${modelLibraryAdapterName(entry).toLowerCase()}`,
    `name:${entry.name.toLowerCase()}`
  ]
  if (entry.path) keys.push(`path:${entry.path.toLowerCase()}`)
  return Array.from(new Set(keys))
}

function modelLibraryEntrySha(entry: ModelLibraryEntry): string | null {
  const sha = entry.sha256 ?? entry.civitai?.expectedSha256 ?? entry.sourceMeta?.expectedSha256 ?? null
  return typeof sha === 'string' && /^[a-f0-9]{64}$/i.test(sha) ? sha.toLowerCase() : null
}

function modelLibraryAdapterName(entry: ModelLibraryEntry): string {
  const fromFile = stripModelFileExtension(entry.name)
  if (fromFile) return fromFile
  return stripModelFileExtension(entry.sourceMeta?.name ?? entry.name)
}

function stripModelFileExtension(value: string): string {
  return value.trim().replace(/\.(safetensors|ckpt|pt|pth|bin)$/i, '')
}

function parseOptionalDraftNumber(value: string, min: number, max: number, integer: boolean): number | null {
  if (!value.trim()) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  const rounded = integer ? Math.round(parsed) : Math.round(parsed * 100) / 100
  return Math.max(min, Math.min(max, rounded))
}

function parseLoraCountDraft(minValue: string, maxValue: string): CheckpointPromptProfile['recommendedLoraCount'] {
  const min = parseOptionalDraftNumber(minValue, 0, 12, true)
  const max = parseOptionalDraftNumber(maxValue, 0, 12, true)
  if (min == null && max == null) return null
  const safeMin = min ?? 0
  const safeMax = max ?? safeMin
  return { min: Math.min(safeMin, safeMax), max: Math.max(safeMin, safeMax) }
}

function parseAspectRatioDraft(value: string): CheckpointPromptProfile['recommendedAspectRatios'] {
  const ratios: NonNullable<CheckpointPromptProfile['recommendedAspectRatios']> = []
  for (const raw of value.split(/\n+/)) {
    const line = raw.trim()
    if (!line) continue
    const match = line.match(/^(?:(.+?)\s+)?(\d{2,4})\s*[x×]\s*(\d{2,4})$/i)
    if (!match) continue
    const label = (match[1] || 'Ratio').trim().slice(0, 80)
    const width = Math.max(64, Math.min(4096, Number(match[2])))
    const height = Math.max(64, Math.min(4096, Number(match[3])))
    ratios.push({ label, width, height })
    if (ratios.length >= 8) break
  }
  return ratios
}

function formatAspectRatioDraft(ratios: CheckpointPromptProfile['recommendedAspectRatios']): string {
  return (ratios ?? []).map((ratio) => `${ratio.label} ${ratio.width}x${ratio.height}`).join('\n')
}

function parseRelatedModelDraft(
  value: string,
  kind: NonNullable<CheckpointPromptProfile['relatedModels']>['loras'][number]['kind']
): NonNullable<CheckpointPromptProfile['relatedModels']>['loras'] {
  const out: NonNullable<CheckpointPromptProfile['relatedModels']>['loras'] = []
  const seen = new Set<string>()
  for (const raw of value.split(/\n+/)) {
    const line = raw.trim()
    if (!line) continue
    const parts = line.split('|').map((part) => part.trim())
    const name = parts[0]?.replace(/\s+/g, ' ').slice(0, 220)
    if (!name) continue
    const role = parts[1]?.replace(/\s+/g, ' ').slice(0, 80) || null
    const hasWeightColumn = parts.length >= 4 || (parts[2] != null && /^[-+]?\d/.test(parts[2]))
    const weightCandidate = hasWeightColumn && parts[2] !== '' ? Number(parts[2]) : null
    const weight = weightCandidate != null && Number.isFinite(weightCandidate)
      ? Math.max(-2, Math.min(2, Math.round(weightCandidate * 100) / 100))
      : null
    const noteStart = hasWeightColumn ? 3 : 2
    const notes = splitProfileNoteText(parts.slice(noteStart).join(' | ').replace(/;/g, '\n')).slice(0, 6)
    const key = `${kind}:${name.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ kind, name, role, weight, notes, path: null, sha256: null })
    if (out.length >= 24) break
  }
  return out
}

function formatRelatedModelDraft(
  items: NonNullable<CheckpointPromptProfile['relatedModels']>['loras'] | undefined
): string {
  return (items ?? []).map((item) => {
    const notes = (item.notes ?? []).join('; ')
    return [
      item.name,
      item.role ?? '',
      item.weight == null ? '' : String(item.weight),
      notes
    ].join(' | ').replace(/\s+\|/g, ' |').replace(/\|\s+$/g, '|')
  }).join('\n')
}

function splitProfileNoteText(value: string): string[] {
  const seen = new Set<string>()
  const notes: string[] = []
  for (const raw of value.split(/\n+/)) {
    const note = raw.trim().replace(/\s+/g, ' ')
    const key = note.toLowerCase()
    if (!note || seen.has(key)) continue
    seen.add(key)
    notes.push(note)
    if (notes.length >= 24) break
  }
  return notes
}

function modelPageUrl(entry: ModelLibraryEntry): string | null {
  return entry.sourceMeta?.pageUrl ?? entry.civitai?.url ?? null
}

function modelPreviewSrc(entry: ModelLibraryEntry): string | null {
  const local = entry.previewPath ?? entry.sourceMeta?.previewPath ?? null
  if (local) return pathToFileUrl(local)
  return entry.sourceMeta?.thumbnailUrl ?? null
}

function needsCivitaiInfo(entry: ModelLibraryEntry): boolean {
  if (entry.sourceMeta?.provider !== 'civitai') return true
  if (!entry.sourceMeta.modelId || !entry.sourceMeta.modelVersionId) return true
  if (isModelLibraryAdapterEntry(entry) && (entry.sourceMeta.trainedWords?.length ?? 0) === 0 && (entry.sourceMeta.recommendedPrompts?.length ?? 0) === 0) return true
  if (!entry.sourceMeta.description && !entry.notes) return true
  if (!entry.previewPath && !entry.sourceMeta.previewPath && !entry.sourceMeta.thumbnailUrl) return true
  return false
}

function pathToFileUrl(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const prefixed = normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`
  return encodeURI(prefixed)
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

function ModelAutoOrganizerCard(): JSX.Element {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState(false)
  const [plan, setPlan] = useState<ModelAutoOrganizePlan | ModelAutoOrganizeResult | null>(null)

  async function preview(): Promise<void> {
    if (busy || applying) return
    setBusy(true)
    try {
      const next = await api.tools.planModelAutoOrganize()
      setPlan(next)
      if (next.totals.movable === 0) {
        toast(tStatic('tools.autoOrganize.none'), { icon: 'i' })
      } else {
        toast(tStatic('tools.autoOrganize.previewDone', { count: next.totals.movable }), { icon: '!' })
      }
    } catch (e) {
      toast.error(tStatic('tools.autoOrganize.failed', { message: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  async function apply(): Promise<void> {
    if (busy || applying || !plan || plan.totals.movable === 0) return
    setApplying(true)
    try {
      const next = await api.tools.applyModelAutoOrganize()
      setPlan(next)
      await refreshModelListsAfterOrganize()
      if (next.moved.length === 0) {
        toast(tStatic('tools.autoOrganize.none'), { icon: 'i' })
      } else {
        toast.success(tStatic('tools.autoOrganize.done', { count: next.moved.length }))
      }
    } catch (e) {
      toast.error(tStatic('tools.autoOrganize.failed', { message: (e as Error).message }))
    } finally {
      setApplying(false)
    }
  }

  const visibleItems = plan?.items.slice(0, 60) ?? []

  return (
    <div className="card p-4 space-y-3" data-testid="model-auto-organizer-card">
      <div className="flex items-center gap-2">
        <Shuffle className="h-5 w-5 text-accent" />
        <h3 className="text-sm font-semibold text-ink-1">{t('tools.autoOrganize.title')}</h3>
      </div>
      <p className="text-xs text-ink-3 leading-relaxed">{t('tools.autoOrganize.body')}</p>
      <div className="flex flex-wrap gap-2">
        <button
          className="btn gap-1.5"
          onClick={() => { void preview() }}
          disabled={busy || applying}
          data-testid="model-auto-organize-preview"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />
          {busy ? t('tools.autoOrganize.scanning') : t('tools.autoOrganize.preview')}
        </button>
        <button
          className="btn gap-1.5"
          onClick={() => { void apply() }}
          disabled={busy || applying || !plan || plan.totals.movable === 0}
          data-testid="model-auto-organize-apply"
        >
          <Shuffle className={cn('h-3.5 w-3.5', applying && 'animate-pulse')} />
          {applying ? t('tools.autoOrganize.applying') : t('tools.autoOrganize.apply')}
        </button>
      </div>

      {plan && (
        <div className="border-t border-line pt-3 space-y-3 text-xs">
          <div className="font-mono text-[11px] text-ink-2 break-all">{plan.sourceDir}</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2" data-testid="model-auto-organize-summary">
            <Stat label={t('tools.autoOrganize.scanned')} value={String(plan.totals.scanned)} />
            <Stat label={t('tools.autoOrganize.movable')} value={`${plan.totals.movable} / ${formatBytes(plan.totals.movableBytes)}`} />
            <Stat label={t('tools.autoOrganize.kept')} value={String(plan.totals.kept)} />
            <Stat label={t('tools.autoOrganize.skipped')} value={String(plan.totals.skipped)} />
          </div>
          {isAutoOrganizeResult(plan) && plan.moved.length > 0 && (
            <div className="rounded-md border border-ok/30 bg-ok/10 p-2 text-ok">
              {t('tools.autoOrganize.movedSummary', { count: plan.moved.length })}
            </div>
          )}
          {visibleItems.length === 0 ? (
            <div className="text-xs text-ink-3">{t('tools.autoOrganize.empty')}</div>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto" data-testid="model-auto-organize-list">
              {visibleItems.map((item, index) => (
                <div key={item.source} className="rounded bg-bg-2/60 p-2" data-testid={`model-auto-organize-row-${index}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold shrink-0', autoOrganizeActionClass(item.action))}>
                      {t(`tools.autoOrganize.action.${item.action}`)}
                    </span>
                    <span className="font-mono text-[11px] text-ink-1 truncate">{item.filename}</span>
                    <span className="ml-auto font-mono text-[10px] text-ink-3 shrink-0">{formatBytes(item.sizeBytes)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-ink-3 min-w-0">
                    <span className="shrink-0">{autoOrganizeKindLabel(item.detectedKind, item.adapterSubtype)}</span>
                    {item.targetLabel && <span className="shrink-0">→ {item.targetLabel}</span>}
                    <span className="truncate">{item.reason}</span>
                  </div>
                  {item.dest && item.dest !== item.source && (
                    <div className="mt-1 font-mono text-[10px] text-ink-3 truncate">{item.dest}</div>
                  )}
                </div>
              ))}
            </div>
          )}
          {(plan.items.length > visibleItems.length) && (
            <div className="text-[10px] text-ink-3">
              {t('tools.autoOrganize.more', { count: plan.items.length - visibleItems.length })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

async function refreshModelListsAfterOrganize(): Promise<void> {
  const [models, loras, vaes] = await Promise.all([
    api.forge.listModels().catch(() => null),
    api.forge.listLoras().catch(() => null),
    api.forge.listVaes().catch(() => null)
  ])
  const store = useStore.getState()
  if (models) store.setModels(models)
  if (loras) store.setLoras(loras)
  if (vaes) store.setVaes(vaes)
}

function isAutoOrganizeResult(
  plan: ModelAutoOrganizePlan | ModelAutoOrganizeResult
): plan is ModelAutoOrganizeResult {
  return Array.isArray((plan as ModelAutoOrganizeResult).moved)
}

function autoOrganizeActionClass(action: ModelAutoOrganizePlan['items'][number]['action']): string {
  if (action === 'move') return 'bg-ok/20 text-ok'
  if (action === 'skip') return 'bg-warn/20 text-warn'
  return 'bg-bg-3 text-ink-2'
}

function autoOrganizeKindLabel(
  kind: ModelAutoOrganizePlan['items'][number]['detectedKind'],
  adapterSubtype?: ModelAutoOrganizePlan['items'][number]['adapterSubtype']
): string {
  if (kind === 'lora' && adapterSubtype) return `${kind} / ${adapterSubtype}`
  if (kind === 'checkpoint') return 'checkpoint'
  if (kind === 'text_encoder') return 'text encoder'
  if (kind === 'unsupported_diffusion') return 'unsupported diffusion'
  return kind
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

function isStaleDownloadJob(job: DownloadJob): boolean {
  return job.status === 'running' && Date.now() - job.updatedAt > STALE_DOWNLOAD_MS
}

function canResumeDownloadJob(job: DownloadJob): boolean {
  return job.status === 'failed' || job.status === 'canceled' || isStaleDownloadJob(job)
}

function canDiscardDownloadJob(job: DownloadJob): boolean {
  return job.status !== 'running' || isStaleDownloadJob(job)
}

function isOrphanPartialIssue(issue: LibraryIntegrityReport['issues'][number]): boolean {
  return isPartialIntegrityIssue(issue) && !issue.jobId
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
