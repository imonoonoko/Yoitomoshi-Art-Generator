# Implementation Brief

## Recommended First PR

Implement Phase 1 foundation:

1. Add `HistoryProRecipeReview` type.
2. Add optional `HistoryItem.proRecipeReview`.
3. Add storage normalization and setter.
4. Add IPC channel and preload API.
5. Add compact History UI for rating, strengths, issues, and next actions.
6. Add DOM QA coverage for persistence.

## Phase 2 Current Implementation

Implemented after the first PR foundation:

1. Extend `CheckpointPromptProfile` with professional guidance fields:
   `baseModel`, `promptStyle`, `negativeStrategy`, `recommendedAspectRatios`, `recommendedLoraCount`, `compatibilityNotes`, and `recipeNotes`.
2. Initialize those fields from checkpoint family and Civitai `baseModel` where available.
3. Keep storage backward-compatible by normalizing missing or invalid profile fields.
4. Add compact Model Library checkpoint controls for model-specific prompt style, negative policy, LoRA count, recommended ratios, compatibility notes, and recipe notes.
5. Add Preflight warnings for profile aspect-ratio mismatch and LoRA count range mismatch.
6. Add DOM QA command `qa:dom:model-profile-pro`.
7. Add GUI screenshot evidence at `docs/screenshots/model-profile-pro-gui-2026-05-25.png`.

## Phase 3 Current Implementation

Implemented after the Model Profile Pro foundation:

1. Add `composePromptSlots()` in `src/lib/prompt-composer.ts`.
2. Add visual-spec slots to `PromptComposerPanel`:
   subject, composition, expression/pose, lighting, color, clothing/props, background, texture/style, finishing, and avoid failures.
3. Read `CheckpointPromptProfile.promptStyle` and `negativeStrategy` in the Composer UI.
4. Generate Positive Prompt from visual-spec slots.
5. Generate Negative Prompt only from the avoid-failures slot.
6. Preserve existing Compose, cleanup-only, model-aware formatting, and Tags tab quick-add behavior.
7. Extend `qa:dom:prompt-composer` and capture GUI screenshot evidence at `docs/screenshots/prompt-composer-slots-gui-2026-05-25.png`.

## Files To Inspect Before Editing

- `src/shared/types.ts`
- `electron/storage.ts`
- `src/shared/ipc-channels.ts`
- `electron/preload.ts`
- `electron/ipc-handlers.ts`
- `src/lib/ipc.ts`
- `src/components/HistoryGallery.tsx`
- `src/components/PromptHelperPanel.tsx`
- `src/lib/i18n.ts`
- `scripts/dom-qa.cjs`
- `docs/maps/04-history-metadata-flow.md`
- `docs/maps/05-electron-ipc-flow.md`

## Suggested Type Shape

```ts
export interface HistoryProRecipeReview {
  rating?: number | null
  strengths: string[]
  issues: string[]
  nextActions: string[]
  scores?: {
    thumbnail?: number | null
    composition?: number | null
    lighting?: number | null
    color?: number | null
    anatomy?: number | null
    styleConsistency?: number | null
    reusePotential?: number | null
  }
  parentHistoryId?: string | null
  updatedAt: number
}
```

## Storage Notes

- Keep the field optional.
- Normalize arrays to short string arrays.
- Clamp rating and score values.
- If review is null, write null or remove based on existing storage style.
- Do not migrate the whole history file unless needed.

## IPC Notes

Add a dedicated setter instead of overloading `setHistoryTagReview`.

Suggested channel:

- `storage:set-history-pro-recipe-review`

Suggested API:

- `api.storage.setHistoryProRecipeReview(id, review)`

## UI Notes

- Keep History item layout compact.
- Do not show all score fields in MVP.
- Use a collapsible review editor or inline compact editor.
- Keep existing label and tag review affordances.

## Verification

Minimum:

- `npm.cmd run typecheck`
- `npm.cmd run qa:dom:history-review -- --port=9338`
- `npm.cmd run qa:dom:history-review-persistence -- --port=9338`
- `git diff --check`

If `PromptHelperPanel` integration is touched:

- `npm.cmd run qa:dom:prompt-helper-review -- --port=9338`

If IPC surface changes:

- `npm.cmd run qa:dom:api -- --port=9338`

## Phase 4 Current Implementation

Candidate Board is now implemented in the History side panel as the first production GUI for batch selection.

Implemented:

- latest generated batch grouping from existing `HistoryItem.params.batchSize`, `imageIndex`, and `imageCount`;
- compact board cards with index, seed, dimensions, current label, and Pro Recipe rating;
- direct `favorite`, `candidate`, and `rejected` label controls;
- direct send to `img2img`, Upscale, and Pro Recipe review;
- regular History card `img2img` send action;
- DOM QA script `qa:dom:candidate-board`;
- screenshot artifact `docs/screenshots/candidate-board-gui-2026-05-25.png`.

Verified:

- `npm.cmd run typecheck`
- `npm.cmd run build`
- `npm.cmd run qa:dom:candidate-board -- --port=9338`

## Phase 5 Current Implementation

Civitai Recipe / Trend Importer is now implemented as a user-triggered Model Library workflow, with Prompt Composer handoff for active LoRA metadata.

Implemented:

- `ModelSourceMetadata.trainedWords` and `recommendedPrompts`;
- LoRA-family Civitai refresh via `fetchLoraByHash()` so trigger words and recommended prompt snippets are saved;
- checkpoint Civitai refresh preservation of `trainedWords`;
- `nsfw=false` as the community mining default;
- Model Library Recipe hint chips and cached community trend panel;
- Prompt Composer Recipe hints from active LoRA Civitai metadata;
- DOM QA script `qa:dom:model-library-recipe`;
- screenshot artifact `docs/screenshots/model-library-recipe-gui-2026-05-25.png`.

Verified:

- `npm.cmd run typecheck`
- `npm.cmd run build`
- `npm.cmd run qa:dom:model-library-recipe -- --port=9338`

## Risks

- Existing history JSON can be large. Avoid unnecessary rewrites beyond the changed item.
- UI can become dense. Keep advanced scoring hidden until needed.
- `tagReview` and Pro Recipe review can be confused. Keep names and headings distinct.
- Many repo files are already modified. Keep implementation diffs narrow.
