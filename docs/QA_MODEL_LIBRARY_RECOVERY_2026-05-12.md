# Model Library recovery QA — 2026-05-12

対象: Tools の Model Library 復旧処理。再起動後に残った未完了ジョブ整理、metadata/preview再取得、SHA未計算モデルのバックグラウンドqueue化を確認する。

## 環境

- Forge: `runtime/forge`
- Electron preload API: `window.api.tools.*`
- Summary:
  - `output/model-library-qa/recovery-summary.json`
  - `output/model-library-qa/recovery-postcheck.json`

## 実行前

| 項目 | 値 |
|---|---:|
| 索引ファイル数 | 11 |
| 合計サイズ | 19,192,927,487 bytes |
| SHA未計算 | 10 |
| metadataあり | 0 |
| previewあり | 0 |
| Download job | 0 |

内訳:

| 種別 | 件数 | サイズ |
|---|---:|---:|
| Checkpoint | 3 | 16,008,709,086 bytes |
| Controlnet | 1 | 2,502,139,104 bytes |
| LoRA | 5 | 597,099,509 bytes |
| Upscaler | 2 | 84,979,788 bytes |

## 復旧結果

`tools.recoverModelLibrary()` の所要時間は 1,453 ms。

| 項目 | 結果 |
|---|---:|
| running job復旧 | 0 |
| completed job補正 | 0 |
| metadata再取得 | 1 |
| preview再取得 | 1 |
| SHA queue投入 | 11 |
| 既存hash queue実行中 | false |

復旧時の再スキャンにより、索引は12件 / 21,325,553,559 bytesになった。

## 復旧後

| 項目 | 値 |
|---|---:|
| 索引ファイル数 | 12 |
| 合計サイズ | 21,325,553,559 bytes |
| metadataあり | 1 |
| previewあり | 1 |
| Download job | 0 |
| 整合性Issue | 0 |
| SHA未計算 | 0 |

内訳:

| 種別 | 件数 | サイズ |
|---|---:|---:|
| Checkpoint | 4 | 18,141,335,158 bytes |
| Controlnet | 1 | 2,502,139,104 bytes |
| LoRA | 5 | 597,099,509 bytes |
| Upscaler | 2 | 84,979,788 bytes |

## UI負荷判断

- 復旧API本体は約1.45秒で返り、SHA計算はバックグラウンドqueueに回った。
- hash queue実行中でも `tools.listModelLibrary()` は 3 ms で応答した。
- 最終postcheckで `checkLibraryIntegrity()` は Issue 0、SHA未計算 0。

## 判断

- 既存の約21.3GBライブラリで、Model Library復旧は実運用可能。
- 未完了Download jobは現環境に無かったため、今回の実データでは復旧件数0が正常。
- SHA計算はUI操作をブロックしない。現時点で追加修正は不要。

## 次に見ること

- 実際に中断されたDownload jobができた時点で、`running -> failed` と `completed補正` の2ケースを別途確認する。
- Model Library一覧に、復旧後に追加されたファイルとmetadata/preview取得件数の履歴を残すUIを検討する。
