---
id: project-health-check
name: Project Health Check
version: 1.0.0
description: Verify build, lint, typecheck, and test baselines
category: system
trigger:
  type: schedule
  interval_seconds: 86400
runtime:
  agent: codex
  timeout_seconds: 900
permissions:
  filesystem:
    mode: read
    paths:
      - ./
  shell:
    mode: allowlist
    commands:
      - bun
      - npm
approval:
  before_shell: true
  before_write: true
retry:
  max_attempts: 2
  strategy: exponential
  backoff_seconds: 30
concurrency:
  mode: single
tags:
  - system
  - health
---

# Project Health Check

## Steps

1. Run typecheck.
2. Run lint.
3. Run test suite.
4. Record pass/fail summary as evidence.

## Success Criteria

- Evidence entry produced with results.