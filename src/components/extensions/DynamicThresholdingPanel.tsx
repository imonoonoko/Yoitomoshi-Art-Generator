import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useStore } from '@/lib/store'
import { useT } from '@/lib/i18n'
import { CollapsiblePanel } from '../CollapsiblePanel'
import { Slider, SelectField } from './controls'
import { cn } from '@/lib/utils'

/**
 * Dynamic Thresholding (CFG-Fix) — Forge built-in `sd_forge_dynamic_thresholding`.
 *
 * Allows the user to push CFG higher than usual without burning out colors:
 * the sampler is told to compute against a "mimic" CFG, then percentile-clipped
 * back into the real range. Useful when high prompt adherence is wanted but
 * CFG ≥ 12 produces over-saturated/noisy output.
 *
 * UX:
 *   - Header shows enabled toggle + title; expanded body has primary sliders.
 *   - "Advanced" sub-toggle reveals the 8 less-common params (mode dropdowns,
 *     min scales, scaling/variability options). Defaults are matched to
 *     Forge's own UI defaults so a user who just flips Enabled gets the
 *     same baseline behavior as in the Gradio UI.
 */

const MODES = [
  'Constant', 'Linear Down', 'Cosine Down', 'Half Cosine Down',
  'Linear Up', 'Cosine Up', 'Half Cosine Up', 'Power Up', 'Power Down',
  'Linear Repeating', 'Cosine Repeating', 'Sawtooth'
] as const

export function DynamicThresholdingPanel(): JSX.Element {
  const dt = useStore((s) => s.dynThres)
  const patch = useStore((s) => s.patchDynThres)
  const t = useT()
  const [advancedOpen, setAdvancedOpen] = useState(false)

  return (
    <CollapsiblePanel
      title={t('dt.title')}
      hint={t('dt.hint')}
      enabled={dt.enabled}
      onEnabledChange={(v) => patch({ enabled: v })}
      testId="dynamic-thresholding-panel"
    >
      <Slider
        label={t('dt.mimicScale')}
        value={dt.mimicScale}
        min={0}
        max={30}
        step={0.5}
        onChange={(v) => patch({ mimicScale: v })}
      />
      <Slider
        label={t('dt.thresholdPercentile')}
        value={dt.thresholdPercentile}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => patch({ thresholdPercentile: v })}
      />

      <button
        type="button"
        className="flex items-center gap-1 text-[10px] text-ink-3 hover:text-ink-1 mt-1"
        onClick={() => setAdvancedOpen((o) => !o)}
      >
        <ChevronRight className={cn('h-3 w-3 transition-transform', advancedOpen && 'rotate-90')} />
        <span>{t('dt.advanced')}</span>
      </button>

      {advancedOpen && (
        <div className="space-y-2 pl-2 border-l border-line">
          <SelectField
            label={t('dt.mimicMode')}
            value={dt.mimicMode}
            options={MODES}
            onChange={(v) => patch({ mimicMode: v })}
          />
          <Slider
            label={t('dt.mimicScaleMin')}
            value={dt.mimicScaleMin}
            min={0}
            max={30}
            step={0.5}
            onChange={(v) => patch({ mimicScaleMin: v })}
          />
          <SelectField
            label={t('dt.cfgMode')}
            value={dt.cfgMode}
            options={MODES}
            onChange={(v) => patch({ cfgMode: v })}
          />
          <Slider
            label={t('dt.cfgScaleMin')}
            value={dt.cfgScaleMin}
            min={0}
            max={30}
            step={0.5}
            onChange={(v) => patch({ cfgScaleMin: v })}
          />
          <Slider
            label={t('dt.schedVal')}
            value={dt.schedVal}
            min={0}
            max={10}
            step={0.01}
            onChange={(v) => patch({ schedVal: v })}
          />
          <SelectField
            label={t('dt.separateFeatureChannels')}
            value={dt.separateFeatureChannels}
            options={['enable', 'disable']}
            onChange={(v) => patch({ separateFeatureChannels: v as 'enable' | 'disable' })}
          />
          <SelectField
            label={t('dt.scalingStartpoint')}
            value={dt.scalingStartpoint}
            options={['MEAN', 'ZERO']}
            onChange={(v) => patch({ scalingStartpoint: v as 'MEAN' | 'ZERO' })}
          />
          <SelectField
            label={t('dt.variabilityMeasure')}
            value={dt.variabilityMeasure}
            options={['AD', 'STD']}
            onChange={(v) => patch({ variabilityMeasure: v as 'AD' | 'STD' })}
          />
          <Slider
            label={t('dt.interpolatePhi')}
            value={dt.interpolatePhi}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => patch({ interpolatePhi: v })}
          />
        </div>
      )}
    </CollapsiblePanel>
  )
}
