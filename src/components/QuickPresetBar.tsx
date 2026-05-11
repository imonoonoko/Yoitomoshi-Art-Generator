import { useState } from 'react'
import { Plus, X, Check, Eye, EyeOff, Settings2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore } from '@/lib/store'
import { api } from '@/lib/ipc'
import { useT, t as tStatic } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { promptAppend, promptContains, promptRemove } from '@/lib/prompt-utils'

interface Props {
  target: 'positive' | 'negative'
  /** Current text of the textarea this bar is attached to. */
  value: string
  onChange(v: string): void
}

/**
 * A toggleable row of small "quick preset" chips above each prompt textarea.
 * Each chip represents a snippet (e.g. "masterpiece, best quality, ..."). Click
 * to splice it in; click again to remove. The user can also save the current
 * highlighted text as a new preset via the "+" button.
 *
 * Visual rationale: chips are kept compact and don't wrap aggressively — the
 * goal is a fast scan, not a comprehensive list. Power users with lots of
 * custom presets can hide built-ins they don't use.
 */
export function QuickPresetBar({ target, value, onChange }: Props): JSX.Element {
  const all = useStore((s) => s.quickPresets)
  const setAll = useStore((s) => s.setQuickPresets)
  const hidden = useStore((s) => s.hiddenQuickPresetIds)
  const toggleHidden = useStore((s) => s.toggleHiddenQuickPreset)

  const presetsForTarget = all.filter((p) => p.target === target)
  const visiblePresets = presetsForTarget.filter((p) => !hidden.has(p.id))
  const hiddenCount = presetsForTarget.length - visiblePresets.length

  const [adding, setAdding] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [manageOpen, setManageOpen] = useState(false)
  const t = useT()

  async function persistHidden(): Promise<void> {
    const next = useStore.getState().hiddenQuickPresetIds
    try {
      await api.storage.setHiddenQuickPresets(Array.from(next))
    } catch (e) {
      toast.error(tStatic('pl.toastSaveFailed', { message: (e as Error).message }))
    }
  }

  function flipHidden(id: string): void {
    toggleHidden(id)
    setTimeout(() => { void persistHidden() }, 0)
  }

  function toggle(text: string): void {
    if (promptContains(value, text)) {
      onChange(promptRemove(value, text))
    } else {
      onChange(promptAppend(value, text))
    }
  }

  async function saveCurrent(): Promise<void> {
    if (!draftName.trim()) {
      toast.error(tStatic('qp.nameRequired'))
      return
    }
    if (!value.trim()) {
      toast.error(tStatic('qp.promptEmpty'))
      return
    }
    try {
      const created = await api.storage.saveQuickPreset({
        name: draftName.trim(),
        text: value.trim(),
        target,
        order: 50
      })
      setAll([...all.filter((p) => p.id !== created.id), created])
      setDraftName('')
      setAdding(false)
      toast.success(tStatic('qp.saved'))
    } catch (e) {
      toast.error(tStatic('pl.toastSaveFailed', { message: (e as Error).message }))
    }
  }

  async function deletePreset(id: string): Promise<void> {
    try {
      await api.storage.deleteQuickPreset(id)
      setAll(all.filter((p) => p.id !== id))
    } catch (e) {
      toast.error(tStatic('qp.deleteFailed', { message: (e as Error).message }))
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1 relative">
      {visiblePresets.map((p) => {
        const active = promptContains(value, p.text)
        return (
          <div key={p.id} className="relative group">
            <button
              type="button"
              onClick={() => toggle(p.text)}
              className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border transition-all',
                active
                  ? target === 'positive'
                    ? 'bg-accent-dim/50 border-accent text-ink-0'
                    : 'bg-err/30 border-err/60 text-ink-0'
                  : 'border-line text-ink-2 hover:bg-bg-3 hover:text-ink-1'
              )}
              title={p.text}
            >
              {active && <Check className="h-3 w-3" />}
              <span>{p.name}</span>
            </button>
            <button
              type="button"
              onClick={() => flipHidden(p.id)}
              className="absolute -top-1 -right-1 hidden group-hover:flex h-3.5 w-3.5 items-center justify-center rounded-full bg-bg-3 border border-line text-ink-2 hover:bg-bg-4 hover:text-ink-0"
              title={t('qp.hideThis')}
            >
              <EyeOff className="h-2.5 w-2.5" />
            </button>
            {!p.builtIn && (
              <button
                type="button"
                onClick={() => deletePreset(p.id)}
                className="absolute -top-1 right-3 hidden group-hover:flex h-3.5 w-3.5 items-center justify-center rounded-full bg-bg-3 border border-line text-ink-2 hover:bg-err/40 hover:text-ink-0"
                title={t('qp.deleteThis')}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
        )
      })}

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setManageOpen((o) => !o)}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] text-ink-3 hover:text-ink-1 hover:bg-bg-3"
          title={t('qp.manageHidden')}
        >
          <Settings2 className="h-3 w-3" />
          {t('qp.hiddenCount', { count: hiddenCount })}
        </button>
      )}

      {manageOpen && (
        <div
          className="absolute top-full mt-1 left-0 z-30 card shadow-2xl w-72 max-h-[260px] overflow-y-auto"
          onMouseLeave={() => setManageOpen(false)}
        >
          <div className="px-2 py-1.5 border-b border-line text-[11px] text-ink-2">
            {t(target === 'positive' ? 'qp.posPresets' : 'qp.negPresets')}
          </div>
          {presetsForTarget.map((p) => {
            const isHidden = hidden.has(p.id)
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => flipHidden(p.id)}
                className="w-full text-left flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-bg-3"
                title={p.text}
              >
                {isHidden ? (
                  <EyeOff className="h-3 w-3 text-ink-3" />
                ) : (
                  <Eye className="h-3 w-3 text-accent" />
                )}
                <span className={cn('flex-1 truncate', isHidden && 'text-ink-3')}>{p.name}</span>
                {p.builtIn && <span className="text-[9px] text-ink-3 font-mono">{t('qp.builtin')}</span>}
              </button>
            )
          })}
        </div>
      )}

      {adding ? (
        <div className="inline-flex items-center gap-1">
          <input
            autoFocus
            className="input text-xs py-0.5 w-32"
            placeholder={t('qp.namePlaceholder')}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveCurrent()
              if (e.key === 'Escape') { setAdding(false); setDraftName('') }
            }}
          />
          <button className="btn btn-primary text-[11px] py-0.5 px-1.5" onClick={saveCurrent}>
            {t('common.save')}
          </button>
          <button
            className="btn btn-ghost text-[11px] py-0.5 px-1.5"
            onClick={() => { setAdding(false); setDraftName('') }}
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] text-ink-3 hover:text-ink-1 hover:bg-bg-3"
          onClick={() => setAdding(true)}
          title={t('qp.savePromptAsPreset')}
        >
          <Plus className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
