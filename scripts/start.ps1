# 全自動啟動 Composer GUI：檢查 Node → 必要時安裝依賴 → 啟動 dev server → 等待就緒 → 開啟瀏覽器。
# 用法：start.cmd [-Port 5173] [-NoBrowser] [-Check]
param(
  [int]$Port = 5173,
  [switch]$NoBrowser,
  [switch]$Check
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Fail([string]$message) {
  Write-Host "[start] 失敗：$message" -ForegroundColor Red
  exit 1
}
function Info([string]$message) { Write-Host "[start] $message" }

# 1. Node 版本須符合 Vite 7 的 engines：^20.19.0 || >=22.12.0
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { Fail '找不到 Node.js，請先安裝 Node 22.12 以上版本。' }
$nodeVersion = [version]((& node -v).TrimStart('v'))
$nodeOk = ($nodeVersion.Major -eq 20 -and $nodeVersion.Minor -ge 19) -or ($nodeVersion -ge [version]'22.12.0')
if (-not $nodeOk) { Fail "Node $nodeVersion 不符合需求（^20.19.0 或 >=22.12.0）。" }
Info "Node $nodeVersion"

# 2. 依賴：node_modules 不存在或 package-lock.json 比已安裝紀錄新時，執行 npm ci
$installed = Join-Path $root 'node_modules\.package-lock.json'
$lock = Join-Path $root 'package-lock.json'
if (-not (Test-Path $installed) -or (Get-Item $lock).LastWriteTime -gt (Get-Item $installed).LastWriteTime) {
  Info '安裝依賴（npm ci）...'
  & npm.cmd ci --no-fund --no-audit
  if ($LASTEXITCODE -ne 0) { Fail 'npm ci 失敗，請檢查網路或 package-lock.json。' }
} else {
  Info '依賴已是最新，略過安裝。'
}

# 3. 可選：啟動前執行型別檢查與測試
if ($Check) {
  Info '執行 typecheck 與 test...'
  & npm.cmd run typecheck
  if ($LASTEXITCODE -ne 0) { Fail 'typecheck 未通過。' }
  & npm.cmd test
  if ($LASTEXITCODE -ne 0) { Fail '測試未通過。' }
}

# 4. 連接埠：已有本專案 dev server 在跑就直接沿用；被其他程式占用則改用下一個可用埠
function Test-PortInUse([int]$p) {
  return [bool](Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
}
function Test-ComposerServer([int]$p) {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$p/" -UseBasicParsing -TimeoutSec 2
    return $response.Content -match 'Composer'
  } catch { return $false }
}
if ((Test-PortInUse $Port) -and (Test-ComposerServer $Port)) {
  Info "Composer 已在 http://127.0.0.1:$Port/ 執行，直接沿用。"
  if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$Port/" }
  exit 0
}
$original = $Port
while (Test-PortInUse $Port) {
  $Port++
  if ($Port -gt $original + 20) { Fail "連接埠 $original 到 $Port 都被占用。" }
}
if ($Port -ne $original) { Info "連接埠 $original 已被其他程式占用，改用 $Port。" }

# 5. 啟動 dev server，等待就緒（最多 60 秒）後開啟瀏覽器；關閉此視窗或按 Ctrl+C 即停止
$url = "http://127.0.0.1:$Port/"
Info "啟動 dev server：$url"
$server = Start-Process -FilePath 'npm.cmd' -ArgumentList @('run', 'dev', '--', '--port', "$Port", '--strictPort') -NoNewWindow -PassThru
try {
  $deadline = (Get-Date).AddSeconds(60)
  while (-not (Test-ComposerServer $Port)) {
    if ($server.HasExited) { Fail "dev server 啟動失敗（exit $($server.ExitCode)）。" }
    if ((Get-Date) -gt $deadline) { Fail 'dev server 60 秒內未就緒。' }
    Start-Sleep -Milliseconds 500
  }
  Info "就緒：$url（按 Ctrl+C 停止）"
  if (-not $NoBrowser) { Start-Process $url }
  Wait-Process -Id $server.Id
} finally {
  if (-not $server.HasExited) {
    Info '停止 dev server...'
    & taskkill.exe /PID $server.Id /T /F | Out-Null
  }
}
