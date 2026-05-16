# Dynamic Prompt Lab 実装記録 2026-05-16

対象調査: [`EXTENSION_RESEARCH_SD_DYNAMIC_PROMPTS_2026-05-16.html`](EXTENSION_RESEARCH_SD_DYNAMIC_PROMPTS_2026-05-16.html)

## 実装したこと

- `sd-dynamic-prompts` の主要価値を、Forge拡張UIの埋め込みではなく Yoitomoshi Art Generator 側の自前UIとして実装した。
- `{red|blue}`、`2::weighted`、`{2$$A|B|C}`、`{2$$ and $$A|B|C}`、ネスト、`__wildcard__` を解決する `src/lib/dynamic-prompts.ts` を追加した。
- Prompt Library、Custom Library、History review の accepted/rejected tags、recent tags、favorite tags から wildcard 候補を組み立てるようにした。
- PromptPanel に `Dynamic Prompt Lab` を追加し、展開プレビュー、seed固定、1案反映、negative反映、ControlNet構図固定準備を操作できるようにした。
- 通常生成とVariation生成で、Dynamic Promptを生成直前に解決し、Historyへ template/resolved prompt、prompt seed、使用wildcardを保存するようにした。
- Variation に `Prompt` 軸を追加し、同じ画像seedを固定したまま Dynamic Prompt seed だけを変えて比較できるようにした。
- Preflight に Dynamic Prompt の解決エラー/有効状態を追加し、未定義wildcardを生成前に止めるようにした。
- History grid に Dynamic Prompt 由来の生成であることと prompt seed を確認できるbadgeを追加した。

## 採用しなかった案

- Forge/Gradio側の `sd-dynamic-prompts` UIをそのまま埋め込む案は採用しない。現行方針の React UI と生成payload制御を維持するため。
- ファイルシステム上の wildcard `.txt` を直接読む案は今回見送り。まずはアプリ内の Prompt Library / History / favorite を信頼できる候補源にする。
- full batch manager は今回見送り。まずは Prompt Lab のプレビューと Variation の Prompt 軸で小さく比較できる形を優先した。

## 検証

- `npm.cmd run typecheck`: 成功。
- `npm.cmd run build`: 成功。
- `npm.cmd run qa:dom -- selectors --port=9338`: 成功。
- `npm.cmd run qa:dom:dynamic-prompt -- --port=9338`: 成功。展開プレビュー、1案反映、未定義wildcardのエラー表示を確認。

## 修正中に出た問題

- 汎用 selector smoke に、折りたたみ内部の `dynamic-prompt-seed` / `dynamic-prompt-summary` / `dynamic-prompt-apply-preview` を必須として追加したため、閉じた状態で失敗した。
- 対応: 汎用 selector smoke は常時表示される `dynamic-prompt-lab` と `dynamic-prompt-toggle` の確認に絞り、内部操作は `qa:dom:dynamic-prompt` で検証するように分離した。

## 次に残す候補

- ユーザー定義 wildcard set の保存/編集UI。
- Dynamic Prompt template を名前付きプリセットとして保存する機能。
- 複数promptをグリッド生成する batch surface。
- History detail で template/resolved prompt の差分を展開表示する機能。
