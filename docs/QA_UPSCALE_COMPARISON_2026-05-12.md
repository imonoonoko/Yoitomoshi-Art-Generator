# Upscale comparison QA — 2026-05-12

対象: Upscale Diffusion の Tile ControlNet ON/OFF と denoise 差分を、同一素材で比較保存する導線。

## 環境

- Forge: `runtime/forge`
- API: `http://127.0.0.1:7860`
- 入力履歴: `userdata/history/3f1ec9bb-6695-4e21-8874-da5047c6d1e6.png`
- QA入力: 元画像 768x512 を 384x256 へ縮小して使用
- 出力サイズ: 576x384
- Method: `diffusion` / MultiDiffusion
- Scale: `1.5`
- Tile ControlNet:
  - module: `tile_resample`
  - model: `xinsir-controlnet-tile-sdxl-1.0 [4d6257d3]`

## 保存結果

- Manifest: `userdata/upscale-comparisons/0c0126bc-8fe3-4cd8-a349-00a1a584f329/comparison.json`
- Contact sheet: `output/upscale-qa/upscale-comparison-0c0126bc.png`

| 条件 | 結果 | 所要時間 |
|---|---:|---:|
| Tile OFF / denoise 0.25 | PASS | 16,264 ms |
| Tile OFF / denoise 0.35 | PASS | 3,069 ms |
| Tile OFF / denoise 0.45 | PASS | 1,566 ms |
| Tile ON / denoise 0.25 | PASS | 9,802 ms |
| Tile ON / denoise 0.35 | PASS | 8,836 ms |
| Tile ON / denoise 0.45 | PASS | 8,243 ms |

合計所要時間: 47,810 ms

## 判断基準

- drift: 顔、髪型、水着、体の向きが入力から大きく変わらないこと。
- seam: 画面中央や上下左右にタイル境界の色差・形状差が出ないこと。
- detail: 水面、髪、輪郭が増える一方で、顔や手が崩れないこと。

## 目視判断

- 6候補すべてで、明確な tile seam は見えなかった。
- `Tile OFF / denoise 0.25` は顔・髪・体の保持が最も安定。ただし追加detailは控えめ。
- `Tile OFF / denoise 0.35` と `0.45` はdetailが増える一方、顔・口・頬の色崩れが見えた。
- `Tile ON / denoise 0.25` は構造を比較的保ったまま、水面・髪・輪郭のdetailが自然に増える。
- `Tile ON / denoise 0.35` と `0.45` はdetailは強いが、顔まわりの崩れが増える。既定値にはしない。

## 採用方針

- 標準候補: `Tile ON / denoise 0.25`
- 顔やポーズの保持を最優先する場合: `Tile OFF / denoise 0.25` も確認する。
- `denoise 0.45` はdetail確認用。人物素材の既定値にはしない。

## 次に見ること

- 保存済み比較の一覧表示と、候補からUpscale出力へ再採用する導線を Tools に追加する。
- 顔・手・衣装パーツが細かい素材でも同じ基準で破綻しないか、別素材で2回目の比較を行う。
