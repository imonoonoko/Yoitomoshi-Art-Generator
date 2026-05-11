# ControlNet Builder UI QA — 2026-05-12

対象: ControlNet Builder の画像ドロップ、preprocessor実行、結果プレビュー、Unit 1反映。

## 環境

- Forge: `runtime/forge`
- Electron remote debugging: `http://127.0.0.1:9223`
- 入力素材: `output/workspace-qa/external-ref.png`
- Summary: `output/ui-qa/controlnet-depth-qa-summary.json`
- Screenshots:
  - `output/ui-qa/controlnet-depth-running-2026-05-12.png`
  - `output/ui-qa/controlnet-depth-complete-2026-05-12.png`
  - `output/ui-qa/controlnet-depth-applied-2026-05-12.png`

## QA中に見つけた問題

1回目のUI確認では、Depthロールが `depth_anything` を選択し、150秒を超えてもpreprocessorが戻らなかった。

対応:

- Depthロールの優先moduleを `depth_midas` -> `depth_anything` -> `depth_zoe` に変更した。
- preprocessor実行時の `processorRes` を `-1` ではなく `512` に固定した。
- 実行中の空プレビュー、ステータス行、実行ボタンに経過秒を表示するようにした。

## 再検証結果

| 項目 | 結果 |
|---|---:|
| 画像ドロップ | PASS |
| Depthロール選択 | PASS |
| 実行中の経過秒表示 | PASS |
| `depth_midas` preprocessor結果プレビュー | PASS |
| Unit 1反映 | PASS |
| 型チェック | PASS |
| build | PASS |

実行中表示:

- `hasRunningSeconds`: true
- running sample: `2s`

完了:

- `completed`: true
- `failed`: false
- wait loop elapsed: 1,003 ms

Unit 1反映:

- `appliedToast`: true

## 判断

- Builder UIから、画像投入 -> Depth preprocessor -> 結果プレビュー -> Unit 1反映まで通った。
- 長時間preprocessorでも、画面上に経過秒が出るため、アプリが止まったようには見えない。
- `depth_anything` は現環境では重すぎる可能性があるため、Builderの標準Depthは `depth_midas` を優先する。
- Depth用ControlNet model自体は未配置のため、実生成でDepth ControlNetを使うには対応model追加後の生成QAが必要。
