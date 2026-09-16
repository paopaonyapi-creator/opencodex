# Phase 20.25 — Testing

`tests/universal-registry.test.ts` — 31 tests, isolated per-case via
`OPENCODEX_HOME` temp dirs and `closeAgentOsDbForTests()`.

## Coverage map (spec §87–§89)

| Spec requirement | Test |
|---|---|
| Ingestion idempotency / dedup | "sync is idempotent with stable canonical ids" |
| Disabled status survives resync | "operator-disabled tools keep their disabled status" |
| Catalog = data only | "catalog entries are metadata-only data, never executable" |
| Secret refs, no values | "auth records hold env references, never secret values" |
| Keyword search ranked | "keyword search ranks relevant tools" |
| Capability search | "capability search finds the exact namespace" |
| Filters | "filters narrow candidates" |
| Profiles normalize; cheap weights cost | "profiles adjust weights…" |
| Explainability | "ranking is explainable" |
| Preference learning | "user preference weight moves the ranking" |
| shell.execute → approval required | "shell.execute requires approval" |
| Approved key allows | "approved once allows a specific action" |
| Dangerous command denied | "dangerous commands are denied outright" |
| Path traversal denied | "path traversal outside the workspace is denied" |
| Risk ladder | "risk ladder maps capabilities to levels 0-4" |
| Disabled tool denied | "disabled tools are denied regardless of approval" |
| SSRF blocklist | "blocks loopback, private ranges, and cloud metadata" |
| Allowlist escape hatch | "accepts public https targets and admin allowlist…" |
| Plan persisted | "goal produces a persisted executable plan" |
| Dry run never executes | "dry run never executes" |
| Fallback on provider failure | "execution falls back when the primary candidate cannot run" |
| Audit written, no secrets | "every execution writes audit events, never secrets" |
| Destructive replay → fresh approval | "destructive steps stop for approval and replay requires a fresh one" |
| Service surface | status/stats/toggle/feedback round-trips |
| Audit sanitizer | "strips control chars and SQL-significant punctuation" |

## Design notes

- Execution tests use injected stub adapters (`test_echo`, `test_unavailable`)
  via `UniversalRegistryService(store, adapters)` DI — no network, fully
  deterministic, and it exercises the same engine path as production.
- The approval test walks the full lifecycle: plan → stop → human approve →
  complete → replay → stop again (fresh approval).

## Running

```bash
bun test tests/universal-registry.test.ts   # focused
bun run test:changed                        # import-connected suites
bun run typecheck                           # strict, required
```
