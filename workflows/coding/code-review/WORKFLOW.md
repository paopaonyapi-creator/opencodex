---
id: code-review
name: Structured Code Review
version: 1.0.0
description: Review a diff for correctness, security, and tests
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
  - review
---

# Structured Code Review

## Steps

1. Collect the current diff.
2. Review correctness and error handling.
3. Review security-sensitive surfaces.
4. Check test coverage of changed behavior.

## Success Criteria

- Review findings cite file and line evidence.