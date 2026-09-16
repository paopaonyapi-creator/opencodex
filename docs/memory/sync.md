# Memory Sync (Phase 20.43)

Sync copies memories between the local engine and a remote PLUR store. It
carries the highest data-exfiltration risk in the memory plane, so it is
**disabled by default** and wrapped in a fail-closed gateway.

## Profiles

`memory_sync_profiles`: name, enabled, remote type (`personal` |
`shared`), remote_ref (secret reference — never a plaintext credential),
allowed/denied scope patterns, require_secret_scan (default ON),
require_approval (default ON), last sync metadata.

## Pipeline

```text
sync request → profile lookup → RBAC → scope allow/deny filter
 → secret scan → private visibility check → remote safety validation
 → dry-run preview → approval if required → engine sync → audit + summary
```

## Rules

- Disabled by default (`PAO_MEMORY_SYNC_ENABLED=false`); a config
  validation error fails closed for sync and sensitive writes.
- `local` scope never syncs.
- Personal sync requires a private-remote expectation; a public GitHub
  repository is never selected automatically. If remote privacy cannot be
  verified, execution fails closed (`MEMORY_SYNC_UNSAFE_REMOTE`).
- Shared sync includes only deliberately shareable scopes/visibility.
- Dry-run preview is mandatory before first execution and reports
  included/blocked items with reasons (scope, private visibility, secret
  findings).
- Remote credentials are never logged and never stored as plaintext.

## Execution

`POST /api/agent-memory/sync/execute` is dashboard-gated. Without PLUR
installed, execute returns `engine_unavailable` honestly (the fallback
engine cannot sync). With PLUR, execution follows the previewed plan and
records a `memory_sync_runs` row with pushed/skipped/blocked counts.
