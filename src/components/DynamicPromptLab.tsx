import { AlertTriangle, Braces, Dice5, GitCompare, Hash, Plus, ShieldCheck, Shuffle, Wand2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { promptAppend } from '@/lib/prompt-utils'
import {
  buildDynamicPromptContext,
  hasDynamicPromptSyntax,
  previewDynamicPrompts
} from '@/lib/dynamic-prompts'
import { useT, t as tStatic } from '@/lib/i18n'

const PREVIEW_COUNTS = [2, 4, 8] as const
const TEMPLATE_SNIPPETS = [
  { id: 'clothing', labelKey: 'dynamicPrompt.snippet.clothing', text: '{kimono|school uniform|hoodie|maid dress}' },
  { id: 'expression', labelKey: 'dynamicPrompt.snippet.expression', text: '{4::smile|2::serious|1::crying}' },
  { id: 'background', labelKey: 'dynamicPrompt.snippet.background', text: '{city street|night market|quiet room|flower garden}' }
]

export function DynamicPromptLab(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [previewSeed, setPreviewSeed] = useState(1001)
  const [previewCount, setPreviewCount] = useState<(typeof PREVIEW_COUNTS)[number]>(4)
  const prompt = useStore((s) => s.prompt)
  const negative = useStore((s) => s.negativePrompt)
  const params = useStore((s) => s.params)
  const library = useStore((s) => s.library)
  const customLibrary = useStore((s) => s.customLibrary)
  const history = useStore((s) => s.history)
  const recentTags = useStore((s) => s.recentTags)
  const favorites = useStore((s) => s.favorites)
  const setPrompt = useStore((s) => s.setPrompt)
  const setNegativePrompt = useStore((s) => s.setNegativePrompt)
  const patchParams = useStore((s) => s.patchParams)
  const patchControlnet = useStore((s) => s.patchControlnet)
  const patchControlnetUnit = useStore((s) => s.patchControlnetUnit)
  const t = useT()

  const context = useMemo(
    () => buildDynamicPromptContext({ library, customLibrary, history, recentTags, favorites }),
    [customLibrary, favorites, history, library, recentTags]
  )
  const promptPreview = useMemo(
    () => previewDynamicPrompts(prompt, context, { count: previewCount, seed: previewSeed }),
    [context, previewCount, previewSeed, prompt]
  )
  const negativePreview = useMemo(
    () => previewDynamicPrompts(negative, context, { count: previewCount, seed: previewSeed + 101 }),
    [context, negative, previewCount, previewSeed]
  )
  const wildcardSources = useMemo(
    () => Array.from(context.wildcards.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 24),
    [context]
  )
  const hasDynamic = hasDynamicPromptSyntax(prompt) || hasDynamicPromptSyntax(negative)
  const promptErrors = promptPreview.issues.filter((issue) => issue.severity === 'error')
  const negativeErrors = negativePreview.issues.filter((issue) => issue.severity === 'error')
  const issueCount = promptPreview.issues.length + negativePreview.issues.length

  function appendSnippet(text: string): void {
    setPrompt(promptAppend(prompt, text))
  }

  function appendWildcard(name: string): void {
    setPrompt(promptAppend(prompt, `__${name}__`))
  }

  function applyFirstPreview(): void {
    const first = promptPreview.prompts[0]
    if (!first || promptErrors.length > 0) return
    setPrompt(first)
    toast.success(tStatic('dynamicPrompt.previewApplied'))
  }

  function applyFirstNegativePreview(): void {
    const first = negativePreview.prompts[0]
    if (!first || negativeErrors.length > 0) return
    setNegativePrompt(first)
    toast.success(tStatic('dynamicPrompt.negativeApplied'))
  }

  function lockPromptSeed(): void {
    patchParams({ seed: previewSeed })
    toast.success(tStatic('dynamicPrompt.seedLocked', { seed: previewSeed }))
  }

  function prepareControlNetLock(): void {
    patchControlnet({ enabled: true })
    patchControlnetUnit(0, {
      enabled: true,
      controlMode: 2,
      pixelPerfect: true,
      weight: 1
    })
    toast.success(tStatic('dynamicPrompt.controlNetPrepared'))
  }

  return (
    <section className="border border-line rounded-md bg-bg-0/60" data-testid="dynamic-prompt-lab">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-2 transition-colors"
        onClick={() => setOpen((value) => !value)}
        data-testid="dynamic-prompt-toggle"
      >
        <Braces className="h-4 w-4 text-accent" />
        <span className="text-xs font-medium text-ink-1">{t('dynamicPrompt.title')}</span>
        <span className={cn('ml-auto rounded px-1.5 py-0.5 text-[10px] font-mono', hasDynamic ? 'bg-accent/15 text-accent' : 'bg-bg-3 text-ink-3')}>
          {hasDynamic ? t('dynamicPrompt.active') : t('dynamicPrompt.idle')}
        </span>
      </button>

      {open && (
        <div className="border-t border-line p-3 space-y-2">
          <div className="grid grid-cols-[1fr_auto_auto] gap-1.5 items-center">
            <label className="min-w-0">
              <span className="sr-only">{t('dynamicPrompt.seed')}</span>
              <input
                className="input h-8 text-xs font-mono"
                type="number"
                value={previewSeed}
                min={1}
                max={2_147_483_647}
                onChange={(e) => setPreviewSeed(Math.max(1, Math.min(2_147_483_647, Math.round(Number(e.target.value) || 1))))}
                data-testid="dynamic-prompt-seed"
              />
            </label>
            <select
              className="input h-8 w-16 text-xs"
              value={previewCount}
              onChange={(e) => setPreviewCount(Number(e.target.value) as (typeof PREVIEW_COUNTS)[number])}
              data-testid="dynamic-prompt-count"
            >
              {PREVIEW_COUNTS.map((count) => (
                <option key={count} value={count}>{count}</option>
              ))}
            </select>
            <button className="btn h-8 px-2 text-xs gap-1" onClick={lockPromptSeed} title={t('dynamicPrompt.lockSeed')}>
              <Dice5 className="h-3.5 w-3.5" />
              {params.seed === previewSeed ? t('dynamicPrompt.seedLockedShort') : t('dynamicPrompt.seedShort')}
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {TEMPLATE_SNIPPETS.map((snippet) => (
              <button
                key={snippet.id}
                className="btn justify-center text-[10px] py-1 gap-1"
                onClick={() => appendSnippet(snippet.text)}
              >
                <Plus className="h-3 w-3" />
                {t(snippet.labelKey)}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            <button
              className="btn justify-center text-[10px] py-1 gap-1"
              disabled={promptPreview.prompts.length === 0 || promptErrors.length > 0}
              onClick={applyFirstPreview}
              data-testid="dynamic-prompt-apply-preview"
            >
              <Wand2 className="h-3 w-3" />
              {t('dynamicPrompt.applyFirst')}
            </button>
            <button
              className="btn justify-center text-[10px] py-1 gap-1"
              disabled={!hasDynamicPromptSyntax(negative) || negativePreview.prompts.length === 0 || negativeErrors.length > 0}
              onClick={applyFirstNegativePreview}
            >
              <ShieldCheck className="h-3 w-3" />
              {t('dynamicPrompt.applyNegative')}
            </button>
            <button
              className="btn justify-center text-[10px] py-1 gap-1"
              onClick={prepareControlNetLock}
            >
              <GitCompare className="h-3 w-3" />
              {t('dynamicPrompt.controlNet')}
            </button>
          </div>

          <div className="rounded-md border border-line bg-bg-2/60 p-2 space-y-1" data-testid="dynamic-prompt-summary">
            <div className="flex items-center gap-1.5 text-[10px] text-ink-3">
              <Shuffle className="h-3 w-3 text-accent" />
              <span>{t('dynamicPrompt.estimate', { count: String(promptPreview.estimate) })}</span>
              <span className="ml-auto">{t('dynamicPrompt.issues', { count: issueCount })}</span>
            </div>
            {promptPreview.prompts.slice(0, previewCount).map((item, index) => (
              <div key={`${index}-${item}`} className="truncate rounded bg-bg-1 px-1.5 py-1 font-mono text-[10px] text-ink-2">
                {index + 1}. {item || '-'}
              </div>
            ))}
          </div>

          {issueCount > 0 && (
            <div className="space-y-1" data-testid="dynamic-prompt-issues">
              {[...promptPreview.issues, ...negativePreview.issues].slice(0, 4).map((issue, index) => (
                <div key={`${issue.code}-${index}`} className={cn('flex items-start gap-1.5 text-[10px]', issue.severity === 'error' ? 'text-err' : 'text-warn')}>
                  <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                  <span className="min-w-0">{issue.message}</span>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-ink-3">
              <Hash className="h-3 w-3" />
              {t('dynamicPrompt.wildcards')}
              <span className="ml-auto font-mono">{context.wildcards.size}</span>
            </div>
            <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto">
              {wildcardSources.map((source) => (
                <button
                  key={source.name}
                  className="rounded border border-line bg-bg-2 px-1.5 py-0.5 text-[10px] text-ink-2 hover:bg-bg-4 hover:text-ink-0"
                  onClick={() => appendWildcard(source.name)}
                  title={`${source.label} (${source.values.length})`}
                >
                  __{source.name}__
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
