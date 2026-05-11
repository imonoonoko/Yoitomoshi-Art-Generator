import { useEffect, useMemo, useState } from 'react'
import { Search, FolderInput, FolderOpen, RefreshCcw, Star, ChevronDown, Globe } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore } from '@/lib/store'
import { api } from '@/lib/ipc'
import { useT, t as tStatic } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { baseModelsCompatible } from '@/lib/lora-suggest'
import { LoraCard } from './LoraCard'

const FILTERS = [
  { id: 'all', labelKey: 'lp.filterAll' },
  { id: 'compatible', labelKey: 'lp.filterCompatible' },
  { id: 'favorites', labelKey: 'lp.filterFavorites' },
  { id: 'active', labelKey: 'lp.filterActive' }
] as const
type FilterId = (typeof FILTERS)[number]['id']

/**
 * Right-pane LoRA browser. Shows the user's local LoRA collection with search,
 * filtering by compatibility / favorites / active state, and an import button
 * that copies new safetensors into Forge's models/Lora directory.
 *
 * Hovering a card lazily fetches Civitai metadata (thumbnail / trigger words /
 * baseModel). The "互換あり" filter uses that metadata, so the first browse
 * pass shows everything; once the user has hovered through their library it
 * narrows to relevant LoRAs.
 */
export function LoraPanel(): JSX.Element {
  const loras = useStore((s) => s.loras)
  const setLoras = useStore((s) => s.setLoras)
  const loraMeta = useStore((s) => s.loraMeta)
  const activeLoras = useStore((s) => s.activeLoras)
  const favorites = useStore((s) => s.loraFavorites)
  const recommendation = useStore((s) => s.recommendation)
  const status = useStore((s) => s.forgeStatus)
  const openCivitaiSearch = useStore((s) => s.openCivitaiSearch)

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterId>('all')
  const [importing, setImporting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [importMenuOpen, setImportMenuOpen] = useState(false)
  const t = useT()

  useEffect(() => {
    if (loadedOnce || status.kind !== 'ready' || loras.length > 0) return
    let cancelled = false
    setRefreshing(true)
    api.forge.listLoras()
      .then((updated) => {
        if (!cancelled) {
          setLoras(updated)
          setLoadedOnce(true)
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setRefreshing(false)
      })
    return () => { cancelled = true }
  }, [loadedOnce, status.kind, loras.length, setLoras])

  // Background fetch metadata for currently visible LoRAs so the "compatible"
  // filter has something to work with. Throttled to 4 concurrent requests so
  // we don't hit Civitai rate limits if the user has many LoRAs.
  useEffect(() => {
    if (loras.length === 0) return
    const queue = loras.filter((l) => !loraMeta.has(l.name)).slice(0, 30)
    let cancelled = false
    let active = 0
    const next = async (): Promise<void> => {
      if (cancelled) return
      const lora = queue.shift()
      if (!lora) return
      active++
      try {
        const m = await api.civitai.lookupLora(lora)
        if (m && !cancelled) useStore.getState().upsertLoraMeta(lora.name, m)
      } catch { /* swallow — lookups are best-effort */ }
      active--
      if (!cancelled) void next()
    }
    for (let i = 0; i < 4; i++) void next()
    return () => { cancelled = true }
  }, [loras])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return loras.filter((l) => {
      if (q && !(`${l.alias} ${l.name}`.toLowerCase().includes(q) ||
                 (loraMeta.get(l.name)?.trainedWords ?? []).some((t) => t.toLowerCase().includes(q)) ||
                 (loraMeta.get(l.name)?.modelName ?? '').toLowerCase().includes(q))) {
        return false
      }
      if (filter === 'favorites' && !favorites.has(l.name)) return false
      if (filter === 'active' && !activeLoras.some((a) => a.name === l.name)) return false
      if (filter === 'compatible') {
        const cBase = recommendation?.baseModel
        const lBase = loraMeta.get(l.name)?.baseModel
        if (cBase && lBase && !baseModelsCompatible(cBase, lBase)) return false
        if (cBase && !lBase) return true // unknown — don't exclude
      }
      return true
    })
  }, [loras, query, filter, favorites, activeLoras, loraMeta, recommendation])

  async function refresh(): Promise<void> {
    if (status.kind !== 'ready') return
    setRefreshing(true)
    try {
      await api.forge.refreshLoras()
      const updated = await api.forge.listLoras()
      setLoras(updated)
      toast.success(tStatic('lp.refreshSuccess'))
    } catch (e) {
      toast.error(tStatic('toast.refreshFailed', { message: (e as Error).message }))
    } finally {
      setRefreshing(false)
    }
  }

  async function importLoras(mode: 'copy' | 'move'): Promise<void> {
    if (status.kind !== 'ready') {
      toast.error(tStatic('toast.waitForge'))
      return
    }
    setImporting(true)
    try {
      const r = await api.forge.importLoras({ mode })
      if (!r) return
      const updated = await api.forge.listLoras()
      setLoras(updated)
      const action = mode === 'move' ? tStatic('toast.actionMoved') : tStatic('toast.actionCopied')
      if (r.imported.length > 0 && r.skipped.length === 0) {
        toast.success(tStatic('lp.importedCount', { count: r.imported.length, action }))
      } else if (r.imported.length > 0) {
        toast.success(tStatic('toast.importedPartial', { count: r.imported.length, action, skipped: r.skipped.length }))
      } else if (r.skipped.length > 0) {
        toast.error(tStatic('toast.skipped', { reasons: r.skipped.map((s) => s.reason).join(' / ') }))
      }
    } catch (e) {
      toast.error(tStatic('toast.importFailed', { message: (e as Error).message }))
    } finally {
      setImporting(false)
    }
  }

  if (status.kind !== 'ready') {
    return (
      <div className="p-4 text-sm text-ink-3 text-center">
        {t('toast.waitForge')}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-line shrink-0 space-y-1.5">
        <div className="flex gap-1">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-3" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('lp.searchPlaceholder')}
              className="input pl-7 text-xs"
            />
          </div>
          <button
            className="btn btn-ghost btn-icon"
            onClick={refresh}
            disabled={refreshing}
            title={t('lp.refreshTitle')}
          >
            <RefreshCcw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
          </button>
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => openCivitaiSearch('LORA')}
            title={t('lp.civitaiSearchTitle')}
          >
            <Globe className="h-3.5 w-3.5" />
          </button>
          <div className="relative">
            <button
              className="btn text-[11px] py-0.5 px-2 gap-1"
              disabled={importing}
              onClick={() => importLoras('copy')}
              title={t('lp.importCopyTitle')}
            >
              <FolderInput className="h-3 w-3" />
              {t('lp.import')}
            </button>
            <button
              className="btn rounded-l-none btn-icon py-0.5 absolute -right-5 top-0"
              disabled={importing}
              onClick={() => setImportMenuOpen((o) => !o)}
              aria-label={t('titlebar.moreImport')}
            >
              <ChevronDown className="h-3 w-3" />
            </button>
            {importMenuOpen && (
              <div
                className="absolute top-full mt-1 right-0 w-48 z-20 card shadow-xl"
                onMouseLeave={() => setImportMenuOpen(false)}
              >
                <button
                  className="w-full text-left px-3 py-2 text-xs hover:bg-bg-3"
                  onClick={() => { setImportMenuOpen(false); importLoras('move') }}
                >
                  {t('titlebar.importMoveAction')}
                </button>
                <div className="border-t border-line" />
                <button
                  className="w-full text-left px-3 py-2 text-xs hover:bg-bg-3 flex items-center gap-1.5"
                  onClick={() => { setImportMenuOpen(false); api.forge.openLorasFolder() }}
                >
                  <FolderOpen className="h-3 w-3" />
                  {t('lp.openFolder')}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded border',
                filter === f.id
                  ? 'border-accent bg-accent-dim/40 text-ink-0'
                  : 'border-line text-ink-2 hover:bg-bg-3'
              )}
            >
              {f.id === 'favorites' && <Star className="h-2.5 w-2.5 inline mr-0.5" />}
              {t(f.labelKey)}
            </button>
          ))}
          <span className="ml-auto text-[10px] text-ink-3 font-mono">
            {filtered.length} / {loras.length}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {loras.length === 0 ? (
          <div className="text-center p-6 space-y-3">
            <div className="text-sm text-ink-2">{t('lp.empty')}</div>
            <div className="text-xs text-ink-3 leading-relaxed">
              {t('lp.emptyHint1')}<br />
              <code className="font-mono text-[10px]">webui/models/Lora/</code> {t('lp.emptyHint2')}
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-ink-3 text-center p-6">{t('lp.noResults')}</div>
        ) : (
          <div className="grid grid-cols-1 gap-1.5">
            {filtered.map((l) => (
              <LoraCard key={l.name} lora={l} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
