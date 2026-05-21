import { open } from 'node:fs/promises'
import type { AdapterSubtype } from '../src/shared/types.js'

export type ModelKind =
  | 'lora'
  | 'checkpoint'
  | 'vae'
  | 'embedding'
  | 'controlnet'
  | 'tagger'
  | 'text_encoder'
  | 'unsupported_diffusion'
  | 'unknown'

export interface InspectedModel {
  kind: ModelKind
  adapterSubtype?: AdapterSubtype
  /** First 10 tensor keys — useful for diagnostic display when classification fails. */
  sampleKeys: string[]
  metadata: Record<string, string> | null
}

const MAX_HEADER_BYTES = 100 * 1024 * 1024 // 100 MB sanity cap

/**
 * Identify what a `.safetensors` file actually is by reading its JSON header.
 *
 * safetensors layout:
 *   bytes 0..7      uint64 little-endian   header length N
 *   bytes 8..8+N-1  UTF-8 JSON             { tensorName: { dtype, shape, ... }, __metadata__: {...} }
 *   bytes 8+N..     binary tensor data
 *
 * We only need the header — the keys alone tell us whether this is a LoRA,
 * a full checkpoint, a VAE, etc. Reading is O(header size) ≈ a few hundred KB
 * regardless of file size, so even multi-GB checkpoints classify in <100ms.
 *
 * Returns 'unknown' (rather than throwing) when the file isn't well-formed
 * safetensors so callers can gracefully fall through to size/extension heuristics.
 */
export async function inspectSafetensors(filepath: string): Promise<InspectedModel> {
  let fh: Awaited<ReturnType<typeof open>> | null = null
  try {
    fh = await open(filepath, 'r')
    const lenBuf = Buffer.alloc(8)
    const r = await fh.read(lenBuf, 0, 8, 0)
    if (r.bytesRead < 8) return unknownResult()
    const headerLen = Number(lenBuf.readBigUInt64LE(0))
    if (!Number.isFinite(headerLen) || headerLen <= 0 || headerLen > MAX_HEADER_BYTES) {
      return unknownResult()
    }
    const jsonBuf = Buffer.alloc(headerLen)
    await fh.read(jsonBuf, 0, headerLen, 8)
    const header = JSON.parse(jsonBuf.toString('utf8')) as Record<string, unknown>
    const keys = Object.keys(header).filter((k) => k !== '__metadata__')
    const metadata = (header['__metadata__'] as Record<string, string>) ?? null
    const kind = classify(keys, metadata)
    return {
      kind,
      adapterSubtype: kind === 'lora' ? inferAdapterSubtype(keys, metadata) : undefined,
      sampleKeys: keys.slice(0, 10),
      metadata
    }
  } catch {
    return unknownResult()
  } finally {
    if (fh) await fh.close().catch(() => undefined)
  }
}

function unknownResult(): InspectedModel {
  return { kind: 'unknown', sampleKeys: [], metadata: null }
}

/**
 * Map tensor keys + metadata to a model kind.
 *
 * Signatures (in observed order of confidence):
 *
 *   LoRA          keys named `lora_unet_*`, `lora_te[12]_*`, or contain `.lora_down.` /
 *                 `.lora_up.` / `.lora_A.` / `.lora_B.` (kohya_ss + diffusers conventions)
 *   Checkpoint    keys under `model.diffusion_model.*`, `cond_stage_model.*`,
 *                 `conditioner.*` (SDXL), `first_stage_model.*` (the embedded VAE)
 *   ControlNet    keys under `control_model.*`
 *   VAE-only      ALL keys under `encoder.*` / `decoder.*` / `quant_conv.*` —
 *                 with NO `model.diffusion_model` keys (those would mean it's
 *                 a checkpoint that includes a VAE)
 *   Text encoder  keys under `text_model.*` only (CLIP/T5 standalone)
 *   Embedding     `string_to_param` key, or single-key file with `emb_params`
 *
 * The `__metadata__` field is consulted for kohya_ss training tags
 * (`ss_network_module`) which are an additional unambiguous LoRA signal.
 */
function classify(
  keys: string[],
  metadata: Record<string, string> | null
): ModelKind {
  if (keys.length === 0) return 'unknown'

  // kohya_ss embeds explicit network type — strongest LoRA signal when present.
  if (metadata && typeof metadata.ss_network_module === 'string') {
    if (/lora|locon|loha|lokr|lycoris/i.test(metadata.ss_network_module)) {
      return 'lora'
    }
  }

  let lora = 0
  let checkpoint = 0
  let controlnet = 0
  let vaeOnly = 0
  let textEnc = 0
  let embeddingHits = 0
  let animaLike = 0
  let transformerLike = 0

  for (const k of keys) {
    if (/^lora_(unet|te[12]?)/i.test(k) ||
        /\.(lora_down|lora_up|lora_A|lora_B|lora_mid|alpha)\b/i.test(k)) {
      lora++
    } else if (/^(model\.diffusion_model|cond_stage_model|conditioner)\./i.test(k)) {
      checkpoint++
    } else if (/^(control_model\.|controlnet_)/i.test(k)) {
      controlnet++
    } else if (/^(first_stage_model|encoder|decoder|quant_conv|post_quant_conv)\./i.test(k)) {
      vaeOnly++
    } else if (/^text_model\./i.test(k)) {
      textEnc++
    } else if (k === 'string_to_param' || /^emb_params/.test(k)) {
      embeddingHits++
    } else if (/^net\.(blocks|llm_adapter)\./i.test(k)) {
      animaLike++
    } else if (/^(double_blocks|single_blocks|transformer_blocks|img_in|txt_in|time_in|vector_in|final_layer)\./i.test(k)) {
      transformerLike++
    }
  }

  const total = keys.length

  // Order: most distinctive signals first. LoRAs typically have hundreds of
  // matching keys (one per layer × down/up); a 40% threshold is safe.
  if (lora / total > 0.4) return 'lora'

  // Checkpoints embed a VAE so they have BOTH diffusion_model.* and first_stage_model.*
  // keys. Distinguish by checking whether diffusion_model is present at all.
  if (checkpoint / total > 0.2) return 'checkpoint'

  // Anima/Flux-style DiT files are full generators, but not A1111/Forge
  // Stable Diffusion checkpoints.
  if ((animaLike / total > 0.2 && keys.some((k) => /^net\.llm_adapter\./i.test(k))) ||
      transformerLike / total > 0.2) {
    return 'unsupported_diffusion'
  }

  if (controlnet / total > 0.2 || (controlnet > 0 && checkpoint === 0)) return 'controlnet'

  // Pure VAE: nothing but encoder/decoder/quant.
  if (vaeOnly > 0 && checkpoint === 0 && controlnet === 0 && lora === 0) return 'vae'

  // Pure text encoder file (Flux / SD3 use these as separate modules).
  if (textEnc > 0 && checkpoint === 0 && lora === 0) return 'text_encoder'

  // Textual inversion files are tiny — usually 1-3 keys total.
  if (embeddingHits > 0 && total < 20) return 'embedding'

  return 'unknown'
}

export function inferAdapterSubtype(
  keys: string[],
  metadata: Record<string, string> | null
): AdapterSubtype {
  const network = metadata?.ss_network_module ?? ''
  const algo = metadata?.ss_network_args ?? ''
  const metaHaystack = `${network} ${algo}`.toLowerCase()
  const keyHaystack = keys.slice(0, 2000).join('\n').toLowerCase()

  if (/dora/.test(metaHaystack) || /dora_scale/.test(keyHaystack)) return 'DoRA'
  if (/glora/.test(metaHaystack) || /glora/.test(keyHaystack)) return 'GLoRA'
  if (/boft/.test(metaHaystack) || /\bboft\b|\.boft_|_boft_/.test(keyHaystack)) return 'BOFT'
  if (/lokr/.test(metaHaystack) || /\blokr\b|\.lokr_|_lokr_/.test(keyHaystack)) return 'LoKr'
  if (/loha/.test(metaHaystack) || /\bhada\b|\.hada_|_hada_/.test(keyHaystack)) return 'LoHa'
  if (/locon/.test(metaHaystack) || /lora_mid/.test(keyHaystack)) return 'LoCon'
  if (/lycoris/.test(metaHaystack)) return 'LyCORIS'
  if (/lora/.test(metaHaystack) || /lora_(unet|te[12]?)/i.test(keyHaystack)) return 'LoRA'
  return 'Unknown'
}

/** Japanese label for diagnostic toasts. */
export function describeKind(kind: ModelKind): string {
  switch (kind) {
    case 'lora': return 'LoRA'
    case 'checkpoint': return 'チェックポイント (本体モデル)'
    case 'vae': return 'VAE'
    case 'controlnet': return 'ControlNet'
    case 'tagger': return 'Tagger'
    case 'embedding': return 'Textual Inversion (Embedding)'
    case 'text_encoder': return 'テキストエンコーダ'
    case 'unsupported_diffusion': return 'Stable Diffusion非対応の拡散モデル'
    case 'unknown': return '不明な形式'
  }
}
