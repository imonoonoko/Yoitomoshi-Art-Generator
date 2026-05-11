import { Dice5, Lock, AlertTriangle } from 'lucide-react'
import { useStore } from '@/lib/store'
import { snapTo } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { NumberField } from './NumberField'

const PRESET_SIZES = [
  { label: '512²', w: 512, h: 512 },
  { label: '768×1024', w: 768, h: 1024 },
  { label: '1024×768', w: 1024, h: 768 },
  { label: '1024²', w: 1024, h: 1024 },
  { label: '832×1216', w: 832, h: 1216 },
  { label: '1216×832', w: 1216, h: 832 }
]

export function ParametersPanel(): JSX.Element {
  const params = useStore((s) => s.params)
  const patch = useStore((s) => s.patchParams)
  const samplers = useStore((s) => s.samplers)
  const schedulers = useStore((s) => s.schedulers)
  const recommendation = useStore((s) => s.recommendation)
  const vaes = useStore((s) => s.vaes)
  const selectedVae = useStore((s) => s.selectedVae)
  const setSelectedVae = useStore((s) => s.setSelectedVae)

  const t = useT()
  const seedLocked = params.seed !== -1
  const vramWarning = computeVramWarning(
    params.width,
    params.height,
    params.batchSize,
    recommendation?.baseModel ?? null,
    t
  )

  return (
    <div className="grid grid-cols-2 gap-2.5">
      <NumberField
        label="Steps"
        value={params.steps}
        min={1}
        max={150}
        onChange={(v) => patch({ steps: Math.round(v) })}
      />
      <NumberField
        label="CFG"
        value={params.cfgScale}
        min={1}
        max={30}
        step={0.5}
        onChange={(v) => patch({ cfgScale: v })}
      />

      <NumberField
        label="Width"
        value={params.width}
        min={64}
        max={2048}
        step={64}
        hint={t('params.unit64')}
        onChange={(v) => patch({ width: snapTo(v, 8) })}
      />
      <NumberField
        label="Height"
        value={params.height}
        min={64}
        max={2048}
        step={64}
        hint={t('params.unit64')}
        onChange={(v) => patch({ height: snapTo(v, 8) })}
      />

      <div className="col-span-2 flex flex-wrap gap-1">
        {PRESET_SIZES.map((p) => (
          <button
            key={p.label}
            className="btn btn-ghost text-xs px-2 py-0.5"
            onClick={() => patch({ width: p.w, height: p.h })}
          >
            {p.label}
          </button>
        ))}
      </div>

      {vramWarning && (
        <div className="col-span-2 flex items-start gap-1.5 px-2 py-1.5 rounded border border-warn/40 bg-warn/10 text-[10px] text-warn">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span className="leading-tight">{vramWarning}</span>
        </div>
      )}

      <label className="flex flex-col gap-1 col-span-2">
        <span className="label">Sampler</span>
        <select
          className="input"
          value={params.sampler}
          onChange={(e) => patch({ sampler: e.target.value })}
        >
          {samplers.length === 0 && <option value={params.sampler}>{params.sampler}</option>}
          {samplers.map((s) => (
            <option key={s.name} value={s.name}>{s.name}</option>
          ))}
        </select>
      </label>

      {schedulers.length > 0 && (
        <label className="flex flex-col gap-1 col-span-2">
          <span className="label">Scheduler</span>
          <select
            className="input"
            value={params.scheduler}
            onChange={(e) => patch({ scheduler: e.target.value })}
          >
            <option value="">—</option>
            {schedulers.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
      )}

      <label className="flex flex-col gap-1 col-span-2">
        <span className="label flex items-baseline justify-between">
          <span>VAE</span>
          {selectedVae !== 'Automatic' && (
            <button
              type="button"
              onClick={() => setSelectedVae('Automatic')}
              className="text-[10px] text-ink-3 hover:text-ink-1 normal-case tracking-normal"
            >
              {t('params.reset')}
            </button>
          )}
        </span>
        <select
          className="input"
          value={selectedVae}
          onChange={(e) => setSelectedVae(e.target.value)}
        >
          {vaes.map((v) => (
            <option key={v.modelName} value={v.modelName}>
              {v.modelName}
            </option>
          ))}
        </select>
      </label>

      <div className="col-span-2 flex gap-1.5">
        <NumberField
          label="Seed"
          value={params.seed}
          step={1}
          onChange={(v) => patch({ seed: Math.round(v) })}
          className="flex-1"
        />
        <div className="flex flex-col justify-end gap-1">
          <button
            className="btn btn-icon"
            title={seedLocked ? t('params.seedUnlock') : t('params.seedLock')}
            onClick={() => patch({ seed: seedLocked ? -1 : Math.floor(Math.random() * 2 ** 31) })}
          >
            {seedLocked ? <Lock className="h-4 w-4" /> : <Dice5 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <NumberField
        label={t('params.batch')}
        value={params.batchSize}
        min={1}
        max={8}
        onChange={(v) => patch({ batchSize: Math.round(v) })}
      />
      <NumberField
        label={t('params.iterations')}
        value={params.iterations}
        min={1}
        max={20}
        onChange={(v) => patch({ iterations: Math.round(v) })}
      />

      <NumberField
        label="Clip Skip"
        value={params.clipSkip}
        min={1}
        max={4}
        onChange={(v) => patch({ clipSkip: Math.round(v) })}
        className="col-span-2"
      />
    </div>
  )
}

/**
 * Heuristic VRAM-pressure warning tuned for an 8GB card (the user's RTX 4060 Ti).
 *
 * SDXL/Pony/NoobAI/Illustrious are 12GB-class on a fresh boot but Forge's memory
 * management lets them limp along on 8GB at 1024² with batch=1. Anything bigger
 * starts swapping or OOM-ing — flag it before the user hits a generation failure.
 *
 * Rules (cheap to compute, conservative):
 *   - SDXL family + > 1024×1024 single-image          → warn
 *   - SDXL family + batch ≥ 2 at 1024² or higher       → warn
 *   - SD1.5 + > 768² single OR batch ≥ 4 at 768² high  → warn
 *   - Unknown base model (no Civitai metadata) + > 1024² → soft warn
 */
function computeVramWarning(
  width: number,
  height: number,
  batch: number,
  baseModel: string | null,
  t: (key: string, params?: Record<string, string | number>) => string
): string | null {
  const pixels = width * height
  const total = pixels * batch
  const isXL = baseModel != null && /SDXL|Pony|NoobAI|Illustrious|FLUX/i.test(baseModel)
  const is15 = baseModel === 'SD 1.5'

  // 1024×1024 = 1.05M pixels.
  if (isXL) {
    if (pixels > 1024 * 1024 && batch >= 1) {
      return t('params.vramSdxlSingle', { width, height })
    }
    if (pixels >= 1024 * 1024 && batch >= 2) {
      return t('params.vramSdxlBatch', { width, height, batch })
    }
  } else if (is15) {
    if (pixels > 768 * 768 && batch >= 1) {
      return t('params.vramSd15', { width, height })
    }
  } else if (baseModel == null) {
    if (total > 1024 * 1024 * 1.5) {
      return t('params.vramUnknown', { mp: (total / 1_000_000).toFixed(2) })
    }
  }
  return null
}
