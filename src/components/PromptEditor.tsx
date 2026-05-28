import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/ipc'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { adjustTokenWeight } from '@/lib/prompt-utils'
import { useT } from '@/lib/i18n'
import {
  currentAutocompleteRange,
  autocompleteSuggestionBadge,
  autocompleteSuggestionSubtext,
  buildAutocompleteUsageHints,
  findLocalAutocompleteSuggestions,
  insertAutocompleteSuggestion,
  mergeAutocompleteSuggestions,
  PROMPT_DICTIONARY_AUTOCOMPLETE_DELAY_MS,
  PROMPT_DICTIONARY_AUTOCOMPLETE_LIMIT,
  shouldSearchAutocompleteQuery,
  suggestionFromDictionary,
  type PromptDictionaryAutocompleteSuggestion
} from '@/lib/prompt-dictionary-autocomplete'

interface Props {
  value: string
  onChange(v: string): void
  placeholder?: string
  rows?: number
  /** Visual variant. Negative prompts get a slight reddish tint. */
  tone?: 'positive' | 'negative'
  ariaLabel: string
  onSubmit?(): void
  testId?: string
}

type Suggestion = PromptDictionaryAutocompleteSuggestion

/**
 * Textarea with autocomplete fed by the main-process Prompt Daijiten service.
 * Ctrl+Space opens suggestions for the current token; Tab or Enter accepts.
 */
export function PromptEditor({
  value,
  onChange,
  placeholder,
  rows = 5,
  tone = 'positive',
  ariaLabel,
  onSubmit,
  testId
}: Props): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)
  const autocomplete = useStore((s) => s.autocomplete)
  const recentTags = useStore((s) => s.recentTags)
  const history = useStore((s) => s.history)
  const searchSeq = useRef(0)
  const searchTimer = useRef<number | null>(null)

  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [highlighted, setHighlighted] = useState(0)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeQuery, setActiveQuery] = useState('')
  const t = useT()
  const usageHints = useMemo(
    () => buildAutocompleteUsageHints(
      recentTags,
      history.slice(0, 80).map((item) => item.tagReview?.acceptedTags ?? [])
    ),
    [history, recentTags]
  )

  function findLocalSuggestions(token: string): Suggestion[] {
    return findLocalAutocompleteSuggestions(autocomplete, token, PROMPT_DICTIONARY_AUTOCOMPLETE_LIMIT)
  }

  function clearSearchTimer(): void {
    if (searchTimer.current !== null) {
      window.clearTimeout(searchTimer.current)
      searchTimer.current = null
    }
  }

  function searchSuggestions(text: string, caret: number, forced = false): void {
    const range = currentAutocompleteRange(text, caret)
    const token = range.query
    clearSearchTimer()
    if (!shouldSearchAutocompleteQuery(token, forced)) {
      setSuggestions([])
      setOpen(false)
      setLoading(false)
      setActiveQuery('')
      return
    }

    const seq = searchSeq.current + 1
    searchSeq.current = seq
    setActiveQuery(token)
    setLoading(true)
    setOpen(true)

    searchTimer.current = window.setTimeout(() => {
      api.promptDictionary.search({
        query: token,
        limit: PROMPT_DICTIONARY_AUTOCOMPLETE_LIMIT,
        polarity: tone === 'negative' ? 'negative' : 'positive'
      })
        .then((result) => {
          if (searchSeq.current !== seq) return
          const dictionarySuggestions = result.entries.map(suggestionFromDictionary)
          const seen = new Set(dictionarySuggestions.map((item) => item.en.toLowerCase()))
          const localSuggestions = findLocalSuggestions(token).filter((item) => !seen.has(item.en.toLowerCase()))
          const next = mergeAutocompleteSuggestions(
            dictionarySuggestions,
            localSuggestions,
            PROMPT_DICTIONARY_AUTOCOMPLETE_LIMIT,
            usageHints
          )
          setSuggestions(next)
          setHighlighted(0)
          setOpen(next.length > 0)
        })
        .catch(() => {
          if (searchSeq.current !== seq) return
          const fallback = findLocalSuggestions(token)
          setSuggestions(fallback)
          setHighlighted(0)
          setOpen(fallback.length > 0)
        })
        .finally(() => {
          if (searchSeq.current === seq) setLoading(false)
        })
    }, forced ? 0 : PROMPT_DICTIONARY_AUTOCOMPLETE_DELAY_MS)
  }

  function showAutocomplete(): void {
    const ta = ref.current
    if (!ta) return
    searchSuggestions(value, ta.selectionStart, true)
  }

  function refreshAutocomplete(text = value, caret = ref.current?.selectionStart ?? 0): void {
    if (!open) return
    searchSuggestions(text, caret)
  }

  function accept(s: Suggestion | undefined): void {
    if (!s) return
    const ta = ref.current
    if (!ta) return
    const inserted = insertAutocompleteSuggestion(
      value,
      currentAutocompleteRange(value, ta.selectionStart, ta.selectionEnd),
      s
    )
    onChange(inserted.value)
    setOpen(false)
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(inserted.caret, inserted.caret)
    })
  }

  function onTextChange(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    onChange(e.target.value)
    searchSuggestions(e.target.value, e.target.selectionStart)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    // Ctrl+Enter submits even when autocomplete is open.
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      setOpen(false)
      onSubmit?.()
      return
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === ' ' || e.code === 'Space')) {
      e.preventDefault()
      showAutocomplete()
      return
    }
    // Ctrl+ArrowUp/Down adjusts the weight of the token under the caret.
    if ((e.ctrlKey || e.metaKey) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      const ta = ref.current
      if (!ta) return
      const delta = e.key === 'ArrowUp' ? 0.1 : -0.1
      const r = adjustTokenWeight(value, ta.selectionStart, delta)
      onChange(r.prompt)
      requestAnimationFrame(() => {
        ta.focus()
        ta.setSelectionRange(r.caret, r.caret)
      })
      return
    }

    if (!open) return
    if (suggestions.length === 0) {
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted((h) => (h + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted((h) => (h - 1 + suggestions.length) % suggestions.length)
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault()
      accept(suggestions[highlighted])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  useEffect(() => {
    refreshAutocomplete()
    // refreshAutocomplete intentionally reads the current caret from ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, autocomplete])

  useEffect(() => () => clearSearchTimer(), [])

  return (
    <div className="relative">
      <textarea
        ref={ref}
        rows={rows}
        value={value}
        onChange={onTextChange}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onClick={() => refreshAutocomplete()}
        onSelect={() => refreshAutocomplete()}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-keyshortcuts="Control+Space"
        data-testid={testId}
        spellCheck={false}
        className={cn(
          'input resize-none font-mono text-[13px] leading-relaxed',
          'text-ink-0 caret-ink-0 selection:bg-accent/40 selection:text-ink-0',
          tone === 'negative' && 'border-line/60'
        )}
      />
      {open && (suggestions.length > 0 || loading) && (
        <div
          className="mt-1 max-h-[220px] overflow-auto rounded-md border border-line bg-bg-1 shadow-xl"
          data-testid={`${testId ?? 'prompt-editor'}-dictionary-suggestions`}
          data-query={activeQuery}
        >
          {loading && suggestions.length === 0 && (
            <div className="px-2.5 py-2 text-[11px] text-ink-3">{t('promptDictionary.loading')}</div>
          )}
          {suggestions.map((s, i) => (
            <button
              key={s.en}
              type="button"
              className={cn(
                'w-full text-left flex items-start gap-2 px-2.5 py-1.5 text-sm transition-colors',
                i === highlighted ? 'bg-bg-3 text-accent' : 'hover:bg-bg-3'
              )}
              onMouseDown={(e) => {
                e.preventDefault()
                accept(s)
              }}
              onMouseEnter={() => setHighlighted(i)}
              data-testid={`${testId ?? 'prompt-editor'}-dictionary-suggestion-${i}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[13px]">{s.en}</span>
                {autocompleteSuggestionSubtext(s) && (
                  <span className="block truncate text-[11px] text-ink-3">{autocompleteSuggestionSubtext(s)}</span>
                )}
              </span>
              {autocompleteSuggestionBadge(s) && (
                <span className={cn(
                  'max-w-[110px] shrink-0 truncate rounded border px-1 py-0.5 text-[10px]',
                  (s.adultLevel ?? 0) > 0 ? 'border-danger/40 text-danger' : 'border-line text-ink-3'
                )}>
                  {autocompleteSuggestionBadge(s)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
