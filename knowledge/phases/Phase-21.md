---
id: phase-21
type: phase
title: Phase 21 — Pao Knowledge Layer × Grounded Agent Gateway
status: active
version: 1
created_at: 2026-09-08
updated_at: 2026-09-08
source_priority: 80
tags:
  - knowledge
  - gateway
  - grounded
related:
  - phase-20-4
  - phase-20-10
supersedes: []
---

# Phase 21 — Pao Knowledge Layer × Grounded Agent Gateway

## Objective
Build a local-first project knowledge system that allows Codex, Claude, ChatGPT, Local AI, and the Reviewer Council to retrieve and verify Pao-hubPro project knowledge through one stable gateway.

## Core Policy
`SEARCH → VERIFY → PLAN → REVIEW → EXECUTE → TEST → UPDATE KNOWLEDGE`

## Components
- Gateway abstraction with multi-provider failover.
- Local Markdown & SQLite document indexer.
- Sensitive content scanner blocking secrets and `.env`.
- Evidence Pack generator and claim verification engine.
- Knowledge-First Guard blocking HIGH-risk tasks without verified evidence.
- 10 canonical MCP tools (`pao_knowledge.*`).
- REST management endpoints under `/api/knowledge/*`.
