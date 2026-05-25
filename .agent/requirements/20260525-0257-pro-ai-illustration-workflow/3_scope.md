# Scope

## In Scope

- Add Pro Recipe review data to generated History items.
- Preserve existing History labels and tag review behavior.
- Extend checkpoint prompt profiles with model-aware production guidance.
- Extend Prompt Composer with production slots.
- Add candidate comparison and handoff to img2img / Upscale.
- Expand Civitai metadata usage for model, LoRA, prompt, and community recipe insight.
- Keep all changes compatible with existing Forge generation flow.

## Out of Scope for MVP

- Replacing Forge with ComfyUI.
- Adding a new top-level Pro tab.
- Training LoRA or checkpoints.
- Scraping SNS images or copying specific artists.
- Making paid cloud APIs required.
- Full FLUX.2 / Qwen / Hunyuan / Z-Image runtime support.
- Automatic public posting or SNS automation.

## Constraints

- Windows / PowerShell environment.
- Use `npm.cmd run <script>` for npm scripts.
- Preserve `runtime/`, `userdata/`, `output/`, `out/`, `dist/`, and `node_modules/` unless explicitly needed.
- Keep `extension-payload.ts` contracts intact.
- Use `data-testid` for DOM QA, not localized text.
- Avoid broad refactors while many uncommitted changes exist.

## Dependencies

- Existing History storage and IPC.
- Existing Prompt Composer and prompt translation runtime.
- Existing checkpoint prompt profile storage.
- Existing Model Library and Civitai metadata enrichment.
- Existing History review DOM QA scripts.
