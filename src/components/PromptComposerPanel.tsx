import { BookOpen, Languages, LayoutTemplate, RefreshCw, Save, ScanLine, ShieldAlert, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import type { CheckpointPromptProfile, CheckpointRelatedModelReference, PromptComposerSlotTemplate, PromptTextTranslationRuntimeStatus } from '@shared/types'
import { useStore } from '@/lib/store'
import { api } from '@/lib/ipc'
import {
  composePromptInput,
  composePromptSlots,
  hasPromptComposerSlotInput,
  parsePromptComposerTags,
  promptComposerPositiveSlotOrderForModel,
  type PromptComposerResult,
  type PromptComposerSlotKey,
  type PromptComposerSlotResult,
  type PromptComposerTarget
} from '@/lib/prompt-composer'
import {
  checkpointPromptContextFromModel,
  defaultCheckpointPromptProfile,
  findCheckpointPromptProfile
} from '@/lib/checkpoint-prompt-profile'
import { formatPromptText, promptAppend } from '@/lib/prompt-utils'
import { useT, t as tStatic } from '@/lib/i18n'
import { cn } from '@/lib/utils'

interface PromptComposerPanelProps {
  value: string
  onChange(value: string): void
  mode?: 'replace' | 'append'
  target?: PromptComposerTarget
  onApplyTags?(tags: string[]): void
  onApplyNegative?(prompt: string, tags: string[]): void
  onModelTune?(): void
  clearOnApply?: boolean
  compact?: boolean
  testId?: string
  legacyCleanupTestId?: string
  legacyModelTuneTestId?: string
}

export function PromptComposerPanel({
  value,
  onChange,
  mode = 'replace',
  target = 'positive',
  onApplyTags,
  onApplyNegative,
  onModelTune,
  clearOnApply = false,
  compact = false,
  testId = 'prompt-composer',
  legacyCleanupTestId,
  legacyModelTuneTestId
}: PromptComposerPanelProps): JSX.Element {
  const library = useStore((s) => s.library)
  const customLibrary = useStore((s) => s.customLibrary)
  const models = useStore((s) => s.models)
  const selectedModelTitle = useStore((s) => s.selectedModelTitle)
  const recommendation = useStore((s) => s.recommendation)
  const checkpointPromptProfiles = useStore((s) => s.checkpointPromptProfiles)
  const activeLoras = useStore((s) => s.activeLoras)
  const loraMeta = useStore((s) => s.loraMeta)
  const slotDraft = useStore((s) => s.promptComposerSlotDraft)
  const slotInsertEnabled = useStore((s) => s.promptComposerSlotInsertEnabled)
  const slotInsertTarget = useStore((s) => s.promptComposerSlotInsertTarget)
  const slotTemplates = useStore((s) => s.promptComposerSlotTemplates)
  const updatePromptComposerSlot = useStore((s) => s.updatePromptComposerSlot)
  const setPromptComposerSlotDraft = useStore((s) => s.setPromptComposerSlotDraft)
  const clearPromptComposerSlots = useStore((s) => s.clearPromptComposerSlots)
  const setPromptComposerSlotInsertTarget = useStore((s) => s.setPromptComposerSlotInsertTarget)
  const upsertPromptComposerSlotTemplate = useStore((s) => s.upsertPromptComposerSlotTemplate)
  const deletePromptComposerSlotTemplate = useStore((s) => s.deletePromptComposerSlotTemplate)
  const [status, setStatus] = useState<PromptTextTranslationRuntimeStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [composing, setComposing] = useState(false)
  const [lastResult, setLastResult] = useState<PromptComposerResult | null>(null)
  const [slotOpen, setSlotOpen] = useState(false)
  const [slotResult, setSlotResult] = useState<PromptComposerSlotResult | null>(null)
  const [slotTemplateId, setSlotTemplateId] = useState('')
  const [slotTemplateName, setSlotTemplateName] = useState('')
  const [slotTemplateBusy, setSlotTemplateBusy] = useState(false)
  const t = useT()

  const allLibrary = useMemo(() => [...library, ...customLibrary], [library, customLibrary])
  const selectedModel = useMemo(
    () => models.find((model) => model.title === selectedModelTitle) ?? null,
    [models, selectedModelTitle]
  )
  const checkpointProfile = useMemo(() => {
    const modelContext = checkpointPromptContextFromModel(selectedModel, recommendation)
    const context = selectedModel
      ? modelContext
      : { ...modelContext, title: selectedModelTitle, name: selectedModelTitle }
    return findCheckpointPromptProfile(checkpointPromptProfiles, context) ?? defaultCheckpointPromptProfile(context)
  }, [checkpointPromptProfiles, recommendation, selectedModel, selectedModelTitle])
  const promptStyle = checkpointProfile.promptStyle ?? 'tag'
  const negativeStrategy = checkpointProfile.negativeStrategy ?? 'classic'
  const positiveSlotOrder = useMemo(
    () => promptComposerPositiveSlotOrderForModel(checkpointProfile.family, promptStyle),
    [checkpointProfile.family, promptStyle]
  )
  const orderedSlotFields = useMemo(() => {
    const byKey = new Map(PROMPT_COMPOSER_SLOT_FIELDS.map((slot) => [slot.key, slot]))
    return ([...positiveSlotOrder, 'avoidFailures'] as PromptComposerSlotKey[])
      .map((key) => byKey.get(key))
      .filter((slot): slot is PromptComposerSlotField => Boolean(slot))
  }, [positiveSlotOrder])
  const ready = status?.deepTranslatorReady === true
  const disabled = composing || !value.trim()
  const hasSlotInput = hasPromptComposerSlotInput(slotDraft)
  const sortedSlotTemplates = useMemo(
    () => [...slotTemplates].sort((a, b) =>
      (b.lastUsedAt ?? b.updatedAt) - (a.lastUsedAt ?? a.updatedAt) ||
      a.name.localeCompare(b.name)
    ),
    [slotTemplates]
  )
  const selectedSlotTemplate = useMemo(
    () => sortedSlotTemplates.find((template) => template.id === slotTemplateId) ?? null,
    [slotTemplateId, sortedSlotTemplates]
  )
  const recipeHints = useMemo(() => {
    const seen = new Set<string>()
    const hints: Array<{ id: string; text: string; source: string; kind: 'trigger' | 'prompt' }> = []
    for (const lora of activeLoras) {
      const meta = loraMeta.get(lora.name)
      if (!meta) continue
      for (const word of meta.trainedWords ?? []) {
        const text = word.trim()
        const key = `trigger:${text.toLowerCase()}`
        if (!text || seen.has(key)) continue
        seen.add(key)
        hints.push({ id: key, text, source: lora.name, kind: 'trigger' })
      }
      for (const prompt of meta.recommendedPrompts ?? []) {
        const text = prompt.trim()
        const key = `prompt:${text.toLowerCase()}`
        if (!text || seen.has(key)) continue
        seen.add(key)
        hints.push({ id: key, text, source: lora.name, kind: 'prompt' })
      }
    }
    return hints.slice(0, 8)
  }, [activeLoras, loraMeta])
  const relatedModelGroups = useMemo(
    () => buildPromptComposerRelatedModelGroups(checkpointProfile),
    [checkpointProfile]
  )
  const hasRelatedModelHints = relatedModelGroups.some((group) => group.items.length > 0)

  const refreshStatus = useCallback(async () => {
    setChecking(true)
    try {
      setStatus(await api.translation.promptRuntimeStatus())
    } catch {
      setStatus(null)
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  async function translateSegments(segments: string[]) {
    const results = await Promise.all(segments.map((text) => api.translation.promptText({
      text,
      source: 'ja',
      target: 'en',
      provider: 'deep-translator-google',
      mode: 'whole'
    })))
    return {
      translatedTexts: results.map((result) => result.translatedText),
      cacheHit: results.some((result) => result.cacheHit),
      warnings: results.flatMap((result) => result.warnings)
    }
  }

  async function compose(): Promise<void> {
    if (!value.trim()) {
      toast(tStatic('promptComposer.empty'), { icon: 'i' })
      return
    }
    setComposing(true)
    try {
      const result = await composePromptInput({
        text: value,
        target,
        library: allLibrary,
        translateSegments
      })
      setLastResult(result)
      if (!result.changed && result.tags.length > 0) {
        toast(tStatic('promptComposer.noChange'), { icon: 'i' })
      }
      if (mode === 'append') {
        onApplyTags?.(result.tags)
        if (clearOnApply) onChange('')
        toast.success(tStatic('promptComposer.added', { count: result.tags.length }))
      } else {
        onChange(result.prompt)
        toast.success(tStatic(result.cacheHit ? 'promptComposer.appliedCached' : 'promptComposer.applied'))
      }
      if (result.warnings.some((warning) => warning.startsWith('translation-failed'))) {
        toast.error(tStatic('promptComposer.partialFailed'))
      }
    } catch (error) {
      toast.error(tStatic('promptComposer.failed', { message: (error as Error).message }))
    } finally {
      setComposing(false)
      void refreshStatus()
    }
  }

  function cleanupOnly(): void {
    const tags = parsePromptComposerTags(value)
    const prompt = formatPromptText(tags.join(', ')).prompt
    if (!prompt || prompt === value.trim()) {
      toast(tStatic('prompt.formatUnchanged'), { icon: 'i' })
      return
    }
    if (mode === 'append') {
      onApplyTags?.(tags)
      if (clearOnApply) onChange('')
      toast.success(tStatic('promptComposer.added', { count: tags.length }))
    } else {
      onChange(prompt)
      toast.success(tStatic('prompt.formatted'))
    }
  }

  function applyRecipeHint(text: string): void {
    if (mode === 'append') {
      const tags = parsePromptComposerTags(text)
      onApplyTags?.(tags.length > 0 ? tags : [text])
    } else {
      onChange(promptAppend(value, text))
    }
    toast.success(tStatic('promptComposer.recipeHintApplied'))
  }

  function updateSlot(key: PromptComposerSlotKey, next: string): void {
    updatePromptComposerSlot(key, next)
  }

  async function composeSlots(): Promise<PromptComposerSlotResult | null> {
    if (!hasSlotInput) {
      toast(tStatic('promptComposer.slotsEmpty'), { icon: 'i' })
      return null
    }
    setComposing(true)
    try {
      const result = await composePromptSlots({
        slots: slotDraft,
        library: allLibrary,
        promptStyle,
        negativeStrategy,
        positiveSlotOrder,
        translateSegments
      })
      setSlotResult(result)
      return result
    } catch (error) {
      toast.error(tStatic('promptComposer.failed', { message: (error as Error).message }))
      return null
    } finally {
      setComposing(false)
      void refreshStatus()
    }
  }

  async function applySlotPositive(): Promise<void> {
    const result = await composeSlots()
    if (!result || !result.positivePrompt) return
    if (mode === 'append') {
      onApplyTags?.(result.positiveTags)
      if (clearOnApply) clearPromptComposerSlots()
      toast.success(tStatic('promptComposer.slotsAppliedPositive'))
    } else {
      onChange(result.positivePrompt)
      toast.success(tStatic('promptComposer.slotsAppliedPositive'))
    }
  }

  async function applySlotNegative(): Promise<void> {
    const result = await composeSlots()
    if (!result || !result.negativePrompt) return
    if (onApplyNegative) {
      onApplyNegative(result.negativePrompt, result.negativeTags)
      toast.success(tStatic('promptComposer.slotsAppliedNegative'))
      return
    }
    if (target === 'negative') {
      onChange(result.negativePrompt)
      toast.success(tStatic('promptComposer.slotsAppliedNegative'))
      return
    }
    toast(tStatic('promptComposer.slotsNegativeUnavailable'), { icon: 'i' })
  }

  async function saveSlotTemplate(): Promise<void> {
    if (!hasSlotInput || slotTemplateBusy) {
      toast(tStatic('promptComposer.slotsEmpty'), { icon: 'i' })
      return
    }
    const name = slotTemplateName.trim() ||
      selectedSlotTemplate?.name ||
      tStatic('promptComposer.templateDefaultName', { family: checkpointProfile.family })
    setSlotTemplateBusy(true)
    try {
      const saved = await api.storage.savePromptComposerSlotTemplate({
        id: selectedSlotTemplate?.id,
        name,
        slots: slotDraft,
        family: checkpointProfile.family,
        promptStyle,
        negativeStrategy,
        notes: selectedSlotTemplate?.notes ?? ''
      })
      upsertPromptComposerSlotTemplate(saved)
      setSlotTemplateId(saved.id)
      setSlotTemplateName(saved.name)
      toast.success(tStatic('promptComposer.templateSaved'))
    } catch (error) {
      toast.error(tStatic('toast.saveFailed', { message: (error as Error).message }))
    } finally {
      setSlotTemplateBusy(false)
    }
  }

  async function loadSlotTemplate(template: PromptComposerSlotTemplate | null = selectedSlotTemplate): Promise<void> {
    if (!template || slotTemplateBusy) return
    setPromptComposerSlotDraft(template.slots)
    setSlotResult(null)
    setSlotTemplateId(template.id)
    setSlotTemplateName(template.name)
    setSlotTemplateBusy(true)
    try {
      const saved = await api.storage.savePromptComposerSlotTemplate({
        id: template.id,
        name: template.name,
        slots: template.slots,
        family: template.family,
        promptStyle: template.promptStyle,
        negativeStrategy: template.negativeStrategy,
        notes: template.notes,
        lastUsedAt: Date.now()
      })
      upsertPromptComposerSlotTemplate(saved)
    } catch {
      // Loading the local store copy is still useful even if last-used persistence fails.
    } finally {
      setSlotTemplateBusy(false)
    }
    toast.success(tStatic('promptComposer.templateLoaded'))
  }

  async function removeSlotTemplate(): Promise<void> {
    if (!selectedSlotTemplate || slotTemplateBusy) return
    setSlotTemplateBusy(true)
    try {
      await api.storage.deletePromptComposerSlotTemplate(selectedSlotTemplate.id)
      deletePromptComposerSlotTemplate(selectedSlotTemplate.id)
      setSlotTemplateId('')
      setSlotTemplateName('')
      toast.success(tStatic('promptComposer.templateDeleted'))
    } catch (error) {
      toast.error(tStatic('toast.deleteFailed', { message: (error as Error).message }))
    } finally {
      setSlotTemplateBusy(false)
    }
  }

  const statusText = composing
    ? t('promptComposer.composing')
    : checking
      ? t('promptComposer.checking')
      : ready
        ? t('promptComposer.ready')
        : t('promptComposer.firstRun')

  return (
    <section
      className={cn(
        'rounded-md border border-accent/30 bg-bg-0/60 p-2',
        compact && 'p-2'
      )}
      data-testid={testId}
      data-translator-ready={ready ? 'true' : 'false'}
      data-target={target}
      data-prompt-style={promptStyle}
      data-negative-strategy={negativeStrategy}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <Wand2 className="h-3.5 w-3.5 text-accent" />
        <span className="label normal-case tracking-normal">{t('promptComposer.title')}</span>
        <span className="ml-auto truncate text-[10px] text-ink-3" data-testid="prompt-composer-status">{statusText}</span>
        <button
          type="button"
          className="btn btn-icon btn-ghost h-6 w-6"
          onClick={() => void refreshStatus()}
          title={t('promptComposer.refreshStatus')}
          data-testid="prompt-composer-refresh"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', checking && 'animate-spin')} />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className="btn btn-primary h-7 gap-1.5 px-2 text-[11px]"
          disabled={disabled}
          onClick={() => void compose()}
          title={t('promptComposer.primaryTitle')}
          data-testid="prompt-composer-primary"
        >
          <Languages className={cn('h-3.5 w-3.5', composing && 'animate-pulse')} />
          {composing ? t('promptComposer.composingShort') : t('promptComposer.primary')}
        </button>
        <button
          type="button"
          className="btn h-7 gap-1.5 px-2 text-[11px]"
          disabled={!value.trim()}
          onClick={cleanupOnly}
          title={t('promptComposer.cleanupTitle')}
          data-testid="prompt-composer-translate"
        >
          <ScanLine className="h-3.5 w-3.5" />
          {legacyCleanupTestId && <span className="sr-only" data-testid={legacyCleanupTestId} />}
          {t('promptComposer.cleanup')}
        </button>
        {onModelTune && (
          <button
            type="button"
            className="btn h-7 gap-1.5 px-2 text-[11px]"
            onClick={onModelTune}
            title={t('promptComposer.modelTuneTitle')}
            data-testid="prompt-composer-model-tune"
          >
            <Wand2 className="h-3.5 w-3.5" />
            {legacyModelTuneTestId && <span className="sr-only" data-testid={legacyModelTuneTestId} />}
            {t('promptComposer.modelTune')}
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost h-7 gap-1.5 px-2 text-[11px]"
          disabled
          title={t('promptComposer.dictionaryTitle')}
          data-testid="prompt-composer-dictionary"
        >
          <BookOpen className="h-3.5 w-3.5" />
          {t('promptComposer.dictionary')}
        </button>
        <button
          type="button"
          className={cn(
            'btn h-7 gap-1.5 px-2 text-[11px]',
            slotOpen && 'border-accent/45 bg-accent-dim/40 text-accent'
          )}
          onClick={() => setSlotOpen((value) => !value)}
          aria-expanded={slotOpen}
          data-testid="prompt-composer-slots-toggle"
        >
          <LayoutTemplate className="h-3.5 w-3.5" />
          {t('promptComposer.slots')}
        </button>
      </div>
      {target === 'positive' && recipeHints.length > 0 && (
        <div className="mt-2 rounded-md border border-line/80 bg-bg-1/60 p-1.5" data-testid="prompt-composer-recipe-hints">
          <div className="mb-1 flex items-center gap-1 text-[10px] text-ink-3">
            <Sparkles className="h-3 w-3 text-accent" />
            {t('promptComposer.recipeHints')}
          </div>
          <div className="flex flex-wrap gap-1">
            {recipeHints.map((hint, index) => (
              <button
                key={hint.id}
                type="button"
                className={cn(
                  'max-w-full truncate rounded border px-1.5 py-0.5 text-[10px]',
                  hint.kind === 'trigger'
                    ? 'border-accent/30 bg-accent/10 text-accent hover:bg-accent/20'
                    : 'border-ok/30 bg-ok/10 text-ok hover:bg-ok/20'
                )}
                onClick={() => applyRecipeHint(hint.text)}
                title={t('promptComposer.recipeHintTitle', { source: hint.source })}
                data-testid={`prompt-composer-recipe-hint-${index}`}
              >
                {hint.text}
              </button>
            ))}
          </div>
        </div>
      )}
      {target === 'positive' && hasRelatedModelHints && (
        <div
          className="mt-2 rounded-md border border-line/80 bg-bg-1/60 p-1.5"
          data-testid="prompt-composer-model-related"
          data-related-loras={relatedModelGroups.find((group) => group.key === 'loras')?.items.length ?? 0}
          data-related-vaes={relatedModelGroups.find((group) => group.key === 'vaes')?.items.length ?? 0}
          data-related-controlnets={relatedModelGroups.find((group) => group.key === 'controlnets')?.items.length ?? 0}
        >
          <div className="mb-1 flex items-center gap-1 text-[10px] text-ink-3">
            <Sparkles className="h-3 w-3 text-accent" />
            {t('promptComposer.modelRelated')}
          </div>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
            {relatedModelGroups.filter((group) => group.items.length > 0).map((group) => (
              <div
                key={group.key}
                className="min-w-0 rounded border border-line/70 bg-bg-0/55 p-1"
                data-testid={`prompt-composer-model-related-${group.key}`}
                data-related-count={group.items.length}
              >
                <div className="mb-1 flex items-center gap-1 text-[10px] text-ink-3">
                  <span className="min-w-0 truncate">{t(group.labelKey)}</span>
                  <span className="ml-auto rounded border border-line bg-bg-2 px-1 font-mono text-[9px] text-ink-2">
                    {group.items.length}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {group.items.slice(0, 4).map((item, index) => (
                    <span
                      key={`${group.key}-${item.name}-${index}`}
                      className="max-w-full truncate rounded border border-accent/25 bg-accent/10 px-1.5 py-0.5 text-[10px] text-ink-2"
                      title={[item.name, item.meta, item.notes].filter(Boolean).join('\n')}
                      data-testid={`prompt-composer-model-related-${group.key}-${index}`}
                    >
                      {item.name}
                      {item.meta && <span className="text-ink-3"> · {item.meta}</span>}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {slotOpen && (
        <div
          className="mt-2 rounded-md border border-line bg-bg-1/65 p-2"
          data-testid="prompt-composer-slots"
          data-prompt-style={promptStyle}
          data-negative-strategy={negativeStrategy}
          data-slot-order={positiveSlotOrder.join(',')}
        >
          <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className="rounded border border-accent/35 bg-accent-dim/35 px-1.5 py-0.5 text-accent" data-testid="prompt-composer-slots-style">
              {t(`promptComposer.style.${promptStyle}`)}
            </span>
            <span className="rounded border border-line bg-bg-2 px-1.5 py-0.5 text-ink-3" data-testid="prompt-composer-slots-negative-strategy">
              {t(`promptComposer.negative.${negativeStrategy}`)}
            </span>
            <span className="rounded border border-line bg-bg-2 px-1.5 py-0.5 text-ink-3" data-testid="prompt-composer-slots-order">
              {t('promptComposer.slotOrder', { family: checkpointProfile.family })}
            </span>
            <label className="ml-auto flex min-w-0 items-center gap-1 rounded border border-line bg-bg-0 px-1.5 py-0.5">
              <span className="shrink-0 text-ink-3">{t('promptComposer.slotInsertTarget')}</span>
              <select
                className="min-w-0 bg-transparent text-[10px] text-ink-1 outline-none"
                value={slotInsertTarget}
                onChange={(event) => setPromptComposerSlotInsertTarget(event.target.value as PromptComposerSlotKey)}
                data-testid="prompt-composer-slot-insert-target"
              >
                {orderedSlotFields.map((slot) => (
                  <option key={slot.key} value={slot.key}>
                    {t(slot.labelKey)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mb-2 grid grid-cols-1 gap-1.5 rounded border border-line/75 bg-bg-0/45 p-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto_auto]" data-testid="prompt-composer-slot-templates">
            <select
              className="input h-7 min-w-0 text-[11px]"
              value={slotTemplateId}
              onChange={(event) => {
                const id = event.target.value
                setSlotTemplateId(id)
                const template = sortedSlotTemplates.find((item) => item.id === id) ?? null
                setSlotTemplateName(template?.name ?? '')
              }}
              aria-label={t('promptComposer.templateSelect')}
              data-testid="prompt-composer-template-select"
            >
              <option value="">{t('promptComposer.templateSelect')}</option>
              {sortedSlotTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
            <input
              className="input h-7 min-w-0 text-[11px]"
              value={slotTemplateName}
              onChange={(event) => setSlotTemplateName(event.target.value)}
              placeholder={t('promptComposer.templateNamePlaceholder')}
              aria-label={t('promptComposer.templateName')}
              data-testid="prompt-composer-template-name"
            />
            <button
              type="button"
              className="btn h-7 gap-1.5 px-2 text-[11px]"
              disabled={!selectedSlotTemplate || slotTemplateBusy}
              onClick={() => void loadSlotTemplate()}
              data-testid="prompt-composer-template-load"
              title={t('promptComposer.templateLoad')}
            >
              <LayoutTemplate className="h-3.5 w-3.5" />
              {t('promptComposer.templateLoad')}
            </button>
            <button
              type="button"
              className="btn btn-primary h-7 gap-1.5 px-2 text-[11px]"
              disabled={!hasSlotInput || slotTemplateBusy}
              onClick={() => void saveSlotTemplate()}
              data-testid="prompt-composer-template-save"
              title={t('promptComposer.templateSave')}
            >
              <Save className="h-3.5 w-3.5" />
              {t('promptComposer.templateSave')}
            </button>
            <button
              type="button"
              className="btn btn-ghost h-7 gap-1.5 px-2 text-[11px]"
              disabled={!selectedSlotTemplate || slotTemplateBusy}
              onClick={() => void removeSlotTemplate()}
              data-testid="prompt-composer-template-delete"
              title={t('promptComposer.templateDelete')}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('promptComposer.templateDelete')}
            </button>
          </div>
          <div className={cn(
            'grid gap-1.5',
            compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'
          )}>
            {orderedSlotFields.map((slot) => (
              <label
                key={slot.key}
                className={cn(
                  'min-w-0 rounded border border-line/75 bg-bg-0/50 p-1.5',
                  slot.key === 'avoidFailures' && 'sm:col-span-2 border-warn/35 bg-warn/5',
                  slotInsertEnabled && slot.key === slotInsertTarget && 'border-accent/60 bg-accent-dim/20 ring-1 ring-accent/30'
                )}
                data-testid={`prompt-composer-slot-card-${slot.key}`}
              >
                <span className="mb-1 flex items-center gap-1 text-[10px] font-medium text-ink-2">
                  {slot.key === 'avoidFailures' && <ShieldAlert className="h-3 w-3 text-warn" />}
                  {t(slot.labelKey)}
                </span>
                <textarea
                  className="input min-h-[44px] w-full resize-y text-xs"
                  value={slotDraft[slot.key] ?? ''}
                  onChange={(event) => updateSlot(slot.key, event.target.value)}
                  placeholder={t(slot.placeholderKey)}
                  aria-label={t(slot.labelKey)}
                  data-prompt-dictionary-autocomplete={slot.key === 'avoidFailures' ? 'negative' : 'positive'}
                  data-testid={`prompt-composer-slot-${slot.key}`}
                />
              </label>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              className="btn btn-primary h-7 gap-1.5 px-2 text-[11px]"
              disabled={composing || !hasSlotInput}
              onClick={() => void applySlotPositive()}
              data-testid="prompt-composer-slots-apply-positive"
            >
              <Wand2 className="h-3.5 w-3.5" />
              {t('promptComposer.slotsApplyPositive')}
            </button>
            <button
              type="button"
              className="btn h-7 gap-1.5 px-2 text-[11px]"
              disabled={composing || !slotDraft.avoidFailures?.trim()}
              onClick={() => void applySlotNegative()}
              data-testid="prompt-composer-slots-apply-negative"
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              {t('promptComposer.slotsApplyNegative')}
            </button>
            <button
              type="button"
              className="btn btn-ghost h-7 px-2 text-[11px]"
              disabled={!hasSlotInput}
              onClick={() => {
                clearPromptComposerSlots()
                setSlotResult(null)
              }}
              data-testid="prompt-composer-slots-clear"
            >
              {t('history.proRecipeClear')}
            </button>
          </div>
          {slotResult && (
            <div className="mt-2 flex flex-wrap gap-1 text-[10px]" data-testid="prompt-composer-slots-preview">
              {slotResult.positiveTags.slice(0, 6).map((tag) => (
                <span key={`p-${tag}`} className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-ink-2">{tag}</span>
              ))}
              {slotResult.negativeTags.slice(0, 6).map((tag) => (
                <span key={`n-${tag}`} className="rounded border border-err/30 bg-err/10 px-1.5 py-0.5 text-ink-2">{tag}</span>
              ))}
              {slotResult.positiveReplacements.slice(0, 4).map((tag) => (
                <span key={`r-${tag}`} className="rounded border border-ok/30 bg-ok/10 px-1.5 py-0.5 text-ink-2">{tag}</span>
              ))}
            </div>
          )}
        </div>
      )}
      {lastResult && (lastResult.negativeSuggestions.length > 0 || lastResult.warnings.length > 0) && (
        <div className="mt-1.5 flex flex-wrap gap-1 text-[10px]" data-testid="prompt-composer-hints">
          {lastResult.negativeSuggestions.slice(0, 4).map((tag) => (
            <span key={tag} className="rounded border border-err/30 bg-err/10 px-1.5 py-0.5 text-ink-2">{tag}</span>
          ))}
          {lastResult.warnings.slice(0, 2).map((warning) => (
            <span key={warning} className="rounded border border-warn/30 bg-warn/10 px-1.5 py-0.5 text-warn">{warning}</span>
          ))}
        </div>
      )}
    </section>
  )
}

interface PromptComposerSlotField {
  key: PromptComposerSlotKey
  labelKey: string
  placeholderKey: string
}

const PROMPT_COMPOSER_SLOT_FIELDS: PromptComposerSlotField[] = [
  {
    key: 'qualityPrefix',
    labelKey: 'promptComposer.slot.qualityPrefix',
    placeholderKey: 'promptComposer.slotPlaceholder.qualityPrefix'
  },
  {
    key: 'subject',
    labelKey: 'promptComposer.slot.subject',
    placeholderKey: 'promptComposer.slotPlaceholder.subject'
  },
  {
    key: 'composition',
    labelKey: 'promptComposer.slot.composition',
    placeholderKey: 'promptComposer.slotPlaceholder.composition'
  },
  {
    key: 'expressionPose',
    labelKey: 'promptComposer.slot.expressionPose',
    placeholderKey: 'promptComposer.slotPlaceholder.expressionPose'
  },
  {
    key: 'lighting',
    labelKey: 'promptComposer.slot.lighting',
    placeholderKey: 'promptComposer.slotPlaceholder.lighting'
  },
  {
    key: 'color',
    labelKey: 'promptComposer.slot.color',
    placeholderKey: 'promptComposer.slotPlaceholder.color'
  },
  {
    key: 'clothingProps',
    labelKey: 'promptComposer.slot.clothingProps',
    placeholderKey: 'promptComposer.slotPlaceholder.clothingProps'
  },
  {
    key: 'background',
    labelKey: 'promptComposer.slot.background',
    placeholderKey: 'promptComposer.slotPlaceholder.background'
  },
  {
    key: 'textureStyle',
    labelKey: 'promptComposer.slot.textureStyle',
    placeholderKey: 'promptComposer.slotPlaceholder.textureStyle'
  },
  {
    key: 'finishing',
    labelKey: 'promptComposer.slot.finishing',
    placeholderKey: 'promptComposer.slotPlaceholder.finishing'
  },
  {
    key: 'avoidFailures',
    labelKey: 'promptComposer.slot.avoidFailures',
    placeholderKey: 'promptComposer.slotPlaceholder.avoidFailures'
  }
]

interface PromptComposerRelatedModelGroup {
  key: 'loras' | 'vaes' | 'controlnets'
  labelKey: string
  items: PromptComposerRelatedModelItem[]
}

interface PromptComposerRelatedModelItem {
  name: string
  meta: string
  notes: string
}

function buildPromptComposerRelatedModelGroups(profile: CheckpointPromptProfile): PromptComposerRelatedModelGroup[] {
  const related = profile.relatedModels
  return [
    {
      key: 'loras',
      labelKey: 'promptComposer.relatedLoras',
      items: promptComposerRelatedItems(related?.loras ?? [])
    },
    {
      key: 'vaes',
      labelKey: 'promptComposer.relatedVaes',
      items: promptComposerRelatedItems(related?.vaes ?? [])
    },
    {
      key: 'controlnets',
      labelKey: 'promptComposer.relatedControlNets',
      items: promptComposerRelatedItems(related?.controlNets ?? [])
    }
  ]
}

function promptComposerRelatedItems(items: CheckpointRelatedModelReference[]): PromptComposerRelatedModelItem[] {
  return items
    .filter((item) => item.name.trim())
    .map((item) => ({
      name: item.name.trim(),
      meta: promptComposerRelatedMeta(item),
      notes: (item.notes ?? []).join('\n')
    }))
}

function promptComposerRelatedMeta(item: CheckpointRelatedModelReference): string {
  const parts: string[] = []
  if (item.role?.trim()) parts.push(item.role.trim())
  if (item.weight != null) parts.push(`w ${formatPromptComposerRelatedWeight(item.weight)}`)
  const firstNote = item.notes?.find((note) => note.trim())?.trim()
  if (firstNote) parts.push(firstNote)
  return parts.join(' / ')
}

function formatPromptComposerRelatedWeight(weight: number): string {
  return Number.isInteger(weight) ? String(weight) : weight.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}
