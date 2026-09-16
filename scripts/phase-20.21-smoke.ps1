# Phase 20.21 — Pao-hubPro x OpenAI Codex Native Runtime Integration
# Windows PowerShell Smoke Test Runner

$ErrorActionPreference = "Stop"
Write-Host "Running Phase 20.21 Smoke Test via Bun..." -ForegroundColor Cyan
bun run scripts/phase-20.21-smoke.ts
if ($LASTEXITCODE -eq 0) {
    Write-Host "Phase 20.21 Smoke Test Completed Successfully!" -ForegroundColor Green
} else {
    Write-Host "Phase 20.21 Smoke Test Failed!" -ForegroundColor Red
    exit 1
}
