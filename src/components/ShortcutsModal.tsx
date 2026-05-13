import { useEffect } from 'react'
import { X, Keyboard } from 'lucide-react'
import { useT } from '@/lib/i18n'

interface Props {
  open: boolean
  onClose(): void
}

interface ShortcutEntry {
  /** Each entry is either a regular keyboard key string ("Ctrl", "Enter") or
   *  one of the special tokens below — translated at render time. */
  keys: string[]
  /** i18n key resolved via `t(...)` at render. */
  descriptionKey: string
}

interface ShortcutGroup {
  titleKey: string
  items: ShortcutEntry[]
}

// Sentinel tokens for keys that need translation. Comparing against these
// instead of the literal text keeps the join-separator logic ("/" vs "+")
// stable across languages.
const TK_CLICK = '__click__'
const TK_DRAG_DROP = '__dragdrop__'

const GROUPS: ShortcutGroup[] = [
  {
    titleKey: 'shortcuts.section.generate',
    items: [
      { keys: ['Ctrl', 'Enter'], descriptionKey: 'shortcuts.generate' },
      { keys: ['Ctrl', '↑'], descriptionKey: 'shortcuts.weightUp' },
      { keys: ['Ctrl', '↓'], descriptionKey: 'shortcuts.weightDown' }
    ]
  },
  {
    titleKey: 'shortcuts.section.promptEditor',
    items: [
      { keys: ['Ctrl', 'Space'], descriptionKey: 'shortcuts.acOpen' },
      { keys: ['Tab', 'Enter'], descriptionKey: 'shortcuts.acAccept' },
      { keys: ['↑', '↓'], descriptionKey: 'shortcuts.acNav' },
      { keys: ['Esc'], descriptionKey: 'shortcuts.acClose' }
    ]
  },
  {
    titleKey: 'shortcuts.section.promptLibrary',
    items: [
      { keys: [TK_CLICK], descriptionKey: 'shortcuts.libClick' },
      { keys: ['Shift', TK_CLICK], descriptionKey: 'shortcuts.libShift' },
      { keys: ['Alt', TK_CLICK], descriptionKey: 'shortcuts.libAlt' },
      { keys: ['☆'], descriptionKey: 'shortcuts.libFav' }
    ]
  },
  {
    titleKey: 'shortcuts.section.imageInput',
    items: [
      { keys: ['Ctrl', 'V'], descriptionKey: 'shortcuts.pasteImage' },
      { keys: [TK_DRAG_DROP], descriptionKey: 'shortcuts.dropImage' }
    ]
  },
  {
    titleKey: 'shortcuts.section.other',
    items: [
      { keys: ['?'], descriptionKey: 'shortcuts.toggleHelp' },
      { keys: ['Esc'], descriptionKey: 'shortcuts.escape' }
    ]
  }
]

export function ShortcutsModal({ open, onClose }: Props): JSX.Element | null {
  const t = useT()

  // Close on Esc; the global ? toggle is handled at the App level so it works
  // even when this modal isn't mounted.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  function renderKey(k: string): string {
    if (k === TK_CLICK) return t('shortcuts.key.click')
    if (k === TK_DRAG_DROP) return t('shortcuts.key.dragDrop')
    return k
  }

  return (
    <div
      className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center p-8"
      onClick={onClose}
    >
      <div
        className="card max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-line">
          <div className="flex items-center gap-2">
            <Keyboard className="h-4 w-4 text-accent" />
            <h2 className="text-base font-semibold">{t('shortcuts.title')}</h2>
          </div>
          <button className="btn btn-icon btn-ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-4 space-y-5">
          {GROUPS.map((g) => (
            <section key={g.titleKey}>
              <h3 className="text-xs uppercase tracking-wider text-ink-2 mb-2">{t(g.titleKey)}</h3>
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                {g.items.map((it, i) => (
                  <div key={i} className="contents">
                    <div className="flex items-center gap-1">
                      {it.keys.map((k, j) => {
                        // The separator between keys: "+" for modifier-style
                        // chords (Ctrl, Shift, Alt) and click-as-secondary,
                        // "/" for alternatives (↑/↓).
                        const next = it.keys[j + 1]
                        const isChordSeparator =
                          next === TK_CLICK ||
                          k === 'Ctrl' || k === 'Shift' || k === 'Alt'
                        return (
                          <span key={j} className="contents">
                            <kbd className="px-1.5 py-0.5 rounded bg-bg-3 border border-line text-[11px] font-mono text-ink-0 min-w-[20px] text-center">
                              {renderKey(k)}
                            </kbd>
                            {j < it.keys.length - 1 && (
                              <span className="text-ink-3 text-[11px] mx-0.5">
                                {isChordSeparator ? '+' : '/'}
                              </span>
                            )}
                          </span>
                        )
                      })}
                    </div>
                    <div className="text-sm text-ink-1 self-center">{t(it.descriptionKey)}</div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="p-3 border-t border-line text-[10px] text-ink-3 text-center">
          {t('shortcuts.openHint')}
        </div>
      </div>
    </div>
  )
}
