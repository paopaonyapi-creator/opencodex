# Phase 20.95 — Content Acquisition Gateway

**Status:** IMPLEMENTED (control plane — plan/policy/jobs/artifacts/session refs, MCP-first OmniGet adapter, CLI fallback, mock worker, REST/MCP/GUI)
**Blueprint:** `docs/Phase_20.95_Pao-hubPro_x_OmniGet_Next.md`
**Law:** OmniGet is a replaceable local worker. Pao-hubPro owns intent, policy, authorization, secrets, artifacts, knowledge, and audit. GPL source is not vendored.

## Architecture law

1. **Reuse, do not clone.** URL policy, process spawn, and the 20.24 OmniGet CLI probe stay in `src/agent-os/media-acquisition/`. This phase wraps them.
2. **MCP first, CLI fallback, mock last.** Live OmniGet success is never faked. When MCP/CLI are unconfigured the mock worker is labeled as such.
3. **No secrets in agent context.** Cookies, bearer tokens, and OmniGet tokens are rejected. Session refs are opaque `secret://` identifiers with TTL and revocation.
4. **No DRM/paywall bypass.** Netflix-class hosts are `BLOCKED_OR_DRM`. Authenticated courses require human approval.
5. **Retrievable ≠ licensed.** `commercialRights` defaults to `unknown`. Acquired text is `untrusted_external_content`.

## Modules (`src/agent-os/acquisition/`)

| Module | Responsibility |
| --- | --- |
| `types.ts` | Canonical request/plan/job/artifact/error contracts |
| `classify.ts` | Source class, auth class, Thai/English intent inference; reuses 20.24 SSRF policy |
| `policy.ts` | allow / allow_with_limits / require_approval / deny |
| `planner.ts` | Subtitle-first research plan, adapter preference MCP > CLI > mock > legacy |
| `adapters.ts` | OmniGet MCP (discovered ports), OmniGet CLI, mock, legacy 20.24 wrapper |
| `service.ts` | Durable `acq_*` jobs, artifact SHA-256, session broker, approval resume |
| `mcp-tools.ts` | `pao.acquire`, `pao.acquire.status`, `pao.acquire.health` |

## Database (schema v66, `acq_*` prefix)

`acq_jobs`, `acq_attempts`, `acq_artifacts`, `acq_session_refs`, `acq_events`

20.24 `media_*` tables are untouched.

## REST (`/api/agent-os/acquisition/*`)

Health, doctor, capabilities, plan, jobs CRUD/pause/resume/cancel/retry/approve/deny, artifacts, session issue/revoke.

## GUI

`#acquisition` — New request, jobs, approval, artifacts, sessions, adapter health. Live API only. Mock fallback is labeled.

## Tests

`tests/acquisition.test.ts` — schema v66, SSRF, secrets, DRM, approval, Scenarios A/C/D, sessions, path escape, MCP cookie rejection. `tests/media-acquisition.test.ts` remains the 20.24 regression gate.

## Feature flag

`PAO_ACQUISITION_ENABLED=0` disables the HTTP surface. `PAO_ACQUISITION_MOCK=1` or `BUN_TEST` forces the mock worker. `PAO_OMNIGET_MCP_URL` selects a live MCP bridge; otherwise `127.0.0.1:18790` then `:8765` are probed.

## Known gaps (honest)

- Live OmniGet MCP/CLI submit is discovery-based and fails closed when the binary/bridge is missing. Tests do not call a live OmniGet.
- Knowledge ingest records an opt-in untrusted event; it does not replace the existing knowledge pipeline.
- Browser cookie material never leaves the secret broker. This phase issues/revokes opaque refs only.
