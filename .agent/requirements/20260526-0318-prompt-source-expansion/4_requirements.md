# Requirements

## Functional Requirements

### Source Registry

- The system must define every external source in a structured registry before import.
- Each source must include:
  - `sourceId`
  - `displayName`
  - `sourceType`: `api`, `dataset`, `local`, `manual`, `blocked`
  - `allowedMode`: `enabled`, `manual-only`, `disabled`
  - `baseUrl`
  - `termsUrl`
  - `licenseNote`
  - `rateLimitRps`
  - `storesRawPrompts`
  - `storesImages`: must default to false
  - `adultPolicy`
  - `checkedAt`
- The importer must refuse to run a source with `allowedMode=disabled`.

### Staging Database

- Raw imported prompts must go into a local staging DB, not directly into the shipped dictionary DB.
- Staging must track:
  - source record ID / cursor
  - positive prompt
  - negative prompt
  - model family hints
  - resources such as checkpoint/LoRA names when available
  - NSFW/adult flags when available
  - fetched timestamp
  - parse status and errors
- Raw prompts from external sources must be removable by source ID.

### Prompt Parsing

- Parser must produce candidate tokens with:
  - raw token
  - canonical tag candidate
  - token kind: `tag`, `phrase`, `negative`, `resource`, `artist`, `character`, `copyright`, `quality`, `unknown`
  - weight if present
  - source prompt position
  - confidence
- Parser must not treat LoRA syntax as a normal dictionary tag.
- Parser must preserve Danbooru-style underscores as canonical aliases.
- Parser must keep negative prompt evidence separate from positive prompt evidence.

### Candidate Merging

- Candidate entries must merge by canonical normalized tag.
- Evidence must be aggregated by source, model family, positive/negative polarity, and occurrence count.
- Existing user-curated Japanese labels must outrank imported or machine-generated labels.
- Entries must support a `blocked` or `hidden` state without deleting their evidence.

### Japanese Translation And Meaning

- Translation must be staged with status:
  - `curated`
  - `source-derived`
  - `machine-draft`
  - `needs-review`
  - `rejected`
- Japanese label and Japanese meaning must be separate fields.
- Machine translations must not overwrite curated labels.
- The UI/search layer may search machine drafts, but should visually mark non-curated entries.

### Promotion To Runtime Dictionary

- Promotion must produce dictionary rows compatible with current `PromptDictionaryEntry`.
- The generated SQLite DB must remain renderer-safe: renderer only queries through IPC.
- Promotion must be incremental and reproducible from source registry plus staging DB.
- Manifest must include source counts, entry counts, skipped counts, and build timestamp.

### UI/Workflow

- A Prompt Daijiten import manager should expose:
  - source list
  - enabled/disabled state
  - last run status
  - candidate count
  - review queue count
  - promote/rebuild action
- Search results should show source labels and curation status.
- The review queue should allow quick edits of Japanese label/meaning and hide/reject actions.

## Non-Functional Requirements

- Import must be resumable and rate-limited.
- Import must be cancelable.
- No API keys or secrets may be stored in repo files.
- External raw prompt corpora must not be committed to Git.
- SQLite search must remain fast for at least 100k promoted entries.
- The build process must be deterministic enough that CI/local rebuilds do not reorder unrelated entries randomly.

## Acceptance Criteria

- Running a Civitai sample import can ingest at least 500 public image metadata records without downloading images.
- The parser extracts positive/negative candidate tags and identifies LoRA/resource tokens separately.
- The staging DB can dedupe repeated tags across sources and retain source evidence counts.
- A promoted DB rebuild increases `manifest.entryCount` and preserves existing curated seed tags.
- `手` search still returns hand-related entries after expansion.
- `npm.cmd run typecheck` passes.
- Dictionary DB changes are verified with a search smoke test.

## Open Questions

- Whether to ship expanded source-derived entries in repo or keep most expanded data in `userdata/` only.
- Whether Civitai prompt metadata should be stored raw or only tokenized evidence by default.
- Which translation provider should be used for draft labels if local translation runtime is unavailable.
- Whether artist/character tags should be enabled by default or separated into optional packs.
