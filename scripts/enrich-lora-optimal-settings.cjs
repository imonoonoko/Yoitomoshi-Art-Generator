#!/usr/bin/env node
/* eslint-env node */

const { createHash } = require('node:crypto')
const { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync } = require('node:fs')
const path = require('node:path')

const PROJECT_ROOT = process.cwd()
const USERDATA_DIR = path.join(PROJECT_ROOT, 'userdata')
const CIVITAI_DIR = path.join(USERDATA_DIR, 'civitai')
const OVERRIDES_PATH = path.join(USERDATA_DIR, 'lora-prompt-overrides.json')
const SETTINGS_PATH = path.join(USERDATA_DIR, 'settings.json')
const DOCS_DIR = path.join(PROJECT_ROOT, 'docs')
const REPORT_PATH = path.join(DOCS_DIR, 'LORA_OPTIMAL_SETTINGS_PRIMARY_SOURCE_2026-05-28.md')
const CIVITAI_BASE = 'https://civitai.com/api/v1'
const USER_AGENT = 'Yoitomoshi-Art-Generator/0.1 lora-settings-enricher'
const ADAPTER_ROOTS = ['Lora', 'LyCORIS']
const ADAPTER_EXTS = new Set(['.safetensors', '.pt', '.ckpt'])

const args = new Set(process.argv.slice(2))
const APPLY = args.has('--apply')
const REFRESH = !args.has('--cache-only')
const INCLUDE_FALLBACK_WEIGHT = !args.has('--no-guide-fallback')

main().catch((error) => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})

async function main() {
  const settings = readJson(SETTINGS_PATH, {})
  const forgePath = settings.forgePath || path.join(PROJECT_ROOT, 'runtime', 'forge')
  const apiKey = readCivitaiApiKey()

  mkdirSync(CIVITAI_DIR, { recursive: true })
  mkdirSync(DOCS_DIR, { recursive: true })

  const adapters = scanAdapters(forgePath)
  if (adapters.length === 0) {
    throw new Error(`No LoRA/LyCORIS files found under ${forgePath}`)
  }

  const existingOverrides = readJson(OVERRIDES_PATH, [])
    .filter((item) => item && typeof item === 'object')
  const existingById = new Map(existingOverrides.map((item) => [item.id, item]))

  const results = []
  for (let i = 0; i < adapters.length; i++) {
    const adapter = adapters[i]
    process.stdout.write(`[${i + 1}/${adapters.length}] hashing ${adapter.sourceRoot}/${adapter.tokenName} ... `)
    adapter.sha256 = await hashFile(adapter.path)
    console.log(adapter.sha256.slice(0, 12))

    const result = await enrichAdapter(adapter, existingById, apiKey)
    results.push(result)
    if (REFRESH) await sleep(180)
  }

  const generatedById = new Map()
  for (const result of results) {
    if (!result.override) continue
    if (generatedById.has(result.override.id)) {
      result.evidence.notes.push(`Duplicate SHA-256; shares override with ${generatedById.get(result.override.id).loraName}.`)
      continue
    }
    generatedById.set(result.override.id, result.override)
  }
  const generated = [...generatedById.values()]
  const generatedIds = new Set(generated.map((item) => item.id))
  const merged = [
    ...generated,
    ...existingOverrides.filter((item) => !generatedIds.has(item.id))
  ]

  const report = buildReport(results, {
    applied: APPLY,
    refreshed: REFRESH,
    usedApiKey: Boolean(apiKey),
    includeFallbackWeight: INCLUDE_FALLBACK_WEIGHT
  })

  if (APPLY) {
    backupIfExists(OVERRIDES_PATH)
    writeFileSync(OVERRIDES_PATH, `${JSON.stringify(merged, null, 2)}\n`)
    writeFileSync(REPORT_PATH, report)
  } else {
    console.log('\nDry run only. Re-run with --apply to write lora-prompt-overrides.json and the report.')
  }

  const summary = summarize(results)
  console.log('\nSummary')
  console.log(`  scanned: ${summary.scanned}`)
  console.log(`  overrides ready: ${summary.overrides}`)
  console.log(`  unique override ids: ${summary.uniqueOverrides}`)
  console.log(`  live Civitai matches: ${summary.live}`)
  console.log(`  cache fallbacks: ${summary.cache}`)
  console.log(`  unmatched: ${summary.unmatched}`)
  console.log(`  author/sample weights: ${summary.sourceWeights}`)
  console.log(`  guide fallback weights: ${summary.fallbackWeights}`)
  for (const result of results.filter((item) => !item.override)) {
    console.log(`  unmatched: ${result.adapter.sourceRoot}/${result.adapter.tokenName} (${result.fetchError || result.source})`)
  }
  if (APPLY) {
    console.log(`  wrote: ${OVERRIDES_PATH}`)
    console.log(`  wrote: ${REPORT_PATH}`)
  }
}

function scanAdapters(forgePath) {
  const entries = []
  for (const sourceRoot of ADAPTER_ROOTS) {
    const root = path.join(forgePath, 'webui', 'models', sourceRoot)
    if (!existsSync(root)) continue
    walk(root, '', sourceRoot, entries)
  }

  const tokenCounts = new Map()
  for (const entry of entries) {
    const key = entry.tokenName.toLowerCase()
    tokenCounts.set(key, (tokenCounts.get(key) || 0) + 1)
  }
  for (const entry of entries) {
    const collides = (tokenCounts.get(entry.tokenName.toLowerCase()) || 0) > 1
    entry.loraName = collides ? `${entry.sourceRoot}/${entry.tokenName}` : entry.tokenName
  }
  return entries.sort((a, b) => a.loraName.localeCompare(b.loraName))
}

function walk(root, relPrefix, sourceRoot, out) {
  const dir = path.join(root, relPrefix)
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name
    const abs = path.join(root, rel)
    if (entry.isDirectory()) {
      walk(root, rel, sourceRoot, out)
      continue
    }
    if (!entry.isFile()) continue
    const parsed = path.parse(entry.name)
    if (!ADAPTER_EXTS.has(parsed.ext.toLowerCase())) continue
    const tokenName = relPrefix
      ? `${relPrefix.replace(/\\/g, '/')}/${parsed.name}`
      : parsed.name
    out.push({
      sourceRoot,
      tokenName,
      alias: parsed.name,
      path: abs,
      sha256: null,
      loraName: tokenName
    })
  }
}

async function enrichAdapter(adapter, existingById, apiKey) {
  const cachePath = path.join(CIVITAI_DIR, `lora-${adapter.sha256}.json`)
  let version = null
  let source = 'none'
  let fetchError = null

  if (REFRESH) {
    try {
      version = await civitaiJson(`/model-versions/by-hash/${adapter.sha256}`, apiKey)
      source = version ? 'live' : 'not-found'
    } catch (error) {
      fetchError = error.message
    }
  }

  const cachedMeta = readJson(cachePath, null)
  if (!version && cachedMeta) source = fetchError ? 'cache-after-error' : 'cache'

  const localPrimary = !version && !cachedMeta ? localPrimaryMetadata(adapter) : null
  if (localPrimary) source = 'local-primary'

  const normalized = version
    ? normalizeCivitaiVersion(version, adapter.sha256)
    : cachedMeta
      ? normalizeCachedMetadata(cachedMeta, adapter.sha256)
      : localPrimary

  if (version && APPLY) {
    writeFileSync(cachePath, `${JSON.stringify(normalized.cache, null, 2)}\n`)
  }

  if (!normalized) {
    return {
      adapter,
      source,
      fetchError,
      override: null,
      metadata: null,
      evidence: { notes: ['No exact Civitai hash match and no local cache.'] }
    }
  }

  const evidence = deriveEvidence(adapter, normalized)
  const existing = existingById.get(`sha256:${adapter.sha256}`) || existingById.get(`name:${adapter.loraName.toLowerCase()}`)
  const override = buildOverride(adapter, normalized.cache, evidence, existing)

  return {
    adapter,
    source,
    fetchError,
    override,
    metadata: normalized.cache,
    evidence
  }
}

function buildOverride(adapter, meta, evidence, existing) {
  const now = Date.now()
  const positive = uniqueTokens([
    ...safeArray(meta.trainedWords),
    ...evidence.recommendedPrompts
  ]).join(', ')
  const negative = evidence.negativePrompt || existing?.negativePrompt || ''
  const sampler = evidence.sampler || existing?.sampler || undefined
  const steps = evidence.steps ?? existing?.steps ?? null
  const cfgScale = evidence.cfgScale ?? existing?.cfgScale ?? null
  const clipSkip = evidence.clipSkip ?? existing?.clipSkip ?? null
  const weight = evidence.weight ?? existing?.weight ?? null

  return normalizeOverride({
    id: `sha256:${adapter.sha256}`,
    loraName: adapter.loraName,
    loraAlias: meta.modelName || adapter.alias,
    loraPath: adapter.path,
    loraSha256: adapter.sha256,
    positivePrompt: positive || existing?.positivePrompt || '',
    negativePrompt: negative,
    weight,
    sampler,
    steps,
    cfgScale,
    clipSkip,
    autoApply: existing?.autoApply !== false,
    updatedAt: now
  })
}

function deriveEvidence(adapter, normalized) {
  const text = normalized.fullText
  const images = normalized.images
  const local = normalized.localRecommended || {}
  const authorWeight = extractAuthorWeight(text)
  const sampleWeights = extractSampleWeights(images, adapter, normalized.cache)
  const sampleSettings = extractSampleSettings(images)
  const recommendedPrompts = uniqueTokens([
    ...extractRecommendedPrompts(text, normalized.cache.trainedWords),
    ...safeArray(local.positivePrompts),
    ...extractStablePromptTokensFromSamples(images, normalized.cache.trainedWords)
  ]).slice(0, 24)
  const negativePrompt = local.negativePrompt || extractNegativePrompt(text) || sampleSettings.negativePrompt || ''

  let weight = null
  let weightSource = 'none'
  if (local.weight != null) {
    weight = local.weight
    weightSource = 'local-primary'
  } else if (authorWeight != null) {
    weight = authorWeight
    weightSource = 'author-card'
  } else if (sampleWeights.length > 0) {
    weight = roundWeight(sampleWeightRecommendation(sampleWeights, adapter, normalized.cache))
    weightSource = 'sample-prompts'
  } else if (INCLUDE_FALLBACK_WEIGHT) {
    weight = 0.85
    weightSource = 'civitai-guide-starting-point'
  }

  return {
    weight,
    weightSource,
    sampleWeights,
    recommendedPrompts,
    negativePrompt,
    sampler: local.sampler || sampleSettings.sampler,
    steps: local.steps ?? sampleSettings.steps,
    cfgScale: local.cfgScale ?? sampleSettings.cfgScale,
    clipSkip: local.clipSkip ?? sampleSettings.clipSkip,
    settingsSource: local.settingsSource || sampleSettings.source,
    notes: sampleSettings.notes
  }
}

function localPrimaryMetadata(adapter) {
  if (!/onoko_0n0k0_sdxl_v3_2_patch_b/i.test(adapter.tokenName)) return null
  const description = [
    'Local ONOKO primary sources: docs/ONOKO_LORA_RECOMMENDED_MODELS_RESEARCH_2026-05-24.html and C:/ONOKO_PROJECT/lora_workspace/config/train_v3_2.toml.',
    'Trigger: 0n0k0.',
    'Initial weight: 0.65. If identity is weak, raise toward 0.75; if the image collapses, lower toward 0.55.',
    'Recommended checkpoint baseline: n4mik4ILSFWNSFW_v20.safetensors.',
    'Recommended test settings: Euler a, 28 steps, CFG 4.5.',
    'Training metadata: SDXL LoRA, n4mik4ILSFWNSFW_v20.safetensors, rank 16, alpha 8, 1024 resolution.'
  ].join('\n')
  return {
    cache: {
      modelId: undefined,
      modelVersionId: undefined,
      modelName: 'ONOKO - AI Girl (SDXL char LoRA, local v3.2 patch_b)',
      versionName: 'v3.2 patch_b',
      baseModel: 'SDXL 1.0 / Illustrious',
      trainedWords: ['0n0k0'],
      description,
      descriptionSource: 'model',
      recommendedPrompts: ['solo', 'looking at viewer', 'eyewear on head', 'sunglasses', 'black hair', 'blue eyes'],
      tags: ['anime', 'character', 'female', 'oc', 'sdxl', 'illustrious', 'local'],
      files: [],
      availability: {
        primaryFileSha256: adapter.sha256,
        primaryFileName: path.basename(adapter.path),
        primaryFileFormat: 'SafeTensor',
        pickleScanResult: null,
        virusScanResult: null
      },
      usage: {
        allowNoCredit: null,
        allowCommercialUse: null,
        allowDerivatives: null,
        allowDifferentLicense: null
      },
      thumbnailUrl: null,
      civitaiUrl: null,
      fetchedAt: Date.now()
    },
    fullText: description,
    images: [],
    localRecommended: {
      weight: 0.65,
      sampler: 'Euler a',
      steps: 28,
      cfgScale: 4.5,
      clipSkip: 2,
      settingsSource: 'local-primary:onoko-report',
      positivePrompts: [
        'solo',
        'looking at viewer',
        'eyewear on head',
        'sunglasses',
        'black hair',
        'blue eyes',
        'masterpiece',
        'best quality'
      ],
      negativePrompt: 'worst quality, low quality, bad anatomy, bad hands, extra digits, text, watermark, logo'
    }
  }
}

function normalizeCivitaiVersion(version, sha256) {
  const modelDetail = version.model || {}
  const modelDescription = stripHtml(modelDetail.description || '')
  const versionDescription = stripHtml(version.description || '')
  const fullText = uniqueTextBlocks([modelDescription, versionDescription]).join('\n\n')
  const cache = {
    modelId: numberOrUndefined(version.modelId),
    modelVersionId: numberOrUndefined(version.id),
    modelName: stringOrFallback(modelDetail.name, version.modelName || ''),
    versionName: stringOrFallback(version.name, ''),
    baseModel: stringOrFallback(version.baseModel, ''),
    trainedWords: safeArray(version.trainedWords).filter((item) => typeof item === 'string'),
    description: truncate(fullText, 4000) || null,
    descriptionSource: modelDescription ? 'model' : versionDescription ? 'version' : 'none',
    recommendedPrompts: extractRecommendedPrompts(fullText, version.trainedWords || []),
    tags: normalizeTags(modelDetail.tags),
    files: normalizeFiles(version.files || []),
    availability: normalizeAvailability(version.files || [], sha256),
    usage: {
      allowNoCredit: booleanOrNull(modelDetail.allowNoCredit),
      allowCommercialUse: modelDetail.allowCommercialUse || null,
      allowDerivatives: booleanOrNull(modelDetail.allowDerivatives),
      allowDifferentLicense: booleanOrNull(modelDetail.allowDifferentLicense)
    },
    thumbnailUrl: pickThumbnail(version.images || []),
    civitaiUrl: version.modelId && version.id
      ? `https://civitai.com/models/${version.modelId}?modelVersionId=${version.id}`
      : null,
    fetchedAt: Date.now()
  }
  return {
    cache,
    fullText,
    images: Array.isArray(version.images) ? version.images : []
  }
}

function normalizeCachedMetadata(meta, sha256) {
  const description = typeof meta.description === 'string' ? meta.description : ''
  const cache = {
    modelId: numberOrUndefined(meta.modelId),
    modelVersionId: numberOrUndefined(meta.modelVersionId),
    modelName: stringOrFallback(meta.modelName, ''),
    versionName: stringOrFallback(meta.versionName, ''),
    baseModel: stringOrFallback(meta.baseModel, ''),
    trainedWords: safeArray(meta.trainedWords).filter((item) => typeof item === 'string'),
    description: description || null,
    descriptionSource: meta.descriptionSource || (description ? 'model' : 'none'),
    recommendedPrompts: safeArray(meta.recommendedPrompts).filter((item) => typeof item === 'string'),
    tags: safeArray(meta.tags).filter((item) => typeof item === 'string'),
    files: safeArray(meta.files),
    availability: meta.availability || { primaryFileSha256: sha256 },
    usage: meta.usage || {
      allowNoCredit: null,
      allowCommercialUse: null,
      allowDerivatives: null,
      allowDifferentLicense: null
    },
    thumbnailUrl: meta.thumbnailUrl || null,
    civitaiUrl: meta.civitaiUrl || null,
    fetchedAt: meta.fetchedAt || Date.now()
  }
  return { cache, fullText: description, images: [] }
}

function normalizeFiles(files) {
  return files.map((file) => ({
    id: numberOrUndefined(file.id) || 0,
    name: stringOrFallback(file.name, ''),
    type: stringOrFallback(file.type, ''),
    sizeKB: typeof file.sizeKB === 'number' ? file.sizeKB : null,
    downloadUrl: file.downloadUrl || null,
    primary: file.primary === true,
    hashes: { sha256: normalizeSha(file.hashes?.SHA256 || file.hashes?.sha256) }
  }))
}

function normalizeAvailability(files, sha256) {
  const primary = files.find((file) => file.primary) || files.find((file) => {
    const fileSha = normalizeSha(file.hashes?.SHA256 || file.hashes?.sha256)
    return fileSha === sha256
  }) || files[0]
  return {
    primaryFileSha256: normalizeSha(primary?.hashes?.SHA256 || primary?.hashes?.sha256) || sha256,
    primaryFileName: primary?.name || null,
    primaryFileFormat: primary?.metadata?.format || primary?.format || null,
    pickleScanResult: primary?.pickleScanResult || null,
    virusScanResult: primary?.virusScanResult || null
  }
}

function extractAuthorWeight(text) {
  if (!text) return null
  const candidates = []
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    if (!/(weight|strength|ウェイト|重み|強度|推奨|recommended|suggested|range)/i.test(line)) continue
    if (/(learning rate|optimizer|epoch|batch|dim|alpha|network|training)/i.test(line)) continue
    const range = line.match(/(?:weight|strength|ウェイト|重み|強度)[^\n]{0,40}?([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*(?:-|–|~|to|から|〜)\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))/i)
    const direct = line.match(/(?:recommended|suggested|use|推奨|おすすめ)?[^\n]{0,35}(?:weight|strength|lora\s*weight|lora\s*strength|ウェイト|重み|強度)[^\n]{0,35}?([+-]?(?:\d+(?:\.\d+)?|\.\d+))/i)
    if (direct) candidates.push(Number(direct[1]))
    else if (range) candidates.push((Number(range[1]) + Number(range[2])) / 2)
  }
  const valid = candidates.filter((value) => Number.isFinite(value) && value >= -1 && value <= 2)
  return valid.length > 0 ? roundWeight(valid[0]) : null
}

function extractSampleWeights(images, adapter, meta) {
  const candidates = adapterNameCandidates(adapter, meta)
  const out = []
  for (const image of images) {
    const promptParts = [
      image?.meta?.prompt,
      image?.meta?.['X Values'],
      image?.meta?.['Y Values'],
      image?.meta?.['Z Values']
    ].filter((value) => typeof value === 'string')
    if (promptParts.length === 0) continue
    const tags = promptParts.flatMap((prompt) =>
      [...prompt.matchAll(/<(?:lora|lyco):([^:>]+):([+-]?(?:\d+(?:\.\d+)?|\.\d+))>/gi)]
    )
    if (tags.length === 0) continue
    for (const match of tags) {
      const name = normalizeName(match[1])
      const weight = Number(match[2])
      if (!Number.isFinite(weight) || weight < -1 || weight > 2) continue
      if (tags.length === 1 || candidates.some((candidate) => namesMatch(candidate, name))) {
        out.push(weight)
      }
    }
  }
  return out
}

function sampleWeightRecommendation(weights, adapter, meta) {
  if (isSliderAdapter(adapter, meta)) {
    const positive = weights.filter((value) => value > 0).sort((a, b) => a - b)
    if (positive.length > 0) return positive[0]
  }
  return median(weights)
}

function isSliderAdapter(adapter, meta) {
  return /slider/i.test([
    adapter.tokenName,
    adapter.alias,
    adapter.loraName,
    meta.modelName,
    meta.versionName,
    ...(meta.tags || [])
  ].filter(Boolean).join(' '))
}

function extractSampleSettings(images) {
  const metas = images
    .map((image) => image?.meta)
    .filter((meta) => meta && typeof meta === 'object')
  const sampler = mode(metas.map((meta) => stringOrNull(meta.sampler || meta.sampler_name || meta['Sampler'])))
  const steps = medianInteger(metas.map((meta) => numberOrNull(meta.steps || meta.Steps)))
  const cfgScale = medianNumber(metas.map((meta) => numberOrNull(meta.cfgScale || meta.CFG || meta['CFG scale'])))
  const clipSkip = medianInteger(metas.map((meta) => numberOrNull(meta.clipSkip || meta['Clip skip'] || meta['Clip Skip'])))
  const negativePrompt = stableNegativePrompt(metas.map((meta) => stringOrNull(meta.negativePrompt || meta.negative_prompt)))
  const count = metas.length
  const notes = []
  if (count === 0) notes.push('No Civitai sample metadata.')
  return {
    sampler,
    steps,
    cfgScale,
    clipSkip,
    negativePrompt,
    source: count > 0 ? `sample-image-metadata:${count}` : 'none',
    notes
  }
}

function stableNegativePrompt(values) {
  const cleaned = values
    .filter(Boolean)
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter((value) => value.length > 0 && value.length <= 600)
  if (cleaned.length === 0) return ''
  const counts = new Map()
  for (const value of cleaned) counts.set(value, (counts.get(value) || 0) + 1)
  const [best, count] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]
  return count >= Math.max(2, Math.ceil(cleaned.length / 2)) ? best : ''
}

function extractRecommendedPrompts(text, trainedWords) {
  if (!text) return []
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map(normalizeDescriptionLine)
  const candidates = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    const inline = promptTextAfterDescriptionLabel(line)
    if (inline) {
      candidates.push(inline)
      continue
    }
    if (!isPromptDescriptionHeading(line)) continue
    for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
      const next = lines[j]
      if (!next) {
        if (j > i + 1) break
        continue
      }
      if (isNegativePromptDescriptionLine(next) || isDescriptionSectionBoundary(next)) break
      candidates.push(promptTextAfterDescriptionLabel(next) || next)
    }
  }
  return promptCandidatesToTokens(candidates, trainedWords)
}

function extractNegativePrompt(text) {
  if (!text) return ''
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map(normalizeDescriptionLine)
  const candidates = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    const inline = negativeTextAfterDescriptionLabel(line)
    if (inline) {
      candidates.push(inline)
      continue
    }
    if (!isNegativePromptDescriptionHeading(line)) continue
    for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
      const next = lines[j]
      if (!next) {
        if (j > i + 1) break
        continue
      }
      if (isPromptDescriptionHeading(next) || isDescriptionSectionBoundary(next)) break
      candidates.push(negativeTextAfterDescriptionLabel(next) || next)
    }
  }
  return uniqueTokens(promptCandidatesToTokens(candidates, [])).slice(0, 40).join(', ')
}

function extractStablePromptTokensFromSamples(images, trainedWords) {
  const prompts = images
    .map((image) => image?.meta?.prompt)
    .filter((value) => typeof value === 'string' && value.length > 0)
  if (prompts.length < 3) return []
  const tokenCounts = new Map()
  for (const prompt of prompts) {
    const tokens = new Set(splitPromptHintTokens(prompt)
      .map(normalizePromptHintToken)
      .filter(Boolean))
    for (const token of tokens) tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1)
  }
  const trained = new Set(safeArray(trainedWords).map(promptHintKey))
  return [...tokenCounts.entries()]
    .filter(([token, count]) => count >= Math.ceil(prompts.length * 0.8) && !trained.has(promptHintKey(token)))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([token]) => token)
    .filter((token) => !/^(masterpiece|best quality|high quality|1girl|solo)$/i.test(token))
    .slice(0, 8)
}

function promptCandidatesToTokens(candidates, trainedWords) {
  const seen = new Set(safeArray(trainedWords).map(promptHintKey).filter(Boolean))
  const out = []
  for (const candidate of candidates) {
    for (const token of splitPromptHintTokens(candidate)) {
      const normalized = normalizePromptHintToken(token)
      const key = promptHintKey(normalized)
      if (!normalized || !key || seen.has(key)) continue
      seen.add(key)
      out.push(normalized)
      if (out.length >= 32) return out
    }
  }
  return out
}

function splitPromptHintTokens(text) {
  const clean = String(text)
    .replace(/<(?:lora|lyco|hypernet):[^>]+>/gi, ' ')
    .replace(/\b(?:negative prompt|negative|settings?|parameters?|steps?|sampler|cfg scale|cfg|seed|size|model hash|model|vae|clip skip)\b[\s\S]*$/i, '')
    .replace(/https?:\/\/\S+/gi, ' ')
  const out = []
  let depth = 0
  let start = 0
  for (let i = 0; i <= clean.length; i++) {
    const ch = clean[i]
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1)
    if (i === clean.length || ((ch === ',' || ch === '、' || ch === '\n') && depth === 0)) {
      out.push(clean.slice(start, i))
      start = i + 1
    }
  }
  return out
}

function normalizePromptHintToken(token) {
  const cleaned = String(token)
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

function normalizeDescriptionLine(line) {
  return String(line)
    .replace(/^[\s>*•・-]+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/\*\*/g, '')
    .trim()
}

function promptTextAfterDescriptionLabel(line) {
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

function negativeTextAfterDescriptionLabel(line) {
  const patterns = [
    /^(?:negative|neg\.?|undesired|avoid|negative\s+prompt|negative\s+tags?)\s*[:：-]\s*(.+)$/i,
    /^(?:ネガティブ|除外|避けるタグ|避けるプロンプト)\s*[:：-]\s*(.+)$/i
  ]
  for (const pattern of patterns) {
    const match = line.match(pattern)
    if (match?.[1]) return match[1]
  }
  return null
}

function isPromptDescriptionHeading(line) {
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

function isNegativePromptDescriptionHeading(line) {
  return /^(?:negative|neg\.?|undesired|avoid|negative\s+prompt|negative\s+tags?)\s*[:：]?$/i.test(line) ||
    /^(?:ネガティブ|除外|避けるタグ|避けるプロンプト)\s*[:：]?$/i.test(line)
}

function isNegativePromptDescriptionLine(line) {
  return negativeTextAfterDescriptionLabel(line) != null ||
    /^tags?\s*\([^)]*(?:negative|neg)[^)]*\)\s*[:：]/i.test(line)
}

function isDescriptionSectionBoundary(line) {
  if (promptTextAfterDescriptionLabel(line) || isPromptDescriptionHeading(line)) return true
  if (isNegativePromptDescriptionLine(line) || isNegativePromptDescriptionHeading(line)) return true
  return /^(?:settings?|parameters?|steps?|sampler|cfg|seed|size|model|vae|clip skip|license|download|changelog|version|notes?)\b.*[:：]/i.test(line) ||
    /^(?:ネガティブ|設定|推奨設定|手順|サンプラー|シード|サイズ|モデル|トリガー|学習ワード|ライセンス|商用|更新|注意)\s*[:：]/i.test(line)
}

function adapterNameCandidates(adapter, meta) {
  return uniqueTokens([
    adapter.tokenName,
    adapter.alias,
    adapter.loraName,
    meta.modelName,
    meta.versionName,
    meta.availability?.primaryFileName ? path.parse(meta.availability.primaryFileName).name : '',
    ...safeArray(meta.files).map((file) => file?.name ? path.parse(file.name).name : '')
  ].filter(Boolean).map(normalizeName))
}

function namesMatch(candidate, name) {
  if (!candidate || !name) return false
  return candidate === name || candidate.includes(name) || name.includes(candidate)
}

function normalizeName(value) {
  return String(value)
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/g, '')
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return []
  return tags
    .map((tag) => typeof tag === 'string' ? tag : tag?.name)
    .filter((tag) => typeof tag === 'string' && tag.trim())
    .map((tag) => tag.trim())
}

function pickThumbnail(images) {
  const image = images.find((item) => typeof item?.url === 'string') || null
  return image?.url || null
}

async function civitaiJson(endpoint, apiKey) {
  const url = endpoint.startsWith('http') ? endpoint : `${CIVITAI_BASE}${endpoint}`
  let lastError = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      }
    }).catch((error) => {
      lastError = error
      return null
    })
    if (!response) {
      await sleep(500 * (attempt + 1))
      continue
    }
    if (response.status === 404) return null
    if (response.status === 429 || response.status >= 500) {
      lastError = new Error(`Civitai ${response.status}`)
      const retryAfter = Number(response.headers.get('retry-after'))
      await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000 * (attempt + 1))
      continue
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Civitai ${response.status}: ${body.slice(0, 200)}`)
    }
    return response.json()
  }
  throw lastError || new Error('Civitai request failed')
}

function readCivitaiApiKey() {
  if (process.env.CIVITAI_API_KEY) return process.env.CIVITAI_API_KEY
  if (process.env.CIVITAI_TOKEN) return process.env.CIVITAI_TOKEN
  const secretsPath = path.join(USERDATA_DIR, 'secrets.local.json')
  const secrets = readJson(secretsPath, {})
  const stored = typeof secrets.civitaiApiKey === 'string' ? secrets.civitaiApiKey : ''
  if (stored.startsWith('plain:')) {
    try {
      return Buffer.from(stored.slice(6), 'base64').toString('utf8')
    } catch {
      return null
    }
  }
  if (stored && !stored.startsWith('safe:')) return stored
  return null
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath, { highWaterMark: 1024 * 1024 * 8 })
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

function backupIfExists(filePath) {
  if (!existsSync(filePath)) return
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  const backupPath = `${filePath}.${stamp}.bak`
  copyFileSync(filePath, backupPath)
}

function buildReport(results, options) {
  const summary = summarize(results)
  const lines = []
  lines.push('# LoRA Optimal Settings Primary Source Report')
  lines.push('')
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push(`Mode: ${options.applied ? 'applied' : 'dry-run'}`)
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push(`- Scanned LoRA/LyCORIS files: ${summary.scanned}`)
  lines.push(`- Overrides generated: ${summary.overrides}`)
  lines.push(`- Unique override IDs written: ${summary.uniqueOverrides}`)
  lines.push(`- Live Civitai exact hash matches: ${summary.live}`)
  lines.push(`- Local Civitai cache fallbacks: ${summary.cache}`)
  lines.push(`- Unmatched files left unchanged: ${summary.unmatched}`)
  lines.push(`- Author/sample-specific weights: ${summary.sourceWeights}`)
  lines.push(`- Civitai guide fallback weights: ${summary.fallbackWeights}`)
  lines.push(`- Civitai API key used: ${options.usedApiKey ? 'yes' : 'no; public API/cache only'}`)
  lines.push('')
  lines.push('## Evidence Policy')
  lines.push('')
  lines.push('- Primary match: local file SHA-256 to Civitai `GET /api/v1/model-versions/by-hash/:hash`.')
  lines.push('- Local primary fallback: project-owned LoRA versions that are not public on Civitai use local training config/report evidence.')
  lines.push('- Prompt hints: Civitai trained words first, then author description sections such as recommended prompt/tags.')
  lines.push('- Weight: author-stated recommendation first, then LoRA weights in Civitai sample prompts, then Civitai guide starting point 0.85 when no per-LoRA source exists.')
  lines.push('- Sampler/steps/CFG/clip skip: median or mode from the same model version sample image metadata only; no generic fallback is invented.')
  lines.push('- Unmatched files are not given guessed model-card settings.')
  lines.push('')
  lines.push('Sources used: Civitai API exact hash endpoint, Civitai model/version pages referenced below, and Civitai How-to-use-models guide for fallback LoRA starting weight.')
  lines.push('')
  lines.push('## Per-LoRA Results')
  lines.push('')
  lines.push('| File | Source | Civitai | Base | Weight | Params | Prompt Hints | Notes |')
  lines.push('|---|---|---|---|---:|---|---:|---|')
  for (const result of results) {
    const meta = result.metadata
    const evidence = result.evidence
    const file = escapeCell(`${result.adapter.sourceRoot}/${result.adapter.tokenName}`)
    const source = escapeCell(result.source)
    const civitai = meta?.civitaiUrl ? `[${escapeCell(meta.modelName || 'Civitai')}](${meta.civitaiUrl})` : ''
    const base = escapeCell(meta?.baseModel || '')
    const weight = evidence.weight != null ? `${evidence.weight} (${evidence.weightSource})` : ''
    const params = [
      evidence.sampler ? `sampler=${evidence.sampler}` : '',
      evidence.steps != null ? `steps=${evidence.steps}` : '',
      evidence.cfgScale != null ? `cfg=${evidence.cfgScale}` : '',
      evidence.clipSkip != null ? `clipSkip=${evidence.clipSkip}` : ''
    ].filter(Boolean).join('<br>')
    const hints = result.override?.positivePrompt
      ? splitCsvCount(result.override.positivePrompt)
      : 0
    const notes = escapeCell([
      result.fetchError ? `fetch: ${result.fetchError}` : '',
      ...(evidence.notes || []),
      !result.override ? 'override not written' : ''
    ].filter(Boolean).join('; '))
    lines.push(`| ${file} | ${source} | ${civitai} | ${base} | ${escapeCell(weight)} | ${escapeCell(params)} | ${hints} | ${notes} |`)
  }
  lines.push('')
  lines.push('## Unmatched')
  lines.push('')
  const unmatched = results.filter((result) => !result.override)
  if (unmatched.length === 0) {
    lines.push('All scanned files had either a live exact Civitai match or a local Civitai cache.')
  } else {
    for (const result of unmatched) {
      lines.push(`- ${result.adapter.sourceRoot}/${result.adapter.tokenName}: ${result.fetchError || 'no exact hash match'}`)
    }
  }
  lines.push('')
  return `${lines.join('\n')}\n`
}

function summarize(results) {
  return {
    scanned: results.length,
    overrides: results.filter((result) => result.override).length,
    uniqueOverrides: new Set(results.filter((result) => result.override).map((result) => result.override.id)).size,
    live: results.filter((result) => result.source === 'live').length,
    cache: results.filter((result) => result.source === 'cache' || result.source === 'cache-after-error').length,
    unmatched: results.filter((result) => !result.override).length,
    sourceWeights: results.filter((result) => ['local-primary', 'author-card', 'sample-prompts'].includes(result.evidence.weightSource)).length,
    fallbackWeights: results.filter((result) => result.evidence.weightSource === 'civitai-guide-starting-point').length
  }
}

function normalizeOverride(item) {
  return {
    id: String(item.id).slice(0, 300),
    loraName: String(item.loraName).slice(0, 500),
    loraAlias: item.loraAlias ? String(item.loraAlias).slice(0, 500) : undefined,
    loraPath: item.loraPath ? String(item.loraPath).slice(0, 2000) : undefined,
    loraSha256: normalizeSha(item.loraSha256),
    positivePrompt: String(item.positivePrompt || '').slice(0, 4000),
    negativePrompt: String(item.negativePrompt || '').slice(0, 4000),
    weight: item.weight == null ? null : Math.max(-1, Math.min(2, Math.round(Number(item.weight) * 100) / 100)),
    sampler: item.sampler ? String(item.sampler).slice(0, 120) : undefined,
    steps: item.steps == null ? null : Math.max(1, Math.min(150, Math.round(Number(item.steps)))),
    cfgScale: item.cfgScale == null ? null : Math.max(1, Math.min(30, Math.round(Number(item.cfgScale) * 100) / 100)),
    clipSkip: item.clipSkip == null ? null : Math.max(1, Math.min(12, Math.round(Number(item.clipSkip)))),
    autoApply: item.autoApply !== false,
    updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now()
  }
}

function readJson(filePath, fallback) {
  if (!existsSync(filePath)) return fallback
  try {
    return JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return fallback
  }
}

function stripHtml(value) {
  return decodeEntities(String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim())
}

function decodeEntities(value) {
  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' '
  }
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity) => {
    const key = entity.toLowerCase()
    if (named[key]) return named[key]
    if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16))
    if (key.startsWith('#')) return String.fromCodePoint(parseInt(key.slice(1), 10))
    return `&${entity};`
  })
}

function uniqueTextBlocks(values) {
  const seen = new Set()
  const out = []
  for (const value of values) {
    const cleaned = String(value || '').trim()
    const key = cleaned.toLowerCase().replace(/\s+/g, ' ')
    if (!cleaned || seen.has(key)) continue
    seen.add(key)
    out.push(cleaned)
  }
  return out
}

function uniqueTokens(values) {
  const seen = new Set()
  const out = []
  for (const value of values) {
    if (typeof value !== 'string') continue
    const cleaned = value.trim().replace(/\s+/g, ' ')
    const key = cleaned.toLowerCase()
    if (!cleaned || seen.has(key)) continue
    seen.add(key)
    out.push(cleaned)
  }
  return out
}

function median(values) {
  const valid = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (valid.length === 0) return null
  const mid = Math.floor(valid.length / 2)
  return valid.length % 2 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2
}

function medianInteger(values) {
  const value = median(values.filter((item) => Number.isFinite(item)))
  return value == null ? null : Math.round(value)
}

function medianNumber(values) {
  const value = median(values.filter((item) => Number.isFinite(item)))
  return value == null ? null : Math.round(value * 100) / 100
}

function mode(values) {
  const cleaned = values.filter(Boolean)
  if (cleaned.length === 0) return null
  const counts = new Map()
  for (const value of cleaned) counts.set(value, (counts.get(value) || 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0][0]
}

function stringOrNull(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function stringOrFallback(value, fallback) {
  return typeof value === 'string' ? value : fallback
}

function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function numberOrUndefined(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function booleanOrNull(value) {
  return typeof value === 'boolean' ? value : null
}

function safeArray(value) {
  return Array.isArray(value) ? value : []
}

function normalizeSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null
}

function roundWeight(value) {
  return Math.max(-1, Math.min(2, Math.round(value * 100) / 100))
}

function truncate(value, max) {
  const text = String(value || '')
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function promptHintKey(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function escapeCell(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
}

function splitCsvCount(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean).length
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
