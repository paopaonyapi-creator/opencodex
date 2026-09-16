# Runbook — AI Gateway outage (9Router sidecar unreachable)

Applies to Phase 20.51's governed AI Gateway. Read top to bottom; do not skip
to credential resets.

## Symptoms

- `/api/gateway/quotas` shows `nineRouter: null` or `TELEMETRY_STALE` events
  in `/api/gateway/events`.
- Requests fail with `provider_unavailable` / `FALLBACK_UPSTREAM_ERROR`
  reason codes on nine-router routes.
- The sync worker logs `NINE_ROUTER_SYNC_FAILED` events.

## Checks

1. **Gateway process up?** `curl http://127.0.0.1:8787/health` — if this
   fails, the Pao gateway itself is down; fix that first.
2. **Sidecar up?** `curl http://127.0.0.1:20128/v1/models` — a failure here
   is a 9Router outage, not a Pao problem. Check the container
   (`docker ps`, compose logs) per `deploy/9router/README.md`.
3. **Loopback binding intact?** The compose file binds `127.0.0.1` only. If
   the sidecar was rebound to another interface, restore the loopback binding
   rather than widening the Pao gateway's target.
4. **Auth mismatch?** A `401`/`403` on the sidecar's `/v1/models` means the
   `PAO_AI_GATEWAY_NINE_ROUTER_API_KEY` changed on one side only. Fix the env
   var; do not disable sidecar auth to "make it work".
5. **Events timeline:** group `NINE_ROUTER_SYNC_FAILED` and
   `ROUTE_ATTEMPT_FAILED` events in `/api/gateway/events` by reason code.

## Containment

- Requests already fail over to non-9Router routes (bounded fallback); no
  action needed for continuity.
- If fallback storms are the concern, lower
  `governance.fallback.max_route_attempts` in
  `config/ai-gateway/governance.yaml`, or set
  `PAO_AI_GATEWAY_GOVERNANCE=false` and restart to return to the ungoverned
  path entirely.

## Do NOT

- Do not reset provider credentials inside 9Router on a connectivity outage;
  auth failures are visible as `CONNECTION_QUARANTINED_AUTH_*` events. Reset
  credentials only for those.
- Do not expose the 9Router dashboard publicly to "debug faster".
