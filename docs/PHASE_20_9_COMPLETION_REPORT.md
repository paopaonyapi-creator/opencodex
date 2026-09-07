# Phase 20.9: Pao-hubPro × Chatbox Agent Desktop Runtime — Completion Report

**Status:** Completed & Certified  
**Date:** September 8, 2026  
**Architecture Line:** Bun-Native TypeScript (`dev` integration branch)  
**Schema Version:** Agent OS Schema v15  
**Verification Suite:** 26 / 26 passing tests (`tests/chatbox-agent-desktop-runtime.test.ts`)  

---

## 1. Executive Summary

Phase 20.9 delivers the **Pao-hubPro × Chatbox Agent Desktop Runtime**: an enterprise-grade autonomous operating layer that combines desktop-level multi-model agent execution, pre-spawn Model Context Protocol (MCP) process gateways, hierarchical policy governance, and multi-model Reviewer Council oversight.

### Key Guarantees & Invariants
1. **100% Clean-Room Architecture:** Zero Chatbox or GPLv3 code copied or referenced; built natively in Bun-first TypeScript with Pao-hubPro architectural patterns.
2. **Authority Decoupling:** Model outputs are strictly proposals; execution authority belongs exclusively to the Pao-hubPro Policy Engine and Human-in-the-Loop Gateway.
3. **Critical Action Guard:** Actions classified as `critical` (destructive commands, force push, schema drops) **strictly require explicit human approval** and **can never be session-approved**.
4. **Pre-spawn MCP Security Gateway:** Stdio MCP server binaries and arguments are validated before process creation against an approved runtime allowlist (`node`, `bun`, `python`, `npx`, `uvx`), blocking arbitrary command execution and inline eval flags (`-e`, `--eval`, `-c`).
5. **Hierarchical Governance:** Enforces policy precedence: Hard Security Policy > User Approval > Workspace Policy > Scoped `AGENTS.md` > Root `AGENTS.md`.
6. **Core-Lab Separation:** Desktop runtime remains off the core request path, zero imports from `src/lab/`.

---

## 2. Subsystems Delivered

### 2.1 Database Persistence (Schema Version 15)
Location: `src/agent-os/db.ts`
- Added 8 relational tables with foreign keys and compound indexes:
  - `desktop_agent_runs`: Orchestrator run metadata, status state machine, token usage.
  - `desktop_agent_events`: Detailed append-only audit trail with secret redaction.
  - `desktop_agent_tool_calls`: Tool execution proposals, risk classifications, arguments, outputs.
  - `desktop_agent_approvals`: Human-in-the-Loop approval cards, operator decisions, timestamps.
  - `desktop_agent_mcp_servers`: Managed MCP servers (stdio, http, sse), trust levels, health.
  - `desktop_agent_skills`: Stage 1 and Stage 2 skill descriptors with security notices.
  - `desktop_agent_provider_configs`: Multi-model provider credentials, endpoints, custom headers.
  - `desktop_agent_policies`: Workspace-level security policies, shell allowlists, Git boundaries.

### 2.2 Agent Modes & Permission Manager
Location: `src/agent-os/desktop-runtime/modes/agent-mode-manager.ts`
- Four operational modes:
  - `off`: Complete lockdown. All tool execution blocked.
  - `ask`: Default mode. Read-only actions allowed; all mutating or shell actions require confirmation.
  - `safe_auto`: Autonomous execution for `read_only` and `low` risk; `medium`, `high`, and `critical` require confirmation.
  - `full_auto`: Autonomous execution for `read_only`, `low`, `medium`, and `high` risk; `critical` actions **always** require explicit human confirmation.
- Session approval caching with security barrier forbidding session approvals for `critical` tier.

### 2.3 Multi-Model Providers & Capability Registry
Locations:
- `src/agent-os/desktop-runtime/providers/provider-registry.ts`
- `src/agent-os/desktop-runtime/providers/model-capability-registry.ts`
- Unified multi-model abstraction:
  - Built-in provider adapters: OpenAI, Anthropic, Gemini, OpenRouter, Ollama, LM Studio, OpenAICompatible.
  - Dynamic capability detection: `tools`, `vision`, `reasoning` (e.g. o1/o3, DeepSeek Reasoner), `structuredOutput`, `streaming`, and `maxContext`.

### 2.4 Tool Registry & 5-Tier Risk Classification
Locations:
- `src/agent-os/desktop-runtime/tools/tool-registry.ts`
- `src/agent-os/desktop-runtime/tools/risk-classifier.ts`
- Namespaced tool isolation:
  - `builtin__*`: 7 core local tools (`read_file`, `write_file`, `search_workspace`, `list_dir`, `run_lint`, `run_typecheck`, `run_test`).
  - `mcp__<server>__<tool>`: Model Context Protocol dynamic server tools.
  - `skill__<skill>__<tool>`: Domain-specific skills.
  - `sandbox__*`: Isolated process sandbox executions.
- Risk Classification Engine:
  - Categorizes actions into: `read_only`, `low`, `medium`, `high`, `critical`.
  - Dynamic shell inspection parses arguments for destructive patterns (`rm -rf`, `format`, `drop table`, `git push --force`).

### 2.5 Security, Redaction & Safe Sandbox
Locations:
- `src/agent-os/desktop-runtime/security/path-guard.ts`
- `src/agent-os/desktop-runtime/security/secret-redactor.ts`
- `src/agent-os/desktop-runtime/sandbox/safe-sandbox.ts`
- PathGuard: Validates canonical paths via `realpath`, blocks `../` directory traversals, UNC paths (`\\server\share`), and drive hopping.
- SecretRedactor: Regex masking of API tokens (`sk-ant-`, `sk-`, `ghp_`, `Bearer`), private keys, database connection strings, and nested JSON values.
- SafeSandbox: Process isolation with concurrency caps, execution timeouts, output buffer caps (512KB), and environment sanitization.

### 2.6 Pre-Spawn MCP Security Gateway & Manager
Locations:
- `src/agent-os/desktop-runtime/mcp/security-gateway.ts`
- `src/agent-os/desktop-runtime/mcp/mcp-manager.ts`
- Validates executable against strict allowlist before process creation (`node`, `bun`, `python`, `npx`, `uvx`).
- Rejects dangerous commands (`bash`, `sh`, `powershell`, `rm`, `curl | sh`) and arbitrary inline eval flags (`-e`, `--eval`, `-c`).
- Manages stdio / HTTP / SSE lifecycle, health checks, and SQLite synchronization.

### 2.7 Policy Engine & Scoped AGENTS.md Resolver
Locations:
- `src/agent-os/desktop-runtime/policy/policy-engine.ts`
- `src/agent-os/desktop-runtime/policy/agents-markdown-resolver.ts`
- PolicyEngine enforces immutable boundaries: Git push controls, shell command allowlists, and sensitive file protections.
- Scoped AGENTS.md resolver crawls directory hierarchies from target path to root workspace, building a hierarchical instruction set.

### 2.8 Progressive Skills Runtime
Location: `src/agent-os/desktop-runtime/skills/skills-runtime.ts`
- Progressive disclosure:
  - Stage 1: Injects minimal metadata descriptors (`name`, `description`) into system prompts, saving model context tokens.
  - Stage 2: Loads full instruction bodies on-demand when the skill is explicitly activated.
- Security Precedence Notice: Automatically injects non-overridable disclaimers into skill prompt bodies.

### 2.9 Reviewer Council & Approval Gateway
Locations:
- `src/agent-os/desktop-runtime/reviewer-council/reviewer-council-bridge.ts`
- `src/agent-os/desktop-runtime/approval/approval-gateway.ts`
- Multi-model Reviewer Council automatically evaluates high and critical risk tool proposals.
- Approval Gateway presents structured Human-in-the-Loop decision cards with side-effect estimates and affected files.

### 2.10 Context Builder & Real-Time Audit Logger
Locations:
- `src/agent-os/desktop-runtime/context/context-builder.ts`
- `src/agent-os/desktop-runtime/audit/audit-logger.ts`
- Assembles token-budgeted system prompts combining hierarchical AGENTS.md, active policies, Stage 1 skill descriptors, and visible tool schemas.
- Real-time event logging to SQLite (`desktop_agent_events`) with automatic secret redaction.

### 2.11 Central Orchestrator & State Machine
Location: `src/agent-os/desktop-runtime/orchestrator/agent-runtime.ts`
- Finite State Machine: `IDLE` -> `PLANNING` -> `WAITING_MODEL` -> `TOOL_PROPOSED` -> `POLICY_CHECK` -> `WAITING_APPROVAL` -> `EXECUTING` -> `OBSERVING` -> `REVIEWING` -> `COMPLETED` / `FAILED` / `CANCELLED`.
- Supports cooperative cancellation via `AbortController`, idempotency deduplication, and max-step bounds.

### 2.12 Management REST API
Location: `src/server/management/desktop-agent-routes.ts`
- Mounted under `/api/desktop-agent/*`:
  - `GET /status`: Subsystem health, active mode, counts.
  - `GET & POST /modes`: Query or switch between `off`, `ask`, `safe_auto`, `full_auto`.
  - `GET /providers`: Configured providers and model capabilities.
  - `GET /tools`: Namespaced tool catalog and visible tool filtering.
  - `GET & POST /mcp/servers`: MCP server registration and listing.
  - `DELETE /mcp/servers/:id`: Remove MCP server.
  - `POST /mcp/servers/:id/health`: Run health diagnostic.
  - `GET /skills`: Progressive skills catalog.
  - `GET & POST /policies`: Security policy inspection and updates.
  - `GET & POST /approvals`: List pending approval cards and record decisions.
  - `GET & POST /runs`: Create, inspect, or cancel autonomous agent runs.
  - `GET /audit`: Real-time structured audit event feed.

### 2.13 GUI Agent Control Center
Locations:
- `gui/src/pages/AgentControlCenter.tsx`
- `gui/src/styles/agent-control-center.css`
- Modern React + Vite Dashboard with 5 operational tabs:
  1. **Control Center:** Active run feed, approval card decision queue, mission launcher.
  2. **MCP Servers:** Server cards, pre-spawn validation status, server registration modal, real-time health checks.
  3. **Providers & Models:** Multi-provider cards, model capability chips (Tools, Vision, Reasoning, Structured Output, Max Context).
  4. **Progressive Skills:** Stage 1 vs Stage 2 catalog inspector with token usage estimators.
  5. **Security & Policies:** Workspace root configuration, Git push guard toggles, shell command rules.
- Fully internationalized across all 10 locales with 0 missing keys.

---

## 3. Verification & Quality Gates

| Gate | Target | Result | Notes |
| :--- | :--- | :--- | :--- |
| **Automated Tests** | `tests/chatbox-agent-desktop-runtime.test.ts` | **PASS (26/26)** | 132 assertions passed in 379ms |
| **Strict Typecheck** | `bun run typecheck` (`tsc --noEmit`) | **PASS (0 errors)** | Full repository strict compliance |
| **GUI Linter** | `bun run lint:gui` (`oxlint`) | **PASS (0 errors, 0 warnings)** | 237 files inspected |
| **GUI Production Build** | `bun run build:gui` (`vite build`) | **PASS (0 errors)** | Production assets compiled |
| **Core-Lab Boundary** | `tests/core-lab-boundary.test.ts` | **PASS (17/17)** | Zero Lab modules imported in core |
| **Locale Parity** | `gui/scripts/sync-locale-keys.mjs` | **PASS (0 missing)** | All 10 locales in complete key parity |

---

## 4. Conclusion

Phase 20.9 is fully implemented, verified, and integrated into the repository. The Pao-hubPro × Chatbox Agent Desktop Runtime provides a safe, sovereign, clean-room desktop agent execution environment ready for production workflows.
