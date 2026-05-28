# Prompt Meaning Enrichment Reliability Implementation Brief

## Existing Patterns

- `scripts/enrich-prompt-dictionary-meanings.cjs`
  - Provider functions: `lookupDanbooru`, `lookupWikidata`, `lookupWiktionary`, `lookupCivitai`.
  - Suggestion function: `buildSuggestion`.
  - DB write path: `applySuggestion`.
  - Cache path: `fetchCachedJson`.
- `scripts/enrich-prompt-dictionary-meanings.ps1`
  - Runs the Node script through Electron with `ELECTRON_RUN_AS_NODE=1`.
- `resources/prompt-dictionary/ingest-schema.sql`
  - Staging DB schema for `translation_jobs` and `meaning_lookup_cache`.
- `docs/maps/02-prompt-management-flow.md`
  - Source expansion safety policy and verification commands.

## Likely Touch Points

- `scripts/enrich-prompt-dictionary-meanings.cjs`
- `scripts/enrich-prompt-dictionary-meanings.ps1`
- `package.json`
- `resources/prompt-dictionary/ingest-schema.sql`
- `docs/maps/02-prompt-management-flow.md`
- Optional new fixtures under `scripts/fixtures/prompt-dictionary-meanings/`

## Technical Plan

1. Add a normalized decision object:
   - `decision`: `apply`, `skip`, or `preview-only`.
   - `reason`: `high-confidence`, `low-confidence`, `ambiguous-provider-result`, `curated-protected`, `provider-error`, `no-candidate`, `redirect-only`, etc.
   - `confidence`, `provider`, `sourceUrl`.
2. Add provider thresholds:
   - Danbooru exact wiki non-redirect: high.
   - Danbooru tag-only: medium/low.
   - Wikidata general term exact match: medium/high only when not work-title-like.
   - Wiktionary: low/medium and never overrides Danbooru/Wikidata.
   - Civitai: evidence-only.
3. Add CLI flags:
   - `--min-confidence <n>`
   - `--json-out <path>`
   - `--fixture-dir <path>`
   - `--no-network`
   - `--timeout-ms <n>`
   - `--retry <n>`
4. Add fixture mode:
   - Read provider payloads from fixture files by provider/key.
   - Strip timestamps before snapshot comparisons.
5. Add batch transaction and output counters.
6. Update docs and add regression script:
   - `dictionary:enrich:meanings:test`

## Risks

- Provider APIs can drift, especially Civitai and experimental Wiktionary definition endpoints.
- Danbooru wiki bodies may include conventions that should be summarized, not copied.
- Wikidata entity search can select works with the same title unless aggressively filtered.

## Test Plan

- `node --check scripts/enrich-prompt-dictionary-meanings.cjs`
- `npm.cmd run dictionary:enrich:meanings -- --tag bad_hands --dry-run --provider danbooru`
- `npm.cmd run dictionary:enrich:meanings -- --tag newest --dry-run --provider wikidata`
- `npm.cmd run dictionary:enrich:meanings:test`
- `npm.cmd run dictionary:ingest:init -- --data-root output/prompt-dictionary-ingest-reliability-smoke --json`
- `npm.cmd run typecheck`
- `git diff --check`

## Implementation Stop Rule

Do not run wide `--apply` until the fixture regression command proves that the known false-positive cases are skipped and exact Danbooru cases remain accepted.

