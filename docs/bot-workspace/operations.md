# Teammate Workspace Operations (Phase 20.42)

## Runbook

### Create a working team

1. Dashboard → Teammate Workspace → Agents → create named agents
   (Researcher / Planner / Codex Coder / Reviewer presets).
2. New agents bind to the deterministic mock runtime automatically —
   truthfully runnable in dev. For production, rebind each agent to a
   real provider/runtime binding (`POST /api/agent-workspace/providers`,
   `POST /api/agent-workspace/runtimes`, then PATCH the agent).
3. Select agents (in order) → Teams → name the team → Create (a group
   chat opens).
4. Send a task → the round confirmation shows the exact resolved order
   and per-agent provider/runtime → Run round.
5. The run timeline shows per-agent status/attempts; Stop is available
   while cancellable; completed outputs survive a Stop.
6. Approval cards appear at the top for gated actions; approve once or
   deny (human decision).

### Routines

- Create with owner agent/team + manual trigger; Run Now for a durable,
  idempotent run (`idempotencyKey` deduplicates repeated deliveries).
- Interval routines need the server running — the due-check is polled on
  demand; the UI never claims 24/7 execution.
- Pause blocks new runs; history is per-routine and durable.

### Recovery after crash/restart

`POST /api/agent-workspace/reconcile` (also safe to call after any
restart): transient executions reconcile to `orphaned`/`failed` with
`RUNTIME_CRASHED`; `waiting_approval` persists; completed output is
preserved; nothing replays automatically.

### Export / import

`GET /api/agent-workspace/export` returns a versioned
`pao-hubpro-workspace` document (agents, teams, routines, provider
bindings with `credential_ref` only). Secrets are never included; the
document states its redaction boundary.

## Troubleshooting

| Symptom | Meaning / action |
|---|---|
| `AGENT_CONFIG_INVALID` | Agent validation failed — see `GET agents/detail` issues (CREDENTIAL_MISSING, RUNTIME_NOT_CONFIGURED…). |
| `AGENT_DISABLED` | Enable the agent before dispatch. |
| `RUNTIME_NOT_AVAILABLE` | Runtime type has no adapter (e.g. codex runtime disabled via `PAO_CODEX_NATIVE_RUNTIME=false`). |
| `CODEX_PROCESS_FAILED` | Codex process error surfaced truthfully; retry creates a new attempt. |
| `ROUTINE_CONFLICT` | Routine paused/disabled, or a previous run is still open under `skip_if_running`. |
| `APPROVAL_DENIED` / `expired` | Decision was denied or the 10-minute window lapsed — re-request. |
| Round stuck `awaiting_consent` | Consent gate: confirm via rounds/run. |

## Configuration

```env
BW_DEFAULT_WORKSPACE=pao-hubpro
BW_MAX_PARALLEL=3
```

## Tests

`bun test tests/bot-workspace.test.ts` covers: exact round order, consent
gate, stop semantics, retry-as-new-attempt, state-machine transition
rejection, approval fingerprint/replay/expiry/human-invariant, mention
ambiguity + disabled inertness, bounded context, redaction, routine
idempotency + pause, mock adapter determinism + cancel, export without
secrets, endpoint validation, and restart reconciliation.
