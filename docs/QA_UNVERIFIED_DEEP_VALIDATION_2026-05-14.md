# QA: Unverified Deep Validation 2026-05-14

対象: P2実装後に残った未検証項目、Model Library整合性、Electron実機生成、docs整理。

詳細HTML: [`UNVERIFIED_DEEP_VALIDATION_REPORT_2026-05-14.html`](UNVERIFIED_DEEP_VALIDATION_REPORT_2026-05-14.html)

DOM自動QAの再実行手順: [`QA_DOM_GUIDE_2026-05-14.md`](QA_DOM_GUIDE_2026-05-14.md)

## 実行コマンド

```powershell
npm.cmd run typecheck
npm.cmd run build
git diff --check
```

追加でNodeスクリプトから以下を確認した。

- Prompt Library YAML parse
- README / ROADMAP のローカルdocsリンク
- Quick Preset内蔵ID
- Model Library index実ファイル存在
- DownloadJob / model folder partial
- Electron remote debugging経由のDOM / IPC / UI操作

## 結果

| 確認 | 結果 |
|---|---|
| TypeScript typecheck | PASS |
| Production build | PASS |
| diff whitespace check | PASS |
| Prompt Library YAML | PASS: `制作レシピ` 3 groups / 30 tags |
| README / ROADMAP links | PASS |
| Quick Preset | PASS: `構図探索` / `全身構図` / `カメラ角度` |
| Model Library files | PASS: 16 entries / missing files 0 / SHA missing 0 |
| Model Library partial handling | PASS: orphan partial 1件を検出し、削除後 `partialDownloads=0` / `issues=0` |
| Electron DOM / IPC | PASS |
| LoRA trigger / base mismatch | PASS: 一時Workspace復元でPreflight DOM確認 |
| ControlNet base mismatch | PASS: SD1.5系ControlNetモデル名 + SDXL checkpointでPreflight DOM確認 |
| UI txt2img generation | PASS: History 99 -> 100 |
| Process cleanup | PASS: Electron / Forge Python残留なし |

## 実機操作

Electron起動:

```powershell
node_modules\electron\dist\electron.exe --remote-debugging-port=<qa-port> .
```

確認内容:

- `制作ナレッジ` を開き、`Model Prompt Contract` / `28 steps` / `CFG 5` を確認。
- `モデル推奨を反映` 後、Steps=28 / CFG=5 がUI入力へ反映。
- 空PromptでQuick Fixを実行し、`portrait, looking at viewer` が追加。
- Recipe保存で `制作レシピ: 構図探索` のPreset作成を確認し、検証後に削除。
- 512x512設定でPreflightに `SDXL系には解像度が小さめです (512×512)` を確認。
- LoRA Panelで `Hands v2.1` のCivitai metadataを読み込み、一時Workspace復元で以下を同時確認。
  現在は `npm.cmd run qa:dom:preflight -- --port=<qa-port>` で再実行可能。
  - `有効LoRAのうち 1 件が現在モデルのbase modelと合わない可能性があります`
  - `有効LoRAのうち 1 件で trigger word がPromptに見つかりません`
  - `ControlNet Unit 1 は SD1.5 系に見えますが、選択モデルは SDXL 系です`
- `simple landscape, blue sky, small house` / Steps=1 / CFG=5 / 512x512でGenerateを実行。
- 生成結果: `userdata/history/78b2125c-d03a-41a9-8537-f39c057e30af.png`

## 修正

- `electron/ipc-handlers.ts`
  - completed jobに残ったpartialを検出。
  - DownloadJobに紐づかないモデルフォルダ内の孤立partialを検出。
  - 今回検出した孤立partialを、プロジェクト配下確認後に削除:
    `runtime/forge/webui/models/Stable-diffusion/waiIllustriousSDXL_v170.safetensors.partial`
  - 削除後の `window.api.tools.checkLibraryIntegrity()` は `issues=0`。

## 残る条件付き項目

- WindowsローカルのP2仕上げQAは完了。
- 別OS、コード署名、SmartScreen、公開installerの検証は、対象環境と証明書が必要な公開配布フェーズで扱う。
- Toolsの孤立partial削除ボタンは任意改善。今回の実ファイルは削除済みで、整合性はclean。
