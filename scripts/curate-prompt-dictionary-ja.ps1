$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$script = Join-Path $repoRoot 'scripts\curate-prompt-dictionary-ja.cjs'

& node $script @args
if ($LASTEXITCODE -ne 0) {
  throw "Prompt dictionary Japanese curation failed with exit code $LASTEXITCODE."
}
