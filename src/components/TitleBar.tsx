import { useState } from 'react'
import {
  RefreshCcw,
  Settings as SettingsIcon,
  Power,
  ChevronDown,
  FolderInput,
  FolderOpen,
  HelpCircle,
  Globe,
  ExternalLink
} from 'lucide-react'
import type { CivitaiAssetType } from '@shared/types'
import toast from 'react-hot-toast'
import { useStore } from '@/lib/store'
import { api } from '@/lib/ipc'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { StatusDot, statusLabel } from './StatusDot'
import { BrokenExtensionsButton } from './BrokenExtensionsButton'

interface Props {
  onOpenSettings(): void
  onOpenShortcuts(): void
  onOpenCivitaiSearch(type?: CivitaiAssetType | null): void
  onModelChanged(title: string): void
}

export function TitleBar({
  onOpenSettings,
  onOpenShortcuts,
  onOpenCivitaiSearch,
  onModelChanged
}: Props): JSX.Element {
  const status = useStore((s) => s.forgeStatus)
  const models = useStore((s) => s.models)
  const selected = useStore((s) => s.selectedModelTitle)
  const setModels = useStore((s) => s.setModels)
  const modelUpdates = useStore((s) => s.modelUpdates)
  const t = useT()

  const [refreshing, setRefreshing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [open, setOpen] = useState(false)

  async function refresh(): Promise<void> {
    if (status.kind !== 'ready') return
    setRefreshing(true)
    try {
      await api.forge.refreshModels()
      const updated = await api.forge.listModels()
      setModels(updated)
      const current = useStore.getState().selectedModelTitle
      if (updated.length > 0 && (!current || !updated.some((model) => model.title === current))) {
        onModelChanged(updated[0].title)
      }
      toast.success(t('toast.modelsRefreshed'))
    } catch (e) {
      toast.error(t('toast.refreshFailed', { message: (e as Error).message }))
    } finally {
      setRefreshing(false)
    }
  }

  async function importModels(mode: 'copy' | 'move'): Promise<void> {
    if (status.kind !== 'ready') {
      toast.error(t('toast.waitForge'))
      return
    }
    setImporting(true)
    try {
      const r = await api.forge.importModels({ mode })
      if (!r) return // cancelled
      const updated = await api.forge.listModels()
      setModels(updated)
      const current = useStore.getState().selectedModelTitle
      if (updated.length > 0 && (!current || !updated.some((model) => model.title === current))) {
        onModelChanged(updated[0].title)
      }
      const action = mode === 'move' ? t('toast.actionMoved') : t('toast.actionCopied')
      if (r.imported.length > 0 && r.skipped.length === 0) {
        toast.success(t('toast.imported', { count: r.imported.length, action }))
      } else if (r.imported.length > 0 && r.skipped.length > 0) {
        toast.success(t('toast.importedPartial', { count: r.imported.length, action, skipped: r.skipped.length }))
      } else if (r.skipped.length > 0) {
        toast.error(t('toast.skipped', { reasons: r.skipped.map((s) => s.reason).join(' / ') }))
      }
    } catch (e) {
      toast.error(t('toast.importFailed', { message: (e as Error).message }))
    } finally {
      setImporting(false)
    }
  }

  async function toggleForge(): Promise<void> {
    if (status.kind === 'ready' || status.kind === 'starting') {
      await api.forge.stop()
    } else {
      await api.forge.start()
    }
  }

  return (
    <header className="flex items-center gap-2 h-11 px-3 bg-bg-1 border-b border-line shrink-0">
      <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-bg-2 border border-line">
        <StatusDot status={status} />
        <span className="text-xs text-ink-1">{statusLabel(status, t)}</span>
        <button
          className="btn btn-ghost btn-icon ml-1"
          onClick={toggleForge}
          title={status.kind === 'ready' ? t('forge.toggleStop') : t('forge.toggleStart')}
        >
          <Power className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="relative">
        <button
          className="btn"
          onClick={() => setOpen(!open)}
          disabled={status.kind !== 'ready'}
        >
          <span className="text-xs text-ink-2 mr-1">{t('titlebar.model')}</span>
          <span className="font-mono text-xs truncate max-w-[280px]">
            {selected || t('titlebar.modelNotSelected')}
          </span>
          <ChevronDown className="h-3.5 w-3.5 ml-1" />
        </button>
        {open && (
          <div
            className="absolute top-full mt-1 left-0 w-[420px] max-h-[420px] overflow-auto z-50 card shadow-xl"
            onMouseLeave={() => setOpen(false)}
          >
            {models.length === 0 ? (
              <div className="p-3 text-sm text-ink-2">{t('titlebar.noModels')}</div>
            ) : (
              models.map((m) => {
                const updateInfo = m.sha256 ? modelUpdates.get(m.sha256) : undefined
                return (
                  <button
                    key={m.title}
                    className={cn(
                      'w-full text-left px-3 py-2 text-sm hover:bg-bg-3 transition-colors',
                      selected === m.title && 'bg-bg-3 text-accent'
                    )}
                    onClick={() => {
                      setOpen(false)
                      onModelChanged(m.title)
                    }}
                    title={updateInfo ? t('titlebar.modelUpdateTooltip', { name: updateInfo.newVersionName }) : undefined}
                  >
                    <div className="flex items-center gap-1">
                      <span className="font-mono truncate flex-1">{m.modelName}</span>
                      {updateInfo && (
                        <span
                          className="text-[9px] px-1 py-0.5 rounded bg-warn/30 border border-warn text-warn font-bold shrink-0"
                          title={t('titlebar.modelUpdateTooltip2', { name: updateInfo.newVersionName })}
                        >
                          {t('titlebar.modelUpdateBadge')}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-ink-3 font-mono">
                      {m.hash || '—'}
                    </div>
                  </button>
                )
              })
            )}
          </div>
        )}
      </div>

      <button
        className="btn btn-ghost btn-icon"
        onClick={refresh}
        disabled={refreshing || status.kind !== 'ready'}
        title={t('titlebar.refresh')}
      >
        <RefreshCcw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
      </button>

      <ImportSplitButton
        disabled={importing || status.kind !== 'ready'}
        onCopy={() => importModels('copy')}
        onMove={() => importModels('move')}
        onOpenFolder={() => api.forge.openModelsFolder()}
      />

      <button
        className="btn gap-1.5"
        onClick={() => onOpenCivitaiSearch(null)}
        title={t('titlebar.civitai')}
      >
        <Globe className="h-3.5 w-3.5" />
        <span className="text-xs">Civitai</span>
      </button>

      <ExternalLinksMenu />

      <div className="flex-1" />

      <BrokenExtensionsButton />
      <button
        className="btn btn-ghost btn-icon"
        onClick={onOpenShortcuts}
        title={t('titlebar.shortcuts')}
      >
        <HelpCircle className="h-4 w-4" />
      </button>
      <button className="btn btn-ghost btn-icon" onClick={onOpenSettings} title={t('titlebar.settings')}>
        <SettingsIcon className="h-4 w-4" />
      </button>
    </header>
  )
}

interface SiteLink {
  /** i18n key for the hint (resolved via useT in render). */
  hintKey: string
  label: string
  url: string
}

const EXTERNAL_SITES: SiteLink[] = [
  { label: 'Civitai',       url: 'https://civitai.com',                                  hintKey: 'ext.civitai' },
  { label: 'Civitai Red',   url: 'https://civitai.com/?view=red',                        hintKey: 'ext.civitaiRed' },
  { label: 'Civitai Green', url: 'https://civitai.green',                                hintKey: 'ext.civitaiGreen' },
  { label: 'HuggingFace',   url: 'https://huggingface.co/models?other=stable-diffusion', hintKey: 'ext.huggingface' },
  { label: 'aipictors',     url: 'https://www.aipictors.com',                            hintKey: 'ext.aipictors' },
  { label: 'Lexica.art',    url: 'https://lexica.art',                                   hintKey: 'ext.lexica' }
]

/**
 * Quick-access launcher for external reference sites — model hubs, image
 * galleries, prompt databases. Just navigation: opens the link in the user's
 * default browser, no scraping or in-app rendering.
 */
function ExternalLinksMenu(): JSX.Element {
  const [open, setOpen] = useState(false)
  const t = useT()
  return (
    <div className="relative">
      <button
        className="btn btn-ghost btn-icon"
        onClick={() => setOpen((o) => !o)}
        title={t('titlebar.openExternalSites')}
      >
        <ExternalLink className="h-4 w-4" />
      </button>
      {open && (
        <div
          className="absolute top-full mt-1 right-0 w-64 z-50 card shadow-2xl"
          onMouseLeave={() => setOpen(false)}
        >
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-ink-3 border-b border-line">
            {t('titlebar.externalSites')}
          </div>
          {EXTERNAL_SITES.map((s) => (
            <button
              key={s.url}
              className="w-full text-left px-3 py-2 hover:bg-bg-3 transition-colors"
              onClick={() => { setOpen(false); api.app.openExternal(s.url) }}
              title={s.url}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-ink-0">{s.label}</span>
                <ExternalLink className="h-3 w-3 text-ink-3 ml-auto" />
              </div>
              <div className="text-[10px] text-ink-3 mt-0.5">{t(s.hintKey)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface ImportSplitProps {
  disabled: boolean
  onCopy(): void
  onMove(): void
  onOpenFolder(): void
}

/** Split button — primary action copies, dropdown reveals "move" + "open folder". */
function ImportSplitButton({ disabled, onCopy, onMove, onOpenFolder }: ImportSplitProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const t = useT()
  return (
    <div className="relative">
      <div className="flex">
        <button
          className="btn rounded-r-none border-r-0 gap-1.5"
          disabled={disabled}
          onClick={onCopy}
          title={t('titlebar.importCopy')}
        >
          <FolderInput className="h-3.5 w-3.5" />
          <span className="text-xs">{t('titlebar.importLabel')}</span>
        </button>
        <button
          className="btn rounded-l-none btn-icon"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          aria-label={t('titlebar.moreImport')}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && (
        <div
          className="absolute top-full mt-1 right-0 w-56 z-50 card shadow-xl"
          onMouseLeave={() => setOpen(false)}
        >
          <button
            className="w-full text-left px-3 py-2 text-sm hover:bg-bg-3 flex items-center gap-2"
            onClick={() => { setOpen(false); onMove() }}
          >
            <FolderInput className="h-3.5 w-3.5" />
            <span>{t('titlebar.importMoveAction')}</span>
          </button>
          <div className="border-t border-line" />
          <button
            className="w-full text-left px-3 py-2 text-sm hover:bg-bg-3 flex items-center gap-2"
            onClick={() => { setOpen(false); onOpenFolder() }}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            <span>{t('titlebar.openModelsFolder')}</span>
          </button>
        </div>
      )}
    </div>
  )
}
