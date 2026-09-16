# Phase 20.23 Smoke Test Runner (PowerShell)
$ErrorActionPreference = "Stop"

Write-Host "Running Phase 20.23 Smoke Tests..." -ForegroundColor Cyan
bun scripts/phase-20.23-smoke.ts
if ($LASTEXITCODE -ne 0) {
    Write-Host "Smoke tests failed with exit code $LASTEXITCODE" -ForegroundColor Red
    exit $LASTEXITCODE
}
Write-Host "Phase 20.23 Smoke tests passed successfully!" -ForegroundColor Green
