# Implementation Brief

## Current State

- Personal Environment Health exists in Tools.
- Safe recovery IPC exists and is limited to settings normalization, stale DownloadJob recovery, and Model Library recovery.
- History already stores labels, tagReview, and proRecipeReview in `userdata/history/index.json`.
- HistoryGallery already has model/sampler/LoRA/label filters and Pro Recipe editing.
- Model Library already detects DownloadJob partials and orphan `.partial` files through integrity checks.

## Next Slices

1. Done: Broaden HistoryGallery search and add quick filters for success/rejected/asset/favorite/Pro Recipe.
2. Done: Show Pro Recipe review memo in the history grid card.
3. Done: Extend DOM QA coverage for the new search/filter affordances through the Pro Recipe fixture.
4. Done: Add rating range filters and connect Candidate Board adoption/failure reasons to `proRecipeReview`.
5. Done: Add a Model Library Download / partial cleanup panel that separates running/stale/failed jobs and orphan `.partial` issues, with main-process guards against discarding active downloads.
6. Done: Add checkpoint profile `relatedModels` for related LoRA / VAE / ControlNet references with role, weight, and notes.
7. Done: Surface checkpoint profile `relatedModels` in Preflight and Prompt Composer as non-blocking model-related notes.
8. Done: Add persistent Prompt Composer Slot templates with save/load/delete in the Composer panel.
9. Done: Add Prompt Library use-case recipes that append purpose bundles to Prompt Composer Slots or Prompt/Negative.
10. Done: Add Candidate Board purpose labels for social/reference use and selected-candidate seed / CFG / LoRA-weight derivation actions into txt2img settings.
11. Done: Add Reference Board in Tools with labeled-history import, current-image capture, Workspace save/restore, and routes into img2img, Inpaint setup, and ControlNet Unit 1.
12. Done: Add Upscale finish comparison metadata, finish failure checklist, and automatic Pro Recipe save for adopted Upscale history results.
13. Done: add focused Personal Health DOM QA for the Tools health card, recovery API surface, and five Forge-ready startup signal categories.
14. Done: run completion audit against the original objective. See `7_completion_audit.md`.

## Verification

- `npm.cmd run typecheck`
- `npm.cmd run build`
- Relevant DOM QA: selectors, personal health, history review, candidate board, reference board, upscale finish, and any new focused fixture.
- `git diff --check` after docs or scripts change.
