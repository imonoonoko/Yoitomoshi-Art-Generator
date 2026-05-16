# 生成画面GUI整理 実装記録 2026-05-16

## 実装したこと

- 生成画面の左カラムを、常時表示エリアと `作る / 整える / 高度` の作業モードへ分けた。
- 常時表示エリアには Recommendation、Prompt / Negative editor、有効な補助の要約、Preflight、Generate button を残した。
- `作る` には img2img入力、キャラクター合成、LoRA suggestion、主要Parametersを配置した。
- `整える` には PromptTagChips、Prompt Helper、Dynamic Prompt Lab、Research Workflowを配置した。
- `高度` には Regional Prompter、FABRIC、ControlNet、ADetailer、Dynamic Thresholding、FreeUを配置した。
- 有効中の LoRA / Dynamic Prompt / ControlNet / ADetailer / FABRIC / Preflight を要約チップ化し、クリックで対象モードと対象パネルへ誘導するようにした。
- Preflight の「開く」は、隠れたモードにある対象へ移動できるよう `generationMode` 切替を追加した。

## 再発した検証エラーと対応

- エラー: `qa:dom:prompt-format` が `Timed out waiting for positive prompt formatted` で失敗し、その後CDP評価もタイムアウトした。
- 発生条件: `qa:dom:generation-modes` と他DOM QAを並列実行し、同じElectron CDP pageに対してreloadと操作が競合した後。
- 原因: 実装ロジックではなく、同一CDPセッションを複数DOM QAが同時に操作したことによる検証セッション汚染。
- 採用した対応: Electronを再起動し、DOM QAを直列実行する。selector smokeは自分で `作る` モードへ戻してから確認するようにした。
- 採用しなかった案:
  - Prompt formatter本体を変更する案: 再起動後に同じテストが通ったため不要。
  - PromptEditorをuncontrolled化する案: React公式docs上、現行のcontrolled textarea + synchronous onChangeが正しいため不要。
  - wait時間だけ延ばす案: reload競合が原因なので根本対応にならない。
  - DOM QAを全て並列化する案: 同じCDP pageを操作するテストでは不安定化するため見送り。

## 検証

- `npm.cmd run typecheck`: 成功。
- `npm.cmd run build`: 成功。
- `node --check scripts/dom-qa.cjs`: 成功。
- `npm.cmd run qa:dom:prompt-format -- --port=9338`: 成功。
- `npm.cmd run qa:dom -- selectors --port=9338`: 成功。
- `npm.cmd run qa:dom:generation-modes -- --port=9338`: 成功。
- `npm.cmd run qa:dom:dynamic-prompt -- --port=9338`: 成功。

## 注意

- Electron CDPを使うDOM QAは同じpageを操作するため、`generation-modes` のようにreloadを伴うテストと他のDOM QAを並列実行しない。
