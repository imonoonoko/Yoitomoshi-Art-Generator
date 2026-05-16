# Launcher startup exit fix 2026-05-15

## 症状

`Yoitomoshi.bat` でbuild完了後、次のように表示されて起動失敗扱いになった。

```text
Starting app...
[!] Electron exited during startup. Recent stderr log:

[!] The app exited during startup.
    See userdata\launcher-electron.err.log
```

## 原因

既存のElectron main processが残っている状態で、ランチャーが新しいElectron processを起動した。

アプリ本体は `app.requestSingleInstanceLock()` を使っているため、2個目のElectron processは既存ウィンドウへfocus要求を送ってすぐ終了する。この終了は正常系だが、旧ランチャーは「起動後8秒以内にprocessが終了したら失敗」とだけ判定していたため、既存インスタンス起動中でも失敗表示になった。

## 採用した修正

- `scripts/launch-electron.ps1` を追加し、Electron起動前に同じproject rootの既存Electron main processを検出する。
- 既存インスタンスがある場合は2個目を一度起動して `second-instance` focusを発火させ、ランチャーは成功終了する。
- 新規起動したprocessが8秒以内に終了した場合も、同じproject rootの既存main processが存在すれば成功扱いにする。
- `Yoitomoshi.bat` からは上記PowerShell launcherを呼ぶだけに整理した。
- 既存インスタンス検出はログ追記より先に行う。Electronが標準出力ログを保持している間でも、再ランチ時にログファイルlockで失敗しないようにする。

## 検証

- 既存Electronが残った状態で `scripts/launch-electron.ps1` を実行し、成功終了することを確認。
- 既存Electronが残った状態で `Yoitomoshi.bat` を実行し、build後に「already running / focusing existing window」で成功終了することを確認。
- 全Electron停止後に `Yoitomoshi.bat` を実行し、build後のElectron起動が成功することを確認。

## 運用メモ

手動検証で `Start-Process` したElectronが残っている場合でも、ランチャーは失敗扱いにしない。完全に起動し直したい場合は、Electronを終了してから `Yoitomoshi.bat` を実行する。
