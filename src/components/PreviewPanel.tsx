import { useState } from 'react'
import { ImageOff, Download, FolderOpen, FileImage, Recycle, Maximize2, Shuffle, Save } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore } from '@/lib/store'
import { api } from '@/lib/ipc'
import { useT, t as tStatic } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { buildWorkspaceSnapshot } from '@/lib/workspace-snapshot'
import { MetadataInfoPanel } from './MetadataInfoPanel'
import { VariationPanel } from './VariationPanel'

export function PreviewPanel(): JSX.Element {
  const isGenerating = useStore((s) => s.isGenerating)
  const progress = useStore((s) => s.progress)
  const lastImage = useStore((s) => s.lastImage)
  const lastImageHistoryId = useStore((s) => s.lastImageHistoryId)
  const history = useStore((s) => s.history)
  const setPrompt = useStore((s) => s.setPrompt)
  const setNeg = useStore((s) => s.setNegativePrompt)
  const patchParams = useStore((s) => s.patchParams)
  const setLastImage = useStore((s) => s.setLastImage)
  const setInputImage = useStore((s) => s.setInputImage)

  const [dragOver, setDragOver] = useState(false)
  const [variationOpen, setVariationOpen] = useState(false)
  const t = useT()
  const patchUpscale = useStore((s) => s.patchUpscale)
  const setCurrentTab = useStore((s) => s.setCurrentTab)

  const liveImage = progress?.current_image
    ? `data:image/png;base64,${progress.current_image}`
    : null
  const display = liveImage ?? lastImage

  function progressPct(): number {
    if (!progress) return 0
    return Math.max(0, Math.min(1, progress.progress)) * 100
  }

  async function download(): Promise<void> {
    if (!display || !display.startsWith('data:')) return
    const a = document.createElement('a')
    a.href = display
    a.download = `sd-${Date.now()}.png`
    a.click()
  }

  function openLatestInFolder(): void {
    if (history.length === 0) return
    api.app.showItemInFolder(history[0].imagePath).catch((e: Error) => {
      toast.error(tStatic('preview.openFolderFailed', { message: e.message }))
    })
  }

  function feedbackAsInput(): void {
    if (!lastImage) return
    setInputImage(lastImage, tStatic('preview.lastResultFilename'), null, lastImageHistoryId)
    setCurrentTab('img2img')
    toast.success(tStatic('preview.feedbackSuccess'))
  }

  /**
   * Send the latest generated image straight to the Upscale tab as input.
   * Mirrors `feedbackAsInput` (which feeds img2img) but routes to the Upscale
   * workspace — saves the user from manually downloading + re-uploading. The
   * Upscale tab's metadata-driven suggestion engine will pick up the image
   * on next render and propose method + upscaler + scale.
   */
  function sendToUpscale(): void {
    if (!lastImage) return
    patchUpscale({
      inputImage: lastImage,
      inputFilename: tStatic('preview.lastResultFilename'),
      inputImagePath: null,
      inputHistoryId: lastImageHistoryId,
      outputImage: null
    })
    setCurrentTab('upscale')
    toast.success(tStatic('preview.sendToUpscale'))
  }

  async function saveResultRecipe(): Promise<void> {
    if (!lastImage) return
    const s = useStore.getState()
    const snapshot = buildWorkspaceSnapshot(s, 'embed')
    const promptHead = s.prompt
      .replace(/\s+/g, ' ')
      .replace(/[\\/:*?"<>|]/g, '')
      .trim()
      .slice(0, 36)
    const name = promptHead
      ? `${tStatic('preview.recipeNamePrefix')} ${promptHead}`
      : `${tStatic('preview.recipeNamePrefix')} ${new Date().toLocaleString()}`
    try {
      await api.storage.saveWorkspace({ name, snapshot })
      toast.success(tStatic('preview.recipeSaved'))
    } catch (e) {
      toast.error(tStatic('preview.recipeSaveFailed', { message: (e as Error).message }))
    }
  }

  // Drop any image file (PNG / JPG / WebP) onto the preview to:
  //   1. Set it as the img2img input image (switches generate to img2img mode).
  //   2. If the PNG carries A1111-style "parameters" metadata, also splice
  //      prompt/negative/params into the form.
  // This unifies the "import for reference" + "load my old generation" flows.
  async function handleDrop(e: React.DragEvent): Promise<void> {
    e.preventDefault()
    setDragOver(false)
    const file = Array.from(e.dataTransfer.files).find((f) =>
      /\.(png|jpe?g|webp)$/i.test(f.name)
    )
    if (!file) {
      toast.error(tStatic('preview.dropOnlyImage'))
      return
    }
    try {
      // Read once as data URL to seed the input image; metadata extraction needs
      // the underlying ArrayBuffer so we read it separately on the File handle.
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        setInputImage(dataUrl, file.name, filePathOf(file))
        setLastImage(dataUrl)
      }
      reader.readAsDataURL(file)

      // Metadata is best-effort; failures here shouldn't block the input image.
      // Try extraction on PNG / JPEG / WebP — the parser handles all three.
      if (/\.(png|jpe?g|webp)$/i.test(file.name)) {
        try {
          const { extractPngMetadata } = await import('@/lib/png-metadata')
          const meta = await extractPngMetadata(file)
          if (meta && (meta.prompt || meta.negativePrompt)) {
            setPrompt(meta.prompt)
            setNeg(meta.negativePrompt)
            patchParams({
              steps: meta.steps ?? undefined as number | undefined,
              cfgScale: meta.cfgScale ?? undefined as number | undefined,
              width: meta.width ?? undefined as number | undefined,
              height: meta.height ?? undefined as number | undefined,
              sampler: meta.sampler ?? undefined as string | undefined,
              seed: meta.seed ?? undefined as number | undefined,
              clipSkip: meta.clipSkip ?? undefined as number | undefined
            } as Parameters<typeof patchParams>[0])
            toast.success(tStatic('preview.metadataLoaded'))

            // Cross-reference the metadata against Civitai in the background.
            // Lets the user see "what was used" for any AI image regardless of
            // origin — useful for studying others' generations.
            useStore.getState().setDroppedInsightLoading(true)
            void api.civitai
              .identifyFromPng({
                modelName: meta.model,
                modelHash: meta.modelHash,
                loras: meta.loras,
                vae: meta.vae
              })
              .then((insight) => useStore.getState().setDroppedInsight(insight))
              .catch((e) => console.warn('[civitai] identify failed:', e))
              .finally(() => useStore.getState().setDroppedInsightLoading(false))
            return
          }
        } catch { /* fall through to plain image import */ }
      }
      toast.success(tStatic('preview.imageImported'))
    } catch (e) {
      toast.error(tStatic('preview.loadFailed', { message: (e as Error).message }))
    }
  }

  return (
    <main
      className="flex-1 flex flex-col min-w-0 bg-bg-0 relative"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <div className="flex-1 flex items-center justify-center p-4 min-h-0 relative">
        {display ? (
          <img
            src={display}
            alt={t('preview.outputAlt')}
            className={cn(
              'max-w-full max-h-full object-contain rounded shadow-2xl',
              isGenerating && 'opacity-90'
            )}
          />
        ) : (
          <div className="text-ink-3 flex flex-col items-center gap-2">
            <ImageOff className="h-12 w-12" />
            <span className="text-sm">{t('preview.placeholder')}</span>
            <span className="text-xs text-ink-3/70 mt-1">{t('preview.dropHint')}</span>
          </div>
        )}
      </div>

      {dragOver && (
        <div className="absolute inset-0 z-30 bg-accent-dim/30 backdrop-blur-sm border-2 border-dashed border-accent flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-ink-0">
            <FileImage className="h-12 w-12" />
            <span className="text-sm font-medium">{t('preview.dropOverlay')}</span>
          </div>
        </div>
      )}

      <MetadataInfoPanel />
      {variationOpen && <VariationPanel />}

      <div className="border-t border-line bg-bg-1 px-3 py-2 flex items-center gap-3 shrink-0">
        <div className="flex-1 min-w-0">
          {isGenerating ? (
            <div className="space-y-1">
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-ink-1">
                  {progress?.state.job || t('preview.generating')}
                </span>
                <span className="font-mono text-ink-2">
                  {progress
                    ? `${progress.state.sampling_step}/${progress.state.sampling_steps} · ${progressPct().toFixed(0)}%`
                    : '0%'}
                </span>
              </div>
              <div className="h-1.5 bg-bg-3 rounded overflow-hidden">
                <div
                  className="h-full bg-accent transition-[width] duration-200"
                  style={{ width: `${progressPct()}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="text-xs text-ink-3">
              {lastImage ? t('preview.complete') : t('preview.idle')}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <span className="hidden xl:inline text-[10px] uppercase tracking-wider text-ink-3 mr-1">{t('preview.actions')}</span>
          <button
            className={cn('btn btn-ghost text-xs gap-1.5 py-1.5', variationOpen && 'btn-primary')}
            disabled={isGenerating}
            onClick={() => setVariationOpen((open) => !open)}
            title={t('variation.toggleTitle')}
          >
            <Shuffle className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">{t('preview.actionVariation')}</span>
          </button>
          <button
            className="btn btn-ghost text-xs gap-1.5 py-1.5"
            disabled={!lastImage}
            onClick={feedbackAsInput}
            title={t('preview.feedbackTitle')}
          >
            <Recycle className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">{t('preview.actionBaseImage')}</span>
          </button>
          <button
            className="btn btn-ghost text-xs gap-1.5 py-1.5"
            disabled={!lastImage}
            onClick={sendToUpscale}
            title={t('preview.sendToUpscaleTitle')}
          >
            <Maximize2 className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">{t('preview.actionEnhance')}</span>
          </button>
          <button
            className="btn btn-ghost text-xs gap-1.5 py-1.5"
            disabled={!lastImage}
            onClick={() => { void saveResultRecipe() }}
            title={t('preview.saveRecipeTitle')}
          >
            <Save className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">{t('preview.actionRecipe')}</span>
          </button>
          <button
            className="btn btn-ghost text-xs gap-1.5 py-1.5"
            disabled={!display}
            onClick={download}
            title={t('preview.download')}
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">{t('preview.actionDownload')}</span>
          </button>
          <button
            className="btn btn-ghost text-xs gap-1.5 py-1.5"
            disabled={history.length === 0}
            onClick={openLatestInFolder}
            title={t('preview.openFolder')}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">{t('preview.actionFolder')}</span>
          </button>
        </div>
      </div>
    </main>
  )
}

function filePathOf(file: File): string | null {
  const path = (file as File & { path?: string }).path
  return typeof path === 'string' && path.length > 0 ? path : null
}
