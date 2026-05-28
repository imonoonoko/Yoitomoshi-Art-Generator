# Prompt Meaning Enrichment Reliability Purpose

## Problem

Prompt Daijiten can now collect candidate tags and look up meaning evidence from external sources, but the script can still produce plausible-sounding wrong drafts when a provider returns a near match, a redirect, a work title, or a generic dictionary sense.

## Target User

Yoitomoshi Forge Studio users who rely on the in-app Prompt Daijiten autocomplete, Dictionary tab, and prompt helper flows while generating AI illustration prompts in Japanese.

## Current Workaround

Run `dictionary:enrich:meanings` in `--dry-run`, inspect JSON manually, then decide whether to apply. This does not scale to thousands of tags.

## Why Now

The dictionary is moving from a small hand-written seed into an automated source-expansion pipeline. Bad explanations at scale will make autocomplete less trustworthy and harder to clean later.

## Desired Outcome

New tags can be enriched automatically, but only when evidence is strong enough. Low-confidence or ambiguous cases are skipped or kept as machine draft with clear reasons.

## Success Definition

- High-confidence exact Danbooru wiki/tag matches become useful `source-derived` drafts.
- Ambiguous Wikidata/Wiktionary/Civitai-only matches do not overwrite better local or curated text.
- Every applied change can be explained by stored evidence, confidence, provider, and skip/apply reason.

