import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Clapperboard, Download, FolderOpen, Gauge, Play, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/ipc'
import { useStore, type VideoGenerationState } from '@/lib/store'
import { useT, t as tStatic } from '@/lib/i18n'
import { buildGenerationPlan, buildImg2ImgRequest, generatedSeedFromInfo } from '@/lib/generation-utils'
import { getExtensionGuardIssues } from '@/lib/extension-guards'
import {
  buildAnimateDiffRequest,
  isExpectedVideoPayload,
  videoBase64FromDataUrl,
  videoDataUrlFromBase64
} from '@/lib/video-generation'
import { cn } from '@/lib/utils'
import { NumberField } from './NumberField'
import { CollapsiblePanel } from './CollapsiblePanel'
import { SelectField } from './extensions/controls'
import type {
  ForgeVideoSupportInfo,
  FramePackSupportInfo,
  SdModel,
  VideoRuntimeDiagnostics,
  VideoOutputFormat
} from '@shared/types'

const VIDEO_FORMATS: VideoOutputFormat[] = ['GIF', 'MP4', 'WEBP', 'WEBM']
const CLOSED_LOOP_OPTIONS = ['N', 'R-P', 'R+P', 'A'] as const

interface Props {
  variant?: 'collapsible' | 'workspace'
}

export function VideoGenerationPanel({ variant = 'collapsible' }: Props): JSX.Element {
  const t = useT()
  const video = useStore((s) => s.video)
  const patchVideo = useStore((s) => s.patchVideo)
  const isGenerating = useStore((s) => s.isGenerating)
  const forgeStatus = useStore((s) => s.forgeStatus)
  const hasInputImage = useStore((s) => Boolean(s.inputImage))
  const params = useStore((s) => s.params)
  const selectedModelTitle = useStore((s) => s.selectedModelTitle)
  const models = useStore((s) => s.models)
  const setSettings = useStore((s) => s.setSettings)
  const [support, setSupport] = useState<ForgeVideoSupportInfo | null>(null)
  const [supportLoading, setSupportLoading] = useState(false)
  const [runtime, setRuntime] = useState<VideoRuntimeDiagnostics | null>(null)
  const [runtimeLoading, setRuntimeLoading] = useState(false)
  const [framePack, setFramePack] = useState<FramePackSupportInfo | null>(null)
  const [framePackLoading, setFramePackLoading] = useState(false)

  async function refreshSupport(): Promise<void> {
    setSupportLoading(true)
    try {
      const info = await api.forge.inspectVideoSupport()
      setSupport(info)
      if (!useStore.getState().video.motionModule && info.motionModules.length > 0) {
        useStore.getState().patchVideo({ motionModule: info.motionModules[0].name })
      }
    } catch (e) {
      toast.error(tStatic('video.supportFailed', { message: (e as Error).message }))
    } finally {
      setSupportLoading(false)
    }
  }

  async function restartForgeForVideo(): Promise<void> {
    setSupportLoading(true)
    try {
      await api.forge.stop()
      await api.forge.start()
      toast.success(tStatic('video.restartStarted'))
    } catch (e) {
      toast.error(tStatic('video.restartFailed', { message: (e as Error).message }))
    } finally {
      setSupportLoading(false)
    }
  }

  async function refreshRuntime(): Promise<void> {
    setRuntimeLoading(true)
    try {
      setRuntime(await api.forge.inspectVideoRuntime())
    } catch (e) {
      toast.error(tStatic('video.runtimeFailed', { message: (e as Error).message }))
    } finally {
      setRuntimeLoading(false)
    }
  }

  async function refreshFramePack(): Promise<void> {
    setFramePackLoading(true)
    try {
      setFramePack(await api.videoBackends.inspectFramePack())
    } catch (e) {
      toast.error(tStatic('video.framePackInspectFailed', { message: (e as Error).message }))
    } finally {
      setFramePackLoading(false)
    }
  }

  async function selectFramePackFolder(): Promise<void> {
    const dir = await api.app.selectDirectory()
    if (!dir) return
    setFramePackLoading(true)
    try {
      const current = await api.storage.getSettings()
      const next = { ...current, framePackPath: dir }
      await api.storage.setSettings(next)
      setSettings(next)
      setFramePack(await api.videoBackends.inspectFramePack())
      toast.success(tStatic('video.framePackSaved'))
    } catch (e) {
      toast.error(tStatic('video.framePackSaveFailed', { message: (e as Error).message }))
    } finally {
      setFramePackLoading(false)
    }
  }

  async function startFramePack(): Promise<void> {
    setFramePackLoading(true)
    try {
      setFramePack(await api.videoBackends.startFramePack())
      toast.success(tStatic('video.framePackStarted'))
    } catch (e) {
      toast.error(tStatic('video.framePackStartFailed', { message: (e as Error).message }))
    } finally {
      setFramePackLoading(false)
    }
  }

  async function openFramePackFolder(): Promise<void> {
    try {
      await api.videoBackends.openFramePackFolder()
    } catch (e) {
      toast.error(tStatic('video.framePackOpenFailed', { message: (e as Error).message }))
    }
  }

  async function importLatestFramePackOutput(): Promise<void> {
    setFramePackLoading(true)
    try {
      const imported = await api.videoBackends.importLatestFramePackOutput()
      const dataUrl = videoDataUrlFromBase64(imported.base64, imported.format)
      useStore.getState().patchVideo({
        enabled: true,
        lastResult: {
          dataUrl,
          filePath: imported.saved.filePath,
          format: imported.saved.format,
          sizeBytes: imported.saved.sizeBytes,
          createdAt: imported.saved.createdAt
        }
      })
      toast.success(tStatic('video.framePackImported'))
    } catch (e) {
      toast.error(tStatic('video.framePackImportFailed', { message: (e as Error).message }))
    } finally {
      setFramePackLoading(false)
    }
  }

  useEffect(() => {
    void refreshSupport()
    void refreshRuntime()
    void refreshFramePack()
  }, [])

  const motionModules = support?.motionModules ?? []
  function supportBlocker(info: ForgeVideoSupportInfo | null, motionModule = video.motionModule): string | null {
    if (forgeStatus.kind !== 'ready') return t('video.blockerForge')
    if (!video.enabled) return t('video.blockerEnabled')
    if (!info?.extension.installed) return t('video.blockerExtension')
    if (!info.extension.enabled) return t('video.blockerExtensionDisabled')
    if (info.apiScript.checked && !info.apiScript.available) return t('video.blockerScriptMissing')
    if (info.motionModules.length === 0) return t('video.blockerModule')
    if (!motionModule) return t('video.blockerModule')
    if (video.sourceMode === 'img2img' && !hasInputImage) return t('video.blockerInput')
    return null
  }

  const blocker = useMemo(() => {
    return supportBlocker(support)
  }, [forgeStatus.kind, hasInputImage, motionModules.length, support, t, video.enabled, video.motionModule, video.sourceMode])
  const selectedModel = useMemo(
    () => models.find((model) => model.title === selectedModelTitle) ?? null,
    [models, selectedModelTitle]
  )
  const readinessWarnings = useMemo(() => buildVideoReadinessWarnings({
    video,
    runtime,
    selectedModel,
    width: params.width,
    height: params.height,
    t
  }), [params.height, params.width, runtime, selectedModel, t, video])
  const canGenerateVideo = !isGenerating && blocker === null

  async function generateVideo(): Promise<void> {
    if (!canGenerateVideo) {
      if (blocker) toast(blocker, { icon: '!' })
      return
    }

    const s = useStore.getState()
    const liveSupport = await api.forge.inspectVideoSupport()
    setSupport(liveSupport)
    const activeMotionModule = s.video.motionModule || liveSupport.motionModules[0]?.name || ''
    if (!s.video.motionModule && activeMotionModule) {
      useStore.getState().patchVideo({ motionModule: activeMotionModule })
    }
    const liveBlocker = supportBlocker(liveSupport, activeMotionModule)
    if (liveBlocker) {
      toast(liveBlocker, { icon: '!' })
      return
    }

    const guardIssue = getExtensionGuardIssues(s)[0]
    if (guardIssue) {
      toast.error(tStatic(guardIssue.messageKey, guardIssue.params))
      return
    }
    const endpoint = s.video.sourceMode
    const plan = buildGenerationPlan(s, {
      endpoint,
      params: { batchSize: 1, iterations: 1 }
    })
    if (!plan) {
      toast.error(tStatic('video.needsCheckpoint'))
      return
    }
    const dynamicBlocker = plan.dynamicPromptIssues.find((issue) => issue.severity === 'error')
    if (dynamicBlocker) {
      toast.error(tStatic('dynamicPrompt.blocked', { message: dynamicBlocker.message }))
      return
    }

    useStore.getState().setGenerating(true)
    useStore.getState().setProgress(null)
    try {
      const activeVideo = useStore.getState().video
      const res = endpoint === 'img2img'
        ? await runImg2Video(plan, activeVideo)
        : await api.forge.txt2img(buildAnimateDiffRequest(plan.baseReq, activeVideo))
      const rawVideo = res.images[0]
      if (!rawVideo) throw new Error(tStatic('video.emptyResult'))
      if (!isExpectedVideoPayload(rawVideo, activeVideo.format)) {
        throw new Error(tStatic('video.invalidResult'))
      }

      const dataUrl = videoDataUrlFromBase64(rawVideo, activeVideo.format)
      const actualSeed = generatedSeedFromInfo(res.info, 0, plan.params.seed)
      const saved = await api.storage.saveGeneratedVideo({
        base64: videoBase64FromDataUrl(dataUrl),
        format: activeVideo.format,
        prompt: plan.finalPrompt,
        negativePrompt: plan.baseReq.negative_prompt,
        model: plan.model,
        motionModule: activeVideo.motionModule,
        width: plan.params.width,
        height: plan.params.height,
        frames: activeVideo.frames,
        fps: activeVideo.fps,
        seed: actualSeed
      })
      useStore.getState().patchVideo({
        enabled: true,
        lastResult: {
          dataUrl,
          filePath: saved.filePath,
          format: saved.format,
          sizeBytes: saved.sizeBytes,
          createdAt: saved.createdAt
        }
      })
      toast.success(tStatic('video.generated'))
    } catch (e) {
      toast.error(tStatic('video.generateFailed', { message: (e as Error).message }))
    } finally {
      useStore.getState().setGenerating(false)
      useStore.getState().setProgress(null)
    }
  }

  async function openResultFolder(): Promise<void> {
    const path = useStore.getState().video.lastResult?.filePath
    if (!path) return
    try {
      await api.app.showItemInFolder(path)
    } catch (e) {
      toast.error(tStatic('video.openFolderFailed', { message: (e as Error).message }))
    }
  }

  async function openMotionModuleFolder(): Promise<void> {
    try {
      await api.forge.openVideoModelFolder()
    } catch (e) {
      toast.error(tStatic('video.openMotionFolderFailed', { message: (e as Error).message }))
    }
  }

  const content = (
    <div className="space-y-2">
        <div className="grid grid-cols-2 gap-1 rounded border border-line bg-bg-1 p-1" data-testid="video-source-mode">
          {(['txt2img', 'img2img'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={cn(
                'rounded px-2 py-1 text-xs transition-colors',
                video.sourceMode === mode
                  ? 'bg-accent text-bg-0'
                  : 'text-ink-2 hover:bg-bg-3'
              )}
              onClick={() => patchVideo({ sourceMode: mode })}
            >
              {t(mode === 'txt2img' ? 'video.sourceTxt' : 'video.sourceImg')}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 rounded border border-line bg-bg-1 px-2 py-1.5 text-[11px] text-ink-2">
          <SupportIcon ok={blocker === null} />
          <span className="min-w-0 flex-1 truncate">
            {blocker ?? t('video.supportReady')}
          </span>
          <button
            type="button"
            className="btn btn-ghost px-1.5 py-0.5 text-[10px]"
            onClick={refreshSupport}
            disabled={supportLoading}
            title={t('video.refreshSupport')}
          >
            <RefreshCw className={cn('h-3 w-3', supportLoading && 'animate-spin')} />
            {t('common.refresh')}
          </button>
        </div>

        {support?.warnings.map((warning) => (
          <div key={warning} className="flex items-center gap-2 rounded border border-warn/40 bg-warn/10 px-2 py-1 text-[10px] text-warn">
            <span className="min-w-0 flex-1">{supportWarningText(warning, t)}</span>
            {warning === 'script-missing' && (
              <button
                type="button"
                className="btn btn-ghost shrink-0 px-1.5 py-0.5 text-[10px]"
                onClick={restartForgeForVideo}
                disabled={supportLoading}
                data-testid="video-restart-forge"
              >
                {t('video.restartForge')}
              </button>
            )}
          </div>
        ))}

        <RuntimeDiagnosticsCard
          runtime={runtime}
          loading={runtimeLoading}
          onRefresh={refreshRuntime}
        />

        <FramePackBackendCard
          info={framePack}
          loading={framePackLoading}
          onRefresh={refreshFramePack}
          onSelect={selectFramePackFolder}
          onStart={startFramePack}
          onOpen={openFramePackFolder}
          onImportLatest={importLatestFramePackOutput}
        />

        {readinessWarnings.map((warning) => (
          <div key={warning} className="flex items-center gap-2 rounded border border-warn/40 bg-warn/10 px-2 py-1 text-[10px] text-warn" data-testid="video-readiness-warning">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">{warning}</span>
          </div>
        ))}

        <SelectField
          label={t('video.motionModule')}
          value={video.motionModule}
          options={motionModules.length > 0 ? motionModules.map((m) => m.name) : ['']}
          onChange={(motionModule) => patchVideo({ motionModule })}
        />
        {support?.modelDir && (
          <div className="flex items-center gap-2 rounded border border-line bg-bg-1 px-2 py-1">
            <div className="min-w-0 flex-1 truncate text-[10px] text-ink-3" title={support.modelDir}>
              {t('video.modelDir')}: {support.modelDir}
            </div>
            <button
              type="button"
              className="btn btn-icon btn-ghost h-7 w-7"
              onClick={openMotionModuleFolder}
              title={t('video.openMotionFolder')}
              data-testid="video-open-motion-folder"
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <SelectField
            label={t('video.format')}
            value={video.format}
            options={VIDEO_FORMATS}
            onChange={(format) => patchVideo({ format: format as VideoOutputFormat })}
          />
          <SelectField
            label={t('video.closedLoop')}
            value={video.closedLoop}
            options={CLOSED_LOOP_OPTIONS}
            onChange={(closedLoop) => patchVideo({ closedLoop: closedLoop as typeof CLOSED_LOOP_OPTIONS[number] })}
          />
          <NumberField label={t('video.frames')} value={video.frames} min={1} max={96} onChange={(frames) => patchVideo({ frames })} />
          <NumberField label={t('video.fps')} value={video.fps} min={1} max={60} onChange={(fps) => patchVideo({ fps })} />
          <NumberField label={t('video.contextBatch')} value={video.contextBatchSize} min={1} max={32} onChange={(contextBatchSize) => patchVideo({ contextBatchSize })} />
          <NumberField label={t('video.loopNumber')} value={video.loopNumber} min={0} max={20} onChange={(loopNumber) => patchVideo({ loopNumber })} />
          <NumberField label={t('video.stride')} value={video.stride} min={1} max={32} onChange={(stride) => patchVideo({ stride })} />
          <NumberField label={t('video.overlap')} value={video.overlap} min={-1} max={32} onChange={(overlap) => patchVideo({ overlap })} />
        </div>

        <button
          type="button"
          className="btn btn-primary w-full"
          onClick={generateVideo}
          disabled={!canGenerateVideo}
          title={blocker ?? undefined}
          data-testid="video-generate-button"
        >
          <Play className="h-4 w-4" />
          {isGenerating ? t('video.generating') : t('video.generate')}
        </button>

        {video.lastResult && (
          <div className="space-y-2 rounded border border-line bg-bg-1 p-2" data-testid="video-result">
            <div className="flex items-center gap-2 text-[11px] text-ink-2">
              <Clapperboard className="h-3.5 w-3.5 text-accent" />
              <span className="font-semibold text-ink-1">{t('video.resultTitle')}</span>
              <span className="ml-auto font-mono text-[10px] text-ink-3">
                {video.lastResult.format} · {formatBytes(video.lastResult.sizeBytes)}
              </span>
            </div>
            {video.lastResult.format === 'MP4' || video.lastResult.format === 'WEBM' ? (
              <video src={video.lastResult.dataUrl} controls loop muted className="w-full rounded border border-line bg-bg-0" />
            ) : (
              <img src={video.lastResult.dataUrl} alt="" className="w-full rounded border border-line bg-bg-0" />
            )}
            <button type="button" className="btn w-full text-xs" onClick={openResultFolder}>
              <FolderOpen className="h-3.5 w-3.5" />
              {t('video.openFolder')}
            </button>
          </div>
        )}
      </div>
  )

  if (variant === 'workspace') {
    return (
      <section className="card p-4 space-y-3" data-testid="video-generation-panel">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-ink-1">{t('video.title')}</h2>
            <p className="text-xs text-ink-3">{t('video.hint')}</p>
          </div>
          <button
            type="button"
            className={cn(
              'inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors',
              video.enabled ? 'bg-accent' : 'bg-bg-3 border border-line'
            )}
            onClick={() => patchVideo({ enabled: !video.enabled })}
            role="switch"
            aria-checked={video.enabled}
            data-testid="video-enable-switch"
          >
            <span className={cn(
              'block h-5 w-5 rounded-full bg-bg-0 shadow transition-transform',
              video.enabled ? 'translate-x-5' : 'translate-x-0'
            )} />
          </button>
        </div>
        <div data-testid="video-generation-body">
          {content}
        </div>
      </section>
    )
  }

  return (
    <CollapsiblePanel
      title={t('video.title')}
      hint={t('video.hint')}
      enabled={video.enabled}
      onEnabledChange={(enabled) => patchVideo({ enabled })}
      testId="video-generation-panel"
      buttonTestId="video-generation-toggle"
      bodyTestId="video-generation-body"
    >
      {content}
    </CollapsiblePanel>
  )
}

async function runImg2Video(
  plan: NonNullable<ReturnType<typeof buildGenerationPlan>>,
  video: VideoGenerationState
) {
  const s = useStore.getState()
  if (!s.inputImage) throw new Error(tStatic('video.blockerInput'))
  const req = buildImg2ImgRequest(plan, s.inputImage, plan.params.denoisingStrength, s.inpaintMaskImage)
  return api.forge.img2img(buildAnimateDiffRequest(req, video))
}

function SupportIcon({ ok }: { ok: boolean }): JSX.Element {
  return ok
    ? <Clapperboard className="h-3.5 w-3.5 shrink-0 text-accent" />
    : <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warn" />
}

function RuntimeDiagnosticsCard({
  runtime,
  loading,
  onRefresh
}: {
  runtime: VideoRuntimeDiagnostics | null
  loading: boolean
  onRefresh(): void
}): JSX.Element {
  const t = useT()
  const gpu = runtime?.gpus[0] ?? null
  return (
    <div className="rounded border border-line bg-bg-1 p-2" data-testid="video-runtime-diagnostics">
      <div className="mb-2 flex items-center gap-2">
        <Gauge className="h-3.5 w-3.5 text-accent" />
        <span className="text-[11px] font-semibold text-ink-1">{t('video.runtimeTitle')}</span>
        <button
          type="button"
          className="btn btn-ghost ml-auto px-1.5 py-0.5 text-[10px]"
          onClick={onRefresh}
          disabled={loading}
          title={t('video.runtimeRefresh')}
          data-testid="video-runtime-refresh"
        >
          <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
          {t('common.refresh')}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1.5 text-[10px]">
        <RuntimeStat label={t('video.runtimeGpu')} value={gpu?.name ?? '-'} />
        <RuntimeStat
          label={t('video.runtimeVram')}
          value={gpu
            ? `${formatMiB(gpu.memoryFreeMiB)} / ${formatMiB(gpu.memoryTotalMiB)}`
            : '-'}
          tone={gpu?.memoryFreeMiB != null && gpu.memoryFreeMiB < 6144 ? 'warn' : 'normal'}
        />
        <RuntimeStat label={t('video.runtimeRam')} value={formatBytes(runtime?.systemMemoryTotalBytes ?? 0)} />
        <RuntimeStat label={t('video.runtimeDisk')} value={formatBytes(runtime?.dataRootFreeBytes ?? 0)} />
      </div>
      {runtime?.warnings.map((warning) => (
        <div key={warning} className="mt-1 text-[10px] text-warn">
          {runtimeWarningText(warning, t)}
        </div>
      ))}
    </div>
  )
}

function RuntimeStat({
  label,
  value,
  tone = 'normal'
}: {
  label: string
  value: string
  tone?: 'normal' | 'warn'
}): JSX.Element {
  return (
    <div className="min-w-0 rounded border border-line bg-bg-0 px-2 py-1">
      <div className="truncate text-ink-3">{label}</div>
      <div className={cn('truncate font-mono text-ink-1', tone === 'warn' && 'text-warn')} title={value}>
        {value}
      </div>
    </div>
  )
}

function FramePackBackendCard({
  info,
  loading,
  onRefresh,
  onSelect,
  onStart,
  onOpen,
  onImportLatest
}: {
  info: FramePackSupportInfo | null
  loading: boolean
  onRefresh(): void
  onSelect(): void
  onStart(): void
  onOpen(): void
  onImportLatest(): void
}): JSX.Element {
  const t = useT()
  const ready = Boolean(info?.canLaunch)
  return (
    <div className="rounded border border-line bg-bg-1 p-2" data-testid="video-framepack-panel">
      <div className="mb-2 flex items-center gap-2">
        <Clapperboard className={cn('h-3.5 w-3.5', ready ? 'text-accent' : 'text-ink-3')} />
        <span className="text-[11px] font-semibold text-ink-1">{t('video.framePackTitle')}</span>
        <span className={cn('ml-auto text-[10px]', ready ? 'text-accent' : 'text-ink-3')}>
          {ready ? t('video.framePackReady') : t('video.framePackNotReady')}
        </span>
      </div>
      <div className="mb-2 truncate rounded border border-line bg-bg-0 px-2 py-1 font-mono text-[10px] text-ink-3" title={info?.configuredPath ?? ''}>
        {info?.configuredPath ?? t('video.framePackPathUnset')}
      </div>
      {info?.warnings.map((warning) => (
        <div key={warning} className="mb-1 text-[10px] text-warn">
          {framePackWarningText(warning, t)}
        </div>
      ))}
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          className="btn btn-ghost justify-center px-1.5 py-1 text-[10px]"
          onClick={onSelect}
          disabled={loading}
          data-testid="video-framepack-select"
        >
          <FolderOpen className="h-3 w-3" />
          {t('common.select')}
        </button>
        <button
          type="button"
          className="btn btn-ghost justify-center px-1.5 py-1 text-[10px]"
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
          {t('common.refresh')}
        </button>
        <button
          type="button"
          className="btn btn-ghost justify-center px-1.5 py-1 text-[10px]"
          onClick={onOpen}
          disabled={loading || !info?.configuredPath}
        >
          <FolderOpen className="h-3 w-3" />
          {t('video.framePackOpen')}
        </button>
        <button
          type="button"
          className="btn btn-ghost justify-center px-1.5 py-1 text-[10px]"
          onClick={onImportLatest}
          disabled={loading || !info?.configuredPath}
          data-testid="video-framepack-import"
        >
          <Download className="h-3 w-3" />
          {t('video.framePackImport')}
        </button>
      </div>
      <button
        type="button"
        className="btn mt-1.5 w-full justify-center text-xs"
        onClick={onStart}
        disabled={loading || !info?.canLaunch}
        data-testid="video-framepack-start"
      >
        <Play className="h-3.5 w-3.5" />
        {t('video.framePackStart')}
      </button>
    </div>
  )
}

function supportWarningText(warning: string, t: ReturnType<typeof useT>): string {
  if (warning === 'extension-missing') return t('video.warningExtensionMissing')
  if (warning === 'extension-disabled') return t('video.warningExtensionDisabled')
  if (warning === 'script-missing') return t('video.warningScriptMissing')
  if (warning === 'motion-module-missing') return t('video.warningMotionModuleMissing')
  return warning
}

function framePackWarningText(warning: string, t: ReturnType<typeof useT>): string {
  if (warning === 'framepack-path-missing') return t('video.framePackWarningPath')
  if (warning === 'framepack-run-missing') return t('video.framePackWarningRun')
  return warning
}

function runtimeWarningText(warning: string, t: ReturnType<typeof useT>): string {
  if (warning === 'nvidia-smi-unavailable') return t('video.runtimeWarningNvidiaSmi')
  if (warning === 'gpu-unavailable') return t('video.runtimeWarningGpu')
  if (warning === 'disk-free-unavailable') return t('video.runtimeWarningDisk')
  return warning
}

function buildVideoReadinessWarnings({
  video,
  runtime,
  selectedModel,
  width,
  height,
  t
}: {
  video: VideoGenerationState
  runtime: VideoRuntimeDiagnostics | null
  selectedModel: SdModel | null
  width: number
  height: number
  t: ReturnType<typeof useT>
}): string[] {
  const warnings: string[] = []
  const gpu = runtime?.gpus[0] ?? null
  if (gpu?.memoryFreeMiB != null && gpu.memoryFreeMiB < 6144) {
    warnings.push(t('video.warningLowFreeVram', { free: formatMiB(gpu.memoryFreeMiB) }))
  }
  if (video.contextBatchSize > 4) {
    warnings.push(t('video.warningHighContextBatch', { batch: video.contextBatchSize }))
  }
  if (video.frames > 16) {
    warnings.push(t('video.warningHighFrameCount', { frames: video.frames }))
  }
  if (width * height >= 768 * 768 || video.frames > 16) {
    const mp = ((width * height * video.frames) / 1_000_000).toFixed(1)
    if (width > 768 || height > 768 || video.frames > 24) {
      warnings.push(t('video.warningLargeVideoWorkload', { width, height, frames: video.frames, mp }))
    }
  }
  const checkpointFamily = inferCheckpointFamily(selectedModel)
  const motionFamily = inferMotionModuleFamily(video.motionModule)
  if (checkpointFamily === 'sdxl' && motionFamily === 'sd15') {
    warnings.push(t('video.warningSdxlWithSd15Module'))
  }
  if (checkpointFamily === 'sd15' && motionFamily === 'sdxl') {
    warnings.push(t('video.warningSd15WithSdxlModule'))
  }
  return Array.from(new Set(warnings))
}

function inferCheckpointFamily(model: SdModel | null): 'sd15' | 'sdxl' | 'unknown' {
  if (!model) return 'unknown'
  const text = `${model.title} ${model.modelName} ${model.filename}`.toLowerCase()
  if (/\b(sd|stable)[-_ ]?xl\b/.test(text) || text.includes('pony') || text.includes('illustrious')) {
    return 'sdxl'
  }
  if (/\bsd[-_ ]?1[._-]?5\b/.test(text) || text.includes('sd15') || text.includes('v1-5')) {
    return 'sd15'
  }
  return 'unknown'
}

function inferMotionModuleFamily(name: string): 'sd15' | 'sdxl' | 'unknown' {
  const text = name.toLowerCase()
  if (!text) return 'unknown'
  if (text.includes('sdxl') || /\bxl\b/.test(text)) return 'sdxl'
  if (text.includes('sd15') || text.includes('sd_15') || text.includes('v15') || text.includes('1.5')) return 'sd15'
  return 'unknown'
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

function formatMiB(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '-'
  if (value >= 1024) return `${(value / 1024).toFixed(1)} GB`
  return `${Math.round(value)} MB`
}
