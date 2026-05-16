import { useState } from 'react'
import { Star, ExternalLink, Check, ImageOff } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore } from '@/lib/store'
import { api } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { promptAppend } from '@/lib/prompt-utils'
import { useT, t as tStatic } from '@/lib/i18n'
import type { SdLora, LoraCivitaiMetadata } from '@shared/types'

interface Props {
  lora: SdLora
  /** Compact mode = used in suggestion strip; full mode = used in main LoRA panel. */
  compact?: boolean
  /** Optional badge (e.g., score + reasons) shown in suggestion mode. */
  badge?: string
  badgeTooltip?: string
}

/**
 * One LoRA entry. Renders a thumbnail (Civitai-fetched or placeholder), name,
 * base model badge, weight slider, ★ favorite toggle, and an "適用 / 解除"
 * action that flips the LoRA in/out of the active set.
 *
 * Civitai metadata is loaded lazily — first time the user mounts this card we
 * kick off a background hash + lookup. Subsequent mounts read from the cached
 * `loraMeta` map in the store.
 */
export function LoraCard({ lora, compact = false, badge, badgeTooltip }: Props): JSX.Element {
  const meta = useStore((s) => s.loraMeta.get(lora.name))
  const upsertLoraMeta = useStore((s) => s.upsertLoraMeta)
  const activeLoras = useStore((s) => s.activeLoras)
  const toggleActive = useStore((s) => s.toggleActiveLora)
  const patchActive = useStore((s) => s.patchActiveLora)
  const favorites = useStore((s) => s.loraFavorites)
  const toggleFav = useStore((s) => s.toggleLoraFavorite)
  const prompt = useStore((s) => s.prompt)
  const setPrompt = useStore((s) => s.setPrompt)
  const t = useT()

  const active = activeLoras.find((a) => a.name === lora.name)
  const isActive = !!active
  const isFavorite = favorites.has(lora.name)
  const [loadingMeta, setLoadingMeta] = useState(false)

  async function fetchMeta(): Promise<void> {
    if (meta || loadingMeta) return
    setLoadingMeta(true)
    try {
      const m = await api.civitai.lookupLora(lora)
      if (m) upsertLoraMeta(lora.name, m)
    } catch (e) {
      console.warn('[lora] civitai lookup failed:', e)
    } finally {
      setLoadingMeta(false)
    }
  }

  function handleToggle(): void {
    if (isActive) {
      toggleActive(lora) // removes
    } else {
      // Default weight: prefer the recommendation's median weight if present,
      // else 0.8 — a safe value that matches most LoRAs without overpowering
      // the prompt.
      const triggerWords = meta?.trainedWords ?? []
      toggleActive(lora, 0.8, triggerWords)
      // Auto-insert any missing trigger words in the user's positive prompt.
      // This is the §7.2.4 spec — for now we always insert; an opt-out toggle
      // can be added in settings later.
      if (triggerWords.length > 0) {
        let next = prompt
        for (const tw of triggerWords) {
          if (!next.toLowerCase().includes(tw.toLowerCase())) {
            next = promptAppend(next, tw)
          }
        }
        if (next !== prompt) setPrompt(next)
      }
      toast.success(tStatic('loraCard.enabled', { name: lora.alias }))
    }
  }

  async function persistFav(): Promise<void> {
    toggleFav(lora.name)
    setTimeout(() => {
      void api.storage.setLoraFavorites(Array.from(useStore.getState().loraFavorites))
    }, 0)
  }

  const baseModelBadge = meta?.baseModel
  const adapterBadge = lora.adapterSubtype && lora.adapterSubtype !== 'Unknown'
    ? lora.adapterSubtype
    : lora.sourceRoot === 'LyCORIS'
      ? 'LyCORIS'
      : 'LoRA'
  const triggerWords = meta?.trainedWords ?? []
  const usageBadges: Array<{ key: string; label: string; title: string; tone?: 'warn' | 'ok' }> = []
  if (meta?.usage?.allowCommercialUse) {
    usageBadges.push({
      key: 'commercial',
      label: t('loraCard.usageCommercialShort'),
      title: t('loraCard.usageCommercialTitle', { value: formatCommercialUse(meta.usage.allowCommercialUse) }),
      tone: meta.usage.allowCommercialUse.toLowerCase() === 'none' ? 'warn' : 'ok'
    })
  }
  if (typeof meta?.usage?.allowNoCredit === 'boolean') {
    usageBadges.push({
      key: 'credit',
      label: meta.usage.allowNoCredit ? t('loraCard.usageNoCreditShort') : t('loraCard.usageCreditRequiredShort'),
      title: meta.usage.allowNoCredit ? t('loraCard.usageNoCreditTitle') : t('loraCard.usageCreditRequiredTitle'),
      tone: meta.usage.allowNoCredit ? 'ok' : 'warn'
    })
  }
  if (typeof meta?.usage?.allowDerivatives === 'boolean') {
    usageBadges.push({
      key: 'derivatives',
      label: meta.usage.allowDerivatives ? t('loraCard.usageDerivativesShort') : t('loraCard.usageNoDerivativesShort'),
      title: meta.usage.allowDerivatives ? t('loraCard.usageDerivativesTitle') : t('loraCard.usageNoDerivativesTitle'),
      tone: meta.usage.allowDerivatives ? 'ok' : 'warn'
    })
  }

  return (
    <div
      className={cn(
        'card overflow-hidden transition-all',
        isActive && 'ring-2 ring-accent',
        compact ? 'flex flex-col w-32 shrink-0' : 'flex'
      )}
      onMouseEnter={fetchMeta}
    >
      {/* Thumbnail */}
      <div
        className={cn(
          'shrink-0 bg-bg-3 relative',
          compact ? 'w-32 aspect-square' : 'w-20 h-20'
        )}
      >
        {meta?.thumbnailUrl ? (
          <img
            src={meta.thumbnailUrl}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-ink-3">
            <ImageOff className="h-6 w-6" />
          </div>
        )}
        {badge && (
          <div
            className="absolute top-1 left-1 bg-accent text-bg-0 text-[9px] font-bold px-1 py-0.5 rounded"
            title={badgeTooltip}
          >
            {badge}
          </div>
        )}
        {isActive && (
          <div className="absolute top-1 right-1 bg-accent text-bg-0 rounded-full p-0.5">
            <Check className="h-2.5 w-2.5" />
          </div>
        )}
      </div>

      {/* Body */}
      <div className={cn('flex-1 min-w-0 p-2 space-y-1', compact && 'p-1.5')}>
        <div className="flex items-start gap-1">
          <span
            className={cn('flex-1 truncate', compact ? 'text-[11px]' : 'text-xs font-medium')}
            title={lora.name}
          >
            {meta?.modelName ?? lora.alias}
          </span>
          {!compact && (
            <button
              className="p-0.5 shrink-0"
              onClick={(e) => { e.stopPropagation(); persistFav() }}
              title={isFavorite ? t('loraCard.favoriteRemove') : t('loraCard.favoriteAdd')}
            >
              <Star className={cn('h-3 w-3', isFavorite ? 'fill-warn text-warn' : 'text-ink-3')} />
            </button>
          )}
        </div>

        {!compact && (
          <div className="flex flex-wrap gap-1 text-[10px]">
            {baseModelBadge && (
              <span className="px-1 py-0.5 bg-bg-3 rounded text-ink-1">{baseModelBadge}</span>
            )}
            <span
              className={cn(
                'px-1 py-0.5 rounded text-ink-1',
                lora.sourceRoot === 'LyCORIS' ? 'bg-warn/20' : 'bg-bg-3'
              )}
              title={`${lora.sourceRoot ?? 'Lora'} / ${lora.tokenName ?? lora.name}`}
              data-testid="lora-adapter-badge"
            >
              {adapterBadge}
            </span>
            {lora.baseModelHint && !baseModelBadge && (
              <span className="px-1 py-0.5 bg-bg-3 rounded text-ink-1">{lora.baseModelHint}</span>
            )}
            {triggerWords.slice(0, 3).map((t) => (
              <span key={t} className="px-1 py-0.5 bg-accent-dim/30 text-ink-1 rounded font-mono">
                {t}
              </span>
            ))}
            {triggerWords.length > 3 && (
              <span className="text-ink-3">+{triggerWords.length - 3}</span>
            )}
            {meta?.availability?.primaryFileFormat && (
              <span className="px-1 py-0.5 bg-bg-3 rounded text-ink-1">
                {meta.availability.primaryFileFormat}
              </span>
            )}
            {meta?.availability?.primaryFileSha256 && (
              <span
                className="px-1 py-0.5 bg-bg-3 rounded text-ink-1 font-mono"
                title={meta.availability.primaryFileSha256}
              >
                SHA
              </span>
            )}
            {usageBadges.slice(0, 3).map((badge) => (
              <span
                key={badge.key}
                className={cn(
                  'px-1 py-0.5 rounded text-ink-1',
                  badge.tone === 'warn' ? 'bg-warn/20' : 'bg-bg-3'
                )}
                title={badge.title}
                data-testid="lora-usage-badge"
              >
                {badge.label}
              </span>
            ))}
            {meta?.civitaiUrl && (
              <button
                className="ml-auto text-ink-3 hover:text-ink-1"
                onClick={(e) => {
                  e.stopPropagation()
                  api.app.openExternal(meta.civitaiUrl!)
                }}
                title={t('loraCard.openCivitai')}
              >
                <ExternalLink className="h-3 w-3" />
              </button>
            )}
          </div>
        )}

        {!compact && isActive && active && (
          <div>
            <div className="flex items-baseline justify-between text-[10px] text-ink-3">
              <span>{t('loraCard.weight')}</span>
              <span className="font-mono text-ink-1">{active.weight.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={-1}
              max={1.5}
              step={0.05}
              value={active.weight}
              onChange={(e) =>
                patchActive(lora.name, { weight: parseFloat(e.target.value) })
              }
              className="w-full accent-accent"
            />
          </div>
        )}

        <button
          className={cn(
            'w-full text-[11px] py-1 rounded border transition-colors',
            isActive
              ? 'border-accent bg-accent-dim/40 text-ink-0 hover:bg-accent-dim/60'
              : 'border-line text-ink-1 hover:bg-bg-3'
          )}
          onClick={handleToggle}
        >
          {isActive ? t('loraCard.remove') : t('loraCard.apply')}
        </button>
      </div>
    </div>
  )
}

function formatCommercialUse(value: string): string {
  const normalized = value.trim()
  if (!normalized) return '-'
  return normalized
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^None$/i, 'None')
}
