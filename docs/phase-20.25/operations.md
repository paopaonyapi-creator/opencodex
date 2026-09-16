# Phase 20.25 — Operations

## Feature flags (env)

| Flag | Default | Effect when off |
|---|---|---|
| `ENABLE_UNIVERSAL_REGISTRY` | on | Registry surface reports disabled |
| `ENABLE_AUTO_TOOL_ROUTER` | off | Reserved for automatic routing of ad-hoc goals |
| `ENABLE_TOOLCHAIN_PLANNER` | on | `POST /plan` returns an error |
| `ENABLE_AUTO_FALLBACK` | on | (reserved — fallback is planner-attached) |
| `ENABLE_REPLAY` | on | `POST /runs/replay` returns an error |

## Sync

`POST /api/agent-os/registry/sync` with optional `{ "sources": ["mcp",
"agents", "skills", "codex", "models", "browser", "catalog"] }`. Default:
all. Idempotent; operator-disabled tools stay disabled. Codex ingestion is
defensive — a broken optional table never blocks sync.

Suggested cadence: catalog + mcp on dashboard demand or daily; agents/skills
at startup.

## Health

`POST /api/agent-os/registry/health-check` re-derives health from execution
metrics and stores samples. Derived bands: <3 runs → unknown; error rate
≥ 0.5 → offline; ≥ 0.2 → degraded; else healthy.

## Approvals

`GET /approvals?status=pending` → `POST /approvals/resolve {id, decision:
approved|rejected}`. "Once" grants are consumed by one execution; "session"
grants expire after 8h; a server restart clears in-memory grants (the ledger
is durable). There is no permanent grant.

## Replay

`POST /runs/replay {runId, mode: exact|latest_tools|from_failed}`. Every
replay is a new run with cleared approvals — destructive steps re-request.

## URL allowlist

`REGISTRY_URL_ALLOWLIST` (comma/newline-separated hosts) overrides the SSRF
blocklist for trusted admin-configured targets only.

## Rollback

Disable `ENABLE_UNIVERSAL_REGISTRY` (or stop calling the routes). Existing
integrations never depended on the registry; the tables and audit history
are retained.
