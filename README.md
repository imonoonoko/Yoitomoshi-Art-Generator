# Yoitomoshi Art Generator

**日本語** | [English](README.en.md) | [Русский](README.ru.md) | [Português](README.pt.md)

個人ゲーム開発用の Stable Diffusion フロントエンド。Stable Diffusion WebUI Forge を裏で起動して、独自の React/Electron UI から生成・素材管理・Civitai 連携をまとめて行う。

> **クイックスタート派の方へ**: 同梱の [`はじめに.txt`](はじめに.txt) を読めば最短手順だけ確認できます。詰まった時は [`docs/SETUP_GUIDE.md`](docs/SETUP_GUIDE.md) を見てください。

## 初めて読む順番

| 目的 | 読むもの |
|---|---|
| すぐ起動したい | [`はじめに.txt`](はじめに.txt) |
| 初回セットアップを丁寧に確認したい | [`docs/SETUP_GUIDE.md`](docs/SETUP_GUIDE.md) |
| どのドキュメントを見ればよいか知りたい | [`docs/DOCS_INDEX.md`](docs/DOCS_INDEX.md) |
| フォルダ構造とGitHubに載せない範囲を確認したい | [`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md) |
| 現在の優先順位と実装履歴を確認したい | [`docs/ROADMAP.md`](docs/ROADMAP.md) |
| DOM QAや検証コマンドを確認したい | [`docs/QA_DOM_GUIDE_2026-05-14.md`](docs/QA_DOM_GUIDE_2026-05-14.md) |

## 起動 — 3 ステップ

### 1. 必要環境を用意する

| 必須 | 用途 |
|---|---|
| **Stable Diffusion WebUI Forge** | 既に動く状態 (`run.bat` 起動可) — [配布元](https://github.com/lllyasviel/stable-diffusion-webui-forge) |
| **Node.js 22.x (LTS)** | 本アプリの実行基盤 — [nodejs.org](https://nodejs.org/) から「LTS」版をインストール |
| **Windows 10/11** | 動作確認済 (Mac/Linux 未検証) |
| **NVIDIA GPU** | RTX 4060 Ti 8GB クラスで確認。SDXL は `--medvram` 推奨 |

ストレージは ~5GB の空きが必要(node_modules + 生成画像履歴)。

### 2. ダブルクリックで起動

```
Yoitomoshi.bat  をエクスプローラから ダブルクリック
```

初回のみ自動で以下が走ります(3〜5 分):

1. `npm install` — 依存パッケージのダウンロード
2. `npm run build` — アプリのビルド

完了すると Electron ウィンドウが立ち上がる。2 回目以降は数秒で起動します。

> **デスクトップアイコン**: [`create-desktop-shortcut.ps1`](create-desktop-shortcut.ps1) を右クリック →「PowerShell で実行」でデスクトップにショートカットを生成。

### 3. 初回設定 — Forge パスを指定

タイトルバー右上の ⚙ アイコンを押すと設定モーダルが開きます:

| 項目 | 内容 |
|---|---|
| **Forge インストールパス** | `run.bat` がある親フォルダの絶対パス。既定: `C:\宵灯工房アート\Yoitomoshi-Art-Generator\runtime\forge` |
| **Forge ポート** | 既定 `7860`(他ポートで動かしているなら変更) |
| **自動起動** | ON にすると Electron 起動と同時に Forge も自動 spawn |
| **Civitai API キー** | 任意。設定すると NSFW モデル取得 / レート制限緩和。[Civitai → Account](https://civitai.com/user/account) の「API Keys」タブから取得 |

設定保存後、タイトルバー左の電源ボタンを押すと Forge が裏で起動します(初回は依存解決で 1〜2 分)。

---

## 生成画面の見方

生成画面は `txt2img / img2img / Upscale / Tools` の上部タブを維持し、日常生成で触る項目は左カラムにまとめて表示する構成です。

| 左カラムの領域 | 役割 |
|---|---|
| **Recommendation / 生成前チェック** | モデル推奨、VAE / Clip Skip / LoRA / ControlNet などの注意点を生成前に確認する |
| **Prompt / Negative** | Prompt editor、Negative editor、タグ並び替え、整形、Generate button |
| **基本設定** | 入力画像、LoRA提案、Sampler / Steps / CFG / Size / Seed など主要パラメータ |
| **Prompt補助** | タグチップ編集、Prompt Helper、Dynamic Prompt Lab、Research Workflow |
| **拡張設定** | Regional Prompter、FABRIC、ControlNet、ADetailer、Dynamic Thresholding、FreeU |

`作る / 整える / 高度` の排他的な切替タブは廃止済みです。隠れている設定が生成payloadに入ったまま分からなくなる問題を避けるため、現在は全体を同じ生成画面内で見渡せるようにしています。

---

## 開発者向け(ホットリロード)

ソース変更を即座に反映したい場合のみ:

```powershell
cd C:\宵灯工房アート\Yoitomoshi-Art-Generator
npm install --no-audit --no-fund    # 初回のみ
npm run dev                          # 起動 (HMR 有効)
```

普段使いは `Yoitomoshi.bat` でビルド済みを直接読む方が速い。

## データの場所

このアプリはポータブル設計。以下すべて **プロジェクトフォルダ直下の `userdata/`** に保存される:

```
userdata/
├── settings.json              アプリ設定 (Forge パス・API キー等)
├── presets.json               プロンプトプリセット
├── quick-presets.json         ユーザカスタム QuickPreset
├── hidden-quick-presets.json  非表示にした組込プリセット ID
├── favorites.json             タグお気に入り
├── lora-favorites.json        LoRA お気に入り
├── lora-usage.json            LoRA 使用履歴(自動提案スコア用)
├── custom-prompt-library.json ユーザ追加カテゴリ/タグ
├── secrets.local.json         Civitai APIキーなどのローカル秘密情報
├── civitai/                   Civitai メタキャッシュ
│   ├── <sha256>.json          チェックポイント単位
│   ├── lora-<sha256>.json     LoRA 単位
│   ├── community-<id>.json    コミュニティ画像集計
│   ├── update-check.json      モデル更新チェック (24h TTL)
│   └── tags.json              人気タグキャッシュ (24h TTL)
├── history/                   生成履歴
│   ├── index.json
│   └── <uuid>.png             各生成画像 (最大 500 件)
├── model-library/             モデル索引、Civitai metadata、preview cache
├── downloads/                 再開可能ダウンロードジョブ
├── workspaces/                .yoitoart ワークスペース保存
├── upscale-comparisons/       Tile ControlNet / denoise 比較保存
├── character-composites/      AIキャラ追加のBefore/After比較パッケージ
└── startup-metrics.jsonl      起動診断ログ
```

**プロジェクトフォルダごと** 別 PC や別ドライブに移動すれば、設定・履歴・キャッシュも一緒に持ち運べる。

## 主な機能

| カテゴリ | 機能 |
|---|---|
| 生成 | txt2img / img2img / 入力画像 D&D + Ctrl+V / バッチ |
| パラメータ | Sampler / Steps / CFG / Size / Seed / Clip Skip / VAE / Denoising / 重み調整(Ctrl+↑↓) |
| プロンプト | 組込タグライブラリ(prompt-all-in-one MIT)+ ユーザー追加 / オートコンプリート / トークンカウンター / シンタックスハイライト / クイックプリセット |
| LoRA | カード UI / 複数同時適用 / 自動提案(モデル推奨優先 +200 加点) / トリガーワード自動挿入 |
| Civitai 連携 | モデル / LoRA / VAE 検索 + ダウンロード / コミュニティ画像 200 枚集計 / モデル更新通知 / タグブラウズ |
| メタデータ解析 | PNG / JPEG / WebP からの抽出 / ラベル形式テキスト貼付 / モデル / LoRA / VAE を Civitai と照合 |

## 開発・ビルド

```powershell
# TypeScript 型チェック
npm run typecheck

# プロダクションビルド
npm run build

# Electron DOM QA(別途remote debugging付きElectron起動が必要)
npm run qa:dom -- selectors --port=9338
npm run qa:dom:preflight -- --port=9338

# パッケージング (Electron 実行ファイル生成)
npm run dist
```

## トラブルシューティング

### ブラウザが自動で開く
本アプリは Forge 起動前に `webui/config.json` の `auto_launch_browser` を `Disable` に書き換えている。それでも開く場合、Forge の他の起動経路を経由している可能性あり。設定モーダルの「Forge 追加引数」に `--api` 等が入っていないか確認。

### 「Running on local URL」が出ない
- Forge インストールパスが正しいか確認(`<path>/webui/launch.py` が存在するか)
- ポート競合: 既に Forge が別ポートで動いている、または別のアプリが 7860 を使用
- Forge の依存パッケージ更新中(初回起動)は数分かかる

### 「メタデータ解析」失敗 → 「PNG ではない画像です」
SNS / CDN 経由の画像は EXIF を剥がされていることが多い。「テキストから解析」ボタンで A1111 形式または「ラベル + 改行 + 値」形式のパラメータ文字列を貼り付けるとパース可能。

### 拡張機能のエラーが何度も出る
タイトルバーの ⚠️ アイコンから「無効化」ボタンを押すと、Forge の `webui/config.json` の `disabled_extensions` 配列に追加される。Forge 再起動で反映。

### モデルの推奨設定が古いまま
キャッシュは `userdata/civitai/<sha>.json` に 14 日 TTL で保存。手動で削除すれば次回モデル選択時に再取得される。コミュニティ集計も同様(`community-<id>.json`)。

## ライセンス・サードパーティ

- 本リポジトリのアプリ本体は [MIT License](LICENSE) です。
- 同梱の `resources/prompt-library.ja.yaml` は [Physton/sd-webui-prompt-all-in-one](https://github.com/Physton/sd-webui-prompt-all-in-one) (MIT) より
- 主要依存: Electron / electron-vite / Vite 5 / React 19 / Tailwind / Radix UI / Zustand / js-yaml / lucide-react
- 詳細な第三者表記は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。
- Stable Diffusion WebUI Forge、モデル、LoRA、ControlNet、生成画像、Civitai cache、ユーザー設定は本リポジトリに含めません。それぞれ元の配布元・作者・サービスのライセンスや規約に従います。

## 既知の制約

- **配布対象は限定的**: 個人開発用に作られたツールで、エンドユーザー向けの一般配布は想定していない
- **NSFW フィルタは Civitai 検索のみ**: 生成内容そのもののモデレーションはしない(Forge / モデル側の責任)
- **ComfyUI 形式の PNG メタデータ未対応**: A1111 形式 (`parameters` チャンク / EXIF UserComment) のみ対応
- **Mac/Linux**: 動作未検証(コードはクロスプラットフォームだが Forge 起動の仕組みが Windows 前提)

## 連絡

不具合・要望は開発者へ直接(個人プロジェクトのため公開イシュートラッカーはなし)。
