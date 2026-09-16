# Phase 20.37 — Pao-hubPro × OrchestKit-inspired Agentic Development OS

> **Status:** Implemented (control-plane delta; clean-room — OrchestKit patterns adapted, no upstream code)
> **Reference:** `yonatangross/orchestkit` (§48) — architectural patterns only
> **Operations doc:** [`docs/orchestration/README.md`](./orchestration/README.md)
> **Validated:** 2026-09-13

---

## 0. The architecture decision

The repository already owns every execution primitive this phase needs: Phase 20.27
provides command classification/path policy, Phase 20.28 the governed dispatch with
approvals + audit, Phase 20.22 the reviewer council, Phase 20.24 the allowlisted
process runner, Phase 20.35 the redaction layer. Phase 20.37 therefore ships the
missing **coordination plane**: agent/skill registries, the deterministic router,
the run state machine, the hook engine, worktree isolation, and the memory store —
all wired *through* the existing subsystems rather than around them.

## 1. Reuse map

| Spec component | Verdict | Lives in |
| --- | --- | --- |
| Policy engine, approvals, audit | **REUSED** | Phase 20.28 patterns; orchestration approvals are human-governed like the cockpit/governance gates |
| Command safety / path safety | **REUSED** | Phase 20.27 `classifyCommand` + new secret-path/traversal guards (fail closed) |
| Runtime adapters (Codex/Claude/local) | **REUSED** | cockpit detection concept; deterministic built-in adapter ships; live runtimes plug via `registerAdapter` |
| Reviewer Council | **REUSED** | Phase 20.22 `ReviewerCouncilBridge` — critical finding blocks DONE |
| Redaction | **REUSED + EXTENDED** | Phase 20.35 + env/cookie/private-key patterns (§28) |
| Safe process execution | **REUSED** | Phase 20.24 `runProcessSafely` (argv, timeouts) for git worktree ops |
| New | **NEW** | registries (9 agents, 12 skills, 6 hook policies), deterministic router, run state machine, hook engine, worktree manager, memory/decision store, doctor |

## 2. Net-new module (`src/agent-os/agentic-os/`)

`types.ts` (contracts, state machine) · `seeds.ts` (§9/§11/§12/§18 seed data) ·
`router.ts` (explainable deterministic scoring, hard disqualifiers, stable
tie-break; write work never routes to read-only agents; orchestrator opens
approval gates for risk ≥ 3) · `guards.ts` (path/command guards + hook engine +
redaction; broken security guards fail closed) · `store.ts` (9 `orch_*` tables,
v37) · `worktree.ts` (allocate/mark/preserve/release — dirty trees are never
touched, PRESERVED state, base revision recorded) · `service.ts` (intake →
hooks → route → approval gate → adapter → verify → review → memory/audit;
human-only approval resolution; doctor).

Database: `AGENT_OS_SCHEMA_VERSION` 36 → **37**, additive migration only.

## 3. REST surface (18 routes, `/api/agent-os/orch/*`)

`GET health` (doctor) · `GET agents` + `POST agents/enable` (human) · `GET skills` ·
`GET hooks` · `POST route` (pure preview) · `POST/GET runs` + `detail` + `cancel` ·
`GET approvals` + `POST approvals/resolve` (human) · `GET worktrees` +
`allocate`/`release` (release refuses dirty) · `GET/POST memories` (redacted,
bounded) · `GET audit` (runId/eventType/severity filters). Registered under
`AGENTIC_OS_VERB_DEFERRAL`.

## 4. Safety verification (spec §37 integration paths, all covered in tests)

- Read-only goal → explorer + explore skill, risk 0, no approval, no writes.
- Risk-3 goal → run pauses `WAITING_APPROVAL`; agents structurally cannot
  self-approve; reject cancels; approve resumes through the state machine.
- `.env`/private-key writes denied before execution, audited, nothing persisted.
- `git reset --hard` / force-push / shell escapes denied (fail closed).
- Reviewer critical finding blocks DONE.
- Dirty worktrees are `PRESERVED`, never auto-cleaned; release refuses dirty.
- Audit redaction strips bearer tokens, env assignments, cookies, private keys.
- Invalid state transitions rejected + audited; terminal states immutable.

## 5. Honest accounting

- Live Codex/Claude adapters plug into `registerAdapter` but only the
  deterministic adapter ships enabled — real CLI dispatch belongs to the cockpit
  session path and is a follow-up wiring task, honestly reported (a run without
  a live adapter ends `DONE_WITH_CONCERNS`/`BLOCKED`, never fake-success).
- Streaming run events (§37 events feed) reuse `recordAgentEvent`; SSE endpoint
  deferred.
- Parallel-writer worktree pools: allocation exists, per-file merge-risk
  warnings deferred.
- Dashboard ships Overview/Agents/Hooks/Runs/Approvals/Audit tabs; run-timeline
  detail view is a follow-up (tool-call data is in the API).
