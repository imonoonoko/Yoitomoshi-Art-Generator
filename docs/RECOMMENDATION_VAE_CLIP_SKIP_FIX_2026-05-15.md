# Recommendation VAE / Clip Skip fix 2026-05-15

## 症状

- Civitai推奨設定を適用するたびに、推奨VAEを再ダウンロードしようとする。
- 推奨設定やPNGメタデータ適用で `clipSkip` が `undefined` になると、生成payloadの `CLIP_stop_at_last_layers` に `undefined` が入り、Forge生成が失敗する。

## 原因

- 推奨VAEのローカル一致判定が完全一致寄りで、拡張子違い・ファイル名stem・Forge側のVAE表示名違いを拾いきれなかった。
- `applyRecommended` / community apply が `clipSkip: undefined` を `patchParams()` に渡し、store側がそのまま既存値へ上書きしていた。
- Civitai download IPCは、保存先ファイルが既に存在する場合でもdownload開始前に短絡していなかった。

## 採用した修正

- `patchParams()` で `undefined` / `null` を既存値へ上書きしないようにし、`clipSkip` は最低1へ正規化する。
- 生成payload作成時にも `normalizeGenerationParams()` を通し、`CLIP_stop_at_last_layers` が必ず数値になるようにする。
- 推奨VAE適用は、ローカルVAE一覧を正規化名で照合し、見つからない場合だけ最新VAE一覧を再取得する。それでも無い場合だけdownloadへ進む。
- 同一VAE downloadのin-flight重複をrendererで抑止する。
- `civitai:download` は保存先ファイルが既にある場合、ネットワーク取得せず既存パスを返す。

## 検証

- `npm.cmd run typecheck` PASS。
- `npm.cmd run build` PASS。
- Electron IPCで既存 `qwen_image_vae.safetensors` に対して `civitai.download()` を呼び、5msで既存パスを返すことを確認。ネットワークdownloadへ進まない。
- `npm.cmd run qa:dom:api -- --port=9338` PASS。
- `npm.cmd run qa:dom -- selectors --port=9338` PASS。

## 運用メモ

推奨設定適用は、ローカルに存在するVAEを選択するだけに寄せる。未導入VAEは自動downloadできるが、既存ファイルや実行中downloadがある場合は再取得しない。
