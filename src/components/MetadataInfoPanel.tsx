import { useState } from 'react'
import { Info, ChevronDown, ChevronUp, Loader2, Copy, Search, ClipboardPaste, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore } from '@/lib/store'
import { api } from '@/lib/ipc'
import { useT, t as tStatic } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { DroppedImageInsight } from './DroppedImageInsight'

/**
 * Metadata strip that lives directly under the preview image.
 *
 * Three modes depending on what's currently displayed:
 *   1. Loading — `droppedInsightLoading` is true: spinner row.
 *   2. Dropped image — `droppedInsight` is non-null: render the full
 *      DroppedImageInsight panel with Civitai cross-references.
 *   3. App-generated image — no dropped insight, but `lastImage` exists:
 *      show a compact summary of the generation params (model + LoRA + VAE
 *      + sampler/steps/CFG) pulled from current store state. No Civitai
 *      lookup needed since the user already chose these values.
 *
 * Always provides a "プロンプトをコピー" + "メタデータ再解析" button so the
 * user can re-run identification on the currently-displayed image at any time.
 */
export function MetadataInfoPanel(): JSX.Element | null {
  const inputImage = useStore((s) => s.inputImage)
  const lastImage = useStore((s) => s.lastImage)
  const droppedInsight = useStore((s) => s.droppedInsight)
  const droppedLoading = useStore((s) => s.droppedInsightLoading)
  const isGenerating = useStore((s) => s.isGenerating)

  const prompt = useStore((s) => s.prompt)
  const negative = useStore((s) => s.negativePrompt)
  const params = useStore((s) => s.params)
  const selectedModel = useStore((s) => s.selectedModelTitle)
  const selectedVae = useStore((s) => s.selectedVae)
  const activeLoras = useStore((s) => s.activeLoras)
  const t = useT()

  // Default expanded when there's something to show (dropped image insight).
  const [expanded, setExpanded] = useState(true)
  // Inline paste editor for when the dropped image had its metadata stripped
  // (typical for CDN-delivered AI images — Twitter, Discord, aipictors etc.).
  // The user copies the source page's "parameters" text and pastes it here.
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')

  // Hide entirely when there's no image at all and we're not in the middle
  // of generating — nothing to describe.
  if (!lastImage && !inputImage && !isGenerating) return null

  const hasInsight = !!droppedInsight || droppedLoading
  const hasGenInfo = !!lastImage && !hasInsight

  function copyPrompt(): void {
    const text =
      prompt + (negative ? `\nNegative prompt: ${negative}` : '')
    navigator.clipboard.writeText(text)
      .then(() => toast.success(tStatic('mp.copySuccess')))
      .catch(() => toast.error(tStatic('mp.copyFailed')))
  }

  /**
   * Take a manually-pasted A1111-style parameters string and turn it into a
   * full insight, exactly as if it had come from a PNG's tEXt chunk.
   *
   * Workflow: user copies "Prompt … Negative prompt: … Steps: …" from the
   * source page (Civitai / aipictors work page / their own logs) and pastes.
   * We parse, populate the form, then cross-reference the model/LoRA/VAE
   * names against Civitai for the same insight UI as a dropped image.
   */
  async function applyPasted(): Promise<void> {
    const text = pasteText.trim()
    if (!text) {
      toast(tStatic('mp.pasteHint'), { icon: 'ℹ' })
      return
    }
    useStore.getState().setDroppedInsightLoading(true)
    try {
      // Use the flexible parser — handles both A1111 inline format AND the
      // label/newline/value format used by aipictors and other sharing sites.
      const { parseFlexibleParameters } = await import('@/lib/png-metadata')
      const meta = parseFlexibleParameters(text)
      if (!meta.prompt && !meta.negativePrompt && meta.steps == null) {
        toast.error(tStatic('mp.unsupported'))
        return
      }
      // Populate form with whatever we got.
      if (meta.prompt) useStore.getState().setPrompt(meta.prompt)
      if (meta.negativePrompt) useStore.getState().setNegativePrompt(meta.negativePrompt)
      useStore.getState().patchParams({
        steps: meta.steps ?? undefined as number | undefined,
        cfgScale: meta.cfgScale ?? undefined as number | undefined,
        width: meta.width ?? undefined as number | undefined,
        height: meta.height ?? undefined as number | undefined,
        sampler: meta.sampler ?? undefined as string | undefined,
        seed: meta.seed ?? undefined as number | undefined,
        clipSkip: meta.clipSkip ?? undefined as number | undefined
      } as Parameters<ReturnType<typeof useStore.getState>['patchParams']>[0])

      // Cross-reference with Civitai.
      const insight = await api.civitai.identifyFromPng({
        modelName: meta.model,
        modelHash: meta.modelHash,
        loras: meta.loras,
        vae: meta.vae
      })
      useStore.getState().setDroppedInsight(insight)
      setPasteOpen(false)
      setPasteText('')
      toast.success(tStatic('mp.parseSuccess'))
    } catch (e) {
      toast.error(tStatic('mp.parseFailed', { message: (e as Error).message }))
    } finally {
      useStore.getState().setDroppedInsightLoading(false)
    }
  }

  async function reanalyze(): Promise<void> {
    // Path 1: we already have an insight from a prior drop. The user is
    // likely just refreshing Civitai info — no need to re-parse the PNG;
    // we already have the parsed metadata, just re-run the lookup.
    if (droppedInsight) {
      useStore.getState().setDroppedInsightLoading(true)
      try {
        const updated = await api.civitai.identifyFromPng({
          modelName: droppedInsight.checkpoint.nameInMetadata,
          modelHash: droppedInsight.checkpoint.hashInMetadata,
          loras: droppedInsight.loras.map((l) => ({
            name: l.nameInPrompt,
            weight: l.weight
          })),
          vae: droppedInsight.vae.nameInMetadata
        })
        useStore.getState().setDroppedInsight(updated)
        toast.success(tStatic('mp.civitaiRefetched'))
      } catch (e) {
        toast.error(tStatic('mp.civitaiRefetchFailed', { message: (e as Error).message }))
      } finally {
        useStore.getState().setDroppedInsightLoading(false)
      }
      return
    }

    // Path 2: no parsed insight yet — try to extract from the current image.
    // Falls back to lastImage so the user can analyze freshly-generated images
    // even when no img2img input was set.
    const target = inputImage ?? lastImage
    if (!target) {
      toast(tStatic('mp.noImageToAnalyze'), { icon: 'ℹ' })
      return
    }

    // We deliberately don't use fetch(dataUrl) here — Electron's CSP doesn't
    // include `data:` in connect-src, so fetch fails with "Failed to fetch".
    // Decoding the base64 portion directly into a Uint8Array works without
    // CSP changes and is faster anyway.
    useStore.getState().setDroppedInsightLoading(true)
    try {
      const bytes = dataUrlToBytes(target)
      const file = new File([new Uint8Array(bytes)], 'reanalyze.png', { type: 'image/png' })
      const { extractPngMetadata, inspectPngChunks } = await import('@/lib/png-metadata')
      const meta = await extractPngMetadata(file)

      if (!meta) {
        // Run a format-aware inspection so we can tell the user *why* it failed.
        const inspection = await inspectPngChunks(file)
        // Almost always the right next step when extraction fails — open the
        // paste editor so the user can manually paste the parameters string
        // they grabbed from the source page.
        const suggestPaste = tStatic('mp.suggestPaste')
        if (inspection.format === 'unknown') {
          toast.error(tStatic('mp.errUnsupportedFormat'))
        } else if (inspection.format === 'png') {
          if (inspection.comfyPrompt || inspection.comfyWorkflow) {
            toast.error(tStatic('mp.errComfyUI', { suggestPaste }))
          } else if (inspection.keywords.length > 0) {
            toast.error(tStatic('mp.errUnknownMeta', { keywords: inspection.keywords.join(', '), suggestPaste }))
          } else {
            toast.error(tStatic('mp.errPngNoMeta', { suggestPaste }))
          }
        } else {
          // JPEG or WebP without findable parameters
          if (!inspection.hasExif) {
            toast.error(tStatic('mp.errNoExif', { format: inspection.format.toUpperCase(), suggestPaste }))
          } else if (!inspection.hasUserComment) {
            toast.error(tStatic('mp.errNoUserComment', { suggestPaste }))
          } else {
            toast.error(tStatic('mp.errEncoding', { suggestPaste }))
          }
        }
        // Auto-open the paste editor since that's the most likely next action.
        setPasteOpen(true)
        return
      }

      const insight = await api.civitai.identifyFromPng({
        modelName: meta.model,
        modelHash: meta.modelHash,
        loras: meta.loras,
        vae: meta.vae
      })
      useStore.getState().setDroppedInsight(insight)
      toast.success(tStatic('mp.metadataLoaded'))
    } catch (e) {
      toast.error(tStatic('mp.parseFailed', { message: (e as Error).message }))
    } finally {
      useStore.getState().setDroppedInsightLoading(false)
    }
  }

  return (
    <div className="border-t border-line bg-bg-1">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-ink-2 hover:text-ink-0 transition-colors"
      >
        <Info className="h-3.5 w-3.5 text-accent" />
        <span className="uppercase tracking-wider">{t('mp.title')}</span>
        <CompactSummary
          hasInsight={hasInsight}
          droppedLoading={droppedLoading}
          insight={droppedInsight}
          hasGenInfo={hasGenInfo}
          model={selectedModel}
          loraCount={activeLoras.length}
          vae={selectedVae}
        />
        <span className="ml-auto">
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-2 pt-1 space-y-2 border-t border-line/50">
          {/* Mode 1: dropped image with Civitai cross-reference */}
          {hasInsight && <DroppedImageInsight />}

          {/* Mode 2: app-generated image — local info only, no lookup */}
          {hasGenInfo && (
            <GenerationSummary
              model={selectedModel}
              vae={selectedVae}
              activeLoras={activeLoras}
              params={params}
              prompt={prompt}
            />
          )}

          {/* Action buttons available in all modes */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            <button
              className="btn text-[11px] py-0.5 px-2"
              onClick={copyPrompt}
              disabled={!prompt}
              title={t('mp.copyPromptTitle')}
            >
              <Copy className="h-3 w-3" />
              {t('mp.copyPrompt')}
            </button>
            <button
              className="btn text-[11px] py-0.5 px-2"
              onClick={reanalyze}
              disabled={(!inputImage && !lastImage) || droppedLoading}
              title={t('mp.fromImageTitle')}
            >
              {droppedLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Search className="h-3 w-3" />
              )}
              {t('mp.fromImage')}
            </button>
            <button
              className={cn(
                'btn text-[11px] py-0.5 px-2',
                pasteOpen && 'btn-primary'
              )}
              onClick={() => setPasteOpen((o) => !o)}
              title={t('mp.fromTextTitle')}
            >
              <ClipboardPaste className="h-3 w-3" />
              {t('mp.fromText')}
            </button>
          </div>

          {/* Inline paste editor — most useful when the source image had its
              metadata stripped (CDN re-encoding) and the user has copied the
              parameters from the source page. */}
          {pasteOpen && (
            <div className="card p-2 space-y-1.5">
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] text-ink-2">{t('mp.pasteHeader')}</span>
                <button
                  type="button"
                  className="ml-auto text-ink-3 hover:text-ink-1"
                  onClick={() => { setPasteOpen(false); setPasteText('') }}
                  title={t('common.close')}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault()
                    void applyPasted()
                  }
                }}
                rows={5}
                placeholder={t('mp.pastePlaceholder')}
                className="input font-mono text-[11px] leading-relaxed resize-none"
                autoFocus
              />
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-ink-3">{t('mp.ctrlEnterHint')}</span>
                <button
                  className="btn btn-primary text-[11px] py-0.5 px-2 ml-auto"
                  onClick={applyPasted}
                  disabled={!pasteText.trim() || droppedLoading}
                >
                  {droppedLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Search className="h-3 w-3" />
                  )}
                  {t('mp.run')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface CompactSummaryProps {
  hasInsight: boolean
  droppedLoading: boolean
  insight: ReturnType<typeof useStore.getState>['droppedInsight']
  hasGenInfo: boolean
  model: string | null
  loraCount: number
  vae: string
}

function CompactSummary({
  hasInsight, droppedLoading, insight, hasGenInfo, model, loraCount, vae
}: CompactSummaryProps): JSX.Element {
  if (droppedLoading && !insight) {
    return (
      <span className="ml-2 flex items-center gap-1 text-ink-3">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>{tStatic('mp.analyzing')}</span>
      </span>
    )
  }
  if (hasInsight && insight) {
    const cpName = insight.checkpoint.civitai?.name ?? insight.checkpoint.nameInMetadata ?? tStatic('mp.unknown')
    const loras = insight.loras.length
    return (
      <span className="ml-2 text-ink-3 truncate">
        <span className="text-ink-1">{cpName}</span>
        {loras > 0 && <span className="ml-1.5">/ {tStatic('mp.loraCount', { count: loras })}</span>}
        {insight.vae.nameInMetadata && <span className="ml-1.5">/ VAE</span>}
      </span>
    )
  }
  if (hasGenInfo) {
    const modelShort = model?.replace(/\.safetensors.*$/, '').replace(/\s*\[.*?\]$/, '') ?? tStatic('mp.unknown')
    return (
      <span className="ml-2 text-ink-3 truncate">
        <span className="text-ink-1">{modelShort}</span>
        {loraCount > 0 && <span className="ml-1.5">/ {tStatic('mp.loraCount', { count: loraCount })}</span>}
        {vae !== 'Automatic' && <span className="ml-1.5">/ VAE: {vae}</span>}
      </span>
    )
  }
  return <span className="ml-2 text-ink-3">{tStatic('mp.noImage')}</span>
}

interface GenerationSummaryProps {
  model: string | null
  vae: string
  activeLoras: { name: string; weight: number }[]
  params: {
    sampler: string
    steps: number
    cfgScale: number
    width: number
    height: number
    seed: number
    clipSkip: number
  }
  prompt: string
}

/**
 * Decode a `data:image/png;base64,…` URL into raw bytes without going through
 * fetch (which Electron's CSP blocks on data: URLs). Works for any base64
 * data URL — extracts the part after the comma and atob's it.
 */
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const commaIdx = dataUrl.indexOf(',')
  if (commaIdx < 0) throw new Error('No base64 separator in data URL')
  const b64 = dataUrl.slice(commaIdx + 1)
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function GenerationSummary({
  model, vae, activeLoras, params, prompt: _prompt
}: GenerationSummaryProps): JSX.Element {
  const modelShort = model?.replace(/\s*\[.*?\]$/, '') ?? tStatic('mp.notSelected')
  return (
    <div className="text-[11px] space-y-1">
      <div className="flex items-baseline gap-2 text-ink-2">
        <span className="w-14 shrink-0 text-ink-3 font-mono text-[10px]">{tStatic('mp.modelLabel')}</span>
        <span className="text-ink-1 truncate">{modelShort}</span>
      </div>
      {vae !== 'Automatic' && (
        <div className="flex items-baseline gap-2 text-ink-2">
          <span className="w-14 shrink-0 text-ink-3 font-mono text-[10px]">VAE</span>
          <span className="text-ink-1 truncate">{vae}</span>
        </div>
      )}
      {activeLoras.length > 0 && (
        <div className="flex items-baseline gap-2 text-ink-2">
          <span className="w-14 shrink-0 text-ink-3 font-mono text-[10px]">LoRA</span>
          <span className="text-ink-1 truncate font-mono text-[10px]">
            {activeLoras.map((l) => `<lora:${l.name}:${l.weight.toFixed(2)}>`).join(' ')}
          </span>
        </div>
      )}
      <div className="grid grid-cols-3 gap-x-3 gap-y-0.5 font-mono text-[10px] text-ink-2 pt-0.5">
        <span>Sampler: <span className="text-ink-0">{params.sampler}</span></span>
        <span>Steps: <span className="text-ink-0">{params.steps}</span></span>
        <span>CFG: <span className="text-ink-0">{params.cfgScale}</span></span>
        <span>Size: <span className="text-ink-0">{params.width}×{params.height}</span></span>
        <span>Seed: <span className="text-ink-0">{params.seed}</span></span>
        <span className={cn(params.clipSkip !== 1 && 'text-warn')}>
          Clip: <span className="text-ink-0">{params.clipSkip}</span>
        </span>
      </div>
    </div>
  )
}
