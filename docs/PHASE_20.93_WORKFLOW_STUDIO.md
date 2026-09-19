# Phase 20.93 — Visual Agentic Workflow Studio

**Status:** IMPLEMENTED (vertical slice — node registry, typed ports, compiler with policy analysis, durable run engine, approval gates, REST surface, GUI)
**Blueprint:** `Pao-hubPro Blueprints/2026-09-19/PHASE_20_93_AGENTIC_SIGNAL.md` (20.93 taken by this spec; BrowserSkill proposal → 20.94, Addy Osmani → 20.95, RESERVED → 20.96+)
**License:** clean-room implementation — the Agentic Signal reference is AGPL v3 dual-licensed and was used as concept inspiration only. No source, assets, or identifiers copied.

## Architecture law

1. **Canvas JSON never executes directly** — the compiler validates (schema → ports → cycles → unreachable → policy) and emits an immutable ExecutionPlan (planHash).
2. **Typed ports** — edges carry declared types; mismatches rejected at compile time.
3. **Policy before risk** — capabilities checked against the shared Phase 05 policy layer at run start; high-risk nodes carry approval requirements.
4. **Durable checkpoints** — node outputs and run memory persist at every node boundary; restarts resume from the latest checkpoint.
5. **Human gates first-class** — `human.approval` nodes pause the run (WAITING_FOR_APPROVAL) until a recorded decision; approvals carry exact payloads, never vague dialogs.
6. **Secrets referenced, never stored** — `secret://scope/name` shape; `redactSecrets` scrubs every persisted payload.

## Modules (`src/agent-os/workflow-studio/`)

| Module | Responsibility |
| --- | --- |
| `types.ts` | Node/ports/graph/plan/run/approval contracts (Zod) + `redactSecrets` |
| `catalog.ts` | Node registry (pure functions) + **`advanceRunDeps`** — the pure scheduler (dependency-ready nodes, condition-port routing, approval pause) with persistence injected |
| `nodes.ts` | 13 executors: local deterministic set (JSON transform/validate/condition/delay/memory/artifact payload/notify/approval resolve) + remote set (Agent via 20.85 model gateway, MCP via 20.74 gateway, HTTP with SSRF guard) |
| `built-in.ts` | 14 built-in node definitions with typed ports + capabilities + risk/side-effect metadata |
| `compiler.ts` | Graph compilation: schema, node existence, port-type compatibility, cycle detection (DFS), unreachable-node warnings, trigger presence → immutable plan |
| `service.ts` | Workflow/version persistence (draft → published immutable), graph validation, run memory checkpoints, artifact lineage |
| `run-engine.ts` | Run lifecycle: start (policy gate) → advance (scheduler callbacks) → pause/resume/cancel/retry, approval requests + decisions, artifact persistence (SHA-256 + sandbox guard) |
| `mcp-tools.ts` | `workflow.*` MCP tools |
| `index.ts` | Public surface |

## Database (schema v62, `wfs_*` prefix)

`wfs_workflows, wfs_versions, wfs_runs, wfs_node_runs, wfs_events, wfs_artifacts, wfs_approvals` — the Phase 11 `workflows`/`workflow_runs` tables are a different subsystem (untouched).

## REST surface (`/api/agent-os/workflow-studio/*`)

16 routes declared in `route-registry.ts` with `WORKFLOW_STUDIO_VERB_DEFERRAL`: health, nodes, workflows CRUD, validate, publish, run, runs/{id} (inspect), advance, pause, resume, cancel, retry, approvals list + decision.

## GUI

`video-studio`-style page at `workflow-studio` route: workflow list + create, node registry view, workflow detail (graph JSON + versions), run list + inspector (per-node status/output/errors), approval queue.

## Tests

`tests/workflow-studio.test.ts` — registry integrity, compiler diagnostics (unknown node, port mismatch, cycle, no-trigger), GOLD local workflow (Manual → JSON Input → Transform → Validate → Condition → Save Artifact → Notify, zero external APIs), approval pause/resume, retry failed node, cancel, artifact lineage SHA-256, secret redaction.

## Known limitations (Milestones E–H deferred)

- Canvas editor is a compact wire-frame (list + JSON) — full drag-and-drop canvas is Milestone A UI follow-up
- Cron/webhook/scheduling triggers defined but not wired to a scheduler service
- Subflows and plugin SDK packaging deferred
- Distributed workers (Apra Fleet adapter) deferred
- Agent nodes require a configured model provider (fail with PROVIDER_UNAVAILABLE otherwise)
