$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  throw 'Node.js was not found on PATH.'
}

$script = Join-Path $repoRoot 'scripts\review-prompt-dictionary-meanings.cjs'
& $node.Source --no-warnings $script @args
if ($LASTEXITCODE -ne 0) {
  throw "Prompt dictionary meaning review failed with exit code $LASTEXITCODE."
}
