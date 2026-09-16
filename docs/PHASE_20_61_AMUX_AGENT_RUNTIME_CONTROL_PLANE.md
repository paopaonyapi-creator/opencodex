# Phase 20.61 — Pao-hubPro × amux: Agent Runtime Control Plane

Multi-agent worker runtime, atomic task coordination, recoverable sessions,
and a policy-governed execution gateway around a separately deployed **amux**
instance (`mixpeek/amux`, Rust, port 8824).

- **Upstream:** https://github.com/mixpeek/amux — pinned commit
  `3a205a41a60ea790dfae48a5056ef70d6f9361e9`; compatibility record:
  `docs/integrations/amux-compatibility.md`; license review:
  `docs/legal/amux-license-review.md` (MIT + Commons Clause).
- **Boundary:** amux is an execution subsystem, never the authority. Pao-hubPro
  owns canonical task identity, state, policy, approval, evidence, audit.

## Final design rule

> **Pao-hubPro decides. amux executes. Workers produce evidence. Reviewers
> verify. Humans authorize high-risk actions.**

## What ships (P0 vertical slice)

| Area | Where | Notes |
|---|---|---|
| Task state machine | `agent-runtime/types.ts` | full spec §2 graph; `DONE != VERIFIED != APPROVED` enforced by `assertTransition` |
| Atomic claiming | `store.claimTaskAtomic` | conditional UPDATE, exactly-one-row semantics, `claim_version`, lease, stale-token guards |
| Worker registry | `ar_workers` | provider/roles/capabilities per config; authorization evaluated per task/action |
| Workspace isolation | `worktrees.ts` | `pao/amux/<task>/<role>` branches + dedicated worktrees, argv-only git, charset guards |
| WorkerRuntimeAdapter | `adapter/` | provider-neutral contract + `AmuxAdapter` (verified endpoints; undocumented ops fail closed `RUNTIME_UNSUPPORTED`; commit gate fails closed `RUNTIME_VERSION_MISMATCH`) |
| Execution gateway | `policy.ts` | identity → capability → structural deny → destructive/require-approval → network → secret → path → risk; default deny, ruleId-explainable |
| Human approval | `service.ts` + `ar_approval_requests` | payload-hash-bound; changed payload ⇒ stale; protected-branch merges verified against worker-branch format |
| Evidence + verification | `evidence.ts` | 12 evidence types, secret-leak rejection, minimum verification packet, independent-verifier rule |
| Recovery controller | `service.runRecoverySweep` | expired leases → reclaim → bounded retry (`max_attempts`, default 3), exhaustion ⇒ `failed` |
| Checkpoints | `ar_tasks.checkpoint_json` | structured spec §13 shape; recovery re-sends the checkpoint, never a transcript |
| Events | `ar_events` | spec §16 envelope, stored-before-broadcast, idempotent by unique key |
| Idempotency | `ar_idempotency_keys` + `service.idempotent` | duplicate operations return the recorded response |
| Audit | `ar_execution_audit` | every lifecycle/claim/policy/approval action with actor + request hash |
| MCP tools | `mcp-tools.ts` | 12 Pao-owned tools (R0–R3) incl. dispatch + approval decisions |
| Management API | `/api/agent-os/agent-runtime/*` | tasks/workers/sessions/evidence/verify/approvals/events/runtime-health |
| Secrets | `secrets.ts` | ref-based resolution, bearer/`amux_*` redaction, evidence leak-rejection (tested) |
| Tests | `tests/agent-runtime.test.ts` | 27 pass: claim races, stale claims, path escape, command deny, recovery exhaustion, payload-change invalidation, worktree isolation, adapter drift |

## Staged rollout (spec §23) — implemented as flags

| Stage | Enabler | State |
|---|---|---|
| A read-only visibility | `PAO_AGENT_RUNTIME_ENABLED=true` | health/workers/tasks/events visible |
| B sandbox dispatch | `+ PAO_AGENT_RUNTIME_DISPATCH_ENABLED=true` | dispatch gated separately from visibility |
| C multi-worker | register workers w/ distinct roles | worktree isolation active |
| D recovery | `PAO_AGENT_RUNTIME_RECOVERY_ENABLED` (default on) | monitor interval + bounded retries |
| E approval gateway | always on | payload-bound approvals; no bypass |
| F production | operator judgment after §30 scenario | docs only |

The spec's §30 first-validation scenario (disposable repo, kill-the-worker
recovery drill) is exactly what the test suite executes against fixtures;
run it against a real disposable repo before Stage F.

## Threat model summary

- **Duplicate ownership** → atomic conditional claim; race tested.
- **Stale workers** → claim-token guards on completion; stale version/token
  writes fail (tested).
- **Prompt-injected policy bypass** → the gateway evaluates requests
  structurally; prompt content cannot grant capabilities (deny tested for
  sudo/mkfs/privileged/docker/network/secret).
- **Path escape** → traversal + out-of-scope denial (tested).
- **Approval replay** → payload hash re-verified at decision time; changed
  payload ⇒ `stale` (tested).
- **Self-approval / self-verification** → verifier must differ from the
  implementer and hold reviewer/release-controller role (tested); MCP
  approval tools carry R3 and remain behind the management principal gate.
- **Secret leakage** → evidence/metadata scrubbed, `containsSecretLikeMaterial`
  guard (tested); tokens never enter transcripts or logs (redaction tested).
- **Runtime drift/unavailability** → commit gate + dispatch fault ⇒ task
  `recovering`, fail closed (tested).
- **Unbounded autonomy** → retry budget, `recoveryPermitted`, exhaustion ⇒
  `failed` (tested); no auto-merge, no auto-deploy.

## Recovery runbook

1. **Symptom:** task stuck `running` past its lease. The monitor sweep marks
   `session.suspect`, waits `recovery_grace_seconds`, reclaims the lease, and
   requeues with `attempt+1` — automatic.
2. **Symptom:** task `failed` ("recovery exhausted"). Inspect
   `ar_sessions.exit_reason` and the runtime lane; fix the cause; `POST
   tasks/:id/retry` manually (operator-initiated, still budget-checked).
3. **Symptom:** `RUNTIME_VERSION_MISMATCH`. amux drifted from the pinned
   commit: re-validate the API surface against the new upstream commit,
   update `PAO_AMUX_PINNED_COMMIT` + `docs/integrations/amux-compatibility.md`,
   then retry.
4. **Pao restart:** canonical state is in SQLite; the monitor re-arms on first
   service use; runtime reconciliation continues via lease expiry.

## Rollback

Set `PAO_AGENT_RUNTIME_ENABLED=false` (or `PAO_AGENT_RUNTIME_DISPATCH_ENABLED=false`
to keep visibility while halting execution). The subsystem is lazy-activated
from routes/MCP only and is invisible to the core request path. Schema v49 is
additive; rollback is `DROP TABLE` of the eight `ar_*` tables plus reverting
`AGENT_OS_SCHEMA_VERSION` (only if no later migration has landed).
