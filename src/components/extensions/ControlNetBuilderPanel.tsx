import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, BoxSelect, CheckCircle2, Clock3, Crosshair, Layers3, Play, Plus, ScanLine, Search, Sparkles, Upload, Wand2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore, type ControlNetUnitState } from '@/lib/store'
import { useT, t as tStatic } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { api } from '@/lib/ipc'
import { hasActiveFabricFeedback } from '@/lib/extension-guards'
import { CollapsiblePanel } from '../CollapsiblePanel'

type BuilderRole = 'pose' | 'lineart' | 'canny' | 'softedge' | 'scribble' | 'depth' | 'normal' | 'seg' | 'tile' | 'reference'

interface RolePreset {
  id: BuilderRole
  icon: JSX.Element
  moduleCandidates: string[]
  modelKeywords: string[]
  preferredModelKeywordGroups?: string[][]
  fallbackModel: string
  weight: number
  controlMode: 0 | 1 | 2
  hintKey: string
}

interface ControlNetModelHint {
  roles: BuilderRole[]
  keywordGroups: string[][]
  label: string
  sourceUrl: string
}

const ROLE_PRESETS: RolePreset[] = [
  {
    id: 'pose',
    icon: <Crosshair className="h-3.5 w-3.5" />,
    moduleCandidates: ['openpose_full', 'openpose', 'dw_openpose_full', 'dw_openpose'],
    modelKeywords: ['openpose', 'pose'],
    preferredModelKeywordGroups: [['xinsir', 'openpose'], ['openpose', 'sdxl']],
    fallbackModel: 'None',
    weight: 1,
    controlMode: 2,
    hintKey: 'cnBuilder.role.pose.hint'
  },
  {
    id: 'lineart',
    icon: <ScanLine className="h-3.5 w-3.5" />,
    moduleCandidates: ['lineart_anime', 'lineart_realistic', 'lineart_standard'],
    modelKeywords: ['lineart'],
    preferredModelKeywordGroups: [['mistoline'], ['lineart']],
    fallbackModel: 'None',
    weight: 0.8,
    controlMode: 1,
    hintKey: 'cnBuilder.role.lineart.hint'
  },
  {
    id: 'canny',
    icon: <ScanLine className="h-3.5 w-3.5" />,
    moduleCandidates: ['canny'],
    modelKeywords: ['canny'],
    preferredModelKeywordGroups: [['xinsir', 'canny'], ['canny', 'sdxl']],
    fallbackModel: 'None',
    weight: 0.75,
    controlMode: 1,
    hintKey: 'cnBuilder.role.canny.hint'
  },
  {
    id: 'softedge',
    icon: <ScanLine className="h-3.5 w-3.5" />,
    moduleCandidates: ['softedge_hed', 'softedge_hedsafe', 'softedge_pidinet', 'softedge_pidisafe'],
    modelKeywords: ['softedge', 'hed'],
    fallbackModel: 'None',
    weight: 0.75,
    controlMode: 1,
    hintKey: 'cnBuilder.role.softedge.hint'
  },
  {
    id: 'scribble',
    icon: <Wand2 className="h-3.5 w-3.5" />,
    moduleCandidates: ['scribble_hed', 'scribble_pidinet', 'scribble_xdog'],
    modelKeywords: ['scribble'],
    fallbackModel: 'None',
    weight: 0.9,
    controlMode: 2,
    hintKey: 'cnBuilder.role.scribble.hint'
  },
  {
    id: 'depth',
    icon: <Layers3 className="h-3.5 w-3.5" />,
    moduleCandidates: ['depth_midas', 'depth_anything', 'depth_zoe'],
    modelKeywords: ['depth'],
    preferredModelKeywordGroups: [['xinsir', 'depth'], ['depth', 'sdxl']],
    fallbackModel: 'None',
    weight: 0.75,
    controlMode: 1,
    hintKey: 'cnBuilder.role.depth.hint'
  },
  {
    id: 'normal',
    icon: <Layers3 className="h-3.5 w-3.5" />,
    moduleCandidates: ['normal_bae'],
    modelKeywords: ['normal'],
    fallbackModel: 'None',
    weight: 0.7,
    controlMode: 1,
    hintKey: 'cnBuilder.role.normal.hint'
  },
  {
    id: 'seg',
    icon: <Layers3 className="h-3.5 w-3.5" />,
    moduleCandidates: ['seg_ofade20k', 'seg_ufade20k', 'seg_anime_face'],
    modelKeywords: ['seg', 'segmentation'],
    fallbackModel: 'None',
    weight: 0.8,
    controlMode: 1,
    hintKey: 'cnBuilder.role.seg.hint'
  },
  {
    id: 'tile',
    icon: <BoxSelect className="h-3.5 w-3.5" />,
    moduleCandidates: ['tile_resample', 'tile_colorfix', 'None'],
    modelKeywords: ['tile'],
    preferredModelKeywordGroups: [['xinsir', 'tile'], ['tile', 'sdxl']],
    fallbackModel: 'None',
    weight: 0.6,
    controlMode: 2,
    hintKey: 'cnBuilder.role.tile.hint'
  },
  {
    id: 'reference',
    icon: <Sparkles className="h-3.5 w-3.5" />,
    moduleCandidates: ['reference_only', 'reference_adain', 'reference_adain+attn', 'None'],
    modelKeywords: ['reference'],
    fallbackModel: 'None',
    weight: 0.65,
    controlMode: 1,
    hintKey: 'cnBuilder.role.reference.hint'
  }
]

const CONTROLNET_MODEL_HINTS: ControlNetModelHint[] = [
  {
    roles: ['pose'],
    keywordGroups: [['xinsir', 'openpose'], ['openpose', 'sdxl']],
    label: 'xinsir OpenPose SDXL',
    sourceUrl: 'https://huggingface.co/xinsir/controlnet-openpose-sdxl-1.0'
  },
  {
    roles: ['depth'],
    keywordGroups: [['xinsir', 'depth'], ['depth', 'sdxl']],
    label: 'xinsir Depth SDXL',
    sourceUrl: 'https://huggingface.co/xinsir/controlnet-depth-sdxl-1.0'
  },
  {
    roles: ['lineart'],
    keywordGroups: [['mistoline'], ['lineart', 'rank256']],
    label: 'MistoLine rank256',
    sourceUrl: 'https://huggingface.co/TheMistoAI/MistoLine'
  },
  {
    roles: ['tile'],
    keywordGroups: [['xinsir', 'tile'], ['tile', 'sdxl']],
    label: 'xinsir Tile SDXL',
    sourceUrl: 'https://huggingface.co/xinsir/controlnet-tile-sdxl-1.0'
  },
  {
    roles: ['canny'],
    keywordGroups: [['xinsir', 'canny'], ['canny', 'sdxl']],
    label: 'xinsir Canny SDXL',
    sourceUrl: 'https://huggingface.co/xinsir/controlnet-canny-sdxl-1.0'
  }
]

const DETECT_PROCESSOR_RES = 512

interface DetectionResult {
  image: string
  module: string
}

export function ControlNetBuilderPanel(): JSX.Element {
  const controlnet = useStore((s) => s.controlnet)
  const fabricFeedbackActive = useStore(hasActiveFabricFeedback)
  const status = useStore((s) => s.forgeStatus)
  const modules = useStore((s) => s.controlnetModuleList)
  const models = useStore((s) => s.controlnetModelList)
  const setControlnetCatalogs = useStore((s) => s.setControlnetCatalogs)
  const patchControlnet = useStore((s) => s.patchControlnet)
  const patchUnit = useStore((s) => s.patchControlnetUnit)
  const addUnit = useStore((s) => s.addControlnetUnit)
  const openCivitaiSearch = useStore((s) => s.openCivitaiSearch)
  const t = useT()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [selectedRole, setSelectedRole] = useState<BuilderRole>('pose')
  const [sourceImage, setSourceImage] = useState<string | null>(null)
  const [sourceFilename, setSourceFilename] = useState<string | null>(null)
  const [sourcePath, setSourcePath] = useState<string | null>(null)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [previewModule, setPreviewModule] = useState<string | null>(null)
  const [targetUnitIndex, setTargetUnitIndex] = useState(0)
  const [detecting, setDetecting] = useState(false)
  const [detectStartedAt, setDetectStartedAt] = useState<number | null>(null)
  const [detectNow, setDetectNow] = useState(Date.now())

  useEffect(() => {
    if (status.kind !== 'ready') return
    if (models.length > 0 && modules.length > 0) return
    let cancelled = false
    ;(async () => {
      const [nextModels, nextModules] = await Promise.all([
        fetchOptionalCatalog(() => api.forge.listControlnetModels(), [] as string[]),
        fetchOptionalCatalog(() => api.forge.listControlnetModules(), [] as string[])
      ])
      if (!cancelled) setControlnetCatalogs(nextModels, nextModules)
    })().catch(() => undefined)
    return () => { cancelled = true }
  }, [status.kind, models.length, modules.length, setControlnetCatalogs])

  useEffect(() => {
    if (!detecting || !detectStartedAt) return
    setDetectNow(Date.now())
    const interval = window.setInterval(() => setDetectNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [detecting, detectStartedAt])

  useEffect(() => {
    if (targetUnitIndex < controlnet.units.length) return
    setTargetUnitIndex(Math.max(0, controlnet.units.length - 1))
  }, [controlnet.units.length, targetUnitIndex])

  function applyPreset(preset: RolePreset): void {
    if (preset.id === 'reference' && fabricFeedbackActive) {
      toast.error(tStatic('guard.fabricControlnetReference'))
      return
    }
    setSelectedRole(preset.id)
    const resolved = resolvePreset(preset, modules, models)
    const unitPatch: Partial<ControlNetUnitState> = {
      enabled: true,
      module: resolved.module,
      model: resolved.model,
      weight: preset.weight,
      controlMode: preset.controlMode,
      pixelPerfect: true,
      processorRes: -1,
      thresholdA: -1,
      thresholdB: -1,
      resizeMode: preset.id === 'pose' ? 1 : 0,
      guidanceStart: 0,
      guidanceEnd: 1
    }
    patchControlnet({ enabled: true })
    patchUnit(targetUnitIndex, unitPatch)
    if (resolved.modelMissing) {
      toast(tStatic('cnBuilder.modelMissing'), { icon: '!' })
    } else {
      toast.success(tStatic('cnBuilder.appliedToUnit', {
        role: tStatic(`cnBuilder.role.${preset.id}`),
        unit: targetUnitIndex + 1
      }))
    }
  }

  function loadFile(file: File): void {
    if (!file.type.startsWith('image/')) {
      toast.error(tStatic('cn.notAnImage'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setSourceImage(reader.result as string)
      setSourceFilename(file.name)
      setSourcePath(filePathOf(file))
      setPreviewImage(null)
      setPreviewModule(null)
    }
    reader.readAsDataURL(file)
  }

  async function runPreprocessor(showSuccessToast = true): Promise<DetectionResult | null> {
    if (!sourceImage) {
      toast.error(tStatic('cnBuilder.needImage'))
      return null
    }
    if (status.kind !== 'ready') {
      toast.error(tStatic('inputImage.waitForge'))
      return null
    }
    const preset = ROLE_PRESETS.find((item) => item.id === selectedRole) ?? ROLE_PRESETS[0]
    const resolved = resolvePreset(preset, modules, models)
    const startedAt = Date.now()
    setDetectStartedAt(startedAt)
    setDetectNow(startedAt)
    setDetecting(true)
    try {
      let result: DetectionResult
      if (resolved.module === 'None' || preset.id === 'reference') {
        setPreviewImage(sourceImage)
        setPreviewModule(resolved.module)
        result = { image: sourceImage, module: resolved.module }
      } else {
        const detected = await api.forge.controlnetDetect({
          image: sourceImage,
          module: resolved.module,
          processorRes: DETECT_PROCESSOR_RES,
          thresholdA: -1,
          thresholdB: -1,
          resizeMode: preset.id === 'pose' ? 1 : 0
        })
        setPreviewImage(detected.image)
        setPreviewModule(detected.module)
        result = { image: detected.image, module: detected.module }
      }
      if (showSuccessToast) toast.success(tStatic('cnBuilder.detected'))
      return result
    } catch (e) {
      toast.error(tStatic('cnBuilder.detectFailed', { message: (e as Error).message }))
      return null
    } finally {
      setDetecting(false)
      setDetectStartedAt(null)
    }
  }

  function applyPreviewToUnit(preprocessed?: DetectionResult, showSuccessToast = true): boolean {
    if (!sourceImage && !previewImage) {
      toast.error(tStatic('cnBuilder.needImage'))
      return false
    }
    const preset = ROLE_PRESETS.find((item) => item.id === selectedRole) ?? ROLE_PRESETS[0]
    const resolved = resolvePreset(preset, modules, models)
    const candidatePreviewImage = preprocessed?.image ?? previewImage
    const candidatePreviewModule = preprocessed?.module ?? previewModule ?? resolved.module
    const useProcessedMap = candidatePreviewImage && shouldUseProcessedMap(preset.id, candidatePreviewModule)
    const image = useProcessedMap ? candidatePreviewImage : (sourceImage ?? candidatePreviewImage)
    if (!image) return false
    patchControlnet({ enabled: true })
    patchUnit(targetUnitIndex, {
      enabled: true,
      module: useProcessedMap ? 'None' : resolved.module,
      model: resolved.model,
      image,
      imagePath: useProcessedMap ? null : sourcePath,
      weight: preset.weight,
      controlMode: preset.controlMode,
      pixelPerfect: true,
      processorRes: -1,
      thresholdA: -1,
      thresholdB: -1,
      resizeMode: preset.id === 'pose' ? 1 : 0,
      guidanceStart: 0,
      guidanceEnd: 1
    })
    if (showSuccessToast) {
      toast.success(tStatic('cnBuilder.previewApplied', {
        role: tStatic(`cnBuilder.role.${preset.id}`),
        unit: targetUnitIndex + 1
      }))
    }
    return true
  }

  async function runAndApply(): Promise<void> {
    const result = await runPreprocessor(false)
    if (!result) return
    const applied = applyPreviewToUnit(result, false)
    if (!applied) return
    toast.success(tStatic('cnBuilder.runAndApplyDone', {
      role: tStatic(`cnBuilder.role.${selectedRole}`),
      unit: targetUnitIndex + 1
    }))
  }

  const detectElapsedSeconds = detecting && detectStartedAt
    ? Math.max(0, Math.floor((detectNow - detectStartedAt) / 1000))
    : null
  const targetUnit = controlnet.units[targetUnitIndex] ?? controlnet.units[0]

  return (
    <CollapsiblePanel
      title={t('cnBuilder.title')}
      hint={t('cnBuilder.hint')}
      defaultOpen
      testId="controlnet-builder-panel"
    >
      <div className="grid grid-cols-1 gap-2">
        <div
          className={cn(
            'rounded-md border border-dashed p-2 text-center transition-colors',
            sourceImage ? 'border-line bg-bg-2/50' : 'border-line hover:border-accent/60'
          )}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'))
            if (file) loadFile(file)
          }}
        >
          {sourceImage ? (
            <div className="flex items-center gap-2 text-left">
              <img src={sourceImage} alt={t('cnBuilder.sourceAlt')} className="h-16 w-16 rounded bg-bg-3 object-cover" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-mono text-ink-1">{sourceFilename ?? t('cnBuilder.sourceImage')}</div>
                <div className="truncate text-[10px] text-ink-3">{previewImage ? t('cnBuilder.previewReady') : t('cnBuilder.previewPending')}</div>
              </div>
              <button
                type="button"
                className="btn btn-icon btn-ghost"
                onClick={(e) => {
                  e.stopPropagation()
                  setSourceImage(null)
                  setSourceFilename(null)
                  setSourcePath(null)
                  setPreviewImage(null)
                  setPreviewModule(null)
                }}
                title={t('cn.clearImage')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <>
              <Upload className="mx-auto mb-1 h-4 w-4 text-ink-3" />
              <div className="text-[10px] text-ink-2">{t('cnBuilder.dropImage')}</div>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) loadFile(f)
              e.target.value = ''
            }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 rounded-md border border-line bg-bg-2/50 p-1.5">
        <span className="mr-1 text-[10px] text-ink-3">{t('cnBuilder.targetUnit')}</span>
        {controlnet.units.map((_unit, index) => (
          <button
            key={index}
            type="button"
            className={cn(
              'rounded border px-2 py-1 text-[10px] transition-colors',
              targetUnitIndex === index
                ? 'border-accent bg-accent/15 text-ink-0'
                : 'border-line text-ink-3 hover:bg-bg-3 hover:text-ink-1'
            )}
            onClick={() => setTargetUnitIndex(index)}
          >
            {t('cn.unitLabel', { n: index + 1 })}
          </button>
        ))}
        {controlnet.units.length < 3 && (
          <button
            type="button"
            className="ml-auto inline-flex h-7 items-center gap-1 rounded border border-line px-2 text-[10px] text-ink-3 transition-colors hover:bg-bg-3 hover:text-ink-1"
            onClick={() => {
              const nextIndex = controlnet.units.length
              patchControlnet({ enabled: true })
              addUnit()
              setTargetUnitIndex(nextIndex)
            }}
            title={t('cnBuilder.addTargetUnit')}
          >
            <Plus className="h-3 w-3" />
            {t('cnBuilder.addTargetUnit')}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {ROLE_PRESETS.map((preset) => {
          const resolved = resolvePreset(preset, modules, models)
          const modelLabel = resolved.model === 'None' ? null : compactModelName(resolved.model)
          const blockedByFabric = preset.id === 'reference' && fabricFeedbackActive
          const active = controlnet.enabled &&
            targetUnit?.enabled &&
            targetUnit.module === resolved.module &&
            targetUnit.model === resolved.model
          return (
            <button
              key={preset.id}
              type="button"
              className={cn(
                'min-h-[88px] rounded-md border border-line bg-bg-2 p-2 text-left transition-colors hover:border-accent/60',
                resolved.modelMissing && 'border-warn/50 bg-warn/5',
                blockedByFabric && 'cursor-not-allowed opacity-60 hover:border-line',
                (active || selectedRole === preset.id) && 'border-accent bg-accent/10'
              )}
              aria-label={`${t(`cnBuilder.role.${preset.id}`)} ${resolved.modelMissing ? t('cnBuilder.modelNeeded') : t('cnBuilder.ready')}`}
              disabled={blockedByFabric}
              onClick={() => applyPreset(preset)}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span className={cn('shrink-0', resolved.modelMissing ? 'text-warn' : 'text-accent')}>{preset.icon}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-ink-1">{t(`cnBuilder.role.${preset.id}`)}</span>
                {resolved.modelMissing ? (
                  <AlertTriangle className="h-3 w-3 shrink-0 text-warn" />
                ) : (
                  <CheckCircle2 className="h-3 w-3 shrink-0 text-accent" />
                )}
              </div>
              <p className="mt-1 h-7 overflow-hidden text-[10px] leading-tight text-ink-3">{t(preset.hintKey)}</p>
              <div className="mt-1 grid gap-0.5 text-[10px]">
                <div className="flex min-w-0 items-center gap-1">
                  <span className="truncate text-ink-3">{resolved.module}</span>
                  <span className={cn('ml-auto shrink-0', resolved.modelMissing ? 'text-warn' : 'text-ink-2')}>
                    {blockedByFabric ? t('cnBuilder.fabricBlocked') : resolved.modelMissing ? t('cnBuilder.modelNeeded') : t('cnBuilder.ready')}
                  </span>
                </div>
                {modelLabel && (
                  <div className="flex min-w-0 items-center gap-1" title={resolved.modelHint ? `${resolved.modelHint.label} - ${resolved.modelHint.sourceUrl}` : resolved.model}>
                    {resolved.modelHint && <span className="shrink-0 rounded border border-accent/35 px-1 text-[9px] leading-4 text-accent">HF</span>}
                    <span className="truncate font-mono text-[9px] text-ink-3">{modelLabel}</span>
                  </div>
                )}
              </div>
            </button>
          )
        })}
      </div>
      {ROLE_PRESETS.some((preset) => resolvePreset(preset, modules, models).modelMissing) && (
        <div className="rounded-md border border-warn/40 bg-warn/5 p-2 text-[10px] leading-relaxed text-warn">
          {t('cnBuilder.missingSummary')}
        </div>
      )}
      {sourceImage && (
        <div className="space-y-2 rounded-md border border-line bg-bg-2/50 p-2">
          <div className="grid grid-cols-2 gap-2">
            <PreviewThumb label={t('cnBuilder.sourceImage')} image={sourceImage} />
            <PreviewThumb
              label={t('cnBuilder.detectedImage')}
              image={previewImage}
              empty={detecting ? t('cnBuilder.detectingWithSeconds', { seconds: detectElapsedSeconds ?? 0 }) : t('cnBuilder.previewPending')}
            />
          </div>
          {detectElapsedSeconds !== null && (
            <div className="flex items-center justify-center gap-1 rounded bg-bg-3 px-2 py-1 text-[10px] text-ink-3">
              <Clock3 className="h-3 w-3 text-accent" />
              <span>{t('cnBuilder.detectElapsed', { seconds: detectElapsedSeconds })}</span>
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              className="btn justify-center text-xs"
              disabled={detecting || status.kind !== 'ready'}
              onClick={() => { void runPreprocessor() }}
            >
              <Wand2 className={cn('h-3.5 w-3.5', detecting && 'animate-pulse')} />
              {detecting ? t('cnBuilder.detectingWithSeconds', { seconds: detectElapsedSeconds ?? 0 }) : t('cnBuilder.runDetect')}
            </button>
            <button
              type="button"
              className="btn btn-primary justify-center text-xs"
              disabled={!sourceImage || detecting}
              onClick={() => { applyPreviewToUnit() }}
            >
              <Play className="h-3.5 w-3.5" />
              {t('cnBuilder.applyPreview', { unit: targetUnitIndex + 1 })}
            </button>
            <button
              type="button"
              className="btn btn-primary justify-center text-xs"
              disabled={!sourceImage || detecting || status.kind !== 'ready'}
              onClick={() => { void runAndApply() }}
            >
              <Sparkles className={cn('h-3.5 w-3.5', detecting && 'animate-pulse')} />
              {t('cnBuilder.runAndApply')}
            </button>
          </div>
        </div>
      )}
      <button
        type="button"
        className="btn btn-ghost w-full justify-center text-xs"
        onClick={() => openCivitaiSearch('Controlnet')}
      >
        <Search className="h-3.5 w-3.5" />
        {t('cnBuilder.findModels')}
      </button>
    </CollapsiblePanel>
  )
}

function PreviewThumb({ label, image, empty }: { label: string; image: string | null; empty?: string }): JSX.Element {
  return (
    <div className="space-y-1">
      <div className="text-[10px] text-ink-3">{label}</div>
      {image ? (
        <img src={image} alt={label} className="h-28 w-full rounded bg-bg-3 object-contain" />
      ) : (
        <div className="flex h-28 items-center justify-center rounded bg-bg-3 text-[10px] text-ink-3">
          {empty ?? '-'}
        </div>
      )}
    </div>
  )
}

function resolvePreset(
  preset: RolePreset,
  modules: string[],
  models: string[]
): { module: string; model: string; modelMissing: boolean; modelHint: ControlNetModelHint | null } {
  const module = chooseFirstAvailable(preset.moduleCandidates, modules) ?? preset.moduleCandidates[0] ?? 'None'
  const model = chooseModel(preset, models) ?? preset.fallbackModel
  const modelHint = getModelHint(preset.id, model)
  return {
    module,
    model,
    modelMissing: model === 'None' && preset.id !== 'reference',
    modelHint
  }
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

function chooseFirstAvailable(candidates: string[], available: string[]): string | null {
  if (available.length === 0) return null
  const lower = new Map(available.map((item) => [item.toLowerCase(), item]))
  for (const candidate of candidates) {
    const exact = lower.get(candidate.toLowerCase())
    if (exact) return exact
  }
  return null
}

function chooseModel(preset: RolePreset, models: string[]): string | null {
  const available = models.filter((model) => model !== 'None')
  const preferred = chooseModelByKeywordGroups(preset.preferredModelKeywordGroups ?? [], available)
  if (preferred) return preferred
  const hinted = CONTROLNET_MODEL_HINTS
    .filter((hint) => hint.roles.includes(preset.id))
    .map((hint) => chooseModelByKeywordGroups(hint.keywordGroups, available))
    .find((model): model is string => Boolean(model))
  if (hinted) return hinted
  for (const keyword of preset.modelKeywords) {
    const lower = keyword.toLowerCase()
    const found = available.find((model) => model.toLowerCase().includes(lower))
    if (found) return found
  }
  return null
}

function chooseModelByKeywordGroups(keywordGroups: string[][], models: string[]): string | null {
  for (const keywords of keywordGroups) {
    const found = models.find((model) => matchesAllKeywords(model, keywords))
    if (found) return found
  }
  return null
}

function getModelHint(role: BuilderRole, model: string): ControlNetModelHint | null {
  if (model === 'None') return null
  return CONTROLNET_MODEL_HINTS.find((hint) =>
    hint.roles.includes(role) &&
    hint.keywordGroups.some((keywords) => matchesAllKeywords(model, keywords))
  ) ?? null
}

function matchesAllKeywords(value: string, keywords: string[]): boolean {
  const normalized = value.toLowerCase()
  return keywords.every((keyword) => normalized.includes(keyword.toLowerCase()))
}

function compactModelName(model: string): string {
  return model
    .replace(/\s+\[[^\]]+\]$/, '')
    .replace(/\.safetensors$/i, '')
}

function shouldUseProcessedMap(role: BuilderRole, module: string): boolean {
  if (role === 'tile' || role === 'reference') return false
  return module !== 'None'
}

function filePathOf(file: File): string | null {
  const path = (file as File & { path?: string }).path
  return typeof path === 'string' && path.length > 0 ? path : null
}
