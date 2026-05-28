# Yoitomoshi Art Generator — ファイル / フォルダ構造

最終更新: 2026-05-29

このプロジェクトは「アプリ本体」「Forge 実行環境」「ユーザーデータ」「生成物」を同じ親フォルダに置くポータブル構成。ただし GitHub へ載せる対象はアプリ本体、公開可能な同梱資産、ドキュメント、実装引き継ぎに限定する。

## ルート直下

| パス | 役割 | Git |
|---|---|---:|
| `electron/` | Electron main / preload / Forge 管理 / IPC / Storage | 管理する |
| `src/` | React renderer / Zustand store / UI components | 管理する |
| `resources/` | 同梱プロンプトライブラリなど静的資産 | 管理する |
| `docs/` | ロードマップ、レビュー、引き継ぎ、構造ドキュメント | 管理する |
| `.agent/requirements/` | Codex実装要件・判断ログ。公開して問題ないものだけ | 管理する |
| `README*.md`, `はじめに.txt` | 利用者向け説明 | 管理する |
| `package.json`, `package-lock.json`, `tsconfig*.json`, `electron.vite.config.ts` | 開発・ビルド設定 | 管理する |
| `Yoitomoshi.bat`, `create-desktop-shortcut.ps1` | 起動・ショートカット作成 | 管理する |
| `build/` | Electron builder などの静的 build resource | 管理する |
| `runtime/` | Forge 本体、Python/Git、モデル、拡張、依存 | 管理しない |
| `userdata/` | 設定、履歴、Civitai cache、Electron profile | 管理しない |
| `out/`, `dist/`, `.vite/` | ビルド成果物 | 管理しない |
| `output/` | UI検証画像など一時出力 | 管理しない |
| `node_modules/` | npm依存 | 管理しない |

## `userdata/`

| パス | 役割 |
|---|---|
| `settings.json` | Forge path、ポート、UI言語など。Civitai APIキーは直接入れない。 |
| `secrets.local.json` | Civitai APIキーなどのローカル秘密情報。Electron `safeStorage` が使える場合は暗号化、初回移行時などは `plain:` base64 fallback。Git 禁止。 |
| `history/` | 生成履歴PNGと `index.json`。 |
| `civitai/` | Civitai metadata / community stats / tag cache。 |
| `electron-profile/` | Electron / Chromium の profile と cache。以前ルート直下に出ていた `Cache` 等はここへ隔離する。 |
| `model-library/` | Stability Matrix 参考の Shared Model Library。`index.json` にローカルモデル索引、source metadata、preview pathを保存し、`previews/` に取得済みサムネイルを置く。 |
| `downloads/` | 再開可能 Download Manager。`jobs.json` にジョブ履歴を保存し、Civitai / Hugging Face download の `.partial` はモデル保存先横に保持する。 |
| `workspaces/` | `.yoitoart` ワークスペース保存。画像埋め込み、履歴ID/外部画像パス参照、設定のみ保存を選べる。 |
| `upscale-comparisons/` | Upscale の Tile ControlNet ON/OFF と denoise 候補比較。入力画像、候補画像、判断基準を保存する。 |
| `startup-metrics.jsonl` | 起動診断の履歴。Electron 初期化、renderer 読み込み、Forge ready までの相対時間を JSONL で保存する。 |
| `validation-*.log` | 実機検証ログ。例: Model Merger 実サイズ確認ログ。 |
| `prompt-dictionary/ingest.sqlite` | Prompt大辞典のsource staging DB。raw promptやlocal sourceを含み得るためGit禁止。 |
| `prompt-dictionary/promoted-candidates.local.json` | ローカル履歴由来の昇格候補snapshot。公開用DBビルドには既定で含めない。 |

## `runtime/`

| パス | 役割 |
|---|---|
| `runtime/forge/` | Stable Diffusion WebUI Forge の統合先。 |
| `runtime/forge/webui/models/` | Checkpoint / LoRA / VAE / ControlNet などの実体配置。 |
| `runtime/forge/webui/extensions/` | ADetailer、ControlNet、MultiDiffusion、Ultimate SD Upscale 等の拡張。 |

## 整理ルール

- ルート直下に Electron / Chromium cache を置かない。`userdata/electron-profile/` に集約する。
- `runtime/` と `userdata/` は巨大・秘密情報あり・環境依存のため Git に入れない。
- `resources/prompt-dictionary/promoted-candidates.local.json` は旧local snapshotの置き場所としてもGitに入れない。local importerの既定出力は `userdata/prompt-dictionary/promoted-candidates.local.json`。
- Prompt大辞典の公開用source snapshotsは、raw promptや画像ではなく、正規化済みtag候補、件数、adult level、source IDだけを持つ。
- Stability Matrix 参考機能は `userdata/model-library/`, `userdata/downloads/`, `userdata/workspaces/` に管理情報を分ける。ソースコードやUI資産はコピーせず、機能思想だけを独自実装する。
- `userdata/model-library/index.json` と `userdata/downloads/jobs.json` は読み込み時にschema normalizeする。壊れた行や欠損項目は起動不能にせず、安全側に落として保存し直す。
- Forge / Gradio / Python 依存は物理削除しない。Electron では Gradio UI を開かないが、Forge 内部の依存として必要なものがある。
- 生成物、検証スクリーンショット、ビルド成果物は `output/` または `out/` に置き、Git に入れない。
- cleanupの具体手順は [`CLEANUP_RUNBOOK.md`](CLEANUP_RUNBOOK.md) を正とする。
