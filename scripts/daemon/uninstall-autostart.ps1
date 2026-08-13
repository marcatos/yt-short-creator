# Remove the AtLogOn scheduled task for the daemon.
param(
  [string]$TaskName = "yt-short-creator-daemon"
)

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "Scheduled task '$TaskName' removed (if it existed)."
