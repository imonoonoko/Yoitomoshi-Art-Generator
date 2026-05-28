# AIイラストサイト由来タグ収集 拡張方針

## 結論

プロンプト大辞典は、無差別スクレイピングではなく、出典管理つきの収集パイプラインとして拡張する。

推奨構成は以下。

```text
source registry
  -> import jobs
  -> userdata/prompt-dictionary/ingest.sqlite
  -> prompt parser
  -> candidate/evidence tables
  -> 日本語訳/意味のレビュー
  -> promoted dictionary pack
  -> runtime prompt-dictionary.sqlite
```

既存のSQLite/FTS5ランタイム辞書は維持し、外部収集データは直接混ぜず、まず `userdata/prompt-dictionary/ingest.sqlite` のステージングDBに入れる。

## 最初に集めるべきデータ

- Civitaiの公開APIから取得できる画像メタデータ内のプロンプト。
- Yoitomoshi/Forge/ComfyUI/A1111など、ユーザー自身の生成履歴・PNGメタデータ。
- Hugging Face上のライセンス明記済みプロンプトデータセット。
- Danbooru系のタグ語彙・カテゴリ・件数などのタグメタデータ。

## MVPで避けるもの

- HTMLページの巡回スクレイピング。
- Cloudflareやログイン画面を迂回する取得。
- 利用規約で自動取得・索引化が禁止されているサイトの一括収集。
- 画像本体の保存。
- 出典、ライセンス、取得日時、成人向け分類を残せないデータ。

## 重要な設計判断

- `raw_prompt_records` と `candidate_tags` を分ける。
- LoRA構文やモデル名は通常タグとして混ぜず、リソース証拠として扱う。
- positive prompt と negative prompt の証拠は分ける。
- 日本語ラベルと日本語の意味説明は別フィールドにする。
- 機械翻訳は `machine-draft` として扱い、既存の人手キュレーションを上書きしない。
- runtime辞書に昇格する前に、レビュー、非表示、却下、出典別削除ができるようにする。

## 実装開始順

1. `resources/prompt-dictionary/sources.json` で収集元レジストリを作る。
2. `userdata/prompt-dictionary/ingest.sqlite` のステージングDBを作る。
3. まずローカル履歴/手動CSV/TXT/PNGメタデータ取り込みを実装する。
4. 次にCivitai公開API importerを実装する。
5. プロンプトパーサーでタグ候補、重み、LoRA、Dynamic Prompt、negative promptを分離する。
6. 候補タグを証拠つきで集計し、日本語訳・意味レビューキューへ流す。
7. レビュー済み候補だけを既存の `prompt-dictionary.sqlite` に昇格する。

詳細は同フォルダの `1_purpose.md` から `6_implementation_brief.md` を参照。
