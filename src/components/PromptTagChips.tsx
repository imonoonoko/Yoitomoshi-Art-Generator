import { ArrowRightLeft, BookmarkPlus, Check, GripVertical, Minus, Plus, Rows3, ScanLine, Square, X } from 'lucide-react'
import { useEffect, useState, type MouseEventHandler, type ReactNode } from 'react'
import toast from 'react-hot-toast'
import { useStore } from '@/lib/store'
import { api } from '@/lib/ipc'
import {
  adjustPromptTokensByIndexes,
  adjustTokenWeight,
  cleanPromptTokenForMatch,
  dedupePromptTokens,
  removePromptToken,
  removePromptTokensByIndexes,
  reorderPromptToken,
  splitPromptTokensWithRanges,
  type PromptTokenRange
} from '@/lib/prompt-utils'
import { useT, t as tStatic } from '@/lib/i18n'
import { cn } from '@/lib/utils'

interface Props {
  target: 'positive' | 'negative'
  value: string
  onChange(v: string): void
  onMoveTokens(tokens: string[]): void
}

export function PromptTagChips({ target, value, onChange, onMoveTokens }: Props): JSX.Element | null {
  const autocomplete = useStore((s) => s.autocomplete)
  const quickPresets = useStore((s) => s.quickPresets)
  const setQuickPresets = useStore((s) => s.setQuickPresets)
  const tokens = splitPromptTokensWithRanges(value)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(new Set())
  const [savingSelection, setSavingSelection] = useState(false)
  const [selectionName, setSelectionName] = useState('')
  const selectedTokens = tokens.filter((_token, index) => selectedIndexes.has(index))
  const selectedCount = selectedTokens.length
  const t = useT()

  useEffect(() => {
    setSelectedIndexes((prev) => {
      const next = new Set([...prev].filter((index) => index >= 0 && index < tokens.length))
      return next.size === prev.size ? prev : next
    })
  }, [tokens.length, value])

  if (tokens.length === 0) return null

  function adjust(token: PromptTokenRange, delta: number): void {
    const caret = token.start + Math.floor(token.text.length / 2)
    onChange(adjustTokenWeight(value, caret, delta).prompt)
  }

  function dedupe(): void {
    const result = dedupePromptTokens(value)
    if (result.removed === 0) {
      toast(tStatic('promptTags.noDuplicates'), { icon: 'i' })
      return
    }
    onChange(result.prompt)
    setSelectedIndexes(new Set())
    toast.success(tStatic('promptTags.duplicatesRemoved', { count: result.removed }))
  }

  function reorder(fromIndex: number | null, toIndex: number): void {
    if (fromIndex === null || fromIndex === toIndex) return
    onChange(reorderPromptToken(value, fromIndex, toIndex))
    setSelectedIndexes(new Set())
    toast.success(tStatic('promptTags.reordered'))
  }

  function toggleSelection(index: number): void {
    setSelectedIndexes((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  function clearSelection(): void {
    setSelectedIndexes(new Set())
    setSavingSelection(false)
    setSelectionName('')
  }

  function selectAll(): void {
    setSelectedIndexes(new Set(tokens.map((_token, index) => index)))
  }

  function selectedPromptText(): string {
    return selectedTokens.map((token) => token.text).join(', ')
  }

  function adjustSelected(delta: number): void {
    if (selectedCount === 0) return
    onChange(adjustPromptTokensByIndexes(value, selectedIndexes, delta))
    toast.success(tStatic('promptTags.batchWeightAdjusted', { count: selectedCount }))
  }

  function removeSelected(): void {
    if (selectedCount === 0) return
    onChange(removePromptTokensByIndexes(value, selectedIndexes))
    toast.success(tStatic('promptTags.selectedRemoved', { count: selectedCount }))
    clearSelection()
  }

  function moveOne(token: PromptTokenRange, index: number): void {
    onChange(removePromptToken(value, token))
    onMoveTokens([token.text])
    clearSelection()
  }

  function moveSelected(): void {
    if (selectedCount === 0) return
    const texts = selectedTokens.map((token) => token.text)
    onChange(removePromptTokensByIndexes(value, selectedIndexes))
    onMoveTokens(texts)
    toast.success(tStatic('promptTags.selectedMoved', { count: selectedCount }))
    clearSelection()
  }

  async function saveSelectedAsQuickPreset(): Promise<void> {
    const name = selectionName.trim()
    if (!name) {
      toast.error(tStatic('promptTags.selectionNameRequired'))
      return
    }
    if (selectedCount === 0) return
    try {
      const created = await api.storage.saveQuickPreset({
        name,
        text: selectedPromptText(),
        target,
        order: 60
      })
      setQuickPresets([...quickPresets.filter((preset) => preset.id !== created.id), created])
      toast.success(tStatic('promptTags.selectionSaved'))
      clearSelection()
    } catch (e) {
      toast.error(tStatic('pl.toastSaveFailed', { message: (e as Error).message }))
    }
  }

  return (
    <section className="rounded-md border border-line/70 bg-bg-0/50 p-2">
      <div className="mb-1.5 flex items-center gap-1.5">
        <Rows3 className="h-3.5 w-3.5 text-accent" />
        <span className="label normal-case tracking-normal">{t('promptTags.title')}</span>
        <span className="rounded bg-bg-3 px-1.5 py-0.5 font-mono text-[10px] text-ink-3">{tokens.length}</span>
        <button
          type="button"
          className="btn btn-icon btn-ghost ml-auto h-6 w-6"
          onClick={selectAll}
          title={t('promptTags.selectAll')}
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="btn btn-icon btn-ghost h-6 w-6"
          onClick={dedupe}
          title={t('promptTags.dedupe')}
        >
          <ScanLine className="h-3.5 w-3.5" />
        </button>
      </div>

      {selectedCount > 0 && (
        <div className="mb-1.5 flex flex-wrap items-center gap-1 rounded bg-bg-2 px-1.5 py-1">
          <span className="mr-0.5 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
            {t('promptTags.selected', { count: selectedCount })}
          </span>
          <ToolbarButton title={t('promptTags.batchWeightDown')} onClick={() => adjustSelected(-0.1)}>
            <Minus className="h-3 w-3" />
          </ToolbarButton>
          <ToolbarButton title={t('promptTags.batchWeightUp')} onClick={() => adjustSelected(0.1)}>
            <Plus className="h-3 w-3" />
          </ToolbarButton>
          <ToolbarButton
            title={t(target === 'positive' ? 'promptTags.batchMoveToNegative' : 'promptTags.batchMoveToPositive')}
            onClick={moveSelected}
          >
            <ArrowRightLeft className="h-3 w-3" />
          </ToolbarButton>
          <ToolbarButton title={t('promptTags.batchRemove')} onClick={removeSelected}>
            <X className="h-3 w-3" />
          </ToolbarButton>
          <ToolbarButton title={t('promptTags.saveSelection')} onClick={() => setSavingSelection((open) => !open)}>
            <BookmarkPlus className="h-3 w-3" />
          </ToolbarButton>
          <ToolbarButton title={t('promptTags.clearSelection')} onClick={clearSelection}>
            <Square className="h-3 w-3" />
          </ToolbarButton>
          {savingSelection && (
            <div className="flex min-w-[160px] flex-1 items-center gap-1">
              <input
                autoFocus
                className="input h-6 min-w-0 flex-1 px-1.5 py-0 text-[11px]"
                placeholder={t('promptTags.selectionNamePlaceholder')}
                value={selectionName}
                onChange={(e) => setSelectionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveSelectedAsQuickPreset()
                  if (e.key === 'Escape') {
                    setSavingSelection(false)
                    setSelectionName('')
                  }
                }}
              />
              <button className="btn btn-primary h-6 px-1.5 text-[10px]" onClick={() => void saveSelectedAsQuickPreset()}>
                {t('common.save')}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto pr-0.5">
        {tokens.map((token, index) => {
          const lookup = cleanPromptTokenForMatch(token.text).toLowerCase()
          const translated = autocomplete.get(lookup) ?? ''
          const isSelected = selectedIndexes.has(index)
          return (
            <div
              key={`${token.start}:${token.end}:${token.text}`}
              draggable
              className={cn(
                'group inline-flex max-w-full items-center gap-0.5 rounded-md border bg-bg-2 px-1 py-0.5 text-[11px]',
                'transition-colors',
                target === 'negative' ? 'border-err/35' : 'border-line',
                isSelected && 'border-accent bg-accent/10',
                draggingIndex === index && 'opacity-55',
                dragOverIndex === index && draggingIndex !== index && 'border-accent bg-accent/10'
              )}
              onDragStart={(e) => {
                setDraggingIndex(index)
                setDragOverIndex(index)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', String(index))
              }}
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setDragOverIndex(index)
              }}
              onDrop={(e) => {
                e.preventDefault()
                const from = Number(e.dataTransfer.getData('text/plain'))
                reorder(Number.isFinite(from) ? from : draggingIndex, index)
                setDraggingIndex(null)
                setDragOverIndex(null)
              }}
              onDragEnd={() => {
                setDraggingIndex(null)
                setDragOverIndex(null)
              }}
              title={t('promptTags.dragHint')}
            >
              <GripVertical className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />
              <IconChipButton
                title={t('promptTags.select')}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleSelection(index)
                }}
              >
                {isSelected ? <Check className="h-3 w-3 text-accent" /> : <Square className="h-3 w-3" />}
              </IconChipButton>
              <span className="min-w-0 max-w-[176px] truncate px-1 font-mono text-ink-1" title={token.text}>
                {token.text}
              </span>
              {translated && (
                <span className="max-w-[72px] truncate border-l border-line pl-1 text-[10px] text-ink-3" title={translated}>
                  {translated}
                </span>
              )}
              <IconChipButton title={t('promptTags.weightDown')} onClick={() => adjust(token, -0.1)}>
                <Minus className="h-3 w-3" />
              </IconChipButton>
              <IconChipButton title={t('promptTags.weightUp')} onClick={() => adjust(token, 0.1)}>
                <Plus className="h-3 w-3" />
              </IconChipButton>
              <IconChipButton
                title={t(target === 'positive' ? 'promptTags.moveToNegative' : 'promptTags.moveToPositive')}
                onClick={() => moveOne(token, index)}
              >
                <ArrowRightLeft className="h-3 w-3" />
              </IconChipButton>
              <IconChipButton
                title={t('promptTags.remove')}
                onClick={() => {
                  onChange(removePromptToken(value, token))
                  clearSelection()
                }}
              >
                <X className="h-3 w-3" />
              </IconChipButton>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function ToolbarButton({
  title,
  onClick,
  children
}: {
  title: string
  onClick(): void
  children: ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-line bg-bg-1 text-ink-3 transition-colors hover:bg-bg-4 hover:text-ink-0"
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  )
}

function IconChipButton({
  title,
  onClick,
  children
}: {
  title: string
  onClick: MouseEventHandler<HTMLButtonElement>
  children: ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-3 transition-colors hover:bg-bg-4 hover:text-ink-0"
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  )
}
