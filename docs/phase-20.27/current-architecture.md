# Phase 20.27 — Current Architecture (discovery record)

Recorded before implementation.

## What already existed and is REUSED

| Concern | Existing module | 20.27 relationship |
|---|---|---|
| Control plane core | `src/agent-os/control-plane/` (Phase 20.16): TaskEnvelope, policy engine, reviewer consensus, cp_* tables, routes, 50 MCP tools | **Extended in place** — cockpit files added beside it; session authorization maps onto task-envelope risk ceilings |
| Policy guards | `policy.ts` (`isInsideWorkspace`, `isProtectedPath`, shell tokenizer + desktop policy engine) | Reused by `access-policy.ts` — single decision path |
| Agent registry | Phase 20.25 Universal Registry | Cockpit agents/capabilities registered as `control.*` via a new ingest source; no duplicate registry |
| Codex runtime | Phase 20.21 codex-runtime module | Codex remains an agent *type* behind the common adapter; no special-casing |
| Reviewer Council | Phase 20.4/20.16 reviewers + consensus | Cockpit review bridge records structured runs and feeds evidence |
| Audit | cp_tool_calls / registry audit / agent_events | Cockpit emits normalized events + evidence; no new audit system |
| Git | system git via fixed-argv subprocess | Read-only intelligence; no second git service |
| Dashboard | existing glassmorphic pages | One new Cockpit page; no duplicate sidebar |
| Tests | flat bun tests | `tests/control-plane-cockpit.test.ts` |

## New files

`cockpit-types.ts`, `access-policy.ts`, `cockpit-agents.ts`, `cockpit-gate.ts`,
`cockpit-store.ts`, `context-plane.ts`, `cockpit-facade.ts`,
`cockpit-routes.ts`; registry ingest source `cockpit`.

## Duplicates deliberately avoided

Agent registry, audit log, task queue, permission system, secret vault, MCP
registry, git service, notification service, WebSocket layer, database
abstraction — all reused (doc §131).
