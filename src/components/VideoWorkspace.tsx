import { useState } from 'react'
import { Cpu, Dice5, Download, ExternalLink, Film, FolderOpen, Languages, ListChecks, Search, SlidersHorizontal, Tags } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore } from '@/lib/store'
import { api } from '@/lib/ipc'
import { approxTokenCount, formatPromptText, promptAppend, promptContains, promptRemove } from '@/lib/prompt-utils'
import { translatePromptToEnglishTags } from '@/lib/prompt-translate'
import { useT, t as tStatic } from '@/lib/i18n'
import { cn, snapTo } from '@/lib/utils'
import { InputImagePanel } from './InputImagePanel'
import { NumberField } from './NumberField'
import { PromptEditor } from './PromptEditor'
import { PromptTagChips } from './PromptTagChips'
import { QuickPresetBar } from './QuickPresetBar'
import { VideoGenerationPanel } from './VideoGenerationPanel'

interface Props {
  onModelChanged(title: string): Promise<void>
}

type VideoPresetId = 'safe' | 'smooth' | 'img2vid' | 'sdxlCautious'

const VIDEO_PRESETS: Array<{
  id: VideoPresetId
  labelKey: string
  hintKey: string
}> = [
  { id: 'safe', labelKey: 'video.presetSafe', hintKey: 'video.presetSafeHint' },
  { id: 'smooth', labelKey: 'video.presetSmooth', hintKey: 'video.presetSmoothHint' },
  { id: 'img2vid', labelKey: 'video.presetImg2Vid', hintKey: 'video.presetImg2VidHint' },
  { id: 'sdxlCautious', labelKey: 'video.presetSdxlCautious', hintKey: 'video.presetSdxlCautiousHint' }
]

const VIDEO_PROMPT_TAG_GROUPS: Array<{
  id: string
  labelKey: string
  target: 'positive' | 'negative'
  tags: string[]
}> = [
  {
    id: 'motion',
    labelKey: 'video.tagMotion',
    target: 'positive',
    tags: ['subtle motion', 'gentle hair movement', 'natural breathing', 'slow blink', 'soft cloth movement']
  },
  {
    id: 'camera',
    labelKey: 'video.tagCamera',
    target: 'positive',
    tags: ['slow camera pan', 'gentle zoom in', 'cinematic dolly shot', 'stable camera', 'parallax']
  },
  {
    id: 'quality',
    labelKey: 'video.tagQuality',
    target: 'positive',
    tags: ['smooth animation', 'consistent character', 'temporal consistency', 'cinematic lighting', 'clean lineart']
  },
  {
    id: 'negative',
    labelKey: 'video.tagNegative',
    target: 'negative',
    tags: ['flicker', 'jitter', 'warped face', 'deformed hands', 'inconsistent anatomy', 'duplicated limbs', 'low quality video']
  }
]

const VIDEO_MODEL_RESOURCES: Array<{
  id: string
  label: string
  hintKey: string
  url: string
}> = [
  {
    id: 'animatediff-sd15',
    label: 'AnimateDiff SD1.5',
    hintKey: 'video.resourceAnimateDiffHint',
    url: 'https://huggingface.co/guoyww/animatediff'
  },
  {
    id: 'animatediff-conrevo',
    label: 'mm_sd15_v2',
    hintKey: 'video.resourceMotionModuleHint',
    url: 'https://huggingface.co/conrevo/AnimateDiff-A1111/tree/main/motion_module'
  },
  {
    id: 'framepack',
    label: 'FramePack',
    hintKey: 'video.resourceFramePackHint',
    url: 'https://github.com/lllyasviel/FramePack'
  }
]

export function VideoWorkspace({ onModelChanged }: Props): JSX.Element {
  const t = useT()
  const prompt = useStore((s) => s.prompt)
  const negative = useStore((s) => s.negativePrompt)
  const setPrompt = useStore((s) => s.setPrompt)
  const setNegative = useStore((s) => s.setNegativePrompt)
  const sourceMode = useStore((s) => s.video.sourceMode)
  const library = useStore((s) => s.library)
  const customLibrary = useStore((s) => s.customLibrary)

  function translateCurrentPrompt(): void {
    const tags = translatePromptToEnglishTags(prompt, [...library, ...customLibrary])
    if (tags.length === 0) {
      toast(tStatic('prompt.translateEmpty'), { icon: 'i' })
      return
    }
    setPrompt(tags.join(', '))
    toast.success(tStatic('prompt.translated'))
  }

  function formatPromptField(target: 'positive' | 'negative'): void {
    const current = target === 'positive' ? prompt : negative
    const result = formatPromptText(current)
    if (!result.summary.changed) {
      toast(tStatic('prompt.formatUnchanged'), { icon: 'i' })
      return
    }
    if (target === 'positive') setPrompt(result.prompt)
    else setNegative(result.prompt)
    toast.success(tStatic('prompt.formatted'))
  }

  return (
    <main className="flex-1 overflow-auto bg-bg-0 p-4" data-testid="video-workspace">
      <div className="mx-auto grid max-w-6xl grid-cols-[380px_minmax(0,1fr)] gap-4">
        <aside className="space-y-3">
          <VideoBaseSettings onModelChanged={onModelChanged} />
          <VideoModelResourcePanel />
          <section className="rounded-md border border-line bg-bg-2/70 p-3 space-y-3">
            <h2 className="text-xs font-semibold text-ink-1">{t('video.promptSection')}</h2>
            <VideoPromptFields
              prompt={prompt}
              negative={negative}
              setPrompt={setPrompt}
              setNegative={setNegative}
              onTranslate={translateCurrentPrompt}
              onFormat={formatPromptField}
            />
          </section>

          <section className="rounded-md border border-line bg-bg-2/70 p-3 space-y-3" data-testid="video-input-settings">
            <h2 className="text-xs font-semibold text-ink-1">{t('video.inputSection')}</h2>
            {sourceMode === 'img2img' ? (
              <InputImagePanel />
            ) : (
              <p className="text-xs text-ink-3">{t('video.txt2vidInputNote')}</p>
            )}
          </section>
        </aside>

        <div className="min-w-0 space-y-4">
          <VideoGenerationPanel variant="workspace" />
          <section className="rounded-md border border-line bg-bg-2/70 p-3 text-xs text-ink-3">
            {t('video.workspaceNote')}
          </section>
        </div>
      </div>
    </main>
  )
}

function VideoBaseSettings({ onModelChanged }: Props): JSX.Element {
  const t = useT()
  const models = useStore((s) => s.models)
  const selectedModelTitle = useStore((s) => s.selectedModelTitle)
  const params = useStore((s) => s.params)
  const patchParams = useStore((s) => s.patchParams)
  const patchVideo = useStore((s) => s.patchVideo)
  const samplers = useStore((s) => s.samplers)
  const schedulers = useStore((s) => s.schedulers)
  const vaes = useStore((s) => s.vaes)
  const selectedVae = useStore((s) => s.selectedVae)
  const setSelectedVae = useStore((s) => s.setSelectedVae)
  const sourceMode = useStore((s) => s.video.sourceMode)
  const [switchingModel, setSwitchingModel] = useState(false)

  async function changeBaseCheckpoint(title: string): Promise<void> {
    if (!title || title === selectedModelTitle) return
    setSwitchingModel(true)
    try {
      await onModelChanged(title)
    } catch (e) {
      toast.error(tStatic('video.baseCheckpointFailed', { message: (e as Error).message }))
    } finally {
      setSwitchingModel(false)
    }
  }

  function applySmokePreset(): void {
    applyVideoPreset('safe')
  }

  function applyVideoPreset(id: VideoPresetId): void {
    const sampler = chooseVideoSampler(['DPM++ 2M Karras', 'Euler', 'Euler a', 'LCM'], samplers, params.sampler)
    if (id === 'smooth') {
      patchParams({
        steps: 20,
        cfgScale: 6,
        width: 512,
        height: 512,
        batchSize: 1,
        iterations: 1,
        sampler
      })
      patchVideo({
        sourceMode: 'txt2img',
        format: 'MP4',
        frames: 16,
        contextBatchSize: 4,
        fps: 12,
        overlap: -1
      })
      return
    }
    if (id === 'img2vid') {
      patchParams({
        steps: 18,
        cfgScale: 5.5,
        width: 512,
        height: 512,
        batchSize: 1,
        iterations: 1,
        denoisingStrength: 0.55,
        sampler
      })
      patchVideo({
        sourceMode: 'img2img',
        format: 'MP4',
        frames: 8,
        contextBatchSize: 4,
        fps: 8,
        overlap: -1
      })
      return
    }
    if (id === 'sdxlCautious') {
      patchParams({
        steps: 16,
        cfgScale: 5.5,
        width: 768,
        height: 512,
        batchSize: 1,
        iterations: 1,
        sampler
      })
      patchVideo({
        sourceMode: 'txt2img',
        format: 'MP4',
        frames: 8,
        contextBatchSize: 2,
        fps: 8,
        overlap: -1
      })
      return
    }
    patchParams({
      steps: 16,
      cfgScale: 6,
      width: 512,
      height: 512,
      batchSize: 1,
      iterations: 1,
      sampler: chooseVideoSampler(['DPM++ 2M Karras', 'Euler', 'Euler a', 'LCM'], samplers, params.sampler)
    })
    patchVideo({
      sourceMode: 'txt2img',
      format: 'GIF',
      frames: 8,
      contextBatchSize: 4,
      fps: 8,
      overlap: -1
    })
  }

  return (
    <section className="rounded-md border border-line bg-bg-2/70 p-3 space-y-3" data-testid="video-base-settings">
      <div className="flex items-center gap-2">
        <Cpu className="h-4 w-4 text-accent" />
        <h2 className="text-xs font-semibold text-ink-1">{t('video.baseSection')}</h2>
        <button
          type="button"
          className="btn btn-ghost ml-auto px-1.5 py-0.5 text-[10px] gap-1"
          onClick={applySmokePreset}
          title={t('video.smokePresetHint')}
          data-testid="video-smoke-preset"
        >
          <SlidersHorizontal className="h-3 w-3" />
          {t('video.smokePreset')}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-1.5" data-testid="video-preset-row">
        {VIDEO_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="btn btn-ghost justify-start px-2 py-1 text-[10px]"
            onClick={() => applyVideoPreset(preset.id)}
            title={t(preset.hintKey)}
            data-testid={`video-preset-${preset.id}`}
          >
            <Film className="h-3 w-3" />
            {t(preset.labelKey)}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1">
        <span className="label">{t('video.baseCheckpoint')}</span>
        <select
          className="input font-mono text-xs"
          value={selectedModelTitle ?? ''}
          onChange={(e) => void changeBaseCheckpoint(e.target.value)}
          disabled={switchingModel || models.length === 0}
          data-testid="video-base-checkpoint"
        >
          {!selectedModelTitle && <option value="">{t('video.baseCheckpointNone')}</option>}
          {models.map((model) => (
            <option key={model.title} value={model.title}>
              {model.modelName}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="label">{t('video.baseVae')}</span>
        <select
          className="input"
          value={selectedVae}
          onChange={(e) => setSelectedVae(e.target.value)}
          data-testid="video-base-vae"
        >
          <option value="Automatic">Automatic</option>
          <option value="None">None</option>
          {vaes.map((vae) => (
            <option key={vae.modelName} value={vae.modelName}>
              {vae.modelName}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Steps" value={params.steps} min={1} max={80} onChange={(steps) => patchParams({ steps: Math.round(steps) })} />
        <NumberField label="CFG" value={params.cfgScale} min={1} max={20} step={0.5} onChange={(cfgScale) => patchParams({ cfgScale })} />
        <NumberField label="Width" value={params.width} min={64} max={1536} step={64} onChange={(width) => patchParams({ width: snapTo(width, 8) })} />
        <NumberField label="Height" value={params.height} min={64} max={1536} step={64} onChange={(height) => patchParams({ height: snapTo(height, 8) })} />
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <button type="button" className="btn btn-ghost justify-center px-1.5 py-0.5 text-[10px]" onClick={() => patchParams({ width: 512, height: 512 })}>512²</button>
        <button type="button" className="btn btn-ghost justify-center px-1.5 py-0.5 text-[10px]" onClick={() => patchParams({ width: 512, height: 768 })}>512×768</button>
        <button type="button" className="btn btn-ghost justify-center px-1.5 py-0.5 text-[10px]" onClick={() => patchParams({ width: 768, height: 512 })}>768×512</button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="label">Sampler</span>
        <select
          className="input"
          value={params.sampler}
          onChange={(e) => patchParams({ sampler: e.target.value })}
        >
          {samplers.length === 0 && <option value={params.sampler}>{params.sampler}</option>}
          {samplers.map((sampler) => (
            <option key={sampler.name} value={sampler.name}>{sampler.name}</option>
          ))}
        </select>
      </label>

      {schedulers.length > 0 && (
        <label className="flex flex-col gap-1">
          <span className="label">Scheduler</span>
          <select
            className="input"
            value={params.scheduler}
            onChange={(e) => patchParams({ scheduler: e.target.value })}
          >
            <option value="">{t('video.schedulerAuto')}</option>
            {schedulers.map((scheduler) => (
              <option key={scheduler} value={scheduler}>{scheduler}</option>
            ))}
          </select>
        </label>
      )}

      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Seed" value={params.seed} min={-1} max={2147483647} onChange={(seed) => patchParams({ seed: Math.round(seed) })} />
        {sourceMode === 'img2img' ? (
          <NumberField
            label="Denoise"
            value={params.denoisingStrength}
            min={0}
            max={1}
            step={0.05}
            onChange={(denoisingStrength) => patchParams({ denoisingStrength })}
          />
        ) : (
          <button
            type="button"
            className="btn btn-ghost mt-5 justify-center text-xs"
            onClick={() => patchParams({ seed: -1 })}
          >
            <Dice5 className="h-3.5 w-3.5" />
            {t('video.seedRandom')}
          </button>
        )}
      </div>
    </section>
  )
}

function VideoModelResourcePanel(): JSX.Element {
  const t = useT()
  const openCivitaiSearch = useStore((s) => s.openCivitaiSearch)

  async function openExternal(url: string): Promise<void> {
    try {
      await api.app.openExternal(url)
    } catch (e) {
      toast.error(tStatic('video.resourceOpenFailed', { message: (e as Error).message }))
    }
  }

  async function openMotionFolder(): Promise<void> {
    try {
      await api.forge.openVideoModelFolder()
    } catch (e) {
      toast.error(tStatic('video.openMotionFolderFailed', { message: (e as Error).message }))
    }
  }

  return (
    <section className="rounded-md border border-line bg-bg-2/70 p-3 space-y-3" data-testid="video-model-resource-panel">
      <div className="flex items-center gap-2">
        <Download className="h-4 w-4 text-accent" />
        <h2 className="text-xs font-semibold text-ink-1">{t('video.resourcesTitle')}</h2>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          className="btn btn-ghost justify-start px-2 py-1 text-[10px]"
          onClick={() => openCivitaiSearch('Checkpoint')}
          data-testid="video-open-civitai-checkpoints"
          title={t('video.resourceCivitaiHint')}
        >
          <Search className="h-3 w-3" />
          Civitai
        </button>
        <button
          type="button"
          className="btn btn-ghost justify-start px-2 py-1 text-[10px]"
          onClick={openMotionFolder}
          data-testid="video-open-motion-resource-folder"
          title={t('video.resourceMotionFolderHint')}
        >
          <FolderOpen className="h-3 w-3" />
          {t('video.motionModuleShort')}
        </button>
      </div>
      <div className="space-y-1.5">
        {VIDEO_MODEL_RESOURCES.map((resource) => (
          <button
            key={resource.id}
            type="button"
            className="w-full rounded border border-line bg-bg-1 px-2 py-1.5 text-left hover:bg-bg-3"
            onClick={() => openExternal(resource.url)}
            title={t(resource.hintKey)}
          >
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-1">
              <ExternalLink className="h-3 w-3 text-ink-3" />
              {resource.label}
            </span>
            <span className="mt-0.5 block text-[10px] text-ink-3">{t(resource.hintKey)}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function VideoPromptFields({
  prompt,
  negative,
  setPrompt,
  setNegative,
  onTranslate,
  onFormat
}: {
  prompt: string
  negative: string
  setPrompt(value: string): void
  setNegative(value: string): void
  onTranslate(): void
  onFormat(target: 'positive' | 'negative'): void
}): JSX.Element {
  const t = useT()

  function appendPromptTagsToNegative(tokens: string[]): void {
    setNegative(tokens.reduce((next, token) => promptAppend(next, token), negative))
  }

  function appendNegativeTagsToPrompt(tokens: string[]): void {
    setPrompt(tokens.reduce((next, token) => promptAppend(next, token), prompt))
  }

  return (
    <>
      <div className="space-y-1.5" data-testid="video-prompt-positive-section">
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
              data-testid="video-prompt-format-positive"
            >
              <ListChecks className="h-3 w-3" />
              {t('prompt.formatShort')}
            </button>
          </div>
          <TokenMeter text={prompt} />
        </div>
        <QuickPresetBar target="positive" value={prompt} onChange={setPrompt} />
        <VideoTagPalette
          prompt={prompt}
          negative={negative}
          setPrompt={setPrompt}
          setNegative={setNegative}
        />
        <PromptEditor
          value={prompt}
          onChange={setPrompt}
          ariaLabel={t('prompt.label')}
          placeholder={t('prompt.placeholder')}
          rows={7}
          testId="video-prompt-positive-editor"
        />
        <PromptTagChips
          target="positive"
          value={prompt}
          onChange={setPrompt}
          onMoveTokens={appendPromptTagsToNegative}
        />
      </div>

      <div className="space-y-1.5" data-testid="video-prompt-negative-section">
        <div className="flex items-baseline justify-between">
          <div className="flex items-center gap-1.5">
            <span className="label">{t('prompt.negativeLabel')}</span>
            <button
              type="button"
              className="btn btn-ghost px-1.5 py-0.5 text-[10px] gap-1"
              onClick={() => onFormat('negative')}
              title={t('prompt.formatTitle')}
              data-testid="video-prompt-format-negative"
            >
              <ListChecks className="h-3 w-3" />
              {t('prompt.formatShort')}
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
          rows={4}
          testId="video-prompt-negative-editor"
        />
        <PromptTagChips
          target="negative"
          value={negative}
          onChange={setNegative}
          onMoveTokens={appendNegativeTagsToPrompt}
        />
      </div>
    </>
  )
}

function VideoTagPalette({
  prompt,
  negative,
  setPrompt,
  setNegative
}: {
  prompt: string
  negative: string
  setPrompt(value: string): void
  setNegative(value: string): void
}): JSX.Element {
  const t = useT()

  function toggleTag(target: 'positive' | 'negative', tag: string): void {
    const current = target === 'positive' ? prompt : negative
    const next = promptContains(current, tag) ? promptRemove(current, tag) : promptAppend(current, tag)
    if (target === 'positive') setPrompt(next)
    else setNegative(next)
  }

  return (
    <div className="rounded border border-line bg-bg-1 p-2" data-testid="video-tag-palette">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-ink-1">
        <Tags className="h-3.5 w-3.5 text-accent" />
        {t('video.tagPaletteTitle')}
      </div>
      <div className="space-y-1.5">
        {VIDEO_PROMPT_TAG_GROUPS.map((group) => (
          <div key={group.id}>
            <div className="mb-1 text-[10px] font-semibold text-ink-3">{t(group.labelKey)}</div>
            <div className="flex flex-wrap gap-1">
              {group.tags.map((tag) => {
                const active = promptContains(group.target === 'positive' ? prompt : negative, tag)
                return (
                  <button
                    key={tag}
                    type="button"
                    className={cn(
                      'rounded border px-1.5 py-0.5 text-[10px] transition-colors',
                      active
                        ? group.target === 'positive'
                          ? 'border-accent bg-accent/15 text-accent'
                          : 'border-err/60 bg-err/20 text-ink-1'
                        : 'border-line text-ink-2 hover:bg-bg-3'
                    )}
                    onClick={() => toggleTag(group.target, tag)}
                    title={group.target === 'positive' ? t('video.tagAddPositive') : t('video.tagAddNegative')}
                  >
                    {tag}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function TokenMeter({ text }: { text: string }): JSX.Element {
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

function chooseVideoSampler(candidates: string[], samplers: { name: string }[], fallback: string): string {
  const names = new Set(samplers.map((sampler) => sampler.name))
  return candidates.find((candidate) => names.has(candidate)) ?? fallback
}
