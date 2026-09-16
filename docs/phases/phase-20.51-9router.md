# Phase 20.51 — Pao-hubPro × 9Router Multi-Provider AI Gateway, Quota-Aware
# Smart Routing & Autonomous Fallback Control Plane

> **Status:** Implemented (control-plane core). Honest scope accounting at the end.
> **Upstream:** https://github.com/decolua/9router
> **Prepared:** 2026-09-15
> **Primary principle:** Pao-hubPro owns policy, governance, audit, budget, and
> orchestration. 9Router owns provider connectivity, protocol translation,
> account execution, and upstream quota telemetry.

## 1. What was built

Phase 20.51 extends the existing Pao AI Gateway subsystem (`src/ai-gateway/`,
Phases 20.13–20.17) with a governed execution layer. 9Router is integrated as
a provider adapter type (`nine-router`), not a fork: its source is not
vendored, its internal schema is not touched, and Pao-hubPro holds only a
gateway credential.

Architecture in this repository (adapted from the phase spec — this repo has
no separate `apps/api`/`packages` monorepo; the gateway is the composition
root):

```text
Codex / agents / GUI
        |
        v
src/ai-gateway/server.ts  (Bun, 127.0.0.1:8787, PAO_AI_GATEWAY_ENABLED)
  governed execution path (PAO_AI_GATEWAY_GOVERNANCE=true)
    ├─ routing/quota-router.ts      hard filters -> weighted score -> reason codes
    ├─ routing/fallback-controller  bounded fallback (attempts, provider cap, deadline)
    ├─ routing/leases.ts            session affinity
    ├─ resilience/connection-state  unknown/healthy/degraded/cooldown/quarantined/recovering/disabled
    ├─ resilience/classifier.ts     GatewayFailureClass + retry/fallback/quarantine table
    ├─ resilience/recovery.ts       jittered probe worker (cooldown + recovering)
    ├─ quota/model.ts + quota/store normalized QuotaWindow (confidence, freshness)
    └─ traces/decision-ledger.ts    decisions + attempts + events (JSONL, data/ai-gateway/)
        |
        v
  providers/nine-router.ts (NineRouterProvider, OpenAI-compatible /v1 + telemetry probes)
        |
        v
9Router sidecar (deploy/9router/, loopback:20128)  ->  upstream providers
```

### Why this shape

- The ungoverned path is byte-for-byte unchanged. `PAO_AI_GATEWAY_GOVERNANCE`
  is a strict `"true"` flag (same rule as `PAO_LLM_DIRECT_BYPASS`); a stray
  value cannot enable autonomous fallback.
- The existing Phase 20.17 `CircuitBreaker` is reused (a governed runtime gets
  its own instance configured from `governance.yaml`, so policy is config, not
  code). The Phase 20.51 connection state machine layers on top of it.
- Budget admission (`auth/budget.ts`) remains the single spend truth — no
  parallel ledger, satisfying the Phase 20.50 reuse rule of the spec with what
  this repository actually has.

## 2. Governing rules (spec §0/§4/§12 compliance)

- **Unknown quota ≠ unlimited.** Missing, unreadable, or 404-ing telemetry
  becomes `confidence: "unknown"`, scores zero headroom, and takes the
  `unknown_penalty`. A bare `percent` field is interpreted as percent *used*.
- **Hard filters before scoring.** Disabled, policy (local-only), capability,
  quarantined, cooldown, open-circuit, evidence-based quota exhaustion, and
  routing-tier budget rejections happen before any scoring, each with a stable
  reason code.
- **Fallback is bounded and classified.** `max_route_attempts` (4),
  `max_same_provider_attempts` (2), `total_deadline_ms` (180000), bounded
  backoff `[500, 1500, 4000]`. Auth/permission/content failures never retry
  and never provider-hop. Budget failures may only fall back to routes at most
  as expensive as the one that failed.
- **Every autonomous action is explainable.** Selections, rejections,
  cooldowns, quarantines, and recovery probes carry stable reason codes
  (`ROUTE_SELECTED_*`, `ROUTE_REJECTED_*`, `FALLBACK_*`, `CB_*`,
  `RECOVERY_PROBE_*`, `CONNECTION_*`) and land in the decision/event ledgers.
- **No anti-abuse evasion.** 429/quota exhaustion cools the route down (until
  a known `resetAt` when available, plus a 30s rollover guard); there is no
  account rotation anywhere in the implementation.
- **Fail-closed secrets.** Provider credentials stay inside 9Router; the
  gateway key resolves from an env var only; ledgers store route keys, reason
  codes, and counts — never prompts, tokens, or account identifiers.

## 3. Reason codes

Selection: `ROUTE_SELECTED_BEST_SCORE`, `ROUTE_SELECTED_SESSION_AFFINITY`,
`ROUTE_SELECTED_QUOTA_HEADROOM`, `ROUTE_SELECTED_LOW_COST`.
Rejection: `ROUTE_REJECTED_DISABLED`, `ROUTE_REJECTED_POLICY`,
`ROUTE_REJECTED_CAPABILITY`, `ROUTE_REJECTED_QUARANTINED`,
`ROUTE_REJECTED_COOLDOWN`, `ROUTE_REJECTED_CIRCUIT_OPEN`,
`ROUTE_REJECTED_QUOTA_EXHAUSTED`, `ROUTE_REJECTED_BUDGET`.
Fallback: `FALLBACK_RATE_LIMIT`, `FALLBACK_QUOTA_EXHAUSTED`,
`FALLBACK_TIMEOUT`, `FALLBACK_UPSTREAM_ERROR`, `FALLBACK_PROTOCOL_ERROR`,
`FALLBACK_MODEL_UNAVAILABLE`, `FALLBACK_UNKNOWN_ERROR`,
`FALLBACK_SAME_PROVIDER_CAP`. Governance: `CB_RATE_LIMIT`, `CB_UPSTREAM_5XX`,
`CB_OPERATOR_ACTION`, `CONNECTION_QUARANTINED_*`, `CONNECTION_MANUALLY_DISABLED`,
`ROUTE_LEASE_MIGRATED`, `RECOVERY_PROBE_SUCCESS`, `RECOVERY_PROBE_FAILED`.

## 4. API surface (admin-authenticated, `/api/gateway/*`)

| Endpoint | Purpose |
|---|---|
| `GET /quotas` | normalized quota windows + freshness + 9Router version |
| `GET /circuits` | connection states, breaker records, active leases |
| `GET /decisions?date&limit` | route decision traces |
| `GET /attempts?date&limit` | per-attempt records |
| `GET /events?date&limit` | gateway event timeline |
| `POST /simulate` | dry-run plan for an alias — no inference, no state writes |
| `POST /connections` | operator actions: `disable` / `quarantine` / `recover` / `enable` |

Existing endpoints (providers, models, aliases, usage, budgets, health,
traces, test-route, test-provider, council) are unchanged.

Requests may carry `X-Pao-Session-Id` to opt into a sticky route lease
(default TTL 60 min, max 120); a failure on the leased route emits
`ROUTE_LEASE_MIGRATED` and re-binds on the next success.

## 5. Configuration

- `config/ai-gateway/governance.yaml` (optional; defaults in
  `config.ts`): weights + profile (`coding-premium`, `background-cheap`,
  `balanced`), fallback limits, breaker thresholds, quota freshness/penalty
  policy, lease TTL.
- `config/ai-gateway/nine-router.yaml`: sidecar base URL, key env name,
  timeout, sync interval, telemetry paths.
- `config/ai-gateway/providers.yaml`: `nine-router-gateway` entry (disabled by
  default).
- Env: `PAO_AI_GATEWAY_GOVERNANCE=false`, `PAO_AI_GATEWAY_NINE_ROUTER_BASE_URL`,
  `PAO_AI_GATEWAY_NINE_ROUTER_API_KEY` (see `.env.example`).

Telemetry note: 9Router's management surface changes between releases, so the
adapter probes the configured paths and degrades to unknown-confidence
readings; operators can repoint `quota_paths` without code changes.

## 6. Tests

`tests/ai-gateway-nine-router.test.ts` (normalization, freshness, store,
adapter probing incl. 404-is-normal and legacy error mapping),
`tests/ai-gateway-resilience.test.ts` (classifier table, state machine
transitions, probe/recovery worker),
`tests/ai-gateway-quota-routing.test.ts` (hard-filter reason codes, weight
profiles, deterministic tie-break, affinity, bounded fallback incl.
cheaper-only and deadline, leases, ledger roundtrip),
`tests/ai-gateway-governance.test.ts` (real server against mock upstreams:
429 → bounded fallback → cooldown → simulate reflects state → operator
disable/recover → wrong admin credential rejected). 63 tests, all passing,
plus the pre-existing 156 gateway tests.

## 7. Honest scope accounting

Implemented: gateway adapter + telemetry normalization, quota model/store,
failure classifier, connection state machine, quota-aware routing with reason
codes, bounded fallback controller, session leases, recovery worker, decision
and event ledgers, admin/simulate/operator API, deploy artifacts, env/config
wiring, tests, runbooks.

Deferred deliberately (each is a follow-up, not a silent gap):

- **Dashboard UI page.** The admin API + simulate endpoint cover the operator
  loop; a gui/ page reusing Phase 20.16's Command Center patterns is the
  natural next step.
- **Streaming fallback.** The gateway's inference surface is non-streaming
  today (`stream: false` upstream); the spec's "no transparent restart after
  meaningful output" rule becomes binding only when streaming lands, and the
  fallback controller is the place to enforce it.
- **Per-connection account pools.** 9Router owns account pools internally;
  Pao governs the gateway route as one connection. Multi-connection governance
  needs an upstream telemetry surface that identifies accounts, which current
  releases do not expose stably.
- **Prometheus metrics.** Reason-code surfaces are JSONL today; mapping them
  onto the `pao_ai_gateway_*` metric names of the spec is mechanical once this
  repo picks a metrics exporter.

## 8. Bug found and fixed in existing code

While testing multi-route fallback, a pre-existing defect surfaced in the
gateway's simple YAML parser (`config.ts`): consecutive `- key: value` items
extended the previous item instead of pushing a new one, so **every
multi-route alias silently collapsed to its last route with priority 0**
(e.g. `pao-code` resolved to `local-fast` instead of `openai-code-primary`).
Single-route aliases (as used by all existing tests) masked it. The parser now
pushes a new item per `- ` line and attaches continuation keys to the last
item; the shipped `aliases.yaml` now resolves its full ladders as documented.
The governed fallback design depends on real ladders, so the fix is part of
this phase.

## 9. Operations

Deployment, pinning, and rollback: `deploy/9router/README.md`.
Runbooks: `docs/runbooks/ai-gateway-outage.md`,
`docs/runbooks/quota-exhaustion.md`, `docs/runbooks/provider-quarantine.md`.

Quick start (the gateway starts programmatically; there is no dedicated
runner script):

```bash
# from the repository root
PAO_AI_GATEWAY_ENABLED=true PAO_AI_GATEWAY_GOVERNANCE=true \
  bun -e 'const { startGatewayServer } = await import("./src/ai-gateway/index.ts");
           const gw = await startGatewayServer(".");
           console.log("ai-gateway on 127.0.0.1:" + gw.config.port);'

# verify
curl -s http://127.0.0.1:8787/api/gateway/circuits -H "Authorization: Bearer $PAO_AI_GATEWAY_ADMIN_KEY"
curl -s -X POST http://127.0.0.1:8787/api/gateway/simulate \
  -H "Authorization: Bearer $PAO_AI_GATEWAY_ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"alias":"pao-code"}'
```
