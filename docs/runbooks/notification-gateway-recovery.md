# Runbook: Unified Notification Gateway Operations & Incident Recovery

Phase 20.23 — Pao-hubPro Unified Notification Gateway × Discord Webhook Reliability Layer

---

## 1. System Health & Diagnostics

Inspect the operational status of the gateway, background worker, queues, and rate-limit states:

```bash
bun scripts/notification-status.ts
```

Expected diagnostic output includes:
- Gateway & Worker Status (`RUNNING` / `STOPPED`)
- Total, Healthy, and Invalid Destinations
- Active Provider Gates (e.g. Discord global pause)
- Dynamic Rate Limit buckets, remaining quota, and reset timers
- Open Dead Letter count and recent failures
- Recent delivery success rate

---

## 2. Emergency Controls & Environment Flags

### 2.1 Complete Gateway Bypass / Deactivation
To completely halt event ingestion across all subsystems:
```powershell
# Windows PowerShell
$env:PAO_NOTIFICATION_GATEWAY_ENABLED = "0"
```
```bash
# Linux / macOS Bash
export PAO_NOTIFICATION_GATEWAY_ENABLED=0
```

### 2.2 Pause Background Delivery Worker
To continue buffering events into SQLite without executing outbound HTTP calls to Discord:
```powershell
# Windows PowerShell
$env:PAO_NOTIFICATION_WORKER_ENABLED = "0"
```
```bash
# Linux / macOS Bash
export PAO_NOTIFICATION_WORKER_ENABLED=0
```

---

## 3. Investigating & Resolving Rate Limits

When Discord responds with HTTP 429 or `X-RateLimit-Remaining: 0`:
1. The gateway extracts `X-RateLimit-Reset-After` and `Retry-After` headers and sets `blocked_until_ms`.
2. The worker automatically enters a jittered cooldown and defers queued deliveries for that route or bucket.
3. If `X-RateLimit-Global: true`, the provider gate pauses all Discord webhook deliveries across all destinations.

To check currently active rate limits:
```bash
curl -s http://localhost:4040/api/agent-os/notifications/rate-limits | jq .
```

To clear a stale provider pause gate manually:
```bash
curl -X POST http://localhost:4040/api/agent-os/notifications/gates/clear \
  -H "Content-Type: application/json" \
  -d '{"provider": "discord_webhook"}'
```

---

## 4. Recovering Dead Letters & Failed Deliveries

Deliveries that exceed `maxAttempts` (default: 5) or hit non-retryable 4xx errors are routed to the Dead Letter Queue.

### 4.1 Inspect Open Dead Letters
```bash
curl -s "http://localhost:4040/api/agent-os/notifications/dead-letters?status=OPEN" | jq .
```

### 4.2 Retry a Dead Letter
Retrying a dead letter transitions its delivery back to `QUEUED` and records `status: "RETRIED"`:
```bash
curl -X POST "http://localhost:4040/api/agent-os/notifications/dead-letters/dl_xyz123/retry"
```

### 4.3 Dismiss a Dead Letter
To dismiss an obsolete or invalid alert:
```bash
curl -X POST "http://localhost:4040/api/agent-os/notifications/dead-letters/dl_xyz123/dismiss"
```

---

## 5. Webhook Credential Rotation & Invalid Destination Recovery

When a webhook URL is deleted or modified in Discord, Discord responds with HTTP 404 (`Unknown Webhook`) or 401/403.
The gateway automatically:
- Trips the destination circuit breaker to `OPEN`.
- Marks the destination health as `"invalid"`.
- Sets `enabled = 0` to prevent hammering dead endpoints.

### 5.1 Rotating the Secret
1. Create a new Webhook in Discord channel settings.
2. Update the environment variable referenced by the destination (e.g., `DISCORD_WEBHOOK_URL`).
3. Reset the destination in Pao-hubPro:
```bash
curl -X POST "http://localhost:4040/api/agent-os/notifications/destinations/dest_primary_discord/enable"
```
4. Verify connectivity using a test emission:
```bash
curl -X POST "http://localhost:4040/api/agent-os/notifications/destinations/dest_primary_discord/test"
```

---

## 6. End-to-End Verification

Run the full end-to-end smoke verification suite to ensure all 10 architectural gates are healthy:

```bash
# PowerShell
powershell -ExecutionPolicy Bypass -File scripts/phase-20.23-smoke.ps1

# Or Bun CLI
bun scripts/phase-20.23-smoke.ts
```
