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

function Get-NodeExecutable {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cmd) { throw "node not found on PATH" }
  return $cmd.Source
}
