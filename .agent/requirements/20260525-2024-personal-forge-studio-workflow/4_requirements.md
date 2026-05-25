# Requirements

## Startup And Recovery

- Diagnose stale DownloadJob, leftover Electron/Forge processes, broken or normalizable settings, Model Library integrity, orphan partials, and Forge ready delay signals.
- Provide Tools > Personal Environment Health.
- Split slow Forge ready evidence into Python/Torch, extension loading, ControlNet, model/checkpoint/VAE, and API readiness polling.
- Safe recovery may normalize settings and recover stale download/model-library state. Destructive process stop or partial deletion requires explicit user action.

## History Search

- Search 497+ history items across prompt, negative prompt, model, sampler, LoRA names, prompt/tag review tags, Pro Recipe notes, rating, and labels.
- Provide one-click filters for successful recipes, rejected items, asset/material items, and favorites.
- Show the useful review memo in the history list, not only inside the edit panel.

## Download And Model Library Cleanup

- Detect and safely recover or discard stale running DownloadJob state.
- Make orphan `.partial` files understandable from UI.
- Aggregate checkpoint / LoRA / VAE / ControlNet relationships into model profiles.

## Medium Priority

- Prompt assets: reusable Prompt Composer Slot templates, model-specific good/avoid/LoRA-count guidance, recipe-oriented tag dictionary.
- Candidate Board: adoption/failure reasons, seed/CFG/LoRA-weight derivation actions, usage labels.
- Reference Board: reference/pose/color/character-source workspace, unified send-to ControlNet/img2img/Inpaint, source notes.
- Upscale finishing: clearer Tile/denoise/Ultimate comparisons, quality checklist, adopted settings saved to Pro Recipe.
