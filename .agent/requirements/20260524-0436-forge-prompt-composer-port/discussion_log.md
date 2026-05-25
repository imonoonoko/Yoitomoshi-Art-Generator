# Forge Prompt Composer Port Discussion Log

## Intake And Direction - 2026-05-24 04:36

### User Input
> このセッションで行った事をForge版にも適応したい。プロンプトコンポーザーとかその他細かな修正。まずはプランを組んで

### Codex Proposal Or Question
ComfyUI版で実装した全モデル共通 Prompt Composer を、Forge版 `Yoitomoshi-Art-Generator` に移植する前提で要件定義を作成する。実装はまだ行わず、既存Forge側の Prompt Helper / PromptTagChips / PromptLibrary / 翻訳IPC / DOM QA との接続点を調べた上で計画へ落とす。

### Decisions
- Accepted: Forge版にも `Prompt Composer` を導入する計画を作る。
- Accepted: `Anima補助` ではなく全モデル共通のプロンプト整理機能として扱う。
- Accepted: `txt2img` と `タグ管理` の両方で使える前提にする。
- Accepted: 既存のタグ編集、重み、positive/negative移動、クイックプリセット、Forge固有のモデル別整形は維持する。
- Open: 実装時に既存 `PromptHelperPanel` の履歴レビュー連携を Composer 内へ完全統合するか、補助パネルとして残すかは、MVPでは「機能を失わない」方針で扱う。

### Rationale
ComfyUI版の差分をそのままコピーすると、Forge版に既に存在する tag library 翻訳、Prompt Helper、History review 連携、Forge preflight と重複する。まずは共通化できる純粋ロジックとUIの境界を定義し、既存機能を壊さない移植順にする。

---
