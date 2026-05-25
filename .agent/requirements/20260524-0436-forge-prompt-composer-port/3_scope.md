# Forge Prompt Composer Port Scope

## MVP
- `src/lib/prompt-composer.ts` 相当の純粋変換ロジックをForge版へ導入する。
- `コスプレ、初音ミク、ダンスシーン` を `cosplay, hatsune miku, dance scene` へ変換できる辞書ルールを含める。
- `、`、`。`、`;`、改行などを prompt tag separator として扱う。
- LoRA / LyCORIS / hypernet系の `<...>`、重み付き `(tag:1.2)`、`BREAK`、`{a|b}`、`[tag]` を壊さない。
- `PromptPanel` の positive prompt 付近に `Prompt Composer` を置き、既存の英訳・整形・モデル別整形ボタンを整理する。
- `PromptTagsWorkspace` の quick add に同じ `Prompt Composer` を置く。
- `PromptTagsWorkspace` の手入力追加も `parsePromptComposerTags()` を使う。
- 既存 `PromptTagChips`、QuickPreset、positive/negative移動、重み変更は維持する。
- i18n に `promptComposer.*` を追加する。
- DOM QA に `qa:dom:prompt-composer` を追加し、代表入力、LoRA保護、tags workspace 追加を確認する。
- 既存 `qa:dom:prompt-format` と selectors smoke を通す。

## Nice To Have
- 既存 `PromptHelperPanel` の History review tags 機能を、Composer下部または TagsWorkspace内の小パネルとして整理する。
- Google翻訳 / MyMemory の既存 tag翻訳UIと、prompt全文翻訳UIの説明を統一する。
- Composerの辞書候補をユーザーが後から追加できる導線を設計する。

## Future
- Forge版とComfyUI版で `prompt-composer.ts` を共有パッケージ化する。
- Tag-Manager 的な語彙辞書、カテゴリ辞書、別名辞書をインポートできるようにする。
- 生成履歴から「成功しやすいタグ」をComposer候補へ反映する。
- モデルプロファイル別に推奨タグ、negative、CFG/steps注意を出す。

## Out Of Scope
- Anima専用UIとして作ること。
- Forgeのモデルローダーや生成APIの挙動変更。
- ComfyUI版の追加改修。
- 公開配布用の翻訳課金、APIキー管理、有料翻訳サービス導入。
- Prompt Library schema の大きな再設計。

## Constraints
- Deadline: まずは実装前プラン。実装は次の指示後に段階的に行う。
- Team/resources: 個人利用のローカルアプリとして、保守しやすい範囲に留める。
- Technology: Electron / React / TypeScript / Forge。既存 npm scripts と DOM QA を使う。
- Budget/cost: 無料前提。prompt全文翻訳は deep-translator Google または既存無料翻訳経路を使い、必ずローカル辞書フォールバックを持つ。
- Compatibility/compliance: 既存Forge機能、未コミット変更、runtime配下を不用意に壊さない。
