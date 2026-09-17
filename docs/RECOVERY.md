# Pao-hubPro Disaster Recovery & Rollback Guide

> **Incident Response, Circuit Reset & Rollback Procedures**  
> **Updated:** 2026-09-17

## 1. Instant Model Gateway Rollback

If OmniRoute becomes unreachable or exhibits latency regressions:
```bash
# Set environment flag to disable remote gateway
export PAO_OMNIROUTE_ENABLED=false

# Restart or reload process
bun run src/cli/index.ts start
```
- **Outcome:** The Model Gateway switches immediately to `DirectGatewayAdapter` in < 5 ms.
- **Data Integrity:** Historical audit records, token counts, and cost telemetry remain fully preserved.

---

## 2. Circuit Breaker Manual Reset

When a provider is recovered after an outage, operators can manually reset its circuit breaker:
```text
POST /api/gateway/circuits/reset
Body: { "provider": "anthropic", "justification": "Upstream rate limit cleared by vendor" }
```

---

## 3. Database Recovery

Pao-hubPro utilizes SQLite with Write-Ahead Logging (`WAL` mode):
```bash
# Check database integrity
sqlite3 ~/.opencodex/agent-os.sqlite3 "PRAGMA integrity_check;"

# Backup database
sqlite3 ~/.opencodex/agent-os.sqlite3 ".backup 'backup-agent-os.sqlite3'"
```
