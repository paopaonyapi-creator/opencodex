# Pao Market Signal Control Plane

Phase 20.52 subsystem. Provider-agnostic market signal ingestion, AI decision
support, deterministic risk control, mandatory human approval, and paper
trading. **This subsystem does not provide autonomous live trading.**

Full architecture, configuration reference, API surface, and scope accounting:
[docs/phases/phase-20.52-market-signals.md](../phases/phase-20.52-market-signals.md).

## What it does

1. Receives signals from multiple providers (Kamden-style signed webhooks,
   TradingView webhooks, generic webhooks, manual entry).
2. Verifies signatures (constant-time HMAC over the raw body), rejects stale
   timestamps and oversized payloads, rate-limits per provider, and dedups
   deliveries persistently.
3. Normalizes every provider into one canonical `MarketSignal` with a
   deterministic data-quality grade (completeness/trust, never profitability).
4. Persists raw payloads (sensitive headers redacted), signals, status
   history, analyses, risk assessments, approvals, paper orders, and an
   append-oriented audit log in the shared Agent OS SQLite database.
5. Runs advisory AI analysis whose numeric claims are validated against
   trusted context (hallucination guard) and reviewed by a deterministic
   five-reviewer council.
6. Runs the deterministic risk engine (position sizing, per-trade risk, daily
   loss, open positions, symbol/sector/gross exposure, drawdown breaker,
   market hours, volatility-only-if-trusted).
7. Requires explicit human approval (permission-gated, expiring, idempotent)
   before any paper order is simulated by the paper broker.

## What it does NOT do

- Place live trades, contact a real broker, or store broker credentials.
- Let AI override risk checks or approve its own proposals.
- Fabricate sector, volatility, or price data it does not have.

## Security notes

- Webhook secrets live in environment variables only
  (`MARKET_KAMDEN_WEBHOOK_SECRET`, `MARKET_TRADINGVIEW_WEBHOOK_SECRET`,
  `MARKET_GENERIC_WEBHOOK_SECRET`).
- HMAC verification uses `crypto.timingSafeEqual` over the original raw
  request bytes; re-serialized JSON will not verify.
- Delivery dedup is persistent (`UNIQUE(provider_id, delivery_id)`), so
  replays are idempotent across restarts.
- Approval resolution requires an actor id in `MARKET_APPROVER_ACTORS`
  (empty by default) and is protected by optimistic version checks.

## Quick start

```bash
MARKET_MODULE_ENABLED=true MARKET_ADMIN_KEY=<key> \
MARKET_PROVIDER_GENERIC_ENABLED=true MARKET_GENERIC_WEBHOOK_SECRET=<secret> \
  bun -e 'const { startMarketServer } = await import("./src/agent-os/market/index.ts");
           const gw = await startMarketServer(".");
           console.log("market on 127.0.0.1:" + gw.config.port);'
```

Health: `GET /api/market/health` (open, no secrets). Everything else requires
the admin bearer key; approval actions additionally require
`MARKET_APPROVER_ACTORS` membership.

## Troubleshooting

| Symptom | Meaning / action |
|---|---|
| `MARKET_WEBHOOK_SIGNATURE_INVALID` | Signature or secret mismatch — check the provider secret env var and that the signature covers `${timestamp}.${rawBody}`. |
| `MARKET_WEBHOOK_TIMESTAMP_STALE` | Delivery outside the replay window (`MARKET_WEBHOOK_MAX_AGE_SECONDS`). |
| `MARKET_WEBHOOK_DUPLICATE` | Delivery already processed (idempotent — no action). |
| `MARKET_PROVIDER_DISABLED` | Provider is registered but disabled — enable via `POST /api/market/providers/:id/enable` as an operator. |
| `MARKET_RISK_HARD_FAIL` | Deterministic risk rejected the signal — inspect findings via `GET /api/market/signals/:id/risk`. |
| `MARKET_CIRCUIT_BREAKER_ACTIVE` | Automation is PAUSED/LOCKED — check `/api/market/circuit-breaker`; only operators can release LOCKED. |
| `MARKET_APPROVAL_FORBIDDEN` | Acting user is not in `MARKET_APPROVER_ACTORS`. |

## Testing

```bash
bun test tests/market-ingress-security.test.ts tests/market-providers.test.ts \
         tests/market-analysis.test.ts tests/market-risk-approval-execution.test.ts \
         tests/market-e2e.test.ts
```
