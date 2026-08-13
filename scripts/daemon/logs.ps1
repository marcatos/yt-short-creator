# Tail daemon logs (works after the start shell is closed).
param(
  [ValidateSet("web", "workers", "all")]
  [string]$Service = "all",
  [int]$Lines = 80,
  [switch]$Follow
)

. "$PSScriptRoot\lib.ps1"

$Root = Get-DaemonRoot
$DaemonDir = Get-DaemonDir -Root $Root

$targets = @()
foreach ($svc in Get-DaemonServices) {
  if ($Service -ne "all" -and $svc.Name -ne $Service) { continue }
  $targets += (Join-Path $DaemonDir $svc.OutLog)
  $targets += (Join-Path $DaemonDir $svc.ErrLog)
}

$existing = $targets | Where-Object { Test-Path $_ }
if (-not $existing) {
  Write-Host "No daemon log files yet in $DaemonDir"
  exit 1
}

if ($Follow) {
  Get-Content -Path $existing -Tail $Lines -Wait
} else {
  foreach ($path in $existing) {
    Write-Host "===== $(Split-Path $path -Leaf) ====="
    if (Test-Path $path) {
      Get-Content -Path $path -Tail $Lines
    }
    Write-Host ""
  }
}
