# Show daemon status without needing the original start shell (supervisord-style).
. "$PSScriptRoot\lib.ps1"

$Root = Get-DaemonRoot
$DaemonDir = Get-DaemonDir -Root $Root
$allOk = $true

Write-Host "yt-short-creator daemon status"
Write-Host "root: $Root"
Write-Host "state: $DaemonDir"
Write-Host ""

foreach ($svc in Get-DaemonServices) {
  $pidValue = Get-DaemonPid -DaemonDir $DaemonDir -PidFile $svc.PidFile
  $proc = Get-DaemonProcess -ProcessId $pidValue
  if ($proc) {
    $memMb = [math]::Round($proc.WorkingSet64 / 1MB)
    $cpu = [math]::Round($proc.CPU, 1)
    Write-Host ("{0,-8} RUNNING  pid={1,-6} mem={2}MB cpu={3}s  ({4})" -f $svc.Name, $proc.Id, $memMb, $cpu, $svc.Label)
  } else {
    $allOk = $false
    $shown = if ($pidValue) { "stale pid=$pidValue" } else { "no pid file" }
    Write-Host ("{0,-8} STOPPED  {1}  ({2})" -f $svc.Name, $shown, $svc.Label)
  }
}

Write-Host ""
$health = Test-DaemonHttp -Port 3000 -TimeoutSec 4
if ($health.Ok) {
  Write-Host "http://127.0.0.1:3000  OK ($($health.StatusCode))"
} else {
  $allOk = $false
  Write-Host "http://127.0.0.1:3000  DOWN ($($health.Error))"
}

if ($allOk) { exit 0 } else { exit 1 }
