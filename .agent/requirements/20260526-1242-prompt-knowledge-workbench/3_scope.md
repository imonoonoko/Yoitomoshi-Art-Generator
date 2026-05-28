# Prompt Knowledge Workbench Scope

## MVP

- Add an in-app workbench for Prompt Daijiten ingestion and curation.
- Show source registry and ingest database status.
- List candidate tags from staging DB with filters:
  - source
  - status
  - token kind
  - polarity
  - adult level
  - evidence count
  - missing Japanese label
  - search text
- Show candidate detail:
  - English tag / canonical tag
  - Japanese label and meaning
  - aliases
  - source evidence counts
  - positive/negative counts
  - sample text snippets when legally/local-source appropriate
  - current promotion decision
- Allow decisions:
  - accept
  - hide
  - reject
  - edit Japanese label
  - edit Japanese meaning
  - add alias
  - mark as negative-only
- Persist decisions into staging DB, preferably `promotion_decisions` plus `translation_jobs` updates.
- Add a controlled rebuild action that regenerates promoted snapshots/runtime dictionary through existing scripts or main-side service.
- Add DOM QA fixture for the workbench list, filters, decision save, and status refresh.

## Nice To Have

- Batch accept/hide/reject visible candidates.
- Duplicate merge suggestions by normalized tag and Japanese label similarity.
- "Promote all high-confidence safe candidates" guarded by preview and count.
- Candidate-to-Prompt-Library insertion for hand-curated tags.
- Source-specific purge/rebuild when one source produces bad data.
- Related tag suggestions from co-occurrence.
- Translation draft helper using existing local heuristic plus optional existing translation runtime.

## Future

- Hugging Face DiffusionDB importer gated behind source/license review.
- Model-specific Prompt Contracts generated from curated candidates and Civitai/community stats.
- Character/artist lookup integration from allowed APIs/datasets.
- Per-model or per-checkpoint ranking of tags in autocomplete.
- User-facing "learning from my history" dashboard that explains what Yoitomoshi learned.

## Out Of Scope

- HTML scraping, login/session scraping, Cloudflare bypassing, or image downloading.
- Copying another creator's full Japanese prompt dictionary without permission.
- Automatic publication or sharing of user local prompt history.
- Replacing Prompt Editor/autocomplete search architecture.
- Loading all dictionary rows into renderer memory.
- Making adult/sensitive tags visible by default.

## Constraints

- Deadline: none, but MVP should be sliceable.
- Team/resources: single local developer/agent workflow.
- Technology: Electron main IPC, React renderer, TypeScript, SQLite staging DB, current `node:sqlite` runtime.
- Budget/cost: local-first, no paid service dependency.
- Compatibility/compliance: keep raw prompts in ignored `userdata/`; committed resources must be normalized and source-attributed.

