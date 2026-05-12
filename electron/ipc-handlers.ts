import { ipcMain, BrowserWindow, shell, dialog } from 'electron'
import { copyFile, mkdir, readdir, rename, stat, statfs, unlink } from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { IPC } from '../src/shared/ipc-channels.js'
import type { ForgeManager } from './forge-manager.js'
import type { ForgeApi } from './forge-api.js'
import type { Storage } from './storage.js'
import {
  checkForModelUpdates,
  destDirForAssetType,
  downloadCivitaiFile,
  fetchByHash,
  fetchLoraByHash,
  hashModelFile,
  identifyByName,
  identifyCheckpoint,
  listCivitaiTags,
  mineCheckpointSamples,
  searchCivitai
} from './civitai-api.js'
import { scanLoras } from './lora-scanner.js'
import { searchHuggingFaceModels } from './huggingface-api.js'
import { describeKind, inspectSafetensors, type ModelKind } from './safetensors-inspect.js'
import type { PromptLibrary } from './prompt-library.js'
import type {
  AppSettings,
  CivitaiAssetType,
  CivitaiDownloadRequest,
  CivitaiSearchOptions,
  ControlNetDetectRequest,
  DownloadJob,
  HuggingFaceSearchOptions,
  HistoryItem,
  Img2ImgRequest,
  Img2ImgResponse,
  LibraryIntegrityReport,
  ModelFormatConversionResult,
  ModelHashResult,
  LoraUsageRecord,
  ModelMergerEstimate,
  ModelMergerProgress,
  ModelMergerRequest,
  ModelMergerResult,
  ModelMergerSupportReport,
  ModelLibraryEntry,
  ModelLibraryEntryType,
  ModelLibraryRecoveryResult,
  ModelLibrarySummary,
  ModelImportResult,
  SdLora,
  SdModel,
  StartupMetrics,
  Txt2ImgRequest,
  Txt2ImgResponse,
  WorkspaceSnapshot,
  WorkspaceImageReference,
  UpscaleComparisonSaveRequest,
  FabricFeedbackImageSaveResult
} from '../src/shared/types.js'

type HealthSeverity = 'warn' | 'error'

interface ModelHealthIssue {
  severity: HealthSeverity
  folder: string
  file: string | null
  message: string
}

interface ModelHealthFolder {
  id: string
  label: string
  path: string
  exists: boolean
  files: number
  totalBytes: number
}

const MODEL_FILE_EXTS = new Set(['.safetensors', '.ckpt', '.pt', '.pth', '.vae'])
const INSPECTABLE_MODEL_FILE_EXTS = new Set(['.safetensors', '.ckpt', '.pt', '.pth', '.vae'])
const CONVERTIBLE_MODEL_FILE_EXTS = new Set(['.ckpt', '.pt', '.pth'])
const IMAGE_FILE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const SETTINGS_LANGUAGES = new Set(['ja', 'en', 'ru', 'pt'])
const CIVITAI_ASSET_TYPES = new Set<CivitaiAssetType>([
  'Checkpoint',
  'LORA',
  'LoCon',
  'TextualInversion',
  'Hypernetwork',
  'VAE',
  'Controlnet',
  'Other'
])
const EXTERNAL_LINK_DOMAINS = [
  'civitai.com',
  'civitai.green',
  'huggingface.co',
  'github.com',
  'aipictors.com',
  'lexica.art'
]
const CIVITAI_DOWNLOAD_DOMAINS = ['civitai.com']
const HUGGING_FACE_DOWNLOAD_DOMAINS = ['huggingface.co']
const PREVIEW_IMAGE_DOMAINS = ['civitai.com', 'huggingface.co']
const MAX_PROMPT_CHARS = 20_000
const MAX_SCRIPT_ARGS_BYTES = 20 * 1024 * 1024
const MAX_ALWAYS_ON_BYTES = 120 * 1024 * 1024
const MAX_IMAGE_BASE64_CHARS = 120 * 1024 * 1024
const MAX_WORKSPACE_IMAGE_BYTES = 80 * 1024 * 1024
const MODEL_MERGER_LOG_TAIL_LIMIT = 120
const MODEL_MERGER_DISK_MARGIN_BYTES = 512 * 1024 * 1024

interface ActiveModelMerger {
  child: ChildProcessWithoutNullStreams
  startedAt: number
  logTail: string[]
  outputPath: string | null
  cancelRequested: boolean
}

let activeModelMerger: ActiveModelMerger | null = null
let modelLibraryHashQueueRunning = false

const MODEL_HEALTH_FOLDERS: Array<{
  id: string
  label: string
  expected: ModelKind
  parts: string[]
}> = [
  { id: 'checkpoints', label: 'Checkpoints', expected: 'checkpoint', parts: ['webui', 'models', 'Stable-diffusion'] },
  { id: 'loras', label: 'LoRA', expected: 'lora', parts: ['webui', 'models', 'Lora'] },
  { id: 'vae', label: 'VAE', expected: 'vae', parts: ['webui', 'models', 'VAE'] },
  { id: 'controlnet', label: 'ControlNet', expected: 'controlnet', parts: ['webui', 'models', 'ControlNet'] }
]

const MODEL_LIBRARY_FOLDERS: Array<{
  type: ModelLibraryEntryType
  parts: string[]
}> = [
  { type: 'Checkpoint', parts: ['webui', 'models', 'Stable-diffusion'] },
  { type: 'LORA', parts: ['webui', 'models', 'Lora'] },
  { type: 'VAE', parts: ['webui', 'models', 'VAE'] },
  { type: 'Controlnet', parts: ['webui', 'models', 'ControlNet'] },
  { type: 'Embedding', parts: ['webui', 'embeddings'] },
  { type: 'Hypernetwork', parts: ['webui', 'models', 'hypernetworks'] },
  { type: 'Upscaler', parts: ['webui', 'models', 'ESRGAN'] },
  { type: 'Upscaler', parts: ['webui', 'models', 'RealESRGAN'] },
  { type: 'Upscaler', parts: ['webui', 'models', 'SwinIR'] },
  { type: 'Upscaler', parts: ['webui', 'models', 'ScuNET'] },
  { type: 'Upscaler', parts: ['webui', 'models', 'LDSR'] }
]

const PY_CONVERT_TO_SAFETENSORS = `
import os
import sys

src, dest = sys.argv[1], sys.argv[2]
if os.path.exists(dest):
    raise SystemExit(f"destination exists: {dest}")

try:
    import torch
    from safetensors.torch import save_file
except Exception as exc:
    raise SystemExit(f"missing Python dependency: {exc}")

obj = torch.load(src, map_location="cpu")
if isinstance(obj, dict) and "state_dict" in obj and isinstance(obj["state_dict"], dict):
    obj = obj["state_dict"]
if not isinstance(obj, dict):
    raise SystemExit("checkpoint did not contain a tensor dictionary")

tensors = {str(k): v.detach().cpu().contiguous() for k, v in obj.items() if hasattr(v, "detach")}
if not tensors:
    raise SystemExit("no tensors found")

save_file(tensors, dest)
print(f"saved {len(tensors)} tensors -> {dest}")
`.trim()

const PY_RUN_MODEL_MERGER = `
import base64
import json
import os
import re
import sys

payload = json.loads(base64.b64decode(sys.argv[1]).decode("utf-8"))
sys.argv = [sys.argv[0]]
os.environ["IGNORE_CMD_ARGS_ERRORS"] = "1"
os.environ.setdefault("GRADIO_ANALYTICS_ENABLED", "False")
os.environ.setdefault("USE_TF", "0")
os.environ.setdefault("TRANSFORMERS_NO_TF", "1")

from modules import initialize
initialize.imports()

from modules import extras, sd_models, sd_vae
sd_models.setup_model()
sd_models.list_models()
sd_vae.refresh_vae_list()

result = extras.run_modelmerger(
    "yoitomoshi-model-merge",
    payload["primaryModelName"],
    payload.get("secondaryModelName") or "",
    payload.get("tertiaryModelName") or "",
    payload["interpMethod"],
    payload["multiplier"],
    payload["saveAsHalf"],
    payload["customName"],
    payload["checkpointFormat"],
    payload["configSource"],
    payload.get("bakeInVae") or "None",
    payload.get("discardWeights") or "",
    payload["saveMetadata"],
    payload["addMergeRecipe"],
    payload["copyMetadataFields"],
    payload.get("metadataJson") or "{}",
)

message = result[-1] if isinstance(result, (list, tuple)) and result else str(result)
match = re.search(r"Checkpoint saved to (.+)$", message)
print(json.dumps({
    "message": message,
    "outputPath": match.group(1) if match else None,
}, ensure_ascii=False))
`.trim()

/**
 * Validate that a file is the expected kind before importing into the
 * corresponding Forge model directory. Returns null when the import should
 * proceed, or a Japanese error message describing the mismatch.
 *
 * Only `.safetensors` files are inspected — `.pt` / `.ckpt` raw PyTorch
 * pickles can't be cheaply parsed, so we let them through (with the user
 * implicitly responsible for choosing the right folder).
 */
async function validateImportKind(
  source: string,
  expected: ModelKind
): Promise<string | null> {
  if (!/\.safetensors$/i.test(source)) return null
  const info = await inspectSafetensors(source).catch(() => null)
  if (!info) return null
  if (info.kind === 'unknown') return null
  if (info.kind === expected) return null
  return `これは ${describeKind(info.kind)} と判定されました。${describeKind(expected)} 用ではないため取込を中止しました。`
}

async function walkModelFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__pycache__' || entry.name.startsWith('.')) continue
      out.push(...await walkModelFiles(full))
    } else if (entry.isFile() && MODEL_FILE_EXTS.has(extname(entry.name).toLowerCase())) {
      out.push(full)
    }
  }
  return out
}

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`)
  }
}

function assertNoControlChars(value: string, label: string): void {
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`Invalid ${label}`)
  }
}

function assertNoUnsafeControlChars(value: string, label: string): void {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new Error(`Invalid ${label}`)
  }
}

function optionalString(
  raw: unknown,
  label: string,
  maxLength: number,
  options: { allowWhitespace?: boolean; trim?: boolean } = {}
): string | undefined {
  if (raw == null || raw === '') return undefined
  if (typeof raw !== 'string' || raw.length > maxLength) {
    throw new Error(`Invalid ${label}`)
  }
  if (options.allowWhitespace) assertNoUnsafeControlChars(raw, label)
  else assertNoControlChars(raw, label)
  const value = options.trim === false ? raw : raw.trim()
  return value
}

function boundedNumber(raw: unknown, label: string, min: number, max: number): number | undefined {
  if (raw == null || raw === '') return undefined
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}`)
  }
  return value
}

function boundedInteger(raw: unknown, label: string, min: number, max: number): number | undefined {
  const value = boundedNumber(raw, label, min, max)
  if (value == null) return undefined
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer`)
  }
  return value
}

function assertJsonPayloadSize(value: unknown, label: string, maxBytes: number): void {
  try {
    const json = JSON.stringify(value)
    if (json == null || Buffer.byteLength(json, 'utf8') > maxBytes) {
      throw new Error()
    }
  } catch {
    throw new Error(`${label} is too large or not serializable`)
  }
}

function validateImagePayload(raw: unknown, label: string): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_IMAGE_BASE64_CHARS) {
    throw new Error(`Invalid ${label}`)
  }
  assertNoUnsafeControlChars(raw, label)
  const payload = raw.startsWith('data:image/') ? raw.replace(/^data:image\/[^;]+;base64,/, '') : raw
  if (payload.length === 0 || !/^[A-Za-z0-9+/=\r\n]+$/.test(payload)) {
    throw new Error(`Invalid ${label}`)
  }
  return raw
}

function validateControlNetDetectRequest(input: unknown): ControlNetDetectRequest {
  assertPlainObject(input, 'ControlNet detect request')
  const image = validateImagePayload(input.image, 'ControlNet input image')
  const module = optionalString(input.module, 'ControlNet module', 120, { trim: false }) ?? 'None'
  const processorRes = boundedInteger(input.processorRes, 'processorRes', -1, 4096) ?? -1
  const thresholdA = boundedNumber(input.thresholdA, 'thresholdA', -1, 4096) ?? -1
  const thresholdB = boundedNumber(input.thresholdB, 'thresholdB', -1, 4096) ?? -1
  const resizeMode = boundedInteger(input.resizeMode, 'resizeMode', 0, 2) ?? 1
  return { image, module, processorRes, thresholdA, thresholdB, resizeMode }
}

function assertAllowedUrl(rawUrl: unknown, label: string, allowedDomains: string[]): string {
  if (typeof rawUrl !== 'string' || rawUrl.length > 2048) {
    throw new Error(`Invalid ${label}`)
  }
  assertNoControlChars(rawUrl, label)
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(`Invalid ${label}`)
  }
  if (url.protocol !== 'https:') {
    throw new Error(`${label} must use https`)
  }
  if (url.username || url.password) {
    throw new Error(`${label} must not contain credentials`)
  }
  const host = url.hostname.toLowerCase()
  const allowed = allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`))
  if (!allowed) {
    throw new Error(`Blocked external domain: ${host}`)
  }
  return url.toString()
}

function assertAbsolutePath(rawPath: unknown, label: string): string {
  if (typeof rawPath !== 'string' || rawPath.length === 0 || rawPath.length > 2000) {
    throw new Error(`Invalid ${label}`)
  }
  assertNoControlChars(rawPath, label)
  if (!isAbsolute(rawPath)) {
    throw new Error(`${label} must be absolute`)
  }
  return resolve(rawPath)
}

function isSubpath(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

async function assertExistingDirectory(rawPath: unknown, label: string): Promise<string> {
  const resolved = assertAbsolutePath(rawPath, label)
  const st = await stat(resolved).catch(() => null)
  if (!st?.isDirectory()) {
    throw new Error(`${label} is not a directory`)
  }
  return resolved
}

async function assertExistingFile(
  rawPath: unknown,
  label: string,
  allowedExts: Set<string>
): Promise<string> {
  const resolved = assertAbsolutePath(rawPath, label)
  const st = await stat(resolved).catch(() => null)
  if (!st?.isFile()) {
    throw new Error(`${label} is not a file`)
  }
  if (!allowedExts.has(extname(resolved).toLowerCase())) {
    throw new Error(`Unsupported file extension: ${extname(resolved)}`)
  }
  return resolved
}

async function assertForgeRoot(rawPath: unknown): Promise<string> {
  const forgePath = await assertExistingDirectory(rawPath, 'Forge path')
  const launchPy = join(forgePath, 'webui', 'launch.py')
  const pythonExe = join(forgePath, 'system', 'python', 'python.exe')
  const [launchStat, pythonStat] = await Promise.all([
    stat(launchPy).catch(() => null),
    stat(pythonExe).catch(() => null)
  ])
  if (!launchStat?.isFile() || !pythonStat?.isFile()) {
    throw new Error('Forge path must contain webui/launch.py and system/python/python.exe')
  }
  return forgePath
}

function validateImportMode(opts: unknown): 'copy' | 'move' {
  assertPlainObject(opts, 'import options')
  const mode = opts.mode
  if (mode !== 'copy' && mode !== 'move') {
    throw new Error('Invalid import mode')
  }
  return mode
}

async function validateSettingsInput(input: unknown, current: AppSettings): Promise<AppSettings> {
  assertPlainObject(input, 'settings')

  const forgePath = await assertForgeRoot(input.forgePath)
  const rawPort = input.forgePort
  const forgePort = typeof rawPort === 'number' ? rawPort : Number(rawPort)
  if (!Number.isInteger(forgePort) || forgePort < 1024 || forgePort > 65535) {
    throw new Error('Forge port must be an integer between 1024 and 65535')
  }

  const outputDirRaw = input.outputDir
  let outputDir = ''
  if (typeof outputDirRaw === 'string' && outputDirRaw.trim()) {
    outputDir = await assertExistingDirectory(outputDirRaw, 'Output directory')
  } else if (outputDirRaw != null && outputDirRaw !== '') {
    throw new Error('Invalid output directory')
  }

  const civitaiApiKeyRaw = input.civitaiApiKey
  let civitaiApiKey: string | null = null
  if (typeof civitaiApiKeyRaw === 'string' && civitaiApiKeyRaw.trim()) {
    const key = civitaiApiKeyRaw.trim()
    assertNoControlChars(key, 'Civitai API key')
    if (key.length > 256) throw new Error('Civitai API key is too long')
    civitaiApiKey = key
  } else if (civitaiApiKeyRaw != null && civitaiApiKeyRaw !== '') {
    throw new Error('Invalid Civitai API key')
  }

  const uiLanguage = input.uiLanguage
  if (typeof uiLanguage !== 'string' || !SETTINGS_LANGUAGES.has(uiLanguage)) {
    throw new Error('Invalid UI language')
  }

  const forgeExtraArgsRaw = input.forgeExtraArgs
  if (typeof forgeExtraArgsRaw !== 'string' || forgeExtraArgsRaw.length > 500) {
    throw new Error('Invalid Forge extra args')
  }
  assertNoControlChars(forgeExtraArgsRaw, 'Forge extra args')

  return {
    ...current,
    forgePath,
    forgePort,
    autoStartForge: input.autoStartForge === true,
    outputDir,
    civitaiApiKey,
    uiLanguage: uiLanguage as AppSettings['uiLanguage'],
    forgeExtraArgs: forgeExtraArgsRaw.trim()
  }
}

function validateSourceMetadata(input: unknown, provider: 'civitai' | 'huggingface'): CivitaiDownloadRequest['source'] {
  if (input == null) return undefined
  assertPlainObject(input, 'download source')
  if (input.provider !== provider) throw new Error('Invalid download source provider')
  const out: NonNullable<CivitaiDownloadRequest['source']> = { provider }
  for (const key of ['name', 'creator', 'versionName', 'baseModel', 'repoId', 'filePath'] as const) {
    const value = input[key]
    if (typeof value === 'string' && value.length <= 500) {
      assertNoUnsafeControlChars(value, `source ${key}`)
      out[key] = value
    }
  }
  const pageDomains = provider === 'huggingface' ? HUGGING_FACE_DOWNLOAD_DOMAINS : CIVITAI_DOWNLOAD_DOMAINS
  if (typeof input.pageUrl === 'string') out.pageUrl = assertAllowedUrl(input.pageUrl, 'source page URL', pageDomains)
  if (typeof input.downloadUrl === 'string') out.downloadUrl = assertAllowedUrl(input.downloadUrl, 'source download URL', pageDomains)
  if (typeof input.thumbnailUrl === 'string') out.thumbnailUrl = assertAllowedUrl(input.thumbnailUrl, 'source thumbnail URL', PREVIEW_IMAGE_DOMAINS)
  else if (input.thumbnailUrl === null) out.thumbnailUrl = null
  const expectedSha256 = input.expectedSha256
  if (typeof expectedSha256 === 'string' && /^[a-f0-9]{64}$/i.test(expectedSha256)) out.expectedSha256 = expectedSha256
  else if (expectedSha256 === null) out.expectedSha256 = null
  for (const key of ['modelId', 'modelVersionId'] as const) {
    const value = input[key]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) out[key] = value
    else if (key === 'modelVersionId' && value === null) out[key] = null
  }
  return out
}

function validateDownloadRequest(
  input: unknown,
  label: string,
  allowedDomains: string[],
  provider: 'civitai' | 'huggingface'
): CivitaiDownloadRequest {
  assertPlainObject(input, label)
  const url = assertAllowedUrl(input.url, `${label} URL`, allowedDomains)

  if (typeof input.filename !== 'string' || input.filename.length === 0 || input.filename.length > 240) {
    throw new Error('Invalid download filename')
  }
  assertNoControlChars(input.filename, 'download filename')
  if (basename(input.filename) !== input.filename || /[<>:"/\\|?*]/.test(input.filename)) {
    throw new Error('Invalid download filename')
  }

  const assetType = input.assetType
  if (typeof assetType !== 'string' || !CIVITAI_ASSET_TYPES.has(assetType as CivitaiAssetType)) {
    throw new Error('Invalid Civitai asset type')
  }

  const expectedSha256 = input.expectedSha256
  if (expectedSha256 != null && (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedSha256))) {
    throw new Error('Invalid SHA-256')
  }

  return {
    url,
    filename: input.filename,
    assetType: assetType as CivitaiAssetType,
    expectedSha256: expectedSha256 ?? null,
    source: validateSourceMetadata(input.source, provider)
  }
}

function validateCivitaiDownloadRequest(input: unknown): CivitaiDownloadRequest {
  return validateDownloadRequest(input, 'Civitai download request', CIVITAI_DOWNLOAD_DOMAINS, 'civitai')
}

function validateHuggingFaceDownloadRequest(input: unknown): CivitaiDownloadRequest {
  return validateDownloadRequest(input, 'Hugging Face download request', HUGGING_FACE_DOWNLOAD_DOMAINS, 'huggingface')
}

function validateDownloadJobId(input: unknown): string {
  if (typeof input !== 'string' || !/^[0-9a-f-]{20,80}$/i.test(input)) {
    throw new Error('Invalid download job id')
  }
  return input
}

function validateModelLibraryEntryId(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0 || input.length > 2200) {
    throw new Error('Invalid model library entry id')
  }
  assertNoControlChars(input, 'model library entry id')
  return input
}

function validateWorkspaceId(input: unknown): string {
  if (typeof input !== 'string' || !/^[A-Za-z0-9_.-]{1,120}$/.test(input)) {
    throw new Error('Invalid workspace id')
  }
  return input
}

function validateWorkspaceSaveInput(input: unknown): { id?: string; name: string; snapshot: WorkspaceSnapshot } {
  assertPlainObject(input, 'workspace save input')
  const name = optionalString(input.name, 'workspace name', 120, { allowWhitespace: true }) ?? 'Untitled workspace'
  const id = input.id == null ? undefined : validateWorkspaceId(input.id)
  assertPlainObject(input.snapshot, 'workspace snapshot')
  assertJsonPayloadSize(input.snapshot, 'workspace snapshot', 160 * 1024 * 1024)
  return { id, name, snapshot: input.snapshot as unknown as WorkspaceSnapshot }
}

function validateWorkspaceImageReference(input: unknown): WorkspaceImageReference {
  assertPlainObject(input, 'workspace image reference')
  if (input.kind === 'history') {
    const historyId = validateWorkspaceId(input.historyId)
    const filename = optionalString(input.filename, 'image filename', 240, { allowWhitespace: true }) ?? null
    return { kind: 'history', historyId, filename }
  }
  if (input.kind === 'file') {
    const path = assertAbsolutePath(input.path, 'image path')
    const filename = optionalString(input.filename, 'image filename', 240, { allowWhitespace: true }) ?? null
    const sizeBytes = typeof input.sizeBytes === 'number' && Number.isFinite(input.sizeBytes) ? input.sizeBytes : null
    const lastModifiedAt = typeof input.lastModifiedAt === 'number' && Number.isFinite(input.lastModifiedAt) ? input.lastModifiedAt : null
    return { kind: 'file', path, filename, sizeBytes, lastModifiedAt }
  }
  throw new Error('Invalid workspace image reference')
}

function validateUpscaleComparisonSaveRequest(input: unknown): UpscaleComparisonSaveRequest {
  assertPlainObject(input, 'upscale comparison')
  const method = input.method
  if (method !== 'simple' && method !== 'diffusion' && method !== 'ultimate') {
    throw new Error('Invalid upscale method')
  }
  const scale = boundedNumber(input.scale, 'scale', 0.1, 16) ?? 1
  const criteria = optionalString(input.criteria, 'criteria', 4000, { allowWhitespace: true }) ?? ''
  const inputImageDataUrl = input.inputImageDataUrl == null ? null : validateImagePayload(input.inputImageDataUrl, 'upscale input image')
  const inputFilename = optionalString(input.inputFilename, 'input filename', 240, { allowWhitespace: true }) ?? null
  if (!Array.isArray(input.candidates) || input.candidates.length === 0 || input.candidates.length > 12) {
    throw new Error('Invalid comparison candidates')
  }
  const candidates = input.candidates.map((candidate, index) => {
    assertPlainObject(candidate, `comparison candidate ${index + 1}`)
    return {
      denoise: boundedNumber(candidate.denoise, 'denoise', 0, 1) ?? 0,
      tileControlNetEnabled: candidate.tileControlNetEnabled === true,
      imageDataUrl: validateImagePayload(candidate.imageDataUrl, `comparison candidate ${index + 1} image`)
    }
  })
  return { inputImageDataUrl, inputFilename, method, scale, criteria, candidates }
}

function validateModelMergerRequest(input: unknown): ModelMergerRequest {
  assertPlainObject(input, 'model merger request')
  const primaryModelName = optionalString(input.primaryModelName, 'primary model name', 300, { allowWhitespace: true })
  if (!primaryModelName) throw new Error('Primary model is required')
  const interpMethod = input.interpMethod
  if (interpMethod !== 'No interpolation' && interpMethod !== 'Weighted sum' && interpMethod !== 'Add difference') {
    throw new Error('Invalid interpolation method')
  }
  const secondaryModelName = optionalString(input.secondaryModelName, 'secondary model name', 300, { allowWhitespace: true }) ?? null
  const tertiaryModelName = optionalString(input.tertiaryModelName, 'tertiary model name', 300, { allowWhitespace: true }) ?? null
  if (interpMethod === 'Weighted sum' && !secondaryModelName) {
    throw new Error('Weighted sum requires a secondary model')
  }
  if (interpMethod === 'Add difference' && (!secondaryModelName || !tertiaryModelName)) {
    throw new Error('Add difference requires secondary and tertiary models')
  }
  const multiplier = boundedNumber(input.multiplier, 'merge multiplier', 0, 1)
  if (multiplier == null) throw new Error('Invalid merge multiplier')
  const customName = optionalString(input.customName, 'custom model name', 120, { allowWhitespace: true })
  if (!customName) throw new Error('Custom model name is required')
  if (/[\\/:*?"<>|]/.test(customName) || /\.(ckpt|safetensors)$/i.test(customName)) {
    throw new Error('Custom model name must not contain path separators or an extension')
  }
  const checkpointFormat = input.checkpointFormat === 'ckpt' ? 'ckpt' : 'safetensors'
  const configSource = boundedInteger(input.configSource, 'config source', 0, 3)
  const metadataJson = optionalString(input.metadataJson, 'metadata JSON', 64 * 1024, { allowWhitespace: true, trim: false }) ?? '{}'
  try {
    JSON.parse(metadataJson)
  } catch {
    throw new Error('Metadata JSON is invalid')
  }
  const discardWeights = optionalString(input.discardWeights, 'discard weights regex', 1000, { allowWhitespace: true }) ?? ''
  if (discardWeights) {
    try { new RegExp(discardWeights) } catch { throw new Error('Discard weights regex is invalid') }
  }
  return {
    primaryModelName,
    secondaryModelName,
    tertiaryModelName,
    interpMethod,
    multiplier,
    saveAsHalf: input.saveAsHalf === true,
    customName,
    checkpointFormat,
    configSource: (configSource ?? 0) as 0 | 1 | 2 | 3,
    bakeInVae: optionalString(input.bakeInVae, 'bake in VAE', 300, { allowWhitespace: true }) ?? 'None',
    discardWeights,
    saveMetadata: input.saveMetadata !== false,
    addMergeRecipe: input.addMergeRecipe !== false,
    copyMetadataFields: input.copyMetadataFields !== false,
    metadataJson
  }
}

function validateCivitaiSearchOptions(input: unknown): CivitaiSearchOptions {
  if (input == null) return {}
  assertPlainObject(input, 'Civitai search options')

  const out: CivitaiSearchOptions = {}
  if (typeof input.query === 'string' && input.query.trim()) {
    assertNoControlChars(input.query, 'Civitai search query')
    out.query = input.query.trim().slice(0, 200)
  }

  if (Array.isArray(input.types)) {
    out.types = input.types.filter((t): t is CivitaiAssetType =>
      typeof t === 'string' && CIVITAI_ASSET_TYPES.has(t as CivitaiAssetType)
    )
  }

  if (input.sort === 'Highest Rated' || input.sort === 'Most Downloaded' || input.sort === 'Newest') {
    out.sort = input.sort
  }
  if (input.period === 'AllTime' || input.period === 'Year' || input.period === 'Month' || input.period === 'Week' || input.period === 'Day') {
    out.period = input.period
  }
  if (typeof input.nsfw === 'boolean') out.nsfw = input.nsfw

  if (Array.isArray(input.baseModels)) {
    out.baseModels = input.baseModels
      .filter((m): m is string => typeof m === 'string' && m.length > 0 && m.length <= 80 && !/[\u0000-\u001f\u007f]/.test(m))
      .slice(0, 20)
  }

  const limit = Number(input.limit ?? 20)
  if (Number.isFinite(limit)) out.limit = Math.min(100, Math.max(1, Math.floor(limit)))

  if (input.page != null) {
    const page = Number(input.page)
    if (Number.isInteger(page) && page > 0 && page < 10_000) out.page = page
  }

  if (typeof input.cursor === 'string' && input.cursor.length <= 512) {
    assertNoControlChars(input.cursor, 'Civitai cursor')
    out.cursor = input.cursor
  } else if (input.cursor === null) {
    out.cursor = null
  }

  return out
}

function validateHuggingFaceSearchOptions(input: unknown): HuggingFaceSearchOptions {
  if (input == null) return {}
  assertPlainObject(input, 'Hugging Face search options')
  const out: HuggingFaceSearchOptions = {}
  if (typeof input.query === 'string' && input.query.trim()) {
    assertNoControlChars(input.query, 'Hugging Face search query')
    out.query = input.query.trim().slice(0, 200)
  }
  if (Array.isArray(input.assetTypes)) {
    out.assetTypes = input.assetTypes.filter((t): t is CivitaiAssetType =>
      typeof t === 'string' && CIVITAI_ASSET_TYPES.has(t as CivitaiAssetType)
    )
  }
  const limit = Number(input.limit ?? 20)
  if (Number.isFinite(limit)) out.limit = Math.min(50, Math.max(1, Math.floor(limit)))
  return out
}

function validateOverrideSettings(raw: unknown): Txt2ImgRequest['override_settings'] | undefined {
  if (raw == null) return undefined
  assertPlainObject(raw, 'override settings')
  const entries = Object.entries(raw)
  if (entries.length > 30) throw new Error('Too many override settings')

  const out: NonNullable<Txt2ImgRequest['override_settings']> = {}
  for (const [key, value] of entries) {
    if (!/^[A-Za-z0-9_. -]{1,80}$/.test(key)) {
      throw new Error('Invalid override setting name')
    }
    if (typeof value === 'string') {
      if (value.length > 500) throw new Error('Override setting value is too long')
      assertNoUnsafeControlChars(value, `override setting ${key}`)
      out[key] = value
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value
    } else {
      throw new Error('Invalid override setting value')
    }
  }
  return out
}

function validateScriptArgs(raw: unknown): unknown[] | undefined {
  if (raw == null) return undefined
  if (!Array.isArray(raw) || raw.length > 100) {
    throw new Error('Invalid script args')
  }
  assertJsonPayloadSize(raw, 'script args', MAX_SCRIPT_ARGS_BYTES)
  return raw
}

function validateAlwaysOnScripts(raw: unknown): Txt2ImgRequest['alwayson_scripts'] | undefined {
  if (raw == null) return undefined
  assertPlainObject(raw, 'alwayson scripts')
  assertJsonPayloadSize(raw, 'alwayson scripts', MAX_ALWAYS_ON_BYTES)

  const entries = Object.entries(raw)
  if (entries.length > 30) throw new Error('Too many alwayson scripts')
  const out: NonNullable<Txt2ImgRequest['alwayson_scripts']> = {}
  for (const [scriptName, config] of entries) {
    if (scriptName.length === 0 || scriptName.length > 160) {
      throw new Error('Invalid alwayson script name')
    }
    assertNoControlChars(scriptName, 'alwayson script name')
    assertPlainObject(config, `alwayson script ${scriptName}`)
    const args = config.args
    if (!Array.isArray(args) || args.length > 120) {
      throw new Error(`Invalid args for alwayson script ${scriptName}`)
    }
    out[scriptName] = { args }
  }
  return out
}

function validateBaseGenerationRequest(input: unknown): Txt2ImgRequest {
  assertPlainObject(input, 'generation request')

  const prompt = optionalString(input.prompt, 'prompt', MAX_PROMPT_CHARS, {
    allowWhitespace: true,
    trim: false
  })
  const negativePrompt = optionalString(input.negative_prompt, 'negative prompt', MAX_PROMPT_CHARS, {
    allowWhitespace: true,
    trim: false
  })
  const steps = boundedInteger(input.steps, 'steps', 1, 150)
  const cfgScale = boundedNumber(input.cfg_scale, 'CFG scale', 0, 50)
  const width = boundedInteger(input.width, 'width', 64, 8192)
  const height = boundedInteger(input.height, 'height', 64, 8192)
  const batchSize = boundedInteger(input.batch_size, 'batch size', 1, 16)
  const nIter = boundedInteger(input.n_iter, 'n_iter', 1, 16)
  const seed = boundedInteger(input.seed, 'seed', -1, Number.MAX_SAFE_INTEGER)
  const out: Partial<Txt2ImgRequest> = {}
  if (prompt != null) out.prompt = prompt
  if (negativePrompt != null) out.negative_prompt = negativePrompt
  if (steps != null) out.steps = steps
  if (cfgScale != null) out.cfg_scale = cfgScale
  if (width != null) out.width = width
  if (height != null) out.height = height
  if (batchSize != null) out.batch_size = batchSize
  if (nIter != null) out.n_iter = nIter
  if (seed != null) out.seed = seed

  const samplerName = optionalString(input.sampler_name, 'sampler name', 120)
  if (samplerName != null) out.sampler_name = samplerName
  const scheduler = optionalString(input.scheduler, 'scheduler', 120)
  if (scheduler != null) out.scheduler = scheduler
  const scriptName = optionalString(input.script_name, 'script name', 160)
  if (scriptName != null) out.script_name = scriptName

  const scriptArgs = validateScriptArgs(input.script_args)
  if (scriptArgs != null) out.script_args = scriptArgs
  const alwaysonScripts = validateAlwaysOnScripts(input.alwayson_scripts)
  if (alwaysonScripts != null) out.alwayson_scripts = alwaysonScripts
  const overrideSettings = validateOverrideSettings(input.override_settings)
  if (overrideSettings != null) out.override_settings = overrideSettings
  if (input.override_settings_restore_afterwards != null) {
    out.override_settings_restore_afterwards = input.override_settings_restore_afterwards === true
  }

  return out as Txt2ImgRequest
}

function validateTxt2ImgRequest(input: unknown): Txt2ImgRequest {
  return validateBaseGenerationRequest(input)
}

function validateImg2ImgRequest(input: unknown): Img2ImgRequest {
  assertPlainObject(input, 'img2img request')
  const out = validateBaseGenerationRequest(input) as Img2ImgRequest

  if (!Array.isArray(input.init_images) || input.init_images.length === 0 || input.init_images.length > 4) {
    throw new Error('Invalid init images')
  }
  out.init_images = input.init_images.map((image, index) => validateImagePayload(image, `init image ${index + 1}`))

  const denoisingStrength = boundedNumber(input.denoising_strength, 'denoising strength', 0, 1)
  if (denoisingStrength != null) out.denoising_strength = denoisingStrength
  const resizeMode = boundedInteger(input.resize_mode, 'resize mode', 0, 3)
  if (resizeMode != null) out.resize_mode = resizeMode
  if (input.mask != null) {
    out.mask = validateImagePayload(input.mask, 'mask image')
  }
  const inpaintingFill = boundedInteger(input.inpainting_fill, 'inpainting fill', 0, 4)
  if (inpaintingFill != null) out.inpainting_fill = inpaintingFill
  const maskBlur = boundedInteger(input.mask_blur, 'mask blur', 0, 64)
  if (maskBlur != null) out.mask_blur = maskBlur

  return out
}

function validateExtraSingleImageOptions(input: unknown): Parameters<ForgeApi['extraSingleImage']>[0] {
  assertPlainObject(input, 'extras request')
  const upscaler = optionalString(input.upscaler, 'upscaler', 160)
  const resize = boundedNumber(input.resize, 'upscale resize', 1, 8)
  if (upscaler == null || resize == null) {
    throw new Error('Invalid extras request')
  }
  return {
    image: validateImagePayload(input.image, 'extras image'),
    upscaler,
    resize,
    upscaler2: optionalString(input.upscaler2, 'upscaler 2', 160),
    upscaler2Visibility: boundedNumber(input.upscaler2Visibility, 'upscaler 2 visibility', 0, 1)
  }
}

function validateInterrogateArgs(input: unknown): { image: string; model?: 'clip' | 'deepdanbooru' } {
  assertPlainObject(input, 'interrogate request')
  const image = validateImagePayload(input.image, 'interrogate image')
  const model = input.model
  if (model == null) return { image }
  if (model !== 'clip' && model !== 'deepdanbooru') {
    throw new Error('Invalid interrogate model')
  }
  return { image, model }
}

async function scanModelHealth(forgePath: string): Promise<{
  root: string
  scannedAt: number
  totals: { files: number; totalBytes: number; issues: number }
  folders: ModelHealthFolder[]
  issues: ModelHealthIssue[]
}> {
  const folders: ModelHealthFolder[] = []
  const issues: ModelHealthIssue[] = []

  for (const spec of MODEL_HEALTH_FOLDERS) {
    const dir = join(forgePath, ...spec.parts)
    const folder: ModelHealthFolder = {
      id: spec.id,
      label: spec.label,
      path: dir,
      exists: existsSync(dir),
      files: 0,
      totalBytes: 0
    }

    if (!folder.exists) {
      issues.push({
        severity: 'warn',
        folder: spec.label,
        file: null,
        message: `Folder is missing: ${dir}`
      })
      folders.push(folder)
      continue
    }

    const files = await walkModelFiles(dir)
    folder.files = files.length
    const stems = new Map<string, string[]>()

    for (const file of files) {
      const st = await stat(file)
      folder.totalBytes += st.size
      const rel = relative(dir, file)
      const stem = basename(file).replace(/\.[^.]+$/, '').toLowerCase()
      stems.set(stem, [...(stems.get(stem) ?? []), rel])

      if (st.size === 0) {
        issues.push({
          severity: 'error',
          folder: spec.label,
          file: rel,
          message: 'File is empty'
        })
        continue
      }

      if (/\.safetensors$/i.test(file)) {
        const inspected = await inspectSafetensors(file)
        if (inspected.kind === 'unknown') {
          issues.push({
            severity: 'warn',
            folder: spec.label,
            file: rel,
            message: 'Could not classify safetensors header'
          })
        } else if (inspected.kind !== spec.expected) {
          issues.push({
            severity: 'error',
            folder: spec.label,
            file: rel,
            message: `Expected ${describeKind(spec.expected)}, detected ${describeKind(inspected.kind)}`
          })
        }
      }
    }

    for (const matches of stems.values()) {
      if (matches.length <= 1) continue
      issues.push({
        severity: 'warn',
        folder: spec.label,
        file: matches[0],
        message: `Duplicate model stem: ${matches.join(', ')}`
      })
    }

    folders.push(folder)
  }

  return {
    root: forgePath,
    scannedAt: Date.now(),
    totals: {
      files: folders.reduce((sum, f) => sum + f.files, 0),
      totalBytes: folders.reduce((sum, f) => sum + f.totalBytes, 0),
      issues: issues.length
    },
    folders,
    issues
  }
}

function summarizeModelLibrary(
  root: string,
  entries: ModelLibraryEntry[],
  scanStats?: ModelLibrarySummary['scanStats']
): ModelLibrarySummary {
  const byType: ModelLibrarySummary['byType'] = {}
  for (const entry of entries) {
    const bucket = byType[entry.type] ?? { files: 0, totalBytes: 0 }
    bucket.files += 1
    bucket.totalBytes += entry.sizeBytes
    byType[entry.type] = bucket
  }
  return {
    root,
    scannedAt: Date.now(),
    totals: {
      files: entries.length,
      totalBytes: entries.reduce((sum, entry) => sum + entry.sizeBytes, 0)
    },
    scanStats,
    byType,
    entries
  }
}

async function scanModelLibrary(forgePath: string, storage: Storage): Promise<ModelLibrarySummary> {
  const previousByPath = new Map(storage.listModelLibrary().map((entry) => [resolve(entry.path), entry]))
  const entries: ModelLibraryEntry[] = []
  const seenPaths = new Set<string>()
  const scanStats: NonNullable<ModelLibrarySummary['scanStats']> = {
    newFiles: 0,
    updatedFiles: 0,
    unchangedFiles: 0,
    removedFiles: 0,
    shaPreserved: 0,
    shaInvalidated: 0
  }
  const now = Date.now()

  for (const spec of MODEL_LIBRARY_FOLDERS) {
    const dir = join(forgePath, ...spec.parts)
    if (!existsSync(dir)) continue
    const files = await walkModelFiles(dir)
    for (const file of files) {
      const resolved = resolve(file)
      const st = await stat(resolved)
      if (!st.isFile()) continue
      const previous = previousByPath.get(resolved)
      seenPaths.add(resolved)
      const lastModifiedAt = st.mtimeMs
      const unchanged =
        previous &&
        previous.sizeBytes === st.size &&
        (previous.lastModifiedAt === null || Math.abs(previous.lastModifiedAt - lastModifiedAt) < 1)
      const sha256 = unchanged || !previous?.lastModifiedAt
        ? previous?.sha256 ?? null
        : null
      if (!previous) {
        scanStats.newFiles += 1
      } else if (unchanged || !previous.lastModifiedAt) {
        scanStats.unchangedFiles += 1
      } else {
        scanStats.updatedFiles += 1
      }
      if (previous?.sha256 && sha256 === previous.sha256) {
        scanStats.shaPreserved += 1
      } else if (previous?.sha256 && !sha256) {
        scanStats.shaInvalidated += 1
      }
      entries.push({
        id: `${spec.type}:${resolved.toLowerCase()}`,
        name: basename(resolved),
        type: spec.type,
        path: resolved,
        sizeBytes: st.size,
        sha256,
        source: previous?.source ?? 'local',
        installedAt: previous?.installedAt ?? st.birthtimeMs ?? now,
        lastSeenAt: now,
        lastModifiedAt,
        sourceMeta: previous?.sourceMeta,
        previewPath: previous?.previewPath,
        civitai: previous?.civitai
      })
    }
  }
  scanStats.removedFiles = Array.from(previousByPath.keys())
    .filter((path) => !seenPaths.has(path))
    .length

  entries.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
  storage.saveModelLibrary(entries)
  return summarizeModelLibrary(forgePath, entries, scanStats)
}

async function checkLibraryIntegrity(storage: Storage): Promise<LibraryIntegrityReport> {
  const entries = storage.listModelLibrary()
  const jobs = storage.listDownloadJobs()
  const issues: LibraryIntegrityReport['issues'] = []
  const totals: LibraryIntegrityReport['totals'] = {
    entries: entries.length,
    jobs: jobs.length,
    missingFiles: 0,
    sizeMismatches: 0,
    shaMissing: 0,
    shaMismatches: 0,
    partialDownloads: 0,
    issues: 0
  }

  for (const entry of entries) {
    const st = existsSync(entry.path) ? await stat(entry.path).catch(() => null) : null
    if (!st?.isFile()) {
      totals.missingFiles += 1
      issues.push({
        severity: 'error',
        entryId: entry.id,
        path: entry.path,
        message: 'Indexed model file is missing'
      })
      continue
    }
    if (entry.sizeBytes > 0 && st.size !== entry.sizeBytes) {
      totals.sizeMismatches += 1
      issues.push({
        severity: 'warn',
        entryId: entry.id,
        path: entry.path,
        message: `Indexed size ${entry.sizeBytes} differs from current size ${st.size}`
      })
    }
    const expected = entry.sourceMeta?.expectedSha256 ?? entry.civitai?.expectedSha256 ?? null
    if (!entry.sha256) {
      totals.shaMissing += 1
      issues.push({
        severity: 'info',
        entryId: entry.id,
        path: entry.path,
        message: 'SHA-256 is not recorded yet'
      })
    } else if (expected && expected.toLowerCase() !== entry.sha256.toLowerCase()) {
      totals.shaMismatches += 1
      issues.push({
        severity: 'error',
        entryId: entry.id,
        path: entry.path,
        message: 'Recorded SHA-256 does not match the provider hash'
      })
    }
  }

  for (const job of jobs) {
    if (job.status !== 'completed' && existsSync(job.partialPath)) {
      totals.partialDownloads += 1
      issues.push({
        severity: 'warn',
        jobId: job.id,
        path: job.partialPath,
        message: `Partial download remains for ${job.filename}`
      })
    }
    if (job.status === 'completed' && !existsSync(job.destPath)) {
      totals.missingFiles += 1
      issues.push({
        severity: 'error',
        jobId: job.id,
        path: job.destPath,
        message: `Completed download is missing on disk: ${job.filename}`
      })
    }
  }

  totals.issues = issues.length
  return { checkedAt: Date.now(), totals, issues }
}

async function hashModelLibraryEntry(storage: Storage, rawId: string): Promise<ModelHashResult> {
  const id = validateModelLibraryEntryId(rawId)
  const entry = storage.listModelLibrary().find((item) => item.id === id)
  if (!entry) throw new Error('Model library entry not found')
  const safePath = await assertExistingFile(entry.path, 'model file', MODEL_FILE_EXTS)
  const settings = storage.getSettings()
  const forgeRoot = resolve(settings.forgePath, 'webui')
  if (!isSubpath(forgeRoot, safePath)) {
    throw new Error('Model library entry is outside the Forge folder')
  }
  const sha256 = await hashModelFile(safePath)
  const st = await stat(safePath)
  storage.upsertModelLibraryEntry({ ...entry, sha256, sizeBytes: st.size, lastSeenAt: Date.now(), lastModifiedAt: st.mtimeMs })
  return { entryId: entry.id, path: safePath, sha256 }
}

async function recoverModelLibrary(storage: Storage): Promise<ModelLibraryRecoveryResult> {
  const settings = storage.getSettings()
  await scanModelLibrary(settings.forgePath, storage).catch(() => null)

  let recoveredJobs = 0
  let completedJobsFixed = 0
  for (const job of storage.listDownloadJobs()) {
    if (job.status === 'running') {
      const partial = existsSync(job.partialPath) ? await stat(job.partialPath).catch(() => null) : null
      const dest = existsSync(job.destPath) ? await stat(job.destPath).catch(() => null) : null
      if (dest?.isFile()) {
        storage.updateDownloadJob(job.id, {
          status: 'completed',
          bytesDownloaded: dest.size,
          totalBytes: dest.size,
          error: undefined
        })
        completedJobsFixed += 1
      } else {
        storage.updateDownloadJob(job.id, {
          status: 'failed',
          bytesDownloaded: partial?.isFile() ? partial.size : job.bytesDownloaded,
          error: 'App restarted while this download was running. Use Resume to continue.'
        })
        recoveredJobs += 1
      }
    }
  }

  let metadataRefetched = 0
  let previewsRefetched = 0
  const key = settings.civitaiApiKey
  const entries = storage.listModelLibrary()
  for (const entry of entries.slice(0, 80)) {
    let next = entry
    if (!next.sourceMeta && next.sha256) {
      const rec = await fetchByHash(next.sha256, key).catch(() => null)
      if (rec) {
        next = storage.upsertModelLibraryEntry({
          ...next,
          source: 'civitai',
          sourceMeta: {
            provider: 'civitai',
            name: rec.modelName,
            pageUrl: rec.civitaiUrl ?? undefined,
            thumbnailUrl: rec.thumbnailUrl,
            expectedSha256: next.sha256,
            modelId: rec.modelId,
            modelVersionId: rec.modelVersionId,
            versionName: rec.versionName,
            baseModel: rec.baseModel
          }
        })
        metadataRefetched += 1
      }
    }
    if (next.sourceMeta?.thumbnailUrl && (!next.previewPath || !existsSync(next.previewPath))) {
      const previewPath = await cacheModelPreview(storage, next.id, next.sourceMeta.thumbnailUrl).catch(() => null)
      if (previewPath) {
        storage.upsertModelLibraryEntry({
          ...next,
          previewPath,
          sourceMeta: { ...next.sourceMeta, previewPath }
        })
        previewsRefetched += 1
      }
    }
  }

  const missingShaEntries = storage.listModelLibrary().filter((entry) => !entry.sha256 && existsSync(entry.path))
  const hashAlreadyRunning = modelLibraryHashQueueRunning
  const hashesQueued = queueMissingModelHashes(storage, missingShaEntries)
  return {
    recoveredJobs,
    completedJobsFixed,
    metadataRefetched,
    previewsRefetched,
    hashesQueued,
    hashAlreadyRunning
  }
}

function queueMissingModelHashes(storage: Storage, entries: ModelLibraryEntry[]): number {
  if (modelLibraryHashQueueRunning || entries.length === 0) return 0
  const queue = entries.slice(0, 200)
  modelLibraryHashQueueRunning = true
  void (async () => {
    try {
      for (const entry of queue) {
        await hashModelLibraryEntry(storage, entry.id).catch(() => null)
      }
    } finally {
      modelLibraryHashQueueRunning = false
    }
  })()
  return queue.length
}

async function cacheModelPreview(storage: Storage, entryId: string, rawUrl: string): Promise<string | null> {
  const url = assertAllowedUrl(rawUrl, 'preview URL', PREVIEW_IMAGE_DOMAINS)
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Yoitomoshi-Art-Generator/0.1' },
    signal: AbortSignal.timeout(10_000)
  })
  if (!res.ok) return null
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length === 0 || bytes.length > 5 * 1024 * 1024) return null
  const contentType = res.headers.get('content-type') ?? ''
  const ext = contentType.includes('png') ? '.png' : contentType.includes('webp') ? '.webp' : '.jpg'
  return storage.saveModelPreview(entryId, bytes, ext)
}

async function resolveWorkspaceImageReference(storage: Storage, rawRef: unknown): Promise<string | null> {
  const ref = validateWorkspaceImageReference(rawRef)
  if (ref.kind === 'history') {
    return storage.readHistoryImageDataUrl(ref.historyId)
  }

  const path = await assertExistingFile(ref.path, 'workspace image file', IMAGE_FILE_EXTS)
  const st = await stat(path)
  if (st.size > MAX_WORKSPACE_IMAGE_BYTES) {
    throw new Error('Workspace image is too large')
  }
  const ext = extname(path).toLowerCase()
  const mime = ext === '.jpg' || ext === '.jpeg'
    ? 'image/jpeg'
    : ext === '.webp'
      ? 'image/webp'
      : 'image/png'
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`
}

async function saveFabricFeedbackImage(
  storage: Storage,
  rawImage: unknown
): Promise<FabricFeedbackImageSaveResult> {
  const image = validateImagePayload(rawImage, 'FABRIC feedback image')
  const match = image.match(/^data:image\/([^;]+);base64,(.+)$/s)
  const mimeExt = match?.[1]?.toLowerCase()
  const payload = match?.[2] ?? image
  const ext = mimeExt === 'jpeg' || mimeExt === 'jpg'
    ? '.jpg'
    : mimeExt === 'webp'
      ? '.webp'
      : '.png'
  const bytes = Buffer.from(payload.replace(/\s+/g, ''), 'base64')
  if (bytes.length === 0 || bytes.length > MAX_WORKSPACE_IMAGE_BYTES) {
    throw new Error('FABRIC feedback image is too large')
  }

  const settings = storage.getSettings()
  const forgeRoot = resolve(settings.forgePath)
  const candidates = [
    resolve(forgeRoot, 'webui', 'extensions', 'sd-webui-fabric'),
    resolve(forgeRoot, 'extensions', 'sd-webui-fabric')
  ]
  const extensionRoot = candidates.find((candidate) => existsSync(candidate))
  if (!extensionRoot) {
    throw new Error('sd-webui-fabric extension was not found under Forge extensions')
  }
  if (!isSubpath(forgeRoot, extensionRoot)) {
    throw new Error('Invalid FABRIC extension path')
  }

  const outDir = resolve(extensionRoot, 'log', 'fabric', 'images')
  if (!isSubpath(extensionRoot, outDir)) {
    throw new Error('Invalid FABRIC feedback folder')
  }
  await mkdir(outDir, { recursive: true })
  const filename = `${createHash('sha256').update(bytes).digest('hex').slice(0, 20)}${ext}`
  const outPath = resolve(outDir, filename)
  if (!isSubpath(outDir, outPath)) {
    throw new Error('Invalid FABRIC feedback path')
  }
  writeFileSync(outPath, bytes)
  return { filename, path: outPath }
}

async function convertModelFormat(storage: Storage, win: BrowserWindow): Promise<ModelFormatConversionResult | null> {
  const settings = storage.getSettings()
  const modelRoot = resolve(settings.forgePath, 'webui', 'models', 'Stable-diffusion')
  const result = await dialog.showOpenDialog(win, {
    title: '変換する checkpoint を選択',
    defaultPath: modelRoot,
    properties: ['openFile'],
    filters: [
      { name: 'PyTorch checkpoint', extensions: ['ckpt', 'pt', 'pth'] },
      { name: 'All files', extensions: ['*'] }
    ]
  })
  if (result.canceled || result.filePaths.length === 0) return null

  const sourcePath = await assertExistingFile(result.filePaths[0], 'checkpoint file', CONVERTIBLE_MODEL_FILE_EXTS)
  if (!isSubpath(modelRoot, sourcePath)) {
    throw new Error('Conversion source must be under the Forge models/Stable-diffusion folder')
  }
  const destPath = sourcePath.replace(/\.(ckpt|pt|pth)$/i, '.safetensors')
  if (destPath === sourcePath || existsSync(destPath)) {
    throw new Error('Destination .safetensors already exists')
  }
  const tempPath = `${destPath}.partial-${Date.now()}`
  const pythonExe = join(settings.forgePath, 'system', 'python', 'python.exe')
  if (!existsSync(pythonExe)) throw new Error('Forge Python was not found')

  let stdout = ''
  let stderr = ''
  try {
    const result = await runProcess(pythonExe, ['-c', PY_CONVERT_TO_SAFETENSORS, sourcePath, tempPath])
    stdout = result.stdout
    stderr = result.stderr
    const tempStat = await stat(tempPath).catch(() => null)
    if (!tempStat?.isFile()) {
      throw new Error('Conversion finished but temporary output file was not created')
    }
    await rename(tempPath, destPath)
  } catch (e) {
    await unlink(tempPath).catch(() => undefined)
    throw e
  }
  const convertedStat = await stat(destPath).catch(() => null)
  if (!convertedStat?.isFile()) {
    throw new Error('Conversion finished but output file was not created')
  }
  await scanModelLibrary(settings.forgePath, storage)
  return { sourcePath, destPath, stdout, stderr }
}

function inspectMergerSupport(forgePath: string): ModelMergerSupportReport {
  const extrasPath = join(forgePath, 'webui', 'modules', 'extras.py')
  if (!existsSync(extrasPath)) {
    return {
      forgePath,
      extrasPath,
      available: false,
      functionName: null,
      message: 'Forge modules/extras.py was not found'
    }
  }
  const source = readFileSync(extrasPath, 'utf8')
  const match = source.match(/def\s+(run_modelmerger|run_pnginfo|run_extras)\s*\(/)
  const available = /def\s+run_modelmerger\s*\(/.test(source)
  return {
    forgePath,
    extrasPath,
    available,
    functionName: available ? 'run_modelmerger' : match?.[1] ?? null,
    message: available
      ? 'Forge model merger function is present and can be called through the guarded Python bridge'
      : 'Forge model merger function was not detected in modules/extras.py'
  }
}

function stripForgeModelHash(title: string): string {
  return title.replace(/\s+\[[a-f0-9]{6,}\]\s*$/i, '').trim()
}

async function resolveCheckpointForMerger(
  outputDir: string,
  title: string
): Promise<{ title: string; path: string; sizeBytes: number }> {
  const wanted = stripForgeModelHash(title)
  const normalizedWanted = wanted.replace(/\//g, '\\').toLowerCase()
  const files = (await walkModelFiles(outputDir))
    .filter((file) => ['.safetensors', '.ckpt'].includes(extname(file).toLowerCase()))
  for (const file of files) {
    const rel = relative(outputDir, file).replace(/\//g, '\\').toLowerCase()
    const name = basename(file).toLowerCase()
    if (rel === normalizedWanted || name === normalizedWanted.toLowerCase()) {
      const st = await stat(file)
      return { title, path: resolve(file), sizeBytes: st.size }
    }
  }
  throw new Error(`Checkpoint file was not found for: ${title}`)
}

async function getFreeBytes(dir: string): Promise<number | null> {
  try {
    const fsStats = await statfs(dir)
    return Number(fsStats.bavail) * Number(fsStats.bsize)
  } catch {
    return null
  }
}

async function buildModelMergerEstimate(
  storage: Storage,
  req: ModelMergerRequest
): Promise<ModelMergerEstimate> {
  const settings = storage.getSettings()
  const outputDir = resolve(settings.forgePath, 'webui', 'models', 'Stable-diffusion')
  const outputPath = join(outputDir, `${req.customName}.${req.checkpointFormat}`)
  const roles: Array<{ role: 'primary' | 'secondary' | 'tertiary'; title: string | null }> = [
    { role: 'primary', title: req.primaryModelName },
    { role: 'secondary', title: req.interpMethod === 'Weighted sum' || req.interpMethod === 'Add difference' ? req.secondaryModelName : null },
    { role: 'tertiary', title: req.interpMethod === 'Add difference' ? req.tertiaryModelName : null }
  ]
  const sourceModels: ModelMergerEstimate['sourceModels'] = []
  for (const item of roles) {
    if (!item.title) continue
    const resolvedModel = await resolveCheckpointForMerger(outputDir, item.title)
    sourceModels.push({ role: item.role, ...resolvedModel })
  }
  const totalSourceBytes = sourceModels.reduce((sum, model) => sum + model.sizeBytes, 0)
  const largestSourceBytes = sourceModels.reduce((max, model) => Math.max(max, model.sizeBytes), 0)
  const outputFactor = req.saveAsHalf ? 0.7 : 1.1
  const estimatedOutputBytes = Math.ceil(largestSourceBytes * outputFactor)
  const requiredFreeBytes = Math.ceil(estimatedOutputBytes * 1.2 + MODEL_MERGER_DISK_MARGIN_BYTES)
  const freeBytes = await getFreeBytes(outputDir)
  const outputExists = existsSync(outputPath)
  const enoughDisk = freeBytes == null ? null : freeBytes >= requiredFreeBytes
  const warnings: string[] = []
  if (outputExists) warnings.push('Output model already exists')
  if (freeBytes == null) warnings.push('Could not read disk free space')
  else if (!enoughDisk) warnings.push('Disk free space is below the safe estimate')
  if (totalSourceBytes >= 8 * 1024 * 1024 * 1024) {
    warnings.push('Large checkpoints can take several minutes and may temporarily freeze Python logs')
  }
  return {
    outputDir,
    outputPath,
    outputExists,
    sourceModels,
    totalSourceBytes,
    largestSourceBytes,
    estimatedOutputBytes,
    requiredFreeBytes,
    freeBytes,
    enoughDisk,
    canRun: !outputExists && enoughDisk !== false,
    warnings
  }
}

async function estimateModelMerger(storage: Storage, rawReq: unknown): Promise<ModelMergerEstimate> {
  return buildModelMergerEstimate(storage, validateModelMergerRequest(rawReq))
}

function sendModelMergerProgress(win: BrowserWindow, patch: Partial<ModelMergerProgress> = {}): void {
  const active = activeModelMerger
  const progress: ModelMergerProgress = {
    running: patch.running ?? !!active,
    startedAt: patch.startedAt ?? active?.startedAt ?? null,
    finishedAt: patch.finishedAt,
    logTail: patch.logTail ?? [...(active?.logTail ?? [])],
    outputPath: patch.outputPath ?? active?.outputPath ?? null,
    error: patch.error
  }
  if (!win.isDestroyed()) {
    win.webContents.send(IPC.toolsModelMergerProgress, progress)
  }
}

function appendModelMergerLog(
  win: BrowserWindow,
  active: ActiveModelMerger,
  source: 'stdout' | 'stderr',
  chunk: Buffer
): void {
  const stripped = chunk
    .toString('utf8')
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '\n')
  for (const rawLine of stripped.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    active.logTail.push(source === 'stderr' ? `[stderr] ${line}` : line)
  }
  if (active.logTail.length > MODEL_MERGER_LOG_TAIL_LIMIT) {
    active.logTail.splice(0, active.logTail.length - MODEL_MERGER_LOG_TAIL_LIMIT)
  }
  sendModelMergerProgress(win, { running: true })
}

function cancelModelMerger(win: BrowserWindow): void {
  const active = activeModelMerger
  if (!active) return
  active.cancelRequested = true
  active.logTail.push('Cancel requested.')
  if (active.logTail.length > MODEL_MERGER_LOG_TAIL_LIMIT) {
    active.logTail.splice(0, active.logTail.length - MODEL_MERGER_LOG_TAIL_LIMIT)
  }
  sendModelMergerProgress(win, { running: true })
  active.child.kill()
}

async function runModelMerger(storage: Storage, win: BrowserWindow, rawReq: unknown): Promise<ModelMergerResult> {
  const req = validateModelMergerRequest(rawReq)
  const settings = storage.getSettings()
  const pythonExe = join(settings.forgePath, 'system', 'python', 'python.exe')
  const webuiDir = join(settings.forgePath, 'webui')
  const outputDir = join(webuiDir, 'models', 'Stable-diffusion')
  if (!existsSync(pythonExe)) throw new Error('Forge Python was not found')
  if (!existsSync(join(webuiDir, 'modules', 'extras.py'))) throw new Error('Forge model merger module was not found')
  if (activeModelMerger) throw new Error('A model merge is already running')

  const estimate = await buildModelMergerEstimate(storage, req)
  const expectedOutput = estimate.outputPath
  if (estimate.outputExists) {
    throw new Error(`Output model already exists: ${expectedOutput}`)
  }
  if (estimate.enoughDisk === false) {
    throw new Error('Disk free space is below the safe estimate for this merge')
  }

  const payload = Buffer.from(JSON.stringify(req), 'utf8').toString('base64')
  const child = spawn(pythonExe, ['-c', PY_RUN_MODEL_MERGER, payload], {
    windowsHide: true,
    cwd: webuiDir,
    env: {
      ...process.env,
      IGNORE_CMD_ARGS_ERRORS: '1',
      USE_TF: '0',
      TRANSFORMERS_NO_TF: '1',
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8'
    }
  })
  activeModelMerger = {
    child,
    startedAt: Date.now(),
    logTail: ['Model merger started.'],
    outputPath: null,
    cancelRequested: false
  }
  sendModelMergerProgress(win, { running: true })

  let stdout = ''
  let stderr = ''
  let completed = false

  try {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8')
        if (activeModelMerger) appendModelMergerLog(win, activeModelMerger, 'stdout', chunk)
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
        if (activeModelMerger) appendModelMergerLog(win, activeModelMerger, 'stderr', chunk)
      })
      child.on('error', rejectPromise)
      child.on('close', (code, signal) => {
        if (code === 0) {
          resolvePromise()
          return
        }
        const message = (stderr || stdout || `process exited with ${code ?? signal ?? 'unknown'}`).trim()
        rejectPromise(new Error(message))
      })
    })

    const parsed = parseLastJsonLine(stdout) as { message?: string; outputPath?: string | null } | null
    const outputPath = parsed?.outputPath ? resolve(parsed.outputPath) : null
    if (outputPath && !isSubpath(outputDir, outputPath)) {
      throw new Error('Model merger output path was outside the checkpoint folder')
    }
    if (outputPath && !existsSync(outputPath)) {
      throw new Error('Model merger reported success but output file was not found')
    }
    if (activeModelMerger) activeModelMerger.outputPath = outputPath
    await scanModelLibrary(settings.forgePath, storage)
    completed = true
    sendModelMergerProgress(win, {
      running: false,
      finishedAt: Date.now(),
      outputPath
    })
    return {
      outputPath,
      message: parsed?.message ?? stdout.split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? 'Model merger completed',
      stdout: stdout.trim(),
      stderr: stderr.trim()
    }
  } catch (e) {
    const wasCanceled = activeModelMerger?.cancelRequested === true
    if (!completed && existsSync(expectedOutput) && isSubpath(outputDir, expectedOutput)) {
      await unlink(expectedOutput).catch(() => undefined)
    }
    const message = wasCanceled ? 'Model merger was canceled' : (e as Error).message
    sendModelMergerProgress(win, {
      running: false,
      finishedAt: Date.now(),
      error: message
    })
    throw new Error(message)
  } finally {
    activeModelMerger = null
  }
}

function parseLastJsonLine(stdout: string): unknown | null {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith('{')) continue
    try { return JSON.parse(lines[i]) } catch { /* ignore */ }
  }
  return null
}

function runProcess(
  command: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {}
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() })
      } else {
        reject(new Error((stderr || stdout || `process exited with ${code}`).trim()))
      }
    })
  })
}

/**
 * Wire up all IPC handlers. Called once from main.ts after the window is created.
 *
 * Naming: handlers throw on failure so the renderer's await reject path triggers
 * a toast — they never return null/undefined to signal errors.
 */
export function registerIpcHandlers(deps: {
  win: BrowserWindow
  manager: ForgeManager
  api: ForgeApi
  storage: Storage
  library: PromptLibrary
  startupMetrics: StartupMetrics
}): void {
  const { win, manager, api, storage, library, startupMetrics } = deps
  const userPickedModelFiles = new Set<string>()
  let startupMetricsPersisted = false

  // Forge lifecycle ------------------------------------------------------
  ipcMain.handle(IPC.forgeStart, async () => {
    await manager.start()
  })
  ipcMain.handle(IPC.forgeStop, async () => {
    await manager.stop()
  })
  ipcMain.handle(IPC.forgeStatus, () => manager.getStatus())

  manager.on('status', (s) => {
    startupMetrics.forgeLastStatusAt = Date.now()
    startupMetrics.forgeLastStatusKind = s.kind
    if (s.kind === 'ready' && startupMetrics.forgeReadyAt === null) {
      startupMetrics.forgeReadyAt = Date.now()
      if (!startupMetricsPersisted) {
        startupMetricsPersisted = true
        try {
          storage.saveStartupMetricsSample(startupMetrics)
        } catch (e) {
          console.warn('[startup] failed to save metrics sample:', e)
        }
      }
    }
    for (const target of BrowserWindow.getAllWindows()) {
      if (!target.isDestroyed()) target.webContents.send(IPC.forgeStatusChanged, s)
    }
    if (s.kind === 'ready') {
      api.setBaseUrl(s.url)
      // Tune live-preview cadence for smoother progress display. Best-effort —
      // a failure here shouldn't block generation, just log it.
      api.configureLivePreviews().catch((e) => {
        console.warn('[forge] live-preview config failed:', e)
      })
    }
  })

  // Forge API passthrough ------------------------------------------------
  ipcMain.handle(IPC.forgeListModels, () => api.listModels())
  ipcMain.handle(IPC.forgeRefreshModels, () => api.refreshModels())
  ipcMain.handle(IPC.forgeListSamplers, () => api.listSamplers())
  ipcMain.handle(IPC.forgeListSchedulers, () => api.listSchedulers())
  // Forge ≥ f2 doesn't expose /sdapi/v1/loras, so we scan the filesystem
  // directly. Both list and refresh do the same thing — there's no caching to
  // bust on the Forge side, our scan is the source of truth.
  ipcMain.handle(IPC.forgeListLoras, () => scanLoras(storage.getSettings().forgePath))
  ipcMain.handle(IPC.forgeRefreshLoras, () => scanLoras(storage.getSettings().forgePath).then(() => undefined))

  // VAE list comes from Forge's /sdapi/v1/sd-vae (works) — and we always
  // prepend "Automatic" + "None" entries so the user can fall back to
  // checkpoint-built-in without leaving the dropdown.
  ipcMain.handle(IPC.forgeListVaes, () => api.listVaes())
  ipcMain.handle(IPC.forgeRefreshVaes, () => api.refreshVaes())

  // ControlNet model + preprocessor lists. Mounted by sd_forge_controlnet —
  // returns empty array on failure (e.g. extension hasn't loaded yet) so the
  // renderer can show an empty-state UI instead of crashing.
  ipcMain.handle(IPC.forgeListControlnetModels, () => api.listControlnetModels())
  ipcMain.handle(IPC.forgeListControlnetModules, () => api.listControlnetModules())
  ipcMain.handle(IPC.forgeControlnetDetect, (_e, rawReq: ControlNetDetectRequest) =>
    api.controlnetDetect(validateControlNetDetectRequest(rawReq))
  )

  // Upscale workspace — list + simple non-diffusion upscale via Forge's extras
  // single-image endpoint. Diffusion-based upscale uses the existing img2img
  // path with the multidiffusion alwayson_scripts entry.
  ipcMain.handle(IPC.forgeListUpscalers, () => api.listUpscalers())
  ipcMain.handle(IPC.forgeExtraSingleImage, async (_e, opts: Parameters<typeof api.extraSingleImage>[0]) => {
    return api.extraSingleImage(validateExtraSingleImageOptions(opts))
  })

  // Tools tab — local filesystem inspection (no Forge required).
  ipcMain.handle(IPC.toolsPickModelFile, async () => {
    const r = await dialog.showOpenDialog({
      title: 'Select model file',
      filters: [
        { name: 'Model files', extensions: ['safetensors', 'ckpt', 'pt', 'pth', 'vae'] },
        { name: 'All files', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (r.canceled || r.filePaths.length === 0) return null
    const picked = await assertExistingFile(
      r.filePaths[0],
      'model file',
      INSPECTABLE_MODEL_FILE_EXTS
    )
    userPickedModelFiles.add(picked)
    return picked
  })

  ipcMain.handle(IPC.toolsInspectModel, async (_e, filepath: string) => {
    const safePath = await assertExistingFile(filepath, 'model file', INSPECTABLE_MODEL_FILE_EXTS)
    const settings = storage.getSettings()
    const forgeModelsRoot = resolve(settings.forgePath, 'webui', 'models')
    if (!userPickedModelFiles.has(safePath) && !isSubpath(forgeModelsRoot, safePath)) {
      throw new Error('Model inspection requires a user-picked file or a Forge model file')
    }
    const inspected = await inspectSafetensors(safePath)
    let sizeBytes = 0
    try { sizeBytes = (await stat(safePath)).size } catch { /* ignore */ }
    return {
      filepath: safePath,
      sizeBytes,
      kind: inspected.kind,
      sampleKeys: inspected.sampleKeys,
      keyCount: inspected.sampleKeys.length, // best-effort; sampleKeys is up to 10
      metadata: inspected.metadata
    }
  })

  ipcMain.handle(IPC.toolsScanModelHealth, () => scanModelHealth(storage.getSettings().forgePath))
  ipcMain.handle(IPC.toolsListModelLibrary, () =>
    summarizeModelLibrary(storage.getSettings().forgePath, storage.listModelLibrary())
  )
  ipcMain.handle(IPC.toolsRescanModelLibrary, () =>
    scanModelLibrary(storage.getSettings().forgePath, storage)
  )
  ipcMain.handle(IPC.toolsListDownloadJobs, (): DownloadJob[] => storage.listDownloadJobs())
  ipcMain.handle(IPC.toolsCheckLibraryIntegrity, () => checkLibraryIntegrity(storage))
  ipcMain.handle(IPC.toolsHashModelLibraryEntry, (_e, id: string) => hashModelLibraryEntry(storage, id))
  ipcMain.handle(IPC.toolsRecoverModelLibrary, () => recoverModelLibrary(storage))
  ipcMain.handle(IPC.toolsConvertModelFormat, () => convertModelFormat(storage, win))
  ipcMain.handle(IPC.toolsInspectMergerSupport, () =>
    inspectMergerSupport(storage.getSettings().forgePath)
  )
  ipcMain.handle(IPC.toolsEstimateModelMerger, (_e, req) => estimateModelMerger(storage, req))
  ipcMain.handle(IPC.toolsRunModelMerger, (_e, req) => runModelMerger(storage, win, req))
  ipcMain.handle(IPC.toolsCancelModelMerger, () => cancelModelMerger(win))

  // Generation with progress streaming. Both txt2img and img2img share the
  // poller — only the API call differs.
  function pollProgressDuring<T>(operation: () => Promise<T>): Promise<T> {
    let stop = false
    const poll = async (): Promise<void> => {
      while (!stop) {
        try {
          const p = await api.progress()
          if (!win.isDestroyed()) win.webContents.send(IPC.forgeProgressUpdate, p)
        } catch { /* ignore individual poll failures */ }
        await new Promise((r) => setTimeout(r, 500))
      }
    }
    const poller = poll()
    return operation().finally(async () => {
      stop = true
      await poller
    })
  }

  ipcMain.handle(
    IPC.forgeTxt2Img,
    (_e, req: Txt2ImgRequest): Promise<Txt2ImgResponse> =>
      pollProgressDuring(() => api.txt2img(validateTxt2ImgRequest(req)))
  )
  ipcMain.handle(
    IPC.forgeImg2Img,
    (_e, req: Img2ImgRequest): Promise<Img2ImgResponse> =>
      pollProgressDuring(() => api.img2img(validateImg2ImgRequest(req)))
  )
  ipcMain.handle(
    IPC.forgeInterrogate,
    (_e, args: { image: string; model?: 'clip' | 'deepdanbooru' }) =>
      {
        const validated = validateInterrogateArgs(args)
        return api.interrogate(validated.image, validated.model)
      }
  )
  ipcMain.handle(IPC.forgeInterrupt, () => api.interrupt())

  // Model import — open file picker, copy/move .safetensors into Forge's models dir,
  // refresh the API model list. We always target the standard
  // <forgePath>/webui/models/Stable-diffusion path so Forge picks them up without
  // needing --ckpt-dir overrides.
  ipcMain.handle(
    IPC.forgeImportModels,
    async (_e, opts: { mode: 'copy' | 'move' }): Promise<ModelImportResult | null> => {
      const mode = validateImportMode(opts)
      const settings = storage.getSettings()
      const destDir = join(settings.forgePath, 'webui', 'models', 'Stable-diffusion')
      await mkdir(destDir, { recursive: true })

      const result = await dialog.showOpenDialog(win, {
        title: 'モデルファイルを選択',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Stable Diffusion モデル', extensions: ['safetensors', 'ckpt'] },
          { name: 'すべてのファイル', extensions: ['*'] }
        ]
      })
      if (result.canceled || result.filePaths.length === 0) return null

      const imported: ModelImportResult['imported'] = []
      const skipped: ModelImportResult['skipped'] = []

      for (const pickedSrc of result.filePaths) {
        const src = await assertExistingFile(
          pickedSrc,
          'checkpoint file',
          new Set(['.safetensors', '.ckpt'])
        ).catch((e) => {
          skipped.push({ source: pickedSrc, reason: (e as Error).message })
          return null
        })
        if (!src) continue
        const fname = basename(src)
        const dest = join(destDir, fname)
        if (existsSync(dest)) {
          skipped.push({ source: src, reason: '同名のファイルが既に存在します' })
          continue
        }
        const kindError = await validateImportKind(src, 'checkpoint')
        if (kindError) {
          skipped.push({ source: src, reason: kindError })
          continue
        }
        try {
          // copyFile is atomic on the destination side and works across drives.
          // We don't use rename() because Node throws EXDEV across volumes.
          await copyFile(src, dest)
          const s = await stat(dest)
          imported.push({ source: src, dest, sizeBytes: s.size })
          if (mode === 'move') {
            try {
              await unlink(src)
            } catch (e) {
              // Source removal failure is non-fatal — the file landed in dest.
              console.warn('[forge] failed to remove source after move:', e)
            }
          }
        } catch (e) {
          skipped.push({ source: src, reason: (e as Error).message })
        }
      }

      // Tell Forge to rescan the directory so the new files appear in /sdapi/v1/sd-models.
      try {
        await api.refreshModels()
      } catch (e) {
        console.warn('[forge] refreshModels after import failed:', e)
      }

      return { imported, skipped, destDir }
    }
  )

  ipcMain.handle(IPC.forgeOpenModelsFolder, async () => {
    const settings = storage.getSettings()
    const dir = join(settings.forgePath, 'webui', 'models', 'Stable-diffusion')
    await mkdir(dir, { recursive: true })
    shell.openPath(dir)
  })

  // LoRA equivalents — same flow as checkpoint import but pointed at the
  // Lora directory.
  ipcMain.handle(
    IPC.forgeImportLoras,
    async (_e, opts: { mode: 'copy' | 'move' }): Promise<ModelImportResult | null> => {
      const mode = validateImportMode(opts)
      const settings = storage.getSettings()
      const destDir = join(settings.forgePath, 'webui', 'models', 'Lora')
      await mkdir(destDir, { recursive: true })

      const result = await dialog.showOpenDialog(win, {
        title: 'LoRA ファイルを選択',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'LoRA', extensions: ['safetensors', 'pt', 'ckpt'] },
          { name: 'すべてのファイル', extensions: ['*'] }
        ]
      })
      if (result.canceled || result.filePaths.length === 0) return null

      const imported: ModelImportResult['imported'] = []
      const skipped: ModelImportResult['skipped'] = []

      for (const pickedSrc of result.filePaths) {
        const src = await assertExistingFile(
          pickedSrc,
          'LoRA file',
          new Set(['.safetensors', '.pt', '.ckpt'])
        ).catch((e) => {
          skipped.push({ source: pickedSrc, reason: (e as Error).message })
          return null
        })
        if (!src) continue
        const fname = basename(src)
        const dest = join(destDir, fname)
        if (existsSync(dest)) {
          skipped.push({ source: src, reason: '同名のファイルが既に存在します' })
          continue
        }
        const kindError = await validateImportKind(src, 'lora')
        if (kindError) {
          skipped.push({ source: src, reason: kindError })
          continue
        }
        try {
          await copyFile(src, dest)
          const s = await stat(dest)
          imported.push({ source: src, dest, sizeBytes: s.size })
          if (mode === 'move') {
            try {
              await unlink(src)
            } catch (e) {
              console.warn('[forge] failed to remove source after move:', e)
            }
          }
        } catch (e) {
          skipped.push({ source: src, reason: (e as Error).message })
        }
      }

      // No Forge-side cache to refresh — our filesystem scanner picks up new
      // files on the next listLoras() call.
      return { imported, skipped, destDir }
    }
  )

  ipcMain.handle(IPC.forgeOpenLorasFolder, async () => {
    const settings = storage.getSettings()
    const dir = join(settings.forgePath, 'webui', 'models', 'Lora')
    await mkdir(dir, { recursive: true })
    shell.openPath(dir)
  })

  // VAE import — same flow as LoRA, just a different destination directory.
  ipcMain.handle(
    IPC.forgeImportVaes,
    async (_e, opts: { mode: 'copy' | 'move' }) => {
      const mode = validateImportMode(opts)
      const settings = storage.getSettings()
      const destDir = join(settings.forgePath, 'webui', 'models', 'VAE')
      await mkdir(destDir, { recursive: true })
      const result = await dialog.showOpenDialog(win, {
        title: 'VAE ファイルを選択',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'VAE', extensions: ['safetensors', 'pt', 'ckpt', 'vae'] },
          { name: 'すべてのファイル', extensions: ['*'] }
        ]
      })
      if (result.canceled || result.filePaths.length === 0) return null

      const imported: { source: string; dest: string; sizeBytes: number }[] = []
      const skipped: { source: string; reason: string }[] = []
      for (const pickedSrc of result.filePaths) {
        const src = await assertExistingFile(
          pickedSrc,
          'VAE file',
          new Set(['.safetensors', '.pt', '.ckpt', '.vae'])
        ).catch((e) => {
          skipped.push({ source: pickedSrc, reason: (e as Error).message })
          return null
        })
        if (!src) continue
        const fname = basename(src)
        const dest = join(destDir, fname)
        if (existsSync(dest)) {
          skipped.push({ source: src, reason: '同名のファイルが既に存在します' })
          continue
        }
        const kindError = await validateImportKind(src, 'vae')
        if (kindError) {
          skipped.push({ source: src, reason: kindError })
          continue
        }
        try {
          await copyFile(src, dest)
          const s = await stat(dest)
          imported.push({ source: src, dest, sizeBytes: s.size })
          if (mode === 'move') {
            try { await unlink(src) } catch { /* non-fatal */ }
          }
        } catch (e) {
          skipped.push({ source: src, reason: (e as Error).message })
        }
      }
      try { await api.refreshVaes() } catch { /* swallow */ }
      return { imported, skipped, destDir }
    }
  )

  ipcMain.handle(IPC.forgeOpenVaesFolder, async () => {
    const settings = storage.getSettings()
    const dir = join(settings.forgePath, 'webui', 'models', 'VAE')
    await mkdir(dir, { recursive: true })
    shell.openPath(dir)
  })

  /**
   * Disable a Forge extension by renaming its directory from `<name>` to
   * `<name>.disabled`. Forge skips dot-suffixed dirs at startup. The change
   * takes effect on next Forge restart.
   *
   * Validates that the input doesn't contain path traversal (`..`, slashes) so
   * a malicious sender can't move arbitrary directories.
   */
  /**
   * Disable a Forge extension by adding it to `disabled_extensions` in
   * webui/config.json — Forge's canonical mechanism. The previous approach
   * (renaming the dir to `.disabled`) didn't actually disable anything;
   * Forge's extension scanner picks up dotted-suffix dirs the same as plain
   * ones and runs their broken scripts.
   *
   * Also: if a `<name>.disabled` directory exists from the old approach,
   * rename it back to the canonical name so Forge sees it under the right
   * key — and the disabled_extensions config entry takes effect.
   */
  ipcMain.handle(IPC.forgeDisableExtension, async (_e, rawName: string) => {
    if (!rawName) throw new Error('Invalid extension name')
    // Tolerate names captured from log lines that already have the
    // .disabled suffix from the old rename approach.
    const canonical = rawName.replace(/\.disabled$/i, '')
    if (/[\\/]|\.\./.test(canonical)) {
      throw new Error('Invalid extension name')
    }
    const settings = storage.getSettings()
    const extensionsDir = join(settings.forgePath, 'webui', 'extensions')
    const canonicalDir = join(extensionsDir, canonical)
    const disabledDir = `${canonicalDir}.disabled`

    // If a .disabled dir exists (from old logic) and the canonical name
    // doesn't, rename back so Forge picks it up under the right name and
    // can be properly disabled by config.
    const { rename } = await import('node:fs/promises')
    if (existsSync(disabledDir) && !existsSync(canonicalDir)) {
      await rename(disabledDir, canonicalDir)
    }

    if (!existsSync(canonicalDir)) {
      throw new Error(`拡張ディレクトリが見つかりません: ${canonical}`)
    }

    // Patch config.json's `disabled_extensions` array.
    const cfgPath = join(settings.forgePath, 'webui', 'config.json')
    let cfg: Record<string, unknown> = {}
    if (existsSync(cfgPath)) {
      try {
        cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
      } catch {
        cfg = {}
      }
    }
    const current = Array.isArray(cfg.disabled_extensions)
      ? (cfg.disabled_extensions as string[]).filter((s) => typeof s === 'string')
      : []
    if (!current.includes(canonical)) {
      current.push(canonical)
    }
    cfg.disabled_extensions = current
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 4))

    return { canonical, configPath: cfgPath }
  })

  // Civitai --------------------------------------------------------------
  ipcMain.handle(IPC.civitaiLookupByModel, async (_e, model: SdModel) => {
    const settings = storage.getSettings()
    // Prefer the SHA-256 Forge already computed; otherwise compute it ourselves.
    let sha = model.sha256
    if (!sha) {
      sha = await hashModelFile(model.filename)
    }
    const cached = storage.getCivitai(sha)
    if (cached) return cached
    const fetched = await fetchByHash(sha, settings.civitaiApiKey)
    if (fetched) storage.saveCivitai(sha, fetched)
    return fetched
  })

  ipcMain.handle(IPC.civitaiLookupLora, async (_e, lora: SdLora) => {
    const settings = storage.getSettings()
    const sha = await hashModelFile(lora.path)
    const cached = storage.getLoraCivitai(sha)
    if (cached) return cached
    const fetched = await fetchLoraByHash(sha, settings.civitaiApiKey)
    if (fetched) storage.saveLoraCivitai(sha, fetched)
    return fetched
  })

  ipcMain.handle(IPC.civitaiSearch, async (_e, opts: CivitaiSearchOptions) => {
    const settings = storage.getSettings()
    return searchCivitai(validateCivitaiSearchOptions(opts), settings.civitaiApiKey)
  })

  // In-flight download tracking — keyed by URL so the renderer can request
  // cancellation by URL (which is the only thing it has on hand).
  const inflightDownloads = new Map<string, AbortController>()

  async function cachePreviewIfAvailable(entryId: string, source: CivitaiDownloadRequest['source']): Promise<CivitaiDownloadRequest['source']> {
    if (!source?.thumbnailUrl) return source
    try {
      const res = await fetch(source.thumbnailUrl, {
        headers: { 'User-Agent': 'Yoitomoshi-Art-Generator/0.1' },
        signal: AbortSignal.timeout(10_000)
      })
      if (!res.ok) return source
      const bytes = Buffer.from(await res.arrayBuffer())
      if (bytes.length === 0 || bytes.length > 5 * 1024 * 1024) return source
      const contentType = res.headers.get('content-type') ?? ''
      const ext = contentType.includes('png') ? '.png' : contentType.includes('webp') ? '.webp' : '.jpg'
      const previewPath = storage.saveModelPreview(entryId, bytes, ext)
      return { ...source, previewPath }
    } catch {
      return source
    }
  }

  async function runManagedDownload(req: CivitaiDownloadRequest): Promise<{ destPath: string; sha256: string | null }> {
      const settings = storage.getSettings()
      const destDir = destDirForAssetType(settings.forgePath, req.assetType)
      if (!destDir) {
        throw new Error(`未対応の Civitai 型: ${req.assetType}`)
      }
      if (inflightDownloads.has(req.url)) {
        throw new Error('このダウンロードは既に実行中です')
      }
      const destPath = join(destDir, req.filename)
      const partialPath = `${destPath}.partial`
      const job = storage.createDownloadJob(req, destPath, partialPath)
      const controller = new AbortController()
      inflightDownloads.set(req.url, controller)
      try {
        const r = await downloadCivitaiFile(
          req,
          destDir,
          req.source?.provider === 'huggingface' ? null : settings.civitaiApiKey,
          (bytes, total) => {
            storage.updateDownloadJob(job.id, {
              status: 'running',
              bytesDownloaded: bytes,
              totalBytes: total
            })
            if (!win.isDestroyed()) {
              win.webContents.send(IPC.civitaiDownloadProgress, {
                url: req.url,
                bytesDownloaded: bytes,
                totalBytes: total,
                done: false
              })
            }
          },
          controller.signal
        )
        const downloadedSize = await stat(r.destPath).then((s) => s.size).catch(() => 0)
        const entryId = `${req.assetType}:${resolve(r.destPath).toLowerCase()}`
        const sourceMeta = await cachePreviewIfAvailable(entryId, req.source)
        storage.updateDownloadJob(job.id, {
          status: 'completed',
          bytesDownloaded: downloadedSize,
          totalBytes: downloadedSize,
          destPath: r.destPath,
          sha256: r.sha256,
          source: sourceMeta
        })
        const now = Date.now()
        storage.upsertModelLibraryEntry({
          id: entryId,
          name: basename(r.destPath),
          type: req.assetType,
          path: resolve(r.destPath),
          sizeBytes: downloadedSize,
          sha256: r.sha256,
          source: sourceMeta?.provider === 'huggingface' ? 'huggingface' : 'civitai',
          installedAt: now,
          lastSeenAt: now,
          lastModifiedAt: await stat(r.destPath).then((s) => s.mtimeMs).catch(() => null),
          sourceMeta,
          previewPath: sourceMeta?.previewPath ?? null,
          civitai: sourceMeta?.provider !== 'huggingface'
            ? {
                url: req.url,
                expectedSha256: req.expectedSha256
              }
            : undefined
        })
        if (!win.isDestroyed()) {
          win.webContents.send(IPC.civitaiDownloadProgress, {
            url: req.url,
            bytesDownloaded: downloadedSize,
            totalBytes: downloadedSize,
            done: true,
            destPath: r.destPath
          })
        }
        // Tell Forge to rescan if it was a checkpoint or VAE — refresh-loras
        // is unnecessary because our LoRA scanner runs on listLoras() each time.
        if (req.assetType === 'Checkpoint') {
          await api.refreshModels().catch(() => undefined)
        } else if (req.assetType === 'VAE') {
          await api.refreshVaes().catch(() => undefined)
        }
        return r
      } catch (e) {
        const message = (e as Error).message
        storage.updateDownloadJob(job.id, {
          status: controller.signal.aborted ? 'canceled' : 'failed',
          error: message
        })
        if (!win.isDestroyed()) {
          win.webContents.send(IPC.civitaiDownloadProgress, {
            url: req.url,
            bytesDownloaded: 0,
            totalBytes: 0,
            done: true,
            error: message
          })
        }
        throw e
      } finally {
        inflightDownloads.delete(req.url)
      }
    }

  ipcMain.handle(
    IPC.civitaiDownload,
    async (_e, rawReq: CivitaiDownloadRequest) => {
      return runManagedDownload(validateCivitaiDownloadRequest(rawReq))
    }
  )

  ipcMain.handle(IPC.huggingFaceSearch, async (_e, rawOpts: HuggingFaceSearchOptions) => {
    return searchHuggingFaceModels(validateHuggingFaceSearchOptions(rawOpts))
  })

  ipcMain.handle(
    IPC.huggingFaceDownload,
    async (_e, rawReq: CivitaiDownloadRequest) => {
      return runManagedDownload(validateHuggingFaceDownloadRequest(rawReq))
    }
  )

  ipcMain.handle(IPC.toolsResumeDownloadJob, async (_e, rawId: string) => {
    const id = validateDownloadJobId(rawId)
    const job = storage.getDownloadJob(id)
    if (!job) throw new Error('Download job not found')
    if (job.status === 'completed' && existsSync(job.destPath)) {
      throw new Error('Download job is already completed')
    }
    const provider = job.source?.provider === 'huggingface' ? 'huggingface' : 'civitai'
    const req = {
      url: job.url,
      filename: job.filename,
      assetType: job.assetType,
      expectedSha256: job.expectedSha256,
      source: job.source
    }
    return runManagedDownload(
      provider === 'huggingface'
        ? validateHuggingFaceDownloadRequest(req)
        : validateCivitaiDownloadRequest(req)
    )
  })

  ipcMain.handle(IPC.toolsDiscardDownloadJob, (_e, rawId: string) => {
    const id = validateDownloadJobId(rawId)
    return storage.deleteDownloadJob(id, { deletePartial: true })
  })

  ipcMain.handle(IPC.toolsOpenDownloadJobFolder, (_e, rawId: string) => {
    const id = validateDownloadJobId(rawId)
    const job = storage.getDownloadJob(id)
    if (!job) throw new Error('Download job not found')
    const target = existsSync(job.destPath) ? job.destPath : job.partialPath
    const settings = storage.getSettings()
    const expectedDir = destDirForAssetType(settings.forgePath, job.assetType)
    if (!expectedDir || !isSubpath(expectedDir, target)) {
      throw new Error('Download job path is outside the expected model folder')
    }
    if (!existsSync(target)) throw new Error('Download file is missing')
    shell.showItemInFolder(target)
  })

  ipcMain.handle(IPC.civitaiCancelDownload, (_e, url: string) => {
    const safeUrl = assertAllowedUrl(url, 'download URL', [...CIVITAI_DOWNLOAD_DOMAINS, ...HUGGING_FACE_DOWNLOAD_DOMAINS])
    inflightDownloads.get(safeUrl)?.abort()
  })

  ipcMain.handle(IPC.civitaiMineCommunity, async (_e, modelVersionId: number) => {
    if (!Number.isFinite(modelVersionId) || modelVersionId <= 0) return null
    const cached = storage.getCommunityStats(modelVersionId)
    if (cached) return cached
    const settings = storage.getSettings()
    const stats = await mineCheckpointSamples(modelVersionId, settings.civitaiApiKey)
    if (stats) storage.saveCommunityStats(stats)
    return stats
  })

  /**
   * Identify the checkpoint + LoRAs + VAE referenced by a parsed PNG metadata.
   * Cross-references each name/hash against Civitai so the user can jump to
   * the source page or download missing pieces in one click.
   *
   * Runs all lookups in parallel — typically 1 checkpoint + 0-5 LoRAs + 0-1
   * VAE = 2-7 Civitai requests, completes in ~1-3s for popular models.
   */
  ipcMain.handle(IPC.civitaiListTags, async (_e, opts?: { force?: boolean }) => {
    const cached = !opts?.force ? storage.getCachedTags() : null
    if (cached) return cached
    const settings = storage.getSettings()
    const tags = await listCivitaiTags(settings.civitaiApiKey, 80)
    storage.saveCachedTags(tags)
    return tags
  })

  ipcMain.handle(IPC.civitaiCheckUpdates, async (_e, opts?: { force?: boolean }) => {
    if (!opts?.force) {
      const cached = storage.getUpdateCheck()
      if (cached) return cached
    }
    const settings = storage.getSettings()
    const installed = storage.listAllCivitai().map((rec) => ({
      sha256: rec.sha256,
      modelId: rec.modelId,
      modelVersionId: rec.modelVersionId,
      modelName: rec.modelName,
      versionName: rec.versionName
    }))
    const updates = await checkForModelUpdates(installed, settings.civitaiApiKey)
    storage.saveUpdateCheck(updates)
    return { checkedAt: Date.now(), updates }
  })

  ipcMain.handle(
    IPC.civitaiIdentifyFromPng,
    async (
      _e,
      meta: {
        modelName: string | null
        modelHash: string | null
        loras: { name: string; weight: number }[]
        vae: string | null
      }
    ) => {
      const settings = storage.getSettings()
      const key = settings.civitaiApiKey

      const [checkpoint, vae, ...loraResults] = await Promise.all([
        identifyCheckpoint(meta.modelHash, meta.modelName, key),
        meta.vae ? identifyByName(meta.vae, 'VAE', key) : Promise.resolve(null),
        ...meta.loras.map((l) => identifyByName(l.name, 'LORA', key))
      ])

      return {
        checkpoint: {
          nameInMetadata: meta.modelName,
          hashInMetadata: meta.modelHash,
          civitai: checkpoint
        },
        loras: meta.loras.map((l, i) => ({
          nameInPrompt: l.name,
          weight: l.weight,
          civitai: loraResults[i] ?? null
        })),
        vae: {
          nameInMetadata: meta.vae,
          civitai: vae
        }
      }
    }
  )

  // Storage --------------------------------------------------------------
  ipcMain.handle(IPC.storageGetSettings, () => storage.getSettings())
  ipcMain.handle(IPC.storageSetSettings, async (_e, s) => {
    const safeSettings = await validateSettingsInput(s, storage.getSettings())
    storage.setSettings(safeSettings)
  })
  ipcMain.handle(IPC.storageListHistory, () => storage.listHistory())
  ipcMain.handle(IPC.storageAddHistory, (_e, args) => storage.addHistory(args))
  ipcMain.handle(IPC.storageReadHistoryImage, (_e, id: string) =>
    storage.readHistoryImageDataUrl(id)
  )
  ipcMain.handle(IPC.storageDeleteHistory, (_e, id) => storage.deleteHistory(id))
  ipcMain.handle(IPC.storageSetHistoryLabel, (_e, id: string, label: HistoryItem['label']) =>
    storage.setHistoryLabel(id, label ?? null)
  )
  ipcMain.handle(IPC.storageListPresets, () => storage.listPresets())
  ipcMain.handle(IPC.storageSavePreset, (_e, input) => storage.savePreset(input))
  ipcMain.handle(IPC.storageDeletePreset, (_e, id) => storage.deletePreset(id))
  ipcMain.handle(IPC.storageGetFavorites, () => storage.getFavorites())
  ipcMain.handle(IPC.storageSetFavorites, (_e, tags: string[]) => storage.setFavorites(tags))
  ipcMain.handle(IPC.storageListQuickPresets, () => storage.listQuickPresets())
  ipcMain.handle(IPC.storageSaveQuickPreset, (_e, input) => storage.saveQuickPreset(input))
  ipcMain.handle(IPC.storageDeleteQuickPreset, (_e, id: string) =>
    storage.deleteQuickPreset(id)
  )
  ipcMain.handle(IPC.storageGetLoraFavorites, () => storage.getLoraFavorites())
  ipcMain.handle(IPC.storageSetLoraFavorites, (_e, names: string[]) =>
    storage.setLoraFavorites(names)
  )
  ipcMain.handle(IPC.storageRecordLoraUsage, (_e, rec: LoraUsageRecord) => {
    storage.recordLoraUsage(rec)
  })
  ipcMain.handle(IPC.storageListLoraUsage, () => storage.listLoraUsage())
  ipcMain.handle(IPC.storageGetHiddenQuickPresets, () => storage.getHiddenQuickPresets())
  ipcMain.handle(IPC.storageSetHiddenQuickPresets, (_e, ids: string[]) =>
    storage.setHiddenQuickPresets(ids)
  )
  ipcMain.handle(IPC.storageListWorkspaces, () => storage.listWorkspaces())
  ipcMain.handle(IPC.storageSaveWorkspace, (_e, input) =>
    storage.saveWorkspace(validateWorkspaceSaveInput(input))
  )
  ipcMain.handle(IPC.storageLoadWorkspace, (_e, id: string) =>
    storage.loadWorkspace(validateWorkspaceId(id))
  )
  ipcMain.handle(IPC.storageDeleteWorkspace, (_e, id: string) =>
    storage.deleteWorkspace(validateWorkspaceId(id))
  )
  ipcMain.handle(IPC.storageResolveImageReference, (_e, ref: WorkspaceImageReference) =>
    resolveWorkspaceImageReference(storage, ref)
  )
  ipcMain.handle(IPC.storageSaveUpscaleComparison, (_e, input: UpscaleComparisonSaveRequest) =>
    storage.saveUpscaleComparison(validateUpscaleComparisonSaveRequest(input))
  )
  ipcMain.handle(IPC.storageSaveFabricFeedbackImage, (_e, imageDataUrl: string) =>
    saveFabricFeedbackImage(storage, imageDataUrl)
  )

  // Library --------------------------------------------------------------
  ipcMain.handle(IPC.libraryLoad, () => ({
    categories: library.categories,
    autocomplete: Array.from(library.autocompleteIndex.entries())
  }))
  ipcMain.handle(IPC.libraryGetCustom, () => storage.getCustomLibrary())
  ipcMain.handle(IPC.librarySaveCustom, (_e, cats) => storage.saveCustomLibrary(cats))

  // Misc -----------------------------------------------------------------
  ipcMain.handle(IPC.appStartupMetrics, () => ({ ...startupMetrics }))
  ipcMain.handle(IPC.appStartupMetricSamples, () => storage.listStartupMetricsSamples())

  ipcMain.handle(IPC.openExternal, (_e, url: string) => {
    return shell.openExternal(assertAllowedUrl(url, 'external URL', EXTERNAL_LINK_DOMAINS))
  })

  // Defensive: shell.showItemInFolder bubbles up an opaque OS dialog when the
  // path doesn't exist. Stat the path first and fall back to the parent dir.
  ipcMain.handle(IPC.showItemInFolder, async (_e, p: string) => {
    const target = assertAbsolutePath(p, 'item path')
    const historyRoot = resolve(storage.getDataRoot(), 'history')
    const outputDir = storage.getSettings().outputDir
    const allowedRoots = [
      historyRoot,
      ...(outputDir ? [outputDir] : [])
    ]
    if (!allowedRoots.some((root) => isSubpath(root, target))) {
      throw new Error('Path is outside allowed app output folders')
    }
    if (existsSync(target)) {
      shell.showItemInFolder(target)
      return
    }
    const parent = dirname(target)
    if (existsSync(parent)) {
      const r = await shell.openPath(parent)
      if (r) throw new Error(r)
      return
    }
    throw new Error(`ファイルが見つかりません: ${p}`)
  })
  ipcMain.handle(IPC.selectDirectory, async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
}
