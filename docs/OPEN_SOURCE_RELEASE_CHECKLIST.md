# Open Source Release Checklist

最終更新: 2026-05-16

このチェックリストは、`imonoonoko/Yoitomoshi-Art-Generator` を private から public に切り替える前の確認用です。公開切替は不可逆に近い影響があるため、最後に明示確認してから実行します。

## 現在の判断

| 項目 | 判断 |
|---|---|
| 推奨ライセンス | MIT |
| package.json | `private: true` は維持し、npm誤公開を防ぐ。`license: MIT` を追加する |
| Forge runtime | 同梱しない |
| モデル / LoRA / ControlNet | 同梱しない |
| 生成画像 / 履歴 / Civitai cache | 同梱しない |
| Civitai API key | `userdata/secrets.local.json` に保存し、Git管理しない |
| visibility切替 | このチェックリスト完了後、ユーザー確認を取ってから実行 |

## 根拠メモ

- GitHub Docs は、公開リポジトリを本当にopen sourceにするには、利用・変更・配布を許可するライセンスが必要だと説明している。
- MIT License は短く、著作権表示とライセンス表示の保持を主条件にした permissive license として扱われる。
- GitHub Docs は、private から public にするとコードが全員に見え、誰でもforkでき、Actions履歴とログも見えると説明している。
- GitHub Docs は、secretが履歴に入った場合は履歴削除より先にsecretを revoke / rotate する必要があると説明している。

参考:

- https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository
- https://choosealicense.com/licenses/mit/
- https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility
- https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository
- https://spdx.org/licenses/

## 実施済みのローカル棚卸し

2026-05-16 時点で確認した内容:

- `gh repo view` で現在の visibility は `PRIVATE`。
- `git log --all --name-only` で `runtime/`, `userdata/`, `node_modules/`, `dist/`, `out/`, `output/`, model weight, generated image の履歴混入は検出されなかった。
- 履歴内の大きなblob上位は `package-lock.json`, `src/lib/i18n.ts`, `resources/prompt-library.ja.yaml`, `electron/ipc-handlers.ts` で、モデルや画像の巨大blobは検出されなかった。
- trackedファイルの簡易secret文字列検索では、実キー値ではなく `Authorization` header組み立てや `civitaiApiKey` 変数名のみ検出された。
- 直接npm依存は MIT / ISC / Apache-2.0 が中心。
- `resources/prompt-library.ja.yaml` は `Physton/sd-webui-prompt-all-in-one` 由来でMITとしてNOTICEに明記する。

## 公開前に確認するコマンド

```powershell
git status --short
git log --all --name-only --format= | Sort-Object -Unique | Select-String -Pattern '(^|/)(userdata|runtime|node_modules|dist|out|output)/|secrets\.local\.json|settings\.json|\.env|\.pem|\.key|\.safetensors$|\.ckpt$|\.onnx$|\.png$|\.jpg$|\.jpeg$|\.webp$' -CaseSensitive:$false
git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)'
npm.cmd run typecheck
npm.cmd run build
git diff --check
```

## 公開切替直前の人間確認

以下を確認してから公開する。

- GitHub Actionsログに非公開情報がない。
- issue / PR / commit message に公開したくない個人情報がない。
- docs内のローカルパスや検証ログを公開してよい。
- Civitai API keyなどのsecretが一度でも混入した疑いがない。疑いがある場合は先にrotateする。
- `runtime/` と `userdata/` はローカルに残っていても Git に入っていない。
- LICENSE / THIRD_PARTY_NOTICES / SECURITY / CONTRIBUTING が含まれている。

## visibility切替コマンド

最終確認後にのみ実行する。

```powershell
gh repo edit imonoonoko/Yoitomoshi-Art-Generator --visibility public --accept-visibility-change-consequences
```

実行後:

```powershell
gh repo view imonoonoko/Yoitomoshi-Art-Generator --json visibility,isPrivate,url
```
