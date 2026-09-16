# Phase 20.55 — Pao Mobile Runtime (ARTEMIS adapter)

Extends the Phase 20.12 mobile gateway instead of replacing it.

## What shipped

- Deterministic Flash/Pro router with auditable reason strings
- Exclusive device leases (`mobile_device_leases`)
- Diagnostics mapped to ready/degraded/blocked; public ARTEMIS console bind is blocked
- Stable `pao.mobile.*` MCP aliases on top of existing `pao_mobile_*` tools
- Additive schema for approvals/trace events/leases

## Safety

- Screen text remains untrusted.
- R2/R3 still go through the existing approval state machine.
- ARTEMIS console must stay on loopback.

## Verification

```bash
bun test tests/mobile-runtime-20.55.test.ts tests/mobile-agent-gateway.test.ts
```

Live Android/ARTEMIS HTTP is **not** claimed by these tests (mock transport).

