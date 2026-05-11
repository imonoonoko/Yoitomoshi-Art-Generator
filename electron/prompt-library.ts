import { readFileSync } from 'node:fs'
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
  const path = join(resourcesDir, 'prompt-library.ja.yaml')
  const raw = readFileSync(path, 'utf8')
  const parsed = yaml.load(raw) as RawCategory[] | null

  const categories: PromptCategory[] = []
  const autocomplete = new Map<string, string>()

  if (!parsed || !Array.isArray(parsed)) {
    return { categories, autocompleteIndex: autocomplete }
  }

  for (const cat of parsed) {
    if (!cat?.name || !Array.isArray(cat.groups)) continue
    const groups: PromptGroup[] = []
    for (const g of cat.groups) {
      if (!g?.name || !g.tags) continue
      const entries = Object.entries(g.tags).map(([en, ja]) => ({
        en,
        ja: (ja ?? '').toString()
      }))
      for (const t of entries) {
        if (!autocomplete.has(t.en)) autocomplete.set(t.en, t.ja)
      }
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

  return { categories, autocompleteIndex: autocomplete }
}
