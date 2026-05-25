import { useState, useEffect } from 'react'
import { cn, clamp } from '@/lib/utils'

interface Props {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange(v: number): void
  className?: string
  hint?: string
  testId?: string
}

/**
 * Compact label + numeric input. Used in the params panel where vertical real
 * estate is precious — keeps each control to a single row.
 */
export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  className,
  hint,
  testId
}: Props): JSX.Element {
  const [draft, setDraft] = useState(String(value))

  useEffect(() => setDraft(String(value)), [value])

  function commit(): void {
    let n = parseFloat(draft)
    if (Number.isNaN(n)) {
      setDraft(String(value))
      return
    }
    if (min !== undefined) n = Math.max(min, n)
    if (max !== undefined) n = Math.min(max, n)
    onChange(n)
  }

  function nudge(delta: number): void {
    const next = clamp(value + delta * step, min ?? -Infinity, max ?? Infinity)
    onChange(next)
  }

  return (
    <label className={cn('flex flex-col gap-1', className)}>
      <span className="label flex items-baseline justify-between">
        <span>{label}</span>
        {hint && <span className="text-[10px] text-ink-3 normal-case tracking-normal">{hint}</span>}
      </span>
      <div className="flex">
        <button
          type="button"
          onClick={() => nudge(-1)}
          className="px-2 border border-line bg-bg-1 rounded-l-md hover:bg-bg-3 text-ink-2"
          tabIndex={-1}
        >−</button>
        <input
          className="input rounded-none border-x-0 text-center font-mono"
          value={draft}
          data-testid={testId}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'ArrowUp') { e.preventDefault(); nudge(1) }
            if (e.key === 'ArrowDown') { e.preventDefault(); nudge(-1) }
          }}
        />
        <button
          type="button"
          onClick={() => nudge(1)}
          className="px-2 border border-line bg-bg-1 rounded-r-md hover:bg-bg-3 text-ink-2"
          tabIndex={-1}
        >+</button>
      </div>
    </label>
  )
}
