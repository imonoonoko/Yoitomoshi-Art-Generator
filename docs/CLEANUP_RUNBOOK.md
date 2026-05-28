# Cleanup Runbook

最終更新: 2026-05-29

このリポジトリは portable app workspace として、Git 管理対象の source/docs と、ローカル実行状態の `runtime/` / `userdata/` を同じ親フォルダに置く。整理は削除から始めず、必ず dry-run と分類から始める。

## 原則

- `runtime/` と `userdata/` は削除しない。
- `git clean -fdx` は使わない。
- 未追跡ファイルは trash ではなく、まず `commit / keep local / disposable / confirm` に分類する。
- generated DB や HTML report は、再生成元と公開可否を確認してから commit する。
- local prompt history 由来の辞書 snapshot は Git に入れない。

## まず確認する

```powershell
git status --short --branch
git clean -nd
git clean -ndX
git diff --stat
```

大きいフォルダを確認する:

```powershell
Get-ChildItem -Force -Directory | ForEach-Object {
  $size = (Get-ChildItem -LiteralPath $_.FullName -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
  [pscustomobject]@{ Name = $_.Name; GB = [Math]::Round(($size / 1GB), 2); MB = [Math]::Round(($size / 1MB), 1) }
} | Sort-Object GB -Descending | Format-Table -AutoSize
```

## 削除してよい候補

削除は必要な時だけ、path allowlist で行う。

| Path | 扱い |
|---|---|
| `out/` | build output。再生成可能 |
| `dist/` | packaging output。再生成可能 |
| `.vite/` | Vite cache。再生成可能 |
| `output/` | QA/一時出力。必要な証跡がないか確認してから削除 |
| `node_modules/` | reinstall 可能。ただし直後に `npm install` が必要 |

## 削除しない

| Path | 理由 |
|---|---|
| `runtime/` | Forge 本体、models、extensions、Python/Git runtime |
| `userdata/` | settings、secrets、history、downloads、prompt dictionary staging |
| `.agent/requirements/` | 実装意図と引き継ぎ。公開可否を確認してから commit 判断 |
| `resources/prompt-dictionary/promoted-candidates.local.json` | 旧local snapshot。Gitには入れず、必要なら `userdata/prompt-dictionary/` へ移す |

## 公開前スキャン

```powershell
rg -n -i --hidden --glob '!node_modules/**' --glob '!runtime/**' --glob '!userdata/**' --glob '!out/**' --glob '!output/**' --glob '!.git/**' 'api[_ -]?key|secret|token|password|authorization|bearer|gho_|sk-|hf_|C:\\Users|C:\\宵灯|secrets\.local|settings\.json'
```

一致が出ても、変数名や説明文なら問題ない。実値、private path、raw prompt、生成画像、browser trace が出たら commit 前に除外する。

## GitHub 更新前

```powershell
git diff --check
npm.cmd run typecheck
git status --short
```

必要なら:

```powershell
npm.cmd run dictionary:enrich:meanings:test
npm.cmd run qa:dom:prompt-dictionary-workspace
```
