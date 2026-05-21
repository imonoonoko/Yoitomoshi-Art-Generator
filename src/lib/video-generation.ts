import type {
  Img2ImgRequest,
  Txt2ImgRequest,
  VideoOutputFormat
} from '@shared/types'
import type { VideoGenerationState } from './store'

const VIDEO_MIME: Record<VideoOutputFormat, string> = {
  GIF: 'image/gif',
  MP4: 'video/mp4',
  WEBP: 'image/webp',
  WEBM: 'video/webm'
}

export function buildAnimateDiffRequest<T extends Txt2ImgRequest | Img2ImgRequest>(
  req: T,
  video: VideoGenerationState
): T {
  const requestId = `yoitomoshi-${Date.now().toString(36)}`
  const args = {
    model: video.motionModule,
    format: [video.format],
    enable: true,
    video_length: clampInt(video.frames, 1, 96),
    fps: clampInt(video.fps, 1, 60),
    loop_number: clampInt(video.loopNumber, 0, 20),
    closed_loop: video.closedLoop,
    batch_size: clampInt(video.contextBatchSize, 1, 32),
    stride: clampInt(video.stride, 1, 32),
    overlap: clampInt(video.overlap, -1, 32),
    interp: 'Off',
    interp_x: 10,
    video_source: '',
    video_path: '',
    mask_path: '',
    latent_power: 1,
    latent_scale: 32,
    last_frame: null,
    latent_power_last: 1,
    latent_scale_last: 32,
    request_id: requestId
  }

  return {
    ...req,
    batch_size: 1,
    n_iter: 1,
    alwayson_scripts: {
      ...(req.alwayson_scripts ?? {}),
      AnimateDiff: { args: [args] }
    }
  }
}

export function videoDataUrlFromBase64(raw: string, format: VideoOutputFormat): string {
  if (raw.startsWith('data:')) return raw
  return `data:${VIDEO_MIME[format]};base64,${raw.replace(/\s/g, '')}`
}

export function videoBase64FromDataUrl(dataUrlOrBase64: string): string {
  return dataUrlOrBase64.replace(/^data:[^;]+;base64,/i, '').replace(/\s/g, '')
}

export function videoMime(format: VideoOutputFormat): string {
  return VIDEO_MIME[format]
}

export function isExpectedVideoPayload(raw: string, format: VideoOutputFormat): boolean {
  const binary = decodeBase64Prefix(videoBase64FromDataUrl(raw), 16)
  if (binary.length === 0) return false
  if (format === 'GIF') return binary.startsWith('GIF87a') || binary.startsWith('GIF89a')
  if (format === 'MP4') return binary.slice(4, 8) === 'ftyp'
  if (format === 'WEBP') return binary.startsWith('RIFF') && binary.slice(8, 12) === 'WEBP'
  if (format === 'WEBM') {
    return binary.charCodeAt(0) === 0x1a &&
      binary.charCodeAt(1) === 0x45 &&
      binary.charCodeAt(2) === 0xdf &&
      binary.charCodeAt(3) === 0xa3
  }
  return false
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.round(value)))
}

function decodeBase64Prefix(base64: string, bytes: number): string {
  try {
    const normalized = base64.replace(/\s/g, '')
    const chars = Math.ceil(bytes / 3) * 4
    return atob(normalized.slice(0, chars))
  } catch {
    return ''
  }
}
