@echo off
setlocal
title Yoitomoshi Art Generator

cd /d "%~dp0"

echo.
echo ============================================
echo   Yoitomoshi Art Generator
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [!] Node.js was not found.
    echo     Install the LTS version from https://nodejs.org/
    echo     Then restart Windows and run this file again.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
echo Node.js: %NODE_VER%
echo Project: %~dp0
echo.

echo --------------------------------------------
echo Checking npm packages...
echo --------------------------------------------
call npm install --no-audit --no-fund
if errorlevel 1 (
    echo.
    echo [!] npm install failed.
    echo     Check your network, VPN, or proxy settings.
    echo.
    pause
    exit /b 1
)
echo.

if not exist "node_modules\electron\dist\electron.exe" (
    echo.
    echo [!] Electron was not found after npm install.
    echo.
    pause
    exit /b 1
)

echo --------------------------------------------
echo Building latest source...
echo --------------------------------------------
call npm run build
if errorlevel 1 (
    echo.
    echo [!] Build failed. See the log above.
    echo.
    pause
    exit /b 1
)
echo.

echo Starting app...
if not exist "%~dp0userdata" mkdir "%~dp0userdata"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$root=(Resolve-Path '.').Path; $exe=Join-Path $root 'node_modules\electron\dist\electron.exe'; $out=Join-Path $root 'userdata\launcher-electron.out.log'; $err=Join-Path $root 'userdata\launcher-electron.err.log'; Add-Content -LiteralPath $out ('--- launch ' + (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + ' ---'); Add-Content -LiteralPath $err ('--- launch ' + (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + ' ---'); $p=Start-Process -FilePath $exe -ArgumentList @($root) -WorkingDirectory $root -RedirectStandardOutput $out -RedirectStandardError $err -PassThru; Start-Sleep -Seconds 8; if($p.HasExited){ Write-Host '[!] Electron exited during startup. Recent stderr log:'; if(Test-Path $err){ Get-Content -LiteralPath $err -Tail 40 }; exit 1 }; exit 0"
if errorlevel 1 (
    echo.
    echo [!] The app exited during startup.
    echo     See userdata\launcher-electron.err.log
    echo.
    pause
    exit /b 1
)

exit /b 0
