import { ArrowRightLeft, BookmarkPlus, Check, GripVertical, Languages, Minus, Plus, Rows3, ScanLine, Square, Star, X } from 'lucide-react'
import { useEffect, useMemo, useState, type MouseEventHandler, type ReactNode } from 'react'
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
import type {
  PromptCategory,
  PromptGroupTag,
  PromptTagPolarity,
  PromptTagSource,
  PromptTagTranslationProvider
} from '@shared/types'

interface Props {
  target: 'positive' | 'negative'
  value: string
  onChange(v: string): void
  onMoveTokens(tokens: string[]): void
}

interface LibraryEditState {
  tokenId: string
  tokenText: string
  category: string
  group: string
  ja: string
  favorite: boolean
}

interface PromptTagLibraryEntry {
  categoryName: string
  groupName: string
  tag: PromptGroupTag
}

const NEW_GROUP_DEFAULT_COLOR = 'rgba(124, 140, 255, .35)'

export function PromptTagChips({ target, value, onChange, onMoveTokens }: Props): JSX.Element | null {
  const autocomplete = useStore((s) => s.autocomplete)
  const library = useStore((s) => s.library)
  const customLibrary = useStore((s) => s.customLibrary)
  const setCustomLibrary = useStore((s) => s.setCustomLibrary)
  const favorites = useStore((s) => s.favorites)
  const setFavorites = useStore((s) => s.setFavorites)
  const quickPresets = useStore((s) => s.quickPresets)
  const setQuickPresets = useStore((s) => s.setQuickPresets)
  const tokens = splitPromptTokensWithRanges(value)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(new Set())
  const [savingSelection, setSavingSelection] = useState(false)
  const [selectionName, setSelectionName] = useState('')
  const [libraryEdit, setLibraryEdit] = useState<LibraryEditState | null>(null)
  const [librarySaving, setLibrarySaving] = useState(false)
  const [translationProvider, setTranslationProvider] = useState<PromptTagTranslationProvider>('google')
  const [translating, setTranslating] = useState(false)
  const selectedTokens = tokens.filter((_token, index) => selectedIndexes.has(index))
  const selectedCount = selectedTokens.length
  const t = useT()
  const defaultLibraryCategory = t('promptTags.libraryDefaultCategory')
  const defaultLibraryGroup = t(target === 'negative' ? 'promptTags.libraryDefaultGroupNegative' : 'promptTags.libraryDefaultGroupPositive')
  const libraryEntries = useMemo(() => collectPromptTagLibraryEntries(library, customLibrary), [library, customLibrary])
  const categoryOptions = useMemo(
    () => collectLibraryCategoryNames(library, customLibrary, defaultLibraryCategory),
    [library, customLibrary, defaultLibraryCategory]
  )
  const groupOptions = useMemo(
    () => collectLibraryGroupNames(library, customLibrary, libraryEdit?.category ?? defaultLibraryCategory, defaultLibraryGroup),
    [library, customLibrary, libraryEdit?.category, defaultLibraryCategory, defaultLibraryGroup]
  )

  useEffect(() => {
    setSelectedIndexes((prev) => {
      const next = new Set([...prev].filter((index) => index >= 0 && index < tokens.length))
      return next.size === prev.size ? prev : next
    })
  }, [tokens.length, value])

  useEffect(() => {
    if (!libraryEdit) return
    const stillPresent = tokens.some((token) => tokenId(token) === libraryEdit.tokenId)
    if (!stillPresent) setLibraryEdit(null)
  }, [libraryEdit, tokens])

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

  function startLibraryEdit(token: PromptTokenRange): void {
    const clean = normalizePromptLibraryTag(cleanPromptTokenForMatch(token.text))
    if (!clean) return
    const existing = findPromptTagLibraryEntry(libraryEntries, clean)
    const category = existing?.categoryName ?? defaultLibraryCategory
    const group = existing?.groupName ?? defaultLibraryGroup
    setLibraryEdit({
      tokenId: tokenId(token),
      tokenText: clean,
      category,
      group,
      ja: existing?.tag.ja || lookupAutocomplete(autocomplete, clean) || '',
      favorite: favorites.has(clean)
    })
  }

  function changeLibraryCategory(category: string): void {
    const groups = collectLibraryGroupNames(library, customLibrary, category, defaultLibraryGroup)
    setLibraryEdit((prev) => prev
      ? {
          ...prev,
          category,
          group: groups.includes(prev.group) ? prev.group : groups[0] ?? defaultLibraryGroup
        }
      : prev
    )
  }

  async function saveLibraryEdit(): Promise<void> {
    if (!libraryEdit || librarySaving) return
    const result = upsertCustomLibraryTag({
      builtinLibrary: library,
      customLibrary,
      categoryName: libraryEdit.category || defaultLibraryCategory,
      groupName: libraryEdit.group || defaultLibraryGroup,
      target,
      tagText: libraryEdit.tokenText,
      ja: libraryEdit.ja
    })
    const favoriteChanged = libraryEdit.favorite !== favorites.has(libraryEdit.tokenText)
    if (result.status === 'unchanged' && !favoriteChanged) {
      toast(tStatic('promptTags.libraryAlreadyExists', { tag: libraryEdit.tokenText }), { icon: 'i' })
      setLibraryEdit(null)
      return
    }
    setLibrarySaving(true)
    try {
      if (result.status !== 'unchanged') {
        await api.library.saveCustom(result.next)
        setCustomLibrary(result.next)
      }
      if (favoriteChanged) {
        await persistFavorite(libraryEdit.tokenText, libraryEdit.favorite)
      }
      toast.success(tStatic(
        result.status === 'added'
          ? 'promptTags.librarySavedAdded'
          : result.status === 'updated'
            ? 'promptTags.librarySavedUpdated'
            : 'promptTags.libraryFavoriteSaved',
        { tag: libraryEdit.tokenText }
      ))
      setLibraryEdit(null)
    } catch (e) {
      toast.error(tStatic('promptTags.librarySaveFailed', { message: (e as Error).message }))
    } finally {
      setLibrarySaving(false)
    }
  }

  async function persistFavorite(tag: string, favorite: boolean): Promise<void> {
    const next = new Set(favorites)
    if (favorite) next.add(tag)
    else next.delete(tag)
    setFavorites(next)
    try {
      await api.storage.setFavorites(Array.from(next))
    } catch (e) {
      setFavorites(favorites)
      throw e
    }
  }

  async function translateLibraryTag(): Promise<void> {
    if (!libraryEdit || translating) return
    setTranslating(true)
    try {
      const result = await api.translation.promptTag({
        text: libraryEdit.tokenText,
        provider: translationProvider,
        from: 'en',
        to: 'ja'
      })
      setLibraryEdit((prev) => prev ? { ...prev, ja: result.text } : prev)
      toast.success(tStatic('promptTags.translationApplied', { provider: translationProviderLabel(result.provider) }))
    } catch (e) {
      toast.error(tStatic('promptTags.translationFailed', { message: (e as Error).message }))
    } finally {
      setTranslating(false)
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
          const cleaned = normalizePromptLibraryTag(cleanPromptTokenForMatch(token.text))
          const entry = findPromptTagLibraryEntry(libraryEntries, cleaned)
          const translated = entry?.tag.ja || lookupAutocomplete(autocomplete, cleaned) || ''
          const isSelected = selectedIndexes.has(index)
          const id = tokenId(token)
          return (
            <div
              key={id}
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
              <IconChipButton
                title={t(entry ? 'promptTags.editLibraryTranslation' : 'promptTags.addToLibrary')}
                onClick={(e) => {
                  e.stopPropagation()
                  startLibraryEdit(token)
                }}
                testId="prompt-tag-library-edit-button"
                active={libraryEdit?.tokenId === id}
              >
                {entry ? <Languages className="h-3 w-3" /> : <BookmarkPlus className="h-3 w-3" />}
              </IconChipButton>
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

      {libraryEdit && (
        <div className="mt-2 rounded-md border border-accent/35 bg-bg-2 p-2 shadow-sm" data-testid="prompt-tag-library-editor">
          <div className="mb-2 flex items-center gap-1.5 text-xs">
            <BookmarkPlus className="h-3.5 w-3.5 text-accent" />
            <span className="font-semibold text-ink-1">{t('promptTags.libraryPanelTitle')}</span>
            <span className="min-w-0 truncate rounded border border-line bg-bg-1 px-1.5 py-0.5 font-mono text-[10px] text-ink-2">
              {libraryEdit.tokenText}
            </span>
            <button
              type="button"
              className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded text-ink-3 hover:bg-bg-4 hover:text-ink-0"
              onClick={() => setLibraryEdit(null)}
              title={t('common.cancel')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-1.5 2xl:grid-cols-[1fr_1fr_1.4fr_auto]">
            <label className="min-w-0 space-y-0.5">
              <span className="block text-[9px] text-ink-3">{t('promptTags.libraryCategoryLabel')}</span>
              <select
                className="input h-7 w-full py-0 text-[11px]"
                value={libraryEdit.category}
                onChange={(e) => changeLibraryCategory(e.target.value)}
                data-testid="prompt-tag-library-category"
              >
                {categoryOptions.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </label>
            <label className="min-w-0 space-y-0.5">
              <span className="block text-[9px] text-ink-3">{t('promptTags.libraryGroupLabel')}</span>
              <select
                className="input h-7 w-full py-0 text-[11px]"
                value={libraryEdit.group}
                onChange={(e) => setLibraryEdit((prev) => prev ? { ...prev, group: e.target.value } : prev)}
                data-testid="prompt-tag-library-group"
              >
                {groupOptions.map((group) => (
                  <option key={group} value={group}>{group}</option>
                ))}
              </select>
            </label>
            <label className="min-w-0 space-y-0.5">
              <span className="block text-[9px] text-ink-3">{t('promptTags.libraryTranslationLabel')}</span>
              <div className="flex min-w-0 gap-1">
                <input
                  autoFocus
                  className="input h-7 min-w-0 flex-1 py-0 text-[11px]"
                  value={libraryEdit.ja}
                  onChange={(e) => setLibraryEdit((prev) => prev ? { ...prev, ja: e.target.value } : prev)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveLibraryEdit()
                    if (e.key === 'Escape') setLibraryEdit(null)
                  }}
                  placeholder={t('promptTags.libraryTranslationPlaceholder')}
                  data-testid="prompt-tag-library-ja"
                />
                <select
                  className="input h-7 w-[94px] py-0 text-[10px]"
                  value={translationProvider}
                  onChange={(e) => setTranslationProvider(e.target.value as PromptTagTranslationProvider)}
                  title={t('promptTags.translationProviderLabel')}
                  data-testid="prompt-tag-library-translation-provider"
                >
                  <option value="google">{t('promptTags.translationProviderGoogle')}</option>
                  <option value="mymemory">{t('promptTags.translationProviderMyMemory')}</option>
                </select>
                <button
                  type="button"
                  className="btn btn-ghost h-7 shrink-0 gap-1 px-2 text-[10px]"
                  disabled={translating}
                  onClick={() => void translateLibraryTag()}
                  title={t('promptTags.translateSuggestionHint')}
                  data-testid="prompt-tag-library-translate"
                >
                  <Languages className="h-3 w-3" />
                  {translating ? t('promptTags.translating') : t('promptTags.translateSuggestion')}
                </button>
              </div>
            </label>
            <div className="flex items-end">
              <button
                type="button"
                className="btn btn-primary h-7 w-full gap-1.5 px-2 text-[10px]"
                disabled={librarySaving}
                onClick={() => void saveLibraryEdit()}
                data-testid="prompt-tag-library-save"
              >
                <Check className="h-3 w-3" />
                {t('common.save')}
              </button>
            </div>
          </div>
          <label className="mt-2 inline-flex items-center gap-1.5 rounded border border-line bg-bg-1 px-2 py-1 text-[11px] text-ink-2">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-accent"
              checked={libraryEdit.favorite}
              onChange={(e) => setLibraryEdit((prev) => prev ? { ...prev, favorite: e.target.checked } : prev)}
              data-testid="prompt-tag-library-favorite"
            />
            <Star className={cn('h-3.5 w-3.5', libraryEdit.favorite ? 'fill-current text-warn' : 'text-ink-3')} />
            {t('promptTags.libraryFavoriteLabel')}
          </label>
        </div>
      )}
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
  children,
  testId,
  active = false
}: {
  title: string
  onClick: MouseEventHandler<HTMLButtonElement>
  children: ReactNode
  testId?: string
  active?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-bg-4 hover:text-ink-0',
        active ? 'bg-accent/15 text-accent' : 'text-ink-3'
      )}
      onClick={onClick}
      title={title}
      data-testid={testId}
    >
      {children}
    </button>
  )
}

function tokenId(token: PromptTokenRange): string {
  return `${token.start}:${token.end}:${token.text}`
}

function normalizePromptLibraryTag(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function promptLibraryLookupKey(value: string): string {
  return normalizePromptLibraryTag(value).toLowerCase()
}

function lookupAutocomplete(autocomplete: Map<string, string>, value: string): string | undefined {
  return autocomplete.get(value) ?? autocomplete.get(promptLibraryLookupKey(value))
}

function collectPromptTagLibraryEntries(
  builtin: PromptCategory[],
  custom: PromptCategory[]
): PromptTagLibraryEntry[] {
  const entries: PromptTagLibraryEntry[] = []
  for (const category of [...custom, ...builtin]) {
    for (const group of category.groups) {
      for (const tag of group.tags) {
        entries.push({ categoryName: category.name, groupName: group.name, tag })
      }
    }
  }
  return entries
}

function findPromptTagLibraryEntry(
  entries: PromptTagLibraryEntry[],
  value: string
): PromptTagLibraryEntry | null {
  const key = promptLibraryLookupKey(value)
  return entries.find((entry) => promptTagLookupKeys(entry.tag).includes(key)) ?? null
}

function collectLibraryCategoryNames(
  builtin: PromptCategory[],
  custom: PromptCategory[],
  fallback: string
): string[] {
  const names = new Set<string>([fallback])
  for (const category of [...builtin, ...custom]) {
    if (category.name.trim()) names.add(category.name)
  }
  return [...names]
}

function collectLibraryGroupNames(
  builtin: PromptCategory[],
  custom: PromptCategory[],
  categoryName: string,
  fallback: string
): string[] {
  const names = new Set<string>([fallback])
  for (const category of [...builtin, ...custom]) {
    if (category.name !== categoryName) continue
    for (const group of category.groups) {
      if (group.name.trim()) names.add(group.name)
    }
  }
  return [...names]
}

function upsertCustomLibraryTag({
  builtinLibrary,
  customLibrary,
  categoryName,
  groupName,
  target,
  tagText,
  ja
}: {
  builtinLibrary: PromptCategory[]
  customLibrary: PromptCategory[]
  categoryName: string
  groupName: string
  target: 'positive' | 'negative'
  tagText: string
  ja: string
}): { status: 'added' | 'updated' | 'unchanged'; next: PromptCategory[] } {
  const cleanTag = normalizePromptLibraryTag(tagText)
  if (!cleanTag) return { status: 'unchanged', next: customLibrary }
  const cleanCategory = categoryName.trim()
  const cleanGroup = groupName.trim()
  if (!cleanCategory || !cleanGroup) return { status: 'unchanged', next: customLibrary }
  const cleanJa = ja.trim()
  const key = promptLibraryLookupKey(cleanTag)
  const builtinCategory = builtinLibrary.find((category) => category.name === cleanCategory)
  const builtinGroup = builtinCategory?.groups.find((group) => group.name === cleanGroup)
  const builtinTag = (builtinGroup?.tags ?? []).find((tag) => promptTagLookupKeys(tag).includes(key))
  const customCategory = customLibrary.find((category) => category.name === cleanCategory)
  const customGroup = customCategory?.groups.find((group) => group.name === cleanGroup)
  const existingCustomTag = customGroup?.tags.find((tag) => promptTagLookupKeys(tag).includes(key))

  if (!existingCustomTag && builtinTag && (builtinTag.ja ?? '').trim() === cleanJa) {
    return { status: 'unchanged', next: customLibrary }
  }

  const next = customLibrary.map(clonePromptCategory)
  let category = next.find((item) => item.name === cleanCategory)
  if (!category) {
    category = { name: cleanCategory, groups: [], editable: true }
    next.push(category)
  }
  let group = category.groups.find((item) => item.name === cleanGroup)
  if (!group) {
    group = {
      name: cleanGroup,
      color: builtinGroup?.color ?? NEW_GROUP_DEFAULT_COLOR,
      tags: []
    }
    category.groups.push(group)
  }

  const existing = group.tags.find((tag) => promptTagLookupKeys(tag).includes(key))
  if (existing) {
    const before = JSON.stringify(existing)
    existing.ja = cleanJa
    existing.canonical = normalizePromptLibraryTag(existing.canonical ?? cleanTag)
    existing.polarity = existing.polarity ?? inferPromptTagPolarity(target, cleanCategory, cleanGroup)
    existing.aliases = existing.aliases ?? []
    existing.modelFamilies = existing.modelFamilies ?? []
    existing.source = mergePromptTagSources(existing.source, { kind: 'manual', confidence: 1 })
    existing.usage = existing.usage ?? { count: 0, lastUsedAt: null }
    return { status: JSON.stringify(existing) === before ? 'unchanged' : 'updated', next }
  }

  group.tags.push({
    en: cleanTag,
    ja: cleanJa,
    canonical: cleanTag,
    aliases: [],
    polarity: inferPromptTagPolarity(target, cleanCategory, cleanGroup),
    modelFamilies: [],
    source: [{ kind: 'manual', confidence: 1 }],
    usage: { count: 0, lastUsedAt: null }
  })
  return { status: 'added', next }
}

function clonePromptCategory(category: PromptCategory): PromptCategory {
  return {
    ...category,
    groups: category.groups.map((group) => ({
      ...group,
      tags: group.tags.map((tag) => ({
        ...tag,
        aliases: tag.aliases ? [...tag.aliases] : undefined,
        modelFamilies: tag.modelFamilies ? [...tag.modelFamilies] : undefined,
        source: tag.source ? tag.source.map((source) => ({ ...source })) : undefined,
        usage: tag.usage ? { ...tag.usage } : undefined
      }))
    }))
  }
}

function promptTagLookupKeys(tag: PromptGroupTag): string[] {
  return [tag.en, tag.canonical, ...(tag.aliases ?? [])]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(promptLibraryLookupKey)
}

function inferPromptTagPolarity(
  target: 'positive' | 'negative',
  categoryName: string,
  groupName: string
): PromptTagPolarity {
  if (/negative|ネガティブ/i.test(`${categoryName} ${groupName}`)) return 'negative'
  return target
}

function mergePromptTagSources(
  current: PromptTagSource[] | undefined,
  source: PromptTagSource
): PromptTagSource[] {
  const sources = current ? current.map((item) => ({ ...item })) : []
  if (!sources.some((item) => item.kind === source.kind)) sources.push(source)
  return sources
}

function translationProviderLabel(provider: PromptTagTranslationProvider): string {
  return provider === 'mymemory' ? 'MyMemory' : 'Google'
}
