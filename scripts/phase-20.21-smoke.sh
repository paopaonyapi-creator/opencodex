#!/usr/bin/env bash
# Phase 20.21 — Pao-hubPro x OpenAI Codex Native Runtime Integration
# Linux/Unix Smoke Test Runner

set -e
echo "Running Phase 20.21 Smoke Test via Bun..."
bun run scripts/phase-20.21-smoke.ts
echo "Phase 20.21 Smoke Test Completed Successfully!"
