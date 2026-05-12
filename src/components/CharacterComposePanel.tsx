import { useRef, useState } from 'react'
import { FlipHorizontal, FolderOpen, Image as ImageIcon, Layers3, Link2, Move, Play, RotateCcw, Save, Sparkles, Upload, Wand2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore, type ControlNetUnitState } from '@/lib/store'
import { api } from '@/lib/ipc'
import { promptAppend } from '@/lib/prompt-utils'
import { useT, t as tStatic } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { CollapsiblePanel } from './CollapsiblePanel'

type ComposePresetId = 'photoAnime' | 'nightPhoto' | 'strongRedraw' | 'edgeOnly'

interface ComposePreset {
  id: ComposePresetId
  promptTags: string[]
  denoise: number
  controlWeight: number
  controlMode: 0 | 1 | 2
  filter: string
  alpha: number
  shadowAlpha: number
}

interface LoadedLayer {
  image: HTMLImageElement
  width: number
  height: number
}

interface TransformState {
  x: number
  y: number
  widthPct: number
  rotation: number
  flipX: boolean
}

interface ComposeResult {
  composite: string
  mask: string
  toneFilter: string
  structureControl: ControlChoice
  referenceControl: ControlChoice | null
}

interface ControlChoice {
  module: string
  model: string
}

interface ToneMetrics {
  luminance: number
  saturation: number
}

const PRESETS: ComposePreset[] = [
  {
    id: 'photoAnime',
    promptTags: ['anime character', 'standing beside person', 'matching lighting', 'natural shadow', 'integrated in photo'],
    denoise: 0.42,
    controlWeight: 0.55,
    controlMode: 1,
    filter: 'brightness(0.88) contrast(0.94) saturate(0.86)',
    alpha: 0.94,
    shadowAlpha: 0.38
  },
  {
    id: 'nightPhoto',
    promptTags: ['anime character', 'low light photo', 'night scene', 'dim ambient light', 'film grain', 'red rim light', 'natural shadow'],
    denoise: 0.35,
    controlWeight: 0.48,
    controlMode: 1,
    filter: 'brightness(0.56) contrast(0.9) saturate(0.72) blur(0.35px)',
    alpha: 0.88,
    shadowAlpha: 0.56
  },
  {
    id: 'strongRedraw',
    promptTags: ['anime character', 'full body', 'clean details', 'matching perspective', 'natural shadow'],
    denoise: 0.62,
    controlWeight: 0.72,
    controlMode: 2,
    filter: 'brightness(0.96) contrast(1) saturate(0.95)',
    alpha: 1,
    shadowAlpha: 0.42
  },
  {
    id: 'edgeOnly',
    promptTags: ['character compositing', 'blend edges', 'same lighting', 'same camera noise'],
    denoise: 0.24,
    controlWeight: 0.42,
    controlMode: 1,
    filter: 'brightness(0.82) contrast(0.92) saturate(0.84) blur(0.25px)',
    alpha: 0.92,
    shadowAlpha: 0.32
  }
]

const NEGATIVE_TAGS = ['pasted sticker', 'floating character', 'mismatched lighting', 'bad shadow', 'cutout border', 'white outline']

export function CharacterComposePanel({ onGenerate }: { onGenerate(): Promise<void> }): JSX.Element {
  const inputImage = useStore((s) => s.inputImage)
  const inputImageFilename = useStore((s) => s.inputImageFilename)
  const lastImage = useStore((s) => s.lastImage)
  const prompt = useStore((s) => s.prompt)
  const negativePrompt = useStore((s) => s.negativePrompt)
  const setInputImage = useStore((s) => s.setInputImage)
  const setInpaintMaskImage = useStore((s) => s.setInpaintMaskImage)
  const patchParams = useStore((s) => s.patchParams)
  const setPrompt = useStore((s) => s.setPrompt)
  const setNegativePrompt = useStore((s) => s.setNegativePrompt)
  const patchControlnet = useStore((s) => s.patchControlnet)
  const patchControlnetUnit = useStore((s) => s.patchControlnetUnit)
  const addControlnetUnit = useStore((s) => s.addControlnetUnit)
  const models = useStore((s) => s.controlnetModelList)
  const modules = useStore((s) => s.controlnetModuleList)
  const setCurrentTab = useStore((s) => s.setCurrentTab)
  const isGenerating = useStore((s) => s.isGenerating)
  const t = useT()

  const baseInputRef = useRef<HTMLInputElement | null>(null)
  const characterInputRef = useRef<HTMLInputElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)

  const [baseLayerImage, setBaseLayerImage] = useState<string | null>(null)
  const [baseLayerFilename, setBaseLayerFilename] = useState<string | null>(null)
  const [characterImage, setCharacterImage] = useState<string | null>(null)
  const [characterFilename, setCharacterFilename] = useState<string | null>(null)
  const [characterPrompt, setCharacterPrompt] = useState('')
  const [presetId, setPresetId] = useState<ComposePresetId>('nightPhoto')
  const [transform, setTransform] = useState<TransformState>({
    x: 32,
    y: 62,
    widthPct: 42,
    rotation: 0,
    flipX: false
  })
  const [maskExpand, setMaskExpand] = useState(22)
  const [maskFeather, setMaskFeather] = useState(14)
  const [autoTone, setAutoTone] = useState(true)
  const [characterReference, setCharacterReference] = useState(true)
  const [lastPrepared, setLastPrepared] = useState<ComposeResult | null>(null)
  const [lastSavedDir, setLastSavedDir] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const preset = PRESETS.find((item) => item.id === presetId) ?? PRESETS[0]
  const baseImage = baseLayerImage ?? inputImage
  const baseFilename = baseLayerFilename ?? inputImageFilename
  const referenceSupport = chooseReferenceControl(modules, models)
  const ready = !!baseImage && !!characterImage

  function readBaseFile(file: File): void {
    if (!file.type.startsWith('image/')) {
      toast.error(tStatic('cn.notAnImage'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const image = reader.result as string
      setBaseLayerImage(image)
      setBaseLayerFilename(file.name)
      setLastPrepared(null)
      setLastSavedDir(null)
      setInputImage(image, file.name, filePathOf(file))
    }
    reader.readAsDataURL(file)
  }

  function readCharacterFile(file: File): void {
    if (!file.type.startsWith('image/')) {
      toast.error(tStatic('cn.notAnImage'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setCharacterImage(reader.result as string)
      setCharacterFilename(file.name)
      setLastPrepared(null)
      setLastSavedDir(null)
    }
    reader.readAsDataURL(file)
  }

  function updatePositionFromPointer(e: React.PointerEvent<HTMLDivElement>): void {
    const stage = stageRef.current
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / Math.max(rect.width, 1)) * 100
    const y = ((e.clientY - rect.top) / Math.max(rect.height, 1)) * 100
    setTransform((current) => ({
      ...current,
      x: clamp(x, -20, 120),
      y: clamp(y, -20, 120)
    }))
    setLastPrepared(null)
  }

  async function prepare(generateAfter: boolean): Promise<void> {
    if (!baseImage) {
      toast.error(tStatic('characterCompose.needBase'))
      return
    }
    if (!characterImage) {
      toast.error(tStatic('characterCompose.needCharacter'))
      return
    }
    setBusy(true)
    try {
      if (!baseLayerImage) {
        setBaseLayerImage(baseImage)
        setBaseLayerFilename(baseFilename)
      }
      const result = await buildComposite({
        baseImage,
        characterImage,
        transform,
        preset,
        maskExpand,
        maskFeather,
        autoTone,
        modules,
        models
      })
      setLastPrepared(result)
      setLastSavedDir(null)
      setCurrentTab('img2img')
      setInputImage(result.composite, `character-compose-${Date.now()}.png`)
      setInpaintMaskImage(result.mask)
      patchParams({ denoisingStrength: preset.denoise })
      applyPromptPreset(characterPrompt, preset, setPrompt, setNegativePrompt)
      applyControlNet({
        composite: result.composite,
        characterImage,
        preset,
        structureControl: result.structureControl,
        referenceControl: characterReference ? result.referenceControl : null,
        patchControlnet,
        patchControlnetUnit,
        addControlnetUnit
      })
      toast.success(tStatic('characterCompose.prepared'))
      if (generateAfter) {
        window.setTimeout(() => { void onGenerate() }, 0)
      }
    } catch (e) {
      toast.error(tStatic('characterCompose.prepareFailed', { message: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  async function savePackage(): Promise<void> {
    if (!baseImage) {
      toast.error(tStatic('characterCompose.needBase'))
      return
    }
    if (!characterImage) {
      toast.error(tStatic('characterCompose.needCharacter'))
      return
    }
    setBusy(true)
    try {
      const result = await buildComposite({
        baseImage,
        characterImage,
        transform,
        preset,
        maskExpand,
        maskFeather,
        autoTone,
        modules,
        models
      })
      const saved = await api.storage.saveCharacterComposite({
        baseImageDataUrl: baseImage,
        characterImageDataUrl: characterImage,
        compositeImageDataUrl: result.composite,
        maskImageDataUrl: result.mask,
        generatedImageDataUrl: lastImage,
        baseFilename,
        characterFilename,
        presetId,
        prompt,
        negativePrompt,
        denoise: preset.denoise,
        controlNet: {
          structureModule: result.structureControl.module,
          structureModel: result.structureControl.model,
          referenceModule: characterReference ? result.referenceControl?.module ?? null : null,
          referenceModel: characterReference ? result.referenceControl?.model ?? null : null
        },
        transform: {
          ...transform,
          maskExpand,
          maskFeather,
          autoTone,
          characterReference
        },
        notes: result.toneFilter
      })
      setLastPrepared(result)
      setLastSavedDir(saved.dir)
      toast.success(tStatic('characterCompose.packageSaved', { path: saved.reportPath }))
    } catch (e) {
      toast.error(tStatic('characterCompose.packageSaveFailed', { message: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <CollapsiblePanel
      title={t('characterCompose.title')}
      hint={t('characterCompose.hint')}
      defaultOpen={false}
    >
      <div className="space-y-3">
        <div
          ref={stageRef}
          className={cn(
            'relative overflow-hidden rounded-md border bg-bg-3 min-h-48 select-none',
            ready ? 'border-accent/40 cursor-crosshair' : 'border-line'
          )}
          onPointerDown={(e) => {
            if (!characterImage || !baseImage) return
            e.currentTarget.setPointerCapture(e.pointerId)
            draggingRef.current = true
            updatePositionFromPointer(e)
          }}
          onPointerMove={(e) => {
            if (!draggingRef.current) return
            updatePositionFromPointer(e)
          }}
          onPointerUp={(e) => {
            draggingRef.current = false
            e.currentTarget.releasePointerCapture(e.pointerId)
          }}
          onPointerCancel={() => { draggingRef.current = false }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const file = Array.from(e.dataTransfer.files).find((item) => item.type.startsWith('image/'))
            if (!file) return
            if (baseImage) readCharacterFile(file)
            else readBaseFile(file)
          }}
        >
          {baseImage ? (
            <img src={baseImage} alt={t('characterCompose.baseAlt')} className="block w-full max-h-80 object-contain" />
          ) : (
            <button
              type="button"
              className="flex min-h-48 w-full flex-col items-center justify-center gap-2 text-xs text-ink-2 hover:bg-bg-2"
              onClick={() => baseInputRef.current?.click()}
            >
              <Upload className="h-6 w-6 text-ink-3" />
              {t('characterCompose.dropBase')}
            </button>
          )}

          {baseImage && characterImage && (
            <img
              src={characterImage}
              alt={t('characterCompose.characterAlt')}
              className="absolute pointer-events-none max-w-none drop-shadow-[0_14px_20px_rgba(0,0,0,0.42)]"
              style={{
                left: `${transform.x}%`,
                top: `${transform.y}%`,
                width: `${transform.widthPct}%`,
                transform: `translate(-50%, -50%) rotate(${transform.rotation}deg) scaleX(${transform.flipX ? -1 : 1})`,
                filter: preset.filter,
                opacity: preset.alpha
              }}
            />
          )}
        </div>

        <input
          ref={baseInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) readBaseFile(file)
            e.target.value = ''
          }}
        />
        <input
          ref={characterInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) readCharacterFile(file)
            e.target.value = ''
          }}
        />

        <div className="grid grid-cols-2 gap-1">
          <button type="button" className="btn justify-center text-[11px]" onClick={() => baseInputRef.current?.click()}>
            <ImageIcon className="h-3.5 w-3.5" />
            {baseImage ? t('characterCompose.replaceBase') : t('characterCompose.selectBase')}
          </button>
          <button type="button" className="btn justify-center text-[11px]" onClick={() => characterInputRef.current?.click()}>
            <Sparkles className="h-3.5 w-3.5" />
            {characterImage ? t('characterCompose.replaceCharacter') : t('characterCompose.selectCharacter')}
          </button>
        </div>

        {characterFilename && (
          <div className="flex items-center gap-1 rounded border border-line bg-bg-2 px-2 py-1 text-[10px] text-ink-3">
            <Layers3 className="h-3 w-3 text-accent" />
            <span className="truncate font-mono">{characterFilename}</span>
            <button
              type="button"
              className="ml-auto btn btn-icon btn-ghost"
              title={t('characterCompose.clearCharacter')}
              onClick={() => {
                setCharacterImage(null)
                setCharacterFilename(null)
                setLastPrepared(null)
                setLastSavedDir(null)
              }}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-1">
          {PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cn(
                'rounded border px-2 py-1 text-left text-[10px] leading-tight',
                presetId === item.id ? 'border-accent bg-accent-dim/30 text-ink-1' : 'border-line text-ink-2 hover:bg-bg-2'
              )}
              onClick={() => {
                setPresetId(item.id)
                setLastPrepared(null)
              }}
            >
              <span className="block font-semibold">{t(`characterCompose.preset.${item.id}`)}</span>
              <span className="text-ink-3">{t(`characterCompose.preset.${item.id}.hint`)}</span>
            </button>
          ))}
        </div>

        <label className="block">
          <span className="text-[10px] text-ink-3">{t('characterCompose.prompt')}</span>
          <input
            className="input text-[11px] py-1"
            value={characterPrompt}
            onChange={(e) => setCharacterPrompt(e.target.value)}
            placeholder={t('characterCompose.promptPlaceholder')}
          />
        </label>

        <div className="grid gap-1 rounded border border-line bg-bg-2/40 p-2 text-[10px]">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5 accent-accent"
              checked={autoTone}
              onChange={(e) => {
                setAutoTone(e.target.checked)
                setLastPrepared(null)
              }}
            />
            <span>
              <span className="block text-ink-1">{t('characterCompose.autoTone')}</span>
              <span className="text-ink-3">{t('characterCompose.autoToneHint')}</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5 accent-accent"
              checked={characterReference}
              onChange={(e) => setCharacterReference(e.target.checked)}
            />
            <span>
              <span className="flex items-center gap-1 text-ink-1">
                <Link2 className="h-3 w-3 text-accent" />
                {t('characterCompose.referenceUnit')}
              </span>
              <span className="text-ink-3">
                {referenceSupport
                  ? t('characterCompose.referenceUnitReady', { module: referenceSupport.module })
                  : t('characterCompose.referenceUnitMissing')}
              </span>
            </span>
          </label>
        </div>

        <div className="space-y-2 rounded border border-line bg-bg-2/40 p-2">
          <SliderRow
            icon={<Move className="h-3.5 w-3.5" />}
            label={t('characterCompose.size')}
            value={transform.widthPct}
            min={12}
            max={90}
            step={1}
            suffix="%"
            onChange={(value) => {
              setTransform((current) => ({ ...current, widthPct: value }))
              setLastPrepared(null)
            }}
          />
          <SliderRow
            icon={<RotateCcw className="h-3.5 w-3.5" />}
            label={t('characterCompose.rotation')}
            value={transform.rotation}
            min={-35}
            max={35}
            step={1}
            suffix="deg"
            onChange={(value) => {
              setTransform((current) => ({ ...current, rotation: value }))
              setLastPrepared(null)
            }}
          />
          <SliderRow
            icon={<Wand2 className="h-3.5 w-3.5" />}
            label={t('characterCompose.maskExpand')}
            value={maskExpand}
            min={0}
            max={64}
            step={1}
            suffix="px"
            onChange={(value) => {
              setMaskExpand(value)
              setLastPrepared(null)
            }}
          />
          <SliderRow
            icon={<Wand2 className="h-3.5 w-3.5" />}
            label={t('characterCompose.maskFeather')}
            value={maskFeather}
            min={0}
            max={48}
            step={1}
            suffix="px"
            onChange={(value) => {
              setMaskFeather(value)
              setLastPrepared(null)
            }}
          />
          <button
            type="button"
            className="btn w-full justify-center text-[11px]"
            onClick={() => {
              setTransform((current) => ({ ...current, flipX: !current.flipX }))
              setLastPrepared(null)
            }}
          >
            <FlipHorizontal className="h-3.5 w-3.5" />
            {t('characterCompose.flip')}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1">
          <button
            type="button"
            className="btn justify-center text-[11px]"
            disabled={!ready || busy}
            onClick={() => { void prepare(false) }}
          >
            <Wand2 className={cn('h-3.5 w-3.5', busy && 'animate-pulse')} />
            {t('characterCompose.prepare')}
          </button>
          <button
            type="button"
            className="btn btn-primary justify-center text-[11px]"
            disabled={!ready || busy || isGenerating}
            onClick={() => { void prepare(true) }}
          >
            <Play className="h-3.5 w-3.5" />
            {t('characterCompose.prepareGenerate')}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1">
          <button
            type="button"
            className="btn justify-center text-[11px]"
            disabled={!ready || busy}
            onClick={() => { void savePackage() }}
          >
            <Save className="h-3.5 w-3.5" />
            {t('characterCompose.savePackage')}
          </button>
          <button
            type="button"
            className="btn justify-center text-[11px]"
            disabled={!lastSavedDir}
            onClick={() => {
              if (lastSavedDir) void api.app.showItemInFolder(lastSavedDir)
            }}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {t('characterCompose.openPackage')}
          </button>
        </div>
        {lastPrepared && (
          <p className="rounded border border-line bg-bg-2/40 px-2 py-1 text-[10px] leading-relaxed text-ink-3">
            {t('characterCompose.lastPrepared', {
              structure: lastPrepared.structureControl.module,
              reference: characterReference ? lastPrepared.referenceControl?.module ?? 'None' : 'None'
            })}
          </p>
        )}
        <p className="text-[10px] leading-relaxed text-ink-3">{t('characterCompose.outputHint')}</p>
      </div>
    </CollapsiblePanel>
  )
}

function SliderRow({
  icon,
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange
}: {
  icon: JSX.Element
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix: string
  onChange(value: number): void
}): JSX.Element {
  return (
    <label className="block">
      <div className="flex items-center gap-1.5 text-[10px] text-ink-3">
        <span className="text-accent">{icon}</span>
        <span>{label}</span>
        <span className="ml-auto font-mono text-ink-1">{value}{suffix}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent"
      />
    </label>
  )
}

async function buildComposite({
  baseImage,
  characterImage,
  transform,
  preset,
  maskExpand,
  maskFeather,
  autoTone,
  modules,
  models
}: {
  baseImage: string
  characterImage: string
  transform: TransformState
  preset: ComposePreset
  maskExpand: number
  maskFeather: number
  autoTone: boolean
  modules: string[]
  models: string[]
}): Promise<ComposeResult> {
  const [base, character] = await Promise.all([
    loadImage(baseImage),
    loadImage(characterImage)
  ])
  const composite = document.createElement('canvas')
  composite.width = base.width
  composite.height = base.height
  const ctx = composite.getContext('2d')
  if (!ctx) throw new Error('Canvas is unavailable')
  ctx.drawImage(base.image, 0, 0)
  const box = layerBox(composite, character, transform)
  const toneFilter = autoTone
    ? composeToneFilter(preset.filter, measureTone(base, box), measureTone(character))
    : preset.filter
  drawCharacterShadow(ctx, character, transform, preset)
  drawCharacter(ctx, character, transform, preset, toneFilter)

  const mask = document.createElement('canvas')
  mask.width = base.width
  mask.height = base.height
  const maskCtx = mask.getContext('2d')
  if (!maskCtx) throw new Error('Mask canvas is unavailable')
  maskCtx.fillStyle = 'black'
  maskCtx.fillRect(0, 0, mask.width, mask.height)
  drawCharacterMask(maskCtx, character, transform, maskExpand, maskFeather)
  const structureControl = chooseStructureControl(modules, models)

  return {
    composite: composite.toDataURL('image/png'),
    mask: mask.toDataURL('image/png'),
    toneFilter,
    structureControl,
    referenceControl: chooseReferenceControl(modules, models)
  }
}

function drawCharacter(
  ctx: CanvasRenderingContext2D,
  character: LoadedLayer,
  transform: TransformState,
  preset: ComposePreset,
  filter: string
): void {
  const box = layerBox(ctx.canvas, character, transform)
  ctx.save()
  applyLayerTransform(ctx, box, transform)
  ctx.globalAlpha = preset.alpha
  ctx.filter = filter
  ctx.drawImage(character.image, -box.width / 2, -box.height / 2, box.width, box.height)
  ctx.restore()
}

function drawCharacterShadow(
  ctx: CanvasRenderingContext2D,
  character: LoadedLayer,
  transform: TransformState,
  preset: ComposePreset
): void {
  if (preset.shadowAlpha <= 0) return
  const silhouette = makeSilhouette(character, 'rgba(0,0,0,1)')
  const box = layerBox(ctx.canvas, character, transform)
  ctx.save()
  applyLayerTransform(ctx, box, transform)
  ctx.globalAlpha = preset.shadowAlpha
  ctx.filter = 'blur(8px)'
  ctx.translate(0, Math.max(6, box.height * 0.04))
  ctx.drawImage(silhouette, -box.width / 2, -box.height / 2, box.width, box.height)
  ctx.restore()
}

function drawCharacterMask(
  ctx: CanvasRenderingContext2D,
  character: LoadedLayer,
  transform: TransformState,
  expand: number,
  feather: number
): void {
  const white = makeSilhouette(character, 'white')
  const box = layerBox(ctx.canvas, character, transform)
  ctx.save()
  applyLayerTransform(ctx, box, transform)
  ctx.shadowColor = 'white'
  ctx.shadowBlur = expand
  ctx.filter = feather > 0 ? `blur(${feather}px)` : 'none'
  ctx.drawImage(white, -box.width / 2, -box.height / 2, box.width, box.height)
  ctx.shadowBlur = 0
  ctx.filter = 'none'
  ctx.drawImage(white, -box.width / 2, -box.height / 2, box.width, box.height)
  ctx.restore()
}

function measureTone(layer: LoadedLayer, crop?: { cx: number; cy: number; width: number; height: number }): ToneMetrics {
  const canvas = document.createElement('canvas')
  const size = 48
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return { luminance: 0.5, saturation: 0.5 }
  const maxSx = Math.max(0, layer.width - 1)
  const maxSy = Math.max(0, layer.height - 1)
  const sx = crop ? clamp(crop.cx - crop.width * 0.55, 0, maxSx) : 0
  const sy = crop ? clamp(crop.cy - crop.height * 0.55, 0, maxSy) : 0
  const sw = crop ? clamp(crop.width * 1.1, 1, Math.max(1, layer.width - sx)) : layer.width
  const sh = crop ? clamp(crop.height * 1.1, 1, Math.max(1, layer.height - sy)) : layer.height
  ctx.drawImage(layer.image, sx, sy, sw, sh, 0, 0, size, size)
  const data = ctx.getImageData(0, 0, size, size).data
  let lum = 0
  let sat = 0
  let count = 0
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]
    if (alpha < 24) continue
    const r = data[i] / 255
    const g = data[i + 1] / 255
    const b = data[i + 2] / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    lum += 0.2126 * r + 0.7152 * g + 0.0722 * b
    sat += max <= 0 ? 0 : (max - min) / max
    count += 1
  }
  if (count === 0) return { luminance: 0.5, saturation: 0.5 }
  return { luminance: lum / count, saturation: sat / count }
}

function composeToneFilter(baseFilter: string, base: ToneMetrics, character: ToneMetrics): string {
  const brightness = clamp(base.luminance / Math.max(character.luminance, 0.08), 0.72, 1.18)
  const saturation = clamp(base.saturation / Math.max(character.saturation, 0.08), 0.62, 1.22)
  const contrast = base.luminance < 0.32 ? 0.94 : 1
  return `${baseFilter} brightness(${roundFilter(brightness)}) saturate(${roundFilter(saturation)}) contrast(${roundFilter(contrast)})`
}

function roundFilter(value: number): number {
  return Math.round(value * 100) / 100
}

function layerBox(
  canvas: HTMLCanvasElement,
  character: LoadedLayer,
  transform: TransformState
): { cx: number; cy: number; width: number; height: number } {
  const width = canvas.width * (transform.widthPct / 100)
  return {
    cx: canvas.width * (transform.x / 100),
    cy: canvas.height * (transform.y / 100),
    width,
    height: width * (character.height / Math.max(character.width, 1))
  }
}

function applyLayerTransform(
  ctx: CanvasRenderingContext2D,
  box: { cx: number; cy: number },
  transform: TransformState
): void {
  ctx.translate(box.cx, box.cy)
  ctx.rotate((transform.rotation * Math.PI) / 180)
  if (transform.flipX) ctx.scale(-1, 1)
}

function makeSilhouette(character: LoadedLayer, color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = character.width
  canvas.height = character.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.drawImage(character.image, 0, 0)
  ctx.globalCompositeOperation = 'source-in'
  ctx.fillStyle = color
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  return canvas
}

function loadImage(src: string): Promise<LoadedLayer> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ image, width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error('Image load failed'))
    image.src = src
  })
}

function applyPromptPreset(
  characterPrompt: string,
  preset: ComposePreset,
  setPrompt: (value: string) => void,
  setNegativePrompt: (value: string) => void
): void {
  const state = useStore.getState()
  let nextPrompt = state.prompt
  for (const tag of preset.promptTags) nextPrompt = promptAppend(nextPrompt, tag)
  for (const tag of splitPromptTags(characterPrompt)) nextPrompt = promptAppend(nextPrompt, tag)
  let nextNegative = state.negativePrompt
  for (const tag of NEGATIVE_TAGS) nextNegative = promptAppend(nextNegative, tag)
  setPrompt(nextPrompt)
  setNegativePrompt(nextNegative)
}

function applyControlNet({
  composite,
  characterImage,
  preset,
  structureControl,
  referenceControl,
  patchControlnet,
  patchControlnetUnit,
  addControlnetUnit
}: {
  composite: string
  characterImage: string
  preset: ComposePreset
  structureControl: ControlChoice
  referenceControl: ControlChoice | null
  patchControlnet: (patch: { enabled: boolean }) => void
  patchControlnetUnit: (index: number, patch: Partial<ControlNetUnitState>) => void
  addControlnetUnit: () => void
}): void {
  patchControlnet({ enabled: true })
  patchControlnetUnit(0, {
    enabled: true,
    module: structureControl.module,
    model: structureControl.model,
    image: composite,
    imagePath: null,
    weight: preset.controlWeight,
    guidanceStart: 0,
    guidanceEnd: 0.82,
    pixelPerfect: true,
    controlMode: preset.controlMode,
    resizeMode: 1,
    processorRes: -1,
    thresholdA: -1,
    thresholdB: -1
  })
  if (!referenceControl) return
  ensureControlNetUnit(1, addControlnetUnit)
  patchControlnetUnit(1, {
    enabled: true,
    module: referenceControl.module,
    model: referenceControl.model,
    image: characterImage,
    imagePath: null,
    weight: 0.55,
    guidanceStart: 0,
    guidanceEnd: 0.7,
    pixelPerfect: false,
    controlMode: 1,
    resizeMode: 1,
    processorRes: -1,
    thresholdA: -1,
    thresholdB: -1
  })
}

function ensureControlNetUnit(index: number, addControlnetUnit: () => void): void {
  for (let count = useStore.getState().controlnet.units.length; count <= index; count += 1) {
    addControlnetUnit()
  }
}

function chooseStructureControl(modules: string[], models: string[]): ControlChoice {
  const module = chooseFirstAvailable(modules, ['lineart_anime', 'lineart_realistic', 'canny', 'softedge_pidinet', 'None'])
  return { module, model: chooseModel(models, module) }
}

function chooseReferenceControl(modules: string[], models: string[]): ControlChoice | null {
  const ipAdapterModule = chooseModuleByKeywords(modules, [['ip', 'adapter']])
  const ipAdapterModel = models.find((model) => {
    const normalized = model.toLowerCase()
    return normalized.includes('ip') && normalized.includes('adapter')
  }) ?? null
  if (ipAdapterModule && ipAdapterModel) {
    return { module: ipAdapterModule, model: ipAdapterModel }
  }
  const referenceModule = chooseModuleByKeywords(modules, [
    ['reference', 'only'],
    ['reference', 'adain', 'attn'],
    ['reference', 'adain']
  ])
  return referenceModule ? { module: referenceModule, model: 'None' } : null
}

function chooseFirstAvailable(items: string[], candidates: string[]): string {
  for (const candidate of candidates) {
    const found = items.find((item) => item.toLowerCase() === candidate.toLowerCase())
    if (found) return found
  }
  return candidates[candidates.length - 1] ?? 'None'
}

function chooseModuleByKeywords(items: string[], keywordGroups: string[][]): string | null {
  for (const keywords of keywordGroups) {
    const found = items.find((item) => {
      const normalized = item.toLowerCase()
      return keywords.every((keyword) => normalized.includes(keyword))
    })
    if (found) return found
  }
  return null
}

function chooseModel(models: string[], module: string): string {
  if (module === 'None') return 'None'
  const normalizedModule = module.toLowerCase()
  const keywords = normalizedModule.includes('canny')
    ? ['canny']
    : normalizedModule.includes('softedge')
      ? ['softedge', 'hed']
      : ['lineart']
  return models.find((model) => keywords.some((keyword) => model.toLowerCase().includes(keyword))) ?? 'None'
}

function splitPromptTags(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function filePathOf(file: File): string | null {
  const path = (file as File & { path?: string }).path
  return typeof path === 'string' && path.length > 0 ? path : null
}
