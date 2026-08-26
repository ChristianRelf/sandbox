$ErrorActionPreference = "Stop"
$repository = Split-Path -Parent $PSScriptRoot
$sidecar = Join-Path $repository "browser-sidecar"
$runtime = Join-Path $sidecar "runtime"
$browsers = Join-Path $sidecar "browsers"
New-Item -ItemType Directory -Force -Path $runtime, $browsers | Out-Null
$nodeExecutable = node -p "process.execPath"
Copy-Item -LiteralPath $nodeExecutable -Destination (Join-Path $runtime "node.exe") -Force
$env:PLAYWRIGHT_BROWSERS_PATH = $browsers
Push-Location $sidecar
try {
  npm.cmd install
  npm.cmd run build
  npx.cmd playwright install chromium
} finally {
  Pop-Location
}
