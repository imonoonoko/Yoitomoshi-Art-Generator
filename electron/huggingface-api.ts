import { basename, extname } from 'node:path'
import type {
  CivitaiAssetType,
  HuggingFaceSearchFile,
  HuggingFaceSearchOptions,
  HuggingFaceSearchResult
} from '../src/shared/types.js'

const HF_BASE = 'https://huggingface.co'
const HF_MODEL_EXTS = new Set(['.safetensors', '.ckpt', '.pt', '.pth', '.vae'])

interface RawModel {
  id?: string
  modelId?: string
  author?: string
  downloads?: number
  likes?: number
  tags?: string[]
  siblings?: Array<{
    rfilename?: string
    size?: number
  }>
}

export async function searchHuggingFaceModels(
  opts: HuggingFaceSearchOptions
): Promise<HuggingFaceSearchResult> {
  const query = opts.query?.trim() || 'stable diffusion'
  const limit = Math.min(50, Math.max(1, Math.floor(opts.limit ?? 20)))
  const params = new URLSearchParams({
    search: query,
    limit: String(limit),
    full: 'true'
  })

  const res = await fetch(`${HF_BASE}/api/models?${params.toString()}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Yoitomoshi-Art-Generator/0.1'
    }
  })
  if (!res.ok) {
    throw new Error(`Hugging Face search ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }

  const raw = await res.json() as RawModel[]
  const allowedTypes = new Set(opts.assetTypes ?? [])
  return {
    items: raw
      .map((model) => normalizeModel(model, allowedTypes))
      .filter((item) => item.files.length > 0)
  }
}

function normalizeModel(model: RawModel, allowedTypes: Set<CivitaiAssetType>) {
  const repoId = model.id ?? model.modelId ?? ''
  const tags = Array.isArray(model.tags) ? model.tags.filter((tag): tag is string => typeof tag === 'string') : []
  const files: HuggingFaceSearchFile[] = (model.siblings ?? [])
    .map((sibling) => normalizeFile(repoId, sibling.rfilename, sibling.size, tags))
    .filter((file): file is HuggingFaceSearchFile => file !== null)
    .filter((file) => allowedTypes.size === 0 || allowedTypes.has(file.assetType))

  return {
    repoId,
    name: repoId.split('/').pop() ?? repoId,
    author: model.author ?? repoId.split('/')[0] ?? '',
    downloads: Number.isFinite(model.downloads) ? model.downloads ?? 0 : 0,
    likes: Number.isFinite(model.likes) ? model.likes ?? 0 : 0,
    tags,
    pageUrl: `${HF_BASE}/${repoId}`,
    files
  }
}

function normalizeFile(
  repoId: string,
  rawPath: string | undefined,
  sizeBytes: number | undefined,
  tags: string[]
): HuggingFaceSearchFile | null {
  if (!repoId || !rawPath) return null
  const ext = extname(rawPath).toLowerCase()
  if (!HF_MODEL_EXTS.has(ext)) return null
  const assetType = inferAssetType(rawPath, tags)
  return {
    path: rawPath,
    name: basename(rawPath),
    sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes ?? null : null,
    downloadUrl: `${HF_BASE}/${repoId}/resolve/main/${encodePath(rawPath)}`,
    assetType
  }
}

function inferAssetType(path: string, tags: string[]): CivitaiAssetType {
  const haystack = `${path} ${tags.join(' ')}`.toLowerCase()
  if (/\b(controlnet|control-net|control_net)\b/.test(haystack)) return 'Controlnet'
  if (/\b(lora|locon|lycoris)\b/.test(haystack)) return 'LORA'
  if (/\bvae\b/.test(haystack) || /\.vae$/i.test(path)) return 'VAE'
  if (/\bembedding|textual-inversion\b/.test(haystack)) return 'TextualInversion'
  return 'Checkpoint'
}

function encodePath(path: string): string {
  return path.split('/').map((part) => encodeURIComponent(part)).join('/')
}
