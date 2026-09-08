# Phase 21 — Knowledge Layer & Grounded Agent Gateway Architecture

## 1. Overview
The Pao Knowledge Gateway is the authoritative, grounded source of truth for Pao-hubPro. It bridges Codex, Claude, ChatGPT, Local AI, and the Reviewer Council to prevent unverified model hallucinations, stale assumptions, and contradictory architecture changes.

## 2. Operating Policy
```text
SEARCH → VERIFY → PLAN → REVIEW → EXECUTE → TEST → UPDATE KNOWLEDGE
```

## 3. Core Subsystems
1. **PaoKnowledgeGateway**: Central entrypoint for search, claim verification, phase lookups, and evidence assembly.
2. **Provider Federation**:
   - `LocalKnowledgeProvider`: High-speed local markdown and SQLite FTS search.
   - `GitKnowledgeProvider`: Safe read-only Git history and commit context.
   - `NotebookLMKnowledgeProvider`: Optional external notebook provider with circuit breaker.
3. **Secret Exclusion & Security**: Pre-index scanner excluding `.env`, tokens, private keys, and passwords.
4. **Knowledge-First Guard**: Enforces `NO EVIDENCE = NO ARCHITECTURE CHANGE` for HIGH risk tasks.
5. **Reviewer Council Integration**: Delivers identical Evidence Packs to all council reviewers to eliminate asymmetric context bias.
