import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/ipc'
import { useStore } from '@/lib/store'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import {
  currentAutocompleteRange,
  autocompleteSuggestionBadge,
  autocompleteSuggestionSubtext,
  buildAutocompleteUsageHints,
  findLocalAutocompleteSuggestions,
  insertAutocompleteSuggestion,
  mergeAutocompleteSuggestions,
  polarityFromAutocompleteMode,
  PROMPT_DICTIONARY_AUTOCOMPLETE_DELAY_MS,
  PROMPT_DICTIONARY_AUTOCOMPLETE_LIMIT,
  shouldSearchAutocompleteQuery,
  suggestionFromDictionary,
  type PromptDictionaryAutocompleteSuggestion
} from '@/lib/prompt-dictionary-autocomplete'

type AutocompleteTarget = HTMLInputElement | HTMLTextAreaElement

type Suggestion = PromptDictionaryAutocompleteSuggestion

interface PanelPosition {
  x: number
  y: number
  width: number
  maxHeight: number
}

const TARGET_SELECTOR = 'input[data-prompt-dictionary-autocomplete], textarea[data-prompt-dictionary-autocomplete]'

/**
 * Global opt-in Prompt Daijiten autocomplete for tag-like inputs that are not
 * backed by PromptEditor. Add `data-prompt-dictionary-autocomplete` to an
 * input/textarea to connect it.
 */
export function PromptDictionaryAutocompleteLayer(): JSX.Element | null {
  const autocomplete = useStore((s) => s.autocomplete)
  const recentTags = useStore((s) => s.recentTags)
  const history = useStore((s) => s.history)
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const activeTargetRef = useRef<AutocompleteTarget | null>(null)
  const searchSeqRef = useRef(0)
  const searchTimerRef = useRef<number | null>(null)
  const autocompleteRef = useRef(autocomplete)
  const usageHintsRef = useRef<string[]>([])
  const suggestionsRef = useRef<Suggestion[]>([])
  const highlightedRef = useRef(0)
  const openRef = useRef(false)

  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [highlighted, setHighlighted] = useState(0)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeQuery, setActiveQuery] = useState('')
  const [position, setPosition] = useState<PanelPosition | null>(null)
  const usageHints = useMemo(
    () => buildAutocompleteUsageHints(
      recentTags,
      history.slice(0, 80).map((item) => item.tagReview?.acceptedTags ?? [])
    ),
    [history, recentTags]
  )

  useEffect(() => {
    autocompleteRef.current = autocomplete
  }, [autocomplete])

  useEffect(() => {
    usageHintsRef.current = usageHints
  }, [usageHints])

  useEffect(() => {
    suggestionsRef.current = suggestions
  }, [suggestions])

  useEffect(() => {
    highlightedRef.current = highlighted
  }, [highlighted])

  useEffect(() => {
    openRef.current = open
  }, [open])

  function close(): void {
    clearSearchTimer()
    setOpen(false)
    setLoading(false)
    setSuggestions([])
    setActiveQuery('')
  }

  function clearSearchTimer(): void {
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current)
      searchTimerRef.current = null
    }
  }

  function positionPanel(target: AutocompleteTarget): void {
    setPosition(panelPositionFor(target))
  }

  function findLocalSuggestions(token: string): Suggestion[] {
    return findLocalAutocompleteSuggestions(
      autocompleteRef.current,
      token,
      PROMPT_DICTIONARY_AUTOCOMPLETE_LIMIT
    )
  }

  function searchSuggestions(target: AutocompleteTarget, forced = false): void {
    const range = currentAutocompleteRange(target.value, target.selectionStart, target.selectionEnd)
    const token = range.query
    clearSearchTimer()
    if (!shouldSearchAutocompleteQuery(token, forced)) {
      close()
      return
    }

    const seq = searchSeqRef.current + 1
    searchSeqRef.current = seq
    activeTargetRef.current = target
    positionPanel(target)
    setActiveQuery(token)
    setLoading(true)
    setOpen(true)

    searchTimerRef.current = window.setTimeout(() => {
      api.promptDictionary.search({
        query: token,
        limit: PROMPT_DICTIONARY_AUTOCOMPLETE_LIMIT,
        polarity: polarityFromAutocompleteMode(target.getAttribute('data-prompt-dictionary-autocomplete'))
      })
        .then((result) => {
          if (searchSeqRef.current !== seq) return
          const dictionarySuggestions = result.entries.map(suggestionFromDictionary)
          const seen = new Set(dictionarySuggestions.map((item) => item.en.toLowerCase()))
          const localSuggestions = findLocalSuggestions(token).filter((item) => !seen.has(item.en.toLowerCase()))
          const next = mergeAutocompleteSuggestions(
            dictionarySuggestions,
            localSuggestions,
            PROMPT_DICTIONARY_AUTOCOMPLETE_LIMIT,
            usageHintsRef.current
          )
          setSuggestions(next)
          setHighlighted(0)
          setOpen(next.length > 0)
        })
        .catch(() => {
          if (searchSeqRef.current !== seq) return
          const fallback = findLocalSuggestions(token)
          setSuggestions(fallback)
          setHighlighted(0)
          setOpen(fallback.length > 0)
        })
        .finally(() => {
          if (searchSeqRef.current === seq) setLoading(false)
        })
    }, forced ? 0 : PROMPT_DICTIONARY_AUTOCOMPLETE_DELAY_MS)
  }

  function accept(suggestion: Suggestion | undefined): void {
    if (!suggestion) return
    const target = activeTargetRef.current
    if (!target) return
    const inserted = insertAutocompleteSuggestion(
      target.value,
      currentAutocompleteRange(target.value, target.selectionStart, target.selectionEnd),
      suggestion
    )
    setNativeValue(target, inserted.value)
    close()
    window.requestAnimationFrame(() => {
      target.focus()
      target.setSelectionRange(inserted.caret, inserted.caret)
    })
  }

  useEffect(() => {
    function onFocusIn(event: FocusEvent): void {
      const target = event.target
      if (isAutocompleteTarget(target)) {
        activeTargetRef.current = target
        return
      }
      if (!rootRef.current?.contains(target as Node | null)) {
        activeTargetRef.current = null
        close()
      }
    }

    function onFocusOut(): void {
      window.setTimeout(() => {
        const active = document.activeElement
        if (
          active !== activeTargetRef.current &&
          !rootRef.current?.contains(active)
        ) {
          activeTargetRef.current = null
          close()
        }
      }, 120)
    }

    function onInput(event: Event): void {
      if (!isAutocompleteTarget(event.target)) return
      searchSuggestions(event.target)
    }

    function onClick(event: MouseEvent): void {
      if (!isAutocompleteTarget(event.target)) {
        if (!rootRef.current?.contains(event.target as Node | null)) close()
        return
      }
      if (open) positionPanel(event.target)
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (!isAutocompleteTarget(event.target)) return
      const target = event.target
      activeTargetRef.current = target

      if ((event.ctrlKey || event.metaKey) && (event.key === ' ' || event.code === 'Space')) {
        event.preventDefault()
        event.stopPropagation()
        searchSuggestions(target, true)
        return
      }

      if (!openRef.current) return
      const currentSuggestions = suggestionsRef.current
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        event.stopPropagation()
        setHighlighted((value) => (value + 1) % Math.max(1, currentSuggestions.length))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()
        setHighlighted((value) => (value - 1 + Math.max(1, currentSuggestions.length)) % Math.max(1, currentSuggestions.length))
      } else if ((event.key === 'Tab' || event.key === 'Enter') && currentSuggestions.length > 0) {
        event.preventDefault()
        event.stopPropagation()
        accept(currentSuggestions[highlightedRef.current])
      } else if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close()
      }
    }

    function onReposition(): void {
      const target = activeTargetRef.current
      if (!target || !openRef.current) return
      positionPanel(target)
    }

    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    document.addEventListener('input', onInput)
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      clearSearchTimer()
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
      document.removeEventListener('input', onInput)
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [])

  if (!open || !position || (suggestions.length === 0 && !loading)) return null

  return (
    <div
      ref={rootRef}
      className="fixed z-[80] overflow-hidden rounded-md border border-line bg-bg-1 shadow-xl"
      style={{
        left: position.x,
        top: position.y,
        width: position.width,
        maxHeight: position.maxHeight
      }}
      data-testid="prompt-dictionary-autocomplete-layer"
      data-query={activeQuery}
    >
      {loading && suggestions.length === 0 && (
        <div className="px-2.5 py-2 text-[11px] text-ink-3">{t('promptDictionary.loading')}</div>
      )}
      <div className="max-h-[inherit] overflow-auto">
        {suggestions.map((suggestion, index) => (
          <button
            key={`${suggestion.en}-${index}`}
            type="button"
            className={cn(
              'flex w-full items-start gap-2 px-2.5 py-1.5 text-left transition-colors',
              index === highlighted ? 'bg-bg-3 text-accent' : 'hover:bg-bg-3'
            )}
            onMouseDown={(event) => {
              event.preventDefault()
              accept(suggestion)
            }}
            onMouseEnter={() => setHighlighted(index)}
            data-testid={`prompt-dictionary-autocomplete-option-${index}`}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-[12px] text-ink-0">{suggestion.en}</span>
              {autocompleteSuggestionSubtext(suggestion) && (
                <span className="block truncate text-[10px] text-ink-3">{autocompleteSuggestionSubtext(suggestion)}</span>
              )}
            </span>
            {autocompleteSuggestionBadge(suggestion) && (
              <span className={cn(
                'max-w-[112px] shrink-0 truncate rounded border px-1 py-0.5 text-[10px]',
                (suggestion.adultLevel ?? 0) > 0 ? 'border-danger/40 text-danger' : 'border-line text-ink-3'
              )}>
                {autocompleteSuggestionBadge(suggestion)}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

function isAutocompleteTarget(target: EventTarget | null): target is AutocompleteTarget {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return false
  if (!target.matches(TARGET_SELECTOR)) return false
  if (target.disabled || target.readOnly) return false
  if (target instanceof HTMLInputElement) {
    const type = (target.getAttribute('type') || 'text').toLowerCase()
    if (!['', 'text', 'search', 'url', 'tel'].includes(type)) return false
  }
  return true
}

function panelPositionFor(target: AutocompleteTarget): PanelPosition {
  const rect = target.getBoundingClientRect()
  const maxHeight = 230
  const width = Math.min(Math.max(rect.width, 280), Math.min(window.innerWidth - 16, 440))
  const x = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
  const below = rect.bottom + 6
  const above = Math.max(8, rect.top - maxHeight - 6)
  const y = below + maxHeight <= window.innerHeight - 8 ? below : above
  return { x, y, width, maxHeight }
}

function setNativeValue(target: AutocompleteTarget, value: string): void {
  const prototype = target instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
  descriptor?.set?.call(target, value)
  target.dispatchEvent(new Event('input', { bubbles: true }))
  target.dispatchEvent(new Event('change', { bubbles: true }))
}
