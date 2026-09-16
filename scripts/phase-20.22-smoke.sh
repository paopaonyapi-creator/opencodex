#!/usr/bin/env bash
# Phase 20.22 Smoke Test Runner (Bash)
set -e

echo "Running Phase 20.22 Smoke Tests..."
bun scripts/phase-20.22-smoke.ts
echo "Phase 20.22 Smoke tests passed successfully!"
