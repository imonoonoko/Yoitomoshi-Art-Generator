import { useMemo, type ReactNode } from 'react'
import { CheckCircle2, Languages, ListChecks, Wand2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore, type WorkspaceTab } from '@/lib/store'
import { api } from '@/lib/ipc'
import { approxTokenCount, formatPromptText, promptAppend } from '@/lib/prompt-utils'
import {
  checkpointPromptContextFromModel,
  findCheckpointPromptProfile,
  formatPromptForCheckpoint
} from '@/lib/checkpoint-prompt-profile'
import { translatePromptToEnglishTags } from '@/lib/prompt-translate'
import { hasDynamicPromptSyntax } from '@/lib/dynamic-prompts'
import { useT, t as tStatic } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { PromptEditor } from './PromptEditor'
import { PromptTagChips } from './PromptTagChips'
import { PromptHelperPanel } from './PromptHelperPanel'
import { DynamicPromptLab } from './DynamicPromptLab'
import { ResearchWorkflowPanel } from './ResearchWorkflowPanel'
import { ParametersPanel } from './ParametersPanel'
import { RecommendationCard } from './RecommendationCard'
import { QuickPresetBar } from './QuickPresetBar'
import { InputImagePanel } from './InputImagePanel'
import { LoraSuggestionStrip } from './LoraSuggestionStrip'
import { DynamicThresholdingPanel } from './extensions/DynamicThresholdingPanel'
import { FreeUPanel } from './extensions/FreeUPanel'
import { RegionalPrompterPanel } from './extensions/RegionalPrompterPanel'
import { FabricFeedbackPanel } from './extensions/FabricFeedbackPanel'
import { ADetailerPanel } from './extensions/ADetailerPanel'
import { ControlNetBuilderPanel } from './extensions/ControlNetBuilderPanel'
import { ControlNetPanel } from './extensions/ControlNetPanel'
import { buildPreflightItems, GenerationPreflightPanel, type PreflightItem } from './GenerationPreflightPanel'
import { CharacterComposePanel } from './CharacterComposePanel'

interface Props {
  onGenerate(): Promise<void>
}

export function PromptPanel({ onGenerate }: Props): JSX.Element {
  const prompt = useStore((s) => s.prompt)
  const negative = useStore((s) => s.negativePrompt)
  const setPrompt = useStore((s) => s.setPrompt)
  const setNeg = useStore((s) => s.setNegativePrompt)
  const isGenerating = useStore((s) => s.isGenerating)
  const currentTab = useStore((s) => s.currentTab)
  const library = useStore((s) => s.library)
  const customLibrary = useStore((s) => s.customLibrary)
  const state = useStore((s) => s)
  const t = useT()

  const preflightItems = useMemo(() => buildPreflightItems(state), [state])
  const generateBlocker = preflightItems.find((item) => item.severity === 'block') ?? null
  const canGenerate = !isGenerating && generateBlocker === null
  const disabledReason = generateBlocker ? t(generateBlocker.messageKey, generateBlocker.params) : undefined

  async function interrupt(): Promise<void> {
    try {
      await api.forge.interrupt()
      toast(tStatic('toast.interrupted'), { icon: '⏹' })
    } catch (e) {
      toast.error(tStatic('toast.interruptFailed', { message: (e as Error).message }))
    }
  }

  function translateCurrentPrompt(): void {
    const tags = translatePromptToEnglishTags(prompt, [...library, ...customLibrary])
    if (tags.length === 0) {
      toast(tStatic('prompt.translateEmpty'), { icon: 'ℹ' })
      return
    }
    setPrompt(tags.join(', '))
    toast.success(tStatic('prompt.translated'))
  }

  function formatPromptField(target: 'positive' | 'negative'): void {
    const current = target === 'positive' ? prompt : negative
    const result = formatPromptText(current)
    if (!result.summary.changed) {
      toast(tStatic('prompt.formatUnchanged'), { icon: 'ℹ' })
      return
    }
    if (target === 'positive') setPrompt(result.prompt)
    else setNeg(result.prompt)
    toast.success(tStatic('prompt.formatted'))
  }

  function formatPromptForModelField(target: 'positive' | 'negative'): void {
    const currentState = useStore.getState()
    const selectedModel = currentState.models.find((model) => model.title === currentState.selectedModelTitle) ?? null
    const context = checkpointPromptContextFromModel(selectedModel, currentState.recommendation)
    const profile = findCheckpointPromptProfile(currentState.checkpointPromptProfiles, context)
    const current = target === 'positive' ? currentState.prompt : currentState.negativePrompt
    const result = formatPromptForCheckpoint(current, target, context, profile)
    if (!result.changed) {
      toast(tStatic('prompt.modelFormatUnchanged'), { icon: 'ℹ' })
      return
    }
    if (target === 'positive') setPrompt(result.prompt)
    else setNeg(result.prompt)
    toast.success(tStatic('prompt.modelFormatted'))
  }

  function appendPromptTagsToNegative(tokens: string[]): void {
    setNeg(tokens.reduce((next, token) => promptAppend(next, token), negative))
  }

  function appendNegativeTagsToPrompt(tokens: string[]): void {
    setPrompt(tokens.reduce((next, token) => promptAppend(next, token), prompt))
  }

  return (
    <aside className="flex flex-col gap-3 p-3 overflow-y-auto bg-bg-1 border-r border-line w-[380px] shrink-0">
      <RecommendationCard />
      <ActiveFeatureSummary preflightItems={preflightItems} />

      <PromptFields
        prompt={prompt}
        negative={negative}
        setPrompt={setPrompt}
        setNegative={setNeg}
        canGenerate={canGenerate}
        onGenerate={onGenerate}
        onTranslate={translateCurrentPrompt}
        onFormat={formatPromptField}
        onModelFormat={formatPromptForModelField}
        onPositiveMove={appendPromptTagsToNegative}
        onNegativeMove={appendNegativeTagsToPrompt}
      />

      <GenerationInlineSection title={t('generationAll.basicTitle')} testId="generation-panel-basic">
        <CreateModePanel currentTab={currentTab} onGenerate={onGenerate} />
      </GenerationInlineSection>

      <GenerationInlineSection title={t('generationAll.promptTitle')} testId="generation-panel-prompt">
        <RefineModePanel />
      </GenerationInlineSection>

      <GenerationInlineSection title={t('generationAll.extensionTitle')} testId="generation-panel-extensions">
        <AdvancedModePanel />
      </GenerationInlineSection>

      <GenerationPreflightPanel />

      <div className="h-24 shrink-0" aria-hidden="true" />

      <div className="sticky bottom-0 -mx-3 -mb-3 px-3 py-3 bg-bg-1 border-t border-line space-y-1">
        {isGenerating ? (
          <button className="btn w-full justify-center text-base font-semibold py-2.5" onClick={interrupt}>
            <X className="h-5 w-5" />
            {t('generate.interrupt')}
          </button>
        ) : (
          <GenerateButton onClick={onGenerate} disabled={!canGenerate} disabledReason={disabledReason} />
        )}
        <div className="text-[10px] text-ink-3 text-center">
          {t('generate.shortcuts')}
        </div>
      </div>
    </aside>
  )
}

function PromptFields({
  prompt,
  negative,
  setPrompt,
  setNegative,
  canGenerate,
  onGenerate,
  onTranslate,
  onFormat,
  onModelFormat,
  onPositiveMove,
  onNegativeMove
}: {
  prompt: string
  negative: string
  setPrompt(value: string): void
  setNegative(value: string): void
  canGenerate: boolean
  onGenerate(): Promise<void>
  onTranslate(): void
  onFormat(target: 'positive' | 'negative'): void
  onModelFormat(target: 'positive' | 'negative'): void
  onPositiveMove(tokens: string[]): void
  onNegativeMove(tokens: string[]): void
}): JSX.Element {
  const t = useT()
  return (
    <>
      <div className="space-y-1.5" data-testid="prompt-positive-section">
        <div className="flex items-baseline justify-between">
          <div className="flex items-center gap-1.5">
            <span className="label">{t('prompt.label')}</span>
            <button
              type="button"
              className="btn btn-ghost px-1.5 py-0.5 text-[10px] gap-1"
              onClick={onTranslate}
              title={t('prompt.translateToEnglish')}
            >
              <Languages className="h-3 w-3" />
              {t('prompt.translateShort')}
            </button>
            <button
              type="button"
              className="btn btn-ghost px-1.5 py-0.5 text-[10px] gap-1"
              onClick={() => onFormat('positive')}
              title={t('prompt.formatTitle')}
              data-testid="prompt-format-positive"
            >
              <ListChecks className="h-3 w-3" />
              {t('prompt.formatShort')}
            </button>
            <button
              type="button"
              className="btn btn-ghost px-1.5 py-0.5 text-[10px] gap-1"
              onClick={() => onModelFormat('positive')}
              title={t('prompt.modelFormatTitle')}
              data-testid="prompt-model-format-positive"
            >
              <Wand2 className="h-3 w-3" />
              {t('prompt.modelFormatShort')}
            </button>
          </div>
          <TokenMeter text={prompt} />
        </div>
        <QuickPresetBar target="positive" value={prompt} onChange={setPrompt} />
        <PromptEditor
          value={prompt}
          onChange={setPrompt}
          ariaLabel={t('prompt.label')}
          placeholder={t('prompt.placeholder')}
          rows={6}
          onSubmit={canGenerate ? onGenerate : undefined}
          testId="prompt-positive-editor"
        />
        <div data-testid="prompt-positive-tags">
          <PromptTagChips
            target="positive"
            value={prompt}
            onChange={setPrompt}
            onMoveTokens={onPositiveMove}
          />
        </div>
      </div>

      <div className="space-y-1.5" data-testid="prompt-negative-section">
        <div className="flex items-baseline justify-between">
          <div className="flex items-center gap-1.5">
            <span className="label">{t('prompt.negativeLabel')}</span>
            <button
              type="button"
              className="btn btn-ghost px-1.5 py-0.5 text-[10px] gap-1"
              onClick={() => onFormat('negative')}
              title={t('prompt.formatTitle')}
              data-testid="prompt-format-negative"
            >
              <ListChecks className="h-3 w-3" />
              {t('prompt.formatShort')}
            </button>
            <button
              type="button"
              className="btn btn-ghost px-1.5 py-0.5 text-[10px] gap-1"
              onClick={() => onModelFormat('negative')}
              title={t('prompt.modelFormatTitle')}
              data-testid="prompt-model-format-negative"
            >
              <Wand2 className="h-3 w-3" />
              {t('prompt.modelFormatShort')}
            </button>
          </div>
          <TokenMeter text={negative} />
        </div>
        <QuickPresetBar target="negative" value={negative} onChange={setNegative} />
        <PromptEditor
          value={negative}
          onChange={setNegative}
          tone="negative"
          ariaLabel={t('prompt.negativeLabel')}
          placeholder={t('prompt.negativePlaceholder')}
          rows={3}
          onSubmit={canGenerate ? onGenerate : undefined}
          testId="prompt-negative-editor"
        />
        <div data-testid="prompt-negative-tags">
          <PromptTagChips
            target="negative"
            value={negative}
            onChange={setNegative}
            onMoveTokens={onNegativeMove}
          />
        </div>
      </div>
    </>
  )
}

interface FeatureChip {
  id: string
  label: string
  targetTestId?: string
  sideTestId?: string
  tone: 'accent' | 'warn' | 'ok'
}

function ActiveFeatureSummary({ preflightItems }: { preflightItems: PreflightItem[] }): JSX.Element {
  const prompt = useStore((s) => s.prompt)
  const negative = useStore((s) => s.negativePrompt)
  const activeLoraCount = useStore((s) => s.activeLoras.length)
  const controlnetEnabled = useStore((s) => s.controlnet.enabled)
  const controlnetUnitCount = useStore((s) => s.controlnet.units.filter((unit) => unit.enabled).length)
  const adetailerEnabled = useStore((s) => s.adetailer.enabled)
  const fabricEnabled = useStore((s) => s.fabric.enabled)
  const fabricCount = useStore((s) => s.fabric.positive.length + s.fabric.negative.length)
  const t = useT()
  const blockerCount = preflightItems.filter((item) => item.severity === 'block').length
  const warningCount = preflightItems.filter((item) => item.severity === 'warn').length
  const dynamicActive = hasDynamicPromptSyntax(prompt) || hasDynamicPromptSyntax(negative)

  const chips: FeatureChip[] = []
  if (activeLoraCount > 0) {
    chips.push({
      id: 'lora',
      label: t('generationMode.chip.lora', { count: activeLoraCount }),
      targetTestId: 'generation-create-lora',
      sideTestId: 'side-tab-lora',
      tone: 'accent'
    })
  }
  if (dynamicActive) {
    chips.push({
      id: 'dynamic-prompt',
      label: t('generationMode.chip.dynamic'),
      targetTestId: 'dynamic-prompt-lab',
      tone: 'accent'
    })
  }
  if (controlnetEnabled) {
    chips.push({
      id: 'controlnet',
      label: t('generationMode.chip.controlnet', { count: Math.max(1, controlnetUnitCount) }),
      targetTestId: 'controlnet-panel',
      tone: controlnetUnitCount > 0 ? 'accent' : 'warn'
    })
  }
  if (adetailerEnabled) {
    chips.push({
      id: 'adetailer',
      label: t('generationMode.chip.adetailer'),
      targetTestId: 'adetailer-panel',
      tone: 'accent'
    })
  }
  if (fabricEnabled) {
    chips.push({
      id: 'fabric',
      label: t('generationMode.chip.fabric', { count: fabricCount }),
      targetTestId: 'fabric-panel',
      tone: fabricCount > 0 ? 'accent' : 'warn'
    })
  }
  if (blockerCount + warningCount > 0) {
    chips.unshift({
      id: 'preflight',
      label: blockerCount > 0
        ? t('generationMode.chip.preflightBlock', { count: blockerCount })
        : t('generationMode.chip.preflightWarn', { count: warningCount }),
      targetTestId: 'preflight-panel',
      tone: blockerCount > 0 ? 'warn' : 'accent'
    })
  }

  function activate(chip: FeatureChip): void {
    window.setTimeout(() => {
      if (chip.sideTestId) clickByTestId(chip.sideTestId)
      if (chip.targetTestId) scrollToTestId(chip.targetTestId)
    }, 0)
  }

  return (
    <section className="rounded-md border border-line bg-bg-0/60 p-2 space-y-1.5" data-testid="active-feature-summary">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-ink-3">
        <CheckCircle2 className="h-3 w-3 text-accent" />
        {t('generationMode.summaryTitle')}
      </div>
      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className={cn(
                'rounded border px-1.5 py-0.5 text-[10px] transition-colors hover:bg-bg-3',
                chip.tone === 'warn'
                  ? 'border-warn/50 text-warn'
                  : chip.tone === 'ok'
                    ? 'border-ok/45 text-ok'
                    : 'border-accent/45 text-accent'
              )}
              onClick={() => activate(chip)}
              data-testid={`active-feature-chip-${chip.id}`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="text-[11px] text-ink-3" data-testid="active-feature-empty">
          {t('generationMode.summaryEmpty')}
        </div>
      )}
    </section>
  )
}

function GenerationInlineSection({
  title,
  testId,
  children
}: {
  title: string
  testId: string
  children: ReactNode
}): JSX.Element {
  return (
    <section className="shrink-0 rounded-md border border-line bg-bg-2/70 p-3 space-y-3" data-testid={testId}>
      <h3 className="text-xs font-semibold text-ink-1">{title}</h3>
      <div className="space-y-3" data-testid={`${testId}-content`}>
        {children}
      </div>
    </section>
  )
}

function CreateModePanel({
  currentTab,
  onGenerate
}: {
  currentTab: WorkspaceTab
  onGenerate(): Promise<void>
}): JSX.Element {
  return (
    <>
      {currentTab === 'img2img' && <InputImagePanel />}
      {currentTab === 'img2img' && <CharacterComposePanel onGenerate={onGenerate} />}
      <div data-testid="generation-create-lora">
        <LoraSuggestionStrip />
      </div>
      <ParametersPanel />
    </>
  )
}

function RefineModePanel(): JSX.Element {
  return (
    <>
      <PromptHelperPanel />
      <DynamicPromptLab />
      <ResearchWorkflowPanel />
    </>
  )
}

function AdvancedModePanel(): JSX.Element {
  return (
    <>
      <RegionalPrompterPanel />
      <FabricFeedbackPanel />
      <ControlNetBuilderPanel />
      <ControlNetPanel />
      <ADetailerPanel />
      <DynamicThresholdingPanel />
      <FreeUPanel />
    </>
  )
}

function scrollToTestId(id: string): void {
  const node = document.querySelector(`[data-testid="${id}"]`)
  if (!(node instanceof HTMLElement)) return
  node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
  node.focus({ preventScroll: true })
}

function clickByTestId(id: string): void {
  const node = document.querySelector(`[data-testid="${id}"]`)
  if (node instanceof HTMLElement) node.click()
}

function GenerateButton({
  onClick,
  disabled,
  disabledReason
}: {
  onClick(): void
  disabled: boolean
  disabledReason?: string
}): JSX.Element {
  const tab = useStore((s) => s.currentTab)
  const t = useT()
  // The mode chip surfaces which workspace tab is active so the user always knows
  // which API path the click will take. Tabs other than txt2img/img2img don't
  // run a generation through this button (Upscale/Tools have their own UI).
  return (
    <button
      className="btn btn-primary w-full justify-center text-base font-semibold py-2.5 gap-2"
      disabled={disabled}
      onClick={onClick}
      title={disabledReason}
      aria-label={disabledReason ? `${t('generate.button')}: ${disabledReason}` : t('generate.button')}
      data-testid="generate-button"
      data-disabled-reason={disabledReason}
    >
      <Wand2 className="h-5 w-5" />
      <span>{t('generate.button')}</span>
      <span className={cn(
        'text-[10px] px-1.5 py-0.5 rounded font-mono',
        tab === 'img2img' ? 'bg-bg-0/30' : 'bg-bg-0/20'
      )}>
        {tab}
      </span>
    </button>
  )
}

function TokenMeter({ text }: { text: string }): JSX.Element {
  // SD's CLIP encoder processes 75-token chunks. Showing the chunk index helps
  // users understand when their prompt is about to spill into the next chunk
  // (which can cause subtle quality changes).
  const tokens = approxTokenCount(text)
  const chunk = Math.floor(tokens / 75)
  const inChunk = tokens % 75
  return (
    <span className={cn(
      'text-[10px] font-mono',
      tokens > 150 ? 'text-warn' : 'text-ink-3'
    )}>
      {tokens} tok · {chunk > 0 ? `chunk ${chunk + 1} (${inChunk}/75)` : `${inChunk}/75`}
    </span>
  )
}
