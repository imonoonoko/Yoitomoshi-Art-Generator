# 一度だけ実行して、デスクトップに「Yoitomoshi Art Generator」ショートカットを作る
# 使い方: このファイルを右クリック → 「PowerShell で実行」、または以下を PowerShell に貼付:
#   powershell -ExecutionPolicy Bypass -File "C:\宵灯工房アート\Yoitomoshi-Art-Generator\create-desktop-shortcut.ps1"

param(
    [switch]$NoPause
)

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$batPath = Join-Path $projectDir 'Yoitomoshi.bat'
$iconPath = Join-Path $projectDir 'resources\icon.ico'
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcut = Join-Path $desktop 'Yoitomoshi Art Generator.lnk'

$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($shortcut)
$lnk.TargetPath = $batPath
$lnk.WorkingDirectory = $projectDir
$lnk.WindowStyle = 7   # 7 = 最小化で起動 (Electron 自身のウィンドウは普通に開く)
$lnk.Description = 'Yoitomoshi Art Generator'
if (Test-Path $iconPath) {
    $lnk.IconLocation = $iconPath
}
$lnk.Save()

Write-Host ""
Write-Host "デスクトップにショートカットを作成しました:" -ForegroundColor Green
Write-Host "  $shortcut"
Write-Host ""
Write-Host "ダブルクリックで Yoitomoshi Art Generator が起動します。"
if (-not $NoPause) {
    Read-Host "Enter キーで閉じる"
}
