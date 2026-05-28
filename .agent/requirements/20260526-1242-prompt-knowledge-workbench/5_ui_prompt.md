# Prompt Knowledge Workbench UI Prompt

## Screen: Prompt Knowledge Workbench

### Purpose

Let the user curate imported Prompt Daijiten candidates before they become normal autocomplete/search entries.

### Layout Diagram

```text
+------------------------------------------------------------------+
| Prompt Knowledge Workbench                  [Refresh] [Rebuild]  |
+------------------------------------------------------------------+
| Sources / Status                                                 |
| [Local prompts 548] [Civitai 135] [Review 1,204] [Missing JA 0]  |
+-------------------------------+----------------------------------+
| Filters                       | Candidate Detail                 |
| Search [______________]       | tag: clean_white_background      |
| Source [All v] Status [New v] | JA: きれいな白い背景             |
| [ ] Missing JA                | Meaning [____________________]   |
| [ ] Sensitive                 | Source evidence                  |
| Sort [Evidence desc v]        | - local-user-prompts: 58         |
+-------------------------------+                                  |
| Candidate List                | Aliases                          |
| > clean_white_background      | [白背景] [clear background]      |
|   three-quarter_view          |                                  |
|   bad_composition             | [Accept] [Hide] [Reject] [Save] |
|   ...                         |                                  |
+-------------------------------+----------------------------------+
```

### Primary Components

- Header: shows feature name, refresh action, rebuild action, and last rebuild state.
- Source status row: compact source chips with imported record counts, candidate counts, warning badges, and allowed mode.
- Filter column: search, source, status, token kind, polarity, adult/sensitive toggle, missing Japanese toggle, sort.
- Candidate list: paginated rows with English tag, Japanese label, source badge, evidence count, and status.
- Candidate detail: editable Japanese label/meaning, aliases, source evidence, sample snippets, decision buttons.
- Rebuild confirmation: summarizes changed decisions and affected output files before running.

### User Flow

1. User opens Tools or Tags and selects Prompt Knowledge Workbench.
2. Workbench loads source/ingest summary and first page of review-needed candidates.
3. User filters to missing Japanese labels or high-evidence local tags.
4. User selects a candidate, edits label/meaning, accepts or hides it.
5. User rebuilds the runtime dictionary.
6. Prompt Editor/autocomplete uses the updated dictionary.

### Design Tone

- Style: quiet operational tool, not a marketing panel.
- Color: existing dark theme tokens and source/status badges.
- Density: high-density but readable, similar to Model Library / History review.
- Cards: avoid card-in-card. Use split panes and compact rows.

### Implementation Prompt

Build a compact data workbench for Prompt Daijiten curation. Use the existing Yoitomoshi dark theme, small controls, and stable `data-testid` selectors. The candidate list must be virtualized or paginated and fetched through IPC. Do not load raw SQLite data directly in renderer. Keep source attribution visible on every candidate. Adult/sensitive candidates are hidden by default. Include empty/loading/error states for missing ingest DB, no matching candidates, and rebuild failure. Rebuild is a deliberate action with a confirmation summary.

