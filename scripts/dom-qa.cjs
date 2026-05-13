#!/usr/bin/env node

const DEFAULT_PORT = Number(process.env.QA_CDP_PORT || 9338)
const COMMANDS = new Set([
  'preflight-mismatch',
  'selectors',
  'p2-fixture',
  'api-surface',
  'tagger-smoke',
  'tagger-blacklist-filter',
  'partial-delete-smoke',
  'history-tag-review',
  'history-review-persistence',
  'history-review-prompt-bridge',
  'history-review-report-source',
  'prompt-helper-review-tags'
])

async function main() {
  const { command, port } = parseArgs(process.argv.slice(2))
  if (!COMMANDS.has(command)) {
    printUsage()
    process.exit(command === 'help' ? 0 : 1)
  }

  const cdp = await connectCdp(port)
  try {
    if (command === 'selectors') {
      const result = await evaluate(cdp, selectorsExpression())
      printResult(result)
      return
    }
    if (command === 'p2-fixture') {
      const result = await evaluate(cdp, p2FixtureExpression())
      printResult(result)
      return
    }
    if (command === 'api-surface') {
      const result = await evaluate(cdp, apiSurfaceExpression())
      printResult(result)
      return
    }
    if (command === 'tagger-smoke') {
      const result = await evaluate(cdp, taggerSmokeExpression())
      printResult(result)
      return
    }
    if (command === 'tagger-blacklist-filter') {
      const result = await evaluate(cdp, taggerBlacklistFilterExpression())
      printResult(result)
      return
    }
    if (command === 'partial-delete-smoke') {
      const result = await evaluate(cdp, partialDeleteSmokeExpression())
      printResult(result)
      return
    }
    if (command === 'history-tag-review') {
      const result = await evaluate(cdp, historyTagReviewExpression())
      printResult(result)
      return
    }
    if (command === 'history-review-persistence') {
      const setup = await evaluate(cdp, historyReviewPersistenceSetupExpression())
      if (!setup?.historyId) {
        printResult(setup)
        return
      }
      await cdp.send('Page.enable')
      await cdp.send('Page.reload', { ignoreCache: true })
      await sleep(2500)
      const result = await evaluate(cdp, historyReviewPersistenceCheckExpression(setup.historyId, setup.previousReview ?? null))
      printResult(result)
      return
    }
    if (command === 'history-review-prompt-bridge') {
      const result = await evaluate(cdp, historyReviewPromptBridgeExpression())
      printResult(result)
      return
    }
    if (command === 'history-review-report-source') {
      const result = await evaluate(cdp, historyReviewReportSourceExpression())
      printResult(result)
      return
    }
    if (command === 'prompt-helper-review-tags') {
      const result = await evaluate(cdp, promptHelperReviewTagsExpression())
      printResult(result)
      return
    }
    const result = await evaluate(cdp, preflightMismatchExpression())
    printResult(result)
  } finally {
    cdp.ws.close()
  }
}

function parseArgs(args) {
  let command = 'preflight-mismatch'
  let port = DEFAULT_PORT
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') return { command: 'help', port }
    if (arg.startsWith('--port=')) {
      port = Number(arg.slice('--port='.length))
      continue
    }
    if (/^\d+$/.test(arg)) {
      port = Number(arg)
      continue
    }
    command = arg
  }
  if (!Number.isInteger(port) || port <= 0) throw new Error(`Invalid CDP port: ${port}`)
  return { command, port }
}

function printUsage() {
  console.log(`Usage:
  node scripts/dom-qa.cjs [preflight-mismatch] [--port=9338]
  node scripts/dom-qa.cjs selectors [--port=9338]
  node scripts/dom-qa.cjs p2-fixture [--port=9338]
  node scripts/dom-qa.cjs api-surface [--port=9338]
  node scripts/dom-qa.cjs tagger-smoke [--port=9338]
  node scripts/dom-qa.cjs tagger-blacklist-filter [--port=9338]
  node scripts/dom-qa.cjs partial-delete-smoke [--port=9338]
  node scripts/dom-qa.cjs history-tag-review [--port=9338]
  node scripts/dom-qa.cjs history-review-persistence [--port=9338]
  node scripts/dom-qa.cjs history-review-prompt-bridge [--port=9338]
  node scripts/dom-qa.cjs history-review-report-source [--port=9338]
  node scripts/dom-qa.cjs prompt-helper-review-tags [--port=9338]

Prerequisite:
  Start Electron with --remote-debugging-port=<port> before running this script.
`)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function connectCdp(port) {
  const listUrl = `http://127.0.0.1:${port}/json/list`
  let targets
  try {
    targets = await (await fetch(listUrl)).json()
  } catch (error) {
    throw new Error(`Could not connect to Electron CDP on ${listUrl}: ${error.message}`)
  }
  const page = targets.find((target) => target.type === 'page')
  if (!page?.webSocketDebuggerUrl) {
    throw new Error(`No page target found on Electron CDP port ${port}`)
  }

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

function printResult(result) {
  console.log(JSON.stringify(result, null, 2))
}

function selectorsExpression() {
  return `(() => {
    const ids = [
      'main-tab-txt2img',
      'main-tab-tools',
      'side-tab-library',
      'side-tab-lora',
      'preflight-panel',
      'preflight-summary',
      'generate-button',
      'prompt-positive-section',
      'prompt-negative-section',
      'parameters-panel',
      'controlnet-builder-panel',
      'controlnet-panel',
      'fabric-panel',
      'adetailer-panel'
    ]
    const selectors = Object.fromEntries(ids.map((id) => [id, Boolean(document.querySelector('[data-testid="' + id + '"]'))]))
    return {
      ok: Object.values(selectors).every(Boolean),
      selectors
    }
  })()`
}

function apiSurfaceExpression() {
  return `(() => {
    const tools = window.api?.tools || {}
    const surface = {
      checkLibraryIntegrity: typeof tools.checkLibraryIntegrity === 'function',
      deletePartialFile: typeof tools.deletePartialFile === 'function',
      runTagger: typeof tools.runTagger === 'function',
      saveWorkspace: typeof window.api?.storage?.saveWorkspace === 'function'
    }
    return {
      ok: Object.values(surface).every(Boolean),
      surface
    }
  })()`
}

function taggerSmokeExpression() {
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
  return `(async () => {
    const result = await window.api.tools.runTagger({
      image: ${JSON.stringify(tinyPng)},
      modelId: 'pixai-onnx',
      generalThreshold: 0.3,
      characterThreshold: 0.85,
      minScore: 0.4,
      excludeMeta: true,
      blacklist: ['blurry', 'watermark', 'text'],
      limit: 5
    })
    return {
      ok: result.status === 'ok' || result.status === 'missing-model' || result.status === 'missing-runtime',
      status: result.status,
      message: result.message,
      modelDir: result.modelDir,
      modelPath: result.modelPath,
      tagsPath: result.tagsPath,
      tagCount: result.promptTags.length,
      suppressedCount: result.suppressedTags?.length ?? 0,
      filter: result.filter ?? null
    }
  })()`
}

function taggerBlacklistFilterExpression() {
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
  return `(async () => {
    const normalize = (value) => String(value || '')
      .toLowerCase()
      .replace(/\\\\\\(/g, '(')
      .replace(/\\\\\\)/g, ')')
      .replace(/[()[\\]{}]/g, ' ')
      .replace(/[_/-]+/g, ' ')
      .replace(/[^a-z0-9\\s]+/g, ' ')
      .replace(/\\s+/g, ' ')
      .trim()
    const baseReq = {
      image: ${JSON.stringify(tinyPng)},
      modelId: 'pixai-onnx',
      generalThreshold: 0.1,
      characterThreshold: 0.1,
      minScore: 0,
      excludeMeta: false,
      blacklist: [],
      limit: 10
    }
    const baseline = await window.api.tools.runTagger(baseReq)
    if (baseline.status !== 'ok' || baseline.promptTags.length === 0) {
      return {
        ok: baseline.status === 'ok' || baseline.status === 'missing-model' || baseline.status === 'missing-runtime',
        status: baseline.status,
        message: baseline.message,
        baselineTagCount: baseline.promptTags.length
      }
    }
    const target = baseline.promptTags[0]
    const filtered = await window.api.tools.runTagger({ ...baseReq, blacklist: [target] })
    const targetKey = normalize(target)
    const promptHasTarget = filtered.promptTags.some((tag) => normalize(tag) === targetKey)
    const suppressedHasTarget = (filtered.suppressedTags || []).some((tag) => normalize(tag.name) === targetKey && tag.reason === 'blacklist')
    return {
      ok: filtered.status === 'ok' && !promptHasTarget && suppressedHasTarget,
      status: filtered.status,
      target,
      baselineTagCount: baseline.promptTags.length,
      filteredTagCount: filtered.promptTags.length,
      promptHasTarget,
      suppressedHasTarget,
      filter: filtered.filter || null
    }
  })()`
}

function partialDeleteSmokeExpression() {
  return `(async () => {
    const before = await window.api.tools.checkLibraryIntegrity()
    const issue = before.issues.find((item) =>
      item.path &&
      item.path.toLowerCase().includes('.partial') &&
      item.path.includes('yoitomoshi-dom-qa-') &&
      !item.jobId
    )
    if (!issue?.path) {
      return {
        ok: false,
        status: 'missing-test-partial',
        beforeIssues: before.totals.issues
      }
    }
    const deleted = await window.api.tools.deletePartialFile(issue.path)
    const after = await window.api.tools.checkLibraryIntegrity()
    const stillPresent = after.issues.some((item) => item.path === issue.path)
    return {
      ok: deleted.deleted === true && !stillPresent,
      status: 'deleted',
      path: deleted.path,
      sizeBytes: deleted.sizeBytes,
      beforePartials: before.totals.partialDownloads,
      afterPartials: after.totals.partialDownloads
    }
  })()`
}

function historyTagReviewExpression() {
  return `(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const testId = (id) => document.querySelector('[data-testid="' + id + '"]')
    const click = (element) => {
      if (!element) throw new Error('Cannot click missing element')
      element.scrollIntoView({ block: 'center', inline: 'center' })
      const rect = element.getBoundingClientRect()
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        element.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: rect.x + rect.width / 2,
          clientY: rect.y + rect.height / 2
        }))
      }
    }
    const setValue = (element, value) => {
      const descriptor = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')
      descriptor?.set?.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const waitUntil = async (predicate, timeoutMs, label) => {
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        const value = await predicate()
        if (value) return value
        await sleep(200)
      }
      throw new Error('Timed out waiting for ' + label)
    }
    const history = await window.api.storage.listHistory()
    const target = history.find((item) => item.id && item.thumbDataUrl)
    if (!target) {
      return { ok: true, status: 'no-history' }
    }
    const previousReview = target.tagReview ?? null
    try {
      click(await waitUntil(() => testId('side-tab-history'), 10000, 'History side tab'))
      click(await waitUntil(() => testId('history-review-open'), 30000, 'history review open'))
      const panel = await waitUntil(() => testId('history-tag-review-panel'), 10000, 'history tag review panel')
      const accepted = await waitUntil(() => testId('history-review-accepted'), 10000, 'accepted textarea')
      setValue(accepted, 'yoitomoshi qa review tag, blue sky')
      click(await waitUntil(() => testId('history-review-save'), 10000, 'history review save'))
      await waitUntil(async () => {
        const next = await window.api.storage.listHistory()
        const updated = next.find((item) => item.id === target.id)
        return updated?.tagReview?.acceptedTags?.includes('yoitomoshi qa review tag')
      }, 10000, 'saved history tag review')
      return {
        ok: true,
        status: 'saved',
        panel: Boolean(panel),
        historyId: target.id
      }
    } finally {
      await window.api.storage.setHistoryTagReview(target.id, previousReview)
    }
  })()`
}

function historyReviewPersistenceSetupExpression() {
  return `(async () => {
    const history = await window.api.storage.listHistory()
    const target = history.find((item) => item.id && item.thumbDataUrl)
    if (!target) return { ok: true, status: 'no-history' }
    const previousReview = target.tagReview ?? null
    const review = {
      acceptedTags: ['yoitomoshi qa persisted tag', 'blue sky'],
      rejectedTags: ['yoitomoshi qa persisted reject'],
      sourceModel: 'manual',
      updatedAt: Date.now()
    }
    const updated = await window.api.storage.setHistoryTagReview(target.id, review)
    return {
      ok: Boolean(updated?.tagReview?.acceptedTags?.includes('yoitomoshi qa persisted tag')),
      status: 'setup-saved',
      historyId: target.id,
      previousReview
    }
  })()`
}

function historyReviewPersistenceCheckExpression(historyId, previousReview) {
  return `(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const waitUntil = async (predicate, timeoutMs, label) => {
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        try {
          const value = await predicate()
          if (value) return value
        } catch {}
        await sleep(200)
      }
      throw new Error('Timed out waiting for ' + label)
    }
    const historyId = ${JSON.stringify(historyId)}
    const previousReview = ${JSON.stringify(previousReview)}
    await waitUntil(() => window.api?.storage?.listHistory, 15000, 'storage API after reload')
    try {
      const history = await window.api.storage.listHistory()
      const target = history.find((item) => item.id === historyId)
      const persisted = target?.tagReview?.acceptedTags?.includes('yoitomoshi qa persisted tag') === true &&
        target?.tagReview?.rejectedTags?.includes('yoitomoshi qa persisted reject') === true
      return {
        ok: persisted,
        status: persisted ? 'persisted-after-reload' : 'missing-after-reload',
        historyId,
        acceptedTags: target?.tagReview?.acceptedTags || [],
        rejectedTags: target?.tagReview?.rejectedTags || []
      }
    } finally {
      await window.api.storage.setHistoryTagReview(historyId, previousReview)
    }
  })()`
}

function historyReviewPromptBridgeExpression() {
  return `(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const testId = (id) => document.querySelector('[data-testid="' + id + '"]')
    const click = (element) => {
      if (!element) throw new Error('Cannot click missing element')
      element.scrollIntoView({ block: 'center', inline: 'center' })
      const rect = element.getBoundingClientRect()
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        element.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: rect.x + rect.width / 2,
          clientY: rect.y + rect.height / 2
        }))
      }
    }
    const setValue = (element, value) => {
      const descriptor = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')
      descriptor?.set?.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const waitUntil = async (predicate, timeoutMs, label) => {
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        const value = await predicate()
        if (value) return value
        await sleep(200)
      }
      throw new Error('Timed out waiting for ' + label)
    }
    const history = await window.api.storage.listHistory()
    const target = history.find((item) => item.id && item.thumbDataUrl)
    if (!target) return { ok: true, status: 'no-history' }
    click(await waitUntil(() => testId('side-tab-history'), 10000, 'History side tab'))
    click(await waitUntil(() => testId('history-review-open'), 30000, 'history review open'))
    await waitUntil(() => testId('history-tag-review-panel'), 10000, 'history tag review panel')
    const accepted = await waitUntil(() => testId('history-review-accepted'), 10000, 'accepted textarea')
    const rejected = await waitUntil(() => testId('history-review-rejected'), 10000, 'rejected textarea')
    const promptTextarea = await waitUntil(() => testId('prompt-positive-section')?.querySelector('textarea'), 10000, 'positive prompt textarea')
    const negativeTextarea = await waitUntil(() => testId('prompt-negative-section')?.querySelector('textarea'), 10000, 'negative prompt textarea')
    const previousPrompt = promptTextarea.value
    const previousNegative = negativeTextarea.value
    try {
      setValue(accepted, 'yoitomoshi qa bridge accepted')
      setValue(rejected, 'yoitomoshi qa bridge rejected')
      click(await waitUntil(() => testId('history-review-append-prompt'), 10000, 'append prompt button'))
      click(await waitUntil(() => testId('history-review-append-negative'), 10000, 'append negative button'))
      await waitUntil(() => promptTextarea.value.includes('yoitomoshi qa bridge accepted'), 10000, 'accepted tag in prompt')
      await waitUntil(() => negativeTextarea.value.includes('yoitomoshi qa bridge rejected'), 10000, 'rejected tag in negative')
      return {
        ok: true,
        status: 'prompt-bridged',
        promptHasAccepted: promptTextarea.value.includes('yoitomoshi qa bridge accepted'),
        negativeHasRejected: negativeTextarea.value.includes('yoitomoshi qa bridge rejected')
      }
    } finally {
      setValue(promptTextarea, previousPrompt)
      setValue(negativeTextarea, previousNegative)
    }
  })()`
}

function historyReviewReportSourceExpression() {
  return `(async () => {
    const history = await window.api.storage.listHistory()
    const target = history.find((item) => item.id && item.thumbDataUrl)
    if (!target) return { ok: true, status: 'no-history' }
    const previousReview = target.tagReview ?? null
    try {
      await window.api.storage.setHistoryTagReview(target.id, {
        acceptedTags: ['yoitomoshi qa report expected', 'blue sky'],
        rejectedTags: ['yoitomoshi qa report rejected'],
        sourceModel: 'manual',
        updatedAt: Date.now()
      })
      const reviewed = await window.api.storage.listHistory()
      const reviewedItems = reviewed.filter((item) => item.tagReview && (item.tagReview.acceptedTags.length > 0 || item.tagReview.rejectedTags.length > 0))
      const sample = reviewedItems.find((item) => item.id === target.id)
      return {
        ok: sample?.tagReview?.acceptedTags?.includes('yoitomoshi qa report expected') === true &&
          sample?.tagReview?.rejectedTags?.includes('yoitomoshi qa report rejected') === true,
        status: 'report-source-readable',
        reviewedItems: reviewedItems.length,
        historyId: target.id,
        expected: sample?.tagReview?.acceptedTags || [],
        rejected: sample?.tagReview?.rejectedTags || []
      }
    } finally {
      await window.api.storage.setHistoryTagReview(target.id, previousReview)
    }
  })()`
}

function promptHelperReviewTagsExpression() {
  return `(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const testId = (id) => document.querySelector('[data-testid="' + id + '"]')
    const click = (element) => {
      if (!element) throw new Error('Cannot click missing element')
      element.scrollIntoView({ block: 'center', inline: 'center' })
      const rect = element.getBoundingClientRect()
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        element.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: rect.x + rect.width / 2,
          clientY: rect.y + rect.height / 2
        }))
      }
    }
    const setValue = (element, value) => {
      const descriptor = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')
      descriptor?.set?.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const waitUntil = async (predicate, timeoutMs, label) => {
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        const value = await predicate()
        if (value) return value
        await sleep(200)
      }
      throw new Error('Timed out waiting for ' + label)
    }
    const history = await window.api.storage.listHistory()
    const target = history.find((item) => item.id && item.thumbDataUrl)
    if (!target) return { ok: true, status: 'no-history' }
    const previousReview = target.tagReview ?? null
    const promptTextarea = await waitUntil(() => testId('prompt-positive-section')?.querySelector('textarea'), 10000, 'positive prompt textarea')
    const negativeTextarea = await waitUntil(() => testId('prompt-negative-section')?.querySelector('textarea'), 10000, 'negative prompt textarea')
    const previousPrompt = promptTextarea.value
    const previousNegative = negativeTextarea.value
    try {
      await window.api.storage.setHistoryTagReview(target.id, {
        acceptedTags: ['yoitomoshi qa helper accepted'],
        rejectedTags: ['yoitomoshi qa helper rejected'],
        sourceModel: 'manual',
        updatedAt: Date.now()
      })
      click(await waitUntil(() => testId('main-tab-txt2img'), 10000, 'txt2img tab'))
      const panel = await waitUntil(() => testId('prompt-helper-panel'), 10000, 'prompt helper panel')
      if (!testId('prompt-helper-reviewed-tags')) click(await waitUntil(() => testId('prompt-helper-toggle'), 10000, 'prompt helper toggle'))
      await waitUntil(() => testId('prompt-helper-reviewed-tags'), 10000, 'reviewed tags section')
      click(await waitUntil(() => testId('prompt-helper-apply-review-accepted'), 10000, 'apply review accepted'))
      click(await waitUntil(() => testId('prompt-helper-apply-review-rejected'), 10000, 'apply review rejected'))
      await waitUntil(() => promptTextarea.value.includes('yoitomoshi qa helper accepted'), 10000, 'helper accepted in prompt')
      await waitUntil(() => negativeTextarea.value.includes('yoitomoshi qa helper rejected'), 10000, 'helper rejected in negative')
      return {
        ok: true,
        status: 'prompt-helper-reviewed-tags',
        panel: Boolean(panel),
        promptHasAccepted: promptTextarea.value.includes('yoitomoshi qa helper accepted'),
        negativeHasRejected: negativeTextarea.value.includes('yoitomoshi qa helper rejected')
      }
    } finally {
      setValue(promptTextarea, previousPrompt)
      setValue(negativeTextarea, previousNegative)
      await window.api.storage.setHistoryTagReview(target.id, previousReview)
    }
  })()`
}

function p2FixtureExpression() {
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
  const tempPrefix = 'QA DOM P2 fixture temporary'
  const snapshot = {
    imageSaveMode: 'embed',
    currentTab: 'img2img',
    prompt: 'simple landscape, blue sky',
    negativePrompt: 'lowres, blurry',
    params: {
      steps: 1,
      cfgScale: 5,
      width: 512,
      height: 512,
      sampler: 'Euler',
      scheduler: '',
      seed: -1,
      batchSize: 1,
      iterations: 1,
      clipSkip: 1,
      denoisingStrength: 0.65
    },
    selectedModelTitle: 'desuCKNXL_v02.safetensors [053fde40f2]',
    selectedVae: 'Automatic',
    activeLoras: [{ name: 'Hands v2.1', weight: 0.8, triggerWords: ['hand'] }],
    inputImageDataUrl: null,
    inputImageFilename: null,
    inpaintMaskImage: null,
    lastImageDataUrl: tinyPng,
    upscaleInputImageDataUrl: null,
    upscaleOutputImageDataUrl: null,
    upscale: {},
    controlnet: {
      enabled: true,
      units: [{
        enabled: true,
        module: 'openpose_full',
        model: 'control_v11p_sd15_openpose [cab727d4]',
        image: tinyPng,
        imagePath: null,
        weight: 1,
        guidanceStart: 0,
        guidanceEnd: 1,
        pixelPerfect: true,
        controlMode: 2,
        resizeMode: 1,
        processorRes: 512,
        thresholdA: -1,
        thresholdB: -1
      }]
    },
    regionalPrompter: {},
    fabric: { enabled: false, positive: [], negative: [] },
    adetailer: {
      enabled: false,
      skipImg2img: false,
      units: [{
        model: 'face_yolov8n.pt',
        modelClasses: '',
        prompt: '',
        negativePrompt: '',
        confidence: 0.3,
        denoisingStrength: 0.4,
        maskBlur: 4,
        inpaintOnlyMaskedPadding: 32,
        dilateErode: 4
      }]
    },
    dynThres: { enabled: false },
    freeu: { enabled: false }
  }

  return `(async () => {
    const tempPrefix = ${JSON.stringify(tempPrefix)}
    const snapshot = ${JSON.stringify(snapshot)}
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const testId = (id) => document.querySelector('[data-testid="' + id + '"]')
    const textOf = (node) => node?.textContent || ''
    const click = (element) => {
      if (!element) throw new Error('Cannot click missing element')
      element.scrollIntoView({ block: 'center', inline: 'center' })
      const rect = element.getBoundingClientRect()
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        element.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: rect.x + rect.width / 2,
          clientY: rect.y + rect.height / 2
        }))
      }
    }
    const waitUntil = async (predicate, timeoutMs, label) => {
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        const value = predicate()
        if (value) return value
        await sleep(200)
      }
      throw new Error('Timed out waiting for ' + label)
    }
    const cleanupTempWorkspaces = async () => {
      const workspaces = await window.api.storage.listWorkspaces()
      for (const workspace of workspaces.filter((item) => item.name.startsWith(tempPrefix))) {
        await window.api.storage.deleteWorkspace(workspace.id)
      }
    }

    let saved = null
    await cleanupTempWorkspaces()
    try {
      click(await waitUntil(() => testId('main-tab-txt2img'), 10000, 'txt2img tab'))
      click(await waitUntil(() => testId('side-tab-lora'), 10000, 'LoRA side tab'))
      await waitUntil(() => {
        const text = document.body.innerText || ''
        return text.includes('ZImageTurbo') && text.includes('cinematic realistic style') && text.includes('hand')
      }, 90000, 'Hands v2.1 metadata')

      saved = await window.api.storage.saveWorkspace({
        name: tempPrefix + ' ' + Date.now(),
        snapshot
      })
      click(await waitUntil(() => testId('main-tab-tools'), 10000, 'Tools tab'))
      click(await waitUntil(() => testId('workspace-restore-' + saved.id), 10000, 'workspace restore button'))

      const requiredWarnings = ['lora-base', 'lora-trigger', 'sdxl-size', 'cn-base-0']
      await waitUntil(() => requiredWarnings.every((key) => testId('preflight-item-' + key)), 10000, 'P2 warning items')
      const generateButton = await waitUntil(() => testId('generate-button'), 10000, 'generate button')
      const beforeDisabled = generateButton.disabled
      const beforeReason = generateButton.getAttribute('data-disabled-reason') || ''
      const preflightBefore = Object.fromEntries(requiredWarnings.map((key) => {
        const node = testId('preflight-item-' + key)
        return [key, {
          exists: Boolean(node),
          text: textOf(node),
          severity: node?.getAttribute('data-preflight-severity') || null,
          canFix: node?.getAttribute('data-preflight-can-fix') || null
        }]
      }))

      click(await waitUntil(() => testId('preflight-open-lora-trigger'), 10000, 'preflight open lora trigger'))
      await sleep(500)
      const promptSectionVisible = Boolean(testId('prompt-positive-section'))
      click(await waitUntil(() => testId('preflight-fix-lora-trigger'), 10000, 'preflight lora trigger quick fix'))
      await waitUntil(() => (document.body.innerText || '').includes('hand'), 10000, 'trigger word added to prompt')
      click(await waitUntil(() => testId('preflight-fix-sdxl-size'), 10000, 'preflight sdxl size quick fix'))
      await waitUntil(() => !testId('preflight-item-sdxl-size'), 10000, 'sdxl size warning cleared')

      click(await waitUntil(() => testId('main-tab-tools'), 10000, 'Tools tab after quick fixes'))
      const taggerPanel = await waitUntil(() => testId('tagger-catalog'), 10000, 'tagger catalog')
      const apiSurface = {
        runTagger: typeof window.api.tools.runTagger === 'function',
        deletePartialFile: typeof window.api.tools.deletePartialFile === 'function',
        checkLibraryIntegrity: typeof window.api.tools.checkLibraryIntegrity === 'function'
      }
      click(await waitUntil(() => testId('tool-section-library-toggle'), 10000, 'library section toggle'))
      const libraryCard = await waitUntil(() => testId('model-library-card'), 10000, 'model library card')

      return {
        ok: beforeDisabled && Object.values(apiSurface).every(Boolean) && promptSectionVisible,
        workspaceId: saved.id,
        generate: {
          disabledBeforeQuickFix: beforeDisabled,
          disabledReasonBeforeQuickFix: beforeReason
        },
        preflight: preflightBefore,
        tools: {
          taggerCatalog: Boolean(taggerPanel),
          modelLibraryCard: Boolean(libraryCard),
          apiSurface
        }
      }
    } finally {
      await cleanupTempWorkspaces()
    }
  })()`
}

function preflightMismatchExpression() {
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
  const tempPrefix = 'QA DOM preflight mismatch temporary'
  const snapshot = {
    imageSaveMode: 'embed',
    currentTab: 'txt2img',
    prompt: 'simple landscape, blue sky',
    negativePrompt: 'lowres, blurry',
    params: {
      steps: 1,
      cfgScale: 5,
      width: 512,
      height: 512,
      sampler: 'Euler',
      scheduler: '',
      seed: -1,
      batchSize: 1,
      iterations: 1,
      clipSkip: 1,
      denoisingStrength: 0.65
    },
    selectedModelTitle: 'desuCKNXL_v02.safetensors [053fde40f2]',
    selectedVae: 'Automatic',
    activeLoras: [{ name: 'Hands v2.1', weight: 0.8, triggerWords: ['hand'] }],
    inputImageDataUrl: null,
    inputImageFilename: null,
    inpaintMaskImage: null,
    lastImageDataUrl: null,
    upscaleInputImageDataUrl: null,
    upscaleOutputImageDataUrl: null,
    upscale: {},
    controlnet: {
      enabled: true,
      units: [{
        enabled: true,
        module: 'openpose_full',
        model: 'control_v11p_sd15_openpose [cab727d4]',
        image: tinyPng,
        imagePath: null,
        weight: 1,
        guidanceStart: 0,
        guidanceEnd: 1,
        pixelPerfect: true,
        controlMode: 2,
        resizeMode: 1,
        processorRes: 512,
        thresholdA: -1,
        thresholdB: -1
      }]
    },
    regionalPrompter: {},
    fabric: { enabled: false, positive: [], negative: [] },
    adetailer: {
      enabled: false,
      skipImg2img: false,
      units: [{
        model: 'face_yolov8n.pt',
        modelClasses: '',
        prompt: '',
        negativePrompt: '',
        confidence: 0.3,
        denoisingStrength: 0.4,
        maskBlur: 4,
        inpaintOnlyMaskedPadding: 32,
        dilateErode: 4
      }]
    },
    dynThres: { enabled: false },
    freeu: { enabled: false }
  }

  return `(async () => {
    const tempPrefix = ${JSON.stringify(tempPrefix)}
    const snapshot = ${JSON.stringify(snapshot)}
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const testId = (id) => document.querySelector('[data-testid="' + id + '"]')
    const click = (element) => {
      if (!element) throw new Error('Cannot click missing element')
      element.scrollIntoView({ block: 'center', inline: 'center' })
      const rect = element.getBoundingClientRect()
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        element.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: rect.x + rect.width / 2,
          clientY: rect.y + rect.height / 2
        }))
      }
    }
    const waitUntil = async (predicate, timeoutMs, label) => {
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        const value = predicate()
        if (value) return value
        await sleep(200)
      }
      throw new Error('Timed out waiting for ' + label)
    }
    const cleanupTempWorkspaces = async () => {
      const workspaces = await window.api.storage.listWorkspaces()
      for (const workspace of workspaces.filter((item) => item.name.startsWith(tempPrefix))) {
        await window.api.storage.deleteWorkspace(workspace.id)
      }
    }

    let saved = null
    await cleanupTempWorkspaces()
    try {
      click(await waitUntil(() => testId('main-tab-txt2img'), 10000, 'txt2img tab'))
      click(await waitUntil(() => testId('side-tab-lora'), 10000, 'LoRA side tab'))
      await waitUntil(() => {
        const text = document.body.innerText || ''
        return text.includes('ZImageTurbo') && text.includes('cinematic realistic style') && text.includes('hand')
      }, 90000, 'Hands v2.1 metadata')

      saved = await window.api.storage.saveWorkspace({
        name: tempPrefix + ' ' + Date.now(),
        snapshot
      })
      click(await waitUntil(() => testId('main-tab-tools'), 10000, 'Tools tab'))
      click(await waitUntil(() => testId('workspace-restore-' + saved.id), 10000, 'workspace restore button'))

      const required = ['lora-base', 'lora-trigger', 'sdxl-size', 'cn-base-0']
      await waitUntil(() => required.every((key) => testId('preflight-item-' + key)), 10000, 'preflight mismatch items')
      const panel = testId('preflight-panel')
      const summary = testId('preflight-summary')
      const items = Object.fromEntries(required.map((key) => {
        const node = testId('preflight-item-' + key)
        return [key, {
          text: node?.innerText || '',
          severity: node?.getAttribute('data-preflight-severity') || null
        }]
      }))
      return {
        ok: true,
        workspaceId: saved.id,
        blockers: Number(panel?.getAttribute('data-preflight-blockers')),
        warnings: Number(panel?.getAttribute('data-preflight-warnings')),
        summary: summary?.innerText || '',
        items
      }
    } finally {
      await cleanupTempWorkspaces()
    }
  })()`
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
