import { cn } from '@/lib/utils'
import type { ForgeStatus } from '@shared/types'

interface Props {
  status: ForgeStatus
  size?: 'sm' | 'md'
}

const COLORS: Record<ForgeStatus['kind'], string> = {
  stopped: 'bg-ink-3',
  starting: 'bg-warn animate-pulse',
  ready: 'bg-ok',
  error: 'bg-err'
}

export function StatusDot({ status, size = 'md' }: Props): JSX.Element {
  const px = size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5'
  return (
    <span
      className={cn('inline-block rounded-full shrink-0', px, COLORS[status.kind])}
      aria-label={status.kind}
    />
  )
}

/**
 * Render a localized human-readable label for the forge status. Takes the
 * caller's `t` function (from `useT()`) so the label is reactive to language
 * changes — making this a hook itself would force every consumer to be
 * inside a function component, which doesn't fit places like `title` props
 * built in event handlers.
 */
export function statusLabel(
  status: ForgeStatus,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  switch (status.kind) {
    case 'stopped':
      return t('forge.status.stopped')
    case 'starting': {
      const base = t('forge.status.starting')
      return status.phase === 'error-detected'
        ? `${base} ${t('forge.status.startingWarning')}`
        : base
    }
    case 'ready':
      return t('forge.status.ready', { port: status.port })
    case 'error':
      return t('forge.status.error', { message: status.message })
  }
}
