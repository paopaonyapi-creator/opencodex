---
id: dependency-audit
name: Dependency Audit
version: 1.0.0
description: Review dependency changes and license/security exposure
category: coding
trigger:
  type: manual
runtime:
  agent: codex
  timeout_seconds: 600
permissions:
  filesystem:
    mode: read
    paths:
      - ./
  shell:
    mode: deny
  network:
    mode: deny
approval:
  before_write: true
retry:
  max_attempts: 1
  strategy: none
tags:
  - coding
  - security
---

# Dependency Audit

## Steps

1. Diff lockfile against last known good.
2. List new direct dependencies.
3. Flag license and known-vulnerability concerns.

## Success Criteria

- Dependency risk list is produced.