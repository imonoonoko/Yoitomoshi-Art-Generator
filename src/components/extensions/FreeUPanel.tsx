import { useStore } from '@/lib/store'
import { useT } from '@/lib/i18n'
import { CollapsiblePanel } from '../CollapsiblePanel'
import { Slider } from './controls'

/**
 * FreeU — Forge built-in `sd_forge_freeu`. Applies a "free" quality boost
 * during sampling by rescaling UNet skip + backbone activations. Only six
 * params, so no advanced sub-section is needed.
 *
 * Defaults:
 *   - SD 1.x: B1=1.01, B2=1.02, S1=0.99, S2=0.95 (paper recommendation)
 *   - SDXL benefits from slightly different values (e.g. B1=1.1, B2=1.2)
 *     but we keep the conservative SD 1.x defaults — the user can tweak.
 */
export function FreeUPanel(): JSX.Element {
  const f = useStore((s) => s.freeu)
  const patch = useStore((s) => s.patchFreeu)
  const t = useT()

  return (
    <CollapsiblePanel
      title={t('freeu.title')}
      hint={t('freeu.hint')}
      enabled={f.enabled}
      onEnabledChange={(v) => patch({ enabled: v })}
    >
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <Slider
          label="B1"
          value={f.b1}
          min={0}
          max={2}
          step={0.01}
          onChange={(v) => patch({ b1: v })}
        />
        <Slider
          label="B2"
          value={f.b2}
          min={0}
          max={2}
          step={0.01}
          onChange={(v) => patch({ b2: v })}
        />
        <Slider
          label="S1"
          value={f.s1}
          min={0}
          max={4}
          step={0.01}
          onChange={(v) => patch({ s1: v })}
        />
        <Slider
          label="S2"
          value={f.s2}
          min={0}
          max={4}
          step={0.01}
          onChange={(v) => patch({ s2: v })}
        />
      </div>
      <Slider
        label={t('freeu.startStep')}
        value={f.startStep}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => patch({ startStep: v })}
      />
      <Slider
        label={t('freeu.endStep')}
        value={f.endStep}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => patch({ endStep: v })}
      />
      <p className="text-[10px] text-ink-3 leading-relaxed pt-1">
        {t('freeu.bsHint')}
      </p>
    </CollapsiblePanel>
  )
}
