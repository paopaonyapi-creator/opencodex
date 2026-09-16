# Teammate Workspace Architecture (Phase 20.42)

## Planes

```text
Workspace UI (sidebar / conversation / inspector / routines)
        |
Application services (agents, teams, conversations, drafts, routines,
                      approvals, export)  — service.ts
        |
Orchestration control plane (GroupRoundOrchestrator, state machines,
                             retry/cancel coordination) — orchestrator.ts
        |
Runtime adapters (mock chat, delegated chat_provider, Codex App Server)
        |
Persistence (17 bw_* tables, schema v42) + audit (redacted)
```

## Group round semantics (spec §11)

- `createRound` validates every agent (typed `AgentValidationResult`,
  never a generic 500), snapshots the exact resolved recipient order,
  and parks the round in `awaiting_consent`.
- `runRound` walks the resolved order: ordered = strict sequential, each
  execution receives a bounded context package (user task + approved
  prior outputs of the same round, via ContextBuilder); parallel =
  bounded concurrency (`BW_MAX_PARALLEL`, default 3) for independent
  agents.
- Failure policy: `stop_on_failure` (default) halts scheduling;
  `continue_and_mark_partial` records failures and keeps going.
- Stop: cancellation intent → adapter cancel signal → remaining agents
  never start → completed outputs remain visible as final messages →
  truthful `cancelled` terminal state with the stop reason recorded.
- Retry: `retry_failed_agent` creates a NEW attempt row
  (`maxAttemptFor + 1`); previous execution records are immutable.

## Execution events (spec §16)

Every execution persists normalized events (`execution.queued/started/
output.delta/output.completed/approval.*/cancelled/failed/completed`,
`round.*`, `routine.run.*`) with monotonically increasing per-execution
sequence and a UNIQUE(execution_id, sequence) constraint. Clients
reconnect with `after sequence N` via `GET rounds/detail` (events
embedded). Deltas are redacted before persistence.

## Codex App Server adapter (spec §9)

`CodexAppServerAdapter` wraps the Phase 20.21 `CodexRuntimeService`
(process lifecycle, version check, JSONL protocol, thread mapping,
approval forwarding — all already production code there). Capabilities
are reported honestly; when the runtime is disabled/absent the adapter
returns `unavailable` and dispatch fails typed
(`RUNTIME_NOT_AVAILABLE` / `CODEX_PROCESS_FAILED`) — never a fake
success. A lost process is never interpreted as a completed run.
Authentication rides the existing supported Codex path; no `auth.json`
token import exists in this phase.

## Routines (spec §15)

Durable runs with idempotency keys (UNIQUE index per routine+key),
concurrency policy enforcement (`skip_if_running` default; `queue`/
`replace`/`allow_parallel` validated — the last requires explicit
configuration), `manual`/`interval`/`daily` triggers (interval uses a
polled due-check — truthful "requires active Pao-hubPro worker" wake
semantics), pause/resume, and per-run error codes with safe messages.

## Persistence (schema v42)

`bw_workspaces`, `bw_agents`, `bw_teams`, `bw_team_members`,
`bw_conversations`, `bw_messages`, `bw_message_mentions`, `bw_drafts`,
`bw_provider_bindings`, `bw_runtime_bindings`, `bw_group_rounds`,
`bw_agent_executions`, `bw_execution_events`, `bw_approvals`,
`bw_routines`, `bw_routine_runs`, `bw_audit_events` — additive, with the
indexes required by spec §6.2.
