# Remove tray / legacy daemon autostart (Scheduled Task and Startup shortcuts).
param(
  [string]$TaskName = "yt-short-creator-tray",
  [string]$LegacyDaemonTaskName = "yt-short-creator-daemon",
  [string]$StartupShortcutName = "YT Short Creator Tray.lnk"
)

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $LegacyDaemonTaskName -Confirm:$false -ErrorAction SilentlyContinue

$startup = [Environment]::GetFolderPath("Startup")
foreach ($name in @($StartupShortcutName, "YT Short Creator Daemon.lnk", "yt-short-creator-daemon.lnk")) {
  $path = Join-Path $startup $name
  if (Test-Path $path) {
    Remove-Item $path -Force
    Write-Host "Removed Startup shortcut: $path"
  }
}

Write-Host "Autostart cleaned (tasks '$TaskName', '$LegacyDaemonTaskName' + Startup shortcuts)."
