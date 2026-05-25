# Discussion Log

## 2026-05-25 02:57 JST

User asked to use `$define-requirements` to create a roadmap for moving from the Pro AI illustration research report into implementation.

Inputs inspected:

- `docs/PRO_AI_ILLUSTRATION_WORKFLOW_RESEARCH_REPORT_2026-05-25.html`
- `docs/ROADMAP.md`
- `src/shared/types.ts`
- `src/lib/checkpoint-prompt-profile.ts`
- `electron/storage.ts`
- existing `.agent/requirements/20260524-0436-forge-prompt-composer-port/`
- memory entries for Prompt Composer, Civitai prompt extraction, Model Library, and History labels

Decision:

- Use a new roadmap document in `docs/` as the main implementation handoff.
- Use this `.agent/requirements/` folder for durable requirement breakdown.
- Start with History / Pro Recipe review because existing `HistoryItem`, labels, generation params, LoRA, ControlNet, and Upscale metadata already provide a safe local anchor.
- Keep `tagReview` for tag review and add a separate Pro Recipe review field.
- Treat external model backends as a later optional phase, not the first implementation step.

## 2026-05-25 Implementation Start

Implemented the Phase 1 foundation:

- added `HistoryProRecipeReview` and optional `HistoryItem.proRecipeReview`;
- added `storage:set-history-pro-recipe-review` through IPC, preload, and storage;
- added History UI controls for rating, strengths, issues, and next actions;
- added i18n strings for ja/en/ru/pt;
- updated history and IPC maps.
- adjusted the History Pro Recipe GUI toward a production-tool surface: compact rating buttons and vertically readable review fields.

Initial verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.
- `npm.cmd run qa:dom:api -- --port=9338` passed.
- `npm.cmd run qa:dom:history-pro-recipe -- --port=9338` passed.
- `npm.cmd run qa:dom:history-review -- --port=9338` passed.

## 2026-05-25 Phase 2 GUI / Model Profile Pro

Implemented the Phase 2 Model Profile Pro foundation:

- extended `CheckpointPromptProfile` with `baseModel`, prompt style, negative strategy, recommended aspect ratios, LoRA count range, compatibility notes, and recipe notes;
- added default profile guidance by checkpoint family, including tag-style defaults for SDXL/anime families and natural-language defaults for Flux;
- added storage normalization for the new model profile fields without requiring migration of existing JSON;
- added compact pro editing controls to Model Library checkpoint cards;
- added Preflight warnings for model profile aspect-ratio mismatch and LoRA count range mismatch;
- added a Quick Fix for model profile aspect ratio;
- added a Sidebar Workspace refresh button so direct workspace changes used by DOM QA can be reloaded through the GUI;
- added `qa:dom:model-profile-pro`.

GUI progress screenshot:

- `docs/screenshots/model-profile-pro-gui-2026-05-25.png`

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.
- `npm.cmd run qa:dom:model-profile-pro -- --port=9338` passed.
- `npm.cmd run qa:dom:preflight -- --port=9338` passed.
- `npm.cmd run qa:dom:workspace-preflight -- --port=9338` passed.

## 2026-05-25 Phase 3 Prompt Composer Slots

Implemented the first Phase 3 Pro Prompt Composer Slots pass:

- added a pure slot composer in `src/lib/prompt-composer.ts`;
- added compact visual-spec slots to `PromptComposerPanel`;
- wired slot output to Positive Prompt and the dedicated "avoid failures" slot to Negative Prompt;
- connected the Composer surface to the selected checkpoint prompt profile's `promptStyle` and `negativeStrategy`;
- kept the existing primary compose, cleanup-only, model-aware formatting, and Tags tab quick-add paths;
- extended `qa:dom:prompt-composer` to exercise slot Positive/Negative application and the existing Tags workspace bridge.

GUI progress screenshot:

- `docs/screenshots/prompt-composer-slots-gui-2026-05-25.png`

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.
- `npm.cmd run qa:dom:prompt-composer -- --port=9338` passed.
- `npm.cmd run qa:dom:prompt-format -- --port=9338` passed.

## 2026-05-25 Phase 4 Candidate Board

Implemented the first Phase 4 Candidate Board pass:

- added a latest-batch Candidate Board to `HistoryGallery`;
- surfaced `batchSize`, `imageIndex`, `imageCount`, seed, and dimensions on candidate cards;
- added candidate/favorite/rejected label controls directly on the board;
- added board actions to send the selected history image to img2img, Upscale, and Pro Recipe review;
- added an img2img send button to regular history cards;
- added `qa:dom:candidate-board`, which creates temporary batch history, reloads the app, verifies the board, saves labels, sends to img2img/Upscale, opens Pro Recipe, and deletes temporary history.

GUI progress screenshot:

- `docs/screenshots/candidate-board-gui-2026-05-25.png`

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.
- `npm.cmd run qa:dom:candidate-board -- --port=9338` passed.

## 2026-05-25 Phase 5 Civitai Recipe / Trend Importer

Implemented the first Phase 5 pass:

- added `ModelSourceMetadata.trainedWords` and `recommendedPrompts`;
- normalized those fields in storage for existing Model Library JSON compatibility;
- routed LoRA / LyCORIS / LoCon Model Library Civitai refresh through `fetchLoraByHash()` so Civitai trigger words and recommended prompt snippets persist into `sourceMeta`;
- kept checkpoint Civitai refresh storing `trainedWords`;
- changed community sample mining default to `nsfw=false`;
- added Model Library Recipe hint chips and a user-triggered Recipe trend panel backed by cached community stats;
- added Prompt Composer recipe hints from active LoRA Civitai metadata;
- added fixture-based DOM QA `qa:dom:model-library-recipe`.

GUI progress screenshot:

- `docs/screenshots/model-library-recipe-gui-2026-05-25.png`

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.
- `npm.cmd run qa:dom:model-library-recipe -- --port=9338` passed.
