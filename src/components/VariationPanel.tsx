import { useState } from 'react'
import { ImageUpscale, Recycle, Shuffle, Wand2 } from 'lucide-react'
import toast from 'react-hot-toast'
import type { HistoryItem } from '@shared/types'
import { api } from '@/lib/ipc'
import { useStore, type GenerationParams } from '@/lib/store'
import { cn } from '@/lib/utils'
import { promptDigestOf } from '@/lib/lora-suggest'
import { useT, t as tStatic } from '@/lib/i18n'
import {
  buildGenerationPlan,
  buildImg2ImgRequest,
  generatedSeedFromInfo,
  imageDataUrlFromPngBase64,
  makeThumbnail
} from '@/lib/generation-utils'
import { getExtensionGuardIssues } from '@/lib/extension-guards'

type VariationAxis = 'seed' | 'cfg' | 'denoise'
type VariationCount = 2 | 4 | 8

interface VariantSpec {
  params: GenerationParams
  label: string
}

interface Candidate {
  id: string
  image: string
  label: string
  historyId: string
}

const AXES: VariationAxis[] = ['seed', 'cfg', 'denoise']
const COUNTS: VariationCount[] = [2, 4, 8]

export function VariationPanel(): JSX.Element {
  const status = useStore((s) => s.forgeStatus)
  const selectedModel = useStore((s) => s.selectedModelTitle)
  const isGenerating = useStore((s) => s.isGenerating)
  const setLastImage = useStore((s) => s.setLastImage)
  const setInputImage = useStore((s) => s.setInputImage)
  const setCurrentTab = useStore((s) => s.setCurrentTab)
  const patchUpscale = useStore((s) => s.patchUpscale)
  const t = useT()

  const [axis, setAxis] = useState<VariationAxis>('seed')
  const [count, setCount] = useState<VariationCount>(4)
  const [running, setRunning] = useState(false)
  const [candidates, setCandidates] = useState<Candidate[]>([])

  const canRun = status.kind === 'ready' && !!selectedModel && !isGenerating && !running

  async function run(): Promise<void> {
    const base = useStore.getState()
    const endpoint = base.currentTab === 'img2img' ? 'img2img' : 'txt2img'
    if (status.kind !== 'ready') {
      toast.error(tStatic('variation.notReady'))
      return
    }
    if (!base.selectedModelTitle) {
      toast.error(tStatic('variation.noModel'))
      return
    }
    if (axis === 'denoise' && endpoint !== 'img2img') {
      toast.error(tStatic('variation.denoiseNeedsImg2Img'))
      return
    }
    if (endpoint === 'img2img' && !base.inputImage) {
      toast.error(tStatic('toast.img2imgNeedsImage'))
      return
    }

    const fixedSeed = base.params.seed >= 0
      ? base.params.seed
      : Math.floor(Math.random() * 2_147_483_647)
    const guardIssue = getExtensionGuardIssues(base)[0]
    if (guardIssue) {
      toast.error(tStatic(guardIssue.messageKey, guardIssue.params))
      return
    }
    const variants = buildVariants(axis, count, base.params, fixedSeed)
    const inputImage = base.inputImage

    setCandidates([])
    setRunning(true)
    base.setGenerating(true)
    base.setProgress(null)

    try {
      for (const variant of variants) {
        const plan = buildGenerationPlan(base, {
          endpoint,
          params: variant.params
        })
        if (!plan) throw new Error(tStatic('variation.noModel'))

        const res = endpoint === 'img2img'
          ? await api.forge.img2img(buildImg2ImgRequest(plan, inputImage!, variant.params.denoisingStrength))
          : await api.forge.txt2img(plan.baseReq)
        const pngBase64 = res.images[0]
        if (!pngBase64) continue

        const dataUrl = imageDataUrlFromPngBase64(pngBase64)
        const actualSeed = generatedSeedFromInfo(res.info, 0, variant.params.seed)
        const thumb = await makeThumbnail(dataUrl, 320)
        const item = await api.storage.addHistory({
          pngBase64,
          thumbDataUrl: thumb,
          prompt: plan.finalPrompt,
          negativePrompt: base.negativePrompt,
          params: {
            steps: variant.params.steps,
            cfgScale: variant.params.cfgScale,
            width: variant.params.width,
            height: variant.params.height,
            sampler: variant.params.sampler,
            scheduler: variant.params.scheduler,
            seed: actualSeed,
            model: plan.model,
            vae: base.selectedVae,
            clipSkip: variant.params.clipSkip,
            denoisingStrength: variant.params.denoisingStrength,
            activeLoras: base.activeLoras
          }
        })
        pushHistory(item)
        setLastImage(dataUrl, item.id)

        if (base.activeLoras.length > 0) {
          const ts = Date.now()
          await Promise.all(
            base.activeLoras.map((al) =>
              api.storage.recordLoraUsage({
                loraName: al.name,
                checkpointTitle: plan.model,
                promptDigest: promptDigestOf(plan.strippedPrompt),
                weight: al.weight,
                timestamp: ts
              })
            )
          )
          const usage = await api.storage.listLoraUsage()
          useStore.getState().setLoraUsage(usage)
        }

        setCandidates((prev) => ([
          ...prev,
          {
            id: `${item.id}-${prev.length}`,
            image: dataUrl,
            label: axis === 'seed' ? `seed ${actualSeed}` : variant.label,
            historyId: item.id
          }
        ]))
      }
      toast.success(tStatic('variation.done', { count: variants.length }))
    } catch (e) {
      toast.error(tStatic('variation.failed', { message: (e as Error).message }))
    } finally {
      setRunning(false)
      useStore.getState().setGenerating(false)
      useStore.getState().setProgress(null)
    }
  }

  function sendToImg2Img(candidate: Candidate): void {
    setInputImage(candidate.image, `${candidate.historyId}.png`, null, candidate.historyId)
    setCurrentTab('img2img')
    toast.success(tStatic('variation.sentToImg2Img'))
  }

  function sendToUpscale(candidate: Candidate): void {
    patchUpscale({
      inputImage: candidate.image,
      inputFilename: `${candidate.historyId}.png`,
      inputImagePath: null,
      inputHistoryId: candidate.historyId,
      outputImage: null
    })
    setCurrentTab('upscale')
    toast.success(tStatic('variation.sentToUpscale'))
  }

  return (
    <section className="border-t border-line bg-bg-1 px-3 py-2 shrink-0">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-ink-1 min-w-0">
          <Shuffle className="h-3.5 w-3.5 text-accent" />
          <span>{t('variation.title')}</span>
        </div>

        <div className="flex items-center gap-1 ml-2">
          {AXES.map((a) => (
            <button
              key={a}
              className={cn(
                'btn text-[11px] py-0.5 px-2',
                axis === a && 'btn-primary'
              )}
              onClick={() => setAxis(a)}
            >
              {t(`variation.axis.${a}`)}
            </button>
          ))}
        </div>

        <select
          className="input text-[11px] py-0.5 w-16"
          value={count}
          onChange={(e) => setCount(Number(e.target.value) as VariationCount)}
        >
          {COUNTS.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>

        <button
          className="btn btn-primary text-[11px] py-0.5 px-2 ml-auto"
          disabled={!canRun}
          onClick={() => { void run() }}
        >
          <Wand2 className="h-3.5 w-3.5" />
          {running ? t('variation.running') : t('variation.run')}
        </button>
      </div>

      {candidates.length > 0 && (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {candidates.map((candidate) => (
            <div
              key={candidate.id}
              className="relative w-24 shrink-0 rounded-md overflow-hidden border border-line bg-bg-2"
            >
              <button
                className="block w-full"
                onClick={() => setLastImage(candidate.image, candidate.historyId)}
                title={candidate.label}
              >
                <img
                  src={candidate.image}
                  alt={t('variation.candidateAlt')}
                  className="w-24 h-20 object-cover"
                />
                <div className="text-[10px] font-mono text-ink-2 truncate px-1 py-0.5">
                  {candidate.label}
                </div>
              </button>
              <div className="absolute top-1 right-1 flex gap-1">
                <button
                  className="btn btn-icon bg-bg-1/90 backdrop-blur p-1"
                  title={t('variation.toImg2Img')}
                  onClick={() => sendToImg2Img(candidate)}
                >
                  <Recycle className="h-3 w-3" />
                </button>
                <button
                  className="btn btn-icon bg-bg-1/90 backdrop-blur p-1"
                  title={t('variation.toUpscale')}
                  onClick={() => sendToUpscale(candidate)}
                >
                  <ImageUpscale className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function pushHistory(item: HistoryItem): void {
  const s = useStore.getState()
  s.setHistory([item, ...s.history].slice(0, 500))
}

function buildVariants(
  axis: VariationAxis,
  count: VariationCount,
  base: GenerationParams,
  fixedSeed: number
): VariantSpec[] {
  const common: GenerationParams = {
    ...base,
    batchSize: 1,
    iterations: 1,
    seed: axis === 'seed' ? base.seed : fixedSeed
  }

  if (axis === 'seed') {
    return Array.from({ length: count }, (_, i) => {
      const seed = base.seed >= 0 ? base.seed + i : -1
      return {
        params: { ...common, seed },
        label: seed >= 0 ? `seed ${seed}` : 'seed random'
      }
    })
  }

  if (axis === 'cfg') {
    return offsets(count, 'cfg').map((offset) => {
      const cfg = clamp(round1(base.cfgScale + offset), 1, 30)
      return {
        params: { ...common, cfgScale: cfg },
        label: `CFG ${cfg.toFixed(1)}`
      }
    })
  }

  return offsets(count, 'denoise').map((offset) => {
    const denoise = clamp(round2(base.denoisingStrength + offset), 0.05, 0.95)
    return {
      params: { ...common, denoisingStrength: denoise },
      label: `D ${denoise.toFixed(2)}`
    }
  })
}

function offsets(count: VariationCount, axis: 'cfg' | 'denoise'): number[] {
  if (axis === 'cfg') {
    if (count === 2) return [-0.75, 0.75]
    if (count === 4) return [-1, -0.5, 0.5, 1]
    return [-1.5, -1, -0.5, -0.25, 0.25, 0.5, 1, 1.5]
  }
  if (count === 2) return [-0.08, 0.08]
  if (count === 4) return [-0.15, -0.05, 0.05, 0.15]
  return [-0.25, -0.15, -0.08, -0.03, 0.03, 0.08, 0.15, 0.25]
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
