# Pao-hubPro Operations & Observability Runbook

> **Operational Procedures, Health Checks & Telemetry**  
> **Updated:** 2026-09-17

## 1. Core Health Endpoints

- **`/healthz`:** Overall proxy & server liveness.
- **`/api/agent-os/model-gateway/health`:** Model Gateway health, active adapter mode (`omniroute` vs `direct`), open circuit breaker count.
- **`/api/agent-os/model-gateway/circuits`:** List of all provider circuits, failure counts, and cooldown statuses.
- **`/api/agent-os/skill-gate/health`:** Skills Gate registry status, published skills count, quarantined skills count.
- **`/api/security/health`:** Security Control Plane operational status.
- **`/api/credentials/health`:** Credential vault and token lease pool health.

---

## 2. Operator Command Index

```bash
# Start proxy with default ports
bun run src/cli/index.ts start --port 8080

# Run deterministic code review over current workspace
bun run src/cli/index.ts review --preview
bun run src/cli/index.ts review

# Skills management
bun run src/cli/index.ts skill list
bun run src/cli/index.ts skill scan <path>

# Run test suites
bun run test:changed
bun test tests/model-gateway.test.ts
bun test tests/gold-master-e2e.test.ts

# Build Web Dashboard
bun run build:gui
```
