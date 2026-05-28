const GENERIC_MEANING_PATTERNS = [
  /日本語訳はレビュー待ち/,
  /を表す生成用タグ候補/,
  /ローカル履歴\/ユーザー辞書から抽出/,
  /Civitai.*抽出/,
  /^$/
]

const FULL_LABELS = {
  newest: '新しい順',
  sketch: 'スケッチ',
  worst_detail: '最低の細部',
  good_quality: '良品質',
  high_quality: '高品質',
  best_quality: '最高品質',
  amazing_quality: '非常に高品質',
  very_aesthetic: '美麗',
  highly_detailed: '非常に細密',
  hyper_detailed: '超細密',
  very_detailed: '非常に詳細',
  high_resolution: '高解像度',
  'high-resolution': '高解像度',
  lowres: '低解像度',
  jpeg_artifacts: 'JPEGノイズ',
  compression_artifacts: '圧縮ノイズ',
  ugly: '醜い',
  displeasing: '不快な見た目',
  artistic_error: '作画ミス',
  bad_feet: '崩れた足',
  bad_proportions: '悪い比率',
  deformed_anatomy: '崩れた解剖',
  deformed_eyes: '崩れた目',
  deformed_face: '崩れた顔',
  deformed_limbs: '崩れた手足',
  distorted: '歪み',
  distorted_hands: '歪んだ手',
  duplicate_limbs: '重複した手足',
  asymmetry: '左右非対称',
  background_visible: '背景が見えている',
  artist_name: '作家名',
  'artist_name:2': '作家名の強調',
  'artist_signature:2': '作家署名の強調',
  censorship: '検閲表現',
  censored: '検閲済み',
  censor: '検閲',
  bar_censor: '棒状の検閲',
  '3d': '3D',
  dslr: '一眼レフ風',
  '35mm_film': '35mmフィルム',
  sepia: 'セピア',
  focused_subject: '主題にピント',
  furry: 'ファーリー',
  anime: 'アニメ',
  anime_style: 'アニメ調',
  cartoon_style: 'カートゥーン調',
  ambient_occlusion: '環境遮蔽',
  award_winning: '受賞作風',
  brush_strokes: '筆致',
  cross_hatching: 'クロスハッチング',
  'cross-hatching': 'クロスハッチング',
  chiarusco: 'キアロスクーロ',
  bokeh_effects: 'ボケ効果',
  bokeh_photography: 'ボケ写真',
  cinematic_composition: '映画的な構図',
  cinematic_lighting: '映画的な照明',
  centered_composition: '中央構図',
  clear_composition: '明瞭な構図',
  casting_dynamic_shadows: '動的な影を落とす',
  dappled_light: '木漏れ日の光',
  dark_background: '暗い背景',
  dark_lighting: '暗い照明',
  dim_light: '薄暗い光',
  cloud: '雲',
  distant_mountains_under_golden_sunset: '金色の夕焼け下の遠い山々',
  deep_blues: '深い青',
  electric_pinks: '鮮やかなピンク',
  and_neon_lit_gadgets: 'ネオンに照らされた小物',
  'and_neon-lit_gadgets': 'ネオンに照らされた小物',
  a_classical_oil_painting: '古典的な油彩画',
  a_masterpiece: '傑作',
  adult_woman: '成人女性',
  aka_oni: '赤鬼',
  'aka-oni': '赤鬼',
  black_horns: '黒い角',
  black_mask: '黒いマスク',
  black_sclera: '黒い白目',
  colored_sclera: '色付きの白目',
  colored_skin: '色付きの肌',
  demon_girl: '悪魔の女の子',
  demon_horns: '悪魔の角',
  bodybuilder: 'ボディビルダー',
  bulky: 'かさばった体型',
  chunky: 'ずんぐりした体型',
  big_girl: '大柄な女の子',
  big_ass: '大きなお尻',
  abs: '腹筋',
  beautiful: '美しい',
  cute: 'かわいい',
  elegant: '上品',
  ethereal: '幻想的',
  ethereal_light: '幻想的な光',
  datamoshing: 'データモッシュ',
  break: 'BREAK区切り',
  cyberpunk_breastplate: 'サイバーパンク風胸当て',
  childs_body: '子供の体型',
  childs_face: '子供の顔',
  cinematic_angle: '映画的なアングル',
  covered_face: '顔が隠れている',
  fluffy_pajamas: 'ふわふわのパジャマ',
  futon: '布団',
  hair_over_face: '髪で顔が隠れている',
  pillow_grab: '枕をつかんでいる',
  white_pajamas: '白いパジャマ'
}

const PART_LABELS = {
  a: '',
  an: '',
  and: '',
  the: '',
  of: 'の',
  in: '中の',
  on: '上の',
  under: '下の',
  by: 'による',
  with: 'あり',
  no: 'なし',
  newest: '新しい',
  score: 'Score',
  up: '以上',
  very: '非常に',
  ultra: '超',
  hyper: '超',
  highly: '非常に',
  high: '高い',
  low: '低い',
  worst: '最低',
  best: '最高',
  good: '良い',
  bad: '悪い',
  amazing: '非常に良い',
  quality: '品質',
  aesthetic: '美麗',
  detailed: '詳細',
  detail: '細部',
  detailer: 'ディテール',
  resolution: '解像度',
  res: '解像度',
  focus: 'ピント',
  focused: 'ピントの合った',
  subject: '主題',
  masterpiece: '傑作',
  sketch: 'スケッチ',
  lineart: '線画',
  coloring: '塗り',
  anime: 'アニメ',
  cartoon: 'カートゥーン',
  style: '調',
  realistic: 'リアル',
  photo: '写真',
  photography: '写真',
  film: 'フィルム',
  oil: '油彩',
  painting: '絵画',
  classical: '古典的な',
  brush: '筆',
  strokes: 'タッチ',
  hatching: 'ハッチング',
  bokeh: 'ボケ',
  effects: '効果',
  ambient: '環境',
  occlusion: '遮蔽',
  cinematic: '映画的な',
  composition: '構図',
  centered: '中央',
  clear: '明瞭な',
  dynamic: '動的な',
  shadows: '影',
  shadow: '影',
  casting: '落とす',
  lighting: '照明',
  light: '光',
  lit: '照らされた',
  neon: 'ネオン',
  dappled: 'まだらの',
  dark: '暗い',
  dim: '薄暗い',
  golden: '金色の',
  sunset: '夕焼け',
  background: '背景',
  visible: '見える',
  mountains: '山々',
  mountain: '山',
  distant: '遠い',
  cloud: '雲',
  clouds: '雲',
  sky: '空',
  forest: '森',
  street: '通り',
  room: '部屋',
  fluffy: 'ふわふわの',
  pajamas: 'パジャマ',
  futon: '布団',
  pillow: '枕',
  grab: 'つかむ',
  woman: '女性',
  girl: '女の子',
  boy: '男の子',
  adult: '成人',
  beautiful: '美しい',
  cute: 'かわいい',
  elegant: '上品な',
  ethereal: '幻想的な',
  demon: '悪魔',
  oni: '鬼',
  horns: '角',
  horn: '角',
  mask: 'マスク',
  sclera: '白目',
  skin: '肌',
  colored: '色付きの',
  covered: '隠れた',
  black: '黒い',
  white: '白い',
  blue: '青い',
  blues: '青',
  red: '赤い',
  pink: 'ピンク',
  pinks: 'ピンク',
  green: '緑',
  yellow: '黄色',
  purple: '紫',
  brown: '茶色',
  hair: '髪',
  over: 'かかった',
  eyes: '目',
  eye: '目',
  face: '顔',
  body: '体',
  anatomy: '解剖',
  limbs: '手足',
  limb: '手足',
  hands: '手',
  hand: '手',
  fingers: '指',
  finger: '指',
  feet: '足',
  foot: '足',
  abs: '腹筋',
  ass: 'お尻',
  proportions: '比率',
  deformed: '崩れた',
  distorted: '歪んだ',
  duplicate: '重複した',
  asymmetry: '左右非対称',
  ugly: '醜い',
  displeasing: '不快な',
  artistic: '作画',
  error: 'ミス',
  jpeg: 'JPEG',
  artifacts: 'ノイズ',
  compression: '圧縮',
  censorship: '検閲',
  censored: '検閲済み',
  censor: '検閲',
  bar: '棒状',
  artist: '作家',
  name: '名前',
  signature: '署名',
  furry: 'ファーリー',
  gadgets: '小物',
  gadget: '小物',
  cyberpunk: 'サイバーパンク',
  breastplate: '胸当て',
  bodybuilder: 'ボディビルダー',
  bulky: 'かさばった',
  chunky: 'ずんぐりした',
  child: '子供',
  childs: '子供の',
  datamoshing: 'データモッシュ',
  break: 'BREAK',
  newest: '新しい順'
}

function curatePromptDictionaryJapanese(tag, options = {}) {
  const originalJa = cleanString(options.ja)
  const originalMeaning = cleanString(options.meaning)
  const normalized = normalizeTag(tag)
  const generatedJa = draftJapaneseLabel(normalized, tag)
  const shouldFillJa = shouldReplaceLabel(originalJa, normalized)
  const ja = shouldFillJa ? generatedJa : originalJa
  const meaning = shouldReplaceMeaning(originalMeaning, tag)
    ? draftJapaneseMeaning(tag, ja, options)
    : originalMeaning
  const changed = ja !== originalJa || meaning !== originalMeaning
  return {
    ja,
    meaning,
    changed,
    status: changed && options.status !== 'curated' ? 'machine-draft' : cleanString(options.status || 'source-derived'),
    provider: changed ? 'yoitomoshi-codex-ja-curation-v1' : cleanString(options.provider || '')
  }
}

function draftJapaneseLabel(normalized, originalTag = normalized) {
  if (!normalized) return cleanString(originalTag)
  if (FULL_LABELS[normalized]) return FULL_LABELS[normalized]
  const score = normalized.match(/^score_(\d+)(?:_up)?$/)
  if (score) return normalized.endsWith('_up') ? `Score ${score[1]}以上` : `Score ${score[1]}`
  const resolution = normalized.match(/^(\d+)k$/)
  if (resolution) return `${resolution[1]}K`
  const film = normalized.match(/^(\d+)mm_film$/)
  if (film) return `${film[1]}mmフィルム`
  if (normalized.startsWith('@')) return `作家: ${humanizeEnglish(normalized.slice(1))}`

  const stripped = normalized
    .replace(/^a_/, '')
    .replace(/^an_/, '')
    .replace(/^and_/, '')
  if (FULL_LABELS[stripped]) return FULL_LABELS[stripped]

  const parts = stripped.split(/[_\s-]+/).filter(Boolean)
  if (parts.length > 0 && parts.length <= 7) {
    const translated = parts.map((part) => PART_LABELS[part] ?? '')
    if (translated.every((part) => part !== '')) return compactJapaneseParts(translated)
    const knownCount = translated.filter(Boolean).length
    if (knownCount >= Math.max(1, Math.ceil(parts.length * 0.65))) {
      return compactJapaneseParts(parts.map((part, index) => translated[index] || humanizeEnglish(part)))
    }
  }

  return `${humanizeEnglish(stripped)}`
}

function draftJapaneseMeaning(tag, ja, options = {}) {
  const label = ja || humanizeEnglish(tag)
  const polarity = cleanString(options.polarity)
  const category = cleanString(options.category)
  const group = cleanString(options.group)
  if (polarity === 'negative' || category.includes('失敗防止') || group.includes('ネガティブ')) {
    return `${label}を避けるためのネガティブプロンプト。Codex自動補正によるドラフト。`
  }
  if (category.includes('品質') || group.includes('品質')) {
    return `${label}の品質・評価傾向を指定する生成用タグ。Codex自動補正によるドラフト。`
  }
  if (category.includes('画面') || group.includes('光') || group.includes('背景')) {
    return `${label}の画面表現を指定する生成用タグ。Codex自動補正によるドラフト。`
  }
  if (category.includes('人物') || group.includes('顔') || group.includes('体')) {
    return `${label}の人物表現を指定する生成用タグ。Codex自動補正によるドラフト。`
  }
  return `${label}を表す生成用タグ。Codex自動補正によるドラフト。`
}

function shouldReplaceLabel(ja, normalizedTag) {
  if (!ja) return true
  const normalizedJa = normalizeTag(ja)
  if (normalizedJa === normalizedTag) return true
  return !/[ぁ-んァ-ヶ一-龠]/.test(ja) && !/^(?:\d+k|score\s*\d|EasyNegativeV?\d*)$/i.test(ja)
}

function shouldReplaceMeaning(meaning, tag) {
  if (!meaning) return true
  if (meaning.trim() === tag.trim()) return true
  return GENERIC_MEANING_PATTERNS.some((pattern) => pattern.test(meaning))
}

function normalizeTag(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/\s*\/\s*/g, '_')
    .replace(/\s+/g, '_')
    .replace(/__+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function humanizeEnglish(value) {
  return cleanString(value)
    .replace(/^@+/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function compactJapaneseParts(parts) {
  return parts
    .filter((part) => part !== '')
    .join('')
    .replace(/のの/g, 'の')
    .replace(/あり$/, 'あり')
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
}

module.exports = {
  curatePromptDictionaryJapanese,
  draftJapaneseLabel,
  draftJapaneseMeaning,
  shouldReplaceLabel,
  shouldReplaceMeaning
}
