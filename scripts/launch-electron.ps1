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

function Add-WindowInterop {
  $code = @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public class YoitomoshiLauncherNative {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);

  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
}
'@
  Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue
}

function Show-YoitomoshiElectronWindow {
  param(
    [object[]]$Processes
  )

  $ids = @($Processes | ForEach-Object { [int]$_.ProcessId })
  if ($ids.Count -eq 0) {
    return $false
  }

  Add-WindowInterop
  $script:yoitomoshiLauncherWindowShown = $false

  [YoitomoshiLauncherNative]::EnumWindows({
    param($hWnd, $lParam)

    $windowProcessId = 0
    [void][YoitomoshiLauncherNative]::GetWindowThreadProcessId($hWnd, [ref]$windowProcessId)
    if ($ids -notcontains $windowProcessId) {
      return $true
    }

    $titleBuffer = New-Object System.Text.StringBuilder 512
    [void][YoitomoshiLauncherNative]::GetWindowText($hWnd, $titleBuffer, $titleBuffer.Capacity)

    $rect = New-Object YoitomoshiLauncherNative+RECT
    [void][YoitomoshiLauncherNative]::GetWindowRect($hWnd, [ref]$rect)
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    $title = $titleBuffer.ToString()

    $looksLikeMainWindow = $title -like '*Yoitomoshi*' -or ($width -ge 900 -and $height -ge 500)
    if (-not $looksLikeMainWindow) {
      return $true
    }

    # 9 = SW_RESTORE, 5 = SW_SHOW. Use both paths because QA launches can leave
    # Chromium's native window hidden without Electron receiving a minimize event.
    if ([YoitomoshiLauncherNative]::IsIconic($hWnd)) {
      [void][YoitomoshiLauncherNative]::ShowWindow($hWnd, 9)
    } else {
      [void][YoitomoshiLauncherNative]::ShowWindow($hWnd, 5)
    }
    [void][YoitomoshiLauncherNative]::SetForegroundWindow($hWnd)
    $script:yoitomoshiLauncherWindowShown = $true
    return $true
  }, [IntPtr]::Zero) | Out-Null

  return $script:yoitomoshiLauncherWindowShown
}

$existing = @(Get-YoitomoshiElectronMainProcess)
if ($existing.Count -gt 0) {
  Write-Host '[i] Yoitomoshi Art Generator is already running. Focusing existing window...'
  if (Show-YoitomoshiElectronWindow -Processes $existing) {
    exit 0
  }

  Start-Process -FilePath $exe `
    -ArgumentList @($rootPath) `
    -WorkingDirectory $rootPath | Out-Null
  Start-Sleep -Seconds 2
  $existingAfterFocus = @(Get-YoitomoshiElectronMainProcess)
  [void](Show-YoitomoshiElectronWindow -Processes $existingAfterFocus)
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
