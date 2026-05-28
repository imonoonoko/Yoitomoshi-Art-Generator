const fs = require('node:fs')
const path = require('node:path')
const yaml = require('js-yaml')
const { DatabaseSync } = require('node:sqlite')
const { curatePromptDictionaryJapanese } = require('./prompt-dictionary-ja-curation.cjs')

const projectRoot = path.resolve(__dirname, '..')
const resourcesDir = path.join(projectRoot, 'resources')
const outputDir = path.join(resourcesDir, 'prompt-dictionary')
const dbPath = path.join(outputDir, 'prompt-dictionary.sqlite')
const manifestPath = path.join(outputDir, 'manifest.json')
const ingestDbPath = path.join(projectRoot, 'userdata', 'prompt-dictionary', 'ingest.sqlite')
const sourceRegistryPath = path.join(resourcesDir, 'prompt-dictionary', 'sources.json')
const localUserPromptSourceId = 'local-user-prompts'
const includeLocalUserPrompts = process.env.YOITOMOSHI_INCLUDE_LOCAL_PROMPT_DICTIONARY === '1'
const promotedCandidateSnapshotFiles = [
  path.join(resourcesDir, 'prompt-dictionary', 'promoted-candidates.civitai.json'),
  path.join(resourcesDir, 'prompt-dictionary', 'promoted-candidates.civitai-red-public-images.json'),
  path.join(resourcesDir, 'prompt-dictionary', 'promoted-candidates.danbooru-adult-tags.json'),
  path.join(resourcesDir, 'prompt-dictionary', 'promoted-candidates.danbooru-tag-metadata.json'),
  path.join(resourcesDir, 'prompt-dictionary', 'promoted-candidates.web.json')
]
if (includeLocalUserPrompts) {
  promotedCandidateSnapshotFiles.push(path.join(projectRoot, 'userdata', 'prompt-dictionary', 'promoted-candidates.local.json'))
}
let ingestManifestSources = []
const promotedSnapshotSourceIds = new Set()

const ingestNoiseTagPatterns = [
  /^yoitomoshi_/,
  /(^|_)(qa|smoke|regression|validation|preflight|fixture)(_|$)/,
  /(^|_)(dom_qa|qa_dom|test_case|test_fixture)(_|$)/,
  /(^|_)comfy_v2(_|$)/
]

const ingestAdultTagPatterns = [
  /(^|_)nsfw(_|$)/,
  /(^|_)nude(_|$)/,
  /(^|_)nudity(_|$)/,
  /(^|_)sex(_|$)/,
  /(^|_)erotic(_|$)/,
  /(^|_)ahegao(_|$)/,
  /(^|_)pussy(_|$)/,
  /(^|_)penis(_|$)/,
  /(^|_)vagina(_|$)/,
  /(^|_)anus(_|$)/,
  /(^|_)anal(_|$)/,
  /(^|_)nipple/,
  /(^|_)areola/,
  /(^|_)cum(_|$)/,
  /(^|_)ejaculation(_|$)/,
  /(^|_)blowjob(_|$)/,
  /(^|_)masturbation(_|$)/,
  /(^|_)sex_toy(_|$)/,
  /(^|_)dildo(_|$)/,
  /(^|_)vibrator(_|$)/,
  /(^|_)butt_plug(_|$)/,
  /(^|_)hitachi_magic_wand(_|$)/,
  /(^|_)panties(_|$)/,
  /(^|_)underwear(_|$)/,
  /(^|_)breasts?(_|$)/,
  /(^|_)ass(_|$)/,
  /(^|_)bdsm(_|$)/,
  /(^|_)orgasm(_|$)/,
  /(^|_)gagged(_|$)/,
  /(^|_)bound(_|$)/,
  /(^|_)restraints?(_|$)/,
  /(^|_)topless(_|$)/,
  /(^|_)underbutt(_|$)/,
  /(^|_)lingerie(_|$)/,
  /(^|_)object_insertion(_|$)/,
  /(^|_)clothing_aside(_|$)/,
  /(^|_)glory_wall(_|$)/,
  /(^|_)milking_machine(_|$)/,
  /(^|_)whale_tail(_|$)/
]

const yamlSources = [
  {
    file: 'prompt-library.ja.yaml',
    sourceId: 'prompt-library-ja',
    label: 'Prompt Library',
    priority: 10
  },
  {
    file: 'prompt-library.yoitomoshi.ja.yaml',
    sourceId: 'yoitomoshi-prompt-library',
    label: 'Yoitomoshi Prompt Library',
    priority: 20
  },
  {
    file: 'prompt-dictionary.yoitomoshi.ja.yaml',
    sourceId: 'yoitomoshi-prompt-daijiten-seed',
    label: 'Yoitomoshi Daijiten',
    priority: 30
  }
]

const queryExpansions = {
  '手': ['hand', 'hands', 'finger', 'fingers', 'wrist'],
  '指': ['finger', 'fingers'],
  '腕': ['arm', 'arms'],
  '髪': ['hair'],
  '目': ['eye', 'eyes'],
  '胸': ['breast', 'breasts', 'chest', 'cleavage'],
  'おっぱい': ['breast', 'breasts', 'cleavage'],
  '光': ['light', 'lighting', 'glow', 'backlit', 'rim light'],
  '座る': ['sitting', 'seated'],
  '立つ': ['standing'],
  '走る': ['running'],
  '笑顔': ['smile', 'smiling'],
  '着物': ['kimono', 'yukata']
}

main()

function main() {
  fs.mkdirSync(outputDir, { recursive: true })
  fs.rmSync(dbPath, { force: true })
  fs.rmSync(`${dbPath}-wal`, { force: true })
  fs.rmSync(`${dbPath}-shm`, { force: true })

  const entries = collectEntries()
  const db = new DatabaseSync(dbPath)
  try {
    createSchema(db)
    insertEntries(db, entries)
    db.exec('VACUUM')
  } finally {
    db.close()
  }

  const manifest = {
    schemaVersion: 1,
    builtAt: new Date().toISOString(),
    generator: 'scripts/build-prompt-dictionary-db.cjs',
    electron: process.versions.electron ?? null,
    node: process.versions.node,
    sqlite: process.versions.sqlite ?? null,
    entryCount: entries.length,
    sources: [
      ...yamlSources.map((source) => ({
        sourceId: source.sourceId,
        file: source.file,
        label: source.label,
        exists: fs.existsSync(path.join(resourcesDir, source.file))
      })),
      ...uniqueIngestManifestSources()
    ]
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  const verifyDb = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const count = verifyDb.prepare('SELECT COUNT(*) AS count FROM dictionary_entries').get().count
    const handRows = verifyDb.prepare(`
      SELECT e.tag
      FROM dictionary_entries e
      JOIN dictionary_fts f ON f.rowid = e.id
      WHERE dictionary_fts MATCH 'hand*'
      ORDER BY e.tag
      LIMIT 5
    `).all().map((row) => row.tag)
    console.log(JSON.stringify({
      dbPath,
      manifestPath,
      count,
      handRows,
      sqlite: process.versions.sqlite ?? null,
      node: process.versions.node,
      electron: process.versions.electron ?? null
    }, null, 2))
  } finally {
    verifyDb.close()
  }
}

function collectEntries() {
  const byTag = new Map()
  const sourceStats = new Map()

  for (const source of yamlSources) {
    const sourcePath = path.join(resourcesDir, source.file)
    if (!fs.existsSync(sourcePath)) continue
    const raw = fs.readFileSync(sourcePath, 'utf8')
    const parsed = yaml.load(raw)
    if (!Array.isArray(parsed)) continue
    sourceStats.set(source.sourceId, { categories: 0, tags: 0 })

    for (const category of parsed) {
      if (!category || typeof category.name !== 'string' || !Array.isArray(category.groups)) continue
      sourceStats.get(source.sourceId).categories += 1
      for (const group of category.groups) {
        if (!group || typeof group.name !== 'string' || !group.tags || typeof group.tags !== 'object') continue
        for (const [tag, jaValue] of Object.entries(group.tags)) {
          if (!tag || typeof tag !== 'string') continue
          const displayTag = tag.trim()
          const normalizedTag = normalizeTag(displayTag)
          if (!normalizedTag) continue
          const rawJa = jaValue == null ? '' : String(jaValue).trim()
          const polarity = inferPolarity(category.name, group.name, displayTag)
          const curatedJapanese = rawJa
            ? { ja: rawJa, meaning: rawJa, status: undefined, provider: undefined }
            : curatePromptDictionaryJapanese(displayTag, {
                ja: rawJa,
                meaning: '',
                category: category.name,
                group: group.name,
                polarity,
                status: 'machine-draft',
                sourceLabel: source.label
              })
          const ja = curatedJapanese.ja
          const key = displayTag.toLowerCase()
          const next = {
            tag: displayTag,
            normalizedTag,
            category: category.name.trim(),
            group: group.name.trim(),
            ja,
            jaMeaning: curatedJapanese.meaning || ja,
            polarity,
            sourceId: source.sourceId,
            sourceLabel: source.label,
            sourcePriority: source.priority,
            curationStatus: curatedJapanese.status,
            translationProvider: curatedJapanese.provider,
            aliases: new Map()
          }
          addAlias(next.aliases, next.category, 'ja', 'category', 6)
          addAlias(next.aliases, next.group, 'ja', 'group', 8)
          addQueryExpansionAliases(next)

          const previous = byTag.get(key)
          if (!previous) {
            byTag.set(key, next)
          } else {
            mergeEntry(previous, next)
          }
          sourceStats.get(source.sourceId).tags += 1
        }
      }
    }
  }

  collectPromotedCandidateSnapshotEntries(byTag)
  collectIngestCandidateEntries(byTag)

  return [...byTag.values()]
    .sort((a, b) => a.tag.localeCompare(b.tag))
    .map((entry, index) => ({
      ...entry,
      id: index + 1,
      aliases: [...entry.aliases.values()].sort((a, b) => b.weight - a.weight || a.alias.localeCompare(b.alias))
    }))
}

function collectPromotedCandidateSnapshotEntries(byTag) {
  for (const snapshotPath of promotedCandidateSnapshotFiles) {
    if (!fs.existsSync(snapshotPath)) continue
    const parsed = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))
    if (!Array.isArray(parsed.entries)) continue
    const sourceId = parsed.sourceId ?? 'local-user-prompts'
    const sourceLabel = parsed.sourceLabel ?? sourceId
    promotedSnapshotSourceIds.add(sourceId)
    ingestManifestSources.push({
      sourceId,
      file: path.relative(projectRoot, snapshotPath).replace(/\\/g, '/'),
      label: sourceLabel,
      exists: true,
      importedRecords: Number(parsed.rawPromptRecords ?? 0),
      promotedEntries: parsed.entries.length
    })
    for (const entry of parsed.entries) {
      addIngestCandidateEntry(byTag, {
        display_tag: entry.tag,
        canonical_tag: entry.canonicalTag ?? entry.tag,
        token_kind: entry.tokenKind ?? 'tag',
        positive_count: entry.positiveCount ?? 0,
        negative_count: entry.negativeCount ?? 0,
        evidence_count: entry.evidenceCount ?? 0,
        adult_level: entry.adultLevel ?? 0,
        ja_label: entry.ja ?? '',
        ja_meaning: entry.meaning ?? '',
        curation_status: entry.curationStatus ?? 'machine-draft',
        source_id: sourceId,
        source_label: sourceLabel,
        aliases: Array.isArray(entry.aliases) ? entry.aliases : []
      })
    }
  }
}

function collectIngestCandidateEntries(byTag) {
  if (!fs.existsSync(ingestDbPath)) return

  const sourceRegistry = loadSourceRegistry()
  const db = new DatabaseSync(ingestDbPath, { readOnly: true })
  try {
    const rows = db.prepare(`
      SELECT
        c.candidate_id,
        c.canonical_tag,
        c.display_tag,
        c.token_kind,
        c.positive_count,
        c.negative_count,
        c.evidence_count,
        c.adult_level,
        COALESCE((
          SELECT ev.source_id
          FROM candidate_evidence ev
          WHERE ev.candidate_id = c.candidate_id
          GROUP BY ev.source_id
          ORDER BY SUM(ev.occurrence_count) DESC, ev.source_id ASC
          LIMIT 1
        ), 'local-user-prompts') AS source_id,
        COALESCE((
          SELECT t.ja_label
          FROM translation_jobs t
          WHERE t.candidate_id = c.candidate_id
          ORDER BY
            CASE t.status
              WHEN 'curated' THEN 1
              WHEN 'source-derived' THEN 2
              WHEN 'machine-draft' THEN 3
              WHEN 'needs-review' THEN 4
              ELSE 5
            END,
            t.updated_at DESC
          LIMIT 1
        ), '') AS ja_label,
        COALESCE((
          SELECT t.ja_meaning
          FROM translation_jobs t
          WHERE t.candidate_id = c.candidate_id
          ORDER BY
            CASE t.status
              WHEN 'curated' THEN 1
              WHEN 'source-derived' THEN 2
              WHEN 'machine-draft' THEN 3
              WHEN 'needs-review' THEN 4
              ELSE 5
            END,
            t.updated_at DESC
          LIMIT 1
        ), '') AS ja_meaning,
        COALESCE((
          SELECT t.status
          FROM translation_jobs t
          WHERE t.candidate_id = c.candidate_id
          ORDER BY
            CASE t.status
              WHEN 'curated' THEN 1
              WHEN 'source-derived' THEN 2
              WHEN 'machine-draft' THEN 3
              WHEN 'needs-review' THEN 4
              ELSE 5
            END,
            t.updated_at DESC
          LIMIT 1
        ), 'needs-review') AS curation_status
      FROM candidate_tags c
      WHERE c.status IN ('accepted', 'promoted')
        AND c.evidence_count >= 2
        AND c.token_kind IN ('tag', 'phrase', 'quality', 'negative')
      ORDER BY c.evidence_count DESC, c.confidence DESC, c.canonical_tag ASC
      LIMIT 5000
    `).all()

    const sourceCounts = db.prepare(`
      SELECT source_id, COUNT(*) AS count
      FROM raw_prompt_records
      GROUP BY source_id
    `).all()

    ingestManifestSources.push(...sourceCounts
      .filter((row) => shouldIncludeIngestSource(row.source_id) && !promotedSnapshotSourceIds.has(String(row.source_id)))
      .map((row) => {
        const source = sourceRegistry.get(row.source_id) ?? {}
        return {
          sourceId: row.source_id,
          file: 'userdata/prompt-dictionary/ingest.sqlite',
          label: source.displayName ?? row.source_id,
          exists: true,
          importedRecords: Number(row.count ?? 0)
        }
      }))

    for (const row of rows) {
      if (!shouldIncludeIngestSource(row.source_id)) continue
      if (promotedSnapshotSourceIds.has(String(row.source_id))) continue
      addIngestCandidateEntry(byTag, row)
    }
  } finally {
    db.close()
  }
}

function shouldIncludeIngestSource(sourceId) {
  return includeLocalUserPrompts || String(sourceId || '') !== localUserPromptSourceId
}

function addIngestCandidateEntry(byTag, row) {
  const sourceRegistry = loadSourceRegistry()
  const sourceId = String(row.source_id || 'civitai-public-images')
  const sourceLabel = String(row.source_label || sourceRegistry.get(sourceId)?.displayName || sourceId)
  const displayTag = String(row.display_tag || row.canonical_tag || '').trim()
  const normalizedTag = normalizeTag(displayTag)
  if (!displayTag || !normalizedTag) return
  if (shouldSkipIngestTag(displayTag)) return
  const category = classifyIngestCategory(displayTag, row.token_kind)
  const group = classifyIngestGroup(displayTag, row.token_kind)
  const adultLevel = Math.max(Number(row.adult_level ?? 0), adultLevelForIngestTag(displayTag))
  const polarity = row.negative_count > row.positive_count ? 'negative' : 'positive'
  const curatedJapanese = curatePromptDictionaryJapanese(displayTag, {
    ja: row.ja_label,
    meaning: row.ja_meaning,
    category,
    group,
    polarity,
    status: row.curation_status,
    sourceLabel
  })
  const ja = curatedJapanese.ja
  const jaMeaning = curatedJapanese.meaning
  const next = {
    tag: displayTag,
    normalizedTag,
    category,
    group,
    ja,
    jaMeaning,
    polarity,
    sourceId,
    sourceLabel,
    sourcePriority: 12,
    sourceKind: 'built-in',
    curationStatus: curatedJapanese.status || String(row.curation_status || 'machine-draft'),
    translationProvider: curatedJapanese.provider || (ja ? 'yoitomoshi-heuristic-v1' : ''),
    postCount: Number(row.evidence_count ?? 0),
    adultLevel,
    aliases: new Map()
  }
  addAlias(next.aliases, next.category, 'ja', 'category', 6)
  addAlias(next.aliases, next.group, 'ja', 'group', 8)
  if (ja) addAlias(next.aliases, ja, 'ja', 'machine-draft', 20)
  if (Array.isArray(row.aliases)) {
    for (const alias of row.aliases) addAlias(next.aliases, alias, 'en', 'source-alias', 10)
  }
  addQueryExpansionAliases(next)

  const key = displayTag.toLowerCase()
  const previous = byTag.get(key)
  if (!previous) {
    byTag.set(key, next)
  } else {
    mergeEntry(previous, next)
  }
}

function loadSourceRegistry() {
  const byId = new Map()
  if (!fs.existsSync(sourceRegistryPath)) return byId
  const parsed = JSON.parse(fs.readFileSync(sourceRegistryPath, 'utf8'))
  if (!Array.isArray(parsed.sources)) return byId
  for (const source of parsed.sources) {
    if (source && typeof source.sourceId === 'string') byId.set(source.sourceId, source)
  }
  return byId
}

function shouldSkipIngestTag(tag) {
  const normalized = String(tag ?? '').trim().toLowerCase()
  if (!normalized) return true
  return ingestNoiseTagPatterns.some((pattern) => pattern.test(normalized))
}

function adultLevelForIngestTag(tag) {
  const normalized = String(tag ?? '').trim().toLowerCase()
  return ingestAdultTagPatterns.some((pattern) => pattern.test(normalized)) ? 2 : 0
}

function classifyIngestCategory(tag, tokenKind) {
  const haystack = `${tag} ${tokenKind}`.toLowerCase()
  if (tokenKind === 'negative' || /(bad_|worst_|low_quality|extra_|missing_|watermark|signature|text)/.test(haystack)) return 'ネガティブなプロンプト'
  if (/(lens|camera|angle|view|focus|bokeh|depth_of_field|telephoto|fisheye)/.test(haystack)) return 'レンズ'
  if (/(quality|score_|masterpiece|highres|detailed|absurdres|aesthetic)/.test(haystack)) return '画面'
  if (/(dress|shirt|skirt|jacket|coat|uniform|kimono|boots|shoes|gloves|hat|ribbon|bow|socks|thighhigh|pantyhose|pajamas|apron|bodysuit|leotard|necktie|belt|holster|veil|panties|underwear|lingerie|whale_tail)/.test(haystack)) return '衣服や装飾品'
  if (/(pose|sitting|standing|knees|shrugging|looking|holding|lifting|grab|contrapposto|masturbation|ejaculation|insertion|ahegao)/.test(haystack)) return '表情動作'
  if (/(weapon|gun|rifle|glock|ak-47|ar-15|badge|bag|book|pillow|futon|sheet|toy|dildo|vibrator|wand|plug)/.test(haystack)) return 'アイテム'
  if (/(hair|eyes?|face|mouth|smile|skin|hands?|fingers?|arms?|legs?|body|ears?|tail|thigh|stomach|collarbone|woman|girl|boy|breasts?|ass|anus|nipple|areola)/.test(haystack)) return '人物'
  if (/(background|sky|room|street|forest|water|flower|cloud|night|day|outdoors|indoors|bedroom|futon)/.test(haystack)) return '環境'
  if (/(lighting|light|shadow|sunset|smoke|trail|petal|atmosphere)/.test(haystack)) return 'シーン'
  return 'シーン'
}

function classifyIngestGroup(tag, tokenKind) {
  const haystack = `${tag} ${tokenKind}`.toLowerCase()
  if (tokenKind === 'negative') return 'ネガティブ'
  if (/(lens|telephoto|fisheye|bokeh|depth_of_field|focus)/.test(haystack)) return 'レンズ'
  if (/(camera|angle|view)/.test(haystack)) return 'カメラの角度'
  if (/(masturbation|ejaculation|insertion)/.test(haystack)) return '動作'
  if (/(hair)/.test(haystack)) return '髪'
  if (/(eyes?|face|mouth|smile|skin|ahegao)/.test(haystack)) return '顔'
  if (/(hands?|fingers?|arms?|legs?|body)/.test(haystack)) return '体'
  if (/(quality|score_|masterpiece|highres|detailed|absurdres)/.test(haystack)) return '品質'
  if (/(lighting|light|shadow|sunlight|backlighting)/.test(haystack)) return '光'
  if (/(background|sky|room|street|forest|water|flower|cloud|outdoors|indoors)/.test(haystack)) return '背景'
  if (/(dress|shirt|skirt|jacket|coat|uniform|kimono|boots|shoes|gloves|hat|ribbon|bow|socks|pantyhose|panties|underwear|lingerie)/.test(haystack)) return '衣装'
  return '候補'
}

function mergeEntry(previous, next) {
  previous.postCount = Math.max(Number(previous.postCount ?? 0), Number(next.postCount ?? 0))
  previous.adultLevel = Math.max(Number(previous.adultLevel ?? 0), Number(next.adultLevel ?? 0))
  if (next.sourcePriority >= previous.sourcePriority && next.ja) {
    previous.ja = next.ja
    previous.jaMeaning = next.jaMeaning ?? next.ja
    previous.category = next.category
    previous.group = next.group
    previous.polarity = next.polarity
    previous.sourceId = next.sourceId
    previous.sourceLabel = next.sourceLabel
    previous.sourcePriority = next.sourcePriority
    previous.curationStatus = next.curationStatus
    previous.translationProvider = next.translationProvider
  }
  for (const alias of next.aliases.values()) {
    addAlias(previous.aliases, alias.alias, alias.language, alias.kind, alias.weight)
  }
}

function addQueryExpansionAliases(entry) {
  for (const [ja, values] of Object.entries(queryExpansions)) {
    for (const value of values) {
      const normalized = normalizeTag(value)
      if (entry.normalizedTag.includes(normalized)) {
        addAlias(entry.aliases, ja, 'ja', 'query-expansion', 30)
        break
      }
    }
  }
}

function createSchema(db) {
  db.exec(`
    PRAGMA foreign_keys=ON;
    PRAGMA journal_mode=DELETE;

    CREATE TABLE dictionary_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE dictionary_sources (
      source_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '',
      license_note TEXT NOT NULL DEFAULT '',
      fetched_at TEXT NOT NULL DEFAULT '',
      import_method TEXT NOT NULL
    );

    CREATE TABLE dictionary_packs (
      pack_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      built_at TEXT NOT NULL,
      entry_count INTEGER NOT NULL
    );

    CREATE TABLE dictionary_entries (
      id INTEGER PRIMARY KEY,
      tag TEXT NOT NULL UNIQUE,
      normalized_tag TEXT NOT NULL,
      category TEXT NOT NULL,
      group_name TEXT NOT NULL,
      polarity TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_label TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_tag_id TEXT,
      post_count INTEGER,
      deprecated INTEGER NOT NULL DEFAULT 0,
      adult_level INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(source_id) REFERENCES dictionary_sources(source_id)
    );

    CREATE TABLE dictionary_text (
      entry_id INTEGER PRIMARY KEY,
      ja_label TEXT NOT NULL DEFAULT '',
      ja_meaning TEXT NOT NULL DEFAULT '',
      en_description TEXT NOT NULL DEFAULT '',
      curation_status TEXT NOT NULL DEFAULT 'seed',
      translation_provider TEXT NOT NULL DEFAULT 'yoitomoshi',
      updated_at TEXT NOT NULL,
      FOREIGN KEY(entry_id) REFERENCES dictionary_entries(id) ON DELETE CASCADE
    );

    CREATE TABLE dictionary_aliases (
      entry_id INTEGER NOT NULL,
      alias TEXT NOT NULL,
      language TEXT NOT NULL,
      alias_kind TEXT NOT NULL,
      weight INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(entry_id) REFERENCES dictionary_entries(id) ON DELETE CASCADE,
      UNIQUE(entry_id, alias, language, alias_kind)
    );

    CREATE TABLE dictionary_relations (
      entry_id INTEGER NOT NULL,
      related_entry_id INTEGER NOT NULL,
      relation_kind TEXT NOT NULL,
      weight INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(entry_id) REFERENCES dictionary_entries(id) ON DELETE CASCADE,
      FOREIGN KEY(related_entry_id) REFERENCES dictionary_entries(id) ON DELETE CASCADE,
      UNIQUE(entry_id, related_entry_id, relation_kind)
    );

    CREATE TABLE dictionary_user_overrides (
      entry_id INTEGER PRIMARY KEY,
      custom_ja_label TEXT NOT NULL DEFAULT '',
      custom_ja_meaning TEXT NOT NULL DEFAULT '',
      hidden INTEGER NOT NULL DEFAULT 0,
      favorite INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(entry_id) REFERENCES dictionary_entries(id) ON DELETE CASCADE
    );

    CREATE TABLE dictionary_usage (
      entry_id INTEGER PRIMARY KEY,
      insert_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      FOREIGN KEY(entry_id) REFERENCES dictionary_entries(id) ON DELETE CASCADE
    );

    CREATE INDEX idx_dictionary_entries_normalized_tag ON dictionary_entries(normalized_tag);
    CREATE INDEX idx_dictionary_entries_category ON dictionary_entries(category, group_name);
    CREATE INDEX idx_dictionary_aliases_alias ON dictionary_aliases(alias);
    CREATE INDEX idx_dictionary_aliases_entry ON dictionary_aliases(entry_id);

    CREATE VIRTUAL TABLE dictionary_fts USING fts5(
      tag,
      normalized_tag,
      ja_label,
      ja_meaning,
      aliases,
      category,
      group_name,
      tokenize = "unicode61 remove_diacritics 1 tokenchars '_-'",
      prefix = "2 3 4"
    );

    CREATE VIRTUAL TABLE dictionary_trigram_fts USING fts5(
      search_text,
      tokenize = "trigram"
    );
  `)
}

function insertEntries(db, entries) {
  const now = new Date().toISOString()
  const insertMeta = db.prepare('INSERT INTO dictionary_meta(key, value) VALUES (?, ?)')
  const insertSource = db.prepare(`
    INSERT INTO dictionary_sources(source_id, name, license_note, import_method)
    VALUES (?, ?, ?, ?)
  `)
  const insertPack = db.prepare(`
    INSERT INTO dictionary_packs(pack_id, name, version, built_at, entry_count)
    VALUES (?, ?, ?, ?, ?)
  `)
  const insertEntry = db.prepare(`
    INSERT INTO dictionary_entries(
      id, tag, normalized_tag, category, group_name, polarity, source_kind, source_label,
      source_id, source_tag_id, post_count, deprecated, adult_level, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertText = db.prepare(`
    INSERT INTO dictionary_text(
      entry_id, ja_label, ja_meaning, en_description, curation_status, translation_provider, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const insertAlias = db.prepare(`
    INSERT OR IGNORE INTO dictionary_aliases(entry_id, alias, language, alias_kind, weight)
    VALUES (?, ?, ?, ?, ?)
  `)
  const insertFts = db.prepare(`
    INSERT INTO dictionary_fts(rowid, tag, normalized_tag, ja_label, ja_meaning, aliases, category, group_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertTrigram = db.prepare(`
    INSERT INTO dictionary_trigram_fts(rowid, search_text)
    VALUES (?, ?)
  `)

  db.exec('BEGIN')
  try {
    insertMeta.run('schema_version', '1')
    insertMeta.run('built_at', now)
    insertMeta.run('generator', 'scripts/build-prompt-dictionary-db.cjs')

    for (const source of yamlSources) {
      insertSource.run(
        source.sourceId,
        source.label,
        source.sourceId === 'prompt-library-ja' ? 'Bundled prompt library source; verify upstream license before redistributing derived text.' : 'Yoitomoshi-authored local seed content.',
        `yaml:${source.file}`
      )
    }
    for (const source of uniqueIngestManifestSources()) {
      const registry = loadSourceRegistry().get(source.sourceId) ?? {}
      insertSource.run(
        source.sourceId,
        source.label,
        registry.licenseNote ?? 'Source-attributed prompt evidence imported into local staging database.',
        `sqlite:userdata/prompt-dictionary/ingest.sqlite`
      )
    }
    insertPack.run('yoitomoshi-base', 'Yoitomoshi Prompt Daijiten Base', '1', now, entries.length)

    for (const entry of entries) {
      const aliasText = entry.aliases.map((alias) => alias.alias).join(' ')
      insertEntry.run(
        entry.id,
        entry.tag,
        entry.normalizedTag,
        entry.category,
        entry.group,
        entry.polarity,
        'built-in',
        entry.sourceLabel,
        entry.sourceId,
        null,
        entry.postCount ?? null,
        0,
        entry.adultLevel ?? 0,
        now
      )
      insertText.run(
        entry.id,
        entry.ja,
        entry.jaMeaning ?? entry.ja,
        '',
        entry.curationStatus ?? (entry.sourceId === 'yoitomoshi-prompt-daijiten-seed' ? 'curated' : 'seed'),
        entry.translationProvider ?? (entry.sourceId.startsWith('yoitomoshi') ? 'yoitomoshi' : 'source-yaml'),
        now
      )
      for (const alias of entry.aliases) {
        insertAlias.run(entry.id, alias.alias, alias.language, alias.kind, alias.weight)
      }
      insertFts.run(entry.id, entry.tag, entry.normalizedTag, entry.ja, entry.jaMeaning ?? entry.ja, aliasText, entry.category, entry.group)
      insertTrigram.run(entry.id, [
        entry.tag,
        entry.normalizedTag,
        entry.ja,
        entry.jaMeaning ?? '',
        aliasText,
        entry.category,
        entry.group
      ].join(' '))
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function uniqueIngestManifestSources() {
  const byId = new Map()
  for (const source of ingestManifestSources) {
    const previous = byId.get(source.sourceId)
    byId.set(source.sourceId, previous ? { ...previous, ...source } : source)
  }
  return [...byId.values()]
}

function inferPolarity(category, group, tag) {
  const haystack = `${category} ${group} ${tag}`.toLowerCase()
  if (
    haystack.includes('失敗回避') ||
    haystack.includes('失敗防止') ||
    haystack.includes('ネガティブなプロンプト') ||
    haystack.includes('negative') ||
    haystack.includes('bad ') ||
    haystack.includes('extra ') ||
    haystack.includes('missing ') ||
    haystack.includes('fused ')
  ) {
    return 'negative'
  }
  return 'positive'
}

function addAlias(aliases, alias, language, kind, weight) {
  const normalized = String(alias ?? '').trim()
  if (!normalized) return
  const key = `${language}:${kind}:${normalized}`
  const previous = aliases.get(key)
  if (!previous || previous.weight < weight) {
    aliases.set(key, { alias: normalized, language, kind, weight })
  }
}

function normalizeTag(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ')
}
