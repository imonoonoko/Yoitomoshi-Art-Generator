# Implementation Brief

## Architecture

```text
source registry
  -> source importer jobs
  -> userdata/prompt-dictionary/ingest.sqlite
  -> prompt parser
  -> candidate/evidence tables
  -> translation/review queue
  -> promoted dictionary pack
  -> resources or userdata prompt-dictionary.sqlite
  -> api.promptDictionary.search
```

## New Files

Suggested additions:

- `resources/prompt-dictionary/sources.json`
- `electron/prompt-dictionary-ingest.ts`
- `electron/prompt-dictionary-source-registry.ts`
- `electron/prompt-dictionary-civitai-source.ts`
- `electron/prompt-dictionary-local-source.ts`
- `electron/prompt-dictionary-hf-source.ts`
- `src/lib/prompt-tokenizer.ts`
- `scripts/import-prompt-dictionary-source.cjs`
- `scripts/promote-prompt-dictionary-candidates.cjs`
- `src/components/PromptDictionaryImportManager.tsx`

## Schema Additions

Use a staging DB in `userdata/prompt-dictionary/ingest.sqlite`.

Tables:

- `source_registry_snapshot`
- `import_runs`
- `import_cursors`
- `raw_prompt_records`
- `prompt_parse_results`
- `candidate_tags`
- `candidate_evidence`
- `translation_jobs`
- `promotion_decisions`

Keep the runtime dictionary schema mostly stable. Extend only when needed:

- `dictionary_sources.allowed_mode`
- `dictionary_sources.terms_url`
- `dictionary_sources.checked_at`
- `dictionary_text.curation_status`
- `dictionary_entries.adult_level`
- `dictionary_entries.deprecated`

## MVP Implementation Steps

1. Add source registry and source policy validator.
2. Add staging DB creation/open helper in main process.
3. Add local/manual import first:
   - app history prompts
   - pasted CSV/TXT prompt files
   - PNG metadata text
4. Add Civitai public API importer:
   - `GET https://civitai.com/api/v1/images`
   - `withMeta=true`
   - store `meta.prompt`, `meta.negativePrompt`, model/resource hints
   - store no image bytes
   - rate limit and cursor pagination
5. Add parser and candidate evidence aggregation.
6. Add promotion script that emits YAML/SQLite-compatible dictionary entries.
7. Add review UI for labels/meanings and hide/reject.
8. Add Hugging Face dataset importer for text-only licensed prompt datasets.
9. Add Danbooru-style tag metadata importer after API/rate-limit confirmation.

## Source-Specific Notes

### Civitai

Use now, API only.

- Public API can return image metadata with `meta.prompt` and `meta.negativePrompt`.
- Do not scrape HTML pages.
- Do not download images.
- Use `nsfw=false` by default.
- Keep raw prompt storage optional; tokenized evidence should be enough for built-in distribution.

### Hugging Face Datasets

Use selectively.

- Prefer datasets with explicit permissive licenses.
- Prefer text-only prompt columns and Parquet access.
- DiffusionDB is a strong first dataset candidate because it is CC0 and includes prompt metadata.

### Danbooru-Style Sources

Use for canonical tag vocabulary and tag counts, not as prompt dump replacement.

- Start with tag metadata, categories, counts, wiki summaries if allowed.
- Respect documented rate limits.
- Mark adult/category-sensitive tags.

### Gelbooru

Do not bulk import in MVP.

- DAPI exists, but TOS currently prohibits automated retrieval/indexing of site contents.
- Allow user-provided manual exports only unless explicit permission or safer terms are confirmed.

## Parsing Rules

- `(tag:1.2)` -> tag candidate `tag`, weight `1.2`
- `((tag))` -> tag candidate `tag`, emphasis count
- `[tag]` -> tag candidate `tag`, de-emphasis
- `<lora:name:0.8>` -> resource evidence, not dictionary tag
- `{a|b|c}` -> candidates `a`, `b`, `c` with dynamic prompt flag
- `BREAK` -> separator, not tag
- `score_9`, `score_8_up` -> quality/score category
- `rating:*`, `source:*`, `user:*` -> meta tags; default hidden unless useful

## Validation

Minimum checks after implementation:

- `npm.cmd run typecheck`
- `npm.cmd run build` if UI/main changes affect packaged output
- parser unit tests for weighted tags, LoRA tokens, Dynamic Prompt, negative prompt
- SQLite smoke:
  - source count
  - raw prompt count
  - candidate count
  - promoted entry count
  - `手` query returns hand-related rows
- DOM QA:
  - import manager renders
  - disabled source cannot run
  - Civitai sample import can run/cancel
  - review accept/hide updates state

## Stop Conditions

- A source requires session scraping or Cloudflare bypassing.
- A source's terms prohibit automated retrieval/indexing.
- A dataset license is missing or incompatible.
- Import quality produces too many unsafe/irrelevant tags without a reliable filter.
- SQLite search latency becomes noticeable in the renderer path.
