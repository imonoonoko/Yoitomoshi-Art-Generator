# Forge Prompt Composer Port Requirements

## 1. Overview
Forge版に全モデル共通の `Prompt Composer` を導入し、日本語自然文、英語タグ、LoRA構文、重み付きタグが混ざった入力を、生成に使いやすい英語タグ列へ整える。ComfyUI版と同じ考え方に揃えつつ、Forge版の既存タグ管理、PromptTagChips、QuickPreset、preflight、履歴レビュー連携を維持する。

## 2. User Stories
- As a creator, I want to type rough Japanese in the prompt area, so that I can quickly get usable English prompt tags.
- As a creator, I want the same Composer in the Tags tab, so that tag management and prompt creation use one mental model.
- As a creator, I want LoRA and weighted syntax preserved, so that cleanup does not break working prompts.
- As a creator, I want existing tag chips and quick presets to keep working, so that the new Composer does not remove familiar editing tools.
- As a creator, I want translation failures to be understandable, so that I can still use local dictionary cleanup without being blocked.

## 3. Acceptance Criteria

### Shared Composer In txt2img
- Given the user is on `txt2img`, when they enter `コスプレ、初音ミク、ダンスシーン` and run Composer, then the positive prompt becomes `cosplay, hatsune miku, dance scene`.
- Given the prompt contains `masterpiece, 初音ミク, <lora:miku:0.8>, ダンスシーン`, when Composer runs, then `<lora:miku:0.8>` remains unchanged.
- Given the prompt contains `(blue eyes:1.2), BREAK, {smile|serious}`, when Composer runs, then the protected syntax remains usable.
- Given there is no Japanese or cleanup needed, when Composer runs, then the UI reports that there is no meaningful change rather than rewriting unexpectedly.

### Shared Composer In Tags Workspace
- Given the user opens `タグ管理`, when they enter `コスプレ、初音ミク、ダンスシーン` in the quick-add Composer, then the tags are appended as `cosplay`, `hatsune miku`, and `dance scene`.
- Given the user selects positive or negative target, when Composer appends tags, then the selected target receives the tags.
- Given the user uses the old manual quick-add field, when they enter comma/newline/Japanese punctuation separated text, then the same parser rules apply.

### Existing Editing Is Preserved
- Given a prompt has tag chips, when the user moves selected chips to negative or positive, then the existing move behavior still works.
- Given a prompt has weighted tags, when the user adjusts weights through `PromptTagChips`, then the existing weight behavior still works.
- Given a QuickPreset exists, when the user applies or saves it, then Composer changes do not break the preset workflow.
- Given preflight finds prompt formatting issues, when the user applies the quick fix, then existing `formatPromptText()` behavior still works.

### Translation And Fallback
- Given the input is covered by local dictionary or prompt library, when Composer runs, then it works without network.
- Given unresolved Japanese text remains and a free translation provider is available, when Composer runs, then it attempts Japanese-to-English translation.
- Given translation fails or is unavailable, when Composer runs, then protected syntax and locally resolved tags are still preserved, and the user gets a clear warning.

### UI Clarity
- The Composer title must not say Anima-only.
- The positive prompt area should show one primary Composer block instead of multiple scattered translate/format/model buttons.
- The Tags tab should expose Composer near quick add, not as a separate distant helper.
- Existing History review tag affordances must not disappear without an equivalent replacement.

## 4. User-Facing Nonfunctional Requirements

### Responsiveness
- Local dictionary and cleanup should feel immediate.
- First translation runtime preparation may take longer, but the UI must show status.

### Usability
- Buttons must be compact enough for the existing Forge sidebar width.
- Labels should be short: Composer, 英訳して整える, 整形, モデル調整.
- Users should not need to know whether the result came from dictionary, prompt library, or translation provider.

### Accessibility
- Composer buttons must have accessible titles and visible disabled states.
- Existing `data-testid`-based QA selectors should remain stable.

### Feedback And Errors
- Empty input: show an informational toast.
- No changes: show a non-error message.
- Translation unavailable: show warning, not a hard stop if local conversion succeeded.
- Partial translation failure: keep original unresolved segment rather than deleting it.

## 5. Open Questions
- Should `PromptHelperPanel` remain as a collapsible advanced helper, or should its History review tags be split into a smaller dedicated panel?
- Should Forge prompt全文翻訳 reuse the existing fetch-based Google endpoint, or port the ComfyUI版 deep-translator runtime for consistency?
- Should negative prompt also receive a dedicated Composer block in MVP, or keep negative as format/model buttons only?
