param(
  [string]$Root = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'

$rootPath = (Resolve-Path -LiteralPath $Root).Path
$exe = Join-Path $rootPath 'node_modules\electron\dist\electron.exe'
$logDir = Join-Path $rootPath 'userdata'
$outLog = Join-Path $logDir 'launcher-electron.out.log'
$errLog = Join-Path $logDir 'launcher-electron.err.log'

function Get-YoitomoshiElectronMainProcess {
  Get-CimInstance Win32_Process -Filter "name = 'electron.exe'" |
    Where-Object {
      $cmd = $_.CommandLine
      $cmd -and $cmd.Contains($rootPath) -and ($cmd -notmatch '--type=')
    }
}

$existing = @(Get-YoitomoshiElectronMainProcess)
if ($existing.Count -gt 0) {
  Write-Host '[i] Yoitomoshi Art Generator is already running. Focusing existing window...'
  Start-Process -FilePath $exe `
    -ArgumentList @($rootPath) `
    -WorkingDirectory $rootPath | Out-Null
  Start-Sleep -Seconds 2
  exit 0
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Add-Content -LiteralPath $outLog ('--- launch ' + (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + ' ---')
Add-Content -LiteralPath $errLog ('--- launch ' + (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + ' ---')

$process = Start-Process -FilePath $exe `
  -ArgumentList @($rootPath) `
  -WorkingDirectory $rootPath `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -PassThru

Start-Sleep -Seconds 8
if ($process.HasExited) {
  $existingAfterExit = @(Get-YoitomoshiElectronMainProcess | Where-Object { $_.ProcessId -ne $process.Id })
  if ($existingAfterExit.Count -gt 0) {
    Write-Host '[i] Existing app instance is running.'
    exit 0
  }

  Write-Host '[!] Electron exited during startup. Recent stderr log:'
  if (Test-Path -LiteralPath $errLog) {
    Get-Content -LiteralPath $errLog -Tail 40
  }
  exit 1
}

exit 0
