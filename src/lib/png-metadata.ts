/**
 * Extract A1111/Forge "parameters" metadata from a generated image file.
 *
 * Despite the historical name (png-metadata), this now handles three formats:
 *
 *   - PNG  → tEXt/iTXt chunk with keyword "parameters"
 *   - JPEG → APP1 (EXIF) segment, UserComment tag (0x9286)
 *   - WebP → EXIF chunk in the RIFF container, same UserComment lookup
 *
 * JPEG/WebP support matters because most image-sharing CDNs (aipictors,
 * Twitter, Discord previews, …) re-encode uploads to JPEG/WebP, stripping
 * the original PNG but often preserving EXIF.
 *
 * The parameters string format is the same across formats — A1111-style:
 *
 *     <prompt - possibly multi-line>
 *     Negative prompt: <negative - single line>
 *     Steps: 25, Sampler: DPM++ 2M Karras, CFG scale: 7, Seed: 1234, ...
 */
import { parseAdapterTokens } from './adapter-tokens'

export interface ParsedPngMetadata {
  prompt: string
  negativePrompt: string
  steps: number | null
  cfgScale: number | null
  width: number | null
  height: number | null
  sampler: string | null
  seed: number | null
  model: string | null
  /** A1111-style 10-char short hash (AutoV2) or full SHA-256 — Civitai accepts both. */
  modelHash: string | null
  /** VAE filename if present in the metadata. */
  vae: string | null
  clipSkip: number | null
  /** All managed adapter references (`<lora:...>` and legacy `<lyco:...>`) found in the prompt. */
  loras: { name: string; weight: number; legacyKind?: 'lora' | 'lyco' }[]
  raw: string
}

/**
 * Diagnostic about *what* the image contains — used by the UI when extraction
 * fails to give the user a meaningful error rather than a generic "not found".
 *
 * Field naming is kept on `Png*` for backward compatibility, but reports apply
 * across all supported formats now.
 */
export interface PngInspection {
  format: 'png' | 'jpeg' | 'webp' | 'unknown'
  hasPngSignature: boolean
  /** PNG: all tEXt/iTXt keyword strings found, in chunk order. */
  keywords: string[]
  /** PNG: "parameters" chunk content if present (A1111 / Forge convention). */
  parameters: string | null
  /** JPEG/WebP: an EXIF blob was located. */
  hasExif: boolean
  /** JPEG/WebP: the EXIF blob contained a UserComment. */
  hasUserComment: boolean
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export async function extractPngMetadata(file: File): Promise<ParsedPngMetadata | null> {
  const buf = new Uint8Array(await file.arrayBuffer())
  const params = findParametersInAnyFormat(buf)
  if (!params) return null
  return parseParametersString(params)
}

/**
 * Best-effort dispatch: detect format by magic bytes and route to the right
 * extractor. Returns the raw parameters string (untouched) so the caller can
 * pass it to `parseParametersString`.
 */
function findParametersInAnyFormat(buf: Uint8Array): string | null {
  if (hasPngSignature(buf)) return findPngParametersChunk(buf)
  if (hasJpegSignature(buf)) return findJpegParameters(buf)
  if (hasWebpSignature(buf)) return findWebpParameters(buf)
  return null
}

export async function inspectPngChunks(file: File): Promise<PngInspection> {
  const buf = new Uint8Array(await file.arrayBuffer())
  const result: PngInspection = {
    format: 'unknown',
    hasPngSignature: false,
    keywords: [],
    parameters: null,
    hasExif: false,
    hasUserComment: false
  }

  if (hasPngSignature(buf)) {
    result.format = 'png'
    result.hasPngSignature = true
    inspectPngChunksInternal(buf, result)
  } else if (hasJpegSignature(buf)) {
    result.format = 'jpeg'
    inspectExifContainer(findJpegExifBlob(buf), result)
  } else if (hasWebpSignature(buf)) {
    result.format = 'webp'
    inspectExifContainer(findWebpExifBlob(buf), result)
  }
  return result
}

// =========================================================================
//  PNG (tEXt / iTXt)
// =========================================================================

function hasPngSignature(buf: Uint8Array): boolean {
  if (buf.length < 8) return false
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== PNG_SIGNATURE[i]) return false
  }
  return true
}

function findPngParametersChunk(buf: Uint8Array): string | null {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let offset = 8

  while (offset + 8 < buf.length) {
    const length = view.getUint32(offset, false)
    const type = String.fromCharCode(buf[offset + 4], buf[offset + 5], buf[offset + 6], buf[offset + 7])
    const dataStart = offset + 8
    const dataEnd = dataStart + length

    if (type === 'tEXt') {
      const text = decodeTextChunk(buf.subarray(dataStart, dataEnd))
      if (text && text.keyword === 'parameters') return text.value
    } else if (type === 'iTXt') {
      const text = decodeITxtChunk(buf.subarray(dataStart, dataEnd))
      if (text && text.keyword === 'parameters') return text.value
    } else if (type === 'IEND') {
      return null
    }

    offset = dataEnd + 4
  }
  return null
}

function inspectPngChunksInternal(buf: Uint8Array, out: PngInspection): void {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let offset = 8
  while (offset + 8 < buf.length) {
    const length = view.getUint32(offset, false)
    const type = String.fromCharCode(buf[offset + 4], buf[offset + 5], buf[offset + 6], buf[offset + 7])
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (type === 'tEXt' || type === 'iTXt') {
      const decoded = type === 'tEXt'
        ? decodeTextChunk(buf.subarray(dataStart, dataEnd))
        : decodeITxtChunk(buf.subarray(dataStart, dataEnd))
      if (decoded) {
        out.keywords.push(decoded.keyword)
        if (decoded.keyword === 'parameters') out.parameters = decoded.value
      }
    } else if (type === 'IEND') {
      break
    }
    offset = dataEnd + 4
  }
}

function decodeTextChunk(data: Uint8Array): { keyword: string; value: string } | null {
  const sep = data.indexOf(0)
  if (sep < 0) return null
  return {
    keyword: bytesToString(data.subarray(0, sep)),
    value: bytesToString(data.subarray(sep + 1))
  }
}

function decodeITxtChunk(data: Uint8Array): { keyword: string; value: string } | null {
  const k1 = data.indexOf(0)
  if (k1 < 0) return null
  const keyword = bytesToString(data.subarray(0, k1))
  const compFlag = data[k1 + 1]
  if (compFlag !== 0) return null
  let p = k1 + 1 + 2
  const lang2 = data.indexOf(0, p)
  if (lang2 < 0) return null
  p = lang2 + 1
  const trans3 = data.indexOf(0, p)
  if (trans3 < 0) return null
  return {
    keyword,
    value: new TextDecoder('utf-8').decode(data.subarray(trans3 + 1))
  }
}

function bytesToString(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return s
}

// =========================================================================
//  JPEG (APP1 / EXIF)
// =========================================================================

function hasJpegSignature(buf: Uint8Array): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
}

/**
 * Locate the EXIF blob inside a JPEG file by walking APP segments. JPEG
 * APP1 may also hold XMP, so we must verify the "Exif\0\0" prefix.
 */
function findJpegExifBlob(buf: Uint8Array): Uint8Array | null {
  let offset = 2 // skip SOI (FF D8)
  while (offset + 4 < buf.length) {
    if (buf[offset] !== 0xff) return null
    const marker = buf[offset + 1]
    // Standalone markers (no length): RST0..7, SOI, EOI, TEM. Skip them
    // safely; the only one we'd encounter mid-stream is EOI which means stop.
    if (marker === 0xd9) return null // EOI
    if (marker === 0xda) return null // SOS — image data follows; no more APP markers
    const segLen = (buf[offset + 2] << 8) | buf[offset + 3]
    if (segLen < 2 || offset + 2 + segLen > buf.length) return null
    if (marker === 0xe1) {
      const dataStart = offset + 4
      // "Exif\0\0" prefix?
      if (
        dataStart + 6 <= buf.length &&
        buf[dataStart] === 0x45 && buf[dataStart + 1] === 0x78 &&
        buf[dataStart + 2] === 0x69 && buf[dataStart + 3] === 0x66 &&
        buf[dataStart + 4] === 0x00 && buf[dataStart + 5] === 0x00
      ) {
        return buf.subarray(dataStart + 6, offset + 2 + segLen)
      }
    }
    offset += 2 + segLen
  }
  return null
}

function findJpegParameters(buf: Uint8Array): string | null {
  const exif = findJpegExifBlob(buf)
  if (!exif) return null
  return readExifUserComment(exif)
}

// =========================================================================
//  WebP (RIFF / EXIF chunk)
// =========================================================================

function hasWebpSignature(buf: Uint8Array): boolean {
  return (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && // RIFF
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50  // WEBP
  )
}

function findWebpExifBlob(buf: Uint8Array): Uint8Array | null {
  // RIFF (12-byte header: "RIFF" + size + "WEBP") followed by chunks.
  // Each chunk: 4-byte FourCC + 4-byte little-endian size + data + optional pad byte.
  let offset = 12
  while (offset + 8 < buf.length) {
    const fourcc = String.fromCharCode(
      buf[offset], buf[offset + 1], buf[offset + 2], buf[offset + 3]
    )
    const size =
      buf[offset + 4] |
      (buf[offset + 5] << 8) |
      (buf[offset + 6] << 16) |
      (buf[offset + 7] << 24)
    if (size < 0 || offset + 8 + size > buf.length) break
    if (fourcc === 'EXIF') {
      return buf.subarray(offset + 8, offset + 8 + size)
    }
    offset += 8 + size + (size & 1)
  }
  return null
}

function findWebpParameters(buf: Uint8Array): string | null {
  const exif = findWebpExifBlob(buf)
  if (!exif) return null
  return readExifUserComment(exif)
}

// =========================================================================
//  EXIF UserComment (shared by JPEG + WebP)
// =========================================================================

interface ExifReader {
  buf: Uint8Array
  little: boolean
}

/**
 * Parse a TIFF/EXIF blob, walk into Exif IFD, and return the UserComment value
 * with its charset header decoded. A1111 writes UserComment as
 * `UNICODE\0<utf-16-le bytes>`; piexif's other charsets (ASCII / JIS) are
 * supported as well so we can read images written by adjacent tooling.
 */
function readExifUserComment(blob: Uint8Array): string | null {
  if (blob.length < 8) return null
  const little = blob[0] === 0x49 && blob[1] === 0x49 // II = little
  const big = blob[0] === 0x4d && blob[1] === 0x4d // MM = big
  if (!little && !big) return null
  const reader: ExifReader = { buf: blob, little }
  const magic = readUint16(reader, 2)
  if (magic !== 0x002a) return null

  const ifd0Offset = readUint32(reader, 4)
  const exifIfd = findIfdEntry(reader, ifd0Offset, 0x8769)
  if (!exifIfd) return null
  // Exif IFD pointer is itself a uint32 stored in the IFD entry's value slot.
  const userComment = findIfdEntry(reader, exifIfd.value, 0x9286)
  if (!userComment) return null

  // UserComment data: type 7 (UNDEFINED), count = byte length. If <= 4 bytes
  // it lives inline in the entry's value slot; otherwise it's at `value` offset.
  let dataStart: number
  if (userComment.count <= 4) {
    // Rare for parameters strings (always > 4 bytes), but handle for completeness.
    return null
  } else {
    dataStart = userComment.value
  }
  if (dataStart + userComment.count > blob.length) return null
  const allBytes = blob.subarray(dataStart, dataStart + userComment.count)
  if (allBytes.length < 8) return null

  const charsetHeader = bytesToString(allBytes.subarray(0, 8))
  const dataBytes = allBytes.subarray(8)

  if (charsetHeader.startsWith('UNICODE')) {
    // piexif uses UTF-16 LE regardless of TIFF byte order, but be permissive
    // and try the alternative if the LE decode produces NULs in alarming density.
    const le = new TextDecoder('utf-16le').decode(dataBytes).replace(/\0+$/, '')
    if (looksReasonable(le)) return le
    return new TextDecoder('utf-16be').decode(dataBytes).replace(/\0+$/, '')
  }
  if (charsetHeader.startsWith('ASCII')) {
    return new TextDecoder('latin1').decode(dataBytes).replace(/\0+$/, '')
  }
  // Empty (8 zero bytes) or unknown — try UTF-8 as a last resort.
  return new TextDecoder('utf-8').decode(dataBytes).replace(/\0+$/, '')
}

function looksReasonable(s: string): boolean {
  // Heuristic: at least 80% printable / common-CJK characters. Catches
  // obvious wrong-endian decodes which produce mostly U+xxxx replacement runs.
  if (s.length === 0) return false
  let printable = 0
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    if (c >= 0x20 || c === 0x0a || c === 0x0d) printable++
  }
  return printable / s.length > 0.8
}

function readUint16(r: ExifReader, off: number): number {
  return r.little
    ? r.buf[off] | (r.buf[off + 1] << 8)
    : (r.buf[off] << 8) | r.buf[off + 1]
}

function readUint32(r: ExifReader, off: number): number {
  return r.little
    ? r.buf[off] | (r.buf[off + 1] << 8) | (r.buf[off + 2] << 16) | (r.buf[off + 3] << 24)
    : (r.buf[off] << 24) | (r.buf[off + 1] << 16) | (r.buf[off + 2] << 8) | r.buf[off + 3]
}

function findIfdEntry(
  r: ExifReader,
  ifdOffset: number,
  tag: number
): { type: number; count: number; value: number } | null {
  if (ifdOffset + 2 > r.buf.length) return null
  const numEntries = readUint16(r, ifdOffset)
  for (let i = 0; i < numEntries; i++) {
    const entryOff = ifdOffset + 2 + i * 12
    if (entryOff + 12 > r.buf.length) return null
    const entryTag = readUint16(r, entryOff)
    if (entryTag === tag) {
      return {
        type: readUint16(r, entryOff + 2),
        count: readUint32(r, entryOff + 4),
        value: readUint32(r, entryOff + 8)
      }
    }
  }
  return null
}

function inspectExifContainer(blob: Uint8Array | null, out: PngInspection): void {
  if (!blob) return
  out.hasExif = true
  const userComment = readExifUserComment(blob)
  if (userComment) {
    out.hasUserComment = true
    out.parameters = userComment
  }
}

// =========================================================================
//  Parameters-string parser (shared across formats)
// =========================================================================

/**
 * Parse the "parameters" string into structured fields. Format is
 * append-only — newer Forge builds add fields, so unknown keys are ignored.
 */
export function parseParametersString(raw: string): ParsedPngMetadata {
  const negIdx = raw.search(/^Negative prompt:/m)
  const stepsIdx = raw.search(/^Steps:/m)

  let prompt = raw
  let negative = ''
  let paramsLine = ''

  if (negIdx >= 0) {
    prompt = raw.slice(0, negIdx).trim()
    if (stepsIdx >= 0) {
      negative = raw.slice(negIdx + 'Negative prompt:'.length, stepsIdx).trim()
      paramsLine = raw.slice(stepsIdx).trim()
    } else {
      negative = raw.slice(negIdx + 'Negative prompt:'.length).trim()
    }
  } else if (stepsIdx >= 0) {
    prompt = raw.slice(0, stepsIdx).trim()
    paramsLine = raw.slice(stepsIdx).trim()
  }

  const fields = parseParamsLine(paramsLine)
  const size = fields['Size']
  const sizeMatch = size?.match(/(\d+)\s*x\s*(\d+)/i)

  const loras = parseMetadataAdapters(prompt)

  return {
    prompt: prompt.replace(/\r\n/g, '\n'),
    negativePrompt: negative.replace(/\r\n/g, '\n'),
    steps: numField(fields, 'Steps'),
    cfgScale: numField(fields, 'CFG scale'),
    width: sizeMatch ? parseInt(sizeMatch[1], 10) : null,
    height: sizeMatch ? parseInt(sizeMatch[2], 10) : null,
    sampler: fields['Sampler'] ?? null,
    seed: numField(fields, 'Seed'),
    model: fields['Model'] ?? null,
    modelHash: fields['Model hash'] ?? null,
    vae: fields['VAE'] ?? null,
    clipSkip: numField(fields, 'Clip skip'),
    loras,
    raw
  }
}

function parseParamsLine(line: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!line) return out
  const segments: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '(' || ch === '{' || ch === '[') depth++
    else if (ch === ')' || ch === '}' || ch === ']') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      segments.push(line.slice(start, i))
      start = i + 1
    }
  }
  segments.push(line.slice(start))
  for (const seg of segments) {
    const idx = seg.indexOf(':')
    if (idx <= 0) continue
    const key = seg.slice(0, idx).trim()
    const val = seg.slice(idx + 1).trim()
    out[key] = val
  }
  return out
}

function numField(fields: Record<string, string>, key: string): number | null {
  const v = fields[key]
  if (!v) return null
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : null
}

// =========================================================================
//  Flexible parser for non-A1111 label/value layouts
// =========================================================================

/**
 * Try the A1111 inline-comma format first; fall back to a label/newline/value
 * format used by some sharing sites (aipictors, certain Korean / Chinese AI
 * platforms). The label-value format looks like:
 *
 *     <positive prompt — first paragraph, no label>
 *     Original Prompt
 *     <alternative-language original — discarded>
 *     Size
 *     1024 x 1024
 *     Sampling Steps
 *     50
 *     Sampling Method
 *     Euler a
 *     CFG Scale
 *     5
 *     Negative
 *     <negative prompt — multi-line until end>
 *
 * Detection heuristic: A1111 has either "Steps:" prefix on a line OR a
 * "Negative prompt:" prefix. If neither matches, we try the label-value
 * format.
 */
export function parseFlexibleParameters(text: string): ParsedPngMetadata {
  const looksLikeA1111 =
    /^Steps:\s*\d+/m.test(text) || /\bNegative prompt:/i.test(text)
  if (looksLikeA1111) return parseParametersString(text)
  const labelResult = parseLabelValueFormat(text)
  // If label-value parser also extracted nothing, fall back to A1111 anyway —
  // returns ParsedPngMetadata with everything as the prompt (least-bad guess).
  if (
    !labelResult.prompt &&
    !labelResult.negativePrompt &&
    labelResult.steps == null &&
    labelResult.cfgScale == null
  ) {
    return parseParametersString(text)
  }
  return labelResult
}

type LabelField =
  | 'prompt'
  | 'originalPrompt'
  | 'size'
  | 'steps'
  | 'sampler'
  | 'cfg'
  | 'seed'
  | 'negative'
  | 'model'
  | 'modelHash'
  | 'vae'
  | 'clipSkip'
  | 'denoising'

/**
 * Recognized header strings (case-insensitive, trailing ":" stripped) and
 * their canonical field names. Adding more keys here is the cheapest way to
 * support new sharing sites.
 */
const LABEL_TO_FIELD: ReadonlyArray<readonly [string, LabelField]> = [
  ['original prompt', 'originalPrompt'],
  ['original', 'originalPrompt'],
  ['prompt', 'prompt'],
  ['size', 'size'],
  ['resolution', 'size'],
  ['sampling steps', 'steps'],
  ['steps', 'steps'],
  ['sampling method', 'sampler'],
  ['sampler', 'sampler'],
  ['sampler name', 'sampler'],
  ['scheduler', 'sampler'],          // some sites lump them
  ['cfg scale', 'cfg'],
  ['cfg', 'cfg'],
  ['guidance scale', 'cfg'],
  ['seed', 'seed'],
  ['negative', 'negative'],
  ['negative prompt', 'negative'],
  ['neg prompt', 'negative'],
  ['model', 'model'],
  ['checkpoint', 'model'],
  ['model hash', 'modelHash'],
  ['hash', 'modelHash'],
  ['vae', 'vae'],
  ['clip skip', 'clipSkip'],
  ['clipskip', 'clipSkip'],
  ['denoising', 'denoising'],
  ['denoising strength', 'denoising'],
  ['denoise strength', 'denoising']
]

function lookupLabel(line: string): LabelField | null {
  // Strip trailing colons and full-width colons / whitespace, lowercase.
  const norm = line.trim().toLowerCase().replace(/[:：\s]+$/, '').trim()
  for (const [label, field] of LABEL_TO_FIELD) {
    if (norm === label) return field
  }
  return null
}

function parseLabelValueFormat(text: string): ParsedPngMetadata {
  const lines = text.split(/\r?\n/)
  const sections = new Map<LabelField, string[]>()
  sections.set('prompt', [])
  let current: LabelField = 'prompt'

  for (const line of lines) {
    const field = lookupLabel(line)
    if (field) {
      current = field
      if (!sections.has(current)) sections.set(current, [])
    } else {
      sections.get(current)!.push(line)
    }
  }

  const single = (f: LabelField): string | null => {
    const arr = sections.get(f) ?? []
    const v = arr.map((l) => l.trim()).filter(Boolean).join(' ').trim()
    return v.length > 0 ? v : null
  }
  const multi = (f: LabelField): string => {
    const arr = sections.get(f) ?? []
    return arr.join('\n').replace(/\s+$/, '').replace(/^\s+/, '').trim()
  }

  const prompt = multi('prompt')
  const negative = multi('negative')
  const sizeText = single('size')
  const sizeMatch = sizeText?.match(/(\d+)\s*[x×]\s*(\d+)/i)

  const loras = parseMetadataAdapters(prompt)

  return {
    prompt,
    negativePrompt: negative,
    steps: parseIntOrNull(single('steps')),
    cfgScale: parseFloatOrNull(single('cfg')),
    width: sizeMatch ? parseInt(sizeMatch[1], 10) : null,
    height: sizeMatch ? parseInt(sizeMatch[2], 10) : null,
    sampler: single('sampler'),
    seed: parseIntOrNull(single('seed')),
    model: single('model'),
    modelHash: single('modelHash'),
    vae: single('vae'),
    clipSkip: parseIntOrNull(single('clipSkip')),
    loras,
    raw: text
  }
}

function parseMetadataAdapters(prompt: string): { name: string; weight: number; legacyKind?: 'lora' | 'lyco' }[] {
  return parseAdapterTokens(prompt)
    .filter((token) => token.kind === 'lora' || token.kind === 'lyco')
    .map((token) => ({
      name: token.name,
      weight: token.weight,
      legacyKind: token.kind as 'lora' | 'lyco'
    }))
}

function parseIntOrNull(s: string | null): number | null {
  if (!s) return null
  const n = parseInt(s, 10)
  return Number.isFinite(n) ? n : null
}

function parseFloatOrNull(s: string | null): number | null {
  if (!s) return null
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}
