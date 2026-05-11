import { Plus, Trash2 } from 'lucide-react'
import { useStore } from '@/lib/store'
import { useT } from '@/lib/i18n'
import { CollapsiblePanel } from '../CollapsiblePanel'
import { Slider, SelectField } from './controls'

/**
 * ADetailer (Bing-su/adetailer) — auto-detects faces / hands / persons in
 * generated images and inpaints each detection at higher quality. The most
 * common use is two units (face + hand); we let the user add up to four.
 *
 * Why we hand-curate the model list rather than fetching it from Forge:
 * ADetailer's models live in `models/adetailer/` and download lazily on
 * first use. Querying their availability requires Forge to be initialized
 * with the extension loaded, and a stale list is worse than a known-good
 * default — so we hardcode the canonical set. Power users can edit the
 * dropdown freely (the field is a free-form string under the hood) by
 * dropping their own .pt into the folder and refreshing.
 */
const COMMON_MODELS = [
  'face_yolov8n.pt',
  'face_yolov8s.pt',
  'hand_yolov8n.pt',
  'person_yolov8n-seg.pt',
  'person_yolov8s-seg.pt',
  // YOLO-World v2 — supports open-vocabulary detection via `ad_model_classes`.
  // Use this when you want to distinguish "left hand" / "right hand" / etc.
  'yolov8x-worldv2.pt',
  'mediapipe_face_full',
  'mediapipe_face_short',
  'mediapipe_face_mesh',
  'None'
] as const

/** Models that support `ad_model_classes` open-vocabulary class filtering. */
const WORLD_MODELS = new Set<string>([
  'yolov8x-worldv2.pt'
])

export function ADetailerPanel(): JSX.Element {
  const a = useStore((s) => s.adetailer)
  const patchA = useStore((s) => s.patchAdetailer)
  const patchUnit = useStore((s) => s.patchAdetailerUnit)
  const addUnit = useStore((s) => s.addAdetailerUnit)
  const removeUnit = useStore((s) => s.removeAdetailerUnit)
  const t = useT()

  return (
    <CollapsiblePanel
      title={t('ad.title')}
      hint={t('ad.hint')}
      enabled={a.enabled}
      onEnabledChange={(v) => patchA({ enabled: v })}
    >
      <div className="space-y-3">
        {a.units.map((u, i) => (
          <div key={i} className="border border-line rounded p-2 space-y-2 bg-bg-2/40">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-ink-3">
                {t('ad.unitLabel', { n: i + 1 })}
              </span>
              {a.units.length > 1 && (
                <button
                  type="button"
                  className="ml-auto btn btn-ghost btn-icon"
                  onClick={() => removeUnit(i)}
                  title={t('ad.removeUnit')}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>

            <SelectField
              label={t('ad.model')}
              value={u.model}
              options={COMMON_MODELS}
              onChange={(v) => patchUnit(i, { model: v })}
            />

            {/* ad_model_classes — open-vocabulary class filter for YOLO-world
                models. We only show this for models known to support it,
                otherwise it's a confusing no-op. */}
            {WORLD_MODELS.has(u.model) && (
              <label className="block">
                <span className="text-[10px] text-ink-3">{t('ad.modelClasses')}</span>
                <input
                  className="input text-[11px] py-1 w-full font-mono"
                  value={u.modelClasses}
                  onChange={(e) => patchUnit(i, { modelClasses: e.target.value })}
                  placeholder={t('ad.modelClassesPlaceholder')}
                />
                <span className="text-[10px] text-ink-3 leading-relaxed mt-0.5 block">
                  {t('ad.modelClassesHint')}
                </span>
              </label>
            )}

            <label className="block">
              <span className="text-[10px] text-ink-3">{t('ad.prompt')}</span>
              <input
                className="input text-[11px] py-1 w-full"
                value={u.prompt}
                onChange={(e) => patchUnit(i, { prompt: e.target.value })}
                placeholder={t('ad.promptPlaceholder')}
              />
            </label>

            <label className="block">
              <span className="text-[10px] text-ink-3">{t('ad.negativePrompt')}</span>
              <input
                className="input text-[11px] py-1 w-full"
                value={u.negativePrompt}
                onChange={(e) => patchUnit(i, { negativePrompt: e.target.value })}
                placeholder={t('ad.negativePromptPlaceholder')}
              />
            </label>

            <div className="grid grid-cols-2 gap-x-3">
              <Slider
                label={t('ad.confidence')}
                value={u.confidence}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => patchUnit(i, { confidence: v })}
              />
              <Slider
                label={t('ad.denoise')}
                value={u.denoisingStrength}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => patchUnit(i, { denoisingStrength: v })}
              />
              <Slider
                label={t('ad.maskBlur')}
                value={u.maskBlur}
                min={0}
                max={32}
                step={1}
                onChange={(v) => patchUnit(i, { maskBlur: v })}
              />
              <Slider
                label={t('ad.inpaintPadding')}
                value={u.inpaintOnlyMaskedPadding}
                min={0}
                max={256}
                step={4}
                onChange={(v) => patchUnit(i, { inpaintOnlyMaskedPadding: v })}
              />
              <Slider
                label={t('ad.dilateErode')}
                value={u.dilateErode}
                min={-32}
                max={32}
                step={1}
                onChange={(v) => patchUnit(i, { dilateErode: v })}
              />
            </div>
          </div>
        ))}

        {a.units.length < 4 && (
          <button
            type="button"
            className="btn w-full text-xs gap-1.5"
            onClick={addUnit}
          >
            <Plus className="h-3 w-3" />
            {t('ad.addUnit')}
          </button>
        )}

        <label className="flex items-center gap-2 text-[11px] text-ink-2">
          <input
            type="checkbox"
            checked={a.skipImg2img}
            onChange={(e) => patchA({ skipImg2img: e.target.checked })}
          />
          <span>{t('ad.skipImg2img')}</span>
        </label>
      </div>
    </CollapsiblePanel>
  )
}
