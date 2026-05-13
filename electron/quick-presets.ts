import type { QuickPreset } from '../src/shared/types.js'

/**
 * Built-in quick presets — short reusable prompt fragments that the user toggles
 * on/off with a single click. Sources / common practice references:
 *  - A1111 wiki on negative prompts (the "EasyNegative"-style standard list)
 *  - Civitai community guides recommending masterpiece/best quality boosters
 *  - r/StableDiffusion threads on hand/face fix tokens
 *
 * Order is descending — higher values appear first in the bar.
 */
export const BUILT_IN_QUICK_PRESETS: QuickPreset[] = [
  // -------- positive --------
  {
    id: 'builtin/pos/quality',
    name: '高品質',
    text: 'masterpiece, best quality, ultra detailed, very aesthetic',
    target: 'positive',
    builtIn: true,
    order: 100
  },
  {
    id: 'builtin/pos/8k',
    name: '8K 描写',
    text: '8k, hyper detailed, sharp focus, highly detailed',
    target: 'positive',
    builtIn: true,
    order: 95
  },
  {
    id: 'builtin/pos/anime',
    name: 'アニメ調',
    text: 'anime style, anime coloring, cel shading',
    target: 'positive',
    builtIn: true,
    order: 90
  },
  {
    id: 'builtin/pos/photoreal',
    name: '実写',
    text: 'photorealistic, raw photo, sharp focus, professional photography, dslr',
    target: 'positive',
    builtIn: true,
    order: 85
  },
  {
    id: 'builtin/pos/cinematic',
    name: 'シネマ',
    text: 'cinematic lighting, dramatic, depth of field, bokeh, film grain',
    target: 'positive',
    builtIn: true,
    order: 80
  },
  {
    id: 'builtin/pos/portrait',
    name: 'ポートレート',
    text: 'portrait, upper body, looking at viewer, detailed face, beautiful eyes',
    target: 'positive',
    builtIn: true,
    order: 75
  },
  {
    id: 'builtin/pos/composition-draft',
    name: '構図探索',
    text: 'dynamic composition, rule of thirds, depth of field, looking at viewer',
    target: 'positive',
    builtIn: true,
    order: 74
  },
  {
    id: 'builtin/pos/full-body',
    name: '全身構図',
    text: 'full body, standing pose, balanced composition, detailed face',
    target: 'positive',
    builtIn: true,
    order: 73
  },
  {
    id: 'builtin/pos/camera-angle',
    name: 'カメラ角度',
    text: 'cinematic composition, low angle, wide shot, perspective',
    target: 'positive',
    builtIn: true,
    order: 72
  },
  {
    id: 'builtin/pos/lighting',
    name: '美しい光',
    text: 'beautiful detailed lighting, soft lighting, volumetric lighting, rim light',
    target: 'positive',
    builtIn: true,
    order: 70
  },
  {
    id: 'builtin/pos/illustration',
    name: 'イラスト',
    text: 'illustration, official art, key visual, painted',
    target: 'positive',
    builtIn: true,
    order: 65
  },

  // -------- negative --------
  {
    id: 'builtin/neg/standard',
    name: '標準ネガ',
    text: 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, jpeg artifacts, signature, watermark, username, blurry',
    target: 'negative',
    builtIn: true,
    order: 100
  },
  {
    id: 'builtin/neg/easyneg',
    name: 'EasyNeg 互換',
    text: '(worst quality, low quality, normal quality:1.4), lowres, bad anatomy, bad hands, error, missing fingers, extra digit, cropped',
    target: 'negative',
    builtIn: true,
    order: 95
  },
  {
    id: 'builtin/neg/face',
    name: '顔崩れ防止',
    text: 'deformed face, asymmetric face, ugly face, mutated, malformed, bad eyes, mismatched eyes, cross-eyed',
    target: 'negative',
    builtIn: true,
    order: 90
  },
  {
    id: 'builtin/neg/hands',
    name: '手の崩れ防止',
    text: '(bad hands:1.3), missing fingers, extra fingers, fused fingers, too many fingers, malformed hands',
    target: 'negative',
    builtIn: true,
    order: 85
  },
  {
    id: 'builtin/neg/anatomy',
    name: '体の崩れ防止',
    text: 'bad anatomy, bad proportions, extra limbs, missing limbs, disconnected limbs, mutated limbs, distorted body',
    target: 'negative',
    builtIn: true,
    order: 80
  },
  {
    id: 'builtin/neg/nsfw',
    name: 'NSFW 除外',
    text: 'nsfw, nude, explicit, sexual content',
    target: 'negative',
    builtIn: true,
    order: 75
  },
  {
    id: 'builtin/neg/text',
    name: '文字消し',
    text: 'text, watermark, signature, username, copyright, logo, error',
    target: 'negative',
    builtIn: true,
    order: 70
  }
]
