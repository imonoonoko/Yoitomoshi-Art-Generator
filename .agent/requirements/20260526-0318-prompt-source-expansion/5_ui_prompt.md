# UI Prompt

## Feature Surface

Add a compact Prompt Daijiten Import Manager inside the existing Prompt/Tags tooling, not as a new top-level tab.

Recommended placement:

- Primary: `PromptDictionaryPanel` expandable section.
- Secondary: Tools tab advanced maintenance section for long imports/rebuilds.

## Layout

Use a dense operational panel:

- Header: `Prompt Daijiten Sources`
- Status chips:
  - total staged prompts
  - candidate tags
  - promoted tags
  - review queue
  - last build time
- Source table:
  - source name
  - mode
  - last run
  - fetched records
  - candidates
  - blocked/skipped
  - action buttons
- Review queue:
  - English tag
  - Japanese label
  - Japanese meaning
  - source evidence
  - curation status
  - accept/edit/hide/reject
- Build controls:
  - run selected import
  - parse staged prompts
  - promote safe candidates
  - rebuild SQLite dictionary

## Interaction Rules

- Imports must show progress and be cancelable.
- Long-running import should continue only in main process, not renderer memory.
- If a source is disabled by policy, show the reason and no run button.
- Do not show raw NSFW prompt text by default.
- Do not show large raw prompt dumps in the panel; show sampled evidence only.
- Review should be keyboard-friendly:
  - Enter accepts edited label
  - Escape cancels edit
  - Ctrl+Enter promotes selected entry

## Visual Tone

Use the existing Yoitomoshi dense tool style:

- small table rows
- compact chips
- clear source provenance
- status colors for `curated`, `draft`, `needs-review`, `blocked`
- no landing-page or marketing layout

## Required Test IDs

- `prompt-dictionary-import-manager`
- `prompt-dictionary-source-row-{sourceId}`
- `prompt-dictionary-source-run-{sourceId}`
- `prompt-dictionary-source-status-{sourceId}`
- `prompt-dictionary-review-queue`
- `prompt-dictionary-review-row-{tagId}`
- `prompt-dictionary-review-accept-{tagId}`
- `prompt-dictionary-review-hide-{tagId}`
- `prompt-dictionary-rebuild`
- `prompt-dictionary-import-progress`
