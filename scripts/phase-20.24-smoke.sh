#!/usr/bin/env bash
# Phase 20.24 — Pao-hubPro × OmniGet Local Media Acquisition & MCP Engine
# Bash Smoke Verification Runner

set -e
echo "Running Phase 20.24 Media Acquisition Smoke Tests via Bun..."
bun run scripts/phase-20.24-smoke.ts
echo "Phase 20.24 Smoke Verification PASSED!"
