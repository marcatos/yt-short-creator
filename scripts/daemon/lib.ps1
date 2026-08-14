# Shared helpers for the Windows production daemon (supervisord-style).

$ErrorActionPreference = "Stop"

function Get-DaemonRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

function Get-DaemonDir {
  param([string]$Root)
  $dir = Join-Path $Root "data\daemon"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  return $dir
}

function Get-DaemonServices {
  return @(
    @{
      Name = "web"
      Label = "Next.js (production)"
      PidFile = "web.pid"
      OutLog = "web.out.log"
      ErrLog = "web.err.log"
      Port = 3000
    },
    @{
      Name = "workers"
      Label = "Job workers"
      PidFile = "workers.pid"
      OutLog = "workers.out.log"
      ErrLog = "workers.err.log"
      Port = $null
    }
  )
}

function Import-DaemonEnvLocal {
  param([string]$Root)
  $envPath = Join-Path $Root ".env.local"
  if (-not (Test-Path $envPath)) { return }
  foreach ($line in Get-Content $envPath) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
    $eq = $trimmed.IndexOf("=")
    if ($eq -lt 1) { continue }
    $key = $trimmed.Substring(0, $eq).Trim()
    $value = $trimmed.Substring($eq + 1).Trim()
    if (-not $key) { continue }
    Set-Item -Path "Env:$key" -Value $value
  }
}

function Get-DaemonPid {
  param([string]$DaemonDir, [string]$PidFile)
  $path = Join-Path $DaemonDir $PidFile
  if (-not (Test-Path $path)) { return $null }
  $raw = (Get-Content $path -Raw).Trim()
  if ($raw -notmatch '^\d+$') { return $null }
  return [int]$raw
}

function Set-DaemonPid {
  param([string]$DaemonDir, [string]$PidFile, [int]$ProcessId)
  Set-Content -Path (Join-Path $DaemonDir $PidFile) -Value $ProcessId -Encoding ascii
}

function Clear-DaemonPid {
  param([string]$DaemonDir, [string]$PidFile)
  $path = Join-Path $DaemonDir $PidFile
  if (Test-Path $path) { Remove-Item $path -Force }
}

function Get-DaemonProcess {
  param([Nullable[int]]$ProcessId)
  if (-not $ProcessId) { return $null }
  return Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
}

function Test-DaemonHttp {
  param([int]$Port = 3000, [int]$TimeoutSec = 3)
  try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -TimeoutSec $TimeoutSec -UseBasicParsing
    return @{ Ok = $true; StatusCode = [int]$resp.StatusCode }
  } catch {
    return @{ Ok = $false; StatusCode = 0; Error = $_.Exception.Message }
  }
}

function Stop-DaemonTree {
  param([int]$ProcessId)
  # Kill process and any direct children (npm/cmd wrappers if present).
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessId -eq $ProcessId -or $_.ParentProcessId -eq $ProcessId } |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Test-EditorBundledNode {
  param([string]$Path)
  return $Path -match '(?i)[\\/](cursor|microsoft vs code)[\\/]resources[\\/]app[\\/]resources[\\/]helpers[\\/]node\.exe$'
}

function Get-NodeExecutable {
  $official = Join-Path ${env:ProgramFiles} "nodejs\node.exe"
  if (Test-Path $official) {
    return $official
  }

  $candidates = @(Get-Command node -All -ErrorAction SilentlyContinue | ForEach-Object { $_.Source })
  $usable = $candidates | Where-Object { -not (Test-EditorBundledNode -Path $_) } | Select-Object -First 1
  if ($usable) { return $usable }

  if ($candidates.Count -gt 0) {
    throw "Only editor-bundled Node.js was found. Install Node.js from https://nodejs.org and retry."
  }
  throw "node not found on PATH"
}

function Test-BetterSqlite3Loads {
  param([string]$Root, [string]$Node)
  # require() only loads the JS wrapper; the native .node is opened on Database().
  $probeJs = Join-Path $PSScriptRoot "probe-sqlite.js"
  $out = Join-Path $env:TEMP "yt-short-creator-sqlite-probe.out.log"
  $err = Join-Path $env:TEMP "yt-short-creator-sqlite-probe.err.log"
  $proc = Start-Process -FilePath $Node `
    -ArgumentList @($probeJs) `
    -WorkingDirectory $Root `
    -Wait -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $out `
    -RedirectStandardError $err
  return ($proc.ExitCode -eq 0)
}

function Ensure-NativeSqliteModule {
  param([string]$Root, [string]$Node)

  $addon = Join-Path $Root "node_modules\better-sqlite3"
  if (-not (Test-Path $addon)) {
    throw "better-sqlite3 is not installed. Run npm install first."
  }

  $nodeVersion = (& $Node -v).Trim()
  if (Test-BetterSqlite3Loads -Root $Root -Node $Node) {
    Write-Host "better-sqlite3 OK ($nodeVersion)"
    return
  }

  $started = Get-Date
  Write-Host "better-sqlite3 ABI mismatch. Rebuilding against $nodeVersion..."

  $nodeDir = Split-Path $Node
  $npmCmd = Join-Path $nodeDir "npm.cmd"
  if (-not (Test-Path $npmCmd)) {
    throw "npm.cmd not found next to $Node"
  }

  $savedPath = $env:PATH
  $env:PATH = "$nodeDir;$savedPath"
  try {
    & $npmCmd rebuild better-sqlite3
    if ($LASTEXITCODE -ne 0) {
      throw "npm rebuild better-sqlite3 failed with exit $LASTEXITCODE"
    }
  } finally {
    $env:PATH = $savedPath
  }

  if (-not (Test-BetterSqlite3Loads -Root $Root -Node $Node)) {
    throw "better-sqlite3 still fails to load after rebuild (Node $nodeVersion)."
  }

  $elapsedMs = [int]((Get-Date) - $started).TotalMilliseconds
  Write-Host "better-sqlite3 rebuilt in ${elapsedMs}ms ($nodeVersion)"
}
