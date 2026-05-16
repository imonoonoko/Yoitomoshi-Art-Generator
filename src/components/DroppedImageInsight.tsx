import { ExternalLink, Loader2, Search, Check, AlertCircle, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore } from '@/lib/store'
import { api } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { useT, t as tStatic } from '@/lib/i18n'
import type { CivitaiQuickRef } from '@shared/types'

/**
 * "What was used to generate this image" panel — appears under InputImagePanel
 * when the user dropped an AI-generated PNG with metadata. Shows the detected
 * checkpoint / LoRAs / VAE and (where Civitai has them) deep-links to the
 * source page or kicks off a download for items the user doesn't have locally.
 *
 * The insight is null until the metadata cross-reference finishes (1-3s);
 * during that window we show a small loading row.
 */
export function DroppedImageInsight(): JSX.Element | null {
  const insight = useStore((s) => s.droppedInsight)
  const loading = useStore((s) => s.droppedInsightLoading)
  const inputImage = useStore((s) => s.inputImage)
  const t = useT()

  // Hide the panel entirely when no input image (state may linger briefly
  // during reset). loading without insight = mid-resolution.
  if (!inputImage) return null
  if (!insight && !loading) return null

  return (
    <div className="card p-2 space-y-2 text-[11px]">
      <div className="flex items-center gap-1.5 text-ink-2">
        <Search className="h-3.5 w-3.5 text-accent" />
        <span className="uppercase tracking-wider">{t('insight.title')}</span>
        {loading && !insight && <Loader2 className="h-3 w-3 animate-spin text-ink-3 ml-1" />}
      </div>

      {insight && (
        <>
          {/* Checkpoint */}
          {(insight.checkpoint.nameInMetadata || insight.checkpoint.civitai) && (
            <Row
              label={t('insight.model')}
              fallbackName={insight.checkpoint.nameInMetadata}
              fallbackHash={insight.checkpoint.hashInMetadata}
              ref={insight.checkpoint.civitai}
              localCheck="model"
            />
          )}

          {/* LoRAs */}
          {insight.loras.length > 0 && (
            <div className="space-y-1">
              <div className="text-ink-3">LoRA ({insight.loras.length}):</div>
              <div className="space-y-1 ml-2">
                {insight.loras.map((l, i) => (
                  <Row
                    key={i}
                    label={`×${l.weight}`}
                    fallbackName={l.nameInPrompt}
                    fallbackHash={null}
                    ref={l.civitai}
                    localCheck="lora"
                  />
                ))}
              </div>
            </div>
          )}

          {/* VAE */}
          {(insight.vae.nameInMetadata || insight.vae.civitai) && (
            <Row
              label="VAE"
              fallbackName={insight.vae.nameInMetadata}
              fallbackHash={null}
              ref={insight.vae.civitai}
              localCheck="vae"
            />
          )}

          {!insight.checkpoint.nameInMetadata &&
            insight.loras.length === 0 &&
            !insight.vae.nameInMetadata && (
              <div className="text-ink-3 italic">{t('insight.noInfo')}</div>
            )}
        </>
      )}
    </div>
  )
}

interface RowProps {
  label: string
  fallbackName: string | null
  fallbackHash: string | null
  ref: CivitaiQuickRef | null
  localCheck: 'model' | 'lora' | 'vae'
}

function Row({ label, fallbackName, fallbackHash, ref, localCheck }: RowProps): JSX.Element {
  // Local-presence check: compare Civitai's filenames against what the user
  // has in their corresponding folder. Falls back to comparing display names
  // when Civitai didn't return us any filenames.
  const isLocal = useLocalPresence(ref, fallbackName, localCheck)
  const t = useT()
  const displayName = ref?.name ?? fallbackName ?? t('insight.unknown')

  function openCivitai(): void {
    if (ref?.pageUrl) api.app.openExternal(ref.pageUrl)
  }

  async function downloadFromCivitai(): Promise<void> {
    if (!ref || !ref.downloadUrl) return
    const filename = ref.filenames[0] ?? `${ref.name}.safetensors`
    try {
      await api.civitai.download({
        url: ref.downloadUrl,
        filename,
        assetType: ref.type,
        expectedSha256: ref.primaryFileSha256 ?? null,
        source: {
          provider: 'civitai',
          name: ref.name,
          pageUrl: ref.pageUrl,
          downloadUrl: ref.downloadUrl,
          thumbnailUrl: ref.thumbnailUrl,
          expectedSha256: ref.primaryFileSha256 ?? null,
          modelId: ref.modelId,
          modelVersionId: ref.modelVersionId,
          baseModel: ref.baseModel
        }
      })
      toast.success(tStatic('insight.downloadDone', { filename }))
      // Refresh the relevant local list so isLocal flips on next render
      if (localCheck === 'model') {
        const updated = await api.forge.listModels()
        useStore.getState().setModels(updated)
      } else if (localCheck === 'lora') {
        const updated = await api.forge.listLoras()
        useStore.getState().setLoras(updated)
      } else if (localCheck === 'vae') {
        const updated = await api.forge.listVaes()
        useStore.getState().setVaes(updated)
      }
    } catch (e) {
      toast.error(tStatic('insight.downloadFailed', { message: (e as Error).message }))
    }
  }

  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-ink-3 shrink-0 font-mono text-[10px] min-w-[40px]">{label}</span>
      <span className={cn('truncate flex-1', isLocal && 'text-ok')}>
        {displayName}
        {fallbackHash && (
          <span className="text-ink-3 font-mono text-[10px] ml-1">[{fallbackHash}]</span>
        )}
      </span>
      {ref ? (
        <>
          {isLocal ? (
            <span title={t('insight.local')} className="text-ok shrink-0">
              <Check className="h-3 w-3" />
            </span>
          ) : ref.downloadUrl ? (
            <button
              onClick={downloadFromCivitai}
              className="shrink-0 text-accent hover:text-accent-hover"
              title={t('insight.download')}
            >
              <Download className="h-3 w-3" />
            </button>
          ) : null}
          <button
            onClick={openCivitai}
            className="shrink-0 text-ink-3 hover:text-ink-1"
            title={t('insight.openCivitai')}
          >
            <ExternalLink className="h-3 w-3" />
          </button>
        </>
      ) : (
        <span title={t('insight.noCivitai')} className="text-ink-3 shrink-0">
          <AlertCircle className="h-3 w-3" />
        </span>
      )}
    </div>
  )
}

function useLocalPresence(
  ref: CivitaiQuickRef | null,
  fallbackName: string | null,
  kind: 'model' | 'lora' | 'vae'
): boolean {
  const models = useStore((s) => s.models)
  const loras = useStore((s) => s.loras)
  const vaes = useStore((s) => s.vaes)

  // Names to test: civitai-reported filenames, the model's display name, the
  // metadata name (e.g., "model_v1"). Lowercased for case-insensitive match.
  const candidates: string[] = []
  if (ref) {
    candidates.push(...ref.filenames.map((f) => f.replace(/\.[^.]+$/, '')))
    candidates.push(ref.name)
  }
  if (fallbackName) candidates.push(fallbackName)
  const candidatesLc = new Set(candidates.map((c) => c.toLowerCase()))
  if (candidatesLc.size === 0) return false

  if (kind === 'model') {
    return models.some(
      (m) => candidatesLc.has(m.modelName.toLowerCase()) ||
             candidatesLc.has(m.title.toLowerCase()) ||
             (m.hash != null && candidatesLc.has(m.hash.toLowerCase()))
    )
  }
  if (kind === 'lora') {
    return loras.some(
      (l) => candidatesLc.has(l.alias.toLowerCase()) ||
             candidatesLc.has(l.name.toLowerCase())
    )
  }
  if (kind === 'vae') {
    return vaes.some((v) => candidatesLc.has(v.modelName.toLowerCase()))
  }
  return false
}
