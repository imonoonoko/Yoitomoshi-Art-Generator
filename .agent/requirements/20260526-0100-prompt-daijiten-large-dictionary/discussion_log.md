# Discussion Log: Prompt Daijiten Large Dictionary

## 2026-05-26 01:00 JST

User wants to evolve the current Prompt Daijiten into a large dictionary covering broad prompt tags, Japanese translations, and meanings. The expected interaction is Japanese-first search: for example, typing "手" should surface hands-related English prompt tags such as `hands`, `hand on hip`, `holding hands`, and related prompt candidates with Japanese labels and meaning notes.

Important direction:

- Treat this as a large searchable knowledge base, not just a bigger YAML file.
- Store English prompt tag, Japanese translation, Japanese meaning, aliases, category, source, and model-family usefulness separately.
- Preserve current Prompt/Negative/Slot insertion workflow.
- Be careful with data storage, update pipeline, source licensing, and startup performance.

Current codebase findings:

- Existing small dictionary is `resources/prompt-dictionary.yoitomoshi.ja.yaml`.
- Existing prompt library loader is `electron/prompt-library.ts`; it loads YAML into memory at app startup.
- Existing Prompt Daijiten UI is `src/components/PromptDictionaryPanel.tsx`.
- Existing Prompt map is `docs/maps/02-prompt-management-flow.md`.
- For large scale, app should query a dictionary service over IPC instead of pushing the full dictionary into Zustand.

External source notes checked on 2026-05-26:

- Danbooru has REST-like API documentation at https://danbooru.donmai.us/wiki_pages/help:api.
- Danbooru tag help is at https://danbooru.donmai.us/wiki_pages/help:tags.
- Danbooru translated tag notes are at https://danbooru.donmai.us/wiki_pages/help:translated_tags.
- Live tag search endpoint shape was confirmed with `https://danbooru.donmai.us/tags.json?search[name_matches]=hand*&limit=5`, returning tag fields such as `id`, `name`, `post_count`, `category`, `is_deprecated`, and `words`.

## 2026-05-26 01:20 JST

Implementation start:

- Added `electron/prompt-dictionary.ts` as the first main-process dictionary search service.
- Added `api.promptDictionary.search` through `src/shared/ipc-channels.ts`, `src/shared/types.ts`, `electron/preload.ts`, and `electron/ipc-handlers.ts`.
- Updated `PromptDictionaryPanel` to query through IPC instead of flattening and searching all entries in renderer memory.
- Kept the existing Prompt Library and Custom Library behavior intact; the service currently searches those existing sources plus `resources/prompt-dictionary.yoitomoshi.ja.yaml`.
- This is a bridge toward the large dictionary architecture. It does not add SQLite yet; the next phase is the storage spike described in `6_implementation_brief.md`.

Synergy preserved:

- Prompt/Negative/Prompt Composer Slot insertion stays unchanged.
- Existing Prompt Library, Prompt Helper, Dynamic Prompt, autocomplete, and Tag workspace still use their current store-backed library data.
- The new IPC boundary lets Prompt Daijiten later move to a large DB without forcing the rest of the prompt ecosystem to change at the same time.

Validation:

- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.
- `git diff --check` passed.
- `npm.cmd run qa:dom:api -- --port=9338` passed and includes `promptDictionarySearch`.
- `npm.cmd run qa:dom -- selectors --port=9338` passed and includes `prompt-dictionary-panel` / `prompt-dictionary-toggle`.
- Added and ran `npm.cmd run qa:dom -- prompt-dictionary-search --port=9338`; query `手` returned hands-related top results such as `hand detail pass`, `hand on cheek`, `hand on chest`, and `hand on hip`.

## 2026-05-26 Database Decision

Selected database method for the large Prompt Daijiten:

- Use SQLite through Electron/Node built-in `node:sqlite` in the Electron main process.
- Use SQLite FTS5 for full-text search and a separate trigram FTS table for substring-style matching.
- Ship the base dictionary as `resources/prompt-dictionary/prompt-dictionary.sqlite`.
- Keep user edits and usage data in `userdata/prompt-dictionary/user-dictionary.sqlite`.
- Avoid `better-sqlite3` or other native npm SQLite modules for the first implementation because Electron native modules add rebuild and Windows packaging risk.

Verification:

- Electron runtime check on this repository returned Electron 42.1.0, Node 24.15.0, SQLite 3.51.3.
- `node:sqlite`, FTS5, and FTS5 `trigram` tokenizer were all available.
- Official references checked: Node.js v24 `node:sqlite`, SQLite FTS5, Electron native Node module guidance, and Electron 42 release notes.

## 2026-05-26 Database Implementation Start

Implemented the first SQLite/FTS5 storage layer:

- Added `scripts/build-prompt-dictionary-db.cjs` and `scripts/build-prompt-dictionary-db.ps1`.
- Added `npm.cmd run dictionary:build`.
- Generated `resources/prompt-dictionary/prompt-dictionary.sqlite` and `resources/prompt-dictionary/manifest.json`.
- Added `electron/prompt-dictionary-db.ts`.
- Updated `electron/prompt-dictionary.ts` so main search prefers SQLite/FTS5 and falls back to the previous YAML/in-memory search if the DB is unavailable.
- Updated `electron/main.ts` and `electron/ipc-handlers.ts` to pass `resourcesDir` and `userdata` roots into the prompt dictionary service.

Verification so far:

- `npm.cmd run dictionary:build` generated a 4,007-entry DB and confirmed `hand*` returns hands-related rows.
- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.
- `npm.cmd run qa:dom:api -- --port=9338` passed.
- `npm.cmd run qa:dom -- prompt-dictionary-search --port=9338` passed.
- The `手` query now returns hands-related top rows through the UI and API, including `hand detail pass`, `hand on cheek`, `hand on chest`, and `hand on hip`.

Implementation notes:

- FTS prefix search is limited to ASCII-like tag queries. Japanese short queries are handled by exact/LIKE/trigram and curated expansion terms to avoid FTS5 syntax errors on one-character Japanese prefix queries.
- Category/group aliases are treated as weaker prefix/contains signals, not exact high-score matches, so broad groups such as `手の動き` do not bury direct `hand*` tags.

## 2026-05-26 Prompt Editor Integration

Implemented Prompt Daijiten suggestions in the normal Prompt/Negative input fields:

- Updated `src/components/PromptEditor.tsx` to query `api.promptDictionary.search` for the current token.
- Japanese one-character terms such as `手` open suggestions while typing; Latin terms open from two characters.
- `Ctrl+Space` still forces suggestions for the current token.
- Selecting a suggestion replaces the current token with the English prompt tag and appends `, `.
- Existing local autocomplete remains a fallback if dictionary IPC search fails.
- Added DOM QA command `prompt-editor-dictionary`.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.
- `npm.cmd run qa:dom:api -- --port=9338` passed.
- `npm.cmd run qa:dom -- prompt-editor-dictionary --port=9338` passed; typing `手` in the normal Prompt editor surfaced a dictionary suggestion and inserted `hand detail pass, `.
- `npm.cmd run qa:dom -- prompt-dictionary-search --port=9338` still passed.

## 2026-05-26 Global Tag Input Autocomplete

Implemented Prompt Daijiten suggestions outside the normal Prompt/Negative editor:

- Added `PromptDictionaryAutocompleteLayer`, a single opt-in global autocomplete layer for inputs and textareas marked with `data-prompt-dictionary-autocomplete`.
- Connected it to Tags Workspace quick-add/editors, Prompt Composer slots, Prompt Library tag add, ADetailer prompts, Regional Prompter prompts, LoRA prompt overrides, Checkpoint prompt profile tag fields, Tagger blacklist/review fields, and Character Compose prompt.
- The normal `PromptEditor` keeps its own inline autocomplete, so the global layer avoids double popups there.
- `手` and other Japanese one-character lookups use the same `api.promptDictionary.search` SQLite/FTS5 service and insert the English tag into the active field.
- Added DOM QA command `prompt-global-autocomplete`.

Validation completed:

- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.
- `npm.cmd run qa:dom:api -- --port=9338` passed.
- `npm.cmd run qa:dom -- prompt-global-autocomplete --port=9338` passed; typing `手` in Tags Workspace quick-add surfaced the shared layer and inserted `hand detail pass, `.
- `npm.cmd run qa:dom -- prompt-editor-dictionary --port=9338` still passed.
- `npm.cmd run qa:dom -- prompt-dictionary-search --port=9338` still passed.
- `npm.cmd run qa:dom:prompt-composer -- --port=9338` passed.
- `git diff --check` passed.
