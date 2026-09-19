#Requires -Version 5.1
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here
$envFile = Join-Path $here ".env"
if (Test-Path $envFile) {
  docker compose --env-file $envFile down
} else {
  docker compose down
}
