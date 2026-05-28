# Prompt Meaning Enrichment Reliability Alternatives

## Codebase Findings

- `scripts/enrich-prompt-dictionary-meanings.cjs` already has provider-specific lookup functions, cache writes, suggestion building, and `--dry-run` / `--apply` modes.
- `resources/prompt-dictionary/ingest-schema.sql` has staging tables, so reliability metadata can stay in `userdata` and avoid polluting the shipped runtime DB.
- `scripts/build-prompt-dictionary-db.cjs` already applies deterministic Japanese curation during runtime DB build.
- `docs/maps/02-prompt-management-flow.md` already defines the safe source-expansion boundary.

## Options

### Option A: Confidence Gates Only

Effort: Small  
Value: Medium

Summary:
Add `--min-confidence`, source-specific thresholds, and stronger skip reasons.

Benefits:
- Fast to implement.
- Reduces obvious false positives.

Tradeoffs:
- Does not fully solve reproducibility or regression risk.
- External API behavior can still change silently.

## Option B: Evidence Pipeline With Fixtures

Effort: Medium  
Value: High

Summary:
Add confidence gates, provider result normalization, cache/audit metadata, offline fixtures, and scripted regression checks.

Benefits:
- Makes changes explainable and testable.
- Lets us expand providers safely.
- Supports CI-like verification without repeatedly hitting external APIs.

Tradeoffs:
- Requires fixture maintenance.
- More code paths than the current exploratory script.

## Option C: LLM-Based Meaning Review

Effort: Medium to Large  
Value: Medium

Summary:
Use an LLM to translate/summarize provider evidence and judge ambiguity.

Benefits:
- Better prose and nuance when evidence is good.

Tradeoffs:
- Adds cost, credentials, model drift, and hallucination risk.
- Not required for the immediate reliability layer.

## Recommendation

Use Option B first. It strengthens the current script without introducing a new provider or dependency. LLM review can be layered later after deterministic gates and audit data exist.

