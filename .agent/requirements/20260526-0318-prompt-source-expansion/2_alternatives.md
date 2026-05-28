# Alternatives

## Option A: Unrestricted Scraper

Collect prompts from every visible AI illustration site by crawling pages.

Verdict: Reject.

Why:

- High legal/ToS risk.
- Cloudflare/session bypass pressure.
- Inconsistent HTML and hidden prompt metadata.
- Hard to reproduce and explain.
- Creates source contamination that cannot safely be redistributed.

## Option B: API-Only Importer

Use only official/public APIs such as Civitai images API and booru JSON/DAPI endpoints.

Verdict: Use as the core, with source policy checks.

Why:

- Reproducible, resumable, rate-limitable.
- Easier to attribute source and fetched cursor.
- Fits Electron main-process service boundary.

Tradeoff:

- Does not cover sites without APIs.
- Some APIs expose incomplete metadata or unstable query behavior.

## Option C: Public Dataset Importer

Import prompt corpora from Hugging Face datasets and other explicitly licensed text datasets.

Verdict: Use selectively.

Why:

- Large scale quickly.
- Dataset cards expose license and schema.
- Text-only Parquet/import can avoid downloading images.

Tradeoff:

- Many datasets are natural-language or non-anime; they need stronger scoring before promotion.
- License quality varies. Each dataset must be source-registered before use.

## Option D: Manual/User-Owned Imports

Let the user import local prompt logs, PNG metadata, JSON/CSV/TXT files, and exported site data.

Verdict: Use in MVP.

Why:

- Lowest external risk.
- Immediately useful for the user's own workflow.
- Can improve personal suggestions without redistributing third-party prompt text.

Tradeoff:

- Corpus size depends on user data.

## Option E: Tag Vocabulary First, Prompt Corpus Later

First import canonical tag metadata from booru-style tag systems, then use prompt corpora to rank and translate those tags.

Verdict: Use.

Why:

- Booru tags map better to anime model prompting than arbitrary natural-language prompts.
- Prompt corpora provide frequency/co-occurrence evidence without becoming the primary source of truth.

Recommended path:

1. Source registry and staging DB.
2. Civitai public image metadata sample importer.
3. User-owned/local prompt metadata importer.
4. DiffusionDB/Hugging Face prompt dataset text importer.
5. Danbooru-style tag metadata importer.
6. Translation/review workflow.
