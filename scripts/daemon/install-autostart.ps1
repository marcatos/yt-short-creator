# Register tray to start at Windows logon (light controller; daemon stays off until Start app).
# Prefers a current-user Scheduled Task; falls back to a Startup-folder shortcut.
param(
  [string]$TaskName = "yt-short-creator-tray",
  [string]$LegacyDaemonTaskName = "yt-short-creator-daemon",
  [string]$StartupShortcutName = "YT Short Creator Tray.lnk"
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\lib.ps1"
$Root = Get-DaemonRoot
$trayScript = Join-Path $PSScriptRoot "tray.ps1"
$trayArgs = "-STA -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$trayScript`""

function Remove-LegacyDaemonAutostart {
  Unregister-ScheduledTask -TaskName $LegacyDaemonTaskName -Confirm:$false -ErrorAction SilentlyContinue
  $startup = [Environment]::GetFolderPath("Startup")
  foreach ($name in @(
      "YT Short Creator Daemon.lnk",
      "yt-short-creator-daemon.lnk"
    )) {
    $legacyLnk = Join-Path $startup $name
    if (Test-Path $legacyLnk) {
      Remove-Item $legacyLnk -Force
      Write-Host "Removed legacy Startup shortcut: $legacyLnk"
    }
  }
}

function Install-ScheduledTrayTask {
  $action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument $trayArgs `
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
    -Description "YT Short Creator tray — start/stop the production daemon on demand" `
    -Force | Out-Null
}

function Install-StartupShortcut {
  $startup = [Environment]::GetFolderPath("Startup")
  $lnkPath = Join-Path $startup $StartupShortcutName
  $wsh = New-Object -ComObject WScript.Shell
  $shortcut = $wsh.CreateShortcut($lnkPath)
  $shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $shortcut.Arguments = $trayArgs
  $shortcut.WorkingDirectory = $Root
  $shortcut.WindowStyle = 7
  $shortcut.Description = "YT Short Creator tray (selective daemon start)"
  $shortcut.Save()
  return $lnkPath
}

Remove-LegacyDaemonAutostart

$legacyStillThere = $null -ne (Get-ScheduledTask -TaskName $LegacyDaemonTaskName -ErrorAction SilentlyContinue)

$mode = $null
try {
  Install-ScheduledTrayTask
  $mode = "scheduled-task:$TaskName"
  Write-Host "Scheduled task '$TaskName' registered (AtLogOn → tray)."
} catch {
  Write-Host "Scheduled task failed ($($_.Exception.Message)); falling back to Startup folder."
  $lnk = Install-StartupShortcut
  $mode = "startup-shortcut:$lnk"
  Write-Host "Startup shortcut created: $lnk"
}

Write-Host "Mode: $mode"
if ($legacyStillThere) {
  Write-Host ""
  Write-Host "WARNING: legacy task '$LegacyDaemonTaskName' is still registered and will start the FULL daemon at logon." -ForegroundColor Yellow
  Write-Host "Remove it once (elevated PowerShell or Task Scheduler):" -ForegroundColor Yellow
  Write-Host "  schtasks /Delete /TN `"$LegacyDaemonTaskName`" /F" -ForegroundColor Yellow
}
Write-Host "Remove tray autostart with: npm run daemon:uninstall-autostart"
Write-Host "Launch now: npm run daemon:tray"
