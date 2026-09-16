---
id: adobe-stock-metadata-generator
name: Adobe Stock Metadata Generator
version: 1.0.0
description: Generate title, description, and keywords for approved assets
category: adobe-stock
trigger:
  type: manual
runtime:
  agent: codex
  timeout_seconds: 600
permissions:
  filesystem:
    mode: write
    paths:
      - ./outputs
  shell:
    mode: deny
  network:
    mode: deny
approval:
  before_write: true
retry:
  max_attempts: 2
  strategy: fixed
  backoff_seconds: 5
tags:
  - adobe-stock
  - metadata
---

# Adobe Stock Metadata Generator

## Steps

1. Read approved asset metadata source.
2. Generate title and description.
3. Generate keywords within stock policy limits.
4. Write metadata draft for review.

## Success Criteria

- Metadata draft written under ./outputs for human review.