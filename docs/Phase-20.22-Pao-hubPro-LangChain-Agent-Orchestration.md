# Phase 20.22 — Pao-hubPro × LangChain Agent Orchestration & MCP Runtime Layer

## Overview & System Mission

Phase 20.22 introduces a pluggable, high-performance **Agent Orchestration and MCP Runtime Layer** to Pao-hubPro. It integrates LangChain and LangGraph coordination paradigms with Pao-hubPro's native security boundaries, tool policy gates, Model Context Protocol (MCP) tool catalogs, Reviewer Council evaluation, and OpenAI Codex Native Runtime delegation.

### Fundamental Security Invariant
> **LangChain decides what should happen next; Pao-hubPro decides whether it is allowed to happen.**
>
> LangChain provides planning, reasoning loops, tool dispatch, and agent graph choreography. However, LangChain must never become the security boundary. Every tool invocation, filesystem mutation, terminal execution, and external MCP call passes through Pao-hubPro's strict Policy Middleware before execution.

---

## Architectural Components

```
┌────────────────────────────────────────────────────────────────────────┐
│                   Pao-hubPro Agent Orchestrator                        │
├────────────────────────────────────────────────────────────────────────┤
│  Pluggable AgentRuntime Interface (langchain | native | codex)         │
│  ┌─────────────────────────┐     ┌──────────────────────────────────┐  │
│  │   LangChain / LangGraph │     │   Native Fallback Runtime        │  │
│  │   Coordination Engine   │     │   (Zero-dependency Bun Native)   │  │
│  └────────────┬────────────┘     └─────────────────┬────────────────┘  │
│               ▼                                    ▼                   │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                  Model Router & Fallback Chain                   │  │
│  │   (Claude 3.7 Sonnet -> Haiku -> GPT-4o -> Local / Simulated)    │  │
│  └────────────────────────────┬─────────────────────────────────────┘  │
│                               ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                 Tool Policy & Risk Middleware                    │  │
│  │  - Risk Classification (R0: Harmless Read to R4: Privileged)     │  │
│  │  - Safe Workspace Containment (Blocks Directory Traversal)       │  │
│  │  - Command Sanitization (Blocks rm -rf /, fork bombs, dd)        │  │
│  │  - Secret Redaction (API keys, PATs, AWS, DB credentials)        │  │
│  └──────────────┬───────────────────────────────┬───────────────────┘  │
│                 ▼                               ▼                      │
│  ┌──────────────────────────────┐  ┌────────────────────────────────┐  │
│  │   Bounded Approval Bridge    │  │   Reviewer Council Bridge      │  │
│  │   (Headless Safety with TTL) │  │   (Governance strictly 'off')  │  │
│  └──────────────┬───────────────┘  └────────────────┬───────────────┘  │
│                 ▼                                   ▼                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                 Execution & Safeguard Middleware                 │  │
│  │   - Model Call Limit (25)    - Tool Call Limit (50)              │  │
│  │   - Timeout Guard (300s)     - Loop Oscillation Guard (3x)       │  │
│  │   - Checkpoint Snapshots     - Token & Cost Tracking             │  │
│  └────────────────────────────┬─────────────────────────────────────┘  │
│                               ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │             Multi-Server MCP Tool Provider & Catalog             │  │
│  │   [trusted_internal] [trusted_local] [approved_third_party]      │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Tool Risk Classification Matrix

| Risk Tier | Category | Default Action | Description |
| :--- | :--- | :--- | :--- |
| **R0** | Harmless Read | `ALLOW` | Read file, inspect directory, help, version, read status |
| **R1** | State Query | `ALLOW` | Web search, API read queries, database SELECT, telemetry |
| **R2** | State Modification | `ALLOW` / `APPROVAL` | File creation/edit inside workspace (`ALLOW`); outside workspace (`APPROVAL_REQUIRED`) |
| **R3** | Execution / Destructive | `APPROVAL_REQUIRED` | Terminal commands, shell scripts, package installation, test execution |
| **R4** | Privileged / Infra | `COUNCIL_REQUIRED` | Process termination, credential mutation, system modifications, DB drops |

---

## Headless Safety & Bounded Approvals

In automated headless CI or background pipeline runs, agent executions cannot block indefinitely on human input. The `ApprovalBridge` introduces a **strict bounded TTL** (default 60 seconds, configurable up to 1 hour):
- If the operator approves or rejects within the TTL window, the execution continues accordingly.
- If the TTL expires without operator action, the approval status transitions to `timed_out` and the run fails safely with `ERR_TIMEOUT` rather than leaking resources or hanging forever.

---

## Database Persistence (Schema Version 28)

Six additive tables are introduced in `agent-os.sqlite3`:
1. `orchestration_runs`: Tracks run ID, prompts, runtime engine, token usage, cost USD, status, and output.
2. `orchestration_events`: Fine-grained event ledger recording sequence number, event type, tokens, latency, and payloads.
3. `orchestration_checkpoints`: Serialized step states with SHA-256 state hashing and secret redaction.
4. `orchestration_approvals`: Human-in-the-loop pending approval queue with risk ratings and TTL timestamps.
5. `orchestration_tool_calls`: Audit record of every MCP tool executed or denied.
6. `orchestration_mcp_servers`: Catalog of registered MCP servers, transport types, and trust levels.

---

## Operational Controls & Rollback

- **Instant Rollback Toggle**: Setting `PAO_LANGCHAIN_ENABLED=0` in the environment automatically routes all orchestration requests to the zero-dependency `NativeAgentRuntime`.
- **Status CLI**: `bun scripts/orchestration-status.ts`
- **Smoke Verification**: `bun scripts/phase-20.22-smoke.ts`
- **Web GUI**: Accessible at `/#agent-orchestrator` in the Pao-hubPro Dashboard.
