# Forge Prompt Composer Port Alternatives

## Codebase Findings
- `src/components/PromptPanel.tsx` は positive prompt ヘッダーに英訳、整形、モデル別整形ボタンを直接持ち、下部の `RefineModePanel` に `PromptHelperPanel` を表示している。
- `src/components/PromptTagsWorkspace.tsx` は quick add の `parseTagInput()` が comma/newline のみを扱い、句読点や保護構文への配慮は薄い。画面末尾にも `PromptHelperPanel` がある。
- `src/components/PromptHelperPanel.tsx` は自然文から候補を出すが、append中心で、prompt入力欄の直接整理UIとしては分かりづらい。一方で History review tags 連携はForge版固有の有用機能。
- `src/lib/prompt-utils.ts` は `formatPromptText()`、LoRA保護、重複整理、重み調整、token分割など既存の土台がある。
- `electron/ipc-handlers.ts` / `electron/preload.ts` / `src/shared/ipc-channels.ts` には tag単体翻訳の `translation:prompt-tag` があるが、ComfyUI版の prompt全文翻訳Runtimeとは別物。
- ComfyUI版には `src/lib/prompt-composer.ts`、`src/components/PromptComposerPanel.tsx`、`qa:dom:prompt-composer` があり、代表入力と tags workspace 連携を検証済み。

## Options

### Option A: ComfyUI版をそのままコピー
Effort: Small
Value: Medium

Summary:
`prompt-composer.ts` と `PromptComposerPanel.tsx` をForge版へほぼそのまま移す。

Benefits:
- 実装が速い。
- ComfyUI版で通ったテスト構造を流用しやすい。

Tradeoffs:
- Forge版の既存 tag翻訳IPC、PromptHelper、History review tags と重複しやすい。
- `PromptHelperPanel` を消すだけだと、Forge版固有の履歴レビュー連携を失う可能性がある。
- deep-translator runtime の移植漏れがあると、UIだけあって翻訳が不安定になる。

Visual or Flow:
```text
ComfyUI PromptComposer
  -> Forge PromptPanel
  -> Forge TagsWorkspace
```

### Option B: Forge版に合わせた Adapter Port
Effort: Medium
Value: High

Summary:
ComfyUI版の純粋変換ロジックとUIを移植しつつ、Forge版の `prompt-utils`、tag翻訳IPC、History review tags、preflight、DOM QA に接続する。

Benefits:
- 2アプリで同じ Composer 体験にできる。
- 既存Forge機能を失わない。
- `Prompt Helper` の重複を整理しやすい。
- 段階実装と回帰QAがしやすい。

Tradeoffs:
- そのままコピーより接続確認が多い。
- 既存 `PromptHelperPanel` の残し方を丁寧に決める必要がある。

Visual or Flow:
```text
Japanese / mixed prompt
  -> prompt-composer pure logic
  -> local dictionary / prompt library / optional deep-translator
  -> formatPromptText
  -> PromptPanel or TagsWorkspace
  -> existing PromptTagChips / QuickPreset / preflight
```

### Option C: Cross-Repo Shared Package化
Effort: Large
Value: Medium

Summary:
Forge版とComfyUI版の共通 `Prompt Composer` をワークスペース共有パッケージまたはコピー同期用モジュールとして再設計する。

Benefits:
- 長期的には二重メンテを減らせる。
- Composer辞書、QA、翻訳runtimeの仕様を一本化できる。

Tradeoffs:
- 今回の目的に対して重い。
- 2リポジトリのビルド設定やパス解決を巻き込み、実装前のリスクが増える。
- 既存の未コミット変更が多い現状では差分が膨らみやすい。

Visual or Flow:
```text
shared prompt-composer package
  -> Forge app
  -> ComfyUI app
```

### Option D: 既存 Prompt Helper の小改善だけ
Effort: Small
Value: Low

Summary:
`PromptHelperPanel` と `parseTagInput()` だけを少し改善し、Composerは作らない。

Benefits:
- 変更量が少ない。
- 既存UIを大きく変えない。

Tradeoffs:
- ユーザーが求めている「入力欄で直接、日本語自然文から英語タグへ整える」体験に届きにくい。
- ComfyUI版との操作差が残る。

## Recommendation
Option B を採用する。理由は、ComfyUI版で得た `Prompt Composer` の良い部分を活かしつつ、Forge版に既に存在する Prompt Helper、tag翻訳、History review、Forge preflight を壊さず統合できるため。
