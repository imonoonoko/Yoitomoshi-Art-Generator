import { readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, parse } from 'node:path'
import type { AdapterSourceRoot, AdapterSubtype, SdLora } from '../src/shared/types.js'
import { inspectSafetensors } from './safetensors-inspect.js'

const LORA_EXTS = new Set(['.safetensors', '.pt', '.ckpt'])
const ADAPTER_ROOTS: AdapterSourceRoot[] = ['Lora', 'LyCORIS']

/**
 * Filesystem scan of `<forgePath>/webui/models/Lora` (recursive). Returns one
 * entry per loadable LoRA file.
 *
 * Forge — unlike modern A1111 — doesn't expose `/sdapi/v1/loras`, so we read
 * the directory ourselves. Result fields mimic what the API would have
 * returned so the rest of the app doesn't have to care about the source.
 *
 * The "name" is what Forge expects in `<lora:name:weight>` syntax: the file's
 * basename relative to the Lora root, without extension. So
 *   models/Lora/character/mychar_v3.safetensors
 * becomes
 *   { name: "character/mychar_v3", alias: "mychar_v3", path: "...full..." }
 *
 * Forge accepts both forward-slash and backslash separators in <lora:>.
 */
export async function scanLoras(forgePath: string): Promise<SdLora[]> {
  const candidates: ScannedAdapter[] = []
  for (const sourceRoot of ADAPTER_ROOTS) {
    const root = join(forgePath, 'webui', 'models', sourceRoot)
    if (!existsSync(root)) continue
    await walk(root, '', sourceRoot, candidates)
  }
  const tokenCounts = new Map<string, number>()
  for (const item of candidates) {
    tokenCounts.set(item.tokenName.toLowerCase(), (tokenCounts.get(item.tokenName.toLowerCase()) ?? 0) + 1)
  }
  const out = candidates.map((item): SdLora => {
    const collides = (tokenCounts.get(item.tokenName.toLowerCase()) ?? 0) > 1
    return {
      name: collides ? `${item.sourceRoot}/${item.tokenName}` : item.tokenName,
      tokenName: item.tokenName,
      alias: item.alias,
      path: item.path,
      sourceRoot: item.sourceRoot,
      adapterSubtype: item.adapterSubtype,
      baseModelHint: item.baseModelHint,
      metadata: item.metadata
    }
  })
  out.sort((a, b) => a.alias.localeCompare(b.alias))
  return out
}

interface ScannedAdapter {
  tokenName: string
  alias: string
  path: string
  sourceRoot: AdapterSourceRoot
  adapterSubtype: AdapterSubtype
  baseModelHint: string | null
  metadata: Record<string, unknown>
}

async function walk(
  absRoot: string,
  relPrefix: string,
  sourceRoot: AdapterSourceRoot,
  out: ScannedAdapter[]
): Promise<void> {
  const entries = await readdir(join(absRoot, relPrefix), { withFileTypes: true })
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const rel = relPrefix ? `${relPrefix}/${e.name}` : e.name
    const abs = join(absRoot, rel)
    if (e.isDirectory()) {
      await walk(absRoot, rel, sourceRoot, out)
      continue
    }
    if (!e.isFile()) continue
    const parsed = parse(e.name)
    const ext = parsed.ext.toLowerCase()
    if (!LORA_EXTS.has(ext)) continue

    // Sanity check: validate the file is actually a LoRA, not a misplaced
    // checkpoint / VAE / etc. Only enforces on .safetensors (we can't cheaply
    // inspect raw .pt / .ckpt headers — those pass through with a warning).
    let embeddedMetadata: Record<string, string> | null = null
    let adapterSubtype: AdapterSubtype = sourceRoot === 'LyCORIS' ? 'LyCORIS' : 'Unknown'
    let baseModelHint: string | null = null
    if (ext === '.safetensors') {
      const info = await inspectSafetensors(abs).catch(() => null)
      if (info && info.kind !== 'lora' && info.kind !== 'unknown') {
        // Misplaced — skip it. The import flow validates upfront so new files
        // never reach here, but pre-existing files (manually copied or
        // imported before this validation existed) still need filtering.
        console.warn(
          `[lora-scanner] skipping ${rel}: detected as ${info.kind}, not a LoRA`
        )
        continue
      }
      embeddedMetadata = info?.metadata ?? null
      adapterSubtype = info?.adapterSubtype ?? adapterSubtype
      baseModelHint = inferBaseModelHint(embeddedMetadata)
    }

    // Forge's <lora:NAME> uses path relative to the Lora root, sans extension
    const tokenName = (relPrefix ? `${relPrefix}/${parsed.name}` : parsed.name)
    let sizeBytes = 0
    try {
      sizeBytes = (await stat(abs)).size
    } catch { /* ignore — unreadable file shows up with size 0 */ }
    out.push({
      tokenName,
      alias: parsed.name,
      path: abs,
      sourceRoot,
      adapterSubtype,
      baseModelHint,
      metadata: {
        ...pickAdapterMetadata(embeddedMetadata),
        sizeBytes,
        sourceRoot,
        adapterSubtype,
        tokenName,
        ...(baseModelHint ? { baseModelHint } : {})
      }
    })
  }
}

function pickAdapterMetadata(metadata: Record<string, string> | null): Record<string, string> {
  if (!metadata) return {}
  const keys = [
    'ss_network_module',
    'ss_base_model_version',
    'ss_sd_model_name',
    'ss_sd_model_hash',
    'ss_output_name'
  ]
  const out: Record<string, string> = {}
  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === 'string' && value.length <= 500) out[key] = value
  }
  return out
}

function inferBaseModelHint(metadata: Record<string, string> | null): string | null {
  if (!metadata) return null
  const raw =
    metadata.ss_base_model_version ||
    metadata.ss_sd_model_name ||
    metadata.ss_sd_model_hash ||
    metadata.base_model ||
    ''
  if (/sdxl|pony|illustrious|animagine|noobai/i.test(raw)) return 'SDXL'
  if (/sd\s*1\.5|sd1\.5|sd15|v1-?5/i.test(raw)) return 'SD 1.5'
  if (/flux/i.test(raw)) return 'FLUX'
  return null
}
