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

$envMap = @{}
if (Test-Path $envFile) {
  Get-Content -LiteralPath $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
      $parts = $line.Split("=", 2)
      $envMap[$parts[0].Trim()] = $parts[1].Trim()
    }
  }
}
$backendPort = if ($env:BACKEND_PORT) { $env:BACKEND_PORT } elseif ($envMap.ContainsKey("BACKEND_PORT")) { $envMap["BACKEND_PORT"] } else { "14000" }
$frontendPort = if ($env:FRONTEND_PORT) { $env:FRONTEND_PORT } elseif ($envMap.ContainsKey("FRONTEND_PORT")) { $envMap["FRONTEND_PORT"] } else { "13000" }
$url = "http://127.0.0.1:$backendPort/health"

try {
  docker compose --env-file $envFile up -d
  if ($LASTEXITCODE -ne 0) { throw "docker compose up failed with exit code $LASTEXITCODE" }
  $healthy = $false
  for ($i = 0; $i -lt 60; $i++) {
    try {
      $res = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
      if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 300) {
        $healthy = $true
        break
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  if (-not $healthy) {
    throw "AnythingMCP /health did not become ready on $url"
  }
  Write-Host "AnythingMCP healthy at http://127.0.0.1:$backendPort"
  Write-Host "Set PAO_ANYTHINGMCP_URL=http://127.0.0.1:$backendPort"
  Write-Host "UI (loopback): http://127.0.0.1:$frontendPort"
  exit 0
} catch {
  Write-Warning "Startup failed: $_. Cleaning up containers..."
  docker compose --env-file $envFile down
  throw $_
}
