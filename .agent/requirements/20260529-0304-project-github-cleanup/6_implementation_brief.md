# Project And GitHub Cleanup Implementation Brief

## Existing Patterns

- `docs/PROJECT_STRUCTURE.md` is the current source of truth for folder ownership.
- `docs/DOCS_INDEX.md` is the user-facing docs map.
- `docs/ROADMAP.md` is the priority/operation map.
- `docs/OPEN_SOURCE_RELEASE_CHECKLIST.md` records public-release hygiene but is stale because GitHub now reports the repo is public.
- `.gitignore` already excludes the main local-only folders.
- `package.json` exposes `typecheck`, `build`, and many `qa:dom:*` commands. Use only the checks relevant to changed areas.

## Current Inventory Snapshot

- Branch: `main`.
- Remote: `origin` -> `imonoonoko/Yoitomoshi-Art-Generator`.
- Worktree: 65 changed paths.
- Tracked modified paths: 23.
- Untracked paths: 42.
- Large local folders:
  - `runtime/`: 41.65 GB.
  - `node_modules/`: 0.77 GB.
  - `userdata/`: 0.73 GB.
  - `output/`: 0.03 GB.
- GitHub:
  - public repo,
  - empty description,
  - no topics,
  - no releases,
  - no workflows,
  - Issues enabled with 0 issues,
  - Projects enabled,
  - Wiki disabled,
  - Discussions disabled,
  - delete branch on merge disabled,
  - main branch unprotected,
  - stale-looking remote codex branch remains.

## Suggested Work Plan

1. Write a cleanup inventory document.
   - Include top-level folder size, Git ownership, risk, and proposed action.
   - Include every changed/untracked path grouped by feature/report/runtime/generated status.

2. Decide `.agent/requirements/` ownership.
   - If these are public handoffs, commit them or move them to `docs/requirements/`.
   - If they are private planning state, add a clear ignore rule and move any public-facing summaries into `docs/`.

3. Stabilize local Git status.
   - Commit or intentionally keep the Prompt Dictionary source additions.
   - Commit or intentionally keep report artifacts.
   - Avoid broad cleanup until active untracked files are handled.

4. Update stale docs.
   - Update `docs/OPEN_SOURCE_RELEASE_CHECKLIST.md` from pre-public checklist to current public hygiene checklist.
   - Update `docs/PROJECT_STRUCTURE.md` if the root folder list has drifted.
   - Update `docs/DOCS_INDEX.md` only for docs that are intended to be tracked.

5. Apply GitHub metadata cleanup after local state is coherent.
   - Set repo description.
   - Add topics.
   - Decide Projects on/off.
   - Consider enabling delete branch on merge.
   - Delete stale remote branch only after confirming it has no unique work to preserve.

6. Verify.
   - Run `git diff --check`.
   - Run `npm run typecheck` if source files remain changed.
   - Run targeted DOM QA only for affected UI behavior.
   - Re-run `gh repo view` after GitHub setting changes.

## Commands To Use Carefully

Non-destructive inventory:

```powershell
git status --short --branch
git clean -nd
git clean -ndX
git branch -a --sort=-committerdate
gh repo view imonoonoko/Yoitomoshi-Art-Generator --json nameWithOwner,visibility,description,repositoryTopics,hasIssuesEnabled,hasProjectsEnabled,hasWikiEnabled,deleteBranchOnMerge
gh issue list --repo imonoonoko/Yoitomoshi-Art-Generator --state all --limit 30
gh pr list --repo imonoonoko/Yoitomoshi-Art-Generator --state all --limit 30
```

Avoid unless a reviewed allowlist exists:

```powershell
git clean -fd
git clean -fdX
git clean -fdx
Remove-Item -Recurse runtime
Remove-Item -Recurse userdata
```

## Technical Assumptions

- The repo remains a personal Windows/Electron app, not a packaged public product.
- GitHub is for source recovery and reuse, not npm distribution.
- `runtime/` and `userdata/` are local operational state and should stay out of Git.
- HTML reports may be useful, but they need an explicit docs policy because they can grow quickly.

## Risks

- Untracked implementation files can be mistaken for disposable generated output.
- `runtime/forge/webui` is a nested repository area; normal cleanup commands can produce misleading output around it.
- Public docs may expose local paths; review before committing any new report.
- GitHub branch cleanup could remove a branch with historical value if performed before comparing commits.

## Test Plan

- For requirements-only changes: verify files exist and review `git diff -- .agent/requirements/20260529-0304-project-github-cleanup`.
- For docs-only cleanup: run `git diff --check`.
- For source cleanup/commit grouping: run `npm run typecheck`; add targeted `npm run qa:dom:*` only for UI-touching source changes.
- For GitHub settings: verify with `gh repo view` and branch listing.

## Open Questions

- Which GitHub description/topics should be final?
- Should branch protection be used for a personal repo, or is it unnecessary friction?
- Should cleanup produce one PR or multiple small commits on `main`?
