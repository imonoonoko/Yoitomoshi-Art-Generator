# Prompt Knowledge Workbench Alternatives

## Codebase Findings

- Runtime Prompt Daijiten search is already main-process SQLite/FTS-backed via `api.promptDictionary.search`.
- Ingestion status/source inspection exists at IPC level via `promptDictionary.listSources` and `promptDictionary.inspectIngest`.
- Staging DB schema already has the tables needed for a curation UI: `candidate_tags`, `candidate_evidence`, `translation_jobs`, and `promotion_decisions`.
- `docs/maps/02-prompt-management-flow.md` requires staging in `userdata/prompt-dictionary/ingest.sqlite` and source registry governance.
- History review and Candidate Board already provide UI patterns for compact review, labels, and prompt reuse.

## Options

### Option A: Keep Growing Import Scripts Only

Effort: Medium  
Value: Medium

Summary:
Add DiffusionDB/Hugging Face importer next, increase raw candidate volume, and continue using JSON snapshots.

Benefits:
- Fastest path to a larger headline count.
- Reuses existing importer architecture.

Tradeoffs:
- More noisy data before there is a review system.
- Japanese quality and duplicate merging will become harder.
- User cannot easily curate or undo source-specific mistakes.

### Option B: Build Prompt Knowledge Workbench

Effort: Large  
Value: High

Summary:
Create an in-app review/curation surface over the staging DB and promoted snapshots. It focuses on trust, translation, status decisions, and rebuild controls.

Benefits:
- Makes future bulk imports safer.
- Converts imported evidence into a personal creative asset system.
- Gives the user direct control over what enters Prompt Daijiten.
- Reuses existing Prompt Dictionary, History review, and Tools patterns.

Tradeoffs:
- Larger UI + IPC surface.
- Needs careful DB write validation and deterministic rebuild behavior.

### Option C: Model-Specific Prompt Contracts First

Effort: Large  
Value: High

Summary:
Use model/Civitai/community prompt evidence to build per-checkpoint prompt contracts: required triggers, recommended negatives, sampler/CFG/size, LoRA compatibility, and style packs.

Benefits:
- Direct generation quality impact.
- Strong synergy with Model Library and Prompt Composer.

Tradeoffs:
- Depends on clean prompt evidence and curation.
- Without Workbench, model contracts may inherit noisy tags.

## Recommendation

Choose Option B first: Prompt Knowledge Workbench.

It is the correct next large addition because it stabilizes the data product before adding larger datasets or more automated recommendations. After this exists, Option A and Option C become lower-risk follow-ups.

