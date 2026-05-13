#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const DEFAULT_PORT = Number(process.env.QA_CDP_PORT || 9338)
const DEFAULT_FORGE_URL = process.env.FORGE_URL || 'http://127.0.0.1:7860'
const DEFAULT_OUT_DIR = path.resolve('output', 'tagger-accuracy-compare-2026-05-14')
const DEFAULT_DOC = path.resolve('docs', 'TAGGER_ACCURACY_COMPARISON_2026-05-14.md')
const HISTORY_INDEX = path.resolve('userdata', 'history', 'index.json')
const HISTORY_REVIEW_LIMIT = 24

const SAMPLES = [
  {
    id: 'controlnet-source-man',
    kind: 'photo-source',
    path: path.resolve('userdata', 'qa-materials', 'goal-2026-05-13', 'controlnet', 'standing-man-source.png'),
    expected: [
      'solo',
      'standing',
      'man|1boy|male focus',
      'shirt|white shirt',
      'pants',
      'suspenders',
      'monochrome|sepia',
      'photo'
    ]
  },
  {
    id: 'controlnet-gen-baseline',
    kind: 'generated-controlnet',
    path: path.resolve('output', 'controlnet-real-qa-2026-05-13', 'gen-baseline.png'),
    expected: [
      'solo',
      'standing',
      'full body',
      'man|1boy|male focus',
      'jacket|coat|long coat',
      'dark background',
      'door|doorway',
      'glitch|chromatic aberration'
    ]
  },
  {
    id: 'controlnet-gen-depth',
    kind: 'generated-controlnet',
    path: path.resolve('output', 'controlnet-real-qa-2026-05-13', 'gen-depth.png'),
    expected: [
      'solo',
      'standing',
      'full body',
      'man|1boy|male focus',
      'coat|long coat',
      'dark background',
      'light|glowing',
      'shoes'
    ]
  },
  {
    id: 'character-composite-after',
    kind: 'generated-composite',
    path: path.resolve('output', 'character-composite-real-qa-2026-05-13', 'generated-after.png'),
    expected: [
      '1girl|girl|female',
      'blue hair',
      'glasses|eyewear',
      'standing',
      'night',
      'street|road',
      'outdoors',
      'hoodie|sweater|jacket'
    ]
  },
  {
    id: 'workspace-external-ref',
    kind: 'anime-reference',
    path: path.resolve('output', 'workspace-qa', 'external-ref.png'),
    expected: [
      '1girl|girl|female',
      'black hair',
      'ponytail',
      'swimsuit',
      'pool',
      'water',
      'blue sky',
      'cloud',
      'mountain',
      'solo'
    ]
  }
]

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const fixedSamples = SAMPLES.filter((sample) => fs.existsSync(sample.path))
  const historyReview = loadHistoryReviewSamples(opts.historyLimit)
  const samples = [...fixedSamples, ...historyReview.samples]
  if (samples.length === 0) throw new Error('No comparison samples were found')

  fs.mkdirSync(opts.outDir, { recursive: true })
  fs.mkdirSync(path.dirname(opts.docPath), { recursive: true })

  const cdp = await connectCdp(opts.port)
  try {
    const forge = await probeForge(opts.forgeUrl)
    const wd14Models = forge.ready ? await getWd14Models(opts.forgeUrl).catch(() => []) : []
    const rows = []
    for (const sample of samples) {
      const image = readDataUrl(sample.path)
      const imageBase64 = image.replace(/^data:image\/[^;]+;base64,/, '')
      const providers = []

      providers.push(await runPixai(cdp, image))

      if (forge.ready) {
        providers.push(await runForgeInterrogate(opts.forgeUrl, imageBase64, 'deepdanbooru'))
        providers.push(await runForgeInterrogate(opts.forgeUrl, imageBase64, 'clip'))
        if (wd14Models.length > 0) {
          providers.push(await runWd14(opts.forgeUrl, imageBase64, opts.wd14Model, wd14Models))
        }
      } else {
        providers.push(skippedProvider('deepdanbooru', 'Forge API is not ready'))
        providers.push(skippedProvider('clip', 'Forge API is not ready'))
        providers.push(skippedProvider('wd14', 'Forge API is not ready'))
      }

      for (const provider of providers) {
        rows.push(scoreProvider(sample, provider))
      }
    }

    const summary = summarize(rows)
    const reviewInsights = buildReviewInsights(historyReview, rows)
    const result = {
      generatedAt: new Date().toISOString(),
      methodology: {
        type: 'local visual-label and history-review proxy benchmark',
        note: 'Expected labels combine small hand-authored QA labels and user-saved History review tags. This is not a formal human-labeled benchmark.',
        coverage: 'expected label hit rate',
        precisionProxy: 'share of top tags that hit one of the expected label groups',
        rejectedHitRate: 'share of saved rejected tag groups that appeared in the provider tags',
        score: 'fixed QA samples use 0.7 * coverage + 0.3 * precisionProxy; History review samples use 0.6 * coverage + 0.25 * precisionProxy + 0.15 * rejectedAvoidance'
      },
      forge,
      wd14Models,
      samples: samples.map((sample) => ({
        id: sample.id,
        kind: sample.kind,
        path: sample.path,
        expected: sample.expected,
        rejected: sample.rejected ?? []
      })),
      historyReview: reviewInsights,
      summary,
      rows
    }

    const jsonPath = path.join(opts.outDir, 'comparison.json')
    fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2))
    fs.writeFileSync(opts.docPath, renderMarkdown(result, jsonPath))
    console.log(JSON.stringify({
      ok: true,
      samples: samples.length,
      fixedSamples: fixedSamples.length,
      historyReviewSamples: historyReview.samples.length,
      providers: summary.length,
      jsonPath,
      docPath: opts.docPath,
      reviewInsights,
      summary
    }, null, 2))
  } finally {
    cdp.ws.close()
  }
}

function parseArgs(args) {
  const opts = {
    port: DEFAULT_PORT,
    forgeUrl: DEFAULT_FORGE_URL,
    outDir: DEFAULT_OUT_DIR,
    docPath: DEFAULT_DOC,
    wd14Model: 'wd14-convnextv2.v1',
    historyLimit: HISTORY_REVIEW_LIMIT
  }
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    }
    if (arg.startsWith('--port=')) opts.port = Number(arg.slice('--port='.length))
    else if (arg.startsWith('--forge-url=')) opts.forgeUrl = arg.slice('--forge-url='.length)
    else if (arg.startsWith('--out=')) opts.outDir = path.resolve(arg.slice('--out='.length))
    else if (arg.startsWith('--doc=')) opts.docPath = path.resolve(arg.slice('--doc='.length))
    else if (arg.startsWith('--wd14-model=')) opts.wd14Model = arg.slice('--wd14-model='.length)
    else if (arg.startsWith('--history-limit=')) opts.historyLimit = Number(arg.slice('--history-limit='.length))
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!Number.isInteger(opts.port) || opts.port <= 0) throw new Error(`Invalid CDP port: ${opts.port}`)
  if (!Number.isInteger(opts.historyLimit) || opts.historyLimit < 0) throw new Error(`Invalid history review limit: ${opts.historyLimit}`)
  return opts
}

function printUsage() {
  console.log(`Usage:
  node scripts/tagger-accuracy-compare.cjs [--port=9338] [--forge-url=http://127.0.0.1:7860] [--history-limit=24]

Prerequisite:
  Start Electron with --remote-debugging-port=<port>. Forge must be ready for DeepDanbooru, CLIP, and WD14.
`)
}

function loadHistoryReviewSamples(limit) {
  const reviewStats = {
    indexPath: HISTORY_INDEX,
    available: false,
    totalHistoryItems: 0,
    reviewedItems: 0,
    usableItems: 0,
    skippedMissingImage: 0,
    skippedNoAcceptedTags: 0
  }
  const samples = []
  const rejectedCounts = new Map()
  const acceptedCounts = new Map()
  if (limit === 0 || !fs.existsSync(HISTORY_INDEX)) {
    return { samples, rejectedCounts: [], acceptedCounts: [], stats: reviewStats }
  }
  let items = []
  try {
    items = JSON.parse(fs.readFileSync(HISTORY_INDEX, 'utf8'))
  } catch (error) {
    reviewStats.error = error.message
    return { samples, rejectedCounts: [], acceptedCounts: [], stats: reviewStats }
  }
  if (!Array.isArray(items)) return { samples, rejectedCounts: [], acceptedCounts: [], stats: reviewStats }

  reviewStats.available = true
  reviewStats.totalHistoryItems = items.length
  for (const item of items) {
    const review = item?.tagReview
    const accepted = normalizeReviewTags(review?.acceptedTags)
    const rejected = normalizeReviewTags(review?.rejectedTags)
    if (accepted.length === 0 && rejected.length === 0) continue
    reviewStats.reviewedItems += 1
    for (const tag of accepted) increment(acceptedCounts, normalize(tag))
    for (const tag of rejected) increment(rejectedCounts, normalize(tag))
    if (accepted.length === 0) {
      reviewStats.skippedNoAcceptedTags += 1
      continue
    }
    const imagePath = typeof item.imagePath === 'string' ? item.imagePath : ''
    if (!imagePath || !fs.existsSync(imagePath)) {
      reviewStats.skippedMissingImage += 1
      continue
    }
    samples.push({
      id: `history-review-${String(item.id || samples.length).slice(0, 8)}`,
      kind: 'history-review',
      path: imagePath,
      expected: accepted,
      rejected,
      historyId: item.id ?? null,
      reviewedAt: typeof review?.updatedAt === 'number' ? review.updatedAt : null
    })
    reviewStats.usableItems += 1
    if (samples.length >= limit) break
  }
  return {
    samples,
    rejectedCounts: topCounts(rejectedCounts, 60),
    acceptedCounts: topCounts(acceptedCounts, 60),
    stats: reviewStats
  }
}

function normalizeReviewTags(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const result = []
  for (const raw of value) {
    if (typeof raw !== 'string') continue
    const tag = raw.trim().replace(/\s+/g, ' ')
    const key = tag.toLowerCase()
    if (!tag || seen.has(key)) continue
    seen.add(key)
    result.push(tag)
    if (result.length >= 120) break
  }
  return result
}

async function connectCdp(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = targets.find((target) => target.type === 'page')
  if (!page?.webSocketDebuggerUrl) throw new Error(`No page target found on CDP port ${port}`)

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('CDP websocket connection failed'))
  })
  const send = (method, params = {}) => new Promise((resolve) => {
    const requestId = ++id
    pending.set(requestId, resolve)
    ws.send(JSON.stringify({ id: requestId, method, params }))
  })
  await send('Runtime.enable')
  return { ws, send }
}

async function evaluate(cdp, expression) {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  if (response.result?.exceptionDetails) {
    const exception = response.result.exceptionDetails.exception
    const message = exception?.description || response.result.exceptionDetails.text || 'Unknown CDP evaluation error'
    throw new Error(message)
  }
  return response.result?.result?.value
}

function readDataUrl(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png'
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`
}

async function probeForge(forgeUrl) {
  const started = Date.now()
  try {
    const response = await fetch(`${forgeUrl}/sdapi/v1/options`)
    return {
      ready: response.ok,
      url: forgeUrl,
      status: response.status,
      elapsedMs: Date.now() - started
    }
  } catch (error) {
    return {
      ready: false,
      url: forgeUrl,
      status: null,
      elapsedMs: Date.now() - started,
      error: error.message
    }
  }
}

async function getWd14Models(forgeUrl) {
  const response = await fetch(`${forgeUrl}/tagger/v1/interrogators`)
  if (!response.ok) return []
  const json = await response.json()
  return Array.isArray(json.models) ? json.models.filter((item) => typeof item === 'string') : []
}

async function runPixai(cdp, image) {
  const expression = `(async () => {
    const started = Date.now()
    try {
      const result = await window.api.tools.runTagger({
        image: ${JSON.stringify(image)},
        modelId: 'pixai-onnx',
        generalThreshold: 0.3,
        characterThreshold: 0.85,
        minScore: 0.4,
        excludeMeta: true,
        limit: 80
      })
      const rawTags = [...(result.tags || []), ...(result.suppressedTags || [])]
        .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
      return {
        provider: 'pixai-onnx',
        ok: result.status === 'ok',
        status: result.status,
        elapsedMs: Date.now() - started,
        tags: result.promptTags || [],
        rawTags: rawTags.slice(0, 120),
        suppressedTags: (result.suppressedTags || []).slice(0, 80),
        filter: result.filter || null,
        message: result.message
      }
    } catch (error) {
      return {
        provider: 'pixai-onnx',
        ok: false,
        status: 'failed',
        elapsedMs: Date.now() - started,
        tags: [],
        rawTags: [],
        message: String(error && error.message ? error.message : error)
      }
    }
  })()`
  return evaluate(cdp, expression)
}

async function runForgeInterrogate(forgeUrl, imageBase64, model) {
  const started = Date.now()
  try {
    const response = await fetch(`${forgeUrl}/sdapi/v1/interrogate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageBase64, model })
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 300)}`)
    const json = JSON.parse(text)
    const caption = typeof json.caption === 'string' ? json.caption : ''
    const tags = model === 'deepdanbooru'
      ? caption.split(',').map((tag) => tag.trim()).filter(Boolean)
      : [caption.trim()].filter(Boolean)
    return {
      provider: model,
      ok: true,
      status: 'ok',
      elapsedMs: Date.now() - started,
      tags,
      rawCaption: caption
    }
  } catch (error) {
    return skippedProvider(model, error.message, Date.now() - started)
  }
}

async function runWd14(forgeUrl, imageBase64, preferredModel, models) {
  const model = models.includes(preferredModel) ? preferredModel : models[0]
  const started = Date.now()
  try {
    const response = await fetch(`${forgeUrl}/tagger/v1/interrogate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageBase64, model, threshold: 0.35 })
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 300)}`)
    const json = JSON.parse(text)
    const tagScores = json.caption?.tag && typeof json.caption.tag === 'object' ? json.caption.tag : {}
    const tags = Object.entries(tagScores)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .map(([tag]) => tag)
    return {
      provider: 'wd14',
      model,
      ok: true,
      status: 'ok',
      elapsedMs: Date.now() - started,
      tags,
      rawTags: Object.entries(tagScores)
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .slice(0, 30)
        .map(([name, score]) => ({ name, score: Number(score) }))
    }
  } catch (error) {
    return skippedProvider('wd14', error.message, Date.now() - started)
  }
}

function skippedProvider(provider, message, elapsedMs = null) {
  return {
    provider,
    ok: false,
    status: 'skipped',
    elapsedMs,
    tags: [],
    rawTags: [],
    message
  }
}

function scoreProvider(sample, provider) {
  const normalizedTags = (provider.tags || []).flatMap((tag) => splitTagText(tag)).map(normalize).filter(Boolean)
  const uniqueTags = Array.from(new Set(normalizedTags))
  const expectedGroups = sample.expected.map((label) => label.split('|').map(normalize).filter(Boolean))
  const rejectedGroups = (sample.rejected ?? []).map((label) => label.split('|').map(normalize).filter(Boolean))
  const hits = []
  const misses = []
  for (let i = 0; i < expectedGroups.length; i += 1) {
    const group = expectedGroups[i]
    const hit = uniqueTags.find((tag) => group.some((expected) => tagMatches(tag, expected)))
    if (hit) hits.push({ expected: sample.expected[i], tag: hit })
    else misses.push(sample.expected[i])
  }
  const rejectedHits = []
  for (let i = 0; i < rejectedGroups.length; i += 1) {
    const group = rejectedGroups[i]
    const hit = uniqueTags.find((tag) => group.some((rejected) => tagMatches(tag, rejected)))
    if (hit) rejectedHits.push({ rejected: sample.rejected[i], tag: hit })
  }
  const topTags = uniqueTags.slice(0, 25)
  const usefulTopTags = topTags.filter((tag) => expectedGroups.some((group) => group.some((expected) => tagMatches(tag, expected))))
  const coverage = expectedGroups.length === 0 ? 0 : hits.length / expectedGroups.length
  const precisionProxy = topTags.length === 0 ? 0 : usefulTopTags.length / topTags.length
  const rejectedHitRate = rejectedGroups.length === 0 ? 0 : rejectedHits.length / rejectedGroups.length
  const rejectedAvoidance = rejectedGroups.length === 0 ? 1 : 1 - rejectedHitRate
  const score = rejectedGroups.length === 0
    ? (coverage * 0.7) + (precisionProxy * 0.3)
    : (coverage * 0.6) + (precisionProxy * 0.25) + (rejectedAvoidance * 0.15)
  return {
    sampleId: sample.id,
    sampleKind: sample.kind,
    historyId: sample.historyId ?? null,
    provider: provider.provider,
    model: provider.model ?? null,
    ok: provider.ok,
    status: provider.status,
    elapsedMs: provider.elapsedMs,
    tagCount: uniqueTags.length,
    expectedTotal: expectedGroups.length,
    expectedHits: hits.length,
    expectedLabels: sample.expected,
    coverage: round4(coverage),
    precisionProxy: round4(precisionProxy),
    rejectedLabels: sample.rejected ?? [],
    rejectedTotal: rejectedGroups.length,
    rejectedHits: rejectedHits.length,
    rejectedHitRate: round4(rejectedHitRate),
    rejectedAvoidance: round4(rejectedAvoidance),
    score: round4(score),
    hits,
    misses,
    rejectedMatches: rejectedHits,
    topTags,
    rawTags: Array.isArray(provider.rawTags) ? provider.rawTags.slice(0, 80) : [],
    filter: provider.filter ?? null,
    message: provider.message ?? null
  }
}

function splitTagText(value) {
  if (typeof value !== 'string') return []
  if (value.includes(',')) return value.split(',')
  return [value]
}

function normalize(value) {
  return String(value)
    .toLowerCase()
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/<lora:[^>]+>/g, ' ')
    .replace(/\([^)]*:[^)]+\)/g, ' ')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/[_/-]+/g, ' ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tagMatches(tag, expected) {
  if (!tag || !expected) return false
  if (tag === expected) return true
  const tagWords = new Set(tag.split(' '))
  const expectedWords = expected.split(' ')
  if (expectedWords.every((word) => tagWords.has(word))) return true
  return tag.includes(expected) || expected.includes(tag)
}

function summarize(rows) {
  const groups = new Map()
  for (const row of rows) {
    if (!groups.has(row.provider)) groups.set(row.provider, [])
    groups.get(row.provider).push(row)
  }
  return Array.from(groups, ([provider, values]) => {
    const okRows = values.filter((row) => row.ok)
    return {
      provider,
      okSamples: okRows.length,
      totalSamples: values.length,
      avgCoverage: avg(okRows.map((row) => row.coverage)),
      avgPrecisionProxy: avg(okRows.map((row) => row.precisionProxy)),
      avgRejectedHitRate: avg(okRows.filter((row) => row.rejectedTotal > 0).map((row) => row.rejectedHitRate)),
      avgScore: avg(okRows.map((row) => row.score)),
      avgElapsedMs: avg(okRows.map((row) => row.elapsedMs).filter((value) => typeof value === 'number')),
      avgTagCount: avg(okRows.map((row) => row.tagCount)),
      failures: values.filter((row) => !row.ok).map((row) => ({ sampleId: row.sampleId, status: row.status, message: row.message }))
    }
  }).sort((a, b) => b.avgScore - a.avgScore)
}

function buildReviewInsights(historyReview, rows) {
  const reviewedRows = rows.filter((row) => row.sampleKind === 'history-review' && row.ok)
  const rejectedTop = historyReview.rejectedCounts
  const acceptedTop = historyReview.acceptedCounts
  const blacklistCandidates = rejectedTop
    .filter((item) => item.count >= 2 || acceptedTop.every((accepted) => accepted.tag !== item.tag))
    .slice(0, 30)
  const thresholdTuning = tunePixaiThreshold(reviewedRows)
  return {
    ...historyReview.stats,
    includedSamples: historyReview.samples.length,
    evaluatedRows: reviewedRows.length,
    topAcceptedTags: acceptedTop.slice(0, 20),
    topRejectedTags: rejectedTop.slice(0, 30),
    blacklistCandidates,
    thresholdTuning
  }
}

function tunePixaiThreshold(rows) {
  const pixaiRows = rows.filter((row) => row.provider === 'pixai-onnx' && Array.isArray(row.rawTags) && row.rawTags.length > 0)
  if (pixaiRows.length === 0) {
    return {
      available: false,
      recommendedMinScore: 0.4,
      candidates: [],
      note: 'No PixAI raw tag scores were available for reviewed History samples.'
    }
  }
  const candidates = []
  for (let threshold = 0.3; threshold <= 0.8001; threshold += 0.05) {
    let acceptedTotal = 0
    let acceptedHits = 0
    let rejectedTotal = 0
    let rejectedHits = 0
    for (const row of pixaiRows) {
      const rawTags = row.rawTags
        .filter((tag) => tag && typeof tag.name === 'string' && typeof tag.score === 'number' && tag.score >= threshold)
        .map((tag) => normalize(tag.name))
        .filter(Boolean)
      const rawSet = Array.from(new Set(rawTags))
      const expectedGroups = row.expectedLabels
        .map((item) => String(item).split('|').map(normalize).filter(Boolean))
      const rejectedGroups = row.rejectedLabels
        .map((item) => String(item).split('|').map(normalize).filter(Boolean))
      acceptedTotal += expectedGroups.length
      rejectedTotal += row.rejectedTotal
      for (const group of expectedGroups) {
        if (rawSet.some((tag) => group.some((expected) => tagMatches(tag, expected)))) acceptedHits += 1
      }
      for (const group of rejectedGroups) {
        if (rawSet.some((tag) => group.some((rejected) => tagMatches(tag, rejected)))) rejectedHits += 1
      }
    }
    const acceptedHitRate = acceptedTotal === 0 ? 0 : acceptedHits / acceptedTotal
    const rejectedHitRate = rejectedTotal === 0 ? 0 : rejectedHits / rejectedTotal
    candidates.push({
      minScore: round4(threshold),
      acceptedHitRate: round4(acceptedHitRate),
      rejectedHitRate: round4(rejectedHitRate),
      utility: round4(acceptedHitRate - (rejectedHitRate * 0.5))
    })
  }
  const recommended = [...candidates].sort((a, b) => {
    if (b.utility !== a.utility) return b.utility - a.utility
    return a.minScore - b.minScore
  })[0]
  return {
    available: true,
    reviewedSamples: pixaiRows.length,
    recommendedMinScore: recommended?.minScore ?? 0.4,
    candidates
  }
}

function increment(map, key) {
  if (!key) return
  map.set(key, (map.get(key) ?? 0) + 1)
}

function topCounts(map, limit) {
  return Array.from(map, ([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, limit)
}

function avg(values) {
  if (values.length === 0) return 0
  return round4(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function round4(value) {
  return Math.round(value * 10000) / 10000
}

function renderMarkdown(result, jsonPath) {
  const rows = result.summary.map((item, index) =>
    `| ${index + 1} | ${item.provider} | ${percent(item.avgScore)} | ${percent(item.avgCoverage)} | ${percent(item.avgPrecisionProxy)} | ${percent(item.avgRejectedHitRate)} | ${Math.round(item.avgElapsedMs)} | ${Math.round(item.avgTagCount)} | ${item.okSamples}/${item.totalSamples} |`
  ).join('\n')
  const sampleRows = result.rows.map((row) =>
    `| ${row.sampleId} | ${row.provider} | ${row.ok ? 'PASS' : 'FAIL'} | ${percent(row.score)} | ${percent(row.coverage)} | ${percent(row.precisionProxy)} | ${row.rejectedHits}/${row.rejectedTotal} | ${row.expectedHits}/${row.expectedTotal} | ${row.topTags.slice(0, 8).join(', ')} |`
  ).join('\n')
  const best = result.summary[0]
  const jsonRel = path.relative(process.cwd(), jsonPath).replace(/\\/g, '/')
  const history = result.historyReview
  const topRejected = history.topRejectedTags.length > 0
    ? history.topRejectedTags.slice(0, 12).map((item) => `${item.tag} (${item.count})`).join(', ')
    : 'なし'
  const blacklistCandidates = history.blacklistCandidates.length > 0
    ? history.blacklistCandidates.slice(0, 16).map((item) => item.tag).join(', ')
    : 'なし'
  const threshold = history.thresholdTuning.available
    ? `${history.thresholdTuning.recommendedMinScore}`
    : '未算出'
  return `# Tagger Accuracy Comparison - 2026-05-14

## 結論

固定QA画像 ${result.samples.length - history.includedSamples}件と保存済みHistoryレビュー ${history.includedSamples}件、合計 ${result.samples.length}件に対し、期待タグと除外タグを基準に比較した。
これは正式な人手ラベル付きベンチマークではなく、Yoitomoshi Art Generatorの実運用で「プロンプト補助に使いやすいタグが返るか」を見るための実用精度比較である。

現時点の総合1位は **${best.provider}**。平均スコアは **${percent(best.avgScore)}**、期待ラベル回収率は **${percent(best.avgCoverage)}**。
詳細な出力JSONは \`${jsonRel}\` に保存した。

Historyレビューからは ${history.includedSamples}件を評価に取り込んだ。頻出除外タグ候補は **${blacklistCandidates}**。PixAIの推奨最低confidenceは **${threshold}**。

## 評価方法

- Coverage: 期待ラベル群のうち、上位出力タグで拾えた割合。
- Precision proxy: 上位25タグのうち、期待ラベル群に当たった割合。
- Rejected hit rate: 履歴レビューで除外タグに入れたタグが出力に混ざった割合。低いほど良い。
- Score: 固定QAは \`0.7 * Coverage + 0.3 * Precision proxy\`。履歴レビューは \`0.6 * Coverage + 0.25 * Precision proxy + 0.15 * Rejected avoidance\`。
- CLIPは自然文captionのため、タグ抽出器と同列ではなく参考値として扱う。
- 成人向け/露骨な履歴画像の内容文面をレポートに展開しないため、比較はQA素材中心で実施した。

## サマリー

| Rank | Provider | Score | Coverage | Precision proxy | Rejected hit | Avg elapsed ms | Avg tags | Samples |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows}

## Historyレビュー反映

- History index: \`${path.relative(process.cwd(), history.indexPath).replace(/\\/g, '/')}\`
- Reviewed items: ${history.reviewedItems} / ${history.totalHistoryItems}
- Included samples: ${history.includedSamples}
- Top rejected tags: ${topRejected}
- Suggested blacklist candidates: ${blacklistCandidates}
- PixAI recommended minimum confidence: ${threshold}

## サンプル別

| Sample | Provider | Status | Score | Coverage | Precision proxy | Rejected | Hits | Top tags |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
${sampleRows}

## 判定

- **既定候補**: \`${best.provider}\`。今回の固定QAサンプルでは最も期待ラベルを拾った。
- **UI方針**: PixAI/WD14/DeepDanbooruを切り替え比較できるUIは有効。CLIPは自然文説明として別枠にするのが扱いやすい。
- **次の改善**: Historyレビューが増えるほど、blacklist候補と最低confidenceの推奨値を実データで更新できる。除外タグが2回以上出たものから既定blacklistへ昇格するのが低リスク。

## 実行環境

- PixAI ONNX: \`runtime/forge/webui/models/Tagger/model.onnx\`
- PixAI tags: \`runtime/forge/webui/models/Tagger/selected_tags.csv\`
- Forge API: \`${result.forge.url}\` (${result.forge.ready ? 'ready' : 'not ready'})
- WD14 models: ${result.wd14Models.length > 0 ? result.wd14Models.join(', ') : 'not available'}
`
}

function percent(value) {
  return `${Math.round(value * 1000) / 10}%`
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
