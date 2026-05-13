# Tagger Implementation Plan - 2026-05-14

## 結論

画像タグ抽出は、既存の Forge `/sdapi/v1/interrogate` を残したまま、次の順で段階導入する。

1. `deepghs/pixai-tagger-v0.9-onnx`
   - 標準候補。Apache-2.0、公開ONNX、PixAI Tagger v0.9のONNX repack。
   - 13,461 tags。general threshold 0.30、character threshold 0.85。
   - 新しめのキャラ/作品名カバーを期待できるため、Yoitomoshi Art Generator の主用途に最も合う。
2. `SmilingWolf/wd-eva02-large-tagger-v3`
   - 比較基準。Apache-2.0、timm/ONNX/safetensors。
   - Danbooru 2024-02まで、10,861 tags、P=R threshold 0.5296。
   - PixAIが過剰検出した時の回帰テストと安全なfallbackにする。
3. `Grio43/OppaiOracle`
   - 実験枠。Apache-2.0、19,294 general tags。
   - V1.1は macro/micro P=R threshold 0.753/0.793 と高い報告値。
   - general tag cleanupに期待するが、character/copyright taggerの置き換えにはしない。
4. `Camais03/camie-tagger-v2`
   - 研究比較。GPL-3.0、70,527 tags。
   - 広いartist/character/copyright/meta coverageは魅力だが、既定同梱・自動導入はしない。
5. `animetimm/convnextv2_huge.dbv4-full`
   - 保留。GPL-3.0かつgated。重く、初期統合対象ではない。
6. `cella110n/cl_tagger`
   - 実験枠。Apache-2.0、ONNX、42k規模の広い語彙。
   - 公開評価情報が薄いため、PixAI/WD/OppaiOracleの後にローカル素材で比較する。

## 実装境界

2026-05-14時点で、導入準備・運用UI・PixAI ONNXの最小実行パスまで実装済み。

- `CivitaiAssetType` に `Tagger` を追加。
- Hugging Face検索で `.onnx` / `.bin` も候補に含め、`image-classification` / `tagger` / `danbooru` / `multi-label` 系タグを `Tagger` として推定する。
- Tagger の保存先を `runtime/forge/webui/models/Tagger` に固定する。
- Model Library と Model Health が Tagger フォルダを認識する。ただしTagger未導入は通常運用上あり得るため、フォルダ未作成は警告にしない。
- Tools に `Tagger Catalog` を追加し、一次情報ベースの採用順、ライセンス、実行形式、タグ数、threshold方針、注意点を表示する。
- Catalog上で Hugging Face のモデルカードを開けるようにし、必要時にHFファイル候補を確認できるようにする。
- img2img のタグ抽出は現行Forge built-inを維持しつつ、`DeepDanbooru` / `CLIP caption` / `PixAI ONNX (local)` を選べる。
- Civitai/Hugging Face検索モーダルに `Tagger` フィルタを追加する。Civitai自体にはTagger型を投げず、HF側の分類に使う。
- `tools:run-tagger` IPCを追加し、Forge Python + `onnxruntime` + `PIL` + `numpy` で `model.onnx` と `selected_tags.csv` をローカル実行する。
- PixAIの前処理は公開Space実装に合わせ、RGB化、448x448 bicubic resize、`(x - 0.5) / 0.5`、NCHWへ変換する。
- general thresholdは0.30、character thresholdは0.85を既定にする。
- モデル未配置は `missing-model`、Python依存不足は `missing-runtime` としてUIへ返し、例外で導線を壊さない。
- 取得タグはPromptへ入れる前に `minScore`、blacklist、meta除外で抑制し、除外されたタグは `suppressedTags` として理由付きで返す。
- Historyレビューで正解タグ/除外タグを保存し、比較スクリプトは保存済みレビューを追加評価サンプルとして読み込む。
- 保存済みレビューから頻出除外タグとPixAIの推奨最低confidenceを集計し、blacklist既定値の調整候補にする。
- Historyレビューの正解タグはPromptへ、除外タグはNegativeへ送れる。Prompt Helperにもレビュー済みタグの再利用導線を追加する。

## 次スライス

- `general` と `character` を別グループで表示し、character系は高thresholdを既定にする。
- WD14を同じ画像で走らせる精度比較は完了。除外ルール適用後のローカルQA画像5件ではPixAI ONNXがScore 67.7%、WD14が65.5%で僅差。詳細は [`TAGGER_ACCURACY_COMPARISON_2026-05-14.md`](TAGGER_ACCURACY_COMPARISON_2026-05-14.md)。
- 現在の保存済みHistoryレビューは0件。レビューが増えるほど `qa:tagger:compare` の `historyReview` セクションがblacklist候補とminScore推奨値を更新する。
- 2回以上出た除外タグを既定blacklistに昇格するかは、レビュー件数が増えてから判断する。
- OppaiOracleは general tag cleanup の比較に限定し、キャラ認識の既定にはしない。

## 一次情報

- https://huggingface.co/deepghs/pixai-tagger-v0.9-onnx
- https://huggingface.co/SmilingWolf/wd-eva02-large-tagger-v3
- https://huggingface.co/Grio43/OppaiOracle
- https://huggingface.co/Camais03/camie-tagger-v2
- https://huggingface.co/animetimm/convnextv2_huge.dbv4-full
- https://huggingface.co/cella110n/cl_tagger
