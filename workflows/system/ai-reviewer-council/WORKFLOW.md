---
id: ai-reviewer-council
name: AI Reviewer Council
version: 1.0.0
description: Multi-reviewer consensus pass over a task or diff
category: system
trigger:
  type: manual
runtime:
  agent: codex
  timeout_seconds: 900
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
  - review
  - council
---

# AI Reviewer Council

## Steps

1. Collect structured context (diff, findings, evidence).
2. Run reviewer passes with distinct roles.
3. Surface disagreements explicitly.
4. Record consensus with evidence refs.

## Success Criteria

- Consensus record with evidence refs is produced.