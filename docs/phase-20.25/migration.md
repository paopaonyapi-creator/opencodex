# Phase 20.25 — Migration & Compatibility

## Backward compatibility

- **Additive only.** Schema v31 adds seven `registry_*` tables via
  `CREATE TABLE IF NOT EXISTS`; no existing table or column changed. Older
  databases upgrade on first open; newer-than-build databases keep the
  existing hard error.
- **No existing integration is rewritten.** MCP tools, agents, skills, Codex,
  browser tools, and models are *indexed* by the registry; their execution
  stays where it lives today.
- **Routes are namespaced** under `/api/agent-os/registry/*` and declared in
  `MANAGEMENT_ROUTES` with a phase deferral for CLI verbs, so the route
  registry reconciliation test stays authoritative.
- **GUI is additive**: one new page id (`universal-registry`), one nav entry,
  one `nav.universalRegistry` key in all 11 locales.

## Existing tool configs

There is no breaking migration of tool configs: the registry is a projection
built from live sources. If existing config data should appear in the
registry, add an ingest source — do not import it by hand.

## Rollback

1. Disable `ENABLE_UNIVERSAL_REGISTRY` (and the planner/replay flags as
   needed).
2. Existing manual integrations continue unchanged.
3. `registry_*` tables and audit history are retained for future re-enable.

## Migration rules honored (spec §85)

Repository inspected before coding; existing modules reused (policy engine,
MCP provider, agents/skills registries, model router, db handle, route
patterns, GUI patterns); no duplicate auth/db/logger/MCP runtime/API
framework; no new dependencies (Bun stdlib only).
