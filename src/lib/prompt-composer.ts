import type {
  CheckpointPromptFamily,
  CheckpointNegativeStrategy,
  CheckpointPromptStyle,
  PromptComposerSlotKey,
  PromptComposerSlots,
  PromptCategory,
  PromptGroupTag
} from '@shared/types'
import { cleanPromptTokenForMatch, formatPromptText } from './prompt-utils'
import { translatePromptToEnglishTags } from './prompt-translate'

export type PromptComposerTarget = 'positive' | 'negative'
export type { PromptComposerSlotKey, PromptComposerSlots } from '@shared/types'

export interface PromptComposerTranslationBatchResult {
  translatedTexts: string[]
  cacheHit: boolean
  warnings: string[]
}

export interface PromptComposerResult {
  prompt: string
  tags: string[]
  changed: boolean
  translatedCount: number
  dictionaryCount: number
  libraryCount: number
  preservedCount: number
  cacheHit: boolean
  warnings: string[]
  positiveSuggestions: string[]
  negativeSuggestions: string[]
}

export interface PromptComposerInput {
  text: string
  target?: PromptComposerTarget
  library: PromptCategory[]
  translateSegments?: (segments: string[]) => Promise<PromptComposerTranslationBatchResult>
}

export interface PromptComposerSlotInput {
  slots: PromptComposerSlots
  library: PromptCategory[]
  promptStyle?: CheckpointPromptStyle
  negativeStrategy?: CheckpointNegativeStrategy
  positiveSlotOrder?: PromptComposerPositiveSlotKey[]
  translateSegments?: (segments: string[]) => Promise<PromptComposerTranslationBatchResult>
}

export interface PromptComposerSlotResult {
  positivePrompt: string
  negativePrompt: string
  positiveTags: string[]
  negativeTags: string[]
  positiveReplacements: string[]
  promptStyle: CheckpointPromptStyle
  negativeStrategy: CheckpointNegativeStrategy
  changed: boolean
  warnings: string[]
}

interface ComposerSegment {
  text: string
  protectedSyntax: boolean
}

const JAPANESE_TEXT = /[\u3040-\u30ff\u3400-\u9fff]/
const ASCII_WORD = /[a-zA-Z]/
const TERMINAL_SENTENCE_MARKS = /[。．.]+$/u

const PROMPT_TRANSLATION_DICTIONARY: Record<string, string[]> = {
  'コスプレ': ['cosplay'],
  'cosチューム': ['cosplay'],
  '初音ミク': ['hatsune miku'],
  'ミク': ['hatsune miku'],
  'ダンスシーン': ['dance scene'],
  'ダンス': ['dance scene'],
  '踊る': ['dancing'],
  '踊っている': ['dancing'],
  '女の子': ['1girl'],
  '少女': ['1girl'],
  '女性': ['1girl'],
  '男の子': ['1boy'],
  '少年': ['1boy'],
  '男性': ['1boy'],
  '黒髪': ['black hair'],
  '青い目': ['blue eyes'],
  '青目': ['blue eyes'],
  '笑顔': ['smile'],
  '微笑み': ['gentle smile'],
  '全身': ['full body'],
  '上半身': ['upper body'],
  'ポートレート': ['portrait'],
  '制服': ['school uniform'],
  '衣装': ['costume'],
  'ライブ': ['live concert'],
  'ステージ': ['stage'],
  '音楽ビデオ': ['music video'],
  '背景なし': ['simple background'],
  '白背景': ['white background'],
  '高品質': ['high quality'],
  '最高品質': ['best quality'],
  '傑作': ['masterpiece'],
  'アニメ': ['anime illustration'],
  'イラスト': ['illustration'],
  '柔らかい光': ['soft lighting'],
  '暖かい光': ['warm light'],
  '逆光': ['backlighting']
}

const NEGATIVE_HINT_RULES: Array<{ needles: string[]; tags: string[]; warning?: string }> = [
  { needles: ['手', '指', 'hand', 'finger'], tags: ['bad hands', 'missing fingers', 'extra fingers'] },
  { needles: ['顔', '目', 'face', 'eyes'], tags: ['deformed face', 'bad eyes', 'asymmetric face'] },
  { needles: ['文字', 'ロゴ', 'text', 'logo'], tags: ['text', 'logo', 'signature', 'watermark'] },
  { needles: ['ポーズ', 'pose', '構図'], tags: [], warning: 'controlnet-may-help' },
  { needles: ['衣装', '服', 'costume', 'outfit'], tags: [], warning: 'lora-clothing-conflict' }
]

export type PromptComposerPositiveSlotKey = Exclude<PromptComposerSlotKey, 'avoidFailures'>

export const PROMPT_COMPOSER_POSITIVE_SLOT_KEYS: PromptComposerPositiveSlotKey[] = [
  'qualityPrefix',
  'subject',
  'composition',
  'expressionPose',
  'lighting',
  'color',
  'clothingProps',
  'background',
  'textureStyle',
  'finishing'
]

export function promptComposerPositiveSlotOrderForModel(
  family: CheckpointPromptFamily,
  promptStyle: CheckpointPromptStyle
): PromptComposerPositiveSlotKey[] {
  if (promptStyle === 'natural' || family === 'flux') {
    return [
      'subject',
      'composition',
      'expressionPose',
      'clothingProps',
      'background',
      'lighting',
      'color',
      'textureStyle',
      'finishing',
      'qualityPrefix'
    ]
  }
  if (family === 'pony') {
    return [
      'qualityPrefix',
      'subject',
      'clothingProps',
      'expressionPose',
      'composition',
      'background',
      'lighting',
      'color',
      'textureStyle',
      'finishing'
    ]
  }
  if (family === 'animagine') {
    return [
      'subject',
      'clothingProps',
      'expressionPose',
      'composition',
      'background',
      'lighting',
      'color',
      'textureStyle',
      'finishing',
      'qualityPrefix'
    ]
  }
  if (family === 'illustrious' || family === 'noobai') {
    return [
      'qualityPrefix',
      'subject',
      'clothingProps',
      'expressionPose',
      'composition',
      'background',
      'lighting',
      'textureStyle',
      'color',
      'finishing'
    ]
  }
  if (family === 'sd15') {
    return [
      'qualityPrefix',
      'subject',
      'composition',
      'expressionPose',
      'clothingProps',
      'background',
      'lighting',
      'textureStyle',
      'color',
      'finishing'
    ]
  }
  return [...PROMPT_COMPOSER_POSITIVE_SLOT_KEYS]
}

const SLOT_LABELS: Record<PromptComposerPositiveSlotKey, string> = {
  qualityPrefix: 'Quality and score',
  subject: 'Subject',
  composition: 'Composition',
  expressionPose: 'Expression and pose',
  lighting: 'Lighting',
  color: 'Color',
  clothingProps: 'Clothing and props',
  background: 'Background',
  textureStyle: 'Texture and style',
  finishing: 'Finishing'
}

const POSITIVE_REPLACEMENT_RULES: Array<{ needles: string[]; positive: string[]; negative: string[] }> = [
  {
    needles: ['手', '指', 'hand', 'finger'],
    positive: ['well drawn hands', 'clear fingers'],
    negative: ['bad hands', 'missing fingers', 'extra fingers']
  },
  {
    needles: ['顔', '目', 'face', 'eyes'],
    positive: ['symmetrical face', 'clear eyes'],
    negative: ['deformed face', 'bad eyes', 'asymmetric face']
  },
  {
    needles: ['文字', 'ロゴ', '署名', 'text', 'logo', 'signature', 'watermark'],
    positive: ['clean image without text'],
    negative: ['text', 'logo', 'signature', 'watermark']
  },
  {
    needles: ['低解像', 'ぼけ', 'blurry', 'lowres', 'low resolution'],
    positive: ['sharp focus', 'high detail'],
    negative: ['lowres', 'blurry']
  },
  {
    needles: ['破綻', '解剖', 'anatomy', 'deformed'],
    positive: ['correct anatomy', 'stable body proportions'],
    negative: ['bad anatomy', 'deformed body']
  }
]

export async function composePromptInput(input: PromptComposerInput): Promise<PromptComposerResult> {
  const source = input.text.trim()
  if (!source) return emptyPromptComposerResult(source)

  const library = input.library
  const segments = splitPromptComposerSegments(source)
  const tags: string[] = []
  const unresolved: Array<{ segment: ComposerSegment; index: number }> = []
  let dictionaryCount = 0
  let libraryCount = 0
  let preservedCount = 0
  const warnings = new Set<string>()

  for (const segment of segments) {
    if (segment.protectedSyntax) {
      addTag(tags, segment.text)
      preservedCount += 1
      continue
    }

    const dictionary = dictionaryLookup(segment.text)
    if (dictionary.length > 0) {
      dictionary.forEach((tag) => addTag(tags, tag))
      dictionaryCount += dictionary.length
      continue
    }

    const libraryMatch = findLibraryTag(segment.text, library)
    if (libraryMatch) {
      addTag(tags, libraryMatch.en)
      libraryCount += 1
      continue
    }

    const localTags = translatePromptToEnglishTags(segment.text, library, 8)
    if (JAPANESE_TEXT.test(segment.text) && localTags.length > 0) {
      localTags.forEach((tag) => addTag(tags, tag))
      libraryCount += localTags.length
      continue
    }

    if (JAPANESE_TEXT.test(segment.text)) {
      unresolved.push({ segment, index: tags.length })
      tags.push('')
      continue
    }

    addTag(tags, segment.text)
  }

  let translatedCount = 0
  let cacheHit = false
  if (unresolved.length > 0) {
    if (input.translateSegments) {
      try {
        const translated = await input.translateSegments(unresolved.map((item) => item.segment.text))
        cacheHit = translated.cacheHit
        translated.warnings.forEach((warning) => warnings.add(warning))
        unresolved.forEach((item, i) => {
          const translatedText = translated.translatedTexts[i] ?? item.segment.text
          const translatedTags = splitPromptComposerSegments(translatedText)
            .map((tag) => normalizePromptComposerTag(tag.text))
            .filter(Boolean)
          tags[item.index] = translatedTags.shift() ?? item.segment.text
          translatedTags.forEach((tag) => tags.push(tag))
          translatedCount += 1
        })
      } catch (error) {
        warnings.add(`translation-failed:${(error as Error).message}`)
        unresolved.forEach((item) => {
          tags[item.index] = item.segment.text
        })
      }
    } else {
      warnings.add('translation-provider-missing')
      unresolved.forEach((item) => {
        tags[item.index] = item.segment.text
      })
    }
  }

  const cleaned = dedupePromptComposerTags(tags)
  const prompt = formatPromptText(cleaned.join(', ')).prompt
  const hints = buildComposerHints(source, cleaned)

  return {
    prompt,
    tags: cleaned,
    changed: prompt !== formatPromptText(source).prompt,
    translatedCount,
    dictionaryCount,
    libraryCount,
    preservedCount,
    cacheHit,
    warnings: [...warnings, ...hints.warnings],
    positiveSuggestions: hints.positiveSuggestions,
    negativeSuggestions: hints.negativeSuggestions
  }
}

export async function composePromptSlots(input: PromptComposerSlotInput): Promise<PromptComposerSlotResult> {
  const promptStyle = normalizePromptStyle(input.promptStyle)
  const negativeStrategy = normalizeNegativeStrategy(input.negativeStrategy)
  const positiveSlotOrder = normalizePositiveSlotOrder(input.positiveSlotOrder)
  const warnings = new Set<string>()
  const positiveBySlot = new Map<PromptComposerPositiveSlotKey, string[]>()
  const positiveTags: string[] = []

  for (const key of positiveSlotOrder) {
    const source = input.slots[key]?.trim()
    if (!source) continue
    const result = await composePromptInput({
      text: source,
      target: 'positive',
      library: input.library,
      translateSegments: input.translateSegments
    })
    result.warnings.forEach((warning) => warnings.add(`${key}:${warning}`))
    positiveBySlot.set(key, result.tags)
    positiveTags.push(...result.tags)
  }

  const avoidSource = input.slots.avoidFailures?.trim() ?? ''
  const avoidResult = avoidSource
    ? await composePromptInput({
      text: avoidSource,
      target: 'negative',
      library: input.library,
      translateSegments: input.translateSegments
    })
    : emptyPromptComposerResult('')
  avoidResult.warnings.forEach((warning) => warnings.add(`avoidFailures:${warning}`))

  const replacements = buildPositiveReplacements(avoidSource)
  const negativeTags = buildNegativeSlotTags(avoidResult.tags, avoidResult.negativeSuggestions, replacements, negativeStrategy)
  const positiveReplacements = negativeStrategy === 'positive-replacement' ? replacements.flatMap((rule) => rule.positive) : []
  const allPositiveTags = dedupePromptComposerTags([...positiveTags, ...positiveReplacements])
  const positivePrompt = formatSlotPositivePrompt(promptStyle, positiveSlotOrder, positiveBySlot, positiveReplacements)
  const negativePrompt = formatPromptText(negativeTags.join(', ')).prompt

  return {
    positivePrompt,
    negativePrompt,
    positiveTags: allPositiveTags,
    negativeTags,
    positiveReplacements: dedupePromptComposerTags(positiveReplacements),
    promptStyle,
    negativeStrategy,
    changed: Boolean(positivePrompt || negativePrompt),
    warnings: [...warnings]
  }
}

export function parsePromptComposerTags(value: string): string[] {
  return dedupePromptComposerTags(
    splitPromptComposerSegments(value).map((segment) => segment.text)
  )
}

export function hasPromptComposerSlotInput(slots: PromptComposerSlots): boolean {
  return Object.values(slots).some((value) => Boolean(value?.trim()))
}

export function splitPromptComposerSegments(value: string): ComposerSegment[] {
  const segments: ComposerSegment[] = []
  let depthParen = 0
  let depthSquare = 0
  let depthBrace = 0
  let depthAngle = 0
  let current = ''

  const flush = (): void => {
    const raw = current.trim()
    current = ''
    if (!raw) return
    const normalized = stripSentenceMarks(raw)
    if (!normalized) return
    segments.push({
      text: normalized,
      protectedSyntax: isProtectedPromptSyntax(normalized)
    })
  }

  for (const char of value.replace(/\r\n/g, '\n')) {
    if (char === '(') depthParen += 1
    if (char === ')' && depthParen > 0) depthParen -= 1
    if (char === '[') depthSquare += 1
    if (char === ']' && depthSquare > 0) depthSquare -= 1
    if (char === '{') depthBrace += 1
    if (char === '}' && depthBrace > 0) depthBrace -= 1
    if (char === '<') depthAngle += 1
    if (char === '>' && depthAngle > 0) depthAngle -= 1

    const topLevel = depthParen === 0 && depthSquare === 0 && depthBrace === 0 && depthAngle === 0
    if (topLevel && /[,，、。；;\n]/u.test(char)) {
      flush()
    } else {
      current += char
    }
  }
  flush()

  return segments
}

function emptyPromptComposerResult(source: string): PromptComposerResult {
  return {
    prompt: source,
    tags: [],
    changed: false,
    translatedCount: 0,
    dictionaryCount: 0,
    libraryCount: 0,
    preservedCount: 0,
    cacheHit: false,
    warnings: [],
    positiveSuggestions: [],
    negativeSuggestions: []
  }
}

function dictionaryLookup(value: string): string[] {
  const direct = PROMPT_TRANSLATION_DICTIONARY[normalizeLookupText(value)]
  return direct ? [...direct] : []
}

function findLibraryTag(value: string, library: PromptCategory[]): PromptGroupTag | null {
  const key = normalizeLookupText(value)
  if (!key) return null
  for (const category of library) {
    for (const group of category.groups) {
      for (const tag of group.tags) {
        if (normalizeLookupText(tag.en) === key || normalizeLookupText(tag.ja ?? '') === key) {
          return tag
        }
      }
    }
  }
  return null
}

function addTag(tags: string[], value: string): void {
  const normalized = normalizePromptComposerTag(value)
  if (normalized) tags.push(normalized)
}

function dedupePromptComposerTags(values: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = normalizePromptComposerTag(value)
    const key = cleanPromptTokenForMatch(normalized).replace(/[_\s]+/g, ' ').toLowerCase()
    if (!normalized || !key || seen.has(key)) continue
    seen.add(key)
    out.push(normalized)
  }
  return out
}

function normalizePromptComposerTag(value: string): string {
  let text = stripSentenceMarks(value)
    .replace(/[，、；;]/gu, ',')
    .replace(/\s+/g, ' ')
    .trim()
  text = text.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim()
  if (!text) return ''
  if (isProtectedPromptSyntax(text)) return text
  text = text.replace(/^(a|an|the)\s+/i, '').trim()
  if (ASCII_WORD.test(text) && !JAPANESE_TEXT.test(text)) {
    text = text.toLowerCase()
  }
  return text
}

function stripSentenceMarks(value: string): string {
  return value.trim().replace(TERMINAL_SENTENCE_MARKS, '').trim()
}

function isProtectedPromptSyntax(value: string): boolean {
  const text = value.trim()
  return text === 'BREAK' ||
    /^<[^>\n]+>$/.test(text) ||
    /^\([^()\n]+:[0-9.]+\)$/.test(text) ||
    /^\[[^\[\]\n]+\]$/.test(text) ||
    /^\{[^{}\n]+\}$/.test(text)
}

function normalizeLookupText(value: string): string {
  return stripSentenceMarks(value)
    .toLowerCase()
    .replace(/[！!？?]/g, ' ')
    .replace(/[・]/g, ' ')
    .replace(/[_\s]+/g, ' ')
    .trim()
}

function buildComposerHints(source: string, tags: string[]): {
  positiveSuggestions: string[]
  negativeSuggestions: string[]
  warnings: string[]
} {
  const normalized = normalizeLookupText(source)
  const existing = new Set(tags.map((tag) => normalizeLookupText(cleanPromptTokenForMatch(tag))))
  const positiveSuggestions = new Set<string>()
  const negativeSuggestions = new Set<string>()
  const warnings = new Set<string>()

  if (!existing.has('masterpiece') && /高品質|最高品質|傑作|quality|masterpiece/.test(normalized)) {
    positiveSuggestions.add('masterpiece')
  }
  if (!existing.has('best quality') && /高品質|最高品質|quality/.test(normalized)) {
    positiveSuggestions.add('best quality')
  }

  for (const rule of NEGATIVE_HINT_RULES) {
    if (!rule.needles.some((needle) => normalized.includes(normalizeLookupText(needle)))) continue
    rule.tags.forEach((tag) => negativeSuggestions.add(tag))
    if (rule.warning) warnings.add(rule.warning)
  }

  return {
    positiveSuggestions: [...positiveSuggestions],
    negativeSuggestions: [...negativeSuggestions],
    warnings: [...warnings]
  }
}

function formatSlotPositivePrompt(
  promptStyle: CheckpointPromptStyle,
  positiveSlotOrder: PromptComposerPositiveSlotKey[],
  positiveBySlot: Map<PromptComposerPositiveSlotKey, string[]>,
  positiveReplacements: string[]
): string {
  if (promptStyle === 'natural' || promptStyle === 'structured') {
    const parts: string[] = []
    for (const key of positiveSlotOrder) {
      const tags = dedupePromptComposerTags(positiveBySlot.get(key) ?? [])
      if (tags.length === 0) continue
      const text = tags.join(', ')
      parts.push(promptStyle === 'structured' ? `${SLOT_LABELS[key]}: ${text}` : text)
    }
    if (positiveReplacements.length > 0) {
      const text = dedupePromptComposerTags(positiveReplacements).join(', ')
      parts.push(promptStyle === 'structured' ? `Stability: ${text}` : text)
    }
    return parts.join(promptStyle === 'structured' ? '; ' : ', ')
  }
  const tags = dedupePromptComposerTags([
    ...positiveSlotOrder.flatMap((key) => positiveBySlot.get(key) ?? []),
    ...positiveReplacements
  ])
  return formatPromptText(tags.join(', ')).prompt
}

function buildNegativeSlotTags(
  avoidTags: string[],
  hintedTags: string[],
  replacements: Array<{ positive: string[]; negative: string[] }>,
  strategy: CheckpointNegativeStrategy
): string[] {
  const replacementNegative = replacements.flatMap((rule) => rule.negative)
  const base = strategy === 'positive-replacement'
    ? [...avoidTags, ...replacementNegative]
    : [...avoidTags, ...hintedTags, ...replacementNegative]
  const deduped = dedupePromptComposerTags(base)
  if (strategy === 'minimal' || strategy === 'positive-replacement') return deduped.slice(0, 10)
  return deduped
}

function buildPositiveReplacements(source: string): Array<{ positive: string[]; negative: string[] }> {
  const normalized = normalizeLookupText(source)
  if (!normalized) return []
  return POSITIVE_REPLACEMENT_RULES.filter((rule) =>
    rule.needles.some((needle) => normalized.includes(normalizeLookupText(needle)))
  ).map((rule) => ({ positive: [...rule.positive], negative: [...rule.negative] }))
}

function normalizePromptStyle(value: CheckpointPromptStyle | undefined): CheckpointPromptStyle {
  return value === 'tag' || value === 'natural' || value === 'structured' || value === 'hybrid' ? value : 'tag'
}

function normalizeNegativeStrategy(value: CheckpointNegativeStrategy | undefined): CheckpointNegativeStrategy {
  return value === 'classic' || value === 'minimal' || value === 'positive-replacement' ? value : 'classic'
}

function normalizePositiveSlotOrder(
  value: PromptComposerPositiveSlotKey[] | undefined
): PromptComposerPositiveSlotKey[] {
  if (!value || value.length === 0) return [...PROMPT_COMPOSER_POSITIVE_SLOT_KEYS]
  const allowed = new Set<PromptComposerPositiveSlotKey>(PROMPT_COMPOSER_POSITIVE_SLOT_KEYS)
  const out: PromptComposerPositiveSlotKey[] = []
  for (const key of value) {
    if (!allowed.has(key) || out.includes(key)) continue
    out.push(key)
  }
  for (const key of PROMPT_COMPOSER_POSITIVE_SLOT_KEYS) {
    if (!out.includes(key)) out.push(key)
  }
  return out
}
