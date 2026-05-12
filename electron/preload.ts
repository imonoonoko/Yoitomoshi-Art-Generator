import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../src/shared/ipc-channels.js'
import type {
  AppSettings,
  CivitaiCommunityStats,
  CivitaiDownloadProgress,
  CivitaiDownloadRequest,
  CivitaiRecommended,
  CivitaiSearchOptions,
  CivitaiSearchResult,
  CivitaiTag,
  ControlNetDetectRequest,
  ControlNetDetectResult,
  DownloadJob,
  DroppedImageInsight,
  ModelUpdateInfo,
  ForgeStatus,
  GenerationProgress,
  HistoryItem,
  HuggingFaceSearchOptions,
  HuggingFaceSearchResult,
  Img2ImgRequest,
  Img2ImgResponse,
  InterrogateResult,
  LibraryIntegrityReport,
  LoraCivitaiMetadata,
  LoraUsageRecord,
  ModelFormatConversionResult,
  ModelHashResult,
  ModelImportResult,
  ModelLibrarySummary,
  ModelLibraryRecoveryResult,
  ModelMergerEstimate,
  ModelMergerProgress,
  ModelMergerRequest,
  ModelMergerResult,
  ModelMergerSupportReport,
  PromptCategory,
  PromptPreset,
  QuickPreset,
  SdLora,
  SdModel,
  SdSampler,
  SdVae,
  StartupMetrics,
  StartupMetricsSample,
  Txt2ImgRequest,
  Txt2ImgResponse,
  WorkspaceFile,
  WorkspaceImageReference,
  WorkspaceSnapshot,
  WorkspaceSummary,
  CharacterCompositeSaveRequest,
  CharacterCompositeSaveResult,
  FabricFeedbackImageSaveResult,
  UpscaleComparisonSaveRequest,
  UpscaleComparisonSaveResult
} from '../src/shared/types.js'

/**
 * IPC bridge between main and renderer. Renderer accesses everything through
 * window.api.* — no nodeIntegration, contextIsolation enabled.
 */
const api = {
  // Forge lifecycle
  forge: {
    start: (): Promise<void> => ipcRenderer.invoke(IPC.forgeStart),
    stop: (): Promise<void> => ipcRenderer.invoke(IPC.forgeStop),
    status: (): Promise<ForgeStatus> => ipcRenderer.invoke(IPC.forgeStatus),
    onStatusChanged: (cb: (s: ForgeStatus) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, s: ForgeStatus): void => cb(s)
      ipcRenderer.on(IPC.forgeStatusChanged, handler)
      return () => ipcRenderer.removeListener(IPC.forgeStatusChanged, handler)
    },
    listModels: (): Promise<SdModel[]> => ipcRenderer.invoke(IPC.forgeListModels),
    refreshModels: (): Promise<void> => ipcRenderer.invoke(IPC.forgeRefreshModels),
    listSamplers: (): Promise<SdSampler[]> => ipcRenderer.invoke(IPC.forgeListSamplers),
    listSchedulers: (): Promise<string[]> => ipcRenderer.invoke(IPC.forgeListSchedulers),
    txt2img: (req: Txt2ImgRequest): Promise<Txt2ImgResponse> =>
      ipcRenderer.invoke(IPC.forgeTxt2Img, req),
    img2img: (req: Img2ImgRequest): Promise<Img2ImgResponse> =>
      ipcRenderer.invoke(IPC.forgeImg2Img, req),
    interrogate: (image: string, model?: 'clip' | 'deepdanbooru'): Promise<InterrogateResult> =>
      ipcRenderer.invoke(IPC.forgeInterrogate, { image, model }),
    interrupt: (): Promise<void> => ipcRenderer.invoke(IPC.forgeInterrupt),
    importModels: (opts: { mode: 'copy' | 'move' }): Promise<ModelImportResult | null> =>
      ipcRenderer.invoke(IPC.forgeImportModels, opts),
    openModelsFolder: (): Promise<void> => ipcRenderer.invoke(IPC.forgeOpenModelsFolder),
    disableExtension: (name: string): Promise<{ renamedFrom: string; renamedTo: string }> =>
      ipcRenderer.invoke(IPC.forgeDisableExtension, name),
    listLoras: (): Promise<SdLora[]> => ipcRenderer.invoke(IPC.forgeListLoras),
    refreshLoras: (): Promise<void> => ipcRenderer.invoke(IPC.forgeRefreshLoras),
    importLoras: (opts: { mode: 'copy' | 'move' }): Promise<ModelImportResult | null> =>
      ipcRenderer.invoke(IPC.forgeImportLoras, opts),
    openLorasFolder: (): Promise<void> => ipcRenderer.invoke(IPC.forgeOpenLorasFolder),
    listVaes: (): Promise<SdVae[]> => ipcRenderer.invoke(IPC.forgeListVaes),
    refreshVaes: (): Promise<void> => ipcRenderer.invoke(IPC.forgeRefreshVaes),
    importVaes: (opts: { mode: 'copy' | 'move' }): Promise<ModelImportResult | null> =>
      ipcRenderer.invoke(IPC.forgeImportVaes, opts),
    openVaesFolder: (): Promise<void> => ipcRenderer.invoke(IPC.forgeOpenVaesFolder),
    listControlnetModels: (): Promise<string[]> => ipcRenderer.invoke(IPC.forgeListControlnetModels),
    listControlnetModules: (): Promise<string[]> => ipcRenderer.invoke(IPC.forgeListControlnetModules),
    controlnetDetect: (req: ControlNetDetectRequest): Promise<ControlNetDetectResult> =>
      ipcRenderer.invoke(IPC.forgeControlnetDetect, req),
    listUpscalers: (): Promise<string[]> => ipcRenderer.invoke(IPC.forgeListUpscalers),
    extraSingleImage: (opts: {
      image: string
      upscaler: string
      resize: number
      upscaler2?: string
      upscaler2Visibility?: number
    }): Promise<{ image: string }> =>
      ipcRenderer.invoke(IPC.forgeExtraSingleImage, opts),
    onProgress: (cb: (p: GenerationProgress) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, p: GenerationProgress): void => cb(p)
      ipcRenderer.on(IPC.forgeProgressUpdate, handler)
      return () => ipcRenderer.removeListener(IPC.forgeProgressUpdate, handler)
    }
  },

  tools: {
    pickModelFile: (): Promise<string | null> => ipcRenderer.invoke(IPC.toolsPickModelFile),
    inspectModel: (filepath: string): Promise<{
      filepath: string
      sizeBytes: number
      kind: string
      sampleKeys: string[]
      keyCount: number
      metadata: Record<string, string> | null
    }> => ipcRenderer.invoke(IPC.toolsInspectModel, filepath),
    scanModelHealth: (): Promise<{
      root: string
      scannedAt: number
      totals: { files: number; totalBytes: number; issues: number }
      folders: Array<{
        id: string
        label: string
        path: string
        exists: boolean
        files: number
        totalBytes: number
      }>
      issues: Array<{
        severity: 'warn' | 'error'
        folder: string
        file: string | null
        message: string
      }>
    }> => ipcRenderer.invoke(IPC.toolsScanModelHealth),
    listModelLibrary: (): Promise<ModelLibrarySummary> =>
      ipcRenderer.invoke(IPC.toolsListModelLibrary),
    rescanModelLibrary: (): Promise<ModelLibrarySummary> =>
      ipcRenderer.invoke(IPC.toolsRescanModelLibrary),
    listDownloadJobs: (): Promise<DownloadJob[]> =>
      ipcRenderer.invoke(IPC.toolsListDownloadJobs),
    resumeDownloadJob: (id: string): Promise<{ destPath: string; sha256: string | null }> =>
      ipcRenderer.invoke(IPC.toolsResumeDownloadJob, id),
    discardDownloadJob: (id: string): Promise<DownloadJob | null> =>
      ipcRenderer.invoke(IPC.toolsDiscardDownloadJob, id),
    openDownloadJobFolder: (id: string): Promise<void> =>
      ipcRenderer.invoke(IPC.toolsOpenDownloadJobFolder, id),
    checkLibraryIntegrity: (): Promise<LibraryIntegrityReport> =>
      ipcRenderer.invoke(IPC.toolsCheckLibraryIntegrity),
    hashModelLibraryEntry: (id: string): Promise<ModelHashResult> =>
      ipcRenderer.invoke(IPC.toolsHashModelLibraryEntry, id),
    recoverModelLibrary: (): Promise<ModelLibraryRecoveryResult> =>
      ipcRenderer.invoke(IPC.toolsRecoverModelLibrary),
    convertModelFormat: (): Promise<ModelFormatConversionResult | null> =>
      ipcRenderer.invoke(IPC.toolsConvertModelFormat),
    inspectMergerSupport: (): Promise<ModelMergerSupportReport> =>
      ipcRenderer.invoke(IPC.toolsInspectMergerSupport),
    estimateModelMerger: (req: ModelMergerRequest): Promise<ModelMergerEstimate> =>
      ipcRenderer.invoke(IPC.toolsEstimateModelMerger, req),
    runModelMerger: (req: ModelMergerRequest): Promise<ModelMergerResult> =>
      ipcRenderer.invoke(IPC.toolsRunModelMerger, req),
    cancelModelMerger: (): Promise<void> =>
      ipcRenderer.invoke(IPC.toolsCancelModelMerger),
    onModelMergerProgress: (cb: (p: ModelMergerProgress) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, p: ModelMergerProgress): void => cb(p)
      ipcRenderer.on(IPC.toolsModelMergerProgress, handler)
      return () => ipcRenderer.removeListener(IPC.toolsModelMergerProgress, handler)
    },
  },

  // Civitai
  civitai: {
    lookup: (model: SdModel): Promise<CivitaiRecommended | null> =>
      ipcRenderer.invoke(IPC.civitaiLookupByModel, model),
    lookupLora: (lora: SdLora): Promise<LoraCivitaiMetadata | null> =>
      ipcRenderer.invoke(IPC.civitaiLookupLora, lora),
    search: (opts: CivitaiSearchOptions): Promise<CivitaiSearchResult> =>
      ipcRenderer.invoke(IPC.civitaiSearch, opts),
    download: (req: CivitaiDownloadRequest): Promise<{ destPath: string; sha256: string | null }> =>
      ipcRenderer.invoke(IPC.civitaiDownload, req),
    cancelDownload: (url: string): Promise<void> =>
      ipcRenderer.invoke(IPC.civitaiCancelDownload, url),
    onDownloadProgress: (cb: (p: CivitaiDownloadProgress) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, p: CivitaiDownloadProgress): void => cb(p)
      ipcRenderer.on(IPC.civitaiDownloadProgress, handler)
      return () => ipcRenderer.removeListener(IPC.civitaiDownloadProgress, handler)
    },
    mineCommunity: (modelVersionId: number): Promise<CivitaiCommunityStats | null> =>
      ipcRenderer.invoke(IPC.civitaiMineCommunity, modelVersionId),
    identifyFromPng: (meta: {
      modelName: string | null
      modelHash: string | null
      loras: { name: string; weight: number }[]
      vae: string | null
    }): Promise<DroppedImageInsight> =>
      ipcRenderer.invoke(IPC.civitaiIdentifyFromPng, meta),
    listTags: (opts?: { force?: boolean }): Promise<CivitaiTag[]> =>
      ipcRenderer.invoke(IPC.civitaiListTags, opts ?? {}),
    checkUpdates: (opts?: { force?: boolean }): Promise<{
      checkedAt: number
      updates: ModelUpdateInfo[]
    }> => ipcRenderer.invoke(IPC.civitaiCheckUpdates, opts ?? {})
  },

  huggingface: {
    search: (opts: HuggingFaceSearchOptions): Promise<HuggingFaceSearchResult> =>
      ipcRenderer.invoke(IPC.huggingFaceSearch, opts),
    download: (req: CivitaiDownloadRequest): Promise<{ destPath: string; sha256: string | null }> =>
      ipcRenderer.invoke(IPC.huggingFaceDownload, req)
  },

  // Storage
  storage: {
    getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.storageGetSettings),
    setSettings: (s: AppSettings): Promise<void> =>
      ipcRenderer.invoke(IPC.storageSetSettings, s),
    listHistory: (): Promise<HistoryItem[]> => ipcRenderer.invoke(IPC.storageListHistory),
    addHistory: (args: {
      pngBase64: string
      thumbDataUrl: string
      prompt: string
      negativePrompt: string
      params: HistoryItem['params']
    }): Promise<HistoryItem> => ipcRenderer.invoke(IPC.storageAddHistory, args),
    readHistoryImage: (id: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.storageReadHistoryImage, id),
    deleteHistory: (id: string): Promise<void> =>
      ipcRenderer.invoke(IPC.storageDeleteHistory, id),
    setHistoryLabel: (id: string, label: HistoryItem['label']): Promise<HistoryItem | null> =>
      ipcRenderer.invoke(IPC.storageSetHistoryLabel, id, label ?? null),
    listPresets: (): Promise<PromptPreset[]> => ipcRenderer.invoke(IPC.storageListPresets),
    savePreset: (input: {
      id?: string
      name: string
      prompt: string
      negativePrompt: string
    }): Promise<PromptPreset> => ipcRenderer.invoke(IPC.storageSavePreset, input),
    deletePreset: (id: string): Promise<void> =>
      ipcRenderer.invoke(IPC.storageDeletePreset, id),
    getFavorites: (): Promise<string[]> => ipcRenderer.invoke(IPC.storageGetFavorites),
    setFavorites: (tags: string[]): Promise<void> =>
      ipcRenderer.invoke(IPC.storageSetFavorites, tags),
    listQuickPresets: (): Promise<QuickPreset[]> =>
      ipcRenderer.invoke(IPC.storageListQuickPresets),
    saveQuickPreset: (input: {
      id?: string
      name: string
      text: string
      target: 'positive' | 'negative'
      order?: number
    }): Promise<QuickPreset> => ipcRenderer.invoke(IPC.storageSaveQuickPreset, input),
    deleteQuickPreset: (id: string): Promise<void> =>
      ipcRenderer.invoke(IPC.storageDeleteQuickPreset, id),
    getLoraFavorites: (): Promise<string[]> =>
      ipcRenderer.invoke(IPC.storageGetLoraFavorites),
    setLoraFavorites: (names: string[]): Promise<void> =>
      ipcRenderer.invoke(IPC.storageSetLoraFavorites, names),
    recordLoraUsage: (rec: LoraUsageRecord): Promise<void> =>
      ipcRenderer.invoke(IPC.storageRecordLoraUsage, rec),
    listLoraUsage: (): Promise<LoraUsageRecord[]> =>
      ipcRenderer.invoke(IPC.storageListLoraUsage),
    getHiddenQuickPresets: (): Promise<string[]> =>
      ipcRenderer.invoke(IPC.storageGetHiddenQuickPresets),
    setHiddenQuickPresets: (ids: string[]): Promise<void> =>
      ipcRenderer.invoke(IPC.storageSetHiddenQuickPresets, ids),
    listWorkspaces: (): Promise<WorkspaceSummary[]> =>
      ipcRenderer.invoke(IPC.storageListWorkspaces),
    saveWorkspace: (input: { id?: string; name: string; snapshot: WorkspaceSnapshot }): Promise<WorkspaceFile> =>
      ipcRenderer.invoke(IPC.storageSaveWorkspace, input),
    loadWorkspace: (id: string): Promise<WorkspaceFile | null> =>
      ipcRenderer.invoke(IPC.storageLoadWorkspace, id),
    deleteWorkspace: (id: string): Promise<void> =>
      ipcRenderer.invoke(IPC.storageDeleteWorkspace, id),
    resolveImageReference: (ref: WorkspaceImageReference): Promise<string | null> =>
      ipcRenderer.invoke(IPC.storageResolveImageReference, ref),
    saveUpscaleComparison: (input: UpscaleComparisonSaveRequest): Promise<UpscaleComparisonSaveResult> =>
      ipcRenderer.invoke(IPC.storageSaveUpscaleComparison, input),
    saveCharacterComposite: (input: CharacterCompositeSaveRequest): Promise<CharacterCompositeSaveResult> =>
      ipcRenderer.invoke(IPC.storageSaveCharacterComposite, input),
    saveFabricFeedbackImage: (imageDataUrl: string): Promise<FabricFeedbackImageSaveResult> =>
      ipcRenderer.invoke(IPC.storageSaveFabricFeedbackImage, imageDataUrl)
  },

  // Library
  library: {
    load: (): Promise<{ categories: PromptCategory[]; autocomplete: [string, string][] }> =>
      ipcRenderer.invoke(IPC.libraryLoad),
    getCustom: (): Promise<PromptCategory[]> => ipcRenderer.invoke(IPC.libraryGetCustom),
    saveCustom: (cats: PromptCategory[]): Promise<void> =>
      ipcRenderer.invoke(IPC.librarySaveCustom, cats)
  },

  // Misc
  app: {
    getStartupMetrics: (): Promise<StartupMetrics> =>
      ipcRenderer.invoke(IPC.appStartupMetrics),
    listStartupMetricSamples: (): Promise<StartupMetricsSample[]> =>
      ipcRenderer.invoke(IPC.appStartupMetricSamples),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.openExternal, url),
    showItemInFolder: (path: string): Promise<void> =>
      ipcRenderer.invoke(IPC.showItemInFolder, path),
    selectDirectory: (): Promise<string | null> => ipcRenderer.invoke(IPC.selectDirectory)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type AppApi = typeof api
