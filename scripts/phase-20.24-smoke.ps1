# Phase 20.24 — Pao-hubPro × OmniGet Local Media Acquisition & MCP Engine
# PowerShell Smoke Verification Runner

$ErrorActionPreference = "Stop"
Write-Host "Running Phase 20.24 Media Acquisition Smoke Tests via Bun..." -ForegroundColor Cyan
bun run scripts/phase-20.24-smoke.ts
if ($LASTEXITCODE -eq 0) {
    Write-Host "Phase 20.24 Smoke Verification PASSED!" -ForegroundColor Green
} else {
    Write-Host "Phase 20.24 Smoke Verification FAILED!" -ForegroundColor Red
    exit 1
}
