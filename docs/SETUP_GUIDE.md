# Yoitomoshi Art Generator セットアップガイド

最終更新: 2026-05-16

このガイドは、GitHubから取得した状態の Yoitomoshi Art Generator を Windows で起動できるところまで案内するための手順書です。最短手順だけ見たい場合はルート直下の [`はじめに.txt`](../はじめに.txt) を参照してください。

## 対象環境

| 項目 | 必要条件 |
|---|---|
| OS | Windows 10 / 11 |
| Node.js | 22.x LTS |
| Stable Diffusion | Stable Diffusion WebUI Forge が `run.bat` で起動できる状態 |
| GPU | NVIDIA GPU 推奨。SDXL は 8GB VRAM 以上を推奨 |
| 空き容量 | アプリ依存だけで約5GB。モデル、履歴、Forge runtime は別途必要 |

## 1. 取得後に確認すること

GitHubに入っているのは、アプリ本体、同梱リソース、ドキュメント、起動スクリプトです。以下は環境依存または巨大ファイルなので Git 管理しません。

| フォルダ | 内容 |
|---|---|
| `runtime/` | Forge本体、Python/Git、モデル、拡張、依存 |
| `userdata/` | 設定、生成履歴、Civitai API key、キャッシュ |
| `node_modules/` | npm依存 |
| `out/`, `dist/`, `output/` | ビルド成果物、検証出力 |

別PCへ移す場合は、アプリフォルダごと移せば `userdata/` も一緒に移せます。ただし GitHub へ push する時は `runtime/` と `userdata/` を含めないでください。

## 2. Node.js を入れる

1. [nodejs.org](https://nodejs.org/) から LTS 版をインストールする。
2. PowerShellで確認する。

```powershell
node --version
npm --version
```

`node --version` が `v22.x.x` なら問題ありません。

## 3. Forge を用意する

Yoitomoshi は Forge の Gradio UI を埋め込まず、Forge API を裏側で使います。Forge自体は先に起動できる状態にしておきます。

確認ポイント:

- Forge フォルダ内に `run.bat` がある。
- `webui/launch.py` が存在する。
- 単体で `run.bat` を起動した時に依存解決が完了する。
- 通常はポート `7860` を使う。

既定の配置は次です。

```text
C:\宵灯工房アート\Yoitomoshi-Art-Generator\runtime\forge
```

既に別の場所にForgeがある場合は、アプリの設定画面でそのパスを指定できます。

## 4. アプリを起動する

通常利用では PowerShell を開く必要はありません。

```text
Yoitomoshi.bat をダブルクリック
```

初回だけ自動で次を実行します。

1. `npm install`
2. `npm run build`
3. Electronアプリ起動

初回は3分から5分程度かかります。2回目以降はビルド済み成果物を使うため短くなります。

## 5. 初回設定

アプリが開いたら、右上の歯車アイコンから設定を開きます。

| 設定 | 入力内容 |
|---|---|
| Forge インストールパス | `run.bat` があるフォルダの絶対パス |
| Forge ポート | 通常は `7860` |
| 自動起動 | ONならアプリ起動時にForgeも起動 |
| Civitai API キー | 任意。NSFWモデル検索やレート制限緩和に使う |

保存後、タイトルバー左側の電源ボタンを押すと Forge が裏で起動します。

## 6. 最初の生成確認

1. 上部タブで `txt2img` を選ぶ。
2. モデルが選択されているか確認する。
3. Prompt に短い英語タグを入れる。
4. `生成前チェック` がOKまたは警告のみであることを確認する。
5. `生成` を押す。

画像が中央プレビューに出れば基本セットアップは完了です。

## 7. 生成画面の見方

左カラムは、生成に関係する設定を同じ画面で確認できるようにまとめています。

| 領域 | 用途 |
|---|---|
| Recommendation / 生成前チェック | 推奨設定、未導入モデル、LoRA trigger、ControlNet不足などの警告 |
| Prompt / Negative | Prompt入力、Negative入力、タグ並び替え、整形、Generate |
| 基本設定 | 入力画像、LoRA提案、Sampler、Steps、CFG、Size、Seed |
| Prompt補助 | Prompt Helper、タグチップ、Dynamic Prompt Lab、Research Workflow |
| 拡張設定 | Regional Prompter、FABRIC、ControlNet、ADetailer、Dynamic Thresholding、FreeU |

以前の `作る / 整える / 高度` の切替タブは廃止済みです。現在は、隠れている設定が生成に効いているか分からなくなる問題を避けるため、必要な領域を同じ生成画面で確認できる構成です。

## 8. 開発者向けコマンド

```powershell
cd C:\宵灯工房アート\Yoitomoshi-Art-Generator

# 型チェック
npm.cmd run typecheck

# ビルド
npm.cmd run build

# 開発起動
npm.cmd run dev
```

DOM QAを実行する場合は、Electronをremote debugging付きで起動します。

```powershell
$exe = Join-Path (Get-Location) 'node_modules\electron\dist\electron.exe'
Start-Process -FilePath $exe -ArgumentList @('--remote-debugging-port=9338', '.') -WorkingDirectory (Get-Location) -WindowStyle Hidden
npm.cmd run qa:dom -- selectors --port=9338
```

生成画面のセクション確認は次を使います。

```powershell
npm.cmd run qa:dom:generation-sections -- --port=9338
```

## 9. よくある問題

| 症状 | 確認すること |
|---|---|
| `node` が見つからない | Node.js 22 LTSを入れ、PowerShellを開き直す |
| `npm install` が失敗する | ネットワーク、プロキシ、セキュリティソフトのブロックを確認する |
| Forgeに接続できない | Forgeパス、ポート、Forge単体起動、`webui/launch.py` の存在を確認する |
| ブラウザが勝手に開く | Forge側の起動経路が別に残っている可能性。Yoitomoshi経由では `auto_launch_browser` を無効化する |
| モデルが出ない | Forgeの `models/Stable-diffusion/` にcheckpointがあるか確認する |
| LoRAやControlNetが効かない | モデル配置先、拡張の有効状態、生成前チェックの警告を見る |
| Civitai情報が古い | `userdata/civitai/` のキャッシュを削除すると再取得される |

## 10. GitHubへ載せる前の確認

```powershell
git status --short
npm.cmd run typecheck
npm.cmd run build
git diff --check
```

`runtime/`、`userdata/`、`node_modules/`、`out/`、`dist/`、`output/` が stage されていないことを確認してください。Civitai API key は `userdata/secrets.local.json` に保存されるため、GitHubへ載せません。
