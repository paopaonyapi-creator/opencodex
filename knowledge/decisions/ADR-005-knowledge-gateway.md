---
id: adr-005
type: decision
title: ADR-005 — Knowledge Gateway Architecture
status: accepted
created_at: 2026-09-08
updated_at: 2026-09-08
source_priority: 95
tags:
  - architecture
  - knowledge
  - gateway
---

# ADR-005 — Knowledge Gateway Architecture

## Status
Accepted

## Context
As Pao-hubPro expands across multiple phases, runtime proxies, generation studio, agent councils, and desktop robotics, individual AI agents (Codex, Claude, ChatGPT, Local AI) face context drift, hallucinated dependencies, and inconsistent assumptions.

## Decision
All agents must access project knowledge through a unified abstraction: the **Pao Knowledge Gateway**.
Direct ad-hoc coupling to external providers (such as NotebookLM) or ungrounded memory assumptions is forbidden for architecture-changing decisions.

## Principles
1. **Search Before Plan**: `SEARCH → VERIFY → PLAN → REVIEW → EXECUTE → UPDATE KNOWLEDGE`.
2. **Evidence-Backed Changes**: HIGH risk tasks require a verified Evidence Pack before Reviewer Council approval.
3. **Local-First Reliability**: Local markdown and SQLite FTS serve as the primary source of truth. External providers like NotebookLM remain optional and must never crash local search upon outage.
4. **Untrusted Data Boundary**: Indexed document content is treated as untrusted data, preventing prompt-injection command execution.
5. **Strict Secret Exclusion**: `.env`, credentials, tokens, private keys, and session cookies are filtered out prior to indexing.

## Consequences
- Requires provider abstraction with `LocalKnowledgeProvider`, `GitKnowledgeProvider`, and optional `NotebookLMKnowledgeProvider`.
- Exposes 10 canonical `pao_knowledge.*` MCP tools.
- Integrates with Reviewer Council by providing identical Evidence Packs to all reviewers.
