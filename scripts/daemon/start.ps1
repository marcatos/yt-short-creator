# Start yt-short-creator in production as a detached Windows daemon.
# Shell can close; processes keep running. Monitor with: npm run daemon:status
param(
  [switch]$SkipBuild,
  [int]$Port = 3000
)

. "$PSScriptRoot\lib.ps1"

$Root = Get-DaemonRoot
$DaemonDir = Get-DaemonDir -Root $Root
Set-Location $Root
Import-DaemonEnvLocal -Root $Root
$env:NODE_ENV = "production"
$env:PORT = "$Port"
$env:WORKER_PROCESS = "1"

$node = Get-NodeExecutable
$nodeDir = Split-Path $node
$env:PATH = "$nodeDir;$env:PATH"
Write-Host "Using Node: $node ($((& $node -v).Trim()))"
& $node (Join-Path $Root "scripts\check-node-version.mjs")
if ($LASTEXITCODE -ne 0) {
  throw "This project requires Node 25. Install it from https://nodejs.org"
}
$nextBin = Join-Path $Root "node_modules\next\dist\bin\next"
$tsxBin = Join-Path $Root "node_modules\tsx\dist\cli.mjs"

if (-not (Test-Path $nextBin)) {
  throw "Next.js binary missing. Run npm install first."
}
if (-not (Test-Path $tsxBin)) {
  throw "tsx binary missing. Run npm install first."
}

# Stop previous daemon instance (if any) before starting.
& "$PSScriptRoot\stop.ps1" | Out-Host

# Rebuild native addons only after processes release better_sqlite3.node.
Ensure-NativeSqliteModule -Root $Root -Node $node

if (-not $SkipBuild -or -not (Test-Path (Join-Path $Root ".next\BUILD_ID"))) {
  Write-Host "Building production bundle..."
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit $LASTEXITCODE" }
}

function Start-DaemonService {
  param(
    [string]$Name,
    [string]$PidFile,
    [string]$OutLog,
    [string]$ErrLog,
    [string[]]$ArgumentList
  )

  $outPath = Join-Path $DaemonDir $OutLog
  $errPath = Join-Path $DaemonDir $ErrLog
  # Truncate previous run logs for a clean session.
  Set-Content -Path $outPath -Value "" -Encoding utf8
  Set-Content -Path $errPath -Value "" -Encoding utf8

  $proc = Start-Process -FilePath $node `
    -ArgumentList $ArgumentList `
    -WorkingDirectory $Root `
    -RedirectStandardOutput $outPath `
    -RedirectStandardError $errPath `
    -WindowStyle Hidden `
    -PassThru

  Set-DaemonPid -DaemonDir $DaemonDir -PidFile $PidFile -ProcessId $proc.Id
  Write-Host "Started $Name (pid $($proc.Id))"
  return $proc
}

Start-DaemonService -Name "workers" -PidFile "workers.pid" `
  -OutLog "workers.out.log" -ErrLog "workers.err.log" `
  -ArgumentList @($tsxBin, "scripts/run-workers.ts") | Out-Null

Start-DaemonService -Name "web" -PidFile "web.pid" `
  -OutLog "web.out.log" -ErrLog "web.err.log" `
  -ArgumentList @($nextBin, "start", "-H", "127.0.0.1", "-p", "$Port") | Out-Null

# Brief readiness probe (do not hang forever).
$deadline = (Get-Date).AddSeconds(45)
$ready = $false
while ((Get-Date) -lt $deadline) {
  $health = Test-DaemonHttp -Port $Port -TimeoutSec 2
  if ($health.Ok) { $ready = $true; break }
  Start-Sleep -Milliseconds 500
}

& "$PSScriptRoot\status.ps1" | Out-Host

if (-not $ready) {
  Write-Host "WARNING: web did not answer HTTP $Port yet — check: npm run daemon:logs"
  exit 1
}

Write-Host ""
Write-Host "Daemon running. You can close this shell."
Write-Host "  status : npm run daemon:status"
Write-Host "  logs   : npm run daemon:logs"
Write-Host "  stop   : npm run daemon:stop"
exit 0
