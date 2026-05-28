# Prompt Meaning Enrichment Reliability Scope

## MVP

- Add provider-specific confidence thresholds.
- Add skip reasons for low-confidence, ambiguous, redirect-only, provider-error, curated-protected, and no-candidate cases.
- Add a transaction around each `--apply` batch.
- Add a compact audit output with counts by provider, status, and skip reason.
- Add offline fixtures for representative cases:
  - `bad_hands`: exact Danbooru wiki hit.
  - `hand`: Danbooru redirect plus valid Wikidata general term.
  - `kimono`: Danbooru and Wikidata both valid.
  - `newest`: Wikidata false-positive work title must be skipped.
  - internal QA tag: must be skipped from automatic batch selection.
- Add a regression command that runs without network using fixtures.

## Nice To Have

- Add `--json-out <path>` for durable dry-run reports.
- Add `--explain <tag>` to show why a suggestion was selected or skipped.
- Add provider health summary for recent cache status.
- Add duplicate/redirect target resolution for Danbooru `See ...` wiki pages.

## Future

- Add an in-app review queue for low-confidence candidates.
- Add optional LLM summarization only after deterministic source selection succeeds.
- Add source-specific license display in Dictionary tab.

## Out Of Scope

- Marking automated suggestions as `curated`.
- Scraping HTML pages.
- Login-required API access.
- Storing images or downloaded image bytes.
- Shipping raw external wiki/dictionary payloads inside `resources/prompt-dictionary/prompt-dictionary.sqlite`.
- Building an OpenAI/LLM translation pipeline in this slice.

## Constraints

- Technology: Windows/PowerShell, Electron Node for `node:sqlite`.
- Compatibility: Preserve existing `translation_jobs` priority behavior and runtime DB rebuild path.
- Compliance: Respect provider rate limits, terms, User-Agent requirements, and attribution needs.
- Cost: Keep MVP free/local except public HTTP APIs.

