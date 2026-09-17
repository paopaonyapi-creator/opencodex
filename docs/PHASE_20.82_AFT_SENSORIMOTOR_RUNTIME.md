# Phase 20.82 — Pao-hubPro × CortexKit AFT: Sensorimotor Execution Runtime

**Status:** production-hardened (this pass: transaction safety, provider hardening,
readiness matrix, MCP/REST parity, redaction, deterministic test suites).
**Schema:** agent-os v56 (`sm_*` tables + `sm_idempotency`).
**Surfaces:** REST `/api/agent-os/sensorimotor/*` · MCP `pao.aft.*` · GUI `Sensorimotor.tsx`.

---

## 1. What it is

The AFT (Action-Feedback-Transaction) sensorimotor runtime is Pao-hubPro's
transactional perception→plan→act→observe loop over a workspace. Every mutating
action is policy-gated, workspace-locked, checkpointed before it runs,
post-verified after it runs, observed with a health delta, and rolled back
deterministically on failure. A failed mutation must never leave an unknown
repository state.

```
session ──► perceive ──► plan(policy) ──► lock(workspace) ──► checkpoint
   ▲                                                           │
   │        observe(health delta) ◄── verify ◄── execute ◄─────┘
   └── close/abort                        │ failure
                                          ▼
                                     rollback(checkpoint)
```

## 2. Architecture & ownership boundaries

| Concern | Owner | Notes |
| --- | --- | --- |
| Workspace path safety | `agent-os/mcp-gateway/sandbox.ts` | Phase 20.74 seam, reused — no duplicate guard |
| Deny-by-default policy + approvals | `agent-os/policy.ts` | Phase 05 engine, the ONE authority |
| Command execution | `agent-os/sdlc/runner.ts` | argv spawn, no shell, timeout capture |
| Model routing (OmniRoute) | `agent-os/model-gateway/` | Phase 20.85 — AFT imports its health, never re-routes |
| Decision intelligence (Jev) | `agent-os/decision/` | Phase 20.84 — provider-mode selection lives here |
| Transaction runtime | `agent-os/sensorimotor/` | sessions, actions, checkpoints, locks, idempotency |
| HTTP surface | `server/management/sensorimotor-routes.ts` | shape validation + dispatch only |

There is exactly one policy engine, one audit trail (`sm_audit`), one health
system per concern, and no business logic in either surface layer.

## 3. Transaction safety (this pass)

- **Per-workspace transaction lock** (`workspace-lock.ts`): the checkpoint→
  observe window is serialized across sessions on the same workspace. Waiters
  fail with `SENSORIMOTOR_LOCK_TIMEOUT` (retryable) after `PAO_AFT_LOCK_WAIT_MS`
  instead of queueing forever; a holder that exceeds its TTL (timeout ×
  attempts + slack) is considered crashed and its lock is stealable, so a dead
  session cannot wedge a workspace.
- **Idempotency**: callers may pass `idempotencyKey` (≤128 chars) on any action
  via REST, MCP, or the service. The first terminal outcome (succeeded, failed,
  rolled_back, aborted, timed_out) is recorded in `sm_idempotency`; duplicates
  replay that outcome with `duplicate: true` and never re-execute the mutation.
  Non-terminal records (crash mid-window) are ignored — the checkpoint remains
  recoverable and the retried action proceeds fresh.
- **Stale-session detection**: a session idle beyond `PAO_AFT_SESSION_STALE_MS`
  (default 24 h) refuses new actions with `SENSORIMOTOR_SESSION_STALE`. Each
  action heartbeats the session's `updated_at`.
- **Post-action verification**: fs.write/delete/move verify their on-disk effect
  immediately (file exists / gone / moved); shell and git actions verify the
  workspace root still exists. Verification failure is retryable where the
  mutation is idempotent and triggers the rollback path for checkpointed
  mutations. The flag persists on the action row (`verified`).
- **Deterministic audit**: every action emits an ordered event sequence —
  `action_started → policy_evaluated → workspace_lock_acquired →
  checkpoint_created → action_finished | action_rolled_back |
  action_aborted → workspace_lock_released` — all redacted.

## 4. Security model

1. **Deny by default.** Every action maps to a Phase 05 capability
   (`fs.write` for fs.*; `shell.exec` for shell/git). No policy row → denied.
   `fs.write`/`shell.exec` additionally require a granted approval record.
2. **Single authoritative path.** REST and MCP both call
   `SensorimotorService.executeAction` → `executeAction()` in `actions.ts`.
   Neither surface can skip workspace validation, policy evaluation, approval
   checks, checkpointing, or audit — they never touch the filesystem
   themselves. Audited bypass search: the only shell→git side door
   (`shell.exec` with target `git`) now runs the same `assertGitCommandSafety`
   guard as `git.mutate`.
3. **Sandbox path guard.** All fs targets resolve through
   `ToolExecutionSandbox.assertSafeWorkspacePath` (traversal, null-byte,
   symlink-escape safe). Rollback restores through the same guard.
4. **Shell hardening (structural, not keyword-only).** The composed command
   line (target + arguments, so split fields can't evade) is checked for:
   destructive primitives; chaining/substitution metacharacters (`;`, `&&`,
   `||`, pipe, backtick, `$(`, newlines); nested shell interpreters
   (sh/bash/zsh/powershell/cmd/eval/… — blocked outright, because `shell.exec`
   already *is* the sanctioned shell surface); and code-carrying flags on
   interpreted runtimes (`node -e`, `python -c`, `powershell -enc`, `perl -e`,
   …) that would smuggle encoded destructive payloads. Module invocation
   (`python -m pytest`) and ordinary argv execution stay available. Execution
   itself is argv-spawn without a shell, so metacharacters are inert by
   construction.
5. **Git hardening (flag-aware).** `assertGitCommandSafety` parses the
   subcommand and its flags (including combined shorts like `-df` and
   `--flag=value`) and blocks: any `push` (covers force push / force-with-lease
   — remotes are not local-checkpointable); `clean` except dry-run;
   `filter-branch`/`filter-repo`; `reset --hard`; forced `checkout`/`restore`/
   `switch`; `branch`/`remote` deletion (`-d`, `-D`, `--delete`, `remove`);
   `rebase` except `--abort`/`--quit`; `stash drop`/`stash clear`;
   `worktree remove`; and repository-redirecting global flags
   (`-C`, `--git-dir`, `--work-tree`, `--namespace`, `--exec-path`,
   `--super-prefix`) that would escape the workspace. Inspection commands
   (`status`, `log`, `diff`, `show`, `rev-parse`, …) and ordinary work-tree
   mutations (`add`, `commit`, plain branch switch, `reset --soft`, `stash
   push/pop`, `worktree add`, `rebase --abort`, `clean -n`) pass through the
   normal policy gate without extra approval.
6. **Secret redaction.** Command stderr is foreign output: it is passed through
   `ToolExecutionSandbox.redactSecrets` before entering outcomes, the audit
   trail, or error messages. Audit details are serialized once and scrubbed.
   API keys travel only in headers, never in URLs, logs, or audit rows.

## 5. REST surface

| Method + path | Purpose |
| --- | --- |
| `GET /api/agent-os/sensorimotor/health` | liveness + runtime counters |
| `GET /api/agent-os/sensorimotor/readiness` | component readiness matrix (below) |
| `GET/POST /api/agent-os/sensorimotor/sessions` | list / create sessions |
| `POST /api/agent-os/sensorimotor/sessions/{id}/close` | close or abort |
| `GET /api/agent-os/sensorimotor/actions?sessionId=` | list session actions |
| `POST /api/agent-os/sensorimotor/actions` | transactional execution (accepts `idempotencyKey`) |
| `GET /api/agent-os/sensorimotor/actions/{id}` | outcome detail (incl. `checkpointId`, `verified`) |
| `POST /api/agent-os/sensorimotor/perceive` | workspace snapshot |
| `GET /api/agent-os/sensorimotor/perceptions/{id}` | stored perception |

## 6. MCP surface (`pao.aft.*`)

`pao.aft.health` (R0) · `pao.aft.readiness` (R0, new) · `pao.aft.perceive`
(R1) · `pao.aft.act` (R2, fs.* + idempotencyKey) · `pao.aft.shell` (R3) ·
`pao.aft.git` (R3) · `pao.aft.session.create` / `pao.aft.session.close` (R1).

**Parity contract:** tools and routes call the same service methods, so
authorization, policy, approvals, idempotency, audit events, session/action
ids, and error codes are identical by construction. MCP handlers normalize
`SensorimotorError` into `{ ok: false, status, error: { code, message } }` —
the same code and message the REST surface returns.

## 7. Readiness matrix (degraded, not dead)

`GET .../readiness` returns `{ ok, degraded, phase, policyVersion, checkedAt,
traceId, components: {...} }`:

| Component | Drives overall `ok`? | Source |
| --- | --- | --- |
| `sensorimotorRuntime` | yes (unavailable fails) | runtime counters |
| `workspace` | no (degraded only) | latest session workspace existence |
| `policyEngine` | yes | `policies` table reachable |
| `checkpointStore` | yes | `sm_checkpoints` reachable |
| `auditTrail` | yes | `sm_audit` reachable |
| `omniroute` | **no — degraded** | shared Phase 20.85 gateway probe (cached) |
| `typesafeJev` | **no — degraded** | Phase 20.84 `describeJevIntegration()` |
| `mcp` | no (degraded only) | registered `pao.aft.*` tool count |
| `managementApi` | no (always ok when served) | route handler reached |

The pattern is deliberate: **optional external dependencies degrade, core
governance components fail the readiness gate.** OmniRoute offline means
local-only execution; it does not mean the runtime is dead.

## 8. Dependency behavior (exact, honest)

### Phase 20.85 OmniRoute (`PAO_OMNIROUTE_BASE_URL`)

- Connection probe: `GET {base}/healthz`, cached for
  `PAO_OMNIROUTE_HEALTH_TTL_MS` (15 s default); readiness checks never hammer
  the daemon.
- **Fast-fail:** a fresh cached probe that already said `unreachable`
  short-circuits the next request into a structured failure — the gateway
  falls back to the direct adapter immediately instead of paying connect +
  retry costs against a daemon known to be down. A stale/absent cache always
  attempts for real (the first request after an outage is the probe), and a
  successful request marks the cache connected so recovery is immediate.
  Set `PAO_OMNIROUTE_FAST_FAIL=false` to always attempt.
- `executeCandidate`: per-request timeout `PAO_OMNIROUTE_TIMEOUT_MS` (30 s
  default), bounded retry `PAO_OMNIROUTE_RETRY_MAX` (2) with exponential
  backoff (200 ms → 2 s cap), honoring `Retry-After` (≤5 s) on 429. Only
  `timeout` / `provider_unavailable` / `rate_limit` / `transient` classes
  retry; `authentication` / `invalid_request` fail immediately.
- Failures are structured `OmniRouteFailure` objects
  (`failureClass`, `retryable`, `statusCode`, provider/model, correlationId,
  attempt). The gateway records circuit-breaker failures and falls back to the
  direct adapter per its envelope — offline OmniRoute is **degraded, never a
  crash, never a policy bypass**.
- Every request carries `x-pao-request-id`, `x-pao-trace-id`,
  `x-pao-attempt`, `x-pao-provider`, `x-pao-model` so gateway and daemon logs
  join on one correlation id.
- Base URL: http/https only; credentials in the URL are rejected at
  construction (the API key travels only via `Authorization`).
- **Exact live-validation command (run once a daemon is deployed):**
  `ocx gateway doctor --probe` — performs a fresh connection probe plus a
  one-shot completion round-trip and prints verdict + structured reasons.
  Expected output for a healthy deployment: `Verdict: READY`, `Live Probe: ok
  via <provider/model>`. A `DEGRADED` verdict with the daemon's exact error is
  an honest diagnostic, not a failure of the command (exit 0 either way).

### Phase 20.84 TypeSafe Jev (`PAO_JEV_PROVIDER`, `TYPESAFE_API_KEY`)

- `real` — requires BOTH `TYPESAFE_API_KEY` and the officially bound schema
  (`bindJevSchema()`, supplied by TypeSafe early access). **No schema is
  fabricated anywhere in this repository.** Missing either → structured
  `JEV_UNAVAILABLE` (`missing_credential` / `missing_schema`), readiness
  `degraded`, and an audited deterministic fallback
  (`jev_unavailable_fallback:<reason>` in the decision's policy reasons).
- `simulated` (default) — the local **calibrated simulation**: deterministic,
  no network, no credential. Explicitly named a development/test backend in
  every readiness surface; never presented as real Jev.
- `disabled` — Jev never selected; the deterministic rule provider answers.
- Unknown `PAO_JEV_PROVIDER` values fail startup validation loudly. The
  credential is read from the environment only; the only shape that ever
  reaches diagnostics is a last-4 hint (`***x9x9`).
- **Staged activation report:** `validateJevReadiness()` (exposed via
  `ocx gateway doctor` and MCP `pao.decision.jev-status`) walks the four
  stages — mode → credential → schema → transport — reporting each as
  pass/fail/not-required with the exact remediation for the first blocker.
- **Exact live-validation command (run once TypeSafe early access is
  granted):** (1) set `TYPESAFE_API_KEY` in the private environment;
  (2) call `bindJevSchema({ name, version })` with the official schema at
  startup; (3) set `PAO_JEV_PROVIDER=real` and restart; (4) run
  `ocx gateway doctor` — the Jev section must show every stage PASS and
  `realAvailable: true`. Until then the staged report honestly names the
  blocking stage; no substitute wire protocol exists or will be fabricated.

## 9. Configuration contract

See `.env.example` (Phase 20.82/20.84/20.85 section) for the full annotated
list: `PAO_OMNIROUTE_ENABLED`, `PAO_OMNIROUTE_BASE_URL`,
`PAO_OMNIROUTE_API_KEY`, `PAO_OMNIROUTE_TIMEOUT_MS`, `PAO_OMNIROUTE_RETRY_MAX`,
`PAO_OMNIROUTE_HEALTH_TTL_MS`, `PAO_JEV_PROVIDER`, `TYPESAFE_API_KEY`,
`PAO_AFT_SESSION_STALE_MS`, `PAO_AFT_LOCK_WAIT_MS`. Placeholders only — no
real credential material is committed.

## 10. Rollback behavior

- Checkpoints capture the byte content of the targeted files (≤50 files,
  ≤512 KiB total) before any fs.delete/fs.move, and the source for fs.write.
- On failure of a checkpointed mutation (including verification failure),
  `rollbackCheckpoint` restores every snapshotted file (or removes files that
  did not exist before) through the same sandbox path guard, then records the
  observation with outcome `rolled_back` and the health delta.
- Rollback failure is escalated to `SENSORIMOTOR_ROLLBACK_FAILED` with the
  original error code preserved — the action ends in a *named* state, never an
  unknown one. Checkpoints remain in `sm_checkpoints` for manual recovery.
- Shell/git mutations are not byte-checkpointed (arbitrary worktree effect);
  they are bounded by the destructive-command guards instead. `git` state
  recovery is out of AFT scope by design — use the git reflog.

## 11. Operational runbook

1. **Start/verify**: `GET /api/agent-os/sensorimotor/health` → `ok: true`.
   `GET .../readiness` → confirm all core components `ok`.
2. **OmniRoute offline** (readiness `components.omniroute.status === "degraded"`):
   start the daemon or point `PAO_OMNIROUTE_BASE_URL` at it. Runtime keeps
   serving local-only; no action required to "restore" AFT itself.
3. **Jev unavailable** (`components.typesafeJev`): expected until TypeSafe
   early access. To go live: obtain credentials → set `TYPESAFE_API_KEY` in the
   private environment (never in `.env.example`) → call `bindJevSchema()` with
   the official schema → set `PAO_JEV_PROVIDER=real` → restart → confirm
   readiness `ready`.
4. **Lock timeout on actions**: another session holds the workspace. Inspect
   via `GET sessions` (active sessions on the same root); close/abort the stale
   one. Crashed holders self-heal after the TTL.
5. **Stale session**: sessions idle >24 h refuse actions — create a new
   session. Tune `PAO_AFT_SESSION_STALE_MS` if the horizon is wrong for your
   workflow.
6. **Rollback needed manually**: find the checkpoint via
   `sm_checkpoints` (`session_id`, `action_id`, `snapshot_json`); the JSON
   contains base64 file contents and their relative paths.
7. **Audit review**: `sm_audit` events are ordered per action; `details_json`
   is secret-scrubbed at write time. Query by `session_id`/`action_id`.

### Troubleshooting

| Symptom | Meaning | Fix |
| --- | --- | --- |
| `SENSORIMOTOR_LOCK_TIMEOUT` | concurrent mutation window on same workspace | wait/retry; check active sessions |
| `SENSORIMOTOR_SESSION_STALE` | idle session beyond horizon | open a new session |
| `SENSORIMOTOR_CHECKPOINT_FAILED` 413 | target exceeds checkpoint budget | snapshot manually; split the action |
| `SENSORIMOTOR_VERIFICATION_FAILED` | mutation ran but on-disk effect not confirmed | runtime auto-retried/rolled back; inspect `sm_observations` |
| `SENSORIMOTOR_ROLLBACK_FAILED` | restore failed after a failed mutation | **action required**: inspect checkpoint + workspace manually |
| readiness `omniroute: degraded` | daemon offline | start daemon / fix `PAO_OMNIROUTE_BASE_URL` |
| readiness `typesafeJev: degraded` | expected until TypeSafe access | see §8 |

## 12. Production readiness checklist

- [x] `bun run typecheck` clean
- [x] Focused suites green: `tests/sensorimotor-aft.test.ts` (13),
      `tests/aft-hardening.test.ts` (81) — transaction safety, shell/git
      hardening, OmniRoute offline/timeout/retry/redaction, Jev modes,
      MCP/REST parity, audit completeness, secret redaction
- [x] MCP and REST share one service, one policy path, one audit vocabulary
- [x] No `TODO_PROVIDER_SCHEMA` leakage; no fabricated schema/credentials
- [x] Offline OmniRoute → degraded readiness + structured failures, no crash
- [x] Rollback verified by test (fs.move failure → `rolled_back`, known state)
- [x] Idempotency, locking, stale sessions, post-verification verified by test
- [x] No credential literals committed (runtime-synthesized test fixtures only)

## 13. Exact limitations (honest)

1. **Real TypeSafe Jev transport is not implemented** — it cannot be, without
   the early-access schema. `real` mode reports unavailability structurally;
   nothing pretends otherwise.
2. **OmniRoute daemon is not shipped here** — integration is a client with
   health/retry/circuit semantics; a running daemon at
   `PAO_OMNIROUTE_BASE_URL` is an external deployment prerequisite.
3. **Workspace lock is single-process** — correct for the Pao server model;
   multi-process deployments would need a file/DB-backed lock (deliberately
   not faked).
4. **Directory mutations are not byte-checkpointed** — recursive delete/move
   of directories checkpoints plain files only, bounded to 50 files / 512 KiB;
   larger trees should be handled with VCS-based recovery.
5. **Symbol perception is structural**, not LSP-grade (pinned AFT toolchain
   integration remains future work).
6. **PTY streaming** (live stdout) is not provided; command output is captured
   post-run.
7. **Approval records are capability-scoped** (per Phase 05), not per-action —
   a granted approval for `shell.exec` covers that capability until policy is
   tightened; per-action approval tickets remain future work.
