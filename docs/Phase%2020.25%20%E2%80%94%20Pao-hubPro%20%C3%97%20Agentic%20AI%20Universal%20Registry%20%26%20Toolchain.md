# Phase 20.25 — Pao-hubPro × Agentic AI Universal Registry & Toolchain

> **Status:** Implemented (A–E core + G dashboard MVP)  
> **Project:** Pao-hubPro  
> **Phase:** 20.25  
> **Codename:** Universal Agent Capability Registry  
> **Spec:** Phase 20.25 document (Universal Registry & Toolchain)  
> **Reference repositories (catalog data sources, DATA ONLY):**
> - https://github.com/cporter202/agentic-ai-apis
> - https://github.com/cporter202/agentic-ai-starters
> - https://github.com/cporter202/API-mega-list
> - https://github.com/cporter202/scraping-apis-for-devs
> - https://github.com/cporter202/ai-agent-tools

---

## 1. Executive Summary

Phase 20.25 adds the unifying layer between every Pao-hubPro tool system: a
**Universal Agent Capability Registry** that ingests, normalizes, searches,
ranks, plans, approves, executes, audits, and replays tools from multiple
sources — MCP tools, Agent OS agents, skills, the Codex runtime, generation
models, browser tools, and external catalog metadata.

The registry indexes; it does not replace. Existing execution systems (the
orchestration runtime, browser runtime, media engines) keep owning their own
execution. Where this phase's universal runtime does not own a safe executor,
tools are marked non-executable and honestly report `TOOL_UNAVAILABLE` instead
of pretending.

## 2. What Shipped (sub-phase accounting)

| Sub-phase | Scope | Status |
|---|---|---|
| 20.25-A Registry Core | Schema (db v31), store, ingestion from 7 sources, dedup, capability mapping | Shipped |
| 20.25-B Search + Ranking | Keyword/capability/NL search, filters, weighted ranking, 6 profiles, explainability, preferences | Shipped |
| 20.25-C Planner | Rule-based goal decomposition, toolchain templates, fallback chains, dry-run | Shipped (deterministic; LLM-assisted decomposition deferred) |
| 20.25-D Permission Engine | 10 permission classes, risk ladder 0–4, human approvals (once/session, never forever), deny rules | Shipped |
| 20.25-E Execution Runtime | Safe adapters (http GET + SSRF guard, workspace-contained file read, model router), fallback engine, circuit breaker | Shipped (safe subset; no shell/code executor by design) |
| 20.25-F Audit + Replay | Audit events per execution, run/step persistence, replay with fresh approvals | Shipped (exact + latest_tools + from_failed modes) |
| 20.25-G Dashboard | Universal Registry page: registry/search, planner, runs, approvals, health | Shipped (MVP) |
| 20.25-H Learning Layer | Feedback → preference weights → ranking | Minimal (no adaptive security policy) |

## 3. Architecture

```text
User Goal
   ↓ decomposeGoal (taxonomy templates + capability extraction)
Toolchain Planner ── ranks candidates via ranking.ts
   ↓
Permission Engine (risk.ts — outside the LLM, fail-closed)
   ├─ denied → POLICY_BLOCK (audited)
   ├─ approval_required → registry_approvals (human decision)
   └─ allowed → Step Executor (engine.ts)
                  ├─ circuit breaker per provider
                  ├─ adapter dispatch (adapters.ts)
                  ├─ fallback chain on retryable errors (TIMEOUT/RATE_LIMIT/
                  │   PROVIDER_ERROR/TOOL_UNAVAILABLE)
                  └──→ Audit (registry_audit_events) + metrics → health
```

Module layout (new code only; no duplicated subsystems):

```text
src/agent-os/universal-registry/
  types.ts          canonical tool schema, run/step/permission types
  taxonomy.ts       capability namespace, aliases, toolchain templates
  risk.ts           permission classes, risk ladder, evaluatePermission()
  registry-store.ts SQLite persistence (registry_* tables, db v31)
  ingest.ts         source adapters: mcp, agents, skills, codex, models, browser, catalog
  search.ts         lexical + capability search with filters
  ranking.ts        profile weights, explainable scoring
  planner.ts        goal → plan (tools + fallbacks + approval points)
  adapters.ts       http_get (SSRF-guarded), local_file_read, model_router
  engine.ts         step executor: permission → approval → adapter → fallback
  flags.ts          ENABLE_UNIVERSAL_REGISTRY, ENABLE_TOOLCHAIN_PLANNER, …
  service.ts        singleton facade
```

## 4. Database (schema v31, additive)

`registry_tools`, `registry_tool_health`, `registry_runs`,
`registry_run_steps`, `registry_approvals`, `registry_audit_events`,
`registry_preferences`. See `docs/phase-20.25/registry-schema.md`.

## 5. REST API (management surface, `/api/agent-os/registry/*`)

```text
GET    /api/agent-os/registry/status
GET    /api/agent-os/registry/tools
GET    /api/agent-os/registry/tool?id=
POST   /api/agent-os/registry/search
POST   /api/agent-os/registry/sync
POST   /api/agent-os/registry/health-check
POST   /api/agent-os/registry/plan
POST   /api/agent-os/registry/runs
GET    /api/agent-os/registry/runs
GET    /api/agent-os/registry/run?id=
POST   /api/agent-os/registry/runs/replay
GET    /api/agent-os/registry/approvals
POST   /api/agent-os/registry/approvals/resolve
GET    /api/agent-os/registry/audit
GET    /api/agent-os/registry/stats
POST   /api/agent-os/registry/tools/toggle
POST   /api/agent-os/registry/feedback
```

CLI verbs are deferred to the dashboard/CLI follow-up (route-registry deferral
owner: this document).

## 6. Security Controls

- **Policy outside the LLM.** `evaluatePermission()` is a pure function; the
  planner can only request. Risk ≥ 3 always requires human approval. There is
  no "approve forever" — "session" grants expire after 8h, "once" grants are
  consumed by one execution.
- **Replay resets approvals.** Every replay creates a fresh run with no
  inherited grants; destructive steps re-request approval (doc §36, §88).
- **SSRF guard** on every runtime fetch: loopback, private ranges, link-local,
  cloud metadata, non-HTTP schemes blocked; admin allowlist via
  `REGISTRY_URL_ALLOWLIST`.
- **Workspace containment** for filesystem adapters (reuses the Phase 20.22
  `ToolPolicyEngine` containment + dangerous-command checks).
- **Secrets referenced, never stored:** auth records hold env/config
  *references*; API/UI/log expose only `configured|missing|invalid|none`.
  Audit summaries are truncated and stripped of control characters.
- **External catalog = DATA.** Catalog ingestion is metadata-only, never
  executable, and never runs code from external repositories.
- **Deny-by-default tool status:** disabled tools are denied outright.
- **No shell/code executor** in the universal runtime — those capabilities
  remain owned by the sandbox/orchestration runtimes with their own approval
  flows; the registry still plans and gates them.

## 7. Feature Flags

`ENABLE_UNIVERSAL_REGISTRY` (on), `ENABLE_AUTO_TOOL_ROUTER` (off),
`ENABLE_TOOLCHAIN_PLANNER` (on), `ENABLE_AUTO_FALLBACK` (on),
`ENABLE_REPLAY` (on). Rollback = disable the flag; existing integrations are
untouched.

## 8. Tests

`tests/universal-registry.test.ts` (31 tests): ingestion idempotency,
dedup by canonical id, disabled-status preservation across resync,
metadata-only catalog, secret-reference safety, keyword/capability search,
profile weight normalization, ranking explainability, preference effects,
permission ladder (`shell.execute` → approval required; dangerous command →
denied; path traversal → denied), SSRF blocklist, dry-run non-execution,
fallback on provider failure, audit-no-secrets, destructive replay requiring
fresh approval, service surface round-trips, audit sanitizer.

## 9. Validation Commands

```bash
bun run typecheck
bun test tests/universal-registry.test.ts
bun run lint:gui
bun run build:gui
bun run privacy:scan
```

## 10. Remaining Limitations (honest accounting)

1. **Search is lexical**, not embedding-based; Thai-language NL search quality
   is limited. The search interface is vector-backend-ready.
2. **Planner is rule-based** (template + alias matching), not LLM-assisted;
   goals outside the templates fall back to extracted capabilities or a
   minimal research loop.
3. **Executor coverage is a safe subset** (HTTP GET, workspace file read,
   model routing). Everything else reports `TOOL_UNAVAILABLE` after passing
   policy — honest failure rather than fake success.
4. **Health checks derive from execution metrics**; no proactive network
   probes yet (configurable intervals are a follow-up).
5. **Cost is `unknown` unless a tool declares a known cost model** — the
   system never invents pricing (doc §38).
6. **Approve-for-session grants live in process memory**; a server restart
   clears them (the approval ledger itself is durable).
7. **Capability graph relationships** (`can_be_served_by` / `consumed_by`
   edges as a first-class graph) are approximated today by shared capability
   families; a dedicated graph store is P3 follow-up.

## 11. Recommended Follow-ups (Phase 20.25+)

- CLI verbs: `pao registry sync/list/search/show/health`, `pao plan`, `pao run`.
- Embedding-backed semantic search behind the existing search interface.
- LLM-assisted planner decomposition with the same structured plan output.
- MCP discovery adapters for remote servers (config-driven).
- Health probes with configurable intervals and rate limits.
- Reuse the existing `registry_preferences` learning signal in the model router.
