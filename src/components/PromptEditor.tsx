import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/ipc'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { adjustTokenWeight } from '@/lib/prompt-utils'
import { useT } from '@/lib/i18n'
import type { PromptDictionaryEntry } from '@shared/types'

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

interface Suggestion {
  en: string
  ja: string
  meaning?: string
  category?: string
  group?: string
  sourceLabel?: string
}

const MAX_SUGGESTIONS = 8
const AUTOCOMPLETE_DELAY_MS = 140

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
  const searchSeq = useRef(0)
  const searchTimer = useRef<number | null>(null)

  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [highlighted, setHighlighted] = useState(0)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeQuery, setActiveQuery] = useState('')
  const t = useT()

  function currentToken(text: string, caret: number): string {
    const before = text.slice(0, caret)
    // Last token = portion after the most recent boundary char.
    const m = before.match(/([^\s,()\n]+)$/)
    return m?.[1] ?? ''
  }

  function findLocalSuggestions(token: string): Suggestion[] {
    if (token.length < 2 || autocomplete.size === 0) return []

    const lc = token.toLowerCase()
    const out: Suggestion[] = []
    for (const [en, ja] of autocomplete.entries()) {
      const enLower = en.toLowerCase()
      const jaLower = ja.toLowerCase()
      if (enLower.startsWith(lc) || jaLower.startsWith(lc)) {
        out.push({ en, ja })
        if (out.length >= MAX_SUGGESTIONS) break
      }
    }
    if (out.length === 0) {
      // Fallback: substring search.
      for (const [en, ja] of autocomplete.entries()) {
        const enLower = en.toLowerCase()
        const jaLower = ja.toLowerCase()
        if (enLower.includes(lc) || jaLower.includes(lc)) {
          out.push({ en, ja })
          if (out.length >= MAX_SUGGESTIONS) break
        }
      }
    }
    return out
  }

  function suggestionFromDictionary(entry: PromptDictionaryEntry): Suggestion {
    return {
      en: entry.en,
      ja: entry.ja,
      meaning: entry.meaning,
      category: entry.category,
      group: entry.group,
      sourceLabel: entry.sourceLabel
    }
  }

  function shouldSearchToken(token: string, forced: boolean): boolean {
    if (forced) return token.trim().length > 0
    const length = [...token.trim()].length
    if (length === 0) return false
    if (/[\u3040-\u30ff\u3400-\u9fff]/.test(token)) return length >= 1
    return length >= 2
  }

  function clearSearchTimer(): void {
    if (searchTimer.current !== null) {
      window.clearTimeout(searchTimer.current)
      searchTimer.current = null
    }
  }

  function searchSuggestions(text: string, caret: number, forced = false): void {
    const token = currentToken(text, caret).trim()
    clearSearchTimer()
    if (!shouldSearchToken(token, forced)) {
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
      api.promptDictionary.search({ query: token, limit: MAX_SUGGESTIONS })
        .then((result) => {
          if (searchSeq.current !== seq) return
          const dictionarySuggestions = result.entries.map(suggestionFromDictionary)
          const seen = new Set(dictionarySuggestions.map((item) => item.en.toLowerCase()))
          const localSuggestions = findLocalSuggestions(token).filter((item) => !seen.has(item.en.toLowerCase()))
          const next = [...dictionarySuggestions, ...localSuggestions].slice(0, MAX_SUGGESTIONS)
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
    }, forced ? 0 : AUTOCOMPLETE_DELAY_MS)
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
    const caret = ta.selectionStart
    const before = value.slice(0, caret)
    const after = value.slice(caret)
    const tokenStart = before.search(/[^\s,()\n]+$/)
    const replaced =
      (tokenStart >= 0 ? before.slice(0, tokenStart) : before) + s.en + ', '
    const newValue = replaced + after
    onChange(newValue)
    setOpen(false)
    requestAnimationFrame(() => {
      ta.focus()
      const pos = replaced.length
      ta.setSelectionRange(pos, pos)
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
                {(s.ja || s.meaning) && (
                  <span className="block truncate text-[11px] text-ink-3">{s.ja || s.meaning}</span>
                )}
              </span>
              {(s.category || s.group) && (
                <span className="max-w-[96px] shrink-0 truncate rounded border border-line px-1 py-0.5 text-[10px] text-ink-3">
                  {s.group || s.category}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
