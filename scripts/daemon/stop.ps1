# Stop the detached production daemon processes.
. "$PSScriptRoot\lib.ps1"

$Root = Get-DaemonRoot
$DaemonDir = Get-DaemonDir -Root $Root

foreach ($svc in Get-DaemonServices) {
  $pidValue = Get-DaemonPid -DaemonDir $DaemonDir -PidFile $svc.PidFile
  $proc = Get-DaemonProcess -ProcessId $pidValue
  if ($proc) {
    Write-Host "Stopping $($svc.Name) (pid $($proc.Id))..."
    Stop-DaemonTree -ProcessId $proc.Id
  } else {
    Write-Host "$($svc.Name): not running"
  }
  Clear-DaemonPid -DaemonDir $DaemonDir -PidFile $svc.PidFile
}

# Also clear any stray next start / workers still bound to this repo.
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object {
    $_.CommandLine -and (
      ($_.CommandLine -match 'next\\dist\\bin\\next["\s]+start' -and $_.CommandLine -match [regex]::Escape($Root)) -or
      ($_.CommandLine -match 'scripts\\run-workers\.ts' -and $_.CommandLine -match [regex]::Escape($Root))
    )
  } |
  ForEach-Object {
    Write-Host "Stopping stray pid $($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

Write-Host "Daemon stopped."
exit 0
