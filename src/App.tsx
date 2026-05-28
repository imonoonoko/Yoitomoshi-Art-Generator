import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useStore, type AppState } from './lib/store'
import { api } from './lib/ipc'
import {
  promptDigestOf,
  scoreLoras
} from './lib/lora-suggest'
import {
  buildGenerationPlan,
  buildImg2ImgRequest,
  generatedSeedFromInfo,
  imageDataUrlFromPngBase64,
  makeThumbnail
} from './lib/generation-utils'
import {
  checkpointPromptContextFromModel,
  checkpointPromptProfileParamsChanged,
  checkpointPromptProfileParamsPatch,
  findCheckpointPromptProfile,
  formatPromptForCheckpoint
} from './lib/checkpoint-prompt-profile'
import { getExtensionGuardIssues } from './lib/extension-guards'
import { TitleBar } from './components/TitleBar'
import { MainTabs } from './components/MainTabs'
import { PromptPanel } from './components/PromptPanel'
import { PreviewPanel } from './components/PreviewPanel'
import { SidePanel } from './components/SidePanel'
import { StartupOverlay } from './components/StartupOverlay'
import { SettingsModal } from './components/SettingsModal'
import { ShortcutsModal } from './components/ShortcutsModal'
import { PromptDictionaryAutocompleteLayer } from './components/PromptDictionaryAutocompleteLayer'
import { t as tStatic } from './lib/i18n'
import type { CivitaiAssetType, Txt2ImgResponse } from '@shared/types'

const UpscaleWorkspace = lazy(() =>
  import('./components/UpscaleWorkspace').then((m) => ({ default: m.UpscaleWorkspace }))
)
const VideoWorkspace = lazy(() =>
  import('./components/VideoWorkspace').then((m) => ({ default: m.VideoWorkspace }))
)
const PromptTagsWorkspace = lazy(() =>
  import('./components/PromptTagsWorkspace').then((m) => ({ default: m.PromptTagsWorkspace }))
)
const PromptDictionaryWorkspace = lazy(() =>
  import('./components/PromptDictionaryWorkspace').then((m) => ({ default: m.PromptDictionaryWorkspace }))
)
const ModelLibraryWorkspace = lazy(() =>
  import('./components/ModelLibraryWorkspace').then((m) => ({ default: m.ModelLibraryWorkspace }))
)
const ToolsWorkspace = lazy(() =>
  import('./components/ToolsWorkspace').then((m) => ({ default: m.ToolsWorkspace }))
)
const CivitaiSearchModal = lazy(() =>
  import('./components/CivitaiSearchModal').then((m) => ({ default: m.CivitaiSearchModal }))
)

export default function App(): JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const modelSyncRef = useRef<{ revision: number; promise: Promise<void> } | null>(null)
  const civitaiSearch = useStore((s) => s.civitaiSearch)
  const openCivitaiSearch = useStore((s) => s.openCivitaiSearch)
  const closeCivitaiSearch = useStore((s) => s.closeCivitaiSearch)
  const currentTab = useStore((s) => s.currentTab)

  const status = useStore((s) => s.forgeStatus)
  const setForgeStatus = useStore((s) => s.setForgeStatus)
  const setModels = useStore((s) => s.setModels)
  const setSamplers = useStore((s) => s.setSamplers)
  const setSchedulers = useStore((s) => s.setSchedulers)
  const setSelectedModel = useStore((s) => s.setSelectedModel)
  const setRecommendation = useStore((s) => s.setRecommendation)
  const setRecLoading = useStore((s) => s.setRecommendationLoading)
  const setLibrary = useStore((s) => s.setLibrary)
  const setHistory = useStore((s) => s.setHistory)
  const setPresets = useStore((s) => s.setPresets)
  const setSettings = useStore((s) => s.setSettings)
  const setProgress = useStore((s) => s.setProgress)
  const setLastImage = useStore((s) => s.setLastImage)
  const setGenerating = useStore((s) => s.setGenerating)
  const setSidePanelTab = useStore((s) => s.setSidePanelTab)

  // Global `?` key toggles the shortcuts help. Skipped when typing into a
  // text field — `?` is a printable character there and shouldn't open a modal.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key !== '?') return
      const t = e.target as HTMLElement | null
      const tag = t?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || t?.isContentEditable) return
      e.preventDefault()
      setShortcutsOpen((o) => !o)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Window-level paste handler — anywhere in the app, Ctrl+V on a clipboard
  // image sets it as the img2img input. Skips when focus is in a text input
  // (the user pasting text in the prompt shouldn't also load an image).
  useEffect(() => {
    function isEditableTarget(t: EventTarget | null): boolean {
      const el = t as HTMLElement | null
      if (!el) return false
      const tag = el.tagName?.toLowerCase()
      return tag === 'input' || tag === 'textarea' || el.isContentEditable
    }
    async function onPaste(e: ClipboardEvent): Promise<void> {
      if (isEditableTarget(e.target)) {
        // Allow pasting an image into a text input only when the clipboard has
        // ONLY an image (no text). Otherwise let the textarea handle it.
        const items = Array.from(e.clipboardData?.items ?? [])
        const hasText = items.some((it) => it.kind === 'string' && it.type.startsWith('text/'))
        if (hasText) return
      }
      const items = Array.from(e.clipboardData?.items ?? [])
      const imageItem = items.find((it) => it.kind === 'file' && it.type.startsWith('image/'))
      if (!imageItem) return
      e.preventDefault()
      const file = imageItem.getAsFile()
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        useStore.getState().setInputImage(dataUrl, file.name || 'clipboard.png')
        // Auto-switch to img2img if the user is currently on a tab where the
        // image isn't shown — otherwise the image is silently stored and the
        // user wouldn't know where it went. Do NOT switch back if they're
        // already on img2img.
        const tab = useStore.getState().currentTab
        if (tab === 'video') {
          useStore.getState().patchVideo({ sourceMode: 'img2img' })
          toast.success(tStatic('toast.imageLoaded'))
        } else if (tab !== 'img2img') {
          useStore.getState().setCurrentTab('img2img')
          toast.success(tStatic('toast.imageLoadedTabSwitch'))
        } else {
          toast.success(tStatic('toast.imageLoaded'))
        }
      }
      reader.readAsDataURL(file)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])

  // Bootstrap on mount.
  useEffect(() => {
    let unsubStatus: (() => void) | null = null
    let unsubProgress: (() => void) | null = null
    let disposed = false
    const bgTimers: number[] = []

    ;(async () => {
      // Keep first paint light: core settings/library/presets load now; history
      // thumbnails are loaded only when the History side tab is opened.
      const [
        settings,
        lib,
        customLib,
        presets,
        favorites,
        quickPresets,
        promptComposerSlotTemplates,
        loraFavs,
        loraPromptOverrides,
        checkpointPromptProfiles,
        loraUsage,
        hiddenQuickPresets
      ] = await Promise.all([
        api.storage.getSettings(),
        api.library.load(),
        api.library.getCustom(),
        api.storage.listPresets(),
        api.storage.getFavorites(),
        api.storage.listQuickPresets(),
        api.storage.listPromptComposerSlotTemplates(),
        api.storage.getLoraFavorites(),
        api.storage.listLoraPromptOverrides(),
        api.storage.listCheckpointPromptProfiles(),
        api.storage.listLoraUsage(),
        api.storage.getHiddenQuickPresets()
      ])
      setSettings(settings)
      setLibrary(lib.categories, new Map(lib.autocomplete))
      // Load user-added categories AFTER built-in so the autocomplete index
      // already contains the curated translations. setCustomLibrary appends
      // any new keys without overwriting.
      useStore.getState().setCustomLibrary(customLib)
      setPresets(presets)
      useStore.getState().setFavorites(new Set(favorites))
      useStore.getState().setQuickPresets(quickPresets)
      useStore.getState().setPromptComposerSlotTemplates(promptComposerSlotTemplates)
      useStore.getState().setLoraFavorites(new Set(loraFavs))
      useStore.getState().setLoraPromptOverrides(loraPromptOverrides)
      useStore.getState().setCheckpointPromptProfiles(checkpointPromptProfiles)
      useStore.getState().setLoraUsage(loraUsage)
      useStore.getState().setHiddenQuickPresetIds(new Set(hiddenQuickPresets))

      // Subscribe to Forge status before reading current — avoids missing transitions.
      unsubStatus = api.forge.onStatusChanged((s) => setForgeStatus(s))
      const initial = await api.forge.status()
      setForgeStatus(initial)

      unsubProgress = api.forge.onProgress((p) => setProgress(p))

    })().catch((e) => toast.error(tStatic('toast.initFailed', { message: (e as Error).message })))

    return () => {
      disposed = true
      bgTimers.forEach((timer) => window.clearTimeout(timer))
      unsubStatus?.()
      unsubProgress?.()
    }
  }, [])

  // When Forge becomes ready, fetch only the catalogs required for first
  // generation. Optional catalogs load on idle timers or when their panel opens.
  useEffect(() => {
    if (status.kind !== 'ready') return
    const bgTimers: number[] = []
    ;(async () => {
      try {
        const [models, samplers, schedulers] = await Promise.all([
          api.forge.listModels(),
          api.forge.listSamplers(),
          api.forge.listSchedulers()
        ])
        setModels(models)
        setSamplers(samplers)
        setSchedulers(schedulers)
        // Pre-select first usable model, or recover when a removed/invalid
        // checkpoint is still stored from an earlier session.
        const current = useStore.getState().selectedModelTitle
        if (models.length > 0 && (!current || !models.some((model) => model.title === current))) {
          void handleModelChanged(models[0].title)
        }

        // LoRA/VAE catalogs are useful for suggestions and recommendation
        // actions, but they do not need to block first interaction.
        bgTimers.push(window.setTimeout(() => {
          const s = useStore.getState()
          if (s.forgeStatus.kind !== 'ready') return
          if (s.loras.length === 0) {
            void api.forge.listLoras().then((loras) => useStore.getState().setLoras(loras)).catch(() => undefined)
          }
          if (s.vaes.length === 0) {
            void api.forge.listVaes().then((vaes) => useStore.getState().setVaes(vaes)).catch(() => undefined)
          }
        }, 3500))

        // Defer remote/cache-heavy Civitai work until after first interaction.
        // Popular tags are loaded by CivitaiSearchModal only when opened.
        bgTimers.push(window.setTimeout(() => {
          void api.civitai.checkUpdates().then((r) => {
            useStore.getState().setModelUpdates(r.updates)
            if (r.updates.length > 0) {
              toast(tStatic('toast.modelUpdatesAvailable', { count: r.updates.length }), { icon: '🔄' })
            }
          }).catch((e) => console.warn('[civitai] update check failed:', e))
        }, 12000))
      } catch (e) {
        toast.error(tStatic('toast.apiFetchFailed', { message: (e as Error).message }))
      }
    })()
    return () => {
      bgTimers.forEach((timer) => window.clearTimeout(timer))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.kind])

  // Recompute LoRA suggestions on a 600ms debounce after the prompt or
  // checkpoint or active-LoRA set changes. Local-only computation, no IPC.
  const prompt = useStore((s) => s.prompt)
  const selectedModelTitle = useStore((s) => s.selectedModelTitle)
  const selectedModelRevision = useStore((s) => s.selectedModelRevision)
  const models = useStore((s) => s.models)
  const recommendation = useStore((s) => s.recommendation)
  const activeLoras = useStore((s) => s.activeLoras)
  const loras = useStore((s) => s.loras)
  const loraMeta = useStore((s) => s.loraMeta)
  const loraFavorites = useStore((s) => s.loraFavorites)
  const loraUsage = useStore((s) => s.loraUsage)
  const uiLanguage = useStore((s) => s.settings?.uiLanguage)
  useEffect(() => {
    const handle = setTimeout(() => {
      const scored = scoreLoras({
        loras,
        loraMeta,
        prompt,
        selectedCheckpointTitle: selectedModelTitle,
        selectedRecommendation: recommendation,
        favorites: loraFavorites,
        recentUsage: loraUsage,
        activeLoraNames: new Set(activeLoras.map((a) => a.name))
      })
      useStore.getState().setLoraSuggestions(scored)
    }, 600)
    return () => clearTimeout(handle)
  }, [prompt, selectedModelTitle, recommendation, activeLoras, loras, loraMeta, loraFavorites, loraUsage, uiLanguage])

  function syncSelectedModelContext(title: string, revision: number): Promise<void> {
    const existing = modelSyncRef.current
    if (existing?.revision === revision) return existing.promise
    const model = useStore.getState().models.find((item) => item.title === title)
    if (useStore.getState().forgeStatus.kind !== 'ready' || !model) return Promise.resolve()

    setRecommendation(null)
    useStore.getState().setCommunityStats(null)
    useStore.getState().setCommunityStatsLoading(false)
    setRecLoading(true)

    const promise = (async () => {
      try {
        // Keep Forge, the title bar, and the Civitai recommendation card in
        // sync no matter whether the model changed from the title bar,
        // history restore, workspace restore, or next-image actions.
        const [, rec] = await Promise.all([
          api.forge.setCurrentModel(title),
          api.civitai.lookup(model).catch(() => null)
        ])
        const latest = useStore.getState()
        if (latest.selectedModelRevision !== revision || latest.selectedModelTitle !== title) return
        setRecommendation(rec)
        if (!rec) {
          toast(tStatic('toast.civitaiNoMatch'), { icon: 'ℹ' })
        } else {
          // Kick off the slow community-mining in the background —
          // RecommendationCard shows a loading badge and updates when results
          // arrive. Cached responses come back almost instantly (14-day TTL);
          // fresh mining takes 3-10s.
          useStore.getState().setCommunityStatsLoading(true)
          void api.civitai
            .mineCommunity(rec.modelVersionId)
            .then((stats) => {
              // Only apply if user hasn't switched models since we started.
              if (useStore.getState().recommendation?.modelVersionId === rec.modelVersionId) {
                useStore.getState().setCommunityStats(stats)
              }
            })
            .catch((e) => console.warn('[civitai] community mining failed:', e))
            .finally(() => {
              if (useStore.getState().recommendation?.modelVersionId === rec.modelVersionId) {
                useStore.getState().setCommunityStatsLoading(false)
              }
            })
        }
      } catch (e) {
        if (useStore.getState().selectedModelRevision === revision) {
          toast.error(tStatic('toast.modelInfoFailed', { message: (e as Error).message }))
        }
      } finally {
        const latest = useStore.getState()
        if (latest.selectedModelRevision === revision && latest.selectedModelTitle === title) {
          setRecLoading(false)
        }
        if (modelSyncRef.current?.revision === revision) {
          modelSyncRef.current = null
        }
      }
    })()

    modelSyncRef.current = { revision, promise }
    return promise
  }

  useEffect(() => {
    if (status.kind !== 'ready' || !selectedModelTitle) return
    void syncSelectedModelContext(selectedModelTitle, selectedModelRevision)
  }, [status.kind, selectedModelTitle, selectedModelRevision, models, setRecommendation, setRecLoading])

  async function handleModelChanged(title: string): Promise<void> {
    setSelectedModel(title)
    const revision = useStore.getState().selectedModelRevision
    await syncSelectedModelContext(title, revision)
  }

  function applyAutoCheckpointPromptFormatting(state: AppState): AppState {
    const selectedModel = state.models.find((model) => model.title === state.selectedModelTitle) ?? null
    const context = checkpointPromptContextFromModel(selectedModel, state.recommendation)
    const profile = findCheckpointPromptProfile(state.checkpointPromptProfiles, context)
    if (profile?.mode !== 'auto') return state
    const promptResult = formatPromptForCheckpoint(state.prompt, 'positive', context, profile)
    const negativeResult = formatPromptForCheckpoint(state.negativePrompt, 'negative', context, profile)
    const paramsChanged = checkpointPromptProfileParamsChanged(state.params, profile)
    if (!promptResult.changed && !negativeResult.changed && !paramsChanged) return state
    if (promptResult.changed) state.setPrompt(promptResult.prompt)
    if (negativeResult.changed) state.setNegativePrompt(negativeResult.prompt)
    if (paramsChanged) state.patchParams(checkpointPromptProfileParamsPatch(profile))
    toast.success(tStatic(paramsChanged ? 'prompt.modelProfileApplied' : 'prompt.modelFormatted'))
    return useStore.getState()
  }

  async function handleGenerate(): Promise<void> {
    let s = useStore.getState()
    s = applyAutoCheckpointPromptFormatting(s)
    const guardIssue = getExtensionGuardIssues(s)[0]
    if (guardIssue) {
      toast.error(tStatic(guardIssue.messageKey, guardIssue.params))
      return
    }
    const plan = buildGenerationPlan(s)
    if (!plan) return
    const dynamicBlocker = plan.dynamicPromptIssues.find((issue) => issue.severity === 'error')
    if (dynamicBlocker) {
      toast.error(tStatic('dynamicPrompt.blocked', { message: dynamicBlocker.message }))
      return
    }

    setGenerating(true)
    setProgress(null)
    try {
      // Endpoint selection is now driven by the active workspace tab rather
      // than the implicit "is an input image set?" check. This makes the
      // user's intent explicit: clicking Generate on the txt2img tab always
      // runs txt2img, even if an inputImage is still in store from earlier.
      const generationResults: Array<{
        res: Txt2ImgResponse
        iterationIndex: number
        iterationCount: number
      }> = []
      if (plan.endpoint === 'img2img') {
        if (!s.inputImage) {
          toast.error(tStatic('toast.img2imgNeedsImage'))
          return
        }
        generationResults.push({
          res: await api.forge.img2img(buildImg2ImgRequest(plan, s.inputImage, plan.params.denoisingStrength, s.inpaintMaskImage)),
          iterationIndex: 0,
          iterationCount: Math.max(1, Math.round(plan.params.iterations))
        })
      } else if (plan.endpoint === 'txt2img') {
        generationResults.push({
          res: await api.forge.txt2img(plan.baseReq),
          iterationIndex: 0,
          iterationCount: Math.max(1, Math.round(plan.params.iterations))
        })
      } else {
        // upscale/tools tabs have their own workflows; the main Generate
        // button is hidden there, but if it ever fires from those tabs
        // we treat it as a no-op rather than running an unintended pipeline.
        toast.error(tStatic('toast.cantGenerateInTab'))
        return
      }
      const generatedImages = generationResults.flatMap((result) =>
        result.res.images.filter(Boolean).map((image, responseImageIndex) => ({
          image,
          responseImageIndex,
          res: result.res,
          iterationIndex: result.iterationIndex,
          iterationCount: result.iterationCount
        }))
      )
      if (generatedImages.length > 0) {
        const preparedHistory = await Promise.all(generatedImages.map(async (entry, imageIndex) => {
          const image = entry.image
          const dataUrl = imageDataUrlFromPngBase64(image)
          const actualSeed = generatedSeedFromInfo(entry.res.info, entry.responseImageIndex, plan.params.seed)
          return {
            pngBase64: image,
            dataUrl,
            thumbDataUrl: await makeThumbnail(dataUrl, 320),
            seed: actualSeed,
            imageIndex,
            iterationIndex: entry.iterationIndex,
            iterationCount: entry.iterationCount,
            res: entry.res
          }
        }))
        let firstItemId: string | null = null
        // addHistory prepends each item. Save from last to first so the visible
        // History order matches the image order returned by the backend.
        for (let i = preparedHistory.length - 1; i >= 0; i -= 1) {
          const prepared = preparedHistory[i]
          const item = await api.storage.addHistory({
            pngBase64: prepared.pngBase64,
            thumbDataUrl: prepared.thumbDataUrl,
            prompt: plan.finalPrompt,
            negativePrompt: plan.baseReq.negative_prompt,
            dynamicPrompt: plan.dynamicPrompt,
            params: {
              steps: plan.params.steps,
              cfgScale: plan.params.cfgScale,
              width: plan.params.width,
              height: plan.params.height,
              sampler: plan.params.sampler,
              scheduler: plan.params.scheduler,
              seed: prepared.seed,
              batchSize: plan.params.batchSize,
              imageIndex: prepared.imageIndex,
              imageCount: preparedHistory.length,
              iterationIndex: prepared.iterationCount > 1 ? prepared.iterationIndex : undefined,
              iterationCount: prepared.iterationCount > 1 ? prepared.iterationCount : undefined,
              model: plan.model,
              vae: s.selectedVae,
              clipSkip: plan.params.clipSkip,
              denoisingStrength: plan.params.denoisingStrength,
              activeLoras: s.activeLoras,
              controlNet: null
            }
          })
          if (prepared.imageIndex === 0) firstItemId = item.id
        }
        setLastImage(preparedHistory[0].dataUrl, firstItemId ?? undefined)
        setHistory((await api.storage.listHistory()).slice(0, 500))
        if (preparedHistory.length >= 2) {
          setSidePanelTab('board')
        }

        // Record LoRA usage for the suggestion engine. One row per active
        // LoRA, indexed by checkpoint + prompt digest so future scoring can
        // boost LoRAs the user has paired with similar prompts.
        if (s.activeLoras.length > 0) {
          const digest = promptDigestOf(plan.strippedPrompt)
          const ts = Date.now()
          await Promise.all(
            s.activeLoras.map((al) =>
              api.storage.recordLoraUsage({
                loraName: al.name,
                checkpointTitle: plan.model,
                promptDigest: digest,
                weight: al.weight,
                timestamp: ts
              })
            )
          )
          const usage = await api.storage.listLoraUsage()
          useStore.getState().setLoraUsage(usage)
        }
      }
    } catch (e) {
      toast.error(tStatic('toast.generateFailed', { message: (e as Error).message }))
    } finally {
      setGenerating(false)
      setProgress(null)
    }
  }

  return (
    <div className="h-full flex flex-col">
      <TitleBar
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onOpenCivitaiSearch={(type) => openCivitaiSearch(type ?? null)}
        onModelChanged={handleModelChanged}
      />
      <MainTabs />
      <div className="flex-1 flex min-h-0 relative">
        {(currentTab === 'txt2img' || currentTab === 'img2img') && (
          <>
            <PromptPanel onGenerate={handleGenerate} />
            <PreviewPanel />
            <SidePanel />
          </>
        )}
        {currentTab === 'upscale' && (
          <Suspense fallback={<WorkspaceLoading />}>
            <UpscaleWorkspace />
          </Suspense>
        )}
        {currentTab === 'video' && (
          <Suspense fallback={<WorkspaceLoading />}>
            <VideoWorkspace onModelChanged={handleModelChanged} />
          </Suspense>
        )}
        {currentTab === 'tags' && (
          <Suspense fallback={<WorkspaceLoading />}>
            <PromptTagsWorkspace />
          </Suspense>
        )}
        {currentTab === 'dictionary' && (
          <Suspense fallback={<WorkspaceLoading />}>
            <PromptDictionaryWorkspace />
          </Suspense>
        )}
        {currentTab === 'models' && (
          <Suspense fallback={<WorkspaceLoading />}>
            <ModelLibraryWorkspace />
          </Suspense>
        )}
        {currentTab === 'tools' && (
          <Suspense fallback={<WorkspaceLoading />}>
            <ToolsWorkspace />
          </Suspense>
        )}
        <StartupOverlay />
      </div>
      <PromptDictionaryAutocompleteLayer />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      {civitaiSearch.open && (
        <Suspense fallback={null}>
          <CivitaiSearchModal
            open={civitaiSearch.open}
            onClose={closeCivitaiSearch}
            initialType={civitaiSearch.initialType}
            onDownloaded={async (asset) => {
              // Refresh the relevant local list so the freshly-downloaded file
              // appears in the corresponding picker right away.
              if (asset === 'Checkpoint') {
                try {
                  const updated = await api.forge.listModels()
                  useStore.getState().setModels(updated)
                } catch { /* ignore */ }
              } else if (asset === 'LORA' || asset === 'LoCon') {
                try {
                  const updated = await api.forge.listLoras()
                  useStore.getState().setLoras(updated)
                } catch { /* ignore */ }
              } else if (asset === 'VAE') {
                try {
                  const updated = await api.forge.listVaes()
                  useStore.getState().setVaes(updated)
                } catch { /* ignore */ }
              }
            }}
          />
        </Suspense>
      )}
    </div>
  )
}

function WorkspaceLoading(): JSX.Element {
  return (
    <main className="flex-1 overflow-auto p-6">
      <div className="max-w-3xl mx-auto text-sm text-ink-3">{tStatic('common.loading')}</div>
    </main>
  )
}
