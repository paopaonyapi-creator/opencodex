# amux compatibility record (Phase 20.61)

Upstream: https://github.com/mixpeek/amux — "open-source control plane for AI
coding agents" (Rust, one binary, SQLite, axum HTTP API on port 8824).

## Pinned version

| Field | Value |
|---|---|
| Repository | https://github.com/mixpeek/amux |
| Pinned commit | `3a205a41a60ea790dfae48a5056ef70d6f9361e9` (main, 2026-09 era) |
| Recorded upstream commit message | `fix(outbox): the sync banner records what it claims (AMUX-4682)` |
| Build checksum | Not applicable — Pao-hubPro consumes no upstream build artifact; the operator deploys the upstream binary directly and records its checksum locally at install time |
| Configuration schema | `server.env` (`AMUX_RS_PORT`, `AMUX_AUTH_TOKEN`, `AMUX_INTERNAL_TOKEN`, `AMUX_HOME`, `AMUX_DB`); the Python-era knobs are inert on the Rust server — `server.env.example` marks them explicitly |
| License | "MIT + Commons Clause" (GitHub reports `Other/NOASSERTION`); see `docs/legal/amux-license-review.md` |
| License review date | 2026-09-16 |
| Adapter compatibility version | `ar-adapter-1` |

No GitHub releases are published, so pinning is by commit SHA. The adapter
gates on the commit reported by `GET /health` and fails closed
(`RUNTIME_VERSION_MISMATCH`) on drift; override deliberately via
`PAO_AMUX_PINNED_COMMIT` after re-validating against a new upstream commit.

## Verified API surface used by the adapter

Source: https://amux.io/guides/rest-api-reference/ + README (pinned era).

| Endpoint | Used for |
|---|---|
| `GET /health` | health + commit gate |
| `GET /api/board` | read runtime task state |
| `POST /api/board` | create a board item on dispatch |
| `POST /api/board/:id/claim` | upstream atomic claim (CAS) |
| `GET /api/sessions` | list workers (upstream: "worker = session") |
| `GET /api/sessions/:name/meta` | session state |
| `GET /api/sessions/:name/peek` | terminal output (advisory, redacted) |
| `POST /api/sessions/:name/send` | task dispatch / checkpoint re-send |
| `GET /api/sync?since=<unix>` | poll-based delta events (no SSE dependency) |

Auth: bearer token (`AMUX_AUTH_TOKEN`) sent as `Authorization: Bearer`;
localhost callers are exempt upstream, but Pao always sends the header when a
token is configured.

## Deliberate fail-closed gaps

Operations the upstream reference does not document at the pinned commit are
**not guessed** by the adapter; they fail with `RUNTIME_UNSUPPORTED`:

- session creation / session stop (amux owns its tmux lanes; Pao attaches to
  existing lanes by name)
- raw amux administrative APIs (never proxied to browsers per spec §15)

Request/response **body fields** are not documented upstream for board/session
endpoints. The adapter sends the minimal documented shapes (`title`,
`description`, `worker`, `text`) and normalizes responses defensively; any
contract mismatch surfaces as a typed `RUNTIME_*` error rather than silent
misbehavior. Re-validate field-level behavior against a new pinned commit
before upgrading.

## Compatibility test report

`bun test tests/agent-runtime.test.ts` — 27 pass / 0 fail (2026-09-16),
including adapter error mapping, commit-gate fail-closed behavior, atomic
claim races, lease reclamation, bounded recovery, payload-bound approvals,
and worktree isolation against a disposable git fixture.
