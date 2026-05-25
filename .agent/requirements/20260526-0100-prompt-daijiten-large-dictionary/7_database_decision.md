# Prompt Daijiten Database Decision

Decision date: 2026-05-26 JST

## Decision

Use SQLite with Electron/Node built-in `node:sqlite` in the Electron main process, backed by SQLite FTS5 indexes.

Do not add `better-sqlite3`, `sqlite3`, `sql.js`, DuckDB, or a renderer-side IndexedDB dependency for the first large-dictionary implementation.

## Why This Fits Yoitomoshi

- The app already runs on Electron 42.1.0. Local verification on 2026-05-26 showed Electron is using Node 24.15.0 and SQLite 3.51.3.
- Local verification also confirmed `node:sqlite`, FTS5, and the FTS5 `trigram` tokenizer are available inside the app runtime.
- Avoiding native npm SQLite modules keeps Windows packaging simpler. Electron native modules usually require Electron-targeted rebuilds after Electron upgrades.
- SQLite fits the product shape: a large local read-mostly dictionary, fast indexed search, source metadata, user overrides, and offline use.
- The existing IPC boundary `api.promptDictionary.search` already keeps the renderer from loading the full dictionary into memory.
- The existing `resourcesDir()` and `extraResources` packaging flow can ship a read-only base DB under `resources/`.

## Storage Layout

Base dictionary:

```text
resources/prompt-dictionary/
  manifest.json
  prompt-dictionary.sqlite
  seed/
    prompt-dictionary.yoitomoshi.ja.yaml
  sources/
    source-manifest.json
```

User overlay:

```text
userdata/prompt-dictionary/
  user-dictionary.sqlite
  imports/
  backups/
```

Use the base DB as a replaceable read-only pack. Keep user edits, favorites, hidden tags, custom translations, usage counts, and imported private packs in the user overlay DB so app updates do not overwrite them.

## Runtime Access Pattern

- Open the base DB lazily from the Electron main process on the first dictionary search.
- Open the base DB with read-only intent and apply `PRAGMA query_only=ON`.
- Open the user overlay as writable and use WAL mode when writes are introduced.
- Query through `api.promptDictionary.search`; renderer receives only result rows.
- Keep query limits bounded. The default UI should request 24 to 50 rows, with an internal hard cap.
- If main-process search ever causes UI stalls, move the DB service into a worker thread or Electron utility process without changing the renderer contract.

## Index Strategy

Use normal tables for durable data and FTS5 virtual tables for search.

Core tables:

```text
dictionary_entries
dictionary_text
dictionary_aliases
dictionary_relations
dictionary_sources
dictionary_packs
dictionary_user_overrides
dictionary_usage
```

Primary FTS index:

```sql
CREATE VIRTUAL TABLE dictionary_fts USING fts5(
  tag,
  normalized_tag,
  ja_label,
  ja_meaning,
  aliases,
  category,
  content='',
  tokenize='unicode61 remove_diacritics 1 tokenchars ''_-'''
);
```

Substring index for partial English/tag searches:

```sql
CREATE VIRTUAL TABLE dictionary_trigram_fts USING fts5(
  search_text,
  content='',
  tokenize='trigram'
);
```

Japanese short queries such as `手` should not depend only on tokenization. Store curated aliases/search terms with weights, for example:

```text
手 -> hand, hands, fingers, wrist, palm, holding hands, hand on hip
髪 -> hair, bangs, ponytail, twintails
光 -> light, rim light, backlighting, glow
```

## Build And Import

- Generate `prompt-dictionary.sqlite` offline from YAML/JSONL/import manifests.
- Prefer running the DB builder through Electron's runtime when using `node:sqlite`, for example with `ELECTRON_RUN_AS_NODE=1`, so the builder and app use the same SQLite implementation.
- Keep imported source text separate from Yoitomoshi-authored Japanese labels and meanings.
- Store source URL, license note, import timestamp, source tag ID, and import method per source.
- Treat machine-generated Japanese meanings as draft metadata, not curated truth.

## Rejected Alternatives

`better-sqlite3`:

- Mature and fast, but it is a native module. Electron upgrades and Windows packaging would require rebuild handling. Use only if `node:sqlite` later lacks a required capability.

`sql.js` / WASM SQLite:

- Avoids native rebuilds, but is less attractive for a large persistent local dictionary in Electron main, and adds WASM packaging and memory overhead.

JSONL shards plus custom index:

- Simple to ship, but pushes ranking, prefix search, substring search, updates, and joins into custom code. Keep only as fallback if SQLite becomes unusable.

DuckDB:

- Strong analytical database, but over-sized for an interactive prompt dictionary and not the best fit for FTS/search UX.

Renderer IndexedDB:

- Puts trusted local data and indexing in the renderer side, complicates migrations, and fights the current IPC/service boundary.

## Implementation Acceptance Criteria

- `api.promptDictionary.search({ query: '手' })` returns hand-related entries without loading the full DB into renderer memory.
- Base dictionary replacement does not remove user favorites, hidden tags, custom labels, or usage counts.
- Packaged app can open `resources/prompt-dictionary/prompt-dictionary.sqlite`.
- Search still works when the user overlay DB is missing; it is created lazily only when needed.
- `npm.cmd run typecheck`, `npm.cmd run build`, `git diff --check`, and the prompt dictionary DOM smoke pass.

## References Checked

- Node.js v24 `node:sqlite` documentation: https://nodejs.org/docs/latest-v24.x/api/sqlite.html
- SQLite FTS5 documentation: https://www.sqlite.org/fts5.html
- Electron native Node modules documentation: https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules
- Electron 42 release note: https://www.electronjs.org/blog/electron-42-0
