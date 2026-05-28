# Implementation Brief

## Selected Skill Stack

- `define-requirements`: durable scope and acceptance criteria.
- `orchestrate-skills`: choose only the relevant local skills and Brain index context.
- `project-closeout`: HTML report, feature inventory, verification summary.

## Implementation Steps

1. Add a Danbooru general tag metadata importer:
   - source: `danbooru-tag-metadata`
   - endpoint: public JSON tag metadata
   - categories: general and meta tags
   - store promoted tag candidates, not raw page/image data
2. Add the promoted snapshot to dictionary build inputs.
3. Extend `PromptDictionaryEntry` with `adultLevel` and `postCount`.
4. Surface adult/source/popularity cues in autocomplete and Dictionary rows.
5. Rebuild dictionary DB and create HTML report.
6. Run typecheck, script syntax checks, and dictionary build.
