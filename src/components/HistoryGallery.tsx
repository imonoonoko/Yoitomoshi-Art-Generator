import { useEffect, useMemo, useState } from 'react'
import { Trash2, RotateCcw, Search, Filter, ImageUpscale, GitCompare, Star, CheckCircle2, XCircle, PackageCheck, ThumbsUp, ThumbsDown, Loader2, Tag, ScanLine, Save, ShieldX, Braces, ClipboardCheck, ImagePlus } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore, type FabricFeedbackItem } from '@/lib/store'
import { api } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { useT, t as tStatic } from '@/lib/i18n'
import { stripLoraTokens } from '@/lib/lora-suggest'
import { promptAppend } from '@/lib/prompt-utils'
import { buildHistoryExperimentGroups, type HistoryExperimentGroup } from '@/lib/history-fingerprint'
import { DEFAULT_TAGGER_BLACKLIST, DEFAULT_TAGGER_MIN_SCORE, parseTaggerBlacklist } from '@shared/tagger-filter'
import type { HistoryItem, HistoryLabel, HistoryProRecipeReview, HistoryTagReview, TaggerRunResult } from '@shared/types'

const RANGE_OPTIONS = [
  { id: 'all', labelKey: 'history.range.all', ms: Infinity },
  { id: 'today', labelKey: 'history.range.today', ms: 24 * 60 * 60 * 1000 },
  { id: 'week', labelKey: 'history.range.week', ms: 7 * 24 * 60 * 60 * 1000 },
  { id: 'month', labelKey: 'history.range.month', ms: 30 * 24 * 60 * 60 * 1000 }
] as const
type RangeId = (typeof RANGE_OPTIONS)[number]['id']
type HistoryQuickFilter = 'all' | 'success' | 'favorite' | 'rejected' | 'asset' | 'social' | 'reference' | 'proRecipe'
type HistoryRatingFilter = 'all' | '5' | '4plus' | '3plus' | 'unrated'
type CandidateBoardVariantAction = 'seedNext' | 'cfgDown' | 'cfgUp' | 'loraDown' | 'loraUp'
const HISTORY_PAGE_SIZE = 40
const FABRIC_IMPORT_LIMIT = 24
const CANDIDATE_BOARD_LIMIT = 8
const FABRIC_POSITIVE_LABELS = new Set<HistoryLabel>(['favorite', 'candidate', 'asset', 'social', 'reference'])
const QUICK_FILTER_OPTIONS: Array<{ id: HistoryQuickFilter; labelKey: string }> = [
  { id: 'all', labelKey: 'history.quick.all' },
  { id: 'success', labelKey: 'history.quick.success' },
  { id: 'favorite', labelKey: 'history.quick.favorite' },
  { id: 'rejected', labelKey: 'history.quick.rejected' },
  { id: 'asset', labelKey: 'history.quick.asset' },
  { id: 'social', labelKey: 'history.quick.social' },
  { id: 'reference', labelKey: 'history.quick.reference' },
  { id: 'proRecipe', labelKey: 'history.quick.proRecipe' }
]
const RATING_FILTER_OPTIONS: Array<{ id: HistoryRatingFilter; labelKey: string }> = [
  { id: 'all', labelKey: 'history.ratingFilter.all' },
  { id: '5', labelKey: 'history.ratingFilter.5' },
  { id: '4plus', labelKey: 'history.ratingFilter.4plus' },
  { id: '3plus', labelKey: 'history.ratingFilter.3plus' },
  { id: 'unrated', labelKey: 'history.ratingFilter.unrated' }
]
const PRO_RECIPE_RATING_OPTIONS = [1, 2, 3, 4, 5] as const
const LABEL_OPTIONS: Array<{ id: HistoryLabel; labelKey: string; icon: typeof Star; className: string }> = [
  { id: 'favorite', labelKey: 'history.label.favorite', icon: Star, className: 'text-amber-300' },
  { id: 'candidate', labelKey: 'history.label.candidate', icon: CheckCircle2, className: 'text-ok' },
  { id: 'rejected', labelKey: 'history.label.rejected', icon: XCircle, className: 'text-err' },
  { id: 'asset', labelKey: 'history.label.asset', icon: PackageCheck, className: 'text-accent' },
  { id: 'social', labelKey: 'history.label.social', icon: ThumbsUp, className: 'text-sky-300' },
  { id: 'reference', labelKey: 'history.label.reference', icon: ScanLine, className: 'text-violet-300' }
]
type HistoryGalleryView = 'history' | 'candidate'

export function HistoryGallery({ view = 'history' }: { view?: HistoryGalleryView } = {}): JSX.Element {
  const history = useStore((s) => s.history)
  const setHistory = useStore((s) => s.setHistory)
  const setPrompt = useStore((s) => s.setPrompt)
  const setNeg = useStore((s) => s.setNegativePrompt)
  const patch = useStore((s) => s.patchParams)
  const setLastImage = useStore((s) => s.setLastImage)
  const setInputImage = useStore((s) => s.setInputImage)
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
  const [quickFilter, setQuickFilter] = useState<HistoryQuickFilter>('all')
  const [ratingFilter, setRatingFilter] = useState<HistoryRatingFilter>('all')
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
  const [proReviewingId, setProReviewingId] = useState<string | null>(null)
  const [proRatingText, setProRatingText] = useState('')
  const [proStrengthsText, setProStrengthsText] = useState('')
  const [proIssuesText, setProIssuesText] = useState('')
  const [proNextActionsText, setProNextActionsText] = useState('')

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

  const historyById = useMemo(() => {
    const index = new Map<string, HistoryItem>()
    for (const item of history) index.set(item.id, item)
    return index
  }, [history])

  const historySearchIndex = useMemo(() => {
    const index = new Map<string, string>()
    for (const item of history) index.set(item.id, historySearchText(item))
    return index
  }, [history])

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
      if (!matchesHistoryQuickFilter(h, quickFilter)) return false
      if (!matchesHistoryRatingFilter(h, ratingFilter)) return false
      if (!q) return true
      return (historySearchIndex.get(h.id) ?? '').includes(q)
    })
  }, [history, historySearchIndex, query, range, modelFilter, samplerFilter, loraFilter, labelFilter, quickFilter, ratingFilter])

  useEffect(() => {
    setVisibleCount(HISTORY_PAGE_SIZE)
  }, [query, range, modelFilter, samplerFilter, loraFilter, labelFilter, quickFilter, ratingFilter])

  const compareItems = useMemo(
    () => compareIds
      .map((id) => historyById.get(id))
      .filter((h): h is HistoryItem => !!h)
      .slice(0, 2),
    [compareIds, historyById]
  )
  const visibleItems = filtered.slice(0, visibleCount)
  const fabricCounts = useMemo(() => {
    let positive = 0
    let negative = 0
    for (const item of history) {
      if (item.label && FABRIC_POSITIVE_LABELS.has(item.label)) positive += 1
      if (item.label === 'rejected') negative += 1
    }
    return { positive, negative }
  }, [history])
  const fabricPositiveCount = fabricCounts.positive
  const fabricNegativeCount = fabricCounts.negative
  const reviewingItem = reviewingId ? historyById.get(reviewingId) ?? null : null
  const proReviewingItem = proReviewingId ? historyById.get(proReviewingId) ?? null : null
  const experimentGroups = useMemo(
    () => buildHistoryExperimentGroups(filtered, { minItems: 2, maxGroups: 4 }),
    [filtered]
  )
  const candidateBoard = useMemo(() => buildCandidateBoardGroup(history), [history])
  const visibleReviewCandidates = useMemo(() => {
    if (!reviewResult?.ok) return []
    const q = reviewCandidateQuery.trim().toLowerCase()
    const tags = reviewResult.tags.map((tag) => tag.name.replace(/_/g, ' '))
    if (!q) return tags.slice(0, 80)
    return tags.filter((tag) => tag.toLowerCase().includes(q)).slice(0, 80)
  }, [reviewCandidateQuery, reviewResult])

  async function restore(id: string): Promise<void> {
    const h = historyById.get(id)
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
    const h = historyById.get(id)
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

  async function sendToImg2Img(id: string): Promise<void> {
    const h = historyById.get(id)
    if (!h) return
    const dataUrl = await api.storage.readHistoryImage(id)
    if (!dataUrl) {
      toast.error(tStatic('history.imageMissing'))
      return
    }
    await restore(id)
    setInputImage(dataUrl, `history-${new Date(h.createdAt).toISOString().slice(0, 10)}.png`, null, id)
    setCurrentTab('img2img')
    toast.success(tStatic('history.sentToImg2Img'))
  }

  async function previewCandidate(id: string): Promise<void> {
    const h = historyById.get(id)
    if (!h) return
    const dataUrl = await api.storage.readHistoryImage(id)
    if (!dataUrl) {
      toast.error(tStatic('history.imageMissing'))
      return
    }
    setLastImage(dataUrl, id)
    toast.success(tStatic('history.previewed'))
  }

  function replaceHistoryItem(updated: HistoryItem): void {
    const latest = useStore.getState().history
    setHistory(latest.map((item) => item.id === updated.id ? updated : item))
  }

  async function applyCandidateVariant(id: string, action: CandidateBoardVariantAction): Promise<void> {
    const h = historyById.get(id)
    if (!h) return
    const stripped = stripLoraTokens(h.prompt)
    const baseActiveLoras = h.params.activeLoras ?? stripped.loras.map((l) => ({
      name: l.name,
      weight: l.weight,
      triggerWords: []
    }))
    let seed = h.params.seed
    let cfgScale = h.params.cfgScale
    let activeLoras = baseActiveLoras
    let labelKey = 'history.candidateVariantSeedNext'

    if (action === 'seedNext') {
      seed = h.params.seed >= 0 ? h.params.seed + 1 : -1
      labelKey = 'history.candidateVariantSeedNext'
    } else if (action === 'cfgDown') {
      cfgScale = clampCandidateCfg(h.params.cfgScale - 0.5)
      labelKey = 'history.candidateVariantCfgDown'
    } else if (action === 'cfgUp') {
      cfgScale = clampCandidateCfg(h.params.cfgScale + 0.5)
      labelKey = 'history.candidateVariantCfgUp'
    } else {
      if (baseActiveLoras.length === 0) {
        toast(tStatic('history.candidateVariantNoLora'), { icon: '!' })
        return
      }
      const delta = action === 'loraDown' ? -0.05 : 0.05
      activeLoras = baseActiveLoras.map((lora) => ({
        ...lora,
        weight: clampCandidateLoraWeight(lora.weight + delta)
      }))
      labelKey = action === 'loraDown' ? 'history.candidateVariantLoraDown' : 'history.candidateVariantLoraUp'
    }

    setPrompt(stripped.prompt)
    setNeg(h.negativePrompt)
    patch({
      steps: h.params.steps,
      cfgScale,
      width: h.params.width,
      height: h.params.height,
      sampler: h.params.sampler,
      scheduler: h.params.scheduler ?? '',
      seed,
      clipSkip: h.params.clipSkip ?? 1,
      denoisingStrength: h.params.denoisingStrength ?? 0.65
    })
    setSelectedModel(h.params.model)
    setSelectedVae(h.params.vae ?? 'Automatic')
    setActiveLoras(activeLoras)
    const dataUrl = await api.storage.readHistoryImage(id).catch(() => null)
    setLastImage(dataUrl ?? h.thumbDataUrl, dataUrl ? id : null)
    setCurrentTab('txt2img')
    toast.success(tStatic('history.candidateVariantApplied', { variant: tStatic(labelKey) }))
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
    const current = useStore.getState().history.find((x) => x.id === id)
    if (!current) return
    const nextLabel = current.label === label ? null : label
    const updated = await api.storage.setHistoryLabel(id, nextLabel)
    if (!updated) return
    replaceHistoryItem(updated)
  }

  async function openTagReview(id: string): Promise<void> {
    const item = historyById.get(id)
    if (!item) return
    setReviewingId(id)
    setReviewResult(null)
    setReviewCandidateQuery('')
    setAcceptedText((item.tagReview?.acceptedTags ?? []).join(', '))
    setRejectedText((item.tagReview?.rejectedTags ?? []).join(', '))
    const image = await api.storage.readHistoryImage(id).catch(() => null)
    setReviewImage(image ?? item.thumbDataUrl)
  }

  function openProRecipeReview(id: string): void {
    const item = historyById.get(id)
    if (!item) return
    const review = item.proRecipeReview
    setProReviewingId(id)
    setProRatingText(review?.rating == null ? '' : String(review.rating))
    setProStrengthsText((review?.strengths ?? []).join('\n'))
    setProIssuesText((review?.issues ?? []).join('\n'))
    setProNextActionsText((review?.nextActions ?? []).join('\n'))
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
    replaceHistoryItem(updated)
    toast.success(tStatic('history.reviewSaved', { count: review.acceptedTags.length }))
  }

  async function saveProRecipeReview(): Promise<void> {
    if (!proReviewingItem) return
    const rating = parseProRecipeRating(proRatingText)
    const review: HistoryProRecipeReview = {
      ...(rating == null ? {} : { rating }),
      strengths: parseProRecipeLines(proStrengthsText),
      issues: parseProRecipeLines(proIssuesText),
      nextActions: parseProRecipeLines(proNextActionsText),
      updatedAt: Date.now()
    }
    const updated = await api.storage.setHistoryProRecipeReview(proReviewingItem.id, review)
    if (!updated) return
    replaceHistoryItem(updated)
    toast.success(tStatic('history.proRecipeSaved'))
  }

  async function clearProRecipeReview(): Promise<void> {
    if (!proReviewingItem) return
    const updated = await api.storage.setHistoryProRecipeReview(proReviewingItem.id, null)
    if (!updated) return
    replaceHistoryItem(updated)
    setProRatingText('')
    setProStrengthsText('')
    setProIssuesText('')
    setProNextActionsText('')
    toast.success(tStatic('history.proRecipeCleared'))
  }

  async function saveCandidateBoardReview(id: string, review: HistoryProRecipeReview): Promise<void> {
    const updated = await api.storage.setHistoryProRecipeReview(id, review)
    if (!updated) return
    replaceHistoryItem(updated)
    toast.success(tStatic('history.candidateBoardReviewSaved'))
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

  if (view === 'candidate') {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b border-line p-2">
          <div className="flex items-center gap-1.5">
            <GitCompare className="h-3.5 w-3.5 text-accent" />
            <span className="text-[11px] font-semibold text-ink-1">{t('history.candidateBoardTitle')}</span>
            <span className="ml-auto rounded bg-bg-3 px-1.5 py-0.5 text-[10px] font-mono text-ink-3">
              {candidateBoard
                ? t('history.candidateBoardMeta', {
                  count: candidateBoard.items.length,
                  batchSize: candidateBoard.batchSize,
                  imageCount: candidateBoard.imageCount
                })
                : t('history.candidateBoardSource')}
            </span>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2" data-testid="candidate-board-scroll">
          {loading ? (
            <div className="p-4 text-sm text-ink-3 text-center">{t('common.loading')}</div>
          ) : history.length === 0 ? (
            <div className="p-4 text-sm text-ink-3 text-center">{t('history.empty')}</div>
          ) : candidateBoard ? (
            <CandidateBoard
              group={candidateBoard}
              layout="standalone"
              onPreview={(id) => { void previewCandidate(id) }}
              onLabel={(id, label) => { void setItemLabel(id, label) }}
              onRestore={(id) => { void restore(id) }}
              onImg2Img={(id) => { void sendToImg2Img(id) }}
              onUpscale={(id) => { void sendToUpscale(id) }}
              onProRecipe={openProRecipeReview}
              onSaveReview={(id, review) => { void saveCandidateBoardReview(id, review) }}
              onVariant={(id, action) => { void applyCandidateVariant(id, action) }}
            />
          ) : (
            <div className="rounded-md border border-line bg-bg-2/60 p-4 text-center text-xs text-ink-3" data-testid="candidate-board-empty">
              {t('history.candidateBoardEmpty')}
            </div>
          )}
          {proReviewingItem && (
            <div className="mt-2">
              <ProRecipeReviewPanel
                item={proReviewingItem}
                ratingText={proRatingText}
                strengthsText={proStrengthsText}
                issuesText={proIssuesText}
                nextActionsText={proNextActionsText}
                onClose={() => setProReviewingId(null)}
                onRatingChange={setProRatingText}
                onStrengthsChange={setProStrengthsText}
                onIssuesChange={setProIssuesText}
                onNextActionsChange={setProNextActionsText}
                onSave={() => { void saveProRecipeReview() }}
                onClear={() => { void clearProRecipeReview() }}
              />
            </div>
          )}
        </div>
      </div>
    )
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
        <div className="grid grid-cols-5 gap-1">
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
          <HistorySelect
            value={ratingFilter}
            onChange={(value) => setRatingFilter(value as HistoryRatingFilter)}
            options={RATING_FILTER_OPTIONS.filter((option) => option.id !== 'all').map((option) => option.id)}
            allLabel={t('history.filterRating')}
            getLabel={(value) => t(RATING_FILTER_OPTIONS.find((option) => option.id === value)?.labelKey ?? 'history.filterRating')}
            testId="history-filter-rating"
          />
        </div>
        <div className="flex gap-1 overflow-x-auto pb-0.5" data-testid="history-quick-filters">
          {QUICK_FILTER_OPTIONS.map((option) => (
            <button
              key={option.id}
              className={cn(
                'shrink-0 rounded border px-1.5 py-0.5 text-[10px]',
                quickFilter === option.id
                  ? 'border-accent bg-accent-dim/40 text-ink-0'
                  : 'border-line text-ink-2 hover:bg-bg-3'
              )}
              onClick={() => setQuickFilter(option.id)}
              data-testid={`history-quick-${option.id}`}
            >
              {t(option.labelKey)}
            </button>
          ))}
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
        {experimentGroups.length > 0 && (
          <HistoryExperimentGroups
            groups={experimentGroups}
            onRestore={(id) => { void restore(id) }}
            onCompare={(ids) => setCompareIds(ids.slice(0, 2))}
          />
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
                  data-prompt-dictionary-autocomplete="tag-blacklist"
                  data-testid="history-review-blacklist"
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
                  data-prompt-dictionary-autocomplete="review-accepted"
                  data-testid="history-review-accepted"
                />
              </label>
              <label>
                <span className="text-ink-3">{t('history.reviewRejected')}</span>
                <textarea
                  className="input mt-1 min-h-16 text-[10px] font-mono"
                  value={rejectedText}
                  onChange={(e) => setRejectedText(e.target.value)}
                  data-prompt-dictionary-autocomplete="review-rejected"
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
                  data-prompt-dictionary-autocomplete="tag-search"
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
        {proReviewingItem && (
          <div className="rounded-md border border-line bg-bg-2/60 p-2 text-[10px] space-y-2" data-testid="history-pro-recipe-review">
            <div className="flex items-center gap-1.5">
              <ClipboardCheck className="h-3.5 w-3.5 text-accent" />
              <span className="font-semibold text-ink-1">{t('history.proRecipeTitle')}</span>
              <span className="font-mono text-ink-3 truncate">{new Date(proReviewingItem.createdAt).toLocaleDateString()}</span>
              <button
                className="ml-auto text-ink-3 hover:text-ink-1"
                onClick={() => setProReviewingId(null)}
              >
                {t('common.close')}
              </button>
            </div>
            {proReviewingItem.proRecipeReview && (
              <div className="rounded border border-line bg-bg-1/70 px-2 py-1 text-ink-3" data-testid="history-pro-recipe-saved-summary">
                {t('history.proRecipeSavedSummary', {
                  date: new Date(proReviewingItem.proRecipeReview.updatedAt).toLocaleDateString()
                })}
              </div>
            )}
            <div className="grid grid-cols-[72px_1fr] items-center gap-2" data-testid="history-pro-recipe-rating">
              <span className="text-ink-3">{t('history.proRecipeRating')}</span>
              <div className="grid grid-cols-5 gap-1">
                {PRO_RECIPE_RATING_OPTIONS.map((rating) => {
                  const active = proRatingText === String(rating)
                  return (
                    <button
                      key={rating}
                      type="button"
                      className={cn(
                        'h-7 rounded border text-[11px] font-mono transition-colors',
                        active
                          ? 'border-accent bg-accent-dim/50 text-ink-0'
                          : 'border-line bg-bg-1 text-ink-2 hover:bg-bg-3'
                      )}
                      aria-pressed={active}
                      onClick={() => setProRatingText(active ? '' : String(rating))}
                      data-testid={`history-pro-recipe-rating-${rating}`}
                    >
                      {rating}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2">
              <label>
                <span className="text-ink-3">{t('history.proRecipeStrengths')}</span>
                <textarea
                  className="input mt-1 min-h-16 text-[10px]"
                  value={proStrengthsText}
                  onChange={(e) => setProStrengthsText(e.target.value)}
                  placeholder={t('history.proRecipeStrengthsPlaceholder')}
                  data-testid="history-pro-recipe-strengths"
                />
              </label>
              <label>
                <span className="text-ink-3">{t('history.proRecipeIssues')}</span>
                <textarea
                  className="input mt-1 min-h-16 text-[10px]"
                  value={proIssuesText}
                  onChange={(e) => setProIssuesText(e.target.value)}
                  placeholder={t('history.proRecipeIssuesPlaceholder')}
                  data-testid="history-pro-recipe-issues"
                />
              </label>
              <label>
                <span className="text-ink-3">{t('history.proRecipeNextActions')}</span>
                <textarea
                  className="input mt-1 min-h-16 text-[10px]"
                  value={proNextActionsText}
                  onChange={(e) => setProNextActionsText(e.target.value)}
                  placeholder={t('history.proRecipeNextActionsPlaceholder')}
                  data-testid="history-pro-recipe-next-actions"
                />
              </label>
            </div>
            <div className="flex gap-1.5">
              <button
                className="btn btn-primary flex-1 justify-center gap-1"
                onClick={() => { void saveProRecipeReview() }}
                data-testid="history-pro-recipe-save"
              >
                <Save className="h-3 w-3" />
                {t('common.save')}
              </button>
              <button
                className="btn justify-center gap-1"
                onClick={() => { void clearProRecipeReview() }}
                data-testid="history-pro-recipe-clear"
              >
                <XCircle className="h-3 w-3" />
                {t('history.proRecipeClear')}
              </button>
            </div>
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
              {visibleItems.map((h) => {
                const reviewNote = historyReviewListNote(h)
                return (
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
                  {h.proRecipeReview ? (
                    <span className="absolute top-8 left-12 z-10 inline-flex items-center gap-1 rounded bg-bg-2/90 px-1.5 py-1 text-[10px] text-accent backdrop-blur">
                      <ClipboardCheck className="h-3 w-3" />
                      {h.proRecipeReview.rating == null ? t('history.proRecipeShort') : h.proRecipeReview.rating}
                    </span>
                  ) : null}
                  {h.dynamicPrompt && (
                    <div className="absolute top-8 right-1 z-10 flex flex-col items-end gap-1">
                      <span className="inline-flex items-center gap-1 rounded bg-bg-2/90 px-1.5 py-1 text-[10px] text-accent backdrop-blur" title={`prompt seed ${h.dynamicPrompt.promptSeed}`}>
                        <Braces className="h-3 w-3" />
                        {h.dynamicPrompt.usedWildcards.length || 1}
                      </span>
                    </div>
                  )}
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
                      onClick={() => openProRecipeReview(h.id)}
                      title={t('history.proRecipeOpen')}
                      data-testid="history-pro-recipe-open"
                    >
                      <ClipboardCheck className="h-3 w-3" />
                    </button>
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
                      onClick={() => { void sendToImg2Img(h.id) }}
                      title={t('history.sendToImg2Img')}
                    >
                      <ImagePlus className="h-3 w-3" />
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
                  <div className="absolute bottom-0 inset-x-0 space-y-0.5 px-1.5 py-1 bg-gradient-to-t from-black/90 to-transparent text-[10px] text-ink-1">
                    {reviewNote && (
                      <div className="truncate font-sans text-ink-0" title={reviewNote} data-testid="history-card-review-note">
                        {reviewNote}
                      </div>
                    )}
                    <div className="truncate font-mono text-ink-2">
                      {h.params.width}×{h.params.height} · {h.params.sampler}
                    </div>
                  </div>
                </div>
                )
              })}
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
  getLabel,
  testId
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
  allLabel: string
  getLabel?: (v: string) => string
  testId?: string
}): JSX.Element {
  return (
    <select className="input text-[10px] py-1 px-1" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
      <option value="all">{allLabel}</option>
      {options.slice(0, 80).map((option) => (
        <option key={option} value={option}>{getLabel ? getLabel(option) : option}</option>
      ))}
    </select>
  )
}

function ProRecipeReviewPanel({
  item,
  ratingText,
  strengthsText,
  issuesText,
  nextActionsText,
  onClose,
  onRatingChange,
  onStrengthsChange,
  onIssuesChange,
  onNextActionsChange,
  onSave,
  onClear
}: {
  item: HistoryItem
  ratingText: string
  strengthsText: string
  issuesText: string
  nextActionsText: string
  onClose(): void
  onRatingChange(value: string): void
  onStrengthsChange(value: string): void
  onIssuesChange(value: string): void
  onNextActionsChange(value: string): void
  onSave(): void
  onClear(): void
}): JSX.Element {
  const t = useT()
  return (
    <div className="rounded-md border border-line bg-bg-2/60 p-2 text-[10px] space-y-2" data-testid="history-pro-recipe-review">
      <div className="flex items-center gap-1.5">
        <ClipboardCheck className="h-3.5 w-3.5 text-accent" />
        <span className="font-semibold text-ink-1">{t('history.proRecipeTitle')}</span>
        <span className="font-mono text-ink-3 truncate">{new Date(item.createdAt).toLocaleDateString()}</span>
        <button
          className="ml-auto text-ink-3 hover:text-ink-1"
          onClick={onClose}
        >
          {t('common.close')}
        </button>
      </div>
      {item.proRecipeReview && (
        <div className="rounded border border-line bg-bg-1/70 px-2 py-1 text-ink-3" data-testid="history-pro-recipe-saved-summary">
          {t('history.proRecipeSavedSummary', {
            date: new Date(item.proRecipeReview.updatedAt).toLocaleDateString()
          })}
        </div>
      )}
      <div className="grid grid-cols-[72px_1fr] items-center gap-2" data-testid="history-pro-recipe-rating">
        <span className="text-ink-3">{t('history.proRecipeRating')}</span>
        <div className="grid grid-cols-5 gap-1">
          {PRO_RECIPE_RATING_OPTIONS.map((rating) => {
            const active = ratingText === String(rating)
            return (
              <button
                key={rating}
                type="button"
                className={cn(
                  'h-7 rounded border text-[11px] font-mono transition-colors',
                  active
                    ? 'border-accent bg-accent-dim/50 text-ink-0'
                    : 'border-line bg-bg-1 text-ink-2 hover:bg-bg-3'
                )}
                aria-pressed={active}
                onClick={() => onRatingChange(active ? '' : String(rating))}
                data-testid={`history-pro-recipe-rating-${rating}`}
              >
                {rating}
              </button>
            )
          })}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2">
        <label>
          <span className="text-ink-3">{t('history.proRecipeStrengths')}</span>
          <textarea
            className="input mt-1 min-h-16 text-[10px]"
            value={strengthsText}
            onChange={(e) => onStrengthsChange(e.target.value)}
            placeholder={t('history.proRecipeStrengthsPlaceholder')}
            data-testid="history-pro-recipe-strengths"
          />
        </label>
        <label>
          <span className="text-ink-3">{t('history.proRecipeIssues')}</span>
          <textarea
            className="input mt-1 min-h-16 text-[10px]"
            value={issuesText}
            onChange={(e) => onIssuesChange(e.target.value)}
            placeholder={t('history.proRecipeIssuesPlaceholder')}
            data-testid="history-pro-recipe-issues"
          />
        </label>
        <label>
          <span className="text-ink-3">{t('history.proRecipeNextActions')}</span>
          <textarea
            className="input mt-1 min-h-16 text-[10px]"
            value={nextActionsText}
            onChange={(e) => onNextActionsChange(e.target.value)}
            placeholder={t('history.proRecipeNextActionsPlaceholder')}
            data-testid="history-pro-recipe-next-actions"
          />
        </label>
      </div>
      <div className="flex gap-1.5">
        <button
          className="btn btn-primary flex-1 justify-center gap-1"
          onClick={onSave}
          data-testid="history-pro-recipe-save"
        >
          <Save className="h-3 w-3" />
          {t('common.save')}
        </button>
        <button
          className="btn justify-center gap-1"
          onClick={onClear}
          data-testid="history-pro-recipe-clear"
        >
          <XCircle className="h-3 w-3" />
          {t('history.proRecipeClear')}
        </button>
      </div>
    </div>
  )
}

function HistoryExperimentGroups({
  groups,
  onRestore,
  onCompare
}: {
  groups: HistoryExperimentGroup[]
  onRestore(id: string): void
  onCompare(ids: string[]): void
}): JSX.Element {
  const t = useT()
  return (
    <section className="rounded-md border border-line bg-bg-2/60 p-2 space-y-2" data-testid="history-experiment-groups">
      <div className="flex items-center gap-1.5">
        <GitCompare className="h-3.5 w-3.5 text-accent" />
        <span className="text-[11px] font-semibold text-ink-1">{t('history.experimentTitle')}</span>
        <span className="ml-auto text-[10px] text-ink-3">{t('history.experimentHint')}</span>
      </div>
      <div className="grid gap-1.5">
        {groups.map((group) => (
          <div key={group.fingerprint} className="rounded border border-line/80 bg-bg-1/70 p-1.5">
            <div className="mb-1 flex items-center gap-1.5">
              <div className="min-w-0 flex-1 truncate text-[10px] font-mono text-ink-2" title={group.keyTags.join(', ')}>
                {group.keyTags.join(', ')}
              </div>
              <span className="shrink-0 rounded bg-bg-3 px-1.5 py-0.5 text-[10px] text-ink-3">
                {t('history.experimentMeta', {
                  count: group.items.length,
                  models: group.modelCount,
                  loras: group.loraStateCount,
                  seeds: group.seedCount
                })}
              </span>
              <button
                type="button"
                className="btn px-1.5 py-0.5 text-[10px]"
                onClick={() => onCompare(group.items.slice(0, 2).map((item) => item.id))}
                disabled={group.items.length < 2}
                title={t('history.experimentCompare')}
              >
                {t('history.experimentCompareShort')}
              </button>
            </div>
            <div className="flex gap-1 overflow-x-auto">
              {group.items.slice(0, 8).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="relative h-12 w-12 shrink-0 overflow-hidden rounded border border-line bg-bg-3"
                  onClick={() => onRestore(item.id)}
                  title={new Date(item.createdAt).toLocaleString()}
                >
                  <img src={item.thumbDataUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                  <span className="absolute bottom-0 inset-x-0 bg-black/70 px-0.5 text-[8px] font-mono text-ink-1">
                    {item.params.seed >= 0 ? String(item.params.seed).slice(-4) : 'rand'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

interface CandidateBoardGroup {
  key: string
  items: HistoryItem[]
  batchSize: number
  imageCount: number
  createdAt: number
}

function CandidateBoard({
  group,
  layout = 'panel',
  onPreview,
  onLabel,
  onRestore,
  onImg2Img,
  onUpscale,
  onProRecipe,
  onSaveReview,
  onVariant
}: {
  group: CandidateBoardGroup
  layout?: 'panel' | 'standalone'
  onPreview(id: string): void
  onLabel(id: string, label: HistoryLabel): void
  onRestore(id: string): void
  onImg2Img(id: string): void
  onUpscale(id: string): void
  onProRecipe(id: string): void
  onSaveReview(id: string, review: HistoryProRecipeReview): void
  onVariant(id: string, action: CandidateBoardVariantAction): void
}): JSX.Element {
  const t = useT()
  const items = group.items.slice(0, CANDIDATE_BOARD_LIMIT)
  const [selectedId, setSelectedId] = useState(() => pickInitialCandidateBoardItem(items)?.id ?? null)
  const [showRejected, setShowRejected] = useState(true)
  const [adoptionText, setAdoptionText] = useState('')
  const [failureText, setFailureText] = useState('')
  const [nextActionText, setNextActionText] = useState('')
  useEffect(() => {
    const next = pickInitialCandidateBoardItem(items)
    setSelectedId(next?.id ?? null)
    setShowRejected(true)
  }, [group.key])
  const selectedItem = items.find((item) => item.id === selectedId) ?? pickInitialCandidateBoardItem(items)
  const selectedIndex = selectedItem
    ? items.findIndex((item) => item.id === selectedItem.id)
    : -1
  const visibleItems = showRejected ? items : items.filter((item) => item.label !== 'rejected')
  const counts = countCandidateBoardLabels(items)
  const selectedNote = selectedItem ? candidateBoardReviewNote(selectedItem) : ''
  const labelOptions = LABEL_OPTIONS
  useEffect(() => {
    const review = selectedItem?.proRecipeReview
    setAdoptionText((review?.strengths ?? []).join('\n'))
    setFailureText((review?.issues ?? []).join('\n'))
    setNextActionText((review?.nextActions ?? []).join('\n'))
  }, [selectedItem?.id, selectedItem?.proRecipeReview])
  function selectAndPreview(id: string): void {
    setSelectedId(id)
    onPreview(id)
  }
  function labelCandidate(id: string, label: HistoryLabel): void {
    setSelectedId(id)
    onLabel(id, label)
  }
  function saveSelectedReview(): void {
    if (!selectedItem) return
    const previous = selectedItem.proRecipeReview
    onSaveReview(selectedItem.id, {
      ...(previous ?? {}),
      strengths: parseProRecipeLines(adoptionText),
      issues: parseProRecipeLines(failureText),
      nextActions: parseProRecipeLines(nextActionText),
      updatedAt: Date.now()
    })
  }
  return (
    <section
      className={cn(
        'rounded-md border border-accent/30 bg-bg-2/70 p-2 space-y-2',
        layout === 'standalone' && 'bg-bg-1/80'
      )}
      data-testid="candidate-board"
      data-batch-size={group.batchSize}
      data-image-count={group.imageCount}
      data-candidate-count={group.items.length}
    >
      <div className="flex items-center gap-1.5">
        <GitCompare className="h-3.5 w-3.5 text-accent" />
        <span className="text-[11px] font-semibold text-ink-1">{t('history.candidateBoardTitle')}</span>
        <span className="ml-auto rounded bg-bg-3 px-1.5 py-0.5 text-[10px] font-mono text-ink-3">
          {t('history.candidateBoardMeta', {
            count: group.items.length,
            batchSize: group.batchSize,
            imageCount: group.imageCount
          })}
        </span>
      </div>
      <div className="text-[10px] text-ink-3">{t('history.candidateBoardHint')}</div>
      <div className="flex flex-wrap items-center gap-1 text-[10px]" data-testid="candidate-board-stats">
        {LABEL_OPTIONS.map((option) => (
          <span key={option.id} className="rounded border border-line bg-bg-1 px-1.5 py-0.5 text-ink-2">
            {t(option.labelKey)} {counts[option.id]}
          </span>
        ))}
        <span className="rounded border border-line bg-bg-1 px-1.5 py-0.5 text-ink-3">
          {t('history.label.none')} {counts.none}
        </span>
        <button
          type="button"
          className="btn btn-ghost ml-auto h-6 px-2 text-[10px]"
          disabled={counts.rejected === 0}
          onClick={() => setShowRejected((value) => !value)}
          data-testid="candidate-board-toggle-rejected"
        >
          {showRejected ? t('history.candidateBoardHideRejected') : t('history.candidateBoardShowRejected')}
        </button>
      </div>
      {selectedItem && (
        <div
          className="rounded-md border border-accent/35 bg-bg-1/80 p-2 space-y-2"
          data-testid="candidate-board-selected"
          data-selected-id={selectedItem.id}
        >
          <div className="flex items-start gap-2">
            <button
              type="button"
              className="relative h-20 w-14 shrink-0 overflow-hidden rounded border border-line bg-bg-3 outline-none hover:ring-2 hover:ring-accent"
              onClick={() => selectAndPreview(selectedItem.id)}
              data-testid="candidate-board-selected-preview"
            >
              <img src={selectedItem.thumbDataUrl} alt="" className="h-full w-full object-contain" />
              <span className="absolute left-1 top-1 rounded bg-black/75 px-1 py-0.5 text-[8px] font-mono text-ink-0">
                #{selectedIndex + 1}
              </span>
            </button>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-1">
                <span className="text-[11px] font-semibold text-ink-1">{t('history.candidateBoardSelected')}</span>
                {selectedItem.label && <HistoryLabelBadge label={selectedItem.label} />}
              </div>
              <div className="grid grid-cols-2 gap-1 text-[9px] text-ink-3">
                <span className="truncate rounded border border-line bg-bg-2 px-1.5 py-0.5 font-mono" data-testid="candidate-board-selected-seed">
                  {t('history.candidateBoardSeed', { seed: selectedItem.params.seed >= 0 ? selectedItem.params.seed : 'random' })}
                </span>
                <span className="truncate rounded border border-line bg-bg-2 px-1.5 py-0.5 font-mono">
                  {selectedItem.params.steps} steps / CFG {selectedItem.params.cfgScale}
                </span>
                <span className="truncate rounded border border-line bg-bg-2 px-1.5 py-0.5 font-mono">
                  {selectedItem.params.width}×{selectedItem.params.height}
                </span>
                <span className="truncate rounded border border-line bg-bg-2 px-1.5 py-0.5" title={selectedItem.params.model ?? ''}>
                  {shortModelName(selectedItem.params.model)}
                </span>
              </div>
              {selectedNote && (
                <div className="line-clamp-2 rounded border border-line bg-bg-2/70 px-1.5 py-1 text-[10px] text-ink-2" data-testid="candidate-board-selected-note">
                  {selectedNote}
                </div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {labelOptions.map((option) => {
              const Icon = option.icon
              const active = selectedItem.label === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  className={cn(
                    'btn h-7 justify-center gap-1 px-1 text-[10px]',
                    active && 'btn-primary'
                  )}
                  aria-pressed={active}
                  onClick={() => labelCandidate(selectedItem.id, option.id)}
                  data-testid={`candidate-board-selected-label-${option.id}`}
                >
                  <Icon className={cn('h-3 w-3', option.className)} />
                  <span className="truncate">{t(option.labelKey)}</span>
                </button>
              )
            })}
          </div>
          <div className="rounded border border-line bg-bg-2/60 p-1.5" data-testid="candidate-board-variants">
            <div className="mb-1 text-[10px] font-semibold text-ink-2">{t('history.candidateVariantTitle')}</div>
            <div className="grid grid-cols-5 gap-1">
              <button
                type="button"
                className="btn h-7 justify-center px-1 text-[10px]"
                onClick={() => onVariant(selectedItem.id, 'seedNext')}
                data-testid="candidate-board-variant-seed-next"
                title={t('history.candidateVariantSeedNextHint')}
              >
                {t('history.candidateVariantSeedNext')}
              </button>
              <button
                type="button"
                className="btn h-7 justify-center px-1 text-[10px]"
                onClick={() => onVariant(selectedItem.id, 'cfgDown')}
                data-testid="candidate-board-variant-cfg-down"
                title={t('history.candidateVariantCfgHint')}
              >
                {t('history.candidateVariantCfgDown')}
              </button>
              <button
                type="button"
                className="btn h-7 justify-center px-1 text-[10px]"
                onClick={() => onVariant(selectedItem.id, 'cfgUp')}
                data-testid="candidate-board-variant-cfg-up"
                title={t('history.candidateVariantCfgHint')}
              >
                {t('history.candidateVariantCfgUp')}
              </button>
              <button
                type="button"
                className="btn h-7 justify-center px-1 text-[10px]"
                disabled={!historyItemHasLora(selectedItem)}
                onClick={() => onVariant(selectedItem.id, 'loraDown')}
                data-testid="candidate-board-variant-lora-down"
                title={t('history.candidateVariantLoraHint')}
              >
                {t('history.candidateVariantLoraDown')}
              </button>
              <button
                type="button"
                className="btn h-7 justify-center px-1 text-[10px]"
                disabled={!historyItemHasLora(selectedItem)}
                onClick={() => onVariant(selectedItem.id, 'loraUp')}
                data-testid="candidate-board-variant-lora-up"
                title={t('history.candidateVariantLoraHint')}
              >
                {t('history.candidateVariantLoraUp')}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-1.5" data-testid="candidate-board-review-editor">
            <label className="space-y-0.5">
              <span className="text-[10px] text-ink-3">{t('history.candidateBoardAdoptionReason')}</span>
              <textarea
                className="input min-h-10 text-[10px]"
                value={adoptionText}
                onChange={(event) => setAdoptionText(event.target.value)}
                placeholder={t('history.candidateBoardAdoptionPlaceholder')}
                data-testid="candidate-board-review-adoption"
              />
            </label>
            <label className="space-y-0.5">
              <span className="text-[10px] text-ink-3">{t('history.candidateBoardFailureReason')}</span>
              <textarea
                className="input min-h-10 text-[10px]"
                value={failureText}
                onChange={(event) => setFailureText(event.target.value)}
                placeholder={t('history.candidateBoardFailurePlaceholder')}
                data-testid="candidate-board-review-failure"
              />
            </label>
            <div className="grid grid-cols-[1fr_auto] gap-1.5">
              <input
                className="input py-1 text-[10px]"
                value={nextActionText}
                onChange={(event) => setNextActionText(event.target.value)}
                placeholder={t('history.candidateBoardNextActionPlaceholder')}
                data-testid="candidate-board-review-next"
              />
              <button
                type="button"
                className="btn h-7 justify-center gap-1 px-2 text-[10px]"
                onClick={saveSelectedReview}
                data-testid="candidate-board-review-save"
              >
                <Save className="h-3 w-3" />
                {t('common.save')}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              className="btn h-7 justify-center gap-1 px-1 text-[10px]"
              onClick={() => onRestore(selectedItem.id)}
              data-testid="candidate-board-selected-restore"
            >
              <RotateCcw className="h-3 w-3" />
              {t('history.restore')}
            </button>
            <button
              type="button"
              className="btn h-7 justify-center gap-1 px-1 text-[10px]"
              onClick={() => onImg2Img(selectedItem.id)}
              data-testid="candidate-board-selected-img2img"
            >
              <ImagePlus className="h-3 w-3" />
              img2img
            </button>
            <button
              type="button"
              className="btn h-7 justify-center gap-1 px-1 text-[10px]"
              onClick={() => onUpscale(selectedItem.id)}
              data-testid="candidate-board-selected-upscale"
            >
              <ImageUpscale className="h-3 w-3" />
              Upscale
            </button>
            <button
              type="button"
              className="btn h-7 justify-center gap-1 px-1 text-[10px]"
              onClick={() => onProRecipe(selectedItem.id)}
              data-testid="candidate-board-selected-pro-recipe"
            >
              <ClipboardCheck className="h-3 w-3" />
              Pro Recipe
            </button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-1.5" data-testid="candidate-board-grid">
        {visibleItems.map((item, index) => {
          const originalIndex = items.findIndex((candidate) => candidate.id === item.id)
          const imageIndex = item.params.imageIndex ?? originalIndex
          const active = selectedItem?.id === item.id
          return (
            <div
              key={item.id}
              className={cn(
                'rounded border bg-bg-1/80 p-1.5 space-y-1 transition-colors',
                active ? 'border-accent/70 ring-1 ring-accent/35' : 'border-line'
              )}
              data-testid={`candidate-board-item-${originalIndex}`}
              data-history-id={item.id}
              data-selected={active ? 'true' : 'false'}
            >
              <button
                type="button"
                className="relative block aspect-[3/4] w-full overflow-hidden rounded bg-bg-3 outline-none ring-accent/0 transition hover:ring-2 focus-visible:ring-2"
                onClick={() => selectAndPreview(item.id)}
                title={t('history.previewCandidate')}
                data-testid={`candidate-board-preview-${originalIndex}`}
              >
                <img src={item.thumbDataUrl} alt="" className="h-full w-full object-contain" loading="lazy" />
                <span
                  className="absolute left-1 top-1 rounded bg-black/75 px-1.5 py-0.5 text-[9px] font-mono text-ink-0"
                  data-testid={`candidate-board-index-${originalIndex}`}
                >
                  {t('history.candidateBoardIndex', { index: imageIndex + 1, total: group.imageCount })}
                </span>
                {item.label && <HistoryLabelBadge label={item.label} className="absolute right-1 top-1" />}
                {item.proRecipeReview?.rating != null && (
                  <span className="absolute bottom-1 right-1 rounded bg-bg-2/90 px-1.5 py-0.5 text-[9px] font-mono text-accent">
                    {item.proRecipeReview.rating}/5
                  </span>
                )}
              </button>
              <div className="flex items-center justify-between gap-1 text-[9px] font-mono text-ink-3">
                <span>{t('history.candidateBoardSeed', { seed: item.params.seed >= 0 ? item.params.seed : 'random' })}</span>
                <span>{item.params.width}×{item.params.height}</span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {labelOptions.map((option) => {
                  const Icon = option.icon
                  const active = item.label === option.id
                  return (
                    <button
                      key={option.id}
                      type="button"
                      className={cn(
                        'btn btn-icon h-6 w-full bg-bg-2/80',
                        active && 'btn-primary'
                      )}
                      aria-pressed={active}
                      onClick={() => labelCandidate(item.id, option.id)}
                      title={t(option.labelKey)}
                      data-testid={`candidate-board-label-${option.id}-${originalIndex}`}
                    >
                      <Icon className={cn('h-3 w-3', option.className)} />
                    </button>
                  )
                })}
              </div>
              <div className="grid grid-cols-3 gap-1">
                <button
                  type="button"
                  className="btn btn-icon h-6 w-full"
                  onClick={() => onImg2Img(item.id)}
                  title={t('history.sendToImg2Img')}
                  data-testid={`candidate-board-img2img-${originalIndex}`}
                >
                  <ImagePlus className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  className="btn btn-icon h-6 w-full"
                  onClick={() => onUpscale(item.id)}
                  title={t('history.sendToUpscale')}
                  data-testid={`candidate-board-upscale-${originalIndex}`}
                >
                  <ImageUpscale className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  className="btn btn-icon h-6 w-full"
                  onClick={() => onProRecipe(item.id)}
                  title={t('history.proRecipeOpen')}
                  data-testid={`candidate-board-pro-recipe-${originalIndex}`}
                >
                  <ClipboardCheck className="h-3 w-3" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function pickInitialCandidateBoardItem(items: HistoryItem[]): HistoryItem | null {
  return items.find((item) => item.label === 'favorite') ??
    items.find((item) => item.label === 'candidate') ??
    items.find((item) => item.proRecipeReview?.rating != null) ??
    items.find((item) => item.label !== 'rejected') ??
    items[0] ??
    null
}

function countCandidateBoardLabels(items: HistoryItem[]): Record<HistoryLabel | 'none', number> {
  const counts = LABEL_OPTIONS.reduce((acc, option) => {
    acc[option.id] = 0
    return acc
  }, { none: 0 } as Record<HistoryLabel | 'none', number>)
  for (const item of items) {
    if (item.label && item.label in counts) counts[item.label] += 1
    else counts.none += 1
  }
  return counts
}

function historyItemHasLora(item: HistoryItem): boolean {
  return (item.params.activeLoras?.length ?? 0) > 0 || /<lora:[^>]+>/i.test(item.prompt)
}

function clampCandidateCfg(value: number): number {
  return Math.max(1, Math.min(30, Number(value.toFixed(2))))
}

function clampCandidateLoraWeight(value: number): number {
  return Math.max(0, Math.min(2, Number(value.toFixed(2))))
}

function candidateBoardReviewNote(item: HistoryItem): string {
  const review = item.proRecipeReview
  if (!review) return ''
  return review.nextActions[0] ?? review.issues[0] ?? review.strengths[0] ?? ''
}

function historyReviewListNote(item: HistoryItem): string {
  const review = item.proRecipeReview
  if (!review) return ''
  return review.strengths[0] ?? review.nextActions[0] ?? review.issues[0] ?? ''
}

function matchesHistoryQuickFilter(item: HistoryItem, filter: HistoryQuickFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'success') {
    return item.label === 'favorite' ||
      item.label === 'candidate' ||
      (item.proRecipeReview?.rating ?? 0) >= 4
  }
  if (filter === 'favorite') return item.label === 'favorite'
  if (filter === 'rejected') return item.label === 'rejected'
  if (filter === 'asset') return item.label === 'asset'
  if (filter === 'social') return item.label === 'social'
  if (filter === 'reference') return item.label === 'reference'
  if (filter === 'proRecipe') return Boolean(item.proRecipeReview)
  return true
}

function matchesHistoryRatingFilter(item: HistoryItem, filter: HistoryRatingFilter): boolean {
  if (filter === 'all') return true
  const rating = item.proRecipeReview?.rating
  if (filter === 'unrated') return rating == null
  if (rating == null) return false
  if (filter === '5') return rating === 5
  if (filter === '4plus') return rating >= 4
  if (filter === '3plus') return rating >= 3
  return true
}

function historySearchText(item: HistoryItem): string {
  const loraText = (item.params.activeLoras ?? [])
    .flatMap((lora) => [
      lora.name,
      lora.tokenName,
      lora.sourceRoot,
      lora.adapterSubtype,
      ...(lora.triggerWords ?? [])
    ])
    .filter(Boolean)
    .join(' ')
  const tagReviewText = [
    ...(item.tagReview?.acceptedTags ?? []),
    ...(item.tagReview?.rejectedTags ?? [])
  ].join(' ')
  const labelText = item.label ? `label:${item.label} ${item.label} ${historyLabelSearchSynonyms(item.label)}` : ''
  const ratingText = item.proRecipeReview?.rating == null
    ? ''
    : `rating:${item.proRecipeReview.rating} ${item.proRecipeReview.rating}/5`
  return [
    item.prompt,
    item.negativePrompt,
    item.params.model ?? '',
    item.params.sampler,
    item.params.scheduler ?? '',
    loraText,
    tagReviewText,
    labelText,
    ratingText,
    proRecipeReviewSearchText(item.proRecipeReview)
  ].join(' ').toLowerCase()
}

function historyLabelSearchSynonyms(label: HistoryLabel): string {
  if (label === 'favorite') return 'favorite fav success お気に入り 成功'
  if (label === 'candidate') return 'candidate success 採用候補 成功'
  if (label === 'rejected') return 'rejected bad fail 没 失敗'
  if (label === 'asset') return 'asset material 素材 素材用'
  if (label === 'social') return 'social sns thumbnail post SNS向け 投稿用'
  if (label === 'reference') return 'reference pose color character 参考用 参照資料'
  return ''
}

function shortModelName(value: string | null | undefined): string {
  if (!value) return '-'
  const base = value.split(/[\\/]/).pop() ?? value
  return base.replace(/\.(safetensors|ckpt|pt|pth)$/i, '')
}

function buildCandidateBoardGroup(items: HistoryItem[]): CandidateBoardGroup | null {
  const groups = new Map<string, CandidateBoardGroup>()
  for (const item of items) {
    const imageCount = normalizeCandidateCount(item)
    const batchSize = normalizeCandidateBatchSize(item)
    if (imageCount < 2 && batchSize < 2) continue
    const key = [
      item.prompt.trim(),
      item.negativePrompt.trim(),
      item.params.model ?? '',
      item.params.width,
      item.params.height,
      item.params.sampler,
      item.params.scheduler ?? '',
      item.params.steps,
      item.params.cfgScale,
      item.params.imageCount ?? '',
      item.params.batchSize ?? '',
      item.params.iterationIndex ?? 0,
      Math.floor(item.createdAt / 60_000)
    ].join('\u001f')
    const current = groups.get(key)
    if (current) {
      current.items.push(item)
      current.batchSize = Math.max(current.batchSize, batchSize)
      current.imageCount = Math.max(current.imageCount, imageCount)
      current.createdAt = Math.max(current.createdAt, item.createdAt)
    } else {
      groups.set(key, {
        key,
        items: [item],
        batchSize,
        imageCount,
        createdAt: item.createdAt
      })
    }
  }
  const candidates = Array.from(groups.values())
    .filter((group) => group.items.length >= 2 || group.imageCount >= 2)
    .map((group) => ({
      ...group,
      items: [...group.items].sort((a, b) => {
        const aIndex = a.params.imageIndex ?? Number.MAX_SAFE_INTEGER
        const bIndex = b.params.imageIndex ?? Number.MAX_SAFE_INTEGER
        if (aIndex !== bIndex) return aIndex - bIndex
        return a.createdAt - b.createdAt
      })
    }))
    .sort((a, b) => b.createdAt - a.createdAt)
  return candidates[0] ?? null
}

function normalizeCandidateCount(item: HistoryItem): number {
  const imageCount = item.params.imageCount ?? item.params.batchSize ?? 1
  return Number.isFinite(imageCount) ? Math.max(1, imageCount) : 1
}

function normalizeCandidateBatchSize(item: HistoryItem): number {
  const batchSize = item.params.batchSize ?? item.params.imageCount ?? 1
  return Number.isFinite(batchSize) ? Math.max(1, batchSize) : 1
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
    removed: uniqueMissingTokens(a, bSet, 60),
    added: uniqueMissingTokens(b, aSet, 60)
  }
}

function uniqueMissingTokens(tokens: string[], otherSet: Set<string>, limit: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const token of tokens) {
    if (otherSet.has(token) || seen.has(token)) continue
    seen.add(token)
    out.push(token)
    if (out.length >= limit) break
  }
  return out
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

function parseProRecipeLines(value: string): string[] {
  const seen = new Set<string>()
  const items: string[] = []
  for (const raw of value.split(/[\n;]+/)) {
    const item = raw.trim().replace(/\s+/g, ' ')
    const key = item.toLowerCase()
    if (!item || seen.has(key)) continue
    seen.add(key)
    items.push(item)
    if (items.length >= 24) break
  }
  return items
}

function parseProRecipeRating(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, Math.min(5, Math.round(parsed)))
}

function proRecipeReviewSearchText(review: HistoryProRecipeReview | null | undefined): string {
  if (!review) return ''
  return [
    ...(review.strengths ?? []),
    ...(review.issues ?? []),
    ...(review.nextActions ?? [])
  ].join(' ').toLowerCase()
}
