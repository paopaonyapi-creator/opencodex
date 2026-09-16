# Phase 20.27 — Rollback

## Feature flags

Disable in order (all default safe):

```bash
VIBERAVEN_ADAPTER_ENABLED=false   # external adapter (already off)
READINESS_GATE_ENABLED=false      # gate endpoints refuse runs
PROVIDER_VERIFICATION_ENABLED=false
AGENT_COCKPIT_ENABLED=false       # sessions refuse to start
CONTROL_PLANE_ENABLED=false       # whole cockpit surface off
```

Disabling any of these never affects the core app, media pipelines, MCP hub,
or existing Phase 20.16 control-plane flows (doc §133).

## Schema

`cockpit_*` tables are additive projections. Rollback = drop them; no other
phase's data is touched. No destructive migration exists in this phase.

## API surface

Remove the `/api/agent-os/cockpit` dispatch branch + the 24 route-registry
entries (single contiguous block) to unwind the HTTP surface.

## Phase rollout mapping (doc §133)

Phase A read-only cockpit → B sessions/approvals → C evidence/gate → D strict
CI/release enforcement. D's CI wiring is the only outstanding piece; until it
lands, strict gates are operator-invoked, not CI-enforced.

## Data

Evidence, gate runs, snapshots, release marks, and review runs are retained
after rollback (audit value); retention policy config (doc §151) is a
follow-up.
