import { BookOpenText, Copy, LayoutTemplate, Plus, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { api } from '@/lib/ipc'
import { useStore } from '@/lib/store'
import { promptAppend } from '@/lib/prompt-utils'
import { useT, t as tStatic } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type {
  PromptDictionaryEntry,
  PromptDictionarySearchRequest,
  PromptDictionarySearchResult,
  PromptTagPolarity
} from '@shared/types'

const MAX_RESULTS = 36
type DictionaryAdultFilter = NonNullable<PromptDictionarySearchRequest['adult']>
type DictionaryPolarityFilter = 'all' | PromptTagPolarity

export function PromptDictionaryPanel(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searchResult, setSearchResult] = useState<PromptDictionarySearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [adultFilter, setAdultFilter] = useState<DictionaryAdultFilter>('all')
  const [polarityFilter, setPolarityFilter] = useState<DictionaryPolarityFilter>('all')
  const searchSeq = useRef(0)
  const prompt = useStore((s) => s.prompt)
  const negative = useStore((s) => s.negativePrompt)
  const setPrompt = useStore((s) => s.setPrompt)
  const setNegative = useStore((s) => s.setNegativePrompt)
  const slotInsertEnabled = useStore((s) => s.promptComposerSlotInsertEnabled)
  const slotInsertTarget = useStore((s) => s.promptComposerSlotInsertTarget)
  const appendPromptComposerSlotTag = useStore((s) => s.appendPromptComposerSlotTag)
  const pushRecent = useStore((s) => s.pushRecentTag)
  const t = useT()

  useEffect(() => {
    if (!open) return
    const timeout = window.setTimeout(() => {
      const seq = searchSeq.current + 1
      searchSeq.current = seq
      setLoading(true)
      setErrorMessage(null)
      api.promptDictionary.search(buildSearchRequest(query, adultFilter, polarityFilter))
        .then((result) => {
          if (searchSeq.current !== seq) return
          setSearchResult(result)
        })
        .catch((e) => {
          if (searchSeq.current !== seq) return
          setErrorMessage((e as Error).message)
          setSearchResult(null)
        })
        .finally(() => {
          if (searchSeq.current === seq) setLoading(false)
        })
    }, query.trim() ? 180 : 0)
    return () => window.clearTimeout(timeout)
  }, [open, query, adultFilter, polarityFilter])

  const results = searchResult?.entries ?? []

  function insertPositive(tag: string): void {
    if (slotInsertEnabled) {
      appendPromptComposerSlotTag(slotInsertTarget, tag)
      pushRecent(tag)
      toast.success(tStatic('promptDictionary.insertedSlot'))
      return
    }
    setPrompt(promptAppend(prompt, tag))
    pushRecent(tag)
  }

  function insertNegative(tag: string): void {
    setNegative(promptAppend(negative, tag))
    pushRecent(tag)
  }

  async function copyTag(tag: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(tag)
      toast.success(tStatic('promptDictionary.copied'))
    } catch (e) {
      toast.error(tStatic('promptDictionary.copyFailed', { message: (e as Error).message }))
    }
  }

  return (
    <section className="border border-line rounded-md bg-bg-0/60" data-testid="prompt-dictionary-panel">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-2 transition-colors"
        onClick={() => setOpen((v) => !v)}
        data-testid="prompt-dictionary-toggle"
      >
        <BookOpenText className="h-4 w-4 text-accent" />
        <span className="text-xs font-medium text-ink-1">{t('promptDictionary.title')}</span>
        {slotInsertEnabled && (
          <span className="ml-1 inline-flex items-center gap-1 rounded border border-accent/35 px-1.5 py-0.5 text-[10px] text-accent">
            <LayoutTemplate className="h-3 w-3" />
            Slots
          </span>
        )}
        <span className="ml-auto text-[10px] text-ink-3">{open ? t('common.close') : t('common.enable')}</span>
      </button>
      {open && (
        <div className="border-t border-line p-3 space-y-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-3" />
            <input
              className="input pl-7 text-xs"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('promptDictionary.placeholder')}
              data-testid="prompt-dictionary-search"
            />
          </div>
          <div className="flex items-center gap-2 text-[10px] text-ink-3">
            <span>{t('promptDictionary.hint')}</span>
            <span className="ml-auto" data-testid="prompt-dictionary-result-count">
              {loading
                ? t('promptDictionary.loading')
                : query.trim()
                  ? t('promptDictionary.count', { count: searchResult?.total ?? 0 })
              : t('promptDictionary.ready', { count: searchResult?.searchableCount ?? 0 })}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5" data-testid="prompt-dictionary-panel-filters">
            <select
              className="input h-7 text-[11px]"
              value={adultFilter}
              onChange={(event) => setAdultFilter(event.target.value as DictionaryAdultFilter)}
              data-testid="prompt-dictionary-adult-filter"
            >
              <option value="all">adult表示: すべて</option>
              <option value="safe">adult以外</option>
              <option value="adult">adultだけ確認</option>
            </select>
            <select
              className="input h-7 text-[11px]"
              value={polarityFilter}
              onChange={(event) => setPolarityFilter(event.target.value as DictionaryPolarityFilter)}
              data-testid="prompt-dictionary-polarity-filter"
            >
              <option value="all">用途: all</option>
              <option value="positive">Prompt</option>
              <option value="negative">Negative</option>
              <option value="both">Both</option>
            </select>
          </div>
          <div className="max-h-80 overflow-y-auto rounded border border-line bg-bg-1" data-testid="prompt-dictionary-results">
            {errorMessage ? (
              <div className="p-3 text-[11px] text-danger">{t('promptDictionary.failed', { message: errorMessage })}</div>
            ) : !query.trim() ? (
              <div className="p-3 text-[11px] text-ink-3">{t('promptDictionary.noQuery')}</div>
            ) : results.length === 0 ? (
              <div className="p-3 text-[11px] text-ink-3">{t('promptDictionary.empty')}</div>
            ) : (
              <div className="divide-y divide-line">
                {results.map((entry) => (
                  <DictionaryRow
                    key={`${entry.category}|${entry.group}|${entry.en}`}
                    entry={entry}
                    slotInsertEnabled={slotInsertEnabled}
                    onInsertPositive={insertPositive}
                    onInsertNegative={insertNegative}
                    onCopy={(tag) => { void copyTag(tag) }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function buildSearchRequest(
  query: string,
  adultFilter: DictionaryAdultFilter,
  polarityFilter: DictionaryPolarityFilter
): PromptDictionarySearchRequest {
  return {
    query,
    limit: MAX_RESULTS,
    adult: adultFilter,
    ...(polarityFilter === 'all' ? {} : { polarity: polarityFilter })
  }
}

function DictionaryRow({
  entry,
  slotInsertEnabled,
  onInsertPositive,
  onInsertNegative,
  onCopy
}: {
  entry: PromptDictionaryEntry
  slotInsertEnabled: boolean
  onInsertPositive(tag: string): void
  onInsertNegative(tag: string): void
  onCopy(tag: string): void
}): JSX.Element {
  const t = useT()
  const isNegative = entry.polarity === 'negative'
  const isAdult = entry.adultLevel > 0
  return (
    <div className="p-2.5 space-y-1.5" data-testid={`prompt-dictionary-row-${tagTestId(entry.en)}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[12px] text-ink-0 break-words">{entry.en}</div>
          {entry.ja && <div className="text-[11px] text-ink-2 leading-relaxed">{entry.ja}</div>}
          <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-ink-3">
            <span className="rounded border border-line px-1 py-0.5">{entry.category}</span>
            <span className="rounded border border-line px-1 py-0.5">{entry.group}</span>
            <span className="rounded border border-line px-1 py-0.5">{entry.sourceLabel}</span>
            {formatPostCount(entry.postCount) && (
              <span className="rounded border border-line px-1 py-0.5">{formatPostCount(entry.postCount)}</span>
            )}
            {entry.aliases.slice(0, 2).map((alias) => (
              <span key={alias} className="rounded border border-line px-1 py-0.5">{alias}</span>
            ))}
          </div>
        </div>
        <span className={cn(
          'rounded border px-1.5 py-0.5 text-[10px]',
          isNegative ? 'border-danger/40 text-danger' : 'border-accent/35 text-accent'
        )}>
          {entry.polarity}
        </span>
        {isAdult && (
          <span className="rounded border border-danger/40 px-1.5 py-0.5 text-[10px] text-danger">
            adult
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className="btn btn-primary h-7 px-2 text-[11px] gap-1"
          onClick={() => onInsertPositive(entry.en)}
          data-testid={`prompt-dictionary-insert-${tagTestId(entry.en)}`}
        >
          {slotInsertEnabled ? <LayoutTemplate className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {slotInsertEnabled ? t('promptDictionary.insertSlot') : t('promptDictionary.insert')}
        </button>
        <button
          type="button"
          className="btn h-7 px-2 text-[11px] gap-1"
          onClick={() => onInsertNegative(entry.en)}
          data-testid={`prompt-dictionary-negative-${tagTestId(entry.en)}`}
        >
          <X className="h-3.5 w-3.5" />
          {t('promptDictionary.insertNegative')}
        </button>
        <button
          type="button"
          className="btn h-7 px-2 text-[11px] gap-1"
          onClick={() => onCopy(entry.en)}
          data-testid={`prompt-dictionary-copy-${tagTestId(entry.en)}`}
        >
          <Copy className="h-3.5 w-3.5" />
          {t('common.copy')}
        </button>
      </div>
    </div>
  )
}

function tagTestId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'tag'
}

function formatPostCount(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN) || (value ?? 0) <= 0) return ''
  const count = Number(value)
  if (count >= 1000000) return `${Math.round(count / 100000) / 10}M`
  if (count >= 1000) return `${Math.round(count / 100) / 10}k`
  return `${count}`
}
