# Runbook — Provider quarantine and recovery

Applies to Phase 20.51's connection state machine
(`unknown / healthy / degraded / cooldown / quarantined / recovering / disabled`).

## When a route quarantines

- `auth_invalid` or `permission_denied` failures quarantine immediately —
  reason codes `CONNECTION_QUARANTINED_AUTH_INVALID` /
  `CONNECTION_QUARANTINED_PERMISSION_DENIED`.
- Quarantined routes are **never probed** by the recovery worker. Return to
  service requires an operator action or an explicit recovery request.

## Operator flow

1. Confirm the cause in `/api/gateway/events` (filter by the route key).
2. Fix the underlying cause **in 9Router** (re-authenticate the provider
   connection in its private admin surface; Pao never stores provider
   credentials).
3. Validate with a controlled probe:
   `curl http://127.0.0.1:20128/v1/models` through the sidecar, or
   `POST /api/gateway/test-provider` for the gateway provider.
4. Return the route to service:
   ```bash
   curl -X POST http://127.0.0.1:8787/api/gateway/connections \
     -H "Authorization: Bearer $PAO_AI_GATEWAY_ADMIN_KEY" \
     -H "Content-Type: application/json" \
     -d '{"routeKey":"nine-router-gateway/<model-id>","action":"recover"}'
   ```
   The route enters `recovering`, not `healthy`: two validated probes close
   the recovery before it takes full traffic again.

## Manual actions

- `disable` — operator-mandated outage; nothing probes it.
- `quarantine` — emergency stop for a misbehaving route.
- `recover` / `enable` — request recovery (from disabled or quarantined).
All three are audited as gateway events (`CB_OPERATOR_ACTION`,
`CONNECTION_MANUALLY_DISABLED`).

## Anti-patterns

- Do not loop retries against an auth-quarantined route; that is how provider
  accounts get locked. Quarantine exists to break that loop.
- Do not force `healthy` state directly; the recovering ramp is the policy.
