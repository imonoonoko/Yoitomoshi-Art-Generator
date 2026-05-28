# Project And GitHub Cleanup Scope

## MVP

- Produce a current cleanup inventory of local folder ownership and GitHub state.
- Classify all changed/untracked paths into:
  - commit now,
  - keep local and ignore,
  - generated/disposable,
  - needs user confirmation.
- Update stale docs that conflict with current reality, especially public GitHub state and project structure.
- Define safe cleanup commands or scripts that never remove `runtime/`, `userdata/`, active `.agent/requirements/`, or untracked source/report files by accident.
- Propose GitHub metadata/settings changes:
  - repo description,
  - topics,
  - delete branch on merge,
  - Projects on/off,
  - stale remote branch handling,
  - branch protection decision.

## Nice To Have

- Move old reports into a clearer `docs/reports/` or date-based structure if links can be updated safely.
- Create a small `docs/CLEANUP_RUNBOOK.md` for future folder cleanup.
- Add GitHub issue labels/milestones if issues will be used as a roadmap.
- Add a release/tag convention once the app has a stable packaged build.

## Future

- Automate a non-destructive repo health report that summarizes dirty paths, ignored large folders, docs freshness, and GitHub metadata.
- Add CI only after deciding which checks are stable enough for this Windows/Electron/Forge-local project.
- Consider branch protection once the project moves from personal-only commits to PR-based workflow.

## Out Of Scope

- Deleting Forge runtime, models, extensions, or Python dependencies.
- Deleting `userdata/`, generated history, local settings, or local secrets.
- Running `git clean -fdx`, `git reset --hard`, force-pushing, or rewriting history.
- Publishing npm packages.
- Adding full CI/CD or release automation in the same pass.
- Restructuring Prompt Dictionary implementation code unrelated to cleanup.

## Constraints

- Platform: Windows / PowerShell.
- Package manager: npm, confirmed by `package-lock.json` and `package.json`.
- Runtime layout: portable app folder with local-only `runtime/` and `userdata/`.
- GitHub repo is already public; docs and cleanup must treat public visibility as current reality.
- Current worktree is dirty and contains likely valuable untracked files.
- Any GitHub write action should be explicit and reversible where possible.
