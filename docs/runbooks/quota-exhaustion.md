# Runbook — Quota exhaustion and stale telemetry

Applies to Phase 20.51's quota-aware routing.

## Symptoms

- `ROUTE_REJECTED_QUOTA_EXHAUSTED` rejections in `/api/gateway/decisions`.
- Routes parked in `cooldown` with `ROUTE_REJECTED_QUOTA_EXHAUSTED` /
  `ROUTE_REJECTED_QUOTA_EXHAUSTED` cooldown reason codes in
  `/api/gateway/circuits`.
- Quota readings on `/api/gateway/quotas` with `confidence: "unknown"` or
  freshness `stale`.

## Decision logic the operator should expect

- Exhausted quota **with a known `resetAt`**: the route cools down until
  slightly after the reset (30s rollover guard) and the recovery worker picks
  it up afterwards. No action needed.
- Exhausted quota **without a reset**: bounded cooldown, then cheap health
  probes; the route returns only after two validated probes.
- **Unknown or stale telemetry is never treated as headroom.** The route is
  scored with a penalty, not with a fabricated 100%.

## Checks

1. **Timestamps first.** Compare the window's `observedAt` on
   `/api/gateway/quotas` with the 9Router dashboard's own quota tracker.
2. **Window identity.** Confirm the `windowType`/`label` matches what the
   provider actually resets (daily vs weekly vs credit); a mismatched window
   means the telemetry mapping needs `quota_paths` adjustment in
   `config/ai-gateway/nine-router.yaml`.
3. **Connection state.** A route that is `cooldown` *and* shows quota
   remaining is a telemetry problem, not a capacity problem.

## Do NOT

- Do not overwrite unknown/stale readings with 100% remaining, in config or
  in the UI.
- Do not raise thresholds to force routes back in while telemetry says
  exhausted; the reserve/headroom policy exists to protect priority work.
- Do not rotate provider accounts to dodge an exhausted quota — cooldown until
  reset is the policy (anti-abuse rule, spec §12/§18).
