# Phase 20.98 — Pao-hubPro × OpenHermit — Durable Multi-Agent Fleet Runtime

## Overview

Phase 20.98 adds OpenHermit as a replaceable production Agent Runtime backend to Pao-hubPro, while preserving Pao-hubPro as the sole platform authority:
- **Pao-hubPro** = Identity, RBAC, Policy, Exact-Action Approvals, Capability Registry, SkillsGate, MCP Governance, Credential Brokerage, OmniRoute, Reviewer Council, Audit, Observability.
- **OpenHermit** = Durable Agent Runtime, Agent Lifecycle, Runtime Sessions, Per-Agent Sandbox, Runtime Skills/MCP Assignment, Schedules, Multi-Channel Delivery, Deep Research Execution.

## Architecture Boundaries

1. **Adapter Boundary**: `HermitRuntimeProvider` interface in `src/agent-os/openhermit/types.ts`. All OpenHermit-specific API shapes remain behind this seam. Unrelated platform modules never import OpenHermit raw types.
2. **State Plane**: SQLite schema v68 (`oh_*` tables: `oh_agents`, `oh_instances`, `oh_sessions`, `oh_operations`, `oh_approvals`, `oh_agent_skills`, `oh_agent_mcp`, `oh_research_runs`, `oh_research_sources`, `oh_research_claims`, `oh_research_evidence`, `oh_channels`, `oh_schedules`, `oh_events`). Stable Pao Agent IDs (`oha_*`) are independent of remote runtime IDs.
3. **Policy & Approvals**: Evaluated strictly server-side. R3 (external side-effect) and R4 (destructive/security-critical) actions require an exact-action hash-bound approval (`sha256(canonicalJson({action, target, args, artifactHash, constraints}))`). If action parameters change materially after approval, the approval is invalidated.
4. **Deep Research**: Bounded research pipeline requiring pre-approved plans, source/evidence/claim ledgers, and citation verification where every claim resolves to stored evidence and source records. Prompt-injection patterns in acquired sources are treated as untrusted data, never instructions.
5. **Sandbox Fabric**: Hard invariants (host filesystem deny, docker socket deny, privileged container deny, host network deny, arbitrary device mount deny, credential directory deny, dropped Linux capabilities). Exported artifacts undergo path-traversal and sensitivity validation.
6. **SkillsGate & MCP Governance**: Skills must be validated via SkillsGate before runtime assignment. MCP tools are classified across an 8-dimension taxonomy; denied tools never reach the model. Credentials use scoped short-lived leases via the credential broker.

## Routes & MCP Tools

- REST: `/api/agent-os/openhermit/*` (health, compatibility, agents, sessions, approvals, fleet, research, skills, mcp, events).
- MCP: `pao.openhermit.*` (health, agent.list, agent.create, agent.start, agent.stop, agent.reconcile, approval.list, approval.decide, research.create, research.approve, research.execute, skill.assign, fleet.impact).

## Configuration & Environment Variables

- `PAO_OPENHERMIT_ENABLED`: Master toggle (default `0`/false). Fails closed when unset or 0.
- `PAO_OPENHERMIT_URL`: HTTP Gateway base URL (e.g. `http://hermit-gateway:8080`).
- `PAO_OPENHERMIT_TOKEN_REF`: Credential reference (e.g. `env:OPENHERMIT_API_TOKEN`). Literals are never stored.
- `PAO_OPENHERMIT_TIMEOUT_MS`: Request timeout (default 15,000ms).
- `PAO_OPENHERMIT_MAX_RESPONSE_BYTES`: Payload size cap (default 2MB).
- `PAO_OPENHERMIT_SANDBOX_BACKEND`: Sandbox runtime (`docker` | `e2b` | `daytona` | `none`).
- `PAO_OPENHERMIT_SANDBOX_IMAGE`: Sandbox container image (default `opencodex-agent-sandbox:latest`).

## Test & Validation Ledger

- Unit & Integration: `tests/openhermit.test.ts` (28/28 passing).
- Resilience & Fault Isolation: `tests/openhermit-resilience.test.ts` (8/8 passing).
- Management Route Registry: `tests/management-route-registry.test.ts` (13/13 passing).
- Core/Lab Decoupling: `tests/core-lab-boundary.test.ts` (17/17 passing).
- Typecheck: `bun run typecheck` passes cleanly with zero diagnostics.

## Live Gateway Status

- **Local implementation & adapter contract**: COMPLETE & VERIFIED.
- **Live Gateway E2E**: BLOCKED / NOT TESTED (no remote OpenHermit daemon currently active in this execution environment). When deployed, configure `PAO_OPENHERMIT_ENABLED=1` and `PAO_OPENHERMIT_URL` to enable live traffic.
