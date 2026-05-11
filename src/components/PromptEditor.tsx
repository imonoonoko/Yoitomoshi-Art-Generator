import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { adjustTokenWeight } from '@/lib/prompt-utils'
import { highlightPrompt } from '@/lib/prompt-highlight'

interface Props {
  value: string
  onChange(v: string): void
  placeholder?: string
  rows?: number
  /** Visual variant — negative prompts get a slight reddish tint. */
  tone?: 'positive' | 'negative'
  ariaLabel: string
  onSubmit?(): void
}

interface Suggestion {
  en: string
  ja: string
}

const MAX_SUGGESTIONS = 8

/**
 * Textarea with inline autocomplete fed from the prompt library's tag dictionary.
 * The user types, and when the last token (split on comma/newline/parenthesis) has
 * 2+ chars, we show a popover of matching tags. Tab or Enter accepts.
 */
export function PromptEditor({
  value,
  onChange,
  placeholder,
  rows = 5,
  tone = 'positive',
  ariaLabel,
  onSubmit
}: Props): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)
  const autocomplete = useStore((s) => s.autocomplete)

  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [highlighted, setHighlighted] = useState(0)
  const [open, setOpen] = useState(false)

  function recompute(text: string, caret: number): void {
    const before = text.slice(0, caret)
    // Last token = portion after the most recent boundary char.
    const m = before.match(/([^\s,()\n]+)$/)
    const token = m?.[1] ?? ''
    if (token.length < 2 || autocomplete.size === 0) {
      setOpen(false)
      return
    }
    const lc = token.toLowerCase()
    const out: Suggestion[] = []
    for (const [en, ja] of autocomplete.entries()) {
      if (en.toLowerCase().startsWith(lc)) {
        out.push({ en, ja })
        if (out.length >= MAX_SUGGESTIONS) break
      }
    }
    if (out.length === 0) {
      // Fallback: substring search
      for (const [en, ja] of autocomplete.entries()) {
        if (en.toLowerCase().includes(lc)) {
          out.push({ en, ja })
          if (out.length >= MAX_SUGGESTIONS) break
        }
      }
    }
    setSuggestions(out)
    setHighlighted(0)
    setOpen(out.length > 0)
  }

  function accept(s: Suggestion): void {
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

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    // Ctrl+Enter submits even when autocomplete is open.
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      setOpen(false)
      onSubmit?.()
      return
    }
    // Ctrl+ArrowUp/Down adjusts the weight of the token under the caret —
    // matches A1111's keyboard shortcut for parens-weight.
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
    if (!ref.current) return
    recompute(value, ref.current.selectionStart)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const tokens = useMemo(() => highlightPrompt(value), [value])

  // Keep the syntax-highlighting <pre> scrolled in lockstep with the textarea.
  const mirrorRef = useRef<HTMLPreElement>(null)
  function syncScroll(): void {
    const t = ref.current
    const m = mirrorRef.current
    if (!t || !m) return
    m.scrollTop = t.scrollTop
    m.scrollLeft = t.scrollLeft
  }

  return (
    <div className="relative">
      {/*
        Mirror layer renders the styled prompt; the textarea on top has
        transparent text and a visible caret. Both use identical font/padding/
        line-height so character positions match pixel-for-pixel. If they ever
        drift, check the .input + textarea-class CSS first.
      */}
      <pre
        ref={mirrorRef}
        aria-hidden
        className={cn(
          'absolute inset-0 input pointer-events-none overflow-hidden',
          'font-mono text-[13px] leading-relaxed whitespace-pre-wrap break-words m-0'
        )}
      >
        {tokens.map((t, i) => (
          <span key={i} className={t.className}>{t.text}</span>
        ))}
      </pre>
      <textarea
        ref={ref}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onScroll={syncScroll}
        placeholder={placeholder}
        aria-label={ariaLabel}
        spellCheck={false}
        className={cn(
          'input resize-none font-mono text-[13px] leading-relaxed relative bg-transparent',
          'text-transparent caret-ink-0 selection:bg-accent/40 selection:text-ink-0',
          tone === 'negative' && 'border-line/60'
        )}
      />
      {open && (
        <div className="absolute z-30 mt-1 left-0 right-0 max-h-[260px] overflow-auto card shadow-2xl">
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
