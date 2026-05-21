import { useState } from 'react'
import { Save, Trash2, Copy } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore } from '@/lib/store'
import { api } from '@/lib/ipc'
import { useT, t as tStatic } from '@/lib/i18n'
import { WorkspaceCard } from './ToolsWorkspace'

export function PresetList(): JSX.Element {
  const presets = useStore((s) => s.presets)
  const setPresets = useStore((s) => s.setPresets)
  const prompt = useStore((s) => s.prompt)
  const negative = useStore((s) => s.negativePrompt)
  const setPrompt = useStore((s) => s.setPrompt)
  const setNeg = useStore((s) => s.setNegativePrompt)
  const t = useT()

  const [name, setName] = useState('')

  async function save(): Promise<void> {
    if (!name.trim()) {
      toast.error(tStatic('preset.nameRequired'))
      return
    }
    if (!prompt.trim()) {
      toast.error(tStatic('preset.promptEmpty'))
      return
    }
    const created = await api.storage.savePreset({
      name: name.trim(),
      prompt,
      negativePrompt: negative
    })
    setPresets([created, ...presets.filter((p) => p.id !== created.id)])
    setName('')
    toast.success(tStatic('preset.saved'))
  }

  async function remove(id: string): Promise<void> {
    await api.storage.deletePreset(id)
    setPresets(presets.filter((p) => p.id !== id))
  }

  function load(id: string): void {
    const p = presets.find((x) => x.id === id)
    if (!p) return
    setPrompt(p.prompt)
    setNeg(p.negativePrompt)
    toast.success(tStatic('preset.loaded', { name: p.name }))
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="border-b border-line p-2">
          <WorkspaceCard compact />
        </div>

        <div className="border-b border-line p-2">
          <div className="mb-2 text-xs font-semibold text-ink-1">{t('preset.promptSection')}</div>
          <div className="flex gap-1.5">
            <input
              className="input flex-1 text-xs"
              placeholder={t('preset.namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save()
              }}
            />
            <button className="btn btn-primary" onClick={() => { void save() }} title={t('preset.saveTitle')}>
              <Save className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {presets.length === 0 ? (
          <div className="p-4 text-sm text-ink-3 text-center">
            {t('preset.empty')}
          </div>
        ) : (
          presets.map((p) => (
            <div key={p.id} className="border-b border-line p-2 hover:bg-bg-3 transition-colors group">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => load(p.id)}
                  className="flex-1 text-left text-sm font-medium truncate"
                  title={t('preset.loadTitle')}
                >
                  {p.name}
                </button>
                <button
                  className="btn btn-icon btn-ghost opacity-0 group-hover:opacity-100"
                  onClick={() => navigator.clipboard.writeText(p.prompt)}
                  title={t('preset.copyPrompt')}
                >
                  <Copy className="h-3 w-3" />
                </button>
                <button
                  className="btn btn-icon btn-ghost opacity-0 group-hover:opacity-100 hover:!bg-err/30"
                  onClick={() => remove(p.id)}
                  title={t('preset.delete')}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              <div className="text-xs text-ink-3 truncate font-mono mt-0.5">
                {p.prompt}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
