# Requirements

## Functional Requirements

1. Bulk dictionary expansion must use the existing source registry and staging/runtime boundary.
2. New imported terms must be traceable by source in `manifest.json`.
3. Autocomplete suggestions must expose enough metadata to judge insertion quickly:
   - English tag
   - Japanese label or meaning when available
   - category/group/source
   - adult marker when `adult_level > 0`
4. Dictionary workspace results must show the same adult/source cues.
5. HTML report must include:
   - current dictionary counts
   - existing feature inventory
   - synergy map
   - implemented changes
   - verification results
   - remaining risks / next actions

## Acceptance Criteria

- `npm.cmd run dictionary:build` succeeds.
- `npm.cmd run typecheck` succeeds.
- New source appears in `resources/prompt-dictionary/manifest.json`.
- Runtime dictionary count and adult-tag count are reported before/after.
- HTML report exists under `docs/` and is linked from `docs/DOCS_INDEX.md`.
