import { useEffect, useRef } from 'react'
import { Plus, Trash2, X, Upload } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore } from '@/lib/store'
import { api } from '@/lib/ipc'
import { useT } from '@/lib/i18n'
import { CollapsiblePanel } from '../CollapsiblePanel'
import { Slider, SelectField } from './controls'
import { cn } from '@/lib/utils'

/**
 * ControlNet — Forge built-in `sd_forge_controlnet`. Steers generation with
 * structural guidance (pose, depth, edges, segmentation, tile, etc.). Up to
 * 3 simultaneous units, each combining a preprocessor (module) with a
 * matching ControlNet model.
 *
 * Why we curate the module list: Forge exposes hundreds of preprocessor
 * variants (every flavor of depth + lineart + scribble + …). Showing them
 * all overwhelms first-time users. The list below is the canonical "you
 * almost certainly want one of these" set; users with niche needs can
 * extend the dropdown by editing the source.
 *
 * Models: fetched once from Forge when the panel mounts (and the user is
 * ready). Falls back to a free-text input if the list is empty so users
 * can type the filename of a model they just dropped into the folder.
 */

const CURATED_MODULES = [
  'None',
  // Edges
  'canny', 'softedge_pidinet', 'mlsd',
  // Depth
  'depth_midas', 'depth_anything', 'depth_zoe',
  // Pose
  'openpose', 'openpose_full', 'openpose_face', 'openpose_hand',
  // Lineart
  'lineart_realistic', 'lineart_anime', 'lineart_standard',
  // Normal
  'normal_bae', 'normal_midas',
  // Sketches / segmentation
  'scribble_pidinet', 'segmentation',
  // Tile / inpaint / reference / shuffle / recolor
  'tile_resample', 'tile_colorfix',
  'inpaint_only', 'inpaint_only+lama',
  'reference_only', 'shuffle', 'recolor_intensity'
] as const

const CONTROL_MODES = [
  { value: 0, key: 'cn.controlMode.balanced' },
  { value: 1, key: 'cn.controlMode.promptPriority' },
  { value: 2, key: 'cn.controlMode.controlPriority' }
] as const

const RESIZE_MODES = [
  { value: 0, key: 'cn.resizeMode.justResize' },
  { value: 1, key: 'cn.resizeMode.cropAndResize' },
  { value: 2, key: 'cn.resizeMode.resizeAndFill' }
] as const

export function ControlNetPanel(): JSX.Element {
  const c = useStore((s) => s.controlnet)
  const status = useStore((s) => s.forgeStatus)
  const modelList = useStore((s) => s.controlnetModelList)
  const moduleListFromApi = useStore((s) => s.controlnetModuleList)
  const setControlnetCatalogs = useStore((s) => s.setControlnetCatalogs)
  const patchC = useStore((s) => s.patchControlnet)
  const patchUnit = useStore((s) => s.patchControlnetUnit)
  const addUnit = useStore((s) => s.addControlnetUnit)
  const removeUnit = useStore((s) => s.removeControlnetUnit)
  const t = useT()

  useEffect(() => {
    if (!c.enabled || status.kind !== 'ready') return
    if (modelList.length > 0 && moduleListFromApi.length > 0) return
    let cancelled = false
    ;(async () => {
      const [models, modules] = await Promise.all([
        fetchOptionalCatalog(() => api.forge.listControlnetModels(), [] as string[]),
        fetchOptionalCatalog(() => api.forge.listControlnetModules(), [] as string[])
      ])
      if (!cancelled) setControlnetCatalogs(models, modules)
    })().catch(() => undefined)
    return () => { cancelled = true }
  }, [c.enabled, status.kind, modelList.length, moduleListFromApi.length, setControlnetCatalogs])

  // Use API-provided module list when available, fall back to curated list
  // (covers the case where Forge isn't fully started yet).
  const modules = moduleListFromApi.length > 0 ? moduleListFromApi : CURATED_MODULES

  return (
    <CollapsiblePanel
      title={t('cn.title')}
      hint={t('cn.hint')}
      enabled={c.enabled}
      onEnabledChange={(v) => patchC({ enabled: v })}
      testId="controlnet-panel"
    >
      <div className="space-y-3">
        {c.units.map((u, i) => (
          <ControlNetUnitCard
            key={i}
            index={i}
            unit={u}
            modules={modules}
            modelList={modelList}
            canRemove={c.units.length > 1}
            onPatch={(patch) => patchUnit(i, patch)}
            onRemove={() => removeUnit(i)}
          />
        ))}

        {c.units.length < 3 && (
          <button
            type="button"
            className="btn w-full text-xs gap-1.5"
            onClick={addUnit}
          >
            <Plus className="h-3 w-3" />
            {t('cn.addUnit')}
          </button>
        )}

        {modelList.length === 0 && (
          <p className="text-[10px] text-warn leading-relaxed">
            {t('cn.noModelsHint')}
          </p>
        )}
      </div>
    </CollapsiblePanel>
  )
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

interface UnitCardProps {
  index: number
  unit: ReturnType<typeof useStore.getState>['controlnet']['units'][number]
  modules: readonly string[]
  modelList: string[]
  canRemove: boolean
  onPatch: (patch: Partial<UnitCardProps['unit']>) => void
  onRemove: () => void
}

function ControlNetUnitCard({
  index,
  unit,
  modules,
  modelList,
  canRemove,
  onPatch,
  onRemove
}: UnitCardProps): JSX.Element {
  const t = useT()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  function loadFile(file: File): void {
    if (!file.type.startsWith('image/')) {
      toast.error(t('cn.notAnImage'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => onPatch({ image: reader.result as string, imagePath: filePathOf(file) })
    reader.readAsDataURL(file)
  }

  return (
    <div className={cn(
      'border rounded p-2 space-y-2 transition-colors',
      unit.enabled ? 'border-accent/60 bg-accent-dim/5' : 'border-line bg-bg-2/40'
    )}>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-ink-3 cursor-pointer">
          <input
            type="checkbox"
            checked={unit.enabled}
            onChange={(e) => onPatch({ enabled: e.target.checked })}
          />
          {t('cn.unitLabel', { n: index + 1 })}
        </label>
        {canRemove && (
          <button
            type="button"
            className="ml-auto btn btn-ghost btn-icon"
            onClick={onRemove}
            title={t('cn.removeUnit')}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Image — drop / click / paste */}
      {unit.image ? (
        <div className="relative">
          <img
            src={unit.image}
            alt={`controlnet input ${index + 1}`}
            className="w-full max-h-32 object-contain rounded bg-bg-3"
          />
          <button
            type="button"
            className="absolute top-1 right-1 btn btn-icon btn-ghost bg-bg-1/80"
            onClick={() => onPatch({ image: null, imagePath: null })}
            title={t('cn.clearImage')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div
          className="border border-dashed border-line rounded p-3 text-center cursor-pointer hover:border-ink-2 transition-colors"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'))
            if (file) loadFile(file)
          }}
        >
          <Upload className="h-4 w-4 mx-auto text-ink-3 mb-1" />
          <div className="text-[10px] text-ink-2">{t('cn.dropZone')}</div>
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
      )}

      <SelectField
        label={t('cn.module')}
        value={unit.module}
        options={modules}
        onChange={(v) => onPatch({ module: v })}
      />

      {/* Model: dropdown if Forge gave us a list, else free text */}
      {modelList.length > 0 ? (
        <SelectField
          label={t('cn.model')}
          value={unit.model}
          options={modelList}
          onChange={(v) => onPatch({ model: v })}
        />
      ) : (
        <label className="block">
          <span className="text-[10px] text-ink-3">{t('cn.model')}</span>
          <input
            className="input text-[11px] py-1 w-full font-mono"
            value={unit.model}
            onChange={(e) => onPatch({ model: e.target.value })}
            placeholder="control_v11p_sd15_openpose [cab727d4]"
          />
        </label>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <Slider
          label={t('cn.weight')}
          value={unit.weight}
          min={0}
          max={2}
          step={0.05}
          onChange={(v) => onPatch({ weight: v })}
        />
        <Slider
          label={t('cn.guidanceStart')}
          value={unit.guidanceStart}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => onPatch({ guidanceStart: v })}
        />
        <Slider
          label={t('cn.guidanceEnd')}
          value={unit.guidanceEnd}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => onPatch({ guidanceEnd: v })}
        />
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <label className="block space-y-0.5">
          <span className="text-[10px] text-ink-3">{t('cn.controlModeLabel')}</span>
          <select
            className="input text-[11px] py-1 w-full"
            value={unit.controlMode}
            onChange={(e) => onPatch({ controlMode: parseInt(e.target.value, 10) as 0 | 1 | 2 })}
          >
            {CONTROL_MODES.map((m) => (
              <option key={m.value} value={m.value}>{t(m.key)}</option>
            ))}
          </select>
        </label>
        <label className="block space-y-0.5">
          <span className="text-[10px] text-ink-3">{t('cn.resizeModeLabel')}</span>
          <select
            className="input text-[11px] py-1 w-full"
            value={unit.resizeMode}
            onChange={(e) => onPatch({ resizeMode: parseInt(e.target.value, 10) as 0 | 1 | 2 })}
          >
            {RESIZE_MODES.map((m) => (
              <option key={m.value} value={m.value}>{t(m.key)}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex items-center gap-2 text-[11px] text-ink-2">
        <input
          type="checkbox"
          checked={unit.pixelPerfect}
          onChange={(e) => onPatch({ pixelPerfect: e.target.checked })}
        />
        <span>{t('cn.pixelPerfect')}</span>
      </label>
    </div>
  )
}

function filePathOf(file: File): string | null {
  const path = (file as File & { path?: string }).path
  return typeof path === 'string' && path.length > 0 ? path : null
}
