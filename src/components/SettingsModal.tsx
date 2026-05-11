import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore } from '@/lib/store'
import { api } from '@/lib/ipc'
import { useT, LANGUAGES } from '@/lib/i18n'
import type { AppSettings, UiLanguage } from '@shared/types'

interface Props {
  open: boolean
  onClose(): void
}

export function SettingsModal({ open, onClose }: Props): JSX.Element | null {
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const t = useT()

  const [draft, setDraft] = useState<AppSettings | null>(settings)

  useEffect(() => {
    if (open) setDraft(settings)
  }, [open, settings])

  if (!open || !draft) return null

  async function pickForge(): Promise<void> {
    if (!draft) return
    const dir = await api.app.selectDirectory()
    if (dir) setDraft({ ...draft, forgePath: dir })
  }

  async function save(): Promise<void> {
    if (!draft) return
    await api.storage.setSettings(draft)
    setSettings(draft)
    toast.success(t('settings.savedToast'))
    onClose()
  }

  return (
    <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center p-8">
      <div className="card max-w-2xl w-full">
        <div className="flex items-center justify-between p-4 border-b border-line">
          <h2 className="text-base font-semibold">{t('settings.title')}</h2>
          <button className="btn btn-icon btn-ghost" onClick={onClose}><X className="h-4 w-4" /></button>
        </div>

        <div className="p-4 space-y-4">
          <label className="block space-y-1.5">
            <span className="label">{t('settings.language')}</span>
            <select
              className="input"
              value={draft.uiLanguage}
              onChange={(e) => setDraft({ ...draft, uiLanguage: e.target.value as UiLanguage })}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="label">{t('settings.forgePath')}</span>
            <div className="flex gap-1.5">
              <input
                className="input flex-1 font-mono text-xs"
                value={draft.forgePath}
                onChange={(e) => setDraft({ ...draft, forgePath: e.target.value })}
              />
              <button className="btn" onClick={pickForge}>{t('common.select')}</button>
            </div>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1.5">
              <span className="label">{t('settings.forgePort')}</span>
              <input
                className="input"
                type="number"
                value={draft.forgePort}
                onChange={(e) => setDraft({ ...draft, forgePort: parseInt(e.target.value, 10) })}
              />
            </label>
            <label className="flex items-center gap-2 mt-6">
              <input
                type="checkbox"
                checked={draft.autoStartForge}
                onChange={(e) => setDraft({ ...draft, autoStartForge: e.target.checked })}
              />
              <span className="text-sm">{t('settings.autoStart')}</span>
            </label>
          </div>

          <label className="block space-y-1.5">
            <span className="label">{t('settings.extraArgs')}</span>
            <input
              className="input font-mono text-xs"
              value={draft.forgeExtraArgs}
              onChange={(e) => setDraft({ ...draft, forgeExtraArgs: e.target.value })}
              placeholder="--medvram --xformers"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="label">{t('settings.civitaiKey')}</span>
            <input
              className="input font-mono text-xs"
              value={draft.civitaiApiKey ?? ''}
              onChange={(e) => setDraft({ ...draft, civitaiApiKey: e.target.value || null })}
              placeholder={t('settings.civitaiKeyPlaceholder')}
            />
            <span className="text-[11px] text-ink-3">
              {t('settings.civitaiKeyHint')}
            </span>
          </label>
        </div>

        <div className="p-4 border-t border-line flex justify-end gap-2">
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={save}>{t('common.save')}</button>
        </div>
      </div>
    </div>
  )
}
