# Yoitomoshi Art Generator — プロジェクトレポート

最終更新: 2026-05-25

---

## 1. プロジェクト概要

現在は `C:\宵灯工房アート\Yoitomoshi-Art-Generator` に置いている Electron 製 Stable Diffusion フロントエンド。
背後で **Stable Diffusion WebUI Forge**(`userdata/settings.json` の `forgePath`。既定: `C:\宵灯工房アート\Yoitomoshi-Art-Generator\runtime\forge`)を
サブプロセスとして自動起動し、Forge の REST API を介して生成を行う。Gradio 製の
Forge オリジナル UI は使わず、自前のミニマルな UI で扱いやすさに振り切る方針。
Forge は Electron 配下の `runtime\forge` に統合し、通常起動では `--nowebui` の API 専用モードを使う。
Gradio UI は表示しないが、Forge/拡張内部の Python 依存として `gradio` は残す。

> **位置づけ**: このプロジェクトは **配布目的ではなく、ユーザ本人が使いやすい
> Stable Diffusion 利用環境の自前最適化** のためのもの。よってインストーラ生成・コード署名・
> クロスプラットフォーム対応・自動アップデート等の配布関連作業は **対象外**。
> 開発機(Windows / RTX 4060 Ti 8GB)で快適に動くこと、生成・再利用・モデル管理・プロンプト整理の
> 日常ワークフローにフィットすることを優先する。
>
> **ポータブル構成**: 設定・履歴・プリセット・お気に入り・LoRA 使用履歴・Civitai キャッシュは
> アプリフォルダ直下の `userdata/` に保存される(Electron デフォルトの `%APPDATA%` ではなく)。
> プロジェクトフォルダごとコピー or 別 PC へ移動するだけで全データを持ち運べる。
> 旧 `%APPDATA%\sd-electron-ui\userdata\` のデータは初回起動時に自動マイグレーション。

### 設計目標

- **ComfyUI 級の扱いやすさ** + ミニマルなダーク UI
- **Civitai 連携** によるモデル単位の推奨設定自動適用
- **`sd-webui-prompt-all-in-one` 互換** のカテゴリ別プロンプトピッカー
- 生成パラメータ・プロンプト・履歴は Forge 側を汚さずアプリ管理(`<project>/userdata/`)
- **LoRA を中心に据えたワークフロー**(複数 LoRA 適用・自動提案・トリガーワード自動挿入)

### 進捗

| Phase | 状態 | 範囲 |
|---|---|---|
| Phase 1 | ✅ 完了 | scaffold / Forge 自動起動 / txt2img / モデル選択 / Civitai 推奨 / プロンプトライブラリ / 履歴 / プリセット / オートコンプリート |
| Phase 1.5 | ✅ 完了 | サブカテゴリ複数トグル / お気に入り・最近 / クイックプリセット / トークンカウンター / Ctrl+Enter, Ctrl+↑↓ / モデル取り込み / PNG メタデータドロップ |
| Phase 1.6 | ✅ 完了 | img2img / 画像 D&D + クリップボード入力 / deepdanbooru タグ抽出 / 結果を入力に戻す連続編集 |
| Phase 1.7 | ❌ 見送り | 自然言語編集(VRAM 8GB 制約と用途を踏まえ非採用 — §6 参照) |
| Phase 2 — 磨き込み | ✅ 完了 | 生成中プレビュー / 履歴検索 / シンタックスハイライト / ショートカット一覧 / 拡張無効化リスト |
| Phase 3 — LoRA 中核機能 | ✅ 完了 | LoRA カード UI / 複数 LoRA 同時適用 / プロンプト連動の自動提案 / トリガーワード自動挿入 |
| Phase 4 — メタデータ強化 | ✅ 完了 | PNG/JPEG/WebP 抽出 / ラベル形式テキスト貼付 / Civitai 照合 / 推奨 VAE 自動 DL |
| Phase 5 — 配布準備 | ✅ 完了 | run.bat/setup.bat/update.bat / Node.js 同梱 / Forge 同梱パッケージ生成スクリプト |
| Phase 6 — 多言語化 (Phase 1) | ✅ 完了 | i18n 基盤 / 言語切替 UI(ja/en/ru/pt) / TitleBar / Settings / RecommendationCard / 主要トースト / ドキュメント 4 言語化 |
| **Phase 7 — タブ + 拡張組込** | ✅ **完了** | §8 参照: 4 タブ構成(txt2img/img2img/Upscale/Tools) + 折りたたみ拡張パネル (Dynamic Threshold / FreeU / ADetailer / ControlNet) + Upscale ワークフロー + Model Inspector |
| Phase 8 — メタデータ駆動 UX | ✅ **完了** | Upscale 自動推奨 / ジャンル判定 / tile 自動マッチ / tile drift 対策 / txt2img→Upscale 直送 |
| i18n フェーズ 2 主要部 | ✅ **完了** | PromptLibrary / ShortcutsModal / ParametersPanel / PreviewPanel / LoraPanel / MetadataInfoPanel / CivitaiSearchModal / QuickPresetBar |
| i18n フェーズ 2 残部 | ✅ **完了** | InputImagePanel / DroppedImageInsight / HistoryGallery / LoraCard / PresetList / SidePanel / StartupOverlay / LoRA 推奨理由 |
| Phase 9A — Tile ControlNet 統合 | ✅ **API+実UI検証済み / 目視比較残** | Upscale Diffusion / Ultimate 共通の Tile ControlNet トグル、ControlNet alwayson payload、Civitai DL 導線、xinsir Tile SDXL モデル配置 |
| Phase 9B — 履歴再利用導線 | ✅ **主要部完了** | 履歴から完全再現 / 履歴→Upscale / seed・CFG・denoise バリエーション生成 |
| Phase 9C — Tools 強化 | 🔜 進行中 | カタログ健全性 / モデル健全性チェック完了。次は Model Merger / Format Converter |
| P0.5 — フォルダ統合 | ✅ **完了** | Forge を `runtime\forge` に統合 / `--nowebui` API専用起動 / Gradio UI非起動 |

---

## 2. 技術スタック

| レイヤ | 採用技術 | 理由 |
|---|---|---|
| アプリ枠 | Electron 33 | Windows ネイティブ統合・Forge プロセス管理が楽 |
| ビルド | electron-vite 2 + Vite 5 + TypeScript 5 | 公式準拠の Electron+Vite テンプレ。Vite 6 は electron-vite v2 の peer 不一致で見送り |
| UI | React 19 + Tailwind CSS 3 + Radix UI(Tabs/Slider/DropdownMenu/Tooltip) | shadcn/ui 全面採用は依存過多なので Radix 単体 + 手書きコンポーネント |
| 状態管理 | Zustand 5 | 全体で 1 ストア、`useStore(s => s.x)` のセレクタで購読 |
| アイコン | lucide-react | |
| 通知 | react-hot-toast | |
| YAML | js-yaml | プロンプトライブラリの読み込み |
| 永続化 | プレーン JSON(`fs/promises`) | better-sqlite3 のネイティブビルド回避。履歴 ~500 件想定 |
| プロンプトライブラリ素材 | `Physton/sd-webui-prompt-all-in-one` の `ja_JP.yaml`(MIT) | アトリビューション込みで同梱 |
| CLIP メタデータ抽出 | DataView で PNG tEXt/iTXt チャンクを直接パース | 専用ライブラリ不要 |

---

## 3. アーキテクチャ

```
┌───────────────────────────────────────────────────────────────┐
│  Electron Main プロセス                                         │
│    main.ts  ── electron/main.ts                                │
│      ├─ ForgeManager ── python launch.py を spawn              │
│      ├─ ForgeApi      ── /sdapi/v1/* REST クライアント          │
│      ├─ Storage       ── JSON ファイル永続化                    │
│      ├─ Civitai       ── /api/v1/model-versions/by-hash        │
│      ├─ PromptLibrary ── ja_JP.yaml ローダ + 補完辞書           │
│      └─ IPC handlers  ── 全 IPC チャネル登録                    │
│                                                                 │
│  ↑↓ contextBridge(electron/preload.ts)                         │
│                                                                 │
│  Renderer プロセス(React)                                      │
│    App.tsx                                                      │
│    ├─ TitleBar(Forge 状態 / モデル選択 / インポート / 設定)    │
│    ├─ PromptPanel                                               │
│    │    ├─ RecommendationCard(Civitai 推奨設定)                │
│    │    ├─ InputImagePanel(img2img 入力 + タグ抽出)            │
│    │    ├─ QuickPresetBar × 2(positive/negative)              │
│    │    ├─ PromptEditor × 2(autocomplete + 重み調整)          │
│    │    └─ ParametersPanel                                      │
│    ├─ PreviewPanel(D&D 受け / プログレス / ダウンロード)       │
│    ├─ SidePanel(ライブラリ / 履歴 / プリセット タブ)            │
│    └─ StartupOverlay(起動中ログ表示)                           │
└───────────────────────────────────────────────────────────────┘
              │
              ↓ HTTP REST
┌───────────────────────────────────────────────────────────────┐
│ Stable Diffusion WebUI Forge(Python サブプロセス)              │
│   --api --api-log --port 7860                                  │
│   /sdapi/v1/{txt2img, img2img, sd-models, samplers,            │
│              progress, interrogate, refresh-checkpoints, ...}  │
└───────────────────────────────────────────────────────────────┘
              │
              ↓ HTTPS
┌───────────────────────────────────────────────────────────────┐
│ Civitai API(https://civitai.com/api/v1)                       │
│   /model-versions/by-hash/{sha256}                             │
└───────────────────────────────────────────────────────────────┘
```

### Forge 起動の特殊事情

`run.bat` 経由の起動は、現代の Windows が **非インタラクティブな cmd で
`call <script>` を CWD から解決しない** セキュリティ仕様により失敗する。
そのため `electron/forge-manager.ts` では:

1. `environment.bat` の環境変数(PATH に bundled python/git、`SKIP_VENV=1` 等)を Node 側で再現
2. `system/python/python.exe` を直接 `spawn` し、引数に `webui/launch.py` を渡す
3. `COMMANDLINE_ARGS` 環境変数で `--api --port 7860` 等を Forge に伝達
4. プロセス停止は `taskkill /T /F` で子孫まで一括終了

加えて Forge は「Running on local URL」を出した直後 1〜5 秒は `/sdapi/v1/*` が
404 を返すため、`/sdapi/v1/options` を 750ms 間隔でポーリングして 200 が返ってから
`status: 'ready'` に遷移する readiness gate を入れてある。

---

## 4. 実装済み機能(完全リスト)

### 4.1 起動・接続
- Forge を Electron 起動と同時に自動起動(設定で OFF 可能)
- `--ckpt-dir` 等を独自設定する代わりに Forge 標準の `webui/models/` を使用
- 接続状態(stopped / starting / ready / error)をタイトルバーに常時表示
- 起動中は StartupOverlay に直近 30 行のログを表示

### 4.2 モデル管理
- API から取得したモデル一覧をドロップダウンに表示(ハッシュ付き)
- **モデル取り込み**: スプリットボタン 1 クリックで `.safetensors` / `.ckpt` の
  ファイルピッカー → `webui/models/Stable-diffusion/` にコピー → 自動再スキャン
- 「移動して取り込む」モード(元削除)、「モデルフォルダを開く」も同ボタンの ▼ から
- ドライブ跨ぎ対応(内部で `copyFile` + 任意で `unlink`)

### 4.3 Civitai 連携
- モデル選択時に SHA-256(Forge が既に計算したものを優先、なければ Node で計算)で
  `/api/v1/model-versions/by-hash/{sha}` を引いて推奨設定を取得
- 結果は `userdata/civitai/<sha>.json` にキャッシュ(以後オフラインでも復元可能)
- サンプル画像のメタデータから sampler は最頻、steps/cfg/size は中央値を採用
- ベースモデル名(SD1.5 / SDXL / Pony / NoobAI 等)・トリガーワード・サムネを表示
- 「推奨設定を適用」で sampler/steps/CFG/size/clip skip/ネガを一括反映、トリガーワードは
  プロンプト先頭に追記

### 4.4 プロンプト入力
- プロンプト/ネガティブそれぞれに:
  - **オートコンプリート**(Danbooru タグ + 同梱 YAML 由来。日本語訳併記)
  - **トークンカウンター**(75 トークン chunk の境界を可視化、150 超で警告色)
  - **クイックプリセット**(組み込み 8+7 個 + ユーザ追加。トグル式チップで挿入/削除)
- キーボード:
  - `Ctrl+Enter` で生成
  - `Ctrl+↑/↓` でカーソル位置のタグの重みを `(tag:1.1)` 形式で 0.1 刻み調整(0.1〜2.0)

### 4.5 プロンプトライブラリ(右ペイン)
- 左ナビ: ⭐ お気に入り / 🕒 最近 / 各カテゴリ(人物/衣服/表情/画面/環境/シーン/アイテム/レンズ/漢服/ネガ)
- サブカテゴリピル: **複数トグル**(独立に表示/非表示)
  - デフォルト: 最初のサブカテゴリだけ表示(縦スクロール最小化)
  - Shift+クリック: ソロ(他全部閉じてそれだけ)
  - 「全て」「なし」ボタン
- タグチップ: 普通クリックで追加 / Shift+クリックで `(tag:1.1)` / Alt+クリックでネガティブへ / ☆ でお気に入り
- 検索ボックスは全カテゴリ横断、検索中は自動で「全て表示」モード

### 4.6 パラメータ
- Steps / CFG / Width / Height / Sampler / Scheduler / Seed / Batch / Iterations / Clip Skip
- Width/Height はプリセット 6 種(`512²` / `768×1024` / `1024×768` / `1024²` / `832×1216` / `1216×832`)
- Seed のロック/ランダム化トグル

### 4.7 生成と進捗
- txt2img / img2img を入力画像の有無で自動切り替え(生成ボタンに `txt2img` / `img2img` バッジ表示)
- 生成中は 500ms 間隔で `/sdapi/v1/progress` をポーリング、進捗バー + 中間プレビュー画像表示
- Ctrl+Enter で即生成、生成中はボタンが「中断」になり API へ interrupt

### 4.8 img2img(画像入力)
- **D&D**: 中央プレビューに画像をドロップ → 入力にセット + メタデータがあれば params も復元
- **クリップボードペースト**: アプリ内任意の場所で Ctrl+V → 入力にセット
- **InputImagePanel**: サムネ + Denoising 強度スライダ(0.00〜1.00)+ ✕で解除
- **タグ抽出**: ボタン 1 つで `/sdapi/v1/interrogate` (deepdanbooru) を呼び、
  得られたタグをチップ表示。クリックでプロンプトに追加、「全追加」もあり
- **♻ feedback as input**: 直前の生成結果を入力に戻す連続編集ループ

### 4.9 履歴・プリセット
- 履歴: 自動保存(最大 500 件、PNG 本体 + サムネ JPEG)。クリックで params 復元
- プリセット: 名前付きプロンプト+ネガペアの保存・読込・削除
- 全データは `<project>/userdata/` に集約(プロジェクトフォルダ持ち運びでデータも一緒に移動可能)

### 4.10 PNG メタデータ
- A1111 形式の `parameters` テキストチャンクをデコード(tEXt + iTXt 両対応)
- prompt / negative / steps / cfg / sampler / size / seed / clip skip を抽出
- ドロップ後すぐにフォームへ反映、画像本体も入力にセット

### 4.11 設定モーダル
- Forge パス・ポート・自動起動・追加引数・Civitai API キー・出力ディレクトリ
- **表示言語**(ja / en / ru / pt)切替セレクタ追加
- 設定は JSON で永続化、変更は次回 Forge 起動時に反映

### 4.12 タブ構成(Phase 7)
- TitleBar 直下に **MainTabs** バーを設置 — `[ txt2img ][ img2img ][ Upscale ][ Tools ]` の 4 タブ固定
- 状態は `useStore.currentTab` に保持、再レンダリング時にタブ別レイアウトを切替
- 拡張機能はタブを増やさず、各タブ内の **折りたたみパネル** として配置(肥大化抑制)
- タブ間連携:
  - 画像をペースト/ドロップ → 自動で img2img タブへ切替 + 入力画像セット
  - Upscale 結果 → 「img2img へ送る」「再アップスケール」ボタン

### 4.13 拡張機能パネル(Phase 7)— PromptPanel 内に折りたたみ式

| パネル | 状態保持 | API 連携 | 操作 |
|---|---|---|---|
| **Dynamic Thresholding** (CFG-Fix) | `dynThres`(12 フィールド) | `alwayson_scripts['DynamicThresholding (CFG-Fix) Integrated']` | enabled / mimic scale / threshold percentile + 詳細(mode 系・min 系・interp phi) |
| **FreeU** | `freeu`(7 フィールド) | `alwayson_scripts['FreeU Integrated (SD 1.x, SD 2.x, SDXL)']` | B1/B2/S1/S2 + start/end step |
| **ADetailer** | `adetailer.units[]`(最大 4) | `alwayson_scripts['ADetailer']` (`[enabled, skip_img2img, ...units]`)| ユニット別 model / prompt / negative / confidence / denoise / mask blur / padding / dilate-erode |
| **ControlNet** | `controlnet.units[]`(最大 3) | `alwayson_scripts['ControlNet']`(units 配列) | ユニット別 image / module / model / weight / guidance start-end / control mode / resize mode / pixel perfect。`/controlnet/model_list` と `/controlnet/module_list` で動的にカタログ取得 |

- 共通基盤:
  - [`CollapsiblePanel.tsx`](../src/components/CollapsiblePanel.tsx) — 折りたたみ + 横の enabled トグル(クリック伝播停止)
  - [`extensions/controls.tsx`](../src/components/extensions/controls.tsx) — Slider / SelectField の共通 props
  - [`lib/extension-payload.ts`](../src/lib/extension-payload.ts) — 各 enabled なパネルから `alwayson_scripts` ペイロードを一元生成。Forge スクリプトの `title()` と完全一致する文字列をキーとして使用

### 4.14 Upscale ワークスペース(Phase 7 + Phase 8)
- 専用タブ。左に設定、右に結果プレビュー
- 3 ワークフロー:
  - **Simple** — `/sdapi/v1/extra-single-image`、純粋なニューラル拡大(R-ESRGAN 等)、第 2 upscaler ブレンド対応
  - **Diffusion** — img2img + MultiDiffusion alwayson_scripts、タイル分割で詳細追加(プロンプトはメイン PromptPanel から継承)
  - **Ultimate** — img2img + `script_name='Ultimate SD upscale'`、18 個の positional `script_args` で redraw / seam fix を制御
- 倍率プリセット(1.5/2/3/4)+ 任意値、Diffusion / Ultimate はタイル幅/高さ/オーバーラップ/denoise/方式
- 入力画像のメタデータと寸法から、方式 / upscaler / scale / tile サイズを推奨するバナーを表示
- 結果操作: PNG 保存 / img2img へ送る / 再アップスケール
- Upscaler 一覧は Forge ready 時に `/sdapi/v1/upscalers` から取得

### 4.15 Tools タブ(Phase 7〜9C)
- **Model Inspector**: `.safetensors` / `.ckpt` を選択 → ヘッダ読取 → 種別 / サイズ / 先頭テンソルキー / 埋込メタデータ表示。Forge 起動不要、ローカル完結([`safetensors-inspect.ts`](../electron/safetensors-inspect.ts) を再利用)
- **Catalog Health**: Forge APIから Checkpoints / LoRA / VAE / ControlNet / Upscalers を再読込し、Tile ControlNet モデル/モジュールを確認。
- **Model Health Scan**: `runtime\forge\webui\models\{Stable-diffusion,Lora,VAE,ControlNet}` をローカル走査し、空ファイル、種別違い、同名モデル重複を検出。`.safetensors` はヘッダだけ読むため大容量モデルでも高速。
- Model Merger / Format Converter はプレースホルダ(後続フェーズ)

### 4.16 多言語化(i18n)— Phase 6 + i18n フェーズ 2
- [`lib/i18n.ts`](../src/lib/i18n.ts) に翻訳辞書(ja / en / ru / pt)を集約。
- フック版 `useT()`(JSX 内、言語切替で再描画)+ 非フック版 `t()`(イベントハンドラ用、closure stale 回避)
- 翻訳済コンポーネント: `TitleBar` / `SettingsModal` / `StatusDot.statusLabel` / `BrokenExtensionsButton` / `MainTabs` / `PromptPanel`(主要ラベル+トースト)/ `InputImagePanel`(EmptyState)/ `RecommendationCard` / `PromptLibrary` / `ShortcutsModal` / `ParametersPanel` / `PreviewPanel` / `LoraPanel` / `MetadataInfoPanel` / `CivitaiSearchModal` / `QuickPresetBar` / 拡張パネル群 / `UpscaleWorkspace` / `ToolsWorkspace`
- ドキュメント: `README.md` + `README.{en,ru,pt}.md` / share フォルダの `はじめに.txt` + `start.{en,ru,pt}.txt`
- 未翻訳残: `InputImagePanel` 内部 / `DroppedImageInsight` / `HistoryGallery` / `LoraCard` / `PresetList` / `SidePanel` / `StartupOverlay` / `LoraSuggestionStrip` など。詳細は [`ROADMAP.md`](ROADMAP.md) を参照。

---

## 5. ディレクトリ構成

```
C:\宵灯工房アート\Yoitomoshi-Art-Generator\
├── package.json              name: "yoitomoshi-art-generator", productName: "Yoitomoshi Art Generator"
├── electron.vite.config.ts   ビルド設定(out/{main,preload}/index.js を強制)
├── tsconfig.{json,node,web}.json
├── tailwind.config.ts        ダークパレット定義
├── electron/
│   ├── main.ts               Electron 起動、ウィンドウ生成、IPC 配線
│   ├── preload.ts            window.api(全 IPC を型付け)
│   ├── ipc-handlers.ts       全 IPC ハンドラ定義
│   ├── forge-manager.ts      Forge 子プロセス起動・停止・readiness ポーリング
│   ├── forge-api.ts          Forge REST クライアント
│   ├── civitai-api.ts        Civitai 検索 + SHA-256 ハッシュ計算
│   ├── prompt-library.ts     ja_JP.yaml ローダ + 補完辞書ビルド
│   ├── quick-presets.ts      組み込みクイックプリセット定義
│   └── storage.ts            設定 / 履歴 / プリセット / お気に入り JSON
├── src/
│   ├── main.tsx              React エントリ
│   ├── index.html            CSP + マウント先 div
│   ├── index.css             Tailwind + 共通コンポーネントクラス
│   ├── App.tsx               ルート、bootstrap、生成フロー、Ctrl+V ハンドラ
│   ├── jsx-shim.d.ts         React 19 で消えた global JSX namespace の補修
│   ├── shared/
│   │   ├── types.ts          IPC で共有される型定義
│   │   └── ipc-channels.ts   IPC チャネル名一元管理
│   ├── lib/
│   │   ├── store.ts          zustand 全体ストア
│   │   ├── ipc.ts            window.api 型付き再エクスポート
│   │   ├── utils.ts          cn / formatBytes / clamp / snapTo
│   │   ├── prompt-utils.ts   トークン重み調整 / カウント / プリセット splice
│   │   └── png-metadata.ts   PNG tEXt/iTXt 解析
│   └── components/
│       ├── TitleBar.tsx
│       ├── PromptPanel.tsx
│       ├── PromptEditor.tsx
│       ├── ParametersPanel.tsx
│       ├── NumberField.tsx
│       ├── RecommendationCard.tsx
│       ├── QuickPresetBar.tsx
│       ├── InputImagePanel.tsx
│       ├── PreviewPanel.tsx
│       ├── SidePanel.tsx
│       ├── PromptLibrary.tsx
│       ├── HistoryGallery.tsx
│       ├── PresetList.tsx
│       ├── SettingsModal.tsx
│       ├── StartupOverlay.tsx
│       └── StatusDot.tsx
├── resources/
│   └── prompt-library.ja.yaml  Physton/sd-webui-prompt-all-in-one 由来(MIT)
├── runtime/
│   └── forge/                  Stable Diffusion WebUI Forge 本体(system/ + webui/)
├── docs/
│   └── PROJECT_REPORT.md       本レポート
└── userdata/                    アプリ生成データ(Git無視)
    ├── settings.json            forgePath / port / 自動起動 / Civitai API キー 等
    ├── presets.json             プロンプト+ネガペアの保存セット
    ├── quick-presets.json       カスタム QuickPreset(組込分以外)
    ├── hidden-quick-presets.json 非表示にしたプリセット ID
    ├── favorites.json           タグお気に入り(クロスカテゴリ)
    ├── lora-favorites.json      LoRA お気に入り
    ├── lora-usage.json          LoRA 使用履歴(自動提案スコアリング用)
    ├── civitai/                 Civitai メタキャッシュ(<sha256>.json / lora-<sha256>.json)
    ├── history/                 生成履歴(index.json + <uuid>.png)
    └── .migrated-from-legacy   マイグレーション済マーカー
```

---

## 6. リサーチ: 自然言語による画像編集の取り込み(Nano Banana 等)— **採用見送り**

> **結論**: 当プロジェクトは個人利用の Stable Diffusion 環境であり、外部 API 課金が継続的に発生する
> クラウド方式は趣旨に合わず、ローカル方式は VRAM 8GB では実用域に達しないため
> **Phase 1.7 として実装する計画は破棄**。以下は将来再検討するための調査記録として保存。

> 「画像を見せて、ChatGPT/Gemini のように『ここをこうして』と言うだけで編集できる」
> 体験を本アプリに組み込めるか — 2026 年 5 月時点での選択肢を整理する。

### 6.1 Google Gemini 2.5 Flash Image(通称 Nano Banana)

- 画像の局所編集(背景ぼかし、シミ消し、人物除去、ポーズ変更、白黒着色など)を
  プロンプト一行で行える Google の最新マルチモーダル画像モデル
  ([blog](https://developers.googleblog.com/en/introducing-gemini-2-5-flash-image/) /
   [docs](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-image))
- **複数画像のブレンド**(参考画像 + 編集対象を混ぜる)、**キャラクター一貫性**、
  Gemini の世界知識を踏まえた賢い編集が強み
- API: `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent`
  - ヘッダ: `x-goog-api-key: <KEY>` + `Content-Type: application/json`
  - body: `contents[].parts[]` に instruction テキストと `inline_data` で base64 画像
  - response: `candidates[].content.parts[].inlineData` で base64 画像が返ってくる
- 価格: 出力 $30 / 1M tokens、画像 1 枚 = 1290 tokens ≒ **$0.039 / 枚**
  ([Google Developers Blog](https://developers.googleblog.com/en/introducing-gemini-2-5-flash-image/))
- アクセス: 公式 Gemini API / Google AI Studio / Vertex AI / OpenRouter / Vercel AI Gateway 等

### 6.2 ローカル実行可能な代替モデル

#### FLUX.1 Kontext Dev(Black Forest Labs, 12B params, 非商用ライセンス)
- 画像 + テキスト指示の **マルチモーダル編集モデル**。スタイル変更、キャラ一貫性、
  オブジェクト追加削除、ターゲット修正に強い
  ([HF](https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev) /
   [ComfyUI チュートリアル](https://docs.comfy.org/tutorials/flux/flux-1-kontext-dev))
- ComfyUI に Native Workflow テンプレートあり。Forge は現状 Kontext を正式サポートしていないが、
  GGUF/FP8 量子化で動かす拡張は登場している
- VRAM 要件:FP16 は約 24GB、FP8 で 14〜16GB、GGUF Q4 で **10〜12GB** が目安

#### Qwen-Image-Edit(Alibaba, 20B params, Apache 2.0)
- Qwen2.5-VL でセマンティクス、VAE で外観を扱うデュアルエンコード設計。
  オブジェクト追加削除、スタイル転送、**画像内テキストの編集**(看板の文字を書き換える等)が
  Kontext より明確に強い
  ([GitHub](https://github.com/QwenLM/Qwen-Image) /
   [Qwen-Image-Edit ガイド](https://www.cliprise.app/learn/guides/model-guides/qwen-image-edit-complete-guide))
- 2025-11 月時点で `Qwen-Image-Edit-2511` がリリース済
  ([Diffusion Doodles](https://medium.com/diffusion-doodles/model-rundown-z-image-turbo-qwen-image-2512-edit-2511-flux-2-dev-fc787f5e87ad))
- 同様に GGUF/FP8 量子化版が ComfyUI 向けに流通

#### InstructPix2Pix(SD 1.5 ベース、軽量)
- 旧来の指示ベース編集モデル。VRAM 6〜8GB で動くため **本ユーザーの 8GB VRAM 環境でもネイティブ実行可能**
- 性能は最新モデルに劣るが「お試し実装」としては最安手

### 6.3 比較表

| 項目 | Nano Banana(API) | FLUX Kontext Dev | Qwen-Image-Edit | InstructPix2Pix | 既存の単純 img2img |
|---|---|---|---|---|---|
| 編集品質 | ★★★★★ | ★★★★ | ★★★★ | ★★ | ★★(指示理解は限定的) |
| キャラ一貫性 | ★★★★★ | ★★★★ | ★★★ | ★★ | ★★ |
| 局所編集 | ★★★★★ | ★★★★ | ★★★★ | ★★ | ★(全体に影響) |
| 文字編集 | ★★★ | ★★ | ★★★★★ | ★ | ★ |
| 必要 VRAM | 0(クラウド) | 12〜24GB | 16〜24GB | 6〜8GB | ユーザの SD と同等 |
| プライバシー | × 画像が外部送信 | ○ | ○ | ○ | ○ |
| 課金 | $0.039/枚 | 無料 | 無料 | 無料 | 無料 |
| ユーザー環境 (RTX 4060 Ti 8GB) で動くか | ○ | △(GGUF Q4 のみ) | △〜× | ○ | ○ |

参考: [Nano Banana vs Qwen vs Flux Kontext Pro vs SeedEdit 25 prompts test](https://wiro.ai/blog/nano-banana-vs-qwen-flux-kontext-pro-seededit/) /
[FLUX vs Qwen Image](https://fal.ai/learn/tools/flux-vs-qwen-image)

### 6.4 ハードウェア制約に対する所感

- ユーザの環境は **NVIDIA RTX 4060 Ti(VRAM 8GB)**(Forge ログから確認済)
- FLUX Kontext Dev / Qwen-Image-Edit を素のままで快適に動かすのは厳しい
  - GGUF Q4 量子化版なら動くが、ロード時間が増え、品質も劣化する
  - Forge も最新ビルドで一応サポートはするが、ComfyUI 経由のほうが整備されている
- **InstructPix2Pix は動くが、現在のクラウド系モデルとは品質差が大きい**

### 6.5 推奨実装プラン:**3 段構えで提供する**

「いきなり Nano Banana だけ」ではなく、**ユーザが体験品質と費用・プライバシーを
選べる構成** を取るのが筋がよい。設定モーダルから「自然言語編集の方式」を選択させる。

#### モード A: クラウド(Nano Banana)
- **対象**: 高品質を求める / VRAM 制約が厳しい / 1 枚 4 円程度の課金を許容できるユーザ
- **実装**: 設定に Gemini API キー欄を追加 → 専用パネル「自然言語編集」を開いて
  入力画像 + 自然言語 instruction を投げる → 返ってきた画像を生成結果として履歴保存
- **工数**: 中(1 IPC + 1 設定欄 + 1 パネル + 履歴連携)。Forge 不要なので独立追加可能

#### モード B: ローカル指示モデル(FLUX Kontext / Qwen-Image-Edit)
- **対象**: 完全オフラインを望む / VRAM が十分(16GB+)あるか GGUF を許容できるユーザ
- **実装**: Forge にモデルファイル(例: `flux1-kontext-dev-Q4_K_M.gguf`)をダウンロード
  → モデル選択ドロップダウンで切替 → 指示モードでは特殊な txt2img/img2img プロンプト
  形式を Forge に送る(モデル側の指示構文に従う)
- **工数**: 大(モデル毎の引数差異吸収・切替 UI・設定保存)。8GB VRAM では実用性が微妙

#### モード C: ハイブリッド(LLM プロンプト変換 + ローカル img2img)
- **対象**: 既存ローカルモデルでの編集をもう少しスマートにしたい / 課金は最小に抑えたい
- **仕組み**:
  1. 入力画像 + 自然言語 instruction を **テキスト LLM**(Gemini Flash / Claude Haiku /
     OpenAI 系のいずれか、または Ollama でローカル LLM)に渡す
  2. 「画像内容の説明 + ユーザ指示 → SD 用の英語プロンプト」を生成させる
  3. 生成された SD プロンプトで現在の Forge img2img を実行
- **コスト**: テキストのみなら $0.001 オーダー / 枚
- **工数**: 中(LLM クライアント追加 + プロンプト変換テンプレート設計 + UI)
- **品質**: 直接編集モデルには及ばないが、SD に慣れていないユーザの **指示 → プロンプト
  翻訳の手間が消える** 効果が大きい

### 6.6 提案する実装順序

**Phase 1.7 — 自然言語編集パネル(クラウド優先)**
1. 設定に「自然言語編集プロバイダ」と「Gemini API キー / OpenAI API キー」項目を追加
2. 中央プレビュー横または下部に「✨ 自然言語で編集」ボタン → モーダルを開いて instruction 入力
3. Nano Banana を呼ぶ IPC ハンドラ(main プロセス側、API キーは renderer に渡さない)
4. 結果を `lastImage` にセット + 履歴へ追加(prompt 欄には instruction を保存)
5. `setInputImage` でそのまま再編集ループに入れる導線

**Phase 1.8 — ハイブリッド(プロンプト変換)**
1. 設定に「LLM プロンプト変換: ON/OFF」+ 使う LLM の選択
2. 入力画像が設定された状態で「instruction → SD プロンプト」変換ボタン
3. 変換結果をプロンプト欄にプレビューしてから生成

**Phase 1.9 — ローカル指示モデル対応(オプション)**
- ユーザの VRAM が 16GB+ になった時 / GGUF 量子化が普及した時の選択肢として、
  モデルメタデータに「edit-model」フラグを持たせて UI を切り替える形を準備
- 現状の 8GB VRAM 環境では実装優先度は低い

### 6.7 プライバシー上の注意

- Nano Banana / OpenAI 系を使う場合、**画像と instruction が Google / OpenAI のサーバに送信される**
- 各社のデータ取扱ポリシー(訓練利用の有無など)は変動するので、設定モーダルに
  「クラウド送信時のリスク」明示と利用規約リンクを併記すべき
- ローカル / ハイブリッドモードを「推奨」、クラウドを明示的にオプトインさせる UI を推奨

### 6.8 見送りの理由(本プロジェクト固有)

- **個人開発・配布なし**: 1 枚 4 円の課金が日常的に発生するモデルは個人ワークフロー向けではない
- **VRAM 8GB**: ローカル指示モデル(Kontext / Qwen-Image-Edit)は GGUF Q4 以下で
  辛うじて動く水準で、ロード時間と品質劣化を考えると現状の img2img + プロンプト工夫で
  十分代替できる
- **既存機能で代替可能**: ♻ "feedback as input" + プロンプト書き換えループは
  「自然言語編集」と完全には別物だが、日常的に生成候補を増やす用途では実質ほぼ同等の
  反復編集ができる
- **将来の見直し条件**: ① ローカル指示モデルが 8GB 級に最適化される、② プロジェクトが
  配布対象に変わる、のいずれかが起きたら §6.5 の Phase 1.7 案を復活させる

---

## 7. LoRA 中核機能の設計(Phase 3)

LoRA(Low-Rank Adaptation)は本プロジェクトの主要なワークフロー要素として位置付ける。
Stable Diffusion を自分用に使い込む環境では「キャラ LoRA + 服装 LoRA + 画風 LoRA」を **複数同時適用** することが
常で、加えて **どの LoRA を選ぶべきか自体がノウハウ**(対応ベースモデル・推奨ウェイト・
トリガーワード等)になっている。これを UI 側で自動化する。

### 7.1 LoRA 周辺の前提知識

- LoRA は SD のチェックポイントに「差分」として被せる軽量モデル(数 MB〜数百 MB)
- Forge では `<lora:filename:weight>` という構文をプロンプトに埋め込むと適用される
  - 例: `<lora:my_character_v3:0.8>, <lora:anime_style_lora:0.5>`
- 各 LoRA は **特定のベースモデル**(SD1.5 / SDXL / Pony / NoobAI / Illustrious 等)で
  訓練されており、不一致のチェックポイントに被せると壊れる
- 多くの LoRA に **トリガーワード**(例: `mychar_v3`, `wearing red dress`)があり、
  プロンプトに含めないと効果が出ない
- LoRA は `webui/models/Lora/` 配下に置かれ、Forge API では `/sdapi/v1/loras` で一覧取得可

### 7.2 機能リスト

#### 7.2.1 基本(Phase 3.1)
- LoRA 一覧の取得・表示(右ペインに新タブ「LoRA」追加、または専用ドロワー)
- 各 LoRA を **カード**として表示:
  - サムネイル(Civitai 由来があればそれ、なければプレースホルダ)
  - LoRA 名・ベースモデル・推奨ウェイト範囲
  - トリガーワードのチップ群
  - 「適用」ボタンで `<lora:name:weight>` をプロンプトに挿入
- カード内に **ウェイトスライダ**(0.0〜1.5、デフォルト 0.8)、変更すると挿入済の構文も追従
- **複数 LoRA 同時適用**: 複数のカードを「アクティブ」状態にできる
- アクティブな LoRA はプロンプト内に対応する `<lora:>` 構文として常に存在することを保証
- ✕ ボタンで個別に解除(構文削除 + アクティブ解除)
- 検索ボックスでファイル名・トリガーワード・タグを横断検索
- ベースモデル不一致の LoRA は **デフォルトで隠す**(設定でオプトイン表示)

#### 7.2.2 Civitai 連携(Phase 3.1 と同時)
- LoRA ファイルの SHA-256 を計算 → `/api/v1/model-versions/by-hash/{hash}` でメタ取得
  (チェックポイントと同じフロー、`civitai-api.ts` を再利用)
- 取得したメタは `userdata/civitai/<sha>.json` にキャッシュ
- メタが取れた LoRA はサムネ・トリガーワード・推奨ウェイトを自動セット
- 取れなかった LoRA はファイル名のみで表示し、ユーザが手動でメモを付けられる

#### 7.2.3 自動提案(Phase 3.2、本機能の中核)
プロンプトを書きながら、その内容にマッチする LoRA を **複数候補** リアルタイム提示する。

- スコアリング・アルゴリズム(優先度順):
  | 順位 | 信号 | 加点 | 備考 |
  |---|---|---|---|
  | **1** | **選択中チェックポイントの Civitai サンプル画像で実際に使われている LoRA** | **+200** | **モデルが推奨する LoRA を最優先扱い**(本プロジェクト固有要件) |
  | 2 | チェックポイントとベースモデルが一致 | +100 | 不一致は -∞ で除外 |
  | 3 | LoRA の trigger word がプロンプトに含まれる | +30 / 単語 | |
  | 4 | LoRA がユーザのお気に入り(★)である | +25 | LoRA カードにも ★ を実装 |
  | 5 | 直近 30 日に同じチェックポイントで使った | +20 | |
  | 6 | 直近 30 日に類似プロンプトで使った | +15 | tf-idf コサイン類似度 0.6 以上 |
  | 7 | LoRA の Civitai タグがプロンプト中の単語と重複 | +10 / 重複 | category, style 等 |
  | — | 同じプロンプト内に既に同種(キャラ/画風)LoRA がある | -40 | 重複防止 |

- **モデル推奨 LoRA の検出方法**(信号 1):
  - Civitai のチェックポイントメタには明示的な「推奨 LoRA」フィールドが存在しないが、
    モデルバージョンの `images[]` に紐づくサンプル画像のメタデータ(`meta.prompt`)に
    `<lora:name:weight>` 形式で実際に使われた LoRA が含まれる
  - これを正規表現で抽出 → 出現頻度をカウント → 上位を「推奨 LoRA」として保存
  - `civitai-api.ts` の `fetchByHash` を拡張し、`recommendedLoras: { name, weight, frequency }[]` を
    `CivitaiRecommended` 型に追加してキャッシュ
  - LoRA 自動提案時にチェックポイント側の `recommendedLoras` と LoRA ファイル名・aliases を
    マッチして +200 を付与
- 提示 UI: プロンプトエディタ下部または右ペイン上部に **「おすすめ LoRA(N 件)」セクション**
  - スコア降順で 5〜8 件、横スクロールするコンパクトカード
  - 1 クリックで適用(構文挿入 + アクティブ化)、もう 1 クリックで解除
  - 「他の候補を見る」リンクで全件モーダル表示
- 更新タイミング: プロンプト編集が 600ms 静止した時にデバウンス再計算

#### 7.2.4 トリガーワード自動挿入
- LoRA を有効化した瞬間、その LoRA のトリガーワードがプロンプトに含まれていなければ
  確認なしでプロンプト先頭に追記(設定で挙動を「常に追加 / 確認 / 追加しない」から選択可)
- LoRA 解除時はトリガーワードも一緒に外す(他 LoRA と共有していない場合のみ)

#### 7.2.5 整理機能(Phase 3.3、優先度低)
- フォルダ階層対応(`Lora/character/`, `Lora/style/` のような分類)
- ユーザがカードを手動でカテゴリ分けできるタグ機能
- LoRA インポート(チェックポイントと同様のスプリットボタン)
- 不使用 LoRA の検出(直近 90 日使われていない)

### 7.3 実装上の注意点

- Forge API: `/sdapi/v1/loras` のレスポンス形式(name, alias, path, metadata)を確認の上、
  `forge-api.ts` に `listLoras()` を追加
- LoRA メタは Civitai に登録されていないものも多い → ファイル名のみで使えるフォールバック
  必須(現在の Civitai 連携と同じパターン)
- **プロンプト内の `<lora:...>` 構文の同期管理が肝**: アクティブな LoRA セットと
  プロンプトテキスト内の構文の整合性を、どちらが編集されても破綻させない設計が必要
  - 推奨案: `useStore` に `activeLoras: { name, weight, triggerWords[] }[]` を持ち、
    プロンプト送信時に `<lora:>` 構文を生成して合成する。プロンプトエディタには
    `<lora:>` 部分は表示しない(別 UI でのみ操作)
  - 既存の手書き `<lora:...>` がプロンプトに含まれる場合はパースしてアクティブ集合に取り込む
- 自動提案のスコア計算は LoRA 数 × プロンプト長 で軽い処理だが、
  類似プロンプト判定で履歴コサイン類似度を使うなら **embedding を持たないので tf-idf に簡略化**
  (sentence-transformers のような重い依存は避ける)

### 7.4 関連する既存資産

- `electron/civitai-api.ts` のハッシュ→メタ解決ロジックは LoRA でもそのまま使える
- `Storage` クラスに `listLoras()` / `getLoraMeta()` / `getLoraFavorites()` /
  `getLoraUsageHistory()` を追加すれば永続化は完結
- 自動提案の UI は QuickPresetBar と類似(チップ + トグル選択)、共通化検討

---

## 8. 既知の問題 / 技術的負債

### 軽度
- 履歴は最大 500 件 LRU、それ以上は古いものから削除(SQLite 移行で解決可)
- Civitai レート制限(1 IP / min)時のリトライ未実装
- ControlNet モデル一覧の動的取得は Forge 起動後に走る — 起動前にタブを開いた場合は
  「モデルが見つかりません」表示になるが、Forge ready 後に再オープンすれば解消

### 中度
- 生成中に Electron をクローズしても Forge は停止する仕組みになっているが、
  Python が VRAM 解放途中で kill されるとごく稀に GPU が掴まったまま残ることがある
- electron-builder でのインストーラ生成・コード署名は未検証(`npm run dist` 動作確認のみ要)
- i18n フェーズ 2 は主要部完了。残りは `DroppedImageInsight` / `HistoryGallery` /
  `InputImagePanel` 内部 / `LoraCard` / `PresetList` などの小〜中規模部品。

### 修正済(本セッション後半)
- **ADetailer 有効時の `IndexError: list assignment index out of range`**:
  Forge の `init_script_args` (`webui/modules/api/api.py:362`) で
  `script_args[args_from + idx] = request_args[idx]` が OOB を起こす現象。
  原因は `init_default_script_args` 段階で `script.ui()` を 2 度呼ぶ際、
  ユーザインストール拡張のいずれかが返すコンポーネント数が登録時とずれて
  slice assign が **`script_args` リストを縮める** ことで、その後の
  ADetailer(高い `args_from` を持つ)への書込みが範囲外になる。
  最初に試した「ユニット 4 個分にパディング」は逆に書込みスロット数を増やして
  失敗を悪化させた。最終的な修正は **dicts-only ペイロード**:
  ```ts
  scripts['ADetailer'] = { args: realUnits }  // [bool, bool, ...] 抜き
  ```
  ADetailer の `is_ad_enabled` は `args[0]` が dict(bool でない)場合
  `enabled=True` を自動推論する。これにより `min(args_to - args_from, len(args))`
  が単元数まで縮まり、書込みスロット数が最小限に。
  ([`src/lib/extension-payload.ts`](../src/lib/extension-payload.ts))

### 仕様上の制約
- ユーザー環境 VRAM 8GB のため、SDXL 1024² 生成時にメモリスワップが起きやすい。
  Forge の `--medvram` を `forgeExtraArgs` に追加すると安定する(設定モーダルから可能)
- ADetailer は git clone 済だが Forge 再起動が必要(Python 拡張のロード)。
  電源ボタンで Forge を一度停止 → 起動で初回 1〜2 分かかる(pip install)
- ControlNet は webui/models/ControlNet/ への .safetensors 配置が前提。
  パネル下部に空状態ヒント表示済

---

## 9. 次のロードマップ

> 詳細な期日付きロードマップは [`docs/ROADMAP.md`](ROADMAP.md) を参照。本セクションは
> 構造的概観のみ残す。

### 完了 ✅

- **Phase 2(磨き込み)**: 生成中プレビュー / 履歴 / シンタックスハイライト / ショートカットモーダル / 拡張無効化(`config.json` の `disabled_extensions` で永続化)/ VRAM 警告 ※簡易版
- **Phase 3(LoRA 中核)**: カード UI / 複数同時適用 / 自動提案(モデル推奨優先 +200) / トリガーワード自動挿入
- **Phase 4(メタデータ)**: PNG/JPEG/WebP / ラベル形式テキスト解析 / Civitai 照合 / 推奨 VAE 自動 DL
- **Phase 5(配布準備)**: `setup.bat` / `run.bat` / `update.bat` / Node.js + Forge 同梱可能な share 生成スクリプト
- **Phase 6(多言語化フェーズ 1)**: ja/en/ru/pt 切替基盤 + TitleBar / Settings / RecommendationCard 等の翻訳 + ドキュメント 4 言語化
- **Phase 7(タブ + 拡張組込)**: 4 タブ構成導入(txt2img / img2img / Upscale / Tools)+ 折りたたみ拡張パネル(Dynamic Threshold / FreeU / ADetailer / ControlNet)+ Upscale ワークフロー(Simple / Diffusion / Ultimate)+ Tools(Model Inspector)
- **Phase 8(メタデータ駆動 UX)**: Upscale 自動推奨 / ジャンル判定 / tile 自動マッチ / tile drift 対策 / txt2img→Upscale 直送 / Upscale プロンプト共有
- **i18n フェーズ 2**: PromptLibrary / ShortcutsModal / ParametersPanel / PreviewPanel / LoraPanel / MetadataInfoPanel / CivitaiSearchModal / QuickPresetBar / InputImagePanel / DroppedImageInsight / HistoryGallery / LoraCard / PresetList / SidePanel / StartupOverlay / LoRA 推奨理由
- **Phase 9A(Tile ControlNet 統合)**: Upscale Diffusion / Ultimate で Tile ControlNet を適用できる専用トグル、モデル未配置警告、Civitai Controlnet 検索導線、Forge 移動後パス更新、xinsir Tile SDXL モデル配置 + txt2img / Upscale Diffusion / Ultimate 相当 API 実生成検証
- **Phase 9B(履歴再利用導線、主要部)**: 履歴から完全再現、履歴画像のフル解像度復元、履歴→Upscale、seed/CFG/denoise バリエーション比較、候補→img2img/Upscale
- **Phase 9C(Tools 強化、初期)**: Forge カタログ健全性、Tile ControlNet 検出、ControlNet 不足時の Civitai 検索導線

### 進行中 / 次回優先 🔜

- **Phase 9A 残**: 実 UI で Upscale Diffusion / Ultimate の denoise 0.25 / 0.35 / 0.45 目視比較
- **Phase 9B 残**: 履歴フィルタ(model / LoRA / sampler / 日付) / prompt diff
- **Phase 9C 残**: Model Merger / Format Converter

### 計画 📅

- **Phase 10(編集ワークフロー)**:
  - Inpaint タブ昇格(現在は img2img 内のサブモード相当)+ マスク描画キャンバス
  - バッチ生成(`{red|blue|green}` 等のワイルドカード、行単位連続実行)
  - キャラクタープリセット(「LoRA セット + ベースプロンプト + 推奨パラメータ」を名前付き保存)

- **Phase 11(開発体験)**:
  - 生成ログのエクスポート(JSON / CSV)
  - PNG メタデータ強化(独自フィールドで適用 LoRA / プリセット名を埋込)

---

## 10. リサーチ: モデル別推奨設定の追加収集ソース

> ユーザ指示: 「モデルごとの推奨設定を更に詳細に集めたい。例えば誰かが生成した
> AI 画像から設定を検出したりとか、どんな方法が使えるかリサーチしてレポート」
>
> 現在の実装は **Civitai のサンプル画像 (version.images, 通常 5〜20 枚)** のみを
> ソースにしている(samplerのmode、steps/cfg/sizeのmedian、`<lora:>` 抽出による
> 推奨 LoRA、`meta.VAE` の最頻値による推奨 VAE)。これを **コミュニティ提供画像**
> や **ユーザ自身の使用履歴** などの追加ソースで拡充できないかを調査した。

### 11.1 ソース別評価

| ソース | データ量 | アクセス手段 | 信号品質 | 実装コスト | 法的リスク |
|---|---|---|---|---|---|
| **Civitai `/api/v1/images?modelVersionId=`** | ★★★★★ (人気モデル数千枚) | 公式 REST | ★★★★★ (構造化 meta + `meta.resources`) | 低 | なし(API 規約準拠) |
| Civitai 公式サンプル(現在使用) | ★★ (5〜20枚) | 公式 REST | ★★★★ | (実装済) | なし |
| ユーザ自身の使用履歴 | ★★★ | ローカル | ★★★★ (本人の好みを反映) | 低 | なし |
| 安全性tensors `__metadata__` | ★ (LoRA のみ詳細) | ローカル | ★★★★ (kohya_ss 学習タグ) | 中 | なし |
| 任意 PNG ドロップから抽出 | (実装済) | ローカル | ★★★★ | (実装済) | なし |
| HuggingFace モデルカード | ★ (構造化されない README のみ) | API | ★★ | 高 | なし |
| Lexica.art / Tensor.art / SeaArt | ★★★ | スクレイピング | ★★ | 高 | **規約違反の可能性大** |
| Reddit / Discord 共有画像 | ★★ | スクレイピング | ★★ | 高 | グレー |

### 11.2 採用候補の詳細

#### (A) Civitai community images API — **最有力**

エンドポイント: `GET https://civitai.com/api/v1/images?modelVersionId=<id>&limit=200`

レスポンス各画像の `meta` フィールド:
```json
{
  "prompt": "<full positive prompt>",
  "negativePrompt": "<full negative>",
  "sampler": "Euler a",
  "steps": 28,
  "cfgScale": 7,
  "Size": "1024x1024",
  "Clip skip": 2,
  "VAE": "sdxl_vae.safetensors",
  "Model": "checkpoint_name",
  "seed": 1234567,
  "Version": "ComfyUI",
  "resources": [               // ← 構造化された使用モデル一覧
    { "type": "lora", "name": "X", "weight": 0.8 },
    { "type": "vae", "name": "Y" }
  ],
  "hashes": { "model": "...", "vae": "..." }
}
```

**強み**:
- 公式サンプルの 100〜500 倍のデータ量(人気モデルなら 1000+ 枚)
- 構造化 `resources` 配列に LoRA / VAE が型付きで列挙されている
- `/api/v1/images` の `sort=Most Reactions` で「コミュニティが評価した上位の組み合わせ」を取れる
- 認証不要(NSFW モデルは API キー必要)
- ページネーション(`metadata.nextPage` カーソル)

**統計的に集計できるもの**(現在の単純 mode/median よりずっと精密):
- プロンプト中の **頻出 N-gram**(「masterpiece, best quality」のような quality booster の利用率)
- ネガティブプロンプトの **頻出フレーズ**(「lowres, bad anatomy」等の標準ネガ)
- **共起 LoRA の組み合わせ**(LoRA A と LoRA B が一緒に使われやすい等)
- **ベースモデル別のチューニング差**(SDXL系で有効な値域 vs SD1.5系)
- **解像度の二峰性**(縦長 vs 横長で用途が分かれる場合の検出)
- 信頼区間付き推奨値(中央値 ± IQR)

**実装案** ([Phase 5.1]):
1. `civitai-api.ts` に `mineCheckpointSamples(modelVersionId, opts)` を追加 — `/api/v1/images` を `limit=200, sort=Most Reactions` で呼ぶ
2. キャッシュ: `userdata/civitai/samples-<modelVersionId>.json`、TTL 14 日
3. 既存の `extractRecommendedLoras` / `extractRecommendedVae` をこの拡張サンプル集合に対しても実行
4. RecommendationCard に「コミュニティ集計 (200件)」バッジ + ホバーで「推奨値の分布」展開
5. **頻出プロンプトフレーズ** 抽出(共起頻度 30% 以上の n-gram)→ QuickPresetBar に「このモデル向け」グループとして自動生成

#### (B) ユーザ自身の使用履歴 — **中優先**

既に `userdata/lora-usage.json` で LoRA だけは使用履歴を取っている。これを **チェックポイントごとの履歴** に拡張すると:

- ユーザが「この checkpoint で実際に成功した組み合わせ」を学習可能
- スコアリング: `+30 ユーザ自身が同モデルでよく使う設定`
- プライバシー完全保護(ローカルのみ)

**実装案** ([Phase 5.2]):
1. 履歴(`userdata/history/index.json`)から checkpoint ハッシュ別に集計するヘルパーを追加
2. RecommendationCard に「あなたの履歴 (X 件)」セクションを追加(コミュニティ推奨と並列表示)
3. 食い違いがあれば視覚的に強調(「コミュニティは 28 steps 推奨ですが、あなたは普段 24 steps」)

#### (C) 任意 PNG ドロップ拡張 — **小優先**

現在は ① プレビューにドロップ → 個別の prompt/params 復元のみ。これを拡張:
- **複数ドロップ対応**: フォルダごと or 複数ファイルを同時に投入 → そのモデル用の追加サンプルとして集計に取り込む
- 例: 友人から渡された 50 枚を投入 → そのモデル向けに「ローカル参考画像」として保存 → コミュニティ集計と合算

**実装案** ([Phase 5.3]):
1. `userdata/civitai/local-samples-<sha>.json` に、ユーザがドロップした PNG メタを蓄積
2. RecommendationCard 集計ロジックでローカル参照も合算(重み付け 0.5 程度に下げる)

#### (D) safetensors `__metadata__` から学習情報抽出 — **低優先**

LoRA/checkpoint の safetensors ヘッダ JSON にある `__metadata__` 辞書には:
- `ss_dataset_dirs`: 学習に使ったデータセット名
- `ss_tag_frequency`: 学習データのタグ頻度ヒストグラム
- `modelspec.architecture`: ベースアーキテクチャ
- `ss_clip_skip`: 学習時の Clip Skip 値

特に `ss_tag_frequency` は **「この LoRA が反応しやすいタグ」** を直接示す signal で、
trigger word 自動補完よりずっと richer。ただしこの情報は kohya_ss で学習された
モデルにしか入っておらず、実装の一般性が低い。

#### (E) HuggingFace モデルカード — **見送り**

- `https://huggingface.co/api/models/<id>` で README が JSON で取れるが、prompt 例は構造化されておらず、Markdown 中の自由文を正規表現で抽出する程度しかできない
- データ量も Civitai と比べてはるかに少ない(SD コミュニティの主戦場は Civitai)
- **ROI が低いため見送り**

#### (F) 他の AI 画像プラットフォーム — **法的に見送り**

Lexica.art / Tensor.art / SeaArt 等は規約上スクレイピングを禁止しているケースが多く、
公式 API も限定的。法的・倫理的リスクのため **本プロジェクトでは採用しない**。

### 11.3 推奨実装順序

```
Phase 5.1 (大):  Civitai community images API 統合
                 → mineCheckpointSamples + 拡張集計 + 信頼区間表示

Phase 5.2 (中):  ユーザ履歴に基づく "あなたの好み" レイヤー
                 → checkpoint × 設定の頻度集計 + RecommendationCard 拡張

Phase 5.3 (小):  ローカル PNG バルクインポート
                 → フォルダドロップ対応 + ローカル参考プールへの追加

Phase 5.4 (オプション): kohya_ss `ss_tag_frequency` を LoRA 自動提案に組込
                 → +20 加点信号として scoreLoras() に追加
```

### 11.4 期待される改善効果

| 信号 | 現在 | Phase 5.1 後 | Phase 5.2 後 |
|---|---|---|---|
| サンプル数(平均) | 5-20 枚 | 100-500 枚 | + ユーザ履歴 |
| Sampler 推奨の精度 | mode (1票で決まる) | 信頼区間付き mode | + ユーザ常用 |
| LoRA 推奨の網羅性 | プロンプト regex のみ | `meta.resources` 構造化抽出 | + 共起頻度 |
| 推奨プロンプトフレーズ | なし | n-gram 集計で生成 | (同) |
| VAE 推奨 | Optional Files + サンプル meta | + コミュニティ集計 | (同) |

### 11.5 補足: PNG 抽出の能力範囲

ユーザが質問していた「誰かが生成した AI 画像から設定を検出」については、本アプリは
既に **A1111 / Forge / ComfyUI 形式の PNG メタデータを完全パース** している
([`src/lib/png-metadata.ts`](../src/lib/png-metadata.ts))。
取得できる情報:

- prompt / negative_prompt
- steps / cfg_scale / sampler / scheduler
- width / height / seed / clip_skip
- model name (+ hash)
- LoRA 構文 `<lora:name:weight>` の抽出
- VAE 名

**未対応のフォーマット**:
- Midjourney 画像 (Discord 由来、構造化メタなし)
- DALL-E / Imagen 系 (商用 API、メタを embed しない)
- ComfyUI workflow JSON 形式の埋め込み(現状は文字列として抽出するが、ノードグラフは未パース)

ComfyUI workflow JSON 対応は将来 Phase に追加候補(`workflow` チャンクを JSON
パース → 主要ノードから sampler/steps を抽出)。

---

## 11. 参考リンク(リサーチで参照した一次情報)

- [Introducing Gemini 2.5 Flash Image — Google Developers Blog](https://developers.googleblog.com/en/introducing-gemini-2-5-flash-image/)
- [Gemini 2.5 Flash Image (Nano Banana) — Google AI for Developers](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-image)
- [Nano Banana image generation — Google AI for Developers](https://ai.google.dev/gemini-api/docs/image-generation)
- [Use Gemini 2.5 Flash Image on Vertex AI — Google Cloud Blog](https://cloud.google.com/blog/products/ai-machine-learning/gemini-2-5-flash-image-on-vertex-ai)
- [Introducing Gemini 2.5 Flash Image Edit aka "nano-banana" — fal.ai blog](https://blog.fal.ai/introducing-gemini-2-5-flash-image-edit-aka-nano-banana/)
- [black-forest-labs/FLUX.1-Kontext-dev — Hugging Face](https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev)
- [ComfyUI Flux Kontext Dev Native Workflow — ComfyUI Docs](https://docs.comfy.org/tutorials/flux/flux-1-kontext-dev)
- [QwenLM/Qwen-Image — GitHub](https://github.com/QwenLM/Qwen-Image)
- [Qwen Image Edit Complete Guide — Cliprise](https://www.cliprise.app/learn/guides/model-guides/qwen-image-edit-complete-guide)
- [Model Rundown: Qwen-Image-Edit-2511 / Flux.2 — Diffusion Doodles](https://medium.com/diffusion-doodles/model-rundown-z-image-turbo-qwen-image-2512-edit-2511-flux-2-dev-fc787f5e87ad)
- [25 Prompts Test: Nano Banana vs Qwen vs Flux Kontext Pro vs SeedEdit — Wiro AI](https://wiro.ai/blog/nano-banana-vs-qwen-flux-kontext-pro-seededit/)
- [FLUX vs. Qwen Image — fal.ai learn](https://fal.ai/learn/tools/flux-vs-qwen-image)
- [The Best Open-Source Image Generation Models in 2026 — BentoML](https://www.bentoml.com/blog/a-guide-to-open-source-image-generation-models)
- [Physton/sd-webui-prompt-all-in-one — GitHub(プロンプトライブラリ素材)](https://github.com/Physton/sd-webui-prompt-all-in-one)
- [Mikubill/sd-webui-controlnet API — GitHub Wiki](https://github.com/Mikubill/sd-webui-controlnet/wiki/API)
- [lllyasviel/stable-diffusion-webui-forge — GitHub](https://github.com/lllyasviel/stable-diffusion-webui-forge)
- [lllyasviel/ControlNet-v1-1-nightly README — GitHub](https://github.com/lllyasviel/ControlNet-v1-1-nightly/blob/main/README.md)
- [lllyasviel/control_v11f1e_sd15_tile — Hugging Face](https://huggingface.co/lllyasviel/control_v11f1e_sd15_tile)
- [xinsir/controlnet-tile-sdxl-1.0 — Hugging Face](https://huggingface.co/xinsir/controlnet-tile-sdxl-1.0)
- [pkuliyi2015/multidiffusion-upscaler-for-automatic1111 — GitHub](https://github.com/pkuliyi2015/multidiffusion-upscaler-for-automatic1111)
- [Coyote-A/ultimate-upscale-for-automatic1111 — GitHub](https://github.com/Coyote-A/ultimate-upscale-for-automatic1111)
