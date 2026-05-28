# Project And GitHub Cleanup Inventory

Snapshot date: 2026-05-29

No deletion, reset, branch deletion, or GitHub setting change has been performed in this inventory pass.

## Classification Legend

| Class | Meaning |
|---|---|
| `COMMIT` | Valuable project source/docs/data. Review and commit in a scoped change. |
| `KEEP_LOCAL` | Local operational state. Keep out of Git and do not delete during cleanup. |
| `DISPOSABLE` | Rebuildable or generated clutter. Delete only through a reviewed allowlist. |
| `CONFIRM` | Needs a user decision before commit, deletion, or GitHub mutation. |

## Current Summary

| Area | Current State | Cleanup Judgment |
|---|---|---|
| Git branch | `main`, tracking `origin/main` | Keep. Do not reset. |
| Worktree | 65 changed paths: 23 modified tracked, 42 untracked | Classify before any cleanup. |
| Main local size | `runtime/` 41.65 GB, `node_modules/` 0.77 GB, `userdata/` 0.73 GB, `output/` 0.03 GB | Runtime/userdata are local app state; node/out/output are disposable only by allowlist. |
| GitHub repo | `imonoonoko/Yoitomoshi-Art-Generator`, public | Metadata/settings cleanup useful after local state is coherent. |
| Secret scan | Focused scan over changed/untracked text files found expected variable names and docs references, not literal tokens in the sampled output | Repeat before commit, especially for reports and generated candidate data. |

## Top-Level Folder Inventory

| Path | Class | Action |
|---|---|---|
| `.agent/` | `COMMIT` with review | Existing `.agent/requirements` files are already tracked. New project-facing handoffs can be committed after public-content review. |
| `.git/` | `KEEP_LOCAL` | Git internal state. Do not touch manually. |
| `build/` | `CONFIRM` | Empty/small at snapshot; inspect if it becomes populated. |
| `docs/` | `COMMIT` with review | Public docs and reports. Review local paths and stale public/private claims before commit. |
| `electron/` | `COMMIT` | App main/preload/source code. Verify with typecheck. |
| `node_modules/` | `DISPOSABLE` | Reinstallable. Safe deletion only when no active dev server/build needs it. |
| `out/` | `DISPOSABLE` | Build output. Can be removed by allowlist. |
| `output/` | `DISPOSABLE` with review | Generated screenshots/log-like output. Review first if recent QA evidence is needed. |
| `resources/` | `COMMIT` or `CONFIRM` | Bundled assets belong in Git; externally derived/generated dictionary candidate data needs source/license review. |
| `runtime/` | `KEEP_LOCAL` | Forge runtime, models, extensions, Python/Git state. Do not delete in repo cleanup. |
| `scripts/` | `COMMIT` | Project automation and QA scripts. Verify before commit. |
| `src/` | `COMMIT` | Renderer source. Verify with typecheck/targeted DOM QA. |
| `userdata/` | `KEEP_LOCAL` | Settings, secrets, history, caches. Do not commit or delete in repo cleanup. |

## Modified Tracked Paths

These 23 paths are already tracked and appear to be one Prompt Dictionary / Dictionary tab feature bundle plus docs updates. Treat them as `COMMIT` candidates after verification.

| Path | Class | Action |
|---|---|---|
| `docs/AI_PROJECT_MAP.md` | `COMMIT` | Dictionary tab/project map update. |
| `docs/DOCS_INDEX.md` | `COMMIT` | Adds report links; verify linked files are intended to be tracked. |
| `docs/ROADMAP.md` | `COMMIT` | Adds Prompt Daijiten source-governed direction. |
| `docs/maps/02-prompt-management-flow.md` | `COMMIT` | Updates prompt flow with Dictionary workspace and source registry. |
| `electron/ipc-handlers.ts` | `COMMIT` | Prompt Dictionary/source/status IPC surface changes; typecheck required. |
| `electron/preload.ts` | `COMMIT` | Exposes new API surface; typecheck required. |
| `electron/prompt-dictionary-db.ts` | `COMMIT` | Expanded SQLite/FTS query behavior; test and typecheck required. |
| `electron/prompt-dictionary.ts` | `COMMIT` | Service changes for source registry/ingest status; typecheck required. |
| `package.json` | `COMMIT` | Adds dictionary ingest/import/enrich scripts and DOM QA entry. |
| `resources/prompt-dictionary.yoitomoshi.ja.yaml` | `COMMIT` | Bundled dictionary content change; review generated/manual boundary. |
| `resources/prompt-dictionary/manifest.json` | `COMMIT` | Dictionary manifest update; keep with DB/source changes. |
| `resources/prompt-dictionary/prompt-dictionary.sqlite` | `COMMIT` with verification | Bundled generated DB grew from about 4.8 MB to 12.2 MB. Rebuild/repro check before commit. |
| `scripts/build-prompt-dictionary-db.cjs` | `COMMIT` | DB builder expansion; test required. |
| `scripts/dom-qa.cjs` | `COMMIT` | Adds prompt dictionary workspace QA. |
| `src/App.tsx` | `COMMIT` | Adds Dictionary top-level surface wiring. |
| `src/components/MainTabs.tsx` | `COMMIT` | Adds/renames tab. |
| `src/components/PromptDictionaryAutocompleteLayer.tsx` | `COMMIT` | Autocomplete behavior changes; DOM QA recommended. |
| `src/components/PromptDictionaryPanel.tsx` | `COMMIT` | Panel changes; DOM QA recommended. |
| `src/components/PromptEditor.tsx` | `COMMIT` | Prompt editor autocomplete changes; DOM QA recommended. |
| `src/lib/i18n.ts` | `COMMIT` | Adds UI strings. |
| `src/lib/store.ts` | `COMMIT` | Store shape/default changes. |
| `src/shared/ipc-channels.ts` | `COMMIT` | IPC channel additions. |
| `src/shared/types.ts` | `COMMIT` | Shared types for new dictionary/source behavior. |

## Untracked Paths

| Path | Class | Action |
|---|---|---|
| `.agent/requirements/20260526-0318-prompt-source-expansion/` | `COMMIT` with review | Durable requirements; existing `.agent/requirements` convention is tracked. Review public suitability. |
| `.agent/requirements/20260526-1242-prompt-knowledge-workbench/` | `COMMIT` with review | Durable requirements; review public suitability. |
| `.agent/requirements/20260526-1346-prompt-meaning-enrichment-reliability/` | `COMMIT` with review | Durable requirements; review public suitability. |
| `.agent/requirements/20260527-0326-prompt-daijiten-autocomplete-synergy/` | `COMMIT` with review | Durable requirements; review public suitability. |
| `.agent/requirements/20260529-0304-project-github-cleanup/` | `COMMIT` with review | Current cleanup handoff and inventory. |
| `docs/LORA_OPTIMAL_SETTINGS_PRIMARY_SOURCE_2026-05-28.md` | `COMMIT` with review | Useful LoRA settings report; review local model names and source quotations before public commit. |
| `docs/PROMPT_DAIJITEN_AUTOCOMPLETE_SYNERGY_REPORT_2026-05-27.html` | `COMMIT` with review | Linked from docs index; review local paths and public suitability. |
| `docs/PROMPT_DAIJITEN_BEST_PRACTICES_RESEARCH_2026-05-26.html` | `COMMIT` with review | Linked from docs index; review source/citation/public suitability. |
| `docs/YOITOMOSHI_FORGE_STUDIO_REVIEW_2026-05-27.html` | `COMMIT` with review | Linked from docs index; review local metrics/paths. |
| `electron/prompt-dictionary-ingest.ts` | `COMMIT` | New main-process ingest module. |
| `electron/prompt-dictionary-source-registry.ts` | `COMMIT` | New source registry module. |
| `resources/prompt-dictionary/ingest-schema.sql` | `COMMIT` | Schema for local/staged dictionary ingest. |
| `resources/prompt-dictionary/promoted-candidates.civitai-red-public-images.json` | `CONFIRM` | Generated/external candidate data with red/adult source implication. Review licensing, content, size, and whether repo should ship it. |
| `resources/prompt-dictionary/promoted-candidates.civitai.json` | `CONFIRM` | Generated Civitai-derived candidate data. Review source policy before commit. |
| `resources/prompt-dictionary/promoted-candidates.danbooru-adult-tags.json` | `CONFIRM` | Adult tag dataset. Review public repo suitability before commit. |
| `resources/prompt-dictionary/promoted-candidates.danbooru-tag-metadata.json` | `CONFIRM` | Danbooru-derived metadata. Review source/license/public suitability. |
| `resources/prompt-dictionary/promoted-candidates.local.json` | `KEEP_LOCAL` | Local-history-derived candidate data. Keep ignored and out of public Git; local importer now writes the default snapshot under `userdata/prompt-dictionary/`. |
| `resources/prompt-dictionary/promoted-candidates.web.json` | `CONFIRM` | Web-derived candidate data. Review source/license/public suitability. |
| `resources/prompt-dictionary/sources.json` | `COMMIT` | Source registry contract; commit with importer/schema code if source policy is accepted. |
| `scripts/curate-prompt-dictionary-ja.cjs` | `COMMIT` | Dictionary curation script. |
| `scripts/curate-prompt-dictionary-ja.ps1` | `COMMIT` | PowerShell wrapper. |
| `scripts/enrich-lora-optimal-settings.cjs` | `COMMIT` with review | Useful LoRA settings helper; reads local userdata. Review no hardcoded secrets or private-only paths. |
| `scripts/enrich-prompt-dictionary-meanings.cjs` | `COMMIT` | Meaning enrichment script. |
| `scripts/enrich-prompt-dictionary-meanings.ps1` | `COMMIT` | PowerShell wrapper. |
| `scripts/fixtures/` | `COMMIT` | Small test fixtures for meaning enrichment. |
| `scripts/import-civitai-prompt-dictionary.cjs` | `COMMIT` | Importer script. |
| `scripts/import-civitai-prompt-dictionary.ps1` | `COMMIT` | PowerShell wrapper. |
| `scripts/import-danbooru-adult-tags.cjs` | `COMMIT` with review | Importer for adult tag source; review public intent. |
| `scripts/import-danbooru-adult-tags.ps1` | `COMMIT` with review | PowerShell wrapper. |
| `scripts/import-danbooru-tag-metadata.cjs` | `COMMIT` | Importer script. |
| `scripts/import-danbooru-tag-metadata.ps1` | `COMMIT` | PowerShell wrapper. |
| `scripts/import-local-prompt-dictionary.cjs` | `COMMIT` with caution | Local importer; ensure generated local data is not committed blindly. |
| `scripts/import-local-prompt-dictionary.ps1` | `COMMIT` | PowerShell wrapper. |
| `scripts/import-web-prompt-dictionary.cjs` | `COMMIT` | Web importer script. |
| `scripts/import-web-prompt-dictionary.ps1` | `COMMIT` | PowerShell wrapper. |
| `scripts/init-prompt-dictionary-ingest.cjs` | `COMMIT` | Ingest DB initializer. |
| `scripts/init-prompt-dictionary-ingest.ps1` | `COMMIT` | PowerShell wrapper. |
| `scripts/prompt-dictionary-ja-curation.cjs` | `COMMIT` | Curation helper. |
| `scripts/review-prompt-dictionary-meanings.cjs` | `COMMIT` | Meaning review helper. |
| `scripts/review-prompt-dictionary-meanings.ps1` | `COMMIT` | PowerShell wrapper. |
| `scripts/test-prompt-dictionary-meaning-fixtures.cjs` | `COMMIT` | Test fixture runner. |
| `src/components/PromptDictionaryWorkspace.tsx` | `COMMIT` | New Dictionary tab/workspace UI. |
| `src/lib/prompt-dictionary-autocomplete.ts` | `COMMIT` | Autocomplete helper logic. |

## Ignored Cleanup Candidates From Dry Run

These were reported by `git clean -ndX`. Do not run `git clean -fdX` wholesale.

| Path | Class | Action |
|---|---|---|
| `node_modules/` | `DISPOSABLE` | Can be removed when reclaiming space; restore with `npm install`. |
| `out/` | `DISPOSABLE` | Build output; safe allowlist cleanup. |
| `output/` | `DISPOSABLE` with review | Generated output; inspect before deletion if it contains QA evidence. |
| `runtime/forge/environment.bat` | `KEEP_LOCAL` | Runtime file; do not delete through repo cleanup. |
| `runtime/forge/run.bat` | `KEEP_LOCAL` | Runtime launcher; do not delete. |
| `runtime/forge/system` | `KEEP_LOCAL` | Runtime dependency state; do not delete. |
| `runtime/forge/update.bat` | `KEEP_LOCAL` | Runtime updater; do not delete. |
| `runtime/forge/webui` | `KEEP_LOCAL` | Nested Forge/WebUI runtime; dry-run skipped as repository. Do not clean. |
| `userdata/` | `KEEP_LOCAL` | App data, secrets, history, caches. Do not delete. |

## GitHub Inventory

| Item | Current State | Class | Action |
|---|---|---|---|
| Visibility | Public | `COMMIT` docs update | Update stale public-release docs that still speak from pre-public state. |
| Description | Empty | `CONFIRM` | Suggested: `Personal Windows Electron UI for Stable Diffusion WebUI Forge with prompt, model, Civitai, and workflow tools.` |
| Topics | None | `CONFIRM` | Suggested: `stable-diffusion`, `forge`, `electron`, `react`, `windows`, `civitai`, `prompt-engineering`, `ai-art`. |
| Issues | Enabled, 0 issues | `KEEP_LOCAL` equivalent | Keep enabled. Add labels/templates only if issue workflow becomes active. |
| Projects | Enabled | `CONFIRM` | Disable if unused, or define it as roadmap surface. |
| Wiki | Disabled | `KEEP_LOCAL` equivalent | Keep disabled; docs live in repo. |
| Discussions | Disabled | `KEEP_LOCAL` equivalent | Keep disabled for personal-source repo. |
| Releases | None | `CONFIRM` later | Add release/tag convention only when packaged build is stable. |
| Workflows | None listed | `CONFIRM` later | Add CI after dirty worktree is stabilized. |
| Delete branch on merge | Disabled | `CONFIRM` | Recommend enabling if PR workflow continues. |
| Main branch protection | Not protected | `CONFIRM` later | Personal repo can leave unprotected until PR workflow matters. |
| Remote branch `origin/codex/forge-only-github-update-20260521` | Stale-looking merged PR branch remains | `CONFIRM` -> likely delete | `git cherry -v origin/main origin/codex/...` reports the branch commit as patch-equivalent to upstream, so deletion is likely safe after confirmation. |

## Recommended Execution Order

1. Repeat focused public-safety scan on changed/untracked text files before staging.
2. Decide whether to commit the generated/external `promoted-candidates.*.json` files or keep only the source registry/importers and rebuild DB locally.
3. Run code validation for the Prompt Dictionary bundle:
   - `npm run typecheck`
   - `npm run dictionary:enrich:meanings:test`
   - `npm run qa:dom:prompt-dictionary-workspace` if the DOM fixture is expected to run without live Forge.
4. Commit source/docs in logical groups:
   - Prompt Dictionary source/UI/scripts/DB.
   - Research reports and `.agent/requirements`.
   - Cleanup docs and public-state docs.
5. Update GitHub metadata after local docs match reality.
6. Perform allowlisted local cleanup only for disposable paths, if desired:
   - `out/`
   - `output/` after review
   - `node_modules/` only if reinstall cost is acceptable

## Hard Stops

- Do not run `git clean -fdx`.
- Do not run `git clean -fd` or `git clean -fdX` without a path allowlist.
- Do not remove `runtime/` or `userdata/`.
- Do not delete the remote codex branch before user confirmation.
- Do not publish generated candidate data before confirming source/license/private-prompt suitability.
