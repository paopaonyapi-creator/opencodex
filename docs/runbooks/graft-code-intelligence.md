# Runbook — Graft code intelligence (Phase 20.62)

Operational procedures for the code-intelligence control plane
(`/api/agent-os/code-intelligence/*`, dashboard page "Code Intelligence").

## Provider missing

**Symptom:** `provider/status` reports `unavailable`
("graft executable not found").

1. Confirm the binary: `graft version` on the host running Pao-hubPro.
2. Install the pinned version: `npm install -g @nanonets/graft@0.18.0`
   (or point `PAO_GRAFT_BIN` at a controlled location).
3. `bun run typecheck && bun test tests/code-intelligence.test.ts`.
4. `GET provider/status` → expect `ready` with the pinned version.

While unavailable: low-risk reads fall back with `reducedConfidence: true`;
HIGH/CRITICAL impact gates block. Do not treat fallback output as
dependency-complete.

## Version incompatible

**Symptom:** `provider/status` reports `incompatible`
(`CODEINTEL_VERSION_MISMATCH`).

1. Read the upstream changelog for the installed version.
2. Either downgrade to the pinned version or follow the upgrade procedure in
   `docs/integrations/graft.md` (fixture tests + security tests + operator
   approval), then update `PAO_GRAFT_PINNED_VERSION`.

## Graph stale

**Symptom:** repository `graphState: stale`; freshness checks report drift.

1. Trigger `POST repositories/:id/build` (operator action).
2. Confirm `ready` + new fingerprint; stale evidence remains audited but
   HIGH/CRITICAL decisions made on it are refused by policy.

## Graph build failed

**Symptom:** `codeintel.graph.build.failed` audit; repository `failed`.

1. Read `error_summary` on the latest `ci_graph_builds` row.
2. Common causes: unsupported file types (narrow with `--extensions`),
   tree-sitter native module failure (check Node >=20), disk space.
3. Rebuild after fixing; the lifecycle allows `failed → building`.

## Multi-repo child missing

**Symptom:** queries against a workspace member fail with
`CODEINTEL_REPOSITORY_UNREGISTERED` ("path is missing on disk").

1. Verify the child repository still exists at its registered path.
2. Re-register with the operator route if it moved; workspace membership is
   per repository id.

## High query latency

1. Check `max_query_seconds` budget; timeouts surface as
   `CODEINTEL_PROVIDER_UNAVAILABLE` (504).
2. Narrow queries with `pathScope` (allowed prefixes) to cut traversal size.
3. Consider `--extensions` on the next build to shrink the graph.

## Deep enrichment provider failed

Deep enrichment is optional and off by default. If `--deep` builds fail:
verify Graft's own model configuration (`GRAFT_PROVIDER`, `GRAFT_API_KEY`,
`GRAFT_MODEL`, `GRAFT_BASE_URL`); Pao-hubPro does not manage those secrets.
Structural intelligence is unaffected.

## Cache corruption

The `graft/` directory is a regenerable cache. Delete it and rebuild:
`rm -rf <repo>/graft && POST repositories/:id/build`. Canonical records
(registry, evidence, impact reports, audit) live in Pao SQLite and are never
touched by cache cleanup.

## Rollback

1. `PAO_GRAFT_ENABLED=false` → module inert (lazy-activated only).
2. Optionally `PAO_CODEINTEL_PROVIDER` remains `graft` but nothing runs.
3. Canonical audit/impact history is retained in SQLite.
4. Remove `graft/` caches if desired; leave Phase 20.61 execution untouched.
5. If machine-level files were changed by a manual `graft init` (out of
   scope for Pao), restore them from the upstream `graft uninstall` flow.

## Upgrade

See `docs/integrations/graft.md` §Upgrade procedure — never auto-upgrade in
production; fixture + security tests gate every version bump.
