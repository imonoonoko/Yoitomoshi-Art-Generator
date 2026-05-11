# ControlNet preprocessor QA — 2026-05-12

対象: ControlNet Builder の画像ドロップ後 preprocessor 実行と、`/controlnet/detect` 経由の結果画像生成。

## 環境

- Forge: `runtime/forge`
- API: `http://127.0.0.1:7860`
- 入力素材: `userdata/history/3f1ec9bb-6695-4e21-8874-da5047c6d1e6.png`
- 出力先: `output/controlnet-qa/`
- Summary: `output/controlnet-qa/summary.json`

## 結果

| module | 結果 | 出力 | 所要時間 |
|---|---:|---|---:|
| `tile_resample` | PASS | `output/controlnet-qa/tile_resample.png` | 279 ms |
| `openpose_full` | PASS | `output/controlnet-qa/openpose_full.png` | 70,678 ms |
| `lineart_standard (from white bg & black line)` | PASS | `output/controlnet-qa/lineart_standard__from_white_bg___black_line_.png` | 136 ms |
| `depth_midas` | PASS | `output/controlnet-qa/depth_midas.png` | 66,094 ms |

## 判断

- ControlNet preprocessor API は実素材で動作確認済み。
- `tile_resample` と `lineart_standard` は軽い。
- `openpose_full` と `depth_midas` は初回ロード込みで1分以上かかるため、UIでは実行中表示を維持する必要がある。現状の `detecting` 状態とボタンdisableは妥当。
- 現在配置済みControlNet modelは `None` と `xinsir-controlnet-tile-sdxl-1.0 [4d6257d3]`。pose / lineart / depth の生成固定用ControlNet modelは未配置だが、preprocessor結果画像の生成自体は通る。

## 次に見ること

- Builder UIから同じ操作を行い、長時間preprocessor中の表示とキャンセル不能状態が許容できるか確認する。
- pose / lineart / depth 用ControlNet modelを追加した後、preprocessed画像を `module: None` で固定参照にする現設計が実生成で崩れないか確認する。
