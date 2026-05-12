import { Grid2X2, Plus, Trash2, Wand2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore, type RegionalPrompterSplitMode } from '@/lib/store'
import { useT, t as tStatic } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { CollapsiblePanel } from '../CollapsiblePanel'

export function RegionalPrompterPanel(): JSX.Element {
  const regional = useStore((s) => s.regionalPrompter)
  const patch = useStore((s) => s.patchRegionalPrompter)
  const setPrompt = useStore((s) => s.setPrompt)
  const t = useT()

  function updateRegion(index: number, value: string): void {
    patch({
      regionPrompts: regional.regionPrompts.map((prompt, i) => i === index ? value : prompt)
    })
  }

  function addRegion(): void {
    const next = [...regional.regionPrompts, tStatic('regional.regionPlaceholder', { n: regional.regionPrompts.length + 1 })]
    patch({ regionPrompts: next, ratios: ratioFor(next.length, regional.splitMode) })
  }

  function removeRegion(index: number): void {
    if (regional.regionPrompts.length <= 1) return
    const next = regional.regionPrompts.filter((_prompt, i) => i !== index)
    patch({ regionPrompts: next, ratios: ratioFor(next.length, regional.splitMode) })
  }

  function changeMode(mode: RegionalPrompterSplitMode): void {
    patch({ splitMode: mode, ratios: ratioFor(regional.regionPrompts.length, mode) })
  }

  function applyTemplate(): void {
    const prompt = buildRegionalPrompt(regional)
    if (!prompt) {
      toast.error(tStatic('regional.needPrompt'))
      return
    }
    setPrompt(prompt)
    patch({ enabled: true })
    toast.success(tStatic('regional.promptApplied'))
  }

  return (
    <CollapsiblePanel
      title={t('regional.title')}
      hint={t('regional.hint')}
      enabled={regional.enabled}
      onEnabledChange={(enabled) => patch({ enabled })}
    >
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-1">
          {(['Columns', 'Rows'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={cn(
                'rounded border px-2 py-1 text-xs transition-colors',
                regional.splitMode === mode
                  ? 'border-accent bg-accent/15 text-ink-0'
                  : 'border-line bg-bg-2 text-ink-2 hover:bg-bg-3'
              )}
              onClick={() => changeMode(mode)}
            >
              {t(mode === 'Columns' ? 'regional.columns' : 'regional.rows')}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[10px] text-ink-3">{t('regional.ratios')}</span>
            <input
              className="input w-full py-1 text-[11px] font-mono"
              value={regional.ratios}
              onChange={(e) => patch({ ratios: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="text-[10px] text-ink-3">{t('regional.baseRatios')}</span>
            <input
              className="input w-full py-1 text-[11px] font-mono"
              value={regional.baseRatios}
              onChange={(e) => patch({ baseRatios: e.target.value })}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-1 text-[11px] text-ink-2">
          <Toggle checked={regional.useCommon} label={t('regional.useCommon')} onChange={(useCommon) => patch({ useCommon })} />
          <Toggle checked={regional.useBase} label={t('regional.useBase')} onChange={(useBase) => patch({ useBase })} />
          <Toggle checked={regional.useCommonNegative} label={t('regional.useCommonNegative')} onChange={(useCommonNegative) => patch({ useCommonNegative })} />
          <Toggle checked={regional.flip} label={t('regional.flip')} onChange={(flip) => patch({ flip })} />
        </div>

        {regional.useCommon && (
          <PromptLine
            label={t('regional.commonPrompt')}
            value={regional.commonPrompt}
            onChange={(commonPrompt) => patch({ commonPrompt })}
          />
        )}
        {regional.useBase && (
          <PromptLine
            label={t('regional.basePrompt')}
            value={regional.basePrompt}
            onChange={(basePrompt) => patch({ basePrompt })}
          />
        )}

        <div className="space-y-1">
          {regional.regionPrompts.map((prompt, index) => (
            <div key={index} className="flex items-center gap-1">
              <span className="w-8 shrink-0 rounded bg-bg-3 px-1.5 py-1 text-center font-mono text-[10px] text-ink-3">
                R{index + 1}
              </span>
              <input
                className="input min-w-0 flex-1 py-1 text-[11px]"
                value={prompt}
                onChange={(e) => updateRegion(index, e.target.value)}
              />
              <button
                type="button"
                className="btn btn-icon btn-ghost h-7 w-7"
                onClick={() => removeRegion(index)}
                title={t('regional.removeRegion')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn justify-center text-xs" onClick={addRegion}>
            <Plus className="h-3.5 w-3.5" />
            {t('regional.addRegion')}
          </button>
          <button type="button" className="btn btn-primary justify-center text-xs" onClick={applyTemplate}>
            <Wand2 className="h-3.5 w-3.5" />
            {t('regional.applyPrompt')}
          </button>
        </div>

        <div className="rounded-md border border-line bg-bg-2/50 p-2">
          <div className="mb-1 flex items-center gap-1 text-[10px] text-ink-3">
            <Grid2X2 className="h-3 w-3 text-accent" />
            {t('regional.preview')}
          </div>
          <div className={cn('grid gap-1', regional.splitMode === 'Columns' ? 'grid-cols-2' : 'grid-cols-1')}>
            {regional.regionPrompts.map((prompt, index) => (
              <div key={index} className="min-h-10 rounded border border-line bg-bg-1 p-1.5 text-[10px] text-ink-2">
                <span className="font-mono text-accent">R{index + 1}</span>
                <span className="ml-1 line-clamp-2">{prompt}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </CollapsiblePanel>
  )
}

function PromptLine({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }): JSX.Element {
  return (
    <label className="block">
      <span className="text-[10px] text-ink-3">{label}</span>
      <input className="input w-full py-1 text-[11px]" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

function Toggle({ checked, label, onChange }: { checked: boolean; label: string; onChange(checked: boolean): void }): JSX.Element {
  return (
    <label className="flex items-center gap-1 rounded border border-line bg-bg-2 px-2 py-1">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0 truncate">{label}</span>
    </label>
  )
}

function buildRegionalPrompt(regional: ReturnType<typeof useStore.getState>['regionalPrompter']): string {
  const parts = [
    regional.useCommon ? regional.commonPrompt.trim() : '',
    regional.useBase ? regional.basePrompt.trim() : '',
    ...regional.regionPrompts.map((prompt) => prompt.trim())
  ].filter(Boolean)
  return parts.join(' BREAK\n')
}

function ratioFor(count: number, mode: RegionalPrompterSplitMode): string {
  const clamped = Math.max(1, count)
  const oneDim = Array.from({ length: clamped }, () => '1').join(',')
  return mode === 'Columns' ? oneDim : Array.from({ length: clamped }, () => '1').join(';')
}
