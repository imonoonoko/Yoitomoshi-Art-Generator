# Discussion Log

## 2026-05-27 03:26 JST

User asked to further expand Prompt Daijiten tags, strengthen autocomplete feel, enumerate all existing functions, discover synergies, and create an HTML report. Explicit skills requested: `define-requirements` and `orchestrate-skills`.

Working assumptions:

- Preserve the existing source-governed corpus boundary: external/raw provider data stays in `userdata/prompt-dictionary/ingest.sqlite`; runtime dictionary receives only promoted/summarized candidates.
- Adult-leaning tags are not filtered only because they are adult-leaning; unsafe minor/non-consensual/bestiality terms are not promoted as adult vocabulary.
- Keep implementation small enough for this pass: add one high-yield vocabulary importer, improve result metadata in autocomplete/search UI, and produce a report that maps existing features to synergies.
