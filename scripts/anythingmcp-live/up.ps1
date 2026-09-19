#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

function New-SecretHex([int]$Bytes) {
  $buffer = New-Object byte[] $Bytes
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($buffer)
  $rng.Dispose()
  return [BitConverter]::ToString($buffer).Replace("-", "").ToLowerInvariant()
}
function New-SecretText([int]$Length) {
  $chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".ToCharArray()
  $buffer = New-Object byte[] $Length
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($buffer)
  $rng.Dispose()
  return -join ($buffer | ForEach-Object { $chars[$_ % $chars.Length] })
}

$envFile = Join-Path $here ".env"
if (-not (Test-Path $envFile)) {
  $enc = New-SecretText 32
  @(
    "COMPOSE_PROJECT_NAME=pao-amcp-2096"
    "FRONTEND_PORT=13000"
    "BACKEND_PORT=14000"
    "POSTGRES_PASSWORD=$(New-SecretText 24)"
    "JWT_SECRET=$(New-SecretHex 32)"
    "ENCRYPTION_KEY=$enc"
    "MCP_BEARER_TOKEN=$(New-SecretHex 32)"
    "PAO_ANYTHINGMCP_ADMIN_EMAIL=pao-amcp-admin@example.com"
    "PAO_ANYTHINGMCP_ADMIN_PASSWORD=Pao-$(New-SecretText 18)-9!"
  ) | Set-Content -LiteralPath $envFile -Encoding ascii
  Write-Host "Wrote $envFile (gitignored). Keep ENCRYPTION_KEY; losing it invalidates stored connector credentials."
}

docker compose --env-file $envFile up -d
$url = "http://127.0.0.1:14000/health"
for ($i = 0; $i -lt 60; $i++) {
  try {
    $res = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
    if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 300) {
      Write-Host "AnythingMCP healthy at http://127.0.0.1:14000"
      Write-Host "Set PAO_ANYTHINGMCP_URL=http://127.0.0.1:14000"
      Write-Host "UI (loopback): http://127.0.0.1:13000"
      exit 0
    }
  } catch {
    Start-Sleep -Seconds 2
  }
}
Write-Error "AnythingMCP /health did not become ready on http://127.0.0.1:14000"
