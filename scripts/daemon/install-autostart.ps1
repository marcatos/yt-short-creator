# Register a per-user Scheduled Task to start the daemon at logon.
param(
  [string]$TaskName = "yt-short-creator-daemon"
)

. "$PSScriptRoot\lib.ps1"
$Root = Get-DaemonRoot
$startScript = Join-Path $PSScriptRoot "start.ps1"

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`" -SkipBuild" `
  -WorkingDirectory $Root

$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Start yt-short-creator production daemon (web + workers)" `
  -Force | Out-Null

Write-Host "Scheduled task '$TaskName' registered (AtLogOn)."
Write-Host "Remove with: npm run daemon:uninstall-autostart"
