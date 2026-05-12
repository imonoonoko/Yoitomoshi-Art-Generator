import type {
  WorkspaceImageReference,
  WorkspaceImageSaveMode,
  WorkspaceSnapshot
} from '@shared/types'
import type { AppState } from './store'

type StoreSnapshot = AppState

export function buildWorkspaceSnapshot(
  s: StoreSnapshot,
  imageSaveMode: WorkspaceImageSaveMode
): WorkspaceSnapshot {
  const { inputImage: _upscaleInputImage, outputImage: _upscaleOutputImage, isRunning: _isRunning, ...upscale } = s.upscale
  const includeImages = imageSaveMode === 'embed'
  const includeRefs = imageSaveMode === 'references'
  const controlnet = includeImages
    ? { ...s.controlnet }
    : {
        ...s.controlnet,
        units: s.controlnet.units.map((unit) => ({ ...unit, image: null }))
      }
  const fabric = includeImages
    ? { ...s.fabric }
    : {
        ...s.fabric,
        positive: s.fabric.positive.map((item) => ({ ...item, image: '' })),
        negative: s.fabric.negative.map((item) => ({ ...item, image: '' }))
      }

  return {
    imageSaveMode,
    imageReferences: includeRefs ? buildWorkspaceImageReferences(s) : undefined,
    currentTab: s.currentTab,
    prompt: s.prompt,
    negativePrompt: s.negativePrompt,
    params: s.params,
    selectedModelTitle: s.selectedModelTitle,
    selectedVae: s.selectedVae,
    activeLoras: s.activeLoras,
    inputImageDataUrl: includeImages ? s.inputImage : null,
    inputImageFilename: s.inputImageFilename,
    inpaintMaskImage: includeImages ? s.inpaintMaskImage : null,
    lastImageDataUrl: includeImages ? s.lastImage : null,
    upscaleInputImageDataUrl: includeImages ? s.upscale.inputImage : null,
    upscaleOutputImageDataUrl: includeImages ? s.upscale.outputImage : null,
    upscale: {
      ...upscale,
      inputImage: null,
      inputFilename: includeImages ? upscale.inputFilename : null,
      inputImagePath: includeImages ? upscale.inputImagePath : null,
      inputHistoryId: includeImages ? upscale.inputHistoryId : null,
      outputImage: null,
      outputImagePath: includeImages ? upscale.outputImagePath : null,
      outputHistoryId: includeImages ? upscale.outputHistoryId : null,
      isRunning: false
    },
    controlnet,
    regionalPrompter: { ...s.regionalPrompter },
    fabric,
    adetailer: { ...s.adetailer },
    dynThres: { ...s.dynThres },
    freeu: { ...s.freeu }
  }
}

export function buildWorkspaceImageReferences(s: StoreSnapshot): WorkspaceSnapshot['imageReferences'] {
  const inputImage = s.inputImageHistoryId
    ? historyRef(s.inputImageHistoryId, s.inputImageFilename)
    : fileRef(s.inputImagePath, s.inputImageFilename)
  const lastImage = s.lastImageHistoryId
    ? historyRef(s.lastImageHistoryId, 'last-generation.png')
    : null
  const upscaleInputImage = s.upscale.inputHistoryId
    ? historyRef(s.upscale.inputHistoryId, s.upscale.inputFilename)
    : s.upscale.inputImage && s.lastImage && s.upscale.inputImage === s.lastImage && s.lastImageHistoryId
      ? historyRef(s.lastImageHistoryId, s.upscale.inputFilename)
      : fileRef(s.upscale.inputImagePath, s.upscale.inputFilename)
  const controlnetUnits = s.controlnet.units.map((unit, index) =>
    unit.image ? fileRef(unit.imagePath, `controlnet-unit-${index + 1}.png`) : null
  )
  const fabricPositive = s.fabric.positive.map((item) =>
    item.path ? fileRef(item.path, item.filename) : null
  )
  const fabricNegative = s.fabric.negative.map((item) =>
    item.path ? fileRef(item.path, item.filename) : null
  )

  return {
    inputImage,
    inpaintMask: null,
    lastImage,
    upscaleInputImage,
    upscaleOutputImage: s.upscale.outputHistoryId ? historyRef(s.upscale.outputHistoryId, 'upscale-output.png') : null,
    controlnetUnits,
    fabricPositive,
    fabricNegative
  }
}

function historyRef(historyId: string | null, filename?: string | null): WorkspaceImageReference | null {
  return historyId ? { kind: 'history', historyId, filename } : null
}

function fileRef(path: string | null | undefined, filename?: string | null): WorkspaceImageReference | null {
  return path ? { kind: 'file', path, filename } : null
}
