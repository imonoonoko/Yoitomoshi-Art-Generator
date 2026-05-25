# Prompt Daijiten Large Dictionary UI Prompt

## Screen: Prompt Daijiten Panel

### Purpose

Let the user search a large prompt dictionary from Japanese or English and insert the chosen English tag into Positive Prompt, Negative Prompt, or Prompt Composer slots.

### Layout Diagram

```text
+--------------------------------------------------+
| Prompt大辞典                         [filters]   |
+--------------------------------------------------+
| [ search: 手 / hand / 髪 / 光 ...              ] |
|  results: 24    source: local dictionary          |
+--------------------------------------------------+
| hands                                general tag  |
| 手。両手、手の形、手元の描写に関係する基本語。       |
| aliases: 手, 両手, hand, hands                    |
| [挿入] [ネガへ] [Slot] [コピー] [★]               |
+--------------------------------------------------+
| hand on hip                         pose/action  |
| 腰に手を当てるポーズ。自信や立ち姿の強調。           |
| [挿入] [ネガへ] [Slot] [コピー] [★]               |
+--------------------------------------------------+
```

### Primary Components

- Search input: Japanese and English query entry, debounced.
- Filter row: category, model family, source, adult/deprecated visibility.
- Result list: virtualized or paginated list for large result sets.
- Result card: English tag, Japanese label, meaning, source/category, actions.
- Details drawer: full explanation, related tags, aliases, source history, examples.
- User controls: favorite, hide, edit note, report wrong translation.

### User Flow

1. User opens Prompt Daijiten inside txt2img.
2. User types `手`.
3. App queries dictionary service.
4. Results appear ranked by direct Japanese alias, category relevance, commonness, and user history.
5. User clicks `挿入`, `ネガへ`, `コピー`, or slot insertion.
6. User can star a result or edit the Japanese note without touching the base dictionary.

### Design Tone

- Style: match existing Yoitomoshi dense tool panels.
- Color: use existing theme tokens.
- Density: compact, searchable, repeated-use friendly.
- Avoid large explanatory onboarding text inside the panel.

### Implementation Prompt

Build a compact dictionary panel that queries `api.promptDictionary.search` instead of loading all entries. Keep the existing Prompt Daijiten location in `PromptPanel`. The search box should accept Japanese/English input and display ranked results with English tag, Japanese label, Japanese meaning, category, source badge, and action buttons. Add filters only as small controls; the main action is fast search and insertion. Use stable `data-testid` selectors for search, result count, rows, and action buttons. Do not depend on visible i18n strings for DOM QA.
