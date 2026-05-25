# UI Prompt

Design the Pro AI Illustration workflow as an extension of the existing Yoitomoshi Forge Studio UI, not as a new landing page or separate product area.

## Product Feel

- Quiet, practical, production-focused.
- Dense enough for repeated creative work.
- Avoid decorative cards or marketing-style hero sections.
- Favor compact panels, tabs, segmented controls, checkboxes, sliders, icon buttons, and collapsible sections.
- Treat the GUI as a professional production surface: structured controls, stable dimensions, clear state, and fast repeated editing are more important than large explanatory text.

## Primary Surfaces

### History

Add a compact Pro Recipe review area to history items.

Controls:

- label selector using existing favorite/candidate/rejected/asset state;
- rating control;
- rating should use compact buttons or segmented control rather than a generic number field;
- strengths chips or textarea;
- issues chips or textarea;
- next actions textarea;
- optional detailed score section hidden by default.

Expected actions:

- save review;
- clear review;
- send to img2img;
- send to Upscale;
- apply recipe to current prompt/settings where safe.

### Prompt Composer

Add a Pro slots mode inside the existing Composer.

Controls:

- mode segmented control: Cleanup / Pro Slots;
- model-aware output style indicator;
- slot inputs for subject, composition, pose, lighting, color, outfit, background, style, finishing, avoid;
- generate positive prompt;
- update negative prompt;
- preserve existing cleanup and translation feedback.

### Model Library

Add model profile guidance in the model detail area.

Controls:

- prompt style;
- negative strategy;
- recommended aspect ratios;
- recommended LoRA count;
- compatibility notes;
- Civitai insight refresh.

### Candidate Board

Use a grid or horizontal strip, not a new top-level tab.

Controls:

- candidate thumbnails;
- label action buttons;
- rating;
- quick note;
- send to img2img;
- send to Upscale.

## Copy Rules

- Prefer short labels:
  - Pro Recipe
  - 採用
  - 候補
  - 没
  - 改善メモ
  - モデル作法
  - 構図
  - 光
  - 色
- Do not add long explanatory text inside the app.
- Put detailed workflow explanation in docs, not UI.

## QA Selectors

Use stable `data-testid` values for new surfaces, for example:

- `history-pro-recipe-review`
- `history-pro-recipe-rating`
- `history-pro-recipe-save`
- `prompt-composer-pro-slots`
- `model-profile-prompt-style`
- `candidate-board`
- `candidate-card`
