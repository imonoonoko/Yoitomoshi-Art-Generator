# Forge Prompt Composer Port UI Prompt

## Screen: txt2img Sidebar Prompt Area

### Purpose
The user can type rough Japanese or mixed prompt text directly in the normal positive prompt workflow, then clean and translate it into model-ready English tags without leaving the prompt area.

### Layout Diagram
```text
+------------------------------------------------+
| Prompt                                  141 tok |
| [Quick Preset chips / save controls]           |
| +--------------------------------------------+ |
| | Prompt Composer                 ready   ↻ | |
| | [英訳して整える] [整形] [モデル調整] [辞書] | |
| | optional hints / negative suggestions       | |
| +--------------------------------------------+ |
| [positive prompt editor]                       |
| [tag chips / weights / move controls]          |
+------------------------------------------------+
| Negative                                35 tok |
| [Quick Preset] [整形] [モデル調整]              |
| [negative editor]                             |
| [negative tag chips]                          |
+------------------------------------------------+
```

### Primary Components
- Prompt Composer: shared conversion toolbar for Japanese natural language, mixed English tags, punctuation cleanup, and protected syntax handling.
- Prompt Editor: existing textarea remains the source of truth.
- PromptTagChips: existing chip editing, weight adjustment, moving, dedupe operations remain.
- QuickPresetBar: existing preset workflow remains above the Composer.
- Negative prompt controls: keep existing format/model controls for MVP unless Composer is explicitly added to negative later.

### User Flow
1. User types `コスプレ、初音ミク、ダンスシーン` in the positive prompt editor.
2. User clicks `英訳して整える`.
3. Prompt becomes `cosplay, hatsune miku, dance scene`.
4. User edits chips, changes weights, or saves a quick preset as before.
5. If model-specific tuning is needed, user clicks `モデル調整`.

### Design Tone
- Style: match existing Forge dark, dense, utilitarian sidebar.
- Color: use existing accent and border tokens, no new decorative palette.
- Density: compact toolbar, no large explanatory card.

### Implementation Prompt
Implement a compact `PromptComposerPanel` in the positive prompt area. It should reuse the existing theme classes, lucide icons, and toast patterns. Keep stable `data-testid` values: `prompt-composer`, `prompt-composer-primary`, `prompt-composer-translate`, `prompt-composer-model-tune`, `prompt-composer-dictionary`, `prompt-composer-status`. Preserve legacy hidden test ids for `prompt-format-positive` and `prompt-model-format-positive` if existing DOM QA still expects them.

## Screen: Tags Workspace

### Purpose
The user can use the same Composer while building a tag list in the Tags tab.

### Layout Diagram
```text
+--------------------------------------------------------------+
| Promptタグ管理              Positive 66 / tok  Negative 12   |
+----------------------+---------------------------------------+
| Prompt Library       | +-----------------------------------+ |
|                      | | Prompt Composer              ready | |
|                      | | [英訳して整える] [整形] [辞書]      | |
|                      | +-----------------------------------+ |
|                      | [Positive/Negative] [manual input] [+]|
|                      | [quality group] [composition] ...     |
|                      | [Positive editor] [Negative editor]   |
+----------------------+---------------------------------------+
```

### Primary Components
- Tags Workspace Composer: same component with `mode="append"` and `testId="tags-workspace-composer"`.
- Target selector: existing positive/negative segmented control remains.
- Manual quick add: remains for direct comma-separated tags, but uses the Composer parser.
- PromptLibrary and TagEditor panels: unchanged.

### User Flow
1. User opens Tags tab.
2. User selects Positive or Negative target.
3. User enters Japanese or mixed tags into quick add.
4. User clicks Composer primary action.
5. Parsed English tags append to the selected target.

### Implementation Prompt
Place `PromptComposerPanel` at the top of `tags-workspace-quick-add`. Use `mode="append"`, `clearOnApply`, and an `onApplyTags` callback that appends through existing `promptAppend()`. Replace the local `parseTagInput()` with `parsePromptComposerTags()` so manual add and Composer agree.
