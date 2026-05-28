$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$electron = Join-Path $repoRoot 'node_modules\.bin\electron.cmd'
if (-not (Test-Path -LiteralPath $electron)) {
  throw "Electron launcher not found: $electron. Run npm install first."
}

$script = Join-Path $repoRoot 'scripts\init-prompt-dictionary-ingest.cjs'
$env:ELECTRON_RUN_AS_NODE = '1'
try {
  & $electron $script @args
  if ($LASTEXITCODE -ne 0) {
    throw "Prompt dictionary ingest DB init failed with exit code $LASTEXITCODE."
  }
} finally {
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
}
