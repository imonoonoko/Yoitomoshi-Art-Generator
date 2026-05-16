import type {
  CivitaiRecommended,
  LoraCivitaiMetadata,
  LoraUsageRecord,
  ScoredLora,
  SdLora
} from '@shared/types'
import { t as tStatic } from './i18n'
import { stripAdapterTokens } from './adapter-tokens'

const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const SIMILAR_PROMPT_THRESHOLD = 0.6

/**
 * Score every available LoRA against the current generation context and return
 * the top candidates for live display in the suggestion strip.
 *
 * Scoring (see docs/PROJECT_REPORT.md §7.2.3 for rationale):
 *   +200  appears in the selected checkpoint's Civitai sample images
 *         (THE strongest signal — what this checkpoint's community uses)
 *   +100  base model matches the checkpoint's base model
 *    +30  per trigger-word found in the current prompt
 *    +25  user starred this LoRA
 *    +20  user has used this LoRA with this checkpoint in the last 30 days
 *    +15  user has used this LoRA with a similar prompt in the last 30 days
 *    +10  per Civitai tag overlap with prompt words
 *    -40  user already has another LoRA active in the same category (dedup)
 *
 * Hard filter: if both have a baseModel and they're incompatible families,
 * the LoRA is dropped from the result entirely.
 */
export function scoreLoras(args: {
  loras: SdLora[]
  loraMeta: Map<string, LoraCivitaiMetadata>
  prompt: string
  selectedCheckpointTitle: string | null
  selectedRecommendation: CivitaiRecommended | null
  favorites: Set<string>
  recentUsage: LoraUsageRecord[]
  activeLoraNames: Set<string>
  limit?: number
}): ScoredLora[] {
  const {
    loras,
    loraMeta,
    prompt,
    selectedCheckpointTitle,
    selectedRecommendation,
    favorites,
    recentUsage,
    activeLoraNames,
    limit = 8
  } = args

  const promptLower = prompt.toLowerCase()
  const promptDigest = promptDigestOf(prompt)
  const promptWords = tokenize(promptLower)

  const recommendedFromCheckpoint = new Map<string, number>()
  for (const r of selectedRecommendation?.recommendedLoras ?? []) {
    recommendedFromCheckpoint.set(r.name.toLowerCase(), r.frequency)
  }

  const checkpointBase = selectedRecommendation?.baseModel ?? null

  // Categories of LoRAs already active — used to de-prioritize dupes.
  const activeCategories = new Set<string>()
  for (const name of activeLoraNames) {
    const meta = loraMeta.get(name)
    for (const t of meta?.tags ?? []) activeCategories.add(t.toLowerCase())
  }

  const scored: ScoredLora[] = []

  for (const lora of loras) {
    if (activeLoraNames.has(lora.name)) continue // already on, no need to suggest

    const meta = loraMeta.get(lora.name) ?? null
    const loraBase = meta?.baseModel ?? null

    if (checkpointBase && loraBase && !baseModelsCompatible(checkpointBase, loraBase)) {
      continue
    }

    let score = 0
    const reasons: string[] = []

    // 1. Model-recommended (highest priority)
    const recFreq = recommendedFromCheckpoint.get(lora.name.toLowerCase())
      ?? recommendedFromCheckpoint.get(lora.alias.toLowerCase())
    if (recFreq && recFreq > 0) {
      score += 200
      reasons.push(tStatic('loraSuggest.reason.modelRecommended', { count: recFreq }))
    }

    // 2. Base model match
    if (checkpointBase && loraBase && checkpointBase === loraBase) {
      score += 100
      reasons.push(tStatic('loraSuggest.reason.baseExact'))
    } else if (checkpointBase && loraBase && baseModelsCompatible(checkpointBase, loraBase)) {
      score += 60
      reasons.push(tStatic('loraSuggest.reason.baseCompatible'))
    }

    // 3. Trigger words present in prompt
    let triggerHits = 0
    for (const tw of meta?.trainedWords ?? []) {
      if (!tw) continue
      if (promptLower.includes(tw.toLowerCase())) triggerHits++
    }
    if (triggerHits > 0) {
      score += 30 * triggerHits
      reasons.push(tStatic('loraSuggest.reason.triggerMatch', { score: 30 * triggerHits, count: triggerHits }))
    }

    // 4. Favorited
    if (favorites.has(lora.name)) {
      score += 25
      reasons.push(tStatic('loraSuggest.reason.favorite'))
    }

    // 5. Used recently with same checkpoint
    const cutoff = Date.now() - RECENT_WINDOW_MS
    const sameCheckpointRecent = recentUsage.filter(
      (r) =>
        r.loraName === lora.name &&
        r.checkpointTitle === selectedCheckpointTitle &&
        r.timestamp >= cutoff
    )
    if (sameCheckpointRecent.length > 0) {
      score += 20
      reasons.push(tStatic('loraSuggest.reason.recentSameModel'))
    }

    // 6. Used recently with a similar prompt (cheap digest match)
    const similarRecent = recentUsage.filter(
      (r) =>
        r.loraName === lora.name &&
        r.timestamp >= cutoff &&
        digestSimilarity(r.promptDigest, promptDigest) >= SIMILAR_PROMPT_THRESHOLD
    )
    if (similarRecent.length > 0 && sameCheckpointRecent.length === 0) {
      score += 15
      reasons.push(tStatic('loraSuggest.reason.similarPrompt'))
    }

    // 7. Tag overlap with prompt words
    let tagOverlap = 0
    for (const tag of meta?.tags ?? []) {
      if (promptWords.has(tag.toLowerCase())) tagOverlap++
    }
    if (tagOverlap > 0) {
      score += 10 * tagOverlap
      reasons.push(tStatic('loraSuggest.reason.tagOverlap', { score: 10 * tagOverlap, count: tagOverlap }))
    }

    // 8. Same-category penalty
    const tagsLower = (meta?.tags ?? []).map((t) => t.toLowerCase())
    if (tagsLower.some((t) => activeCategories.has(t))) {
      score -= 40
      reasons.push(tStatic('loraSuggest.reason.sameCategoryPenalty'))
    }

    if (score > 0) scored.push({ lora, meta, score, reasons })
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}

/**
 * Given two base-model strings ("SDXL 1.0", "Pony", "SD 1.5", ...) decide
 * whether a LoRA from one will work on a checkpoint from the other.
 *
 * Pony, NoobAI, and Illustrious are all SDXL family but are *fine-tuned*
 * variants. A pure SDXL 1.0 LoRA usually works on Pony but a Pony-trained
 * LoRA does NOT work as well on vanilla SDXL. We collapse them all to one
 * family for matching — the user can disable strict mode in settings later
 * if they want only exact matches.
 */
export function baseModelsCompatible(a: string, b: string): boolean {
  return baseFamily(a) === baseFamily(b)
}

function baseFamily(s: string): string {
  if (/SDXL|Pony|NoobAI|Illustrious|Animagine/i.test(s)) return 'SDXL'
  if (/SD\s*1\.5|SD1\.5/i.test(s)) return 'SD15'
  if (/SD\s*2\.\d|SD2\.\d/i.test(s)) return 'SD2'
  if (/SD\s*3|SD3/i.test(s)) return 'SD3'
  if (/FLUX/i.test(s)) return 'FLUX'
  return s.toLowerCase().replace(/\s+/g, '')
}

/**
 * Cheap prompt digest: lowercase, strip tag/punctuation noise, keep at most
 * the first 40 alphanumeric chars. Storing only this in usage records means
 * we don't keep the user's full prompt history in plaintext on disk.
 */
export function promptDigestOf(prompt: string): string {
  return prompt
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^a-z0-9　-鿿\s,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
}

/** Token Jaccard similarity between two prompt digests. */
function digestSimilarity(a: string, b: string): number {
  const ta = new Set(tokenize(a))
  const tb = new Set(tokenize(b))
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  const union = ta.size + tb.size - inter
  return union > 0 ? inter / union : 0
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[\s,()<>:[\]]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2)
  )
}

// -------------------- Prompt ↔ active-LoRA syntax bridging --------------------

/**
 * Strip all `<lora:...>` tokens from a prompt (we manage them in state and
 * splice them in at request time). Whitespace and orphaned commas left over
 * are normalized. Used both when building the final request AND when the
 * user pastes a prompt that already contains <lora:...> so we can extract
 * them into activeLoras instead of leaving them in plain text.
 */
export function stripLoraTokens(prompt: string): {
  prompt: string
  loras: { name: string; tokenName?: string; weight: number; legacyKind?: 'lora' | 'lyco' }[]
} {
  const stripped = stripAdapterTokens(prompt)
  return {
    prompt: stripped.prompt,
    loras: stripped.tokens.map((token) => ({
      name: token.name,
      tokenName: token.name,
      weight: token.weight,
      legacyKind: token.kind === 'lyco' ? 'lyco' : 'lora'
    }))
  }
}

/** Splice active LoRAs into a prompt string for the actual API request. */
export function buildPromptWithLoras(
  prompt: string,
  active: { name: string; tokenName?: string; weight: number }[]
): string {
  if (active.length === 0) return prompt
  const tags = active.map((a) => `<lora:${a.tokenName ?? a.name}:${a.weight.toFixed(2)}>`).join(' ')
  return prompt.length > 0 ? `${prompt} ${tags}` : tags
}
