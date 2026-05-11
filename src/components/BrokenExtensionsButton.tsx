import { useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore } from '@/lib/store'
import { api } from '@/lib/ipc'
import { useT } from '@/lib/i18n'

/**
 * Title-bar warning button for Forge extensions that crashed during startup.
 *
 * Why: Forge prints "*** Error calling: ...extensions\<name>\..." when an
 * extension's UI/API hook throws — but Forge keeps running and the user
 * usually doesn't notice. The broken extension can quietly degrade Forge
 * (e.g., the easy_prompt_selector trace blocks /sdapi/v1/* mount sometimes).
 *
 * The button only renders when at least one broken extension was detected.
 * Clicking shows the list with a one-click disable that renames
 * `extensions/<name>` → `extensions/<name>.disabled`. Forge needs a restart
 * to actually unload the extension.
 */
export function BrokenExtensionsButton(): JSX.Element | null {
  const status = useStore((s) => s.forgeStatus)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const t = useT()

  const broken = status.kind === 'ready' ? status.brokenExtensions : []
  const visible = broken.filter((b) => !dismissed.has(b))

  if (visible.length === 0) return null

  async function disable(name: string): Promise<void> {
    if (busy) return
    setBusy(name)
    try {
      await api.forge.disableExtension(name)
      setDismissed((prev) => new Set(prev).add(name))
      toast.success(t('ext.disableSuccess', { name }), { duration: 5000 })
    } catch (e) {
      toast.error(t('ext.disableFail', { message: (e as Error).message }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="relative">
      <button
        className="btn btn-ghost btn-icon text-warn relative"
        onClick={() => setOpen((o) => !o)}
        title={t('ext.detected', { count: visible.length })}
      >
        <AlertTriangle className="h-4 w-4" />
        <span className="absolute -top-0.5 -right-0.5 bg-warn text-bg-0 text-[9px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center">
          {visible.length}
        </span>
      </button>
      {open && (
        <div
          className="absolute top-full mt-1 right-0 w-[360px] z-50 card shadow-2xl"
          onMouseLeave={() => setOpen(false)}
        >
          <div className="px-3 py-2 border-b border-line flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-warn" />
            <span className="text-xs font-medium">{t('ext.errorOnStart')}</span>
          </div>
          <div className="max-h-[280px] overflow-y-auto">
            {visible.map((name) => (
              <div
                key={name}
                className="px-3 py-2 border-b border-line last:border-b-0 flex items-center gap-2"
              >
                <span className="font-mono text-xs text-ink-1 flex-1 truncate" title={name}>
                  {name}
                </span>
                <button
                  className="btn btn-ghost text-[11px] py-0.5 px-1.5 hover:!text-ink-2"
                  onClick={() => setDismissed((prev) => new Set(prev).add(name))}
                  title={t('ext.dismissThisSession')}
                >
                  <X className="h-3 w-3" />
                </button>
                <button
                  className="btn text-[11px] py-0.5 px-2"
                  disabled={busy !== null}
                  onClick={() => disable(name)}
                >
                  {busy === name ? '…' : t('common.disable')}
                </button>
              </div>
            ))}
          </div>
          <div className="px-3 py-2 text-[10px] text-ink-3 border-t border-line leading-relaxed">
            {t('ext.disableHint')}
          </div>
        </div>
      )}
    </div>
  )
}
