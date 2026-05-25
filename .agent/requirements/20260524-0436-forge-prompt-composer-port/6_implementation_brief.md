# Forge Prompt Composer Port Implementation Brief

## Existing Patterns
- `src/components/PromptPanel.tsx`: prompt sidebar, current translate/format/model buttons, `RefineModePanel`, `PromptTagChips`, `QuickPresetBar`.
- `src/components/PromptTagsWorkspace.tsx`: Prompt Library plus quick add and positive/negative tag editors.
- `src/components/PromptHelperPanel.tsx`: local heuristic helper and History review tag bridge.
- `src/lib/prompt-utils.ts`: `formatPromptText()`, protected LoRA formatting, prompt append/remove, split tokens, dedupe.
- `src/lib/prompt-translate.ts`: local phrase rules and prompt library matching.
- `electron/ipc-handlers.ts`, `electron/preload.ts`, `src/shared/ipc-channels.ts`, `src/shared/types.ts`: existing tag translation IPC.
- `scripts/dom-qa.cjs`: existing selectors, `prompt-format`, prompt-helper-review, history-review tests.
- ComfyUI版 reference:
  - `..\Yoitomoshi-Art-Generator-ComfyUI\src\lib\prompt-composer.ts`
  - `..\Yoitomoshi-Art-Generator-ComfyUI\src\components\PromptComposerPanel.tsx`
  - `..\Yoitomoshi-Art-Generator-ComfyUI\electron\prompt-translation-runtime.ts`
  - `..\Yoitomoshi-Art-Generator-ComfyUI\scripts\dom-qa.cjs`

## Likely Touch Points
- Add `src/lib/prompt-composer.ts`.
- Add `src/components/PromptComposerPanel.tsx`.
- Update `src/components/PromptPanel.tsx`.
- Update `src/components/PromptTagsWorkspace.tsx`.
- Update `src/lib/i18n.ts` for `promptComposer.*` in ja/en/ru/pt.
- Update `scripts/dom-qa.cjs` and `package.json` for `qa:dom:prompt-composer`.
- If prompt全文翻訳 is included in MVP, port or adapt:
  - `electron/prompt-translation-runtime.ts`
  - `resources/python/deep_translate_prompt.py`
  - IPC channels/types/preload entries for `translation.promptText`, `translation.promptRuntimeStatus`, and optionally prepare/status.

## Technical Assumptions
- Keep `formatPromptText()` as the final cleanup layer so Forge prompt-format behavior stays consistent.
- Use the Composer dictionary and prompt library lookup before calling any network-backed translator.
- Preserve the existing `translation:prompt-tag` API for PromptTagChips library translation; do not replace it in the same pass unless necessary.
- Use Google via `deep-translator` only as a free personal-use convenience, with cache and local fallback.
- Treat the current Forge worktree as dirty; do not revert unrelated changes.

## Suggested Implementation Phases
1. Pure logic phase: add `prompt-composer.ts`, wire it to `prompt-utils` and `prompt-translate`, add focused unit-style or DOM helper coverage where available.
2. UI phase: add `PromptComposerPanel`, replace scattered positive prompt controls, add Composer to Tags Workspace, remove duplicate main `PromptHelperPanel` only after history-review affordances are preserved.
3. Translation phase: either wire existing free Google endpoint for prompt segments or port ComfyUI deep-translator runtime. Keep dictionary-only path working without network.
4. QA phase: add `qa:dom:prompt-composer`, update selectors and prompt-helper-review expectations, run typecheck/build/DOM smoke.
5. Cleanup phase: review UI duplication, i18n labels, docs note, and `git diff --check`.

## Risks
- Existing `PromptHelperPanel` has History review tags; deleting it outright could remove a useful Forge-only workflow.
- Deep-translator runtime touches Electron, bundled resources, Python dependency install, cache, and IPC types; it should be isolated from the pure Composer logic.
- DOM QA for React-controlled textareas must use direct value setters plus input events, not naive assignment.
- Existing dirty files may contain user work; implementation must patch around them.

## Test Plan
- `npm.cmd run typecheck`
- `npm.cmd run build`
- `npm.cmd run qa:dom -- selectors --port=9338`
- `npm.cmd run qa:dom:prompt-format -- --port=9338`
- `npm.cmd run qa:dom:prompt-composer -- --port=9338`
- Keep or adapt `npm.cmd run qa:dom:prompt-helper-review -- --port=9338` so History review tag behavior remains covered.
- `git diff --check`

## Acceptance Smoke Example
```json
{
  "txt2imgPrompt": "masterpiece, hatsune miku, <lora:miku:0.8>, dance scene",
  "tagsPrompt": "cosplay, hatsune miku, dance scene",
  "tagsComposer": true
}
```

## Open Questions
- Should negative prompt get a Composer block in MVP, or remain format/model-only to keep the sidebar compact?
- Should `PromptHelperPanel` become a hidden advanced panel, or should its history-review part be extracted into Tags Workspace?
- Should the first implementation include deep-translator runtime, or start with dictionary/library/local rules and add runtime in the second slice?
