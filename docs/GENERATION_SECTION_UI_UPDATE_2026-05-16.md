# 生成画面セクションUI更新記録 2026-05-16

## 背景

生成画面の混雑対策として一度 `作る / 整える / 高度` の作業モード切替を導入したが、実利用では切替そのものが負担になった。

特に次の問題があった。

- Prompt欄とタグ並び替え、Prompt Helper、Dynamic Prompt Lab の位置関係が離れ、作業の連続性が落ちた。
- ControlNetやADetailerなど、生成payloadに効く設定が別モードに隠れてしまう。
- `作る / 整える / 高度` が手順のように見える一方、実際には同時に効く設定カテゴリであり、認知と挙動がずれた。

## 採用した更新

排他的なモードタブを廃止し、左カラム内に次のセクションをまとめて表示する。

| セクション | 内容 |
|---|---|
| 常時表示 | Recommendation要約、Prompt / Negative editor、Generate button、Preflight summary |
| 基本設定 | Input image、キャラクター合成、LoRA suggestion、主要Parameters |
| Prompt補助 | PromptTagChips、Prompt Helper、Dynamic Prompt Lab、Research Workflow |
| 拡張設定 | Regional Prompter、FABRIC、ControlNet、ADetailer、Dynamic Thresholding、FreeU |

タグ並び替え機能は Prompt欄の近くに寄せ、Prompt編集と連続して使える配置にした。

## 仕様上の注意

- 生成payload、History metadata、Dynamic Prompt解決ロジックは変更しない。
- `GenerationWorkspaceMode` と `generationMode` は廃止方向。DOM QA名は互換のため `generation-modes` を内部的に残しつつ、npm script は `qa:dom:generation-sections` を使う。
- Preflight の「開く」は、隠れたモード切替ではなく対象セクションへのスクロールに寄せる。
- 高度機能は折りたたみ詳細を維持するが、有効中や警告中の状態は見える位置に出す。

## 検証

実施済み:

```powershell
npm.cmd run typecheck
npm.cmd run build
git diff --check
npm.cmd run qa:dom:generation-sections -- --port=9338
```

DOM QAでは次を確認した。

- 旧 `作る / 整える / 高度` モード切替が存在しない。
- `基本設定`、`Prompt補助`、`拡張設定` が同時に見える。
- Prompt Helper、Dynamic Prompt Lab、Research Workflow が Prompt補助側に存在する。
- ControlNet、ADetailer、FreeU などの拡張設定が拡張設定側に存在する。
- Dynamic Prompt 有効状態のチップが表示される。
- タグ並び替えUIがPrompt欄近くで使える。
