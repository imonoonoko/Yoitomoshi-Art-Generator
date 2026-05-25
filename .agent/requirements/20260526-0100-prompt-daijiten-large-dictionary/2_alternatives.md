# Prompt Daijiten Large Dictionary Alternatives

## Codebase Findings

- `resources/prompt-dictionary.yoitomoshi.ja.yaml` is appropriate for the starter dictionary, but not for a massive dictionary.
- `electron/prompt-library.ts` currently normalizes YAML at startup and returns categories to the renderer.
- `src/components/PromptDictionaryPanel.tsx` searches in renderer memory. This is fine for a few thousand entries, but not for a dictionary with large explanations and aliases.
- `docs/maps/02-prompt-management-flow.md` already positions Prompt Daijiten as a prompt surface inside the current Prompt ecosystem.
- The project currently has `js-yaml`, but no SQLite/search dependency.

## Option A: Keep Growing YAML

Effort: Small
Value: Low

Summary:
Keep adding tags to `resources/prompt-dictionary.yoitomoshi.ja.yaml` and search in React state.

Benefits:

- No new dependency.
- Easy to inspect manually.
- Reuses current loader.

Tradeoffs:

- Slow startup as data grows.
- Large file diffs and merge conflicts.
- No efficient Japanese lookup, alias expansion, ranking, source tracking, or incremental updates.
- Hard to separate generated translations from manually curated meanings.

Recommendation:
Do not use this for the large dictionary. Keep YAML only as a small curated starter or fallback pack.

## Option B: JSONL Shards + Custom Inverted Index

Effort: Medium
Value: Medium

Summary:
Store entries in line-delimited JSON shards and build small precomputed indexes for Japanese/English terms.

Benefits:

- No native dependency.
- Easy to generate and inspect.
- Can load only relevant shards.

Tradeoffs:

- More custom search code.
- Harder ranking, typo tolerance, prefix search, and updates.
- Index format must be maintained by us.

Recommendation:
Acceptable fallback if SQLite packaging becomes painful, but not the first choice.

## Option C: SQLite Database + FTS Search

Effort: Medium/Large
Value: High

Summary:
Build a local dictionary database with normalized tables and full-text search. Query through Electron main IPC. Renderer receives only search results.

Benefits:

- Designed for large datasets.
- Good fit for prefix/phrase search, ranking, pagination, and source metadata.
- Clean split between immutable base dictionary and user overlay.
- Does not require pushing the full dictionary into Zustand.

Tradeoffs:

- Requires dependency/runtime decision.
- Native SQLite packages can complicate Electron packaging on Windows.
- FTS tokenizer behavior for Japanese needs a spike.

Recommendation:
Use this as the target architecture, but run a packaging spike before committing to a specific library. If native SQLite is risky, use a WASM SQLite option or JSONL-shard fallback.

## Option D: External API Only

Effort: Medium
Value: Low/Medium

Summary:
Call Danbooru/CivitAI/other sources live whenever the user searches.

Benefits:

- Always current.
- Smaller local data.

Tradeoffs:

- Slow and fragile.
- Depends on network and external rate limits.
- Cannot safely provide Japanese meanings without local curation/cache.
- Repeated search while prompting should not generate unnecessary external traffic.

Recommendation:
Use external APIs only for update/import jobs or optional "refresh from source", not for the core prompt dictionary search.

## Recommendation

Adopt Option C as the product direction:

- Immutable base dictionary as generated database under app resources.
- User overlay under `userdata/`.
- Query via IPC from renderer to main.
- Use YAML only for curated seed tags and human-authored additions.
- Keep source/import pipeline separate from runtime search.
