import { AlertTriangle, Plus, Sparkles, Wand2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useStore } from '@/lib/store'
import { promptAppend } from '@/lib/prompt-utils'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { PromptCategory, PromptGroupTag } from '@shared/types'

interface HelperResult {
  positive: string[]
  negative: string[]
  warnings: string[]
}

const BASE_QUALITY = ['masterpiece', 'best quality', 'highly detailed']
const BASE_NEGATIVE = ['lowres', 'bad anatomy', 'bad hands', 'text', 'watermark', 'blurry']

const POSITIVE_RULES: { needles: string[]; tags: string[] }[] = [
  { needles: ['女の子', '少女', '女性', 'girl', 'woman'], tags: ['1girl'] },
  { needles: ['男の子', '少年', '男性', 'boy', 'man'], tags: ['1boy'] },
  { needles: ['アニメ', 'anime', '二次元'], tags: ['anime style', 'cel shading'] },
  { needles: ['実写', '写真', 'photo', 'realistic'], tags: ['photorealistic', 'raw photo'] },
  { needles: ['ポートレート', 'portrait', '顔'], tags: ['portrait', 'detailed face', 'beautiful eyes'] },
  { needles: ['全身', 'full body'], tags: ['full body'] },
  { needles: ['夜', 'night'], tags: ['night', 'cinematic lighting'] },
  { needles: ['夕方', '夕焼け', 'sunset'], tags: ['sunset', 'warm light'] },
  { needles: ['和風', '着物', 'kimono'], tags: ['kimono', 'japanese clothes'] },
  { needles: ['メカ', '機械', 'robot', 'mecha'], tags: ['mecha', 'mechanical parts'] },
  { needles: ['ファンタジー', 'fantasy'], tags: ['fantasy', 'magical atmosphere'] },
  { needles: ['水彩', 'watercolor'], tags: ['watercolor'] },
  { needles: ['線画', 'lineart'], tags: ['lineart', 'clean line'] },
  { needles: ['背景', '風景', 'landscape'], tags: ['scenery', 'detailed background'] }
]

const NEGATIVE_RULES: { needles: string[]; tags: string[] }[] = [
  { needles: ['手', '指', 'hand', 'finger'], tags: ['bad hands', 'missing fingers', 'extra fingers'] },
  { needles: ['顔', '目', 'face', 'eyes'], tags: ['deformed face', 'bad eyes', 'asymmetric face'] },
  { needles: ['文字', 'ロゴ', 'text', 'logo'], tags: ['text', 'logo', 'signature'] },
  { needles: ['実写', '写真', 'photo'], tags: ['cartoon', 'anime'] },
  { needles: ['アニメ', 'anime'], tags: ['photorealistic', 'realistic'] }
]

const WARNING_RULES: { needles: string[]; warningKey: string }[] = [
  { needles: ['衣装', '服', '着物', 'uniform', 'costume'], warningKey: 'promptHelper.warning.clothingLora' },
  { needles: ['同じキャラ', '再現', '固定', 'same character'], warningKey: 'promptHelper.warning.seed' },
  { needles: ['ポーズ', 'pose', '構図'], warningKey: 'promptHelper.warning.controlnet' }
]

export function PromptHelperPanel(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [description, setDescription] = useState('')
  const prompt = useStore((s) => s.prompt)
  const negative = useStore((s) => s.negativePrompt)
  const setPrompt = useStore((s) => s.setPrompt)
  const setNegative = useStore((s) => s.setNegativePrompt)
  const library = useStore((s) => s.library)
  const customLibrary = useStore((s) => s.customLibrary)
  const t = useT()

  const result = useMemo(
    () => analyzeDescription(description, [...library, ...customLibrary], t),
    [description, library, customLibrary, t]
  )
  const hasResult = result.positive.length > 0 || result.negative.length > 0 || result.warnings.length > 0

  function applyPositive(tags: string[]): void {
    let next = prompt
    for (const tag of tags) next = promptAppend(next, tag)
    setPrompt(next)
  }

  function applyNegative(tags: string[]): void {
    let next = negative
    for (const tag of tags) next = promptAppend(next, tag)
    setNegative(next)
  }

  return (
    <section className="border border-line rounded-md bg-bg-0/60">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-2 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <Sparkles className="h-4 w-4 text-accent" />
        <span className="text-xs font-medium text-ink-1">{t('promptHelper.title')}</span>
        <span className="ml-auto text-[10px] text-ink-3">{open ? t('common.close') : t('common.enable')}</span>
      </button>
      {open && (
        <div className="border-t border-line p-3 space-y-2">
          <textarea
            className="input min-h-[64px] resize-y text-xs"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('promptHelper.placeholder')}
          />
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              className="btn btn-primary text-xs py-1.5 gap-1.5"
              disabled={!result.positive.length}
              onClick={() => applyPositive(result.positive)}
            >
              <Wand2 className="h-3.5 w-3.5" />
              {t('promptHelper.applyPositive')}
            </button>
            <button
              type="button"
              className="btn text-xs py-1.5 gap-1.5"
              disabled={!result.negative.length}
              onClick={() => applyNegative(result.negative)}
            >
              <X className="h-3.5 w-3.5" />
              {t('promptHelper.applyNegative')}
            </button>
          </div>
          {hasResult ? (
            <div className="space-y-2">
              <TagRow
                label={t('promptHelper.positive')}
                tags={result.positive}
                onClick={(tag) => applyPositive([tag])}
              />
              <TagRow
                label={t('promptHelper.negative')}
                tags={result.negative}
                tone="negative"
                onClick={(tag) => applyNegative([tag])}
              />
              {result.warnings.length > 0 && (
                <div className="space-y-1">
                  {result.warnings.map((warning) => (
                    <div key={warning} className="flex items-start gap-1.5 text-[11px] text-warn">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>{warning}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="text-[11px] text-ink-3">{t('promptHelper.empty')}</div>
          )}
        </div>
      )}
    </section>
  )
}

function TagRow({
  label,
  tags,
  tone,
  onClick
}: {
  label: string
  tags: string[]
  tone?: 'negative'
  onClick(tag: string): void
}): JSX.Element | null {
  if (!tags.length) return null
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wide text-ink-3">{label}</div>
      <div className="flex flex-wrap gap-1">
        {tags.map((tag) => (
          <button
            key={tag}
            type="button"
            className={cn(
              'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] transition-colors',
              tone === 'negative'
                ? 'border-danger/40 text-danger hover:bg-danger/10'
                : 'border-line text-ink-1 hover:bg-bg-3'
            )}
            onClick={() => onClick(tag)}
          >
            <Plus className="h-3 w-3" />
            {tag}
          </button>
        ))}
      </div>
    </div>
  )
}

function analyzeDescription(
  raw: string,
  library: PromptCategory[],
  t: (key: string) => string
): HelperResult {
  const text = raw.trim().toLowerCase()
  if (!text) return { positive: [], negative: [], warnings: [] }
  const positive = new Set(BASE_QUALITY)
  const negative = new Set(BASE_NEGATIVE)
  const warnings = new Set<string>()

  for (const rule of POSITIVE_RULES) {
    if (rule.needles.some((needle) => text.includes(needle.toLowerCase()))) {
      rule.tags.forEach((tag) => positive.add(tag))
    }
  }
  for (const rule of NEGATIVE_RULES) {
    if (rule.needles.some((needle) => text.includes(needle.toLowerCase()))) {
      rule.tags.forEach((tag) => negative.add(tag))
    }
  }
  for (const rule of WARNING_RULES) {
    if (rule.needles.some((needle) => text.includes(needle.toLowerCase()))) {
      warnings.add(t(rule.warningKey))
    }
  }
  findLibraryTags(text, library).forEach((tag) => positive.add(tag.en))

  return {
    positive: [...positive].slice(0, 18),
    negative: [...negative].slice(0, 14),
    warnings: [...warnings].slice(0, 4)
  }
}

function findLibraryTags(text: string, library: PromptCategory[]): PromptGroupTag[] {
  const out: PromptGroupTag[] = []
  const seen = new Set<string>()
  for (const category of library) {
    for (const group of category.groups) {
      for (const tag of group.tags) {
        if (seen.has(tag.en)) continue
        const en = tag.en.toLowerCase()
        const ja = (tag.ja ?? '').toLowerCase()
        if ((en.length >= 3 && text.includes(en)) || (ja.length >= 2 && text.includes(ja))) {
          out.push(tag)
          seen.add(tag.en)
          if (out.length >= 10) return out
        }
      }
    }
  }
  return out
}
