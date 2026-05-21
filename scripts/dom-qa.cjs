#!/usr/bin/env node

const DEFAULT_PORT = Number(process.env.QA_CDP_PORT || 9338)
const COMMANDS = new Set([
  'preflight-mismatch',
  'selectors',
  'p2-fixture',
  'api-surface',
  'forge-core-smoke',
  'forge-controlnet-diagnostic',
  'tagger-smoke',
  'tagger-blacklist-filter',
  'partial-delete-smoke',
  'history-tag-review',
  'history-review-persistence',
  'history-review-prompt-bridge',
  'history-review-report-source',
  'prompt-helper-review-tags',
  'prompt-format',
  'dynamic-prompt',
  'generation-modes',
  'adapter-scan-collision',
  'workspace-preflight',
  'model-auto-organize'
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
    if (command === 'prompt-format') {
      const result = await evaluate(cdp, promptFormatExpression())
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
  node scripts/dom-qa.cjs forge-core-smoke [--port=9338]
  node scripts/dom-qa.cjs forge-controlnet-diagnostic [--port=9338]
  node scripts/dom-qa.cjs tagger-smoke [--port=9338]
  node scripts/dom-qa.cjs tagger-blacklist-filter [--port=9338]
  node scripts/dom-qa.cjs partial-delete-smoke [--port=9338]
  node scripts/dom-qa.cjs history-tag-review [--port=9338]
  node scripts/dom-qa.cjs history-review-persistence [--port=9338]
  node scripts/dom-qa.cjs history-review-prompt-bridge [--port=9338]
  node scripts/dom-qa.cjs history-review-report-source [--port=9338]
  node scripts/dom-qa.cjs prompt-helper-review-tags [--port=9338]
  node scripts/dom-qa.cjs prompt-format [--port=9338]
  node scripts/dom-qa.cjs dynamic-prompt [--port=9338]
  node scripts/dom-qa.cjs generation-modes [--port=9338]
  node scripts/dom-qa.cjs adapter-scan-collision [--port=9338]
  node scripts/dom-qa.cjs workspace-preflight [--port=9338]
  node scripts/dom-qa.cjs model-auto-organize [--port=9338]

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
  return `(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    document.querySelector('[data-testid="main-tab-txt2img"]')?.click()
    await sleep(100)
    const baseIds = [
      'main-tab-txt2img',
      'main-tab-tags',
      'main-tab-video',
      'main-tab-models',
      'main-tab-tools',
      'side-tab-library',
      'side-tab-lora',
      'preflight-panel',
      'preflight-summary',
      'generate-button',
      'prompt-positive-section',
      'prompt-negative-section',
      'prompt-positive-editor',
      'prompt-negative-editor',
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
    const selectors = Object.fromEntries(baseIds.map((id) => [id, Boolean(document.querySelector('[data-testid="' + id + '"]'))]))
    document.querySelector('[data-testid="main-tab-tags"]')?.click()
    await sleep(500)
    const tagIds = [
      'tags-workspace-library',
      'tags-workspace-quick-add',
      'tags-workspace-positive',
      'tags-workspace-negative',
    ]
    for (const id of tagIds) {
      selectors[id] = Boolean(document.querySelector('[data-testid="' + id + '"]'))
    }
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
    }
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
      saveWorkspace: typeof window.api?.storage?.saveWorkspace === 'function',
      saveGeneratedVideo: typeof window.api?.storage?.saveGeneratedVideo === 'function'
    }
    return {
      ok: Object.values(surface).every(Boolean),
      surface
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
      click(await waitUntil(() => testId('main-tab-tools'), 10000, 'Tools tab'))
      click(await waitUntil(() => testId('workspace-restore-' + saved.id), 10000, 'workspace restore button'))

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
        checkLibraryIntegrity: typeof window.api.tools.checkLibraryIntegrity === 'function'
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
      click(await waitUntil(() => testId('main-tab-tools'), 10000, 'Tools tab'))
      click(await waitUntil(() => testId('workspace-preflight-run-' + saved.id), 10000, 'workspace preflight button'))
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
