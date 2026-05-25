# Pro AI Illustration Workflow Implementation Roadmap

最終更新: 2026-05-25

関連調査: [`PRO_AI_ILLUSTRATION_WORKFLOW_RESEARCH_REPORT_2026-05-25.html`](PRO_AI_ILLUSTRATION_WORKFLOW_RESEARCH_REPORT_2026-05-25.html)

## 目的

Yoitomoshi Forge Studio を、Stable Diffusion / Forge を操作する生成UIから、プロAIイラスト制作のための「レシピ保存、候補選別、モデル別Prompt補助、仕上げ、再利用」ワークフローへ拡張する。

プロンプトを長くする機能ではなく、成功した制作条件を残し、比較し、派生し、モデルごとの作法へ戻せる制作環境を作る。

## 判断基準

- Forge版を主軸にする。ComfyUI専用化や外部モデル統合へ先に飛ばない。
- トップレベルタブは維持する。新機能は既存の `txt2img / img2img / Tags / Video / Upscale / Models / Tools` 内に置く。
- 既存の `HistoryItem`、`CheckpointPromptProfile`、`Prompt Composer`、`Model Library`、`Civitai` 連携を受け皿にする。
- 8GB VRAM前提の安定性を崩さない。FLUX.2 / Qwen / Hunyuan / Z-Image系は任意の調査・外部バックエンド候補として隔離する。
- `userdata/` の後方互換を守る。既存履歴、モデルライブラリ、Civitaiキャッシュは壊さない。
- DOM QAは表示文言ではなく `data-testid` と状態属性を使う。
- GUIはプロ制作ツールとして扱う。小さく密度のある操作面、評価ボタン、折りたたみ詳細、明確な状態表示を優先し、説明過多なフォームや新規タブ乱立は避ける。

## Phase 0: 要件固定とスキーマ設計

### Goal

実装前に、Pro Recipeを既存履歴へどう保存するかを決める。`tagReview` はタグ抽出レビュー用として残し、プロ品質評価は別フィールドにする。

### Scope

- `HistoryItem` に任意フィールドとして `proRecipeReview?: HistoryProRecipeReview | null` を追加する設計を確定。
- `HistoryLabel` は既存の `favorite / candidate / rejected / asset` を使い、ラベル追加はMVPでは避ける。
- 既存履歴JSONに新フィールドが無くても正常に読める正規化方針を決める。

### Candidate Type

```ts
export interface HistoryProRecipeReview {
  rating?: number | null
  strengths: string[]
  issues: string[]
  nextActions: string[]
  scores: {
    thumbnail?: number | null
    composition?: number | null
    lighting?: number | null
    color?: number | null
    anatomy?: number | null
    styleConsistency?: number | null
    reusePotential?: number | null
  }
  parentHistoryId?: string | null
  updatedAt: number
}
```

### Acceptance Criteria

- 既存 `userdata/history/index.json` に新フィールドが無くても読み込みが壊れない。
- 新フィールドが不正でも、履歴一覧全体が落ちず、そのレビューだけ捨てられる。
- `tagReview` と `proRecipeReview` の責務がコードコメントか型名から分かる。

### Verification

- `npm.cmd run typecheck`
- 履歴fixtureを使った読み込み確認
- `git diff --check`

## Phase 1: Pro Recipe Review MVP

### Goal

生成履歴から「この画像がなぜ良い/悪いか」を保存できるようにし、成功レシピを次のPrompt作成へ戻せる状態にする。

### User Value

偶然良い画像が出た時に、モデル、Prompt、LoRA、seed、ControlNet、Upscaleだけでなく、制作判断も残せる。SNS向けに強い候補と、素材として使う候補を分けられる。

### Main Files

- `src/shared/types.ts`
- `electron/storage.ts`
- `src/shared/ipc-channels.ts`
- `electron/preload.ts`
- `electron/ipc-handlers.ts`
- `src/components/HistoryGallery.tsx`
- `src/components/PromptHelperPanel.tsx`
- `src/lib/i18n.ts`

### UI

- History itemに小さなレビュー操作を追加する。
- ratingは数値入力ではなく、制作レビュー用のコンパクトな評価ボタンとして出す。
- 評価軸は最初から全部を常時表示しない。詳細パネルまたは折りたたみで出す。
- `favorite / candidate / rejected / asset` は既存ラベル操作として残す。
- Pro Recipeから `Prompt Helper` へ「強み」「改善メモ」「採用タグ」を渡せるようにする。

### Acceptance Criteria

- 履歴画像に rating、strengths、issues、nextActions、score群を保存できる。
- 保存後にアプリを再起動してもレビューが復元される。
- `favorite / candidate / rejected / asset` ラベルの既存挙動が壊れない。
- `Prompt Helper` がPro Recipeの採用タグまたは改善メモを参照できる。
- 既存の `tagReview` 連携が消えない。

### Verification

- `npm.cmd run typecheck`
- `npm.cmd run qa:dom:history-review -- --port=9338`
- `npm.cmd run qa:dom:history-review-persistence -- --port=9338`
- `npm.cmd run qa:dom:prompt-helper-review -- --port=9338`

## Phase 2: Model Profile Pro化

### Goal

checkpoint選択時に、そのモデルに合うPrompt形式、推奨設定、LoRA互換、negative方針を提示できるようにする。

### Main Files

- `src/shared/types.ts`
- `src/lib/checkpoint-prompt-profile.ts`
- `src/components/GenerationPreflightPanel.tsx`
- `src/components/PromptPanel.tsx`
- `src/components/ToolsWorkspace.tsx`
- `src/components/ModelLibraryWorkspace.tsx`
- `electron/storage.ts`

### Model Profile Additions

- `baseModel?: string | null`
- `promptStyle?: 'tag' | 'natural' | 'structured' | 'hybrid'`
- `negativeStrategy?: 'classic' | 'minimal' | 'positive-replacement'`
- `recommendedAspectRatios?: Array<{ label: string; width: number; height: number }>`
- `recommendedLoraCount?: { min: number; max: number }`
- `compatibilityNotes?: string[]`
- `recipeNotes?: string[]`

### Acceptance Criteria

- SDXL/Illustrious/Pony/Anima系はタグ型候補として表示される。
- Flux/SD3.5/Qwen系は自然文または構造化Prompt候補として表示される。
- Preflightがモデルプロファイルの推奨設定と現在設定の差分を出せる。
- Model Libraryでプロファイル編集と保存ができる。
- Civitaiから取得した `baseModel` や `trainedWords` がプロファイル作成の補助に使える。

### Implementation Progress

- `CheckpointPromptProfile` に `baseModel`、Prompt形式、Negative方針、推奨比率、推奨LoRA数、互換メモ、制作メモを追加。
- `defaultCheckpointPromptProfile()` が checkpoint family と Civitai `baseModel` から、タグ型/自然文型、Negative方針、推奨比率、LoRA使用数、互換メモを初期化。
- `storage.ts` の正規化で新フィールドを後方互換つきで保存・復元。
- Model Libraryのcheckpointカードに、プロ仕様のコンパクト編集面を追加。保存QA後は元プロファイルへ復元するDOM QAで確認。
- Preflightがモデルプロファイルの推奨比率と推奨LoRA数を現在設定と比較し、推奨比率はQuick Fixで適用可能。
- Sidebar Workspaceに再読込ボタンを追加し、外部保存されたQA workspaceもGUIから再取得できるようにした。
- GUI進捗スクリーンショット: `docs/screenshots/model-profile-pro-gui-2026-05-25.png`

### Verification

- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.
- `npm.cmd run qa:dom:model-profile-pro -- --port=9338` passed.
- `npm.cmd run qa:dom:preflight -- --port=9338` passed.
- `npm.cmd run qa:dom:workspace-preflight -- --port=9338` passed.
- モデルプロファイルJSONの後方互換確認: `storage.ts` 正規化で欠損・不正値を既定値または空配列へ丸める。

## Phase 3: Pro Prompt Composer Slots

### Goal

Prompt Composerを、単なる日本語から英語タグへの整形ではなく、プロ制作向けの視覚仕様書ビルダーにする。

### Slots

- 主題
- 構図
- 表情 / ポーズ
- 光
- 色
- 服 / 小物
- 背景
- 質感 / 画風
- 仕上げ
- 避けたい破綻

### Main Files

- `src/lib/prompt-composer.ts`
- `src/components/PromptComposerPanel.tsx`
- `src/components/PromptPanel.tsx`
- `src/components/PromptTagsWorkspace.tsx`
- `src/lib/checkpoint-prompt-profile.ts`
- `src/lib/i18n.ts`

### Behavior

- タグ型モデルでは、各slotを短いタグ列へまとめる。
- 自然文型モデルでは、slotを構造化された英文promptへまとめる。
- `negativeStrategy=positive-replacement` の場合、否定語の一部を肯定指示へ変換する。
- LoRA構文、重み付きタグ、Dynamic Prompt、`BREAK` は壊さない。

### Acceptance Criteria

- `タグ型` と `自然文型` の切り替えがモデルプロファイルに連動する。
- slot入力からpositive promptを生成できる。
- negative prompt用には破綻回避slotだけを使える。
- 既存のComposer cleanup-only導線が残る。
- Tagsタブのquick addも既存通り使える。

### Implementation Progress

- `prompt-composer.ts` に Pro Prompt Composer Slots の変換ロジックを追加。
- スロット: 主題、構図、表情/ポーズ、光、色、服/小物、背景、質感/画風、仕上げ、避けたい破綻。
- `PromptComposerPanel` に折りたたみ式の仕様書GUIを追加。既存の整える/整理/モデル向け導線は維持。
- 選択checkpointの `CheckpointPromptProfile.promptStyle` と `negativeStrategy` をComposer GUIへ反映。
- タグ型は短いタグ列、自然文/構造化型はスロット単位の構造化promptへ変換。
- `positive-replacement` では「手、顔、文字、ぼけ、解剖」などの破綻回避メモから肯定指示をpositive側へ補助できる。
- Negative側は「避けたい破綻」スロットだけから作成し、PromptPanelでは現在のNegative Promptへ追加できる。
- LoRA構文、重み付きタグ、`BREAK`、Dynamic Prompt系の保護構文は既存のPrompt Composer parserを通して保持。
- GUI進捗スクリーンショット: `docs/screenshots/prompt-composer-slots-gui-2026-05-25.png`

### Verification

- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.
- `npm.cmd run qa:dom:prompt-composer -- --port=9338` passed.
- `npm.cmd run qa:dom:prompt-format -- --port=9338` passed.
- Prompt Library YAMLを触る場合は `js-yaml` parse確認

## Phase 4: Candidate Board

### Goal

複数生成結果を並べて比較し、勝ち画像だけを `img2img / inpaint / Upscale / Pro Recipe` へ送る。

### Main Files

- `src/components/PreviewPanel.tsx`
- `src/components/HistoryGallery.tsx`
- `src/components/UpscaleWorkspace.tsx`
- `src/lib/store.ts`
- `electron/storage.ts`

### UI

- batch生成結果を候補グリッドとして表示する。
- ラベル、rating、簡易メモをその場で付けられる。
- 選択画像をbase image、upscale input、Prompt Helperへ送れる。
- 画像base64を過剰にstoreへ残さず、履歴ID参照を優先する。

### Acceptance Criteria

- batchSize / imageIndex / imageCount が候補比較で見える。
- 候補に `candidate`、採用候補に `favorite`、没に `rejected` を付けられる。
- 選択画像をimg2imgとUpscaleへ送れる。
- 候補比較の状態が履歴再読み込み後も破綻しない。

### Implementation Progress

- `HistoryGallery` に最新batchを抽出する Candidate Board を追加。
- `batchSize`、`imageIndex`、`imageCount`、seed、サイズを候補カード上に表示。
- 候補カードから `favorite`、`candidate`、`rejected` ラベルを保存できる。
- 候補カードから履歴画像を `img2img` 入力、Upscale入力、Pro Recipeレビューへ送れる。
- 既存の履歴カードにも `img2img` 送信ボタンを追加。
- DOM QA `qa:dom:candidate-board` を追加し、一時履歴を作成、reload後のCandidate Board表示、ラベル保存、img2img/Upscale送信、Pro Recipe起動を検証。
- GUI進捗スクリーンショット: `docs/screenshots/candidate-board-gui-2026-05-25.png`

### Verification

- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.
- `npm.cmd run qa:dom:candidate-board -- --port=9338` passed.
- `npm.cmd run qa:dom:history-review -- --port=9338`
- `npm.cmd run qa:dom:history-review-persistence -- --port=9338`
- 必要ならElectron実機で少数batch生成smoke

## Phase 5: Civitai Recipe / Trend Importer

### Goal

Civitai公開APIから、流行モデル名だけでなく、baseModel、trainedWords、recommendedPrompts、画像meta、よく併用されるLoRAを取り込み、Model LibraryとPrompt Composerの判断材料にする。

### Main Files

- `electron/civitai-api.ts`
- `electron/storage.ts`
- `electron/ipc-handlers.ts`
- `src/shared/types.ts`
- `src/components/ToolsWorkspace.tsx`
- `src/components/ModelLibraryWorkspace.tsx`
- `src/components/RecommendationCard.tsx`

### Scope

- 取得はユーザー操作時だけ行う。起動時には走らせない。
- `nsfw=false` を既定にし、POI/ライセンス/NSFW注意を表示する。
- 既存の `refreshModelLibraryCivitaiBatch` と `communityStats` を拡張する。
- API失敗時も生成UIを止めない。

### Acceptance Criteria

- Model Libraryから選択モデルのCivitai community statsを更新できる。
- LoRAの `trainedWords` と明示的な `recommendedPrompts` をPrompt Composer候補へ渡せる。
- 画像metaから sampler、steps、CFG、解像度の傾向を表示できる。
- API rate limit / not found / invalid response をUIで区別できる。

### Implementation Progress

- `ModelSourceMetadata` に `trainedWords` と `recommendedPrompts` を追加し、Model Library保存時に後方互換つきで正規化。
- LoRA / LyCORIS / LoCon系のCivitai更新では `fetchLoraByHash()` を使い、trigger words、recommended prompts、description、tagsをsourceMetaへ保存。
- checkpoint系のCivitai更新でも `trainedWords` をsourceMetaへ保存。
- Civitai community miningは既定で `nsfw=false` に変更し、ユーザー操作時だけ取得する方針へ寄せた。
- Model Library entryにCivitai Recipeヒントchipを追加し、trigger/recommended promptを現在Promptへ追加できる。
- Model Library entryからCivitai Recipe傾向を読み込み、Sampler、Steps、CFG、Size、よく使われるLoRA、共通positive phraseを表示。
- Prompt Composerにactive LoRAのCivitai `trainedWords` / `recommendedPrompts` をRecipeヒントとして表示し、Promptへ追加できる。
- DOM QA `qa:dom:model-library-recipe` を追加し、fixtureのModel Library/Civitai cacheでRecipeヒント、Prompt反映、Recipe傾向パネルを検証。
- GUI進捗スクリーンショット: `docs/screenshots/model-library-recipe-gui-2026-05-25.png`

### Verification

- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.
- `npm.cmd run qa:dom:model-library-recipe -- --port=9338` passed.
- API fixtureまたはmockで `updated / skipped / not-found / failed` を確認
- `npm.cmd run qa:dom:workspace-preflight -- --port=9338`

## Phase 6: Reference Board and Optional Backends

### Goal

参照画像と最新モデル実験を、Forge標準導線から分離して扱う。

### Reference Board Scope

- 構図、ポーズ、顔、服、配色、スタイルの参照を別slotで保持する。
- ControlNet / img2img / future IP-Adapter候補へ送る。
- 参照画像の由来とメモを残す。

### Optional Backend Scope

- FLUX.2 / Qwen / Hunyuan / Z-Image系は、Tools内の調査・実験導線として扱う。
- Forgeの通常生成payloadへ混ぜない。
- 8GB VRAMで無理なモデルは標準推奨にしない。

### Acceptance Criteria

- 参照画像を用途別slotへ登録できる。
- どのslotがどの生成制御に使われたか履歴へ残る。
- 外部バックエンド実験は明示的に有効化しない限り起動しない。

### Verification

- `npm.cmd run typecheck`
- 対象UIのDOM QA
- 外部backendは実機検証レポートを別途残す

## 実装順の推奨

1. Phase 0で型と保存方針だけを確定する。
2. Phase 1でPro Recipe Reviewを履歴に追加する。
3. Phase 2でモデルプロファイルをPro化し、Preflightへつなぐ。
4. Phase 3でPrompt Composerをslot化する。
5. Phase 4で候補比較と派生導線を整える。
6. Phase 5でCivitai観測をModel Libraryへ追加する。
7. Phase 6は、上記の制作ループが安定してから着手する。

## 最初の実装タスク

### Task 1: Pro Recipe Review Schema

- `HistoryProRecipeReview` 型を追加。
- `HistoryItem.proRecipeReview` を任意フィールドとして追加。
- `storage.setHistoryProRecipeReview` 相当の保存処理を追加。
- IPC / preload / renderer APIを追加。
- 既存履歴読み込みで不正reviewを破棄する正規化を追加。

### Task 2: History UI MVP

- History itemにPro Recipe review編集UIを追加。
- rating、strengths、issues、nextActionsだけをMVP表示する。
- 詳細score群は折りたたみまたは後続に回す。
- 保存、再読み込み、削除を確認する。

### Task 3: Prompt Helper連携

- Pro Recipeで採用されたstrengths/nextActionsをPrompt Helperの候補に出す。
- `tagReview` 由来のタグ候補とは見出しを分ける。

## 完了条件

このロードマップの完了は、Phase 1からPhase 5までが実装され、以下を満たした時点とする。

- 成功画像をPro Recipeとして保存、比較、派生できる。
- モデルごとのPrompt作法と推奨設定をUIが提示できる。
- Prompt Composerがタグ型/自然文型をモデルに応じて切り替えられる。
- Civitaiの流通レシピを安全に観測し、Model LibraryとPrompt作成へ反映できる。
- 既存のForge生成、History、Prompt Library、LoRA、Upscale、DOM QAが壊れていない。
