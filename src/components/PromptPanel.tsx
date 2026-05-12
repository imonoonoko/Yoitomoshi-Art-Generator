import { Languages, Wand2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore } from '@/lib/store'
import { api } from '@/lib/ipc'
import { approxTokenCount, promptAppend, removePromptToken, type PromptTokenRange } from '@/lib/prompt-utils'
import { translatePromptToEnglishTags } from '@/lib/prompt-translate'
import { useT, t as tStatic } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { PromptEditor } from './PromptEditor'
import { PromptTagChips } from './PromptTagChips'
import { PromptHelperPanel } from './PromptHelperPanel'
import { ParametersPanel } from './ParametersPanel'
import { RecommendationCard } from './RecommendationCard'
import { QuickPresetBar } from './QuickPresetBar'
import { InputImagePanel } from './InputImagePanel'
import { LoraSuggestionStrip } from './LoraSuggestionStrip'
import { DynamicThresholdingPanel } from './extensions/DynamicThresholdingPanel'
import { FreeUPanel } from './extensions/FreeUPanel'
import { ADetailerPanel } from './extensions/ADetailerPanel'
import { ControlNetBuilderPanel } from './extensions/ControlNetBuilderPanel'
import { ControlNetPanel } from './extensions/ControlNetPanel'

interface Props {
  onGenerate(): Promise<void>
}

export function PromptPanel({ onGenerate }: Props): JSX.Element {
  const prompt = useStore((s) => s.prompt)
  const negative = useStore((s) => s.negativePrompt)
  const setPrompt = useStore((s) => s.setPrompt)
  const setNeg = useStore((s) => s.setNegativePrompt)
  const status = useStore((s) => s.forgeStatus)
  const isGenerating = useStore((s) => s.isGenerating)
  const selected = useStore((s) => s.selectedModelTitle)
  const currentTab = useStore((s) => s.currentTab)
  const library = useStore((s) => s.library)
  const customLibrary = useStore((s) => s.customLibrary)
  const t = useT()

  const canGenerate = status.kind === 'ready' && !!selected && !isGenerating

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

  function movePromptTagToNegative(token: PromptTokenRange): void {
    setPrompt(removePromptToken(prompt, token))
    setNeg(promptAppend(negative, token.text))
  }

  function moveNegativeTagToPrompt(token: PromptTokenRange): void {
    setNeg(removePromptToken(negative, token))
    setPrompt(promptAppend(prompt, token.text))
  }

  return (
    <aside className="flex flex-col gap-3 p-3 overflow-y-auto bg-bg-1 border-r border-line w-[380px] shrink-0">
      <RecommendationCard />
      {currentTab === 'img2img' && <InputImagePanel />}
      <LoraSuggestionStrip />
      <PromptHelperPanel />

      <div className="space-y-1.5">
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
          onMoveToken={movePromptTagToNegative}
        />
      </div>

      <div className="space-y-1.5">
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
          onMoveToken={moveNegativeTagToPrompt}
        />
      </div>

      <div className="border-t border-line pt-3">
        <ParametersPanel />
      </div>

      <div className="border-t border-line pt-3 space-y-2">
        <ControlNetBuilderPanel />
        <ControlNetPanel />
        <ADetailerPanel />
        <DynamicThresholdingPanel />
        <FreeUPanel />
      </div>

      <div className="h-24 shrink-0" aria-hidden="true" />

      <div className="sticky bottom-0 -mx-3 -mb-3 px-3 py-3 bg-bg-1 border-t border-line space-y-1">
        {isGenerating ? (
          <button className="btn w-full justify-center text-base font-semibold py-2.5" onClick={interrupt}>
            <X className="h-5 w-5" />
            {t('generate.interrupt')}
          </button>
        ) : (
          <GenerateButton onClick={onGenerate} disabled={!canGenerate} />
        )}
        <div className="text-[10px] text-ink-3 text-center">
          {t('generate.shortcuts')}
        </div>
      </div>
    </aside>
  )
}

function GenerateButton({ onClick, disabled }: { onClick(): void; disabled: boolean }): JSX.Element {
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
