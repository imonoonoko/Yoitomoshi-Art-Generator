import { ArrowRightLeft, Minus, Plus, Rows3, ScanLine, X } from 'lucide-react'
import type { ReactNode } from 'react'
import toast from 'react-hot-toast'
import { useStore } from '@/lib/store'
import {
  adjustTokenWeight,
  cleanPromptTokenForMatch,
  dedupePromptTokens,
  removePromptToken,
  splitPromptTokensWithRanges,
  type PromptTokenRange
} from '@/lib/prompt-utils'
import { useT, t as tStatic } from '@/lib/i18n'
import { cn } from '@/lib/utils'

interface Props {
  target: 'positive' | 'negative'
  value: string
  onChange(v: string): void
  onMoveToken(token: PromptTokenRange): void
}

export function PromptTagChips({ target, value, onChange, onMoveToken }: Props): JSX.Element | null {
  const autocomplete = useStore((s) => s.autocomplete)
  const tokens = splitPromptTokensWithRanges(value)
  const t = useT()

  if (tokens.length === 0) return null

  function adjust(token: PromptTokenRange, delta: number): void {
    const caret = token.start + Math.floor(token.text.length / 2)
    onChange(adjustTokenWeight(value, caret, delta).prompt)
  }

  function dedupe(): void {
    const result = dedupePromptTokens(value)
    if (result.removed === 0) {
      toast(tStatic('promptTags.noDuplicates'), { icon: 'i' })
      return
    }
    onChange(result.prompt)
    toast.success(tStatic('promptTags.duplicatesRemoved', { count: result.removed }))
  }

  return (
    <section className="rounded-md border border-line/70 bg-bg-0/50 p-2">
      <div className="mb-1.5 flex items-center gap-1.5">
        <Rows3 className="h-3.5 w-3.5 text-accent" />
        <span className="label normal-case tracking-normal">{t('promptTags.title')}</span>
        <span className="rounded bg-bg-3 px-1.5 py-0.5 font-mono text-[10px] text-ink-3">{tokens.length}</span>
        <button
          type="button"
          className="btn btn-icon btn-ghost ml-auto h-6 w-6"
          onClick={dedupe}
          title={t('promptTags.dedupe')}
        >
          <ScanLine className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto pr-0.5">
        {tokens.map((token) => {
          const lookup = cleanPromptTokenForMatch(token.text).toLowerCase()
          const translated = autocomplete.get(lookup) ?? ''
          return (
            <div
              key={`${token.start}:${token.end}:${token.text}`}
              className={cn(
                'group inline-flex max-w-full items-center gap-0.5 rounded-md border bg-bg-2 px-1 py-0.5 text-[11px]',
                target === 'negative' ? 'border-err/35' : 'border-line'
              )}
            >
              <span className="min-w-0 max-w-[176px] truncate px-1 font-mono text-ink-1" title={token.text}>
                {token.text}
              </span>
              {translated && (
                <span className="max-w-[72px] truncate border-l border-line pl-1 text-[10px] text-ink-3" title={translated}>
                  {translated}
                </span>
              )}
              <IconChipButton title={t('promptTags.weightDown')} onClick={() => adjust(token, -0.1)}>
                <Minus className="h-3 w-3" />
              </IconChipButton>
              <IconChipButton title={t('promptTags.weightUp')} onClick={() => adjust(token, 0.1)}>
                <Plus className="h-3 w-3" />
              </IconChipButton>
              <IconChipButton
                title={t(target === 'positive' ? 'promptTags.moveToNegative' : 'promptTags.moveToPositive')}
                onClick={() => onMoveToken(token)}
              >
                <ArrowRightLeft className="h-3 w-3" />
              </IconChipButton>
              <IconChipButton title={t('promptTags.remove')} onClick={() => onChange(removePromptToken(value, token))}>
                <X className="h-3 w-3" />
              </IconChipButton>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function IconChipButton({
  title,
  onClick,
  children
}: {
  title: string
  onClick(): void
  children: ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-3 transition-colors hover:bg-bg-4 hover:text-ink-0"
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  )
}
