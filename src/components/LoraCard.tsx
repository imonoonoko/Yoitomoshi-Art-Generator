import { useState } from 'react'
import { Star, ExternalLink, Check, ImageOff, Pencil, Save, Trash2, ClipboardPaste, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore } from '@/lib/store'
import { api } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { promptAppend, splitPromptTokensWithRanges } from '@/lib/prompt-utils'
import { stripAdapterTokens } from '@/lib/adapter-tokens'
import { getBuiltInLoraPromptPreset, loraGenerationParamsFromOverride, resolvePresetSampler } from '@/lib/builtin-lora-presets'
import { useT, t as tStatic } from '@/lib/i18n'
import type { SdLora, LoraCivitaiMetadata, LoraPromptOverride } from '@shared/types'

interface Props {
  lora: SdLora
  /** Compact mode = used in suggestion strip; full mode = used in main LoRA panel. */
  compact?: boolean
  /** Optional badge (e.g., score + reasons) shown in suggestion mode. */
  badge?: string
  badgeTooltip?: string
}

const loraMetaRequests = new Map<string, Promise<LoraCivitaiMetadata | null>>()

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
  const promptOverrides = useStore((s) => s.loraPromptOverrides)
  const selectedModelTitle = useStore((s) => s.selectedModelTitle)
  const recommendation = useStore((s) => s.recommendation)
  const upsertPromptOverride = useStore((s) => s.upsertLoraPromptOverride)
  const deletePromptOverride = useStore((s) => s.deleteLoraPromptOverride)
  const setPrompt = useStore((s) => s.setPrompt)
  const setNegativePrompt = useStore((s) => s.setNegativePrompt)
  const t = useT()

  const active = activeLoras.find((a) => a.name === lora.name)
  const isActive = !!active
  const isFavorite = favorites.has(lora.name)
  const savedPromptOverride = findLoraPromptOverride(promptOverrides, lora, meta)
  const builtInPreset = getBuiltInLoraPromptPreset(lora, meta, { selectedModelTitle, recommendation })
  const promptOverride = savedPromptOverride ?? builtInPreset?.override
  const hasPromptOverride = Boolean(promptOverride && (
    promptOverride.positivePrompt ||
    promptOverride.negativePrompt ||
    promptOverride.weight != null ||
    promptOverride.autoApply === false
  ))
  const [loadingMeta, setLoadingMeta] = useState(false)
  const [editingOverride, setEditingOverride] = useState(false)
  const [draftPositive, setDraftPositive] = useState('')
  const [draftNegative, setDraftNegative] = useState('')
  const [draftWeight, setDraftWeight] = useState('')
  const [draftSampler, setDraftSampler] = useState('')
  const [draftSteps, setDraftSteps] = useState('')
  const [draftCfgScale, setDraftCfgScale] = useState('')
  const [draftClipSkip, setDraftClipSkip] = useState('')
  const [draftAutoApply, setDraftAutoApply] = useState(true)
  const [savingOverride, setSavingOverride] = useState(false)

  async function fetchMeta(): Promise<LoraCivitaiMetadata | null> {
    if (meta) return meta
    const requestKey = lora.sha256 || lora.path || lora.name
    setLoadingMeta(true)
    try {
      let request = loraMetaRequests.get(requestKey)
      if (!request) {
        request = api.civitai.lookupLora(lora).finally(() => {
          loraMetaRequests.delete(requestKey)
        })
        loraMetaRequests.set(requestKey, request)
      }
      const m = await request
      if (m) upsertLoraMeta(lora.name, m)
      return m
    } catch (e) {
      console.warn('[lora] civitai lookup failed:', e)
      return null
    } finally {
      setLoadingMeta(false)
    }
  }

  async function handleToggle(): Promise<void> {
    if (isActive) {
      toggleActive(lora) // removes
    } else {
      const resolvedMeta = meta ?? await fetchMeta()
      // Default weight: prefer the recommendation's median weight if present,
      // else 0.8 — a safe value that matches most LoRAs without overpowering
      // the prompt.
      const triggerWords = resolvedMeta?.trainedWords ?? []
      const recommendedPrompts = resolvedMeta?.recommendedPrompts ?? []
      const currentOverride = findLoraPromptOverride(
        useStore.getState().loraPromptOverrides,
        lora,
        resolvedMeta ?? undefined
      )
      const currentBuiltInPreset = getBuiltInLoraPromptPreset(lora, resolvedMeta, {
        selectedModelTitle: useStore.getState().selectedModelTitle,
        recommendation: useStore.getState().recommendation
      })
      const effectiveOverride = currentOverride ?? currentBuiltInPreset?.override
      const manualEnabled = effectiveOverride?.autoApply !== false
      const manualPositive = manualEnabled ? promptOverrideTokens(effectiveOverride?.positivePrompt ?? '') : []
      const manualNegative = manualEnabled ? promptOverrideTokens(effectiveOverride?.negativePrompt ?? '') : []
      const weight = manualEnabled && effectiveOverride?.weight != null ? effectiveOverride.weight : 0.8
      toggleActive(lora, weight, triggerWords)
      applyLoraGenerationParams(effectiveOverride)
      // Auto-insert missing trigger words plus description-derived recommended
      // prompt hints. Manual saved hints override Civitai-derived hints.
      const snippets = manualPositive.length > 0
        ? uniquePromptSnippets(manualPositive)
        : uniquePromptSnippets([...triggerWords, ...recommendedPrompts])
      if (snippets.length > 0) {
        const currentPrompt = useStore.getState().prompt
        let next = currentPrompt
        for (const snippet of snippets) {
          next = promptAppend(next, snippet)
        }
        if (next !== currentPrompt) setPrompt(next)
      }
      if (manualNegative.length > 0) {
        const currentNegative = useStore.getState().negativePrompt
        let nextNegative = currentNegative
        for (const snippet of manualNegative) {
          nextNegative = promptAppend(nextNegative, snippet)
        }
        if (nextNegative !== currentNegative) setNegativePrompt(nextNegative)
      }
      toast.success(tStatic('loraCard.enabled', { name: lora.alias }))
    }
  }

  function openPromptOverrideEditor(): void {
    const override = findLoraPromptOverride(useStore.getState().loraPromptOverrides, lora, meta)
      ?? getBuiltInLoraPromptPreset(lora, meta, {
        selectedModelTitle: useStore.getState().selectedModelTitle,
        recommendation: useStore.getState().recommendation
      })?.override
    setDraftPositive(override?.positivePrompt ?? '')
    setDraftNegative(override?.negativePrompt ?? '')
    setDraftWeight(override?.weight != null ? String(override.weight) : '')
    setDraftSampler(override?.sampler ?? '')
    setDraftSteps(override?.steps != null ? String(override.steps) : '')
    setDraftCfgScale(override?.cfgScale != null ? String(override.cfgScale) : '')
    setDraftClipSkip(override?.clipSkip != null ? String(override.clipSkip) : '')
    setDraftAutoApply(override?.autoApply !== false)
    setEditingOverride(true)
  }

  async function savePromptOverride(): Promise<void> {
    setSavingOverride(true)
    try {
      const existing = findLoraPromptOverride(useStore.getState().loraPromptOverrides, lora, meta)
      const parsedWeight = draftWeight.trim() ? Number(draftWeight) : null
      const weight = parsedWeight != null && Number.isFinite(parsedWeight)
        ? Math.max(-1, Math.min(2, Math.round(parsedWeight * 100) / 100))
        : null
      const steps = parseOptionalNumber(draftSteps, 1, 150, true)
      const cfgScale = parseOptionalNumber(draftCfgScale, 1, 30, false)
      const clipSkip = parseOptionalNumber(draftClipSkip, 1, 12, true)
      const sha = loraPromptOverrideSha(lora, meta)
      const item: LoraPromptOverride = {
        id: existing?.id ?? preferredLoraPromptOverrideId(lora, meta),
        loraName: lora.name,
        loraAlias: lora.alias,
        loraPath: lora.path,
        loraSha256: sha,
        positivePrompt: stripAdapterTokens(draftPositive).prompt,
        negativePrompt: stripAdapterTokens(draftNegative).prompt,
        weight,
        sampler: draftSampler.trim() || undefined,
        steps,
        cfgScale,
        clipSkip,
        autoApply: draftAutoApply,
        updatedAt: Date.now()
      }
      const saved = await api.storage.saveLoraPromptOverride(item)
      upsertPromptOverride(saved)
      if (isActive) {
        if (saved.weight != null) patchActive(lora.name, { weight: saved.weight })
        applyLoraGenerationParams(saved)
      }
      setEditingOverride(false)
      toast.success(tStatic('loraCard.promptOverrideSaved'))
    } catch (e) {
      toast.error(tStatic('toast.saveFailed', { message: (e as Error).message }))
    } finally {
      setSavingOverride(false)
    }
  }

  async function removePromptOverride(): Promise<void> {
    const existing = findLoraPromptOverride(useStore.getState().loraPromptOverrides, lora, meta)
    if (!existing) {
      setEditingOverride(false)
      return
    }
    setSavingOverride(true)
    try {
      await api.storage.deleteLoraPromptOverride(existing.id)
      deletePromptOverride(existing.id)
      setEditingOverride(false)
      toast.success(tStatic('loraCard.promptOverrideDeleted'))
    } catch (e) {
      toast.error(tStatic('toast.deleteFailed', { message: (e as Error).message }))
    } finally {
      setSavingOverride(false)
    }
  }

  function applyLoraGenerationParams(override: LoraPromptOverride | null | undefined): void {
    const params = loraGenerationParamsFromOverride(override)
    if (Object.keys(params).length === 0) return
    const state = useStore.getState()
    const sampler = params.sampler ? resolvePresetSampler(state.samplers, params.sampler) : null
    state.patchParams({
      ...(params.steps != null ? { steps: params.steps } : {}),
      ...(params.cfgScale != null ? { cfgScale: params.cfgScale } : {}),
      ...(params.clipSkip != null ? { clipSkip: params.clipSkip } : {}),
      ...(sampler ? { sampler } : {})
    })
  }

  function captureCurrentPrompt(): void {
    const state = useStore.getState()
    setDraftPositive(state.prompt)
    setDraftNegative(state.negativePrompt)
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
      onMouseEnter={() => { void fetchMeta() }}
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
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                className={cn('p-0.5', hasPromptOverride ? 'text-accent' : 'text-ink-3 hover:text-ink-1')}
                onClick={(e) => { e.stopPropagation(); openPromptOverrideEditor() }}
                title={t('loraCard.editPromptOverride')}
                data-testid="lora-prompt-override-edit"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                className="p-0.5"
                onClick={(e) => { e.stopPropagation(); persistFav() }}
                title={isFavorite ? t('loraCard.favoriteRemove') : t('loraCard.favoriteAdd')}
              >
                <Star className={cn('h-3 w-3', isFavorite ? 'fill-warn text-warn' : 'text-ink-3')} />
              </button>
            </div>
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
            {hasPromptOverride && (
              <span
                className="px-1 py-0.5 bg-accent-dim/30 text-ink-1 rounded"
                title={t('loraCard.promptOverrideBadgeTitle')}
                data-testid="lora-prompt-override-badge"
              >
                {t('loraCard.promptOverrideBadge')}
              </span>
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

        {!compact && editingOverride && (
          <div
            className="border border-line rounded bg-bg-1 p-2 space-y-1.5"
            onClick={(e) => e.stopPropagation()}
            data-testid="lora-prompt-override-editor"
          >
            <label className="flex items-center gap-1.5 text-[10px] text-ink-2">
              <input
                type="checkbox"
                checked={draftAutoApply}
                onChange={(e) => setDraftAutoApply(e.target.checked)}
                className="accent-accent"
              />
              {t('loraCard.promptOverrideAutoApply')}
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] text-ink-3">{t('loraCard.promptOverridePositive')}</span>
              <textarea
                value={draftPositive}
                onChange={(e) => setDraftPositive(e.target.value)}
                placeholder={t('loraCard.promptOverridePositivePlaceholder')}
                className="input min-h-14 text-[11px] leading-relaxed resize-y"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] text-ink-3">{t('loraCard.promptOverrideNegative')}</span>
              <textarea
                value={draftNegative}
                onChange={(e) => setDraftNegative(e.target.value)}
                placeholder={t('loraCard.promptOverrideNegativePlaceholder')}
                className="input min-h-10 text-[11px] leading-relaxed resize-y"
              />
            </label>
            <div className="flex items-center gap-1.5">
              <label className="flex items-center gap-1 text-[10px] text-ink-3">
                {t('loraCard.promptOverrideWeight')}
                <input
                  type="number"
                  min={-1}
                  max={2}
                  step={0.05}
                  value={draftWeight}
                  onChange={(e) => setDraftWeight(e.target.value)}
                  placeholder={t('loraCard.promptOverrideWeightAuto')}
                  className="input h-6 w-16 text-[11px]"
                />
              </label>
              <label className="flex items-center gap-1 text-[10px] text-ink-3">
                {t('loraCard.promptOverrideSteps')}
                <input
                  type="number"
                  min={1}
                  max={150}
                  step={1}
                  value={draftSteps}
                  onChange={(e) => setDraftSteps(e.target.value)}
                  placeholder="28"
                  className="input h-6 w-14 text-[11px]"
                />
              </label>
              <label className="flex items-center gap-1 text-[10px] text-ink-3">
                {t('loraCard.promptOverrideCfg')}
                <input
                  type="number"
                  min={1}
                  max={30}
                  step={0.5}
                  value={draftCfgScale}
                  onChange={(e) => setDraftCfgScale(e.target.value)}
                  placeholder="7"
                  className="input h-6 w-14 text-[11px]"
                />
              </label>
            </div>
            <div className="flex items-center gap-1.5">
              <label className="flex items-center gap-1 text-[10px] text-ink-3">
                {t('loraCard.promptOverrideSampler')}
                <input
                  type="text"
                  value={draftSampler}
                  onChange={(e) => setDraftSampler(e.target.value)}
                  placeholder="Euler a"
                  className="input h-6 w-24 text-[11px]"
                />
              </label>
              <label className="flex items-center gap-1 text-[10px] text-ink-3">
                {t('loraCard.promptOverrideClipSkip')}
                <input
                  type="number"
                  min={1}
                  max={12}
                  step={1}
                  value={draftClipSkip}
                  onChange={(e) => setDraftClipSkip(e.target.value)}
                  placeholder="2"
                  className="input h-6 w-12 text-[11px]"
                />
              </label>
              <button
                className="btn btn-ghost h-6 px-1.5 text-[10px]"
                onClick={captureCurrentPrompt}
                title={t('loraCard.promptOverrideCaptureTitle')}
                type="button"
              >
                <ClipboardPaste className="h-3 w-3" />
                {t('loraCard.promptOverrideCapture')}
              </button>
            </div>
            <div className="flex items-center gap-1">
              <button
                className="btn btn-primary h-6 px-2 text-[10px]"
                onClick={() => { void savePromptOverride() }}
                disabled={savingOverride}
                type="button"
              >
                <Save className="h-3 w-3" />
                {t('loraCard.promptOverrideSave')}
              </button>
              <button
                className="btn btn-ghost h-6 px-1.5 text-[10px]"
                onClick={() => { void removePromptOverride() }}
                disabled={savingOverride || !savedPromptOverride}
                type="button"
              >
                <Trash2 className="h-3 w-3" />
              </button>
              <button
                className="btn btn-ghost btn-icon h-6 w-6 ml-auto"
                onClick={() => setEditingOverride(false)}
                type="button"
                title={t('common.close')}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
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
          onClick={() => { void handleToggle() }}
        >
          {isActive ? t('loraCard.remove') : t('loraCard.apply')}
        </button>
      </div>
    </div>
  )
}

function findLoraPromptOverride(
  overrides: Map<string, LoraPromptOverride>,
  lora: SdLora,
  meta: LoraCivitaiMetadata | undefined
): LoraPromptOverride | undefined {
  for (const key of loraPromptOverrideKeys(lora, meta)) {
    const hit = overrides.get(key)
    if (hit) return hit
  }
  const sha = loraPromptOverrideSha(lora, meta)
  const loraName = lora.name.toLowerCase()
  const loraPath = lora.path?.toLowerCase()
  for (const item of overrides.values()) {
    if (sha && item.loraSha256?.toLowerCase() === sha) return item
    if (item.loraName.toLowerCase() === loraName) return item
    if (loraPath && item.loraPath?.toLowerCase() === loraPath) return item
  }
  return undefined
}

function preferredLoraPromptOverrideId(lora: SdLora, meta: LoraCivitaiMetadata | undefined): string {
  const sha = loraPromptOverrideSha(lora, meta)
  return sha ? `sha256:${sha}` : `name:${lora.name.toLowerCase()}`
}

function loraPromptOverrideKeys(lora: SdLora, meta: LoraCivitaiMetadata | undefined): string[] {
  const keys = [preferredLoraPromptOverrideId(lora, meta), `name:${lora.name.toLowerCase()}`]
  if (lora.tokenName) keys.push(`name:${lora.tokenName.toLowerCase()}`)
  if (lora.path) keys.push(`path:${lora.path.toLowerCase()}`)
  return Array.from(new Set(keys))
}

function loraPromptOverrideSha(lora: SdLora, meta: LoraCivitaiMetadata | undefined): string | null {
  const sha = lora.sha256 ?? meta?.availability?.primaryFileSha256 ?? null
  return typeof sha === 'string' && /^[a-f0-9]{64}$/i.test(sha) ? sha.toLowerCase() : null
}

function promptOverrideTokens(value: string): string[] {
  const normalized = stripAdapterTokens(value).prompt.replace(/\r?\n/g, ', ')
  return splitPromptTokensWithRanges(normalized).map((token) => token.text)
}

function uniquePromptSnippets(snippets: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const snippet of snippets) {
    const normalized = snippet.trim()
    const key = normalized.toLowerCase().replace(/\s+/g, ' ')
    if (!normalized || seen.has(key)) continue
    seen.add(key)
    out.push(normalized)
  }
  return out
}

function parseOptionalNumber(value: string, min: number, max: number, integer: boolean): number | null {
  if (!value.trim()) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  const rounded = integer ? Math.round(parsed) : Math.round(parsed * 100) / 100
  return Math.max(min, Math.min(max, rounded))
}

function formatCommercialUse(value: string): string {
  const normalized = value.trim()
  if (!normalized) return '-'
  return normalized
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^None$/i, 'None')
}
