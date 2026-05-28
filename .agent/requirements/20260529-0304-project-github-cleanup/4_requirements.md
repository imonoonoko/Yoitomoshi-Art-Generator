# Project And GitHub Cleanup Requirements

## 1. Overview

The cleanup must make the Yoitomoshi Art Generator workspace safe to maintain as both a local portable app and a public GitHub source repo. The primary behavior is not deletion; it is classification, preservation of active work, and alignment between local docs, Git state, and GitHub settings.

## 2. User Stories

- As the project owner, I want active work separated from generated/local-only files, so that cleanup does not delete useful implementation or research artifacts.
- As the project owner, I want GitHub to show the project purpose and maintenance state clearly, so that the public repo is understandable later.
- As a future Codex session, I want a current cleanup/runbook artifact, so that repeated broad cleanup requests start from known safe boundaries.
- As a future self reinstalling from GitHub, I want docs to match the public repo and local runtime split, so that setup is not misleading.

## 3. Acceptance Criteria

### Local Classification

- Given the current worktree, when cleanup planning is complete, then every changed/untracked path is assigned to one of: commit, keep local, disposable, or needs confirmation.
- Given untracked source/docs/scripts are present, when cleanup commands are proposed, then no command removes them without an explicit reviewed allowlist.
- Given `runtime/` and `userdata/` are local app state, when cleanup is executed, then they are not removed by broad `git clean` or recursive delete commands.

### Git Ownership

- Given `.gitignore` excludes runtime/userdata/output/build artifacts, when `git status --short` is reviewed, then no local-only secrets, models, generated images, or Forge runtime assets appear as tracked or to-be-committed files.
- Given `.agent/requirements/` contains durable handoff artifacts, when deciding Git ownership, then the project has a clear rule for whether those artifacts are committed, moved to docs, or left local.

### Documentation

- Given GitHub now reports the repo is public, when docs are updated, then `docs/OPEN_SOURCE_RELEASE_CHECKLIST.md` no longer claims the repo is still private.
- Given new reports and prompt dictionary work exist, when `docs/DOCS_INDEX.md` is updated, then it links only to files that should exist in the repo and clearly separates current docs from historical reports.
- Given `docs/PROJECT_STRUCTURE.md` defines the local/source split, when cleanup is complete, then that document reflects the actual root folders and cleanup rules.

### GitHub Repository

- Given the repo is public, when GitHub metadata cleanup is done, then the repo has a concise description and relevant topics.
- Given Issues are enabled and there are no issues, when roadmap/issue workflow is decided, then Issues either get useful labels/templates or stay intentionally minimal.
- Given Projects are enabled but no project workflow is being used, when GitHub settings are cleaned, then Projects are either configured or disabled.
- Given a stale-looking remote `codex/forge-only-github-update-20260521` branch exists, when branch cleanup is done, then it is deleted only after confirming it contains no unique work that should be preserved.
- Given delete-branch-on-merge is false, when PR workflow settings are updated, then the repo either enables automatic deletion or documents why it stays off.

### Verification

- Given local cleanup/docs changes are made, when verification runs, then at minimum `git diff --check` and a relevant npm check pass or failures are documented.
- Given no source behavior changes are made, when verification is scoped down, then the report states why typecheck/build were not necessary.
- Given GitHub settings are changed, when verification runs, then `gh repo view` confirms the intended state.

## 4. User-Facing Nonfunctional Requirements

### Safety

- Prefer dry-run commands and reviewed path allowlists.
- Never rely on `git clean -fdx` for this repo.

### Traceability

- Keep cleanup decisions in a durable artifact before deleting or moving files.
- Split commits by concern: cleanup docs/inventory, source feature work, generated resource updates, GitHub metadata.

### Maintainability

- Keep source/docs in Git and runtime/userdata local.
- Avoid creating a new folder taxonomy unless it reduces future ambiguity.

## 5. Open Questions

- Should `.agent/requirements/` be committed to GitHub, moved into `docs/requirements/`, or remain local-only?
- Should GitHub Projects be disabled for this repo, or should it become the public roadmap surface?
- Should the stale remote codex branch be deleted now, or kept as a historical branch until the current dirty worktree is committed?
- Should generated HTML reports stay in `docs/`, move under `docs/reports/`, or remain untracked local reports?
- What public description and topics should GitHub use? Suggested baseline: `Personal Windows Electron UI for Stable Diffusion WebUI Forge with prompt, model, Civitai, and workflow tools.`
