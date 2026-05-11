import { Sparkles } from 'lucide-react'
import { useStore } from '@/lib/store'
import { useT } from '@/lib/i18n'
import { LoraCard } from './LoraCard'

/**
 * Live LoRA recommendations based on the current prompt + selected checkpoint.
 *
 * Renders compact LoRA cards in a horizontally-scrolling strip, ordered by
 * suggestion score (model-recommended LoRAs are weighted highest). The
 * scoring runs in App.tsx with a 600ms debounce on prompt edits.
 *
 * Hidden when:
 *   - There are no suggestions (no LoRAs installed, or none matched)
 *   - The user has no checkpoint selected (no signal to score against)
 */
export function LoraSuggestionStrip(): JSX.Element | null {
  const suggestions = useStore((s) => s.loraSuggestions)
  const t = useT()
  if (suggestions.length === 0) return null

  return (
    <div className="card p-2">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Sparkles className="h-3.5 w-3.5 text-accent" />
        <span className="text-xs text-ink-2 uppercase tracking-wider">{t('loraSuggest.title')}</span>
        <span className="text-[10px] text-ink-3 font-mono">{t('loraSuggest.count', { count: suggestions.length })}</span>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {suggestions.map((s) => (
          <LoraCard
            key={s.lora.name}
            lora={s.lora}
            compact
            badge={`${s.score}`}
            badgeTooltip={s.reasons.join('\n')}
          />
        ))}
      </div>
    </div>
  )
}
