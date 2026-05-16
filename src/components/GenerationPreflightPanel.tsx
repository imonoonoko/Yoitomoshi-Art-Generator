import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { useMemo } from 'react'
import toast from 'react-hot-toast'
import { useStore, type AppState } from '@/lib/store'
import { useT, t as tStatic } from '@/lib/i18n'
import { getExtensionGuardIssues } from '@/lib/extension-guards'
import { baseModelsCompatible } from '@/lib/lora-suggest'
import { approxTokenCount, formatPromptText, promptAppend, promptNeedsFormatting } from '@/lib/prompt-utils'
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
  const blockers = items.filter((item) => item.severity === 'block').length
  const warnings = items.filter((item) => item.severity === 'warn').length
  const ok = blockers === 0 && warnings === 0
  const visibleItems = items.filter((item) => item.severity !== 'ok').slice(0, 6)

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
            severity: 'warn',
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
  return key === 'lora-trigger' || key === 'sdxl-size' || key === 'prompt-format'
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

interface PreflightTarget {
  tab?: AppState['currentTab']
  sideTab?: 'library' | 'lora' | 'history' | 'presets'
  testIds: string[]
}

function preflightTargetForKey(key: string): PreflightTarget | null {
  if (key === 'tab') return { tab: 'txt2img', testIds: ['main-tab-txt2img'] }
  if (key === 'model' || key === 'vae' || key === 'forge') {
    return { sideTab: 'library', testIds: ['side-tab-library', 'side-content-library'] }
  }
  if (key === 'img2img-image') {
    return { tab: 'img2img', testIds: ['input-image-panel', 'input-image-empty'] }
  }
  if (key === 'prompt-tokens' || key === 'prompt-format' || key.startsWith('adapter-')) {
    return { tab: 'txt2img', testIds: ['prompt-positive-section'] }
  }
  if (key === 'dynamic-prompt') {
    return { tab: 'txt2img', testIds: ['dynamic-prompt-lab', 'prompt-positive-section'] }
  }
  if (key === 'lora-trigger') {
    return { tab: 'txt2img', sideTab: 'lora', testIds: ['generation-create-lora', 'side-content-lora'] }
  }
  if (key === 'lora' || key === 'lora-base') {
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
  if (/sdxl|pony|illustrious|animagine|noobai/i.test(title)) return 'SDXL'
  if (/sd\s*1\.5|sd1\.5|sd15|v1-?5/i.test(title)) return 'SD 1.5'
  if (/flux/i.test(title)) return 'FLUX'
  return null
}

function isSdxlFamily(baseModel: string): boolean {
  return /sdxl|pony|illustrious|animagine|noobai/i.test(baseModel)
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
