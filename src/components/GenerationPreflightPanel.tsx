import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { useMemo } from 'react'
import toast from 'react-hot-toast'
import { useStore, type AppState } from '@/lib/store'
import { useT, t as tStatic } from '@/lib/i18n'
import { getExtensionGuardIssues } from '@/lib/extension-guards'
import { baseModelsCompatible } from '@/lib/lora-suggest'
import { approxTokenCount, formatPromptText, promptAppend, promptNeedsFormatting } from '@/lib/prompt-utils'
import type { CheckpointPromptProfile, CheckpointRelatedModelReference } from '@shared/types'
import {
  checkpointPromptContextFromModel,
  checkpointPromptProfileParamsChanged,
  checkpointPromptProfileParamsPatch,
  checkpointPromptProfileSuggests,
  defaultCheckpointPromptProfile,
  findCheckpointPromptProfile,
  formatPromptForCheckpoint
} from '@/lib/checkpoint-prompt-profile'
import { parseAdapterTokens } from '@/lib/adapter-tokens'
import { buildDynamicPromptContext, hasDynamicPromptSyntax, resolveDynamicPrompt } from '@/lib/dynamic-prompts'
import { cn } from '@/lib/utils'

export type PreflightSeverity = 'block' | 'warn' | 'ok'
export interface PreflightItem {
  severity: PreflightSeverity
  key: string
  messageKey: string
  params?: Record<string, string | number>
}

export function GenerationPreflightPanel(): JSX.Element {
  const state = useStore((s) => s)
  const t = useT()
  const items = useMemo(() => buildPreflightItems(state), [state])
  const relatedModelGroups = useMemo(() => buildPreflightRelatedModelGroups(state), [state])
  const blockers = items.filter((item) => item.severity === 'block').length
  const warnings = items.filter((item) => item.severity === 'warn').length
  const ok = blockers === 0 && warnings === 0
  const visibleItems = items.filter((item) => item.severity !== 'ok').slice(0, 6)
  const hasRelatedModels = relatedModelGroups.some((group) => group.items.length > 0)

  return (
    <section
      className="rounded-md border border-line bg-bg-0/50 p-2 text-[11px]"
      data-testid="preflight-panel"
      data-preflight-blockers={blockers}
      data-preflight-warnings={warnings}
    >
      <div className="flex items-center gap-1.5 text-ink-2">
        {ok ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-ok" />
        ) : blockers > 0 ? (
          <AlertTriangle className="h-3.5 w-3.5 text-warn" />
        ) : (
          <Info className="h-3.5 w-3.5 text-accent" />
        )}
        <span className="font-medium text-ink-1">{t('preflight.title')}</span>
        <span className={cn(
          'ml-auto rounded border px-1.5 py-0.5 font-mono text-[10px]',
          ok
            ? 'border-ok/45 text-ok'
            : blockers > 0
              ? 'border-warn/45 text-warn'
              : 'border-accent/45 text-accent'
        )} data-testid="preflight-summary">
          {ok
            ? t('preflight.ready')
            : t('preflight.summary', { blocks: blockers, warnings })}
        </span>
      </div>

      {!ok && (
        <div className="mt-2 space-y-1">
          {visibleItems.map((item) => {
            const target = preflightTargetForKey(item.key)
            const canQuickFix = canQuickFixPreflightItem(item.key)
            return (
            <div
              key={item.key}
              className="flex items-start gap-1.5 leading-relaxed"
              data-testid={`preflight-item-${item.key}`}
              data-preflight-severity={item.severity}
              data-preflight-target={target?.testIds.join(',') ?? ''}
              data-preflight-can-fix={canQuickFix ? 'true' : 'false'}
            >
              {item.severity === 'block' ? (
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warn" />
              ) : (
                <Info className="mt-0.5 h-3 w-3 shrink-0 text-accent" />
              )}
              <span className={cn(
                'min-w-0 flex-1',
                item.severity === 'block' ? 'text-warn' : 'text-ink-3'
              )}>
                {t(item.messageKey, item.params)}
              </span>
              {target && (
                <button
                  type="button"
                  className="btn btn-ghost shrink-0 px-1.5 py-0.5 text-[10px]"
                  onClick={() => focusPreflightItem(item.key)}
                  data-testid={`preflight-open-${item.key}`}
                >
                  {t('preflight.open')}
                </button>
              )}
              {canQuickFix && (
                <button
                  type="button"
                  className="btn btn-ghost shrink-0 px-1.5 py-0.5 text-[10px]"
                  onClick={() => quickFixPreflightItem(item.key)}
                  data-testid={`preflight-fix-${item.key}`}
                >
                  {t('preflight.quickFix')}
                </button>
              )}
            </div>
          )})}
        </div>
      )}
      {hasRelatedModels && (
        <div
          className="mt-2 rounded-md border border-line/80 bg-bg-1/55 p-1.5"
          data-testid="preflight-related-models"
          data-preflight-related-loras={relatedModelGroups.find((group) => group.key === 'loras')?.items.length ?? 0}
          data-preflight-related-vaes={relatedModelGroups.find((group) => group.key === 'vaes')?.items.length ?? 0}
          data-preflight-related-controlnets={relatedModelGroups.find((group) => group.key === 'controlnets')?.items.length ?? 0}
        >
          <div className="mb-1 flex items-center gap-1 text-[10px] font-medium text-ink-2">
            <Info className="h-3 w-3 text-accent" />
            {t('preflight.relatedModels')}
          </div>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
            {relatedModelGroups.filter((group) => group.items.length > 0).map((group) => (
              <div
                key={group.key}
                className="min-w-0 rounded border border-line/70 bg-bg-0/60 p-1"
                data-testid={`preflight-related-${group.key}`}
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
                      data-testid={`preflight-related-${group.key}-${index}`}
                      data-related-status={item.status}
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
    </section>
  )
}

export function buildPreflightItems(state: AppState): PreflightItem[] {
  const items: PreflightItem[] = []

  if (state.forgeStatus.kind !== 'ready') {
    items.push({
      severity: 'block',
      key: 'forge',
      messageKey: 'preflight.forgeNotReady',
      params: { status: state.forgeStatus.kind }
    })
  }
  if (!state.selectedModelTitle) {
    items.push({ severity: 'block', key: 'model', messageKey: 'preflight.noModel' })
  } else if (!state.models.some((model) => model.title === state.selectedModelTitle)) {
    items.push({
      severity: 'block',
      key: 'model',
      messageKey: 'preflight.invalidModel',
      params: { name: state.selectedModelTitle }
    })
  }
  if (state.currentTab !== 'txt2img' && state.currentTab !== 'img2img') {
    items.push({
      severity: 'block',
      key: 'tab',
      messageKey: 'preflight.unsupportedTab',
      params: { tab: state.currentTab }
    })
  }
  if (state.currentTab === 'img2img' && !state.inputImage) {
    items.push({ severity: 'block', key: 'img2img-image', messageKey: 'preflight.img2imgNeedsImage' })
  }

  for (const issue of getExtensionGuardIssues(state)) {
    items.push({
      severity: 'block',
      key: issue.code,
      messageKey: issue.messageKey,
      params: issue.params
    })
  }

  if (state.selectedVae !== 'Automatic' && state.selectedVae !== 'None') {
    const hasVae = state.vaes.some((vae) => vae.modelName === state.selectedVae)
    if (!hasVae) {
      items.push({
        severity: 'warn',
        key: 'vae',
        messageKey: 'preflight.vaeMissing',
        params: { name: state.selectedVae }
      })
    }
  }

  const promptTokens = approxTokenCount(state.prompt)
  if (promptTokens > 150) {
    items.push({
      severity: 'warn',
      key: 'prompt-tokens',
      messageKey: 'preflight.promptTooLong',
      params: { tokens: promptTokens }
    })
  }
  if (promptNeedsFormatting(state.prompt) || promptNeedsFormatting(state.negativePrompt)) {
    items.push({
      severity: 'warn',
      key: 'prompt-format',
      messageKey: 'preflight.promptFormatSuggested'
    })
  }
  const selectedModel = state.models.find((model) => model.title === state.selectedModelTitle) ?? null
  const checkpointPromptContext = checkpointPromptContextFromModel(selectedModel, state.recommendation)
  const checkpointPromptProfile = findCheckpointPromptProfile(state.checkpointPromptProfiles, checkpointPromptContext)
  const positiveModelFormat = formatPromptForCheckpoint(
    state.prompt,
    'positive',
    checkpointPromptContext,
    checkpointPromptProfile
  )
  const negativeModelFormat = formatPromptForCheckpoint(
    state.negativePrompt,
    'negative',
    checkpointPromptContext,
    checkpointPromptProfile
  )
  const effectiveCheckpointProfile = checkpointPromptProfile ?? positiveModelFormat.profile
  if (
    checkpointPromptProfileSuggests(positiveModelFormat.profile) &&
    (positiveModelFormat.modelChanged || negativeModelFormat.modelChanged)
  ) {
    items.push({
      severity: 'warn',
      key: 'model-prompt-format',
      messageKey: 'preflight.modelPromptFormatSuggested',
      params: { family: positiveModelFormat.family }
    })
  }
  if (
    checkpointPromptProfileSuggests(checkpointPromptProfile) &&
    checkpointPromptProfileParamsChanged(state.params, checkpointPromptProfile)
  ) {
    items.push({
      severity: 'warn',
      key: 'model-profile-settings',
      messageKey: 'preflight.modelProfileSettingsSuggested',
      params: { family: positiveModelFormat.family }
    })
  }
  if (checkpointPromptProfileSuggests(effectiveCheckpointProfile)) {
    const recommendedAspect = recommendedAspectRatioForParams(
      state.params.width,
      state.params.height,
      effectiveCheckpointProfile
    )
    if (recommendedAspect) {
      items.push({
        severity: 'warn',
        key: 'model-profile-aspect',
        messageKey: 'preflight.modelProfileAspectSuggested',
        params: {
          width: state.params.width,
          height: state.params.height,
          recommended: `${recommendedAspect.label} ${recommendedAspect.width}x${recommendedAspect.height}`
        }
      })
    }
    const loraRange = effectiveCheckpointProfile?.recommendedLoraCount ?? null
    if (loraRange && (state.activeLoras.length < loraRange.min || state.activeLoras.length > loraRange.max)) {
      items.push({
        severity: 'warn',
        key: 'model-profile-lora-count',
        messageKey: 'preflight.modelProfileLoraCountSuggested',
        params: {
          count: state.activeLoras.length,
          min: loraRange.min,
          max: loraRange.max
        }
      })
    }
  }
  if (hasDynamicPromptSyntax(state.prompt) || hasDynamicPromptSyntax(state.negativePrompt)) {
    const context = buildDynamicPromptContext({
      library: state.library,
      customLibrary: state.customLibrary,
      history: state.history,
      recentTags: state.recentTags,
      favorites: state.favorites
    })
    const promptSeed = state.params.seed >= 0 ? state.params.seed : 1001
    const issues = [
      ...resolveDynamicPrompt(state.prompt, context, promptSeed).issues,
      ...resolveDynamicPrompt(state.negativePrompt, context, promptSeed + 1).issues
    ]
    const blocker = issues.find((issue) => issue.severity === 'error')
    if (blocker) {
      items.push({
        severity: 'block',
        key: 'dynamic-prompt',
        messageKey: 'preflight.dynamicPromptError',
        params: { message: blocker.message }
      })
    } else {
      items.push({
        severity: 'warn',
        key: 'dynamic-prompt',
        messageKey: 'preflight.dynamicPromptActive'
      })
    }
  }
  const adapterTokens = parseAdapterTokens(state.prompt)
  if (adapterTokens.some((token) => token.kind === 'lyco')) {
    items.push({
      severity: 'warn',
      key: 'adapter-legacy-lyco',
      messageKey: 'preflight.adapterLegacyLyco'
    })
  }
  if (adapterTokens.some((token) => token.kind !== 'hypernet' && token.complex)) {
    items.push({
      severity: 'warn',
      key: 'adapter-complex-weight',
      messageKey: 'preflight.adapterComplexWeight'
    })
  }

  const knownLoras = new Set(state.loras.map((lora) => lora.name))
  const missingLoras = state.activeLoras.filter((lora) => !knownLoras.has(lora.name))
  if (missingLoras.length > 0) {
    items.push({
      severity: 'warn',
      key: 'lora',
      messageKey: 'preflight.loraMissing',
      params: { count: missingLoras.length }
    })
  }
  const checkpointBase = state.recommendation?.baseModel ?? inferBaseModelFromTitle(state.selectedModelTitle)
  if (checkpointBase && isSdxlFamily(checkpointBase) && isLikelySd15Vae(state.selectedVae)) {
    items.push({
      severity: 'warn',
      key: 'vae-base',
      messageKey: 'preflight.vaeBaseMismatch',
      params: { name: state.selectedVae }
    })
  }
  const incompatibleLoras = state.activeLoras.filter((active) => {
    const meta = state.loraMeta.get(active.name)
    return Boolean(checkpointBase && meta?.baseModel && !baseModelsCompatible(checkpointBase, meta.baseModel))
  })
  if (incompatibleLoras.length > 0) {
    items.push({
      severity: 'warn',
      key: 'lora-base',
      messageKey: 'preflight.loraBaseMismatch',
      params: { count: incompatibleLoras.length }
    })
  }
  const promptLower = state.prompt.toLowerCase()
  const missingTriggers = state.activeLoras.filter((active) =>
    active.triggerWords.length > 0 &&
    active.triggerWords.every((word) => !promptLower.includes(word.toLowerCase()))
  )
  if (missingTriggers.length > 0) {
    items.push({
      severity: 'warn',
      key: 'lora-trigger',
      messageKey: 'preflight.loraTriggerMissing',
      params: { count: missingTriggers.length }
    })
  }

  if (checkpointBase && isSdxlFamily(checkpointBase) && Math.max(state.params.width, state.params.height) < 900) {
    items.push({
      severity: 'warn',
      key: 'sdxl-size',
      messageKey: 'preflight.sdxlSmallSize',
      params: { width: state.params.width, height: state.params.height }
    })
  }

  if (state.controlnet.enabled) {
    const enabledUnits = state.controlnet.units.filter((unit) => unit.enabled)
    if (enabledUnits.length === 0) {
      items.push({ severity: 'warn', key: 'cn-none', messageKey: 'preflight.controlnetNoEnabledUnits' })
    }
    enabledUnits.forEach((unit, index) => {
      if (!unit.image) {
        items.push({
          severity: 'block',
          key: `cn-image-${index}`,
          messageKey: 'preflight.controlnetNoImage',
          params: { unit: index + 1 }
        })
      }
      if (unit.model === 'None' && !unit.module.toLowerCase().includes('reference')) {
        items.push({
          severity: 'warn',
          key: `cn-model-${index}`,
          messageKey: 'preflight.controlnetModelMissing',
          params: { unit: index + 1 }
        })
      }
      if (checkpointBase && unit.model !== 'None') {
        const mismatch = controlNetBaseMismatch(checkpointBase, unit.model)
        if (mismatch) {
          items.push({
            severity: 'block',
            key: `cn-base-${index}`,
            messageKey: 'preflight.controlnetBaseMismatch',
            params: { unit: index + 1, expected: mismatch.expected, actual: mismatch.actual }
          })
        }
      }
    })
  }

  if (state.fabric.enabled && state.fabric.positive.length + state.fabric.negative.length === 0) {
    items.push({ severity: 'warn', key: 'fabric-empty', messageKey: 'preflight.fabricNoFeedback' })
  }
  if (state.adetailer.enabled && state.adetailer.units.every((unit) => unit.model === 'None')) {
    items.push({ severity: 'warn', key: 'adetailer-empty', messageKey: 'preflight.adetailerNoModel' })
  }

  if (items.length === 0) {
    items.push({ severity: 'ok', key: 'ok', messageKey: 'preflight.ok' })
  }
  return items
}

function canQuickFixPreflightItem(key: string): boolean {
  return key === 'lora-trigger' ||
    key === 'sdxl-size' ||
    key === 'prompt-format' ||
    key === 'model-prompt-format' ||
    key === 'model-profile-settings' ||
    key === 'model-profile-aspect'
}

function quickFixPreflightItem(key: string): void {
  const state = useStore.getState()
  if (key === 'prompt-format') {
    const promptResult = formatPromptText(state.prompt)
    const negativeResult = formatPromptText(state.negativePrompt)
    if (!promptResult.summary.changed && !negativeResult.summary.changed) {
      focusPreflightItem(key)
      return
    }
    if (promptResult.summary.changed) state.setPrompt(promptResult.prompt)
    if (negativeResult.summary.changed) state.setNegativePrompt(negativeResult.prompt)
    toast.success(tStatic('preflight.fixedPromptFormat'))
    focusPreflightItem(key)
    return
  }

  if (key === 'model-prompt-format') {
    const selectedModel = state.models.find((model) => model.title === state.selectedModelTitle) ?? null
    const context = checkpointPromptContextFromModel(selectedModel, state.recommendation)
    const profile = findCheckpointPromptProfile(state.checkpointPromptProfiles, context)
    const promptResult = formatPromptForCheckpoint(state.prompt, 'positive', context, profile)
    const negativeResult = formatPromptForCheckpoint(state.negativePrompt, 'negative', context, profile)
    if (!promptResult.changed && !negativeResult.changed) {
      focusPreflightItem(key)
      return
    }
    if (promptResult.changed) state.setPrompt(promptResult.prompt)
    if (negativeResult.changed) state.setNegativePrompt(negativeResult.prompt)
    toast.success(tStatic('preflight.fixedModelPromptFormat'))
    focusPreflightItem('prompt-tokens')
    return
  }

  if (key === 'model-profile-settings') {
    const selectedModel = state.models.find((model) => model.title === state.selectedModelTitle) ?? null
    const context = checkpointPromptContextFromModel(selectedModel, state.recommendation)
    const profile = findCheckpointPromptProfile(state.checkpointPromptProfiles, context)
    if (!checkpointPromptProfileParamsChanged(state.params, profile)) {
      focusPreflightItem(key)
      return
    }
    state.patchParams(checkpointPromptProfileParamsPatch(profile))
    toast.success(tStatic('preflight.fixedModelProfileSettings'))
    focusPreflightItem(key)
    return
  }

  if (key === 'model-profile-aspect') {
    const selectedModel = state.models.find((model) => model.title === state.selectedModelTitle) ?? null
    const context = checkpointPromptContextFromModel(selectedModel, state.recommendation)
    const profile = findCheckpointPromptProfile(state.checkpointPromptProfiles, context) ??
      defaultCheckpointPromptProfile(context)
    const recommendedAspect = recommendedAspectRatioForParams(state.params.width, state.params.height, profile)
    if (!recommendedAspect) {
      focusPreflightItem(key)
      return
    }
    state.patchParams({ width: recommendedAspect.width, height: recommendedAspect.height })
    toast.success(tStatic('preflight.fixedModelProfileAspect'))
    focusPreflightItem(key)
    return
  }

  if (key === 'lora-trigger') {
    const promptLower = state.prompt.toLowerCase()
    const missingWords = uniqueNonEmpty(
      state.activeLoras.flatMap((active) =>
        active.triggerWords.filter((word) => !promptLower.includes(word.toLowerCase()))
      )
    )
    if (missingWords.length === 0) {
      focusPreflightItem(key)
      return
    }
    const nextPrompt = missingWords.reduce((next, word) => promptAppend(next, word), state.prompt)
    state.setPrompt(nextPrompt)
    toast.success(tStatic('preflight.fixedTriggerWords', { count: missingWords.length }))
    focusPreflightItem('prompt-tokens')
    return
  }

  if (key === 'sdxl-size') {
    const current = state.params
    const next = current.width > current.height
      ? { width: 1216, height: 832 }
      : current.height > current.width
        ? { width: 832, height: 1216 }
        : { width: 1024, height: 1024 }
    state.patchParams(next)
    toast.success(tStatic('preflight.fixedSdxlSize', next))
    focusPreflightItem(key)
  }
}

function uniqueNonEmpty(words: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of words) {
    const word = raw.trim()
    if (!word) continue
    const key = word.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(word)
  }
  return out
}

function recommendedAspectRatioForParams(
  width: number,
  height: number,
  profile: CheckpointPromptProfile | null | undefined
): NonNullable<CheckpointPromptProfile['recommendedAspectRatios']>[number] | null {
  const ratios = profile?.recommendedAspectRatios ?? []
  if (ratios.length === 0 || width <= 0 || height <= 0) return null
  const currentRatio = width / height
  const matched = ratios.some((ratio) => {
    const targetRatio = ratio.width / ratio.height
    return Math.abs(currentRatio - targetRatio) <= 0.02
  })
  return matched ? null : ratios[0]
}

interface PreflightRelatedModelGroup {
  key: 'loras' | 'vaes' | 'controlnets'
  labelKey: string
  items: PreflightRelatedModelItem[]
}

interface PreflightRelatedModelItem {
  name: string
  meta: string
  notes: string
  status: 'active' | 'selected' | 'enabled' | 'available' | 'memo'
}

function buildPreflightRelatedModelGroups(state: AppState): PreflightRelatedModelGroup[] {
  const selectedModel = state.models.find((model) => model.title === state.selectedModelTitle) ?? null
  const modelContext = checkpointPromptContextFromModel(selectedModel, state.recommendation)
  const context = selectedModel
    ? modelContext
    : { ...modelContext, title: state.selectedModelTitle, name: state.selectedModelTitle }
  const profile = findCheckpointPromptProfile(state.checkpointPromptProfiles, context)
  const related = profile?.relatedModels
  const activeLoraNames = state.activeLoras.map((lora) => lora.name)
  const availableLoraNames = state.loras.map((lora) => lora.name)
  const availableVaeNames = state.vaes.map((vae) => vae.modelName)
  const enabledControlNetNames = state.controlnet.units
    .filter((unit) => unit.enabled && unit.model !== 'None')
    .map((unit) => unit.model)
  const availableControlNetNames = state.controlnetModelList

  return [
    {
      key: 'loras',
      labelKey: 'preflight.relatedLoras',
      items: summarizeRelatedModels(related?.loras ?? [], (item) => {
        if (hasRelatedName(activeLoraNames, item.name)) return 'active'
        if (hasRelatedName(availableLoraNames, item.name)) return 'available'
        return 'memo'
      })
    },
    {
      key: 'vaes',
      labelKey: 'preflight.relatedVaes',
      items: summarizeRelatedModels(related?.vaes ?? [], (item) => {
        if (relatedNamesMatch(state.selectedVae, item.name)) return 'selected'
        if (hasRelatedName(availableVaeNames, item.name)) return 'available'
        return 'memo'
      })
    },
    {
      key: 'controlnets',
      labelKey: 'preflight.relatedControlNets',
      items: summarizeRelatedModels(related?.controlNets ?? [], (item) => {
        if (hasRelatedName(enabledControlNetNames, item.name)) return 'enabled'
        if (hasRelatedName(availableControlNetNames, item.name)) return 'available'
        return 'memo'
      })
    }
  ]
}

function summarizeRelatedModels(
  items: CheckpointRelatedModelReference[],
  statusFor: (item: CheckpointRelatedModelReference) => PreflightRelatedModelItem['status']
): PreflightRelatedModelItem[] {
  return items
    .filter((item) => item.name.trim())
    .map((item) => ({
      name: item.name.trim(),
      meta: relatedModelMeta(item),
      notes: (item.notes ?? []).join('\n'),
      status: statusFor(item)
    }))
}

function relatedModelMeta(item: CheckpointRelatedModelReference): string {
  const parts: string[] = []
  if (item.role?.trim()) parts.push(item.role.trim())
  if (item.weight != null) parts.push(`w ${formatRelatedWeight(item.weight)}`)
  const firstNote = item.notes?.find((note) => note.trim())?.trim()
  if (firstNote) parts.push(firstNote)
  return parts.join(' / ')
}

function formatRelatedWeight(weight: number): string {
  return Number.isInteger(weight) ? String(weight) : weight.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function hasRelatedName(names: string[], target: string): boolean {
  return names.some((name) => relatedNamesMatch(name, target))
}

function relatedNamesMatch(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = normalizeRelatedName(left)
  const b = normalizeRelatedName(right)
  if (!a || !b) return false
  return a === b || a.includes(b) || b.includes(a)
}

function normalizeRelatedName(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/\[[a-f0-9]{6,}\]/g, '')
    .replace(/\.(safetensors|ckpt|pt|pth|bin)$/g, '')
    .replace(/[^a-z0-9]+/g, '')
}

interface PreflightTarget {
  tab?: AppState['currentTab']
  sideTab?: 'library' | 'lora' | 'history' | 'presets'
  testIds: string[]
}

function preflightTargetForKey(key: string): PreflightTarget | null {
  if (key === 'tab') return { tab: 'txt2img', testIds: ['main-tab-txt2img'] }
  if (key === 'model' || key === 'vae' || key === 'vae-base' || key === 'forge') {
    return { sideTab: 'library', testIds: ['side-tab-library', 'side-content-library'] }
  }
  if (key === 'img2img-image') {
    return { tab: 'img2img', testIds: ['input-image-panel', 'input-image-empty'] }
  }
  if (key === 'prompt-tokens' || key === 'prompt-format' || key === 'model-prompt-format' || key.startsWith('adapter-')) {
    return { tab: 'txt2img', testIds: ['prompt-positive-section'] }
  }
  if (key === 'model-profile-settings' || key === 'model-profile-aspect') {
    return { tab: 'txt2img', testIds: ['parameters-panel'] }
  }
  if (key === 'dynamic-prompt') {
    return { tab: 'txt2img', testIds: ['dynamic-prompt-lab', 'prompt-positive-section'] }
  }
  if (key === 'lora-trigger') {
    return { tab: 'txt2img', sideTab: 'lora', testIds: ['generation-create-lora', 'side-content-lora'] }
  }
  if (key === 'lora' || key === 'lora-base' || key === 'model-profile-lora-count') {
    return { tab: 'txt2img', sideTab: 'lora', testIds: ['side-tab-lora', 'side-content-lora'] }
  }
  if (key === 'sdxl-size') {
    return { tab: 'txt2img', testIds: ['parameters-panel'] }
  }
  if (key === 'fabric-empty' || key === 'fabric-controlnet-reference') {
    return { tab: 'txt2img', testIds: ['fabric-panel', 'controlnet-panel'] }
  }
  if (key === 'adetailer-empty') {
    return { tab: 'txt2img', testIds: ['adetailer-panel'] }
  }
  if (key.startsWith('cn-')) {
    return { tab: 'txt2img', testIds: ['controlnet-builder-panel', 'controlnet-panel'] }
  }
  if (key.startsWith('regional-')) {
    return { tab: 'txt2img', testIds: ['regional-prompter-panel', 'prompt-positive-section'] }
  }
  return null
}

function focusPreflightItem(key: string): void {
  const target = preflightTargetForKey(key)
  if (!target) return
  const store = useStore.getState()
  if (target.tab) store.setCurrentTab(target.tab)
  window.setTimeout(() => {
    if (target.sideTab) {
      clickByTestId(`side-tab-${target.sideTab}`)
    }
    const node = target.testIds
      .map((id) => document.querySelector(`[data-testid="${id}"]`))
      .find((candidate): candidate is HTMLElement => candidate instanceof HTMLElement)
    if (!node) return
    node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
    node.focus({ preventScroll: true })
  }, 0)
}

function clickByTestId(id: string): void {
  const node = document.querySelector(`[data-testid="${id}"]`)
  if (node instanceof HTMLElement) node.click()
}

function inferBaseModelFromTitle(title: string | null): string | null {
  if (!title) return null
  if (/sdxl|pony|illustrious|animagine|noobai|[a-z0-9]xl(?:[_\-.]|$)/i.test(title)) return 'SDXL'
  if (/sd\s*1\.5|sd1\.5|sd15|v1-?5/i.test(title)) return 'SD 1.5'
  if (/flux/i.test(title)) return 'FLUX'
  return null
}

function isSdxlFamily(baseModel: string): boolean {
  return /sdxl|pony|illustrious|animagine|noobai/i.test(baseModel)
}

function isLikelySd15Vae(selectedVae: string): boolean {
  if (!selectedVae || selectedVae === 'Automatic' || selectedVae === 'None') return false
  if (/sdxl|pony|illustrious|animagine|noobai|fix.?fp16/i.test(selectedVae)) return false
  return /sd\s*1\.5|sd1\.5|sd15|vae[-_]?ft[-_]?mse|840000|ema[-_]?pruned/i.test(selectedVae)
}

function controlNetBaseMismatch(checkpointBase: string, controlNetModel: string): {
  expected: string
  actual: string
} | null {
  const expected = controlNetExpectedFamily(checkpointBase)
  const actual = controlNetModelFamily(controlNetModel)
  if (!expected || !actual || expected === actual) return null
  return { expected, actual }
}

function controlNetExpectedFamily(baseModel: string): string | null {
  if (/sdxl|pony|illustrious|animagine|noobai/i.test(baseModel)) return 'SDXL'
  if (/sd\s*1\.5|sd1\.5|sd15/i.test(baseModel)) return 'SD1.5'
  if (/flux/i.test(baseModel)) return 'FLUX'
  return null
}

function controlNetModelFamily(model: string): string | null {
  if (/flux/i.test(model)) return 'FLUX'
  if (/sdxl|\bxl\b|pony|illustrious|animagine/i.test(model)) return 'SDXL'
  if (/sd15|sd1\.5|control_v11|controlnet11|v11p|v11f/i.test(model)) return 'SD1.5'
  return null
}
