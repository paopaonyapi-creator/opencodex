---
id: adobe-stock-image-qc
name: Adobe Stock Image QC
version: 1.0.0
description: Validate generated stock assets before export
category: adobe-stock
trigger:
  type: manual
runtime:
  agent: codex
  timeout_seconds: 600
permissions:
  filesystem:
    mode: read
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
  - qc
  - production
---

# Adobe Stock Image QC

## Steps

1. Inspect image quality.
2. Detect obvious rendering defects.
3. Validate dimensions.
4. Check metadata completeness.
5. Produce QC report.
6. Mark asset as pass, review, or reject.

## Success Criteria

- QC report is produced and asset status is set.