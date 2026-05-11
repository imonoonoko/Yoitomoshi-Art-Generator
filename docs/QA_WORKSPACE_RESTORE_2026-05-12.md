# Workspace restore QA — 2026-05-12

対象: `.yoitoart` Workspace の `embed` / `references` / `settings-only` 保存と復元。

## 環境

- Electron preload API: `window.api.storage.*`
- 入力履歴: `userdata/history/3f1ec9bb-6695-4e21-8874-da5047c6d1e6.png`
- 外部参照素材: `output/workspace-qa/external-ref.png`
- Summary: `output/workspace-qa/summary.json`

## 実行内容

Electron remote debugging 経由で、実アプリの preload API を呼び出した。

1. `embed` Workspace を保存し、入力画像、直近生成画像、Upscale入力/出力、ControlNet Unit画像が data URL として保持されることを確認。
2. `references` Workspace を保存し、画像data URLを埋め込まず、履歴ID参照と外部ファイル参照だけを持つことを確認。
3. `settings-only` Workspace を保存し、画像data URLと画像参照を持たないことを確認。
4. `references` の履歴ID参照と外部ファイル参照を `storage.resolveImageReference` で復元。
5. 存在しない外部ファイル参照を解決し、欠落時に復元処理が検出できることを確認。

QAで一時保存したWorkspaceは、検証後に削除した。

## 結果

| ケース | 結果 | 確認内容 |
|---|---:|---|
| `embed` | PASS | `inputImageDataUrl` / `lastImageDataUrl` / ControlNet Unit画像が data URL として保存された。 |
| `references` | PASS | 埋め込み画像を持たず、`history` と `file` の参照だけを保存した。 |
| `settings-only` | PASS | 画像data URLと `imageReferences` を保存しない。 |
| 履歴ID参照復元 | PASS | `history` 参照を `data:image/png;base64,...` へ復元できた。 |
| 外部ファイル参照復元 | PASS | `file` 参照を `data:image/png;base64,...` へ復元できた。 |
| 欠落ファイル参照 | PASS | `workspace image file is not a file` として検出。UI復元側はこの例外を欠落参照として扱う。 |

## 実測値

- 一時保存ID:
  - `b183f729-9440-40e8-aeee-5a1fc46116c2`
  - `0642044e-1f12-450c-908c-1de6e092dc0f`
  - `27a12c1f-61ff-4acd-9223-99e4cca6769c`
- 履歴ID参照の復元data URL長: 786,774
- 外部ファイル参照の復元data URL長: 786,774

## 判断

- Workspace参照保存は、巨大画像を `.yoitoart` に埋め込まずに再利用できる状態になった。
- 共有先に参照ファイルが無い場合でも、画像復元だけを欠落扱いにできる。設定自体の復元を止めないUI実装は妥当。
- 次の改善は、欠落参照の差し替えUIと、プロジェクトフォルダ内素材の相対パス化。
