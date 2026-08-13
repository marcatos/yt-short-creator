# Restart production daemon.
. "$PSScriptRoot\lib.ps1"
& "$PSScriptRoot\stop.ps1"
& "$PSScriptRoot\start.ps1" @args
exit $LASTEXITCODE
