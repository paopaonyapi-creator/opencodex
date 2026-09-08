---
id: arch-knowledge-gateway
type: architecture
title: Pao Knowledge Gateway Architecture
status: active
created_at: 2026-09-08
updated_at: 2026-09-08
source_priority: 90
tags:
  - architecture
  - gateway
  - grounded-ai
---

# Pao Knowledge Gateway Architecture

## Overview
The Pao Knowledge Gateway acts as the grounded source-of-truth proxy between developer agents (Codex, Claude, ChatGPT, Local AI) and the project's living knowledge base.

## Architecture Layers
1. **Agent Router / Client Layer**: Codex, Claude, ChatGPT, and Local AI query knowledge tools via Model Context Protocol (`pao_knowledge.*`).
2. **Knowledge Gateway**: Unified query routing, claim verification, phase comparison, evidence pack construction, and risk policy evaluation.
3. **Provider Layer**:
   - `local`: SQLite-backed lexical and section search across `knowledge/` and `docs/`.
   - `git`: Safe read-only Git operations (`status`, `log`, `diff`, `grep`).
   - `notebooklm`: Optional external grounded notebook provider (disabled by default with circuit breaker).
4. **Knowledge-First Guardrail**:
   - Classifies task risk (LOW, MEDIUM, HIGH).
   - Blocks HIGH risk architecture/code mutations if evidence is insufficient (`EVIDENCE_INSUFFICIENT`).
5. **Reviewer Council Integration**: Feeds identical Evidence Packs to all council reviewers to eliminate asymmetric context bias.
