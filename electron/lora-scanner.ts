import { readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, parse } from 'node:path'
import type { SdLora } from '../src/shared/types.js'
import { inspectSafetensors } from './safetensors-inspect.js'

const LORA_EXTS = new Set(['.safetensors', '.pt', '.ckpt'])

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
  const root = join(forgePath, 'webui', 'models', 'Lora')
  if (!existsSync(root)) return []
  const out: SdLora[] = []
  await walk(root, '', out)
  out.sort((a, b) => a.alias.localeCompare(b.alias))
  return out
}

async function walk(absRoot: string, relPrefix: string, out: SdLora[]): Promise<void> {
  const entries = await readdir(join(absRoot, relPrefix), { withFileTypes: true })
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const rel = relPrefix ? `${relPrefix}/${e.name}` : e.name
    const abs = join(absRoot, rel)
    if (e.isDirectory()) {
      await walk(absRoot, rel, out)
      continue
    }
    if (!e.isFile()) continue
    const parsed = parse(e.name)
    const ext = parsed.ext.toLowerCase()
    if (!LORA_EXTS.has(ext)) continue

    // Sanity check: validate the file is actually a LoRA, not a misplaced
    // checkpoint / VAE / etc. Only enforces on .safetensors (we can't cheaply
    // inspect raw .pt / .ckpt headers — those pass through with a warning).
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
    }

    // Forge's <lora:NAME> uses path relative to the Lora root, sans extension
    const name = (relPrefix ? `${relPrefix}/${parsed.name}` : parsed.name)
    let sizeBytes = 0
    try {
      sizeBytes = (await stat(abs)).size
    } catch { /* ignore — unreadable file shows up with size 0 */ }
    out.push({
      name,
      alias: parsed.name,
      path: abs,
      metadata: { sizeBytes }
    })
  }
}
