# Forge Prompt Composer Port Purpose

## Problem
Forge版には既に `Prompt Helper`、英訳ボタン、整形ボタン、タグ管理、タグ翻訳が存在するが、入力欄まわりの役割が分散している。日本語の自然文、英語タグ、LoRA、重み付きタグ、dynamic prompt を混ぜて入力したときに、どこで整えるべきか分かりづらい。

## Target User
Forge版 Yoitomoshi Art Generator を個人利用する制作者。日本語でラフに入力し、最終的には Stable Diffusion / Forge に渡しやすい英語タグ列へ整えたいユーザー。

## Current Workaround
- `txt2img` の英訳ボタンでローカル辞書ベース変換を行う。
- `Prompt Helper` で候補を生成して追加する。
- `タグ管理` の quick add や `PromptTagChips` で個別に編集する。
- `整形` / `モデル向け整形` を別ボタンで実行する。

## Why Now
ComfyUI版で、`Prompt Composer` として入力、英訳、句読点整理、タグ整形、LoRA保護、タグ管理連携を一体化できる形ができた。Forge版にも同じ使い心地を合わせると、2つのアプリでプロンプト作成の手順が揃う。

## Desired Outcome
Forge版でも `Prompt Composer` がプロンプト入力欄とタグ管理タブで使える。ユーザーは `コスプレ、初音ミク、ダンスシーン` のように入力し、`cosplay, hatsune miku, dance scene` のような英語タグ列へ自然に変換できる。

## Success Definition
- `txt2img` と `タグ管理` の両方で同じ Composer 変換ロジックを使う。
- LoRA、LyCORIS、重み付きタグ、`BREAK`、dynamic prompt を壊さない。
- Forge版の既存タグ編集、重み変更、positive/negative移動、QuickPreset、preflight整形が維持される。
- 既存の `Prompt Helper` より入口が分かりやすくなり、重複UIが減る。
- DOM QAで代表入力の変換と既存 prompt-format 回帰を確認できる。
