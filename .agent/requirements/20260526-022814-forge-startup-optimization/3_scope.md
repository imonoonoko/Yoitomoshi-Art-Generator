# Scope

## In

- Conservative startup argument defaults in `electron/forge-manager.ts`.
- Environment variables that reduce telemetry/backend probing and package-manager startup noise.
- Faster local API readiness polling.
- Measurement through existing startup metrics and Personal Health DOM QA.
- Documentation of remaining optional knobs for later phases.

## Out

- Removing user models, extensions, or runtime folders.
- Disabling all extra extensions by default, because ADetailer, Regional Prompter, AnimateDiff, WD14 Tagger, and Ultimate Upscale can be part of the personal workflow.
- `--skip-load-model-at-start` as a default, because it shifts cost to first generation and can weaken the "ready to generate" contract.
- Replacing Forge runtime or updating Torch/CUDA packages in this pass.
