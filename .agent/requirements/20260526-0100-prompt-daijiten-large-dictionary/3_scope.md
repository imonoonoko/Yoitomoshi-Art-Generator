# Prompt Daijiten Large Dictionary Scope

## MVP

- Replace renderer-side all-entry search with a dictionary query API.
- Support Japanese concept search:
  - `手` finds hands-related tags.
  - `髪` finds hair-related tags.
  - `胸` finds breast/chest-related tags.
  - `光` finds lighting-related tags.
  - English fragments still work.
- Each result includes:
  - English prompt tag.
  - Japanese display label.
  - Japanese meaning/explanation.
  - Category/type.
  - Related aliases/search terms.
  - Source summary.
  - Insert Positive / Insert Negative / Copy / Slot insertion action.
- Store data in a scalable format, not one huge YAML file.
- Keep existing small `prompt-dictionary.yoitomoshi.ja.yaml` as seed/curated source.
- Add source and update metadata.
- Add a small build/import script that can ingest a seed dataset and produce the runtime dictionary artifact.

## Nice To Have

- Result ranking using usage history, post count, favorites, and model family.
- Related tag clusters:
  - hand anatomy.
  - hand pose.
  - hand-object interaction.
  - hand quality/negative fixes.
- Model-family filters:
  - SD1.5 anime.
  - Pony.
  - Animagine.
  - Illustrious/NoobAI.
  - Anima.
- User edit overlay:
  - custom Japanese translation.
  - custom meaning.
  - favorite.
  - hide/deprioritize.
  - "works well with this model".
- Import from existing autocomplete CSV/tag lists if source terms permit.
- Optional online refresh for Danbooru tag metadata.

## Future

- Dictionary update manager with downloadable packs.
- CivitAI prompt evidence mining that records real usage examples without copying large external descriptions blindly.
- Animadex character/artist bridge: character search can open dictionary tags and related LoRA suggestions.
- Semantic Japanese search using a local embedding index or lightweight bilingual synonym table.
- Tag conflict warnings and prompt recipe suggestions.

## Out Of Scope

- Copying another creator's entire Japanese prompt dictionary without permission.
- Treating generated machine translations as confirmed meanings.
- Live external API search on every keystroke.
- Storing generated images or external wiki bodies inside the dictionary database unless source rights and scope are explicitly approved.
- Replacing Prompt Composer or Prompt Library; this feature should extend them.

## Constraints

- Platform: Windows / Electron / React / TypeScript.
- Current package has no SQLite/search dependency; storage dependency choice needs a small spike.
- App startup must remain fast.
- Renderer should not receive the full dictionary.
- Data source licensing and attribution must be tracked before large imports.
- User edits must survive base dictionary rebuilds.
- Existing prompt insertion behavior must remain append-oriented and non-destructive.
