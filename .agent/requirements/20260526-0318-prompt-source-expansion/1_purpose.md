# Purpose

## Goal

Expand Yoitomoshi Prompt Daijiten from a curated seed dictionary into a large, source-attributed prompt/tag knowledge base for AI illustration workflows.

The system should ingest prompt metadata from allowed sources, split prompts into reusable prompt tags, normalize aliases, add Japanese labels/meanings, and promote only useful entries into the searchable SQLite dictionary used by PromptEditor, PromptDictionaryPanel, and global tag autocomplete.

## Target Users

- The Yoitomoshi creator using Forge models such as Illustrious, NoobAI, Pony, Animagine, Anima, SDXL, and SD1.5.
- Future agents expanding the prompt dictionary without breaking legal/source boundaries.
- Power users who want to import their own prompt logs, PNG metadata, and Civitai/API-derived prompt examples into a local dictionary.

## Success Criteria

- Dictionary scale grows from thousands of tags to tens or hundreds of thousands of candidates without slowing renderer search.
- Every imported item has source provenance, import method, license/ToS status, fetched timestamp, and curation status.
- Japanese search such as `手`, `髪`, `俯瞰`, `着物`, `光`, `表情` returns useful English prompt tags with Japanese labels and meanings.
- Raw prompts are never treated as curated dictionary entries until parsed, deduped, scored, and reviewed or auto-approved by conservative rules.
- The system can be rerun incrementally without duplicating entries or losing user edits.

## Product Principle

Use a "source-governed corpus" approach:

- APIs and licensed datasets first.
- Manual/user-owned imports second.
- No generic scraping when terms, robots, auth, or platform behavior make automated indexing unclear.
- Preserve source metadata so unsafe or low-quality sources can be disabled without deleting the whole dictionary.

## Current Base

The repo already has:

- SQLite/FTS5 dictionary build path: `scripts/build-prompt-dictionary-db.cjs`
- Runtime search path: `electron/prompt-dictionary-db.ts`
- UI surfaces: `PromptDictionaryPanel`, `PromptEditor`, `PromptDictionaryAutocompleteLayer`
- Existing source metadata columns: `dictionary_sources`, `dictionary_entries.source_id`, `source_label`, `post_count`, `deprecated`, `adult_level`

This feature should extend that architecture instead of replacing it.
