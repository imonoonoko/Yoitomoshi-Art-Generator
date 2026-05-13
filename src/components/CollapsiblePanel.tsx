import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  /** Panel header title — usually the extension/feature name. */
  title: string
  /** Optional one-line description shown next to the title in muted text. */
  hint?: string
  /**
   * If provided, an "enabled" toggle switch is rendered on the right of the
   * header. The toggle is independent of expansion: a panel can be expanded
   * but disabled (the user is configuring without applying yet) and vice
   * versa.
   */
  enabled?: boolean
  onEnabledChange?: (v: boolean) => void
  /** Initial expansion state. Defaults to collapsed to keep the panel quiet. */
  defaultOpen?: boolean
  testId?: string
  children: ReactNode
}

/**
 * Generic collapsible accordion panel used to host extension/feature settings
 * (Dynamic Thresholding, FreeU, ADetailer, ControlNet, …) inside a single
 * shared "Extensions" column. Clicking the header toggles open/close; the
 * optional toggle on the right enables/disables the feature without touching
 * expansion state.
 *
 * Why not use a Headless UI / Radix Disclosure: rendering the optional
 * enabled-toggle inside the header (as a click-isolated subtree) is awkward
 * with their composable APIs because the toggle's click would bubble up and
 * also flip expansion. We just stop propagation on the toggle.
 */
export function CollapsiblePanel({
  title,
  hint,
  enabled,
  onEnabledChange,
  defaultOpen = false,
  testId,
  children
}: Props): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  const showToggle = onEnabledChange !== undefined

  return (
    <div className={cn(
      'card overflow-hidden',
      enabled === true && 'ring-1 ring-accent/40'
    )} data-testid={testId}>
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-3 transition-colors text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
        <span className={cn('text-xs font-medium flex-1 truncate', enabled === true && 'text-accent')}>
          {title}
        </span>
        {hint && !showToggle && (
          <span className="text-[10px] text-ink-3 truncate">{hint}</span>
        )}
        {showToggle && (
          <span
            role="switch"
            aria-checked={enabled}
            tabIndex={0}
            className={cn(
              'inline-flex w-8 h-4 rounded-full p-0.5 transition-colors cursor-pointer',
              enabled ? 'bg-accent' : 'bg-bg-3 border border-line'
            )}
            onClick={(e) => {
              // Don't bubble — the parent button toggles expansion.
              e.stopPropagation()
              onEnabledChange?.(!enabled)
            }}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault()
                e.stopPropagation()
                onEnabledChange?.(!enabled)
              }
            }}
          >
            <span className={cn(
              'block w-3 h-3 rounded-full bg-bg-0 shadow transition-transform',
              enabled ? 'translate-x-4' : 'translate-x-0'
            )} />
          </span>
        )}
      </button>
      {open && (
        <div className="px-3 pt-1 pb-3 border-t border-line space-y-2 text-xs">
          {hint && showToggle && (
            <p className="text-[10px] text-ink-3 leading-relaxed -mt-0.5">{hint}</p>
          )}
          {children}
        </div>
      )}
    </div>
  )
}
