# Discussion Log: Prompt Knowledge Workbench

## 2026-05-26 Planning Request

User asked to plan the next large addition after Prompt Daijiten source expansion, explicitly invoking:

- `define-requirements`
- `codex-brain`
- `orchestrate-skills`

Skill stack used:

- `orchestrate-skills`: confirm the requested skill stack and avoid pulling in browser/GitHub/frontend implementation skills before scope is defined.
- `codex-brain`: read `wiki/hot.md`, `wiki/INDEX.md`, search Brain wiki for Yoitomoshi prompt/dictionary context, and treat Brain as an index rather than current proof.
- `define-requirements`: create a durable handoff under `.agent/requirements/`.

Current repo facts:

- Working tree already contains the Prompt Daijiten source expansion work: source registry, staging SQLite schema, Civitai importer, local prompt importer, promoted snapshots, and rebuilt runtime SQLite.
- `docs/maps/02-prompt-management-flow.md` now requires source-governed ingestion into `userdata/prompt-dictionary/ingest.sqlite` and prohibits direct injection into the runtime dictionary.
- Current runtime dictionary after cleanup is 4,343 entries, including 243 Civitai-derived and 140 local-user-prompt-derived runtime entries.
- The staging schema already has `candidate_tags`, `candidate_evidence`, `translation_jobs`, and `promotion_decisions`, but there is no in-app review/curation UI yet.
- Existing app UI already has Prompt Dictionary search/autocomplete, Prompt Library, Prompt Composer, History review, Candidate Board, Model Library, and Civitai metadata paths.

Decision:

- The next large addition should be an in-app `Prompt Knowledge Workbench`, not another bulk importer first.
- Reason: the pipeline can already ingest external/local evidence, but scale will become hard to trust without review queues, Japanese translation cleanup, duplicate merging, source attribution, and rebuild controls.
- This is a Tools-tab or Prompt/Tags-adjacent workbench that turns imported candidates into curated prompt assets.

## 2026-05-26 New Dictionary Tab Direction

User asked to implement Prompt Daijiten as a new tab and check synergy with existing features.

Implementation direction:

- Promote Prompt Daijiten from a small txt2img collapsible panel into a top-level `Dictionary` tab.
- Keep the existing `PromptDictionaryPanel`, `PromptEditor` inline autocomplete, and global autocomplete in place.
- New tab focuses on broad search and cross-workflow handoff:
  - Positive Prompt insert
  - Negative Prompt insert
  - Prompt Composer Slot insert when slot mode is enabled
  - Tags workspace handoff
  - History side panel handoff
  - Civitai/LoRA search handoff
  - source registry / ingest status visibility
- This is intentionally a read/search/handoff surface first. Candidate review/accept/reject remains the later Workbench slice.

## 2026-05-26 Codex Auto Japanese Curation

User wants Codex to handle Japanese label/meaning correction without manual prework.

- Add deterministic Japanese curation rules for imported Prompt Daijiten candidates.
- `scripts/curate-prompt-dictionary-ja.*` updates promoted snapshots before rebuild.
- `scripts/build-prompt-dictionary-db.cjs` reapplies the same curation during runtime SQLite build, so missing snapshot labels still become searchable Japanese draft text.
- Keep `curationStatus=machine-draft` and `translationProvider=yoitomoshi-codex-ja-curation-v1` on automated corrections so later human or LLM review can distinguish them from curated seed entries.
