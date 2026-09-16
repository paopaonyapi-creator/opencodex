---
id: adobe-stock-trend-research
name: Adobe Stock Trend Research
version: 1.0.0
description: Research current visual trends relevant to stock content
category: adobe-stock
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
  network:
    mode: deny
  shell:
    mode: deny
approval:
  before_external_action: true
retry:
  max_attempts: 2
  strategy: linear
  backoff_seconds: 10
tags:
  - adobe-stock
  - research
---

# Adobe Stock Trend Research

## Steps

1. Collect trend signals from existing research artifacts.
2. Cluster demand signals into themes.
3. Produce a trend summary with citations.

## Success Criteria

- Trend summary with evidence refs is produced.