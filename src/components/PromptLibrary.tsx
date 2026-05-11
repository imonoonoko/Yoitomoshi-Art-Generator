import { useEffect, useMemo, useState } from 'react'
import { Search, Star, Clock, EyeOff, Plus, X, Edit3, Pencil } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore } from '@/lib/store'
import { api } from '@/lib/ipc'
import { useT, t as tStatic } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { PromptCategory, PromptGroup, PromptGroupTag } from '@shared/types'

/**
 * Categorized prompt picker — built-in + user-added entries merged seamlessly.
 *
 * Layout:
 *   [Left nav: ⭐ Favorites | 🕒 Recent | built-in cats … | (sep) | user cats … | + カテゴリ]
 *   [Right:    subcategory toggle pills (with + 新規 in editable cats) | tag chips]
 *
 * Subcategory pills are multi-toggle (click to show/hide). Default = first
 * subcat only so a category isn't a wall of tags.
 *
 * Tag chip:
 *   - click:    append "tag, " to positive prompt
 *   - Shift:    append wrapped as (tag:1.1)
 *   - Alt:      append to negative prompt
 *   - ⭐:       toggle favorite (cross-category)
 *
 * Editable items (anything from `customLibrary`) get hover X (delete) +
 * inline-form add buttons. Built-in items are read-only.
 */
const SPECIAL_FAVORITES = '__favorites__'
const SPECIAL_RECENT = '__recent__'
const NEW_GROUP_DEFAULT_COLOR = 'rgba(124, 140, 255, .35)'
const TAG_PREVIEW_LIMIT = 80
const GROUP_PREVIEW_LIMIT = 8

export function PromptLibrary(): JSX.Element {
  const library = useStore((s) => s.library)
  const customLibrary = useStore((s) => s.customLibrary)
  const setCustomLibrary = useStore((s) => s.setCustomLibrary)
  const setPrompt = useStore((s) => s.setPrompt)
  const setNeg = useStore((s) => s.setNegativePrompt)
  const prompt = useStore((s) => s.prompt)
  const negative = useStore((s) => s.negativePrompt)
  const favorites = useStore((s) => s.favorites)
  const toggleFavoriteState = useStore((s) => s.toggleFavorite)
  const recentTags = useStore((s) => s.recentTags)
  const pushRecent = useStore((s) => s.pushRecentTag)
  const t = useT()

  // Combined categories — built-in first, then user-only customs.
  //
  // A custom category whose name matches a built-in category is treated as a
  // *shadow* and merges into the built-in: extra groups are appended, and
  // extra tags within the same group name are appended to the built-in's tags.
  // This lets the user add their own tags to built-in categories without
  // forking the whole library.
  //
  // We also surface, alongside the merged list, two helper structures the
  // renderer uses to decide what's deletable vs. read-only:
  //   - userAddedTags: per "{cat}|{group}" key, the Set of tag.en the user added
  //   - userAddedGroups: per cat name, the Set of group names the user added
  // Built-in tags/groups have no entry there and so render without an X button.
  const { allCategories, userAddedTags, userAddedGroups, builtinCount } = useMemo(() => {
    const builtinNames = new Set(library.map((c) => c.name))
    const customByName = new Map(customLibrary.map((c) => [c.name, c]))

    const merged: PromptCategory[] = []
    const tagsAdded = new Map<string, Set<string>>()
    const groupsAdded = new Map<string, Set<string>>()

    for (const b of library) {
      const shadow = customByName.get(b.name)
      if (!shadow) {
        merged.push(b)
        continue
      }
      const builtinGroupNames = new Set(b.groups.map((g) => g.name))
      const shadowByGroup = new Map(shadow.groups.map((g) => [g.name, g]))
      const groupTagsAdded = new Set<string>()

      const mergedGroups: PromptGroup[] = b.groups.map((g) => {
        const sg = shadowByGroup.get(g.name)
        if (!sg || sg.tags.length === 0) return g
        const existingEns = new Set(g.tags.map((t) => t.en))
        const additions = sg.tags.filter((t) => !existingEns.has(t.en))
        if (additions.length > 0) {
          const key = `${b.name}|${g.name}`
          tagsAdded.set(key, new Set(additions.map((t) => t.en)))
        }
        return { ...g, tags: [...g.tags, ...additions] }
      })
      // Append shadow-only groups (whole new sub-categories the user added).
      for (const sg of shadow.groups) {
        if (builtinGroupNames.has(sg.name)) continue
        mergedGroups.push(sg)
        groupTagsAdded.add(sg.name)
        const key = `${b.name}|${sg.name}`
        tagsAdded.set(key, new Set(sg.tags.map((t) => t.en)))
      }
      if (groupTagsAdded.size > 0) groupsAdded.set(b.name, groupTagsAdded)

      merged.push({ ...b, groups: mergedGroups })
    }

    // Append user-only categories (those without a built-in counterpart).
    for (const c of customLibrary) {
      if (builtinNames.has(c.name)) continue
      merged.push(c)
      // For user-only cats, every group/tag is "user added" by definition.
      // The renderer keys off `c.editable` for the category-level X button
      // and off these maps for group/tag-level X buttons.
      const allGroups = new Set<string>()
      for (const g of c.groups) {
        allGroups.add(g.name)
        tagsAdded.set(`${c.name}|${g.name}`, new Set(g.tags.map((t) => t.en)))
      }
      groupsAdded.set(c.name, allGroups)
    }

    return {
      allCategories: merged,
      userAddedTags: tagsAdded,
      userAddedGroups: groupsAdded,
      builtinCount: library.length
    }
  }, [library, customLibrary])

  // activeCat is either a real index, or one of the special pseudo-categories.
  const [activeCat, setActiveCat] = useState<number | typeof SPECIAL_FAVORITES | typeof SPECIAL_RECENT>(0)
  const [activeSubcats, setActiveSubcats] = useState<Set<number>>(new Set([0]))
  const [query, setQuery] = useState('')

  // Inline editor state — at most one form open at a time.
  const [addingCategory, setAddingCategory] = useState(false)
  const [draftCategoryName, setDraftCategoryName] = useState('')
  const [addingGroup, setAddingGroup] = useState(false)
  const [draftGroupName, setDraftGroupName] = useState('')
  const [addingTagInGroup, setAddingTagInGroup] = useState<string | null>(null)
  const [draftTagEn, setDraftTagEn] = useState('')
  const [draftTagJa, setDraftTagJa] = useState('')

  const filteredCategories = useMemo(() => {
    if (!query.trim()) return allCategories
    const q = query.toLowerCase()
    return allCategories
      .map((c) => ({
        ...c,
        groups: c.groups
          .map((g) => ({
            ...g,
            tags: g.tags.filter(
              (t) => t.en.toLowerCase().includes(q) || t.ja.includes(q)
            )
          }))
          .filter((g) => g.tags.length > 0)
      }))
      .filter((c) => c.groups.length > 0)
  }, [allCategories, query])

  const cat = typeof activeCat === 'number' ? filteredCategories[activeCat] : null
  const groups = cat?.groups ?? []

  useEffect(() => {
    setActiveSubcats(groups.length > 0 ? new Set([0]) : new Set())
    setAddingGroup(false)
    setAddingTagInGroup(null)
  }, [activeCat, allCategories])

  useEffect(() => {
    if (query.trim()) setActiveSubcats(new Set(groups.map((_, i) => i)))
  }, [query, groups.length])

  function toggleSubcat(i: number, e: React.MouseEvent): void {
    if (e.shiftKey) { setActiveSubcats(new Set([i])); return }
    setActiveSubcats((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i); else next.add(i)
      return next
    })
  }

  function setAllSubcats(active: boolean): void {
    setActiveSubcats(active ? new Set(groups.map((_, i) => i)) : new Set())
  }

  async function persistFavorites(updated: Set<string>): Promise<void> {
    try { await api.storage.setFavorites(Array.from(updated)) }
    catch (e) { toast.error(tStatic('pl.toastFavSaveFailed', { message: (e as Error).message })) }
  }

  function toggleFav(en: string, e: React.MouseEvent): void {
    e.preventDefault(); e.stopPropagation()
    toggleFavoriteState(en)
    setTimeout(() => { void persistFavorites(useStore.getState().favorites) }, 0)
  }

  function addTag(en: string, e: React.MouseEvent): void {
    e.preventDefault()
    let token = en
    if (e.shiftKey) token = `(${en}:1.1)`
    if (e.altKey) setNeg(negative + (negative ? ', ' : '') + token)
    else setPrompt(prompt + (prompt ? ', ' : '') + token)
    pushRecent(en)
  }

  // -- mutations on customLibrary -----------------------------------------
  async function persistCustom(next: PromptCategory[]): Promise<void> {
    setCustomLibrary(next)
    try {
      await api.library.saveCustom(next)
    } catch (e) {
      toast.error(tStatic('pl.toastSaveFailed', { message: (e as Error).message }))
    }
  }

  function commitNewCategory(): void {
    const name = draftCategoryName.trim()
    if (!name) { setAddingCategory(false); return }
    if (allCategories.some((c) => c.name === name)) {
      toast.error(tStatic('pl.toastDupeCategory')); return
    }
    const next = [...customLibrary, { name, groups: [], editable: true }]
    void persistCustom(next)
    setAddingCategory(false)
    setDraftCategoryName('')
    // Position in merged list = built-ins + existing user-only customs.
    // (Shadow customs are merged into built-ins and don't take their own slot.)
    const builtinNameSet = new Set(library.map((c) => c.name))
    const userOnlyCount = customLibrary.filter((c) => !builtinNameSet.has(c.name)).length
    setActiveCat(library.length + userOnlyCount)
    toast.success(tStatic('pl.toastCategoryAdded', { name }))
  }

  function deleteCategory(name: string): void {
    if (!confirm(tStatic('pl.confirmDeleteCategory', { name }))) return
    const next = customLibrary.filter((c) => c.name !== name)
    void persistCustom(next)
    setActiveCat(0)
    toast.success(tStatic('pl.toastCategoryDeleted', { name }))
  }

  function commitNewGroup(): void {
    const name = draftGroupName.trim()
    if (!name || typeof activeCat !== 'number') { setAddingGroup(false); return }
    const cat = filteredCategories[activeCat]
    if (!cat) return
    if (cat.groups.some((g) => g.name === name)) {
      toast.error(tStatic('pl.toastDupeGroup')); return
    }
    // Find or lazily create the shadow custom entry for this cat. For a
    // built-in cat, this is the first time we're storing user-additions
    // under it.
    const next = [...customLibrary]
    let customIdx = next.findIndex((c) => c.name === cat.name)
    if (customIdx < 0) {
      next.push({ name: cat.name, groups: [] })
      customIdx = next.length - 1
    }
    next[customIdx] = {
      ...next[customIdx],
      groups: [
        ...next[customIdx].groups,
        { name, color: NEW_GROUP_DEFAULT_COLOR, tags: [] }
      ]
    }
    void persistCustom(next)
    setAddingGroup(false)
    setDraftGroupName('')
    setActiveSubcats(new Set([cat.groups.length]))
    toast.success(tStatic('pl.toastGroupAdded', { name }))
  }

  function deleteGroup(catName: string, groupName: string): void {
    if (!confirm(tStatic('pl.confirmDeleteGroup', { name: groupName }))) return
    const customIdx = customLibrary.findIndex((c) => c.name === catName)
    if (customIdx < 0) return
    const next = [...customLibrary]
    next[customIdx] = {
      ...next[customIdx],
      groups: next[customIdx].groups.filter((g) => g.name !== groupName)
    }
    void persistCustom(next)
    toast.success(tStatic('pl.toastGroupDeleted', { name: groupName }))
  }

  /**
   * Add one OR many tags to a user group.
   *
   * The English-tag input accepts:
   *   - a single tag (existing behavior): `1girl`
   *   - multi-line input: each line is a separate tag, optional ` | <ja>` suffix
   *   - comma-separated input: `1girl, 1boy, solo` → 3 tags, ja from the
   *     ja-input applies to all unless any line had its own `| <ja>` suffix
   *
   * Lets the user paste a whole batch from a reference page and mass-add
   * without typing one-by-one.
   */
  function commitNewTag(catName: string, groupName: string): void {
    const enRaw = draftTagEn.trim()
    const sharedJa = draftTagJa.trim()
    if (!enRaw) { setAddingTagInGroup(null); return }

    // Parse the bulk input. Split on newlines first; if no newlines, fall
    // back to commas. Keep the original text otherwise (single-tag path).
    const rawLines = enRaw.includes('\n')
      ? enRaw.split(/\r?\n/)
      : enRaw.includes(',') ? enRaw.split(',') : [enRaw]

    const candidates: { en: string; ja: string }[] = []
    for (const line of rawLines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const pipeIdx = trimmed.indexOf('|')
      if (pipeIdx >= 0) {
        const en = trimmed.slice(0, pipeIdx).trim()
        const ja = trimmed.slice(pipeIdx + 1).trim()
        if (en) candidates.push({ en, ja })
      } else {
        candidates.push({ en: trimmed, ja: sharedJa })
      }
    }
    if (candidates.length === 0) { setAddingTagInGroup(null); return }

    // Locate (or lazily create) the shadow custom-library entry for this cat.
    // For a built-in cat with no prior user additions, the shadow doesn't
    // exist yet — we create it on first tag add. The shadow stores ONLY user
    // additions; it never duplicates built-in tags.
    const next = [...customLibrary]
    let customIdx = next.findIndex((c) => c.name === catName)
    if (customIdx < 0) {
      next.push({ name: catName, groups: [] })
      customIdx = next.length - 1
    }

    // Within the shadow, locate (or create) the matching group. If the group
    // doesn't yet exist in the shadow but DOES exist in built-in, copy its
    // color so the chip pill matches the built-in style. For a brand-new
    // sub-category, fall back to the default color.
    const shadowCat = next[customIdx]
    let group = shadowCat.groups.find((g) => g.name === groupName)
    if (!group) {
      const builtinCat = library.find((c) => c.name === catName)
      const builtinGroup = builtinCat?.groups.find((g) => g.name === groupName)
      group = {
        name: groupName,
        color: builtinGroup?.color ?? NEW_GROUP_DEFAULT_COLOR,
        tags: []
      }
      shadowCat.groups = [...shadowCat.groups, group]
    }

    // Reject duplicates against BOTH built-in and shadow tags so adding the
    // same tag twice never persists into the shadow.
    const builtinCat = library.find((c) => c.name === catName)
    const builtinGroup = builtinCat?.groups.find((g) => g.name === groupName)
    const builtinEns = new Set((builtinGroup?.tags ?? []).map((t) => t.en))
    const shadowEns = new Set(group.tags.map((t) => t.en))

    let added = 0
    for (const c of candidates) {
      if (builtinEns.has(c.en) || shadowEns.has(c.en)) continue
      group.tags.push({ en: c.en, ja: c.ja })
      shadowEns.add(c.en)
      added++
    }
    void persistCustom(next)
    setAddingTagInGroup(null)
    setDraftTagEn('')
    setDraftTagJa('')
    if (added === candidates.length) {
      if (added > 1) toast.success(tStatic('pl.toastTagsAdded', { count: added }))
    } else if (added > 0) {
      toast.success(tStatic('pl.toastTagsAddedPartial', { added, skipped: candidates.length - added }))
    } else {
      toast(tStatic('pl.toastAllTagsExist'), { icon: 'ℹ' })
    }
  }

  function deleteTag(catName: string, groupName: string, en: string): void {
    const customIdx = customLibrary.findIndex((c) => c.name === catName)
    if (customIdx < 0) return
    const next = [...customLibrary]
    const group = next[customIdx].groups.find((g) => g.name === groupName)
    if (!group) return
    group.tags = group.tags.filter((t) => t.en !== en)
    void persistCustom(next)
  }

  if (allCategories.length === 0) {
    return <div className="p-4 text-sm text-ink-3">{t('pl.loading')}</div>
  }

  // Right-pane content depending on the selected (pseudo-)category.
  const rightPane = (() => {
    if (activeCat === SPECIAL_FAVORITES) {
      const tags = collectTags(allCategories, (t) => favorites.has(t.en))
      return <SpecialList title={t('pl.favTitle', { count: tags.length })} tags={tags} onAdd={addTag} onToggleFav={toggleFav} favorites={favorites} emptyText={t('pl.emptyFavorites')} />
    }
    if (activeCat === SPECIAL_RECENT) {
      const tags = collectTags(allCategories, (t) => recentTags.includes(t.en))
        .sort((a, b) => recentTags.indexOf(a.en) - recentTags.indexOf(b.en))
      return <SpecialList title={t('pl.recentTitle', { count: tags.length })} tags={tags} onAdd={addTag} onToggleFav={toggleFav} favorites={favorites} emptyText={t('pl.emptyRecent')} />
    }
    const userGroupNames = cat ? userAddedGroups.get(cat.name) ?? new Set<string>() : new Set<string>()
    return (
      <NormalCategory
        category={cat}
        groups={groups}
        activeSubcats={activeSubcats}
        onToggleSubcat={toggleSubcat}
        onAllSubcats={setAllSubcats}
        onAddTag={addTag}
        onToggleFav={toggleFav}
        favorites={favorites}
        userAddedGroupNames={userGroupNames}
        getUserAddedTagsForGroup={(g) =>
          (cat && userAddedTags.get(`${cat.name}|${g}`)) ?? new Set<string>()
        }
        addingGroup={addingGroup}
        draftGroupName={draftGroupName}
        onStartAddGroup={() => { setAddingGroup(true); setDraftGroupName('') }}
        onCancelAddGroup={() => setAddingGroup(false)}
        onChangeDraftGroupName={setDraftGroupName}
        onCommitGroup={commitNewGroup}
        onDeleteGroup={(g) => cat && deleteGroup(cat.name, g)}
        addingTagInGroup={addingTagInGroup}
        draftTagEn={draftTagEn}
        draftTagJa={draftTagJa}
        onStartAddTag={(g) => { setAddingTagInGroup(g); setDraftTagEn(''); setDraftTagJa('') }}
        onCancelAddTag={() => setAddingTagInGroup(null)}
        onChangeDraftTagEn={setDraftTagEn}
        onChangeDraftTagJa={setDraftTagJa}
        onCommitTag={(g) => cat && commitNewTag(cat.name, g)}
        onDeleteTag={(g, en) => cat && deleteTag(cat.name, g, en)}
      />
    )
  })()

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-line shrink-0 space-y-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('pl.searchPlaceholder')}
            className="input pl-7 text-xs"
          />
        </div>
        <div className="text-[10px] text-ink-3 leading-tight">
          {t('pl.shortcuts')}
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <nav className="w-24 shrink-0 overflow-y-auto bg-bg-1 border-r border-line">
          <CatNavButton
            label={t('pl.favorites')}
            icon={<Star className="h-3 w-3" />}
            active={activeCat === SPECIAL_FAVORITES}
            count={favorites.size}
            onClick={() => setActiveCat(SPECIAL_FAVORITES)}
          />
          <CatNavButton
            label={t('pl.recent')}
            icon={<Clock className="h-3 w-3" />}
            active={activeCat === SPECIAL_RECENT}
            count={recentTags.length}
            onClick={() => setActiveCat(SPECIAL_RECENT)}
          />
          <div className="border-t border-line my-1" />
          {filteredCategories.map((c, i) => {
            // Separator runs between the last built-in and the first user-only
            // custom. With merging, customs may only include shadows (which
            // don't add new slots) — in that case the separator suppresses.
            const isUserSeparator = i === builtinCount && filteredCategories.length > builtinCount
            return (
              <div key={c.name + i}>
                {isUserSeparator && (
                  <div className="border-t border-line my-1 mx-2" title={t('pl.userAdded')} />
                )}
                <CatNavRow
                  label={c.name}
                  active={activeCat === i}
                  editable={!!c.editable}
                  onClick={() => setActiveCat(i)}
                  onDelete={() => deleteCategory(c.name)}
                />
              </div>
            )
          })}
          {!query.trim() && (
            <div className="px-1.5 py-1.5 mt-1 border-t border-line">
              {addingCategory ? (
                <div className="space-y-1">
                  <input
                    autoFocus
                    value={draftCategoryName}
                    onChange={(e) => setDraftCategoryName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitNewCategory()
                      if (e.key === 'Escape') setAddingCategory(false)
                    }}
                    placeholder={t('pl.categoryNamePlaceholder')}
                    className="input text-[11px] py-0.5"
                  />
                  <div className="flex gap-1">
                    <button className="btn btn-primary text-[10px] py-0.5 px-1 flex-1" onClick={commitNewCategory}>{t('pl.add')}</button>
                    <button className="btn btn-ghost text-[10px] py-0.5 px-1" onClick={() => setAddingCategory(false)}>×</button>
                  </div>
                </div>
              ) : (
                <button
                  className="w-full flex items-center justify-center gap-1 text-[10px] text-ink-3 hover:text-ink-1 py-1 rounded hover:bg-bg-3"
                  onClick={() => setAddingCategory(true)}
                  title={t('pl.addCategoryHint')}
                >
                  <Plus className="h-3 w-3" /> {t('pl.categoryLabel')}
                </button>
              )}
            </div>
          )}
        </nav>

        <div className="flex-1 flex flex-col min-w-0">{rightPane}</div>
      </div>
    </div>
  )
}

// ----- helpers + sub-components -----

function collectTags(
  library: { groups: PromptGroup[] }[],
  predicate: (t: PromptGroupTag) => boolean
): (PromptGroupTag & { color: string })[] {
  const out: (PromptGroupTag & { color: string })[] = []
  for (const cat of library) {
    for (const g of cat.groups) {
      for (const t of g.tags) {
        if (predicate(t)) out.push({ ...t, color: g.color })
      }
    }
  }
  return out
}

interface CatNavProps {
  label: string
  active: boolean
  onClick(): void
  icon?: React.ReactNode
  count?: number
}

function CatNavButton({ label, active, onClick, icon, count }: CatNavProps): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-1 text-left px-2 py-2 text-xs border-l-2 transition-colors',
        active
          ? 'border-accent bg-bg-2 text-ink-0'
          : 'border-transparent text-ink-2 hover:bg-bg-2'
      )}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="text-[9px] text-ink-3 font-mono">{count}</span>
      )}
    </button>
  )
}

interface CatNavRowProps {
  label: string
  active: boolean
  editable: boolean
  onClick(): void
  onDelete(): void
}

function CatNavRow({ label, active, editable, onClick, onDelete }: CatNavRowProps): JSX.Element {
  return (
    <div
      className={cn(
        'group relative w-full border-l-2 transition-colors flex items-center',
        active
          ? 'border-accent bg-bg-2 text-ink-0'
          : 'border-transparent text-ink-2 hover:bg-bg-2'
      )}
    >
      <button
        onClick={onClick}
        className="flex-1 text-left px-2 py-2 text-xs truncate"
      >
        {editable && <Pencil className="h-2.5 w-2.5 inline mr-1 text-ink-3" />}
        {label}
      </button>
      {editable && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="opacity-0 group-hover:opacity-100 mr-1 p-0.5 text-ink-3 hover:text-err"
          title={tStatic('pl.deleteCategoryHint')}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

interface NormalCategoryProps {
  category: PromptCategory | null
  groups: PromptGroup[]
  activeSubcats: Set<number>
  onToggleSubcat(i: number, e: React.MouseEvent): void
  onAllSubcats(active: boolean): void
  onAddTag(en: string, e: React.MouseEvent): void
  onToggleFav(en: string, e: React.MouseEvent): void
  favorites: Set<string>
  /** Group names within the active category that originate from user additions. */
  userAddedGroupNames: Set<string>
  /** Per-group lookup: which tag.en values within that group were user-added. */
  getUserAddedTagsForGroup(groupName: string): Set<string>
  addingGroup: boolean
  draftGroupName: string
  onStartAddGroup(): void
  onCancelAddGroup(): void
  onChangeDraftGroupName(s: string): void
  onCommitGroup(): void
  onDeleteGroup(name: string): void
  addingTagInGroup: string | null
  draftTagEn: string
  draftTagJa: string
  onStartAddTag(group: string): void
  onCancelAddTag(): void
  onChangeDraftTagEn(s: string): void
  onChangeDraftTagJa(s: string): void
  onCommitTag(group: string): void
  onDeleteTag(group: string, en: string): void
}

function NormalCategory(props: NormalCategoryProps): JSX.Element {
  const {
    category, groups, activeSubcats, onToggleSubcat, onAllSubcats,
    onAddTag, onToggleFav, favorites,
    userAddedGroupNames, getUserAddedTagsForGroup,
    addingGroup, draftGroupName, onStartAddGroup, onCancelAddGroup,
    onChangeDraftGroupName, onCommitGroup, onDeleteGroup,
    addingTagInGroup, draftTagEn, draftTagJa,
    onStartAddTag, onCancelAddTag, onChangeDraftTagEn, onChangeDraftTagJa,
    onCommitTag, onDeleteTag
  } = props
  // Tag- and group-level edits are always available — adding to a built-in
  // category lazily creates a shadow entry in customLibrary. Only the
  // category-level X (delete the whole thing) is gated to user-only cats.
  const isUserOnlyCat = !!category?.editable
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [visibleGroupCount, setVisibleGroupCount] = useState(GROUP_PREVIEW_LIMIT)

  useEffect(() => {
    setExpandedGroups(new Set())
    setVisibleGroupCount(GROUP_PREVIEW_LIMIT)
  }, [category?.name])

  useEffect(() => {
    setVisibleGroupCount(GROUP_PREVIEW_LIMIT)
  }, [activeSubcats])

  function toggleExpandedGroup(name: string): void {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  return (
    <>
      {(groups.length > 0 || category) && (
        <div className="flex items-start gap-1 p-1.5 bg-bg-1 border-b border-line shrink-0">
          <div className="flex flex-wrap gap-1 flex-1">
            {groups.map((g, i) => {
              const active = activeSubcats.has(i)
              const isUserGroup = userAddedGroupNames.has(g.name)
              return (
                <div key={g.name + i} className="relative group">
                  <button
                    onClick={(e) => onToggleSubcat(i, e)}
                    className={cn(
                      'inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] border whitespace-nowrap transition-all',
                      active
                        ? 'border-accent text-ink-0 ring-1 ring-accent/30'
                        : 'border-line text-ink-2 hover:border-line-strong hover:text-ink-1'
                    )}
                    style={{ backgroundColor: active ? g.color : 'transparent' }}
                    title={tStatic('pl.subcatTooltip', { state: active ? tStatic('pl.subcatHide') : tStatic('pl.subcatShow') })}
                  >
                    {!active && <EyeOff className="h-2.5 w-2.5 opacity-60" />}
                    <span>{g.name}</span>
                    <span className="text-[9px] text-ink-3 ml-0.5 font-mono">{g.tags.length}</span>
                  </button>
                  {isUserGroup && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onDeleteGroup(g.name) }}
                      className="absolute -top-1 -right-1 hidden group-hover:flex h-3.5 w-3.5 items-center justify-center rounded-full bg-bg-3 border border-line text-ink-2 hover:bg-err/40 hover:text-ink-0"
                      title={tStatic('pl.deleteGroupHint')}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  )}
                </div>
              )
            })}
            {category && (
              addingGroup ? (
                <div className="inline-flex items-center gap-1">
                  <input
                    autoFocus
                    value={draftGroupName}
                    onChange={(e) => onChangeDraftGroupName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onCommitGroup()
                      if (e.key === 'Escape') onCancelAddGroup()
                    }}
                    placeholder={tStatic('pl.groupNamePlaceholder')}
                    className="input text-[11px] py-0.5 w-32"
                  />
                  <button className="btn btn-primary text-[10px] py-0.5 px-1.5" onClick={onCommitGroup}>{tStatic('pl.add')}</button>
                  <button className="btn btn-ghost text-[10px] py-0.5 px-1.5" onClick={onCancelAddGroup}>×</button>
                </div>
              ) : (
                <button
                  onClick={onStartAddGroup}
                  className="inline-flex items-center gap-0.5 px-1.5 py-1 rounded text-[10px] text-ink-3 border border-dashed border-line hover:text-ink-1 hover:bg-bg-3"
                  title={tStatic('pl.addGroupHint')}
                >
                  <Plus className="h-3 w-3" />
                </button>
              )
            )}
          </div>
          {groups.length > 0 && (
            <div className="flex flex-col gap-0.5 shrink-0">
              <button
                className="text-[10px] px-1.5 py-0.5 rounded border border-line text-ink-2 hover:bg-bg-3"
                onClick={() => onAllSubcats(true)}
              >
                {tStatic('pl.allGroups')}
              </button>
              <button
                className="text-[10px] px-1.5 py-0.5 rounded border border-line text-ink-2 hover:bg-bg-3"
                onClick={() => onAllSubcats(false)}
              >
                {tStatic('pl.noGroups')}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {groups.map((g, i) => ({ g, i }))
          .filter(({ i }) => activeSubcats.has(i))
          .slice(0, visibleGroupCount)
          .map(({ g, i }) => {
          const isAddingTag = addingTagInGroup === g.name
          const userAddedTagEns = getUserAddedTagsForGroup(g.name)
          const expanded = expandedGroups.has(g.name)
          const visibleTags = expanded ? g.tags : g.tags.slice(0, TAG_PREVIEW_LIMIT)
          const hiddenCount = g.tags.length - visibleTags.length
          return (
            <div key={g.name + i}>
              <div className="text-xs text-ink-2 mb-1.5 sticky top-0 bg-bg-2 py-0.5 flex items-baseline gap-2">
                <span>{g.name}</span>
                <span className="text-[10px] text-ink-3 font-mono">{g.tags.length}</span>
                {!isAddingTag && (
                  <button
                    onClick={() => onStartAddTag(g.name)}
                    className="ml-auto text-[10px] text-ink-3 hover:text-ink-1 inline-flex items-center gap-0.5"
                    title={tStatic('pl.addTagHint')}
                  >
                    <Plus className="h-2.5 w-2.5" /> {tStatic('pl.tag')}
                  </button>
                )}
              </div>
              {isAddingTag && (
                <div className="space-y-1 mb-1.5 p-1.5 rounded bg-bg-3/40">
                  <textarea
                    autoFocus
                    rows={Math.min(6, Math.max(1, draftTagEn.split('\n').length))}
                    value={draftTagEn}
                    onChange={(e) => onChangeDraftTagEn(e.target.value)}
                    onKeyDown={(e) => {
                      // Ctrl+Enter commits even with multi-line input.
                      // Plain Enter commits only when single-line (no \n yet).
                      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        e.preventDefault()
                        onCommitTag(g.name)
                      } else if (e.key === 'Enter' && !e.shiftKey && !draftTagEn.includes('\n') && !draftTagEn.includes(',')) {
                        e.preventDefault()
                        onCommitTag(g.name)
                      }
                      if (e.key === 'Escape') onCancelAddTag()
                    }}
                    placeholder={tStatic('pl.tagInputPlaceholder')}
                    className="input text-[11px] py-1 font-mono resize-none w-full"
                  />
                  <div className="flex items-center gap-1">
                    <input
                      value={draftTagJa}
                      onChange={(e) => onChangeDraftTagJa(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); onCommitTag(g.name) }
                        if (e.key === 'Escape') onCancelAddTag()
                      }}
                      placeholder={tStatic('pl.tagJaPlaceholder')}
                      className="input text-[11px] py-0.5 flex-1"
                    />
                    <button className="btn btn-primary text-[10px] py-0.5 px-1.5" onClick={() => onCommitTag(g.name)}>{tStatic('pl.add')}</button>
                    <button className="btn btn-ghost text-[10px] py-0.5 px-1.5" onClick={onCancelAddTag}>×</button>
                  </div>
                  <div className="text-[9px] text-ink-3 leading-tight">
                    {tStatic('pl.tagInputHint')}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-1">
                {visibleTags.map((t) => {
                  const isUserTag = userAddedTagEns.has(t.en)
                  return (
                    <TagChip
                      key={t.en}
                      tag={t}
                      color={g.color}
                      favorited={favorites.has(t.en)}
                      onAdd={onAddTag}
                      onToggleFav={onToggleFav}
                      deletable={isUserTag}
                      onDelete={isUserTag ? () => onDeleteTag(g.name, t.en) : undefined}
                    />
                  )
                })}
                {g.tags.length > TAG_PREVIEW_LIMIT && (
                  <button
                    className="inline-flex items-center px-2 py-1 rounded border border-line text-[11px] text-ink-2 hover:text-ink-0 hover:bg-bg-3"
                    onClick={() => toggleExpandedGroup(g.name)}
                  >
                    {expanded
                      ? tStatic('pl.showLessTags')
                      : tStatic('pl.showMoreTags', { count: hiddenCount })}
                  </button>
                )}
              </div>
            </div>
          )
        })}
        {Array.from(activeSubcats).filter((i) => i >= 0 && i < groups.length).length > visibleGroupCount && (
          <button
            className="btn w-full text-xs"
            onClick={() => setVisibleGroupCount((count) => count + GROUP_PREVIEW_LIMIT)}
          >
            {tStatic('pl.showMoreGroups', {
              count: Array.from(activeSubcats).filter((i) => i >= 0 && i < groups.length).length - visibleGroupCount
            })}
          </button>
        )}
        {groups.length === 0 && !isUserOnlyCat && (
          <div className="text-sm text-ink-3 text-center p-6">
            {tStatic('pl.noSubcatsBuiltin')}
          </div>
        )}
        {groups.length === 0 && isUserOnlyCat && (
          <div className="text-sm text-ink-3 text-center p-6">
            {tStatic('pl.noSubcatsUser')}
          </div>
        )}
        {activeSubcats.size === 0 && groups.length > 0 && (
          <div className="text-sm text-ink-3 text-center p-6">
            {tStatic('pl.selectSubcat')}
          </div>
        )}
      </div>
    </>
  )
}

interface SpecialListProps {
  title: string
  tags: (PromptGroupTag & { color: string })[]
  onAdd(en: string, e: React.MouseEvent): void
  onToggleFav(en: string, e: React.MouseEvent): void
  favorites: Set<string>
  emptyText: string
}

function SpecialList({ title, tags, onAdd, onToggleFav, favorites, emptyText }: SpecialListProps): JSX.Element {
  return (
    <>
      <div className="px-2 py-2 bg-bg-1 border-b border-line shrink-0">
        <div className="text-xs text-ink-1 font-medium">{title}</div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {tags.length === 0 ? (
          <div className="text-xs text-ink-3 text-center p-6 leading-relaxed">{emptyText}</div>
        ) : (
          <div className="flex flex-wrap gap-1">
            {tags.map((t) => (
              <TagChip
                key={t.en}
                tag={t}
                color={t.color}
                favorited={favorites.has(t.en)}
                onAdd={onAdd}
                onToggleFav={onToggleFav}
              />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

interface TagChipProps {
  tag: PromptGroupTag
  color: string
  favorited: boolean
  onAdd(en: string, e: React.MouseEvent): void
  onToggleFav(en: string, e: React.MouseEvent): void
  deletable?: boolean
  onDelete?(): void
}

function TagChip({ tag, color, favorited, onAdd, onToggleFav, deletable, onDelete }: TagChipProps): JSX.Element {
  const t = useT()
  return (
    <span
      className="group relative inline-flex items-center gap-1 px-2 py-1 rounded text-xs cursor-pointer hover:brightness-125 transition-all select-none"
      style={{ backgroundColor: color, borderRadius: 4 }}
      onClick={(e) => onAdd(tag.en, e)}
      title={`${tag.en} — ${tag.ja}`}
    >
      <span className="font-mono text-[11px]">{tag.en}</span>
      {tag.ja && <span className="text-[10px] text-ink-1/80">{tag.ja}</span>}
      <button
        onClick={(e) => onToggleFav(tag.en, e)}
        className={cn(
          'ml-0.5 p-0.5 rounded transition-opacity',
          favorited ? 'opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'
        )}
        title={favorited ? t('pl.unfav') : t('pl.fav')}
        tabIndex={-1}
      >
        <Star className={cn('h-2.5 w-2.5', favorited && 'fill-warn text-warn')} />
      </button>
      {deletable && onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="absolute -top-1 -right-1 hidden group-hover:flex h-3.5 w-3.5 items-center justify-center rounded-full bg-bg-3 border border-line text-ink-2 hover:bg-err/40 hover:text-ink-0"
          title={t('pl.deleteTagHint')}
          tabIndex={-1}
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  )
}
