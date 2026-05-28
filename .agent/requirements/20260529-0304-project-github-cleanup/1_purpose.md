# Project And GitHub Cleanup Purpose

## Problem

The project has grown into a portable app workspace that contains source code, documentation, local Forge runtime, user data, generated outputs, research reports, and Codex handoff artifacts in the same folder. The GitHub repo is already public, but the local worktree has many uncommitted and untracked changes, and GitHub metadata/settings still look partly unfinished.

The immediate risk is losing active work through a broad cleanup command or publishing an unclear set of changes to GitHub.

## Target User

The primary user is the project owner using Yoitomoshi Art Generator locally on Windows and using GitHub as a recoverable, reusable source repository.

Secondary users are future Codex sessions and future self re-setting up the project from GitHub.

## Current Workaround

- Use `.gitignore` to keep large local state out of Git.
- Keep runtime, user data, generated outputs, and reports in nearby folders.
- Rely on docs such as `docs/PROJECT_STRUCTURE.md`, `docs/DOCS_INDEX.md`, `docs/ROADMAP.md`, and `docs/OPEN_SOURCE_RELEASE_CHECKLIST.md` to explain intent.
- Manually inspect `git status` before deciding what to commit or delete.

## Why Now

The repo is public and has accumulated 65 local changes, including active source work and untracked reports/scripts. A broad folder/GitHub cleanup now needs a safety-first process so useful work is preserved, local-only state stays local, and GitHub becomes easier to understand from the outside.

## Desired Outcome

After cleanup, the local project folder has clear ownership boundaries:

- source/docs that belong in Git are either committed or intentionally staged for review,
- local runtime and user state are preserved but excluded from Git,
- generated/transient output is either removed safely or documented as disposable,
- GitHub metadata, branches, and repo settings match the public project state,
- docs accurately explain the current public/source/local split.

## Success Definition

Cleanup is successful when `git status`, `git clean -nd`, docs, and GitHub all tell the same story: no important work is hidden in untracked paths, no local secrets or runtime assets are tracked, and the public repo has enough metadata/settings to be understandable and maintainable.
