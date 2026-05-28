import { BookOpenText, Clipboard, Copy, Database, ExternalLink, History, LayoutTemplate, Library, Plus, RefreshCw, Search, Send, Tags, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { api } from '@/lib/ipc'
import { promptAppend } from '@/lib/prompt-utils'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type {
  PromptDictionaryEntry,
  PromptDictionaryIngestStatus,
  PromptDictionarySearchRequest,
  PromptDictionarySearchResult,
  PromptDictionarySourceDefinition,
  PromptDictionarySourceRegistryResult,
  PromptTagPolarity
} from '@shared/types'

const MAX_RESULTS = 80
const QUICK_QUERIES = ['手', '髪', '目', '光', '着物', 'ポーズ', '背景', 'bad hands']
type DictionaryAdultFilter = NonNullable<PromptDictionarySearchRequest['adult']>
type DictionaryPolarityFilter = 'all' | PromptTagPolarity
const REVIEW_EXPORT_COMMAND = 'npm.cmd run dictionary:enrich:meanings:review -- --export output/prompt-dictionary-meaning-review.json'
const REVIEW_IMPORT_COMMAND = 'npm.cmd run dictionary:enrich:meanings:review -- --import output/prompt-dictionary-meaning-review.json'

export function PromptDictionaryWorkspace(): JSX.Element {
  const [query, setQuery] = useState('手')
  const [result, setResult] = useState<PromptDictionarySearchResult | null>(null)
  const [registry, setRegistry] = useState<PromptDictionarySourceRegistryResult | null>(null)
  const [ingest, setIngest] = useState<PromptDictionaryIngestStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [statusLoading, setStatusLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [sourceFilter, setSourceFilter] = useState('all')
  const [adultFilter, setAdultFilter] = useState<DictionaryAdultFilter>('all')
  const [polarityFilter, setPolarityFilter] = useState<DictionaryPolarityFilter>('all')
  const searchSeq = useRef(0)

  const prompt = useStore((s) => s.prompt)
  const negative = useStore((s) => s.negativePrompt)
  const setPrompt = useStore((s) => s.setPrompt)
  const setNegative = useStore((s) => s.setNegativePrompt)
  const pushRecent = useStore((s) => s.pushRecentTag)
  const slotInsertEnabled = useStore((s) => s.promptComposerSlotInsertEnabled)
  const slotInsertTarget = useStore((s) => s.promptComposerSlotInsertTarget)
  const appendPromptComposerSlotTag = useStore((s) => s.appendPromptComposerSlotTag)
  const setCurrentTab = useStore((s) => s.setCurrentTab)
  const setSidePanelTab = useStore((s) => s.setSidePanelTab)
  const openCivitaiSearch = useStore((s) => s.openCivitaiSearch)

  useEffect(() => {
    void refreshStatus()
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const seq = searchSeq.current + 1
      searchSeq.current = seq
      setLoading(true)
      setErrorMessage(null)
      api.promptDictionary.search(buildSearchRequest(query, MAX_RESULTS, sourceFilter, adultFilter, polarityFilter))
        .then((next) => {
          if (searchSeq.current === seq) setResult(next)
        })
        .catch((error) => {
          if (searchSeq.current !== seq) return
          setResult(null)
          setErrorMessage((error as Error).message)
        })
        .finally(() => {
          if (searchSeq.current === seq) setLoading(false)
        })
    }, query.trim() ? 160 : 0)
    return () => window.clearTimeout(timeout)
  }, [query, sourceFilter, adultFilter, polarityFilter])

  const entries = result?.entries ?? []
  const runtimeCount = result?.searchableCount ?? 0
  const sourceSummary = useMemo(() => summarizeSources(registry?.sources ?? []), [registry])
  const sourceOptions = useMemo(
    () => sourceSummary.filter((source) => source.allowedMode !== 'disabled'),
    [sourceSummary]
  )

  async function refreshStatus(): Promise<void> {
    setStatusLoading(true)
    try {
      const [sources, ingestStatus, dictionaryStatus] = await Promise.all([
        api.promptDictionary.listSources(),
        api.promptDictionary.inspectIngest(),
        api.promptDictionary.search({ query: '', limit: 0 })
      ])
      setRegistry(sources)
      setIngest(ingestStatus)
      setResult((previous) => previous ?? dictionaryStatus)
    } catch (error) {
      toast.error(`大辞典ステータス取得失敗: ${(error as Error).message}`)
    } finally {
      setStatusLoading(false)
    }
  }

  function insertPositive(tag: string): void {
    if (slotInsertEnabled) {
      appendPromptComposerSlotTag(slotInsertTarget, tag)
      pushRecent(tag)
      toast.success('Prompt Composer Slotへ追加しました')
      return
    }
    setPrompt(promptAppend(prompt, tag))
    pushRecent(tag)
    toast.success('Promptへ追加しました')
  }

  function insertNegative(tag: string): void {
    setNegative(promptAppend(negative, tag))
    pushRecent(tag)
    toast.success('Negativeへ追加しました')
  }

  async function copyTag(tag: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(tag)
      toast.success('タグをコピーしました')
    } catch (error) {
      toast.error(`コピー失敗: ${(error as Error).message}`)
    }
  }

  async function copyReviewCommand(command: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(command)
      toast.success('レビューコマンドをコピーしました')
    } catch (error) {
      toast.error(`コピー失敗: ${(error as Error).message}`)
    }
  }

  async function revealIngestDatabase(): Promise<void> {
    if (!ingest?.dbPath) {
      toast.error('staging DBの場所を取得できていません')
      return
    }
    try {
      await api.app.showItemInFolder(ingest.dbPath)
    } catch (error) {
      toast.error(`staging DBを開けません: ${(error as Error).message}`)
    }
  }

  function openPromptInput(): void {
    setCurrentTab('txt2img')
  }

  function openHistory(): void {
    setSidePanelTab('history')
    setCurrentTab('txt2img')
  }

  return (
    <main className="flex-1 min-w-0 overflow-auto bg-bg-0" data-testid="prompt-dictionary-workspace">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-5">
        <header className="flex flex-wrap items-start gap-3 border-b border-line pb-4">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="mt-0.5 rounded border border-accent/35 bg-accent/10 p-2 text-accent">
              <BookOpenText className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-ink-0">Prompt大辞典</h2>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-2">
                SQLite版の大辞典を広い画面で検索し、Prompt入力、Negative、Prompt Composer Slot、タグ管理、履歴再利用、Civitai由来データへつなぐ作業面です。
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn h-8 px-3 text-xs gap-1.5"
            onClick={() => { void refreshStatus() }}
            disabled={statusLoading}
            data-testid="prompt-dictionary-workspace-refresh"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', statusLoading && 'animate-spin')} />
            再確認
          </button>
        </header>

        <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6" data-testid="prompt-dictionary-workspace-stats">
          <Metric label="検索可能タグ" value={runtimeCount || '...'} icon={<Database className="h-4 w-4" />} />
          <Metric label="収集レコード" value={ingest?.rawPromptRecordCount ?? '...'} icon={<Clipboard className="h-4 w-4" />} />
          <Metric label="候補タグ" value={ingest?.candidateTagCount ?? '...'} icon={<Tags className="h-4 w-4" />} />
          <Metric label="翻訳ジョブ" value={ingest?.translationJobCount ?? '...'} icon={<Library className="h-4 w-4" />} />
          <Metric label="意味レビュー待ち" value={ingest?.meaningReviewableCount ?? '...'} icon={<BookOpenText className="h-4 w-4" />} />
          <Metric label="有効ソース" value={`${ingest?.enabledSourceCount ?? '...'}/${ingest?.registrySourceCount ?? '...'}`} icon={<ExternalLink className="h-4 w-4" />} />
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-3">
            <div className="rounded border border-line bg-bg-1 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[260px] flex-1">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
                  <input
                    className="input pl-8 text-sm"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="日本語/英語で検索: 手、髪、光、kimono..."
                    data-testid="prompt-dictionary-workspace-search"
                  />
                </div>
                <span className="text-[11px] text-ink-3" data-testid="prompt-dictionary-workspace-result-count">
                  {loading ? '検索中...' : `${result?.total ?? 0} 件 / ${result?.searchableCount ?? 0} 語`}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {QUICK_QUERIES.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={cn(
                      'rounded border px-2 py-1 text-[11px]',
                      query === item ? 'border-accent bg-accent/15 text-accent' : 'border-line text-ink-2 hover:bg-bg-2'
                    )}
                    onClick={() => setQuery(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-3" data-testid="prompt-dictionary-workspace-filters">
                <label className="grid gap-1 text-[11px] text-ink-3">
                  Source
                  <select
                    className="input h-8 text-xs"
                    value={sourceFilter}
                    onChange={(event) => setSourceFilter(event.target.value)}
                    data-testid="prompt-dictionary-workspace-source-filter"
                  >
                    <option value="all">All sources</option>
                    {sourceOptions.map((source) => (
                      <option key={source.sourceId} value={source.sourceId}>
                        {source.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-[11px] text-ink-3">
                  adult表示
                  <select
                    className="input h-8 text-xs"
                    value={adultFilter}
                    onChange={(event) => setAdultFilter(event.target.value as DictionaryAdultFilter)}
                    data-testid="prompt-dictionary-workspace-adult-filter"
                  >
                    <option value="all">すべて表示</option>
                    <option value="safe">adult以外</option>
                    <option value="adult">adultだけ確認</option>
                  </select>
                </label>
                <label className="grid gap-1 text-[11px] text-ink-3">
                  用途
                  <select
                    className="input h-8 text-xs"
                    value={polarityFilter}
                    onChange={(event) => setPolarityFilter(event.target.value as DictionaryPolarityFilter)}
                    data-testid="prompt-dictionary-workspace-polarity-filter"
                  >
                    <option value="all">All</option>
                    <option value="positive">Prompt</option>
                    <option value="negative">Negative</option>
                    <option value="both">Both</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="min-h-[460px] overflow-hidden rounded border border-line bg-bg-1" data-testid="prompt-dictionary-workspace-results">
              {errorMessage ? (
                <div className="p-4 text-sm text-danger">検索失敗: {errorMessage}</div>
              ) : !query.trim() ? (
                <div className="p-4 text-sm text-ink-3">検索語を入力してください。</div>
              ) : entries.length === 0 ? (
                <div className="p-4 text-sm text-ink-3">一致するタグはありません。</div>
              ) : (
                <div className="divide-y divide-line">
                  {entries.map((entry) => (
                    <DictionaryWorkspaceRow
                      key={`${entry.category}|${entry.group}|${entry.en}`}
                      entry={entry}
                      slotInsertEnabled={slotInsertEnabled}
                      onInsertPositive={insertPositive}
                      onInsertNegative={insertNegative}
                      onCopy={(tag) => { void copyTag(tag) }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <aside className="space-y-3">
            <section className="rounded border border-line bg-bg-1 p-3" data-testid="prompt-dictionary-synergy-panel">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-1">
                <Send className="h-4 w-4 text-accent" />
                既存機能とのシナジー
              </h3>
              <div className="mt-3 space-y-2">
                <SynergyAction
                  icon={<Send className="h-4 w-4" />}
                  title="Prompt入力"
                  body="検索結果からPositive / Negativeへ直接追記。通常のtxt2img生成導線を壊さない。"
                  action="txt2imgへ"
                  onClick={openPromptInput}
                />
                <SynergyAction
                  icon={<LayoutTemplate className="h-4 w-4" />}
                  title="Prompt Composer Slot"
                  body={slotInsertEnabled ? `現在ON: ${slotInsertTarget} slotへ挿入` : 'Slot挿入ON時は検索結果を選択slotへ送れる。'}
                  action={slotInsertEnabled ? 'Slot利用中' : 'txt2imgでON'}
                  onClick={openPromptInput}
                />
                <SynergyAction
                  icon={<Tags className="h-4 w-4" />}
                  title="タグ管理"
                  body="大辞典で見つけた語をCustom Libraryへ育てる前段として使う。"
                  action="タグ管理へ"
                  onClick={() => setCurrentTab('tags')}
                />
                <SynergyAction
                  icon={<History className="h-4 w-4" />}
                  title="履歴/学習"
                  body="過去生成履歴から抽出した候補を検索面で確認し、良い語を再利用する。"
                  action="履歴へ"
                  onClick={openHistory}
                />
                <SynergyAction
                  icon={<ExternalLink className="h-4 w-4" />}
                  title="Civitai / LoRA"
                  body="Civitai公開メタデータ由来タグとLoRA検索を同じ制作文脈で使う。"
                  action="Civitai"
                  onClick={() => openCivitaiSearch('LORA')}
                />
              </div>
            </section>

            <section className="rounded border border-line bg-bg-1 p-3" data-testid="prompt-dictionary-meaning-review-panel">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-1">
                <BookOpenText className="h-4 w-4 text-accent" />
                意味レビュー
              </h3>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <CompactMetric label="待ち" value={ingest?.meaningReviewableCount ?? '...'} />
                <CompactMetric label="判定ログ" value={ingest?.meaningDecisionCount ?? '...'} />
              </div>
              <div className="mt-2 truncate text-[10px] text-ink-3" data-testid="prompt-dictionary-meaning-review-latest">
                latest: {formatDateTime(ingest?.latestMeaningDecisionAt)}
              </div>
              <div className="mt-3 grid gap-1.5">
                <button
                  type="button"
                  className="btn h-8 justify-start px-2 text-[11px] gap-1.5"
                  onClick={() => { void copyReviewCommand(REVIEW_EXPORT_COMMAND) }}
                  data-testid="prompt-dictionary-meaning-review-copy-export"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Export command
                </button>
                <button
                  type="button"
                  className="btn h-8 justify-start px-2 text-[11px] gap-1.5"
                  onClick={() => { void copyReviewCommand(REVIEW_IMPORT_COMMAND) }}
                  data-testid="prompt-dictionary-meaning-review-copy-import"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Import command
                </button>
                <button
                  type="button"
                  className="btn h-8 justify-start px-2 text-[11px] gap-1.5"
                  onClick={() => { void revealIngestDatabase() }}
                  data-testid="prompt-dictionary-meaning-review-reveal-db"
                >
                  <Database className="h-3.5 w-3.5" />
                  staging DB
                </button>
              </div>
            </section>

            <section className="rounded border border-line bg-bg-1 p-3" data-testid="prompt-dictionary-source-panel">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-1">
                <Database className="h-4 w-4 text-accent" />
                Source / Ingest
              </h3>
              <div className="mt-3 space-y-2">
                {sourceSummary.map((source) => (
                  <SourceRow key={source.sourceId} source={source} />
                ))}
                {sourceSummary.length === 0 && (
                  <div className="text-xs text-ink-3">Source registryを読み込み中...</div>
                )}
              </div>
              {ingest?.warnings?.length ? (
                <div className="mt-3 rounded border border-warning/30 bg-warning/10 p-2 text-[11px] text-warning">
                  {ingest.warnings.slice(0, 2).join(' / ')}
                </div>
              ) : null}
            </section>
          </aside>
        </section>
      </div>
    </main>
  )
}

function Metric({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }): JSX.Element {
  return (
    <div className="rounded border border-line bg-bg-1 p-3">
      <div className="flex items-center gap-2 text-[11px] text-ink-3">
        <span className="text-accent">{icon}</span>
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-ink-0">{value}</div>
    </div>
  )
}

function CompactMetric({ label, value }: { label: string; value: string | number }): JSX.Element {
  return (
    <div className="rounded border border-line bg-bg-0 p-2">
      <div className="text-[10px] text-ink-3">{label}</div>
      <div className="mt-0.5 text-base font-semibold text-ink-0">{value}</div>
    </div>
  )
}

function DictionaryWorkspaceRow({
  entry,
  slotInsertEnabled,
  onInsertPositive,
  onInsertNegative,
  onCopy
}: {
  entry: PromptDictionaryEntry
  slotInsertEnabled: boolean
  onInsertPositive(tag: string): void
  onInsertNegative(tag: string): void
  onCopy(tag: string): void
}): JSX.Element {
  const isNegative = entry.polarity === 'negative'
  const isAdult = entry.adultLevel > 0
  const testId = tagTestId(entry.en)
  return (
    <article className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_240px]" data-testid={`prompt-dictionary-workspace-row-${testId}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-mono text-sm font-semibold text-ink-0 break-all">{entry.en}</h3>
          <span className={cn(
            'rounded border px-1.5 py-0.5 text-[10px]',
            isNegative ? 'border-danger/40 text-danger' : 'border-accent/35 text-accent'
          )}>
            {entry.polarity}
          </span>
          <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-3">
            score {Math.round(entry.score)}
          </span>
          {isAdult && (
            <span className="rounded border border-danger/40 px-1.5 py-0.5 text-[10px] text-danger">
              adult
            </span>
          )}
          {formatPostCount(entry.postCount) && (
            <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-3">
              {formatPostCount(entry.postCount)}
            </span>
          )}
        </div>
        {entry.ja && <p className="mt-1 text-sm text-ink-1">{entry.ja}</p>}
        {entry.meaning && entry.meaning !== entry.ja && (
          <p className="mt-1 text-xs leading-relaxed text-ink-2">{entry.meaning}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-ink-3">
          <span className="rounded border border-line px-1.5 py-0.5">{entry.category}</span>
          <span className="rounded border border-line px-1.5 py-0.5">{entry.group}</span>
          <span className="rounded border border-line px-1.5 py-0.5">{entry.sourceLabel}</span>
          {entry.aliases.slice(0, 4).map((alias) => (
            <span key={alias} className="rounded border border-line px-1.5 py-0.5">{alias}</span>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap content-start gap-1.5 lg:justify-end">
        <button
          type="button"
          className="btn btn-primary h-8 px-2 text-[11px] gap-1"
          onClick={() => onInsertPositive(entry.en)}
          data-testid={`prompt-dictionary-workspace-insert-${testId}`}
        >
          {slotInsertEnabled ? <LayoutTemplate className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {slotInsertEnabled ? 'Slot' : 'Prompt'}
        </button>
        <button
          type="button"
          className="btn h-8 px-2 text-[11px] gap-1"
          onClick={() => onInsertNegative(entry.en)}
          data-testid={`prompt-dictionary-workspace-negative-${testId}`}
        >
          <X className="h-3.5 w-3.5" />
          Negative
        </button>
        <button
          type="button"
          className="btn h-8 px-2 text-[11px] gap-1"
          onClick={() => onCopy(entry.en)}
          data-testid={`prompt-dictionary-workspace-copy-${testId}`}
        >
          <Copy className="h-3.5 w-3.5" />
          Copy
        </button>
      </div>
    </article>
  )
}

function SynergyAction({
  icon,
  title,
  body,
  action,
  onClick
}: {
  icon: React.ReactNode
  title: string
  body: string
  action: string
  onClick(): void
}): JSX.Element {
  return (
    <div className="rounded border border-line bg-bg-0 p-2">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-accent">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-ink-1">{title}</div>
          <div className="mt-0.5 text-[11px] leading-relaxed text-ink-3">{body}</div>
        </div>
        <button type="button" className="btn h-7 px-2 text-[11px]" onClick={onClick}>
          {action}
        </button>
      </div>
    </div>
  )
}

function SourceRow({ source }: { source: PromptDictionarySourceDefinition & { tone: 'enabled' | 'manual' | 'disabled' } }): JSX.Element {
  return (
    <div className="rounded border border-line bg-bg-0 p-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink-1">{source.displayName}</span>
        <span className={cn(
          'rounded border px-1.5 py-0.5 text-[10px]',
          source.tone === 'enabled' && 'border-accent/35 text-accent',
          source.tone === 'manual' && 'border-warning/35 text-warning',
          source.tone === 'disabled' && 'border-danger/35 text-danger'
        )}>
          {source.allowedMode}
        </span>
      </div>
      <div className="mt-1 text-[10px] text-ink-3">{source.sourceType} / raw prompts: {source.storesRawPrompts ? 'yes' : 'no'}</div>
    </div>
  )
}

function summarizeSources(sources: PromptDictionarySourceDefinition[]): Array<PromptDictionarySourceDefinition & { tone: 'enabled' | 'manual' | 'disabled' }> {
  return sources.map((source) => ({
    ...source,
    tone: source.allowedMode === 'enabled' ? 'enabled' : source.allowedMode === 'manual-only' ? 'manual' : 'disabled'
  }))
}

function buildSearchRequest(
  query: string,
  limit: number,
  sourceFilter: string,
  adultFilter: DictionaryAdultFilter,
  polarityFilter: DictionaryPolarityFilter
): PromptDictionarySearchRequest {
  return {
    query,
    limit,
    adult: adultFilter,
    ...(sourceFilter === 'all' ? {} : { sourceIds: [sourceFilter] }),
    ...(polarityFilter === 'all' ? {} : { polarity: polarityFilter })
  }
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function tagTestId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'tag'
}

function formatPostCount(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN) || (value ?? 0) <= 0) return ''
  const count = Number(value)
  if (count >= 1000000) return `${Math.round(count / 100000) / 10}M posts`
  if (count >= 1000) return `${Math.round(count / 100) / 10}k posts`
  return `${count} posts`
}
