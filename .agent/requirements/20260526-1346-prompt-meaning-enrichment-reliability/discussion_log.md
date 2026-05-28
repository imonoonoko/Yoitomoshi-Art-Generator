# Discussion Log: Prompt Meaning Enrichment Reliability

## 2026-05-26 Request

User wants to strengthen the reliability of the prompt dictionary meaning-enrichment script, explicitly invoking:

- `define-requirements`
- `orchestrate-skills`
- `codex-brain`

Skill stack used:

- `orchestrate-skills`: keep the stack narrow and verify that no frontend/browser/OpenAI/API-key skill is required for this requirements pass.
- `codex-brain`: read `wiki/hot.md`, `wiki/INDEX.md`, and query Brain context. Brain query fell back because Obsidian CLI was unavailable; current repo files remain the source of truth.
- `define-requirements`: create this durable implementation handoff.

Current repo facts:

- `scripts/enrich-prompt-dictionary-meanings.cjs` can query Danbooru, Wikidata, Wiktionary, and Civitai, then build a `source-derived` suggestion.
- `resources/prompt-dictionary/ingest-schema.sql` has `translation_jobs` and newly added `meaning_lookup_cache`.
- `docs/maps/02-prompt-management-flow.md` says external sources must stage in `userdata/prompt-dictionary/ingest.sqlite` and runtime SQLite must be rebuilt from promoted candidates.
- Existing importer policy already blocks HTML scraping, login bypass, image-byte storage, and direct runtime DB injection.

External source check:

- Danbooru API docs confirm JSON read endpoints for `wiki_pages` and `tags`, including searchable fields and tag categories.
- Wikimedia API policy requires an identifying User-Agent and notes licensing varies per wiki/API.
- Wikimedia REST docs describe Wiktionary's definition endpoint as experimental.
- Civitai API docs expose `/api/v1/tags`, but this is usage evidence, not a reliable meaning source.

Decision:

- Reliability should be improved with gates, fixtures, audits, and deterministic scoring before wider `--apply`.
- The script should never turn machine/source-derived results into `curated`.
- Source text should remain local evidence. Runtime dictionary text should be generated summaries with provider/source attribution, not copied wiki/dictionary bodies.

## 2026-05-26 Roadmap Resume

Input:

- Resume reference: `019e5fb4-9667-7b83-98b8-9129df21e5fe`.
- New research memo: `7_best_practices_research_20260526.md`.

Additional repo check:

- `scripts/enrich-prompt-dictionary-meanings.cjs` currently has provider lookups, `buildSuggestion`, `applySuggestion`, and `fetchCachedJson`.
- Missing implementation gates include normalized decisions, `--min-confidence`, `--json-out`, fixture/no-network mode, explicit transaction wrapping, timeout/retry/backoff, provider circuit breaker, and wide-apply regression checks.

Decision:

- Added `8_roadmap_20260526.md`.
- The roadmap resolves the default broad `--apply` threshold to `0.80`, keeps Civitai as usage evidence only, places Danbooru redirect resolution after the MVP unless needed, and makes offline fixtures plus temporary-data-root apply smoke mandatory before broad apply.

## 2026-05-26 Implementation Start

Skill stack used:

- `define-requirements`: used the existing `.agent/requirements/20260526-1346-prompt-meaning-enrichment-reliability/` handoff and roadmap as the implementation boundary.
- `orchestrate-skills`: kept the stack narrow; no frontend/browser/OpenAI skill was needed for this CLI/staging-DB slice.
- `codex-brain`: read `wiki/hot.md`, `wiki/INDEX.md`, and queried the Brain. No current Prompt Daijiten project note was found, so current repo files and this requirement folder remained the source of truth.

Implemented first slice:

- Added normalized enrichment decisions with `decision`, `reason`, confidence, selected provider, source URL, warnings, and generated Japanese suggestion preview.
- Added conservative `--min-confidence` defaulting to `0.80`.
- Added `--json-out`, `--fixture-dir`, `--no-network`, `--timeout-ms`, `--retry`, and `--max-errors-per-provider`.
- Added explicit `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` wrapping for `--apply`.
- Added run counters for apply, preview, low-confidence skips, curated protection, ambiguous skips, usage-only skips, provider errors, provider disabled, cache hits/writes, and fixture hits.
- Added `meaning_enrichment_decisions` audit table to the schema and script-side compatibility creation.
- Added offline fixture coverage and `npm.cmd run dictionary:enrich:meanings:test`.
- Added fixture cases for `bad_hands`, `kimono`, and `1girl`, plus a no-apply check for `newest`.
- Added apply smoke checks in the fixture test: `kimono` applies into a temporary DB, while curated `bad_hands` remains protected.

Validation:

- `node --check scripts\enrich-prompt-dictionary-meanings.cjs`
- `node --check scripts\test-prompt-dictionary-meaning-fixtures.cjs`
- `npm.cmd run dictionary:enrich:meanings:test`
- `npm.cmd run typecheck`
- `npm.cmd run dictionary:ingest:init -- --data-root output/prompt-dictionary-ingest-reliability-smoke --json`
- `npm.cmd run dictionary:enrich:meanings -- --data-root output/prompt-dictionary-ingest-reliability-smoke --tag bad_hands --provider danbooru --fixture-dir scripts/fixtures/prompt-dictionary-meanings --no-network --dry-run --json-out output/prompt-dictionary-ingest-reliability-smoke/bad-hands-wrapper-dry-run.json`
- `git diff --check`

Result:

- All validation passed.
- No broad `--apply` was run against normal `userdata`.
- Next implementation slice should start from P2 provider reliability hardening if more live API robustness is needed.

## 2026-05-26 P2 Provider Reliability Continuation

Implemented:

- Tightened provider circuit breaker accounting to use provider-family names (`danbooru`, `wikidata`, `wiktionary`, `civitai`) instead of cache table names such as `wikidata-search` or `danbooru-tags`.
- Added `providerErrorCounts` to JSON output so disabled providers can be explained.
- Added fixture regression checks for provider-family mapping, `Retry-After` seconds handling, Wikimedia-family fallback backoff, and provider-disabled behavior after `--max-errors-per-provider 1`.
- Fixed a regression where the default fixture directory was used during live dry-runs just because it existed. Fixtures are now used when `--fixture-dir` is explicit, or by default only when `--no-network` is set.

Validation:

- `node --check scripts\enrich-prompt-dictionary-meanings.cjs`
- `node --check scripts\test-prompt-dictionary-meaning-fixtures.cjs`
- `npm.cmd run dictionary:enrich:meanings:test`
- `npm.cmd run dictionary:enrich:meanings -- --data-root output/prompt-dictionary-ingest-reliability-smoke --tag kimono --provider danbooru,wikidata,wiktionary,civitai --dry-run --retry 1 --timeout-ms 8000 --rate-limit-ms 250 --json-out output/prompt-dictionary-ingest-reliability-smoke/kimono-live-policy-dry-run.json`
- `npm.cmd run typecheck`
- `git diff --check`

Result:

- All validation passed.
- The live policy dry-run used public APIs with `fixtureHits: 0`, `providerErrors: 0`, and no writes/apply against normal `userdata`.
- Current implementation remains sequential, so Wikimedia-family concurrency is effectively `1`, under the `<= 3` policy.
- Remaining future work is P3 review workflow/UI integration or deeper provider schema validation if needed.

## 2026-05-26 P3 Review Workflow Start

Implemented:

- Added `scripts/review-prompt-dictionary-meanings.cjs` and `.ps1` wrapper.
- Added `npm.cmd run dictionary:enrich:meanings:review`.
- Review export supports:
  - `--from-report <dry-run-json> --export <review-json>`
  - database audit export from latest unapplied `meaning_enrichment_decisions`
- Review import supports:
  - `--import <review-json>`
  - accepting only entries with `review.decision = "accept"`
  - writing accepted entries as `source-derived` by default, never `curated`
  - curated overwrite protection unless `--force` is explicit
  - transaction-wrapped writes and audit rows with `human-review-accepted`
- Added fixture coverage for a review round-trip: `hands` Wikidata evidence becomes `preview-only`, is exported to review JSON, edited to accept, imported into the temporary staging DB, and verified as `source-derived`.
- Updated `docs/maps/02-prompt-management-flow.md` to include the review CLI and the dry-run JSON -> review JSON -> import path.

Validation:

- `node --check scripts\review-prompt-dictionary-meanings.cjs`
- PowerShell AST parse for `scripts\review-prompt-dictionary-meanings.ps1`
- `npm.cmd run dictionary:enrich:meanings:test`
- `npm.cmd run dictionary:enrich:meanings:review -- --from-report output/prompt-dictionary-ingest-reliability-smoke/kimono-live-policy-dry-run.json --export output/prompt-dictionary-ingest-reliability-smoke/kimono-review-export.json --limit 5`
- `npm.cmd run dictionary:enrich:meanings:review -- --data-root output/prompt-dictionary-ingest-reliability-smoke --import output/prompt-dictionary-ingest-reliability-smoke/kimono-review-export.json --dry-run`
- `npm.cmd run typecheck`
- `git diff --check`

Result:

- All validation passed.
- Normal `userdata` still was not broad-applied.
- P3 CLI review workflow is now usable; UI affordances can be layered later against this JSON/audit contract.

## 2026-05-26 P3 Dictionary Tab Review Affordance

Implemented:

- Added meaning-enrichment review counts to `PromptDictionaryIngestStatus`:
  - `meaningDecisionCount`
  - `meaningReviewableCount`
  - `latestMeaningDecisionAt`
- Updated `electron/prompt-dictionary-ingest.ts` and `scripts/init-prompt-dictionary-ingest.cjs` so both app IPC and CLI status expose those counts.
- Added a small `意味レビュー` panel to `PromptDictionaryWorkspace`.
  - Shows reviewable/audit counts.
  - Copies safe review export/import commands.
  - Reveals the staging DB location.
  - Does not run broad apply from the UI.
- Updated `scripts/dom-qa.cjs` `prompt-dictionary-workspace` check to require the meaning review panel and command controls.

Validation:

- `npm.cmd run typecheck`
- `node --check scripts\init-prompt-dictionary-ingest.cjs`
- `node --check scripts\dom-qa.cjs`
- `npm.cmd run dictionary:ingest:init -- --data-root output/prompt-dictionary-ingest-reliability-smoke --json`
- `npm.cmd run qa:dom:prompt-dictionary-workspace -- --port=9338`
- `git diff --check`

Result:

- All validation passed.
- DOM QA confirmed Dictionary tab search, prompt insertion, source/ingest panel, and the new meaning review controls.
- Electron/CDP QA was used because the target surface is an Electron renderer, not a standalone browser URL.

## 2026-05-26 Project Closeout

Used `project-closeout` for a final status/docs pass.

Added:

- `9_closeout_20260526.md`

Closeout result:

- The roadmap scope is complete through P0/P1/P2/P3.
- The closeout records changed areas, verification evidence, remaining risks, and the recommended small real-data review workflow.
- It explicitly notes that normal `userdata` was not broadly applied and the whole repo still has broader uncommitted Prompt Daijiten/source-expansion work outside this reliability slice.

Final verification after closeout:

- `npm.cmd run dictionary:enrich:meanings:test`
- `npm.cmd run typecheck`
- `git diff --check`

Result:

- All final verification passed.
