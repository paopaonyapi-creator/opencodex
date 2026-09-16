# Named AI Teammate Workspace (Phase 20.42)

Local-first AI teammate workspace: named agents with editable profiles,
direct and group conversations, ordered/parallel multi-agent rounds,
mentions and replies, truthful streaming, Stop/Retry with partial-result
preservation, fingerprint-bound approval gates, routines with durable
history, provider/runtime binding registries, safe export, crash
recovery, and a Codex App Server adapter over the Phase 20.21 native
runtime. Clean-room implementation of BotWorkspace product patterns —
no macOS/Swift code and no upstream source copied.

## Core concepts

- **Agent** — durable named teammate; id is identity, display name is
  not. Roles, system instructions, provider/runtime bindings, policies.
  Disabling blocks new runs but never deletes history.
- **Team** — members with preserved positions; orchestration modes
  (`ordered` default, `parallel`, `lead_then_specialists`,
  `specialists_then_reviewer`, `review_loop`, `manual`); failure policies
  (`stop_on_failure` default, `continue_and_mark_partial`, …).
- **Group round** — backend-driven state machine:
  `draft → resolving_recipients → awaiting_consent → queued → running →
  paused_for_approval / partial / failed / cancelled / completed`.
  Invalid transitions are rejected centrally.
- **Execution** — `created → queued → starting → running →
  waiting_approval / cancelling → cancelled / failed / completed /
  orphaned`. Retries create NEW attempts; history is immutable.
- **Approval** — fingerprint-bound to the exact action payload,
  single-use, expiring, human-actor-only decisions, redacted payloads.
- **Routine** — Trigger + Owner + instruction/Skill + concurrency policy
  + durable run history. P0 triggers: `manual`, `interval`, `daily`
  (registry-ready for webhook/event/file). Idempotency keys deduplicate
  repeated trigger deliveries. Wake limitation is truthful: interval
  routines execute only while the Pao-hubPro server is running (polled
  due-check, no fake 24/7 claim).

## Provider / runtime separation

- **Provider binding** — provider type, endpoint, model, `credential_ref`
  (reference only — raw secrets are never stored in DB rows, logs, or
  exports).
- **Runtime binding** — `chat_provider` (delegates to the injectable
  completion function bound to the existing provider router),
  `codex_app_server` (wraps the Phase 20.21 runtime: process lifecycle,
  JSONL protocol, thread mapping, approval forwarding), `mcp_agent`,
  `local_agent`, `reviewer_council`, `custom` (truthful
  RUNTIME_NOT_AVAILABLE until an adapter exists).
- New agents are auto-bound to the deterministic mock runtime
  (`deterministic-mock`) so they are truthfully runnable in dev;
  production use rebinds to a real provider/runtime.

## Quick start

```bash
bun run src/cli/index.ts start --port 10100
# Dashboard → Teammate Workspace:
# 1. Create agents (Researcher, Planner, Reviewer…)
# 2. Create a team (ordered members) — a group chat opens
# 3. Send a task → review the resolved recipient order → Run round
# 4. Watch per-agent timeline states; Stop anytime (completed outputs kept)
# 5. Approve/deny approval cards; create routines and Run Now
```

## API

34 full-literal routes under `/api/agent-workspace/*` (agents, teams,
conversations/messages/drafts, providers/runtimes, rounds
start/run/detail/cancel/retry, approvals, routines/runs, audit, export,
reconcile). 9 `workspace_*` WebMCP tools in the central gateway.

## Safety

- Mentions resolve to stable agent IDs (longest-prefix word matching);
  duplicate names are ambiguous and never guessed; disabled agents are
  inert and cannot be dispatched.
- ContextBuilder assembles a deterministic, size-bounded context package
  (no blind database dumps).
- Secrets: DB stores `credential_ref` only; redaction (20.35/20.28 stack)
  runs before audit/event persistence; export never includes secrets and
  states its redaction boundary explicitly.
- Provider endpoint validation (http(s) only).
- Recovery: restart reconciles transient executions to
  `orphaned`/`failed` truthfully; completed output is preserved; side
  effects are never automatically replayed.

## Documentation map

- `docs/bot-workspace/architecture.md` — planes, round semantics
- `docs/bot-workspace/security.md` — approvals, secrets, SSRF policy
- `docs/bot-workspace/operations.md` — runbook, recovery, troubleshooting
- Upstream reference note: `docs/bot-workspace/upstream-reference.md`

## Deviations from the spec's literal text

- Agent identity tables are new `bw_*` tables (schema v42) rather than
  extensions of the Phase 20.37 orchestration agents — those model
  pipeline executors, not named teammates (spec §36 mapping documented).
- Codex integration reuses the Phase 20.21 CodexRuntimeService as the
  App Server adapter surface (spec rule 8: prefer the previous
  Codex-native phase); no auth.json import path exists or is used.
- Skills: the existing Pao-hubPro skill registry is referenced by slug in
  `capability_policy_json`; no duplicate skill tables.
- Group rounds that are stopped after producing outputs end truthfully
  `cancelled` (with outputs preserved as messages), not `partial`.
