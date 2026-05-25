# AI Project Map

最終更新: 2026-05-25

このファイルは Codex / Claude / future agent が最初に読むための案内板です。詳細な実装判断は現在のコード、`docs/ROADMAP.md`、該当する `docs/maps/` を優先してください。

## 目的

Yoitomoshi Art Generator は、Stable Diffusion WebUI Forge を裏で起動し、Electron / React / TypeScript の独自UIから画像生成、img2img、動画、Upscale、モデル管理、Prompt管理、履歴再利用、Civitai / Hugging Face連携をまとめる個人制作向けフロントエンドです。

## 最初に読む順番

1. `docs/AI_PROJECT_MAP.md` - AI向けの入口と変更時の注意。
2. `docs/PROJECT_MAP.md` - 人間向けの1枚全体地図。
3. `docs/maps/00-overview.md` - レイヤと責務。
4. 触る機能に対応する `docs/maps/*.md`。
5. `docs/ROADMAP.md` と `docs/QA_DOM_GUIDE_2026-05-14.md` - 現在の優先順位と検証手順。

## 主要エリア

| 領域 | 主なファイル | 役割 |
|---|---|---|
| Renderer shell | `src/App.tsx`, `src/main.tsx`, `src/components/MainTabs.tsx` | 起動時データロード、タブレイアウト、Generate実行、モーダル管理 |
| UI components | `src/components/`, `src/components/extensions/` | txt2img / img2img / Tags / Video / Upscale / Models / Tools の画面 |
| State | `src/lib/store.ts` | Zustand単一store。生成状態、Forge catalog、Prompt library、履歴、LoRA、Video、Upscale、拡張設定を保持 |
| Generation request | `src/lib/generation-utils.ts`, `src/lib/extension-payload.ts` | Prompt / LoRA / Dynamic Prompt / alwayson_scripts をForge API payloadへ変換 |
| Prompt intelligence | `src/lib/prompt-*`, `src/components/PromptComposerPanel.tsx`, `src/components/PromptTagsWorkspace.tsx` | Prompt整形、Composer、タグ辞書、翻訳runtime、Dynamic Prompt |
| IPC boundary | `src/lib/ipc.ts`, `src/shared/ipc-channels.ts`, `electron/preload.ts`, `electron/ipc-handlers.ts` | renderer と main の型付き境界。入力検証とOS/外部API操作を集約 |
| Electron services | `electron/forge-api.ts`, `electron/forge-manager.ts`, `electron/storage.ts`, `electron/civitai-api.ts`, `electron/huggingface-api.ts` | Forge lifecycle / REST API / local JSON storage / model search / download / tool execution |
| Shared contracts | `src/shared/types.ts`, `src/shared/tagger-filter.ts` | IPC payload、履歴、モデル、Prompt library、Workspace、Toolsの型 |
| Local runtime/data | `runtime/`, `userdata/`, `output/` | Forge本体、モデル、ユーザーデータ、生成物。原則Git管理外 |
| QA scripts | `scripts/dom-qa.cjs`, `scripts/tagger-accuracy-compare.cjs` | Electron DOM QA、Tagger比較、安定セレクタ検証 |

## 変更時の注意

| 変更対象 | 影響しやすい場所 | 先に読む地図 | 最低限の検証 |
|---|---|---|---|
| Generate payload | `src/lib/generation-utils.ts`, `src/lib/extension-payload.ts`, `electron/ipc-handlers.ts`, `electron/forge-api.ts`, History保存 | `docs/maps/01-image-generation-flow.md`, `docs/maps/05-electron-ipc-flow.md` | `npm.cmd run typecheck`。UI変更なら対象DOM QA |
| Prompt形式 / Prompt Composer | `src/lib/prompt-*`, `PromptPanel`, `PromptComposerPanel`, `PromptTagsWorkspace`, `storage.ts` | `docs/maps/02-prompt-management-flow.md` | `npm.cmd run qa:dom:prompt-composer -- --port=9338` または関連DOM QA |
| LoRA / Civitai / Models | `lora-suggest.ts`, `ModelLibraryWorkspace`, `ToolsWorkspace`, `civitai-api.ts`, `storage.ts` | `docs/maps/03-lora-civitai-model-flow.md` | typecheck、必要なら model library / Civitai DOM QA |
| History / Metadata | `HistoryGallery`, `MetadataInfoPanel`, `png-metadata.ts`, `storage.ts` | `docs/maps/04-history-metadata-flow.md` | history-review系DOM QA |
| IPC追加 / main処理 | `src/shared/ipc-channels.ts`, `electron/preload.ts`, `electron/ipc-handlers.ts`, `src/shared/types.ts` | `docs/maps/05-electron-ipc-flow.md` | `npm.cmd run typecheck`, `npm.cmd run qa:dom:api -- --port=9338` |
| Settings / Workspace | `SettingsModal`, `workspace-snapshot.ts`, `ToolsWorkspace`, `storage.ts`, `userdata/` schema | `docs/maps/06-settings-storage-workspace-flow.md` | workspace-preflight / reference-board / restore系DOM QA |
| Video / Upscale / Tools | `VideoWorkspace`, `VideoGenerationPanel`, `UpscaleWorkspace`, `ToolsWorkspace`, main IPC tools | `docs/maps/07-video-upscale-tools-flow.md` | `qa:dom:upscale-finish` など変更面に対応するDOM QA。Forge実機系は直列実行 |

## 維持する設計

- トップレベルタブは `txt2img / img2img / Tags / Video / Upscale / Models / Tools`。小さい補助機能は既存タブ内の折りたたみパネルやモーダルに入れる。
- Forge / Gradio UIは埋め込まず、React UIから `alwayson_scripts` または専用IPC経由でForge APIを操作する。
- `src/lib/extension-payload.ts` は中核契約。ADetailer dicts-only、ControlNet unit dict、Upscale専用 `forUpscaleDiffusion` / `forUpscaleUltimate` 分岐を崩さない。
- Rendererは `window.api` 経由でのみmainへ触る。Node機能、外部URL、ファイルパス、巨大base64、script argsの検証はmain側で行う。
- `runtime/`, `userdata/`, `output/`, `out/`, `dist/`, `node_modules/` は巨大・環境依存・生成物。明示された作業以外では編集対象にしない。
- DOM QAは表示文言ではなく `data-testid` と状態属性を使う。i18n変更で壊れないセレクタを保つ。

## 地図更新ルール

- 実装の流れ、IPC契約、保存場所、トップレベルタブ、Generate payload、Prompt/History/Model Libraryの責務が変わったら、該当する `docs/maps/*.md` も更新する。
- import依存の実態を見るときは `docs/maps/generated/import-graph-summary.md` を更新する。大きな依存追加が必要なSVG生成は、必要になった時だけ `madge` または `dependency-cruiser` を導入する。
