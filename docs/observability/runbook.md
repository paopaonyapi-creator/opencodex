# Observability Runbook (Phase 20.40)

## Enable / disable

```bash
OBSERVABILITY_ENABLED=false   # no scanning, routes answer {enabled:false}
OBSERVABILITY_ENABLED=true    # default
```

## Adapter toggles

```bash
OBSERVABILITY_CLAUDE_JSONL_ENABLED=false   # disable the Claude JSONL scanner
OBSERVABILITY_CLAUDE_ROOT=/custom/path     # change the discovery root (default ~/.claude/projects)
OBSERVABILITY_CODEX_ADAPTER_ENABLED=false  # disable the 20.21 Codex table adapter
OBSERVABILITY_PAO_NATIVE_ENABLED=false     # disable the 20.39 cockpit bus adapter
OBSERVABILITY_GENERIC_JSONL_SOURCES='[{"id":"stock-factory","root":"/srv/pao/logs"}]'  # add generic JSONL sources
```

Generic roots are validated: `/` and the home directory are refused;
configure a specific directory.

## Diagnosing an empty dashboard

1. `GET /api/agent-os/observability/adapters` — is your adapter enabled?
2. `GET /api/agent-os/observability/stats` — `sourcesTotal`, `cacheMissesTotal`, `scanErrorsTotal`.
3. Check `OBSERVABILITY_CLAUDE_ROOT` resolves on THIS machine (`~` expands to the server's home).
4. Session rows appear on the next snapshot after a file gains its first complete newline-terminated record.
5. Adapter errors surface in `snapshot.scan.adapterErrors` and `/alerts` (`adapter-unhealthy`).

## Interpreting the states (never conflate them)

- **Activity** — how recently EVIDENCE was recorded. `stale` ≠ stopped, ≠ completed.
- **Process** — OS/registry evidence. `not_observed` explicitly does NOT mean stopped; a failed scan is `unknown`.
- **Execution** — direct event evidence. `unknown` is the honest answer when no decoder evidence exists.
- **Health** — independent of activity. `stalled` requires: process running + active execution + no progress ≥ `OBSERVABILITY_STALLED_MS` + no waiting-for-user signal.
- **Integrity** — SHA-256 vs the previous verified revision. "changed" ≠ tampered.

Hover any badge in the dashboard for its precise wording and evidence.

## Handling adapter errors

Errors are per-session structured records (`SOURCE_NOT_FOUND`,
`SOURCE_UNREADABLE`, `MALFORMED_RECORD`, `TAIL_LIMIT_REACHED`, …) shown
in the session inspector. The rest of the fleet stays observable.
Repeated parse errors raise `repeated-parse-errors` alerts (cooldown 10m).

## Verifying integrity

```bash
curl -X POST :port/api/agent-os/observability/integrity-check \
  -H "authorization: Bearer $TOKEN" -d '{"sessionId":"obs_…","force":true}'
```

Only the session's REGISTERED source can be checked. Regular polling never
hashes; hashes cache by source revision; `force` bypasses the cache.

## Remote access safety

The plane has no listener of its own. If you expose the management API
beyond loopback you inherit that surface's obligations: admin token,
exact CORS origins, HTTPS at the proxy. Do not widen CORS for
observability.

## Database cleanup

Retention runs with each scan in batches: events 7d, scan cycles 7d,
process evidence 24h, resolved alerts 30d, integrity records 30d
(configurable via `OBSERVABILITY_*_DAYS` / `_HOURS`). It deletes ONLY
`observability_*` rows — never transcript files. Alias rows are kept.

## MCP inspection

Read-only tools (snake_case forms of the spec names): `agent_list`,
`agent_health`, `agent_activity`, `agent_timeline`, `agent_session`,
`agent_process`, `agent_stalled`, `agent_errors`, `agent_tool_calls`,
`agent_artifacts`, `observability_snapshot`, `observability_events`,
`observability_stats`, `observability_verify_session`. No control tools
exist by design.
