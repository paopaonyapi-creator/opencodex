# Phase 20.95 Runbook

## Enable

- Default on (`PAO_ACQUISITION_ENABLED=1`).
- Optional: `PAO_OMNIGET_MCP_URL=http://127.0.0.1:<port>`.
- Optional: `PAO_ACQUISITION_ROOT` for output root.

## Health

```
GET /api/agent-os/acquisition/health
GET /api/agent-os/acquisition/adapters/health
GET /api/agent-os/acquisition/doctor
```

Healthy MCP requires a reachable OmniGet bridge. Unconfigured MCP + missing CLI → mock adapter in tests; in production the doctor tells the operator to install/configure OmniGet. That is not reported as a live OmniGet success.

## MCP token

Store as `secret://omniget/mcp-token` in the existing secret broker. Do not put the token in agent prompts or `.env` sprawl.

## Session refs

```
POST /api/agent-os/acquisition/session-refs   { provider, domains, secretRef }
POST /api/agent-os/acquisition/session-refs/{id}/revoke
```

`secretRef` must start with `secret://`. Raw cookies are rejected.

## Stalled jobs

Pause / resume / retry / cancel on `/api/agent-os/acquisition/jobs/{id}/...`. Approval resume replays the stored request/plan JSON.

## Cleanup

Temp files live under `runtime/acquisition/<jobId>/` (or `PAO_ACQUISITION_ROOT`). Delete per job after artifacts are hashed. Do not sweep unrelated `runtime/media` from 20.24.

## Upstream OmniGet upgrade

Re-run doctor + capability discovery. Do not assume a tool count. Newly discovered high-risk tools stay disabled until allowlisted.
