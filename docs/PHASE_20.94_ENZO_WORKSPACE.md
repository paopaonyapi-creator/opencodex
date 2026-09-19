# Phase 20.94 — Pao-hubPro × ENZO Unified AI Operating Workspace

**Status:** IMPLEMENTED (composition plane — intent compiler, two-pass agent factory, SkillsGate composer, OmniRoute marketplace, credential leases, budget-governed research, sandbox coding, lesson distillation, REST/MCP, GUI)
**Blueprint:** `docs/Phase_20.94_Pao-hubPro_x_ENZO.md`
**Law:** ENZO is a reference architecture. It is not vendored and not a runtime dependency.

## Architecture law

1. **Compose, do not duplicate.** Models stay on OmniRoute (20.85). Skills stay on SkillsGate. Tools stay on MCPProxy. Credentials stay on the 20.59 runtime when enabled. Coding reuses the sandbox adapter over coding-cockpit/AFT. Memory candidates live in `enzo_lessons` and can be forwarded to Memory Plane.
2. **Intent first.** The operator describes an outcome. The workspace compiles agent, skills, model, policy, and budget.
3. **Human approval at irreversible boundaries.** R3/R4 and safe-personal source edits pause in `WAITING_FOR_APPROVAL`. Replay cannot silently repeat irreversible actions.
4. **Secrets are leased, never listed.** HTTP returns lease metadata only. Events run through `redactSecrets`.
5. **Budget is a hard stop.** Research terminates on max queries/sources/cost/runtime.

## Modules (`src/agent-os/enzo-workspace/`)

| Module | Responsibility |
| --- | --- |
| `intent.ts` | Deterministic intent/task compiler |
| `factory.ts` | Two-pass Forge-style blueprint compiler (local seam; Forge package is not in this checkout) |
| `composer.ts` | Minimal skill set, trust filter, conflict resolution, token budget |
| `models.ts` | Marketplace adapter over `getModelGateway()` |
| `broker.ts` | Run-bound credential leases; wraps 20.59 when enabled |
| `policy-plane.ts` | R0–R4 decisions + profiles |
| `research.ts` | Budget-governed iterative research (local corpus by default) |
| `coding.ts` | Sandboxed plan/apply/test/review with env allowlist |
| `memory.ts` | Provenance-gated lesson distillation |
| `orchestrator.ts` | Canonical run state machine + audit events |
| `service.ts` / `mcp-tools.ts` | REST + MCP facade |

## Database (schema v65, `enzo_*` prefix)

`enzo_agents, enzo_runs, enzo_run_events, enzo_approvals, enzo_lessons, enzo_artifacts, enzo_leases, enzo_secrets, enzo_policy_decisions`

Existing `agents` / `approvals` / `skills` / `memories` tables are untouched.

## REST (`/api/agent-os/enzo-workspace/*`)

Health, models, model route, agent draft/save/run, skill resolve, runs CRUD/replay/cancel, research, credentials/lease, tool invoke, approvals, memory search/accept/quarantine.

## GUI

`#enzo-workspace` — Chat, Models, Agents, Skills, Research, Code, Operations. Live API only.

## Tests

`tests/enzo-workspace.test.ts` — schema, redaction, factory, skill policy, model fallback, AES-GCM vault, adapter probes, OmniRoute real-vs-simulated classification, Scenarios A–E.

## Feature flag

`PAO_ENZO_WORKSPACE=0` disables the HTTP surface.

## Credentials

Workspace secrets persist as AES-256-GCM envelopes in `enzo_secrets.envelope_json` using Phase 20.59 `AesGcmVault`.
Production requires `CREDENTIAL_MASTER_KEY` (optional `CREDENTIAL_MASTER_KEY_ID`). Missing key → secret writes fail closed (`UNCONFIGURED`).
`CREDENTIAL_RUNTIME_ENABLED=true` additionally mirrors secrets into the 20.59 mutating API; it is not required for workspace encryption.
Leases are scoped, TTL-bound, revocable, and never returned with plaintext.

## Known gaps (honest)

- `completeViaOmniRoute()` always goes through `getModelGateway().execute`. DirectAdapter simulation is classified `FALLBACK` / `real:false`. A live OmniRoute completion needs a reachable daemon (`PAO_OMNIROUTE_BASE_URL`) and `PAO_OMNIROUTE_API_KEY` when the daemon requires auth.
- Phase 20.90 Forge has no runtime package in this checkout; two-pass compilation is implemented locally behind `ForgeCompiler`.
- Codex/AFT/OpenCodeReview probes are explicit (`AVAILABLE`/`UNCONFIGURED`/`DEGRADED`/`FALLBACK`/`ERROR`). Coding apply stays sandboxed unless those runtimes are selected; sandbox fallback is labeled.
