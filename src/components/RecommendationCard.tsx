import { useState } from 'react'
import {
  ExternalLink, Sparkles, Users, ChevronDown, ChevronUp, Loader2, Minus,
  Download, Check
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore } from '@/lib/store'
import { api } from '@/lib/ipc'
import { promptAppend, promptContains } from '@/lib/prompt-utils'
import { useT, t as tStatic } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type {
  CivitaiAssetType,
  CivitaiCommunityStats,
  CivitaiQuickRef,
  Distribution
} from '@shared/types'

/**
 * Civitai recommendation banner. Shown above the prompt editor when the
 * selected model has resolved Civitai metadata. The user gets a one-click
 * "Apply" button that pushes recommended sampler/steps/size/etc into the form
 * — and prepends trigger words to the current prompt.
 *
 * In addition to the official sample-image recommendation (which is built
 * from typically 5-20 images), this card surfaces a community-mining stats
 * panel built from `/api/v1/images?modelVersionId=` (~100-500 images). The
 * community stats reveal richer detail: full sampler distribution, IQR of
 * steps/CFG, common prompt phrases as clickable chips, and the most-used
 * LoRAs across community generations.
 */
export function RecommendationCard(): JSX.Element | null {
  const r = useStore((s) => s.recommendation)
  const loading = useStore((s) => s.recommendationLoading)
  const stats = useStore((s) => s.communityStats)
  const statsLoading = useStore((s) => s.communityStatsLoading)
  const patch = useStore((s) => s.patchParams)
  const setPrompt = useStore((s) => s.setPrompt)
  const setNeg = useStore((s) => s.setNegativePrompt)
  const prompt = useStore((s) => s.prompt)
  const negative = useStore((s) => s.negativePrompt)
  const vaes = useStore((s) => s.vaes)
  const setSelectedVae = useStore((s) => s.setSelectedVae)
  const t = useT()

  const [expanded, setExpanded] = useState(false)
  // Collapse the whole card to a single-line header — useful when the user
  // is already familiar with the model and wants the vertical space back.
  const [cardCollapsed, setCardCollapsed] = useState(false)

  if (loading) {
    return (
      <div className="card p-3 flex items-center gap-2 text-sm text-ink-2">
        <Sparkles className="h-4 w-4 animate-pulse" />
        {t('rec.searching')}
      </div>
    )
  }
  if (!r) return null

  function applyAll(): void {
    if (!r) return
    const sug = r.suggested
    patch({
      steps: sug.steps ?? undefined as number | undefined,
      cfgScale: sug.cfgScale ?? undefined as number | undefined,
      width: sug.width ?? undefined as number | undefined,
      height: sug.height ?? undefined as number | undefined,
      sampler: sug.sampler ?? undefined as string | undefined,
      clipSkip: sug.clipSkip ?? undefined as number | undefined
    } as Parameters<typeof patch>[0])

    if (r.trainedWords.length > 0) {
      const missing = r.trainedWords.filter((w) => !prompt.includes(w))
      if (missing.length > 0) {
        setPrompt(missing.join(', ') + (prompt ? ', ' + prompt : ''))
      }
    }
    if (sug.negativePrompt) setNeg(sug.negativePrompt)

    if (r.recommendedVae) {
      const recName = r.recommendedVae.name
      const match = vaes.find(
        (v) => v.modelName === recName || v.modelName.toLowerCase() === recName.toLowerCase()
      )
      if (match) {
        setSelectedVae(match.modelName)
      } else {
        // The recommendation may have come from sample-image meta (no downloadUrl)
        // or the structured files[] (downloadUrl present). Try the direct URL first;
        // fall back to a Civitai name search so VAEs sourced from sample meta still
        // download in one click.
        void autoDownloadVae(recName, r.recommendedVae.downloadUrl)
      }
    }

    toast.success(tStatic('rec.applied'))
  }

  /**
   * Best-effort VAE auto-download. If we already have a direct downloadUrl from
   * Civitai's structured files[], use it. Otherwise search Civitai by VAE name
   * and use the top match's primary file. The whole flow is wrapped in one toast
   * lifecycle so the user sees one progress indicator regardless of which path
   * we took.
   */
  async function autoDownloadVae(
    recName: string,
    knownUrl: string | null
  ): Promise<void> {
    const dlId = toast.loading(tStatic('rec.fetchingVae', { name: recName }))
    try {
      let url = knownUrl
      let filename = recName
      let expectedSha: string | null = null

      if (!url) {
        toast.loading(tStatic('rec.searchingVae', { name: recName }), { id: dlId })
        const result = await api.civitai.search({
          query: recName,
          types: ['VAE'],
          limit: 5,
          sort: 'Most Downloaded',
          period: 'AllTime',
          nsfw: false
        })
        // Prefer a result whose primary file's stem matches the recommendation
        // case-insensitively. Falls back to the first result.
        const targetStem = recName.replace(/\.[^.]+$/, '').toLowerCase()
        const item =
          result.items.find((it) =>
            it.versions[0]?.files.some(
              (f) => f.name.replace(/\.[^.]+$/, '').toLowerCase() === targetStem
            )
          ) ??
          result.items.find((it) => it.name.toLowerCase().includes(targetStem)) ??
          result.items[0]
        const version = item?.versions[0]
        const file =
          version?.files.find((f) => f.primary) ?? version?.files[0]
        if (!file?.downloadUrl) {
          toast.error(
            tStatic('rec.vaeNotFound', { name: recName }),
            { id: dlId }
          )
          return
        }
        url = file.downloadUrl
        filename = file.name
        expectedSha = file.hashes?.sha256 ?? null
      }

      toast.loading(tStatic('rec.downloadingVae', { filename }), { id: dlId })
      await api.civitai.download({
        url,
        filename,
        assetType: 'VAE',
        expectedSha256: expectedSha
      })
      const updated = await api.forge.listVaes()
      useStore.getState().setVaes(updated)
      const stem = filename.replace(/\.[^.]+$/, '').toLowerCase()
      const fresh = updated.find(
        (v) =>
          v.modelName.toLowerCase() === filename.toLowerCase() ||
          v.modelName.replace(/\.[^.]+$/, '').toLowerCase() === stem
      )
      if (fresh) setSelectedVae(fresh.modelName)
      toast.success(tStatic('rec.vaeImported', { filename }), { id: dlId })
    } catch (e) {
      toast.error(tStatic('rec.vaeFailed', { message: (e as Error).message }), { id: dlId })
    }
  }

  /**
   * Apply community-mined values: most-frequent sampler, median steps/cfg/clip,
   * most-frequent size, top community VAE. More representative than the
   * official-sample mode/median when the community set is large.
   */
  function applyCommunity(): void {
    if (!stats) return
    const top = (xs: { name: string; freq: number }[]): string | undefined =>
      xs[0]?.name ?? undefined
    const topSize = stats.topSizes[0]
    patch({
      steps: stats.stepsDist.median != null ? Math.round(stats.stepsDist.median) : undefined,
      cfgScale: stats.cfgDist.median ?? undefined,
      clipSkip: stats.clipSkipDist.median != null ? Math.round(stats.clipSkipDist.median) : undefined,
      sampler: top(stats.topSamplers),
      width: topSize?.width,
      height: topSize?.height
    } as Parameters<typeof patch>[0])
    const topVae = top(stats.topVaes)
    if (topVae) {
      const match = vaes.find(
        (v) => v.modelName.toLowerCase() === topVae.toLowerCase()
      )
      if (match) setSelectedVae(match.modelName)
    }
    toast.success(tStatic('rec.communityApplied', { count: stats.sampleCount }))
  }

  function applyTriggers(): void {
    if (!r) return
    if (r.trainedWords.length === 0) return
    const missing = r.trainedWords.filter((w) => !prompt.includes(w))
    if (missing.length === 0) { toast(tStatic('rec.alreadyContains')); return }
    setPrompt(missing.join(', ') + (prompt ? ', ' + prompt : ''))
  }

  function togglePhrase(phrase: string, target: 'positive' | 'negative'): void {
    const current = target === 'positive' ? prompt : negative
    const setter = target === 'positive' ? setPrompt : setNeg
    if (promptContains(current, phrase)) {
      // simple substring removal — same approach as QuickPresetBar uses
      setter(current.replace(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '')
        .replace(/,\s*,/g, ',').replace(/^[\s,]+|[\s,]+$/g, ''))
    } else {
      setter(promptAppend(current, phrase))
    }
  }

  const sug = r.suggested

  if (cardCollapsed) {
    return (
      <button
        type="button"
        onClick={() => setCardCollapsed(false)}
        className="card p-2 flex items-center gap-2 w-full text-left hover:bg-bg-3 transition-colors"
        title={t('rec.expandTitle')}
      >
        <Sparkles className="h-3.5 w-3.5 text-accent shrink-0" />
        <span className="text-[11px] text-ink-2 uppercase tracking-wider shrink-0">Civitai</span>
        <span className="text-xs text-ink-1 truncate flex-1">{r.modelName}</span>
        <ChevronDown className="h-3.5 w-3.5 text-ink-3 shrink-0" />
      </button>
    )
  }

  return (
    <div className="card p-3 space-y-2">
      <div className="flex items-start gap-2">
        {r.thumbnailUrl && (
          <img
            src={r.thumbnailUrl}
            alt=""
            className="w-12 h-12 rounded object-cover shrink-0 bg-bg-3"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            <span className="text-xs text-ink-2 uppercase tracking-wider">{t('rec.title')}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-bg-3 text-ink-1">{r.baseModel}</span>
            <button
              onClick={() => setCardCollapsed(true)}
              className="ml-auto text-ink-3 hover:text-ink-1"
              title={t('rec.collapseTitle')}
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            {r.civitaiUrl && (
              <button
                onClick={() => api.app.openExternal(r.civitaiUrl!)}
                className="text-ink-3 hover:text-ink-1"
                title={t('rec.openOnCivitai')}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="text-sm font-medium truncate">{r.modelName}</div>
          <div className="text-xs text-ink-3 truncate">{r.versionName}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs font-mono">
        {sug.sampler && <span className="text-ink-2">Sampler: <span className="text-ink-0">{sug.sampler}</span></span>}
        {sug.steps !== null && <span className="text-ink-2">Steps: <span className="text-ink-0">{sug.steps}</span></span>}
        {sug.cfgScale !== null && <span className="text-ink-2">CFG: <span className="text-ink-0">{sug.cfgScale}</span></span>}
        {sug.width && sug.height && (
          <span className="text-ink-2">{t('rec.size')}: <span className="text-ink-0">{sug.width}×{sug.height}</span></span>
        )}
        {sug.clipSkip !== null && <span className="text-ink-2">Clip Skip: <span className="text-ink-0">{sug.clipSkip}</span></span>}
        {r.recommendedVae && (
          <span className="text-ink-2 col-span-2 flex items-baseline gap-1">
            <span>VAE:</span>
            <span className="text-ink-0">{r.recommendedVae.name}</span>
            {!vaes.some(
              (v) => v.modelName.toLowerCase() === r.recommendedVae!.name.toLowerCase()
            ) && (
              <>
                <span className="text-warn">{t('rec.notImported')}</span>
                {r.recommendedVae.downloadUrl && (
                  <button
                    onClick={() => api.app.openExternal(r.recommendedVae!.downloadUrl!)}
                    className="text-accent hover:text-accent-hover underline ml-1"
                    title={t('rec.downloadFromCivitai')}
                  >
                    {t('rec.download')}
                  </button>
                )}
              </>
            )}
          </span>
        )}
      </div>

      {r.trainedWords.length > 0 && (
        <div className="flex flex-wrap gap-1 items-center">
          <span className="text-xs text-ink-2">{t('rec.triggers')}</span>
          {r.trainedWords.slice(0, 6).map((w) => (
            <button
              key={w}
              className="chip bg-accent-dim/40 text-ink-0 border border-accent-dim"
              onClick={applyTriggers}
              title={t('rec.addToPrompt')}
            >
              {w}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-1.5 pt-1">
        <button className="btn btn-primary flex-1" onClick={applyAll}>{t('rec.applyRecommended')}</button>
      </div>

      {/* Community-mined stats — async; shows loading or results when ready */}
      <CommunityStatsSection
        stats={stats}
        loading={statsLoading}
        expanded={expanded}
        onToggle={() => setExpanded((e) => !e)}
        onApply={applyCommunity}
        onTogglePhrase={togglePhrase}
        prompt={prompt}
        negative={negative}
      />
    </div>
  )
}

interface CommunityProps {
  stats: CivitaiCommunityStats | null
  loading: boolean
  expanded: boolean
  onToggle(): void
  onApply(): void
  onTogglePhrase(phrase: string, target: 'positive' | 'negative'): void
  prompt: string
  negative: string
}

function CommunityStatsSection({
  stats, loading, expanded, onToggle, onApply, onTogglePhrase, prompt, negative
}: CommunityProps): JSX.Element {
  const t = useT()
  if (loading && !stats) {
    return (
      <div className="border-t border-line pt-2 text-[11px] text-ink-3 flex items-center gap-1.5">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t('rec.communityLoading')}
      </div>
    )
  }
  if (!stats) return <></>

  return (
    <div className="border-t border-line pt-2 space-y-2">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 text-[11px] text-ink-2 hover:text-ink-0"
      >
        <Users className="h-3 w-3 text-accent" />
        <span>{t('rec.communityStats')}</span>
        <span className="font-mono text-ink-3">{t('rec.communitySampleCount', { count: stats.sampleCount })}</span>
        <span className="ml-auto">
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </span>
      </button>

      {expanded && (
        <div className="space-y-2 text-[11px]">
          {/* Top samplers / sizes / VAEs at a glance */}
          <DistRow label="Sampler" entries={stats.topSamplers.map((s) => `${s.name} (${pct(s.freq, stats.sampleCount)}%)`)} />
          <DistRow label="Steps" entries={[describeDist(stats.stepsDist)]} />
          <DistRow label="CFG" entries={[describeDist(stats.cfgDist)]} />
          {stats.clipSkipDist.n > 0 && (
            <DistRow label="Clip Skip" entries={[describeDist(stats.clipSkipDist)]} />
          )}
          <DistRow
            label="Size"
            entries={stats.topSizes.slice(0, 3).map((s) => `${s.width}×${s.height} (${pct(s.freq, stats.sampleCount)}%)`)}
          />
          {stats.topVaes.length > 0 && (
            <DownloadableRowGroup
              label="VAE"
              kind="vae"
              items={stats.topVaes.map((v) => ({
                name: v.name,
                pct: pct(v.freq, stats.sampleCount),
                civitai: v.civitai ?? null
              }))}
            />
          )}
          {stats.topLoras.length > 0 && (
            <DownloadableRowGroup
              label="LoRA"
              kind="lora"
              items={stats.topLoras.slice(0, 8).map((l) => ({
                name: l.name,
                pct: pct(l.freq, stats.sampleCount),
                weight: l.medianWeight,
                civitai: l.civitai ?? null
              }))}
            />
          )}

          {stats.commonPositivePhrases.length > 0 && (
            <div>
              <div className="text-ink-3 mb-1">{t('rec.frequentPositive')}</div>
              <div className="flex flex-wrap gap-1">
                {stats.commonPositivePhrases.map((p) => {
                  const active = promptContains(prompt, p.phrase)
                  return (
                    <button
                      key={p.phrase}
                      onClick={() => onTogglePhrase(p.phrase, 'positive')}
                      className={cn(
                        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border',
                        active
                          ? 'bg-accent-dim/50 border-accent text-ink-0'
                          : 'border-line text-ink-1 hover:bg-bg-3'
                      )}
                      title={t('rec.containedInSample', { percent: pct(p.freq, stats.sampleCount) })}
                    >
                      <span className="font-mono">{p.phrase}</span>
                      <span className="text-ink-3">{pct(p.freq, stats.sampleCount)}%</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {stats.commonNegativePhrases.length > 0 && (
            <div>
              <div className="text-ink-3 mb-1">{t('rec.frequentNegative')}</div>
              <div className="flex flex-wrap gap-1">
                {stats.commonNegativePhrases.map((p) => {
                  const active = promptContains(negative, p.phrase)
                  return (
                    <button
                      key={p.phrase}
                      onClick={() => onTogglePhrase(p.phrase, 'negative')}
                      className={cn(
                        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border',
                        active
                          ? 'bg-err/30 border-err/60 text-ink-0'
                          : 'border-line text-ink-1 hover:bg-bg-3'
                      )}
                      title={t('rec.containedInSample', { percent: pct(p.freq, stats.sampleCount) })}
                    >
                      <span className="font-mono">{p.phrase}</span>
                      <span className="text-ink-3">{pct(p.freq, stats.sampleCount)}%</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <button
            className="btn text-[11px] py-1 px-2 w-full"
            onClick={onApply}
            title={t('rec.applyCommunityTitle')}
          >
            {t('rec.applyCommunity')}
          </button>
        </div>
      )}
    </div>
  )
}

interface DistRowProps {
  label: string
  entries: string[]
}
function DistRow({ label, entries }: DistRowProps): JSX.Element | null {
  if (entries.length === 0) return null
  return (
    <div className="flex items-baseline gap-2 font-mono">
      <span className="text-ink-3 w-14 shrink-0">{label}:</span>
      <span className="text-ink-1 truncate">{entries.join(' ・ ')}</span>
    </div>
  )
}

interface DownloadableItem {
  name: string
  pct: number
  weight?: number
  civitai: CivitaiQuickRef | null
}

/**
 * Vertical list of community-popular VAEs / LoRAs with per-item download
 * action. Each row shows: name, % of community samples, download / local
 * indicator, and a deep-link to the Civitai page when one was resolvable.
 *
 * The download UX mirrors DroppedImageInsight — main thread handles the
 * stream + progress, refreshes the local list on success so the green ✓
 * indicator flips automatically.
 */
function DownloadableRowGroup({
  label, kind, items
}: { label: string; kind: 'vae' | 'lora'; items: DownloadableItem[] }): JSX.Element | null {
  if (items.length === 0) return null
  return (
    <div className="space-y-0.5">
      <div className="text-ink-3 font-mono">{label}:</div>
      <div className="space-y-0.5 ml-3">
        {items.map((it, i) => (
          <DownloadableRow key={`${it.name}-${i}`} item={it} kind={kind} />
        ))}
      </div>
    </div>
  )
}

function DownloadableRow({
  item, kind
}: { item: DownloadableItem; kind: 'vae' | 'lora' }): JSX.Element {
  const vaes = useStore((s) => s.vaes)
  const loras = useStore((s) => s.loras)
  const setVaes = useStore((s) => s.setVaes)
  const setLoras = useStore((s) => s.setLoras)
  const t = useT()

  // Local-presence check: compare Civitai-reported filenames + the meta name
  // against the user's local installation. Same logic the DroppedImageInsight
  // panel uses, kept inlined for self-contained behavior.
  const candidates = new Set<string>()
  candidates.add(item.name.toLowerCase())
  if (item.civitai) {
    candidates.add(item.civitai.name.toLowerCase())
    for (const f of item.civitai.filenames) {
      candidates.add(f.replace(/\.[^.]+$/, '').toLowerCase())
    }
  }
  const isLocal = kind === 'vae'
    ? vaes.some((v) => candidates.has(v.modelName.toLowerCase()))
    : loras.some((l) =>
        candidates.has(l.alias.toLowerCase()) ||
        candidates.has(l.name.toLowerCase())
      )

  const [downloading, setDownloading] = useState(false)

  async function download(): Promise<void> {
    if (!item.civitai?.downloadUrl) return
    setDownloading(true)
    try {
      const filename = item.civitai.filenames[0] ?? `${item.civitai.name}.safetensors`
      const assetType: CivitaiAssetType = kind === 'vae' ? 'VAE' : 'LORA'
      await api.civitai.download({
        url: item.civitai.downloadUrl,
        filename,
        assetType,
        expectedSha256: null
      })
      toast.success(tStatic('rec.downloadComplete', { filename }))
      // Refresh the relevant list so the local ✓ indicator updates.
      if (kind === 'vae') setVaes(await api.forge.listVaes())
      else setLoras(await api.forge.listLoras())
    } catch (e) {
      toast.error(tStatic('rec.dlFailed', { message: (e as Error).message }))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="flex items-baseline gap-1.5 font-mono">
      <span className={cn('truncate flex-1 text-[10px]', isLocal && 'text-ok')}>
        {item.name}
        {item.weight !== undefined && (
          <span className="text-ink-3 ml-1">×{item.weight.toFixed(2)}</span>
        )}
      </span>
      <span className="text-ink-3 text-[10px] shrink-0">{item.pct}%</span>
      {isLocal ? (
        <span title={t('rec.localExists')} className="text-ok shrink-0">
          <Check className="h-3 w-3" />
        </span>
      ) : item.civitai?.downloadUrl ? (
        <button
          onClick={download}
          disabled={downloading}
          className="shrink-0 text-accent hover:text-accent-hover disabled:text-ink-3"
          title={t('rec.dlFromCivitaiHint', { name: item.civitai.name })}
        >
          {downloading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
        </button>
      ) : null}
      {item.civitai?.pageUrl && (
        <button
          onClick={() => api.app.openExternal(item.civitai!.pageUrl)}
          className="shrink-0 text-ink-3 hover:text-ink-1"
          title={t('rec.openOnCivitai')}
        >
          <ExternalLink className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}

function describeDist(d: Distribution): string {
  if (d.n === 0 || d.median == null) return '—'
  if (d.q1 != null && d.q3 != null && (d.q3 - d.q1) > 0) {
    return tStatic('rec.medianStat', {
      median: formatNum(d.median),
      q1: formatNum(d.q1),
      q3: formatNum(d.q3),
      n: d.n
    })
  }
  return `${formatNum(d.median)} (n=${d.n})`
}

function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}
