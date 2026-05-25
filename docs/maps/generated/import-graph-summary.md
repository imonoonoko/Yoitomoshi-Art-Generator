# Generated Import Graph Summary

最終更新: 2026-05-25

このファイルは `src/`, `electron/`, `scripts/` のimportを軽量にscanした結果です。現時点では `madge` / `dependency-cruiser` / `typedoc` はdevDependencyに入っていないため、依存追加なしのNodeスクリプトで実態確認だけ行っています。

## Scan result

| 項目 | 結果 |
|---|---:|
| 対象ファイル | 93 |
| import edge | 124 |
| 循環依存 | 0件検出 |

## Area edges

| Edge | Count |
|---|---:|
| renderer components -> renderer components | 42 |
| renderer lib -> renderer lib | 21 |
| electron -> electron | 18 |
| renderer entry -> renderer components | 14 |
| renderer components -> renderer extension panels | 9 |
| renderer entry -> renderer lib | 7 |
| renderer extension panels -> renderer components | 7 |
| renderer extension panels -> renderer extension panels | 4 |
| renderer lib -> electron | 1 |
| renderer entry -> renderer entry | 1 |

```mermaid
flowchart LR
    Entry["renderer entry<br/>App / main"] -->|14| Components["renderer components"]
    Entry -->|7| Lib["renderer lib"]
    Entry -->|1| Entry
    Components -->|42| Components
    Components -->|9| Ext["extension panels"]
    Ext -->|7| Components
    Ext -->|4| Ext
    Lib -->|21| Lib
    Lib -. type import .->|1| Electron["electron preload type"]
    Electron -->|18| Electron
```

## Most imported files

| File | Importers |
|---|---:|
| `src/lib/store.ts` | 11 |
| `src/components/CollapsiblePanel.tsx` | 9 |
| `src/components/extensions/controls.tsx` | 6 |
| `src/lib/prompt-utils.ts` | 4 |
| `src/components/NumberField.tsx` | 3 |
| `src/components/PromptEditor.tsx` | 3 |
| `src/components/PromptTagChips.tsx` | 3 |
| `src/components/QuickPresetBar.tsx` | 3 |
| `src/components/ToolsWorkspace.tsx` | 3 |
| `electron/safetensors-inspect.ts` | 3 |

## Highest fanout files

| File | Imports |
|---|---:|
| `src/App.tsx` | 21 |
| `src/components/PromptPanel.tsx` | 20 |
| `electron/ipc-handlers.ts` | 9 |
| `src/components/VideoWorkspace.tsx` | 6 |
| `src/lib/generation-utils.ts` | 5 |
| `electron/main.ts` | 5 |
| `src/components/PromptTagsWorkspace.tsx` | 4 |
| `src/components/SidePanel.tsx` | 4 |

## Re-run

```powershell
@'
// Lightweight scan: paste the current Node import-scan script here when this file needs refreshing.
'@ | node -
```

Full graph options are intentionally not committed yet. Add one only when SVG/HTML graphs become useful enough to justify package churn:

```powershell
npm.cmd install --save-dev madge
npm.cmd exec madge -- src --extensions ts,tsx --circular
npm.cmd exec madge -- src --extensions ts,tsx --image docs/maps/generated/madge-graph.svg
```

or:

```powershell
npm.cmd install --save-dev dependency-cruiser
npm.cmd exec depcruise -- src electron --include-only "^(src|electron)" --output-type mermaid > docs/maps/generated/dependency-graph.mmd
```
