#!/usr/bin/env bash
# Phase 20.23 Smoke Test Runner (Bash)
set -e

echo "Running Phase 20.23 Smoke Tests..."
bun scripts/phase-20.23-smoke.ts
echo "Phase 20.23 Smoke tests passed successfully!"
