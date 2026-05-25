# Prompt Daijiten Large Dictionary Requirements

## 1. Overview

Prompt Daijiten Large Dictionary is a local prompt-tag knowledge base for Yoitomoshi Forge Studio. It lets the user search in Japanese or English and returns English image-generation prompt tags with Japanese translations, meanings, usage notes, and insertion actions. The large dictionary must be stored and queried as an indexed data product, not as a giant UI-loaded YAML file.

## 2. User Stories

- As a creator, I want to type "手" and see hands-related English tags, so I can compose prompts without remembering exact tag names.
- As a creator, I want Japanese meanings beside each English tag, so I can choose the right tag instead of only copying a string.
- As a creator, I want one-click Positive, Negative, Copy, and Slot insertion, so the dictionary stays inside my normal generation workflow.
- As a creator, I want favorites and custom notes, so my personal prompt knowledge becomes more useful over time.
- As a maintainer, I want source metadata and update provenance, so large imports remain auditable.

## 3. Acceptance Criteria

### Japanese Concept Search

- Given the dictionary panel is open, when the user types `手`, then hands-related entries appear without requiring the English word `hand`.
- Given the user types a Japanese body/pose/object concept, when dictionary entries have matching aliases or meanings, then relevant English prompt tags appear.
- Given the user types English fragments such as `hand`, then matching English tags appear.
- Given no result exists, then the UI clearly shows an empty state and does not clear the current prompt.

### Result Content

- Each result shows the English prompt tag.
- Each result shows a Japanese translation or label.
- Each result shows a Japanese meaning or usage explanation when available.
- Each result shows category/source hints compactly.
- Deprecated or risky tags are visually distinguishable.

### Prompt Actions

- Positive insert appends to the existing prompt or active Prompt Composer slot.
- Negative insert appends to the negative prompt.
- Copy copies the English tag only.
- Actions do not overwrite existing prompt text.

### Data Storage

- The app does not load the full large dictionary into renderer state on startup.
- Runtime search uses a query API with pagination/limit.
- The immutable base dictionary is separate from user edits.
- The data format has a schema version.
- The source of imported entries is recorded at pack/source level and, where possible, entry level.

### Updates And User Edits

- Rebuilding or replacing the base dictionary does not delete user favorites, hidden tags, or custom notes.
- User overrides are keyed by stable tag identity, not by row order.
- If a tag is renamed or deprecated, the UI can still show the old name as alias or migration note.

### Source Safety

- External tag names and metadata may be imported only after source terms are checked.
- Long external wiki explanations are not copied into the app unless licensing/permission is explicit.
- Machine-generated Japanese meanings must be marked as generated/draft until curated.

## 4. User-Facing Nonfunctional Requirements

### Responsiveness

- Search should feel instant for normal queries.
- Typing should debounce queries to avoid unnecessary work.
- Opening the panel should not block the app while loading a huge dataset.

### Usability

- The panel remains compact and work-focused.
- Results are grouped or ranked so common tags appear before obscure low-count tags.
- Japanese queries should support short terms such as `手`, `目`, `髪`, `胸`, `光`, `座る`.
- English tags should preserve prompt-safe formatting.

### Accessibility

- Search input has a stable label or accessible name.
- Result actions are reachable by keyboard.
- State is not conveyed by color alone.

### Feedback And Errors

- If the dictionary database is missing or corrupt, show a repair/import prompt.
- If source update fails, keep the last local dictionary available.
- If the query service fails, the app should not break Prompt editing.

## 5. Open Questions

- Which SQLite/search runtime should be used in packaged Electron on Windows?
- Should the first large source be Danbooru tag metadata, a curated prompt autocomplete CSV, or a Yoitomoshi-authored seed pack?
- How much generated Japanese explanation is acceptable before human curation?
- Which categories should be enabled by default: general, character, copyright, artist, meta?
- Should NSFW/adult tags be included, hidden by default, or managed by filter?
- Should dictionary packs be repo-managed, downloadable, or user-imported?
