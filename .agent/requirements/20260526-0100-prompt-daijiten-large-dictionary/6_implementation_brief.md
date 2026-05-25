# Prompt Daijiten Large Dictionary Implementation Brief

## Existing Patterns

- Current UI: `src/components/PromptDictionaryPanel.tsx`
- Prompt surface: `src/components/PromptPanel.tsx`
- Current small YAML loader: `electron/prompt-library.ts`
- Current prompt map: `docs/maps/02-prompt-management-flow.md`
- Storage owner: `electron/storage.ts`
- IPC pattern: `src/shared/ipc-channels.ts`, `electron/preload.ts`, `electron/ipc-handlers.ts`, `src/shared/types.ts`
- Validation baseline: `npm.cmd run typecheck`, `npm.cmd run build`, `git diff --check`

## Recommended Data Model

Base dictionary artifact:

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
  overrides.json
  usage.json
  imports/
```

Core tables or equivalent records:

```text
dictionary_entries
- id
- tag
- normalized_tag
- category
- post_count
- deprecated
- source_id
- source_tag_id
- model_families
- adult_level
- updated_at

dictionary_text
- entry_id
- ja_label
- ja_meaning
- en_description
- curation_status
- translation_provider
- updated_at

dictionary_aliases
- entry_id
- alias
- language
- alias_kind
- weight

dictionary_relations
- entry_id
- related_entry_id
- relation_kind
- weight

dictionary_sources
- source_id
- name
- url
- license_note
- fetched_at
- import_method
```

Search index:

- English tag exact/prefix.
- Japanese label exact/prefix.
- Japanese aliases and meaning terms.
- Optional romaji/kana expansions later.
- Ranking signals: direct alias match, exact tag, prefix, category, post count, user usage, favorites, deprecation penalty.

## Likely Touch Points

- `src/shared/types.ts`
  - Add `PromptDictionaryEntry`, `PromptDictionarySearchRequest`, `PromptDictionarySearchResult`.
- `src/shared/ipc-channels.ts`
  - Add prompt dictionary search/detail/update channels.
- `electron/preload.ts`
  - Expose `window.api.promptDictionary`.
- `electron/ipc-handlers.ts`
  - Validate query input and call dictionary service.
- `electron/prompt-dictionary-db.ts`
  - New service for opening database, querying index, merging user overlay.
- `electron/storage.ts`
  - Add user overlay persistence if not kept inside the DB service.
- `src/components/PromptDictionaryPanel.tsx`
  - Replace in-memory search with async IPC search.
- `resources/prompt-dictionary.yoitomoshi.ja.yaml`
  - Keep as seed source, not runtime search source.
- `scripts/`
  - Add build/import script for dictionary artifact.
- `docs/maps/02-prompt-management-flow.md`
  - Update after implementation.
- `docs/maps/06-settings-storage-workspace-flow.md`
  - Update if new `userdata/prompt-dictionary/` is added.

## Technical Assumptions

- The first implementation should support a local dictionary of at least 100k tags.
- The renderer should only hold current search results, not the full dictionary.
- Startup should open or validate the dictionary lazily.
- User overlay should be a separate user SQLite DB under `userdata/prompt-dictionary/`.
- Selected storage: Electron/Node built-in `node:sqlite` in the main process, with SQLite FTS5 indexes. See `7_database_decision.md`.

## Implementation Phases

### Phase 0.5: IPC Search Bridge Started

- Status: started on 2026-05-26.
- Added `electron/prompt-dictionary.ts`.
- Added `api.promptDictionary.search`.
- Updated `PromptDictionaryPanel` to call the main-process search service.
- Current source set is existing Prompt Library + Custom Library + Yoitomoshi seed dictionary.
- Purpose is to create the non-disruptive boundary before SQLite/FTS work, not to treat the current in-memory service as the final large-dictionary storage.

### Phase 0: Storage Spike

- Status: completed on 2026-05-26.
- Electron 42.1.0 runtime confirmed Node 24.15.0, SQLite 3.51.3, `node:sqlite`, FTS5, and FTS5 `trigram` tokenizer.
- Selected `node:sqlite` + SQLite FTS5.
- Confirm packaged build can open a read-only resource DB and a writable userdata overlay.
- Confirm Japanese search behavior for short queries such as `手`.
- Keep JSONL shards + custom inverted index only as fallback.

### Phase 1: Local Query Service

- Status: started on 2026-05-26.
- Add IPC search/detail contract.
- Move Prompt Daijiten search out of renderer memory. Done for search via `api.promptDictionary.search`.
- Build DB from current YAML seed. Done via `npm.cmd run dictionary:build`.
- Search service now prefers `resources/prompt-dictionary/prompt-dictionary.sqlite` through `electron/prompt-dictionary-db.ts`.
- Existing YAML/in-memory search remains fallback when the DB is unavailable.
- Preserve current UI behavior and DOM selectors.

### Phase 2: Large Tag Import

- Import tag metadata from an approved source.
- Add aliases and Japanese search terms.
- Add source manifest and update metadata.
- Keep long explanations Yoitomoshi-authored or explicitly licensed.

### Phase 3: Curation Layer

- Add favorites, hide, custom note, custom Japanese label.
- Add usage-based ranking.
- Add model-family filter and adult/deprecated controls.

### Phase 4: External Bridges

- Add optional Danbooru metadata refresh.
- Add CivitAI prompt evidence hints.
- Add Animadex character/artist handoff.

## Risks

- Source/license ambiguity around external dictionaries and wiki text.
- `node:sqlite` is release-candidate API in Node 24. Keep the DB service behind `api.promptDictionary` so the storage adapter can be replaced if necessary.
- Japanese FTS tokenization may need custom alias/index fields.
- Generated translations can be wrong and should not be treated as curated meaning.
- Too many rare tags can overwhelm search unless ranking and filters are strong.

## Test Plan

- Unit test search ranking on fixture data:
  - `手` returns `hands`/`hand` related entries.
  - `髪` returns hair-related entries.
  - `光` returns lighting-related entries.
  - deprecated entries rank lower.
- `npm.cmd run typecheck`
- `npm.cmd run build`
- `npm.cmd run dictionary:build`
- `git diff --check`
- DOM smoke:
  - open Prompt Daijiten.
  - search `手`.
  - insert result into Positive.
  - insert result into Negative.
  - copy result.
  - slot insertion mode still works.
- Storage migration test:
  - replace base dictionary.
  - confirm favorites/custom notes persist.

## Open Questions

- Keep large DB in repo resources or provide downloadable packs?
- Which source categories should be included by default?
- How should adult terms be filtered in a private-use tool?
- Should Japanese meanings be manually curated first for high-value categories, then generated for low-value tags?
