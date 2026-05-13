import { useEffect, useMemo, useState } from 'react'
import { Trash2, RotateCcw, Search, Filter, ImageUpscale, GitCompare, Star, CheckCircle2, XCircle, PackageCheck, ThumbsUp, ThumbsDown, Loader2, Tag, ScanLine, Save, ShieldX } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore, type FabricFeedbackItem } from '@/lib/store'
import { api } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { useT, t as tStatic } from '@/lib/i18n'
import { stripLoraTokens } from '@/lib/lora-suggest'
import { promptAppend } from '@/lib/prompt-utils'
import { DEFAULT_TAGGER_BLACKLIST, DEFAULT_TAGGER_MIN_SCORE, parseTaggerBlacklist } from '@shared/tagger-filter'
import type { HistoryItem, HistoryLabel, HistoryTagReview, TaggerRunResult } from '@shared/types'

const RANGE_OPTIONS = [
  { id: 'all', labelKey: 'history.range.all', ms: Infinity },
  { id: 'today', labelKey: 'history.range.today', ms: 24 * 60 * 60 * 1000 },
  { id: 'week', labelKey: 'history.range.week', ms: 7 * 24 * 60 * 60 * 1000 },
  { id: 'month', labelKey: 'history.range.month', ms: 30 * 24 * 60 * 60 * 1000 }
] as const
type RangeId = (typeof RANGE_OPTIONS)[number]['id']
const HISTORY_PAGE_SIZE = 40
const FABRIC_IMPORT_LIMIT = 24
const FABRIC_POSITIVE_LABELS = new Set<HistoryLabel>(['favorite', 'candidate', 'asset'])
const LABEL_OPTIONS: Array<{ id: HistoryLabel; labelKey: string; icon: typeof Star; className: string }> = [
  { id: 'favorite', labelKey: 'history.label.favorite', icon: Star, className: 'text-amber-300' },
  { id: 'candidate', labelKey: 'history.label.candidate', icon: CheckCircle2, className: 'text-ok' },
  { id: 'rejected', labelKey: 'history.label.rejected', icon: XCircle, className: 'text-err' },
  { id: 'asset', labelKey: 'history.label.asset', icon: PackageCheck, className: 'text-accent' }
]

export function HistoryGallery(): JSX.Element {
  const history = useStore((s) => s.history)
  const setHistory = useStore((s) => s.setHistory)
  const setPrompt = useStore((s) => s.setPrompt)
  const setNeg = useStore((s) => s.setNegativePrompt)
  const patch = useStore((s) => s.patchParams)
  const setLastImage = useStore((s) => s.setLastImage)
  const setSelectedModel = useStore((s) => s.setSelectedModel)
  const setSelectedVae = useStore((s) => s.setSelectedVae)
  const setActiveLoras = useStore((s) => s.setActiveLoras)
  const patchUpscale = useStore((s) => s.patchUpscale)
  const setCurrentTab = useStore((s) => s.setCurrentTab)
  const patchFabric = useStore((s) => s.patchFabric)
  const t = useT()

  const [query, setQuery] = useState('')
  const [range, setRange] = useState<RangeId>('all')
  const [modelFilter, setModelFilter] = useState('all')
  const [samplerFilter, setSamplerFilter] = useState('all')
  const [loraFilter, setLoraFilter] = useState('all')
  const [labelFilter, setLabelFilter] = useState('all')
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [fabricBusy, setFabricBusy] = useState<'positive' | 'negative' | null>(null)
  const [visibleCount, setVisibleCount] = useState(HISTORY_PAGE_SIZE)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [reviewImage, setReviewImage] = useState<string | null>(null)
  const [reviewBusy, setReviewBusy] = useState(false)
  const [reviewResult, setReviewResult] = useState<TaggerRunResult | null>(null)
  const [acceptedText, setAcceptedText] = useState('')
  const [rejectedText, setRejectedText] = useState('')
  const [reviewCandidateQuery, setReviewCandidateQuery] = useState('')
  const [reviewMinScore, setReviewMinScore] = useState(DEFAULT_TAGGER_MIN_SCORE)
  const [reviewExcludeMeta, setReviewExcludeMeta] = useState(true)
  const [reviewBlacklistText, setReviewBlacklistText] = useState(DEFAULT_TAGGER_BLACKLIST.join(', '))

  useEffect(() => {
    if (history.length > 0 || loading) return
    let disposed = false
    setLoading(true)
    void api.storage.listHistory()
      .then((items) => {
        if (!disposed) setHistory(items)
      })
      .catch((e) => toast.error(tStatic('history.loadFailed', { message: (e as Error).message })))
      .finally(() => {
        if (!disposed) setLoading(false)
      })
    return () => {
      disposed = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filterOptions = useMemo(() => {
    const models = new Set<string>()
    const samplers = new Set<string>()
    const loras = new Set<string>()
    for (const h of history) {
      if (h.params.model) models.add(h.params.model)
      if (h.params.sampler) samplers.add(h.params.sampler)
      for (const lora of h.params.activeLoras ?? []) loras.add(lora.name)
    }
    return {
      models: Array.from(models).sort((a, b) => a.localeCompare(b)),
      samplers: Array.from(samplers).sort((a, b) => a.localeCompare(b)),
      loras: Array.from(loras).sort((a, b) => a.localeCompare(b))
    }
  }, [history])

  // Filter is in-memory because history is bounded to ~500 items — well under the
  // size where we'd need to push filtering into a worker or the storage layer.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const cutoff = range === 'all'
      ? -Infinity
      : Date.now() - (RANGE_OPTIONS.find((r) => r.id === range)?.ms ?? Infinity)
    return history.filter((h) => {
      if (h.createdAt < cutoff) return false
      if (modelFilter !== 'all' && h.params.model !== modelFilter) return false
      if (samplerFilter !== 'all' && h.params.sampler !== samplerFilter) return false
      if (loraFilter !== 'all' && !(h.params.activeLoras ?? []).some((l) => l.name === loraFilter)) return false
      if (labelFilter !== 'all' && (h.label ?? 'none') !== labelFilter) return false
      if (!q) return true
      return (
        h.prompt.toLowerCase().includes(q) ||
        h.negativePrompt.toLowerCase().includes(q) ||
        (h.params.model ?? '').toLowerCase().includes(q) ||
        h.params.sampler.toLowerCase().includes(q)
      )
    })
  }, [history, query, range, modelFilter, samplerFilter, loraFilter, labelFilter])

  useEffect(() => {
    setVisibleCount(HISTORY_PAGE_SIZE)
  }, [query, range, modelFilter, samplerFilter, loraFilter, labelFilter])

  const compareItems = compareIds
    .map((id) => history.find((h) => h.id === id))
    .filter((h): h is HistoryItem => !!h)
    .slice(0, 2)
  const visibleItems = filtered.slice(0, visibleCount)
  const fabricPositiveCount = history.filter((h) => h.label && FABRIC_POSITIVE_LABELS.has(h.label)).length
  const fabricNegativeCount = history.filter((h) => h.label === 'rejected').length
  const reviewingItem = reviewingId ? history.find((item) => item.id === reviewingId) ?? null : null
  const visibleReviewCandidates = useMemo(() => {
    if (!reviewResult?.ok) return []
    const q = reviewCandidateQuery.trim().toLowerCase()
    const tags = reviewResult.tags.map((tag) => tag.name.replace(/_/g, ' '))
    if (!q) return tags.slice(0, 80)
    return tags.filter((tag) => tag.toLowerCase().includes(q)).slice(0, 80)
  }, [reviewCandidateQuery, reviewResult])

  async function restore(id: string): Promise<void> {
    const h = history.find((x) => x.id === id)
    if (!h) return
    const stripped = stripLoraTokens(h.prompt)
    const activeLoras = h.params.activeLoras ?? stripped.loras.map((l) => ({
      name: l.name,
      weight: l.weight,
      triggerWords: []
    }))
    setPrompt(stripped.prompt)
    setNeg(h.negativePrompt)
    patch({
      steps: h.params.steps,
      cfgScale: h.params.cfgScale,
      width: h.params.width,
      height: h.params.height,
      sampler: h.params.sampler,
      scheduler: h.params.scheduler ?? '',
      seed: h.params.seed,
      clipSkip: h.params.clipSkip ?? 1,
      denoisingStrength: h.params.denoisingStrength ?? 0.65
    })
    setSelectedModel(h.params.model)
    setSelectedVae(h.params.vae ?? 'Automatic')
    setActiveLoras(activeLoras)
    const dataUrl = await api.storage.readHistoryImage(id).catch(() => null)
    setLastImage(dataUrl ?? h.thumbDataUrl, dataUrl ? id : null)
    toast.success(tStatic('history.restored'))
  }

  async function sendToUpscale(id: string): Promise<void> {
    const h = history.find((x) => x.id === id)
    if (!h) return
    const dataUrl = await api.storage.readHistoryImage(id)
    if (!dataUrl) {
      toast.error(tStatic('history.imageMissing'))
      return
    }
    await restore(id)
    patchUpscale({
      inputImage: dataUrl,
      inputFilename: `history-${new Date(h.createdAt).toISOString().slice(0, 10)}.png`,
      inputImagePath: null,
      inputHistoryId: id,
      outputImage: null
    })
    setCurrentTab('upscale')
    toast.success(tStatic('history.sentToUpscale'))
  }

  async function remove(id: string): Promise<void> {
    await api.storage.deleteHistory(id)
    setHistory(history.filter((x) => x.id !== id))
    setCompareIds((ids) => ids.filter((x) => x !== id))
  }

  function toggleCompare(id: string): void {
    setCompareIds((ids) => {
      if (ids.includes(id)) return ids.filter((x) => x !== id)
      return [id, ...ids].slice(0, 2)
    })
  }

  async function setItemLabel(id: string, label: HistoryLabel): Promise<void> {
    const current = history.find((x) => x.id === id)
    if (!current) return
    const nextLabel = current.label === label ? null : label
    const updated = await api.storage.setHistoryLabel(id, nextLabel)
    if (!updated) return
    setHistory(history.map((item) => item.id === id ? updated : item))
  }

  async function openTagReview(id: string): Promise<void> {
    const item = history.find((x) => x.id === id)
    if (!item) return
    setReviewingId(id)
    setReviewResult(null)
    setReviewCandidateQuery('')
    setAcceptedText((item.tagReview?.acceptedTags ?? []).join(', '))
    setRejectedText((item.tagReview?.rejectedTags ?? []).join(', '))
    const image = await api.storage.readHistoryImage(id).catch(() => null)
    setReviewImage(image ?? item.thumbDataUrl)
  }

  async function runReviewTagger(): Promise<void> {
    if (!reviewingItem || !reviewImage || reviewBusy) return
    setReviewBusy(true)
    try {
      const result = await api.tools.runTagger({
        image: reviewImage,
        modelId: 'pixai-onnx',
        generalThreshold: 0.3,
        characterThreshold: 0.85,
        minScore: reviewMinScore,
        excludeMeta: reviewExcludeMeta,
        blacklist: parseTaggerBlacklist(reviewBlacklistText),
        limit: 80
      })
      setReviewResult(result)
      if (!result.ok) {
        toast.error(tStatic('history.reviewRunFailed', { message: result.message }))
        return
      }
      const current = parseReviewTags(acceptedText)
      const next = mergeReviewTags(current, result.promptTags)
      setAcceptedText(next.join(', '))
      toast.success(tStatic('history.reviewRunDone', { count: result.promptTags.length }))
    } catch (e) {
      toast.error(tStatic('history.reviewRunFailed', { message: (e as Error).message }))
    } finally {
      setReviewBusy(false)
    }
  }

  async function saveTagReview(): Promise<void> {
    if (!reviewingItem) return
    const review: HistoryTagReview = {
      acceptedTags: parseReviewTags(acceptedText),
      rejectedTags: parseReviewTags(rejectedText),
      sourceModel: reviewResult?.ok ? 'pixai-onnx' : 'manual',
      updatedAt: Date.now()
    }
    const updated = await api.storage.setHistoryTagReview(reviewingItem.id, review)
    if (!updated) return
    setHistory(history.map((item) => item.id === updated.id ? updated : item))
    toast.success(tStatic('history.reviewSaved', { count: review.acceptedTags.length }))
  }

  function acceptReviewTag(tag: string): void {
    setAcceptedText(mergeReviewTags(parseReviewTags(acceptedText), [tag]).join(', '))
    setRejectedText(parseReviewTags(rejectedText).filter((item) => item.toLowerCase() !== tag.toLowerCase()).join(', '))
  }

  function rejectReviewTag(tag: string): void {
    setRejectedText(mergeReviewTags(parseReviewTags(rejectedText), [tag]).join(', '))
    setAcceptedText(parseReviewTags(acceptedText).filter((item) => item.toLowerCase() !== tag.toLowerCase()).join(', '))
  }

  function acceptAllReviewTags(tags = visibleReviewCandidates): void {
    if (!tags.length) return
    setAcceptedText(mergeReviewTags(parseReviewTags(acceptedText), tags).join(', '))
    const incoming = new Set(tags.map((tag) => tag.toLowerCase()))
    setRejectedText(parseReviewTags(rejectedText).filter((item) => !incoming.has(item.toLowerCase())).join(', '))
  }

  function rejectAllReviewTags(tags = visibleReviewCandidates): void {
    if (!tags.length) return
    setRejectedText(mergeReviewTags(parseReviewTags(rejectedText), tags).join(', '))
    const incoming = new Set(tags.map((tag) => tag.toLowerCase()))
    setAcceptedText(parseReviewTags(acceptedText).filter((item) => !incoming.has(item.toLowerCase())).join(', '))
  }

  function appendReviewAcceptedToPrompt(): void {
    const tags = parseReviewTags(acceptedText)
    if (!tags.length) return
    setPrompt(tags.reduce((next, tag) => promptAppend(next, tag), useStore.getState().prompt))
    toast.success(tStatic('history.reviewPromptAdded', { count: tags.length }))
  }

  function appendReviewRejectedToNegative(): void {
    const tags = parseReviewTags(rejectedText)
    if (!tags.length) return
    setNeg(tags.reduce((next, tag) => promptAppend(next, tag), useStore.getState().negativePrompt))
    toast.success(tStatic('history.reviewNegativeAdded', { count: tags.length }))
  }

  async function addLabeledToFabric(kind: 'positive' | 'negative'): Promise<void> {
    const targets = history
      .filter((h) => kind === 'positive'
        ? !!h.label && FABRIC_POSITIVE_LABELS.has(h.label)
        : h.label === 'rejected')
      .slice(0, FABRIC_IMPORT_LIMIT)
    if (targets.length === 0) {
      toast(tStatic(kind === 'positive' ? 'history.fabricNoPositive' : 'history.fabricNoNegative'), { icon: '!' })
      return
    }

    setFabricBusy(kind)
    try {
      const existingSources = new Set([
        ...useStore.getState().fabric.positive,
        ...useStore.getState().fabric.negative
      ].map((item) => item.sourceLabel))
      const imported: FabricFeedbackItem[] = []
      let skipped = 0

      for (const item of targets) {
        const sourceLabel = `history:${item.id}`
        if (existingSources.has(sourceLabel)) {
          skipped += 1
          continue
        }
        const image = await api.storage.readHistoryImage(item.id).catch(() => null)
        if (!image) {
          skipped += 1
          continue
        }
        const saved = await api.storage.saveFabricFeedbackImage(image)
        imported.push({
          filename: saved.filename,
          path: saved.path,
          image,
          sourceLabel,
          addedAt: Date.now()
        })
        existingSources.add(sourceLabel)
      }

      if (imported.length === 0) {
        toast(tStatic('history.fabricNothingAdded', { skipped }), { icon: '!' })
        return
      }

      const current = useStore.getState().fabric
      if (kind === 'positive') {
        patchFabric({ enabled: true, positive: [...current.positive, ...imported] })
      } else {
        patchFabric({ enabled: true, negative: [...current.negative, ...imported] })
      }
      toast.success(tStatic('history.fabricAdded', { count: imported.length, skipped }))
    } catch (e) {
      toast.error(tStatic('history.fabricFailed', { message: (e as Error).message }))
    } finally {
      setFabricBusy(null)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-line shrink-0 space-y-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('history.searchPlaceholder')}
            className="input pl-7 text-xs"
          />
        </div>
        <div className="flex items-center gap-1">
          <Filter className="h-3 w-3 text-ink-3" />
          {RANGE_OPTIONS.map((r) => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded border',
                range === r.id
                  ? 'border-accent bg-accent-dim/40 text-ink-0'
                  : 'border-line text-ink-2 hover:bg-bg-3'
              )}
            >
              {t(r.labelKey)}
            </button>
          ))}
          <span className="ml-auto text-[10px] text-ink-3 font-mono">
            {filtered.length} / {history.length}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-1">
          <HistorySelect value={modelFilter} onChange={setModelFilter} options={filterOptions.models} allLabel={t('history.filterModel')} />
          <HistorySelect value={samplerFilter} onChange={setSamplerFilter} options={filterOptions.samplers} allLabel={t('history.filterSampler')} />
          <HistorySelect value={loraFilter} onChange={setLoraFilter} options={filterOptions.loras} allLabel={t('history.filterLora')} />
          <HistorySelect
            value={labelFilter}
            onChange={setLabelFilter}
            options={['none', ...LABEL_OPTIONS.map((option) => option.id)]}
            allLabel={t('history.filterLabel')}
            getLabel={(value) => value === 'none' ? t('history.label.none') : t(`history.label.${value}`)}
          />
        </div>
        {(fabricPositiveCount > 0 || fabricNegativeCount > 0) && (
          <div className="grid grid-cols-2 gap-1">
            <button
              className="btn text-[10px] py-1 gap-1 justify-center"
              disabled={fabricBusy !== null || fabricPositiveCount === 0}
              onClick={() => { void addLabeledToFabric('positive') }}
              title={t('history.fabricPositiveTitle')}
            >
              {fabricBusy === 'positive' ? <Loader2 className="h-3 w-3 animate-spin" /> : <ThumbsUp className="h-3 w-3 text-accent" />}
              {t('history.fabricPositive', { count: Math.min(fabricPositiveCount, FABRIC_IMPORT_LIMIT) })}
            </button>
            <button
              className="btn text-[10px] py-1 gap-1 justify-center"
              disabled={fabricBusy !== null || fabricNegativeCount === 0}
              onClick={() => { void addLabeledToFabric('negative') }}
              title={t('history.fabricNegativeTitle')}
            >
              {fabricBusy === 'negative' ? <Loader2 className="h-3 w-3 animate-spin" /> : <ThumbsDown className="h-3 w-3 text-warn" />}
              {t('history.fabricNegative', { count: Math.min(fabricNegativeCount, FABRIC_IMPORT_LIMIT) })}
            </button>
          </div>
        )}
        {compareItems.length === 2 && (
          <PromptDiffPanel left={compareItems[0]} right={compareItems[1]} onClear={() => setCompareIds([])} />
        )}
        {reviewingItem && (
          <div className="rounded-md border border-line bg-bg-2/60 p-2 text-[10px] space-y-2" data-testid="history-tag-review-panel">
            <div className="flex items-center gap-1.5">
              <Tag className="h-3.5 w-3.5 text-accent" />
              <span className="font-semibold text-ink-1">{t('history.reviewTitle')}</span>
              <span className="font-mono text-ink-3 truncate">{new Date(reviewingItem.createdAt).toLocaleDateString()}</span>
              <button
                className="ml-auto text-ink-3 hover:text-ink-1"
                onClick={() => {
                setReviewingId(null)
                setReviewImage(null)
                setReviewResult(null)
                setReviewCandidateQuery('')
              }}
            >
                {t('common.close')}
              </button>
            </div>
            <div className="grid grid-cols-[56px_1fr] gap-2">
              {reviewImage && <img src={reviewImage} alt="" className="h-14 w-14 rounded object-cover bg-bg-3" />}
              <div className="space-y-2 min-w-0">
                <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
                  <label className="min-w-0">
                    <div className="flex items-baseline justify-between text-ink-3">
                      <span>{t('taggerFilter.minScore')}</span>
                      <span className="font-mono text-ink-1">{reviewMinScore.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min={0.3}
                      max={0.8}
                      step={0.01}
                      value={reviewMinScore}
                      onChange={(e) => setReviewMinScore(parseFloat(e.target.value))}
                      className="w-full accent-accent"
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-ink-2">
                    <input
                      type="checkbox"
                      checked={reviewExcludeMeta}
                      onChange={(e) => setReviewExcludeMeta(e.target.checked)}
                      className="accent-accent"
                    />
                    {t('taggerFilter.excludeMeta')}
                  </label>
                </div>
                <textarea
                  className="input min-h-10 text-[10px] font-mono"
                  value={reviewBlacklistText}
                  onChange={(e) => setReviewBlacklistText(e.target.value)}
                  placeholder={t('taggerFilter.blacklist')}
                />
              </div>
            </div>
            {reviewingItem.tagReview && (
              <div className="rounded border border-line bg-bg-1/70 p-2 space-y-1" data-testid="history-review-saved-summary">
                <div className="flex items-center justify-between text-ink-3">
                  <span>{t('history.reviewSavedSummary')}</span>
                  <span className="font-mono">{new Date(reviewingItem.tagReview.updatedAt).toLocaleDateString()}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 font-mono text-[10px]">
                  <div className="min-w-0">
                    <div className="text-ok">{t('history.reviewAccepted')} ({reviewingItem.tagReview.acceptedTags.length})</div>
                    <div className="truncate text-ink-3">{reviewingItem.tagReview.acceptedTags.slice(0, 16).join(', ') || '-'}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-warn">{t('history.reviewRejected')} ({reviewingItem.tagReview.rejectedTags.length})</div>
                    <div className="truncate text-ink-3">{reviewingItem.tagReview.rejectedTags.slice(0, 16).join(', ') || '-'}</div>
                  </div>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <label>
                <span className="text-ink-3">{t('history.reviewAccepted')}</span>
                <textarea
                  className="input mt-1 min-h-16 text-[10px] font-mono"
                  value={acceptedText}
                  onChange={(e) => setAcceptedText(e.target.value)}
                  data-testid="history-review-accepted"
                />
              </label>
              <label>
                <span className="text-ink-3">{t('history.reviewRejected')}</span>
                <textarea
                  className="input mt-1 min-h-16 text-[10px] font-mono"
                  value={rejectedText}
                  onChange={(e) => setRejectedText(e.target.value)}
                  data-testid="history-review-rejected"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                className="btn justify-center gap-1 text-[10px]"
                onClick={appendReviewAcceptedToPrompt}
                disabled={parseReviewTags(acceptedText).length === 0}
                data-testid="history-review-append-prompt"
              >
                <Tag className="h-3 w-3" />
                {t('history.reviewAppendPrompt')}
              </button>
              <button
                className="btn justify-center gap-1 text-[10px]"
                onClick={appendReviewRejectedToNegative}
                disabled={parseReviewTags(rejectedText).length === 0}
                data-testid="history-review-append-negative"
              >
                <ShieldX className="h-3 w-3" />
                {t('history.reviewAppendNegative')}
              </button>
            </div>
            <div className="flex gap-1.5">
              <button
                className="btn btn-primary flex-1 justify-center gap-1"
                disabled={reviewBusy || !reviewImage}
                onClick={() => { void runReviewTagger() }}
                data-testid="history-review-run-tagger"
              >
                {reviewBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ScanLine className="h-3 w-3" />}
                {reviewBusy ? t('tools.tagger.running') : t('history.reviewRun')}
              </button>
              <button
                className="btn justify-center gap-1"
                onClick={() => { void saveTagReview() }}
                data-testid="history-review-save"
              >
                <Save className="h-3 w-3" />
                {t('common.save')}
              </button>
            </div>
            {reviewResult?.ok && (
              <div className="space-y-1" data-testid="history-review-result">
                <div className="flex items-center gap-1.5 text-ink-3">
                  <span>
                    {t('taggerFilter.keptSuppressed', {
                      kept: reviewResult.filter?.kept ?? reviewResult.promptTags.length,
                      suppressed: reviewResult.filter?.suppressed ?? reviewResult.suppressedTags?.length ?? 0
                    })}
                  </span>
                  <button className="ml-auto btn px-1.5 py-0.5 text-[10px]" onClick={() => acceptAllReviewTags()} data-testid="history-review-accept-all">
                    {t('history.reviewAcceptAll')}
                  </button>
                  <button className="btn px-1.5 py-0.5 text-[10px]" onClick={() => rejectAllReviewTags()} data-testid="history-review-reject-all">
                    {t('history.reviewRejectAll')}
                  </button>
                </div>
                <input
                  className="input py-1 text-[10px]"
                  value={reviewCandidateQuery}
                  onChange={(e) => setReviewCandidateQuery(e.target.value)}
                  placeholder={t('history.reviewSearch')}
                  data-testid="history-review-search"
                />
                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                  {visibleReviewCandidates.slice(0, 40).map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1 rounded border border-line bg-bg-3 px-1.5 py-0.5 text-ink-1">
                      {tag}
                      <button className="text-ok hover:text-ink-0" onClick={() => acceptReviewTag(tag)} title={t('history.reviewAcceptTag')}>+</button>
                      <button className="text-err hover:text-ink-0" onClick={() => rejectReviewTag(tag)} title={t('history.reviewRejectTag')}>×</button>
                    </span>
                  ))}
                </div>
                {(reviewResult.suppressedTags?.length ?? 0) > 0 && (
                  <div className="flex items-start gap-1 text-ink-3">
                    <ShieldX className="h-3 w-3 text-warn mt-0.5 shrink-0" />
                    <div className="min-w-0 truncate">
                      {reviewResult.suppressedTags?.slice(0, 12).map((tag) => tag.name.replace(/_/g, ' ')).join(', ')}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-sm text-ink-3 text-center">{t('common.loading')}</div>
        ) : history.length === 0 ? (
          <div className="p-4 text-sm text-ink-3 text-center">{t('history.empty')}</div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-sm text-ink-3 text-center">{t('history.noMatches')}</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-1 p-1.5">
              {visibleItems.map((h) => (
                <div key={h.id} className="relative group rounded overflow-hidden bg-bg-2">
                  <button
                    className={cn(
                      'absolute top-1 left-1 z-10 btn btn-icon bg-bg-2/90 backdrop-blur',
                      compareIds.includes(h.id) && 'btn-primary'
                    )}
                    onClick={() => toggleCompare(h.id)}
                    title={t('history.compareSelect')}
                  >
                    <GitCompare className="h-3 w-3" />
                  </button>
                  {h.label && (
                    <HistoryLabelBadge label={h.label} className="absolute top-1 left-8 z-10" />
                  )}
                  {h.tagReview?.acceptedTags?.length ? (
                    <span className="absolute top-8 left-1 z-10 inline-flex items-center gap-1 rounded bg-bg-2/90 px-1.5 py-1 text-[10px] text-ok backdrop-blur">
                      <Tag className="h-3 w-3" />
                      {h.tagReview.acceptedTags.length}
                    </span>
                  ) : null}
                  <img
                    src={h.thumbDataUrl}
                    alt={h.prompt.slice(0, 80)}
                    className="w-full aspect-square object-cover cursor-pointer"
                    loading="lazy"
                    onClick={() => { void restore(h.id) }}
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors pointer-events-none" />
                  <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      className="btn btn-icon bg-bg-2/90 backdrop-blur"
                      onClick={() => { void openTagReview(h.id) }}
                      title={t('history.reviewOpen')}
                      data-testid="history-review-open"
                    >
                      <Tag className="h-3 w-3" />
                    </button>
                    <button
                      className="btn btn-icon bg-bg-2/90 backdrop-blur"
                      onClick={() => { void restore(h.id) }}
                      title={t('history.restoreFull')}
                    >
                      <RotateCcw className="h-3 w-3" />
                    </button>
                    <button
                      className="btn btn-icon bg-bg-2/90 backdrop-blur"
                      onClick={() => { void sendToUpscale(h.id) }}
                      title={t('history.sendToUpscale')}
                    >
                      <ImageUpscale className="h-3 w-3" />
                    </button>
                    <button
                      className="btn btn-icon bg-bg-2/90 backdrop-blur hover:!bg-err/40"
                      onClick={() => remove(h.id)}
                      title={t('history.delete')}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="absolute left-1 right-1 bottom-6 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {LABEL_OPTIONS.map((option) => {
                      const Icon = option.icon
                      const active = h.label === option.id
                      return (
                        <button
                          key={option.id}
                          className={cn(
                            'btn btn-icon h-6 w-6 bg-bg-2/90 backdrop-blur',
                            active && 'btn-primary'
                          )}
                          onClick={() => { void setItemLabel(h.id, option.id) }}
                          title={t(option.labelKey)}
                        >
                          <Icon className={cn('h-3 w-3', option.className)} />
                        </button>
                      )
                    })}
                  </div>
                  <div className="absolute bottom-0 inset-x-0 px-1.5 py-1 bg-gradient-to-t from-black/85 to-transparent text-[10px] font-mono text-ink-1 truncate">
                    {h.params.width}×{h.params.height} · {h.params.sampler}
                  </div>
                </div>
              ))}
            </div>
            {visibleItems.length < filtered.length && (
              <div className="p-2 border-t border-line">
                <button
                  className="btn w-full text-xs"
                  onClick={() => setVisibleCount((count) => count + HISTORY_PAGE_SIZE)}
                >
                  {t('history.showMore', { count: filtered.length - visibleItems.length })}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function HistorySelect({
  value,
  onChange,
  options,
  allLabel,
  getLabel
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
  allLabel: string
  getLabel?: (v: string) => string
}): JSX.Element {
  return (
    <select className="input text-[10px] py-1 px-1" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="all">{allLabel}</option>
      {options.slice(0, 80).map((option) => (
        <option key={option} value={option}>{getLabel ? getLabel(option) : option}</option>
      ))}
    </select>
  )
}

function HistoryLabelBadge({ label, className }: { label: HistoryLabel; className?: string }): JSX.Element {
  const t = useT()
  const option = LABEL_OPTIONS.find((item) => item.id === label)
  if (!option) return <></>
  const Icon = option.icon
  return (
    <span className={cn('inline-flex items-center gap-1 rounded bg-bg-2/90 px-1.5 py-1 text-[10px] text-ink-1 backdrop-blur', className)}>
      <Icon className={cn('h-3 w-3', option.className)} />
      <span className="hidden xl:inline">{t(option.labelKey)}</span>
    </span>
  )
}

function PromptDiffPanel({
  left,
  right,
  onClear
}: {
  left: HistoryItem
  right: HistoryItem
  onClear: () => void
}): JSX.Element {
  const t = useT()
  const diff = useMemo(() => buildPromptDiff(left.prompt, right.prompt), [left.prompt, right.prompt])
  return (
    <div className="rounded-md border border-line bg-bg-2/60 p-2 text-[10px] space-y-1">
      <div className="flex items-center gap-1 text-ink-2">
        <GitCompare className="h-3 w-3 text-accent" />
        <span>{t('history.promptDiff')}</span>
        <button className="ml-auto text-ink-3 hover:text-ink-1" onClick={onClear}>{t('common.close')}</button>
      </div>
      <div className="grid grid-cols-2 gap-2 font-mono">
        <div>
          <div className="text-err mb-0.5">- {t('history.diffRemoved')}</div>
          <div className="max-h-16 overflow-y-auto text-ink-3 break-words">{diff.removed.join(', ') || '-'}</div>
        </div>
        <div>
          <div className="text-ok mb-0.5">+ {t('history.diffAdded')}</div>
          <div className="max-h-16 overflow-y-auto text-ink-3 break-words">{diff.added.join(', ') || '-'}</div>
        </div>
      </div>
    </div>
  )
}

function buildPromptDiff(left: string, right: string): { added: string[]; removed: string[] } {
  const a = tokenizePrompt(left)
  const b = tokenizePrompt(right)
  const aSet = new Set(a)
  const bSet = new Set(b)
  return {
    removed: a.filter((token, index) => !bSet.has(token) && a.indexOf(token) === index).slice(0, 60),
    added: b.filter((token, index) => !aSet.has(token) && b.indexOf(token) === index).slice(0, 60)
  }
}

function tokenizePrompt(prompt: string): string[] {
  return prompt
    .split(/[,;\n]+/)
    .map((token) => token.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
}

function parseReviewTags(value: string): string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const raw of value.split(/[,;\n]+/)) {
    const tag = raw.trim().replace(/\s+/g, ' ')
    const key = tag.toLowerCase()
    if (!tag || seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
  }
  return tags.slice(0, 120)
}

function mergeReviewTags(current: string[], incoming: string[]): string[] {
  const seen = new Set(current.map((tag) => tag.toLowerCase()))
  const merged = [...current]
  for (const raw of incoming) {
    const tag = raw.trim().replace(/\s+/g, ' ')
    const key = tag.toLowerCase()
    if (!tag || seen.has(key)) continue
    seen.add(key)
    merged.push(tag)
    if (merged.length >= 120) break
  }
  return merged
}
