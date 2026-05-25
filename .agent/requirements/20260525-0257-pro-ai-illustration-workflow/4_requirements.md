# Pro AI Illustration Workflow Requirements

## 1. Pro Recipe Review

### Requirements

- Each `HistoryItem` may store a separate Pro Recipe review object.
- The review object must not replace `tagReview`.
- The review object must support:
  - rating;
  - strengths;
  - issues;
  - next actions;
  - optional score fields for thumbnail, composition, lighting, color, anatomy, style consistency, and reuse potential;
  - optional parent history ID;
  - updated timestamp.
- Invalid review data must not break the whole History list.

### Acceptance Criteria

- Existing history without the field still loads.
- A user can add, update, and clear review data.
- Review data persists across app restart.
- Existing favorite/candidate/rejected/asset labels still work.
- Existing tag review and Prompt Helper reviewed tags still work.

## 2. Model Profile Pro Guidance

### Requirements

- Checkpoint profiles should support model-aware prompt style and production guidance.
- Profiles should distinguish tag-style, natural-language, structured, and hybrid prompt modes.
- Profiles should support negative prompt strategy.
- Profiles should show compatible base model and LoRA notes where known.
- Profile suggestions should integrate with Preflight.

### Acceptance Criteria

- Selecting an SDXL/Illustrious/Pony/Anima-style model can show tag-style guidance.
- Selecting Flux/SD3.5-like profiles can show natural-language or structured guidance.
- Preflight can recommend applying profile params and prompt format.
- Saved profiles remain backward compatible with older JSON.

## 3. Pro Prompt Composer Slots

### Requirements

- Prompt Composer should include optional production slots:
  - subject;
  - composition;
  - expression / pose;
  - lighting;
  - color;
  - outfit / props;
  - background;
  - texture / style;
  - finishing;
  - failures to avoid.
- Output should adapt to the current model profile.
- Protected syntax must remain intact.

### Acceptance Criteria

- Slot input can build a positive prompt.
- Failure avoidance can build or modify a negative prompt.
- Existing cleanup-only Composer still works.
- LoRA syntax, weighted tags, Dynamic Prompt, and `BREAK` are preserved.

## 4. Candidate Board

### Requirements

- Batch generation results should be easy to compare.
- Candidate images should support labels, ratings, and brief notes.
- Selected candidates should be sendable to img2img and Upscale.
- Candidate state should rely on History IDs, not only transient image data.

### Acceptance Criteria

- Batch item index and total count are visible or inspectable.
- Candidate/favorite/rejected states persist.
- Selected image can be reused as base image.
- Selected image can be sent to Upscale.

## 5. Civitai Recipe and Trend Importer

### Requirements

- Civitai lookup should be user-triggered, not startup-blocking.
- The importer should collect baseModel, trainedWords, recommendedPrompts, community stats, common LoRAs, and generation metadata where available.
- The importer must default to safer filters and show license/NSFW/POI cautions.
- API failures must not block generation.

### Acceptance Criteria

- Model Library can refresh Civitai insight for selected entries.
- LoRA prompt hints can use explicit recommended prompt sections only.
- Community metadata can inform model profile and Prompt Composer suggestions.
- Updated/skipped/not-found/failed results are reported.

## 6. Safety and Nonfunctional Requirements

### Requirements

- Do not encourage copying specific artists or scraping SNS images.
- Keep UI additions compact and collapsible.
- Preserve existing top-level tab layout.
- Preserve 8GB VRAM-safe defaults.
- Keep generated/runtime directories out of implementation scope unless explicitly required.

### Acceptance Criteria

- The feature can be used without external APIs.
- When Civitai is unavailable, local generation and History still work.
- The app remains typecheck-clean.
- Relevant DOM QA passes for each touched feature.
