# Phase 20.25 — Registry Schema

Canonical tool metadata (see `src/agent-os/universal-registry/types.ts`) and
its persistence (db v31, `registry_*` tables).

## Tool record

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable canonical id: `mcp:{server}:{tool}`, `agent_os:{agentId}`, `skill:{id}`, `codex:{id}`, `model:{id}`, `browser:{name}`, `catalog:{slug}` |
| `name` / `slug` / `provider` | string | slug is `slugify(name)`; dedup key is (provider, slug) |
| `type` | enum | agent, ai_model, mcp_server, external_api, scraper, browser_tool, local_tool, codex_tool, image_generator, video_generator, audio_generator, research_tool, reviewer, database, storage, exporter, notification, automation, connector |
| `status` | enum | active, disabled, metadata_only, deprecated |
| `capabilities` | string[] | Capability namespace entries (see capability-taxonomy.md) |
| `inputTypes` / `outputTypes` | string[] | Free-form type hints |
| `auth` | `{ type: none\|env\|config, ref? }` | Reference only — never a secret value |
| `authStatus` | enum | none, configured, missing, invalid (the only thing UI/API may show) |
| `runtime` | `{ execution, protocol, executor? }` | `executor` names the universal-runtime adapter when one exists |
| `risk` | `{ level 0–4, permissionClass, requiresApproval }` | Derived from capabilities unless overridden |
| `cost` | `{ model: free\|fixed\|usage_based\|unknown }` | Never invented |
| `quality` | `{ reliabilityScore?, latencyScore? }` | Optional manual overrides; otherwise derived from metrics |
| `source` | `{ kind, repository?, ownerModule? }` | Provenance: builtin, mcp, agent_os, codex, browser, skill, model, catalog |
| `executable` | boolean | True only when the universal runtime owns a safe executor |
| `health` | enum | healthy, degraded, offline, unknown, disabled |
| `metrics` | `{ runs, successes, failures, avgLatencyMs, lastRunAt?, lastError? }` | Updated per execution |

## Tables (db v31, additive `CREATE TABLE IF NOT EXISTS`)

- `registry_tools` — one row per tool; JSON columns for nested objects.
- `registry_tool_health` — per-check health samples `(tool_id, checked_at)`.
- `registry_runs` — plan JSON, mode (execute/dry_run), status, risk, cost.
- `registry_run_steps` — per-step state; ids scoped as `{runId}:{stepId}`.
- `registry_approvals` — pending/granted ledger; `scope` once|session;
  session grants expire (8h); no permanent grants.
- `registry_audit_events` — append-only execution audit.
- `registry_preferences` — per-user preference weights for ranking.

## Deduplication

Canonical id upserts are idempotent. Catalog entries additionally resolve by
(provider, slug) before insert so resyncs keep stable ids. Re-syncs never
resurrect an operator-disabled tool.
