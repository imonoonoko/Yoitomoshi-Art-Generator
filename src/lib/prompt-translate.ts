import type { PromptCategory, PromptGroupTag } from '@shared/types'

interface PhraseRule {
  needles: string[]
  tags: string[]
}

const PHRASE_RULES: PhraseRule[] = [
  { needles: ['女の子', '少女', '女性', '女', 'girl', 'woman'], tags: ['1girl'] },
  { needles: ['男の子', '少年', '男性', '男', 'boy', 'man'], tags: ['1boy'] },
  { needles: ['複数', '二人', '2人', 'ふたり', 'group'], tags: ['multiple people'] },
  { needles: ['全身', '全体', 'full body'], tags: ['full body'] },
  { needles: ['上半身', 'バストアップ', 'portrait', 'ポートレート'], tags: ['upper body', 'portrait'] },
  { needles: ['顔', '目', '瞳', 'eyes'], tags: ['detailed face', 'beautiful eyes'] },
  { needles: ['笑顔', '微笑み', 'smile'], tags: ['smile'] },
  { needles: ['泣き', '涙', 'tears'], tags: ['tears'] },
  { needles: ['長髪', 'ロングヘア'], tags: ['long hair'] },
  { needles: ['短髪', 'ショートヘア'], tags: ['short hair'] },
  { needles: ['黒髪'], tags: ['black hair'] },
  { needles: ['白髪', '銀髪'], tags: ['white hair'] },
  { needles: ['金髪'], tags: ['blonde hair'] },
  { needles: ['青髪'], tags: ['blue hair'] },
  { needles: ['赤髪'], tags: ['red hair'] },
  { needles: ['着物', '和服'], tags: ['kimono', 'japanese clothes'] },
  { needles: ['制服', '学校'], tags: ['school uniform'] },
  { needles: ['ドレス'], tags: ['dress'] },
  { needles: ['鎧', 'アーマー'], tags: ['armor'] },
  { needles: ['夜', 'night'], tags: ['night'] },
  { needles: ['夕方', '夕焼け', '夕日', 'sunset'], tags: ['sunset', 'warm light'] },
  { needles: ['朝', '朝日'], tags: ['morning light'] },
  { needles: ['月', '月明かり'], tags: ['moonlight'] },
  { needles: ['逆光'], tags: ['backlighting'] },
  { needles: ['柔らかい光', '柔らかい照明', 'soft light'], tags: ['soft lighting'] },
  { needles: ['映画', 'シネマ', 'cinematic'], tags: ['cinematic lighting'] },
  { needles: ['和風', '日本風'], tags: ['japanese style'] },
  { needles: ['ファンタジー', '幻想'], tags: ['fantasy', 'magical atmosphere'] },
  { needles: ['サイバーパンク'], tags: ['cyberpunk', 'neon lights'] },
  { needles: ['水彩'], tags: ['watercolor'] },
  { needles: ['油絵'], tags: ['oil painting'] },
  { needles: ['アニメ', '二次元'], tags: ['anime style', 'cel shading'] },
  { needles: ['実写', '写真'], tags: ['photorealistic', 'raw photo'] },
  { needles: ['線画', 'ラフ'], tags: ['lineart', 'clean line'] },
  { needles: ['背景', '風景'], tags: ['scenery', 'detailed background'] },
  { needles: ['森'], tags: ['forest'] },
  { needles: ['海'], tags: ['ocean'] },
  { needles: ['空'], tags: ['sky'] },
  { needles: ['街', '都市'], tags: ['cityscape'] },
  { needles: ['部屋', '室内'], tags: ['indoors'] },
  { needles: ['桜'], tags: ['cherry blossoms'] },
  { needles: ['雨'], tags: ['rain'] },
  { needles: ['雪'], tags: ['snow'] },
  { needles: ['炎', '火'], tags: ['fire'] },
  { needles: ['水', '水面'], tags: ['water'] },
  { needles: ['メカ', '機械', 'ロボット'], tags: ['mecha', 'mechanical parts'] },
  { needles: ['かわいい', '可愛い'], tags: ['cute'] },
  { needles: ['美しい', '綺麗', 'きれい'], tags: ['beautiful'] },
  { needles: ['高品質', '細かい', '精細'], tags: ['highly detailed'] }
]

const ASCII_TAG_PATTERN = /^[a-zA-Z0-9_ .:+()'-]+$/

export function translatePromptToEnglishTags(
  raw: string,
  library: PromptCategory[],
  limit = 28
): string[] {
  const text = raw.trim()
  if (!text) return []

  const normalized = normalizeText(text)
  const tags = new Set<string>()

  for (const segment of splitPromptSegments(text)) {
    const cleaned = normalizeEnglishTag(segment)
    if (cleaned) tags.add(cleaned)
  }

  for (const rule of PHRASE_RULES) {
    if (rule.needles.some((needle) => normalized.includes(normalizeText(needle)))) {
      rule.tags.forEach((tag) => tags.add(tag))
    }
  }

  for (const tag of findLibraryTags(normalized, library)) {
    tags.add(tag.en)
    if (tags.size >= limit) break
  }

  return Array.from(tags).slice(0, limit)
}

function splitPromptSegments(text: string): string[] {
  return text
    .split(/[,、。;\n\r]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeEnglishTag(segment: string): string | null {
  const cleaned = segment.trim().replace(/\s+/g, ' ')
  if (!cleaned || !ASCII_TAG_PATTERN.test(cleaned) || !/[a-zA-Z]/.test(cleaned)) return null
  return cleaned
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[！!？?]/g, ' ')
    .replace(/[・]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function findLibraryTags(text: string, library: PromptCategory[]): PromptGroupTag[] {
  const out: PromptGroupTag[] = []
  const seen = new Set<string>()
  for (const category of library) {
    for (const group of category.groups) {
      for (const tag of group.tags) {
        if (seen.has(tag.en)) continue
        const en = normalizeText(tag.en)
        const ja = normalizeText(tag.ja ?? '')
        if ((en.length >= 3 && text.includes(en)) || (ja.length >= 2 && text.includes(ja))) {
          out.push(tag)
          seen.add(tag.en)
          if (out.length >= 12) return out
        }
      }
    }
  }
  return out
}
