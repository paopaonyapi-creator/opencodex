# Teammate Workspace Security (Phase 20.42)

## Approval engine (spec §14)

- Risk levels `low` / `medium` / `high` / `critical`; approvals are bound
  to an HMAC-style SHA-256 fingerprint of the exact redacted action
  payload + agent + action type.
- Single-use consumption; replay rejected (`already consumed`).
- Expiry (10 min default) → `expired`; expired approvals cannot decide or
  consume.
- Decisions require the human-actor invariant
  (`operator|dashboard|user|human|owner`); an agent cannot decide.
- A denied approval cannot be routed around an alternate adapter: the
  consumption check is the single gate before any gated dispatch.
- Approval payloads are redacted (API keys, bearer tokens, cookies,
  password/secret key names) BEFORE persistence — test-verified.
- No "Always allow" in this phase: every approval is approve-once or deny.

## Secrets (spec §19)

- `bw_provider_bindings.credential_ref` stores a REFERENCE only. API
  keys, tokens, cookies, passwords never enter DB rows, audit records,
  event payloads, or exports.
- Shared redaction utility (Phase 20.35 regex stack + 20.28 key-name
  scrubber) applied before audit/event persistence.
- Export states its redaction boundary explicitly and excludes secret
  material by default (test-verified).

## Injection & spoofing

- Mentions resolve to stable agent IDs via longest-prefix matching;
  duplicate display names are ambiguous (never guessed); disabled agents
  are inert — mention spoofing cannot resurrect them.
- Provider endpoints must be absolute http(s) URLs (SSRF surface
  minimized; private/local endpoints follow existing repo policy).
- No shell anywhere in the adapter layer; the Codex adapter reuses the
  Phase 20.21 process manager (argv discipline, JSONL protocol).
- Cross-workspace isolation: all reads/writes are scoped by the resolved
  workspace id; conversation/round/execution lookups validate membership
  through the workspace-scoped stores.

## Audit (spec §31)

`agent.created/updated/disabled`, `team.updated`, `provider.created`,
`routine.created/paused/enabled`, `approval.requested/approved/denied`,
`execution.cancel_requested`, `export.created` — all with redacted
metadata, stored in `bw_audit_events` with workspace + timestamp indexes.

## Recovery (spec §32)

On restart, executions in transient states reconcile truthfully:
`starting/cancelling` → `orphaned` (RUNTIME_CRASHED), others → `failed`
with a safe message; `waiting_approval` remains valid; completed output
is preserved; no side-effecting action is automatically replayed.
