---
id: github-repository-analysis
name: GitHub Repository Analysis
version: 1.0.0
description: Inspect repository structure and summarize architecture
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
  before_shell: true
retry:
  max_attempts: 1
  strategy: fixed
  backoff_seconds: 5
tags:
  - coding
  - analysis
---

# GitHub Repository Analysis

## Steps

1. Map top-level directories and entry points.
2. Identify frameworks and runtimes.
3. Summarize architecture in plain language.

## Success Criteria

- Architecture summary is produced.