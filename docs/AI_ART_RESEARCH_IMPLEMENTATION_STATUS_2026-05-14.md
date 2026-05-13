# AI Art Research Implementation Status 2026-05-14

対象: `Yoitomoshi Art Generator`

目的: 一次情報・二次情報リサーチを、実装済み / 実装中 / 後回しに分け、次の作業判断で迷わないようにする。

## 採用済み

| 項目 | 実装 | 根拠 |
|---|---|---|
| Prompt構造診断 | `ResearchWorkflowPanel` に主題、構図、絵柄、照明、negative、seed、LoRA trigger、ADetailer、ControlNet、SDXL解像度の診断を追加 | Civitai Prompting、Stable Diffusion Art workflow、Replicate guide、二次情報の共通作法 |
| Quick Fix | 診断カードから構図/絵柄/照明/negative追加、重複整理、主題前方移動、LoRA trigger追加、ADetailer顔補修、ControlNet Unit準備、SDXL解像度補正を実行 | 「神設定」より段階的修正と比較が重要という調査結果 |
| 制作レシピ | 構図探索、全身キャラ顔補修、Prompt構造の土台、ポーズ/線画固定、仕上げUpscaleをレシピ化 | 複数講座で共通する制作段階 |
| Reliability Badge | レシピに信頼度A/Bと `一次+講座一致` / `複数講座一致` / `Creator実例` を表示 | 二次情報を鵜呑みにしない運用ルール |
| Model Prompt Contract | Civitai sample metadata 由来の sampler / steps / CFG / size / clip skip / negative を制作ナレッジ内で表示・適用 | モデルごとの推奨値は汎用レシピより優先 |
| Compatibility Guard | Preflightに長いPrompt、LoRA base model不一致、LoRA trigger不足、SDXL小解像度、ControlNet base mismatch警告を追加 | 古いworkflowや互換不一致が失敗原因になりやすい |
| Preflight操作接続 | blockerをGenerate disabled理由へ接続し、警告行から該当セクションへ移動、LoRA trigger / SDXLサイズはQuick Fix可能にした | 警告を見るだけでなく、その場で修正へ進めるため |
| PixAI ONNX Tagger最小実行 | `runtime/forge/webui/models/Tagger` の `model.onnx` + `selected_tags.csv` をForge Python + ONNX Runtimeで実行するIPCを追加。未配置/依存不足は状態として返す | `deepghs/pixai-tagger-v0.9-onnx` は448x448、general 0.30 / character 0.85の運用が明示されている |
| Tagger精度比較 | PixAI ONNXモデルを配置し、PixAI / WD14 / DeepDanbooru / CLIPをローカルQA画像5件で比較。除外ルール適用後はPixAIがScore 67.7%、WD14が65.5%で僅差。Historyレビューが保存されている場合は評価サンプルへ自動追加する | [`TAGGER_ACCURACY_COMPARISON_2026-05-14.md`](TAGGER_ACCURACY_COMPARISON_2026-05-14.md) |
| Tagger除外・レビュー | PixAI ONNXに最低confidence、blacklist、meta除外を追加。Historyに正解タグ/除外タグを保存できるレビューパネルを追加し、保存済みレビューからblacklist候補と推奨minScoreを集計する | `qa:dom:tagger` / `qa:dom:history-review` / `qa:dom:history-review-report-source` |
| Review Prompt連携 | Historyレビューの正解タグをPromptへ、除外タグをNegativeへ送れるようにし、Prompt Helperにも保存済みレビュータグの再利用導線を追加 | `qa:dom:history-review-prompt` / `qa:dom:prompt-helper-review` |
| Model Library partial運用 | 整合性チェックの孤立partialに削除ボタンを追加。削除対象はForgeモデルフォルダ配下かつ `.partial` を含むファイルに限定 | 大容量partialを検出後にTools内で処理できるようにする |
| Prompt Library整理 | `制作レシピ` カテゴリを追加し、比較・探索、参照・制御、仕上げ・検査タグを追加 | Prompt Libraryを調査ナレッジの入口にする |
| Quick Preset整理 | 構図探索、全身構図、カメラ角度を内蔵Quick Presetに追加 | よく使う制作操作をPrompt欄直上へ置く |

## 実装中 / 次スライス

| 項目 | 次の形 |
|---|---|
| Compare Studio | History差分、保存済みレビュー結果、seed固定を使い、Tagger / prompt / CFG / steps / LoRA weight / ADetailer ON/OFFを並べる |
| Taggerレビュー運用 | 保存済みレビューを増やし、2回以上出た除外タグを既定blacklist昇格候補として確認する |
| Model Library Prompt Contract保存 | 現在はCivitai recommendationから表示。次は `userdata/model-library/index.json` にモデル別の契約として保存 |
| Role-based Control Cards強化 | ControlNet Builderの既存role presetに、調査ソースとbase model互換表示を足す |

## 後回し

| 項目 | 理由 |
|---|---|
| ComfyUI workflow完全再現 | Forge API主軸の本アプリでは自由ノード再現より、role-based recipe化の方が低リスク |
| GPL/gated Tagger同梱 | 配布・利用条件のリスクが高いため、既定候補はApache公開モデルに限定 |
| 大型all-in-one workflow導入 | 依存拡張とバージョン差で壊れやすい。Yoitomoshiでは小さなレシピへ分解する |

## 検証済み

- TypeScript typecheck: PASS
- Electron build: PASS
- Prompt Library YAML parse: PASS
- Quick Preset表示: PASS
- Prompt側UIで制作ナレッジ、Reliability Badge、Quick Fix、Recipe、SaveをDOM確認: PASS
- Model Prompt Contract表示と適用: PASS
- Compatibility Guard DOM確認: PASS
  - SDXL小解像度
  - LoRA base model不一致
  - LoRA trigger不足
  - ControlNet SD1.5/SDXL mismatch
- 最小txt2img実生成: PASS
- Model Library整合性: 孤立partial検出を追加し、現環境の1件を安全削除。再チェック `issues=0`
- Preflight操作接続DOM QA: PASS
  - Generate disabled理由
  - Preflight Open
  - LoRA trigger Quick Fix
  - SDXL size Quick Fix
  - Tools Tagger / Model Library IPC surface
- Tagger IPC smoke: PASS
  - `runtime/forge/webui/models/Tagger/model.onnx` と `selected_tags.csv` を配置後、`status=ok` を確認
  - Forge Pythonの `onnxruntime` / `PIL` / `numpy` は存在確認済み
- Tagger精度比較: PASS
  - PixAI ONNX: Score 67.7%、Coverage 75.0%、平均 4735ms
  - WD14: Score 65.5%、Coverage 68.0%、平均 906ms
  - DeepDanbooru / CLIPは参考値として低め
  - 現在の保存済みHistoryレビューは0件。比較スクリプトは `historyReview.includedSamples=0` として正直に出力し、一時レビューfixtureでは `historyReviewSamples=1` の取り込みを確認済み
- Tagger除外ルール: PASS
  - `minScore=0.4`、meta除外、blacklistをIPCへ渡し、`suppressedTags` とfilter summaryを返す
  - `qa:dom:tagger-blacklist` でblacklistに入れたタグがPrompt候補から外れ、`suppressedTags.reason=blacklist` になることを確認
- History正解タグレビュー: PASS
  - DOM QAでレビューパネルを開き、正解タグ保存後に `tagReview.acceptedTags` が永続化されることを確認
  - Renderer reload後も `tagReview` が復元されることを `qa:dom:history-review-persistence` で確認
  - 正解タグ→Prompt、除外タグ→Negativeの導線を `qa:dom:history-review-prompt` で確認
  - Prompt Helper内のレビュー済みタグ再利用を `qa:dom:prompt-helper-review` で確認
- 孤立partial削除smoke: PASS
  - `yoitomoshi-dom-qa-*.safetensors.partial` のテストファイルだけを作成し、IPC削除後 `afterPartials=0`

証跡:

- [`QA_CREATOR_WORKFLOW_P2_2026-05-14.md`](QA_CREATOR_WORKFLOW_P2_2026-05-14.md)
- [`UNVERIFIED_DEEP_VALIDATION_REPORT_2026-05-14.html`](UNVERIFIED_DEEP_VALIDATION_REPORT_2026-05-14.html)
- [`QA_UNVERIFIED_DEEP_VALIDATION_2026-05-14.md`](QA_UNVERIFIED_DEEP_VALIDATION_2026-05-14.md)
- [`TAGGER_ACCURACY_COMPARISON_2026-05-14.md`](TAGGER_ACCURACY_COMPARISON_2026-05-14.md)

## 条件付きで残る検証

- WindowsローカルのP2仕上げQAは完了。
- 別OS、コード署名、SmartScreen、公開installerは、対象環境と証明書が必要な公開配布フェーズで検証する。
- Tagger精度比較はローカルQA画像の擬似評価として完了し、保存済みHistoryレビューがある場合は評価データへ取り込む。現時点の実データでは保存済みレビュー0件のため、レビュー運用を増やすほどblacklist候補と推奨minScoreが更新される。
