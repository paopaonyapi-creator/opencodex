# Unified AI Coding Workspace (Phase 20.39)

A local-first, provider-agnostic cockpit for native AI coding runtimes —
discover, resume, stream, control, audit, and safely execute Codex /
Claude Code / mock sessions from one place. Phase 20.39 is an
orchestration + UX + safety layer, **not** another model router; the
20.27 agency cockpit keeps its own `/api/agent-os/cockpit` surface while
this module serves `/api/agent-os/coding-workspace/*`.

## What it gives you

- **Unified session registry** — every session is a Pao wrapper
  (`phs_…`) that references the provider's *native* session id verbatim;
  nothing fakes native identity.
- **Provider adapter registry** — normalized `CodingProviderAdapter`
  contract with capability probing; the UI never contains provider logic.
- **Normalized event bus** — monotonic per-session sequences, idempotent
  ingestion, replay (`GET …/sessions/events?after=N`), SSE streaming with
  `Last-Event-ID` semantics. Deltas stream live but only structural
  events are persisted.
- **`@context` registry** — `@file`, `@folder`, `@session`, `@run`,
  `@agent`, `@skill`, `@mcp`, `@phase`, `@workspace`, `@repo`,
  `@artifact`. Refs resolve **server-side** under workspace containment
  checks; file contents never enter frontend text fields.
- **`/command` registry** — `/status`, `/sessions`, `/usage`, `/cancel`,
  `/checkpoint`, `/rollback` (extensible). Frontend renders metadata
  only; handlers run through authorization + policy.
- **Execution policy engine** — action categories × execution levels
  (`LEVEL_0_READ_ONLY` … `LEVEL_5_FULL_CONTROL`) with a deterministic
  0–100 risk score. New workspaces default to read-only.
- **Approval gateway** — `REQUIRE_APPROVAL` actions create human-gated,
  single-use approvals **hash-bound to the exact approved parameters**;
  replay across unrelated actions is structurally impossible.
- **One-writer workspace lock** — atomic via a partial UNIQUE index;
  readers coexist; leases heartbeat and expire; healthy leases can only
  move via audited, confirmed takeover.
- **Safe CLI bridge** — every process runs argv-only through the Phase
  20.24 `runProcessSafely` choke point (allowlist, env allowlist,
  timeouts, output caps, shell never invoked).
- **Usage telemetry** — provider-reported vs calculated vs unknown is
  kept separate; unknown values display as *Unavailable*, never invented.
- **Audit** — workspace/session/lock/approval/policy/tool/shell/provider
  events, redacted centrally before persistence.

## Providers

| Provider | id | Availability behavior |
|---|---|---|
| OpenAI Codex | `codex` | Wraps the Phase 20.21 runtime. Probes the codex CLI; unavailable cleanly when the CLI is missing or `PAO_CODEX_NATIVE_RUNTIME=false`. No usage reported (the 20.21 runtime does not expose tokens) rather than invented. |
| Claude Code | `claude_code` | Structured CLI subprocess adapter (one-shot headless turns, `--output-format stream-json`, native resume via `--resume`). Probes `claude --version`; reports `authenticated: null` until a real turn verifies login. |
| Mock | `mock` | Deterministic in-process provider for tests/development: scripted events, approval simulation, usage simulation, cancellation. Never the default production provider. |
| Local / other | — | The adapter contract is the plugin slot (Qwen/DeepSeek-local/llama.cpp/Ollama/future MCP runtimes). Not blocked on implementing every backend. |

### Prerequisites

- **Claude Code**: install the CLI and run `claude login` once. The
  cockpit never passes `--dangerously-skip-permissions` unless ALL of:
  env `PAO_CLAUDE_ALLOW_DANGEROUS_SKIP_PERMISSIONS=true`, workspace
  trust `PRIVILEGED`, and the explicit per-call flag are set. Default OFF.
- **Codex**: the Phase 20.21 native runtime must be enabled (`PAO_CODEX_NATIVE_RUNTIME`)
  and the `codex` CLI on PATH.

## Workspace trust & execution levels

Trust levels: `UNTRUSTED` → `READ_ONLY` → `STANDARD` → `TRUSTED` →
`PRIVILEGED`. Trust **caps** the configured execution level
(`PRIVILEGED` never assigned automatically; setting it requires a human
actor AND `PAO_ALLOW_PRIVILEGED_MODE=true`).

| Category | Minimum level | Approval |
|---|---|---|
| READ | 0 | — |
| WRITE | 1 | risk ≥ 50 |
| SHELL | 2 | always |
| NETWORK / GIT_WRITE / DELETE | 3 | always for DELETE |
| PACKAGE_INSTALL / PROCESS_CONTROL / DEPLOY | 4/5 | always |
| SECRET_ACCESS / PRIVILEGED | 5 | always |

Risk increases with: outside-workspace targets, system paths, recursive
deletes, credential-bearing paths, privilege escalation, remote-content-
piped-to-shell, public binds, cloud metadata endpoints. **The risk score
is one policy input, not a security guarantee.**

## Writer lock rules

1. Read-only sessions coexist; one writer per workspace.
2. Writers acquire a lease before mutation; leases heartbeat and expire.
3. Expired leases are reclaimable (audited); healthy leases require
   explicit `confirmHealthyTakeover` and are audited as takeover.
4. Crash never leaves a permanent lock — expiry reclaims it.
5. Designed for future per-agent git-worktree isolation (20.40 hook).

## LAN / bind safety

The management API inherits the repository's existing auth model: admin
token, loopback binding by default, CORS allowlist — no unauthenticated
execution surface is added. There is no arbitrary `/exec` endpoint; the
only local execution surfaces are the policy-gated CLI bridge and
workspace-bounded file reads.

## Quick start

```bash
# 1. Register a workspace (dashboard → Coding Workspace → Add)
curl -X POST :port/api/agent-os/coding-workspace/workspaces \
  -H "authorization: Bearer $TOKEN" \
  -d '{"rootPath":"/absolute/path/to/project","actor":"operator"}'

# 2. Probe providers
curl -X POST :port/api/agent-os/coding-workspace/providers/probe \
  -H "authorization: Bearer $TOKEN" -d '{"providerId":"claude_code"}'

# 3. Start a session (mock provider works with zero setup)
curl -X POST :port/api/agent-os/coding-workspace/sessions/start \
  -H "authorization: Bearer $TOKEN" \
  -d '{"workspaceId":"ws_…","providerId":"mock","actor":"operator","mode":"CHAT"}'

# 4. Stream events (SSE)
curl -N :port/api/agent-os/coding-workspace/sessions/stream?id=phs_…
```

## Troubleshooting

| Symptom | Meaning / recovery |
|---|---|
| `PROVIDER_NOT_INSTALLED` | CLI missing from PATH — install Claude Code / Codex, re-probe. |
| `PROVIDER_NOT_AUTHENTICATED` | Run `claude login` (Claude Code) or complete Codex auth. |
| `LOCK_CONFLICT` | Another writer holds the lease — wait, take over (audited), or work read-only. |
| `POLICY_DENIED` | Execution level or trust too low for the action — raise via human-gated routes. |
| `APPROVAL_EXPIRED` | Requests expire (10 min default) — re-issue the action. |
| `PATH_OUTSIDE_WORKSPACE` | A ref/target escaped the workspace — use paths inside the root. |
| Session `STALE` | Reconciliation marked it after inactivity; history is preserved — resume it. |

## API surface

34 full-literal routes under `/api/agent-os/coding-workspace/*`
(health, workspaces, providers, sessions, discovery, approvals, locks,
usage, context, slash-commands, audit, reconcile, runs, tools,
processes) plus 13 `cockpit_*` WebMCP tools. DB: schema v39, 13 `cc_*`
tables (additive).

## Deviations & notes

- 20.27's agency cockpit owns `/api/agent-os/cockpit`; this module uses
  `/api/agent-os/coding-workspace` (rule 20: closest compatible architecture).
- Session history is never auto-deleted; reconciliation only annotates.
- `/rollback` returns a structured unsupported state instead of running
  destructive git (`git reset --hard` is never executed by the cockpit).
- One-shot CLI turn semantics mean in-flight turns are cooperatively
  cancelled (documented graceful degradation of the process supervisor).
