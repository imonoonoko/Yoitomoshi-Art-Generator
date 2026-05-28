# Project And GitHub Cleanup Alternatives

## Codebase Findings

- `docs/PROJECT_STRUCTURE.md` already defines the desired split between Git-managed app/docs and local-only `runtime/`, `userdata/`, `out/`, `output/`, and `node_modules/`.
- `.gitignore` mostly matches that split.
- `docs/OPEN_SOURCE_RELEASE_CHECKLIST.md` is stale because it records a pre-public state, while GitHub now reports `visibility: PUBLIC`.
- The local worktree has active source/doc changes and untracked implementation files. Treating all untracked paths as trash would delete current work.
- GitHub has no description/topics/releases/workflows, no open issues, one merged PR, and one stale-looking remote codex branch.

## Options

### Option A: Safe Inventory First

Effort: Small
Value: High

Summary:
Create a current inventory, classify every changed/untracked path, then apply only obvious metadata/docs cleanups and leave destructive cleanup for a reviewed second pass.

Benefits:

- Minimizes risk of deleting active Prompt Dictionary / LoRA work.
- Produces a durable basis for commit grouping.
- Fits the current dirty worktree.

Tradeoffs:

- Does not immediately free the most disk space.
- Requires one more pass before deletion.

### Option B: Aggressive Local Cleanup

Effort: Medium
Value: Medium

Summary:
Run ignored/untracked cleanup commands and then reconstruct anything still needed.

Benefits:

- Fastest visible folder cleanup.
- Removes build/cache clutter quickly.

Tradeoffs:

- Unsafe in this repo because `git clean -nd` lists many likely-valuable untracked implementation and report files.
- `git clean -ndX` includes live `runtime/` and `userdata/` areas.
- High chance of losing useful local state.

### Option C: GitHub-First Polish

Effort: Small
Value: Medium

Summary:
Update GitHub description/topics/settings, delete stale remote branch, then clean local repo later.

Benefits:

- Makes public repo look cleaner quickly.
- Does not touch local runtime/userdata.

Tradeoffs:

- GitHub may look polished while local docs and current source state remain inconsistent.
- Remote branch deletion needs confirmation because the branch is not an ancestor of `origin/main`.

## Recommendation

Use Option A first, then perform Option C after the local classification confirms what should be committed and what should stay local. Avoid Option B except for narrowly reviewed paths.
