import { useEffect, useMemo, useState } from 'react'
import {
  X,
  Search,
  ExternalLink,
  Download,
  Check,
  Loader2,
  AlertCircle,
  RefreshCcw,
  Filter as FilterIcon,
  ChevronDown,
  ChevronUp,
  Tag as TagIcon
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore } from '@/lib/store'
import { api } from '@/lib/ipc'
import { useT, t as tStatic } from '@/lib/i18n'
import { cn, formatBytes } from '@/lib/utils'
import type {
  CivitaiAssetType,
  CivitaiSearchItem,
  CivitaiSearchResult,
  CivitaiSearchVersion,
  HuggingFaceSearchItem
} from '@shared/types'

interface Props {
  open: boolean
  onClose(): void
  /** Initial type filter; if null, "All" is preselected. */
  initialType?: CivitaiAssetType | null
  /** Called when a download finishes successfully — caller refreshes lists. */
  onDownloaded?(asset: CivitaiAssetType, destPath: string): void
}

const TYPE_FILTERS: Array<{ id: CivitaiAssetType | 'all'; labelKey: string }> = [
  { id: 'all', labelKey: 'cs.typeAll' },
  { id: 'Checkpoint', labelKey: 'cs.typeCheckpoint' },
  { id: 'LORA', labelKey: 'cs.typeLora' },
  { id: 'VAE', labelKey: 'cs.typeVae' },
  { id: 'TextualInversion', labelKey: 'cs.typeEmbedding' },
  { id: 'Controlnet', labelKey: 'cs.typeControlnet' }
]

const SORT_OPTIONS = [
  { id: 'Most Downloaded', labelKey: 'cs.sortDownloads' },
  { id: 'Highest Rated', labelKey: 'cs.sortRated' },
  { id: 'Newest', labelKey: 'cs.sortNewest' }
] as const

type SearchProvider = 'civitai' | 'huggingface'

/**
 * Full-screen Civitai search dialog. Lets the user browse Civitai's catalog
 * filtered by type/sort/NSFW and download files directly into the right
 * Forge models/* folder.
 *
 * Why a full modal: search results are rich (thumbnail + name + tags + stats),
 * a popover would be too cramped. Modal also keeps focus on the task — the
 * user is browsing/downloading, not editing prompts.
 */
export function CivitaiSearchModal({
  open,
  onClose,
  initialType = null,
  onDownloaded
}: Props): JSX.Element | null {
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [type, setType] = useState<CivitaiAssetType | 'all'>(initialType ?? 'all')
  const [sort, setSort] = useState<(typeof SORT_OPTIONS)[number]['id']>('Most Downloaded')
  const [nsfw, setNsfw] = useState(false)
  // Two pagination states. Civitai accepts page-based when no `query` is
  // set; once a query is given the API requires cursor-based and we track
  // a stack so the user can step back through previously-fetched cursors.
  const [page, setPage] = useState(1)
  const [cursor, setCursor] = useState<string | null>(null)
  const [cursorHistory, setCursorHistory] = useState<(string | null)[]>([])
  const [results, setResults] = useState<CivitaiSearchResult | null>(null)
  const [hfResults, setHfResults] = useState<HuggingFaceSearchItem[]>([])
  const [provider, setProvider] = useState<SearchProvider>('civitai')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const usingCursor = !!submittedQuery.trim()
  const civitaiTags = useStore((s) => s.civitaiTags)
  const setCivitaiTags = useStore((s) => s.setCivitaiTags)
  const t = useT()

  // Reset filters when modal is opened with a different initial type.
  useEffect(() => {
    if (!open) return
    setType(initialType ?? 'all')
    setQuery('')
    setSubmittedQuery('')
    setPage(1)
    setCursor(null)
    setCursorHistory([])
    setResults(null)
    setHfResults([])
    setError(null)
  }, [open, initialType])

  useEffect(() => {
    if (!open || civitaiTags.length > 0) return
    let cancelled = false
    void api.civitai.listTags()
      .then((tags) => {
        if (!cancelled) setCivitaiTags(tags)
      })
      .catch((e) => console.warn('[civitai] tag list failed:', e))
    return () => {
      cancelled = true
    }
  }, [open, civitaiTags.length, setCivitaiTags])

  // Fire a search whenever any input changes. Switches to cursor pagination
  // automatically when there's a query (Civitai requires it for query-based
  // search; page-based returns 400).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const search = provider === 'civitai'
      ? api.civitai
          .search({
            query: submittedQuery || undefined,
            types: type === 'all' ? undefined : [type],
            sort,
            nsfw,
            limit: 20,
            page: usingCursor ? undefined : page,
            cursor: usingCursor ? cursor : undefined
          })
          .then((r) => {
            if (!cancelled) {
              setResults(r)
              setHfResults([])
            }
          })
      : api.huggingface
          .search({
            query: submittedQuery || undefined,
            assetTypes: type === 'all' ? undefined : [type],
            limit: 20
          })
          .then((r) => {
            if (!cancelled) {
              setHfResults(r.items)
              setResults(null)
            }
          })
    search
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, submittedQuery, type, sort, nsfw, page, cursor, usingCursor, provider])

  // Esc closes the modal.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  function submit(): void {
    setSubmittedQuery(query.trim())
    setPage(1)
    setCursor(null)
    setCursorHistory([])
  }

  function gotoNext(): void {
    if (usingCursor) {
      const next = results?.nextCursor ?? null
      if (next == null) return
      setCursorHistory((h) => [...h, cursor])
      setCursor(next)
    } else {
      setPage((p) => p + 1)
    }
  }

  function gotoPrev(): void {
    if (usingCursor) {
      if (cursorHistory.length === 0) return
      const prev = cursorHistory[cursorHistory.length - 1]
      setCursorHistory((h) => h.slice(0, -1))
      setCursor(prev)
    } else {
      setPage((p) => Math.max(1, p - 1))
    }
  }

  return (
    <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center p-6">
      <div
        className="card w-full max-w-5xl h-full max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 p-3 border-b border-line shrink-0">
          <Search className="h-4 w-4 text-accent" />
          <h2 className="text-base font-semibold">{t('cs.title')}</h2>
          <button className="ml-auto btn btn-icon btn-ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-3 py-2 border-b border-line shrink-0 space-y-2">
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-3" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                placeholder={t('cs.searchPlaceholder')}
                className="input pl-7"
                autoFocus
              />
            </div>
            <button className="btn btn-primary" onClick={submit}>{t('cs.search')}</button>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <FilterIcon className="h-3.5 w-3.5 text-ink-3" />
            {(['civitai', 'huggingface'] as SearchProvider[]).map((p) => (
              <button
                key={p}
                onClick={() => {
                  setProvider(p)
                  setPage(1)
                  setCursor(null)
                  setCursorHistory([])
                }}
                className={cn(
                  'text-[11px] px-2 py-0.5 rounded border',
                  provider === p
                    ? 'border-accent bg-accent-dim/40 text-ink-0'
                    : 'border-line text-ink-2 hover:bg-bg-3'
                )}
              >
                {p === 'civitai' ? 'Civitai' : 'Hugging Face'}
              </button>
            ))}
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => { setType(f.id); setPage(1) }}
                className={cn(
                  'text-[11px] px-2 py-0.5 rounded border',
                  type === f.id
                    ? 'border-accent bg-accent-dim/40 text-ink-0'
                    : 'border-line text-ink-2 hover:bg-bg-3'
                )}
              >
                {t(f.labelKey)}
              </button>
            ))}
            <select
              className="input text-xs ml-auto py-0.5 w-auto"
              value={sort}
              onChange={(e) => { setSort(e.target.value as typeof sort); setPage(1) }}
            >
              {SORT_OPTIONS.map((s) => (
                <option key={s.id} value={s.id}>{t(s.labelKey)}</option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-[11px] text-ink-2 cursor-pointer">
              <input
                type="checkbox"
                checked={nsfw}
                onChange={(e) => { setNsfw(e.target.checked); setPage(1) }}
              />
              NSFW
            </label>
          </div>

          <PopularTagsRow
            currentQuery={query}
            onPickTag={(t) => { setQuery(t); setSubmittedQuery(t); setPage(1) }}
          />
        </div>

        <div className="flex-1 overflow-y-auto p-2 min-h-0">
          {loading && (
            <div className="flex items-center justify-center py-10 text-ink-3 gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('cs.searching')}
            </div>
          )}
          {error && (
            <div className="card p-4 text-err text-sm flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
          {!loading && !error && provider === 'civitai' && results && results.items.length === 0 && (
            <div className="text-center py-10 text-ink-3 text-sm">
              {t('cs.noResults')}
            </div>
          )}
          {!loading && !error && provider === 'huggingface' && hfResults.length === 0 && (
            <div className="text-center py-10 text-ink-3 text-sm">
              {t('cs.noResults')}
            </div>
          )}
          {!loading && provider === 'civitai' && results && (
            <div className="space-y-1.5">
              {results.items.map((it) => (
                <SearchResultCard
                  key={it.id}
                  item={it}
                  onDownloaded={onDownloaded}
                />
              ))}
            </div>
          )}
          {!loading && provider === 'huggingface' && hfResults.length > 0 && (
            <div className="space-y-1.5">
              {hfResults.map((it) => (
                <HuggingFaceResultCard
                  key={it.repoId}
                  item={it}
                  onDownloaded={onDownloaded}
                />
              ))}
            </div>
          )}
        </div>

        {provider === 'civitai' && results && (results.totalPages > 1 || usingCursor) && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-line shrink-0">
            <button
              className="btn btn-ghost text-xs"
              disabled={
                loading ||
                (usingCursor ? cursorHistory.length === 0 : page <= 1)
              }
              onClick={gotoPrev}
            >
              {t('cs.prev')}
            </button>
            <span className="text-xs text-ink-2 font-mono">
              {usingCursor
                ? t('cs.pageStatusCursor', { page: cursorHistory.length + 1, count: results.items.length })
                : t('cs.pageStatus', { page: results.currentPage, total: results.totalPages, count: results.totalItems })}
            </span>
            <button
              className="btn btn-ghost text-xs"
              disabled={
                loading ||
                (usingCursor
                  ? results.nextCursor === null
                  : results.nextPage === null)
              }
              onClick={gotoNext}
            >
              {t('cs.next')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

interface SearchResultCardProps {
  item: CivitaiSearchItem
  onDownloaded?(asset: CivitaiAssetType, destPath: string): void
}

function SearchResultCard({ item, onDownloaded }: SearchResultCardProps): JSX.Element {
  // Always show the latest version for download — user can browse on Civitai
  // for older versions. 99% of the time you want the newest.
  const version = item.versions[0] as CivitaiSearchVersion | undefined
  const primaryFile = version?.files.find((f) => f.primary) ?? version?.files[0]

  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<{ b: number; t: number } | null>(null)
  const [done, setDone] = useState<{ destPath: string } | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)

  // Subscribe to progress events filtered to our URL only.
  useEffect(() => {
    if (!downloading || !primaryFile?.downloadUrl) return
    const unsub = api.civitai.onDownloadProgress((p) => {
      if (p.url !== primaryFile.downloadUrl) return
      if (p.done) {
        if (p.error) setErrorMsg(p.error)
        else if (p.destPath) setDone({ destPath: p.destPath })
        setDownloading(false)
      } else {
        setProgress({ b: p.bytesDownloaded, t: p.totalBytes })
      }
    })
    return unsub
  }, [downloading, primaryFile?.downloadUrl])

  async function startDownload(): Promise<void> {
    if (!primaryFile?.downloadUrl) return
    setDownloading(true)
    setProgress({ b: 0, t: (primaryFile.sizeKB ?? 0) * 1024 })
    setErrorMsg(null)
    try {
      const r = await api.civitai.download({
        url: primaryFile.downloadUrl,
        filename: primaryFile.name,
        assetType: item.type,
        expectedSha256: primaryFile.hashes.sha256,
        source: {
          provider: 'civitai',
          name: item.name,
          creator: item.creator,
          pageUrl: item.pageUrl,
          downloadUrl: primaryFile.downloadUrl,
          thumbnailUrl: version?.thumbnailUrl ?? null,
          expectedSha256: primaryFile.hashes.sha256,
          modelId: item.id,
          modelVersionId: version?.id ?? null,
          versionName: version?.name,
          baseModel: version?.baseModel,
          filePath: primaryFile.name
        }
      })
      setDone({ destPath: r.destPath })
      onDownloaded?.(item.type, r.destPath)
      toast.success(tStatic('cs.dlSuccess', { name: primaryFile.name }))
    } catch (e) {
      setErrorMsg((e as Error).message)
      toast.error(tStatic('cs.dlFailed', { message: (e as Error).message }))
    } finally {
      setDownloading(false)
    }
  }

  function cancel(): void {
    if (primaryFile?.downloadUrl) {
      void api.civitai.cancelDownload(primaryFile.downloadUrl)
    }
  }

  const sizeBytes = primaryFile?.sizeKB ? primaryFile.sizeKB * 1024 : 0
  const pct = progress && progress.t > 0 ? Math.round((progress.b / progress.t) * 100) : 0
  const downloadable = primaryFile?.downloadUrl != null

  return (
    <div className="card p-2 flex gap-2 overflow-hidden">
      <div className="w-20 h-20 shrink-0 bg-bg-3 rounded overflow-hidden">
        {version?.thumbnailUrl ? (
          <img
            src={version.thumbnailUrl}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : null}
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="text-sm font-medium truncate" title={item.name}>{item.name}</span>
          <Badge>{labelOfType(item.type)}</Badge>
          {version && version.baseModel && <Badge tone="ink">{version.baseModel}</Badge>}
          {item.nsfw && <Badge tone="warn">NSFW</Badge>}
          <button
            onClick={() => api.app.openExternal(item.pageUrl)}
            className="ml-auto text-ink-3 hover:text-ink-1"
            title={tStatic('rec.openOnCivitai')}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="text-[11px] text-ink-3 truncate">
          {item.creator && <>by <span className="font-mono">{item.creator}</span> · </>}
          ↓ {item.downloadCount.toLocaleString()} ・ 👍 {item.thumbsUpCount.toLocaleString()}
          {item.thumbsDownCount > 0 && <> ・ 👎 {item.thumbsDownCount.toLocaleString()}</>}
          {sizeBytes > 0 && <> ・ {formatBytes(sizeBytes)}</>}
          {primaryFile && <> ・ <span className="font-mono">{primaryFile.name}</span></>}
        </div>

        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 text-[10px]">
            {item.tags.slice(0, 6).map((t) => (
              <span key={t} className="px-1 py-0.5 rounded bg-bg-3 text-ink-2">{t}</span>
            ))}
          </div>
        )}

        {/* Expandable details: trigger words + description from the model
            page. Hidden by default to keep cards compact, revealed via the
            "詳細" toggle when the user wants to read more before downloading. */}
        {(version && version.trainedWords.length > 0) || item.description ? (
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => setDetailsOpen((o) => !o)}
              className="flex items-center gap-1 text-[10px] text-ink-3 hover:text-ink-1"
            >
              {detailsOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {tStatic('cs.details')}
            </button>
            {detailsOpen && (
              <div className="space-y-1.5 text-[11px]">
                {version && version.trainedWords.length > 0 && (
                  <div className="flex items-baseline flex-wrap gap-1">
                    <span className="text-ink-3 mr-1">{tStatic('rec.triggers')}</span>
                    {version.trainedWords.slice(0, 8).map((w) => (
                      <span
                        key={w}
                        className="font-mono px-1 py-0.5 rounded bg-accent-dim/30 text-ink-1 border border-accent-dim"
                      >
                        {w}
                      </span>
                    ))}
                  </div>
                )}
                {item.description && (
                  <div className="text-ink-2 whitespace-pre-wrap leading-relaxed bg-bg-1 rounded p-2 max-h-40 overflow-y-auto">
                    {item.description}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}

        {/* Download row */}
        <div className="flex items-center gap-1.5 mt-auto">
          {done && (
            <span className="flex items-center gap-1 text-ok text-[11px]">
              <Check className="h-3.5 w-3.5" /> {tStatic('cs.imported')}
            </span>
          )}
          {errorMsg && !downloading && (
            <span className="flex items-center gap-1 text-err text-[11px] truncate" title={errorMsg}>
              <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {errorMsg}
            </span>
          )}
          {downloading && (
            <>
              <div className="flex-1 h-1.5 bg-bg-3 rounded overflow-hidden">
                <div
                  className="h-full bg-accent transition-[width] duration-150"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-[10px] text-ink-2 font-mono shrink-0 w-10 text-right">{pct}%</span>
              <button className="btn btn-ghost text-[11px] py-0.5" onClick={cancel}>{tStatic('generate.interrupt')}</button>
            </>
          )}
          {!downloading && !done && (
            <>
              {errorMsg && (
                <button
                  className="btn btn-ghost text-[11px] py-0.5"
                  onClick={() => { setErrorMsg(null); startDownload() }}
                  title={tStatic('cs.retry')}
                >
                  <RefreshCcw className="h-3 w-3" />
                </button>
              )}
              <button
                className="btn btn-primary text-[11px] py-0.5 ml-auto"
                disabled={!downloadable || item.type === 'Other'}
                onClick={startDownload}
                title={
                  !downloadable
                    ? tStatic('cs.noDlUrl')
                    : item.type === 'Other'
                    ? tStatic('cs.unsupportedType')
                    : tStatic('cs.dlAndImport')
                }
              >
                <Download className="h-3 w-3 mr-1" />
                {tStatic('rec.download')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

interface HuggingFaceResultCardProps {
  item: HuggingFaceSearchItem
  onDownloaded?(asset: CivitaiAssetType, destPath: string): void
}

function HuggingFaceResultCard({ item, onDownloaded }: HuggingFaceResultCardProps): JSX.Element {
  const [selectedPath, setSelectedPath] = useState(item.files[0]?.path ?? '')
  const selectedFile = item.files.find((file) => file.path === selectedPath) ?? item.files[0]
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<{ b: number; t: number } | null>(null)
  const [done, setDone] = useState<{ destPath: string } | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!downloading || !selectedFile?.downloadUrl) return
    const unsub = api.civitai.onDownloadProgress((p) => {
      if (p.url !== selectedFile.downloadUrl) return
      if (p.done) {
        if (p.error) setErrorMsg(p.error)
        else if (p.destPath) setDone({ destPath: p.destPath })
        setDownloading(false)
      } else {
        setProgress({ b: p.bytesDownloaded, t: p.totalBytes })
      }
    })
    return unsub
  }, [downloading, selectedFile?.downloadUrl])

  async function startDownload(): Promise<void> {
    if (!selectedFile) return
    setDownloading(true)
    setProgress({ b: 0, t: selectedFile.sizeBytes ?? 0 })
    setErrorMsg(null)
    try {
      const r = await api.huggingface.download({
        url: selectedFile.downloadUrl,
        filename: selectedFile.name,
        assetType: selectedFile.assetType,
        expectedSha256: null,
        source: {
          provider: 'huggingface',
          name: item.name,
          creator: item.author,
          pageUrl: item.pageUrl,
          downloadUrl: selectedFile.downloadUrl,
          thumbnailUrl: null,
          expectedSha256: null,
          repoId: item.repoId,
          filePath: selectedFile.path
        }
      })
      setDone({ destPath: r.destPath })
      onDownloaded?.(selectedFile.assetType, r.destPath)
      toast.success(tStatic('cs.dlSuccess', { name: selectedFile.name }))
    } catch (e) {
      setErrorMsg((e as Error).message)
      toast.error(tStatic('cs.dlFailed', { message: (e as Error).message }))
    } finally {
      setDownloading(false)
    }
  }

  function cancel(): void {
    if (selectedFile?.downloadUrl) {
      void api.civitai.cancelDownload(selectedFile.downloadUrl)
    }
  }

  const pct = progress && progress.t > 0 ? Math.round((progress.b / progress.t) * 100) : 0

  return (
    <div className="card p-2 flex gap-2 overflow-hidden">
      <div className="w-20 h-20 shrink-0 bg-bg-3 rounded overflow-hidden flex items-center justify-center text-[10px] text-ink-3">
        HF
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="text-sm font-medium truncate" title={item.repoId}>{item.name}</span>
          <Badge tone="ink">Hugging Face</Badge>
          {selectedFile && <Badge>{labelOfType(selectedFile.assetType)}</Badge>}
          <button
            onClick={() => api.app.openExternal(item.pageUrl)}
            className="ml-auto text-ink-3 hover:text-ink-1"
            title={tStatic('rec.openOnCivitai')}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="text-[11px] text-ink-3 truncate">
          {item.author && <>by <span className="font-mono">{item.author}</span> · </>}
          ↓ {item.downloads.toLocaleString()} ・ ♥ {item.likes.toLocaleString()}
        </div>
        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 text-[10px]">
            {item.tags.slice(0, 6).map((tag) => (
              <span key={tag} className="px-1 py-0.5 rounded bg-bg-3 text-ink-2">{tag}</span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <select
            className="input text-[11px] py-1 flex-1 min-w-0"
            value={selectedPath}
            onChange={(e) => setSelectedPath(e.target.value)}
            disabled={downloading || item.files.length <= 1}
          >
            {item.files.map((file) => (
              <option key={file.path} value={file.path}>
                {file.path} {file.sizeBytes ? `(${formatBytes(file.sizeBytes)})` : ''}
              </option>
            ))}
          </select>
          {done && (
            <span className="flex items-center gap-1 text-ok text-[11px]">
              <Check className="h-3.5 w-3.5" /> {tStatic('cs.imported')}
            </span>
          )}
          {errorMsg && !downloading && (
            <span className="flex items-center gap-1 text-err text-[11px] truncate" title={errorMsg}>
              <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {errorMsg}
            </span>
          )}
          {downloading ? (
            <>
              <div className="w-24 h-1.5 bg-bg-3 rounded overflow-hidden">
                <div className="h-full bg-accent transition-[width] duration-150" style={{ width: `${pct}%` }} />
              </div>
              <button className="btn btn-ghost text-[11px] py-0.5" onClick={cancel}>{tStatic('generate.interrupt')}</button>
            </>
          ) : (
            <button
              className="btn btn-primary text-[11px] py-0.5"
              disabled={!selectedFile}
              onClick={startDownload}
            >
              <Download className="h-3 w-3 mr-1" />
              {tStatic('rec.download')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

interface PopularTagsRowProps {
  currentQuery: string
  onPickTag(tag: string): void
}

/**
 * Horizontally-scrolling row of Civitai's most-used tags. Click sets the
 * search query to that tag — works because Civitai's text-search matches
 * tag names as a substring, so "anime" finds anime-tagged models.
 *
 * Tags are loaded the first time the modal opens (with 24h cache) and stored in zustand.
 * Hidden when the cache hasn't populated yet.
 */
function PopularTagsRow({ currentQuery, onPickTag }: PopularTagsRowProps): JSX.Element | null {
  const tags = useStore((s) => s.civitaiTags)
  const [showAll, setShowAll] = useState(false)
  if (tags.length === 0) return null
  const visible = showAll ? tags : tags.slice(0, 18)
  return (
    <div className="flex items-start gap-1.5 flex-wrap">
      <TagIcon className="h-3.5 w-3.5 text-ink-3 shrink-0 mt-1" />
      {visible.map((t) => {
        const active = currentQuery.toLowerCase() === t.name.toLowerCase()
        return (
          <button
            key={t.name}
            onClick={() => onPickTag(t.name)}
            className={cn(
              'text-[11px] px-1.5 py-0.5 rounded border whitespace-nowrap',
              active
                ? 'border-accent bg-accent-dim/40 text-ink-0'
                : 'border-line text-ink-2 hover:bg-bg-3'
            )}
            title={tStatic('cs.tagModelCount', { count: t.modelCount.toLocaleString() })}
          >
            {t.name}
          </button>
        )
      })}
      {tags.length > 18 && (
        <button
          onClick={() => setShowAll((s) => !s)}
          className="text-[11px] px-1.5 py-0.5 rounded text-ink-3 hover:text-ink-1"
        >
          {showAll ? tStatic('cs.showLess') : `+${tags.length - 18}`}
        </button>
      )}
    </div>
  )
}

function labelOfType(t: CivitaiAssetType): string {
  // Resolve via i18n so badges follow the active language. The `case`
  // branches that don't need translation (LoRA / VAE / etc. — proper nouns)
  // bypass the dictionary by falling through to the static string.
  switch (t) {
    case 'Checkpoint': return tStatic('cs.typeCheckpoint')
    case 'LORA': return 'LoRA'
    case 'LoCon': return 'LoCon'
    case 'TextualInversion': return 'Embedding'
    case 'Hypernetwork': return 'Hyper'
    case 'VAE': return 'VAE'
    case 'Controlnet': return 'ControlNet'
    case 'Other': return tStatic('cs.typeOther')
  }
}

interface BadgeProps {
  children: React.ReactNode
  tone?: 'accent' | 'ink' | 'warn'
}
function Badge({ children, tone = 'accent' }: BadgeProps): JSX.Element {
  const cls = {
    accent: 'bg-accent-dim/40 text-ink-0',
    ink: 'bg-bg-3 text-ink-1',
    warn: 'bg-warn/20 text-warn'
  }[tone]
  return (
    <span className={cn('text-[10px] px-1.5 py-0.5 rounded', cls)}>{children}</span>
  )
}
