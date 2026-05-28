# Scope

## In Scope

- Source registry that records allowed mode, terms URL, license note, rate limit, NSFW policy, and whether raw prompt storage is allowed.
- Local staging database under `userdata/prompt-dictionary/` for raw prompts, extracted tags, source cursors, evidence counts, and translation review state.
- Importers for:
  - Civitai public image metadata via API with `withMeta=true`.
  - Local PNG metadata/history/workspace prompt data.
  - User-provided JSON/CSV/TXT prompt lists.
  - Hugging Face prompt datasets with acceptable licenses.
  - Booru-style tag metadata where API/TOS permit use.
- Prompt parser for:
  - comma-separated tag prompts
  - weighted tags such as `(tag:1.2)`
  - LoRA/resource tokens such as `<lora:name:0.8>`
  - Dynamic Prompt braces and alternatives
  - negative prompts
  - natural language phrase extraction
- Candidate normalization:
  - lower-case canonical form
  - underscore/space aliases
  - duplicate merging
  - source evidence merge
  - polarity inference
  - adult/safety flags
  - deprecated/blocked flags
- Japanese enrichment:
  - curated glossary first
  - source wiki/description when available
  - machine/LLM translation as draft only
  - review status per entry
- Promotion from staging to dictionary build:
  - auto-promote safe, high-confidence canonical tags
  - hold ambiguous/adult/person-name/artist tags for review
  - keep user overrides intact

## Out Of Scope

- Downloading or mirroring images.
- Training models on collected prompts.
- Reposting or redistributing raw third-party prompt dumps.
- Bypassing Cloudflare, auth walls, private APIs, robots, rate limits, or account/session restrictions.
- Scraping HTML from sites that do not provide a documented public API or explicit export/data license.
- Treating machine translation as final curated Japanese meaning.
- Enabling unrestricted NSFW prompt harvesting by default.

## Source Policy Defaults

| Source class | Default mode | Notes |
|---|---|---|
| Civitai public API | Use now | Public images endpoint can expose `meta.prompt`/`negativePrompt`; use API only, rate limit, no images |
| Local/user-owned data | Use now | Safe for personal dictionary and evidence scoring |
| Hugging Face datasets | Use selectively | Require dataset card/license check; prefer text-only prompts |
| Danbooru-style tag APIs | Use selectively | Good canonical tag vocabulary; obey documented rate limits and source terms |
| Gelbooru bulk API | Skip MVP | DAPI exists, but current TOS prohibits automated retrieving/indexing; allow only manual/user-provided import unless terms are clarified |
| PixAI/Yodayo/TensorArt/SeaArt/Lexica/PromptHero/etc. | Skip automated import | Use only if official API/export/license is confirmed |

## Safety Boundary

The feature is a local personal knowledge tool. It must not become a public scraper, image mirror, or redistributed third-party prompt corpus.
