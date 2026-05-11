import type { UpscaleMethod, UpscaleState } from './store'

/**
 * Heuristic upscale-settings recommender.
 *
 * Given an image's PNG / EXIF metadata + raw dimensions + the catalog of
 * upscalers actually installed locally, propose a method + upscaler + scale +
 * denoise that suits the source. The user gets one-click "apply" to populate
 * the Upscale tab.
 *
 * Decision tree:
 *   1. Genre detection
 *      - prompt mentions anime / 1girl / masterpiece-style → "anime"
 *      - prompt mentions photo / RAW / realistic → "photo"
 *      - else → "unknown"
 *   2. Resolution tier
 *      - < 768²  → "small"   (needs significant enlargement, prefer 4x)
 *      - 768²..1280² → "medium" (typical 2x)
 *      - > 1280²  → "large"  (1.5x is enough)
 *   3. Method
 *      - SDXL/anime + medium-large → 'ultimate' (best quality / detail balance)
 *      - small (<768) → 'simple' (just enlarge first; user can do diffusion pass after)
 *      - else → 'diffusion' (let MultiDiffusion add coherent detail)
 *   4. Upscaler picked from `availableUpscalers`:
 *      - anime → first containing "Anime" then "R-ESRGAN" then any non-trivial
 *      - photo → first "R-ESRGAN 4x+" (no Anime), then ESRGAN, then any non-trivial
 *
 * Returns `null` if we couldn't make a meaningful guess (no metadata, missing
 * upscalers, etc.) — the caller falls back to the user's existing settings.
 */

export type Genre = 'anime' | 'photo' | 'unknown'
export type ResolutionTier = 'small' | 'medium' | 'large'

export interface UpscaleMetadata {
  prompt?: string
  modelName?: string | null
  /** From the image file itself, NOT the metadata (which often lies). */
  width: number
  height: number
}

export interface UpscaleSuggestion {
  method: UpscaleMethod
  upscaler: string
  scale: number
  denoise: number
  /** Tile dimensions chosen to match the source image's aspect ratio. */
  tileWidth: number
  tileHeight: number
  /** Why we picked these — surfaced in the UI as the user's reasoning hint. */
  reasonKey: string
  /** Substitution params for the reason translation. */
  reasonParams?: Record<string, string | number>
  /** Detected (or forced) genre / tier — exposed for UI badges. */
  genre: Genre
  tier: ResolutionTier
}

// Prompt keyword set for anime detection. Mix of:
//   - Booru-style numeric tags (1girl/2boys/...)
//   - Quality magic words common to anime model prompts
//   - Pony/Illustrious/SDXL-anime score tags
//   - Common subject + descriptor words
const ANIME_RE = new RegExp([
  '\\b(?:anime|illustration|manga|shoujo|shounen|bishoujo|bishounen|chibi|kawaii|moe|kemono|furry)\\b',
  '\\b(?:\\d+girls?|\\d+boys?|solo|multiple_(?:girls|boys)|loli|shota)\\b',
  '\\bscore_\\d+(?:_up)?\\b',           // pony / illustrious tags
  '\\b(?:masterpiece,\\s*best\\s+quality|best\\s+quality,\\s*masterpiece)\\b',
  '\\b(?:absurdres|highres|ultra-detailed)\\b'
].join('|'), 'i')

const PHOTO_RE = new RegExp([
  '\\b(?:photo(?:realistic|graphy)?|photorealism)\\b',
  '\\braw\\s+photo\\b',
  '\\b(?:dslr|cinematic|film\\s+grain|natural\\s+lighting|bokeh|depth\\s+of\\s+field)\\b',
  '\\b(?:8k\\s+uhd|professional\\s+photography)\\b'
].join('|'), 'i')

// Model-name family detection. Common SDXL/SD1.5 anime checkpoint families
// + common token patterns. Matched case-insensitively as a SUBSTRING — works
// for filenames like "desuCKNXL_v02.safetensors" (matches "XL" + checks
// other common anime tokens).
const ANIME_MODEL_RE = /(anime|pony|illustrious|noobai|animepastel|cetus|meinamix|mistoon|wai|hassaku|yiffymix|nai|nooba|orange|pixel|abyss|counterfeit|breakdomain|7thanime|aniverse|cuteyukimix|deliberate|dream(?:shaper)?|ckxl|ckn[xs]l)/i

const PHOTO_MODEL_RE = /(realistic|photorealistic|reallifevision|epicrealism|juggernaut|cyberrealistic|protovision|absoluterealism|chillout|majic)/i

/**
 * Best-effort genre detection from metadata. `forceGenre` lets the user
 * override when our heuristic misses (e.g. prompt is in a language whose
 * keywords we don't recognize, or the model is a custom merge with no
 * familiar tokens).
 */
function detectGenre(meta: UpscaleMetadata, forceGenre?: Genre): Genre {
  if (forceGenre && forceGenre !== 'unknown') return forceGenre
  const p = meta.prompt ?? ''
  if (ANIME_RE.test(p)) return 'anime'
  if (PHOTO_RE.test(p)) return 'photo'
  if (meta.modelName) {
    if (ANIME_MODEL_RE.test(meta.modelName)) return 'anime'
    if (PHOTO_MODEL_RE.test(meta.modelName)) return 'photo'
  }
  return 'unknown'
}

function tierForResolution(width: number, height: number): ResolutionTier {
  const pixels = width * height
  if (pixels < 768 * 768) return 'small'
  if (pixels > 1280 * 1280) return 'large'
  return 'medium'
}

/** Pick the best-matching upscaler from the actual installed catalog. */
function pickUpscaler(genre: Genre, available: string[]): string | null {
  if (available.length === 0) return null
  const trivial = new Set(['None', 'Lanczos', 'Nearest'])
  const real = available.filter((u) => !trivial.has(u))

  if (genre === 'anime') {
    // Prefer anime-tuned R-ESRGAN variants
    const anime = real.find((u) => /anime/i.test(u))
    if (anime) return anime
    // Fallback to general R-ESRGAN
    const resrgan = real.find((u) => /R-ESRGAN/i.test(u) && !/anime/i.test(u))
    if (resrgan) return resrgan
    return real[0] ?? available[0]
  }
  if (genre === 'photo') {
    // Photorealistic: prefer non-anime R-ESRGAN
    const realistic = real.find((u) => /R-ESRGAN/i.test(u) && !/anime/i.test(u))
    if (realistic) return realistic
    const esrgan = real.find((u) => /ESRGAN/i.test(u) && !/anime/i.test(u))
    if (esrgan) return esrgan
    return real[0] ?? available[0]
  }
  // unknown genre — generic preference order
  return (
    real.find((u) => u === 'R-ESRGAN 4x+') ??
    real.find((u) => /R-ESRGAN/i.test(u)) ??
    real[0] ??
    available[0]
  )
}

/**
 * Snap tile dimensions to a multiple of `step` (Forge uses 16/64-pixel grid
 * for tile components — picking arbitrary sizes works but conventional sizes
 * align better with the model's latent grid).
 */
function snapToGrid(n: number, step = 64): number {
  return Math.max(step, Math.round(n / step) * step)
}

export function suggestUpscaleSettings(
  meta: UpscaleMetadata,
  availableUpscalers: string[],
  forceGenre?: Genre
): UpscaleSuggestion | null {
  const genre = detectGenre(meta, forceGenre)
  const upscaler = pickUpscaler(genre, availableUpscalers)
  if (!upscaler) return null

  const tier = tierForResolution(meta.width, meta.height)

  // Scale: small images get 4x to bring up to a usable size; large stay at 1.5x.
  const scale = tier === 'small' ? 4 : tier === 'large' ? 1.5 : 2

  // Method: prefer Ultimate for medium/large of known genre (best quality at
  // moderate cost). Simple for small-original (faster first enlargement).
  // Diffusion when we have unknown genre (can't optimize, fall back to detail).
  let method: UpscaleMethod
  if (tier === 'small') method = 'simple'
  else if (genre === 'unknown') method = 'diffusion'
  else method = 'ultimate'

  // Denoise: target the "preserve character + nudge detail" sweet spot from
  // community testing (r/StableDiffusion, MultiDiffusion paper):
  //   0.20–0.30 keeps the source recognizable across tiles
  //   0.40+ frequently produces tile drift (top vs bottom = different chars)
  // Anime gets 0.25 (line art tolerates a bit more denoise without melting).
  // Photo gets 0.20 (skin / texture is fragile, lower is safer).
  const denoise = method === 'simple'
    ? 0.0  // unused for simple but keep state consistent
    : genre === 'anime' ? 0.25
    : 0.20

  // Tile dimensions: match the source image's aspect ratio. The diffusion
  // model processes one tile at a time at the source's native resolution,
  // so each tile = "one full source view" feels natural and avoids the
  // square-tile-on-portrait awkwardness (which used to default to 768×768
  // for any input). Snap to 64-pixel grid so it lands on the latent
  // boundary cleanly.
  //
  // Cap at 1024 max — anything bigger blows past 8GB VRAM under SDXL even
  // with --medvram. Floor at 64 (gives the smallest meaningful tile).
  const tileWidth = Math.min(1024, snapToGrid(meta.width))
  const tileHeight = Math.min(1024, snapToGrid(meta.height))

  return {
    method,
    upscaler,
    scale,
    denoise,
    tileWidth,
    tileHeight,
    reasonKey:
      genre === 'anime' ? 'upscale.suggest.reasonAnime' :
      genre === 'photo' ? 'upscale.suggest.reasonPhoto' :
      'upscale.suggest.reasonUnknown',
    reasonParams: {
      tier:
        tier === 'small' ? '<768²' :
        tier === 'large' ? '>1280²' : '768²–1280²'
    },
    genre,
    tier
  }
}

/**
 * Turn an UpscaleSuggestion into a partial UpscaleState patch.
 *
 * Applies tile dimensions to **both** methods' tile fields (Diffusion's
 * `tileWidth/tileHeight` and Ultimate's `ultimateTileWidth/Height`)
 * regardless of which method the suggestion picks. The user can switch
 * methods after applying without losing the matched tile size — otherwise
 * the unselected method's tiles silently revert to their defaults.
 */
export function applyUpscaleSuggestion(s: UpscaleSuggestion): Partial<UpscaleState> {
  const patch: Partial<UpscaleState> = {
    method: s.method,
    upscaler: s.upscaler,
    scale: s.scale,
    tileWidth: s.tileWidth,
    tileHeight: s.tileHeight,
    ultimateTileWidth: s.tileWidth,
    ultimateTileHeight: s.tileHeight
  }
  if (s.method !== 'simple') {
    patch.denoise = s.denoise
  }
  return patch
}
