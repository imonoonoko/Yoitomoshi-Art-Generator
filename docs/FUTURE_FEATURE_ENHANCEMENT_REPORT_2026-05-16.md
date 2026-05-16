# Future Feature Enhancement Report - 2026-05-16

対象: Yoitomoshi Art Generator
目的: LyCORIS周りと、既存実装でまだ不完全な機能を洗い出し、今後の強化順を決めやすくする。

## 結論

次の強化は、Forgeへ追加拡張を入れるより **Yoitomoshi側のモデル理解・Prompt理解・制作履歴の再利用** を厚くするのがよい。

最優先は次の3つ。

1. **LyCORIS / LoRA Model Intelligence**
   - `models/Lora` だけでなく `models/LyCORIS` も含めてスキャンし、LoRA / LoCon / LoHa / LoKr / DoRA / GLoRA / BOFT を説明付きで扱う。
   - 旧 `<lyco:...>` 記法を検出し、現行Forgeで推奨しやすい `<lora:...>` へ移行案内する。
   - Civitai metadata、safetensors metadata、利用履歴を統合して「このLoRAは何用か、どのbase model向けか、triggerは何か」を見える化する。

2. **Prompt Formatter + Prompt Recipe**
   - Prompt Helperで作った候補、History review、Tagger結果、Civitai sample promptを、整形・重複削除・blacklist反映まで一続きにする。
   - 現在の文字列promptを正本にしたまま、タグチップ/整形/Preflight Quick Fixを追加するのが低リスク。

3. **Civitai Official API First + Recon補助**
   - 公式REST APIで取れる `models / images / model-versions / tags / by-hash` を土台にする。
   - browser-api-reconは、公式APIにないUIフィルタ対応、favorites/collections/hiddenの自分のアカウント範囲、cursor挙動、生成系SDK候補の確認に限定する。

## 調査した現状

### 既にできていること

- Civitai検索、Hugging Face検索、Download Manager、Model Library、metadata/preview保存の土台はある。
- LoRA一覧、Civitai lookup、trigger word自動挿入、base model mismatch警告、LoRA usage log、LoRA suggestion scoringはある。
- History reviewの accepted/rejected tags は Prompt Helper と Tagger比較へ接続済み。
- Forge runtime側には LyCORIS系の処理が既に入っている。
  - `runtime/forge/webui/extensions-builtin/sd_forge_lora/preload.py` に `--lyco-dir-backcompat` がある。
  - `runtime/forge/webui/backend/patcher/lora.py` は `lora`, `lokr`, `loha`, `glora`, DoRA scale を処理している。
  - `runtime/forge/webui/CHANGELOG.md` も A1111 1.5.0 でLyCORIS拡張の責務がLoRA側へ統合され、1.9.0でBOFT/DoRA対応が追加された流れを示している。

### 不完全なところ

| 領域 | 現状 | 不完全な点 | 改善案 |
|---|---|---|---|
| LyCORISフォルダ | `electron/lora-scanner.ts` は `models/Lora` のみ再帰スキャン | Forgeは `models/LyCORIS` もbackcompatで持てるが、Yoitomoshi UIには出ない | `scanLoras()` を複数root対応にし、`sourceRoot: 'Lora' | 'LyCORIS'` を `SdLora` に追加 |
| LyCORIS種別 | `inspectSafetensors()` は `ss_network_module` でLoRA判定する | LoCon/LoHa/LoKr/DoRA等のsubtypeをUIに出せない | `ModelKind` とは別に `adapterSubtype` を返し、カード/Health Scan/Inspectorで表示 |
| Prompt記法 | highlightは `<lyco:...>` を認識するが、parser/stripperは `<lora:...>` 中心 | 旧LyCO promptや複数引数記法が復元・履歴・Preflightから漏れる | `parseAdapterTokens()` を作り、`lora`, `lyco`, `hypernet` を統一的に解析 |
| ActiveLora | `name`, `weight`, `triggerWords` のみ | text encoder / UNet 別weight、dyn、subtype、hash、source pathが残らない | `ActiveAdapter` へ拡張し、既存 `ActiveLora` はmigration互換で読む |
| Civitai LoRA metadata | `fetchLoraByHash()` は model/version/base/tags/thumbnail/url/trainedWords中心 | modelId/versionId/file hashes/scan result/license/usage constraintsがLoRA側cacheにない | `LoraCivitaiMetadata` に `modelId`, `modelVersionId`, `files`, `availability`, `usage` を追加 |
| Dropped image insight | 不足LoRA/VAEのDL導線はある | `CivitaiQuickRef` にSHAがなく、DL時 `expectedSha256: null` になる | QuickRefにprimary file SHAを持たせ、DL後に検証する |
| Civitai rate limit | エラー表示中心 | retry/backoff/APIキー案内/キャッシュfallbackが弱い | `CivitaiHttpClient` を作り、429/401/5xxを分類してUIへ返す |
| Prompt整形 | `promptAppend()` はある | 重複タグ、余分なカンマ、旧記法、blacklist反映が分散 | `prompt-format.ts` を追加し、手動整形ボタン + Preflight Quick Fixに接続 |
| History review | 保存済み実レビュー0件でも固定QAで比較可能 | 実運用データが増えないとblacklist候補が育たない | History reviewを軽く触れる導線にし、2回以上rejectされたタグを昇格候補にする |
| Workspace | `.yoitoart` 保存復元は進んでいる | 共有時の参照切れ差し替えUI、相対パス化方針が未決定 | Workspace Import preflightでmissing file一覧と差し替えを出す |
| Upscale比較 | 比較保存はある | 保存済み比較から再採用/素材化済みへの流れが弱い | History label / Upscale comparison / Prompt recipeを1つの採用判断に接続 |
| Format Converter | checkpointの `.ckpt/.pt/.pth -> .safetensors` がある | LoRA抽出・adapter変換はまだ安全仕様未確定 | まずは「対応しない理由」と入力種別ガードをUIに明示し、抽出は後段 |
| Character compose | P0導線、診断、比較保存はある | IP-Adapter model配置済み環境、LayerDiffuse、IC-Light統合は条件付き | 導入診断からモデル検索・配置・実素材QAへ進める |

## LyCORIS強化案

### P0: LyCORIS / LoRAを同じ「Adapter」として扱う

実装対象:

- `src/shared/types.ts`
  - `SdLora` に `sourceRoot`, `adapterSubtype`, `sha256`, `baseModelHint` を追加。
  - 互換のため既存フィールドは残す。
- `electron/lora-scanner.ts`
  - `models/Lora` と `models/LyCORIS` を両方スキャン。
  - 同名衝突時は `sourceRoot/name` を内部IDにし、表示名は従来通り保つ。
- `electron/safetensors-inspect.ts`
  - `ss_network_module`, tensor key (`hada`, `lokr`, `dora_scale`, `oft`, `boft`) からsubtypeを推定。
- `src/components/LoraCard.tsx`
  - `LoRA`, `LoCon`, `LoHa`, `LoKr`, `DoRA`, `LyCORIS` badgeを表示。

完了条件:

- `models/Lora` と `models/LyCORIS` の両方に置いたadapterがUI一覧へ出る。
- 既存のLoRA適用、favorite、trigger挿入、base mismatch警告が壊れない。
- `.safetensors` でcheckpoint/VAEを誤ってLoRA扱いしない。

### P1: Adapter token parser

現状の `stripLoraTokens()` とPNG metadata parserは `<lora:name:weight>` に寄っている。LyCORISを安全に扱うなら、token parserを共通化する。

対応する記法:

- `<lora:name:0.8>`
- `<lyco:name:0.8>`
- `<lyco:name:te=1:unet=0.7:dyn=13>`
- 将来用に `<hypernet:name:0.6>` は検出だけ残す

改善点:

- paste時、history restore時、metadata insight時、generation build時で同じparserを使う。
- 旧 `<lyco:>` は「互換のため読めるが、新規生成では `<lora:>` 推奨」と表示する。
- `activeLoras` ではなく `activeAdapters` へ段階移行する。

完了条件:

- `<lyco:...>` 入りpromptを貼り付けても、生成時に二重適用しない。
- History復元でadapterが消えない。
- Preflightに「旧LyCO記法を含む」「複雑weight記法はUI編集対象外」などの警告が出る。

### P1: Civitai metadata拡張

公式REST APIだけで十分に取れる情報をLoRA側cacheにも保存する。

追加候補:

- `modelId`, `modelVersionId`
- primary file name / SHA256 / AutoV2 / size / format / pickle scan / virus scan
- commercial use / derivative / credit条件
- trained words と sample promptから見た推奨weight分布
- tagsを `character / style / clothing / concept / pose` へ分類したlocal category

完了条件:

- LoRAカードから「Civitaiで開く」「更新確認」「安全性/形式」「利用条件」を確認できる。
- DL後にSHA検証できる。
- base model mismatchとtrigger missingの精度が上がる。

## 公式APIとbrowser-api-reconの役割分担

### 公式APIで進める

- model search: `GET /api/v1/models`
- image prompt mining: `GET /api/v1/images`
- exact hash lookup: `GET /api/v1/model-versions/by-hash/:hash`
- tags: `GET /api/v1/tags`
- model/version detail: `GET /api/v1/models/:modelId`, `GET /api/v1/model-versions/:modelVersionId`

Yoitomoshiの制作補助は、まずこの範囲で足りる。

### browser-api-reconで調べる価値がある

- Civitai Web UIのフィルタがREST queryのどれに対応するか。
- queryあり検索でのcursor挙動、UI上のhidden/favorites/collectionsの扱い。
- 自分のアカウントで許可された範囲のcollections/favorites読み取り。
- 生成系Web UIのjob submit/result/upload流れをSDK化できるか。

対象外:

- ログイン回避、課金/Buzz/制限回避、非公開データ取得、rate limit回避。

成果物候補:

- `docs/CIVITAI_API_RECON_REPORT_YYYY-MM-DD.md`
- `.o11y/civitai-filter-map/api-spec/openapi.yaml`
- `samples/redacted/*.json`
- `src/lib/civitai-client-plan.md`

## 今後の機能強化ロードマップ案

### P0: すぐ価値が出る小さな改善

1. **Prompt Formatter**
   - 空白、カンマ、重複タグ、underscore、blacklist候補を整理。
   - `<lora:...>` / `<lyco:...>` / `AND` / `BREAK` / Regional Prompter tokenは保護。
   - UIはPrompt欄の小ボタンとPreflight Quick Fix。

2. **CivitaiHttpClient**
   - 429, 401, 404, 5xxを分類。
   - APIキー未設定/期限切れ/レート制限をユーザーに分かる文言へ変換。
   - 既存cache fallbackを使う。

3. **DroppedImageInsightのSHA付きDL**
   - QuickRefへprimary file hashを追加。
   - 不足LoRA/VAEをDLするときもSHA検証する。

### P1: 制作効率を上げる中核強化

1. **Adapter Library**
   - LoRA/LyCORISを同じAdapter概念で整理。
   - subtype, sourceRoot, base model, trigger, category, lastUsed, favorite, update statusを一覧化。

2. **Prompt Recipe**
   - Prompt Helper候補、Tagger正解/除外、Civitai sample prompt、LoRA triggerを1つのrecipeとして保存。
   - Historyの「採用候補」「素材化済み」と接続する。

3. **Workspace Import Preflight**
   - 共有された `.yoitoart` の参照切れ、未導入model/LoRA/VAE、base mismatchを事前表示。
   - Civitai/HF検索へ誘導する。

### P2: 高度化・運用品質

1. **Civitai Web UI filter recon**
   - official APIにないUIフィルタだけをbrowser-api-reconで観察。
   - redacted sampleとOpenAPI差分を残す。

2. **Compare Studio**
   - CFG / steps / LoRA weight / denoise / ControlNet ON/OFFを少数候補で横並び。
   - 採用結果をHistory labelとPrompt Recipeへ保存。

3. **Character Composite advanced**
   - IP-Adapter model導入済み環境でUnit 2効果確認。
   - LayerDiffuse透明生成、IC-Light照明合わせは導入診断から段階的に追加。

### P3: 後回し

- LoRA抽出、adapter変換、複数package管理、自然言語編集AI、外部生成サービス連携。
- 理由: 仕様の安全性、依存、ライセンス、検証コストが重い。既存のForge API + local UIの安定性を先に固める方が効果が大きい。

## 実装時の注意

- `src/lib/extension-payload.ts` の既存契約を壊さない。
- `runtime/`, `userdata/`, `output/` は明示されたfixture以外では編集対象にしない。
- DOM QAは表示文言ではなく `data-testid` と状態属性で行う。
- LyCORIS対応はまず検出・表示・復元から始め、生成payloadの変更は最後にする。
- Civitai通信は公式API優先。browser-api-reconは許可された読み取りflowの観察だけに使う。

## 推奨される次の1手

次に実装するなら **P0 Prompt Formatter** が最小で効果が高い。
その次に **Adapter token parser** と **LyCORIS複数root scan** を入れると、LyCORIS周りの不完全さを実運用で潰せる。

## 参照

- Local: `docs/EXTENSION_RESEARCH_PROMPT_LYCORIS_2026-05-15.html`
- Local: `docs/APP_MAP_2026-05-15.json`
- Local: `docs/ROADMAP.md`
- Local: `electron/lora-scanner.ts`
- Local: `electron/safetensors-inspect.ts`
- Local: `src/lib/lora-suggest.ts`
- Local: `src/lib/png-metadata.ts`
- Local: `src/components/DroppedImageInsight.tsx`
- Local: `runtime/forge/webui/extensions-builtin/sd_forge_lora/preload.py`
- Local: `runtime/forge/webui/backend/patcher/lora.py`
- Web: [KohakuBlueleaf/LyCORIS](https://github.com/KohakuBlueleaf/LyCORIS)
- Web: [KohakuBlueleaf/a1111-sd-webui-lycoris](https://github.com/KohakuBlueleaf/a1111-sd-webui-lycoris)
- Web: [AUTOMATIC1111 stable-diffusion-webui v1.5.0 release](https://github.com/AUTOMATIC1111/stable-diffusion-webui/releases/tag/v1.5.0)
- Web: [Civitai REST API Reference snapshot](https://github.com/civitai/civitai/wiki/REST-API-Reference/de63434512878133a5788a25f4b94af0c06de4bc)
- Web: [Civitai docs migration notice](https://github.com/civitai/civitai/wiki/REST-API-Reference)
