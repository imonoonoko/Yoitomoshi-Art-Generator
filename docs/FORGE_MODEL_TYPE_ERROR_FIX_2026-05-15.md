# Forge model type error fix 2026-05-15

## 症状

txt2img実行時に次のForge API 500が返った。

```text
Forge API /sdapi/v1/txt2img failed: 500 {"error":"ValueError","detail":"","body":"","message":"Failed to recognize model type!"}
```

## 原因

Forgeの選択checkpointが `anima-base-v1.0.safetensors` になっていた。

このファイルは `runtime/forge/webui/models/Stable-diffusion/` に置かれていたが、safetensors headerのtensor keyが `net.blocks.*` 系で、ForgeがSD/SDXL checkpointとして期待する `model.diffusion_model.*` / `conditioner.*` / `cond_stage_model.*` / `first_stage_model.*` を持っていなかった。

Forge側では `/sdapi/v1/sd-models` に表示されるものの、`hash` / `sha256` が `null` になり、実生成で `backend/loader.py` のmodel type判定に失敗する。

## 採用した修正

- `electron/forge-api.ts` の `listModels()` で、hash未解決の `.safetensors` を `inspectSafetensors()` で確認し、checkpointではない候補をアプリのモデル一覧から除外する。
- 起動時・モデル一覧更新時・モデルインポート後に、保存済み選択モデルが現在の有効一覧になければ先頭の有効モデルへ戻す。
- モデル選択時にrendererから `forge:set-current-model` IPCを呼び、Forgeのlive checkpointも同期する。
- Preflightに「選択モデルがForgeの利用可能一覧にない」blockerを追加する。

## 見送った修正案

- `anima-base-v1.0.safetensors` を自動削除する: ユーザーの手元素材を消すため見送り。
- Stable-diffusionフォルダ外へ自動移動する: 用途未確定のファイルを勝手に整理するため見送り。
- 生成時の例外握りつぶし: 原因がcheckpoint不一致なので、生成前に選べない状態へ直す方が恒久対応になる。

## 検証

- `npm.cmd run typecheck` PASS。
- `npm.cmd run build` PASS。
- Forge REST直叩きの最小 `txt2img` PASS。`desuCKNXL_v02.safetensors [053fde40f2]` で `images=1`。
- Electron renderer IPC経由の `window.api.forge.txt2img()` PASS。`images=1`。
- Electron renderer IPC経由の `window.api.forge.listModels()` で `anima-base-v1.0` が除外され、有効checkpoint 4件のみ表示されることを確認。
- `npm.cmd run qa:dom:api -- --port=9338` PASS。
- `npm.cmd run qa:dom -- selectors --port=9338` PASS。

## 運用メモ

`anima-base-v1.0.safetensors` はForge checkpointとしては未対応形式のため、Stable-diffusion本体モデルとしては使わない。用途が判明するまでは削除せず、必要なら別フォルダへ手動退避する。
