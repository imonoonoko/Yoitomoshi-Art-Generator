# QA: Creator Workflow P2 2026-05-14

対象: 制作ナレッジ、Reliability Badge、Compatibility Guard、Prompt Library / Quick Preset整理

## 実行コマンド

```powershell
npm.cmd run typecheck
node -e "const fs=require('fs'); const yaml=require('js-yaml'); const p='resources/prompt-library.yoitomoshi.ja.yaml'; const data=yaml.load(fs.readFileSync(p,'utf8')); const tags=data.flatMap(c=>c.groups.flatMap(g=>Object.keys(g.tags||{}))); console.log(JSON.stringify({categories:data.length,last:data.at(-1).name,totalTags:tags.length,hasRecipe:tags.includes('prompt comparison')}));"
git diff --check
npm.cmd run build
```

## 結果

| 確認 | 結果 |
|---|---|
| TypeScript typecheck | PASS |
| Prompt Library YAML parse | PASS: categories=8 / last=制作レシピ / totalTags=364 / hasRecipe=true |
| diff whitespace check | PASS |
| Electron build | PASS |

## Electron DOM確認

起動:

```powershell
node_modules\electron\dist\electron.exe --remote-debugging-port=9335 .
```

確認後、起動プロセスは終了済み。

| 確認 | 結果 |
|---|---|
| `制作ナレッジ` パネル表示 | PASS |
| `調査ベースの制作レシピ` 表示 | PASS |
| Reliability Badge (`一次+講座一致` / `複数講座一致` / `Creator実例`) 表示 | PASS |
| Quick Fix表示 | PASS |
| 5件以上のRecipe保存ボタン | PASS |
| Quick Preset (`構図探索` / `全身構図` / `カメラ角度`) 表示 | PASS |
| 長いPrompt入力時のPreflight警告 (`Prompt が長めです`) | PASS |

## 追補

- このQA時点では実生成とModel Prompt Contract実モデル表示は未実施だった。
- その後、[`QA_UNVERIFIED_DEEP_VALIDATION_2026-05-14.md`](QA_UNVERIFIED_DEEP_VALIDATION_2026-05-14.md) で
  Model Prompt Contract表示/適用、Quick Fix、Recipe保存、SDXL小解像度Preflight、最小txt2img実生成まで追加確認済み。
