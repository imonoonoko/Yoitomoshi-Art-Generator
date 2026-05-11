# セッション引き継ぎレポート — 2026-05-11

このセッションで実施した作業の完全なログ。次セッション(または共同開発者)が続きから着手するための引き継ぎドキュメント。

> 2026-05-11 追記: 現在の作業フォルダは `C:\宵灯工房アート\Yoitomoshi-Art-Generator`。本文中の `C:\Imagen\Yoitomoshi-Art-Generator` は旧配置または過去成果物の記録として読む。
> 2026-05-11 追記2: i18n フェーズ 2 残部と Phase 9A(Tile ControlNet 統合)は実装済み。当時の Forge 実体パスは `C:\宵灯工房アート\webui_forge_cu121_torch231`。
> 2026-05-11 追記3: `xinsir/controlnet-tile-sdxl-1.0` を `webui/models/ControlNet/xinsir-controlnet-tile-sdxl-1.0.safetensors` に配置し SHA-256 を確認。Forge API で `xinsir-controlnet-tile-sdxl-1.0 [4d6257d3]` / `tile_resample` を確認し、最小 txt2img + ControlNet payload、Upscale Diffusion 相当、Ultimate 相当の実生成に成功。履歴完全再現、履歴→Upscale、seed/CFG/denoise Variations、Tools のカタログ健全性カードも追加済み。次は実 UI での denoise 目視比較、履歴フィルタ/prompt diff、Model Merger / Format Converter。
> 2026-05-11 追記4: Electron 実 UI で Upscale タブへ `ui-upscale-test.png` を投入し、Diffusion + Tile ControlNet ON、`tile_resample`、`xinsir-controlnet-tile-sdxl-1.0 [4d6257d3]` を確認。1.5x の最小生成で `128×128→192×192` の出力表示まで確認済み。Tools の Tile catalog 表示と Variations パネル表示も実 UI で確認済み。
> 2026-05-11 追記5: 次の優先作業に、`C:\宵灯工房アート` 直下の sibling Forge フォルダを `Yoitomoshi-Art-Generator\runtime\forge` に統合する整理を追加。Electron では Gradio UI を使わず `--nowebui` API専用起動を既定に寄せる。ただし Forge/ControlNet 内部は `gradio` を import するため、Gradio依存ファイルの物理削除は行わず、旧配置・旧キャッシュ・不要なブラウザUI導線を整理対象にする。
> 2026-05-11 追記6: Forge フォルダ統合完了。`C:\宵灯工房アート` 直下は `Yoitomoshi-Art-Generator` のみ。`runtime\forge` から `--nowebui` API専用起動し、`/sdapi/v1/options` と ControlNet API が通ること、`/` が404でGradio UIが出ないことを確認。Tools に Model Health Scan を追加し、LoRA側に重複していた `pixelstyleckpt_strength07.safetensors` はCheckpoints側とSHA-256一致確認後にLoRA側を削除。実 UI の Model Health Scan は `確認事項 0`。

---

## 1. セッション概要

開始時点の状態:
- Electron + React + TS の SD フロントエンド `Yoitomoshi Art Generator` が稼働
- Forge を裏で起動し、独自 UI から txt2img / img2img / Civitai 検索 / LoRA 管理ができる状態
- i18n は未着手、UI は日本語のみ
- 拡張機能(ControlNet / ADetailer 等)は Forge UI 経由でのみ操作可能
- メタデータ抽出 / Civitai 照合は実装済

セッション中に実装した主要マイルストーン:

| Phase | 内容 |
|---|---|
| **Phase 5** | 配布パッケージ生成(`share/` フォルダ + Node.js + Forge 同梱、setup.bat/run.bat/update.bat) |
| **Phase 6** | 多言語化フェーズ 1(ja / en / ru / pt 切替基盤)|
| **Phase 7** | タブ構成導入 + 拡張機能の native UI 移植(4 拡張)+ Upscale + Tools |
| **Phase 8** | メタデータ駆動 UX(Upscale 自動推奨、ジャンル判定、tile 自動マッチ)|
| **i18n フェーズ 2** | 主要コンポーネント 8 ファイルの完全翻訳 |
| **複数のバグ修正** | ADetailer IndexError、tile drift、Upscale fallback、closure stale 等 |

---

## 2. 完了したフェーズ詳細

### Phase 5 — 配布パッケージ

**目的**: 共同開発者に渡せる ZIP 形式の配布物を生成

**成果物**:
- `C:\Imagen\Yoitomoshi-Art-Generator-share\` (フォルダ)
- `C:\Imagen\Yoitomoshi-Art-Generator-share.zip` (ZIP)
- 約 3.46GB(Forge + Node.js 同梱)、AI モデル除外

**含まれるもの**:
```
share/
├── setup.bat            ← 初回セットアップ(npm install + build)
├── run.bat              ← 起動(セットアップ後)
├── update.bat           ← app/ 差し替え後の再ビルド
├── はじめに.txt          ← 日本語スタートガイド
├── start.{en,ru,pt}.txt ← 多言語スタートガイド
├── README.md / .{en,ru,pt}.md
├── runtime/
│   ├── node/            ← Node.js v22.22.2 portable (95 MB)
│   └── forge/           ← Forge クローン(~7.8GB、モデル除く)
└── app/                 ← Yoitomoshi 本体(node_modules / out / userdata 除外)
```

**重要な設計**:
- `run.bat` は起動時に `app/userdata/settings.json` の `forgePath` が壊れていれば PowerShell で再生成(フォルダ移動対応)
- `setup.bat` は初回のみ、forgePath を `runtime/forge/` の絶対パスに自動設定
- userdata は app/ 配下に残るため、共同開発者の設定は次回更新でも保持

### Phase 6 — 多言語化フェーズ 1(基盤 + 主要 UI)

**新規ファイル**: [`src/lib/i18n.ts`](../src/lib/i18n.ts)

**設計**:
- 4 言語辞書を 1 ファイルに集約(ja / en / ru / pt)
- `useT()` フック(JSX 用、言語切替で再描画)
- `t()`(非フック、イベントハンドラ用、closure stale 回避)
- パラメータ補間: `{name}` 形式
- フォールバック: 要求言語 → ja → 生キー
- `UiLanguage` 型を `src/shared/types.ts` に定義

**翻訳済(Phase 6 時点)**:
- TitleBar / SettingsModal(言語セレクタ追加)/ StatusDot / BrokenExtensionsButton / MainTabs
- App.tsx の主要トースト
- PromptPanel の主要ラベル
- InputImagePanel の EmptyState
- RecommendationCard 完全
- TabPlaceholder

**ドキュメント多言語化**:
- `README.md` + `README.{en,ru,pt}.md`
- `はじめに.txt` + `start.{en,ru,pt}.txt`(share 用)

### Phase 7 — タブ + 拡張組込

#### 7.0a タブ構成

**設計目標**: 機能が増えても **トップレベル 4 タブ固定**。新機能はタブ内の折りたたみパネルで増やす。

```
[ txt2img ] [ img2img ] [ Upscale ] [ Tools ]
```

**実装**:
- [`src/components/MainTabs.tsx`](../src/components/MainTabs.tsx) — Radix を使わずカスタム実装(レイアウト自由度のため)
- store に `currentTab: WorkspaceTab` 追加
- App.tsx でタブ別レイアウト切替
- 画像ペースト時に img2img タブへ自動切替

#### 7.1a〜d 拡張パネル(PromptPanel 内、折りたたみ式)

| パネル | ファイル | 引数構造 | 注意点 |
|---|---|---|---|
| Dynamic Thresholding | [`extensions/DynamicThresholdingPanel.tsx`](../src/components/extensions/DynamicThresholdingPanel.tsx) | 12 個 positional | `alwayson_scripts['DynamicThresholding (CFG-Fix) Integrated']` |
| FreeU | [`FreeUPanel.tsx`](../src/components/extensions/FreeUPanel.tsx) | 7 個 positional | `'FreeU Integrated (SD 1.x, SD 2.x, SDXL)'` |
| ADetailer | [`ADetailerPanel.tsx`](../src/components/extensions/ADetailerPanel.tsx) | **dicts-only**(後述) | 最大 4 ユニット、YOLO-world + `ad_model_classes` 対応 |
| ControlNet | [`ControlNetPanel.tsx`](../src/components/extensions/ControlNetPanel.tsx) | 単体 dict 配列 | 最大 3 ユニット、画像 D&D、動的モデル取得 |

**共通基盤**:
- [`CollapsiblePanel.tsx`](../src/components/CollapsiblePanel.tsx) — header に enabled トグル + 折りたたみ
- [`extensions/controls.tsx`](../src/components/extensions/controls.tsx) — Slider / SelectField 共通
- [`lib/extension-payload.ts`](../src/lib/extension-payload.ts) — `alwayson_scripts` を一元生成

**ADetailer のクローン**:
```bash
cd webui_forge_cu121_torch231/webui/extensions/
git clone https://github.com/Bing-su/adetailer.git
```

**ControlNet モデル**: ユーザー側で `webui/models/ControlNet/` に配置必要(空状態は UI で警告表示)

#### 7.2 Upscale ワークスペース

[`src/components/UpscaleWorkspace.tsx`](../src/components/UpscaleWorkspace.tsx) — 専用タブ。

**3 メソッド**:

| メソッド | API ルート | 速度 | 詳細追加 |
|---|---|---|---|
| **Simple** | `/sdapi/v1/extra-single-image` | 高速 | なし(upscaler のみ) |
| **Diffusion** | `img2img + alwayson_scripts['MultiDiffusion Integrated']` | 低速 | 多 |
| **Ultimate** | `img2img + script_name='Ultimate SD upscale'` | 中 | 中 |

**Ultimate の `script_args`**: 18 個 positional(`scripts/ultimate-upscale.py:520` の `ui()` 戻り値順と完全一致 — IMPORTANT)

**Ultimate のクローン**:
```bash
cd webui_forge_cu121_torch231/webui/extensions/
git clone https://github.com/Coyote-A/ultimate-upscale-for-automatic1111.git
```

**Forge API 拡張**(electron/forge-api.ts):
- `listUpscalers()` → `/sdapi/v1/upscalers`
- `extraSingleImage(opts)` → `/sdapi/v1/extra-single-image`

#### 7.3 Tools タブ

[`src/components/ToolsWorkspace.tsx`](../src/components/ToolsWorkspace.tsx)

**実装済**: Model Inspector — `.safetensors` ヘッダ読取 → 種別 / サイズ / 先頭テンソルキー / 埋込メタデータ表示。Forge 不要(ローカル完結)。

**プレースホルダ**: Model Merger / Format Converter(Phase 9 候補)

### Phase 8 — メタデータ駆動 UX

#### Upscale 推奨提案

[`src/lib/upscale-suggest.ts`](../src/lib/upscale-suggest.ts) — ヒューリスティック分析。

**判定パイプライン**:
1. **ジャンル判定** — prompt + modelName を正規表現で照合(anime / photo / unknown)
2. **解像度ティア** — small (<768²) / medium / large (>1280²)
3. **メソッド選択** — small=simple, known genre+medium-large=ultimate, unknown=diffusion
4. **Upscaler 選択** — anime → "Anime" 含む / photo → 通常 R-ESRGAN / unknown → 汎用
5. **タイル寸法** — **入力画像の寸法に 64px グリッドスナップ + 1024 上限**(seam 抑制 + VRAM 安全圏)
6. **denoise** — 安全側に振った 0.20-0.25(キャラ drift 防止)

**UI**: 紫色バナーで推奨表示、ジャンル切替トグル(自動 / アニメ / リアル)、ワンクリック適用。

#### Tile drift 抑制(重要バグ修正)

ユーザーが「上下で違うキャラ」が出る現象を報告 → コミュニティのベストプラクティスを調査して既定値を全面見直し:

| 項目 | Before → After | 効果 |
|---|---|---|
| denoise 既定 | 0.40 → **0.25** | drift の主因解消 |
| diffusionMethod | MultiDiffusion → **Mixture of Diffusers** | latent 平均化で seam 消失 |
| tileOverlap | 64 → **96** | 境界ブレンド範囲拡大 |
| ultimateMaskBlur | 8 → **16** | seam ぼかし強化 |
| ultimatePadding | 32 → **64** | コンテキスト窓拡大 |
| ultimateRedrawMode | Linear → **Chess** | グリッド模様破り |
| `ultimateSeamsFixType`(NEW) | 0 (None) → **3 (Half tile offset pass + intersections)** | seam 2 重消し |

#### txt2img → Upscale 直送ボタン

PreviewPanel に `Maximize2` アイコン追加。`lastImage` を `upscale.inputImage` にコピー → Upscale タブへ自動切替。

#### Upscale タブのプロンプト欄

[`UpscaleWorkspace.tsx`](../src/components/UpscaleWorkspace.tsx) 左パネル(推奨バナーの直下)に PromptEditor 2 つ追加(Positive + Negative)。**メインストアと共有** — txt2img タブと双方向同期。

### i18n フェーズ 2(主要コンポーネント完全翻訳)

| ファイル | 文字列数 | 状態 |
|---|---|---|
| PromptLibrary.tsx | 58 | ✅ |
| ShortcutsModal.tsx | 22 | ✅ |
| ParametersPanel.tsx | 24 | ✅ |
| PreviewPanel.tsx | 19 | ✅ |
| LoraPanel.tsx | 26 | ✅ |
| MetadataInfoPanel.tsx | 41 | ✅ |
| CivitaiSearchModal.tsx | 36 | ✅ |
| QuickPresetBar.tsx | 17 | ✅ |
| **合計** | **~243 文字列 × 4 言語 = ~970 翻訳** | |

i18n キー命名:
- `pl.*` PromptLibrary
- `qp.*` QuickPresetBar
- `cs.*` CivitaiSearchModal
- `mp.*` MetadataInfoPanel
- `lp.*` LoraPanel
- `params.*` ParametersPanel
- `preview.*` PreviewPanel
- `shortcuts.*` ShortcutsModal
- `upscale.*` UpscaleWorkspace
- `cn.*` ControlNet
- `ad.*` ADetailer
- `dt.*` DynamicThresholding
- `freeu.*` FreeU
- `tools.*` Tools tab
- `tab.*` MainTabs
- `rec.*` RecommendationCard
- `ext.*` BrokenExtensionsButton
- `forge.*` StatusDot 等
- `titlebar.*` TitleBar
- `settings.*` SettingsModal
- `prompt.*` 主要ラベル
- `generate.*` 生成ボタン関連
- `toast.*` 共通トースト
- `common.*` 共通(キャンセル / 保存等)
- `inputImage.*` InputImagePanel

---

## 3. 重大なバグ修正(根本原因 + 修正)

### A. ADetailer 有効時の `IndexError: list assignment index out of range`

**症状**: ADetailer を有効にして生成 → 500 エラー、`{"error":"IndexError","message":"list assignment index out of range"}`

**原因**: Forge の `webui/modules/api/api.py:362` の `init_script_args` 内、`script_args[args_from + idx] = request_args[idx]` で OOB。`init_default_script_args` 段階で他のユーザー拡張(Config-Presets が culprit 候補)が `script.ui()` を 2 度呼ぶ際、コンポーネント数の不一致で slice assign が `script_args` リストを縮め、ADetailer(高い `args_from`)への書込みが範囲外になる。

**修正**(`src/lib/extension-payload.ts`): **dicts-only ペイロード** — 先頭の `[bool, bool]` を省く。
```ts
scripts['ADetailer'] = { args: realUnits }  // [bool, bool, ...] 抜き
```
ADetailer の `is_ad_enabled` は `args[0]` が dict(bool でない)場合 `enabled=True` を自動推論。書込みスロット数が単元数まで縮まり、shrink 点を踏まずに済む。

### B. アップスケール「即完了 + 画質低下」

**症状**: Simple モードで実行 → 一瞬で完了、結果が input より低品質

**原因**: 既定値 `upscaler: 'R-ESRGAN 4x+'` がユーザー環境のインストール一覧と完全一致しない → Forge は黙って `None` にフォールバック → 線形ストレッチのみ実行

**修正**:
1. `App.tsx` で `listUpscalers` の結果と現在選択を照合 → 不一致なら最初の non-trivial(None/Lanczos/Nearest 以外)に自動切替
2. UI で None/Lanczos/Nearest 選択時に黄色警告表示
3. `extra-single-image` の `show_extras_results: true` を明示
4. 結果プレビューに `DimensionsCompare` 追加(入力 → 出力 + 倍率を表示、倍率 ≤1.0 なら警告色)
5. Simple パスで `r.image` が空なら明示的にエラー

### C. Tile drift(タイル間で別キャラ)

**症状**: Diffusion / Ultimate モードで上下にキャラが分裂

**原因**: 各タイルが独立に diffusion → 各々が完結した「1girl」を生成 → 文脈不一致

**修正**: 既定値全面見直し(上記 Phase 8 表)。最大効果の組合せ:
- Mixture of Diffusers(latent 平均化)
- denoise 0.25
- Ultimate なら Half tile offset pass + intersections + Chess redraw

**未対応(Phase 9 候補)**: Tile ControlNet 統合(根本解決)。

### D. Tile 寸法自動マッチが片方しか反映されない

**症状**: 推奨を `method='ultimate'` で適用 → Ultimate 側のタイル寸法は更新、Diffusion 側は既定値 768×768 のまま

**修正**(`upscale-suggest.ts:applyUpscaleSuggestion`): **両モードのタイルを同時更新**。メソッド切替後もマッチが保持される。

### E. 拡張機能の `*.disabled` フォルダがロードされる

**症状**: `sdweb-easy-prompt-selector.disabled/` という名のフォルダが Forge に依然ロードされ毎回エラーログ

**原因**: Forge `extensions.py:278` は `extension_dirname not in disabled_extensions` で判定。フォルダ名そのものが鍵。`.disabled` リネームだけでは無効化されない。

**修正**: `forgeDisableExtension` IPC ハンドラを刷新。フォルダを canonical にリネーム + `webui/config.json` の `disabled_extensions` 配列に追加。Forge 再起動で反映。

### F. i18n closure stale on language switch

**症状**: 言語切替後、ハンドラ内のトーストメッセージが旧言語のまま

**原因**: `useEffect` 内で `t = useT()` を使うと初期言語の closure を保持。

**修正**: ハンドラ / async / event listener では非フック版 `t as tStatic` を使う。`tStatic` は呼出時にストアから現在言語を読むので常に最新。

---

## 4. ロードマップの最新状態

### 完了 ✅

- Phase 1-4(初期スコープ): scaffold / 生成 / Civitai / LoRA / メタデータ
- Phase 5(配布): setup/run/update bat、Node + Forge 同梱
- Phase 6(i18n フェーズ 1): 基盤 + 主要 UI
- **Phase 7(本セッション完了)**: タブ + 4 拡張 + Upscale + Tools
  - 7.0a タブ枠組み
  - 7.1a-d Dynamic Threshold / FreeU / ADetailer / ControlNet
  - 7.2 Upscale ワークスペース
  - 7.3 Tools(Model Inspector)
  - 7.4 i18n
  - 7.5 ADetailer 修正
  - 7.6 ADetailer 左右の手(YOLO-world)
  - 7.7 Upscale 修正(自動補正 / 警告 / DimensionsCompare)
  - 7.8 Ultimate SD upscale 統合
- **Phase 8(本セッション完了)**: メタデータ駆動推奨 + tile drift 全面対策 + 直送ボタン + Upscale プロンプト欄
- **i18n フェーズ 2 主要部(本セッション完了)**: 8 ファイル、約 970 翻訳

### 次セッション優先 🔜

**i18n フェーズ 2 残り**(~150 文字列 × 3 言語):
- InputImagePanel 残り(タグ抽出ボタン等、16 文字列)
- DroppedImageInsight(12)
- HistoryGallery(12)
- RecommendationCard 残り(主要部完了済、12 文字列)
- SidePanel / StartupOverlay / NumberField / LoraCard 等(各小規模)

### Phase 9(計画)

メタデータ駆動の派生機能 + 大物拡張:

| 項目 | 工数 | 備考 |
|---|---|---|
| **Tile ControlNet 統合** | 中〜大 | Drift 根本解決。`controlnet-tile-sdxl-1.0.safetensors` 配置 + Upscale で自動適用トグル |
| 履歴アイテムから完全再生成 | 小 | 履歴右クリック → モデル/LoRA/VAE/prompt/seed/size 全部復元 |
| バリエーション生成 | 小〜中 | seed ±N でグリッド生成 |
| 画像ドロップ時の不足 LoRA 自動 DL | 小 | Civitai 検索 + DL ボタン自動表示 |
| モデル自動切替提案 on drop | 小 | ドロップ画像のモデルが local にあれば確認 |
| 履歴フィルタ強化 | 中 | model / LoRA / sampler / 日付 |
| プロンプト diff | 中 | 履歴 2 件選択比較 |
| openpose-editor 統合 | 中 | Canvas ベースのポーズ編集モーダル |
| Tools: Model Merger | 大 | Python 連携 or TS 移植 |
| Tools: Format Converter | 中 | .ckpt ↔ .safetensors / LoRA 抽出 |

### Phase 10(編集ワークフロー、計画)

- Inpaint タブ昇格 + マスク描画キャンバス
- バッチ生成(ワイルドカード `{red|blue|green}`)
- キャラクタープリセット(LoRA セット + base prompt の保存)

### Phase 11(開発体験、計画)

- 生成ログ JSON/CSV エクスポート
- PNG 独自メタデータフィールド埋込
- VRAM 使用量モニタ

### 保留 ⏸ / 見送り ❌

- ComfyUI PNG メタデータ対応(需要待ち)
- Mac/Linux 対応(需要待ち)
- SQLite 履歴移行(500 件超で必要になったら)
- 自然言語編集(VRAM 制約で見送り)
- Forge Gradio UI iframe(自前 UI 方針と矛盾)
- 重複機能(infinite-image-browsing / civitai-shortcut)— 既存機能で代替済

---

## 5. 重要なアーキテクチャ判断

### 1) タブを増やさない設計

新機能は **タブ内の折りたたみパネル** として追加。トップレベルは 4 タブで永久固定。

理由: タブが増えると認知負荷が高まる + どのタブか覚える負担。折りたたみなら必要な時だけ展開、デフォルト全閉で空間効率が良い。

### 2) 拡張機能は「Forge install + native UI」

Forge 拡張をそのまま Gradio UI で使うのではなく、**alwayson_scripts API 経由** + 我々の React UI で操作。`extension-payload.ts` が一元的にペイロードを生成。

利点:
- UI を統一できる(Gradio UI 開かなくて済む)
- 引数構造を完全制御できる(ADetailer の dicts-only fix のような対処が可能)

欠点:
- Forge スクリプトの `ui()` 戻り値順序を完全に追従する必要(壊れたら検出困難)
- スクリプト側のバージョンアップで args 順が変わると壊れる(現状 ADetailer 26.2.0 / Ultimate 主要版で動作確認済)

### 3) i18n は in-house(`react-i18next` 不採用)

`react-i18next` などの巨大ライブラリは入れず、独自の useT() / t() で済ませる。

理由: 4 言語 × ~250 キー = 1000 翻訳。これに 200KB の依存を入れる正当性が薄い。文字列補間と言語切替再描画があれば足りる。

### 4) メタデータ駆動の推奨は確率的、ユーザー上書きは確定

ジャンル判定の正規表現は当然完璧ではない(ユーザーの prompt が日本語タグ多めだと miss する)。なので **手動上書きトグル** を必ず提供。「自動 / アニメ / リアル」の 3 ボタン。

### 5) Upscale プロンプトはメインストアと共有

Upscale タブのプロンプト欄は **独立した state を持たず**、`useStore.prompt` / `negativePrompt` をそのまま編集。txt2img タブと双方向同期。

理由: 別 state にすると「どのタブのプロンプトを編集してるか」を意識する必要が出る。共有なら混乱なし。Upscale 用に微調整したいケースも、編集後 txt2img に戻れば同じ値。

---

## 6. 既知の問題 / 技術的負債

### 軽度

- **i18n フェーズ 2 は完了済み**: PromptLibrary / CivitaiSearchModal に加え、InputImagePanel / DroppedImageInsight / HistoryGallery / LoraCard / PresetList / SidePanel / StartupOverlay / LoRA 推奨理由まで翻訳済み。
- **dev サーバが時々勝手に死ぬ**: `npm run dev` を放置していると数時間で Vite が落ちることがあった。原因不明、再起動で復旧。
- **Electron キャッシュロックエラー**: 二重起動防止と終了時 Forge 停止を実装済み。再発時は残プロセス確認から入る。

### 中度

- **Tile ControlNet 統合済み**: xinsir Tile SDXL モデル配置、txt2img / Upscale Diffusion / Ultimate 相当の API 実生成まで確認済み。残りは実 UI での denoise 目視比較。
- **history は最大 500 件 LRU**: SQLite 移行が将来必要かも。
- **Civitai レート制限のリトライ未実装**: 1 IP / min を超えた時の対応は単に失敗を表示するのみ。

### 重要なバグ修正履歴(再発防止メモ)

- **ADetailer payload は dicts-only 形式を維持**: `[bool, bool, ...]` を先頭に付けると IndexError 再発の可能性。
- **Upscale の既定 `denoise=0.25`**: 0.40 に戻すと tile drift が再発。
- **Ultimate の `seamsFixType` は既定 3**: 0 (None) にすると seam が露呈。

---

## 7. 次セッションの始め方(チェックリスト)

```bash
# 1. 状態確認
cd C:\宵灯工房アート\Yoitomoshi-Art-Generator
git status   # (リポジトリでは無いので git は使えないが、ファイル状態だけ確認)
npm run typecheck   # クリーンであることを確認

# 2. dev サーバ起動
# 既存 Electron が残っていたら先に終了
taskkill //F //IM electron.exe 2>nul
npm run dev

# 3. Forge 起動完了まで待つ(初回 1-2 分、ADetailer 等の依存解決)
# ログで `Running on local URL` を確認

# 4. ロードマップ確認
# docs/ROADMAP.md
# docs/SESSION_HANDOFF_2026-05-11.md(このファイル)
```

**実機で確認しておくとよい動作**(セッション再開時の sanity check):

1. ⚙ → 表示言語 → en / ru / pt に切替 → 翻訳済 UI が変わることを確認
2. txt2img タブ → 任意モデルで生成 → プレビュー下の `Maximize2` クリック → Upscale タブへ送信
3. Upscale タブで紫色推奨バナー → ジャンルトグル切替 → 推奨が変わる
4. 推奨適用 → tile 寸法が入力画像に合っていることを確認(例: 768×1024 入力 → tile 768×1024)
5. Diffusion / Ultimate モードで実行 → 上下で同じキャラが保たれていることを確認(drift なし)
6. ADetailer タブ → ユニット 1 の model を `face_yolov8n.pt` → 生成 → 顔が再描画されることを確認

---

## 8. ファイル変更サマリ

### 新規追加(本セッション)

```
src/lib/i18n.ts                                ← i18n 基盤(~1700 行、全 4 言語辞書)
src/lib/upscale-suggest.ts                     ← 推奨アップスケール提案ロジック
src/lib/extension-payload.ts                   ← alwayson_scripts ビルダー
src/components/MainTabs.tsx                    ← 4 タブ
src/components/UpscaleWorkspace.tsx            ← Upscale タブ
src/components/ToolsWorkspace.tsx              ← Tools タブ
src/components/CollapsiblePanel.tsx            ← 折りたたみパネル基盤
src/components/extensions/controls.tsx          ← Slider / SelectField 共通
src/components/extensions/DynamicThresholdingPanel.tsx
src/components/extensions/FreeUPanel.tsx
src/components/extensions/ADetailerPanel.tsx
src/components/extensions/ControlNetPanel.tsx
docs/ROADMAP.md                                 ← 簡潔ロードマップ
docs/SESSION_HANDOFF_2026-05-11.md              ← 本ファイル
README.{en,ru,pt}.md                            ← README 多言語版
share/start.{en,ru,pt}.txt                      ← 配布用スタートガイド多言語
```

### 主要な変更

```
src/App.tsx                  ← MainTabs / UpscaleWorkspace / ToolsWorkspace 統合、各種 IPC 呼出
src/lib/store.ts             ← currentTab、dynThres / freeu / adetailer / controlnet / upscale 状態
src/components/PromptPanel.tsx       ← 拡張パネル統合、Upscale send button、i18n
src/components/PreviewPanel.tsx      ← Upscale 直送ボタン(Maximize2)、i18n
src/components/SettingsModal.tsx     ← 言語セレクタ
src/components/TitleBar.tsx          ← i18n
src/components/StatusDot.tsx         ← i18n(t を引数受取)
src/components/RecommendationCard.tsx ← 完全 i18n
src/components/PromptLibrary.tsx     ← 完全 i18n
src/components/ParametersPanel.tsx   ← 完全 i18n
src/components/CivitaiSearchModal.tsx ← 完全 i18n
src/components/MetadataInfoPanel.tsx ← 完全 i18n
src/components/LoraPanel.tsx         ← 完全 i18n
src/components/ShortcutsModal.tsx    ← 完全 i18n + 構造再編
src/components/QuickPresetBar.tsx    ← 完全 i18n
src/components/InputImagePanel.tsx   ← EmptyState / drop hint i18n、ファイル D&D サポート
src/shared/types.ts                  ← UiLanguage / AlwaysOnScripts / script_name|args
src/shared/ipc-channels.ts           ← Upscale / Tools / ControlNet 用 IPC channel
electron/preload.ts                  ← Upscale / Tools / ControlNet API
electron/forge-api.ts                ← listUpscalers / extraSingleImage / listControlnetModels|Modules
electron/ipc-handlers.ts             ← 同
docs/PROJECT_REPORT.md               ← Phase 7 / 8 詳細追記
README.md                            ← 多言語スイッチャ、Quick Start 再構成
```

---

## 9. ロードマップ Phase 9 の最優先タスク(次セッション推奨スタート)

### Tile ControlNet 統合

**目的**: tile drift の **根本解決**。各タイルが入力画像の対応領域でコンディショニングされ、コンテンツ不一致が消える。

**実装範囲**:
1. ControlNet タブで「Tile」モード追加(既存 ControlNet パネルを Upscale 専用に拡張)
2. Upscale タブの method に「Tile ControlNet + diffusion」を追加 or 既存 Diffusion / Ultimate で自動適用するトグル
3. `webui/models/ControlNet/` に `controlnet-tile-sdxl-1.0.safetensors` 等が無い場合の Civitai DL 誘導
4. Tile ControlNet を有効にした時、`alwayson_scripts['ControlNet']` に Tile ユニットを自動追加(各タイルに同じ ControlNet weight で適用される)

**期待効果**: drift がほぼ完全消失。denoise を 0.40 以上に上げてもキャラ崩壊しなくなる。

### i18n フェーズ 2 残部

機械的作業。InputImagePanel 内部 → DroppedImageInsight → HistoryGallery → RecommendationCard 残り → 細かい部品 で進める。各ファイル 30 分程度。

---

## 10. 連絡 / メタ情報

- 開発機: Windows 10/11、RTX 4060 Ti 8GB
- Forge: f2.0.1v1.10.1-previous-669-gdfdcbab6
- Node.js: v22.x(同梱版 v22.22.2)
- ADetailer: v26.2.0
- Ultimate SD upscale: 最新 main
- ベース言語: 日本語(他言語は補助的、メンテナンス時は ja を真とする)

このレポートは [`docs/SESSION_HANDOFF_2026-05-11.md`](SESSION_HANDOFF_2026-05-11.md) として保存済み。
