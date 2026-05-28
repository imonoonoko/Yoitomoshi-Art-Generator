# Prompt Knowledge Workbench Purpose

## Problem

Prompt Daijiten now has a source-governed ingestion pipeline, but imported candidates are still mostly managed by scripts and generated snapshots. As the database grows from thousands to tens of thousands of tags, script-only curation will become opaque: noisy tags, weak Japanese labels, duplicates, adult/sensitive tags, source disagreements, and promotion decisions need a visible workflow.

## Target User

The primary user is the local Yoitomoshi Forge Studio creator who wants a large Japanese-first prompt dictionary that improves over time from Civitai metadata, local history, existing libraries, and future licensed datasets.

Secondary users are future agents expanding the dictionary without breaking provenance, legal constraints, or runtime search performance.

## Current Workaround

- Run import scripts manually.
- Inspect JSON/SQLite output directly.
- Rebuild `resources/prompt-dictionary/prompt-dictionary.sqlite`.
- Search the final dictionary from Prompt Editor / Prompt Dictionary UI.
- Fix bad candidates by changing scripts or promoted snapshots.

## Why Now

The base ingestion pipeline exists. Civitai and local-history sources have already produced real candidate data. The next bottleneck is trust and maintainability, not raw collection volume.

## Desired Outcome

Yoitomoshi gains an in-app workbench where imported prompt-tag candidates can be reviewed, translated, merged, hidden/rejected, promoted, and rebuilt into the runtime dictionary with clear source attribution.

## Success Definition

- Imported candidates are reviewable without opening SQLite or JSON by hand.
- The user can search/filter candidates by Japanese/English text, source, status, token kind, polarity, adult level, evidence count, and missing translation.
- Accept/hide/reject/translate decisions persist in `promotion_decisions` or a compatible local overlay.
- Runtime dictionary rebuilds remain deterministic and do not require committing raw prompts.
- Prompt Editor/autocomplete quality improves because curated terms outrank noisy imported evidence.

