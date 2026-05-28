# Open Source Maintenance Checklist

最終更新: 2026-05-29

`imonoonoko/Yoitomoshi-Art-Generator` は現在 public repository として運用する。
このチェックリストは private から public へ切り替える前の資料ではなく、公開後に GitHub へ push / release / 設定変更する前の保守確認として使う。

## 現在の判断

| 項目 | 判断 |
|---|---|
| Repository visibility | `PUBLIC` |
| 推奨ライセンス | MIT |
| package.json | `private: true` は維持し、npm 誤公開を防ぐ |
| Forge runtime | 同梱しない |
| モデル / LoRA / ControlNet | 同梱しない |
| 生成画像 / 履歴 / Civitai cache | 同梱しない |
| Civitai API key | `userdata/secrets.local.json` に保存し、Git 管理しない |
| Local prompt history | `userdata/prompt-dictionary/` に置き、公開用DBビルドには既定で含めない |
| GitHub用途 | 一般配布ではなく、将来の自分が復元・再利用しやすい source repository |

## Push 前チェック

```powershell
git status --short
git diff --check
npm.cmd run typecheck
```

必要に応じて追加:

```powershell
npm.cmd run build
npm.cmd run dictionary:enrich:meanings:test
npm.cmd run qa:dom:prompt-dictionary-workspace
```

## Git に入れてよいもの

- `electron/`, `src/`, `scripts/` のアプリ/検証/保守コード
- `resources/` の同梱静的資産と、公開可能な prompt dictionary source snapshots
- `docs/` のセットアップ、構造、ロードマップ、調査、QA 証跡
- `.agent/requirements/` の公開して問題ない実装要件・引き継ぎ
- `README*.md`, `はじめに.txt`, `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `THIRD_PARTY_NOTICES.md`

## Git に入れないもの

- `runtime/`
- `userdata/`
- `node_modules/`
- `out/`, `dist/`, `.vite/`
- `output/`
- `.env`, `.env.*`, `*.local`
- `resources/prompt-dictionary/promoted-candidates.local.json`
- model weight files: `.safetensors`, `.ckpt`, `.pt`, `.pth`, `.onnx`, `.bin`
- generated private images: `.png`, `.jpg`, `.jpeg`, `.webp` unless they are intentional docs screenshots

## Prompt Dictionary Data Policy

- Public source snapshots may store normalized tag candidates, counts, adult level, curation status, Japanese labels, and source identifiers.
- Public snapshots must not store raw prompt dumps, image bytes, browser traces, user IDs, cookies, API keys, or local filesystem paths.
- `local-user-prompts` is a local-only source. It may read `userdata/history/`, presets, local prompt libraries, and LoRA/checkpoint profiles, so its promoted snapshot stays under `userdata/prompt-dictionary/` and is ignored by Git.
- Public DB builds exclude local user prompts by default. To intentionally include them for a local-only build, set `YOITOMOSHI_INCLUDE_LOCAL_PROMPT_DICTIONARY=1` before running the dictionary build.

## GitHub Settings Check

Current desired baseline:

- Issues: enabled
- Wiki: disabled
- Discussions: disabled
- Projects: optional; disable if not used as a roadmap
- Delete branch on merge: recommended if PR workflow continues
- Branch protection: optional for personal repo; enable if using PR-only changes
- Releases: add only when a packaged build is stable enough to restore from

Suggested repository description:

```text
Personal Windows Electron UI for Stable Diffusion WebUI Forge with prompt, model, Civitai, and workflow tools.
```

Suggested topics:

```text
stable-diffusion, forge, electron, react, windows, civitai, prompt-engineering, ai-art
```

## Secret / Private Data Response

If a secret or private local artifact is ever committed:

1. Revoke or rotate the secret first.
2. Remove the file or value from the current tree.
3. Decide whether Git history rewrite is necessary.
4. Re-check GitHub Actions logs, issues, PRs, releases, and tags for the same value.

## Reference

- https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository
- https://choosealicense.com/licenses/mit/
- https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository
- https://spdx.org/licenses/
