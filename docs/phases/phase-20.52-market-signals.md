# Phase 20.52 — Pao-hubPro × Stock Market Signal Automation

> **Status:** Implemented (control-plane core). Honest scope accounting at the end.
> **Reference inspiration:** `cporter202/stock-market-signal-automation`
> **Safety posture:** Paper-trading-first. Human approval is mandatory before
> any execution. Live trading does not exist in this phase —
> `LIVE_EXECUTION_DISABLED` is a compile-time constant, not a flag.

## What was built

A provider-agnostic **Market Signal Control Plane** in `src/agent-os/market/`,
following the repository's agent-os subsystem conventions (bun:sqlite via the
shared Agent OS DB, additive `CREATE TABLE IF NOT EXISTS` DDL, standalone
loopback Bun server like the AI Gateway).

```text
External signal providers (Kamden-style signed webhooks, TradingView,
generic webhooks, manual entry)
        |
        v
POST /api/market/webhooks/:provider      <- provider-key auth (HMAC / body secret)
  ingress/security.ts: size limit -> timestamp/replay window ->
  constant-time HMAC -> persistent delivery dedup
        |
        v
providers/adapters.ts   (provider-specific parsing owns schema/mapping)
        |
        v
pipeline.ts             (raw persistence w/ redacted headers -> normalize ->
                         provider-event dedup -> VERIFIED signal + quality grade)
        |
        v
events.ts               typed bus, correlation IDs, persisted trail
        |
        v
analysis/orchestrator   deterministic restatement model (default), structured
  hallucination-guard   numeric-claim validation, fabrication-pattern detector
  reviewer council      5 deterministic reviewers; consensus NEVER overrides risk
        |
        v
risk/engine.ts          DETERMINISTIC: position sizing, per-trade risk, daily
                        loss, open positions, symbol/sector/gross exposure,
                        drawdown circuit breaker, market hours, volatility
        |
        v
approvals/service.ts    human approval REQUIRED (RBAC, expiry, idempotent,
                        optimistic version-checked resolution)
        |
        v
execution/broker.ts     PaperBrokerAdapter only; fills are simulated with
                        configurable slippage; live mode structurally absent
        |
        v
db-store.ts             market_* tables (SQLite, shared Agent OS DB)
server.ts               loopback Bun server: webhooks + admin API + health
```

## Hard invariants (spec §2)

- No code path can place a live order. `LIVE_EXECUTION_DISABLED` is checked
  structurally in `execution/broker.ts` (`assertPaperOnly`); a future live
  phase must delete code, not flip a flag.
- The AI layer is advisory only: it cannot supply price, equity, quantity,
  exposure, or broker state; its numeric claims are validated against the
  trusted context by the hallucination guard; its council votes are
  deterministic and cannot override a hard risk failure.
- Proposal creation requires `risk.passed === true` from the deterministic
  engine. Execution requires an approval resolved by an actor in
  `MARKET_APPROVER_ACTORS` (empty by default — fail closed).
- Secrets resolve from environment variables only (`MARKET_*_WEBHOOK_SECRET`,
  `MARKET_ADMIN_KEY`); they are never logged, persisted, or returned by any
  endpoint. Raw webhook headers are redacted (`[REDACTED]`) before storage.
- Missing market data (sector, volatility) is reported as
  `NOT_EVALUATED_MISSING_DATA` — never fabricated.

## Configuration (spec §61-62)

| Variable | Default | Purpose |
|---|---|---|
| `MARKET_MODULE_ENABLED` | `false` | master switch (strict `"true"`) |
| `MARKET_MODULE_PORT` | `8790` | loopback port |
| `MARKET_ADMIN_KEY` | — | admin bearer key for the management API |
| `MARKET_EXECUTION_MODE` | `paper` | `live` is refused unconditionally |
| `MARKET_WEBHOOK_MAX_AGE_SECONDS` | `300` | replay window |
| `MARKET_WEBHOOK_MAX_BODY_KB` | `256` | ingress size limit |
| `MARKET_WEBHOOK_RATE_LIMIT_PER_MINUTE` | `120` | provider-scoped limit |
| `MARKET_DEFAULT_RISK_PERCENT` | `0.5` | sizing risk per trade |
| `MARKET_MAX_RISK_PER_TRADE_PERCENT` | `1.0` | hard cap |
| `MARKET_MAX_DAILY_LOSS_PERCENT` | `3.0` | hard block |
| `MARKET_MAX_OPEN_POSITIONS` | `5` | hard block |
| `MARKET_MAX_SYMBOL_EXPOSURE_PERCENT` | `20` | hard block at cap |
| `MARKET_MAX_GROSS_EXPOSURE_PERCENT` | `100` | hard block at cap |
| `MARKET_MAX_DRAWDOWN_PERCENT` | `10` | pauses the global breaker |
| `MARKET_APPROVAL_EXPIRY_MINUTES` | `30` | approval TTL |
| `PAPER_BROKER_SLIPPAGE_BPS` | `0` | simulated slippage |
| `MARKET_PAPER_EQUITY` | `100000` | deterministic paper account equity |
| `MARKET_AI_ANALYSIS_ENABLED` | `true` | analysis stage flag |
| `MARKET_REVIEWER_COUNCIL_ENABLED` | `true` | council stage flag |
| `MARKET_PROVIDER_KAMDEN_ENABLED` | `false` | per-provider ingress gates |
| `MARKET_PROVIDER_TRADINGVIEW_ENABLED` | `false` | |
| `MARKET_PROVIDER_GENERIC_ENABLED` | `false` | |
| `MARKET_KAMDEN_WEBHOOK_SECRET` | — | env name resolved at verify time |
| `MARKET_TRADINGVIEW_WEBHOOK_SECRET` | — | compared against the body `secret` |
| `MARKET_GENERIC_WEBHOOK_SECRET` | — | token or HMAC per `MARKET_GENERIC_AUTH_TYPE` |
| `MARKET_APPROVER_ACTORS` | *(empty)* | comma-separated user ids that may resolve approvals |
| `MARKET_OPERATOR_ACTORS` | *(empty)* | user ids that may manage providers/breaker |

## API surface (spec §43, adapted)

Webhook ingress (provider-key auth, raw-body HMAC verification):
- `POST /api/market/webhooks/:provider`

Management API (Bearer `MARKET_ADMIN_KEY`):
- `POST /api/market/signals/manual`
- `GET /api/market/signals[?status&symbol&limit]`, `GET /api/market/signals/:id`
- `GET /api/market/signals/:id/audit|analysis|risk`
- `POST /api/market/signals/:id/analyze|risk-check|propose`
- `GET /api/market/approvals[/:id]`, `POST /api/market/approvals/:id/approve|reject`
- `GET /api/market/providers`, `POST /api/market/providers/:id/enable|disable`
- `GET /api/market/circuit-breaker`, `POST /api/market/circuit-breaker/pause|reset|lock`
- `GET /api/market/paper-orders`, `POST /api/market/paper-orders/:id/close`
- `GET /api/market/proposals[/:id]`, `POST /api/market/proposals/:id/execute`
- `GET /api/market/notifications`, `GET /api/market/events`
- `GET /api/market/health` (open), `GET /api/market/metrics`

Error model (spec §69-70): `{ error: { code, message, correlationId } }` with
stable codes such as `MARKET_WEBHOOK_SIGNATURE_INVALID`,
`MARKET_WEBHOOK_TIMESTAMP_STALE`, `MARKET_WEBHOOK_DUPLICATE`,
`MARKET_WEBHOOK_RATE_LIMITED`, `MARKET_RISK_HARD_FAIL`,
`MARKET_APPROVAL_FORBIDDEN`, `MARKET_APPROVAL_EXPIRED`,
`MARKET_APPROVAL_ALREADY_RESOLVED`, `MARKET_CIRCUIT_BREAKER_ACTIVE`,
`MARKET_LIVE_EXECUTION_DISABLED`.

## Persistence

Additive tables in the shared Agent OS SQLite database (`src/agent-os/db.ts`,
`OPENCODEX_HOME/agent-os.db`): `market_providers`,
`market_webhook_deliveries` (UNIQUE(provider_id, delivery_id) dedup),
`market_raw_events` (redacted headers, payload hash), `market_signals`,
`market_signal_status_history`, `market_ai_analyses`, `market_reviewer_votes`,
`market_risk_assessments`, `market_risk_findings`, `market_trade_proposals`,
`market_approval_requests` (optimistic versioning), `market_paper_orders`,
`market_trade_results`, `market_circuit_breaker_events`, `market_audit_logs`
(append-oriented), `market_notifications`, `market_daily_risk`. Every query
string is a compile-time constant; caller values bind to `?` placeholders.

## Tests

57 tests across five files, all passing:
- `tests/market-ingress-security.test.ts` — HMAC accept/reject, re-serialized
  body rejection, stale timestamps, constant-time comparison, header
  redaction, size limits, rate limiting, replay/duplicate idempotency,
  disabled-provider rejection, raw-event redaction.
- `tests/market-providers.test.ts` — Kamden/TradingView/generic/manual
  normalization, body-secret rejection, lifecycle transition guards.
- `tests/market-risk-approval-execution.test.ts` — position sizing guards,
  daily-loss hard fail, drawdown circuit breaker pause, max open positions,
  breaker lock semantics, approval RBAC/expiry/idempotency/optimistic
  resolution, paper fills with adverse slippage, live-mode structural refusal,
  full approve→execute→close audit chain.
- `tests/market-analysis.test.ts` — hallucination guard (unsupported numeric
  claims, percent context, enumeration tolerance, fabrication patterns),
  reviewer council determinism, degraded-model isolation.
- `tests/market-e2e.test.ts` — the spec §99 flow through the real HTTP server
  (signed webhook → … → paper execution → audit) plus the negative flows.

## Honest scope accounting

Implemented: everything in the architecture diagram above — ingress security,
four provider adapters, canonical schema, typed events, lifecycle machine,
signal quality grades, analysis orchestrator with hallucination guard and
deterministic reviewer council, full deterministic risk engine, global circuit
breaker, mandatory human approval runtime, paper broker, audit trail,
notifications store, health/metrics endpoints, configuration, tests, docs.

Deferred deliberately (follow-ups, not silent gaps):
- **Dashboard UI screens** (spec §22/§51-53): the admin API covers the
  operator loop; gui/ pages reusing the Command Center patterns are the next
  step. The raw-payload viewer must render as plain text (never HTML) when
  built.
- **Telegram/Discord notification sinks**: `MarketNotifier` accepts sinks;
  wiring them to the Phase 20.23 notification gateway destinations is a small
  follow-up. The dashboard channel (persisted notifications API) works today.
- **MCP tools and Agent/Skill Registry registrations** (§45-47): the service
  methods exist; registration into the runtime registries is follow-up work.
- **Scheduler jobs** (§71): approval expiry runs on an in-process timer;
  provider-health rollup, retention, and reconciliation jobs follow when a
  scheduler primitive is chosen.
- **Performance analytics** (§81-82): intentionally waiting for sufficient
  stored paper results; any future output must carry the
  `PAPER RESULTS / HISTORICAL OBSERVATION / NOT A GUARANTEE` labels.

## Operations

```bash
# start (loopback only)
MARKET_MODULE_ENABLED=true MARKET_ADMIN_KEY=<key> \
  bun -e 'const { startMarketServer } = await import("./src/agent-os/market/index.ts");
           const gw = await startMarketServer(".");
           console.log("market on 127.0.0.1:" + gw.config.port);'

# verify health (no secrets in the response)
curl -s http://127.0.0.1:8790/api/market/health
```

Emergency stop: `POST /api/market/circuit-breaker/lock` as an operator. Only
an operator (user actor in `MARKET_OPERATOR_ACTORS`) can release a LOCKED
breaker; automated actors cannot.
