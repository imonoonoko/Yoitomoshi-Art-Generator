import { createHash } from 'node:crypto'
import { createReadStream, existsSync, statSync, createWriteStream } from 'node:fs'
import { rename, unlink, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  CivitaiAssetType,
  CivitaiCommunityStats,
  CivitaiDownloadProgress,
  CivitaiDownloadRequest,
  CivitaiQuickRef,
  CivitaiRecommended,
  CivitaiSearchFile,
  CivitaiSearchItem,
  CivitaiSearchOptions,
  CivitaiSearchResult,
  CivitaiTag,
  Distribution,
  LoraCivitaiMetadata,
  ModelUpdateInfo
} from '../src/shared/types.js'

const CIVITAI_BASE = 'https://civitai.com/api/v1'
const HASH_CACHE = new Map<string, string>() // filepath → sha256

type CivitaiErrorKind =
  | 'auth'
  | 'rate-limit'
  | 'not-found'
  | 'server'
  | 'network'
  | 'unknown'

export class CivitaiHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly kind: CivitaiErrorKind,
    public readonly retriable: boolean
  ) {
    super(message)
    this.name = 'CivitaiHttpError'
  }
}

function civitaiHeaders(apiKey: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'Yoitomoshi-Art-Generator/0.1'
  }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return headers
}

async function civitaiJson<T>(
  pathOrUrl: string,
  apiKey: string | null,
  label: string,
  init?: RequestInit
): Promise<T | null> {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${CIVITAI_BASE}${pathOrUrl}`
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        ...civitaiHeaders(apiKey),
        ...(init?.headers as Record<string, string> | undefined)
      }
    })
  } catch (error) {
    throw new CivitaiHttpError(
      `${label}: Civitaiへ接続できません (${(error as Error).message})`,
      null,
      'network',
      true
    )
  }

  if (response.status === 404) return null
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw classifyCivitaiError(label, response.status, body)
  }
  return (await response.json()) as T
}

function classifyCivitaiError(label: string, status: number, body: string): CivitaiHttpError {
  const detail = body.trim().slice(0, 200)
  if (status === 401 || status === 403) {
    return new CivitaiHttpError(
      `${label}: Civitai APIキーが未設定、期限切れ、または権限不足です`,
      status,
      'auth',
      false
    )
  }
  if (status === 429) {
    return new CivitaiHttpError(
      `${label}: Civitaiのレート制限に達しました。時間を置くかAPIキーを設定してください`,
      status,
      'rate-limit',
      true
    )
  }
  if (status >= 500) {
    return new CivitaiHttpError(
      `${label}: Civitai側の一時エラーです (${status})${detail ? `: ${detail}` : ''}`,
      status,
      'server',
      true
    )
  }
  return new CivitaiHttpError(
    `${label}: Civitai API ${status}${detail ? `: ${detail}` : ''}`,
    status,
    'unknown',
    false
  )
}

/**
 * Compute SHA-256 of a model file.
 *
 * Civitai indexes safetensors by their full-file SHA-256 (matching what A1111 stores
 * in `cache.json` after first load). For multi-GB files we stream and report progress
 * via the optional callback so the UI can show "hashing..." feedback.
 */
export async function hashModelFile(
  filepath: string,
  onProgress?: (bytesRead: number, total: number) => void
): Promise<string> {
  const cached = HASH_CACHE.get(filepath)
  if (cached) return cached

  const total = statSync(filepath).size
  const hash = createHash('sha256')
  let read = 0

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filepath, { highWaterMark: 1024 * 1024 * 4 })
    stream.on('data', (chunk) => {
      hash.update(chunk)
      read += chunk.length
      onProgress?.(read, total)
    })
    stream.on('end', () => resolve())
    stream.on('error', reject)
  })

  const digest = hash.digest('hex')
  HASH_CACHE.set(filepath, digest)
  return digest
}

interface CivitaiImage {
  url: string
  nsfw: boolean | string  // Civitai returns boolean for legacy or "None"|"Soft"|"Mature"|"X"
  meta: {
    prompt?: string
    negativePrompt?: string
    sampler?: string
    steps?: number
    cfgScale?: number
    Size?: string             // "1024x1024"
    'Clip skip'?: number | string
    VAE?: string              // e.g., "sdxl_vae.safetensors"
  } | null
}

interface CivitaiFile {
  id: number
  name: string
  type: string                  // "Model" | "VAE" | "Config" | "Training Data" | ...
  sizeKB?: number
  downloadUrl?: string
  hashes?: { SHA256?: string; AutoV2?: string }
  primary?: boolean
  metadata?: { format?: string; fp?: string; size?: string }
  pickleScanResult?: string
  virusScanResult?: string
}

interface CivitaiVersion {
  id: number
  modelId: number
  name: string
  description?: string | null
  baseModel: string
  trainedWords: string[]
  images: CivitaiImage[]
  files?: CivitaiFile[]
  model: {
    name: string
    type: string
    nsfw: boolean
    description?: string | null
    creator?: { username?: string }
    tags?: string[]
    allowNoCredit?: boolean
    allowCommercialUse?: string
    allowDerivatives?: boolean
    allowDifferentLicense?: boolean
  }
}

interface CivitaiModelDetail {
  id: number
  name: string
  description?: string | null
  tags?: string[]
  creator?: { username?: string }
  allowNoCredit?: boolean
  allowCommercialUse?: string
  allowDerivatives?: boolean
  allowDifferentLicense?: boolean
}

/**
 * Fetch model metadata from Civitai by file SHA-256.
 *
 * Civitai's `/model-versions/by-hash/{hash}` is the canonical lookup —
 * given any file hash, it returns the version (and embedded model info).
 * We then derive recommended settings by taking the median of sample-image params.
 */
export async function fetchByHash(
  sha256: string,
  apiKey: string | null
): Promise<CivitaiRecommended | null> {
  const v = await civitaiJson<CivitaiVersion>(
    `/model-versions/by-hash/${sha256}`,
    apiKey,
    'Civitai hash lookup'
  )
  if (!v) return null

  return {
    modelName: v.model.name,
    versionName: v.name,
    modelVersionId: v.id,
    modelId: v.modelId,
    baseModel: v.baseModel,
    creator: v.model.creator?.username ?? null,
    description: stripModelAndVersionDescription(v, 1200),
    tags: v.model.tags ?? [],
    trainedWords: v.trainedWords ?? [],
    suggested: deriveSuggestedSettings(v.images ?? []),
    recommendedLoras: extractRecommendedLoras(v.images ?? []),
    recommendedVae: extractRecommendedVae(v),
    thumbnailUrl: pickThumbnail(v.images ?? []),
    civitaiUrl: `https://civitai.com/models/${v.modelId}?modelVersionId=${v.id}`,
    fetchedAt: Date.now()
  }
}

/**
 * Pick the recommended VAE for this checkpoint. Priority:
 *   1. Civitai's structured `files[]` containing a `type="VAE"` entry — these
 *      are the "Optional Files" the model author explicitly attaches.
 *      Highest-confidence signal because the author hand-picked it.
 *   2. Most-frequent `meta.VAE` across sample images. Lower confidence but
 *      reflects what the community actually pairs the model with.
 *
 * (1) gives us a downloadUrl too, enabling one-click fetch from the UI.
 */
function extractRecommendedVae(
  version: CivitaiVersion
): { name: string; downloadUrl: string | null; sizeBytes: number | null } | null {
  const files = version.files ?? []
  // Case-insensitive type match — Civitai sometimes returns "VAE" / "vae".
  const vaeFile = files.find((f) => /^vae$/i.test(f.type))
  if (vaeFile) {
    return {
      name: vaeFile.name,
      downloadUrl: vaeFile.downloadUrl ?? null,
      sizeBytes: vaeFile.sizeKB != null ? Math.round(vaeFile.sizeKB * 1024) : null
    }
  }
  const names = (version.images ?? [])
    .map((i) => i.meta?.VAE)
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
  const sample = mode(names)
  return sample ? { name: sample, downloadUrl: null, sizeBytes: null } : null
}

/**
 * Same hash-lookup pattern, but the response is reshaped for LoRA cards.
 * Civitai returns a model version regardless of whether the file is a
 * checkpoint or LoRA, so we reuse the endpoint but extract a LoRA-flavored
 * subset (no `suggested` settings since LoRAs don't define those, just
 * trigger words + base model + tags).
 */
export async function fetchLoraByHash(
  sha256: string,
  apiKey: string | null
): Promise<LoraCivitaiMetadata | null> {
  const v = await civitaiJson<CivitaiVersion>(
    `/model-versions/by-hash/${sha256}`,
    apiKey,
    'Civitai LoRA hash lookup'
  )
  if (!v) return null
  const primaryFile = pickPrimaryModelFile(v.files ?? [])
  const preliminaryDescription = stripModelAndVersionDescription(v, 2000)
  let description = preliminaryDescription
  let recommendedPrompts = extractLoraRecommendedPrompts(description, v.trainedWords ?? [])
  let modelDetail: CivitaiModelDetail | null = null
  if (!v.model.description && recommendedPrompts.length === 0) {
    modelDetail = await fetchModelDetail(v.modelId, apiKey).catch(() => null)
    if (modelDetail?.description) {
      description = stripModelAndVersionDescription(v, 2000, modelDetail.description)
      recommendedPrompts = extractLoraRecommendedPrompts(description, v.trainedWords ?? [])
    }
  }
  const descriptionSource = modelDetail?.description || v.model.description
    ? 'model'
    : v.description
      ? 'version'
      : 'none'

  return {
    modelId: v.modelId,
    modelVersionId: v.id,
    modelName: v.model.name,
    versionName: v.name,
    baseModel: v.baseModel,
    trainedWords: v.trainedWords ?? [],
    description,
    descriptionSource,
    recommendedPrompts,
    tags: modelDetail?.tags ?? v.model.tags ?? [],
    files: normalizeCivitaiFiles(v.files ?? []),
    availability: {
      primaryFileSha256: primaryFile?.hashes?.SHA256 ?? null,
      primaryFileName: primaryFile?.name ?? null,
      primaryFileFormat: primaryFile?.metadata?.format ?? null,
      pickleScanResult: primaryFile?.pickleScanResult ?? null,
      virusScanResult: primaryFile?.virusScanResult ?? null
    },
    usage: {
      allowNoCredit: booleanOrNull(modelDetail?.allowNoCredit ?? v.model.allowNoCredit),
      allowCommercialUse: modelDetail?.allowCommercialUse ?? v.model.allowCommercialUse ?? null,
      allowDerivatives: booleanOrNull(modelDetail?.allowDerivatives ?? v.model.allowDerivatives),
      allowDifferentLicense: booleanOrNull(modelDetail?.allowDifferentLicense ?? v.model.allowDifferentLicense)
    },
    thumbnailUrl: pickThumbnail(v.images ?? []),
    civitaiUrl: `https://civitai.com/models/${v.modelId}?modelVersionId=${v.id}`,
    fetchedAt: Date.now()
  }
}

function extractLoraRecommendedPrompts(
  description: string | null,
  trainedWords: string[]
): string[] {
  if (!description) return []
  const lines = description
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(normalizeDescriptionLine)

  const candidates: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue

    const inline = promptTextAfterDescriptionLabel(line)
    if (inline) {
      candidates.push(inline)
      continue
    }

    if (!isPromptDescriptionHeading(line)) continue
    for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
      const next = lines[j]
      if (!next) {
        if (j > i + 1) break
        continue
      }
      if (isNegativePromptDescriptionLine(next)) break
      if (isDescriptionSectionBoundary(next)) break
      candidates.push(promptTextAfterDescriptionLabel(next) ?? next)
    }
  }

  const seen = new Set(trainedWords.map(promptHintKey).filter(Boolean))
  const out: string[] = []
  for (const candidate of candidates) {
    for (const token of splitPromptHintTokens(candidate)) {
      const normalized = normalizePromptHintToken(token)
      const key = promptHintKey(normalized)
      if (!normalized || !key || seen.has(key)) continue
      seen.add(key)
      out.push(normalized)
      if (out.length >= 16) return out
    }
  }
  return out
}

async function fetchModelDetail(modelId: number, apiKey: string | null): Promise<CivitaiModelDetail | null> {
  return civitaiJson<CivitaiModelDetail>(
    `/models/${modelId}`,
    apiKey,
    'Civitai model detail lookup'
  )
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function normalizeDescriptionLine(line: string): string {
  return line
    .replace(/^[\s>*•・-]+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/\*\*/g, '')
    .trim()
}

function promptTextAfterDescriptionLabel(line: string): string | null {
  const patterns = [
    /^(?:(?:recommended|suggested|example|sample|positive)\s+)?prompts?\s*[:：-]\s*(.+)$/i,
    /^(?:prompt\s+(?:example|sample)|positive\s+prompt)\s*[:：-]\s*(.+)$/i,
    /^(?:positive|positive\s+tags?|prompt\s+tags?)\s*[:：-]\s*(.+)$/i,
    /^(?:(?:recommended|suggested)\s+)?(?:tags?|words?)\s+to\s+use\s*[:：-]\s*(.+)$/i,
    /^(?:recommended|suggested)\s+(?:tags?|words?)\s*[:：-]\s*(.+)$/i,
    /^tags?(?:\s*\((?![^)]*(?:negative|neg))[^)]*\))?\s*[:：-]\s*(.+)$/i,
    /^(?:推奨|おすすめ|推奨される|おすすめの)?\s*(?:プロンプト|タグ)\s*[:：-]\s*(.+)$/i,
    /^(?:プロンプト例|使用プロンプト|ポジティブプロンプト|追加タグ)\s*[:：-]\s*(.+)$/i
  ]
  for (const pattern of patterns) {
    const match = line.match(pattern)
    if (match?.[1]) return match[1]
  }
  const include = line.match(/^(?:include|add|use)\s+(.+?)(?:\s+(?:explicitly|for best|to help)\b.*)?$/i)
  if (include?.[1] && include[1].includes(',')) return include[1]
  return null
}

function isPromptDescriptionHeading(line: string): boolean {
  return [
    /^(?:(?:recommended|suggested|example|sample|positive)\s+)?prompts?\s*[:：]?$/i,
    /^(?:prompt\s+(?:example|sample)|positive\s+prompt)\s*[:：]?$/i,
    /^(?:positive|positive\s+tags?|prompt\s+tags?|quick[- ]start(?:\s+template)?)\s*[:：]?$/i,
    /^(?:recommended|suggested)\s+(?:tags?|words?)\s*[:：]?$/i,
    /^tags?(?:\s*\((?![^)]*(?:negative|neg))[^)]*\))?\s*[:：]?$/i,
    /^(?:推奨|おすすめ|推奨される|おすすめの)?\s*(?:プロンプト|タグ)\s*[:：]?$/i,
    /^(?:プロンプト例|使用プロンプト|ポジティブプロンプト|追加タグ)\s*[:：]?$/i
  ].some((pattern) => pattern.test(line))
}

function isNegativePromptDescriptionLine(line: string): boolean {
  return /^(?:negative|neg\.?|undesired)\b.*[:：]/i.test(line) ||
    /^tags?\s*\([^)]*(?:negative|neg)[^)]*\)\s*[:：]/i.test(line) ||
    /^(?:ネガティブ|除外)\s*[:：]/i.test(line)
}

function isDescriptionSectionBoundary(line: string): boolean {
  if (promptTextAfterDescriptionLabel(line) || isPromptDescriptionHeading(line)) return true
  if (isNegativePromptDescriptionLine(line)) return true
  return /^(?:settings?|parameters?|steps?|sampler|cfg|seed|size|model|vae|clip skip|license|download|changelog|version|notes?)\b.*[:：]/i.test(line) ||
    /^(?:ネガティブ|設定|推奨設定|手順|サンプラー|シード|サイズ|モデル|トリガー|学習ワード|ライセンス|商用|更新|注意)\s*[:：]/i.test(line)
}

function splitPromptHintTokens(text: string): string[] {
  const clean = text
    .replace(/<(?:lora|lyco|hypernet):[^>]+>/gi, ' ')
    .replace(/\b(?:negative prompt|negative|settings?|parameters?|steps?|sampler|cfg scale|cfg|seed|size|model hash|model|vae|clip skip)\b[\s\S]*$/i, '')
    .replace(/https?:\/\/\S+/gi, ' ')
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i <= clean.length; i++) {
    const ch = clean[i]
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1)
    if ((i === clean.length || ((ch === ',' || ch === '、' || ch === '\n') && depth === 0))) {
      out.push(clean.slice(start, i))
      start = i + 1
    }
  }
  return out
}

function normalizePromptHintToken(token: string): string {
  const cleaned = token
    .replace(/^[\s"'`*_~]+|[\s"'`*_~]+$/g, '')
    .replace(/[。.!]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length < 2 || cleaned.length > 120) return ''
  if (/^(?:none|n\/a|null|-)$|^(?:steps?|sampler|cfg|seed|size|model|vae|clip skip|negative|trigger|trained words?|weight|strength|recommended weight|lora strength)\b/i.test(cleaned)) return ''
  if (/^(?:設定|推奨設定|シード|サイズ|モデル|ネガティブ|トリガー)\b/i.test(cleaned)) return ''
  if (/\b(?:download|license|commercial use|credit required|discord|patreon|instagram|twitter|civitai)\b/i.test(cleaned)) return ''
  return cleaned
}

function promptHintKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Mine the checkpoint's sample-image prompts for `<lora:name:weight>` references.
 *
 * Civitai exposes no structured "this checkpoint recommends X LoRA" field, but
 * the sample images people upload almost always include the LoRA syntax in
 * their `meta.prompt`. The most-used LoRAs across samples are a strong signal
 * for what the checkpoint creator (and community) actually pair this model with.
 */
function extractRecommendedLoras(
  images: CivitaiImage[]
): { name: string; weight: number; frequency: number }[] {
  const counts = new Map<string, { weights: number[]; freq: number }>()
  const re = /<(?:lora|lyco):([^:>]+):([^>]+)>/gi
  for (const img of images) {
    const prompt = img.meta?.prompt
    if (!prompt) continue
    let m: RegExpExecArray | null
    re.lastIndex = 0
    while ((m = re.exec(prompt)) !== null) {
      const name = m[1].trim()
      if (!name) continue
      const weight = parseAdapterWeight(m[2])
      const e = counts.get(name) ?? { weights: [], freq: 0 }
      e.weights.push(weight)
      e.freq++
      counts.set(name, e)
    }
  }
  return Array.from(counts.entries())
    .map(([name, e]) => ({
      name,
      weight: median(e.weights) ?? 1,
      frequency: e.freq
    }))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 20)
}

function pickThumbnail(images: CivitaiImage[]): string | null {
  const safe = images.find((i) => isSafe(i.nsfw)) ?? images[0]
  return safe?.url ?? null
}

function stripModelAndVersionDescription(
  version: CivitaiVersion,
  maxChars: number,
  modelDescription = version.model.description
): string | null {
  const html = [
    modelDescription,
    version.description
  ]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join('<br><br>')
  return stripHtmlExcerpt(html || null, maxChars)
}

function isSafe(nsfw: boolean | string): boolean {
  if (typeof nsfw === 'boolean') return !nsfw
  return nsfw === 'None' || nsfw === 'Soft'
}

function deriveSuggestedSettings(images: CivitaiImage[]): CivitaiRecommended['suggested'] {
  // Use only images that have meta data to derive recommendations.
  const withMeta = images.filter((i) => i.meta && Object.keys(i.meta).length > 0)
  if (withMeta.length === 0) {
    return {
      sampler: null,
      steps: null,
      cfgScale: null,
      width: null,
      height: null,
      clipSkip: null,
      negativePrompt: null
    }
  }

  const samplers: string[] = []
  const steps: number[] = []
  const cfgScales: number[] = []
  const widths: number[] = []
  const heights: number[] = []
  const clipSkips: number[] = []
  let negativePrompt: string | null = null

  for (const image of withMeta) {
    const meta = image.meta!
    if (isString(meta.sampler)) samplers.push(meta.sampler)
    if (isNumber(meta.steps)) steps.push(meta.steps)
    if (isNumber(meta.cfgScale)) cfgScales.push(meta.cfgScale)
    const size = parseSize(meta.Size)
    if (isNumber(size?.w)) widths.push(size.w)
    if (isNumber(size?.h)) heights.push(size.h)
    const rawClipSkip = meta['Clip skip']
    const clipSkip = typeof rawClipSkip === 'string' ? parseInt(rawClipSkip, 10) : rawClipSkip
    if (isNumber(clipSkip)) clipSkips.push(clipSkip)
    if (isString(meta.negativePrompt) && (!negativePrompt || meta.negativePrompt.length > negativePrompt.length)) {
      negativePrompt = meta.negativePrompt
    }
  }

  return {
    sampler: mode(samplers),
    steps: median(steps),
    cfgScale: median(cfgScales),
    width: median(widths),
    height: median(heights),
    clipSkip: median(clipSkips),
    // Pick the longest negative prompt — usually the most "complete" reference.
    negativePrompt
  }
}

function isString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}
function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function parseSize(s: string | undefined): { w: number; h: number } | undefined {
  if (!s) return undefined
  const m = s.match(/(\d+)\s*x\s*(\d+)/i)
  if (!m) return undefined
  return { w: parseInt(m[1], 10), h: parseInt(m[2], 10) }
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid]
}

function mode<T>(arr: T[]): T | null {
  if (arr.length === 0) return null
  const counts = new Map<T, number>()
  let bestKey: T = arr[0]
  let bestCount = 0
  for (const v of arr) {
    const c = (counts.get(v) ?? 0) + 1
    counts.set(v, c)
    if (c > bestCount) {
      bestCount = c
      bestKey = v
    }
  }
  return bestKey
}

// =========================================================================
//  Civitai search + in-app download
// =========================================================================

/**
 * Search Civitai's model catalog. Mirrors the `/api/v1/models` endpoint with
 * the filters we expose in the UI; returns a normalized shape so the renderer
 * doesn't have to deal with Civitai's verbose response.
 *
 * Pagination: caller passes `page`, we return the next page number (or null
 * at the end) so the UI can implement "もっと見る" without recomputing.
 */
export async function searchCivitai(
  opts: CivitaiSearchOptions,
  apiKey: string | null
): Promise<CivitaiSearchResult> {
  const params = new URLSearchParams()
  if (opts.query?.trim()) params.set('query', opts.query.trim())
  if (opts.types && opts.types.length > 0) {
    for (const t of opts.types) params.append('types', t)
  }
  params.set('sort', opts.sort ?? 'Most Downloaded')
  params.set('period', opts.period ?? 'AllTime')
  params.set('nsfw', String(!!opts.nsfw))
  if (opts.baseModels && opts.baseModels.length > 0) {
    for (const b of opts.baseModels) params.append('baseModels', b)
  }
  params.set('limit', String(Math.min(100, Math.max(1, opts.limit ?? 20))))

  // Civitai requires cursor-based pagination when `query` is set
  // (page-based returns 400). Without `query`, page-based works fine.
  // We support both based on what the caller passed.
  const usingCursor = !!opts.query?.trim()
  if (usingCursor) {
    if (opts.cursor) params.set('cursor', opts.cursor)
  } else {
    params.set('page', String(opts.page ?? 1))
  }

  const data = await civitaiJson<RawSearchResponse>(
    `/models?${params.toString()}`,
    apiKey,
    'Civitai search'
  )
  if (!data) {
    return {
      items: [],
      totalItems: 0,
      totalPages: 1,
      currentPage: opts.page ?? 1,
      nextPage: null,
      nextCursor: null
    }
  }
  return {
    items: (data.items ?? []).map(normalizeSearchItem),
    totalItems: data.metadata?.totalItems ?? 0,
    totalPages: data.metadata?.totalPages ?? 1,
    currentPage: data.metadata?.currentPage ?? opts.page ?? 1,
    nextPage:
      !usingCursor &&
      (data.metadata?.currentPage ?? 0) < (data.metadata?.totalPages ?? 0)
        ? (data.metadata?.currentPage ?? 0) + 1
        : null,
    nextCursor: data.metadata?.nextCursor ?? null
  }
}

interface RawSearchResponse {
  items: RawSearchItem[]
  metadata?: {
    totalItems?: number
    totalPages?: number
    currentPage?: number
    nextPage?: string
    nextCursor?: string
  }
}

interface RawSearchItem {
  id: number
  name: string
  type: string
  nsfw: boolean
  tags?: string[]
  creator?: { username?: string }
  modelVersions?: RawSearchVersion[]
  stats?: { downloadCount?: number; thumbsUpCount?: number; thumbsDownCount?: number; favoriteCount?: number }
  description?: string | null
}

interface RawSearchVersion {
  id: number
  name: string
  baseModel?: string
  trainedWords?: string[]
  files?: RawSearchFile[]
  images?: { url: string; nsfw: boolean | string }[]
}

interface RawSearchFile {
  id: number
  name: string
  type?: string
  sizeKB?: number
  downloadUrl?: string
  primary?: boolean
  hashes?: { SHA256?: string }
}

function normalizeSearchItem(raw: RawSearchItem): CivitaiSearchItem {
  return {
    id: raw.id,
    name: raw.name,
    type: normalizeAssetType(raw.type),
    nsfw: !!raw.nsfw,
    tags: raw.tags ?? [],
    creator: raw.creator?.username ?? '',
    downloadCount: raw.stats?.downloadCount ?? 0,
    thumbsUpCount: raw.stats?.thumbsUpCount ?? 0,
    thumbsDownCount: raw.stats?.thumbsDownCount ?? 0,
    pageUrl: `https://civitai.com/models/${raw.id}`,
    description: stripHtmlExcerpt(raw.description ?? null, 800),
    versions: (raw.modelVersions ?? []).map((v) => ({
      id: v.id,
      name: v.name,
      baseModel: v.baseModel ?? '',
      trainedWords: v.trainedWords ?? [],
      thumbnailUrl: pickThumbnail(
        (v.images ?? []).map((i) => ({ url: i.url, nsfw: i.nsfw, meta: null }))
      ),
      files: (v.files ?? []).map((f) => ({
        id: f.id,
        name: f.name,
        type: f.type ?? 'Model',
        sizeKB: f.sizeKB ?? null,
        downloadUrl: f.downloadUrl ?? null,
        primary: !!f.primary,
        hashes: { sha256: f.hashes?.SHA256 ?? null }
      }))
    }))
  }
}

function normalizeCivitaiFiles(files: CivitaiFile[]): CivitaiSearchFile[] {
  return files.map((f) => ({
    id: f.id,
    name: f.name,
    type: f.type ?? 'Model',
    sizeKB: f.sizeKB ?? null,
    downloadUrl: f.downloadUrl ?? null,
    primary: !!f.primary,
    hashes: { sha256: f.hashes?.SHA256 ?? null }
  }))
}

function pickPrimaryModelFile(files: CivitaiFile[]): CivitaiFile | undefined {
  return files.find((f) => f.primary && /^model$/i.test(f.type ?? 'Model')) ??
    files.find((f) => /^model$/i.test(f.type ?? 'Model')) ??
    files.find((f) => f.primary) ??
    files[0]
}

/**
 * Convert Civitai's HTML-rich description into plain readable text.
 * Civitai descriptions are typically a few paragraphs of usage tips, in HTML
 * with <br>, <p>, <strong>, <a>, etc. We strip tags, decode common entities,
 * and truncate to keep the search-modal cards compact.
 */
function stripHtmlExcerpt(html: string | null, maxChars: number): string | null {
  if (!html) return null
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
  if (text.length === 0) return null
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars).trimEnd() + '…'
}

function normalizeAssetType(s: string | undefined): CivitaiAssetType {
  if (!s) return 'Other'
  switch (s) {
    case 'Checkpoint':
    case 'LORA':
    case 'LoCon':
    case 'TextualInversion':
    case 'Hypernetwork':
    case 'VAE':
    case 'Controlnet':
      return s
    default:
      return 'Other'
  }
}

/** Map Civitai asset type → forge models/* directory. */
export function destDirForAssetType(
  forgePath: string,
  assetType: CivitaiAssetType
): string | null {
  switch (assetType) {
    case 'Checkpoint':
      return join(forgePath, 'webui', 'models', 'Stable-diffusion')
    case 'LORA':
    case 'LoCon':
      return join(forgePath, 'webui', 'models', 'Lora')
    case 'VAE':
      return join(forgePath, 'webui', 'models', 'VAE')
    case 'TextualInversion':
      return join(forgePath, 'webui', 'embeddings')
    case 'Controlnet':
      return join(forgePath, 'webui', 'models', 'ControlNet')
    case 'Tagger':
      return join(forgePath, 'webui', 'models', 'Tagger')
    case 'Hypernetwork':
      return join(forgePath, 'webui', 'models', 'hypernetworks')
    case 'Other':
      return null
  }
}

/**
 * Stream-download a Civitai file to disk with progress reporting.
 *
 * - Writes to `<dest>.partial` and renames on success — half-written files
 *   never sit in the user's models folder where Forge might try to load them.
 * - Calls `onProgress` after every chunk so the UI can show a smooth bar.
 * - Optional SHA-256 verification post-download (Civitai supplies the hash
 *   in search results, so we use it when available).
 *
 * Cancellation: pass an AbortSignal. The partial file is kept so a later
 * request can resume with an HTTP Range request when the remote supports it.
 */
export async function downloadCivitaiFile(
  req: CivitaiDownloadRequest,
  destDir: string,
  apiKey: string | null,
  onProgress: (bytesDownloaded: number, totalBytes: number) => void,
  signal: AbortSignal
): Promise<{ destPath: string; sha256: string | null; resumedFrom: number }> {
  await mkdir(destDir, { recursive: true })
  const destPath = join(destDir, req.filename)
  const partial = `${destPath}.partial`
  let resumeFrom = 0
  if (existsSync(partial)) {
    try {
      resumeFrom = statSync(partial).size
    } catch {
      resumeFrom = 0
    }
  }

  const headers: Record<string, string> = {
    'User-Agent': 'Yoitomoshi-Art-Generator/0.1'
  }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  if (resumeFrom > 0) headers.Range = `bytes=${resumeFrom}-`

  const res = await fetch(req.url, { headers, signal, redirect: 'follow' })
  if (!res.ok) {
    throw classifyCivitaiError('Civitai download', res.status, await res.text().catch(() => ''))
  }
  if (!res.body) throw new Error('レスポンスボディがありません')

  if (resumeFrom > 0 && res.status !== 206) {
    // Some mirrors ignore Range and return a full 200 response. Restart cleanly
    // so the final file and hash are not corrupted by duplicate bytes.
    await unlink(partial).catch(() => undefined)
    resumeFrom = 0
  }

  const contentLength = parseInt(res.headers.get('content-length') ?? '0', 10)
  const contentRange = res.headers.get('content-range')
  const totalFromRange = contentRange?.match(/\/(\d+)$/)?.[1]
  const total = totalFromRange
    ? parseInt(totalFromRange, 10)
    : contentLength > 0
      ? contentLength + resumeFrom
      : 0
  let downloaded = resumeFrom
  const hash = createHash('sha256')
  if (resumeFrom > 0) {
    await new Promise<void>((resolve, reject) => {
      const existing = createReadStream(partial)
      existing.on('data', (chunk) => hash.update(chunk))
      existing.on('error', reject)
      existing.on('end', resolve)
    })
  }

  const out = createWriteStream(partial, { flags: resumeFrom > 0 ? 'a' : 'w' })
  try {
    onProgress(downloaded, total)
    const reader = res.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value)
      out.write(value)
      downloaded += value.length
      onProgress(downloaded, total)
      if (signal.aborted) {
        await new Promise<void>((r) => out.end(r))
        throw new Error('キャンセルされました')
      }
    }
    await new Promise<void>((resolve, reject) => {
      out.end((err: NodeJS.ErrnoException | null | undefined) =>
        err ? reject(err) : resolve()
      )
    })
  } catch (e) {
    await new Promise<void>((r) => out.end(r))
    throw e
  }

  const computed = hash.digest('hex')
  if (req.expectedSha256 && req.expectedSha256.toLowerCase() !== computed.toLowerCase()) {
    await unlink(partial).catch(() => undefined)
    throw new Error('SHA-256 が一致しません(ファイル破損の可能性)')
  }

  await rename(partial, destPath)
  return { destPath, sha256: computed, resumedFrom: resumeFrom }
}

// =========================================================================
//  Community-image mining for richer per-checkpoint recommendations
// =========================================================================

interface MinedImage {
  meta: Record<string, unknown> | null
  resources?: Array<{ type?: string; name?: string; weight?: number }>
}

/**
 * Aggregate Civitai's community-uploaded images for a checkpoint into rich
 * per-model statistics. Goes well beyond the 5-20 official samples by paging
 * through `/api/v1/images?modelVersionId=` (typically 100-600 results for
 * popular models).
 *
 * Returns null when the model version has no community images at all (rare
 * but possible for brand-new uploads). Otherwise builds:
 *   - sampler frequency table
 *   - steps / cfg / clip-skip distributions (median + IQR)
 *   - common image sizes
 *   - common LoRA / VAE pairings (uses structured `meta.resources` first,
 *     falls back to <lora:> regex on prompts)
 *   - common positive / negative prompt phrases (1-3 grams in ≥30% of samples)
 */
export async function mineCheckpointSamples(
  modelVersionId: number,
  apiKey: string | null,
  maxImages = 200,
  includeNsfw = false
): Promise<CivitaiCommunityStats | null> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'Yoitomoshi-Art-Generator/0.1'
  }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  const collected: MinedImage[] = []
  // Sort by Most Reactions to bias toward community-validated combinations.
  // Civitai paginates with cursor-style nextPage; cap at 3 pages to avoid
  // hammering the API on extremely popular models.
  let url: string | null =
    `${CIVITAI_BASE}/images?modelVersionId=${modelVersionId}` +
    `&sort=Most%20Reactions&limit=${Math.min(200, maxImages)}&nsfw=${includeNsfw ? 'true' : 'false'}`
  let pages = 0
  while (url && collected.length < maxImages && pages < 3) {
    type ImagesResp = {
      items: Array<{
        meta: Record<string, unknown> | null
        resources?: Array<{ type?: string; name?: string; weight?: number }>
      }>
      metadata?: { nextPage?: string }
    }
    let resp: ImagesResp
    try {
      const r = await fetch(url, { headers })
      if (!r.ok) break
      resp = (await r.json()) as ImagesResp
    } catch {
      break
    }
    for (const it of resp.items ?? []) {
      collected.push({ meta: it.meta, resources: it.resources })
    }
    url = resp.metadata?.nextPage ?? null
    pages++
  }

  if (collected.length === 0) return null

  const aggregated = aggregateMinedSamples(modelVersionId, collected)

  // Resolve top LoRA / VAE names against Civitai in parallel so the UI can
  // offer one-click downloads for community-popular items the user doesn't
  // have locally. Each lookup runs against /api/v1/models?query=<name>.
  // Failures are non-fatal — they just leave `civitai: null`.
  const [loraRefs, vaeRefs] = await Promise.all([
    Promise.all(
      aggregated.topLoras.map((l) =>
        identifyByName(l.name, 'LORA', apiKey).catch(() => null)
      )
    ),
    Promise.all(
      aggregated.topVaes.map((v) =>
        identifyByName(v.name, 'VAE', apiKey).catch(() => null)
      )
    )
  ])

  return {
    ...aggregated,
    topLoras: aggregated.topLoras.map((l, i) => ({ ...l, civitai: loraRefs[i] })),
    topVaes: aggregated.topVaes.map((v, i) => ({ ...v, civitai: vaeRefs[i] }))
  }
}

function aggregateMinedSamples(
  modelVersionId: number,
  images: MinedImage[]
): CivitaiCommunityStats {
  const samplers: string[] = []
  const stepsArr: number[] = []
  const cfgArr: number[] = []
  const clipArr: number[] = []
  const sizes = new Map<string, number>()
  const vaes: string[] = []
  const loraOccurrences = new Map<string, number[]>() // name → list of weights
  const positivePrompts: string[] = []
  const negativePrompts: string[] = []

  for (const img of images) {
    const meta = img.meta ?? {}

    if (typeof meta.sampler === 'string') samplers.push(meta.sampler)
    if (typeof meta.steps === 'number') stepsArr.push(meta.steps)
    if (typeof meta.cfgScale === 'number') cfgArr.push(meta.cfgScale)
    const clip = meta['Clip skip']
    if (typeof clip === 'number') clipArr.push(clip)
    else if (typeof clip === 'string') {
      const n = parseInt(clip, 10)
      if (Number.isFinite(n)) clipArr.push(n)
    }

    const size = typeof meta.Size === 'string' ? meta.Size : null
    if (size) {
      sizes.set(size, (sizes.get(size) ?? 0) + 1)
    }

    if (typeof meta.VAE === 'string') vaes.push(meta.VAE)
    if (typeof meta.prompt === 'string') positivePrompts.push(meta.prompt)
    if (typeof meta.negativePrompt === 'string') negativePrompts.push(meta.negativePrompt)

    // Prefer the structured `resources` array when present — these are
    // type-tagged and won't be confused by similarly-formatted strings.
    const fromResources = (img.resources ?? []).filter((r) => /lora/i.test(r.type ?? ''))
    if (fromResources.length > 0) {
      for (const r of fromResources) {
        if (!r.name) continue
        const arr = loraOccurrences.get(r.name) ?? []
        arr.push(r.weight ?? 1)
        loraOccurrences.set(r.name, arr)
      }
    } else if (typeof meta.prompt === 'string') {
      // Fallback: pull <lora:name:weight> from the prompt string.
      const re = /<(?:lora|lyco):([^:>]+):([^>]+)>/gi
      let m: RegExpExecArray | null
      while ((m = re.exec(meta.prompt)) !== null) {
        const name = m[1].trim()
        const w = parseAdapterWeight(m[2])
        const arr = loraOccurrences.get(name) ?? []
        arr.push(w)
        loraOccurrences.set(name, arr)
      }
    }
  }

  return {
    modelVersionId,
    sampleCount: images.length,
    fetchedAt: Date.now(),
    topSamplers: counts(samplers).slice(0, 6),
    stepsDist: distribution(stepsArr),
    cfgDist: distribution(cfgArr),
    clipSkipDist: distribution(clipArr),
    topSizes: Array.from(sizes.entries())
      .map(([s, freq]) => {
        const m = s.match(/(\d+)\s*x\s*(\d+)/i)
        return m ? { width: parseInt(m[1], 10), height: parseInt(m[2], 10), freq } : null
      })
      .filter((x): x is { width: number; height: number; freq: number } => x !== null)
      .sort((a, b) => b.freq - a.freq)
      .slice(0, 6),
    topLoras: Array.from(loraOccurrences.entries())
      .map(([name, weights]) => ({
        name,
        freq: weights.length,
        medianWeight: median(weights) ?? 1
      }))
      .sort((a, b) => b.freq - a.freq)
      .slice(0, 12),
    topVaes: counts(vaes).slice(0, 4),
    commonPositivePhrases: extractCommonPhrases(positivePrompts, 0.3, 12),
    commonNegativePhrases: extractCommonPhrases(negativePrompts, 0.3, 8)
  }
}

function parseAdapterWeight(raw: string): number {
  const direct = parseFloat(raw)
  if (Number.isFinite(direct)) return direct
  const unet = raw.match(/(?:^|:)unet=(-?\d+(?:\.\d+)?)/i)
  if (unet) return Number(unet[1])
  const te = raw.match(/(?:^|:)te=(-?\d+(?:\.\d+)?)/i)
  if (te) return Number(te[1])
  return 1
}

function counts<T>(arr: T[]): { name: T; freq: number }[] {
  const m = new Map<T, number>()
  for (const v of arr) m.set(v, (m.get(v) ?? 0) + 1)
  return Array.from(m.entries())
    .map(([name, freq]) => ({ name, freq }))
    .sort((a, b) => b.freq - a.freq)
}

function distribution(nums: number[]): Distribution {
  if (nums.length === 0) {
    return { n: 0, median: null, q1: null, q3: null, min: null, max: null }
  }
  const sorted = [...nums].sort((a, b) => a - b)
  return {
    n: sorted.length,
    median: percentile(sorted, 0.5),
    q1: percentile(sorted, 0.25),
    q3: percentile(sorted, 0.75),
    min: sorted[0],
    max: sorted[sorted.length - 1]
  }
}

function percentile(sorted: number[], p: number): number {
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  const frac = idx - lo
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac
}

/**
 * Find tag-like phrases that appear in at least `minRatio` of the prompts.
 *
 * SD prompts are comma-delimited tag lists, so we tokenize on commas and
 * count token frequency. Multi-word phrases like "best quality" or "1girl"
 * are already a single token (no internal commas), so 1-grams cover most of
 * what users actually type.
 *
 * Phrases shorter than 3 chars or matching only digits/punctuation are dropped.
 */
function extractCommonPhrases(
  prompts: string[],
  minRatio: number,
  maxResults: number
): { phrase: string; freq: number }[] {
  if (prompts.length === 0) return []
  const seen = new Map<string, number>()
  for (const p of prompts) {
    const tokens = p
      .replace(/<[^>]+>/g, '') // strip <lora:> etc.
      .split(/[,\n]+/)
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length >= 3 && /[a-z぀-ヿ一-鿿]/.test(t))
    // Each token only contributes once per prompt — we want "fraction of
    // prompts that include this phrase", not raw occurrence count.
    for (const t of new Set(tokens)) {
      seen.set(t, (seen.get(t) ?? 0) + 1)
    }
  }
  const threshold = Math.max(2, Math.floor(prompts.length * minRatio))
  return Array.from(seen.entries())
    .filter(([, freq]) => freq >= threshold)
    .map(([phrase, freq]) => ({ phrase, freq }))
    .sort((a, b) => b.freq - a.freq)
    .slice(0, maxResults)
}

// =========================================================================
//  PNG-derived identification — find Civitai pages for a generated image
// =========================================================================

/**
 * Resolve a checkpoint reference (hash or name) into a Civitai page pointer.
 *
 * Lookup strategy:
 *   1. If we have a hash (A1111 stores AutoV2 short hash; Civitai accepts both
 *      AutoV2 and full SHA-256), use `/model-versions/by-hash/{hash}` for an
 *      exact match.
 *   2. Otherwise fall back to a name search via `/models?query=<name>&types=Checkpoint&limit=1`.
 *
 * Returns null when nothing matches — common for private models, models removed
 * from Civitai, or models that exist only on HuggingFace etc.
 */
export async function identifyCheckpoint(
  hash: string | null,
  name: string | null,
  apiKey: string | null
): Promise<CivitaiQuickRef | null> {
  if (hash) {
    const ref = await refFromHash(hash, apiKey)
    if (ref) return ref
  }
  if (name) return refFromNameSearch(name, 'Checkpoint', apiKey)
  return null
}

/** Search Civitai by name to identify a referenced LoRA or VAE. */
export async function identifyByName(
  name: string,
  type: 'LORA' | 'VAE',
  apiKey: string | null
): Promise<CivitaiQuickRef | null> {
  return refFromNameSearch(name, type, apiKey)
}

async function refFromHash(
  hash: string,
  apiKey: string | null
): Promise<CivitaiQuickRef | null> {
  try {
    const v = await civitaiJson<{
      id: number
      modelId: number
      name: string
      baseModel?: string
      images?: Array<{ url: string; nsfw: boolean | string }>
      files?: Array<{ name: string; downloadUrl?: string; primary?: boolean; type?: string; hashes?: { SHA256?: string } }>
      model: { name: string; type: string }
    }>(`/model-versions/by-hash/${hash}`, apiKey, 'Civitai image hash lookup')
    if (!v) return null
    const primaryFile = v.files?.find((f) => f.primary) ?? v.files?.[0]
    return {
      modelId: v.modelId,
      modelVersionId: v.id,
      name: v.model.name,
      type: normalizeAssetType(v.model.type),
      baseModel: v.baseModel ?? '',
      thumbnailUrl: pickThumbnail(
        (v.images ?? []).map((i) => ({ url: i.url, nsfw: i.nsfw, meta: null }))
      ),
      pageUrl: `https://civitai.com/models/${v.modelId}?modelVersionId=${v.id}`,
      downloadUrl: primaryFile?.downloadUrl ?? null,
      primaryFileSha256: primaryFile?.hashes?.SHA256 ?? null,
      filenames: (v.files ?? []).map((f) => f.name).filter(Boolean) as string[]
    }
  } catch {
    return null
  }
}

async function refFromNameSearch(
  name: string,
  assetType: 'Checkpoint' | 'LORA' | 'VAE',
  apiKey: string | null
): Promise<CivitaiQuickRef | null> {
  // Civitai full-text search is fuzzy; cap to 5 results and pick the closest
  // case-insensitive name match. Avoids "abc_v2" matching the unrelated "abc_v3"
  // that happens to be the most-downloaded.
  let result: CivitaiSearchResult
  try {
    result = await searchCivitai(
      { query: name, types: [assetType], limit: 5, sort: 'Most Downloaded' },
      apiKey
    )
  } catch {
    return null
  }
  if (result.items.length === 0) return null

  const targetLc = name.toLowerCase()
  const exact = result.items.find((it) =>
    it.versions[0]?.files.some((f) => f.name.toLowerCase().replace(/\.[^.]+$/, '') === targetLc) ||
    it.name.toLowerCase() === targetLc
  )
  const item = exact ?? result.items[0]
  const version = item.versions[0]
  const primaryFile = version?.files.find((f) => f.primary) ?? version?.files[0]

  return {
    modelId: item.id,
    modelVersionId: version?.id ?? null,
    name: item.name,
    type: item.type,
    baseModel: version?.baseModel ?? '',
    thumbnailUrl: version?.thumbnailUrl ?? null,
    pageUrl: item.pageUrl,
    downloadUrl: primaryFile?.downloadUrl ?? null,
    primaryFileSha256: primaryFile?.hashes.sha256 ?? null,
    filenames: (version?.files ?? []).map((f) => f.name)
  }
}

// =========================================================================
//  Tag listing — for the search modal's tag-chip browse row
// =========================================================================

/**
 * Top tags used across Civitai's catalog. Used to populate the "popular tags"
 * chip row in the search modal so users can browse by category without typing.
 */
export async function listCivitaiTags(
  apiKey: string | null,
  limit = 50
): Promise<CivitaiTag[]> {
  type Resp = { items: Array<{ name: string; modelCount?: number }> }
  const data = await civitaiJson<Resp>(`/tags?limit=${limit}`, apiKey, 'Civitai tags')
  if (!data) return []
  return (data.items ?? [])
    .filter((t) => typeof t.name === 'string' && t.name.length > 0)
    .map((t) => ({ name: t.name, modelCount: t.modelCount ?? 0 }))
    .sort((a, b) => b.modelCount - a.modelCount)
}

// =========================================================================
//  Model update detection
// =========================================================================

/**
 * For a given Civitai model ID, return the latest version's id + name +
 * download URL. Used to detect when a locally-installed model has a newer
 * version available.
 *
 * Civitai's `/api/v1/models/:id` returns `modelVersions[]` ordered by
 * createdAt descending, so `[0]` is the latest.
 */
async function fetchLatestModelVersion(
  modelId: number,
  apiKey: string | null
): Promise<{
  versionId: number
  versionName: string
  modelName: string
  downloadUrl: string | null
} | null> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'Yoitomoshi-Art-Generator/0.1'
  }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  try {
    const r = await fetch(`${CIVITAI_BASE}/models/${modelId}`, { headers })
    if (!r.ok) return null
    const data = (await r.json()) as {
      name: string
      modelVersions?: Array<{
        id: number
        name: string
        files?: Array<{ name: string; downloadUrl?: string; primary?: boolean; type?: string }>
      }>
    }
    const latest = data.modelVersions?.[0]
    if (!latest) return null
    const primaryFile =
      latest.files?.find((f) => f.primary && /^model$/i.test(f.type ?? 'Model')) ??
      latest.files?.find((f) => /^model$/i.test(f.type ?? 'Model')) ??
      latest.files?.[0]
    return {
      versionId: latest.id,
      versionName: latest.name,
      modelName: data.name,
      downloadUrl: primaryFile?.downloadUrl ?? null
    }
  } catch {
    return null
  }
}

/**
 * Compare local cached recommendations against Civitai's latest version data.
 * Returns one entry per checkpoint that has a newer version available.
 *
 * Caller passes the list of locally-known checkpoints with their cached
 * `modelId` + `modelVersionId`. We hit /models/:id for each in parallel
 * (capped to 6 concurrent requests to be polite to the API).
 */
export async function checkForModelUpdates(
  installed: { sha256: string; modelId: number; modelVersionId: number; modelName: string; versionName: string }[],
  apiKey: string | null
): Promise<ModelUpdateInfo[]> {
  const updates: ModelUpdateInfo[] = []
  const queue = [...installed]
  const CONCURRENCY = 6

  async function next(): Promise<void> {
    const item = queue.shift()
    if (!item) return
    const latest = await fetchLatestModelVersion(item.modelId, apiKey)
    if (latest && latest.versionId !== item.modelVersionId) {
      updates.push({
        sha256: item.sha256,
        modelId: item.modelId,
        modelName: latest.modelName,
        oldVersionId: item.modelVersionId,
        oldVersionName: item.versionName,
        newVersionId: latest.versionId,
        newVersionName: latest.versionName,
        newVersionUrl: `https://civitai.com/models/${item.modelId}?modelVersionId=${latest.versionId}`,
        newVersionDownloadUrl: latest.downloadUrl
      })
    }
    await next()
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => next()))
  return updates
}

// Suppress "imported but unused" when consumers haven't pulled it yet.
export type { CivitaiAssetType, CivitaiDownloadProgress } from '../src/shared/types.js'
