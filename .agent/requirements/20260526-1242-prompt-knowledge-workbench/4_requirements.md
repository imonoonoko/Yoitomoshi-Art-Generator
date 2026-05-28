# Prompt Knowledge Workbench Requirements

## 1. Overview

Prompt Knowledge Workbench is an in-app curation system for Prompt Daijiten. It lets the user inspect imported prompt-tag candidates, improve Japanese labels/meanings, make promotion decisions, and rebuild the searchable runtime dictionary without manually opening SQLite or JSON files.

## 2. User Stories

- As a creator, I want to see what tags were learned from Civitai/local history so that I can trust what enters autocomplete.
- As a creator, I want to fix Japanese translations and meanings so that searching in Japanese stays useful.
- As a creator, I want to hide or reject noisy tags so that bad imports do not pollute normal prompt entry.
- As a creator, I want to filter by missing translation, source, or evidence count so that I can review the highest-impact items first.
- As a future agent, I want source and decision data to stay separated so that future importers can be added safely.

## 3. Acceptance Criteria

### Candidate List

- Given the ingest DB exists, when the workbench opens, then it shows total candidates, review-needed count, accepted count, hidden/rejected count, missing-Japanese count, and source counts.
- Given the user types a search query, when candidates match English tag, Japanese label, meaning, alias, or source text, then the list updates without loading all runtime dictionary rows into renderer memory.
- Given filters are changed, when the query runs, then paging/limit prevents rendering thousands of rows at once.

### Candidate Detail

- Given a candidate is selected, when detail opens, then it displays source breakdown, evidence count, positive/negative count, token kind, current status, Japanese label, Japanese meaning, aliases, and safe sample snippets.
- Given a candidate came from a source that must not expose raw prompts, then raw prompt text is not shown unless the source policy allows it.

### Decisions

- Given a candidate has no decision, when the user chooses accept/hide/reject and saves, then the decision is persisted and reflected in the list.
- Given the user edits Japanese label/meaning, when saved, then the updated text becomes the preferred dictionary text after rebuild.
- Given a candidate is hidden/rejected, when the runtime dictionary is rebuilt, then it does not appear in normal Prompt Dictionary/autocomplete results.

### Rebuild

- Given decisions have changed, when the user runs rebuild, then `resources/prompt-dictionary/prompt-dictionary.sqlite` and manifest are regenerated deterministically.
- Given rebuild fails, then the UI shows the error and keeps previous runtime DB usable.
- Given rebuild succeeds, then `api.promptDictionary.search` returns updated labels/hidden behavior without restarting when technically feasible; otherwise the UI clearly indicates restart/reload is needed.

### Safety

- Given a source is `allowedMode=disabled`, then the UI does not offer import/run actions for it.
- Given adult/sensitive candidates exist, then they are filtered out by default and require an explicit toggle to review.
- Given raw local prompts are staged, then they are not committed or exported into resources.

## 4. User-Facing Nonfunctional Requirements

### Responsiveness

- Opening the workbench should be quick even with tens of thousands of candidates.
- Candidate list queries should be paginated and main-process backed.

### Usability

- The screen should be compact and data-oriented, matching the existing Tools/Prompt panels.
- Common review actions should be one-click but reversible through visible status changes.
- Keyboard-friendly review flow is preferred: next candidate after save, search focus preserved.

### Feedback And Errors

- Empty states explain whether the ingest DB is missing, no sources are enabled, or filters are too narrow.
- Import/rebuild errors show source, command/service, and short error text.
- The UI distinguishes staged candidates from runtime dictionary entries.

## 5. Open Questions

- Should the workbench live under Tools, Tags, or inside the Prompt Dictionary panel?
- Should rebuild be implemented by calling existing scripts from main, or by moving rebuild logic into an Electron service?
- Should translation edits immediately write `translation_jobs`, or should they write only `promotion_decisions` and be merged during build?
- How much local-history sample text should be shown by default?

