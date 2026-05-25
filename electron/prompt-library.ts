import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import type { PromptCategory, PromptGroup } from '../src/shared/types.js'

/**
 * Source YAML schema (Physton/sd-webui-prompt-all-in-one, MIT):
 *   - name: <category>
 *     groups:
 *       - name: <subcategory>
 *         color: rgba(...)
 *         tags:
 *           english_term: japanese_translation
 *
 * After parse we flatten `tags` map into an ordered array so the renderer
 * can render chips deterministically.
 */
type RawCategory = {
  name: string
  groups: Array<{
    name: string
    color: string
    tags: Record<string, string | null>
  }>
}

export interface PromptLibrary {
  categories: PromptCategory[]
  /** flat tag → ja translation map, used for autocomplete */
  autocompleteIndex: Map<string, string>
}

export function loadPromptLibrary(resourcesDir: string): PromptLibrary {
  const paths = [
    join(resourcesDir, 'prompt-library.ja.yaml'),
    join(resourcesDir, 'prompt-library.yoitomoshi.ja.yaml'),
    join(resourcesDir, 'prompt-dictionary.yoitomoshi.ja.yaml')
  ]

  let categories: PromptCategory[] = []
  const autocomplete = new Map<string, string>()

  for (const path of paths) {
    if (!existsSync(path)) continue
    const raw = readFileSync(path, 'utf8')
    const parsed = yaml.load(raw) as RawCategory[] | null
    categories = mergeCategories(categories, normalizeCategories(parsed))
  }

  for (const cat of categories) {
    for (const group of cat.groups) {
      for (const tag of group.tags) {
        if (!autocomplete.has(tag.en)) autocomplete.set(tag.en, tag.ja)
      }
    }
  }

  return { categories, autocompleteIndex: autocomplete }
}

function normalizeCategories(parsed: RawCategory[] | null): PromptCategory[] {
  if (!parsed || !Array.isArray(parsed)) return []

  const categories: PromptCategory[] = []
  for (const cat of parsed) {
    if (!cat?.name || !Array.isArray(cat.groups)) continue
    const groups: PromptGroup[] = []
    for (const g of cat.groups) {
      if (!g?.name || !g.tags) continue
      const entries = Object.entries(g.tags).map(([en, ja]) => ({
        en,
        ja: (ja ?? '').toString()
      }))
      groups.push({
        name: g.name,
        color: g.color || 'rgba(120, 120, 130, .35)',
        tags: entries
      })
    }
    if (groups.length > 0) {
      categories.push({ name: cat.name, groups })
    }
  }
  return categories
}

function mergeCategories(base: PromptCategory[], additions: PromptCategory[]): PromptCategory[] {
  const merged = base.map((cat) => ({
    ...cat,
    groups: cat.groups.map((group) => ({ ...group, tags: [...group.tags] }))
  }))
  const categoryByName = new Map(merged.map((cat) => [cat.name, cat]))

  for (const addCat of additions) {
    const targetCat = categoryByName.get(addCat.name)
    if (!targetCat) {
      const nextCat = {
        ...addCat,
        groups: addCat.groups.map((group) => ({ ...group, tags: [...group.tags] }))
      }
      merged.push(nextCat)
      categoryByName.set(nextCat.name, nextCat)
      continue
    }

    const groupByName = new Map(targetCat.groups.map((group) => [group.name, group]))
    for (const addGroup of addCat.groups) {
      const targetGroup = groupByName.get(addGroup.name)
      if (!targetGroup) {
        const nextGroup = { ...addGroup, tags: [...addGroup.tags] }
        targetCat.groups.push(nextGroup)
        groupByName.set(nextGroup.name, nextGroup)
        continue
      }

      const tagEns = new Set(targetGroup.tags.map((tag) => tag.en))
      for (const tag of addGroup.tags) {
        if (tagEns.has(tag.en)) continue
        targetGroup.tags.push(tag)
        tagEns.add(tag.en)
      }
    }
  }

  return merged
}
