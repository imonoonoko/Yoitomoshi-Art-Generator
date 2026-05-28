# Prompt Knowledge Workbench Implementation Brief

## Existing Patterns

- Prompt Dictionary runtime search:
  - `src/components/PromptDictionaryPanel.tsx`
  - `src/components/PromptEditor.tsx`
  - `src/components/PromptDictionaryAutocompleteLayer.tsx`
  - `electron/prompt-dictionary.ts`
- Ingest/source foundation:
  - `resources/prompt-dictionary/sources.json`
  - `resources/prompt-dictionary/ingest-schema.sql`
  - `electron/prompt-dictionary-source-registry.ts`
  - `electron/prompt-dictionary-ingest.ts`
  - `scripts/init-prompt-dictionary-ingest.*`
  - `scripts/import-civitai-prompt-dictionary.*`
  - `scripts/import-local-prompt-dictionary.*`
  - `scripts/build-prompt-dictionary-db.cjs`
- UI review patterns:
  - `src/components/HistoryGallery.tsx` Candidate Board and tag review
  - `src/components/PromptLibrary.tsx` tag editing/import preview patterns
  - `src/components/ToolsWorkspace.tsx` operational tool panels
- IPC contract pattern:
  - `src/shared/ipc-channels.ts`
  - `src/shared/types.ts`
  - `electron/preload.ts`
  - `electron/ipc-handlers.ts`

## Likely Touch Points

- Add shared types:
  - `PromptDictionaryCandidateQuery`
  - `PromptDictionaryCandidateSummary`
  - `PromptDictionaryCandidateDetail`
  - `PromptDictionaryPromotionDecisionInput`
  - `PromptDictionaryRebuildResult`
- Add IPC channels:
  - list candidate summaries
  - get candidate detail
  - save decision/translation
  - inspect source/ingest summary
  - rebuild runtime dictionary
- Add main service:
  - `electron/prompt-dictionary-curation.ts`
- Add renderer component:
  - `src/components/PromptKnowledgeWorkbench.tsx`
  - likely mounted in `ToolsWorkspace` first to avoid top-level tab churn.
- Extend DOM QA:
  - `prompt-knowledge-workbench` fixture in `scripts/dom-qa.cjs`.
- Update docs:
  - `docs/maps/02-prompt-management-flow.md`
  - possibly `docs/maps/05-electron-ipc-flow.md` if IPC surface expands significantly.

## Technical Assumptions

- `userdata/prompt-dictionary/ingest.sqlite` is the writable staging source of truth for candidate decisions.
- `resources/prompt-dictionary/promoted-candidates.*.json` remain commit-safe promotion snapshots.
- Runtime dictionary rebuild can initially call the existing script path, then later move into a service if needed.
- Candidate queries must stay main-process backed and paginated.
- Raw prompts are shown only when source policy allows it; local prompts can show short snippets, external sources default to aggregate/evidence only.

## Suggested Implementation Slices

### Slice 1: Read-Only Workbench

- IPC query for summary and candidate list.
- Tools panel UI with filters and detail read-only view.
- DOM QA for opening, filtering, selecting.

### Slice 2: Decision Persistence

- Save accept/hide/reject and Japanese edits.
- Update `promotion_decisions` / `translation_jobs`.
- DOM QA for save and status refresh.

### Slice 3: Rebuild Control

- Add guarded rebuild action.
- Rebuild runtime SQLite and manifest.
- Reload dictionary service cache or document restart requirement.
- DOM QA for success/error states.

### Slice 4: Batch And Merge

- Batch operations for visible filtered rows.
- Duplicate/alias merge suggestions.
- Source-specific purge/review helpers.

## Risks

- Rebuild from renderer could become unsafe if arbitrary script execution is exposed. Keep main-side action narrow and validated.
- SQLite write contention if import and curation run simultaneously. Use simple locks or reject curation while an import run is active.
- Showing raw prompt snippets can violate source policy. Gate by source definition and default to hidden.
- Adult/sensitive candidates need default-off visibility.
- Dirty working tree already contains source expansion work; avoid mixing unrelated refactors.

## Test Plan

- `npm.cmd run typecheck`
- `npm.cmd run dictionary:build`
- `git diff --check`
- `npm.cmd run qa:dom -- prompt-knowledge-workbench --port=9338`
- Existing prompt dictionary checks:
  - `npm.cmd run qa:dom -- prompt-editor-dictionary --port=9338`
  - `npm.cmd run qa:dom -- prompt-global-autocomplete --port=9338`
- If IPC changes are substantial:
  - `npm.cmd run qa:dom:api -- --port=9338`

## Open Questions

- Whether to mount under Tools first or add a Prompt Dictionary subtab.
- Whether batch decisions should be included in MVP or delayed.
- Whether existing script-based rebuild is enough for MVP.

