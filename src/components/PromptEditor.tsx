import { useEffect, useRef, useState } from 'react'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { adjustTokenWeight } from '@/lib/prompt-utils'

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
}

const MAX_SUGGESTIONS = 8

/**
 * Textarea with opt-in autocomplete fed from the prompt library tag dictionary.
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

  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [highlighted, setHighlighted] = useState(0)
  const [open, setOpen] = useState(false)

  function findSuggestions(text: string, caret: number): Suggestion[] {
    const before = text.slice(0, caret)
    // Last token = portion after the most recent boundary char.
    const m = before.match(/([^\s,()\n]+)$/)
    const token = m?.[1] ?? ''
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

  function showAutocomplete(): void {
    const ta = ref.current
    if (!ta) return
    const out = findSuggestions(value, ta.selectionStart)
    setSuggestions(out)
    setHighlighted(0)
    setOpen(out.length > 0)
  }

  function refreshAutocomplete(text = value, caret = ref.current?.selectionStart ?? 0): void {
    if (!open) return
    const out = findSuggestions(text, caret)
    setSuggestions(out)
    setHighlighted(0)
    setOpen(out.length > 0)
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
    if (open) refreshAutocomplete(e.target.value, e.target.selectionStart)
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

  return (
    <div>
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
      {open && suggestions.length > 0 && (
        <div className="mt-1 max-h-[180px] overflow-auto card shadow-xl">
          {suggestions.map((s, i) => (
            <button
              key={s.en}
              type="button"
              className={cn(
                'w-full text-left flex items-baseline gap-2 px-2.5 py-1.5 text-sm transition-colors',
                i === highlighted ? 'bg-bg-3 text-accent' : 'hover:bg-bg-3'
              )}
              onMouseDown={(e) => {
                e.preventDefault()
                accept(s)
              }}
              onMouseEnter={() => setHighlighted(i)}
            >
              <span className="font-mono text-[13px]">{s.en}</span>
              <span className="text-[11px] text-ink-3 truncate">{s.ja}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
