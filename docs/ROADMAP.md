# Yoitomoshi Art Generator — ロードマップ

最終更新: 2026-05-13

現在の作業フォルダ: `C:\宵灯工房アート\Yoitomoshi-Art-Generator`

このロードマップは、以下のドキュメントを読み合わせて更新した現在の優先順位表。

- [`SESSION_HANDOFF_2026-05-11.md`](SESSION_HANDOFF_2026-05-11.md): 最新の実装ログ。Phase 8 と i18n フェーズ 2 の進捗はこれを正とする。
- [`PROJECT_REPORT.md`](PROJECT_REPORT.md): 設計思想、技術選定、調査ログの長期保管場所。一部の Phase 記述は古い。
- [`NEXT_ACTION_REPORT_2026-05-12.html`](NEXT_ACTION_REPORT_2026-05-12.html): 次にやる作業を優先度順に整理した運用レポート。
- [`PROJECT_STRUCTURE.md`](PROJECT_STRUCTURE.md): GitHub に載せる範囲、`runtime/`、`userdata/`、Electron profile、将来の model-library/download/workspace 領域の整理ルール。
- [`../README.md`](../README.md) / `README.{en,ru,pt}.md` / `はじめに.txt`: 利用者向けの起動・運用説明。

---

## 現在の判断基準

- トップレベルタブは `txt2img / img2img / Upscale / Tools` の 4 つを維持する。新機能は既存タブ内の折りたたみパネルやモーダルで増やす。
- Forge 拡張は Gradio UI を埋め込まず、Forge 側に拡張を入れて `alwayson_scripts` または `script_name/script_args` を React UI から操作する。
- `C:\宵灯工房アート` 直下の sibling 構成は解消し、Forge は `Yoitomoshi-Art-Generator\runtime\forge` に統合する。Electron 利用では Gradio UI を開かず、Forge は `--nowebui` API 専用起動を既定にする。ただし Forge/ControlNet 内部が `gradio` Python パッケージを import するため、依存ファイルの物理削除は検証済みの不要物だけに限定する。
- Stability Matrix は `LykosAI/StabilityMatrix` を機能調査ソースとして扱う。採用するのは「モデル管理 / ダウンロード管理 / package launcher / workspace保存」の考え方で、AGPL-3.0 のソースコードやUI資産はコピーしない。
- PixAI は機能調査ソースとして扱う。採用するのは「自然文からの生成補助 / Note相当の設定テンプレート / モデル・LoRAマーケット導線 / Variation・Use as Base Image・Enhance / Composition・OpenPose系の視覚編集」の考え方で、サービス固有UIや商用導線はコピーしない。
- `src/lib/extension-payload.ts` は壊れやすい中核。ADetailer は dicts-only 形式を維持し、Ultimate SD upscale は 18 個の `script_args` 順を変更しない。
- i18n は `src/lib/i18n.ts` の独自辞書を継続する。`react-i18next` のような大型依存は入れない。
- 8GB VRAM 前提で、既定値は安定優先に寄せる。Upscale の `denoise=0.25`、Ultimate の `seamsFixType=3` は戻さない。
- `userdata/` はポータブルなユーザーデータ領域。履歴・設定・Civitai キャッシュを壊す変更は避ける。
- 起動時ロードと全体軽量化は継続的な横断テーマとして扱う。初期画面の描画をForge起動・モデル一覧・Civitai集計・重いToolsスキャンから切り離し、必要になった時だけ非同期ロードする。

---

## 完了済み

| Phase | 状態 | 内容 |
|---|---:|---|
| Phase 1 | ✅ | scaffold / Forge 自動起動 / txt2img / モデル選択 / Civitai 推奨 / プロンプトライブラリ / 履歴 / プリセット |
| Phase 1.5 | ✅ | サブカテゴリ複数トグル / お気に入り / クイックプリセット / トークンカウンター / ショートカット / モデル取込 |
| Phase 1.6 | ✅ | img2img / D&D + クリップボード / deepdanbooru タグ抽出 / 結果を入力へ戻す連続編集 |
| Phase 2 | ✅ | 生成中プレビュー / 履歴検索 / プロンプト編集補助 / ショートカットモーダル / 拡張無効化 |
| Phase 3 | ✅ | LoRA カード UI / 複数 LoRA / 自動提案 / トリガーワード自動挿入 |
| Phase 4 | ✅ | PNG/JPEG/WebP メタデータ抽出 / ラベル形式テキスト解析 / Civitai 照合 / 推奨 VAE 自動 DL |
| Phase 5 | ✅ | `setup.bat` / `run.bat` / `update.bat` / Node.js + Forge 同梱 share フォルダ |
| Phase 6 | ✅ | i18n 基盤 / ja,en,ru,pt 切替 / 主要 UI と README 多言語化 |
| Phase 7 | ✅ | 4 タブ構成 / Dynamic Thresholding / FreeU / ADetailer / ControlNet / Upscale / Tools(Model Inspector) |
| Phase 8 | ✅ | メタデータ駆動 Upscale 推奨 / tile drift 対策 / txt2img から Upscale 直送 / Upscale プロンプト欄 |
| i18n フェーズ 2 主要部 | ✅ | PromptLibrary / ShortcutsModal / ParametersPanel / PreviewPanel / LoraPanel / MetadataInfoPanel / CivitaiSearchModal / QuickPresetBar |
| i18n フェーズ 2 残部 | ✅ | InputImagePanel / DroppedImageInsight / HistoryGallery / LoraCard / PresetList / SidePanel / StartupOverlay / LoRA 推奨理由 |
| Phase 9A | ✅ API+実UI検証済み / 目視比較残 | Upscale Diffusion / Ultimate の Tile ControlNet 専用トグル、payload 統合、Civitai DL 導線、xinsir Tile SDXL モデル配置 |
| Phase 9B | ✅ 主要導線実装 / 残あり | 履歴から完全再現、履歴→Upscale、seed/CFG/denoise バリエーション生成 |
| P0.5 | ✅ | Forge フォルダを `runtime\forge` に統合 / `--nowebui` API専用起動 / モデル健全性スキャン |
| P0.7 | ✅ | IPC入力検証 / 外部URL allowlist / file path境界 / 生成payload範囲検証 / BOM付きsettings起動復旧 |
| Phase 9E 初期 | ✅ | Stability Matrix参考の Model Library index / DownloadJob manifest / `.partial` HTTP Range再開 / Tools表示 |
| Phase 9E-2 | ✅ 主要部 / 残あり | DownloadJob再開/破棄/保存先UI、manifest normalize、Civitai metadata/preview保存、Hugging Face検索 |
| 運用整備 | ✅ | デスクトップ起動ショートカット更新 / 毎回最新ビルド起動 / Electron 終了時 Forge 停止 / 二重起動防止 / stale pid cleanup |
| P0.8 | 🟡 新規 | 起動時ロード高速化 / 初期描画軽量化 / 遅延ロード / 不要スキャン抑制 / バンドル分割 |

---

## 次に進める順序

### 現在の優先度(2026-05-12 実装後)

1. **実素材QA — ControlNet入力生成**
   - 画像ドロップ、preprocessor実行、結果プレビュー、ControlNet Unit 1反映は実装済み。
   - 2026-05-12 QAで `tile_resample` / `openpose_full` / `lineart_standard (from white bg & black line)` / `depth_midas` の `/controlnet/detect` 実行はPASS。証跡: [`QA_CONTROLNET_2026-05-12.md`](QA_CONTROLNET_2026-05-12.md)。
   - 2026-05-12 UI QAで画像ドロップ、Depth preprocessor実行、経過秒表示、結果プレビュー、Unit 1反映をPASS。証跡: [`QA_CONTROLNET_UI_2026-05-12.md`](QA_CONTROLNET_UI_2026-05-12.md)。
   - UI QA中に `depth_anything` が150秒超で戻らないケースを確認したため、標準Depthは実績のある `depth_midas` を優先し、detect時の `processorRes` を512に固定した。
   - 次は pose / lineart / depth 用ControlNet model追加後に実生成で確認する。

2. **実素材QA — Workspace参照保存**
   - `.yoitoart` は `embed` / `references` / `settings-only` を選べる。
   - `references` では履歴IDと外部画像パスを保存し、復元時にIPC経由で履歴PNGまたは許可画像ファイルをdata URLへ戻す。
   - 2026-05-12 QAで3モードの保存/読込、履歴ID参照復元、外部ファイル参照復元、欠落参照検出をPASS。証跡: [`QA_WORKSPACE_RESTORE_2026-05-12.md`](QA_WORKSPACE_RESTORE_2026-05-12.md)。
   - 次は欠落参照の差し替えUIと、プロジェクトフォルダ内素材の相対パス化を検討する。

3. **実データQA — Download / Library復旧**
   - ToolsのModel Libraryに復旧ボタンを追加済み。stale running jobの整理、metadata/preview再取得、SHA未計算のバックグラウンドqueue化まで入っている。
   - 2026-05-12 QAで約21.3GB / 12件の既存ライブラリ復旧をPASS。metadata/previewを1件再取得し、SHA未計算11件のqueue完了後に整合性Issue 0。証跡: [`QA_MODEL_LIBRARY_RECOVERY_2026-05-12.md`](QA_MODEL_LIBRARY_RECOVERY_2026-05-12.md)。
   - 次は実際の中断Download jobが発生した時点で、`running -> failed` と `completed補正` の2ケースを確認する。

4. **実素材QA — Upscale比較保存**
   - Diffusion比較は Tile ControlNet OFF/ON と denoise 0.25 / 0.35 / 0.45 の候補生成を同一素材で並べ、判断基準と候補画像を `userdata/upscale-comparisons/` に保存できる。
   - 2026-05-12 QAで同一素材の6候補比較を保存済み。証跡: [`QA_UPSCALE_COMPARISON_2026-05-12.md`](QA_UPSCALE_COMPARISON_2026-05-12.md)。
   - 標準候補は `Tile ON / denoise 0.25`。顔やポーズ保持を最優先する素材では `Tile OFF / denoise 0.25` も確認する。`denoise 0.45` はdetail確認用で、人物素材の既定値にはしない。

5. **公開準備**
   - `runtime/`、`userdata/`、`output/`、`node_modules/`、ビルド成果物はGit除外を維持する。
   - README / HTMLレポート / 構造ドキュメントのリンクを揃えたうえで、最小コミットを作る。
   - GitHubへpushする段階では、リポジトリ名と公開範囲(public/private)を確定してから `gh repo create` または既存remoteを設定する。

2026-05-11 追加実装:

- Phase 9E-3: Tools に Workspace 保存カードを追加。`userdata/workspaces/*.yoitoart` へ prompt / negative / params / model / VAE / LoRA / ControlNet / ADetailer / Dynamic Thresholding / FreeU / Upscale / Inpaint mask を保存・復元する。
- P0.9: Tools の Model Library に整合性チェックを追加。index済みファイルの欠落、サイズ差分、SHA未計算、provider SHA不一致、partial download残存、完了DL欠落を表示する。既存モデル1件ずつのSHA-256計算も追加。
- P4: Tools に Format Converter を追加。Forge models 配下の `.ckpt/.pt/.pth` を Forge Python + safetensors で `.safetensors` へ変換する。Model Merger は `modules/extras.py::run_modelmerger` の検出まで実装し、実行ブリッジは次スライス。
- P1: Upscale Diffusion / Ultimate に denoise 0.25 / 0.35 / 0.45 の実UI比較生成ボタンと比較グリッドを追加。候補をクリックすると出力として採用できる。
- P2/P3: History に model / sampler / LoRA / date filter と、履歴2件の prompt diff 表示を追加。
- P5: img2img の入力画像カードに Inpaint mask キャンバスを追加。白く塗った範囲を Forge img2img の `mask` として送信する。

当時の残タスクと現在の扱い:

- Workspace参照方式は2026-05-12追補で解消済み。残るのは参照先欠落時の説明表示と相対パス化の検討。
- Model Merger は後続で安全なPythonブリッジ、出力先選択、上書き防止、実サイズ安全確認まで完了。
- Format Converter は変換前後の自動Inspector結果表示、失敗時の一時ファイル cleanup、LoRA抽出系の仕様化が残る。
- Inpaint mask は基本描画のみ。消しゴム、ぼかしプレビュー、マスク反転、塗り領域の編集履歴は後続。

2026-05-11 追加進捗:

- Model Merger の実行ブリッジを追加。Forge Python を `USE_TF=0` / `TRANSFORMERS_NO_TF=1` で起動し、TensorFlow/protobuf衝突を避ける。
- Forge 内部の通常 import 順に合わせ、`modules.initialize.imports()` 後に `sd_models.list_models()` / `sd_vae.refresh_vae_list()` を行って `modules.extras.run_modelmerger()` を呼ぶ。
- UI から Primary/Secondary/Tertiary、補間方式、Multiplier、保存形式、float16、metadata保存、出力名を指定できる。
- 出力名は拡張子・パス区切り禁止、既存ファイル上書き禁止。完了後は Model Library を再スキャンする。
- Workspace 保存は画像復元に対応。`inputImageDataUrl`、`lastImageDataUrl`、`upscaleInputImageDataUrl`、`upscaleOutputImageDataUrl` を `.yoitoart` に保存し、復元時に img2img / preview / Upscale へ戻す。
- Model Merger の長時間処理向けに、Python stdout/stderr の実行ログ表示、キャンセルIPC、完了後の自動 Model Inspector、失敗/キャンセル時の出力予定ファイルcleanupを追加。
- Format Converter は `.safetensors.partial-*` に一時出力し、成功時のみ最終ファイル名へリネームする方式へ変更。失敗時は一時ファイルをcleanupし、変換完了後は自動 Model Inspector 結果を表示する。
- 実マージは巨大モデル出力を伴うため未実行。Python初期化・model list・`run_modelmerger` 検出は実環境で確認済み。

2026-05-12 追加進捗:

- PixAIを調査ソースに追加。公開Help/Blogで確認できる Note、Prompt Helper、Model/LoRA Market、Variation、Use as Base Image、Enhance、Composition、ControlNet、Image-to-Video、Mio.2的な補助導線を、ローカルForge向けのレシピ保存・結果アクション・自然文補助・ControlNet Builder候補へ分解して優先度に組み込んだ。
- PixAI参考の結果アクション強化を開始。Preview の生成結果フッターを「次の操作」バーに整理し、Variation / Base image(img2img) / Enhance(Upscale) / Recipe保存 / PNG保存 / Folder を明示した。Recipe保存は現在の設定と生成結果を `.yoitoart` Workspace として保存する。
- 起動時ロード高速化 / 全体軽量化を P0.8 としてロードマップへ追加。初期描画、Forge起動、モデル一覧、Civitai集計、Toolsスキャンを分離し、遅延ロードと計測を進める方針にした。
- Model Merger に実行前チェックを追加。Primary/Secondary/Tertiary の入力モデルサイズ、推定出力サイズ、必要空き容量、実ディスク空き容量、出力先上書き状態をUIに表示し、空き容量不足や同名出力では実行を止める。
- P0.8 初期対応として、Upscale / Tools / Civitai検索モーダルをReact lazy + Suspenseで分割。初期renderer chunkは約1.25MBから約1.12MBへ減り、`CivitaiSearchModal` / `UpscaleWorkspace` / `ToolsWorkspace` は必要時ロードになった。履歴サムネイル読み込みとCivitai更新/タグ取得も初期描画後へ遅延。
- P0.8 追加対応として、SidePanel内の `PromptLibrary` / `LoraPanel` / `HistoryGallery` / `PresetList` をタブ別 lazy chunk 化。`PreviewPanel` の `png-metadata.ts` 静的importもドロップ時の動的importへ変更し、画像metadata parserを初期bundleから外す。
- P0.8 追加対応として、Tools に起動診断カードを追加。App ready / IPC ready / renderer loaded / window shown / Forge start / Forge ready のタイムスタンプをIPCで取得し、次の高速化対象をUI上で確認できるようにした。
- 起動安定化として、IPC handler 登録を renderer 読み込み前へ移動。初期化中に renderer 側IPCが先行して `No handler registered` になる可能性を潰した。
- Forge 起動高速化として、初回 ready 後に `.yoitomoshi-install-ready.json` を作成し、requirements / extension install.py / requirements.txt が更新されていない次回起動では `--skip-install` を自動付与する。拡張やrequirementsが更新された場合は再チェックに戻る。
- API専用起動では不要かつGradio互換エラーを出していた `model_preset_manager` を `disabled_extensions` に自動追加するようにした。これにより毎回出ていた `Textbox.style()` エラーを抑制した。
- Prompt Library はサブカテゴリごとの初期描画タグを最大80件に制限し、必要時に「さらに表示」へ切り替える方式へ変更した。既定表示では最初のサブカテゴリだけを描画する方針を維持し、巨大DOM化を抑える。
- History はアプリ起動直後ではなく、履歴タブを開いた時だけ `storage.listHistory()` を実行する方式へ変更した。起動直後の履歴サムネイル読み込みを完全に外した。
- Civitai popular tags は起動時ロードをやめ、Civitai検索モーダルを開いた時だけ取得する方式へ変更した。モデル更新チェックもForge ready直後から12秒後へ後ろ倒しした。
- Tools は内部カードを開閉式にし、Model Library / Model Health / Inspector / Merger / Converter は開かれるまでマウントしない。これによりToolsタブを開いただけでModel Library indexやMerger preflightが走る状態を避ける。
- HistoryGallery は初期描画を40件に制限し、追加分は「さらに表示」で段階描画する。サムネイル画像にも `loading="lazy"` を付け、履歴タブを開いた時のDOM/画像負荷を抑える。
- Model Library index は差分更新へ寄せた。再スキャン時に各モデルの `lastModifiedAt` を記録し、サイズ/mtimeが同じファイルは既存 metadata / preview / SHA を保持、差し替わったファイルだけSHAを未計算へ戻す。
- Model Library の再スキャン結果をUIで見える化した。新規 / 更新 / 維持 / 削除 / SHA保持 / SHA再計算待ちを表示し、差分更新が効いているかをTools上で確認できる。
- Model Library に索引ファイル一覧、検索、種別フィルタを追加した。初期表示は25件上限にし、名前 / パス / SHA / source metadata で絞り込めるため、大きいモデルフォルダでも一覧確認の負荷を抑える。
- Prompt Library はタグ数だけでなく、表示サブカテゴリ数も初期8件に制限し、検索時や「全て」表示時のDOM増加を段階表示へ逃がした。
- P2/P3: History に PixAI 参考のローカル整理ラベルを追加。各履歴に「お気に入り / 採用候補 / 没 / 素材化済み」を付けられ、ラベルで絞り込める。実UIで履歴70件表示、ラベルフィルタ表示、先頭履歴への一時ラベル付与と復元を確認済み。
- P1.2: Prompt Helper の初期版を追加。外部AI APIなしで自然文メモをルール + 既存Prompt Library検索に通し、positive / negative 候補と衣装LoRA・seed固定・ControlNet参照の注意点を出す。実UIで自然文から `kimono` / `1girl` 候補表示、候補追加、元プロンプト復元を確認済み。
- P0.8: 起動診断を `userdata/startup-metrics.jsonl` に自動保存するようにした。Tools の起動診断カードから直近サンプルを確認できる。ビルド済みElectronで3回測定し、renderer loaded は約235〜247ms、Forge ready は約15.5〜25.7秒だったため、次の高速化対象はrenderer bundleよりForge起動側。
- P0.8: API専用起動では使わないGradio UI系拡張(`a1111-sd-webui-tagcomplete`, `Config-Presets`, `sd-webui-prompt-all-in-one`, `Stable-Diffusion-Webui-Civitai-Helper`, `stable-diffusion-webui-localization-ja_JP`)を自動無効化対象へ追加した。追加後の実測2回では Forge ready が約14.7〜20.1秒、Forgeログ上の `load scripts` は約2.7〜3.7秒。ADetailer / WD14 tagger / Better Prompt / ControlNet / Ultimate は維持。
- P0.8 検討結果: ControlNet は現時点では常時ロードを維持する。`sd_forge_controlnet` は `/controlnet/model_list` / `/controlnet/module_list` と `alwayson_scripts['ControlNet']` を起動時に登録するため、遅延有効化は実質 Forge 再起動を伴う。短縮できるのは主に `controlnet.py` 約3〜6秒だが、Upscale Tile ControlNet / 通常ControlNet / モデル未配置警告の導線を即時利用できなくなる影響が大きい。将来の候補は「高速起動モード(ControlNet無効、利用時に再起動案内)」として opt-in に限定する。
- P0.8: Forge 起動引数の `--cuda-malloc` を3回実測し、Forge ready は約15.49〜15.54秒で安定。txt2img 128x128 1step と Tile ControlNet 付き img2img の最小生成も成功したため、`userdata/settings.json` の `forgeExtraArgs` に採用した。
- P0.8: Forge ready 直後のカタログ取得を分割。即時取得は checkpoint / sampler / scheduler に絞り、LoRA / VAE は3.5秒後へ遅延、ControlNet model/module と upscaler は ControlNet / Upscale パネル利用時に取得する。
- P4: Model Merger は実サイズの安全確認を完了。`pixelstyleckpt_strength07` と `hassakuHentaiModel` を half safetensors で一時マージし、約18.7秒で約2.13GB出力、safetensors header 読み取り、検証後 cleanup 成功を確認した。ログは `userdata/validation-model-merger-real.out.log`。
- Phase 9E-3: Workspace 保存に「画像も含める / 設定だけ保存」の選択を追加。設定だけ保存では input / preview / upscale / inpaint mask / ControlNet参照画像を除外し、軽い `.yoitoart` として保存できる。
- P1.3: PromptPanel に ControlNet Builder 初期版を追加。ポーズ / 線画 / depth / tile / reference の役割プリセットから Unit 1 を設定し、導入済み module/model を優先選択する。
- P4: Format Converter は Stable-diffusion 配下だけを変換対象に制限した。現環境には checkpoint系 `.ckpt/.pt/.pth` が無く、検出された `.pt/.pth` は ADetailer / RealESRGAN / DeepDanbooru / VAE-approx 用だったため実変換は保留。
- P1.3: ControlNet Builder を実用UIへ寄せた。パネルは既定で開き、役割カードを2列のコンパクト表示に変更。Forge ready後に ControlNet model/module catalog を取得し、各役割に「使用可 / モデル不足」を表示する。Tile は `xinsir-controlnet-tile-sdxl-1.0` 配置済み環境で `使用可` になり、クリックで Unit 1 に `tile_resample` + Tile model を適用する。
- Phase 9E-3: Workspace 保存の実API検証を追加。`settings-only` は画像・ControlNet参照画像を保存しないこと、`embed` は小さな画像data URLを保持すること、保存後に load/delete できることを Electron preload API 経由で確認した。
- 実UI QA: Electron remote debugging 経由で Toolsタブクリック、Workspace「設定だけ保存」選択、ControlNet BuilderのTileクリックを確認。スクリーンショットは `output/ui-qa/12-workspace-settings-only.png` と `output/ui-qa/14-controlnet-builder-tile-click.png`。ページ例外/Log error は検出なし。
- P1.3: ControlNet Builder に入力画像ドロップ、preprocessor実行、source / preprocessedプレビュー、Unit 1への反映を追加した。pose / lineart / depth はpreprocessed画像を `module: None` で固定参照として使い、tile / reference は元画像と対応moduleを使う。
- Phase 9E-3: Workspace 保存に `references` モードを追加。履歴IDと外部画像パス参照を保存し、復元時に履歴PNGまたは許可された外部画像ファイルを読み直す。巨大画像を `.yoitoart` に埋め込まない復元導線ができた。
- P0.9: Model Library 復旧処理を追加。再起動後に残ったrunning jobの整理、source metadataの再取得、preview再キャッシュ、SHA未計算モデルのバックグラウンドqueue化をToolsから実行できる。
- P1: Upscale比較を Tile ControlNet OFF/ON と denoise 0.25 / 0.35 / 0.45 の組み合わせに拡張。比較候補、入力画像、drift / seam / detail の判断基準を `userdata/upscale-comparisons/` に保存できる。
- 公開準備: READMEに全体精査レポート、ロードマップ、構造ドキュメントへの入口を追加し、HTMLレポートも実装後の状態へ更新する。

2026-05-13 追加進捗:

- Prompt All in ONEはAPI専用Forge起動では無効化対象にしているため、依存せずに設計だけを取り込む方針にした。対象はタグチップ編集、英語タグ変換、Prompt Library連携、ControlNet用途別導線。
- Prompt入力欄に英語タグ変換ボタンを追加。日本語の自然文やPrompt Libraryの日本語ラベルを、ローカル辞書と既存ライブラリ検索だけで英語タグ列へ変換する。
- Prompt Helperに英語タグ候補行と「英語に置換」操作を追加。自然文メモから候補生成、タグ追加、英語タグ化を同じ補助パネル内で行える。
- Prompt Editorの補完を英語タグだけでなく日本語ラベルにも対応させ、ローマ字/英語入力と日本語メモの両方からタグへ到達しやすくした。
- PromptPanelにタグチップ編集を追加。既存textareaを正本にしたまま、タグ単位で重み+/-、削除、positive/negative間移動、重複整理ができる。Prompt Libraryの日本語ラベルもチップに併記する。
- ControlNet Builderの役割プリセットを拡張。pose / lineart / depth / tile / referenceに加えて、canny / softedge / scribble / normal / segmentationを選べるようにした。
- 全体機能・シナジー精査レポートのP0改善を実装。PreviewのRecipe保存とToolsのWorkspace保存を共通スナップショット生成へ統一し、Regional Prompter / FABRIC / ADetailer / Dynamic Thresholding / FreeU / ControlNet / Upscale を同じ保存範囲で扱う。
- Historyのラベル整理とFABRICを接続。お気に入り / 採用候補 / 素材化済みはFABRIC positive、没はFABRIC negativeへまとめて送れるようにし、`history:{id}` で重複投入を防ぐ。
- PromptPanelに生成前チェックを追加。Forge ready、モデル未選択、非生成タブ、img2img入力画像、拡張ガード、VAE/LoRAのカタログ不一致、ControlNet画像/モデル、FABRIC feedback、ADetailer検出モデルを生成直前に見える化する。
- 検証: `npm.cmd run typecheck` と `npm.cmd run build` はPASS。Electron実機での目視QAは次回、履歴ラベル付き実データとControlNet/FABRICを使って確認する。
- img2imgに「AIキャラ追加」パネルを追加。元写真の上へ透明PNG/キャラ画像を配置し、ドラッグ位置・サイズ・回転・左右反転・mask拡張/ぼかしを調整できる。`馴染ませ準備` で合成画像をimg2img入力へ、キャラalpha由来の白黒maskをInpaint maskへ、lineart/canny系ControlNet Unit 1を自動設定し、prompt/negative/denoiseもプリセットに合わせて追記する。
- AIキャラ追加プリセットは `写真にアニメ / 夜写真 / しっかり描く / 境界修正` の4種。サンプルのような夜・低照度写真には `夜写真` を既定にし、暗さ・粒状感・赤い光・自然な影をpromptと仮配置フィルタへ反映する。
- 参考調査は Inpaint + ControlNet、ControlNet reference_only、IP-Adapter、LayerDiffuse、IC-Light、Inpaint Anything、Replacer、GLIGEN/Add-it/Paint-by-Example に整理し、まずはForge APIで即実装できる「置く→マスク→ControlNet/Inpaint準備」をP0として採用した。詳細は [`CHARACTER_COMPOSITE_WORKFLOW_REPORT_2026-05-13.html`](CHARACTER_COMPOSITE_WORKFLOW_REPORT_2026-05-13.html)。
- AIキャラ追加の強化版として、背景トーン自動合わせ、ControlNet Unit 2へのキャラ参照自動投入、Before/After比較パッケージ保存を追加した。比較パッケージは `userdata/character-composites/<uuid>/` に元画像、キャラ、仮配置、mask、生成後画像、manifest、HTMLレポートを保存する。
- AIキャラ追加は準備後も元画像をローカル保持し、再調整で仮配置画像にさらにキャラを重ねてしまう二重合成を避ける。詳細は [`CHARACTER_COMPOSITE_ADVANCED_REPORT_2026-05-13.html`](CHARACTER_COMPOSITE_ADVANCED_REPORT_2026-05-13.html)。
- AIキャラ追加パネルに連携診断を追加。Forge拡張フォルダ、`disabled_extensions`、ControlNetモデルフォルダをIPCでスキャンし、LayerDiffuse / IP-Adapter / ControlNetモデル / IC-Light の導入状態と不足点を表示する。現環境ではControlNet Tileのみ検出し、LayerDiffuse / IP-Adapter model / IC-Light は未導入。詳細は [`CHARACTER_COMPOSITE_INTEGRATION_STATUS_REPORT_2026-05-13.html`](CHARACTER_COMPOSITE_INTEGRATION_STATUS_REPORT_2026-05-13.html)。
- 未検証項目の棚卸しを実施。`typecheck` / `build` / Forge API smoke / AIキャラ追加UI+IPC / Model Library整合性 / DownloadJob現況 / Workspace参照保存 / Upscale比較保存 / 配布版EXE smokeを確認した。配布ビルドは `runtime/forge` の巨大モデル混入と Windows通常権限の `winCodeSign` 展開失敗を検出し、electron-builder設定で除外・未署名個人配布ビルドへ修正したうえで `npm.cmd run dist` PASS。詳細は [`PROJECT_UNVERIFIED_VALIDATION_REPORT_2026-05-13.html`](PROJECT_UNVERIFIED_VALIDATION_REPORT_2026-05-13.html)。
- 必要モデル・実素材を調査。最短QAセットは OpenPose SDXL、Depth SDXL、MistoLine rank256 と、自前の夜写真/昼写真/透明PNGキャラ素材。追加比較は xinsir Canny V2、IP-Adapter SDXL、LayerDiffuse、IC-Light、ControlNet Union。詳細は [`MODEL_AND_ASSET_RESEARCH_REPORT_2026-05-13.html`](MODEL_AND_ASSET_RESEARCH_REPORT_2026-05-13.html)。
- OpenPose / Depth / Lineart の候補を再調査し、`xinsir-controlnet-openpose-sdxl-1.0.safetensors`、`xinsir-controlnet-depth-sdxl-1.0.safetensors`、`mistoline-lineart-rank256.safetensors` を導入した。SHA検証、Forge `model_list`、Electron UI smoke、Model Library反映まで確認済み。詳細は [`CONTROLNET_MODEL_INSTALLATION_REPORT_2026-05-13.html`](CONTROLNET_MODEL_INSTALLATION_REPORT_2026-05-13.html)。
- Goal 1-5を完了。実素材でControlNet preprocessor / txt2img実生成を baseline、pose、depth、lineart、tile で検証し、AIキャラ追加は夜景写真 + 透明PNG + mask + img2img/inpaint + MistoLine/reference_only でAfter画像まで保存した。ControlNet BuilderはHF由来モデル名を役割カードへ表示し、Model LibraryにはrepoId/pageUrl/expectedSha256を追記した。次の追加候補は `xinsir/controlnet-canny-sdxl-1.0` をP0、`h94/IP-Adapter` SDXLをP1に整理。詳細は [`GOAL_1_5_EXECUTION_REPORT_2026-05-13.html`](GOAL_1_5_EXECUTION_REPORT_2026-05-13.html)。
- 生成設定のシンプル化を開始。ParametersPanel に「おすすめ設定」4種(高速確認 / 標準 / 高品質 / AIキャラ追加)を追加し、Sampler / Scheduler / VAE / Seed / Batch / Clip Skip は詳細設定の折りたたみに移した。普段は目的別プリセット、Steps / CFG / サイズだけで調整できる導線にする。
- Prompt Editorの表示ズレ対策として、textarea上のミラー式シンタックスハイライトを外し、実文字をそのまま表示する方式へ変更。オートコンプリートは自動表示をやめ、Ctrl+Spaceで手動起動、候補一覧は入力欄下に配置して本文に重ならないようにした。

残タスク更新:

- ControlNet入力生成はUI/IPC実装、UI QA、pose / lineart / depth / tile の実生成QAまで完了。次は canny モデル導入後に建物・小物・硬い輪郭の保持を追加比較する。
- Workspace参照保存は実素材QA済み。参照先が存在しない共有Workspaceの差し替えUIと、相対パス化の是非は後続で検討する。
- Model Library復旧は実データQA済み。既存の約21.3GBライブラリで復旧ボタンを実行し、SHA queueがUI操作を阻害しないこととmetadata/preview再取得を確認した。
- Upscale比較保存は実素材QA済み。比較結果を1セット保存し、drift / seam / detail の採用基準と推奨denoiseを確定した。
- Promptタグ編集は文字列プロンプトを正本にした軽量実装まで完了。次の拡張は、タグ無効化を含む構造化Prompt RecipeとしてWorkspace/Historyに保存するかどうかを決めてから進める。
- Prompt Editorの色分けを再導入する場合は、textareaミラー方式ではなく、ズレが出にくい専用エディタ採用かタグチップ側の視覚化で行う。
- 生成前チェックは初期版。次はチェック結果をGenerateボタンのdisabled理由と連動させ、警告はクリックで該当パネルへ移動できるようにする。
- AIキャラ追加はP0導線、比較保存、連携診断まで完了。次はIP-Adapter model配置済み環境でのUnit 2効果確認、実写真+透明PNGでのトーンON/OFF比較、LayerDiffuse透明生成・IC-Light照明合わせの段階統合を進める。
- Format Converter は `.ckpt/.pt/.pth` の checkpoint 実ファイルが環境にないため、次に該当ファイルが `webui/models/Stable-diffusion/` に入った時点で実変換を1回確認する。
- 配布ビルドは個人配布向けの未署名NSIS installer生成まで確認済み。公開配布時はコード署名証明書、管理者権限または開発者モード、SmartScreen確認を別途検証する。

以下は2026-05-11に完了済み。

### 完了 — P0.6 / P0.7 / Phase 9E 初期 / Phase 9E-2 主要部

1. **Phase 9E-2 — Model Browser / Download Manager 実用化**
   - 実装済み土台: `userdata/model-library/index.json`、`userdata/downloads/jobs.json`、Tools のモデルライブラリ集計、Civitai download の `.partial` 継続とHTTP Range再開。
   - 実装済み: 未完了/失敗/中断ジョブの「再開」「破棄」「保存先を開く」をToolsに追加。
   - 実装済み: `jobs.json` と `index.json` 読み込み時に schema normalize を行い、壊れたmanifestで起動不能にならないよう補正。
   - 実装済み: Civitai検索結果から source URL、model/version id、creator、base model、expected SHA-256、thumbnail preview cacheを Model Library に保存。
   - 実装済み: Hugging Face model browserをCivitai検索モーダルにprovider切替として追加。`huggingface.co/api/models` を利用し、Checkpoint / LoRA / VAE / ControlNet などの配置先を明示してダウンロードする。
   - 2026-05-12追補: Tools の復旧処理でstale running job整理、metadata/preview再取得、SHA queue化を追加し、実データQAも完了。

1. **P0.6 — Git/GitHub 移行前の安全整備**
   - `.gitignore` を拡張し、`runtime/`, `userdata/`, Electron cache 類, `out/`, `dist/`, `output/` を確実に除外した。
   - `app.setPath('userData', projectRoot)` をやめ、Electron profile/cache を `userdata/electron-profile` へ隔離した。
   - `userdata/settings.json` の Civitai API キーを `secrets.local.json` へ分離した。Electron `safeStorage` が使える環境では次回保存時に暗号化形式へ更新する。

2. **P0.7 — IPC / 外部URL / ファイル操作の境界強化**
   - 実装済み: `toolsInspectModel` はユーザー選択済みファイルまたはForgeモデル配下だけ許可する。
   - 実装済み: `openExternal` と Electron window navigation は `https` + 許可ドメインだけ許可する。
   - 実装済み: `storageSetSettings` は Forge path / port / outputDir / language / extraArgs / Civitai key を検証してから保存する。
   - 実装済み: Civitai download request は URL / filename / asset type / SHA-256 を検証する。
   - 実装済み: `showItemInFolder` は履歴画像または設定済みoutputDir配下だけ許可する。
   - 実装済み: txt2img / img2img / extras / interrogate payload は文字列長、画像base64サイズ、steps / cfg / size / seed / batch / denoise などを検証してからForgeへ渡す。
   - 実装済み: BOM付き `userdata/settings.json` でも起動できるよう設定読み込みを補正した。

3. **Phase 9E — Stability Matrix 参考の管理機能**
   - Model Browser: Civitai / Hugging Face から検索し、モデル種別に応じて Checkpoint / LoRA / VAE / ControlNet へ自動配置する。
   - 実装済み: Download Manager の初期manifestとして `userdata/downloads/jobs.json` を追加。Civitai download は `.partial` を保持し、再実行時にHTTP Rangeで継続する。
   - 実装済み: Shared Model Library の初期indexとして `userdata/model-library/index.json` を追加。Tools からモデル数、容量、種別別集計、最近のDownloadJobを確認できる。
   - 2026-05-12追補: 未完了ジョブ整理、metadata/preview保存、Hugging Face検索、復旧処理まで実装済み。自動再開選択は今後のUX改善候補。
   - Package / Launcher 管理: Forge の起動引数プリセット、環境変数、依存修復、拡張 enable/disable/update を Tools 内に集約する。
   - Workspace 保存: Stability Matrix の `.smproj` に相当する独自 `.yoitoart` を作り、prompt / params / LoRA / ControlNet / input image 参照 / upscale 設定を保存・復元する。
   - まずは Forge 1系統に限定する。ComfyUI / InvokeAI 等の複数 package 管理は後続で、現時点では採用しない。

以下の完了済み項目は履歴として残す。

### 完了 — P0.5: フォルダ統合 / API専用Forge起動 / 不要物整理

目的: `C:\宵灯工房アート` 直下にアプリ本体とForge本体が sibling として並ぶ状態を解消し、Electronアプリ1フォルダで管理する。

2026-05-11 実装済み:

- `C:\宵灯工房アート\webui_forge_cu121_torch231` を `C:\宵灯工房アート\Yoitomoshi-Art-Generator\runtime\forge` に移動。
- `userdata/settings.json` と既定設定を `runtime\forge` に更新。
- 旧 sibling パスが設定に残っていても、統合後パスが存在する場合は自動補正する。
- Forge 起動を `--nowebui --api-log --port ...` に変更し、Gradio画面を起動しないAPI専用運用に変更。
- API専用起動はこの環境で60秒を少し超えることがあるため、readiness timeout を180秒へ延長。
- 実機確認: `/sdapi/v1/options`、`/controlnet/model_list`、`/controlnet/module_list` が通り、`/` は404でGradio UIが出ないことを確認。
- Tools に Model Health Scan を追加し、Checkpoints / LoRA / VAE / ControlNet 配置の空ファイル・種別違い・重複を検出可能にした。
- LoRAフォルダ内に重複配置されていたチェックポイント `pixelstyleckpt_strength07.safetensors` は、Checkpoints側とSHA-256一致を確認したうえでLoRA側の重複を削除。
- `xinsir-controlnet-tile-sdxl-1.0.safetensors` の diffusers系 `controlnet_*` ヘッダをControlNetとして判定できるよう分類器を更新。

完了確認:

- `C:\宵灯工房アート` 直下は `Yoitomoshi-Art-Generator` のみ。
- 実 UI の Tools → Model Health Scan で `確認事項 0`。
- Electron終了後に対象の Electron / Forge Python プロセスが残らない。

### P0 — 現状同期と軽い整備

目的: フォルダ移動後も次の作業者が迷わず再開できる状態にする。

実施内容:

- README 系の開発用パスを `C:\宵灯工房アート\Yoitomoshi-Art-Generator` に揃える。
- `PROJECT_REPORT.md` 内の古い進捗表を、Phase 8 完了 / Ultimate 統合済み / i18n 残ありに更新する。
- `SESSION_HANDOFF_2026-05-11.md` は履歴ログなので大きく書き換えず、必要なら冒頭に「現作業フォルダは移動済み」と追記する。

完了条件:

- `rg -n "C:\\Imagen\\Yoitomoshi-Art-Generator|Phase 8 — i18n|ultimate-upscale 追加" docs\PROJECT_REPORT.md README.md README.en.md README.ru.md README.pt.md はじめに.txt` で、古いプロジェクトパスや古い次フェーズ表現が残っていない。`SESSION_HANDOFF_2026-05-11.md` は履歴ログなので対象外。

### 完了 — i18n フェーズ 2 残り

目的: 言語切替時に主要 UI へ日本語が混ざる状態をなくす。

実装済み対象:

| 優先 | ファイル | 理由 |
|---:|---|---|
| 1 | `src/components/InputImagePanel.tsx` | img2img の常用 UI。タグ抽出ボタンやトーストが残っている。 |
| 1 | `src/components/DroppedImageInsight.tsx` | メタデータ解析 UX の中核。DL 成功/失敗、ローカル有無、Civitai 操作が残っている。 |
| 1 | `src/components/HistoryGallery.tsx` | 履歴復元・検索・削除など、使用頻度が高い。 |
| 2 | `src/components/LoraCard.tsx` | LoRA 適用/解除、お気に入り、Civitai 表示が残っている。 |
| 2 | `src/components/PresetList.tsx` | プリセット保存/読込/削除が残っている。 |
| 2 | `src/components/SidePanel.tsx` | ライブラリ/履歴/プリセットのタブラベルが残っている。 |
| 2 | `src/components/StartupOverlay.tsx` | Forge 停止/起動/エラー表示が残っている。 |
| 3 | `src/components/LoraSuggestionStrip.tsx` / `src/lib/lora-suggest.ts` | LoRA 推奨理由の表示言語を整える。 |

実装方針:

- 既存キー体系に合わせて `inputImage.*`, `insight.*`, `history.*`, `loraCard.*`, `preset.*`, `side.*`, `startup.*`, `loraSuggest.*` を追加する。
- JSX 内では `useT()`、イベントハンドラ/async/utility では `t()` を使う。closure stale を再発させない。
- 記号や寸法の `×`、モデル名、ユーザー入力、Civitai 固有名は翻訳対象にしない。

検出コマンド:

```powershell
rg -n "[ぁ-んァ-ン一-龯]" src\components src\App.tsx src\lib -g '!i18n.ts'
```

完了確認:

- 上記コマンドのヒットが、コメント・ユーザー生成値・言語非依存記号だけになる。
- ja/en/ru/pt に切替えて、txt2img / img2img / Upscale / Tools の主要導線に日本語混入がない。
- `npm run typecheck` が通る(2026-05-11 確認済み)。

### 完了 — Phase 9A: Tile ControlNet 統合

目的: Upscale 時の tile drift を根本的に抑える。現状の低 denoise / Mixture of Diffusers / Ultimate seam fix は有効だが、入力画像の構造を ControlNet Tile で固定するほうが安定する。

2026-05-11 実装済み:

- `UpscaleState` に Tile ControlNet 専用設定を追加。
- `UpscaleWorkspace` に Diffusion / Ultimate 共通の Tile ControlNet トグルを追加。
- Forge の `controlnetModelList` / `controlnetModuleList` から tile model / tile_resample / None を自動選択。
- Tile モデル未配置時は警告し、Civitai の Controlnet 検索へ誘導。
- `buildAlwaysOnScripts()` に upscale 専用 context を追加し、Diffusion は `MultiDiffusion Integrated` と `ControlNet`、Ultimate は `script_name: 'Ultimate SD upscale'` と `alwayson_scripts['ControlNet']` を併用。
- フォルダ移動後の Forge パスを `C:\宵灯工房アート\Yoitomoshi-Art-Generator\runtime\forge` に更新。
- `xinsir/controlnet-tile-sdxl-1.0` の `diffusion_pytorch_model.safetensors` を `webui/models/ControlNet/xinsir-controlnet-tile-sdxl-1.0.safetensors` に配置し、SHA-256 一致を確認。
- Forge API の `/controlnet/model_list` / `/controlnet/module_list` で Tile モデルと `tile_resample` を確認し、最小 txt2img + ControlNet payload で実生成成功。
- Upscale Diffusion 相当の `img2img + MultiDiffusion Integrated + ControlNet` と、Ultimate 相当の `script_name: 'Ultimate SD upscale' + ControlNet` も最小 API payload で生成成功。
- Electron 実 UI で Upscale タブに画像を投入し、Diffusion + Tile ControlNet ON、`tile_resample`、`xinsir-controlnet-tile-sdxl-1.0 [4d6257d3]` が選択されることを確認。1.5x の最小生成で `128×128→192×192` の出力表示まで確認済み。

実装スライス:

1. Store
   - `UpscaleState` に Tile ControlNet 用の設定を追加する。
   - 候補: `tileControlNetEnabled`, `tileControlNetModel`, `tileControlNetModule`, `tileControlNetWeight`, `tileControlNetGuidanceStart`, `tileControlNetGuidanceEnd`。

2. UI
   - `UpscaleWorkspace` に折りたたみパネルを追加する。
   - ControlNet モデル/モジュール一覧は既存の `controlnetModelList` / `controlnetModuleList` を使う。
   - Tile 系モデルが見つからない場合は、`webui/models/ControlNet/` に配置が必要であることを明示する。

3. Payload
   - `buildAlwaysOnScripts()` の upscale 用 context を拡張し、Diffusion では `MultiDiffusion Integrated` と `ControlNet` を同時に返せるようにする。
   - Ultimate path でも `script_name: 'Ultimate SD upscale'` と `alwayson_scripts['ControlNet']` を併用できる形にする。
   - PromptPanel 側の通常 ControlNet 設定が Upscale 専用 Tile ControlNet に勝手に混ざらないよう、専用 builder か context 分岐を使う。

4. Model/module 自動選択
   - module は環境差があるため、`tile`, `tile_resample`, `None` を候補順で検索する。
   - model は `tile` / `controlnet-tile` / `sdxl` を含む名前を優先し、見つからない場合は未設定で警告する。

完了条件:

- ControlNet モデル未配置時にエラーではなく明確な警告が出る。
- Tile モデル配置済み環境で、ControlNet payload 付きの実生成が成功する。
- Upscale Diffusion と Ultimate の両方で API payload が通る。
- 実 UI の Tile ControlNet ON 生成が成功する。
- 実 UI で denoise 比較を行い、上下分裂・衣装 drift・seam の変化を目視確認する(残タスク)。
- denoise 0.35 前後でも、縦長キャラ画像で上下の人物が分裂しにくくなる。
- 既存の PromptPanel ControlNet、ADetailer dicts-only、Simple Upscale に副作用がない。

### 完了 — Phase 9B: 履歴からの再利用導線(主要部)

目的: ゲーム素材制作で「良かった生成」を再利用しやすくする。

2026-05-11 実装済み:

- 履歴アイテムの「完全再現」で prompt / negative / model / VAE / LoRA / seed / sampler / scheduler / steps / cfg / size / clip skip / denoise を復元。
- `seed=-1` 生成時も Forge の `info` から実シードを履歴保存し、再現性を落とさない。
- 履歴アイテムからフル解像度 PNG を読み出して Upscale へ送るボタンを追加。
- Preview に Variations パネルを追加し、seed / CFG / denoise の 2 / 4 / 8 枚比較を順次生成。
- バリエーション候補は履歴へ保存し、候補から img2img / Upscale へ送れる。

残り候補:

- 履歴フィルタを model / LoRA / sampler / 日付で絞れるようにする。
- 履歴 2 件の prompt diff を表示する。

完了条件:

- 履歴から 1 クリックで再生成前のフォーム状態へ戻せる。
- 復元後に生成した画像のメタデータが、履歴元と同じ主要パラメータを持つ。
- 履歴から Upscale へ送った画像で、推奨バナーが通常の画像投入時と同じように出る。

### P2 — Phase 9C: メタデータ駆動 UX の拡張

目的: 画像ドロップや Civitai 情報から、必要なモデル/LoRA/VAE を自動で探しやすくする。

実装候補:

- ドロップ画像に含まれる LoRA がローカルにない場合、Civitai 検索 + DL ボタンを表示する。
- ドロップ画像の checkpoint がローカルにある場合、「このモデルに切替」を提案する。
- 複数 PNG / フォルダドロップでローカル参考サンプルを集計する。
- Civitai community images の集計を RecommendationCard だけでなく QuickPreset にも反映する。
- ComfyUI workflow JSON の最低限パースを追加する。

完了条件:

- ローカルに存在する資産と不足資産が、ドロップ直後に判別できる。
- Civitai レート制限時にも UI が破綻せず、再試行や API キー案内へ流せる。

### P3 — Phase 9D: Tools 強化

目的: モデル整理をアプリ内で完結させる。

実装候補:

- Model Merger
  - まずは UI と実行設計を分離する。
  - Python 連携で Forge/SuperMerger 相当を呼ぶか、TS 移植するかを決める。
- Format Converter
  - `.ckpt` から `.safetensors` への変換。
  - LoRA 抽出は安全な仕様が固まってから着手する。

完了条件:

- 変換やマージは元ファイルを上書きしない。
- 出力先、推定サイズ、失敗時の復旧方法が UI 上で分かる。

### Phase 9E — Stability Matrix 参考の管理機能

目的: Stability Matrix の「package manager + model browser + shared model directory + launcher」思想を、Yoitomoshi の Forge 専用運用へ取り込む。

参考ソース:

- `https://github.com/LykosAI/StabilityMatrix`
- Stability Matrix README で確認した主な機能: 複数 Stable Diffusion package の install/update、拡張管理、Python/Git同梱、ポータブルData Directory、Inference workspace、launch arguments/env editor、shared model directory、Civitai/Hugging Face model browser、pause/resume download、metadata/preview取得。

ライセンス方針:

- Stability Matrix は AGPL-3.0。ソースコード、UI実装、画像資産をコピーしない。
- 取り込むのは公開README等から読み取れる機能要件とUXの考え方のみ。
- 実装は既存の Electron / React / Forge API / Node fs IPC の枠内で独自実装する。

採用する機能:

1. **Model Browser / Importer**
   - Civitai と Hugging Face を同じ検索面で扱う。
   - モデル種別を Checkpoint / LoRA / VAE / ControlNet / Upscaler / Embedding に分類し、配置先を自動選択する。
   - ダウンロード前にファイル名、サイズ、SHA-256、配置先、必要ディスク容量を表示する。
   - 取得できる場合は metadata JSON と preview thumbnail を `userdata/model-library/` に保存する。

2. **Download Manager**
   - `.part` 一時ファイル + manifest 方式で、キャンセル / 再開 / アプリ再起動後の継続を可能にする。
   - 大容量モデルは進捗、速度、残り時間、失敗理由、再試行を表示する。
   - 完了後に Model Health Scan と SHA-256 照合を走らせる。

3. **Shared Model Library**
   - Forge の実体フォルダは維持しつつ、アプリ側で `model-library-index.json` を持つ。
   - 各モデルに source(Civitai/HF/local), type, sha256, preview, metadata, installedPath, lastUsedAt, favorite を記録する。
   - 将来 ComfyUI 等を入れる場合に備え、物理コピーではなくハードリンク/シンボリックリンク/追加モデルパスのどれを使うかを設計できるようにする。

4. **Package / Launcher 管理**
   - まず Forge 1 package のみを対象にする。
   - 起動引数プリセット(`--medvram`, `--xformers` 等)、環境変数、ポート、API専用起動、ログ表示を Tools で管理する。
   - 拡張機能は enable/disable に加え、Git URL / branch / update status / last commit を一覧化する。
   - 依存修復は「壊れた拡張の pip install を再実行する」など最小単位から始める。

5. **Workspace 保存**
   - Stability Matrix の `.smproj` 相当として、独自 `.yoitoart` を定義する。
   - 保存対象: prompt / negative / params / selected model / VAE / LoRA / ADetailer / ControlNet / Upscale / input image reference / output history reference。
   - 画像本体は埋め込まず、`userdata/history` または任意ファイルへの参照を保存する。

採用しない/後回し:

- 複数 package の一括 install/update(ComfyUI, InvokeAI, SD.Next 等)は、Forge 運用が十分安定してから。
- Stability Matrix の dockable/floating panel UI をそのまま再現しない。現行の4タブ + 折りたたみパネル方針を維持する。
- Gradio UI iframe 埋め込みは引き続き見送り。

完了条件:

- モデル検索から配置、metadata保存、Health Scanまでが1つの導線で終わる。
- ダウンロード中にアプリを閉じても、次回起動時に未完了ジョブを表示して再開/破棄を選べる。
- Forge起動引数と環境変数がUIから確認でき、設定の危険変更には明示的な警告が出る。
- `.yoitoart` を保存して再読込すると、主要な生成フォームとUpscale設定が復元される。

---

## 後続計画

### Phase 10 — 編集ワークフロー

- Inpaint を独立ワークフローとして整備する。マスク描画キャンバスを実装する。
- バッチ生成を追加する。候補: `{red|blue|green}` ワイルドカード、行単位連続実行、グリッド出力。
- キャラクタープリセットを追加する。LoRA セット + base prompt + 推奨パラメータを名前付き保存する。

### Phase 11 — 開発体験

- 生成ログ JSON/CSV エクスポート。
- PNG 独自メタデータ埋込。適用 LoRA、プリセット名、アプリバージョンを入れる。
- VRAM 使用量モニタと設定警告。SDXL 1024² 以上や batch 増加時に警告する。

### Phase 12 — 配布オプション

- electron-builder のインストーラ生成とコード署名。
- GitHub Releases ベースの更新配布。
- ただし現時点の主目的は個人ゲーム開発用環境なので、配布作業は需要が明確になってから。

---

## 保留

| 項目 | 待ち条件 |
|---|---|
| ComfyUI PNG メタデータ完全対応 | 実際に ComfyUI 画像を再利用する頻度が上がったとき。 |
| Mac/Linux 対応 | Windows 以外で使う必要が出たとき。Forge 起動まわりが Windows 前提。 |
| SQLite 履歴移行 | 500 件 LRU で運用上困ったとき。 |
| 自然言語編集 | VRAM 8GB と外部 API 課金の制約が変わったとき。 |

---

## 採用見送り

| 項目 | 理由 |
|---|---|
| Forge Gradio UI iframe 埋め込み | 自前 UI 方針と衝突する。 |
| infinite-image-browsing / civitai-shortcut など重複拡張 | 履歴・Civitai 機能をアプリ側で持っている。 |
| 規約不明な画像サイトのスクレイピング | Civitai 公式 API とローカル履歴で十分に強い信号が取れる。 |

---

## 作業前チェック

```powershell
cd C:\宵灯工房アート\Yoitomoshi-Art-Generator
npm run typecheck
```

開発サーバを起動する場合:

```powershell
taskkill /F /IM electron.exe 2>$null
npm run dev
```

実機 sanity check:

1. 設定モーダルで言語を ja/en/ru/pt に切替え、主要 UI が変わる。
2. txt2img で生成し、プレビューの Upscale 直送ボタンで Upscale タブへ送れる。
3. Upscale 推奨バナーを適用し、Diffusion / Ultimate の tile 寸法が入力画像に合う。
4. Simple Upscale で実出力サイズが入力より大きく、`None/Lanczos/Nearest` 警告が機能する。
5. ADetailer 有効時に `IndexError: list assignment index out of range` が再発しない。
6. ControlNet モデルがない場合は警告、ある場合はモデル選択肢が出る。

---

## 再発防止メモ

- ADetailer payload は dicts-only を維持する。`[bool, bool, ...]` に戻さない。
- Ultimate SD upscale の `script_args` は `ui()` 戻り値順に固定する。並び替えない。
- Upscale の `denoise=0.25`, `tileOverlap=96`, `ultimateMaskBlur=16`, `ultimatePadding=64`, `ultimateSeamsFixType=3` は drift 対策の要点。
- `buildAlwaysOnScripts(state, { forUpscaleDiffusion: true })` は Upscale 専用で、PromptPanel の拡張設定を混ぜない設計を維持する。
- イベントハンドラや非同期処理の翻訳は `useT()` ではなく非フック版 `t()` を使う。
