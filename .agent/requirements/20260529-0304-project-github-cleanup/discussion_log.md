# Project And GitHub Cleanup Discussion Log

## 2026-05-29 03:04 +09:00

User request:

- `$define-requirements` を使い、`C:\宵灯工房アート\Yoitomoshi-Art-Generator` のプロジェクトフォルダ全体と GitHub を整理したい。

Applied skills:

- `define-requirements`: 大きい repo 整理なので、実削除や GitHub 設定変更の前に durable handoff を作る。
- `github`: GitHub repo の公開状態、Issue/PR、リモートブランチ、設定を現物確認する。

Repository findings:

- Local branch: `main`, tracking `origin/main`.
- Remote: `https://github.com/imonoonoko/Yoitomoshi-Art-Generator.git`.
- Worktree: 65 changed paths total, including 23 modified tracked paths and 42 untracked paths.
- Current untracked paths include durable-looking Prompt Dictionary / LoRA reports, new scripts, new Electron modules, new React modules, and `.agent/requirements/*`.
- Top local directory sizes: `runtime/` 41.65 GB, `node_modules/` 0.77 GB, `userdata/` 0.73 GB, `output/` 0.03 GB.
- `.gitignore` excludes the expected local/runtime areas: `runtime/`, `userdata/`, `output/`, `out/`, `dist/`, `node_modules/`, `.env*`, `.codex-rollback/`, Electron cache folders.
- `git clean -nd` would delete active untracked work; cleanup must classify before deleting.
- `git clean -ndX` lists ignored cleanup candidates including `node_modules/`, `out/`, `output/`, `userdata/`, and partial `runtime/forge/*`; this must not be executed wholesale because `runtime/` and `userdata/` are live local app state.
- `docs/OPEN_SOURCE_RELEASE_CHECKLIST.md` still says the repo was private as of 2026-05-16, but GitHub now reports the repo is public.

GitHub findings:

- Repo: `imonoonoko/Yoitomoshi-Art-Generator`.
- Visibility: public.
- Description: empty.
- Topics: none.
- Default branch: `main`.
- Issues enabled: true, open issues: 0.
- PRs: one merged PR, `#1 [codex] Prepare Forge-only Art Generator update`.
- Releases: none.
- Workflows: none listed.
- Wiki disabled, Projects enabled, Discussions disabled.
- Delete branch on merge: false.
- Main branch protection: not enabled.
- Remote branches: `origin/main` and `origin/codex/forge-only-github-update-20260521`; the codex branch came from the merged PR but is not reported as merged into `origin/main`, likely because the PR was merged with a different commit shape.

Decision so far:

- Do not delete, reset, clean, force-push, or change GitHub settings in this pass.
- First output is a scoped cleanup definition and implementation brief.

## 2026-05-29 Inventory Pass

User confirmed proceeding with the safe inventory path.

Actions taken:

- Re-read `git status`, tracked diff names/stats, untracked path sizes, GitHub repo settings, PR/issue state, and remote branches.
- Confirmed `.agent/requirements` already has tracked historical files, so new durable requirements are not automatically local-only.
- Compared `origin/codex/forge-only-github-update-20260521` against `origin/main`; `git cherry -v origin/main origin/codex/...` reports its unique commit as patch-equivalent to upstream, so it is likely safe to delete later after explicit confirmation.
- Ran a focused text scan over changed/untracked paths for secret-like strings; output showed expected variable names and docs references, not literal tokens in the sampled output.
- Created `7_cleanup_inventory.md` with per-path classification and GitHub cleanup recommendations.

Still not done:

- No files were deleted.
- No GitHub settings were changed.
- No branches were deleted.
- No commits were made.
