import { ArrowRightLeft, Eraser, ListChecks, Plus, ScanLine, Tags, Wand2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useStore } from '@/lib/store'
import { approxTokenCount, formatPromptText, promptAppend, splitPromptTokensWithRanges } from '@/lib/prompt-utils'
import { useT, t as tStatic } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { PromptHelperPanel } from './PromptHelperPanel'
import { PromptLibrary } from './PromptLibrary'
import { PromptTagChips } from './PromptTagChips'
import { QuickPresetBar } from './QuickPresetBar'

type TagTarget = 'positive' | 'negative'

interface TagGroup {
  id: string
  target: TagTarget
  labelKey: string
  tags: string[]
}

const TAG_GROUPS: TagGroup[] = [
  {
    id: 'quality',
    target: 'positive',
    labelKey: 'tagsWorkspace.group.quality',
    tags: ['masterpiece', 'best quality', 'highly detailed', 'sharp focus', 'beautiful lighting']
  },
  {
    id: 'composition',
    target: 'positive',
    labelKey: 'tagsWorkspace.group.composition',
    tags: ['portrait', 'upper body', 'full body', 'looking at viewer', 'dynamic pose', 'simple background']
  },
  {
    id: 'lighting',
    target: 'positive',
    labelKey: 'tagsWorkspace.group.lighting',
    tags: ['soft lighting', 'studio lighting', 'cinematic lighting', 'rim light', 'warm light', 'depth of field']
  },
  {
    id: 'negative',
    target: 'negative',
    labelKey: 'tagsWorkspace.group.negative',
    tags: ['lowres', 'bad anatomy', 'bad hands', 'extra fingers', 'text', 'logo', 'watermark', 'blurry']
  }
]

export function PromptTagsWorkspace(): JSX.Element {
  const prompt = useStore((s) => s.prompt)
  const negative = useStore((s) => s.negativePrompt)
  const setPrompt = useStore((s) => s.setPrompt)
  const setNegative = useStore((s) => s.setNegativePrompt)
  const [draft, setDraft] = useState('')
  const [target, setTarget] = useState<TagTarget>('positive')
  const t = useT()

  const positiveCount = useMemo(() => splitPromptTokensWithRanges(prompt).length, [prompt])
  const negativeCount = useMemo(() => splitPromptTokensWithRanges(negative).length, [negative])

  function changeTarget(next: TagTarget, value: string): void {
    if (next === 'positive') setPrompt(value)
    else setNegative(value)
  }

  function moveTokens(from: TagTarget, tokens: string[]): void {
    const to: TagTarget = from === 'positive' ? 'negative' : 'positive'
    const current = to === 'positive' ? prompt : negative
    const next = tokens.reduce((text, token) => promptAppend(text, token), current)
    changeTarget(to, next)
  }

  function addTags(nextTarget: TagTarget, raw: string): void {
    const tags = parseTagInput(raw)
    if (tags.length === 0) return
    const current = nextTarget === 'positive' ? prompt : negative
    const next = tags.reduce((text, tag) => promptAppend(text, tag), current)
    changeTarget(nextTarget, next)
    if (raw === draft) setDraft('')
    toast.success(tStatic('tagsWorkspace.added', { count: tags.length }))
  }

  function formatBoth(): void {
    const positiveResult = formatPromptText(prompt)
    const negativeResult = formatPromptText(negative)
    if (positiveResult.summary.changed) setPrompt(positiveResult.prompt)
    if (negativeResult.summary.changed) setNegative(negativeResult.prompt)
    if (!positiveResult.summary.changed && !negativeResult.summary.changed) {
      toast(tStatic('prompt.formatUnchanged'), { icon: 'i' })
    } else {
      toast.success(tStatic('prompt.formatted'))
    }
  }

  return (
    <main className="flex-1 overflow-auto bg-bg-0 p-5">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <header className="flex flex-wrap items-center gap-3 border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <Tags className="h-5 w-5 text-accent" />
            <h2 className="text-lg font-semibold text-ink-1">{t('tagsWorkspace.title')}</h2>
          </div>
          <TagStat label={t('prompt.label')} count={positiveCount} tokens={approxTokenCount(prompt)} />
          <TagStat label={t('prompt.negativeLabel')} count={negativeCount} tokens={approxTokenCount(negative)} tone="negative" />
          <button type="button" className="btn ml-auto text-xs gap-1.5" onClick={formatBoth}>
            <ScanLine className="h-3.5 w-3.5" />
            {t('tagsWorkspace.formatBoth')}
          </button>
        </header>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
          <section
            className="h-[calc(100vh-155px)] min-h-[620px] overflow-hidden rounded-md border border-line bg-bg-1"
            data-testid="tags-workspace-library"
          >
            <PromptLibrary />
          </section>

          <div className="space-y-3">
            <section className="rounded-md border border-line bg-bg-1 p-3" data-testid="tags-workspace-quick-add">
              <div className="flex flex-wrap items-center gap-2">
                <SegmentedTarget value={target} onChange={setTarget} />
                <input
                  className="input min-w-[240px] flex-1 text-xs"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addTags(target, draft)
                  }}
                  placeholder={t('tagsWorkspace.addPlaceholder')}
                />
                <button type="button" className="btn btn-primary text-xs gap-1.5" onClick={() => addTags(target, draft)}>
                  <Plus className="h-3.5 w-3.5" />
                  {t('tagsWorkspace.add')}
                </button>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-4">
                {TAG_GROUPS.map((group) => (
                  <div key={group.id} className="rounded border border-line/70 bg-bg-2/50 p-2">
                    <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-ink-3">
                      <ListChecks className="h-3 w-3" />
                      {t(group.labelKey)}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {group.tags.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          className={cn(
                            'rounded border px-1.5 py-0.5 text-[11px] transition-colors',
                            group.target === 'negative'
                              ? 'border-err/35 text-ink-2 hover:bg-err/20 hover:text-ink-0'
                              : 'border-line text-ink-2 hover:bg-bg-4 hover:text-ink-0'
                          )}
                          onClick={() => addTags(group.target, tag)}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
              <TagEditor
                target="positive"
                value={prompt}
                onChange={setPrompt}
                onMoveTokens={(tokens) => moveTokens('positive', tokens)}
                onClear={() => setPrompt('')}
              />
              <TagEditor
                target="negative"
                value={negative}
                onChange={setNegative}
                onMoveTokens={(tokens) => moveTokens('negative', tokens)}
                onClear={() => setNegative('')}
              />
            </div>
          </div>
        </div>

        <PromptHelperPanel />
      </div>
    </main>
  )
}

function TagEditor({
  target,
  value,
  onChange,
  onMoveTokens,
  onClear
}: {
  target: TagTarget
  value: string
  onChange(value: string): void
  onMoveTokens(tokens: string[]): void
  onClear(): void
}): JSX.Element {
  const t = useT()
  const title = target === 'positive' ? t('prompt.label') : t('prompt.negativeLabel')
  return (
    <section className="flex min-h-[420px] flex-col gap-2 rounded-md border border-line bg-bg-1 p-3" data-testid={`tags-workspace-${target}`}>
      <div className="flex items-center gap-2">
        <Wand2 className={cn('h-4 w-4', target === 'negative' ? 'text-err' : 'text-accent')} />
        <h3 className="text-sm font-semibold text-ink-1">{title}</h3>
        <button type="button" className="btn btn-ghost ml-auto h-7 px-2 text-[10px] gap-1" onClick={onClear}>
          <Eraser className="h-3 w-3" />
          {t('tagsWorkspace.clear')}
        </button>
      </div>
      <QuickPresetBar target={target} value={value} onChange={onChange} />
      <textarea
        className="input min-h-[120px] resize-y font-mono text-xs leading-relaxed"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={target === 'positive' ? t('prompt.placeholder') : t('prompt.negativePlaceholder')}
      />
      <PromptTagChips target={target} value={value} onChange={onChange} onMoveTokens={onMoveTokens} />
      <div className="mt-auto flex items-center gap-2 text-[10px] text-ink-3">
        <ArrowRightLeft className="h-3 w-3" />
        <span>{t(target === 'positive' ? 'promptTags.batchMoveToNegative' : 'promptTags.batchMoveToPositive')}</span>
      </div>
    </section>
  )
}

function SegmentedTarget({ value, onChange }: { value: TagTarget; onChange(value: TagTarget): void }): JSX.Element {
  const t = useT()
  return (
    <div className="inline-flex rounded-md border border-line bg-bg-2 p-0.5">
      {(['positive', 'negative'] as const).map((item) => (
        <button
          key={item}
          type="button"
          className={cn(
            'rounded px-2 py-1 text-xs transition-colors',
            value === item ? 'bg-accent text-bg-0' : 'text-ink-2 hover:bg-bg-4 hover:text-ink-0'
          )}
          onClick={() => onChange(item)}
        >
          {item === 'positive' ? t('prompt.label') : t('prompt.negativeLabel')}
        </button>
      ))}
    </div>
  )
}

function TagStat({
  label,
  count,
  tokens,
  tone = 'positive'
}: {
  label: string
  count: number
  tokens: number
  tone?: TagTarget
}): JSX.Element {
  return (
    <div className={cn(
      'rounded border bg-bg-1 px-2 py-1 text-[10px]',
      tone === 'negative' ? 'border-err/30' : 'border-accent/30'
    )}>
      <span className="text-ink-3">{label}</span>
      <span className="ml-2 font-mono text-ink-1">{count}</span>
      <span className="ml-1 font-mono text-ink-3">/ {tokens} tok</span>
    </div>
  )
}

function parseTagInput(value: string): string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const raw of value.split(/[,\n]/)) {
    const tag = raw.trim()
    const key = tag.toLowerCase().replace(/\s+/g, ' ')
    if (!tag || seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
  }
  return tags
}
