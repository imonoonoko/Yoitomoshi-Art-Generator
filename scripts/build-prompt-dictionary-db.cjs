const fs = require('node:fs')
const path = require('node:path')
const yaml = require('js-yaml')
const { DatabaseSync } = require('node:sqlite')

const projectRoot = path.resolve(__dirname, '..')
const resourcesDir = path.join(projectRoot, 'resources')
const outputDir = path.join(resourcesDir, 'prompt-dictionary')
const dbPath = path.join(outputDir, 'prompt-dictionary.sqlite')
const manifestPath = path.join(outputDir, 'manifest.json')

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
    sources: yamlSources.map((source) => ({
      sourceId: source.sourceId,
      file: source.file,
      label: source.label,
      exists: fs.existsSync(path.join(resourcesDir, source.file))
    }))
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
          const ja = jaValue == null ? '' : String(jaValue).trim()
          const key = displayTag.toLowerCase()
          const next = {
            tag: displayTag,
            normalizedTag,
            category: category.name.trim(),
            group: group.name.trim(),
            ja,
            polarity: inferPolarity(category.name, group.name, displayTag),
            sourceId: source.sourceId,
            sourceLabel: source.label,
            sourcePriority: source.priority,
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

  return [...byTag.values()]
    .sort((a, b) => a.tag.localeCompare(b.tag))
    .map((entry, index) => ({
      ...entry,
      id: index + 1,
      aliases: [...entry.aliases.values()].sort((a, b) => b.weight - a.weight || a.alias.localeCompare(b.alias))
    }))
}

function mergeEntry(previous, next) {
  if (next.sourcePriority >= previous.sourcePriority && next.ja) {
    previous.ja = next.ja
    previous.category = next.category
    previous.group = next.group
    previous.polarity = next.polarity
    previous.sourceId = next.sourceId
    previous.sourceLabel = next.sourceLabel
    previous.sourcePriority = next.sourcePriority
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
        null,
        0,
        0,
        now
      )
      insertText.run(
        entry.id,
        entry.ja,
        entry.ja,
        '',
        entry.sourceId === 'yoitomoshi-prompt-daijiten-seed' ? 'curated' : 'seed',
        entry.sourceId.startsWith('yoitomoshi') ? 'yoitomoshi' : 'source-yaml',
        now
      )
      for (const alias of entry.aliases) {
        insertAlias.run(entry.id, alias.alias, alias.language, alias.kind, alias.weight)
      }
      insertFts.run(entry.id, entry.tag, entry.normalizedTag, entry.ja, entry.ja, aliasText, entry.category, entry.group)
      insertTrigram.run(entry.id, [
        entry.tag,
        entry.normalizedTag,
        entry.ja,
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

function inferPolarity(category, group, tag) {
  const haystack = `${category} ${group} ${tag}`.toLowerCase()
  if (
    haystack.includes('失敗回避') ||
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
