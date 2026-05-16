# Civitai API Recon Report - 2026-05-16

対象: Yoitomoshi Art Generator のCivitai連携強化

## Scope

- 公式REST APIで足りる範囲を優先する。
- browser-api-reconは、ユーザーが許可したログイン済みブラウザflowに限定する。
- 今回は認証済みアカウント通信、favorites、collections、生成job submit、blob uploadのcaptureは行っていない。
- ログイン回避、制限回避、非公開データ取得、Buzz/課金/生成制限の迂回は対象外。

## Official API Smoke

2026-05-16 に軽量疎通を確認した。

| Endpoint | Result |
|---|---:|
| `GET https://civitai.com/api/v1/tags?limit=1` | 200 |
| `GET https://civitai.com/api/v1/models?limit=1&types=LORA&sort=Most%20Downloaded&period=AllTime&nsfw=false` | 200 |

## Implemented In This Pass

- `CivitaiHttpError` を追加し、Civitai通信エラーを `auth / rate-limit / server / network / unknown` に分類。
- `fetchByHash`, `fetchLoraByHash`, `searchCivitai`, `listCivitaiTags`, image insight hash lookupの主要GETを共通fetch helperへ寄せた。
- tags取得はAPI失敗時に既存cacheへfallbackする。
- `CivitaiQuickRef.primaryFileSha256` を追加し、Dropped image insightとCommunity recommendationの不足モデルDLでSHA検証へ渡す。
- `LoraCivitaiMetadata` を `modelId / modelVersionId / files / availability / usage` で拡張し、LoRAカードでformat/SHAの存在を見える化した。

## Browser Recon Candidates

| Flow | Why browser recon may help | Capture policy |
|---|---|---|
| Web UI filter mapping | REST query名とUI filterの対応が分かりにくい | read-only, logged-out or disposable account |
| Query cursor behavior | query時のpage/cursor差異をUIごとに確認したい | redacted request/response only |
| Favorites / Collections | 公式RESTで不足する可能性がある | only user's own account, no replay without permission |
| Generation UI job flow | SDK設計候補の確認 | explicit permission required, no Buzz/limit bypass |

## Deferred

- Raw browser trace capture.
- OpenAPI artifact generation from trace.
- Authenticated favorites/collections SDK.
- Generation submit/result/upload SDK.

理由: 現時点のP0/P1改善は公式REST APIとローカル実装だけで足りるため。

## References

- https://developer.civitai.com/docs/api/public-rest
- https://github.com/civitai/civitai/wiki/REST-API-Reference/de63434512878133a5788a25f4b94af0c06de4bc
- `docs/FUTURE_FEATURE_ENHANCEMENT_REPORT_2026-05-16.md`
