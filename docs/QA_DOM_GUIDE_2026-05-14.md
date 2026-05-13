# QA: DOM Automation Guide 2026-05-14

対象: Electron remote debugging 経由のDOM確認、Preflight警告、Workspace復元fixture。

目的: DOM QAを表示文言依存から外し、`data-testid` と状態属性で再実行できる形にする。

## 安定セレクタ

| 領域 | セレクタ |
|---|---|
| 上部タブ | `main-tab-txt2img`, `main-tab-img2img`, `main-tab-upscale`, `main-tab-tools` |
| サイドタブ | `side-tab-library`, `side-tab-lora`, `side-tab-history`, `side-tab-presets` |
| サイド内容 | `side-content-library`, `side-content-lora`, `side-content-history`, `side-content-presets` |
| Prompt / Generate | `prompt-positive-section`, `prompt-negative-section`, `generate-button` |
| 拡張パネル | `parameters-panel`, `regional-prompter-panel`, `fabric-panel`, `controlnet-builder-panel`, `controlnet-panel`, `adetailer-panel` |
| Preflight | `preflight-panel`, `preflight-summary`, `preflight-item-{key}`, `preflight-open-{key}`, `preflight-fix-{key}` |
| Workspace | `workspace-row-{id}`, `workspace-restore-{id}`, `workspace-delete-{id}` |
| Tools | `tagger-catalog`, `tagger-run-current-image`, `tagger-run-result`, `tool-section-library-toggle`, `model-library-card`, `library-delete-partial-{index}` |
| History review | `history-tag-review-panel`, `history-review-open`, `history-review-accepted`, `history-review-rejected`, `history-review-save`, `history-review-accept-all`, `history-review-reject-all`, `history-review-append-prompt`, `history-review-append-negative` |
| Prompt Helper | `prompt-helper-reviewed-tags`, `prompt-helper-apply-review-accepted`, `prompt-helper-apply-review-rejected` |

`preflight-panel` は `data-preflight-blockers` と `data-preflight-warnings` を持つ。
`preflight-item-{key}` は `data-preflight-severity`, `data-preflight-target`, `data-preflight-can-fix` を持つ。

## 実行

Electronをremote debugging付きで起動する。

```powershell
$exe = Join-Path (Get-Location) 'node_modules\electron\dist\electron.exe'
Start-Process -FilePath $exe -ArgumentList @('--remote-debugging-port=9338', '.') -WorkingDirectory (Get-Location) -WindowStyle Hidden
```

セレクタの最低限smoke:

```powershell
npm.cmd run qa:dom -- selectors --port=9338
```

Preflight mismatch fixture:

```powershell
npm.cmd run qa:dom:preflight -- --port=9338
```

P2 fixture:

```powershell
npm.cmd run qa:dom:p2 -- --port=9338
```

API surface smoke:

```powershell
npm.cmd run qa:dom:api -- --port=9338
```

Tagger IPC smoke:

```powershell
npm.cmd run qa:dom:tagger -- --port=9338
```

Tagger blacklist反映:

```powershell
npm.cmd run qa:dom:tagger-blacklist -- --port=9338
```

Tagger精度比較:

```powershell
npm.cmd run qa:tagger:compare -- --port=9338
```

History正解タグレビュー:

```powershell
npm.cmd run qa:dom:history-review -- --port=9338
npm.cmd run qa:dom:history-review-persistence -- --port=9338
npm.cmd run qa:dom:history-review-prompt -- --port=9338
npm.cmd run qa:dom:history-review-report-source -- --port=9338
npm.cmd run qa:dom:prompt-helper-review -- --port=9338
```

孤立partial削除smoke:

```powershell
$dir = Join-Path (Get-Location) 'runtime\forge\webui\models\Tagger'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Set-Content -LiteralPath (Join-Path $dir 'yoitomoshi-dom-qa-test.safetensors.partial') -Value 'partial-smoke'
npm.cmd run qa:dom:partial-delete -- --port=9338
```

このfixtureは以下を行う。

- 以前の `QA DOM preflight mismatch temporary` Workspaceを削除。
- LoRAタブを開き、`Hands v2.1` のCivitai metadataが表示されるまで待つ。
- 一時Workspaceを保存し、ToolsのWorkspace復元UIから復元する。
- `preflight-item-lora-base`, `preflight-item-lora-trigger`, `preflight-item-sdxl-size`, `preflight-item-cn-base-0` をDOMで確認する。
- 一時Workspaceを削除する。

`p2-fixture` は以下も確認する。

- img2img入力画像不足のblockerがGenerateボタンのdisabled理由へ入る。
- `preflight-open-lora-trigger` から該当Prompt領域へ移動できる。
- `preflight-fix-lora-trigger` でLoRA triggerをPromptへ追記できる。
- `preflight-fix-sdxl-size` でSDXL小解像度警告を解消できる。
- ToolsのTagger Catalog、Model Library、`runTagger` / `deletePartialFile` / `checkLibraryIntegrity` IPCが露出している。

`tagger-smoke` はローカルTagger未配置でも `missing-model` として安全に返ることを確認する。モデル配置後は `ok` または依存不足時の `missing-runtime` を許容する。

`tagger-blacklist-filter` は同じ最小画像を2回Taggerに通し、2回目で先頭タグをblacklistへ入れる。対象タグがPrompt候補から消え、`suppressedTags.reason=blacklist` として返ることを確認する。

`qa:tagger:compare` は `output/tagger-accuracy-compare-2026-05-14/comparison.json` と `docs/TAGGER_ACCURACY_COMPARISON_2026-05-14.md` を更新する。PixAI ONNXはElectron IPC、DeepDanbooru/CLIP/WD14はForge APIを使うため、Forge ready状態で実行する。

`qa:tagger:compare` は保存済み `tagReview` がある場合にHistoryレビュー画像を追加サンプルとして取り込む。現在の実データにレビューがない場合は `historyReview.includedSamples=0` として出力する。実装確認では一時レビューfixtureを入れた状態で `historyReviewSamples=1` の取り込みも確認した。

`history-tag-review` はHistoryタブを開き、先頭履歴のレビューUIに一時的な正解タグを書き込んで保存を確認する。検証後は元の `tagReview` に戻す。

`history-review-persistence` は一時レビューを保存し、renderer reload後に `tagReview` が復元されることを確認してから元に戻す。

`history-review-prompt-bridge` はレビュー欄の正解タグをPromptへ、除外タグをNegativeへ送れることをDOMで確認する。検証後はPrompt/Negativeを元に戻す。

`history-review-report-source` は比較スクリプトが読むのと同じHistory index上で、一時レビューの正解タグ/除外タグが読み出せることを確認する。検証後は元の `tagReview` に戻す。

`prompt-helper-review-tags` は一時レビューを保存し、Prompt Helper内のレビュー済みタグ欄から正解タグをPromptへ、除外タグをNegativeへ送れることを確認する。検証後はPrompt/Negativeと `tagReview` を元に戻す。

`partial-delete-smoke` は `yoitomoshi-dom-qa-` prefixのテスト用partialだけを削除する。実運用の孤立partialを誤って消さないため、通常のpartial名は対象にしない。

## ルール

- QAスクリプトは日本語などの表示文言で主要操作対象を探さない。文言確認が目的の時だけ `innerText` を読む。
- UI変更時は、見た目より先に `data-testid` の互換性を確認する。
- 一時データはprefixを固定し、開始時と終了時の両方でcleanupする。
- Forge ready前はLoRA metadataやControlNet catalogが揃わないため、DOM QAはForge接続済み状態で実行する。

## 失敗時の切り分け

| 症状 | 見る場所 |
|---|---|
| CDP接続失敗 | Electron起動port、`http://127.0.0.1:<port>/json/list` |
| `Hands v2.1 metadata` timeout | Forge ready、LoRA一覧、Civitai cache、ネットワーク |
| Workspace restore timeout | `main-tab-tools` / `workspace-restore-{id}` のtest id |
| Preflight item timeout | `GenerationPreflightPanel.tsx` のitem key、fixture snapshot、LoRA metadata |
| Tagger smoke が `failed` | `runtime/forge/webui/models/Tagger` の `model.onnx` / `selected_tags.csv`、Forge Pythonの `onnxruntime` / `PIL` / `numpy` |
