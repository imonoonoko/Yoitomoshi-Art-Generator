# Requirements

## Functional

- The app must continue to launch Forge in API-only mode.
- Existing txt2img/img2img/ControlNet/Upscale/Prompt workflows must remain available.
- First-run or dependency-changed launches must still allow install/environment checks.
- Repeated launches after a successful ready marker may skip redundant checks.
- Personal Health must continue to show startup phase signals.

## Acceptance Criteria

- `npm.cmd run typecheck` passes.
- `npm.cmd run build` passes.
- `npm.cmd run qa:dom:api -- --port=9338` passes.
- `npm.cmd run qa:dom:personal-health -- --port=9338` passes.
- A post-change startup sample reaches Forge ready and is recorded in `userdata/startup-metrics.jsonl`.
- No test requires destructive edits to `runtime/`, `userdata/`, `output/`, or model files.

## Risks

- Skipping CUDA checks can hide a broken driver only if applied too early. Mitigation: only add it when the install-ready marker is current.
- Disabling extension loading globally would speed startup but break workflows. Mitigation: keep extension disablement opt-in or per known UI-only extension only.
- PyTorch allocator flags can improve steady-state inference but may be hardware/workload dependent. Mitigation: keep the user's explicit `--cuda-malloc` setting, do not add more allocator flags blindly.
