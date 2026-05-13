import { useMemo } from 'react'
import { Languages, Wand2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore } from '@/lib/store'
import { api } from '@/lib/ipc'
import { approxTokenCount, promptAppend } from '@/lib/prompt-utils'
import { translatePromptToEnglishTags } from '@/lib/prompt-translate'
import { useT, t as tStatic } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { PromptEditor } from './PromptEditor'
import { PromptTagChips } from './PromptTagChips'
import { PromptHelperPanel } from './PromptHelperPanel'
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
import { buildPreflightItems, GenerationPreflightPanel } from './GenerationPreflightPanel'
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

  function appendPromptTagsToNegative(tokens: string[]): void {
    setNeg(tokens.reduce((next, token) => promptAppend(next, token), negative))
  }

  function appendNegativeTagsToPrompt(tokens: string[]): void {
    setPrompt(tokens.reduce((next, token) => promptAppend(next, token), prompt))
  }

  return (
    <aside className="flex flex-col gap-3 p-3 overflow-y-auto bg-bg-1 border-r border-line w-[380px] shrink-0">
      <RecommendationCard />
      {currentTab === 'img2img' && <InputImagePanel />}
      {currentTab === 'img2img' && <CharacterComposePanel onGenerate={onGenerate} />}
      <LoraSuggestionStrip />
      <PromptHelperPanel />
      <ResearchWorkflowPanel />

      <div className="space-y-1.5" data-testid="prompt-positive-section">
        <div className="flex items-baseline justify-between">
          <div className="flex items-center gap-1.5">
            <span className="label">{t('prompt.label')}</span>
            <button
              type="button"
              className="btn btn-ghost px-1.5 py-0.5 text-[10px] gap-1"
              onClick={translateCurrentPrompt}
              title={t('prompt.translateToEnglish')}
            >
              <Languages className="h-3 w-3" />
              {t('prompt.translateShort')}
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
        />
        <PromptTagChips
          target="positive"
          value={prompt}
          onChange={setPrompt}
          onMoveTokens={appendPromptTagsToNegative}
        />
      </div>

      <div className="space-y-1.5" data-testid="prompt-negative-section">
        <div className="flex items-baseline justify-between">
          <span className="label">{t('prompt.negativeLabel')}</span>
          <TokenMeter text={negative} />
        </div>
        <QuickPresetBar target="negative" value={negative} onChange={setNeg} />
        <PromptEditor
          value={negative}
          onChange={setNeg}
          tone="negative"
          ariaLabel={t('prompt.negativeLabel')}
          placeholder={t('prompt.negativePlaceholder')}
          rows={3}
          onSubmit={canGenerate ? onGenerate : undefined}
        />
        <PromptTagChips
          target="negative"
          value={negative}
          onChange={setNeg}
          onMoveTokens={appendNegativeTagsToPrompt}
        />
      </div>

      <div className="border-t border-line pt-3">
        <ParametersPanel />
      </div>

      <div className="border-t border-line pt-3 space-y-2">
        <RegionalPrompterPanel />
        <FabricFeedbackPanel />
        <ControlNetBuilderPanel />
        <ControlNetPanel />
        <ADetailerPanel />
        <DynamicThresholdingPanel />
        <FreeUPanel />
      </div>

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
