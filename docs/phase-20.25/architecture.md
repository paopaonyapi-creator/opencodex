# Phase 20.25 — Architecture

```text
                     Pao-hubPro dashboard / CLI (follow-up)
                          │
                  /api/agent-os/registry/*
                          │
        ┌─────────────────▼──────────────────┐
        │  UniversalRegistryService          │
        │  (flags · sync · search · plan ·   │
        │   execute · approvals · replay ·   │
        │   audit · stats · feedback)        │
        └───┬──────────┬──────────┬─────────┘
            │          │          │
     taxonomy.ts   planner.ts   engine.ts
     (capabilities) (decompose,  (permission → approval →
      templates,     rank,        circuit breaker → adapter →
      extraction)    fallbacks)   fallback → audit)
            │          │          │
            └────┬─────┴─────┬────┘
                 │           │
        registry-store.ts  adapters.ts (http_get · local_file_read · model_router)
                 │
        agent-os.sqlite3 (db v31: registry_* tables)
                 │
     Sources ingested: MCP tools (Phase 20.22 provider) · Agent OS agents ·
     skills · Codex runtime capabilities · gen models + model router ·
     browser tools · external catalog metadata (DATA ONLY)
```

## Data flow of one run

1. `POST /plan {goal}` → `decomposeGoal` → capability sequence → per-capability
   ranking (`ranking.ts`) → `PlanStep[]` with selected tool + fallbacks + risk +
   approval points → persisted (`registry_runs`, `registry_run_steps`).
2. `POST /runs {runId}` → sequential execution:
   - `evaluatePermission` (pure, fail-closed),
   - risk ≥ 3 → approval row → run parks in `waiting_approval`,
   - else adapter dispatch with circuit breaker; retryable errors walk the
     fallback chain (`fallback_used` step status),
   - every transition appends to `registry_audit_events` and updates tool
     metrics (which drive health).
3. `POST /runs/replay` → fresh run, cleared grants; destructive steps re-approve.

## Health

`registry_tool_health` samples + metrics-derived health (runs < 3 → unknown;
error rate ≥ 0.5 → offline; ≥ 0.2 → degraded; else healthy). Health feeds the
ranking multiplier. Proactive network probes are a follow-up.

## Extensibility seams

- New source: add an ingest function + `sources` entry in `syncRegistry`.
- New capability: taxonomy + permission mapping (both fail-closed defaults).
- New executor: implement `ToolAdapter`, register via DI — planner untouched.
- Vector search backend: replace `searchTools` internals; callers unchanged.
