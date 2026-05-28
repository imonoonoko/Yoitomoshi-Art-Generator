# Prompt Meaning Enrichment Reliability Best Practices Research

Updated: 2026-05-26

Scope: `scripts/enrich-prompt-dictionary-meanings.cjs`, `resources/prompt-dictionary/ingest-schema.sql`, and future prompt dictionary enrichment jobs.

## 1. Executive Summary

The enrichment script should treat external services as evidence providers, not as a single source of truth. The safest production pattern is:

1. Gather provider evidence into a cache/audit layer.
2. Convert evidence into a deterministic `decision` object.
3. Apply only high-confidence, non-curated, non-ambiguous suggestions inside a SQLite transaction.
4. Keep raw external payloads local to staging/userdata caches, and store generated Yoitomoshi summaries plus provenance in the runtime dictionary.
5. Test provider scoring with offline fixtures and reserve live API tests for optional smoke checks.

Recommended default for `--apply`: `--min-confidence 0.80`.

## 2. Source Ranking

| Rank | Source evidence | Meaning confidence | Recommended behavior |
| --- | --- | --- | --- |
| 1 | Danbooru exact wiki page, exact title, non-redirect body | High | Can apply if no curated value exists and generated summary passes threshold. |
| 2 | Danbooru exact tag record with category/post_count, no wiki body | Medium/low | Use as tag existence/category evidence, not detailed meaning. |
| 3 | Wikidata exact/general entity with matching labels/descriptions and safe instance type | Medium | Use for common objects/concepts only after work-title/person false-positive filters. |
| 4 | Wiktionary definition endpoint or page-derived definition | Low/medium | Use as supporting dictionary evidence; never override stronger booru evidence. |
| 5 | Civitai model tags/trainedWords/image metadata | Usage evidence only | Useful for prompt usage and LoRA linkage, not semantic meaning. |

## 3. Provider-Specific Findings

### Danbooru

Primary docs checked:

- `https://danbooru.donmai.us/wiki_pages/help%3Aapi`
- `https://danbooru.donmai.us/wiki_pages/api%3Atags`
- `https://danbooru.donmai.us/wiki_pages/api%3Awiki_pages`

Current docs state that Danbooru has a REST-like API, supports JSON/XML responses, and asks clients to use a unique `User-Agent` rather than impersonating browsers. The tag API exposes tag category and post count. The wiki page API exposes `title`, `body`, `other_names`, and status fields.

Implementation rules:

- Normalize tag key with Danbooru rules: lowercase, underscores, exact-title match.
- Fetch both `/tags.json?search[name]=...` and `/wiki_pages/{tag}.json`.
- Treat wiki body redirects like `See ...` as `redirect-only` unless redirect target resolution is implemented.
- Do not copy long Danbooru wiki body text into shipped resources. Generate short Japanese summaries and store source URL/provenance.
- Use `post_count` and `category` as confidence modifiers only, not as a semantic definition.

### Wikimedia / Wikidata / Wiktionary

Primary docs checked:

- `https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits`
- `https://foundation.wikimedia.org/wiki/Policy%3AWikimedia_Foundation_User-Agent_Policy/en`
- `https://www.wikidata.org/wiki/Help%3AData_access`
- `https://www.wikidata.org/wiki/Wikidata%3ALicensing`
- `https://www.mediawiki.org/wiki/Wikimedia_REST_API/en`

As of the May 2026 Wikimedia API rate-limit docs, clients should use a meaningful `User-Agent`, keep concurrent requests to 3 or fewer, and respect `Retry-After` on 429 responses. Wikidata data is CC0, but Wikimedia text pages are generally CC BY-SA; therefore, store only generated summaries or structured labels/descriptions, not copied article/definition prose.

Implementation rules:

- Always send a meaningful `User-Agent` or `Api-User-Agent`.
- Limit Wikimedia-family concurrency to `<= 3`.
- Respect HTTP `429` and `503`; if `Retry-After` exists, wait that duration, otherwise exponential backoff with at least a 5 second base delay.
- Prefer Wikidata labels/descriptions and entity type checks over free text extraction.
- Reject or downgrade Wikidata hits whose entity type is likely a work title or named entity when the prompt token is generic:
  - album, song, film, game, TV series, journal, sculpture, book, organization, person, place.
- Use Wiktionary definition endpoint only as supporting evidence because the Wikimedia REST docs describe the English Wiktionary definition endpoint as experimental.

### Civitai

Primary docs checked:

- `https://github.com/civitai/civitai/wiki/REST-API-Reference/de63434512878133a5788a25f4b94af0c06de4bc`

The public REST docs expose models, images, tags, model versions, image `meta`, model `tags`, and model-version `trainedWords`. This is useful for usage and LoRA linkage, but it is not a reliable definition source for generic prompt tags.

Implementation rules:

- Use Civitai as usage evidence only.
- `trainedWords` can confirm trigger words for LoRA/model linkage.
- Image `meta` can provide prompt usage examples, but must go through the same prompt-token splitter and licensing/provenance boundary as other prompt imports.
- Avoid HTML scraping and Cloudflare bypass behavior. Use public API endpoints only.

## 4. Network Reliability Best Practices

Primary docs checked:

- `https://nodejs.org/dist/latest/docs/api/globals.html`
- `https://nodejs.org/api/test.html`

Node's current globals docs include `AbortSignal.timeout(delay)`, and the test runner docs support test-context mocks and snapshot/file-snapshot assertions.

Implementation rules:

- Add a single fetch wrapper, for example `fetchJsonWithPolicy(provider, url, options)`.
- Required options:
  - `--timeout-ms`, default `8000`.
  - `--retry`, default `2`.
  - `--max-concurrency`, provider-specific default: Wikimedia `3`, others `2-4`.
  - `--max-errors-per-provider`, default `5`.
- Retry only transient classes:
  - `408`, `409`, `425`, `429`, `500`, `502`, `503`, `504`, timeout, connection reset.
- Do not retry deterministic failures:
  - `400`, `401`, `403`, `404`, schema validation failure.
- Add jittered exponential backoff.
- Add a provider circuit breaker: if a provider repeatedly fails, mark remaining lookups for that provider as `provider-disabled` and continue with other providers.
- Persist provider error counts in the JSON report.

## 5. SQLite / Data Safety

Primary docs checked:

- `https://www.sqlite.org/lang_transaction.html`
- `https://sqlite.org/atomiccommit.html`
- `https://nodejs.org/api/sqlite.html`

SQLite transactions should wrap every apply batch. The official transaction docs specify that explicit transactions persist until `COMMIT` or `ROLLBACK`, and SQLite's atomic commit design exists to make a transaction appear all-or-nothing even across interruptions.

Implementation rules:

- Keep dry-run as default.
- `--apply` must use:
  - `BEGIN IMMEDIATE`
  - write suggestions
  - write cache/audit records
  - `COMMIT`
  - `ROLLBACK` on any exception
- Do not overwrite `translation_jobs.status = 'curated'` unless `--force` is explicit.
- Record `decision`, `reason`, `confidence`, `provider`, `source_url`, `payload_hash`, and `generated_at`.
- Suggested idempotency key: `candidate_id + provider + provider_key + payload_hash + script_version`.
- Raw provider payloads should live only in local staging/cache tables or `userdata`, not in the shipped runtime dictionary.

## 6. Decision Object Contract

Every candidate should produce this normalized shape before any DB write:

```json
{
  "tag": "bad_hands",
  "decision": "apply",
  "reason": "high-confidence-danbooru-wiki",
  "confidence": 0.92,
  "selectedProvider": "danbooru",
  "sourceUrl": "https://danbooru.donmai.us/wiki_pages/bad_hands",
  "jaLabel": "崩れた手",
  "jaMeaning": "手指の崩れや不自然な手の描写を避けるためのネガティブプロンプト。",
  "evidence": [],
  "warnings": []
}
```

Allowed `decision` values:

- `apply`
- `skip`
- `preview-only`
- `provider-error`

Required skip reasons:

- `low-confidence`
- `curated-protected`
- `ambiguous-provider-result`
- `redirect-only`
- `usage-evidence-only`
- `no-candidate`
- `provider-disabled`
- `schema-invalid`

## 7. Confidence Policy

Recommended starting scores:

| Evidence | Base confidence |
| --- | ---: |
| Danbooru exact wiki, non-redirect, exact title | `0.92` |
| Danbooru exact wiki redirect-only | `0.55` |
| Danbooru exact tag only | `0.58` |
| Wikidata exact label + safe instance + Japanese description | `0.74` |
| Wikidata exact label + safe instance, no Japanese description | `0.62` |
| Wiktionary definition only | `0.48` |
| Civitai usage/trainedWords only | `0.35` |

Apply thresholds:

- Default dry-run: show all evidence.
- Default apply: `>= 0.80`.
- `>= 0.70` can be `preview-only` for curator review.
- `< 0.70` skip unless the user explicitly requests candidate export.

## 8. Regression Fixtures

Add fixture mode before wide apply:

```powershell
npm.cmd run dictionary:enrich:meanings:test
```

Fixture set should include:

| Tag | Expected result |
| --- | --- |
| `bad_hands` | Danbooru exact wiki accepted. |
| `hands` | Generic term accepted only with strong source; avoid over-specific Wikidata entity. |
| `newest` | Skip or low confidence if Wikidata returns named works. |
| `kimono` | Common object/clothing accepted when source evidence is exact. |
| `1girl` | Usage/tag evidence accepted as prompt convention, not ordinary dictionary meaning. |
| `style` | Skip ambiguous generic token unless exact prompt-context source exists. |

Test layers:

- Unit tests for normalization, redirect detection, entity-type filters, scoring, and overwrite guard.
- Fixture tests with `--no-network`.
- Temporary data-root integration test for `BEGIN/COMMIT/ROLLBACK`.
- Optional live smoke tests for one tag per provider, never required for CI.

## 9. Implementation Priority

P0:

- Central `buildDecision()` / `scoreEvidence()`.
- `--min-confidence`.
- Curated overwrite guard.
- Transaction-wrapped `--apply`.
- JSON summary counters.

P1:

- Offline fixtures and `dictionary:enrich:meanings:test`.
- Provider schema validation.
- `--json-out`.

P2:

- Shared fetch wrapper with timeout, retries, backoff, `Retry-After`, and provider circuit breaker.
- Wikimedia concurrency cap.

P3:

- Human review export/import flow.
- In-app review queue for `preview-only` suggestions.
- Later LLM-assisted Japanese cleanup, but only after source evidence and deterministic scoring are stable.

## 10. Acceptance Gate Before Wide Apply

Do not run a broad `--apply` until all are true:

- `node --check scripts/enrich-prompt-dictionary-meanings.cjs` passes.
- Fixture tests prove false positives are skipped.
- Apply smoke test uses a temporary data-root and verifies rollback behavior.
- `git diff --check` passes.
- Output includes `applied`, `skippedLowConfidence`, `skippedCurated`, `skippedAmbiguous`, `providerErrors`, `cacheHits`, and `providerDisabled`.
