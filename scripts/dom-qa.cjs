#!/usr/bin/env node

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const DEFAULT_PORT = Number(process.env.QA_CDP_PORT || 9338)
const COMMANDS = new Set([
  'preflight-mismatch',
  'selectors',
  'personal-health',
  'p2-fixture',
  'api-surface',
  'forge-core-smoke',
  'forge-controlnet-diagnostic',
  'tagger-smoke',
  'tagger-blacklist-filter',
  'partial-delete-smoke',
  'history-tag-review',
  'history-pro-recipe-review',
  'history-review-persistence',
  'history-review-prompt-bridge',
  'history-review-report-source',
  'candidate-board',
  'reference-board',
  'upscale-finish',
  'prompt-dictionary-workspace',
  'prompt-dictionary-search',
  'prompt-editor-dictionary',
  'prompt-global-autocomplete',
  'prompt-helper-review-tags',
  'prompt-format',
  'prompt-composer',
  'dynamic-prompt',
  'generation-modes',
  'adapter-scan-collision',
  'workspace-preflight',
  'model-auto-organize',
  'model-profile-pro-guidance',
  'model-library-recipe',
  'tag-library-import',
  'prompt-tag-library-add',
  'workspace-sidebar-restore-tab',
  'preview-inspector-toggle'
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
    if (command === 'personal-health') {
      const result = await evaluate(cdp, personalHealthExpression())
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
    if (command === 'forge-core-smoke') {
      const result = await evaluate(cdp, forgeCoreSmokeExpression())
      printResult(result)
      return
    }
    if (command === 'forge-controlnet-diagnostic') {
      const result = await evaluate(cdp, forgeControlNetDiagnosticExpression())
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
      const fixturePath = createPartialDeleteFixture()
      try {
        const result = await evaluate(cdp, partialDeleteSmokeExpression())
        printResult(result)
      } finally {
        if (fs.existsSync(fixturePath)) fs.rmSync(fixturePath, { force: true })
      }
      return
    }
    if (command === 'history-tag-review') {
      const result = await evaluate(cdp, historyTagReviewExpression())
      printResult(result)
      return
    }
    if (command === 'history-pro-recipe-review') {
      const result = await evaluate(cdp, historyProRecipeReviewExpression())
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
    if (command === 'candidate-board') {
      const setup = await evaluate(cdp, candidateBoardSetupExpression())
      if (!setup?.ok || !Array.isArray(setup.ids) || setup.ids.length < 3) {
        printResult(setup)
        return
      }
      await cdp.send('Page.enable')
      await cdp.send('Page.reload', { ignoreCache: true })
      await sleep(2500)
      const result = await evaluate(cdp, candidateBoardCheckExpression(setup.ids))
      printResult(result)
      return
    }
    if (command === 'reference-board') {
      const setup = await evaluate(cdp, referenceBoardSetupExpression())
      if (!setup?.ok || !setup.id) {
        printResult(setup)
        return
      }
      await cdp.send('Page.enable')
      await cdp.send('Page.reload', { ignoreCache: true })
      await sleep(2500)
      const result = await evaluate(cdp, referenceBoardCheckExpression(setup.id))
      printResult(result)
      return
    }
    if (command === 'upscale-finish') {
      const fixture = createUpscaleFinishFixture()
      try {
        const setup = await evaluate(cdp, upscaleFinishSetupExpression())
        if (!setup?.ok) {
          printResult(setup)
          return
        }
        if (!setup.qaMockSet) {
          printResult(setup)
          return
        }
        await setFileInputFiles(cdp, '[data-testid="upscale-input-file"]', [fixture.path])
        const result = await evaluate(cdp, upscaleFinishCheckExpression(setup.startedAt))
        printResult(result)
      } finally {
        fs.rmSync(fixture.dir, { recursive: true, force: true })
      }
      return
    }
    if (command === 'prompt-helper-review-tags') {
      const result = await evaluate(cdp, promptHelperReviewTagsExpression())
      printResult(result)
      return
    }
    if (command === 'prompt-dictionary-search') {
      const result = await evaluate(cdp, promptDictionarySearchExpression())
      printResult(result)
      return
    }
    if (command === 'prompt-dictionary-workspace') {
      const result = await evaluate(cdp, promptDictionaryWorkspaceExpression())
      printResult(result)
      return
    }
    if (command === 'prompt-editor-dictionary') {
      const result = await evaluate(cdp, promptEditorDictionaryExpression())
      printResult(result)
      return
    }
    if (command === 'prompt-global-autocomplete') {
      const result = await evaluate(cdp, promptGlobalAutocompleteExpression())
      printResult(result)
      return
    }
    if (command === 'prompt-format') {
      const result = await evaluate(cdp, promptFormatExpression())
      printResult(result)
      return
    }
    if (command === 'prompt-composer') {
      const result = await evaluate(cdp, promptComposerExpression())
      printResult(result)
      return
    }
    if (command === 'dynamic-prompt') {
      const result = await evaluate(cdp, dynamicPromptExpression())
      printResult(result)
      return
    }
    if (command === 'generation-modes') {
      await cdp.send('Page.enable')
      await cdp.send('Page.reload', { ignoreCache: true })
      await sleep(2500)
      const result = await evaluate(cdp, generationModesExpression())
      printResult(result)
      return
    }
    if (command === 'adapter-scan-collision') {
      const result = await evaluate(cdp, adapterScanCollisionExpression())
      printResult(result)
      return
    }
    if (command === 'workspace-preflight') {
      const result = await evaluate(cdp, workspacePreflightExpression())
      printResult(result)
      return
    }
    if (command === 'model-auto-organize') {
      const result = await evaluate(cdp, modelAutoOrganizeExpression())
      printResult(result)
      return
    }
    if (command === 'model-profile-pro-guidance') {
      const result = await evaluate(cdp, modelProfileProGuidanceExpression())
      printResult(result)
      return
    }
    if (command === 'model-library-recipe') {
      const fixture = createModelLibraryRecipeFixture()
      try {
        await cdp.send('Page.enable')
        await cdp.send('Page.reload', { ignoreCache: true })
        await sleep(2500)
        const result = await evaluate(cdp, modelLibraryRecipeExpression(fixture))
        printResult(result)
      } finally {
        restoreModelLibraryRecipeFixture(fixture)
        await cdp.send('Page.reload', { ignoreCache: true }).catch(() => undefined)
      }
      return
    }
    if (command === 'tag-library-import') {
      const results = []
      for (const format of ['v2', 'legacy']) {
        const fixture = createTagLibraryImportFixture(format)
        try {
          const setup = await evaluate(cdp, tagLibraryImportSetupExpression(fixture))
          if (!setup?.ok) {
            results.push({ ok: false, format, setup })
            continue
          }
          await setFileInputFiles(cdp, '[data-testid="prompt-library-import-input"]', [fixture.path])
          results.push(await evaluate(cdp, tagLibraryImportCheckExpression(fixture)))
        } finally {
          try { await evaluate(cdp, tagLibraryImportCleanupExpression()) } catch {}
          fs.rmSync(fixture.dir, { recursive: true, force: true })
        }
      }
      printResult({ ok: results.every((result) => result.ok), results })
      return
    }
    if (command === 'prompt-tag-library-add') {
      const result = await evaluate(cdp, promptTagLibraryAddExpression())
      printResult(result)
      return
    }
    if (command === 'workspace-sidebar-restore-tab') {
      const result = await evaluate(cdp, workspaceSidebarRestoreTabExpression())
      printResult(result)
      return
    }
    if (command === 'preview-inspector-toggle') {
      const result = await evaluate(cdp, previewInspectorToggleExpression())
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
  node scripts/dom-qa.cjs personal-health [--port=9338]
  node scripts/dom-qa.cjs p2-fixture [--port=9338]
  node scripts/dom-qa.cjs api-surface [--port=9338]
  node scripts/dom-qa.cjs forge-core-smoke [--port=9338]
  node scripts/dom-qa.cjs forge-controlnet-diagnostic [--port=9338]
  node scripts/dom-qa.cjs tagger-smoke [--port=9338]
  node scripts/dom-qa.cjs tagger-blacklist-filter [--port=9338]
  node scripts/dom-qa.cjs partial-delete-smoke [--port=9338]
  node scripts/dom-qa.cjs history-tag-review [--port=9338]
  node scripts/dom-qa.cjs history-pro-recipe-review [--port=9338]
  node scripts/dom-qa.cjs history-review-persistence [--port=9338]
  node scripts/dom-qa.cjs history-review-prompt-bridge [--port=9338]
  node scripts/dom-qa.cjs history-review-report-source [--port=9338]
  node scripts/dom-qa.cjs candidate-board [--port=9338]
  node scripts/dom-qa.cjs reference-board [--port=9338]
  node scripts/dom-qa.cjs upscale-finish [--port=9338]
  node scripts/dom-qa.cjs prompt-dictionary-workspace [--port=9338]
  node scripts/dom-qa.cjs prompt-dictionary-search [--port=9338]
  node scripts/dom-qa.cjs prompt-editor-dictionary [--port=9338]
  node scripts/dom-qa.cjs prompt-global-autocomplete [--port=9338]
  node scripts/dom-qa.cjs prompt-helper-review-tags [--port=9338]
  node scripts/dom-qa.cjs prompt-format [--port=9338]
  node scripts/dom-qa.cjs prompt-composer [--port=9338]
  node scripts/dom-qa.cjs dynamic-prompt [--port=9338]
  node scripts/dom-qa.cjs generation-modes [--port=9338]
  node scripts/dom-qa.cjs adapter-scan-collision [--port=9338]
  node scripts/dom-qa.cjs workspace-preflight [--port=9338]
  node scripts/dom-qa.cjs model-auto-organize [--port=9338]
  node scripts/dom-qa.cjs model-profile-pro-guidance [--port=9338]
  node scripts/dom-qa.cjs model-library-recipe [--port=9338]
  node scripts/dom-qa.cjs tag-library-import [--port=9338]
  node scripts/dom-qa.cjs prompt-tag-library-add [--port=9338]
  node scripts/dom-qa.cjs workspace-sidebar-restore-tab [--port=9338]
  node scripts/dom-qa.cjs preview-inspector-toggle [--port=9338]

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

async function setFileInputFiles(cdp, selector, files) {
  await cdp.send('DOM.enable')
  const documentResponse = await cdp.send('DOM.getDocument', { depth: 1, pierce: true })
  if (documentResponse.error) throw new Error(documentResponse.error.message)
  const nodeResponse = await cdp.send('DOM.querySelector', {
    nodeId: documentResponse.result.root.nodeId,
    selector
  })
  if (nodeResponse.error) throw new Error(nodeResponse.error.message)
  const nodeId = nodeResponse.result?.nodeId
  if (!nodeId) throw new Error(`File input not found: ${selector}`)
  const fileResponse = await cdp.send('DOM.setFileInputFiles', { nodeId, files })
  if (fileResponse.error) throw new Error(fileResponse.error.message)
}

function createTagLibraryImportFixture(format) {
  const id = Date.now().toString(36)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoitomoshi-tag-import-'))
  const fixture = {
    format,
    dir,
    path: path.join(dir, `tag-library-import-${format}.json`),
    categoryName: `QA Import ${id}`,
    groupName: 'QA import group',
    tagName: `qa_import_tag_${id}`,
    alias: `qa_import_alias_${id}`
  }
  const categories = [
    {
      name: fixture.categoryName,
      groups: [
        {
          name: fixture.groupName,
          color: 'rgba(124, 140, 255, .35)',
          tags: [
            {
              en: fixture.tagName,
              ja: 'QA取込タグ',
              canonical: fixture.tagName,
              aliases: [fixture.alias],
              polarity: 'positive',
              modelFamilies: ['sdxl'],
              source: [{ kind: 'import', confidence: 1 }],
              usage: { count: 0, lastUsedAt: null }
            },
            {
              en: fixture.tagName,
              ja: '重複QAタグ',
              aliases: [fixture.alias]
            },
            {
              ja: 'missing en'
            }
          ]
        }
      ]
    }
  ]
  const document = format === 'legacy'
    ? categories
    : { schemaVersion: 2, updatedAt: new Date().toISOString(), categories }
  fs.writeFileSync(fixture.path, JSON.stringify(document, null, 2), 'utf8')
  return fixture
}

function createPartialDeleteFixture() {
  const forgePath = readQaForgePath()
  const modelDir = path.join(forgePath, 'webui', 'models', 'Stable-diffusion')
  fs.mkdirSync(modelDir, { recursive: true })
  const fixturePath = path.join(modelDir, `yoitomoshi-dom-qa-${Date.now()}.safetensors.partial`)
  fs.writeFileSync(fixturePath, 'yoitomoshi partial delete qa fixture', 'utf8')
  return fixturePath
}

function createUpscaleFinishFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoitomoshi-upscale-finish-'))
  const imagePath = path.join(dir, 'upscale-finish-input.png')
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAATklEQVR4nO3PQQ3AIBDAwJx/6a0NwQkU9KQF7c1m5v5mVwC8JwEJSEACEpCABCSgAQlIQAI6QDc4t1v7o2D3j7rffgIQkIAEJCCBCRy3hQFqPwEV0wAAAABJRU5ErkJggg=='
  fs.writeFileSync(imagePath, Buffer.from(pngBase64, 'base64'))
  return { dir, path: imagePath, pngBase64 }
}

function readQaForgePath() {
  const settingsPath = path.join(process.cwd(), 'userdata', 'settings.json')
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, ''))
    if (typeof settings.forgePath === 'string' && settings.forgePath.trim()) {
      return settings.forgePath
    }
  } catch {}
  return path.join(process.cwd(), 'runtime', 'forge')
}

function createModelLibraryRecipeFixture() {
  const modelVersionId = 123456789
  const modelLibraryDir = path.join(process.cwd(), 'userdata', 'model-library')
  const civitaiDir = path.join(process.cwd(), 'userdata', 'civitai')
  const indexPath = path.join(modelLibraryDir, 'index.json')
  const communityPath = path.join(civitaiDir, `community-${modelVersionId}.json`)
  fs.mkdirSync(modelLibraryDir, { recursive: true })
  fs.mkdirSync(civitaiDir, { recursive: true })
  const originalIndex = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : null
  const originalCommunity = fs.existsSync(communityPath) ? fs.readFileSync(communityPath, 'utf8') : null
  const now = Date.now()
  let existing = []
  try {
    existing = originalIndex ? JSON.parse(originalIndex) : []
    if (!Array.isArray(existing)) existing = []
  } catch {
    existing = []
  }
  const entry = {
    id: 'qa-civitai-recipe-entry',
    name: 'qa-civitai-recipe-lora.safetensors',
    type: 'LORA',
    path: path.join(process.cwd(), 'runtime', 'qa-civitai-recipe-lora.safetensors'),
    sizeBytes: 123456,
    sha256: 'a'.repeat(64),
    source: 'civitai',
    installedAt: now,
    lastSeenAt: now,
    lastModifiedAt: now,
    sourceMeta: {
      provider: 'civitai',
      name: 'QA Civitai Recipe LoRA',
      pageUrl: 'https://civitai.com/models/123?modelVersionId=123456789',
      thumbnailUrl: null,
      expectedSha256: 'a'.repeat(64),
      modelId: 123,
      modelVersionId,
      versionName: 'QA recipe version',
      baseModel: 'SDXL 1.0',
      description: 'QA fixture for Civitai recipe hints.',
      tags: ['style'],
      trainedWords: ['qa_trigger_word'],
      recommendedPrompts: ['qa cinematic lighting, clean lineart']
    },
    favorite: false,
    notes: '',
    civitai: {
      url: 'https://civitai.com/models/123?modelVersionId=123456789',
      expectedSha256: 'a'.repeat(64)
    }
  }
  fs.writeFileSync(
    indexPath,
    JSON.stringify([entry, ...existing.filter((item) => item?.id !== entry.id)], null, 2),
    'utf8'
  )
  fs.writeFileSync(
    communityPath,
    JSON.stringify({
      modelVersionId,
      sampleCount: 20,
      fetchedAt: now,
      topSamplers: [{ name: 'DPM++ 2M Karras', freq: 12 }],
      stepsDist: { n: 20, median: 28, q1: 24, q3: 32, min: 18, max: 40 },
      cfgDist: { n: 20, median: 6.5, q1: 5.5, q3: 7.5, min: 4, max: 9 },
      clipSkipDist: { n: 20, median: 2, q1: 2, q3: 2, min: 1, max: 2 },
      topSizes: [{ width: 832, height: 1216, freq: 10 }],
      topLoras: [{ name: 'qa_recipe_helper_lora', freq: 9, medianWeight: 0.75, civitai: null }],
      topVaes: [{ name: 'qa_recipe_vae.safetensors', freq: 8, civitai: null }],
      commonPositivePhrases: [{ phrase: 'clean lineart', freq: 12 }],
      commonNegativePhrases: [{ phrase: 'bad hands', freq: 10 }]
    }, null, 2),
    'utf8'
  )
  return { indexPath, communityPath, originalIndex, originalCommunity, modelVersionId }
}

function restoreModelLibraryRecipeFixture(fixture) {
  if (fixture.originalIndex == null) fs.rmSync(fixture.indexPath, { force: true })
  else fs.writeFileSync(fixture.indexPath, fixture.originalIndex, 'utf8')
  if (fixture.originalCommunity == null) fs.rmSync(fixture.communityPath, { force: true })
  else fs.writeFileSync(fixture.communityPath, fixture.originalCommunity, 'utf8')
}

function printResult(result) {
  console.log(JSON.stringify(result, null, 2))
}

function selectorsExpression() {
  return `(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const waitUntil = async (predicate, timeoutMs, label) => {
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        const value = await predicate()
        if (value) return value
        await sleep(100)
      }
      throw new Error('Timed out waiting for ' + label)
    }
    document.querySelector('[data-testid="main-tab-txt2img"]')?.click()
    await sleep(100)
    const baseIds = [
      'main-tab-txt2img',
      'main-tab-dictionary',
      'main-tab-tags',
      'main-tab-video',
      'main-tab-models',
      'main-tab-tools',
      'side-tab-library',
      'side-tab-lora',
      'side-tab-history',
      'preflight-panel',
      'preflight-summary',
      'generate-button',
      'prompt-positive-section',
      'prompt-negative-section',
      'prompt-positive-editor',
      'prompt-negative-editor',
      'prompt-composer',
      'prompt-composer-primary',
      'prompt-composer-translate',
      'prompt-composer-model-tune',
      'prompt-composer-dictionary',
      'prompt-dictionary-panel',
      'prompt-dictionary-toggle',
      'prompt-format-positive',
      'prompt-format-negative',
      'prompt-positive-tags',
      'prompt-negative-tags',
      'active-feature-summary',
      'generation-panel-basic',
      'generation-panel-prompt',
      'generation-panel-extensions',
      'parameters-panel',
    ]
    const requiredSelectorIds = [...baseIds]
    const selectors = Object.fromEntries(baseIds.map((id) => [id, Boolean(document.querySelector('[data-testid="' + id + '"]'))]))
    document.querySelector('[data-testid="main-tab-dictionary"]')?.click()
    await waitUntil(() => document.querySelector('[data-testid="prompt-dictionary-workspace"]'), 10000, 'dictionary workspace')
    const dictionaryIds = [
      'prompt-dictionary-workspace',
      'prompt-dictionary-workspace-search',
      'prompt-dictionary-workspace-stats',
      'prompt-dictionary-synergy-panel',
      'prompt-dictionary-meaning-review-panel',
      'prompt-dictionary-source-panel',
    ]
    for (const id of dictionaryIds) {
      selectors[id] = Boolean(document.querySelector('[data-testid="' + id + '"]'))
      requiredSelectorIds.push(id)
    }
    document.querySelector('[data-testid="main-tab-tags"]')?.click()
    await waitUntil(() => document.querySelector('[data-testid="tags-workspace-library"]'), 10000, 'tags workspace')
    const tagIds = [
      'tags-workspace-library',
      'tags-workspace-composer',
      'tags-workspace-quick-add',
      'tags-workspace-positive',
      'tags-workspace-negative',
      'prompt-library-add-tag-button',
      'prompt-library-import-button',
      'prompt-library-recipes',
      'prompt-library-recipes-toggle',
    ]
    for (const id of tagIds) {
      selectors[id] = Boolean(document.querySelector('[data-testid="' + id + '"]'))
      requiredSelectorIds.push(id)
    }
    document.querySelector('[data-testid="prompt-library-recipes-toggle"]')?.click()
    await sleep(100)
    selectors['prompt-library-recipe-character-base'] = Boolean(document.querySelector('[data-testid="prompt-library-recipe-character-base"]'))
    requiredSelectorIds.push('prompt-library-recipe-character-base')
    document.querySelector('[data-testid="prompt-library-add-tag-button"]')?.click()
    await sleep(100)
    selectors['prompt-library-add-tag-panel'] = Boolean(document.querySelector('[data-testid="prompt-library-add-tag-panel"]'))
    document.querySelector('[data-testid="main-tab-video"]')?.click()
    await sleep(1500)
    const videoIds = [
      'video-workspace',
      'video-base-settings',
      'video-smoke-preset',
      'video-preset-row',
      'video-model-resource-panel',
      'video-open-civitai-checkpoints',
      'video-tag-palette',
      'video-generation-panel',
      'video-generation-body',
      'video-runtime-diagnostics',
      'video-framepack-panel',
      'video-source-mode',
      'video-generate-button',
    ]
    for (const id of videoIds) {
      selectors[id] = Boolean(document.querySelector('[data-testid="' + id + '"]'))
      requiredSelectorIds.push(id)
    }
    document.querySelector('[data-testid="main-tab-tools"]')?.click()
    await sleep(1000)
    const requiredToolIds = [
      'tool-section-personal-health-toggle',
      'personal-health-card',
    ]
    const optionalToolIds = [
      'personal-health-recover',
      'personal-health-issues',
      'personal-health-startup-signals',
    ]
    for (const id of requiredToolIds) {
      selectors[id] = Boolean(document.querySelector('[data-testid="' + id + '"]'))
      requiredSelectorIds.push(id)
    }
    for (const id of optionalToolIds) {
      selectors[id] = Boolean(document.querySelector('[data-testid="' + id + '"]'))
    }
    return {
      ok: requiredSelectorIds.every((id) => selectors[id]),
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
      inspectPersonalHealth: typeof tools.inspectPersonalHealth === 'function',
      runPersonalHealthRecovery: typeof tools.runPersonalHealthRecovery === 'function',
      planModelAutoOrganize: typeof tools.planModelAutoOrganize === 'function',
      applyModelAutoOrganize: typeof tools.applyModelAutoOrganize === 'function',
      updateModelLibraryEntry: typeof tools.updateModelLibraryEntry === 'function',
      refreshModelLibraryCivitai: typeof tools.refreshModelLibraryCivitai === 'function',
      refreshModelLibraryCivitaiBatch: typeof tools.refreshModelLibraryCivitaiBatch === 'function',
      runTagger: typeof tools.runTagger === 'function',
      inspectVideoSupport: typeof window.api?.forge?.inspectVideoSupport === 'function',
      inspectVideoRuntime: typeof window.api?.forge?.inspectVideoRuntime === 'function',
      inspectFramePack: typeof window.api?.videoBackends?.inspectFramePack === 'function',
      startFramePack: typeof window.api?.videoBackends?.startFramePack === 'function',
      importLatestFramePackOutput: typeof window.api?.videoBackends?.importLatestFramePackOutput === 'function',
      openVideoModelFolder: typeof window.api?.forge?.openVideoModelFolder === 'function',
      setHistoryProRecipeReview: typeof window.api?.storage?.setHistoryProRecipeReview === 'function',
      listPromptComposerSlotTemplates: typeof window.api?.storage?.listPromptComposerSlotTemplates === 'function',
      savePromptComposerSlotTemplate: typeof window.api?.storage?.savePromptComposerSlotTemplate === 'function',
      deletePromptComposerSlotTemplate: typeof window.api?.storage?.deletePromptComposerSlotTemplate === 'function',
      saveWorkspace: typeof window.api?.storage?.saveWorkspace === 'function',
      saveGeneratedVideo: typeof window.api?.storage?.saveGeneratedVideo === 'function',
      promptDictionarySearch: typeof window.api?.promptDictionary?.search === 'function',
      promptDictionaryListSources: typeof window.api?.promptDictionary?.listSources === 'function',
      promptDictionaryInspectIngest: typeof window.api?.promptDictionary?.inspectIngest === 'function',
      promptTextTranslation: typeof window.api?.translation?.promptText === 'function',
      promptRuntimeStatus: typeof window.api?.translation?.promptRuntimeStatus === 'function'
    }
    return {
      ok: Object.values(surface).every(Boolean),
      surface
    }
  })()`
}

function personalHealthExpression() {
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
    const waitUntil = async (predicate, timeoutMs, label) => {
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        const value = await predicate()
        if (value) return value
        await sleep(200)
      }
      throw new Error('Timed out waiting for ' + label)
    }

    click(await waitUntil(() => testId('main-tab-tools'), 10000, 'Tools tab'))
    await sleep(500)
    let card = testId('personal-health-card')
    if (!card) {
      const toggle = await waitUntil(() => testId('tool-section-personal-health-toggle'), 10000, 'Personal Health toggle')
      for (let attempt = 0; attempt < 3 && !card; attempt++) {
        click(toggle)
        await sleep(800)
        card = testId('personal-health-card')
      }
    }
    if (!card) {
      const toggle = await waitUntil(() => testId('tool-section-personal-health-toggle'), 10000, 'Personal Health toggle')
      click(toggle)
    }
    card = await waitUntil(() => testId('personal-health-card'), 15000, 'Personal Health card')
    const issues = await waitUntil(() => testId('personal-health-issues'), 90000, 'Personal Health issues')
    const signalsPanel = await waitUntil(() => testId('personal-health-startup-signals'), 90000, 'Personal Health startup signals')
    const report = await window.api.tools.inspectPersonalHealth()
    const expectedSignals = ['python', 'extensions', 'controlnet', 'model', 'api']
    const signalIds = (report.startup?.signals ?? []).map((signal) => signal.id)
    const missingSignals = expectedSignals.filter((id) => !signalIds.includes(id))
    const signalText = signalsPanel.textContent || ''
    return {
      ok: Boolean(card) &&
        Boolean(issues) &&
        Boolean(signalsPanel) &&
        typeof window.api.tools.inspectPersonalHealth === 'function' &&
        typeof window.api.tools.runPersonalHealthRecovery === 'function' &&
        missingSignals.length === 0,
      status: 'personal-health-ok',
      settings: {
        parseOk: report.settings?.parseOk === true,
        normalizedChanged: report.settings?.normalizedChanged === true,
        inlineSecretPresent: report.settings?.inlineSecretPresent === true,
        launchPyExists: report.settings?.launchPyExists === true
      },
      downloads: report.downloads,
      processCounts: {
        forge: report.processes?.relatedForgeProcesses?.length ?? null,
        electron: report.processes?.relatedElectronProcesses?.length ?? null
      },
      startup: {
        slowForgeReady: report.startup?.slowForgeReady === true,
        signalIds,
        missingSignals,
        uiHasPython: signalText.includes('Python') || signalText.includes('Torch'),
        uiHasControlNet: signalText.includes('ControlNet'),
        uiHasModel: signalText.includes('Checkpoint') || signalText.includes('VAE')
      }
    }
  })()`
}

function forgeCoreSmokeExpression() {
  return `(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const waitUntil = async (fn, timeoutMs, label) => {
      const started = Date.now()
      let lastError = null
      while (Date.now() - started < timeoutMs) {
        try {
          const value = await fn()
          if (value) return value
        } catch (error) {
          lastError = error
        }
        await sleep(1000)
      }
      throw new Error(label + ' timed out' + (lastError ? ': ' + lastError.message : ''))
    }

    const api = window.api
    if (!api?.forge?.txt2img ||
        !api?.forge?.img2img ||
        !api?.forge?.status ||
        !api?.forge?.listModels ||
        !api?.forge?.listSamplers ||
        !api?.forge?.listSchedulers ||
        !api?.forge?.listUpscalers ||
        !api?.forge?.extraSingleImage ||
        !api?.forge?.listControlnetModels ||
        !api?.forge?.listControlnetModules ||
        !api?.forge?.controlnetDetect) {
      throw new Error('Forge IPC surface is not available')
    }
    const asDataUrl = (image) => String(image || '').startsWith('data:')
      ? String(image)
      : 'data:image/png;base64,' + String(image || '')
    const stripDataUrl = (image) => String(image || '').replace(/^data:image\\/[a-z]+;base64,/, '')
    const hasImage = (image) => typeof image === 'string' && image.length > 100
    const parseInfo = (info) => {
      try { return JSON.parse(info || '{}') } catch { return {} }
    }

    const beforeStatus = await api.forge.status()
    const shouldStopAfter = beforeStatus.kind !== 'ready'
    if (beforeStatus.kind === 'stopped') {
      await api.forge.start()
    }
    const readyStatus = await waitUntil(async () => {
      const status = await api.forge.status()
      if (status.kind === 'error') throw new Error(status.message)
      return status.kind === 'ready' ? status : null
    }, 180000, 'Forge ready')

    const models = await waitUntil(async () => {
      const list = await api.forge.listModels()
      return Array.isArray(list) && list.length > 0 ? list : null
    }, 60000, 'Forge model list')
    const selectedModel =
      models.find((model) => String(model.title || '').includes('pixelstyleckpt_strength07')) ||
      models.find((model) => String(model.title || '').includes('dasiwaAnima_luminousLabyrinthV1')) ||
      models[0]
    const samplers = await api.forge.listSamplers()
    const sampler = samplers.find((item) => item.name === 'Euler')?.name || samplers[0]?.name || 'Euler'
    const schedulers = await api.forge.listSchedulers()
    const scheduler = schedulers.includes('normal') ? 'normal' : schedulers[0]
    const req = {
      prompt: 'yoitomoshi forge regression smoke, simple clean icon',
      negative_prompt: 'lowres, blurry',
      steps: 1,
      cfg_scale: 1,
      width: 128,
      height: 128,
      sampler_name: sampler,
      seed: 123456,
      batch_size: 1,
      n_iter: 1,
      override_settings: {
        sd_model_checkpoint: selectedModel.title
      },
      override_settings_restore_afterwards: true
    }
    if (scheduler) req.scheduler = scheduler

    const txt2img = await api.forge.txt2img(req)
    const txtInfo = parseInfo(txt2img.info)
    const txtImage = Array.isArray(txt2img.images) ? txt2img.images.find(Boolean) : null
    if (!hasImage(txtImage)) throw new Error('Forge txt2img returned no image')

    const img2img = await api.forge.img2img({
      ...req,
      prompt: 'yoitomoshi forge regression img2img smoke, simple clean icon',
      seed: 123457,
      init_images: [stripDataUrl(txtImage)],
      denoising_strength: 0.35,
      resize_mode: 0
    })
    const img2imgInfo = parseInfo(img2img.info)
    const img2imgImage = Array.isArray(img2img.images) ? img2img.images.find(Boolean) : null
    if (!hasImage(img2imgImage)) throw new Error('Forge img2img returned no image')

    const upscalers = await api.forge.listUpscalers()
    const upscaler = upscalers.find((name) => /nearest/i.test(name)) ||
      upscalers.find((name) => name && name !== 'None') ||
      upscalers[0] ||
      'Nearest'
    const upscale = await api.forge.extraSingleImage({
      image: stripDataUrl(txtImage),
      upscaler,
      resize: 2
    })
    if (!hasImage(upscale?.image)) throw new Error('Forge extra-single-image returned no image')

    const controlnetModels = await api.forge.listControlnetModels()
    const controlnetModules = await api.forge.listControlnetModules()
    const controlnetModule = controlnetModules.find((name) => /canny/i.test(name)) ||
      controlnetModules.find((name) => name === 'None') ||
      'None'
    const tileControlnetModel = controlnetModels.find((name) => /tile/i.test(name))
    const tileControlnetModule = controlnetModules.find((name) => /tile_resample|tile/i.test(name))
    const cannyControlnetModel = controlnetModels.find((name) => /canny/i.test(name))
    const preferredControlnetModel = tileControlnetModel ||
      cannyControlnetModel ||
      controlnetModels.find((name) => name && name !== 'None') ||
      'None'
    const preferredControlnetModule = tileControlnetModel && tileControlnetModule
      ? tileControlnetModule
      : /canny/i.test(preferredControlnetModel) && /canny/i.test(controlnetModule)
      ? controlnetModule
      : 'None'
    const controlnetDetect = await api.forge.controlnetDetect({
      image: asDataUrl(txtImage),
      module: controlnetModule,
      processorRes: 128,
      thresholdA: 100,
      thresholdB: 200,
      resizeMode: 1
    })
    if (!hasImage(controlnetDetect?.image)) throw new Error('Forge ControlNet detect returned no image')

    let stoppedAfter = false
    if (shouldStopAfter) {
      await api.forge.stop()
      await waitUntil(async () => {
        const status = await api.forge.status()
        return status.kind === 'stopped' ? status : null
      }, 60000, 'Forge stop')
      stoppedAfter = true
    }

    return {
      ok: true,
      statusBefore: beforeStatus.kind,
      statusReady: readyStatus.kind,
      stoppedAfter,
      port: readyStatus.port ?? null,
      modelCount: models.length,
      selectedModel: selectedModel.title,
      sampler,
      scheduler: scheduler || null,
      txt2img: {
        imageCount: Array.isArray(txt2img.images) ? txt2img.images.length : 0,
        imagePrefix: String(txtImage).slice(0, 24),
        infoSeed: txtInfo.seed ?? null,
        infoModelName: txtInfo.sd_model_name ?? txtInfo.model_name ?? null
      },
      img2img: {
        imageCount: Array.isArray(img2img.images) ? img2img.images.length : 0,
        imagePrefix: String(img2imgImage).slice(0, 24),
        infoSeed: img2imgInfo.seed ?? null
      },
      upscale: {
        upscaler,
        upscalerCount: upscalers.length,
        imagePrefix: String(upscale.image).slice(0, 24)
      },
      controlnet: {
        modelCount: controlnetModels.length,
        moduleCount: controlnetModules.length,
        detectModule: controlnetModule,
        preferredGenerationModel: preferredControlnetModel,
        preferredGenerationModule: preferredControlnetModule,
        detectPrefix: String(controlnetDetect.image).slice(0, 32),
        generationSkipped: true,
        generationSkipReason: 'ControlNet alwayson generation is tracked as a separate regression after payload/model compatibility failures.'
      }
    }
  })()`
}

function forgeControlNetDiagnosticExpression() {
  return `(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const waitUntil = async (fn, timeoutMs, label) => {
      const started = Date.now()
      let lastError = null
      while (Date.now() - started < timeoutMs) {
        try {
          const value = await fn()
          if (value) return value
        } catch (error) {
          lastError = error
        }
        await sleep(1000)
      }
      throw new Error(label + ' timed out' + (lastError ? ': ' + lastError.message : ''))
    }
    const stripDataUrl = (image) => String(image || '').replace(/^data:image\\/[a-z]+;base64,/, '')
    const hasImage = (image) => typeof image === 'string' && image.length > 100
    const parseInfo = (info) => {
      try { return JSON.parse(info || '{}') } catch { return {} }
    }
    const makeInputImage = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 512
      canvas.height = 512
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas is unavailable')
      const gradient = ctx.createLinearGradient(0, 0, 512, 512)
      gradient.addColorStop(0, '#263a77')
      gradient.addColorStop(1, '#f3d37a')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, 512, 512)
      ctx.fillStyle = '#fff8e8'
      ctx.fillRect(144, 96, 224, 320)
      ctx.strokeStyle = '#111111'
      ctx.lineWidth = 18
      ctx.strokeRect(144, 96, 224, 320)
      ctx.beginPath()
      ctx.arc(256, 188, 58, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(256, 248)
      ctx.lineTo(256, 370)
      ctx.moveTo(174, 302)
      ctx.lineTo(338, 302)
      ctx.stroke()
      return canvas.toDataURL('image/png')
    }

    const api = window.api
    if (!api?.forge?.txt2img ||
        !api?.forge?.img2img ||
        !api?.forge?.status ||
        !api?.forge?.listModels ||
        !api?.forge?.listSamplers ||
        !api?.forge?.listSchedulers ||
        !api?.forge?.listControlnetModels ||
        !api?.forge?.listControlnetModules) {
      throw new Error('Forge IPC surface is not available')
    }

    const beforeStatus = await api.forge.status()
    const shouldStopAfter = beforeStatus.kind !== 'ready'
    if (beforeStatus.kind === 'stopped') await api.forge.start()
    const readyStatus = await waitUntil(async () => {
      const status = await api.forge.status()
      if (status.kind === 'error') throw new Error(status.message)
      return status.kind === 'ready' ? status : null
    }, 180000, 'Forge ready')

    const models = await waitUntil(async () => {
      const list = await api.forge.listModels()
      return Array.isArray(list) && list.length > 0 ? list : null
    }, 60000, 'Forge model list')
    const sd15Model =
      models.find((model) => /pixelstyleckpt_strength07/i.test(String(model.title || ''))) ||
      models.find((model) => /dasiwaAnima_luminousLabyrinthV1/i.test(String(model.title || ''))) ||
      models[0]
    const sdxlModel =
      models.find((model) => /novaAnimeXL_ilV190/i.test(String(model.title || ''))) ||
      models.find((model) => /n4mik4|sdxl|xl/i.test(String(model.title || ''))) ||
      sd15Model
    const samplers = await api.forge.listSamplers()
    const sampler = samplers.find((item) => item.name === 'Euler')?.name || samplers[0]?.name || 'Euler'
    const schedulers = await api.forge.listSchedulers()
    const scheduler = schedulers.includes('normal') ? 'normal' : schedulers[0]
    const controlnetModels = await api.forge.listControlnetModels()
    const controlnetModules = await api.forge.listControlnetModules()
    const tileModel = controlnetModels.find((name) => /tile/i.test(name))
    const tileModule = controlnetModules.find((name) => /^tile_resample$/i.test(name)) ||
      controlnetModules.find((name) => /tile/i.test(name))
    const cannyModel = controlnetModels.find((name) => /canny/i.test(name))
    const cannyModule = controlnetModules.find((name) => /^canny$/i.test(name)) ||
      controlnetModules.find((name) => /canny/i.test(name))
    const lineartModel = controlnetModels.find((name) => /lineart|misto/i.test(name))
    const inputDataUrl = makeInputImage()
    const inputRaw = stripDataUrl(inputDataUrl)
    const baseReq = {
      prompt: 'yoitomoshi forge controlnet diagnostic, simple clean icon',
      negative_prompt: 'lowres, blurry',
      steps: 1,
      cfg_scale: 1,
      width: 512,
      height: 512,
      sampler_name: sampler,
      seed: 223344,
      batch_size: 1,
      n_iter: 1,
      override_settings_restore_afterwards: true
    }
    if (scheduler) baseReq.scheduler = scheduler
    const unit = ({ module, model, image, enumStyle = 'number' }) => ({
      enabled: true,
      module,
      model,
      image,
      weight: 0.55,
      resize_mode: enumStyle === 'string' ? 'Crop and Resize' : 1,
      processor_res: 512,
      threshold_a: 100,
      threshold_b: 200,
      guidance_start: 0,
      guidance_end: 1,
      pixel_perfect: false,
      control_mode: enumStyle === 'string' ? 'Balanced' : 0,
      hr_option: enumStyle === 'string' ? 'Both' : 0
    })
    const controlnet = (args) => ({ ControlNet: { args: [args] } })
    const cases = [
      tileModel && tileModule ? {
        id: 'img2img-sdxl-tile-raw',
        endpoint: 'img2img',
        model: sdxlModel.title,
        unit: unit({ module: tileModule, model: tileModel, image: inputRaw })
      } : null,
      tileModel && tileModule ? {
        id: 'img2img-sdxl-tile-data-url',
        endpoint: 'img2img',
        model: sdxlModel.title,
        unit: unit({ module: tileModule, model: tileModel, image: inputDataUrl })
      } : null,
      tileModel && tileModule ? {
        id: 'txt2img-sdxl-tile-data-url',
        endpoint: 'txt2img',
        model: sdxlModel.title,
        unit: unit({ module: tileModule, model: tileModel, image: inputDataUrl })
      } : null,
      lineartModel ? {
        id: 'txt2img-sdxl-lineart-none-data-url-string-enums',
        endpoint: 'txt2img',
        model: sdxlModel.title,
        unit: unit({ module: 'None', model: lineartModel, image: inputDataUrl, enumStyle: 'string' })
      } : null,
      cannyModel && cannyModule ? {
        id: 'txt2img-sd15-canny-raw',
        endpoint: 'txt2img',
        model: sd15Model.title,
        unit: unit({ module: cannyModule, model: cannyModel, image: inputRaw })
      } : null
    ].filter(Boolean)

    const results = []
    for (const testCase of cases) {
      const req = {
        ...baseReq,
        prompt: baseReq.prompt + ', ' + testCase.id,
        seed: baseReq.seed + results.length,
        override_settings: { sd_model_checkpoint: testCase.model },
        alwayson_scripts: controlnet(testCase.unit)
      }
      try {
        const res = testCase.endpoint === 'img2img'
          ? await api.forge.img2img({
              ...req,
              init_images: [inputRaw],
              denoising_strength: 0.35,
              resize_mode: 0
            })
          : await api.forge.txt2img(req)
        const image = Array.isArray(res.images) ? res.images.find(Boolean) : null
        const info = parseInfo(res.info)
        results.push({
          id: testCase.id,
          ok: hasImage(image),
          endpoint: testCase.endpoint,
          checkpoint: testCase.model,
          module: testCase.unit.module,
          model: testCase.unit.model,
          imageKind: String(testCase.unit.image).startsWith('data:') ? 'data-url' : 'raw-base64',
          imageCount: Array.isArray(res.images) ? res.images.length : 0,
          imagePrefix: image ? String(image).slice(0, 24) : '',
          infoSeed: info.seed ?? null
        })
      } catch (error) {
        results.push({
          id: testCase.id,
          ok: false,
          endpoint: testCase.endpoint,
          checkpoint: testCase.model,
          module: testCase.unit.module,
          model: testCase.unit.model,
          imageKind: String(testCase.unit.image).startsWith('data:') ? 'data-url' : 'raw-base64',
          error: error?.message || String(error)
        })
      }
    }

    let stoppedAfter = false
    if (shouldStopAfter) {
      await api.forge.stop()
      await waitUntil(async () => {
        const status = await api.forge.status()
        return status.kind === 'stopped' ? status : null
      }, 60000, 'Forge stop')
      stoppedAfter = true
    }

    const passing = results.filter((result) => result.ok)
    return {
      ok: passing.length > 0,
      statusBefore: beforeStatus.kind,
      statusReady: readyStatus.kind,
      stoppedAfter,
      port: readyStatus.port ?? null,
      checkpointCandidates: {
        sd15: sd15Model.title,
        sdxl: sdxlModel.title
      },
      controlnetCatalog: {
        modelCount: controlnetModels.length,
        moduleCount: controlnetModules.length,
        tileModel: tileModel || null,
        tileModule: tileModule || null,
        lineartModel: lineartModel || null,
        cannyModel: cannyModel || null,
        cannyModule: cannyModule || null
      },
      passingCaseIds: passing.map((result) => result.id),
      results
    }
  })()`
}

function modelAutoOrganizeExpression() {
  return `(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const testId = (id) => document.querySelector('[data-testid="' + id + '"]')
    const click = (element) => {
      if (!element) throw new Error('Cannot click missing element')
      element.scrollIntoView({ block: 'center', inline: 'center' })
      element.click()
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

    click(await waitUntil(() => testId('main-tab-tools'), 10000, 'Tools tab'))
    await sleep(500)
    if (!testId('model-auto-organizer-card')) {
      click(await waitUntil(() => testId('tool-section-auto-organize-toggle'), 10000, 'auto organizer toggle'))
    }
    const card = await waitUntil(() => testId('model-auto-organizer-card'), 10000, 'auto organizer card')
    const previewButton = await waitUntil(() => testId('model-auto-organize-preview'), 10000, 'auto organizer preview')
    const applyButton = await waitUntil(() => testId('model-auto-organize-apply'), 10000, 'auto organizer apply')

    const plan = await window.api.tools.planModelAutoOrganize()
    click(previewButton)
    await waitUntil(() => testId('model-auto-organize-summary'), 20000, 'auto organizer summary')
    const summary = testId('model-auto-organize-summary')
    const list = testId('model-auto-organize-list')

    return {
      ok: Boolean(card) &&
        Boolean(summary) &&
        (plan.items.length === 0 || Boolean(list)) &&
        applyButton.disabled === (plan.totals.movable === 0),
      sourceDir: plan.sourceDir,
      totals: plan.totals,
      ui: {
        card: Boolean(card),
        preview: Boolean(previewButton),
        applyDisabled: Boolean(applyButton.disabled),
        summary: Boolean(summary),
        list: Boolean(list),
        rowCount: card.querySelectorAll('[data-testid^="model-auto-organize-row-"]').length
      },
      sample: plan.items.slice(0, 8).map((item) => ({
        filename: item.filename,
        action: item.action,
        kind: item.detectedKind,
        target: item.targetLabel,
        reason: item.reason
      }))
    }
  })()`
}

function modelProfileProGuidanceExpression() {
  return `(async () => {
    const relatedWorkspacePrefix = 'QA DOM model profile related temporary'
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
      if (!element) throw new Error('Cannot set missing element')
      const proto = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : element instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
      if (setter) setter.call(element, value)
      else element.value = value
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
    const profileMatches = (profile) =>
      profile &&
      profile.baseModel === 'QA Pro SDXL' &&
      profile.promptStyle === 'structured' &&
      profile.negativeStrategy === 'minimal' &&
      profile.recommendedLoraCount?.min === 1 &&
      profile.recommendedLoraCount?.max === 2 &&
      Array.isArray(profile.recommendedAspectRatios) &&
      profile.recommendedAspectRatios.some((ratio) => ratio.label === 'QA Portrait' && ratio.width === 832 && ratio.height === 1216) &&
      profile.relatedModels?.loras?.some((item) => item.name === 'qa_hands_lora' && item.role === 'anatomy' && item.weight === 0.65) &&
      profile.relatedModels?.vaes?.some((item) => item.name === 'qa_color_vae' && item.role === 'color' && item.notes?.includes('QA stable color')) &&
      profile.relatedModels?.controlNets?.some((item) => item.name === 'qa_tile_controlnet' && item.role === 'upscale' && item.weight === 0.5) &&
      Array.isArray(profile.compatibilityNotes) &&
      profile.compatibilityNotes.includes('QA compatibility note') &&
      Array.isArray(profile.recipeNotes) &&
      profile.recipeNotes.includes('QA recipe note')
    const relatedSnapshot = (checkpointTitle) => ({
      imageSaveMode: 'embed',
      currentTab: 'txt2img',
      prompt: 'qa model profile related display',
      negativePrompt: 'lowres, blurry',
      params: {
        steps: 1,
        cfgScale: 5,
        width: 832,
        height: 1216,
        sampler: 'Euler',
        scheduler: '',
        seed: -1,
        batchSize: 1,
        iterations: 1,
        clipSkip: 1,
        denoisingStrength: 0.5
      },
      selectedModelTitle: checkpointTitle,
      selectedVae: 'qa_color_vae',
      activeLoras: [{ name: 'qa_hands_lora', weight: 0.65, triggerWords: [] }],
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
          module: 'tile_resample',
          model: 'qa_tile_controlnet',
          image: null,
          imagePath: null,
          weight: 0.5,
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
    })
    const cleanupRelatedWorkspaces = async () => {
      const workspaces = await window.api.storage.listWorkspaces()
      for (const workspace of workspaces.filter((item) => item.name.startsWith(relatedWorkspacePrefix))) {
        await window.api.storage.deleteWorkspace(workspace.id)
      }
    }

    click(await waitUntil(() => testId('main-tab-models'), 10000, 'Models tab'))
    const card = await waitUntil(() => testId('model-library-card'), 10000, 'model library card')
    let summary = await window.api.tools.listModelLibrary().catch(() => null)
    if (!summary || !summary.entries?.some((entry) => entry.type === 'Checkpoint')) {
      summary = await window.api.tools.rescanModelLibrary().catch(() => summary)
    }
    const checkpointCount = summary?.entries?.filter((entry) => entry.type === 'Checkpoint').length ?? 0
    if (checkpointCount === 0) {
      return {
        ok: true,
        skipped: true,
        reason: 'no-checkpoint-entry',
        totalEntries: summary?.entries?.length ?? 0
      }
    }

    const typeSelect = Array.from(card.querySelectorAll('select'))
      .find((select) => Array.from(select.options).some((option) => option.value === 'Checkpoint'))
    setValue(typeSelect, 'Checkpoint')
    const panel = await waitUntil(() => testId('model-library-checkpoint-prompt-0'), 10000, 'checkpoint prompt profile panel')
    const beforeProfiles = await window.api.storage.listCheckpointPromptProfiles()
    const beforeById = new Map(beforeProfiles.map((profile) => [profile.id, profile]))

    setValue(testId('model-profile-base-model-0'), 'QA Pro SDXL')
    setValue(testId('model-profile-family-0'), 'illustrious')
    setValue(testId('model-profile-mode-0'), 'suggest')
    setValue(testId('model-profile-prompt-style-0'), 'structured')
    setValue(testId('model-profile-negative-strategy-0'), 'minimal')
    setValue(testId('model-profile-lora-min-0'), '1')
    setValue(testId('model-profile-lora-max-0'), '2')
    setValue(testId('model-profile-aspect-ratios-0'), 'QA Portrait 832x1216\\nQA Square 1024x1024')
    setValue(testId('model-profile-related-loras-0'), 'qa_hands_lora | anatomy | 0.65 | QA hand repair')
    setValue(testId('model-profile-related-vaes-0'), 'qa_color_vae | color | | QA stable color')
    setValue(testId('model-profile-related-controlnets-0'), 'qa_tile_controlnet | upscale | 0.5 | QA tile detail')
    setValue(testId('model-profile-compatibility-0'), 'QA compatibility note')
    setValue(testId('model-profile-recipe-notes-0'), 'QA recipe note')

    click(await waitUntil(() => testId('model-profile-save-0'), 10000, 'model profile save'))
    const saved = await waitUntil(async () => {
      const profiles = await window.api.storage.listCheckpointPromptProfiles()
      return profiles.find(profileMatches) || null
    }, 10000, 'saved pro model profile')
    const modelProfileUi = {
      panel: Boolean(panel),
      proGuidance: Boolean(testId('model-profile-pro-guidance-0')),
      baseModel: Boolean(testId('model-profile-base-model-0')),
      promptStyle: Boolean(testId('model-profile-prompt-style-0')),
      negativeStrategy: Boolean(testId('model-profile-negative-strategy-0')),
      aspectRatios: Boolean(testId('model-profile-aspect-ratios-0')),
      relatedModels: Boolean(testId('model-profile-related-models-0')),
      relatedLoras: Boolean(testId('model-profile-related-loras-0')),
      relatedVaes: Boolean(testId('model-profile-related-vaes-0')),
      relatedControlNets: Boolean(testId('model-profile-related-controlnets-0')),
      compatibility: Boolean(testId('model-profile-compatibility-0')),
      recipeNotes: Boolean(testId('model-profile-recipe-notes-0'))
    }

    let relatedWorkspace = null
    let preflightRelated = null
    let composerRelated = null
    await cleanupRelatedWorkspaces()
    try {
      relatedWorkspace = await window.api.storage.saveWorkspace({
        name: relatedWorkspacePrefix + ' ' + Date.now(),
        snapshot: relatedSnapshot(saved.checkpointTitle)
      })
      click(await waitUntil(() => testId('main-tab-txt2img'), 10000, 'txt2img tab for related profile'))
      click(await waitUntil(() => testId('side-tab-presets'), 10000, 'presets tab for related profile'))
      click(await waitUntil(() => testId('workspace-refresh'), 10000, 'workspace refresh for related profile'))
      click(await waitUntil(() => testId('workspace-restore-' + relatedWorkspace.id), 10000, 'restore related profile workspace'))
      click(await waitUntil(() => testId('main-tab-txt2img'), 10000, 'txt2img tab after related profile restore'))
      const preflightPanel = await waitUntil(() => testId('preflight-related-models'), 10000, 'preflight related models')
      const composerPanel = await waitUntil(() => testId('prompt-composer-model-related'), 10000, 'prompt composer related models')
      preflightRelated = {
        loras: preflightPanel.getAttribute('data-preflight-related-loras'),
        vaes: preflightPanel.getAttribute('data-preflight-related-vaes'),
        controlnets: preflightPanel.getAttribute('data-preflight-related-controlnets'),
        loraChip: Boolean(testId('preflight-related-loras-0')),
        vaeChip: Boolean(testId('preflight-related-vaes-0')),
        controlnetChip: Boolean(testId('preflight-related-controlnets-0')),
        loraStatus: testId('preflight-related-loras-0')?.getAttribute('data-related-status') || null,
        vaeStatus: testId('preflight-related-vaes-0')?.getAttribute('data-related-status') || null,
        controlnetStatus: testId('preflight-related-controlnets-0')?.getAttribute('data-related-status') || null
      }
      composerRelated = {
        loras: composerPanel.getAttribute('data-related-loras'),
        vaes: composerPanel.getAttribute('data-related-vaes'),
        controlnets: composerPanel.getAttribute('data-related-controlnets'),
        loraChip: Boolean(testId('prompt-composer-model-related-loras-0')),
        vaeChip: Boolean(testId('prompt-composer-model-related-vaes-0')),
        controlnetChip: Boolean(testId('prompt-composer-model-related-controlnets-0'))
      }
      if (relatedWorkspace) {
        await window.api.storage.deleteWorkspace(relatedWorkspace.id)
        relatedWorkspace = null
      }
      await cleanupRelatedWorkspaces()
      const previous = beforeById.get(saved.id)
      if (previous) await window.api.storage.saveCheckpointPromptProfile(previous)
      else await window.api.storage.deleteCheckpointPromptProfile(saved.id)
    } catch (error) {
      try {
        if (relatedWorkspace) {
          await window.api.storage.deleteWorkspace(relatedWorkspace.id)
          relatedWorkspace = null
        }
        await cleanupRelatedWorkspaces()
      } catch {}
      try {
        const previous = beforeById.get(saved.id)
        if (previous) await window.api.storage.saveCheckpointPromptProfile(previous)
        else await window.api.storage.deleteCheckpointPromptProfile(saved.id)
      } catch {}
      return {
        ok: false,
        restored: false,
        error: error instanceof Error ? error.message : String(error),
        savedId: saved.id
      }
    }

    return {
      ok: Boolean(panel) &&
        Boolean(saved) &&
        preflightRelated?.loras === '1' &&
        preflightRelated?.vaes === '1' &&
        preflightRelated?.controlnets === '1' &&
        preflightRelated?.loraChip &&
        preflightRelated?.vaeChip &&
        preflightRelated?.controlnetChip &&
        composerRelated?.loras === '1' &&
        composerRelated?.vaes === '1' &&
        composerRelated?.controlnets === '1' &&
        composerRelated?.loraChip &&
        composerRelated?.vaeChip &&
        composerRelated?.controlnetChip,
      skipped: false,
      restored: true,
      savedId: saved.id,
      checkpointCount,
      ui: modelProfileUi,
      saved: {
        baseModel: saved.baseModel,
        promptStyle: saved.promptStyle,
        negativeStrategy: saved.negativeStrategy,
        recommendedLoraCount: saved.recommendedLoraCount,
        recommendedAspectRatios: saved.recommendedAspectRatios,
        relatedModels: saved.relatedModels,
        compatibilityNotes: saved.compatibilityNotes,
        recipeNotes: saved.recipeNotes
      },
      preflightRelated,
      composerRelated
    }
  })()`
}

function modelLibraryRecipeExpression(fixture) {
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
    click(await waitUntil(() => testId('main-tab-models'), 10000, 'Models tab'))
    const entry = await waitUntil(() => testId('model-library-entry-0'), 15000, 'model library entry')
    const hints = await waitUntil(() => document.querySelector('[data-testid^="model-library-recipe-hints-"]'), 10000, 'recipe hints')
    const indexMatch = hints.getAttribute('data-testid')?.match(/-(\\d+)$/)
    const index = indexMatch ? indexMatch[1] : '0'
    if (!hints.textContent.includes('qa_trigger_word') || !hints.textContent.includes('qa cinematic lighting')) {
      return { ok: false, status: 'missing-recipe-hints', text: hints.textContent }
    }
    const firstHint = hints.querySelector('button')
    click(firstHint)
    click(await waitUntil(() => testId('main-tab-txt2img'), 10000, 'txt2img tab'))
    const promptTextarea = await waitUntil(() => testId('prompt-positive-section')?.querySelector('textarea'), 10000, 'positive prompt textarea')
    const promptContainsHint = promptTextarea.value.includes('qa_trigger_word')
    click(await waitUntil(() => testId('main-tab-models'), 10000, 'Models tab return'))
    click(await waitUntil(() => testId('model-library-recipe-stats-load-' + index), 10000, 'recipe stats button'))
    const statsPanel = await waitUntil(() => testId('model-library-recipe-stats-' + index), 10000, 'recipe stats panel')
    const sampler = await waitUntil(() => testId('model-library-recipe-sampler-' + index), 10000, 'recipe sampler')
    const size = await waitUntil(() => testId('model-library-recipe-size-' + index), 10000, 'recipe size')
    return {
      ok: Boolean(entry) && promptContainsHint && statsPanel.textContent.includes('clean lineart') && sampler.textContent.includes('DPM++ 2M Karras') && size.textContent.includes('832×1216'),
      status: 'model-library-recipe-ok',
      modelVersionId: ${JSON.stringify(fixture.modelVersionId)},
      index,
      promptContainsHint,
      hints: hints.textContent,
      sampler: sampler.textContent,
      size: size.textContent
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
        const value = await predicate()
        if (value) return value
        await sleep(200)
      }
      throw new Error('Timed out waiting for ' + label)
    }
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
    click(await waitUntil(() => testId('main-tab-models'), 10000, 'Models tab'))
    await waitUntil(() => testId('model-library-card'), 10000, 'model library card')
    const recoveryPanel = await waitUntil(() => testId('model-library-download-recovery'), 10000, 'download recovery panel')
    click(await waitUntil(() => testId('model-library-integrity-check'), 10000, 'integrity check button'))
    const partialPanel = await waitUntil(() => testId('model-library-partial-issues'), 10000, 'partial issues panel')
    const partialRow = await waitUntil(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid^="model-library-partial-issue-"]'))
      return rows.find((row) => (row.textContent || '').includes('yoitomoshi-dom-qa-'))
    }, 10000, 'QA partial issue row')
    const deleteButton = partialRow.querySelector('[data-testid^="model-library-delete-partial-"]')
    click(deleteButton)
    await waitUntil(async () => {
      const next = await window.api.tools.checkLibraryIntegrity()
      return !next.issues.some((item) => item.path === issue.path)
    }, 10000, 'partial removed from integrity')
    const after = await window.api.tools.checkLibraryIntegrity()
    const stillPresent = after.issues.some((item) => item.path === issue.path)
    return {
      ok: Boolean(recoveryPanel) && Boolean(partialPanel) && Boolean(partialRow) && !stillPresent,
      status: 'deleted',
      path: issue.path,
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
      document.querySelector('[data-testid="main-tab-txt2img"]')?.click()
      await sleep(300)
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

function historyProRecipeReviewExpression() {
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
    const previousReview = target.proRecipeReview ?? null
    try {
      document.querySelector('[data-testid="main-tab-txt2img"]')?.click()
      await sleep(300)
      click(await waitUntil(() => testId('side-tab-history'), 10000, 'History side tab'))
      click(await waitUntil(() => testId('history-pro-recipe-open'), 30000, 'Pro Recipe open'))
      const panel = await waitUntil(() => testId('history-pro-recipe-review'), 10000, 'Pro Recipe panel')
      click(await waitUntil(() => testId('history-pro-recipe-rating-4'), 10000, 'rating button'))
      const strengths = await waitUntil(() => testId('history-pro-recipe-strengths'), 10000, 'strengths textarea')
      const issues = await waitUntil(() => testId('history-pro-recipe-issues'), 10000, 'issues textarea')
      const nextActions = await waitUntil(() => testId('history-pro-recipe-next-actions'), 10000, 'next actions textarea')
      setValue(strengths, 'yoitomoshi qa strong thumbnail')
      setValue(issues, 'yoitomoshi qa weak hands')
      setValue(nextActions, 'yoitomoshi qa inpaint hands')
      await waitUntil(() =>
        strengths.value.includes('yoitomoshi qa strong thumbnail') &&
        issues.value.includes('yoitomoshi qa weak hands') &&
        nextActions.value.includes('yoitomoshi qa inpaint hands'),
        10000,
        'Pro Recipe field values'
      )
      await sleep(200)
      click(await waitUntil(() => testId('history-pro-recipe-save'), 10000, 'Pro Recipe save'))
      await waitUntil(async () => {
        const next = await window.api.storage.listHistory()
        const updated = next.find((item) => item.id === target.id)
        return updated?.proRecipeReview?.rating === 4 &&
          updated?.proRecipeReview?.strengths?.includes('yoitomoshi qa strong thumbnail') &&
          updated?.proRecipeReview?.issues?.includes('yoitomoshi qa weak hands') &&
          updated?.proRecipeReview?.nextActions?.includes('yoitomoshi qa inpaint hands')
      }, 10000, 'saved Pro Recipe review')
      const quickFilters = {
        container: Boolean(testId('history-quick-filters')),
        success: Boolean(testId('history-quick-success')),
        rejected: Boolean(testId('history-quick-rejected')),
        asset: Boolean(testId('history-quick-asset')),
        proRecipe: Boolean(testId('history-quick-proRecipe'))
      }
      const ratingFilter = await waitUntil(() => testId('history-filter-rating'), 10000, 'history rating filter')
      setValue(ratingFilter, '4plus')
      await waitUntil(() => ratingFilter.value === '4plus', 10000, 'rating filter 4plus')
      click(await waitUntil(() => testId('history-quick-success'), 10000, 'success quick filter'))
      const reviewNote = await waitUntil(() => {
        const notes = Array.from(document.querySelectorAll('[data-testid="history-card-review-note"]'))
        return notes.find((node) => (node.textContent || '').includes('yoitomoshi qa strong thumbnail'))
      }, 10000, 'history list review note')
      return {
        ok: Object.values(quickFilters).every(Boolean) && ratingFilter.value === '4plus' && Boolean(reviewNote),
        status: 'saved',
        panel: Boolean(panel),
        quickFilters,
        ratingFilter: ratingFilter.value,
        reviewNote: reviewNote.textContent,
        historyId: target.id
      }
    } finally {
      await window.api.storage.setHistoryProRecipeReview(target.id, previousReview)
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
    document.querySelector('[data-testid="main-tab-txt2img"]')?.click()
    await sleep(300)
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

function candidateBoardSetupExpression() {
  return `(async () => {
    const prompt = 'yoitomoshi qa candidate board ' + Date.now()
    const palettes = [
      ['#2dd4bf', '#0f172a', 'A'],
      ['#f59e0b', '#111827', 'B'],
      ['#f43f5e', '#172554', 'C'],
      ['#38bdf8', '#1e1b4b', 'D'],
      ['#a78bfa', '#111827', 'E']
    ]
    const makePng = (index) => {
      const palette = palettes[index] || palettes[0]
      const canvas = document.createElement('canvas')
      canvas.width = 832
      canvas.height = 1216
      const ctx = canvas.getContext('2d')
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
      gradient.addColorStop(0, palette[0])
      gradient.addColorStop(1, palette[1])
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = 'rgba(255,255,255,.22)'
      ctx.beginPath()
      ctx.arc(420, 420, 170, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,.92)'
      ctx.font = '700 154px Arial'
      ctx.fillText('QA ' + palette[2], 92, 940)
      ctx.font = '42px Arial'
      ctx.fillText('Candidate Board', 96, 1015)
      return canvas.toDataURL('image/png').replace(/^data:image\\/png;base64,/, '')
    }
    const thumb = (index) => {
      const palette = palettes[index] || palettes[0]
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">' +
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="' + palette[0] + '"/><stop offset="1" stop-color="' + palette[1] + '"/></linearGradient></defs>' +
        '<rect width="160" height="160" fill="url(#g)"/><circle cx="' + (52 + index * 20) + '" cy="62" r="32" fill="rgba(255,255,255,.28)"/>' +
        '<text x="16" y="134" fill="white" font-family="Arial" font-size="42" font-weight="700">QA ' + palette[2] + '</text></svg>'
      return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
    }
    const ids = []
    for (let index = 0; index < 5; index += 1) {
      const item = await window.api.storage.addHistory({
        pngBase64: makePng(index),
        thumbDataUrl: thumb(index),
        prompt,
        negativePrompt: 'bad hands, text, logo',
        params: {
          steps: 24,
          cfgScale: 7,
          width: 832,
          height: 1216,
          sampler: 'Euler a',
          scheduler: 'Automatic',
          seed: 9000 + index,
          batchSize: 5,
          imageIndex: index,
          imageCount: 5,
          iterationIndex: 0,
          iterationCount: 1,
          model: 'qa-candidate-board.safetensors',
          vae: 'Automatic',
          clipSkip: 2,
          denoisingStrength: 0.55,
          activeLoras: [{ name: 'qa_candidate_lora', tokenName: 'qa_candidate_lora', weight: 0.75, triggerWords: ['qa trigger'] }]
        }
      })
      ids.push(item.id)
    }
    return { ok: ids.length === 5, status: 'setup', ids, prompt }
  })()`
}

function candidateBoardCheckExpression(ids) {
  return `(async () => {
    const ids = ${JSON.stringify(ids)}
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
        try {
          const value = await predicate()
          if (value) return value
        } catch {}
        await sleep(200)
      }
      throw new Error('Timed out waiting for ' + label)
    }
    try {
      await waitUntil(() => window.api?.storage?.listHistory, 15000, 'storage API')
      click(await waitUntil(() => testId('side-tab-board'), 10000, 'Candidate Board side tab'))
      await waitUntil(() => testId('side-tab-board')?.getAttribute('aria-selected') === 'true', 10000, 'Candidate Board side tab selected')
      const boardContent = await waitUntil(() => testId('side-content-board'), 10000, 'Candidate Board side content')
      const board = await waitUntil(() => testId('candidate-board'), 15000, 'Candidate Board')
      const boardIds = Array.from(document.querySelectorAll('[data-testid^="candidate-board-item-"]')).map((node) => node.getAttribute('data-history-id'))
      const hasExpectedIds = ids.every((id) => boardIds.includes(id))
      const boardContentRect = boardContent.getBoundingClientRect()
      const boardLayoutOk = boardContentRect.top >= 0 && boardContentRect.bottom <= window.innerHeight + 1
      const boardClientHeight = boardContent.clientHeight
      const boardScrollHeight = boardContent.scrollHeight
      const preview0Button = await waitUntil(() => testId('candidate-board-preview-0'), 10000, 'candidate preview')
      const preview0Id = preview0Button.closest('[data-testid^="candidate-board-item-"]')?.getAttribute('data-history-id')
      click(preview0Button)
      const selectedPanel = await waitUntil(() => testId('candidate-board-selected'), 10000, 'candidate selected panel')
      const selectedAfterPreview = await waitUntil(() =>
        preview0Id && testId('candidate-board-selected')?.getAttribute('data-selected-id') === preview0Id,
      10000, 'selected candidate follows preview')
      const selectedSeed = await waitUntil(() => testId('candidate-board-selected-seed'), 10000, 'selected candidate seed')
      const previewImage = await waitUntil(() => testId('preview-output-image'), 10000, 'center preview image')
      const previewed = previewImage.getAttribute('src')?.includes('iVBORw0KGgo') === true
      click(await waitUntil(() => testId('candidate-board-label-candidate-0'), 10000, 'candidate label'))
      click(await waitUntil(() => testId('candidate-board-label-favorite-1'), 10000, 'favorite label'))
      click(await waitUntil(() => testId('candidate-board-label-rejected-2'), 10000, 'rejected label'))
      click(await waitUntil(() => testId('candidate-board-label-social-3'), 10000, 'social label'))
      click(await waitUntil(() => testId('candidate-board-label-reference-4'), 10000, 'reference label'))
      const labelState = await waitUntil(async () => {
        const history = await window.api.storage.listHistory()
        const byId = Object.fromEntries(history.filter((item) => ids.includes(item.id)).map((item) => [item.id, item.label || null]))
        return byId[ids[0]] === 'candidate' &&
          byId[ids[1]] === 'favorite' &&
          byId[ids[2]] === 'rejected' &&
          byId[ids[3]] === 'social' &&
          byId[ids[4]] === 'reference'
          ? byId
          : null
      }, 10000, 'saved candidate labels')
      await waitUntil(() => testId('candidate-board-toggle-rejected') && !testId('candidate-board-toggle-rejected').disabled, 10000, 'rejected toggle enabled')
      click(await waitUntil(() => testId('candidate-board-preview-0'), 10000, 'candidate review target preview'))
      await waitUntil(() =>
        testId('candidate-board-selected')?.getAttribute('data-selected-id') === ids[0],
      10000, 'candidate review target selected')
      const reviewEditor = await waitUntil(() => testId('candidate-board-review-editor'), 10000, 'candidate review editor')
      setValue(await waitUntil(() => testId('candidate-board-review-adoption'), 10000, 'candidate adoption reason'), 'yoitomoshi qa adoption reason')
      setValue(await waitUntil(() => testId('candidate-board-review-failure'), 10000, 'candidate failure reason'), 'yoitomoshi qa failure reason')
      setValue(await waitUntil(() => testId('candidate-board-review-next'), 10000, 'candidate next action'), 'yoitomoshi qa next action')
      click(await waitUntil(() => testId('candidate-board-review-save'), 10000, 'candidate review save'))
      const reviewState = await waitUntil(async () => {
        const history = await window.api.storage.listHistory()
        const updated = history.find((item) => item.id === ids[0])
        return updated?.proRecipeReview?.strengths?.includes('yoitomoshi qa adoption reason') &&
          updated?.proRecipeReview?.issues?.includes('yoitomoshi qa failure reason') &&
          updated?.proRecipeReview?.nextActions?.includes('yoitomoshi qa next action')
          ? updated.proRecipeReview
          : null
      }, 10000, 'saved candidate review')
      const variants = await waitUntil(() => testId('candidate-board-variants'), 10000, 'candidate variants')
      click(await waitUntil(() => testId('candidate-board-variant-seed-next'), 10000, 'seed variant'))
      await waitUntil(() => testId('main-tab-txt2img')?.getAttribute('aria-selected') === 'true', 10000, 'txt2img selected after seed variant')
      const promptAfterSeed = await waitUntil(() => testId('prompt-positive-editor'), 10000, 'positive prompt after seed variant')
      if (!testId('params-seed')) click(await waitUntil(() => testId('params-advanced-toggle'), 10000, 'params advanced toggle'))
      const seedAfterVariant = await waitUntil(() => testId('params-seed')?.value === '9001', 10000, 'seed +1 applied')
      click(await waitUntil(() => testId('side-tab-board'), 10000, 'Candidate Board side tab after seed variant'))
      await waitUntil(() => testId('candidate-board'), 10000, 'Candidate Board after seed variant')
      click(await waitUntil(() => testId('candidate-board-preview-0'), 10000, 'candidate cfg variant target preview'))
      click(await waitUntil(() => testId('candidate-board-variant-cfg-up'), 10000, 'cfg variant'))
      await waitUntil(() => testId('main-tab-txt2img')?.getAttribute('aria-selected') === 'true', 10000, 'txt2img selected after cfg variant')
      const cfgAfterVariant = await waitUntil(() => testId('params-cfg-scale')?.value === '7.5', 10000, 'cfg +0.5 applied')
      click(await waitUntil(() => testId('side-tab-board'), 10000, 'Candidate Board side tab after cfg variant'))
      await waitUntil(() => testId('candidate-board'), 10000, 'Candidate Board after cfg variant')
      click(await waitUntil(() => testId('candidate-board-preview-0'), 10000, 'candidate lora variant target preview'))
      const loraVariantButton = await waitUntil(() => testId('candidate-board-variant-lora-up'), 10000, 'lora variant')
      const loraVariantEnabled = !loraVariantButton.disabled
      click(loraVariantButton)
      await waitUntil(() => testId('main-tab-txt2img')?.getAttribute('aria-selected') === 'true', 10000, 'txt2img selected after lora variant')
      const promptAfterLora = await waitUntil(() => testId('prompt-positive-editor')?.value.includes('yoitomoshi qa candidate board'), 10000, 'prompt restored after lora variant')
      click(await waitUntil(() => testId('candidate-board-img2img-0'), 10000, 'candidate img2img'))
      await waitUntil(() => testId('main-tab-img2img')?.getAttribute('aria-selected') === 'true', 10000, 'img2img selected')
      await waitUntil(() => testId('input-image-panel'), 10000, 'img2img input image panel')
      click(await waitUntil(() => testId('candidate-board-upscale-1'), 10000, 'candidate upscale'))
      await waitUntil(() => testId('main-tab-upscale')?.getAttribute('aria-selected') === 'true', 10000, 'upscale selected')
      click(await waitUntil(() => testId('main-tab-img2img'), 10000, 'return to img2img'))
      await waitUntil(() => testId('main-tab-img2img')?.getAttribute('aria-selected') === 'true', 10000, 'img2img reselected')
      click(await waitUntil(() => testId('side-tab-board'), 10000, 'Candidate Board side tab after upscale'))
      await waitUntil(() => testId('candidate-board'), 10000, 'Candidate Board after return')
      click(await waitUntil(() => testId('candidate-board-pro-recipe-2'), 10000, 'candidate Pro Recipe'))
      const proPanel = await waitUntil(() => testId('history-pro-recipe-review'), 10000, 'Pro Recipe panel')
      await waitUntil(() => testId('candidate-board-toggle-rejected') && !testId('candidate-board-toggle-rejected').disabled, 10000, 'rejected toggle enabled after routes')
      click(await waitUntil(() => testId('candidate-board-toggle-rejected'), 10000, 'hide rejected toggle'))
      const rejectedHidden = await waitUntil(() => {
        const after = Array.from(document.querySelectorAll('[data-testid^="candidate-board-item-"]')).map((node) => node.getAttribute('data-history-id'))
        return !after.includes(ids[2])
      }, 10000, 'rejected candidate hidden')
      return {
        ok: Boolean(board) && hasExpectedIds && boardLayoutOk && previewed && Boolean(proPanel) && Boolean(selectedPanel) && Boolean(selectedAfterPreview) && Boolean(selectedSeed) && Boolean(reviewEditor) && Boolean(reviewState) && Boolean(variants) && Boolean(seedAfterVariant) && Boolean(cfgAfterVariant) && loraVariantEnabled && Boolean(promptAfterSeed) && Boolean(promptAfterLora) && rejectedHidden,
        status: 'candidate-board-ok',
        ids,
        labelState,
        reviewState,
        boardCount: board.getAttribute('data-candidate-count'),
        imageCount: board.getAttribute('data-image-count'),
        boardLayoutOk,
        previewed,
        selectedPanel: Boolean(selectedPanel),
        variants: Boolean(variants),
        seedAfterVariant,
        cfgAfterVariant,
        loraVariantEnabled,
        rejectedHidden,
        boardClientHeight,
        boardScrollHeight
      }
    } finally {
      for (const id of ids) {
        try { await window.api.storage.deleteHistory(id) } catch {}
      }
    }
  })()`
}

function referenceBoardSetupExpression() {
  return `(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400))
    if (!window.api?.storage?.addHistory) return { ok: false, error: 'storage API unavailable' }
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 640
    const ctx = canvas.getContext('2d')
    const gradient = ctx.createLinearGradient(0, 0, 640, 640)
    gradient.addColorStop(0, '#164e63')
    gradient.addColorStop(1, '#f59e0b')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 640, 640)
    ctx.fillStyle = 'rgba(255,255,255,.28)'
    ctx.fillRect(92, 120, 180, 360)
    ctx.beginPath()
    ctx.arc(380, 230, 105, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.font = '700 58px Arial'
    ctx.fillText('QA Reference', 70, 560)
    const pngBase64 = canvas.toDataURL('image/png').replace(/^data:image\\/png;base64,/, '')
    const item = await window.api.storage.addHistory({
      pngBase64,
      thumbDataUrl: canvas.toDataURL('image/png'),
      prompt: 'yoitomoshi qa reference board pose color character sheet',
      negativePrompt: 'bad hands, text, logo',
      params: {
        steps: 22,
        cfgScale: 6.5,
        width: 640,
        height: 640,
        sampler: 'Euler a',
        scheduler: 'Automatic',
        seed: 260526,
        batchSize: 1,
        imageIndex: 0,
        imageCount: 1,
        iterationIndex: 0,
        iterationCount: 1,
        model: 'qa-reference-board.safetensors',
        vae: 'Automatic',
        clipSkip: 2,
        denoisingStrength: 0.52,
        activeLoras: []
      }
    })
    await window.api.storage.setHistoryLabel(item.id, 'reference')
    await window.api.storage.setHistoryProRecipeReview(item.id, {
      rating: 4,
      strengths: ['yoitomoshi qa reference strength'],
      issues: ['yoitomoshi qa reference issue'],
      nextActions: ['yoitomoshi qa reference next'],
      updatedAt: Date.now()
    })
    return { ok: true, id: item.id }
  })()`
}

function referenceBoardCheckExpression(id) {
  return `(async () => {
    const historyId = ${JSON.stringify(id)}
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
        try {
          const value = await predicate()
          if (value) return value
        } catch {}
        await sleep(200)
      }
      throw new Error('Timed out waiting for ' + label)
    }
    const findImportedCard = () => {
      const notes = Array.from(document.querySelectorAll('[data-testid^="reference-board-note-"]'))
      const note = notes.find((node) =>
        node.value.includes('yoitomoshi qa reference strength') ||
        node.value.includes('yoitomoshi qa reference board note')
      )
      return note?.closest('[data-testid^="reference-board-item-"]') || null
    }
    try {
      await waitUntil(() => window.api?.storage?.listHistory, 15000, 'storage API')
      click(await waitUntil(() => testId('main-tab-tools'), 10000, 'Tools tab'))
      const board = await waitUntil(() => testId('reference-board'), 15000, 'Reference Board')
      click(await waitUntil(() => testId('reference-board-import-labeled'), 10000, 'import labeled button'))
      const card = await waitUntil(findImportedCard, 10000, 'imported reference card')
      const note = card.querySelector('[data-testid^="reference-board-note-"]')
      setValue(note, 'yoitomoshi qa reference board note')
      await waitUntil(() => note.value.includes('reference board note'), 10000, 'reference note edit')

      click(card.querySelector('[data-testid^="reference-board-send-img2img-"]'))
      await waitUntil(() => testId('main-tab-img2img')?.getAttribute('aria-selected') === 'true', 10000, 'img2img selected')
      const inputPanel = await waitUntil(() => testId('input-image-panel'), 10000, 'img2img input panel')

      click(await waitUntil(() => testId('main-tab-tools'), 10000, 'Tools tab before ControlNet'))
      const cardForControlNet = await waitUntil(findImportedCard, 10000, 'reference card before ControlNet')
      click(cardForControlNet.querySelector('[data-testid^="reference-board-send-controlnet-"]'))
      const controlnetReady = await waitUntil(() => {
        const current = testId('reference-board')
        return current?.getAttribute('data-controlnet-enabled') === 'true' &&
          current?.getAttribute('data-controlnet-unit-has-image') === 'true' &&
          current?.getAttribute('data-controlnet-unit-module') !== 'None'
          ? current
          : null
      }, 10000, 'ControlNet prepared from reference')

      click(await waitUntil(() => testId('main-tab-tools'), 10000, 'Tools tab before Inpaint'))
      const cardForInpaint = await waitUntil(findImportedCard, 10000, 'reference card before Inpaint')
      click(cardForInpaint.querySelector('[data-testid^="reference-board-send-inpaint-"]'))
      await waitUntil(() => testId('main-tab-img2img')?.getAttribute('aria-selected') === 'true', 10000, 'img2img selected for Inpaint')
      const inpaintEditor = await waitUntil(() => testId('inpaint-mask-editor'), 10000, 'inpaint mask editor')

      return {
        ok: Boolean(board) && Boolean(card) && Boolean(inputPanel) && Boolean(controlnetReady) && Boolean(inpaintEditor),
        status: 'reference-board-ok',
        historyId,
        count: board.getAttribute('data-reference-board-count'),
        controlnetModule: controlnetReady.getAttribute('data-controlnet-unit-module'),
        note: note.value
      }
    } finally {
      try { await window.api.storage.deleteHistory(historyId) } catch {}
    }
  })()`
}

function upscaleFinishSetupExpression() {
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
    if (!window.api?.storage?.listHistory || !window.api?.forge) return { ok: false, error: 'API unavailable' }
    const outputBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAATklEQVR4nO3PQQ3AIBDAwJx/6a0NwQkU9KQF7c1m5v5mVwC8JwEJSEACEpCABCSgAQlIQAI6QDc4t1v7o2D3j7rffgIQkIAEJCCBCRy3hQFqPwEV0wAAAABJRU5ErkJggg=='
    window.localStorage.setItem('yoitomoshi:qa:upscale-output', outputBase64)
    click(await waitUntil(() => testId('main-tab-upscale'), 10000, 'Upscale tab'))
    click(await waitUntil(() => testId('upscale-method-simple'), 10000, 'Simple method'))
    const existingInput = document.querySelector('img[alt="upscale input"]')
    if (existingInput && !testId('upscale-input-file')) {
      const clearButton = testId('upscale-clear-input') || existingInput.parentElement?.querySelector('button')
      if (clearButton) {
        click(clearButton)
        await sleep(300)
      }
    }
    await waitUntil(() => testId('upscale-input-file'), 10000, 'upscale file input')
    return {
      ok: true,
      startedAt: Date.now(),
      qaMockSet: window.localStorage.getItem('yoitomoshi:qa:upscale-output') === outputBase64
    }
  })()`
}

function upscaleFinishCheckExpression(startedAt) {
  return `(async () => {
    const startedAt = ${Number(startedAt)}
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
        try {
          const value = await predicate()
          if (value) return value
        } catch {}
        await sleep(200)
      }
      throw new Error('Timed out waiting for ' + label)
    }
    let savedId = null
    try {
      await waitUntil(() => testId('upscale-run-button') && !testId('upscale-run-button').disabled, 10000, 'upscale run enabled')
      click(testId('upscale-run-button'))
      await waitUntil(() => testId('upscale-output-image'), 10000, 'upscale output image')
      const checklist = await waitUntil(() => testId('upscale-finish-checklist'), 10000, 'finish checklist')
      click(await waitUntil(() => testId('upscale-finish-check-face'), 10000, 'face checklist'))
      click(await waitUntil(() => testId('upscale-finish-check-line'), 10000, 'line checklist'))
      setValue(await waitUntil(() => testId('upscale-finish-memo'), 10000, 'finish memo'), 'yoitomoshi qa upscale adoption memo')
      click(await waitUntil(() => testId('upscale-save-history'), 10000, 'save history'))
      const saved = await waitUntil(async () => {
        const history = await window.api.storage.listHistory()
        return history.find((item) =>
          item.createdAt >= startedAt &&
          item.params?.upscale?.method === 'simple' &&
          item.proRecipeReview?.nextActions?.includes('yoitomoshi qa upscale adoption memo') &&
          item.proRecipeReview?.issues?.length >= 2 &&
          item.proRecipeReview?.strengths?.some((line) => String(line).includes('upscale:simple'))
        ) || null
      }, 10000, 'history item with upscale Pro Recipe')
      savedId = saved.id
      return {
        ok: Boolean(checklist) && Boolean(saved),
        status: 'upscale-finish-ok',
        savedId,
        issueCount: checklist.getAttribute('data-issue-count'),
        proRecipe: saved.proRecipeReview,
        upscale: saved.params.upscale
      }
    } finally {
      try { window.localStorage.removeItem('yoitomoshi:qa:upscale-output') } catch {}
      if (savedId) {
        try { await window.api.storage.deleteHistory(savedId) } catch {}
      }
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

function promptDictionarySearchExpression() {
  return `(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const testId = (id) => document.querySelector('[data-testid="' + id + '"]')
    const waitUntil = async (predicate, timeoutMs, label) => {
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        const value = await predicate()
        if (value) return value
        await sleep(100)
      }
      throw new Error('Timed out waiting for ' + label)
    }
    const setValue = (element, value) => {
      const descriptor = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')
      descriptor?.set?.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const apiResult = await window.api.promptDictionary.search({ query: '\\u624b', limit: 8 })
    testId('main-tab-txt2img')?.click()
    await sleep(300)
    const toggle = await waitUntil(() => testId('prompt-dictionary-toggle'), 10000, 'prompt dictionary toggle')
    if (!testId('prompt-dictionary-search')) toggle.click()
    const input = await waitUntil(() => testId('prompt-dictionary-search'), 10000, 'prompt dictionary search')
    setValue(input, '\\u624b')
    await waitUntil(() => document.querySelectorAll('[data-testid^="prompt-dictionary-row-"]').length > 0, 10000, 'prompt dictionary rows')
    const rows = Array.from(document.querySelectorAll('[data-testid^="prompt-dictionary-row-"]'))
    const firstTags = rows.slice(0, 8).map((row) => row.querySelector('.font-mono')?.textContent?.trim()).filter(Boolean)
    const handsRelated = firstTags.some((tag) => /hand|waving|reaching|finger/.test(tag))
    return {
      ok: apiResult.total > 0 && apiResult.total < apiResult.searchableCount && rows.length > 0 && handsRelated,
      apiTotal: apiResult.total,
      searchableCount: apiResult.searchableCount,
      apiFirstTags: apiResult.entries.map((entry) => entry.en),
      uiCountText: testId('prompt-dictionary-result-count')?.textContent?.trim() || '',
      uiRowCount: rows.length,
      uiFirstTags: firstTags
    }
  })()`
}

function promptDictionaryWorkspaceExpression() {
  return `(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const testId = (id) => document.querySelector('[data-testid="' + id + '"]')
    const waitUntil = async (predicate, timeoutMs, label) => {
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        const value = await predicate()
        if (value) return value
        await sleep(100)
      }
      throw new Error('Timed out waiting for ' + label)
    }
    const setValue = (element, value) => {
      const descriptor = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')
      descriptor?.set?.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }
    testId('main-tab-txt2img')?.click()
    await sleep(300)
    const promptEditor = await waitUntil(() => testId('prompt-positive-editor'), 10000, 'prompt editor')
    const previousPrompt = promptEditor.value
    const apiSearch = await window.api.promptDictionary.search({ query: '\\u624b', limit: 8 })
    const sources = await window.api.promptDictionary.listSources()
    const adultSearch = await window.api.promptDictionary.search({ query: 'hand', limit: 8, adult: 'adult' })
    const safeSearch = await window.api.promptDictionary.search({ query: 'hand', limit: 8, adult: 'safe' })
    const danbooruSource = sources.sources.find((source) => source.sourceId === 'danbooru-tag-metadata')?.sourceId
    const sourceSearch = danbooruSource
      ? await window.api.promptDictionary.search({ query: 'hand', limit: 8, sourceIds: [danbooruSource] })
      : { entries: [] }
    const ingest = await window.api.promptDictionary.inspectIngest()
    testId('main-tab-dictionary')?.click()
    const workspace = await waitUntil(() => testId('prompt-dictionary-workspace'), 10000, 'dictionary workspace')
    const search = await waitUntil(() => testId('prompt-dictionary-workspace-search'), 10000, 'dictionary workspace search')
    const sourceFilter = await waitUntil(() => testId('prompt-dictionary-workspace-source-filter'), 10000, 'dictionary source filter')
    const adultFilter = await waitUntil(() => testId('prompt-dictionary-workspace-adult-filter'), 10000, 'dictionary adult filter')
    const polarityFilter = await waitUntil(() => testId('prompt-dictionary-workspace-polarity-filter'), 10000, 'dictionary polarity filter')
    setValue(search, '\\u624b')
    await waitUntil(() => document.querySelectorAll('[data-testid^="prompt-dictionary-workspace-row-"]').length > 0, 10000, 'dictionary workspace rows')
    const rows = Array.from(document.querySelectorAll('[data-testid^="prompt-dictionary-workspace-row-"]'))
    const firstTags = rows.slice(0, 8).map((row) => row.querySelector('.font-mono')?.textContent?.trim()).filter(Boolean)
    const firstInsert = document.querySelector('[data-testid^="prompt-dictionary-workspace-insert-"]')
    if (!firstInsert) throw new Error('missing workspace insert action')
    const insertedTag = firstTags[0] || ''
    firstInsert.click()
    await sleep(250)
    testId('main-tab-txt2img')?.click()
    const promptAfter = await waitUntil(() => testId('prompt-positive-editor'), 10000, 'prompt editor after insert')
    const inserted = insertedTag && promptAfter.value.includes(insertedTag)
    setValue(promptAfter, previousPrompt)
    testId('main-tab-dictionary')?.click()
    await waitUntil(() => testId('prompt-dictionary-synergy-panel'), 10000, 'synergy panel')
    await waitUntil(() => testId('prompt-dictionary-meaning-review-panel'), 10000, 'meaning review panel')
    await waitUntil(() => testId('prompt-dictionary-source-panel'), 10000, 'source panel')
    const reviewCopyExport = document.querySelector('[data-testid="prompt-dictionary-meaning-review-copy-export"]')
    const reviewCopyImport = document.querySelector('[data-testid="prompt-dictionary-meaning-review-copy-import"]')
    const reviewRevealDb = document.querySelector('[data-testid="prompt-dictionary-meaning-review-reveal-db"]')
    return {
      ok: Boolean(workspace) &&
        apiSearch.total > 0 &&
        apiSearch.searchableCount > apiSearch.total &&
        rows.length > 0 &&
        inserted &&
        sources.sources.length >= 3 &&
        ingest.registrySourceCount >= sources.sources.length &&
        Number.isFinite(Number(ingest.meaningReviewableCount)) &&
        Boolean(reviewCopyExport) &&
        Boolean(reviewCopyImport) &&
        Boolean(reviewRevealDb) &&
        Boolean(sourceFilter) &&
        Boolean(adultFilter) &&
        Boolean(polarityFilter) &&
        adultSearch.entries.length > 0 &&
        adultSearch.entries.every((entry) => entry.adultLevel > 0) &&
        safeSearch.entries.length > 0 &&
        safeSearch.entries.every((entry) => entry.adultLevel <= 0) &&
        (!danbooruSource || (
          sourceSearch.entries.length > 0 &&
          sourceSearch.entries.every((entry) => entry.sourceId === danbooruSource)
        )),
      apiTotal: apiSearch.total,
      searchableCount: apiSearch.searchableCount,
      rowCount: rows.length,
      firstTags,
      insertedTag,
      sourceCount: sources.sources.length,
      adultFirstTags: adultSearch.entries.slice(0, 3).map((entry) => [entry.en, entry.adultLevel, entry.sourceId]),
      safeFirstTags: safeSearch.entries.slice(0, 3).map((entry) => [entry.en, entry.adultLevel, entry.sourceId]),
      sourceFirstTags: sourceSearch.entries.slice(0, 3).map((entry) => [entry.en, entry.adultLevel, entry.sourceId]),
      ingest
    }
  })()`
}

function promptEditorDictionaryExpression() {
  return `(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const testId = (id) => document.querySelector('[data-testid="' + id + '"]')
    const waitUntil = async (predicate, timeoutMs, label) => {
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        const value = await predicate()
        if (value) return value
        await sleep(100)
      }
      throw new Error('Timed out waiting for ' + label)
    }
    const setValue = (element, value) => {
      const descriptor = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')
      descriptor?.set?.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const click = (element) => {
      if (!element) throw new Error('Cannot click missing element')
      element.scrollIntoView({ block: 'center', inline: 'center' })
      const rect = element.getBoundingClientRect()
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: rect.left + 4, clientY: rect.top + 4 }))
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.left + 4, clientY: rect.top + 4 }))
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rect.left + 4, clientY: rect.top + 4 }))
    }
    testId('main-tab-txt2img')?.click()
    await sleep(300)
    const textarea = await waitUntil(() => testId('prompt-positive-editor'), 10000, 'positive prompt editor')
    const previous = textarea.value
    try {
      textarea.focus()
      setValue(textarea, '\\u624b')
      textarea.setSelectionRange(textarea.value.length, textarea.value.length)
      textarea.dispatchEvent(new Event('select', { bubbles: true }))
      const panel = await waitUntil(() => testId('prompt-positive-editor-dictionary-suggestions'), 10000, 'prompt editor dictionary suggestions')
      const first = await waitUntil(() => testId('prompt-positive-editor-dictionary-suggestion-0'), 10000, 'first prompt editor dictionary suggestion')
      const firstText = first.textContent || ''
      click(first)
      await waitUntil(() => /hand|finger|wrist/.test(textarea.value), 10000, 'dictionary tag inserted into prompt editor')
      return {
        ok: /hand|finger|wrist/.test(textarea.value) && /hand|finger|wrist/.test(firstText),
        panel: Boolean(panel),
        firstText,
        promptValue: textarea.value
      }
    } finally {
      setValue(textarea, previous)
    }
  })()`
}

function promptGlobalAutocompleteExpression() {
  return `(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const testId = (id) => document.querySelector('[data-testid="' + id + '"]')
    const waitUntil = async (predicate, timeoutMs, label) => {
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        const value = await predicate()
        if (value) return value
        await sleep(100)
      }
      throw new Error('Timed out waiting for ' + label)
    }
    const setValue = (element, value) => {
      const descriptor = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')
      descriptor?.set?.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const click = (element) => {
      if (!element) throw new Error('Cannot click missing element')
      element.scrollIntoView({ block: 'center', inline: 'center' })
      const rect = element.getBoundingClientRect()
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: rect.left + 4, clientY: rect.top + 4 }))
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.left + 4, clientY: rect.top + 4 }))
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rect.left + 4, clientY: rect.top + 4 }))
    }
    testId('main-tab-tags')?.click()
    await sleep(500)
    const input = await waitUntil(() => testId('tags-workspace-quick-add-input'), 10000, 'tags workspace quick add input')
    const previous = input.value
    try {
      input.focus()
      setValue(input, '\\u624b')
      input.setSelectionRange(input.value.length, input.value.length)
      const layer = await waitUntil(() => testId('prompt-dictionary-autocomplete-layer'), 10000, 'global dictionary autocomplete layer')
      const first = await waitUntil(() => testId('prompt-dictionary-autocomplete-option-0'), 10000, 'global autocomplete first option')
      const firstText = first.textContent || ''
      click(first)
      await waitUntil(() => /hand|finger|wrist/.test(input.value), 10000, 'global dictionary tag inserted')
      const connectedInputs = Array.from(document.querySelectorAll('[data-prompt-dictionary-autocomplete]'))
        .map((element) => ({
          testId: element.getAttribute('data-testid') || '',
          mode: element.getAttribute('data-prompt-dictionary-autocomplete') || ''
        }))
      return {
        ok: /hand|finger|wrist/.test(input.value) && /hand|finger|wrist/.test(firstText) && connectedInputs.length >= 3,
        layer: Boolean(layer),
        firstText,
        inputValue: input.value,
        connectedInputs
      }
    } finally {
      setValue(input, previous)
    }
  })()`
}

function promptComposerExpression() {
  return `(async () => {
    const tempTemplatePrefix = 'QA DOM Prompt Composer Slot Template'
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const testId = (id) => document.querySelector('[data-testid="' + id + '"]')
    const waitUntil = async (fn, timeoutMs, label) => {
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        const value = await fn()
        if (value) return value
        await sleep(100)
      }
      throw new Error('Timed out waiting for ' + label)
    }
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
      element.focus()
      const descriptor = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')
      descriptor?.set?.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const cleanupPromptComposerTemplates = async () => {
      const templates = await window.api.storage.listPromptComposerSlotTemplates()
      for (const template of templates.filter((item) => item.name.startsWith(tempTemplatePrefix))) {
        await window.api.storage.deletePromptComposerSlotTemplate(template.id)
      }
    }

    click(await waitUntil(() => testId('main-tab-txt2img'), 10000, 'txt2img tab'))
    const positive = await waitUntil(() => testId('prompt-positive-editor'), 10000, 'positive prompt editor')
    const negative = await waitUntil(() => testId('prompt-negative-editor'), 10000, 'negative prompt editor')
    const previousPrompt = positive.value
    const previousNegative = negative.value
    let previousTagsPrompt = ''
    let shouldRestoreTags = false
    let savedTemplateId = null
    let templateRoundTrip = null
    await cleanupPromptComposerTemplates()
    try {
      setValue(positive, 'コスプレ、初音ミク、ダンスシーン')
      await sleep(200)
      click(await waitUntil(() => testId('prompt-composer-primary'), 10000, 'prompt composer primary'))
      await waitUntil(() => positive.value.trim() === 'cosplay, hatsune miku, dance scene', 10000, 'txt2img translated prompt')

      setValue(positive, 'masterpiece、初音ミク, <lora:miku:0.8>、ダンスシーン')
      await sleep(200)
      click(await waitUntil(() => testId('prompt-composer-primary'), 10000, 'prompt composer primary second run'))
      await waitUntil(() => {
        const value = positive.value
        return value.includes('masterpiece') &&
          value.includes('hatsune miku') &&
          value.includes('<lora:miku:0.8>') &&
          value.includes('dance scene')
      }, 10000, 'protected syntax translated prompt')

      click(await waitUntil(() => testId('prompt-composer-slots-toggle'), 10000, 'prompt composer slots toggle'))
      const slots = await waitUntil(() => testId('prompt-composer-slots'), 10000, 'prompt composer slots panel')
      const slotStyle = slots.getAttribute('data-prompt-style')
      const slotNegativeStrategy = slots.getAttribute('data-negative-strategy')
      const slotOrder = slots.getAttribute('data-slot-order')
      setValue(await waitUntil(() => testId('prompt-composer-slot-qualityPrefix'), 10000, 'slot quality prefix'), 'masterpiece, best quality')
      setValue(await waitUntil(() => testId('prompt-composer-slot-subject'), 10000, 'slot subject'), '1girl, original character')
      setValue(await waitUntil(() => testId('prompt-composer-slot-composition'), 10000, 'slot composition'), 'upper body, looking at viewer')
      setValue(await waitUntil(() => testId('prompt-composer-slot-lighting'), 10000, 'slot lighting'), 'soft lighting, rim light')
      setValue(await waitUntil(() => testId('prompt-composer-slot-finishing'), 10000, 'slot finishing'), 'clean lineart, <lora:qa_style:0.5>')
      setValue(await waitUntil(() => testId('prompt-composer-slot-avoidFailures'), 10000, 'slot avoid failures'), 'hands, text, logo')
      const composerTarget = await waitUntil(() => testId('prompt-composer-slot-insert-target'), 10000, 'composer slot target')
      setValue(composerTarget, 'clothingProps')
      click(await waitUntil(() => testId('side-tab-library'), 10000, 'side library tab'))
      const libraryTarget = await waitUntil(() => testId('prompt-library-slot-insert-target'), 10000, 'library slot insert target')
      if (libraryTarget.disabled) click(await waitUntil(() => testId('prompt-library-slot-insert-toggle'), 10000, 'library slot insert toggle'))
      setValue(libraryTarget, 'clothingProps')
      await sleep(250)
      const libraryTag = await waitUntil(() => document.querySelector('[data-testid^="prompt-library-tag-"]'), 10000, 'library tag chip')
      const libraryTagText = libraryTag.querySelector('span')?.textContent?.trim() || ''
      click(libraryTag)
      const clothingSlot = await waitUntil(() => testId('prompt-composer-slot-clothingProps'), 10000, 'slot clothing props')
      await waitUntil(() => libraryTagText && clothingSlot.value.includes(libraryTagText), 10000, 'library tag inserted into slot')
      const recipePanel = await waitUntil(() => testId('prompt-library-recipes'), 10000, 'prompt library recipes')
      if (recipePanel.getAttribute('data-expanded') !== 'true') {
        click(await waitUntil(() => testId('prompt-library-recipes-toggle'), 10000, 'prompt library recipes toggle'))
      }
      click(await waitUntil(() => testId('prompt-library-recipe-upscale-finish'), 10000, 'prompt library upscale recipe'))
      const finishingSlot = await waitUntil(() => testId('prompt-composer-slot-finishing'), 10000, 'slot finishing after recipe')
      const avoidSlot = await waitUntil(() => testId('prompt-composer-slot-avoidFailures'), 10000, 'slot avoid failures after recipe')
      await waitUntil(() => finishingSlot.value.includes('detailed eyes') && avoidSlot.value.includes('artifact'), 10000, 'recipe inserted into slots')

      const templateName = tempTemplatePrefix + ' ' + Date.now()
      const templateNameInput = await waitUntil(() => testId('prompt-composer-template-name'), 10000, 'template name input')
      setValue(templateNameInput, templateName)
      click(await waitUntil(() => testId('prompt-composer-template-save'), 10000, 'template save button'))
      const savedTemplate = await waitUntil(async () => {
        const templates = await window.api.storage.listPromptComposerSlotTemplates()
        return templates.find((item) => item.name === templateName) || null
      }, 10000, 'saved slot template')
      savedTemplateId = savedTemplate.id
      setValue(await waitUntil(() => testId('prompt-composer-slot-subject'), 10000, 'slot subject before template load'), '')
      click(await waitUntil(() => testId('prompt-composer-template-load'), 10000, 'template load button'))
      const restoredSubject = await waitUntil(() => {
        const subject = testId('prompt-composer-slot-subject')
        return subject?.value.includes('1girl') ? subject : null
      }, 10000, 'slot template restored subject')
      click(await waitUntil(() => testId('prompt-composer-template-delete'), 10000, 'template delete button'))
      await waitUntil(async () => {
        const templates = await window.api.storage.listPromptComposerSlotTemplates()
        return !templates.some((item) => item.id === savedTemplate.id)
      }, 10000, 'deleted slot template')
      savedTemplateId = null
      templateRoundTrip = {
        saved: Boolean(savedTemplate),
        loaded: restoredSubject.value.includes('1girl'),
        deleted: true
      }

      click(await waitUntil(() => testId('prompt-composer-slots-apply-positive'), 10000, 'apply slots positive'))
      await waitUntil(() => {
        const value = positive.value
        return value.includes('masterpiece') &&
          value.includes('1girl') &&
          value.includes(libraryTagText) &&
          value.includes('upper body') &&
          value.includes('soft lighting') &&
          value.includes('clean lineart') &&
          value.includes('<lora:qa_style:0.5>')
      }, 10000, 'slot positive prompt applied')
      click(await waitUntil(() => testId('prompt-composer-slots-apply-negative'), 10000, 'apply slots negative'))
      await waitUntil(() => {
        const value = negative.value
        return value.includes('bad hands') &&
          value.includes('text') &&
          value.includes('logo')
      }, 10000, 'slot negative prompt applied')
      const slotPreview = await waitUntil(() => testId('prompt-composer-slots-preview'), 10000, 'slot preview')

      click(await waitUntil(() => testId('main-tab-tags'), 10000, 'tags tab'))
      const tagsComposer = await waitUntil(() => testId('tags-workspace-composer'), 10000, 'tags workspace composer')
      const quickInput = await waitUntil(() => testId('tags-workspace-quick-add')?.querySelector('input'), 10000, 'tags quick add input')
      const tagPositive = await waitUntil(() => testId('tags-workspace-positive')?.querySelector('textarea'), 10000, 'tags positive textarea')
      previousTagsPrompt = tagPositive.value
      shouldRestoreTags = true
      setValue(tagPositive, '')
      setValue(quickInput, 'コスプレ、初音ミク、ダンスシーン')
      await sleep(200)
      click(await waitUntil(() => tagsComposer.querySelector('[data-testid="prompt-composer-primary"]'), 10000, 'tags composer primary'))
      await waitUntil(() => tagPositive.value.includes('cosplay') &&
        tagPositive.value.includes('hatsune miku') &&
        tagPositive.value.includes('dance scene'), 10000, 'tags workspace translated tags')

      return {
        ok: true,
        txt2imgPrompt: positive.value,
        negativePrompt: negative.value,
        tagsPrompt: tagPositive.value,
        tagsComposer: Boolean(tagsComposer),
        slots: {
          style: slotStyle,
          negativeStrategy: slotNegativeStrategy,
          order: slotOrder,
          templateRoundTrip,
          preview: Boolean(slotPreview),
          libraryInserted: clothingSlot.value.includes(libraryTagText),
          recipePanel: Boolean(recipePanel),
          recipeInserted: finishingSlot.value.includes('detailed eyes') && avoidSlot.value.includes('artifact'),
          qualityFirst: positive.value.indexOf('masterpiece') >= 0 && positive.value.indexOf('masterpiece') < positive.value.indexOf('1girl'),
          positiveApplied: positive.value.includes('masterpiece') && positive.value.includes('1girl') && positive.value.includes(libraryTagText) && positive.value.includes('<lora:qa_style:0.5>') && positive.value.includes('detailed eyes'),
          negativeApplied: negative.value.includes('bad hands') && negative.value.includes('logo') && negative.value.includes('artifact')
        }
      }
    } finally {
      if (savedTemplateId) {
        try { await window.api.storage.deletePromptComposerSlotTemplate(savedTemplateId) } catch {}
      }
      await cleanupPromptComposerTemplates()
      click(await waitUntil(() => testId('main-tab-txt2img'), 10000, 'restore txt2img tab'))
      const restored = await waitUntil(() => testId('prompt-positive-editor'), 10000, 'restore positive prompt editor')
      const restoredNegative = await waitUntil(() => testId('prompt-negative-editor'), 10000, 'restore negative prompt editor')
      setValue(restored, previousPrompt)
      setValue(restoredNegative, previousNegative)
      if (shouldRestoreTags) {
        click(await waitUntil(() => testId('main-tab-tags'), 10000, 'restore tags tab'))
        const restoredTagPositive = await waitUntil(() => testId('tags-workspace-positive')?.querySelector('textarea'), 10000, 'restore tags positive textarea')
        setValue(restoredTagPositive, previousTagsPrompt)
      }
      click(await waitUntil(() => testId('main-tab-txt2img'), 10000, 'final txt2img tab'))
    }
  })()`
}

function promptFormatExpression() {
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
        const value = predicate()
        if (value) return value
        await sleep(200)
      }
      throw new Error('Timed out waiting for ' + label)
    }

    click(await waitUntil(() => testId('main-tab-txt2img'), 10000, 'txt2img tab'))
    const positive = await waitUntil(() => testId('prompt-positive-editor'), 10000, 'positive editor')
    const negative = await waitUntil(() => testId('prompt-negative-editor'), 10000, 'negative editor')
    const previousPositive = positive.value
    const previousNegative = negative.value

    try {
      setValue(positive, 'masterpiece,, best_quality, masterpiece, <lyco:foo_bar:0.8>, BREAK, score_9')
      setValue(negative, 'lowres,, bad_anatomy, lowres, <lora:neg_pack:1>')
      const warning = await waitUntil(() => testId('preflight-item-prompt-format'), 10000, 'prompt format warning')
      const canFix = warning.getAttribute('data-preflight-can-fix')
      const legacyLyco = await waitUntil(() => testId('preflight-item-adapter-legacy-lyco'), 10000, 'legacy lyco warning')
      const complexAdapter = await waitUntil(() => testId('preflight-item-adapter-complex-weight'), 10000, 'complex adapter warning')
      click(await waitUntil(() => testId('prompt-format-positive'), 10000, 'positive format button'))
      await waitUntil(() => positive.value === 'masterpiece, best quality, <lyco:foo_bar:0.8>, BREAK, score_9', 10000, 'positive prompt formatted')
      setValue(positive, 'masterpiece,, best_quality, masterpiece, <lyco:foo_bar:0.8>, BREAK, score_9')
      await waitUntil(() => testId('preflight-item-prompt-format'), 10000, 'prompt format warning restored')
      click(await waitUntil(() => testId('preflight-fix-prompt-format'), 10000, 'preflight prompt format quick fix'))
      await waitUntil(() => positive.value === 'masterpiece, best quality, <lyco:foo_bar:0.8>, BREAK, score_9', 10000, 'positive quick fixed')
      await waitUntil(() => negative.value === 'lowres, bad anatomy, <lora:neg_pack:1>', 10000, 'negative quick fixed')
      await waitUntil(() => !testId('preflight-item-prompt-format'), 10000, 'prompt format warning cleared')
      return {
        ok: canFix === 'true' &&
          legacyLyco.getAttribute('data-preflight-severity') === 'warn' &&
          complexAdapter.getAttribute('data-preflight-severity') === 'warn' &&
          positive.value.includes('<lyco:foo_bar:0.8>') &&
          negative.value.includes('<lora:neg_pack:1>') &&
          !positive.value.includes('best_quality') &&
          !negative.value.includes('bad_anatomy'),
        canFix,
        adapterWarnings: {
          legacyLyco: legacyLyco.getAttribute('data-preflight-severity'),
          complexAdapter: complexAdapter.getAttribute('data-preflight-severity')
        },
        positive: positive.value,
        negative: negative.value
      }
    } finally {
      setValue(positive, previousPositive)
      setValue(negative, previousNegative)
    }
  })()`
}

function dynamicPromptExpression() {
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
        const value = predicate()
        if (value) return value
        await sleep(200)
      }
      throw new Error('Timed out waiting for ' + label)
    }

    click(await waitUntil(() => testId('main-tab-txt2img'), 10000, 'txt2img tab'))
    const positive = await waitUntil(() => testId('prompt-positive-editor'), 10000, 'positive editor')
    const negative = await waitUntil(() => testId('prompt-negative-editor'), 10000, 'negative editor')
    const previousPositive = positive.value
    const previousNegative = negative.value

    try {
      setValue(positive, 'qa dynamic {red dress|blue kimono|white hoodie}, looking at viewer')
      setValue(negative, 'lowres, {bad hands|text}')
      const lab = await waitUntil(() => testId('dynamic-prompt-lab'), 10000, 'dynamic prompt lab')
      if (!testId('dynamic-prompt-summary')) click(await waitUntil(() => testId('dynamic-prompt-toggle'), 10000, 'dynamic prompt toggle'))
      const seed = await waitUntil(() => testId('dynamic-prompt-seed'), 10000, 'dynamic prompt seed')
      setValue(seed, '1234')
      const summary = await waitUntil(() => testId('dynamic-prompt-summary'), 10000, 'dynamic prompt summary')
      await waitUntil(() => {
        const text = summary.textContent || ''
        return text.includes('qa dynamic') &&
          (text.includes('red dress') || text.includes('blue kimono') || text.includes('white hoodie'))
      }, 10000, 'dynamic prompt preview text')
      click(await waitUntil(() => testId('dynamic-prompt-apply-preview'), 10000, 'apply first dynamic prompt'))
      await waitUntil(() =>
        positive.value.includes('qa dynamic') &&
        !positive.value.includes('{') &&
        (positive.value.includes('red dress') || positive.value.includes('blue kimono') || positive.value.includes('white hoodie')),
        10000,
        'resolved prompt applied'
      )
      const appliedValue = positive.value

      setValue(positive, 'qa missing __yoitomoshi_missing_wildcard__')
      const issues = await waitUntil(() => testId('dynamic-prompt-issues'), 10000, 'dynamic prompt missing wildcard issue')
      const issueText = issues.textContent || ''
      return {
        ok: lab &&
          appliedValue.includes('qa dynamic') &&
          !appliedValue.includes('{') &&
          issueText.includes('yoitomoshi_missing_wildcard'),
        appliedValue,
        issueText
      }
    } finally {
      setValue(positive, previousPositive)
      setValue(negative, previousNegative)
    }
  })()`
}

function generationModesExpression() {
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
    const dragChip = (from, to) => {
      const data = new DataTransfer()
      data.effectAllowed = 'move'
      data.setData('text/plain', String(from))
      const chips = Array.from(testId('prompt-positive-tags')?.querySelectorAll('[draggable="true"]') || [])
      const source = chips[from]
      const target = chips[to]
      if (!source || !target) throw new Error('Missing prompt tag chip for drag test')
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: data }))
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data }))
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }))
      source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: data }))
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

    click(await waitUntil(() => testId('main-tab-txt2img'), 10000, 'txt2img tab'))
    await waitUntil(() => testId('generation-panel-basic'), 10000, 'basic settings panel')
    const obsoleteModeControlsAbsent = !testId('generation-section-navigator') &&
      !testId('generation-mode-create') &&
      !testId('generation-mode-refine') &&
      !testId('generation-mode-advanced')
    const allPanelsVisible = Boolean(testId('generation-panel-basic')) &&
      Boolean(testId('generation-panel-prompt')) &&
      Boolean(testId('generation-panel-extensions')) &&
      Boolean(testId('generation-panel-basic-content')) &&
      Boolean(testId('generation-panel-prompt-content')) &&
      Boolean(testId('generation-panel-extensions-content')) &&
      Boolean(testId('parameters-panel')) &&
      Boolean(testId('prompt-helper-panel')) &&
      Boolean(testId('dynamic-prompt-lab')) &&
      Boolean(testId('research-workflow-panel')) &&
      Boolean(testId('controlnet-builder-panel')) &&
      Boolean(testId('controlnet-panel')) &&
      Boolean(testId('adetailer-panel')) &&
      Boolean(testId('fabric-panel')) &&
      Boolean(testId('freeu-panel'))
    const panelLayoutOk = ['generation-panel-basic', 'generation-panel-prompt', 'generation-panel-extensions'].every((id) => {
      const panel = testId(id)
      if (!panel) return false
      const rect = panel.getBoundingClientRect()
      const text = (panel.textContent || '').trim()
      return rect.width >= 300 && rect.height >= 32 && text.length > 2
    })
    const positive = await waitUntil(() => testId('prompt-positive-editor'), 10000, 'positive editor')
    const previousPositive = positive.value
    setValue(positive, 'alpha tag, beta tag, gamma tag')
    await waitUntil(() => (testId('prompt-positive-tags')?.querySelectorAll('[draggable="true"]').length || 0) >= 3, 10000, 'prompt tag chips near editor')
    dragChip(0, 2)
    await waitUntil(() => positive.value.startsWith('beta tag, gamma tag, alpha tag'), 10000, 'prompt tag reorder near editor')
    const tagReorderOk = positive.value.startsWith('beta tag, gamma tag, alpha tag')
    const refineOk = Boolean(await waitUntil(() => testId('prompt-helper-panel'), 10000, 'prompt helper panel')) &&
      Boolean(await waitUntil(() => testId('dynamic-prompt-lab'), 10000, 'dynamic prompt lab')) &&
      Boolean(await waitUntil(() => testId('research-workflow-panel'), 10000, 'research workflow panel')) &&
      Boolean(await waitUntil(() => testId('prompt-positive-section'), 10000, 'positive prompt section')) &&
      Boolean(await waitUntil(() => testId('prompt-negative-section'), 10000, 'negative prompt section')) &&
      Boolean(await waitUntil(() => testId('prompt-positive-tags'), 10000, 'positive tag chips'))

    const advancedOk = Boolean(await waitUntil(() => testId('controlnet-builder-panel'), 10000, 'controlnet builder')) &&
      Boolean(await waitUntil(() => testId('controlnet-panel'), 10000, 'controlnet panel')) &&
      Boolean(await waitUntil(() => testId('adetailer-panel'), 10000, 'adetailer panel')) &&
      Boolean(await waitUntil(() => testId('fabric-panel'), 10000, 'fabric panel')) &&
      Boolean(await waitUntil(() => testId('freeu-panel'), 10000, 'freeu panel'))

    try {
      setValue(positive, 'qa {red|blue} dress')
      await waitUntil(() => testId('active-feature-chip-dynamic-prompt'), 10000, 'dynamic prompt chip')
      click(testId('active-feature-chip-dynamic-prompt'))
      await waitUntil(() => Boolean(testId('dynamic-prompt-lab')), 10000, 'dynamic chip keeps prompt lab available')

      const formatButton = await waitUntil(() => testId('preflight-open-dynamic-prompt'), 10000, 'dynamic preflight open')
      click(formatButton)
      await waitUntil(() => Boolean(testId('dynamic-prompt-lab')), 10000, 'preflight keeps prompt lab available')

      return {
        ok: obsoleteModeControlsAbsent && allPanelsVisible && panelLayoutOk && refineOk && advancedOk && tagReorderOk,
        obsoleteModeControlsAbsent,
        allPanelsVisible,
        panelLayoutOk,
        refineOk,
        advancedOk,
        tagReorderOk,
        dynamicChipVisible: Boolean(testId('active-feature-chip-dynamic-prompt'))
      }
    } finally {
      setValue(positive, previousPositive)
    }
  })()`
}

function tagLibraryImportSetupExpression(fixture) {
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
    const waitUntil = async (predicate, timeoutMs, label) => {
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        const value = await predicate()
        if (value) return value
        await sleep(150)
      }
      throw new Error('Timed out waiting for ' + label)
    }
    click(await waitUntil(() => testId('main-tab-tags'), 10000, 'tag management tab'))
    const input = await waitUntil(() => testId('prompt-library-import-input'), 10000, 'import file input')
    const button = await waitUntil(() => testId('prompt-library-import-button'), 10000, 'import button')
    window.__yoitomoshiTagImportOriginal = await window.api.library.getCustom()
    const originalHasFixture = window.__yoitomoshiTagImportOriginal.some((category) =>
      category.name === ${JSON.stringify(fixture.categoryName)}
    )
    return {
      ok: Boolean(input && button),
      originalCustomCategories: window.__yoitomoshiTagImportOriginal.length,
      originalHasFixture
    }
  })()`
}

function tagLibraryImportCheckExpression(fixture) {
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
    const waitUntil = async (predicate, timeoutMs, label) => {
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        const value = await predicate()
        if (value) return value
        await sleep(150)
      }
      throw new Error('Timed out waiting for ' + label)
    }

    const preview = await waitUntil(() => testId('prompt-library-import-preview'), 10000, 'import preview')
    const counts = {
      newTags: Number(preview.getAttribute('data-import-new-tags')),
      duplicateTags: Number(preview.getAttribute('data-import-duplicate-tags')),
      invalidTags: Number(preview.getAttribute('data-import-invalid-tags')),
      newCategories: Number(preview.getAttribute('data-import-new-categories')),
      newGroups: Number(preview.getAttribute('data-import-new-groups'))
    }
    click(await waitUntil(() => testId('prompt-library-import-apply'), 10000, 'import apply button'))

    const imported = await waitUntil(async () => {
      const custom = await window.api.library.getCustom()
      const category = custom.find((item) => item.name === ${JSON.stringify(fixture.categoryName)})
      const group = category?.groups.find((item) => item.name === ${JSON.stringify(fixture.groupName)})
      const tags = group?.tags.filter((tag) => tag.en === ${JSON.stringify(fixture.tagName)}) ?? []
      return tags.length === 1 ? { category, group, tag: tags[0] } : null
    }, 10000, 'imported tag persisted')

    const ok = counts.newTags === 1 &&
      counts.duplicateTags === 1 &&
      counts.invalidTags === 1 &&
      counts.newCategories === 1 &&
      counts.newGroups === 1 &&
      imported.tag.canonical === ${JSON.stringify(fixture.tagName)} &&
      imported.tag.aliases?.includes(${JSON.stringify(fixture.alias)}) &&
      imported.tag.source?.some((source) => source.kind === 'import') &&
      imported.tag.modelFamilies?.includes('sdxl')

    return {
      ok,
      format: ${JSON.stringify(fixture.format)},
      counts,
      imported: {
        category: imported.category.name,
        group: imported.group.name,
        tag: imported.tag.en,
        canonical: imported.tag.canonical,
        aliases: imported.tag.aliases ?? [],
        sourceKinds: (imported.tag.source ?? []).map((source) => source.kind),
        modelFamilies: imported.tag.modelFamilies ?? []
      }
    }
  })()`
}

function tagLibraryImportCleanupExpression() {
  return `(async () => {
    const original = window.__yoitomoshiTagImportOriginal
    if (!Array.isArray(original)) return { ok: true, restored: false }
    await window.api.library.saveCustom(original)
    delete window.__yoitomoshiTagImportOriginal
    return { ok: true, restored: true, categories: original.length }
  })()`
}

function promptTagLibraryAddExpression() {
  const tagName = 'blue sky'
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
        await sleep(150)
      }
      throw new Error('Timed out waiting for ' + label)
    }

    const originalCustom = await window.api.library.getCustom()
    const originalFavorites = await window.api.storage.getFavorites()
    click(await waitUntil(() => testId('main-tab-txt2img'), 10000, 'txt2img tab'))
    const positive = await waitUntil(() => testId('prompt-positive-editor'), 10000, 'positive prompt editor')
    const previousPositive = positive.value
    try {
      setValue(positive, ${JSON.stringify(tagName)})
      const chipArea = await waitUntil(() => testId('prompt-positive-tags'), 10000, 'positive tag chips')
      const editButton = await waitUntil(() => chipArea.querySelector('[data-testid="prompt-tag-library-edit-button"]'), 10000, 'library edit button')
      click(editButton)
      const editor = await waitUntil(() => testId('prompt-tag-library-editor'), 10000, 'tag library editor')
      const category = await waitUntil(() => testId('prompt-tag-library-category'), 10000, 'tag library category')
      const group = await waitUntil(() => testId('prompt-tag-library-group'), 10000, 'tag library group')
      const jaInput = await waitUntil(() => testId('prompt-tag-library-ja'), 10000, 'tag library ja input')
      click(await waitUntil(() => testId('prompt-tag-library-translate'), 10000, 'tag library translate'))
      await waitUntil(() => jaInput.value.trim().length > 0, 10000, 'translated tag suggestion')
      const translated = jaInput.value.trim()
      const favorite = await waitUntil(() => testId('prompt-tag-library-favorite'), 10000, 'tag library favorite')
      if (!favorite.checked) click(favorite)
      click(await waitUntil(() => testId('prompt-tag-library-save'), 10000, 'tag library save'))

      const persisted = await waitUntil(async () => {
        const custom = await window.api.library.getCustom()
        const targetCategory = custom.find((item) => item.name === category.value)
        const targetGroup = targetCategory?.groups.find((item) => item.name === group.value)
        const targetTag = targetGroup?.tags.find((item) => item.en === ${JSON.stringify(tagName)})
        return targetTag ? { category: targetCategory.name, group: targetGroup.name, tag: targetTag } : null
      }, 10000, 'prompt chip tag persisted')
      const favoriteSaved = await waitUntil(async () => {
        const favorites = await window.api.storage.getFavorites()
        return favorites.includes(${JSON.stringify(tagName)})
      }, 10000, 'prompt chip tag favorite saved')
      const chipTranslated = await waitUntil(() => (testId('prompt-positive-tags')?.textContent || '').includes(translated), 10000, 'chip translation visible')

      return {
        ok: Boolean(editor) && Boolean(chipTranslated) && Boolean(favoriteSaved) && persisted.tag.ja === translated,
        tag: persisted.tag.en,
        ja: persisted.tag.ja,
        category: persisted.category,
        group: persisted.group,
        favoriteSaved: Boolean(favoriteSaved),
        chipTranslated: Boolean(chipTranslated),
        sourceKinds: (persisted.tag.source || []).map((source) => source.kind)
      }
    } finally {
      setValue(positive, previousPositive)
      await window.api.library.saveCustom(originalCustom)
      await window.api.storage.setFavorites(originalFavorites)
    }
  })()`
}

function workspaceSidebarRestoreTabExpression() {
  const tempPrefix = 'Yoitomoshi DOM QA sidebar restore tab'
  const promptText = `${tempPrefix} ${Date.now()}`
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
    const waitUntil = async (predicate, timeoutMs, label) => {
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        const value = await predicate()
        if (value) return value
        await sleep(150)
      }
      throw new Error('Timed out waiting for ' + label)
    }
    const editorValue = () => {
      const editor = testId('prompt-positive-editor')
      if (!editor) return ''
      return 'value' in editor ? editor.value : editor.textContent || ''
    }
    const cleanupTempWorkspaces = async () => {
      const workspaces = await window.api.storage.listWorkspaces()
      for (const workspace of workspaces.filter((item) => item.name.startsWith(${JSON.stringify(tempPrefix)}))) {
        await window.api.storage.deleteWorkspace(workspace.id)
      }
    }

    await cleanupTempWorkspaces()
    const saved = await window.api.storage.saveWorkspace({
      name: ${JSON.stringify(tempPrefix)} + ' ' + Date.now(),
      snapshot: {
        imageSaveMode: 'settings-only',
        currentTab: 'tools',
        prompt: ${JSON.stringify(promptText)},
        negativePrompt: 'sidebar restore should keep current tab',
        params: {
          steps: 18,
          cfgScale: 6,
          width: 1024,
          height: 1024,
          sampler: 'Euler',
          scheduler: 'Automatic',
          seed: -1,
          batchSize: 1,
          iterations: 1,
          clipSkip: 2,
          denoisingStrength: 0.35
        },
        selectedModelTitle: '',
        selectedVae: 'Automatic',
        activeLoras: [],
        inputImageDataUrl: null,
        inputImageFilename: null,
        inpaintMaskImage: null,
        lastImageDataUrl: null,
        upscaleInputImageDataUrl: null,
        upscaleOutputImageDataUrl: null,
        upscale: {},
        video: {},
        controlnet: { units: [] },
        regionalPrompter: {},
        fabric: { positive: [], negative: [] },
        adetailer: {},
        dynThres: {},
        freeu: {}
      }
    })

    try {
      click(await waitUntil(() => testId('main-tab-txt2img'), 10000, 'txt2img tab'))
      await waitUntil(() => testId('prompt-positive-editor'), 10000, 'txt2img prompt editor')
      click(await waitUntil(() => testId('side-tab-presets'), 10000, 'side presets tab'))
      click(await waitUntil(() => testId('workspace-refresh'), 10000, 'workspace refresh button'))
      click(await waitUntil(() => testId('workspace-restore-' + saved.id), 10000, 'sidebar workspace restore button'))
      await waitUntil(() => editorValue().includes(${JSON.stringify(promptText)}), 10000, 'restored prompt while staying on txt2img')

      const txtSelected = testId('main-tab-txt2img')?.getAttribute('aria-selected') === 'true'
      const toolsSelected = testId('main-tab-tools')?.getAttribute('aria-selected') === 'true'
      return {
        ok: txtSelected && !toolsSelected,
        workspaceId: saved.id,
        promptRestored: editorValue().includes(${JSON.stringify(promptText)}),
        txtSelected,
        toolsSelected
      }
    } finally {
      await cleanupTempWorkspaces()
    }
  })()`
}

function previewInspectorToggleExpression() {
  const tempPrefix = 'Yoitomoshi DOM QA preview inspector'
  const promptText = `${tempPrefix} ${Date.now()}`
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
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
    const waitUntil = async (predicate, timeoutMs, label) => {
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        const value = await predicate()
        if (value) return value
        await sleep(150)
      }
      throw new Error('Timed out waiting for ' + label)
    }
    const cleanupTempWorkspaces = async () => {
      const workspaces = await window.api.storage.listWorkspaces()
      for (const workspace of workspaces.filter((item) => item.name.startsWith(${JSON.stringify(tempPrefix)}))) {
        await window.api.storage.deleteWorkspace(workspace.id)
      }
    }

    await cleanupTempWorkspaces()
    const saved = await window.api.storage.saveWorkspace({
      name: ${JSON.stringify(tempPrefix)} + ' ' + Date.now(),
      snapshot: {
        imageSaveMode: 'embed',
        currentTab: 'txt2img',
        prompt: ${JSON.stringify(promptText)},
        negativePrompt: 'preview inspector toggle',
        params: {
          steps: 10,
          cfgScale: 2.5,
          width: 768,
          height: 1024,
          sampler: 'DPM++ 2M',
          scheduler: '',
          seed: -1,
          batchSize: 1,
          iterations: 1,
          clipSkip: 1,
          denoisingStrength: 0.65
        },
        selectedModelTitle: '',
        selectedVae: 'Automatic',
        activeLoras: [],
        inputImageDataUrl: null,
        inputImageFilename: null,
        inpaintMaskImage: null,
        lastImageDataUrl: ${JSON.stringify(tinyPng)},
        upscaleInputImageDataUrl: null,
        upscaleOutputImageDataUrl: null,
        upscale: {},
        video: {},
        controlnet: { units: [] },
        regionalPrompter: {},
        fabric: { positive: [], negative: [] },
        adetailer: {},
        dynThres: {},
        freeu: {}
      }
    })

    try {
      click(await waitUntil(() => testId('main-tab-txt2img'), 10000, 'txt2img tab'))
      await waitUntil(() => testId('prompt-positive-editor'), 10000, 'txt2img prompt editor')
      click(await waitUntil(() => testId('side-tab-presets'), 10000, 'side presets tab'))
      click(await waitUntil(() => testId('workspace-refresh'), 10000, 'workspace refresh button'))
      click(await waitUntil(() => testId('workspace-restore-' + saved.id), 10000, 'sidebar workspace restore button'))
      await waitUntil(() => testId('prompt-positive-editor')?.value?.includes(${JSON.stringify(promptText)}), 10000, 'restored prompt')

      const toggle = await waitUntil(() => testId('preview-inspector-toggle'), 10000, 'preview inspector toggle')
      const initiallyExpanded = toggle.getAttribute('aria-expanded') === 'true'
      const initiallyRendered = Boolean(testId('preview-inspector'))

      if (initiallyExpanded) click(toggle)
      await waitUntil(() => testId('preview-inspector-toggle')?.getAttribute('aria-expanded') === 'false', 10000, 'inspector closed')
      const closedRendered = Boolean(testId('preview-inspector'))

      click(await waitUntil(() => testId('preview-inspector-toggle'), 10000, 'preview inspector toggle reopen'))
      await waitUntil(() => testId('preview-inspector-toggle')?.getAttribute('aria-expanded') === 'true', 10000, 'inspector opened')
      const openRendered = Boolean(testId('preview-inspector'))
      const metadataRendered = Boolean(testId('preview-inspector')?.querySelector('[data-testid="metadata-info-panel"]'))
      const nextImageRendered = Boolean(testId('preview-inspector')?.querySelector('[data-testid="next-image-panel"]'))

      click(await waitUntil(() => testId('preview-inspector-toggle'), 10000, 'preview inspector toggle close'))
      await waitUntil(() => testId('preview-inspector-toggle')?.getAttribute('aria-expanded') === 'false', 10000, 'inspector closed again')
      const finalRendered = Boolean(testId('preview-inspector'))

      return {
        ok: !closedRendered && openRendered && metadataRendered && nextImageRendered && !finalRendered,
        initiallyExpanded,
        initiallyRendered,
        closedRendered,
        openRendered,
        metadataRendered,
        nextImageRendered,
        finalRendered
      }
    } finally {
      await cleanupTempWorkspaces()
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
    const pickSdxlModelTitle = async () => {
      const models = await window.api.forge.listModels().catch(() => [])
      const preferred = models.find((model) =>
        /novaAnimeXL/i.test([model.title, model.modelName, model.filename].filter(Boolean).join(' '))
      )
      const sdxl = preferred ?? models.find((model) =>
        /sdxl|\\bxl\\b|pony|illustrious|animagine|noobai/i.test(
          [model.title, model.modelName, model.filename].filter(Boolean).join(' ')
        )
      )
      return sdxl?.title || sdxl?.modelName || snapshot.selectedModelTitle
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

      const selectedModelTitle = await pickSdxlModelTitle()
      saved = await window.api.storage.saveWorkspace({
        name: tempPrefix + ' ' + Date.now(),
        snapshot: { ...snapshot, selectedModelTitle }
      })
      click(await waitUntil(() => testId('side-tab-presets'), 10000, 'side presets tab'))
      click(await waitUntil(() => testId('workspace-refresh'), 10000, 'workspace refresh button'))
      click(await waitUntil(() => testId('workspace-restore-' + saved.id), 10000, 'sidebar workspace restore button'))

      const requiredWarnings = ['lora-base', 'lora-trigger', 'sdxl-size']
      const requiredBlockers = ['cn-base-0']
      const requiredItems = [...requiredWarnings, ...requiredBlockers]
      await waitUntil(() => requiredItems.every((key) => testId('preflight-item-' + key)), 10000, 'P2 preflight items')
      const generateButton = await waitUntil(() => testId('generate-button'), 10000, 'generate button')
      const beforeDisabled = generateButton.disabled
      const beforeReason = generateButton.getAttribute('data-disabled-reason') || ''
      const preflightBefore = Object.fromEntries(requiredItems.map((key) => {
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
        checkLibraryIntegrity: typeof window.api.tools.checkLibraryIntegrity === 'function',
        inspectPersonalHealth: typeof window.api.tools.inspectPersonalHealth === 'function',
        runPersonalHealthRecovery: typeof window.api.tools.runPersonalHealthRecovery === 'function'
      }
      click(await waitUntil(() => testId('main-tab-models'), 10000, 'Models tab'))
      await waitUntil(() => testId('model-library-workspace'), 10000, 'model library workspace')
      const libraryCard = await waitUntil(() => testId('model-library-card'), 10000, 'model library card')

      return {
        ok: beforeDisabled &&
          preflightBefore['cn-base-0']?.severity === 'block' &&
          Object.values(apiSurface).every(Boolean) &&
          promptSectionVisible,
        workspaceId: saved.id,
        selectedModelTitle,
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
    const pickSdxlModelTitle = async () => {
      const models = await window.api.forge.listModels().catch(() => [])
      const preferred = models.find((model) =>
        /novaAnimeXL/i.test([model.title, model.modelName, model.filename].filter(Boolean).join(' '))
      )
      const sdxl = preferred ?? models.find((model) =>
        /sdxl|\\bxl\\b|pony|illustrious|animagine|noobai/i.test(
          [model.title, model.modelName, model.filename].filter(Boolean).join(' ')
        )
      )
      return sdxl?.title || sdxl?.modelName || snapshot.selectedModelTitle
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

      const selectedModelTitle = await pickSdxlModelTitle()
      saved = await window.api.storage.saveWorkspace({
        name: tempPrefix + ' ' + Date.now(),
        snapshot: { ...snapshot, selectedModelTitle }
      })
      click(await waitUntil(() => testId('side-tab-presets'), 10000, 'side presets tab'))
      click(await waitUntil(() => testId('workspace-refresh'), 10000, 'workspace refresh button'))
      click(await waitUntil(() => testId('workspace-restore-' + saved.id), 10000, 'sidebar workspace restore button'))

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
        ok: items['cn-base-0']?.severity === 'block',
        workspaceId: saved.id,
        selectedModelTitle,
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

function adapterScanCollisionExpression() {
  return `(async () => {
    const fixture = 'yoitomoshi-adapter-collision-qa'
    const loras = await window.api.forge.listLoras()
    const matches = loras.filter((item) =>
      item.tokenName === fixture ||
      item.alias === fixture ||
      String(item.name || '').endsWith('/' + fixture)
    )
    const roots = matches.map((item) => item.sourceRoot).sort()
    const names = matches.map((item) => item.name).sort()
    const ok = matches.length === 2 &&
      roots.includes('Lora') &&
      roots.includes('LyCORIS') &&
      names.includes('Lora/' + fixture) &&
      names.includes('LyCORIS/' + fixture) &&
      matches.every((item) => item.tokenName === fixture)
    return {
      ok,
      fixture,
      matches: matches.map((item) => ({
        name: item.name,
        alias: item.alias,
        tokenName: item.tokenName,
        sourceRoot: item.sourceRoot,
        adapterSubtype: item.adapterSubtype
      }))
    }
  })()`
}

function workspacePreflightExpression() {
  const tempPrefix = 'Yoitomoshi DOM QA workspace preflight'
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
      for (const workspace of workspaces.filter((item) => item.name.startsWith(${JSON.stringify(tempPrefix)}))) {
        await window.api.storage.deleteWorkspace(workspace.id)
      }
    }
    const snapshot = {
      imageSaveMode: 'references',
      imageReferences: {
        inputImage: {
          kind: 'file',
          path: 'C:\\\\yoitomoshi-missing-workspace-preflight.png',
          filename: 'yoitomoshi-missing-workspace-preflight.png'
        }
      },
      currentTab: 'txt2img',
      prompt: 'workspace preflight qa',
      negativePrompt: '',
      params: {
        steps: 20,
        cfgScale: 7,
        width: 832,
        height: 1216,
        sampler: 'Euler',
        scheduler: 'Automatic',
        seed: -1,
        batchSize: 1,
        iterations: 1,
        clipSkip: 2,
        denoisingStrength: 0.35
      },
      selectedModelTitle: 'yoitomoshi-missing-model.safetensors [0000000000]',
      selectedVae: 'yoitomoshi-missing-vae.safetensors',
      activeLoras: [
        {
          name: 'yoitomoshi-missing-adapter',
          tokenName: 'yoitomoshi-missing-adapter',
          sourceRoot: 'Lora',
          adapterSubtype: 'LoRA',
          weight: 0.8,
          triggerWords: []
        }
      ],
      inputImageDataUrl: null,
      inputImageFilename: null,
      inpaintMaskImage: null,
      lastImageDataUrl: null,
      upscaleInputImageDataUrl: null,
      upscaleOutputImageDataUrl: null,
      upscale: {},
      controlnet: {},
      adetailer: {},
      dynThres: {},
      freeu: {}
    }

    let saved = null
    click(await waitUntil(() => testId('main-tab-txt2img'), 10000, 'txt2img tab before workspace setup'))
    await sleep(300)
    await cleanupTempWorkspaces()
    try {
      saved = await window.api.storage.saveWorkspace({
        name: ${JSON.stringify(tempPrefix)} + ' ' + Date.now(),
        snapshot
      })
      click(await waitUntil(() => testId('side-tab-presets'), 10000, 'side presets tab'))
      click(await waitUntil(() => testId('workspace-refresh'), 10000, 'workspace refresh button'))
      click(await waitUntil(() => testId('workspace-preflight-run-' + saved.id), 10000, 'sidebar workspace preflight button'))
      const panel = await waitUntil(() => testId('workspace-preflight-' + saved.id), 10000, 'workspace preflight panel')
      await waitUntil(() => panel.getAttribute('data-workspace-preflight-status') === 'warn', 10000, 'workspace preflight warn status')
      const issueCount = Number(panel.getAttribute('data-workspace-preflight-issues'))
      return {
        ok: issueCount >= 4,
        workspaceId: saved.id,
        issueCount,
        status: panel.getAttribute('data-workspace-preflight-status')
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
