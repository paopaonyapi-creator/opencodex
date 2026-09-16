# PHASE_20_61_REPORT.md — Pao-hubPro × amux Agent Runtime Control Plane

Implementation report for Phase 20.61. Design doc:
`docs/PHASE_20_61_AMUX_AGENT_RUNTIME_CONTROL_PLANE.md`. Compatibility record:
`docs/integrations/amux-compatibility.md`. License review:
`docs/legal/amux-license-review.md`.

## A. Architecture discovered

- **Pao-hubPro:** Bun-native TypeScript; single SQLite via `src/agent-os/db.ts`
  (schema v48 → **49** this phase); management routes under
  `/api/agent-os/*` with prefix-decode dispatchers; module conventions from
  capability-lab / social-publishing (pure policy functions, module audit
  tables, WebMcpToolDefinition, injectable transports, `ur-*` GUI pages).
- **Upstream amux:** Rust control plane for AI coding agents; axum HTTP API on
  port 8824; bearer token (`AMUX_AUTH_TOKEN`); primitives: board (with
  upstream atomic/CAS claim), workers (= sessions on the wire), messages,
  memories, schedules. REST surface verified via amux.io REST API reference;
  request/response body fields are not documented upstream — the adapter
  normalizes defensively and fails closed on contract mismatch.
- **Reuse over rewrites:** no second DB/ORM/queue/logger; the phase adds one
  module, one migration group, one route file, one chain link.

## B. Files added/changed

**New — `src/agent-os/agent-runtime/`**

- `types.ts` (state machine + transitions + domain model + error class)
- `config.ts` (PAO_AGENT_RUNTIME_* / PAO_AMUX_*)
- `secrets.ts` (token refs + redaction + leak detector)
- `policy.ts` (execution gateway: capability/structural-deny/destructive/
  network/secret/path rules, risk classifier, approval matrix, merge guard)
- `store.ts` (`ar_*` CRUD, atomic claim, lease reclaim, idempotent events,
  idempotency store, audit)
- `hash.ts` (canonical JSON, payload hash, idempotency keys)
- `evidence.ts` (evidence types/safety, verification packet, independent
  verifier rule, bounded retry budget)
- `worktrees.ts` (git worktree/branch isolation, argv-only git)
- `adapter/types.ts`, `adapter/transport.ts`, `adapter/amux-adapter.ts`
  (WorkerRuntimeAdapter contract + amux implementation with commit gate)
- `service.ts` (lifecycle, dispatch, heartbeat, recovery sweep, gateway,
  approvals, idempotency wrapper, events, singleton + test hooks)
- `mcp-tools.ts` (12 tools, R0–R3)

**Changed**

- `src/agent-os/db.ts` — v49 section (8 `ar_*` tables + indexes), version bump
- `src/server/management/agent-os-routes.ts` — chain link
- `.env.example` — Phase 20.61 block

**New — routes/tests/docs/GUI**

- `src/server/management/agent-runtime-routes.ts`
- `tests/agent-runtime.test.ts`, `tests/helpers/amux-fake.ts`
- `gui/src/pages/AgentRuntime.tsx`, App/routing/i18n ×10, oxlint entry
- docs listed above + this report

## C. DB migrations

`AGENT_OS_SCHEMA_VERSION` 48 → 49: `ar_tasks`, `ar_workers`, `ar_sessions`,
`ar_task_evidence`, `ar_approval_requests`, `ar_execution_audit`,
`ar_idempotency_keys`, `ar_events` + indexes (`idx_ar_tasks_status`,
`idx_ar_sessions_task`, `idx_ar_evidence_task`, `idx_ar_approvals_task`,
`idx_ar_audit_created`, `idx_ar_events_task`). Additive only. (Spec table
names carry the repo's module prefix to avoid ambiguity with the existing
generic `tasks`/`approvals` tables.)

## D. API routes (all under `/api/agent-os/agent-runtime`)

`GET health` · `GET runtime/health` · `GET|POST workers` · `GET sessions` ·
`GET|POST tasks` · `tasks/:id` (GET) · `tasks/:id/{queue,dispatch,heartbeat,
complete,cancel,retry,verify,run,request-approval,promote-merge}` (POST) ·
`tasks/:id/evidence` (GET/POST) · `GET|POST approvals(/:id/{approve,reject})` ·
`GET events` · `GET audit` · `GET mcp-tools`.

No amux administrative endpoint is proxied to the browser; the dashboard only
sees normalized Pao state.

## E. Policy rules

Gateway pipeline per request: claim-owner identity → capability → structural
deny (`sudo`/`su`, fork-bomb shape, `mkfs`/`format`, `mount`, service/system,
firewall, privileged docker, host sockets) → destructive require-approval
(`rm -rf`, `git push`, force/reset/rebase/merge, `drop table/database`) →
network default-deny → secret deny-without-capability → path policy
(traversal/out-of-scope) → risk classification (low/medium/high/critical;
high+ upgrades to require_approval) → approval matrix for named actions →
merge guard (`pao/amux/*` branch format + protected-branch approval).

## F. Tests executed with exact results

`bun test tests/agent-runtime.test.ts` — **27 pass / 0 fail** (103 expect
calls), covering: state-machine illegal jumps; in-scope allow; path escape;
structural deny families; git-push/secret rules; network default-deny; risk
classification; non-claim-owner denial; approval matrix; merge-target guard;
evidence type/safety; verifier independence; verdict mapping; retry budget;
full dispatch→claim→worktree→heartbeat→evidence→verify→approval flow; atomic
claim race; stale claim token; runtime-failure fail-closed (`recovering`);
version-drift fail-closed; lease reclamation + bounded recovery exhaustion;
verifier rejection → rework; payload-change approval invalidation;
cancellation; idempotent duplicate events; worktree branch format; adapter
error mapping; plus route-level tests (health, worker registration, task
lifecycle, approval queue + decision, mcp-tools listing, 404).

`bun test tests/management-route-registry.test.ts` — 13 pass (scanner
reconciled with the new prefix-decode anchor). See §H for the remaining
verification set.

## G. Remaining risks / TODOs

- Upstream board/session body fields are undocumented at the pinned commit;
  field-level behavior must be re-validated against a live amux instance
  before Stage C (the adapter fails closed rather than guessing).
- The execution gateway decides and enforces; actual command execution lands
  with Stage B/C operator enablement (`PAO_AGENT_RUNTIME_DISPATCH_ENABLED`)
  and is not exercised against a real shell in this phase by design.
- Session create/stop are amux-native and unsupported by the adapter —
  workers must pre-exist as amux lanes (documented fail-closed behavior).
- Commercial enablement stays off pending the license-review triggers.

## H. Pinned amux commit/version

`3a205a41a60ea790dfae48a5056ef70d6f9361e9` (main, 2026-09). Enforced at
runtime by the adapter's commit gate (`RUNTIME_VERSION_MISMATCH` on drift).

## I. Rollback instructions

Set `PAO_AGENT_RUNTIME_ENABLED=false` (halts the subsystem entirely) or
`PAO_AGENT_RUNTIME_DISPATCH_ENABLED=false` (keeps visibility, halts
execution). Schema rollback: drop the eight `ar_*` tables and revert
`AGENT_OS_SCHEMA_VERSION` to 48 (only if no later migration landed). No
Pao-hubPro core behavior depends on this module; it is lazy-activated from
routes/MCP only.

## J. Quality gates

| Gate | Result |
|---|---|
| typecheck (`bun run typecheck`) | 0 errors in phase files (pre-existing errors elsewhere untouched) |
| focused tests | 27/27 pass (see §F) |
| lint:gui | 0 warnings / 0 errors |
| GUI tsc + vite build | clean (chunk-size advisory pre-existing) |
| privacy:scan | 0 findings in phase files; pre-existing fixtures elsewhere untouched |
| secrets/generated junk | none committed; no real tokens in fixtures (`test-token-not-real`) |
