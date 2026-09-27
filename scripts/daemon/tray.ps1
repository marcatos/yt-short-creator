# System-tray controller for the production daemon.
# Starts light at logon; operator starts/stops the app on demand.
# Requires STA: powershell -STA -NoProfile -WindowStyle Hidden -File tray.ps1
param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$script:TrayStartedAt = Get-Date

. "$PSScriptRoot\lib.ps1"

$Root = Get-DaemonRoot
$DaemonDir = Get-DaemonDir -Root $Root
$TrayLog = Join-Path $DaemonDir "tray.log"
$TrayPidFile = "tray.pid"
$DeskUrl = "http://127.0.0.1:3000/"
$MutexName = "Local\yt-short-creator-tray"

function Write-TrayLog {
  param(
    [ValidateSet("DEBUG", "INFO", "WARN", "ERROR")]
    [string]$Level = "INFO",
    [Parameter(Mandatory)][string]$Message
  )
  $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss.fff")
  $line = "[$ts] [$Level] $Message"
  Add-Content -Path $TrayLog -Value $line -Encoding utf8
}

function Get-DaemonRunningState {
  $webPid = Get-DaemonPid -DaemonDir $DaemonDir -PidFile "web.pid"
  $workersPid = Get-DaemonPid -DaemonDir $DaemonDir -PidFile "workers.pid"
  $web = Get-DaemonProcess -ProcessId $webPid
  $workers = Get-DaemonProcess -ProcessId $workersPid
  $http = Test-DaemonHttp -Port 3000 -TimeoutSec 2
  return @{
    Web = [bool]$web
    Workers = [bool]$workers
    HttpOk = [bool]$http.Ok
    Running = ([bool]$web -and [bool]$workers)
  }
}

function Format-StatusText {
  param($State)
  if ($script:Busy) { return "YTSC — busy…" }
  if ($State.Running -and $State.HttpOk) { return "YTSC — RUNNING" }
  if ($State.Web -or $State.Workers) { return "YTSC — partial" }
  return "YTSC — STOPPED"
}

# Single instance
$script:Mutex = $null
$createdNew = $false
try {
  $script:Mutex = New-Object System.Threading.Mutex($true, $MutexName, [ref]$createdNew)
} catch {
  Write-TrayLog -Level ERROR -Message "Mutex create failed: $($_.Exception.Message)"
  exit 1
}
if (-not $createdNew -and -not $Force) {
  Write-Host "Tray already running (mutex $MutexName). Use -Force only after clearing a stale instance."
  exit 0
}

Set-DaemonPid -DaemonDir $DaemonDir -PidFile $TrayPidFile -ProcessId $PID
Write-TrayLog -Level INFO -Message "Tray starting pid=$PID root=$Root"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

if (-not ("YtscTrayIconUtil" -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

public static class YtscTrayIconUtil {
  [DllImport("user32.dll", CharSet = CharSet.Auto)]
  private static extern bool DestroyIcon(IntPtr handle);

  public static Icon MakeDot(Color fill) {
    using (var bmp = new Bitmap(16, 16)) {
      using (var g = Graphics.FromImage(bmp)) {
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(Color.Transparent);
        using (var brush = new SolidBrush(fill)) {
          g.FillEllipse(brush, 1, 1, 13, 13);
        }
        using (var pen = new Pen(Color.FromArgb(220, 30, 30, 30), 1)) {
          g.DrawEllipse(pen, 1, 1, 13, 13);
        }
      }
      IntPtr hIcon = bmp.GetHicon();
      try {
        using (Icon tmp = Icon.FromHandle(hIcon)) {
          return (Icon)tmp.Clone();
        }
      } finally {
        DestroyIcon(hIcon);
      }
    }
  }
}
"@ -ReferencedAssemblies System.Drawing
}

$script:Busy = $false
$script:ActionProc = $null
$script:Icons = @{}

$script:Icons["running"] = [YtscTrayIconUtil]::MakeDot([System.Drawing.Color]::FromArgb(255, 46, 167, 88))
$script:Icons["stopped"] = [YtscTrayIconUtil]::MakeDot([System.Drawing.Color]::FromArgb(255, 96, 100, 108))
$script:Icons["busy"] = [YtscTrayIconUtil]::MakeDot([System.Drawing.Color]::FromArgb(255, 245, 158, 11))
$script:Icons["partial"] = [YtscTrayIconUtil]::MakeDot([System.Drawing.Color]::FromArgb(255, 234, 88, 12))

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Visible = $true
$notify.Text = "YTSC — starting…"

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$miOpen = $menu.Items.Add("Open desk")
$miSep1 = $menu.Items.Add("-")
$miStart = $menu.Items.Add("Start app")
$miStop = $menu.Items.Add("Stop app")
$miRestart = $menu.Items.Add("Restart app")
$miSep2 = $menu.Items.Add("-")
$miStatus = $menu.Items.Add("Show status")
$miLogs = $menu.Items.Add("Open logs folder")
$miSep3 = $menu.Items.Add("-")
$miExit = $menu.Items.Add("Exit tray (keep app)")
$notify.ContextMenuStrip = $menu

$form = New-Object System.Windows.Forms.Form
$form.Text = "YTSC tray"
$form.ShowInTaskbar = $false
$form.WindowState = [System.Windows.Forms.FormWindowState]::Minimized
$form.Opacity = 0
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedToolWindow
$form.Size = New-Object System.Drawing.Size 0, 0

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 3000

function Update-TrayUi {
  $state = Get-DaemonRunningState
  $text = Format-StatusText -State $state
  # NotifyIcon.Text max ~63 chars
  if ($text.Length -gt 63) { $text = $text.Substring(0, 63) }
  $notify.Text = $text

  if ($script:Busy) {
    $notify.Icon = $script:Icons["busy"]
  } elseif ($state.Running -and $state.HttpOk) {
    $notify.Icon = $script:Icons["running"]
  } elseif ($state.Web -or $state.Workers) {
    $notify.Icon = $script:Icons["partial"]
  } else {
    $notify.Icon = $script:Icons["stopped"]
  }

  $miStart.Enabled = (-not $script:Busy -and -not $state.Running)
  $miStop.Enabled = (-not $script:Busy -and ($state.Web -or $state.Workers))
  $miRestart.Enabled = (-not $script:Busy)
  $miOpen.Enabled = $true
}

function Show-Balloon {
  param([string]$Title, [string]$Text, [System.Windows.Forms.ToolTipIcon]$Icon = "Info")
  $notify.BalloonTipTitle = $Title
  $notify.BalloonTipText = $Text
  $notify.BalloonTipIcon = $Icon
  $notify.ShowBalloonTip(4000)
}

function Start-DaemonAction {
  param(
    [ValidateSet("start", "stop", "restart")]
    [string]$Action
  )
  if ($script:Busy) {
    Show-Balloon -Title "YTSC" -Text "Already busy…" -Icon Warning
    return
  }

  $scriptPath = switch ($Action) {
    "start" { Join-Path $PSScriptRoot "start.ps1" }
    "stop" { Join-Path $PSScriptRoot "stop.ps1" }
    "restart" { Join-Path $PSScriptRoot "restart.ps1" }
  }
  $args = "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
  if ($Action -eq "start") {
    $args += " -SkipBuild"
  }

  $script:Busy = $true
  Write-TrayLog -Level INFO -Message "Action=$Action starting"
  Show-Balloon -Title "YTSC" -Text ("{0} in progress…" -f $Action) -Icon Info
  Update-TrayUi

  $outLog = Join-Path $DaemonDir ("tray-action-{0}.out.log" -f $Action)
  $errLog = Join-Path $DaemonDir ("tray-action-{0}.err.log" -f $Action)
  Set-Content -Path $outLog -Value "" -Encoding utf8
  Set-Content -Path $errLog -Value "" -Encoding utf8

  $script:ActionProc = Start-Process -FilePath "powershell.exe" `
    -ArgumentList $args `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -PassThru `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog

  Write-TrayLog -Level INFO -Message "Action=$Action spawned pid=$($script:ActionProc.Id)"
}

function Complete-DaemonActionIfFinished {
  if (-not $script:ActionProc) { return }
  if (-not $script:ActionProc.HasExited) { return }

  $exitCode = $script:ActionProc.ExitCode
  $pidDone = $script:ActionProc.Id
  $script:ActionProc = $null
  $script:Busy = $false

  $state = Get-DaemonRunningState
  $elapsedMs = [int]((Get-Date) - $script:TrayStartedAt).TotalMilliseconds
  Write-TrayLog -Level INFO -Message "Action process pid=$pidDone exited=$exitCode running=$($state.Running) http=$($state.HttpOk) trayUptimeMs=$elapsedMs"

  if ($exitCode -ne 0) {
    Show-Balloon -Title "YTSC" -Text "Action failed (exit $exitCode). See data/daemon/tray-action-*.log" -Icon Error
  } elseif ($state.Running -and $state.HttpOk) {
    Show-Balloon -Title "YTSC" -Text "App RUNNING — $DeskUrl" -Icon Info
  } elseif (-not $state.Web -and -not $state.Workers) {
    Show-Balloon -Title "YTSC" -Text "App STOPPED" -Icon Info
  } else {
    Show-Balloon -Title "YTSC" -Text "Partial state — check daemon:status" -Icon Warning
  }
  Update-TrayUi
}

$miOpen.Add_Click({
  Write-TrayLog -Level INFO -Message "Open desk $DeskUrl"
  Start-Process $DeskUrl
})

$miStart.Add_Click({ Start-DaemonAction -Action start })
$miStop.Add_Click({ Start-DaemonAction -Action stop })
$miRestart.Add_Click({ Start-DaemonAction -Action restart })

$miStatus.Add_Click({
  $state = Get-DaemonRunningState
  $msg = "web=$($state.Web) workers=$($state.Workers) http=$($state.HttpOk)"
  Write-TrayLog -Level INFO -Message "Status $msg"
  Show-Balloon -Title (Format-StatusText -State $state) -Text $msg -Icon Info
  Update-TrayUi
})

$miLogs.Add_Click({
  Write-TrayLog -Level INFO -Message "Open logs folder $DaemonDir"
  Start-Process explorer.exe -ArgumentList $DaemonDir
})

$miExit.Add_Click({
  Write-TrayLog -Level INFO -Message "Exit tray requested (daemon left as-is)"
  $form.Close()
})

$notify.Add_DoubleClick({
  Start-Process $DeskUrl
})

$timer.Add_Tick({
  try {
    Complete-DaemonActionIfFinished
    Update-TrayUi
  } catch {
    Write-TrayLog -Level ERROR -Message "Timer tick failed: $($_.Exception.Message)"
  }
})

$form.Add_Shown({
  $form.Hide()
  Update-TrayUi
  $timer.Start()
  Write-TrayLog -Level INFO -Message "Tray UI ready"
  Show-Balloon -Title "YT Short Creator" -Text "Tray ready. Start the app from the menu when you need it." -Icon Info
})

$form.Add_FormClosed({
  $timer.Stop()
  $timer.Dispose()
  $notify.Visible = $false
  $notify.Dispose()
  foreach ($key in @($script:Icons.Keys)) {
    $script:Icons[$key].Dispose()
  }
  Clear-DaemonPid -DaemonDir $DaemonDir -PidFile $TrayPidFile
  if ($script:Mutex) {
    try { $script:Mutex.ReleaseMutex() } catch { }
    $script:Mutex.Dispose()
  }
  $totalMs = [int]((Get-Date) - $script:TrayStartedAt).TotalMilliseconds
  Write-TrayLog -Level INFO -Message "Tray stopped after ${totalMs}ms"
})

try {
  [System.Windows.Forms.Application]::Run($form)
  exit 0
} catch {
  Write-TrayLog -Level ERROR -Message "Tray crashed: $($_.Exception.Message)"
  throw
}
