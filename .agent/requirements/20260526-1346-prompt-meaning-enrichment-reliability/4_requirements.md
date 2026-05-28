# Prompt Meaning Enrichment Reliability Requirements

## 1. Overview

The meaning-enrichment script must convert external source evidence into Japanese prompt dictionary drafts safely and repeatably. It should apply only defensible updates and leave ambiguous cases inspectable.

## 2. User Stories

- As a prompt author, I want automatically enriched Japanese meanings to be trustworthy enough for autocomplete, so that I do not need to manually research every tag.
- As a curator, I want skipped cases to explain why they were skipped, so that I can prioritize review work.
- As a developer, I want deterministic fixtures, so that provider scoring changes do not silently degrade results.

## 3. Acceptance Criteria

### Source Confidence

- Given an exact Danbooru wiki page with non-redirect body, when enrichment runs, then the suggestion may become `source-derived` if it meets the configured threshold.
- Given only a Danbooru tag record with no wiki body, when enrichment runs, then it may add usage evidence but must not claim detailed semantic certainty.
- Given a Danbooru redirect body like `See hands.`, when enrichment runs, then it must be lower confidence unless redirect target resolution is implemented.
- Given Wikidata returns a work title such as an album, song, game, journal, sculpture, or TV series for a generic prompt token, when enrichment runs, then that result must be skipped or scored below apply threshold.
- Given only Civitai tag evidence, when enrichment runs, then Civitai must be treated as usage evidence, not meaning evidence.

### Apply Safety

- Given an existing `curated` translation job, when enrichment runs with `--apply`, then it must not overwrite it unless `--force` is set.
- Given a suggestion below `--min-confidence`, when enrichment runs with `--apply`, then it must not update `translation_jobs`.
- Given a batch apply, when any DB write fails, then the failed batch must not leave partial updates without an error count.
- Given no matching `candidate_id`, when `--tag` is used, then the script may show evidence but must not write `translation_jobs`.

### Auditability

- Given `--dry-run`, when enrichment finishes, then output must include per-tag evidence, selected suggestion, confidence, and skip/apply reason.
- Given `--apply`, when enrichment writes a suggestion, then `translation_jobs.provider` must identify the evidence chain and `meaning_lookup_cache` must retain local evidence metadata.
- Given provider errors or 429/5xx responses, when enrichment finishes, then output must include provider error counts and continue with remaining candidates unless all providers fail.

### Reproducibility

- Given fixture mode, when the regression command runs offline, then known cases produce stable selected providers and skip/apply decisions.
- Given the same fixture inputs and thresholds, when the script runs twice, then output decisions must match except timestamps.

## 4. Nonfunctional Requirements

### Reliability

- Network lookups must use timeout, retry/backoff, and provider-specific error classification.
- Provider scoring must be deterministic and centralized enough to test.

### Data Safety

- Raw source payloads remain in local `userdata` cache only.
- Runtime dictionary text must be generated or summarized Yoitomoshi text with source attribution, not long copied external definitions.

### Usability

- Default mode remains `--dry-run`.
- Dangerous behaviors require explicit flags: `--apply`, `--force`, and `--refresh`.

### Feedback And Errors

- Output must expose `applied`, `skippedLowConfidence`, `skippedCurated`, `skippedAmbiguous`, `providerErrors`, and `cacheHits`.

## 5. Open Questions

- Should `--apply` default threshold be `0.70` or stricter `0.80`?
- Should Danbooru redirect target resolution be MVP or nice-to-have?
- Should source-derived summaries include source URLs in runtime DB, or only in local staging/audit data?

