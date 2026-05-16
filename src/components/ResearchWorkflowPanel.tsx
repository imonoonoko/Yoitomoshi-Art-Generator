import { AlertTriangle, BookOpenCheck, CheckCircle2, ClipboardCheck, Maximize2, Route, Save, ScanFace, Shuffle, Sparkles, Wand2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { api } from '@/lib/ipc'
import { DEFAULT_ADETAILER_UNIT, useStore } from '@/lib/store'
import { approxTokenCount, cleanPromptTokenForMatch, dedupePromptTokens, promptAppend, splitPromptTokensWithRanges } from '@/lib/prompt-utils'
import { cn } from '@/lib/utils'
import type { ActiveLora, CivitaiRecommended, UiLanguage } from '@shared/types'

type Tone = 'ok' | 'warn' | 'info'
type RecipeId = 'composition' | 'faceFix' | 'promptStructure' | 'controlNet' | 'upscale'
type QuickFixId = 'moveSubjectFirst' | 'addComposition' | 'addStyle' | 'addLighting' | 'addNegative' | 'enableFaceFix' | 'prepareControlNet' | 'lockSdxlSize' | 'addLoraTriggers' | 'dedupePrompt'
type SourceTier = 'primaryPlusGuide' | 'multiGuide' | 'creatorExample'

interface CopyText {
  ja: string
  en: string
}

interface ResearchCheck {
  id: string
  tone: Tone
  title: CopyText
  detail: CopyText
  fix?: {
    id: QuickFixId
    label: CopyText
  }
}

interface ResearchRecipe {
  id: RecipeId
  title: CopyText
  summary: CopyText
  source: CopyText
  sourceTier: SourceTier
  reliability: 'A' | 'B'
  applyLabel: CopyText
  onApply(): void
  onSave(): Promise<void>
}

interface ModelContract {
  baseModel: string
  source: CopyText
  sampler: string | null
  steps: number | null
  cfgScale: number | null
  width: number | null
  height: number | null
  clipSkip: number | null
  negativePrompt: string | null
}

const QUALITY_PREFIXES = [
  'masterpiece',
  'best quality',
  'high quality',
  'highly detailed',
  'ultra detailed'
]

const SUBJECT_TERMS = [
  '1girl',
  '1boy',
  'girl',
  'boy',
  'woman',
  'man',
  'character',
  'portrait',
  'person',
  'scenery',
  'landscape',
  'room',
  'building',
  'creature',
  '女の子',
  '少女',
  '女性',
  '男の子',
  '男性',
  '人物',
  '風景',
  '背景'
]

const COMPOSITION_TERMS = [
  'portrait',
  'close-up',
  'upper body',
  'cowboy shot',
  'full body',
  'wide shot',
  'from above',
  'from below',
  'dutch angle',
  'perspective',
  'looking at viewer',
  '全身',
  '上半身',
  '俯瞰',
  '煽り',
  '構図',
  '視線'
]

const STYLE_TERMS = [
  'anime',
  'cel shading',
  'illustration',
  'photorealistic',
  'raw photo',
  'watercolor',
  'oil painting',
  'concept art',
  '3d render',
  'manga',
  'アニメ',
  '実写',
  '水彩',
  'イラスト',
  '写真'
]

const LIGHTING_TERMS = [
  'cinematic lighting',
  'soft light',
  'rim light',
  'backlight',
  'golden hour',
  'volumetric light',
  'sunset',
  'night',
  'lighting',
  '光',
  '照明',
  '夜',
  '夕焼け',
  '逆光'
]

const COLOR_TERMS = [
  'red',
  'blue',
  'green',
  'yellow',
  'pink',
  'purple',
  'black',
  'white',
  'gold',
  'silver',
  'monochrome',
  '赤',
  '青',
  '緑',
  '黄色',
  'ピンク',
  '紫',
  '黒',
  '白',
  '金',
  '銀',
  'モノクロ'
]

const NEGATIVE_SAFETY_TERMS = [
  'lowres',
  'bad anatomy',
  'bad hands',
  'text',
  'watermark',
  'blurry'
]

const FACE_FIX_TAGS = ['deformed face', 'bad eyes', 'asymmetric face', 'bad hands', 'missing fingers', 'extra fingers']
const COMPOSITION_BASE_TAGS = ['portrait', 'looking at viewer']
const STYLE_BASE_TAGS = ['anime style', 'illustration']
const LIGHTING_BASE_TAGS = ['cinematic lighting', 'soft light']
const PROMPT_STRUCTURE_TAGS = ['masterpiece', 'best quality', 'highly detailed', 'cinematic lighting', 'detailed background']
const PROMPT_STRUCTURE_NEGATIVE_TAGS = ['lowres', 'bad anatomy', 'bad hands', 'text', 'watermark', 'blurry']

export function ResearchWorkflowPanel(): JSX.Element {
  const [open, setOpen] = useState(false)
  const prompt = useStore((s) => s.prompt)
  const negative = useStore((s) => s.negativePrompt)
  const params = useStore((s) => s.params)
  const recommendation = useStore((s) => s.recommendation)
  const activeLoras = useStore((s) => s.activeLoras)
  const adetailer = useStore((s) => s.adetailer)
  const controlnet = useStore((s) => s.controlnet)
  const controlnetModels = useStore((s) => s.controlnetModelList)
  const controlnetModules = useStore((s) => s.controlnetModuleList)
  const language = useStore((s) => s.settings?.uiLanguage ?? 'ja')
  const setPrompt = useStore((s) => s.setPrompt)
  const setNegativePrompt = useStore((s) => s.setNegativePrompt)
  const patchParams = useStore((s) => s.patchParams)
  const patchAdetailer = useStore((s) => s.patchAdetailer)
  const patchAdetailerUnit = useStore((s) => s.patchAdetailerUnit)
  const patchControlnet = useStore((s) => s.patchControlnet)
  const patchControlnetUnit = useStore((s) => s.patchControlnetUnit)
  const patchUpscale = useStore((s) => s.patchUpscale)
  const setCurrentTab = useStore((s) => s.setCurrentTab)
  const presets = useStore((s) => s.presets)
  const setPresets = useStore((s) => s.setPresets)

  const checks = useMemo(
    () => analyzeResearchChecks({
      prompt,
      negative,
      params,
      recommendation,
      activeLoras,
      adetailerEnabled: adetailer.enabled,
      controlnetActive: controlnet.enabled && controlnet.units.some((unit) => unit.enabled && Boolean(unit.image))
    }),
    [activeLoras, adetailer.enabled, controlnet.enabled, controlnet.units, negative, params, prompt, recommendation]
  )
  const modelContract = useMemo(() => buildModelContract(recommendation), [recommendation])

  function applyCompositionDraft(): void {
    patchParams({ steps: 20, cfgScale: 6.5, seed: -1, batchSize: 1, iterations: 4 })
    patchAdetailer({ enabled: false })
    toast.success(tx(language, { ja: '構図探索向けに設定しました', en: 'Draft exploration settings applied' }))
  }

  function applyFaceFix(): void {
    patchAdetailer({ enabled: true })
    patchAdetailerUnit(0, {
      ...DEFAULT_ADETAILER_UNIT,
      model: 'face_yolov8n.pt',
      prompt: 'detailed face, beautiful eyes, natural expression',
      negativePrompt: 'deformed face, bad eyes, asymmetric face',
      denoisingStrength: 0.4,
      maskBlur: 4,
      inpaintOnlyMaskedPadding: 32
    })
    setNegativePrompt(appendTags(negative, FACE_FIX_TAGS))
    toast.success(tx(language, { ja: 'ADetailerの顔補修レシピを適用しました', en: 'ADetailer face repair recipe applied' }))
  }

  function applyPromptBaseline(): void {
    setPrompt(appendTags(prompt, PROMPT_STRUCTURE_TAGS))
    setNegativePrompt(appendTags(negative, PROMPT_STRUCTURE_NEGATIVE_TAGS))
    toast.success(tx(language, { ja: 'Prompt構造の土台を追加しました', en: 'Prompt structure baseline added' }))
  }

  function preparePoseControlNet(): void {
    const module = chooseAvailable(controlnetModules, ['openpose_full', 'dw_openpose_full', 'openpose', 'dw_openpose']) ?? 'openpose_full'
    const model = chooseModel(controlnetModels, ['openpose', 'pose']) ?? 'None'
    patchControlnet({ enabled: true })
    patchControlnetUnit(0, {
      enabled: true,
      module,
      model,
      weight: 1,
      controlMode: 2,
      processorRes: 512,
      resizeMode: 1,
      pixelPerfect: true
    })
    toast.success(tx(language, { ja: 'ControlNet Unit 1をポーズ固定向けに準備しました', en: 'ControlNet Unit 1 prepared for pose guidance' }))
  }

  function applyFinalUpscale(): void {
    patchUpscale({
      method: 'ultimate',
      scale: 2,
      denoise: 0.25,
      ultimateTileWidth: 512,
      ultimateMaskBlur: 16,
      ultimatePadding: 64,
      ultimateSeamsFixType: 3
    })
    setCurrentTab('upscale')
    toast.success(tx(language, { ja: '仕上げUpscale向けに設定しました', en: 'Final upscale settings applied' }))
  }

  function applyQuickFix(fixId: QuickFixId): void {
    if (fixId === 'moveSubjectFirst') {
      const next = moveFirstSubjectBeforeQuality(prompt)
      if (next === prompt) {
        toast(tx(language, { ja: '移動できる主題タグが見つかりませんでした', en: 'No movable subject tag was found' }), { icon: 'ℹ' })
        return
      }
      setPrompt(next)
      toast.success(tx(language, { ja: '主題タグを前へ移動しました', en: 'Moved the subject tag earlier' }))
      return
    }
    if (fixId === 'addComposition') {
      setPrompt(appendTags(prompt, COMPOSITION_BASE_TAGS))
      toast.success(tx(language, { ja: '構図タグを追加しました', en: 'Composition tags added' }))
      return
    }
    if (fixId === 'addStyle') {
      setPrompt(appendTags(prompt, STYLE_BASE_TAGS))
      toast.success(tx(language, { ja: '絵柄タグを追加しました', en: 'Style tags added' }))
      return
    }
    if (fixId === 'addLighting') {
      setPrompt(appendTags(prompt, LIGHTING_BASE_TAGS))
      toast.success(tx(language, { ja: '照明タグを追加しました', en: 'Lighting tags added' }))
      return
    }
    if (fixId === 'addNegative') {
      setNegativePrompt(appendTags(negative, PROMPT_STRUCTURE_NEGATIVE_TAGS))
      toast.success(tx(language, { ja: '基本negativeを追加しました', en: 'Basic negative prompt added' }))
      return
    }
    if (fixId === 'enableFaceFix') {
      applyFaceFix()
      return
    }
    if (fixId === 'prepareControlNet') {
      preparePoseControlNet()
      return
    }
    if (fixId === 'lockSdxlSize') {
      patchParams(resolveSdxlSizePatch(params.width, params.height))
      toast.success(tx(language, { ja: 'SDXL向け解像度へ寄せました', en: 'Adjusted resolution for SDXL' }))
      return
    }
    if (fixId === 'addLoraTriggers') {
      const triggerWords = collectMissingLoraTriggers(prompt, activeLoras)
      if (!triggerWords.length) return
      setPrompt(appendTags(prompt, triggerWords))
      toast.success(tx(language, { ja: 'LoRA triggerを追加しました', en: 'LoRA triggers added' }))
      return
    }
    if (fixId === 'dedupePrompt') {
      const result = dedupePromptTokens(prompt)
      if (result.removed === 0) {
        toast(tx(language, { ja: '重複タグは見つかりませんでした', en: 'No duplicate tags found' }), { icon: 'ℹ' })
        return
      }
      setPrompt(result.prompt)
      toast.success(tx(language, { ja: `${result.removed}件の重複タグを整理しました`, en: `Removed ${result.removed} duplicate tags` }))
    }
  }

  async function saveRecipePreset(title: CopyText): Promise<void> {
    if (!prompt.trim()) {
      toast.error(tx(language, { ja: '保存するPromptが空です', en: 'Prompt is empty' }))
      return
    }
    try {
      const name = tx(language, { ja: `制作レシピ: ${title.ja}`, en: `Workflow recipe: ${title.en}` })
      const created = await api.storage.savePreset({
        name,
        prompt,
        negativePrompt: negative
      })
      setPresets([created, ...presets.filter((preset) => preset.id !== created.id)])
      toast.success(tx(language, { ja: 'プリセットに保存しました', en: 'Saved to presets' }))
    } catch (error) {
      toast.error(tx(language, { ja: `保存に失敗しました: ${(error as Error).message}`, en: `Save failed: ${(error as Error).message}` }))
    }
  }

  function applyModelContract(contract: ModelContract): void {
    patchParams({
      ...(contract.steps ? { steps: contract.steps } : {}),
      ...(contract.cfgScale ? { cfgScale: contract.cfgScale } : {}),
      ...(contract.width && contract.height ? { width: contract.width, height: contract.height } : {}),
      ...(contract.sampler ? { sampler: contract.sampler } : {}),
      ...(contract.clipSkip ? { clipSkip: contract.clipSkip } : {})
    })
    if (contract.negativePrompt) {
      setNegativePrompt(appendTags(negative, splitPromptLikeTags(contract.negativePrompt).slice(0, 12)))
    }
    toast.success(tx(language, { ja: 'モデル推奨設定を反映しました', en: 'Model contract applied' }))
  }

  const recipes = useMemo<ResearchRecipe[]>(() => [
    {
      id: 'composition',
      title: { ja: '構図探索', en: 'Composition draft' },
      summary: {
        ja: '固定しすぎず、短時間で4案を見る。顔補修やupscaleは後回し。',
        en: 'Explore four light drafts before detail repair or upscaling.'
      },
      source: { ja: 'SD Art workflow / Replicate seed比較', en: 'SD Art workflow / Replicate seed comparison' },
      sourceTier: 'primaryPlusGuide',
      reliability: 'A',
      applyLabel: { ja: '探索設定', en: 'Apply draft' },
      onApply: applyCompositionDraft,
      onSave: () => saveRecipePreset({ ja: '構図探索', en: 'Composition draft' })
    },
    {
      id: 'faceFix',
      title: { ja: '全身キャラの顔補修', en: 'Full-body face repair' },
      summary: {
        ja: '全身・遠景で崩れやすい顔をADetailerで後処理する。',
        en: 'Use ADetailer for small faces in full-body or distant shots.'
      },
      source: { ja: 'ADetailer講座の共通実務', en: 'Common ADetailer tutorial practice' },
      sourceTier: 'multiGuide',
      reliability: 'A',
      applyLabel: { ja: '顔補修ON', en: 'Enable repair' },
      onApply: applyFaceFix,
      onSave: () => saveRecipePreset({ ja: '全身キャラの顔補修', en: 'Full-body face repair' })
    },
    {
      id: 'promptStructure',
      title: { ja: 'Prompt構造の土台', en: 'Prompt structure base' },
      summary: {
        ja: '品質、照明、背景、基本negativeを足して比較の土台を揃える。',
        en: 'Add a compact quality, lighting, background, and negative baseline.'
      },
      source: { ja: 'Civitai Prompting / 日本語構図集', en: 'Civitai Prompting / composition guides' },
      sourceTier: 'multiGuide',
      reliability: 'B',
      applyLabel: { ja: '不足分を追加', en: 'Add baseline' },
      onApply: applyPromptBaseline,
      onSave: () => saveRecipePreset({ ja: 'Prompt構造の土台', en: 'Prompt structure base' })
    },
    {
      id: 'controlNet',
      title: { ja: 'ポーズ/線画固定', en: 'Pose or line lock' },
      summary: {
        ja: 'ControlNetを役割カードとして使う。画像を入れてからpreviewで確認。',
        en: 'Prepare a role-based ControlNet unit, then preview with an image.'
      },
      source: { ja: 'ControlNet講座の共通実務', en: 'Common ControlNet tutorial practice' },
      sourceTier: 'primaryPlusGuide',
      reliability: 'A',
      applyLabel: { ja: 'Pose Unit準備', en: 'Prepare pose unit' },
      onApply: preparePoseControlNet,
      onSave: () => saveRecipePreset({ ja: 'ポーズ/線画固定', en: 'Pose or line lock' })
    },
    {
      id: 'upscale',
      title: { ja: '仕上げUpscale', en: 'Final upscale' },
      summary: {
        ja: '構図確定後に2xから、denoise低めで破綻を抑える。',
        en: 'Start at 2x after composition is fixed, with a low denoise value.'
      },
      source: { ja: 'Upscale / Tile講座の共通実務', en: 'Common upscale and tile guidance' },
      sourceTier: 'creatorExample',
      reliability: 'A',
      applyLabel: { ja: 'Upscaleへ', en: 'Go upscale' },
      onApply: applyFinalUpscale,
      onSave: () => saveRecipePreset({ ja: '仕上げUpscale', en: 'Final upscale' })
    }
  ], [
    activeLoras,
    controlnetModels,
    controlnetModules,
    language,
    negative,
    patchAdetailer,
    patchAdetailerUnit,
    patchControlnet,
    patchControlnetUnit,
    patchParams,
    patchUpscale,
    prompt,
    setCurrentTab,
    setNegativePrompt,
    setPresets,
    setPrompt,
    presets
  ])

  return (
    <section className="border border-line rounded-md bg-bg-0/60" data-testid="research-workflow-panel">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-2 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <BookOpenCheck className="h-4 w-4 text-accent" />
        <span className="text-xs font-medium text-ink-1">
          {tx(language, { ja: '制作ナレッジ', en: 'Creator workflow' })}
        </span>
        <span className="ml-auto text-[10px] text-ink-3">
          {open ? tx(language, { ja: '閉じる', en: 'Close' }) : tx(language, { ja: '確認', en: 'Check' })}
        </span>
      </button>
      {open && (
        <div className="border-t border-line p-3 space-y-3">
          {modelContract && (
            <ModelContractCard
              contract={modelContract}
              language={language}
              onApply={applyModelContract}
            />
          )}

          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-ink-3">
              <ClipboardCheck className="h-3.5 w-3.5" />
              <span>{tx(language, { ja: '現在のPrompt診断', en: 'Current prompt checks' })}</span>
            </div>
            <div className="space-y-1.5">
              {checks.map((check) => (
                <CheckItem key={check.id} check={check} language={language} onFix={applyQuickFix} />
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-ink-3">
              <Sparkles className="h-3.5 w-3.5" />
              <span>{tx(language, { ja: '調査ベースの制作レシピ', en: 'Research-backed recipes' })}</span>
            </div>
            <div className="space-y-2">
              {recipes.map((recipe) => (
                <RecipeCard key={recipe.id} recipe={recipe} language={language} />
              ))}
            </div>
          </div>

        </div>
      )}
    </section>
  )
}

function ModelContractCard({
  contract,
  language,
  onApply
}: {
  contract: ModelContract
  language: UiLanguage
  onApply(contract: ModelContract): void
}): JSX.Element {
  const chips = [
    contract.sampler,
    contract.steps ? `${contract.steps} steps` : null,
    contract.cfgScale ? `CFG ${contract.cfgScale}` : null,
    contract.width && contract.height ? `${contract.width}×${contract.height}` : null,
    contract.clipSkip ? `clip skip ${contract.clipSkip}` : null
  ].filter(Boolean)
  return (
    <article className="rounded-md border border-accent/35 bg-accent/5 p-2">
      <div className="flex items-center gap-1.5">
        <BookOpenCheck className="h-3.5 w-3.5 text-accent" />
        <h3 className="text-[11px] font-semibold text-ink-1">
          {tx(language, { ja: 'Model Prompt Contract', en: 'Model Prompt Contract' })}
        </h3>
        <span className="ml-auto rounded border border-ok/35 px-1.5 py-0.5 text-[9px] font-semibold text-ok">
          {contract.baseModel}
        </span>
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-ink-3">{tx(language, contract.source)}</p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {chips.map((chip) => (
          <span key={chip} className="rounded border border-line bg-bg-2 px-1.5 py-0.5 text-[9px] text-ink-2">
            {chip}
          </span>
        ))}
      </div>
      <button
        type="button"
        className="btn mt-2 w-full justify-center py-1 text-[11px] gap-1.5"
        onClick={() => onApply(contract)}
      >
        <Wand2 className="h-3.5 w-3.5" />
        {tx(language, { ja: 'モデル推奨を反映', en: 'Apply model contract' })}
      </button>
    </article>
  )
}

function buildModelContract(recommendation: CivitaiRecommended | null): ModelContract | null {
  if (!recommendation) return null
  const s = recommendation.suggested
  if (
    !s.sampler &&
    !s.steps &&
    !s.cfgScale &&
    !s.width &&
    !s.height &&
    !s.clipSkip &&
    !s.negativePrompt
  ) {
    return null
  }
  return {
    baseModel: recommendation.baseModel,
    source: {
      ja: 'Civitai sample metadata 由来。モデルごとの推奨値として扱い、二次情報レシピより優先して確認します。',
      en: 'Derived from Civitai sample metadata. Treat as the model-specific recommendation before generic recipes.'
    },
    sampler: s.sampler,
    steps: s.steps,
    cfgScale: s.cfgScale,
    width: s.width,
    height: s.height,
    clipSkip: s.clipSkip,
    negativePrompt: s.negativePrompt
  }
}

function splitPromptLikeTags(prompt: string): string[] {
  return prompt
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function CheckItem({
  check,
  language,
  onFix
}: {
  check: ResearchCheck
  language: UiLanguage
  onFix(fixId: QuickFixId): void
}): JSX.Element {
  const Icon = check.tone === 'ok' ? CheckCircle2 : check.tone === 'warn' ? AlertTriangle : Sparkles
  return (
    <div className={cn(
      'rounded border px-2 py-1.5',
      check.tone === 'ok' && 'border-ok/30 bg-ok/5',
      check.tone === 'warn' && 'border-warn/35 bg-warn/5',
      check.tone === 'info' && 'border-accent/30 bg-accent/5'
    )}>
      <div className="flex items-start gap-1.5">
        <Icon className={cn(
          'mt-0.5 h-3.5 w-3.5 shrink-0',
          check.tone === 'ok' && 'text-ok',
          check.tone === 'warn' && 'text-warn',
          check.tone === 'info' && 'text-accent'
        )} />
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-ink-1">{tx(language, check.title)}</div>
          <div className="text-[10px] leading-relaxed text-ink-3">{tx(language, check.detail)}</div>
          {check.fix && (
            <button
              type="button"
              className="btn mt-1.5 py-0.5 px-2 text-[10px] gap-1"
              onClick={() => onFix(check.fix!.id)}
            >
              <Wand2 className="h-3 w-3" />
              {tx(language, check.fix.label)}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function RecipeCard({ recipe, language }: { recipe: ResearchRecipe; language: UiLanguage }): JSX.Element {
  return (
    <article className="rounded border border-line bg-bg-2/35 p-2" data-testid={`recipe-card-${recipe.id}`}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-accent">{renderRecipeIcon(recipe.id)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-[11px] font-semibold text-ink-1">{tx(language, recipe.title)}</h3>
            <span className={cn(
              'ml-auto rounded border px-1.5 py-0.5 text-[9px] font-semibold',
              recipe.reliability === 'A'
                ? 'border-ok/40 text-ok'
                : 'border-warn/40 text-warn'
            )}>
              {tx(language, { ja: `信頼度${recipe.reliability}`, en: `Reliability ${recipe.reliability}` })}
            </span>
          </div>
          <p className="mt-0.5 text-[10px] leading-relaxed text-ink-2">{tx(language, recipe.summary)}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <span className={cn(
              'rounded border px-1.5 py-0.5 text-[9px] font-semibold',
              sourceTierClass(recipe.sourceTier)
            )}>
              {tx(language, sourceTierLabel(recipe.sourceTier))}
            </span>
            <span className="min-w-0 text-[9px] leading-relaxed text-ink-3">{tx(language, recipe.source)}</span>
          </div>
          <div className="mt-2 grid grid-cols-[1fr_auto] gap-1.5">
            <button
              type="button"
              className="btn justify-center py-1 text-[11px] gap-1.5"
              onClick={recipe.onApply}
            >
              <Wand2 className="h-3.5 w-3.5" />
              {tx(language, recipe.applyLabel)}
            </button>
            <button
              type="button"
              className="btn btn-icon"
              onClick={() => { void recipe.onSave() }}
              title={tx(language, { ja: '現在のPromptをプリセットへ保存', en: 'Save current prompt to presets' })}
            >
              <Save className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}

function renderRecipeIcon(id: RecipeId): JSX.Element {
  switch (id) {
    case 'composition':
      return <Shuffle className="h-4 w-4" />
    case 'faceFix':
      return <ScanFace className="h-4 w-4" />
    case 'promptStructure':
      return <ClipboardCheck className="h-4 w-4" />
    case 'controlNet':
      return <Route className="h-4 w-4" />
    case 'upscale':
      return <Maximize2 className="h-4 w-4" />
  }
}

function sourceTierLabel(tier: SourceTier): CopyText {
  switch (tier) {
    case 'primaryPlusGuide':
      return { ja: '一次+講座一致', en: 'Primary + guides' }
    case 'multiGuide':
      return { ja: '複数講座一致', en: 'Multiple guides' }
    case 'creatorExample':
      return { ja: 'Creator実例', en: 'Creator example' }
  }
}

function sourceTierClass(tier: SourceTier): string {
  switch (tier) {
    case 'primaryPlusGuide':
      return 'border-ok/40 bg-ok/5 text-ok'
    case 'multiGuide':
      return 'border-accent/40 bg-accent/5 text-accent'
    case 'creatorExample':
      return 'border-warn/40 bg-warn/5 text-warn'
  }
}

function analyzeResearchChecks({
  prompt,
  negative,
  params,
  recommendation,
  activeLoras,
  adetailerEnabled,
  controlnetActive
}: {
  prompt: string
  negative: string
  params: { seed: number; width: number; height: number }
  recommendation: CivitaiRecommended | null
  activeLoras: ActiveLora[]
  adetailerEnabled: boolean
  controlnetActive: boolean
}): ResearchCheck[] {
  const checks: ResearchCheck[] = []
  const tokens = splitPromptTokensWithRanges(prompt)
    .map((token) => cleanPromptTokenForMatch(token.text).toLowerCase())
    .filter(Boolean)
  const text = prompt.toLowerCase()
  const negativeText = negative.toLowerCase()
  const tokenCount = approxTokenCount(prompt)

  if (!prompt.trim()) {
    checks.push({
      id: 'empty',
      tone: 'warn',
      title: { ja: 'Promptが空です', en: 'Prompt is empty' },
      detail: { ja: '主題、構図、絵柄、光の順で短く置くと比較しやすくなります。', en: 'Start with subject, composition, style, and lighting for easier comparison.' },
      fix: { id: 'addComposition', label: { ja: '構図だけ足す', en: 'Add composition' } }
    })
    return checks
  }

  const firstToken = tokens[0] ?? ''
  const hasSubject = hasAny(text, SUBJECT_TERMS)
  if (QUALITY_PREFIXES.some((quality) => firstToken.includes(quality)) && hasSubject) {
    checks.push({
      id: 'quality-first',
      tone: 'info',
      title: { ja: '主題より品質タグが前です', en: 'Quality tags come before the subject' },
      detail: { ja: '重要な主題を先頭に置くと、構図比較時の意図が読みやすくなります。', en: 'Putting the subject first keeps comparison runs easier to reason about.' },
      fix: { id: 'moveSubjectFirst', label: { ja: '主題を前へ', en: 'Move subject first' } }
    })
  } else if (hasSubject) {
    checks.push({
      id: 'subject-ok',
      tone: 'ok',
      title: { ja: '主題は入っています', en: 'Subject is present' },
      detail: { ja: '次は構図、絵柄、光を足すとレシピ化しやすくなります。', en: 'Add composition, style, and lighting to make this a reusable recipe.' },
      fix: hasDuplicatePromptTokens(prompt) ? { id: 'dedupePrompt', label: { ja: '重複整理', en: 'Dedupe' } } : undefined
    })
  } else {
    checks.push({
      id: 'subject-missing',
      tone: 'warn',
      title: { ja: '主題が弱いです', en: 'Subject is weak' },
      detail: { ja: '誰/何を描くかを先頭付近に置くと、二次情報で推奨される比較が安定します。', en: 'Place who or what is being drawn near the start for more stable comparisons.' }
    })
  }

  if (!hasAny(text, COMPOSITION_TERMS)) {
    checks.push({
      id: 'composition-missing',
      tone: 'info',
      title: { ja: '構図タグが不足気味です', en: 'Composition tags are light' },
      detail: { ja: 'portrait、full body、from above、wide shotなどを足すと狙いを固定しやすくなります。', en: 'Add terms like portrait, full body, from above, or wide shot to lock intent.' },
      fix: { id: 'addComposition', label: { ja: '構図タグ追加', en: 'Add composition' } }
    })
  }

  if (!hasAny(text, STYLE_TERMS)) {
    checks.push({
      id: 'style-missing',
      tone: 'info',
      title: { ja: '絵柄指定が薄いです', en: 'Style is underspecified' },
      detail: { ja: 'anime style、raw photo、watercolorなど、モデルに任せる範囲を明確にできます。', en: 'Use anime style, raw photo, watercolor, or similar terms to narrow the model behavior.' },
      fix: { id: 'addStyle', label: { ja: '絵柄タグ追加', en: 'Add style' } }
    })
  }

  if (!hasAny(text, LIGHTING_TERMS)) {
    checks.push({
      id: 'lighting-missing',
      tone: 'info',
      title: { ja: '光の指定がありません', en: 'Lighting is missing' },
      detail: { ja: 'cinematic lighting、soft light、backlightなどは仕上がり差が出やすい調整点です。', en: 'Lighting terms like cinematic lighting, soft light, and backlight strongly shape the result.' },
      fix: { id: 'addLighting', label: { ja: '照明タグ追加', en: 'Add lighting' } }
    })
  }

  const colorIndex = tokens.findIndex((token) => COLOR_TERMS.some((color) => token.includes(color)))
  if (colorIndex >= 0 && colorIndex <= 1) {
    checks.push({
      id: 'color-early',
      tone: 'warn',
      title: { ja: '色指定が強く出やすい位置です', en: 'Color may dominate the prompt' },
      detail: { ja: '色語が先頭付近にあると画面全体を支配しやすいので、衣装/背景など対象を明示すると安定します。', en: 'Early color terms can dominate the whole image; attach them to clothing, background, or a target.' }
    })
  }

  if (tokenCount > 150) {
    checks.push({
      id: 'token-high',
      tone: 'warn',
      title: { ja: 'Promptが長めです', en: 'Prompt is long' },
      detail: { ja: '150 token超は意図が薄まりやすいので、比較前に重複と弱い語を削るのが安全です。', en: 'Past 150 tokens, intent can dilute; remove duplicates and weak terms before comparing.' },
      fix: { id: 'dedupePrompt', label: { ja: '重複整理', en: 'Dedupe' } }
    })
  } else if (tokenCount > 75) {
    checks.push({
      id: 'token-mid',
      tone: 'info',
      title: { ja: '2 chunk目に入っています', en: 'Prompt enters a second chunk' },
      detail: { ja: '重要語を前半へ寄せると、モデル差の比較が読みやすくなります。', en: 'Move important terms earlier to make model comparisons easier to read.' }
    })
  }

  const missingNegative = NEGATIVE_SAFETY_TERMS.filter((term) => !negativeText.includes(term))
  if (missingNegative.length >= 3) {
    checks.push({
      id: 'negative-light',
      tone: 'warn',
      title: { ja: '基本negativeが薄いです', en: 'Basic negative prompt is light' },
      detail: { ja: 'bad hands、text、watermark、blurryは多くの講座で共通する安全側の土台です。', en: 'bad hands, text, watermark, and blurry are common safety baseline terms.' },
      fix: { id: 'addNegative', label: { ja: '基本negative追加', en: 'Add negative' } }
    })
  }

  const fullBodyIntent = hasAny(text, ['full body', 'cowboy shot', 'wide shot', '全身', '遠景'])
  if (fullBodyIntent && !adetailerEnabled) {
    checks.push({
      id: 'face-fix-needed',
      tone: 'warn',
      title: { ja: '全身絵は顔補修候補です', en: 'Full-body shots may need face repair' },
      detail: { ja: '小さい顔は崩れやすいので、ADetailer顔補修を後段で使うと安定します。', en: 'Small faces often degrade; ADetailer face repair is a good final pass.' },
      fix: { id: 'enableFaceFix', label: { ja: '顔補修ON', en: 'Enable face repair' } }
    })
  }

  const controlIntent = hasAny(text, ['pose', 'openpose', 'lineart', 'canny', 'depth', 'sketch', 'ポーズ', '線画', '構図固定'])
  if (controlIntent && !controlnetActive) {
    checks.push({
      id: 'controlnet-needed',
      tone: 'info',
      title: { ja: '構図固定はControlNet候補です', en: 'ControlNet may help lock structure' },
      detail: { ja: 'ポーズ、線画、DepthはPromptだけでなく参照画像とpreview確認に分けると再現しやすくなります。', en: 'Pose, lineart, and depth are easier to reproduce with a reference image and preview.' },
      fix: { id: 'prepareControlNet', label: { ja: 'Unit準備', en: 'Prepare unit' } }
    })
  }

  if (params.seed === -1) {
    checks.push({
      id: 'seed-random',
      tone: 'info',
      title: { ja: 'seedはランダムです', en: 'Seed is random' },
      detail: { ja: '構図探索には向きます。設定比較に入る時は良いseedを固定してください。', en: 'Good for exploration; lock a promising seed before comparing settings.' }
    })
  } else {
    checks.push({
      id: 'seed-fixed',
      tone: 'ok',
      title: { ja: 'seed固定で比較できます', en: 'Seed is fixed for comparison' },
      detail: { ja: 'CFG、steps、LoRA weight、ADetailer有無の差を見やすい状態です。', en: 'CFG, steps, LoRA weight, and ADetailer changes are easier to compare now.' }
    })
  }

  const missingLoraTriggers = activeLoras
    .filter((lora) => lora.triggerWords.length > 0)
    .filter((lora) => !lora.triggerWords.some((word) => text.includes(word.toLowerCase())))
  if (missingLoraTriggers.length > 0) {
    checks.push({
      id: 'lora-triggers',
      tone: 'warn',
      title: { ja: 'LoRA triggerが未入力です', en: 'LoRA triggers are missing' },
      detail: { ja: `${missingLoraTriggers.slice(0, 2).map((lora) => lora.name).join(', ')} のtrigger wordsをPromptへ入れると効き方が安定します。`, en: `Add trigger words for ${missingLoraTriggers.slice(0, 2).map((lora) => lora.name).join(', ')} for steadier LoRA behavior.` },
      fix: { id: 'addLoraTriggers', label: { ja: 'trigger追加', en: 'Add triggers' } }
    })
  }

  if (recommendation?.baseModel.toLowerCase().includes('sdxl') && Math.max(params.width, params.height) < 900) {
    checks.push({
      id: 'sdxl-size',
      tone: 'info',
      title: { ja: 'SDXLには少し小さめです', en: 'Resolution is small for SDXL' },
      detail: { ja: 'SDXL系は1024付近が基準になりやすいので、構図探索後にサイズを上げる候補です。', en: 'SDXL usually expects around 1024px; raise size after composition exploration.' },
      fix: { id: 'lockSdxlSize', label: { ja: '1024基準へ', en: 'Use 1024 base' } }
    })
  }

  return checks.slice(0, 8)
}

function appendTags(prompt: string, tags: string[]): string {
  return tags.reduce((next, tag) => promptAppend(next, tag), prompt)
}

function chooseAvailable(available: string[], candidates: string[]): string | null {
  if (!available.length) return null
  const normalized = available.map((value) => ({ value, lower: value.toLowerCase() }))
  for (const candidate of candidates) {
    const lowerCandidate = candidate.toLowerCase()
    const exact = normalized.find((item) => item.lower === lowerCandidate)
    if (exact) return exact.value
  }
  for (const candidate of candidates) {
    const lowerCandidate = candidate.toLowerCase()
    const partial = normalized.find((item) => item.lower.includes(lowerCandidate))
    if (partial) return partial.value
  }
  return null
}

function chooseModel(models: string[], keywords: string[]): string | null {
  if (!models.length) return null
  return models.find((model) => keywords.every((keyword) => model.toLowerCase().includes(keyword))) ?? null
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term.toLowerCase()))
}

function hasDuplicatePromptTokens(prompt: string): boolean {
  const tokens = splitPromptTokensWithRanges(prompt)
  const seen = new Set<string>()
  for (const token of tokens) {
    const key = cleanPromptTokenForMatch(token.text).toLowerCase()
    if (!key) continue
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
}

function moveFirstSubjectBeforeQuality(prompt: string): string {
  const tokens = splitPromptTokensWithRanges(prompt).map((token) => token.text)
  if (tokens.length < 2) return prompt
  const subjectIndex = tokens.findIndex((token, index) => {
    if (index === 0) return false
    const clean = cleanPromptTokenForMatch(token).toLowerCase()
    return SUBJECT_TERMS.some((term) => clean.includes(term.toLowerCase()))
  })
  if (subjectIndex <= 0) return prompt
  const [subject] = tokens.splice(subjectIndex, 1)
  tokens.unshift(subject)
  return tokens.join(', ')
}

function resolveSdxlSizePatch(width: number, height: number): { width: number; height: number } {
  if (width > height) return { width: 1216, height: 832 }
  if (height > width) return { width: 832, height: 1216 }
  return { width: 1024, height: 1024 }
}

function collectMissingLoraTriggers(prompt: string, activeLoras: ActiveLora[]): string[] {
  const text = prompt.toLowerCase()
  const out: string[] = []
  const seen = new Set<string>()
  for (const lora of activeLoras) {
    for (const trigger of lora.triggerWords) {
      const clean = trigger.trim()
      const key = clean.toLowerCase()
      if (!clean || seen.has(key) || text.includes(key)) continue
      seen.add(key)
      out.push(clean)
      if (out.length >= 8) return out
    }
  }
  return out
}

function tx(language: UiLanguage, copy: CopyText): string {
  return language === 'ja' ? copy.ja : copy.en
}
