# Phase 20.23 — Pao-hubPro Unified Notification Gateway × Discord Webhook Reliability Layer

> **Project:** Pao-hubPro  
> **Phase:** 20.20  
> **Status:** Implementation Specification  
> **Date:** 2026-09-11  
> **Primary reference:** https://discord-webhook.com/en/blog/discord-webhook-rate-limits/  
> **Authoritative reference:** https://docs.discord.com/developers/topics/rate-limits  
> **Primary goal:** Build a centralized, provider-neutral notification infrastructure for Pao-hubPro, with Discord Webhook as the first production adapter, using queueing, header-driven rate-limit control, retry/backoff, batching, deduplication, circuit breakers, auditability, and safe secret handling.

---

## 0. Executive Decision

Do **not** let every subsystem call Discord Webhook directly.

Do this instead:

```text
Codex
ComfyUI
Runpod
Browser Agent
Chrome Extension
Social Intelligence
Adobe Stock Pipeline
Reviewer Council
System Monitor
Other Agents
      |
      v
Pao Notification Bus
      |
      v
Unified Notification Gateway
      |
      +-- Validation
      +-- Policy
      +-- Priority Queue
      +-- Deduplication
      +-- Aggregation
      +-- Delivery Router
      +-- Rate Limit Manager
      +-- Retry / Backoff
      +-- Circuit Breaker
      +-- Delivery Ledger
      +-- Dead Letter Queue
      +-- Metrics / Audit
      |
      v
Notification Adapters
      |
      +-- Discord Webhook      <-- Phase 20.23 first adapter
      +-- Telegram             <-- later
      +-- LINE                 <-- later
      +-- Email                <-- later
      +-- Slack                <-- later
      +-- Web Push             <-- later
```

The rest of Pao-hubPro sends **notification events**, not raw Discord HTTP requests.

This separates:

```text
"What happened?"
```

from:

```text
"Where and how should it be delivered?"
```

---

# 1. Why This Phase Exists

Pao-hubPro is becoming a multi-agent control plane.

As more subsystems run concurrently, direct webhook calls create predictable failure modes:

- burst traffic;
- duplicated alerts;
- Discord HTTP 429 responses;
- several workers retrying at the same time;
- hidden message loss;
- unbounded retries;
- webhook tokens leaking into logs;
- one noisy subsystem flooding a channel;
- critical alerts being delayed behind low-value progress messages;
- inconsistent formatting across tools;
- impossible-to-audit notification history.

Phase 20.23 creates one controlled delivery boundary.

Correct pattern:

```text
Agent / Pipeline
   -> emit event
   -> queue
   -> policy
   -> route
   -> send
   -> observe response headers
   -> update limiter state
   -> delivery receipt
```

Wrong pattern:

```text
ComfyUI -> Discord directly
Codex   -> Discord directly
Runpod  -> Discord directly
Browser -> Discord directly
Stock   -> Discord directly
```

---

# 2. Source Findings and Authority Rules

## 2.1 Community Reference

Reference article:

```text
https://discord-webhook.com/en/blog/discord-webhook-rate-limits/
```

Useful concepts to preserve:

- HTTP 429 handling;
- `Retry-After`;
- `retry_after`;
- `X-RateLimit-Remaining`;
- `X-RateLimit-Reset-After`;
- `X-RateLimit-Bucket`;
- global limit handling;
- exponential backoff;
- jitter;
- queue-per-resource thinking;
- token-bucket / local pacing;
- avoiding retry storms.

The article provides practical example limits such as approximate per-webhook/per-channel values.

These numbers are **implementation guidance only**, not a protocol contract.

## 2.2 Authoritative Rule

Discord's official documentation states that rate limits can vary and are subject to change.

Therefore:

```text
DO NOT HARD-CODE DISCORD ROUTE LIMITS AS THE SOURCE OF TRUTH.
```

The sender must learn actual limits dynamically from Discord response headers.

Authoritative headers:

```text
X-RateLimit-Limit
X-RateLimit-Remaining
X-RateLimit-Reset
X-RateLimit-Reset-After
X-RateLimit-Bucket
X-RateLimit-Global
X-RateLimit-Scope
Retry-After
```

Primary runtime rule:

```text
Headers / 429 body
    > local assumptions
```

## 2.3 Retry Rule

When Discord returns:

```text
HTTP 429
```

use:

```text
Retry-After
```

or:

```json
{
  "retry_after": 1.234,
  "global": false
}
```

Do not replace Discord-provided cooldowns with arbitrary values such as:

```text
sleep(1)
```

## 2.4 Invalid Request Guard

Discord currently documents an invalid-request threshold of:

```text
10,000 invalid requests / 10 minutes / IP
```

for relevant 401, 403, and 429 responses, with shared-scope 429 behavior documented separately.

This value must be treated as current documentation, not assumed permanent.

Pao-hubPro must track invalid-request velocity and stop bad retry loops.

---

# 3. Scope

## 3.1 In Scope

Build:

- Unified notification event model;
- notification provider abstraction;
- Discord Webhook adapter;
- destination registry;
- priority queue;
- persistent delivery jobs;
- deduplication;
- aggregation;
- batching;
- per-destination serialization;
- rate-limit bucket state;
- adaptive limiter;
- global pause handling;
- retry with bounded exponential backoff;
- jitter;
- circuit breaker;
- dead-letter queue;
- idempotency;
- delivery receipts;
- metrics;
- audit log;
- MCP tools;
- protected HTTP API;
- dashboard;
- secret-safe configuration;
- tests;
- documentation;
- migration strategy;
- integration hooks for existing Pao-hubPro phases.

## 3.2 Out of Scope

Do not implement:

- Discord spam;
- mass unsolicited messaging;
- webhook discovery/scanning;
- webhook token scraping;
- stolen webhook usage;
- bypass of Discord restrictions;
- CAPTCHA or anti-abuse bypass;
- IP rotation to evade rate limits;
- proxy rotation to evade Discord enforcement;
- fake webhook success receipts;
- infinite retries;
- direct browser exposure of webhook tokens;
- automatic secret logging;
- automatic creation of public webhooks without authorization;
- bypassing permissions after 401/403;
- retrying a known-deleted webhook forever.

---

# 4. Core Architecture

```text
                         Pao-hubPro
                             |
          +------------------+------------------+
          |                  |                  |
        Codex            Pipelines           Agents
          |                  |                  |
          +------------------+------------------+
                             |
                             v
                    Notification Event API
                             |
                             v
                    Event Validation Layer
                             |
                             v
                     Notification Policy
                             |
             +---------------+---------------+
             |               |               |
        Deduplication    Aggregation      Priority
             |               |               |
             +---------------+---------------+
                             |
                             v
                     Persistent Queue
                             |
                             v
                      Delivery Router
                             |
                    destination/provider
                             |
                             v
                   Rate Limit Coordinator
                             |
                    +--------+--------+
                    |                 |
             Bucket Limiter      Global Pause
                    |                 |
                    +--------+--------+
                             |
                             v
                     Discord Adapter
                             |
                             v
                         Discord
                             |
                             v
                    Response Observer
                             |
          +------------------+-------------------+
          |                  |                   |
       success              429                 5xx
          |                  |                   |
          v                  v                   v
      complete       cooldown/requeue      retry/backoff
          |
          v
    Delivery Receipt
          |
          +--> Metrics
          +--> Audit
          +--> Dashboard
```

---

# 5. Design Principle — Provider Neutral

Define a common interface.

Suggested TypeScript shape:

```ts
interface NotificationProvider {
  id: string;
  name: string;

  validateDestination(
    destination: NotificationDestination
  ): Promise<DestinationValidationResult>;

  send(
    request: ProviderSendRequest
  ): Promise<ProviderSendResult>;

  classifyError(
    error: unknown,
    response?: ProviderHttpResponse
  ): NotificationErrorClassification;
}
```

Initial provider:

```text
discord_webhook
```

Future providers:

```text
telegram_bot
line_messaging
email
slack_webhook
web_push
custom_mcp
local_desktop
```

No producer should depend on Discord-specific payload structure.

---

# 6. Notification Event Model

Create a stable domain event.

Suggested model:

```ts
type NotificationSeverity =
  | 'debug'
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'critical';

type NotificationPriority =
  | 'P0'
  | 'P1'
  | 'P2'
  | 'P3'
  | 'P4';

type NotificationEvent = {
  id: string;

  source:
    | 'codex'
    | 'comfyui'
    | 'runpod'
    | 'browser'
    | 'chrome_extension'
    | 'social_intelligence'
    | 'stock_pipeline'
    | 'reviewer_council'
    | 'system'
    | 'user'
    | 'other';

  eventType: string;
  title: string;
  message?: string | null;

  severity: NotificationSeverity;
  priority: NotificationPriority;

  status?: string | null;
  progress?: number | null;

  entityType?: string | null;
  entityId?: string | null;

  dedupeKey?: string | null;
  aggregationKey?: string | null;

  tags: string[];

  data?: Record<string, unknown>;

  occurredAt: Date;
  createdAt: Date;

  requestedDestinations?: string[];
};
```

---

# 7. Priority Policy

Suggested defaults:

```text
P0 = Critical / Security / Data loss risk / Service down
P1 = Job failed / Approval required / Budget blocked
P2 = Job completed / Important success
P3 = Normal progress / Informational
P4 = Debug / Verbose telemetry
```

Queue behavior:

```text
P0 -> highest priority
P1 -> high
P2 -> normal
P3 -> low
P4 -> very low / optionally suppressed
```

Priority must **not** bypass provider rate limits.

Correct:

```text
P0 gets next available send slot
```

Wrong:

```text
P0 ignores Discord cooldown
```

---

# 8. Destination Registry

Create a destination registry instead of scattering webhook URLs across `.env` variables.

Suggested domain model:

```ts
type NotificationDestination = {
  id: string;
  provider: 'discord_webhook';

  name: string;
  enabled: boolean;

  environment?: 'dev' | 'staging' | 'production' | 'all';

  channelClass?:
    | 'critical'
    | 'errors'
    | 'jobs'
    | 'stock'
    | 'research'
    | 'system'
    | 'general';

  secretRef: string;

  rateLimitStateKey?: string | null;

  createdAt: Date;
  updatedAt: Date;
};
```

Store:

```text
secretRef
```

not:

```text
full webhook URL plaintext in normal application tables
```

If the existing project already has encrypted secret storage, reuse it.

Otherwise keep the actual webhook URL server-side via environment/secret manager and store only a reference key.

---

# 9. Webhook Secret Rules

A Discord webhook URL contains a secret token.

Treat the entire webhook URL as a credential.

Never:

```text
console.log(DISCORD_WEBHOOK_URL)
```

Never expose it to:

- browser JavaScript;
- frontend state;
- client-side environment variables;
- analytics;
- screenshots;
- audit metadata;
- error responses;
- exception monitoring without redaction.

Allowed logging:

```text
provider=discord_webhook
destinationId=discord-prod-alerts
webhookIdHash=...
bucketId=...
statusCode=204
remaining=...
resetAfter=...
```

Do not log the token.

---

# 10. Queue Strategy

Reuse an existing Pao-hubPro queue/job framework if present.

Do **not** add Redis/BullMQ/Celery/etc. simply because this phase suggests a queue.

Codex must inspect the repository first.

If no queue exists, implement the lightest production-appropriate abstraction with a replaceable interface.

Suggested queue interface:

```ts
interface NotificationQueue {
  enqueue(job: NotificationDeliveryJob): Promise<void>;
  reserve(workerId: string): Promise<NotificationDeliveryJob | null>;
  acknowledge(jobId: string): Promise<void>;
  retry(jobId: string, runAt: Date, reason: string): Promise<void>;
  deadLetter(jobId: string, reason: string): Promise<void>;
}
```

Required queue features:

- persistence;
- priorities;
- scheduled retry time;
- attempts;
- lease/visibility timeout;
- idempotent acknowledgment;
- worker crash recovery;
- bounded payload size;
- dead-letter state.

---

# 11. Per-Destination Serialization

Multiple webhooks may ultimately share provider/resource limits.

Phase 20.23 should avoid unbounded parallel sends.

Initial safe design:

```text
destination queue
    -> one active sender lane
    -> adaptive limiter
    -> Discord
```

If distributed workers are used:

```text
worker A
worker B
worker C
   |
   v
shared rate-limit state / lease
```

Do not allow every worker to believe it owns the same remaining quota independently.

---

# 12. Rate Limit Manager

Create a central service:

```ts
interface RateLimitManager {
  beforeSend(input: RateLimitAcquireInput): Promise<RateLimitPermit>;
  observeResponse(input: ObserveRateLimitResponseInput): Promise<void>;
  release?(permit: RateLimitPermit): Promise<void>;
}
```

Track at minimum:

```text
provider
destination
bucketId
limit
remaining
resetAfterMs
resetAtMonotonic/derived timestamp
scope
global
observedAt
```

Do not make the local limiter the authority over Discord.

The authority chain is:

```text
Discord response headers
   -> local learned state
   -> proactive pacing
```

---

# 13. Discord Rate Limit Header Handling

Parse case-insensitively:

```text
X-RateLimit-Limit
X-RateLimit-Remaining
X-RateLimit-Reset
X-RateLimit-Reset-After
X-RateLimit-Bucket
X-RateLimit-Global
X-RateLimit-Scope
Retry-After
```

Preferred timing source:

```text
X-RateLimit-Reset-After
```

over wall-clock epoch calculations when practical.

Reason:

```text
relative reset duration
```

is less vulnerable to local clock skew.

Header values may be absent.

Code must tolerate missing headers safely.

---

# 14. Bucket Identity

Discord exposes:

```text
X-RateLimit-Bucket
```

Use observed bucket IDs to group matching limits.

Do not assume:

```text
one URL = one independent bucket forever
```

Internal key may look like:

```text
discord:{scope}:{topLevelResource}:{bucketId}
```

Exact key design should match actual project architecture.

Until a bucket ID has been observed:

```text
use conservative per-destination local pacing
```

After observation:

```text
bind destination/route state to the learned bucket
```

---

# 15. Adaptive Limiter

Do not implement:

```text
const DISCORD_LIMIT = 5;
const WINDOW_MS = 5000;
```

as protocol truth.

Instead:

```text
first request
   -> Discord response
   -> learn limit/remaining/reset
   -> update local state
   -> proactively delay when exhausted
```

Fallback values may exist only as conservative safety defaults before headers are known.

They must be clearly labeled:

```text
bootstrap pacing
```

not:

```text
Discord official limit
```

Suggested config:

```dotenv
NOTIFY_DISCORD_BOOTSTRAP_MIN_INTERVAL_MS=250
```

This is local safety pacing, not a claim about Discord's real quota.

---

# 16. 429 Handling

On:

```text
HTTP 429
```

perform:

```text
1. Parse Retry-After header.
2. Parse JSON retry_after if available.
3. Parse global flag.
4. Parse X-RateLimit-Scope.
5. Parse bucket metadata.
6. Persist/update cooldown.
7. Requeue delivery for after cooldown.
8. Add small bounded jitter.
9. Increment rate-limit metrics.
10. Do not count successful delivery yet.
```

Pseudo-flow:

```ts
if (status === 429) {
  const retryAfterMs = parseDiscordRetryAfter(response);
  const global = parseDiscordGlobal(response);

  await rateLimitManager.observeResponse(...);

  if (global) {
    await globalGate.pauseUntil(now + retryAfterMs);
  }

  await queue.retry(
    job.id,
    now + retryAfterMs + jitter(),
    'DISCORD_RATE_LIMITED'
  );
}
```

Do not recursively call `send()` in an unbounded way.

Use queue rescheduling.

---

# 17. Global Rate Limit Gate

Discord documents a global API rate limit for bots, while unauthenticated requests can be IP-scoped.

Phase 20.23 should support a provider-wide pause primitive.

Suggested interface:

```ts
interface GlobalProviderGate {
  isPaused(provider: string): Promise<boolean>;
  pauseUntil(
    provider: string,
    until: Date,
    reason: string
  ): Promise<void>;
}
```

When response indicates:

```text
X-RateLimit-Global: true
```

or:

```json
{
  "global": true
}
```

all applicable Discord delivery workers should stop sending until the cooldown expires.

Do not pause only the failed job.

---

# 18. Retry Policy

Classify errors.

## Retryable

Typically:

```text
429
500
502
503
504
network timeout
connection reset
temporary DNS/network failure
```

## Non-Retryable by Default

```text
400 invalid payload
401 authentication failure
403 permission failure
404 deleted/unknown webhook
other deterministic invalid request
```

Do not turn every 4xx into a retry loop.

---

# 19. Exponential Backoff + Jitter

For transient non-429 errors, use bounded exponential backoff.

Example:

```text
attempt 1 -> ~1s
attempt 2 -> ~2s
attempt 3 -> ~4s
attempt 4 -> ~8s
attempt 5 -> ~16s
```

plus bounded jitter.

Suggested formula:

```ts
delayMs =
  min(maxBackoffMs, baseBackoffMs * 2 ** attempt)
  + random(0, jitterMaxMs);
```

Suggested configuration:

```dotenv
NOTIFY_RETRY_MAX_ATTEMPTS=5
NOTIFY_RETRY_BASE_MS=1000
NOTIFY_RETRY_MAX_MS=30000
NOTIFY_RETRY_JITTER_MS=500
```

For HTTP 429:

```text
Discord Retry-After wins.
```

Do not override it with exponential backoff unless extra safety padding is intentionally added.

---

# 20. Circuit Breaker

Create a circuit breaker per destination/provider.

States:

```text
CLOSED
OPEN
HALF_OPEN
```

Examples:

## 401

```text
AUTH_INVALID
-> open circuit
-> disable sending
-> notify admin through another available channel/dashboard
-> require credential fix
```

## 403

```text
FORBIDDEN
-> stop retrying
-> open/degrade destination
-> require permission review
```

## 404

```text
WEBHOOK_NOT_FOUND
-> mark destination invalid
-> stop using webhook
-> no repeated retry loop
```

## repeated 5xx

```text
transient failures
-> backoff
-> threshold exceeded
-> circuit OPEN
-> probe later
```

## 429

```text
RATE_LIMITED
-> cooldown
```

A normal 429 should generally update limiter state rather than permanently invalidating the destination.

---

# 21. Invalid Request Guard

Track sliding-window counters for:

```text
401
403
429
404
400
```

At minimum expose:

```text
invalid_requests_10m
rate_limited_requests_10m
auth_failures_10m
forbidden_requests_10m
not_found_requests_10m
```

Hard safety behavior:

```text
credential invalid
-> stop

webhook 404
-> stop

repeated payload 400
-> stop matching payload class / dead-letter

rate limit
-> cooldown
```

Never use proxy rotation or IP rotation to defeat Discord's safety/rate-limit controls.

---

# 22. Delivery Job Model

Suggested model:

```ts
type NotificationDeliveryJob = {
  id: string;
  eventId: string;
  destinationId: string;
  provider: string;

  priority: NotificationPriority;

  status:
    | 'QUEUED'
    | 'RESERVED'
    | 'SENDING'
    | 'RATE_LIMITED'
    | 'RETRY_SCHEDULED'
    | 'DELIVERED'
    | 'FAILED'
    | 'DEAD_LETTER'
    | 'CANCELLED'
    | 'SUPPRESSED';

  attempt: number;
  maxAttempts: number;

  availableAt: Date;
  reservedAt?: Date | null;
  sentAt?: Date | null;
  deliveredAt?: Date | null;

  providerMessageId?: string | null;

  lastStatusCode?: number | null;
  lastErrorCode?: string | null;

  idempotencyKey: string;

  createdAt: Date;
  updatedAt: Date;
};
```

---

# 23. Idempotency

A retry must not create uncontrolled duplicate messages.

Create an idempotency key such as:

```text
hash(
  eventId +
  destinationId +
  templateVersion
)
```

The storage layer must enforce or safely check uniqueness.

Recommended behavior:

```text
same event
+ same destination
+ same delivery variant
= one logical delivery
```

Retries update the same delivery record.

---

# 24. Deduplication

Deduplication is different from idempotency.

Example:

ComfyUI produces:

```text
image 1 completed
image 2 completed
image 3 completed
...
image 100 completed
```

Instead of 100 Discord messages, optionally coalesce them.

Suggested event controls:

```ts
dedupeKey?: string;
aggregationKey?: string;
dedupeWindowMs?: number;
```

Example:

```text
aggregationKey =
stock-batch:{batchId}
```

---

# 25. Aggregation

Support event aggregation for noisy pipelines.

Example source events:

```text
stock.asset.generated x100
stock.asset.qc.passed x83
stock.asset.qc.failed x17
stock.asset.exported x80
```

Aggregated Discord notification:

```text
✅ Adobe Stock Batch Complete

Generated: 100
QC Passed: 83
QC Failed: 17
Exported: 80

Duration: 42m
Runpod Cost: $1.82
Batch: stock-2026-09-11-001
```

Aggregation rules must be deterministic and testable.

---

# 26. Progress Notification Policy

Avoid message spam from progress ticks.

Suggested policy:

```text
0%
25%
50%
75%
100%
```

or:

```text
meaningful state transitions only
```

For long-running jobs:

```text
STARTED
MILESTONE
APPROVAL_REQUIRED
FAILED
COMPLETED
```

Do not send:

```text
1%
2%
3%
...
100%
```

unless explicitly configured.

---

# 27. Message Templates

Create provider-independent templates.

Suggested template names:

```text
job.started
job.completed
job.failed
job.approval_required
budget.blocked
provider.degraded
provider.recovered
stock.batch.completed
stock.asset.rejected
runpod.instance.ready
runpod.instance.failed
codex.task.completed
codex.task.failed
research.completed
security.alert
system.health
```

Renderer flow:

```text
NotificationEvent
   -> template
   -> provider-neutral message model
   -> Discord renderer
   -> Discord payload
```

---

# 28. Provider-Neutral Message Model

Suggested shape:

```ts
type NotificationMessage = {
  title?: string;
  text?: string;

  severity?: NotificationSeverity;

  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;

  links?: Array<{
    label: string;
    url: string;
  }>;

  footer?: string;

  timestamp?: Date;
};
```

Discord-specific embed conversion belongs only in:

```text
DiscordNotificationRenderer
```

---

# 29. Discord Adapter

Suggested layout:

```text
src/
  notifications/
    domain/
      types.ts
      events.ts
      priorities.ts
      errors.ts
      policies.ts

    destinations/
      destination.service.ts
      secret-resolver.ts

    queue/
      queue.interface.ts
      queue.service.ts
      worker.service.ts
      dead-letter.service.ts

    routing/
      notification-router.service.ts
      subscription.service.ts

    aggregation/
      dedupe.service.ts
      aggregation.service.ts

    rate-limit/
      rate-limit-manager.service.ts
      bucket-state.ts
      global-gate.service.ts

    retry/
      retry-policy.ts
      backoff.ts
      circuit-breaker.service.ts

    providers/
      provider.interface.ts
      discord/
        discord.client.ts
        discord.provider.ts
        discord.renderer.ts
        discord.headers.ts
        discord.errors.ts
        discord.payload.ts

    delivery/
      delivery.service.ts
      delivery-ledger.service.ts

    mcp/
      tools/
      schemas/

    api/
      ...

    ui/
      ...
```

Codex must adapt this to the existing repository instead of blindly creating duplicate folders.

---

# 30. Discord HTTP Client Rules

Use the project's existing HTTP client where possible.

Required:

- timeout;
- abort signal/cancellation;
- JSON validation;
- response status capture;
- selected response header capture;
- token redaction;
- bounded response body logging;
- request correlation ID;
- no automatic library retry that conflicts with the central retry system.

Important:

```text
Only one layer should own retry semantics.
```

If the HTTP library has automatic retries:

```text
disable them for Discord
```

or:

```text
configure them so the Notification Retry Manager remains authoritative.
```

---

# 31. Payload Validation

Validate before sending.

Do not let predictable invalid payloads consume Discord requests.

Check:

- content length;
- embeds;
- fields;
- URLs;
- supported JSON shape;
- empty payload;
- invalid UTF-8 edge cases where relevant;
- unexpected binary/object data;
- oversized internal metadata.

Provider renderer should only output fields supported by the target provider.

---

# 32. Database Models

Reuse the existing database/ORM conventions.

Suggested additive entities:

```text
NotificationEvent
NotificationDestination
NotificationSubscription
NotificationDelivery
NotificationDeliveryAttempt
NotificationRateLimitState
NotificationCircuitState
NotificationAggregation
NotificationDeadLetter
```

Relations:

```text
NotificationEvent       1---N NotificationDelivery
NotificationDestination 1---N NotificationDelivery
NotificationDelivery    1---N NotificationDeliveryAttempt
NotificationDestination 1---N NotificationRateLimitState
```

Do not store full Discord webhook tokens in ordinary tables.

---

# 33. Suggested Database Fields

## NotificationEvent

```text
id
source
eventType
title
message
severity
priority
entityType
entityId
dedupeKey
aggregationKey
dataJson
occurredAt
createdAt
```

## NotificationDelivery

```text
id
eventId
destinationId
provider
status
priority
attempt
maxAttempts
availableAt
idempotencyKey
lastStatusCode
lastErrorCode
providerMessageId
sentAt
deliveredAt
createdAt
updatedAt
```

## NotificationDeliveryAttempt

```text
id
deliveryId
attempt
startedAt
finishedAt
statusCode
errorCode
retryAfterMs
bucketId
rateLimitRemaining
rateLimitResetAfterMs
globalRateLimited
durationMs
```

## NotificationRateLimitState

```text
id
provider
destinationId
bucketId
scope
limitValue
remaining
resetAfterMs
blockedUntil
observedAt
```

---

# 34. Migration Rules

Mandatory:

- additive migrations only;
- never reset database;
- never drop production tables;
- preserve existing data;
- nullable columns where migration/backfill is unsafe;
- index delivery status;
- index availableAt;
- index priority;
- index eventId;
- index destinationId;
- unique idempotency key where architecture permits;
- use transactions for state transitions when necessary.

---

# 35. Delivery State Machine

Suggested:

```text
CREATED
   |
   v
QUEUED
   |
   v
RESERVED
   |
   v
SENDING
   |
   +-------------------+
   |                   |
   v                   v
DELIVERED          RATE_LIMITED
                       |
                       v
                RETRY_SCHEDULED
                       |
                       v
                    QUEUED
```

Failure branch:

```text
SENDING
  |
  v
FAILED_RETRYABLE
  |
  +-> RETRY_SCHEDULED

SENDING
  |
  v
FAILED_PERMANENT
  |
  +-> DEAD_LETTER / FAILED
```

Circuit branch:

```text
destination circuit OPEN
  -> hold / suppress according to policy
```

---

# 36. Error Taxonomy

Normalize provider errors.

Suggested codes:

```text
NOTIFY_INVALID_EVENT
NOTIFY_INVALID_DESTINATION
NOTIFY_DESTINATION_DISABLED
NOTIFY_RENDER_FAILED
NOTIFY_PAYLOAD_INVALID
NOTIFY_QUEUE_FAILED
NOTIFY_DUPLICATE
NOTIFY_SUPPRESSED

DISCORD_AUTH_INVALID
DISCORD_FORBIDDEN
DISCORD_WEBHOOK_NOT_FOUND
DISCORD_RATE_LIMITED
DISCORD_GLOBAL_RATE_LIMITED
DISCORD_BAD_REQUEST
DISCORD_TIMEOUT
DISCORD_NETWORK_ERROR
DISCORD_SERVER_ERROR

NOTIFY_RETRY_EXHAUSTED
NOTIFY_CIRCUIT_OPEN
NOTIFY_DEAD_LETTERED
NOTIFY_UNKNOWN_ERROR
```

Store raw response bodies only when necessary and redacted.

---

# 37. Routing / Subscription Rules

Producers should emit events without knowing destination URLs.

Example subscription configuration:

```text
security.*                 -> discord-critical
job.failed                 -> discord-errors
job.completed              -> discord-jobs
stock.*                    -> discord-stock
social.research.completed  -> discord-research
system.health.*            -> discord-system
```

Support wildcard or equivalent routing according to existing project conventions.

---

# 38. Notification Policy Engine

Before enqueueing:

```text
event
 -> enabled?
 -> severity allowed?
 -> environment allowed?
 -> quiet/suppression policy?
 -> dedupe?
 -> aggregation?
 -> destinations?
 -> enqueue
```

Policies should support:

```text
source
event type
severity
priority
environment
tag
entity type
destination
```

---

# 39. MCP Tool Surface

Expose authorized notification functionality through MCP.

Minimum tools:

```text
notify.send
notify.emit_event
notify.destinations.list
notify.delivery.get
notify.deliveries.list
notify.dead_letters.list
notify.metrics.summary
notify.health
```

Administrative tools only if existing permission architecture supports them:

```text
notify.destination.test
notify.destination.enable
notify.destination.disable
notify.delivery.retry
notify.dead_letter.retry
notify.dead_letter.dismiss
notify.settings.get
notify.settings.update
```

Do not expose webhook tokens through MCP outputs.

---

# 40. MCP Contract — `notify.emit_event`

Input:

```json
{
  "source": "stock_pipeline",
  "eventType": "stock.batch.completed",
  "title": "Adobe Stock Batch Complete",
  "severity": "success",
  "priority": "P2",
  "entityType": "stock_batch",
  "entityId": "batch-20260911-001",
  "aggregationKey": "stock-batch:batch-20260911-001",
  "data": {
    "generated": 100,
    "qcPassed": 83,
    "qcFailed": 17,
    "exported": 80,
    "durationSec": 2520,
    "runpodCostUsd": 1.82
  }
}
```

Output:

```json
{
  "eventId": "...",
  "status": "accepted",
  "deliveriesQueued": 1,
  "suppressed": 0
}
```

---

# 41. MCP Contract — `notify.send`

This is a direct logical notification request, not a raw webhook HTTP tool.

Input:

```json
{
  "destination": "discord-errors",
  "title": "Codex task failed",
  "message": "Phase implementation build failed.",
  "severity": "error",
  "priority": "P1",
  "dedupeKey": "codex:task-123:failed"
}
```

The tool must:

```text
validate
-> create internal event
-> queue
-> deliver through gateway
```

It must not return the Discord secret.

---

# 42. HTTP API

If Pao-hubPro has an HTTP API, add protected routes consistent with existing conventions.

Suggested:

```text
POST /api/notifications/events
POST /api/notifications/send

GET  /api/notifications/destinations
GET  /api/notifications/deliveries
GET  /api/notifications/deliveries/:id
GET  /api/notifications/dead-letters
GET  /api/notifications/metrics
GET  /api/notifications/health

POST /api/notifications/destinations/:id/test
POST /api/notifications/deliveries/:id/retry
POST /api/notifications/dead-letters/:id/retry
```

Protect administrative actions.

---

# 43. RBAC / Permissions

Reuse existing auth architecture.

Suggested permissions:

```text
notifications.read
notifications.emit
notifications.send
notifications.destinations.read
notifications.destinations.manage
notifications.delivery.retry
notifications.deadletter.manage
notifications.settings.manage
```

Do not create a parallel user/role system.

---

# 44. Dashboard

Create a **Notifications** area in the existing Pao-hubPro dashboard.

## 44.1 Overview

Show:

```text
Events Today
Deliveries Today
Delivered
Retrying
Rate Limited
Failed
Dead Letter
Success Rate
P50 Delivery Time
P95 Delivery Time
429 Rate
Invalid Request Count
Active Destinations
Open Circuits
```

## 44.2 Destinations

Table:

```text
Name
Provider
Class
Environment
Enabled
Health
Circuit
Last Success
Last Failure
Observed Bucket
```

Actions:

```text
View
Test
Enable/Disable
Inspect Health
```

Never reveal secret URL.

## 44.3 Delivery History

Show:

```text
Time
Event
Source
Priority
Destination
Status
Attempt
HTTP Status
Duration
Error
```

Expandable attempt history:

```text
attempt
timestamp
status
retry after
bucket
remaining
reset after
error code
```

## 44.4 Rate Limit Monitor

Show learned values:

```text
Destination
Bucket ID
Scope
Limit
Remaining
Reset After
Blocked Until
Last Observed
429 Count
```

Label clearly:

```text
Observed from Discord headers
```

Do not display hard-coded fake values.

## 44.5 Dead Letter Queue

Show:

```text
Event
Destination
Reason
Attempts
Last Error
Created
```

Actions:

```text
Inspect
Retry
Dismiss
```

Retry action must revalidate destination/circuit state.

## 44.6 Event Explorer

Filters:

```text
Source
Event type
Severity
Priority
Status
Destination
Date range
Entity
```

---

# 45. Observability

Structured logs:

```text
correlationId
eventId
deliveryId
destinationId
provider
priority
status
attempt
httpStatus
durationMs
errorCode

rateLimitBucket
rateLimitScope
rateLimitRemaining
rateLimitResetAfterMs
retryAfterMs
globalRateLimited

circuitState
queueDelayMs
```

Never log:

```text
webhook token
full webhook URL
authorization secrets
arbitrary sensitive payload data
```

---

# 46. Metrics

Suggested counters:

```text
notification_events_total
notification_deliveries_total
notification_delivery_success_total
notification_delivery_failed_total
notification_delivery_retry_total
notification_delivery_dead_letter_total

discord_requests_total
discord_429_total
discord_4xx_total
discord_5xx_total
discord_invalid_requests_total

notification_queue_depth
notification_queue_oldest_age_seconds

notification_circuit_open_total
notification_deduped_total
notification_aggregated_total
notification_suppressed_total
```

Histograms:

```text
notification_delivery_duration_ms
notification_queue_delay_ms
discord_request_duration_ms
```

---

# 47. Alerting on the Alerting System

Avoid relying only on Discord to report Discord failure.

If Discord is unhealthy:

```text
Dashboard health state
+ system logs
+ optional alternate provider later
```

Future provider fallback example:

```text
P0 critical
Discord failed permanently
   -> Telegram fallback
```

Do not implement cross-provider fallback in this phase unless existing infrastructure makes it straightforward.

Design extension points now.

---

# 48. Environment Variables

Use existing settings/secret infrastructure where possible.

Suggested defaults:

```dotenv
NOTIFICATIONS_ENABLED=true

NOTIFY_WORKER_ENABLED=true
NOTIFY_WORKER_CONCURRENCY=2

NOTIFY_RETRY_MAX_ATTEMPTS=5
NOTIFY_RETRY_BASE_MS=1000
NOTIFY_RETRY_MAX_MS=30000
NOTIFY_RETRY_JITTER_MS=500

NOTIFY_DISCORD_ENABLED=true
DISCORD_WEBHOOK_URL=
NOTIFY_DISCORD_REQUEST_TIMEOUT_MS=10000
NOTIFY_DISCORD_BOOTSTRAP_MIN_INTERVAL_MS=250

NOTIFY_DEDUPE_DEFAULT_WINDOW_MS=30000
NOTIFY_AGGREGATION_DEFAULT_WINDOW_MS=10000

NOTIFY_CIRCUIT_FAILURE_THRESHOLD=5
NOTIFY_CIRCUIT_OPEN_MS=60000

NOTIFY_QUEUE_MAX_PAYLOAD_BYTES=65536
NOTIFY_EVENT_RETENTION_DAYS=30
NOTIFY_DELIVERY_RETENTION_DAYS=30
```

These are suggested defaults, not requirements to create duplicate configuration systems.

For multiple destinations prefer secret references such as:

```text
DISCORD_WEBHOOK_ALERTS
DISCORD_WEBHOOK_JOBS
DISCORD_WEBHOOK_STOCK
```

or the project's encrypted secret registry.

---

# 49. Secret Redaction

Create/reuse a central redaction helper.

Patterns to redact:

```text
https://discord.com/api/webhooks/<id>/<token>
https://discordapp.com/api/webhooks/<id>/<token>
```

Redacted form:

```text
https://discord.com/api/webhooks/<id>/***REDACTED***
```

Prefer not logging the URL at all.

Test secret redaction explicitly.

---

# 50. Integration with Phase 20.19

Phase 20.19 introduced the Social Intelligence Engine and provider/run lifecycle.

Integrate by emitting events such as:

```text
social.registry.refresh.completed
social.registry.refresh.failed

social.research.started
social.research.completed
social.research.failed

social.provider.degraded
social.provider.recovered

social.budget.blocked
social.approval.required

social.stock_opportunities.ready
```

Example:

```text
Social Intelligence Engine
    -> NotificationEvent
    -> Unified Notification Gateway
    -> Discord
```

Do not add Discord calls inside Social Intelligence provider code.

---

# 51. Integration with Adobe Stock Workflow

Useful events:

```text
stock.research.completed
stock.concepts.ready
stock.generation.started
stock.generation.completed
stock.qc.completed
stock.qc.failed
stock.metadata.completed
stock.export.completed
stock.batch.completed
stock.pipeline.failed
stock.human_review.required
```

Recommended default:

```text
batch-level notifications
```

not:

```text
one notification per generated asset
```

unless troubleshooting mode is enabled.

---

# 52. Integration with ComfyUI / Runpod

Events:

```text
runpod.instance.starting
runpod.instance.ready
runpod.instance.failed
runpod.cost.warning

comfyui.workflow.started
comfyui.workflow.progress
comfyui.workflow.completed
comfyui.workflow.failed
comfyui.queue.stalled
```

Progress should be aggregated.

Example:

```text
🎬 ComfyUI Batch

Workflow: H3 Video
Completed: 18 / 24
Failed: 1
GPU: RTX 5090
Elapsed: 31m
```

---

# 53. Integration with Codex

Events:

```text
codex.task.started
codex.task.completed
codex.task.failed
codex.review.required
codex.tests.failed
codex.security.warning
```

Useful completed message:

```text
✅ Codex Task Completed

Phase: 20.20
Build: PASS
Tests: PASS
Files changed: 27
Migration: additive
Review required: Yes
```

---

# 54. Integration with Reviewer Council

Events:

```text
reviewer.requested
reviewer.provider.completed
reviewer.provider.failed
reviewer.consensus.ready
reviewer.disagreement.detected
reviewer.human_review.required
```

Aggregate provider responses into one outcome notification where possible.

---

# 55. Integration with Browser / Chrome Extension

Events:

```text
browser.agent.started
browser.agent.completed
browser.agent.failed
browser.approval.required

extension.queue.started
extension.queue.completed
extension.queue.paused
extension.queue.failed
```

Never include:

```text
cookies
tokens
passwords
session secrets
```

inside notification payloads.

---

# 56. Reliability Rules

Mandatory:

```text
at-least-once queue processing
+
idempotent logical delivery handling
+
bounded retries
+
persistent status
+
dead-letter on exhaustion
```

Exactly-once delivery to an external webhook cannot be assumed.

Design for duplicate tolerance.

---

# 57. Shutdown Behavior

Worker shutdown must:

```text
stop reserving new jobs
-> allow active sends to finish within timeout
-> release/expire queue leases
-> persist unfinished jobs
```

Do not lose jobs on process restart.

---

# 58. Startup Recovery

On startup:

```text
find expired RESERVED/SENDING leases
-> return eligible jobs to queue
-> preserve attempt history
```

Do not mark them delivered without receipt evidence.

---

# 59. Multi-Process / Multi-Instance Deployment

If Pao-hubPro runs on more than one process/server:

- rate-limit state must be coordinated;
- global pause must be shared;
- queue reservation must be atomic;
- idempotency must be storage-backed;
- circuit state should be shared where practical.

If only one process exists today, create interfaces that can move to shared storage later without rewriting producers.

---

# 60. Redis Use

If Redis already exists:

use it where appropriate for:

```text
queue
leases
rate-limit bucket state
global cooldown
distributed locks
short dedupe windows
```

If Redis does not exist:

do not introduce it blindly.

A database-backed implementation may be acceptable for initial scale.

Document the tradeoff.

---

# 61. Dead Letter Queue

A delivery enters dead letter when:

```text
max attempts exhausted
or
non-retryable failure requiring operator action
```

Examples:

```text
invalid payload
deleted webhook
auth invalid
forbidden
renderer bug
retry exhausted
```

Store enough data to diagnose, but redact secrets.

---

# 62. Manual Retry Rules

Admin manual retry must:

```text
revalidate destination
-> check circuit
-> rebuild/redact payload
-> enqueue a new attempt
```

Do not bypass rate limits.

Do not allow unlimited click-spam retries.

---

# 63. Retention

Keep notification records long enough for debugging, but avoid indefinite growth.

Suggested defaults:

```text
event metadata: 30 days
delivery metadata: 30 days
attempt metadata: 30 days
dead letters: until resolved or retention policy
```

Make configurable.

Do not retain unnecessary sensitive business payloads.

---

# 64. Testing Strategy

## 64.1 Unit Tests

Test:

```text
event validation
priority ordering
subscription routing
dedupe
aggregation
idempotency
Discord header parser
Retry-After parser
rate-limit state update
global pause
retry classification
backoff bounds
jitter bounds
circuit state transitions
secret redaction
payload renderer
payload validation
```

## 64.2 Integration Tests

Mock Discord HTTP responses.

Scenarios:

```text
204 success
200 success where applicable

429 + Retry-After
429 + retry_after body
429 + global=true
429 + X-RateLimit-Scope=shared

500 -> retry
502 -> retry
503 -> retry
504 -> retry

400 -> no retry
401 -> circuit/auth failure
403 -> no retry
404 -> destination invalid
```

## 64.3 Rate Limit Learning Test

Response:

```text
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 0
X-RateLimit-Reset-After: 1.0
X-RateLimit-Bucket: test-bucket
```

Expected:

```text
bucket learned
remaining=0
destination/bucket blocked until reset
next send delayed
no unnecessary 429
```

## 64.4 Global Pause Test

Mock:

```text
429
X-RateLimit-Global: true
Retry-After: 2
```

Expected:

```text
global Discord gate paused
other Discord destinations do not send during cooldown
jobs remain queued
workers resume after cooldown
```

## 64.5 Retry Storm Test

Create:

```text
100 queued messages
multiple workers
provider returns transient failure
```

Expected:

```text
bounded concurrency
jittered retries
no recursive explosion
no duplicate logical deliveries
```

## 64.6 Crash Recovery Test

```text
reserve job
simulate worker crash
lease expires
new worker resumes
```

Expected:

```text
job not lost
attempt history preserved
```

## 64.7 Secret Test

Search:

```text
logs
API responses
frontend bundle
database normal fields
test snapshots
```

Expected:

```text
no webhook token
```

---

# 65. Load Test

Create a local/mock provider.

Do **not** load-test Discord production webhooks aggressively.

Test locally:

```text
1,000 events
several priorities
dedupe groups
aggregation groups
random 429
random 5xx
random delays
```

Measure:

```text
queue depth
throughput
p95 queue delay
p95 delivery duration
retry count
duplicate logical delivery count
lost job count
```

Expected:

```text
lost jobs = 0
unbounded retry loops = 0
secret exposure = 0
```

---

# 66. Dashboard UX Rules

Use the existing Pao-hubPro design language.

Recommended:

- clean status cards;
- Apple-like restraint;
- clear severity;
- no excessive animation;
- responsive mobile layout;
- copyable IDs;
- expandable technical details;
- human-readable errors;
- timestamps with timezone clarity;
- empty states;
- loading states;
- degraded states;
- retry states.

Do not use secret values as UI diagnostics.

---

# 67. Audit Events

Reuse Pao-hubPro audit architecture.

Suggested events:

```text
NOTIFICATION_DESTINATION_CREATED
NOTIFICATION_DESTINATION_UPDATED
NOTIFICATION_DESTINATION_ENABLED
NOTIFICATION_DESTINATION_DISABLED
NOTIFICATION_DESTINATION_TESTED

NOTIFICATION_EVENT_EMITTED
NOTIFICATION_DELIVERY_QUEUED
NOTIFICATION_DELIVERY_SENT
NOTIFICATION_DELIVERY_FAILED
NOTIFICATION_DELIVERY_RETRY_SCHEDULED
NOTIFICATION_DELIVERY_DEAD_LETTERED

NOTIFICATION_CIRCUIT_OPENED
NOTIFICATION_CIRCUIT_CLOSED

NOTIFICATION_SETTINGS_CHANGED
```

Do not audit full webhook secret.

---

# 68. Security Requirements

Mandatory:

## Secret Boundary

```text
Discord webhook URL server-side only.
```

## SSRF / URL Policy

If administrators can configure arbitrary webhook URLs:

- allow only expected Discord hostnames for Discord provider;
- require HTTPS;
- reject localhost;
- reject private network addresses;
- validate redirects or disable them;
- do not allow arbitrary internal fetch targets.

Preferred:

```text
parse webhook URL
-> validate Discord hostname
-> validate expected path structure
-> store as secret
```

## Input Limits

Apply limits to:

```text
title
message
field count
field size
data object
tags
destination count
event frequency
queue payload size
```

## Access Control

Only authorized users/agents may:

```text
send
test destination
retry dead letters
edit settings
enable/disable destination
```

---

# 69. Compliance / Abuse Boundary

The notification system exists for internal workflow notifications.

Do not add:

```text
bulk DM
unsolicited outreach
mass guild/channel posting
rate-limit bypass
webhook token harvesting
proxy-based enforcement evasion
```

Keep the subsystem narrow and legitimate.

---

# 70. Failure Modes to Prevent

Must explicitly prevent:

### Failure A

```text
100 ComfyUI workers
-> 100 direct Discord requests
-> burst 429
```

Fix:

```text
central queue + aggregation + limiter
```

### Failure B

```text
429
-> every worker sleep(1)
-> all retry together
-> 429 again
```

Fix:

```text
Retry-After + shared state + jitter
```

### Failure C

```text
404 deleted webhook
-> retry forever
```

Fix:

```text
invalidate destination + circuit + dead letter
```

### Failure D

```text
webhook URL printed in error
```

Fix:

```text
secret redaction
```

### Failure E

```text
critical alert waits behind 5,000 debug messages
```

Fix:

```text
priority queue
```

### Failure F

```text
worker process crashes
-> job disappears
```

Fix:

```text
persistent queue + lease recovery
```

---

# 71. Completion Checks

Codex must run the real project checks.

At minimum attempt:

```text
typecheck
lint
unit tests
integration tests
production build
database migration validation
```

Report each as:

```text
PASS
FAIL CAUSED BY THIS PHASE
PRE-EXISTING FAIL
NOT AVAILABLE
```

Never hide failures.

---

# 72. Acceptance Criteria

Phase 20.23 is complete only when applicable items pass.

## Architecture

- [ ] Notification producers no longer need direct Discord webhook logic.
- [ ] Provider-neutral NotificationEvent model exists.
- [ ] Provider abstraction exists.
- [ ] Discord Webhook is implemented as an adapter.

## Queue

- [ ] Persistent queue exists or existing queue is reused.
- [ ] Priority handling works.
- [ ] Retry scheduling works.
- [ ] Worker crash recovery works.
- [ ] Dead-letter path exists.
- [ ] Queue is bounded by policy.

## Rate Limits

- [ ] Discord rate-limit headers are parsed.
- [ ] `X-RateLimit-Bucket` is recorded/used.
- [ ] `X-RateLimit-Remaining` is respected.
- [ ] `X-RateLimit-Reset-After` is supported.
- [ ] `Retry-After` is supported.
- [ ] `retry_after` body is supported.
- [ ] `X-RateLimit-Scope` is supported.
- [ ] global rate-limit pause is supported.
- [ ] route limits are not hard-coded as protocol truth.

## Retry

- [ ] 429 uses provider cooldown.
- [ ] 5xx uses bounded exponential backoff.
- [ ] jitter exists.
- [ ] 400 does not retry blindly.
- [ ] 401 does not retry blindly.
- [ ] 403 does not retry blindly.
- [ ] 404 stops using invalid webhook.
- [ ] max attempts are enforced.

## Circuit Breaker

- [ ] CLOSED exists.
- [ ] OPEN exists.
- [ ] HALF_OPEN exists or equivalent recovery logic exists.
- [ ] invalid auth can open circuit.
- [ ] deleted webhook can invalidate destination.
- [ ] recovery is observable.

## Idempotency / Noise Control

- [ ] Idempotency key exists.
- [ ] Duplicate logical delivery is prevented where possible.
- [ ] Dedupe is supported.
- [ ] Aggregation is supported.
- [ ] noisy progress events can be suppressed/coalesced.

## Security

- [ ] Webhook tokens remain server-side.
- [ ] Tokens are redacted from logs.
- [ ] Tokens are not returned through API/MCP.
- [ ] Discord destination URLs are validated.
- [ ] no rate-limit bypass/proxy evasion exists.
- [ ] admin actions are permission protected.

## Persistence

- [ ] Event records persist.
- [ ] Delivery records persist.
- [ ] Attempt history persists.
- [ ] Delivery state transitions are safe.
- [ ] migration is additive.

## MCP

- [ ] `notify.send`
- [ ] `notify.emit_event`
- [ ] `notify.destinations.list`
- [ ] `notify.delivery.get`
- [ ] `notify.deliveries.list`
- [ ] `notify.dead_letters.list`
- [ ] `notify.metrics.summary`
- [ ] `notify.health`

## Dashboard

- [ ] Overview exists.
- [ ] Destinations exists.
- [ ] Delivery history exists.
- [ ] Rate-limit monitor exists.
- [ ] Dead Letter Queue exists.
- [ ] Event explorer exists.
- [ ] loading/empty/error/degraded states exist.
- [ ] secrets are never displayed.

## Integrations

- [ ] Phase 20.19 can emit notifications without Discord-specific code.
- [ ] Adobe Stock pipeline events are supported.
- [ ] Codex events are supported.
- [ ] ComfyUI/Runpod events can be supported through the same event model.
- [ ] Browser/Extension events can use the same gateway.

## Quality Gate

- [ ] Typecheck attempted.
- [ ] Lint attempted.
- [ ] Tests attempted.
- [ ] Production build attempted.
- [ ] Migration validation attempted.
- [ ] No secrets committed.
- [ ] No destructive database reset.
- [ ] Implementation report produced.

---

# 73. Recommended Implementation Order

Implement in this order:

```text
1. Inspect current Pao-hubPro architecture.
2. Identify existing queue, DB, auth, audit, logger, MCP, API, settings patterns.
3. Create Notification domain model.
4. Create provider abstraction.
5. Create destination + secret-reference model.
6. Create/reuse persistent queue.
7. Create delivery ledger/state machine.
8. Implement Discord renderer.
9. Implement Discord HTTP adapter.
10. Implement rate-limit header parser.
11. Implement bucket state manager.
12. Implement global Discord pause gate.
13. Implement retry classification.
14. Implement exponential backoff + jitter.
15. Implement circuit breaker.
16. Implement idempotency.
17. Implement deduplication.
18. Implement aggregation.
19. Implement routing/subscriptions.
20. Add protected HTTP API.
21. Add MCP tools.
22. Add dashboard.
23. Integrate Phase 20.19 events.
24. Add Adobe Stock / Codex / ComfyUI / Runpod event hooks where architecture already exposes them.
25. Add unit tests.
26. Add integration tests.
27. Add secret-leak tests.
28. Add crash-recovery tests.
29. Run full project checks.
30. Produce implementation report.
```

---

# 74. Codex One-Shot Implementation Prompt

Copy the entire block below into Codex from the root of the existing Pao-hubPro repository.

```text
You are implementing Phase 20.23 for my existing Pao-hubPro repository.

PHASE NAME:
Pao-hubPro Unified Notification Gateway × Discord Webhook Reliability Layer

PRIMARY REFERENCE:
https://discord-webhook.com/en/blog/discord-webhook-rate-limits/

AUTHORITATIVE DISCORD RATE LIMIT DOC:
https://docs.discord.com/developers/topics/rate-limits

PRIMARY OBJECTIVE:
Build a centralized, provider-neutral notification infrastructure inside Pao-hubPro. Discord Webhook is the first production adapter. All Pao-hubPro subsystems should emit internal notification events instead of independently calling Discord webhooks.

CRITICAL RULES:

1. FIRST inspect the entire current repository architecture before modifying anything.
2. Reuse existing auth, roles, DB/ORM, queue, worker, Redis, settings, audit, logging, validation, API, MCP, UI, secret storage and job infrastructure whenever present.
3. Do NOT create duplicate infrastructure.
4. Preserve all existing behavior and data.
5. Use additive database migrations only.
6. NEVER reset/drop the database.
7. NEVER commit secrets.
8. Treat the entire Discord Webhook URL as a secret credential.
9. NEVER expose webhook URLs/tokens to browser code, API output, MCP output, logs, analytics or error responses.
10. Redact webhook tokens from all diagnostic paths.
11. Discord official documentation is authoritative over the community article.
12. Discord states rate limits may vary/change. Therefore DO NOT hard-code route/per-webhook/per-channel values as protocol truth.
13. Learn and react to actual Discord response headers.
14. Parse X-RateLimit-Limit.
15. Parse X-RateLimit-Remaining.
16. Parse X-RateLimit-Reset.
17. Parse X-RateLimit-Reset-After.
18. Parse X-RateLimit-Bucket.
19. Parse X-RateLimit-Global.
20. Parse X-RateLimit-Scope.
21. Parse Retry-After.
22. Parse 429 JSON retry_after and global.
23. On 429, Discord-provided Retry-After/retry_after is authoritative for retry timing.
24. A global rate limit must pause all applicable Discord workers, not only the failed job.
25. Use a shared/central learned rate-limit state when multiple workers/processes may send concurrently.
26. Use bounded exponential backoff + jitter for retryable transient non-429 failures.
27. Do not implement recursive unbounded retries.
28. Use queue rescheduling for retries.
29. Do not retry invalid 400 payloads blindly.
30. Do not retry invalid 401 credentials blindly.
31. Do not retry 403 permission failures blindly.
32. A known 404 webhook must be invalidated/stopped, not retried forever.
33. Track invalid-request rates to prevent bad retry loops.
34. Do not implement proxy/IP rotation to bypass Discord enforcement.
35. Do not implement spam, webhook harvesting, credential theft, unsolicited mass messaging, CAPTCHA bypass or restriction evasion.
36. Keep all external delivery behind the gateway.
37. Preserve human-readable auditability and observability.
38. Unknown rate-limit data must remain unknown until observed; never fabricate values.
39. Exactly-once external delivery cannot be assumed. Build at-least-once queueing with idempotent logical delivery handling.
40. Do the implementation now if the repository is writable. Do not stop at a plan.

ARCHITECTURE TARGET:

Pao-hubPro producers
  -> Notification Event API
  -> Validation
  -> Policy
  -> Deduplication / Aggregation
  -> Priority Queue
  -> Delivery Router
  -> Rate Limit Coordinator
  -> Retry / Circuit Breaker
  -> Discord Provider
  -> Delivery Receipt
  -> Metrics / Audit / Dashboard

A. NOTIFICATION DOMAIN

Create/extend a provider-neutral NotificationEvent model containing:
- id
- source
- eventType
- title
- message
- severity
- priority
- status/progress where useful
- entityType/entityId
- dedupeKey
- aggregationKey
- tags
- data
- occurredAt
- createdAt
- optional requested destinations

Suggested severity:
debug, info, success, warning, error, critical

Suggested priority:
P0, P1, P2, P3, P4

Priority policy:
P0 critical/security/service-down
P1 failure/approval/budget block
P2 completion/important success
P3 info/progress
P4 debug

Priority must not bypass rate limits.

B. PROVIDER ABSTRACTION

Create/extend a NotificationProvider interface supporting:
- validateDestination
- send
- classifyError

Implement:
DiscordWebhookProvider

Design extension points for:
- Telegram
- LINE
- Email
- Slack
- Web Push
- Custom MCP/local notification providers

Producer modules must not depend on Discord JSON payloads.

C. DESTINATION REGISTRY

Create/reuse a destination registry.

Minimum:
- id
- provider
- name
- enabled
- environment
- channel class/category
- secretRef
- health timestamps/state

Do NOT store full Discord webhook secrets in normal plaintext configuration tables.

If the project has encrypted secret storage, use it.
Otherwise use server-side env/secret references.

D. QUEUE

Reuse the existing queue if present.

Required behavior:
- persistent jobs
- priorities
- scheduled retries
- atomic reservation/lease
- crash recovery
- max attempts
- dead-letter state
- bounded payload
- idempotent acknowledgment

Do not install a second queue framework if one already exists.

E. DELIVERY LEDGER

Persist:
- event
- destination
- status
- priority
- attempt
- maxAttempts
- availableAt
- last HTTP status
- last internal error code
- idempotencyKey
- timestamps
- optional provider message ID

Persist attempt history:
- attempt
- started/finished
- statusCode
- errorCode
- retryAfterMs
- rateLimit bucket
- remaining
- resetAfter
- global flag
- duration

F. DISCORD RENDERER

Create provider-neutral message templates and a Discord renderer.

Do not let producers manually compose arbitrary Discord payloads unless there is a safe advanced path.

Validate payloads before network send.

G. DISCORD HTTP ADAPTER

Use existing HTTP client if possible.

Required:
- timeout
- abort/cancellation
- response status
- response headers
- safe bounded response-body handling
- correlation IDs
- secret redaction

Ensure only one layer owns retry behavior.
Disable conflicting automatic HTTP-client retries.

H. RATE LIMIT MANAGER

Implement a central adaptive rate-limit coordinator.

Observe:
X-RateLimit-Limit
X-RateLimit-Remaining
X-RateLimit-Reset
X-RateLimit-Reset-After
X-RateLimit-Bucket
X-RateLimit-Global
X-RateLimit-Scope
Retry-After

Prefer relative reset duration for scheduling when practical.

Do NOT use hard-coded community values as protocol truth.

Local fallback/bootstrap pacing may be used before headers are observed, but it must be clearly internal safety pacing.

I. BUCKET STATE

Use X-RateLimit-Bucket as an observed bucket identifier.

Track:
- provider
- destination/top-level resource
- bucket
- scope
- limit
- remaining
- resetAfter
- blockedUntil
- observedAt

If the app runs multiple workers/processes, coordinate bucket state through existing shared storage/Redis/DB.

J. 429 HANDLING

On 429:
- parse Retry-After
- parse JSON retry_after
- parse global
- parse scope
- update bucket/global state
- requeue for cooldown expiry
- add small bounded jitter
- increment metrics
- never recursively retry indefinitely

Discord retry timing wins over generic backoff.

K. GLOBAL GATE

When response indicates global=true or X-RateLimit-Global=true:
- pause all applicable Discord sends
- keep jobs queued
- resume after cooldown
- share pause state between workers if multi-process

L. RETRY POLICY

Retryable:
- 429
- 500
- 502
- 503
- 504
- timeout
- temporary network failure

Non-retryable by default:
- deterministic 400
- invalid 401
- 403
- deleted/invalid 404 webhook

Use bounded exponential backoff + jitter for transient non-429 failures.

Suggested configurable defaults:
NOTIFY_RETRY_MAX_ATTEMPTS=5
NOTIFY_RETRY_BASE_MS=1000
NOTIFY_RETRY_MAX_MS=30000
NOTIFY_RETRY_JITTER_MS=500

M. CIRCUIT BREAKER

Implement destination/provider circuit states:
CLOSED
OPEN
HALF_OPEN or equivalent controlled probe recovery

Behavior:
401 -> auth invalid -> stop/review credential
403 -> permission failure -> stop/review permission
404 -> invalidate destination -> no endless retries
repeated 5xx -> threshold -> open circuit -> probe later
429 -> limiter cooldown rather than permanent failure

N. INVALID REQUEST GUARD

Track recent:
- 401
- 403
- 404
- 429
- 400

Discord currently documents an invalid-request threshold of 10,000/10 minutes/IP for relevant requests, but treat current docs as the source of truth and do not assume the numeric threshold will never change.

Primary goal is to prevent defective loops long before the threshold.

O. IDEMPOTENCY

Create a stable idempotency key, e.g. based on:
eventId + destinationId + templateVersion

Retries operate on one logical delivery.

Prevent duplicate logical messages where possible.

P. DEDUPLICATION

Support:
- dedupeKey
- configurable dedupe window

Do not send repeated identical alerts during a short storm unless policy says otherwise.

Q. AGGREGATION

Support:
- aggregationKey
- configurable aggregation window

Use aggregation for noisy pipelines such as:
- ComfyUI asset completions
- Adobe Stock batch processing
- Reviewer Council provider results
- progress ticks

Prefer summary notifications over one-message-per-asset.

R. ROUTING / SUBSCRIPTIONS

Support rules like:
security.* -> discord-critical
job.failed -> discord-errors
job.completed -> discord-jobs
stock.* -> discord-stock
social.* -> discord-research
system.* -> discord-system

Use existing project configuration conventions.

S. DATABASE

Reuse actual ORM.

Suggested additive entities if needed:
NotificationEvent
NotificationDestination
NotificationSubscription
NotificationDelivery
NotificationDeliveryAttempt
NotificationRateLimitState
NotificationCircuitState
NotificationAggregation
NotificationDeadLetter

Never reset/drop existing DB.

Index:
- delivery status
- availableAt
- priority
- eventId
- destinationId
- idempotency key where applicable

T. MCP TOOLS

Implement/reuse MCP conventions.

Minimum:
notify.send
notify.emit_event
notify.destinations.list
notify.delivery.get
notify.deliveries.list
notify.dead_letters.list
notify.metrics.summary
notify.health

Optional administrative tools only with proper permissions:
notify.destination.test
notify.destination.enable
notify.destination.disable
notify.delivery.retry
notify.dead_letter.retry
notify.dead_letter.dismiss
notify.settings.get
notify.settings.update

Never return webhook token.

U. HTTP API

If the app already has HTTP APIs, add protected equivalents:
POST /api/notifications/events
POST /api/notifications/send
GET /api/notifications/destinations
GET /api/notifications/deliveries
GET /api/notifications/deliveries/:id
GET /api/notifications/dead-letters
GET /api/notifications/metrics
GET /api/notifications/health

Admin:
POST /api/notifications/destinations/:id/test
POST /api/notifications/deliveries/:id/retry
POST /api/notifications/dead-letters/:id/retry

Use existing validation/auth/RBAC.

V. PERMISSIONS

Suggested:
notifications.read
notifications.emit
notifications.send
notifications.destinations.read
notifications.destinations.manage
notifications.delivery.retry
notifications.deadletter.manage
notifications.settings.manage

Reuse existing role architecture.

W. DASHBOARD

Add Notifications area:

1. Overview
- Events Today
- Deliveries
- Delivered
- Retrying
- Rate Limited
- Failed
- Dead Letter
- Success Rate
- P50/P95 delivery time
- 429 rate
- invalid request count
- active destinations
- open circuits

2. Destinations
- name
- provider
- class
- environment
- enabled
- health
- circuit
- last success
- last failure
- learned bucket

3. Delivery History
- time
- event
- source
- priority
- destination
- status
- attempt
- HTTP status
- duration
- error

4. Rate Limit Monitor
- destination
- bucket
- scope
- observed limit
- remaining
- reset after
- blocked until
- last observed
- 429 count

Label these values as observed Discord header data.

5. Dead Letter Queue
- inspect
- retry
- dismiss

6. Event Explorer
- source
- event type
- severity
- priority
- status
- destination
- date range
- entity

Never render webhook secret.

X. OBSERVABILITY

Structured logs:
correlationId
eventId
deliveryId
destinationId
provider
priority
status
attempt
httpStatus
durationMs
errorCode
rateLimitBucket
rateLimitScope
rateLimitRemaining
rateLimitResetAfterMs
retryAfterMs
globalRateLimited
circuitState
queueDelayMs

Never log token/full webhook URL.

Metrics:
notification_events_total
notification_deliveries_total
notification_delivery_success_total
notification_delivery_failed_total
notification_delivery_retry_total
notification_delivery_dead_letter_total
discord_requests_total
discord_429_total
discord_4xx_total
discord_5xx_total
discord_invalid_requests_total
notification_queue_depth
notification_queue_oldest_age_seconds
notification_circuit_open_total
notification_deduped_total
notification_aggregated_total

Y. SECURITY

Validate Discord webhook destination host/path.
Require HTTPS.
Do not allow localhost/private-network arbitrary URLs for Discord provider.
Prevent SSRF.
Redact secrets.
Bound payload size.
Protect admin operations.
Do not send cookies/passwords/session tokens inside event payloads.

Z. PAO-HUBPRO INTEGRATIONS

Integrate event hooks where the architecture already has appropriate boundaries.

Phase 20.19 Social Intelligence:
social.registry.refresh.completed
social.registry.refresh.failed
social.research.started
social.research.completed
social.research.failed
social.provider.degraded
social.provider.recovered
social.budget.blocked
social.approval.required
social.stock_opportunities.ready

Adobe Stock:
stock.research.completed
stock.concepts.ready
stock.generation.started
stock.generation.completed
stock.qc.completed
stock.qc.failed
stock.metadata.completed
stock.export.completed
stock.batch.completed
stock.pipeline.failed
stock.human_review.required

Codex:
codex.task.started
codex.task.completed
codex.task.failed
codex.review.required
codex.tests.failed
codex.security.warning

ComfyUI / Runpod:
runpod.instance.starting
runpod.instance.ready
runpod.instance.failed
runpod.cost.warning
comfyui.workflow.started
comfyui.workflow.progress
comfyui.workflow.completed
comfyui.workflow.failed
comfyui.queue.stalled

Reviewer Council:
reviewer.requested
reviewer.provider.completed
reviewer.provider.failed
reviewer.consensus.ready
reviewer.disagreement.detected
reviewer.human_review.required

Browser/Extension:
browser.agent.started
browser.agent.completed
browser.agent.failed
browser.approval.required
extension.queue.started
extension.queue.completed
extension.queue.paused
extension.queue.failed

Do not place Discord-specific code inside these producers.

AA. TESTS

Unit:
- event validation
- priority
- routing
- dedupe
- aggregation
- idempotency
- Discord header parser
- Retry-After parser
- rate-limit state
- global pause
- retry classification
- backoff/jitter
- circuit states
- secret redaction
- payload renderer/validation

Integration HTTP mocks:
204 success
429 + Retry-After
429 + retry_after
429 global
429 shared scope
500/502/503/504 retry
400 no blind retry
401 auth failure
403 permission failure
404 invalid webhook

Rate-limit learning:
mock remaining=0/reset-after/bucket
verify next request waits without unnecessary 429.

Global pause:
mock global 429
verify all applicable Discord workers pause.

Retry storm:
100 jobs + multiple workers + transient failure
verify bounded retries/jitter/no recursion/no logical duplicate storm.

Crash recovery:
reserve job -> kill worker -> expire lease -> resume.

Secret leak:
verify webhook token absent from:
logs
frontend build
API responses
MCP responses
audit events
test snapshots

Load testing:
use local/mock provider, NOT aggressive production Discord testing.

AB. ENV/CONFIG

Use existing settings system when present.

Suggested:
NOTIFICATIONS_ENABLED=true
NOTIFY_WORKER_ENABLED=true
NOTIFY_WORKER_CONCURRENCY=2
NOTIFY_RETRY_MAX_ATTEMPTS=5
NOTIFY_RETRY_BASE_MS=1000
NOTIFY_RETRY_MAX_MS=30000
NOTIFY_RETRY_JITTER_MS=500
NOTIFY_DISCORD_ENABLED=true
DISCORD_WEBHOOK_URL=
NOTIFY_DISCORD_REQUEST_TIMEOUT_MS=10000
NOTIFY_DISCORD_BOOTSTRAP_MIN_INTERVAL_MS=250
NOTIFY_DEDUPE_DEFAULT_WINDOW_MS=30000
NOTIFY_AGGREGATION_DEFAULT_WINDOW_MS=10000
NOTIFY_CIRCUIT_FAILURE_THRESHOLD=5
NOTIFY_CIRCUIT_OPEN_MS=60000
NOTIFY_QUEUE_MAX_PAYLOAD_BYTES=65536
NOTIFY_EVENT_RETENTION_DAYS=30
NOTIFY_DELIVERY_RETENTION_DAYS=30

Bootstrap min interval is local safety pacing only, not an official Discord limit.

AC. MIGRATION SAFETY

- additive only
- no reset
- no destructive drop
- preserve existing rows
- nullable where needed
- transactions for state transitions
- document rollback where practical

AD. COMPLETION CHECKS

Run actual repository scripts for:
- typecheck
- lint
- unit tests
- integration tests
- production build
- migration validation

Report each:
PASS
FAIL CAUSED BY THIS PHASE
PRE-EXISTING FAIL
NOT AVAILABLE

Do not hide failures.

AE. FINAL IMPLEMENTATION REPORT

Return:
1. Existing architecture discovered
2. Reused infrastructure
3. Files added
4. Files modified
5. Database migrations
6. New/changed env vars
7. Notification domain implementation
8. Queue implementation
9. Discord adapter implementation
10. Rate-limit implementation
11. Retry/backoff implementation
12. Circuit breaker implementation
13. Idempotency/dedupe/aggregation
14. API routes
15. MCP tools
16. Dashboard pages/components
17. Pao-hubPro integration hooks
18. Tests and results
19. Build/typecheck/lint results
20. Security review
21. Secret-leak review
22. Remaining risks/TODOs
23. Exact commands to run locally

Do the implementation now.
Do not stop after writing a plan if the repository is writable.
Do not ask me to manually reproduce code that you can safely implement.
```

---

# 75. Post-Implementation Manual Test Checklist

## Test 1 — Basic Discord Delivery

Emit:

```text
notify.send
title = Phase 20.23 test
message = Hello from Pao-hubPro
```

Expected:

```text
event created
delivery queued
Discord receives one message
delivery = DELIVERED
attempt history = 1
```

---

## Test 2 — Secret Leakage

Search Pao-hubPro:

```text
logs
browser network response
frontend source
database debug view
MCP output
audit log
```

Expected:

```text
No Discord webhook token visible.
```

---

## Test 3 — Rate Limit Header Capture

Use test/mocked Discord response:

```text
X-RateLimit-Limit
X-RateLimit-Remaining
X-RateLimit-Reset-After
X-RateLimit-Bucket
```

Expected:

```text
state visible in Rate Limit Monitor
values labeled observed
```

---

## Test 4 — Proactive Pause

Mock:

```text
remaining = 0
reset-after = 1.2s
```

Queue two jobs.

Expected:

```text
job 1 response updates limiter
job 2 waits until safe window
```

---

## Test 5 — 429 Retry

Mock:

```text
HTTP 429
Retry-After: 1.5
```

Expected:

```text
no immediate recursive retry
delivery = RATE_LIMITED / RETRY_SCHEDULED
availableAt approximately cooldown + jitter
then delivery succeeds
```

---

## Test 6 — Global 429

Mock:

```text
HTTP 429
X-RateLimit-Global: true
Retry-After: 2
```

Have several Discord destinations queued.

Expected:

```text
all applicable Discord sending pauses
jobs stay queued
resume after cooldown
```

---

## Test 7 — 500 Backoff

Mock:

```text
500
500
204
```

Expected:

```text
attempt 1 fails
backoff
attempt 2 fails
larger backoff
attempt 3 succeeds
```

---

## Test 8 — Deleted Webhook

Mock:

```text
404
```

Expected:

```text
destination invalid/degraded
no infinite retry
delivery goes failed/dead-letter
admin can see actionable error
```

---

## Test 9 — Invalid Credential

Mock:

```text
401
```

Expected:

```text
no blind retry loop
circuit/destination degraded
secret remains hidden
```

---

## Test 10 — Aggregation

Emit:

```text
100 stock.asset.generated
aggregationKey = same batch
```

Expected:

```text
small number of summary notifications
not 100 Discord messages
```

---

## Test 11 — Priority

Queue:

```text
100 P4 events
1 P0 event
```

Expected:

```text
P0 gets earliest safe available delivery slot
```

P0 must still respect Discord cooldown.

---

## Test 12 — Worker Crash

```text
reserve job
kill worker
restart worker
```

Expected:

```text
lease recovery
job resumes
not silently lost
```

---

## Test 13 — MCP

Call:

```text
notify.emit_event
```

Expected:

```text
event accepted
delivery routed
no webhook URL returned
```

---

## Test 14 — Phase 20.19 Integration

Run a small Social Intelligence research job.

Expected:

```text
social.research.started
social.research.completed
```

through the Notification Gateway.

No Discord-specific code should exist inside Social Intelligence provider logic.

---

## Test 15 — Stock Batch

Run/mock stock batch.

Expected Discord summary:

```text
Generated
QC Passed
QC Failed
Exported
Duration
Cost if known
```

One useful summary rather than per-asset spam.

---

# 76. Definition of Success

Phase 20.23 succeeds when Pao-hubPro can handle a burst such as:

```text
Codex task completed
+
Runpod instance ready
+
ComfyUI generated 100 assets
+
Social research completed
+
Stock QC produced 17 failures
```

and internally execute:

```text
Events
 -> Validate
 -> Policy
 -> Dedupe
 -> Aggregate
 -> Priority Queue
 -> Route
 -> Rate Limit Gate
 -> Discord Adapter
 -> Observe Headers
 -> Delivery Receipt
 -> Metrics/Audit
```

without:

```text
webhook token exposure
message storm
unbounded retry
ignored Retry-After
hard-coded Discord route limit assumptions
worker race causing uncontrolled 429s
critical messages being buried permanently
job loss after restart
deleted-webhook infinite retry
database reset
```

---

# 77. Future Follow-Ups After Phase 20.23

Potential later phases:

```text
Phase 20.23.1 — Telegram Notification Adapter
Phase 20.23.2 — LINE Messaging Adapter
Phase 20.23.3 — Email Notification Adapter
Phase 20.23.4 — Slack Notification Adapter
Phase 20.23.5 — Cross-Provider Failover
Phase 20.23.6 — Notification Rules Builder
Phase 20.23.7 — Mobile/Web Push
Phase 20.23.8 — Alert Correlation / Incident Engine
Phase 20.23.9 — Notification Analytics & SLO
Phase 20.23.10 — AI Notification Summarizer
```

Recommended next logical extension:

```text
Phase 20.23.1 — Telegram Notification Adapter
```

because the core gateway, queue, rate-limit, retry, audit and template infrastructure should already exist after this phase.

Do not add Telegram by duplicating notification infrastructure.

Add it as another provider adapter.

---

# 78. Final Phase Statement

**Phase 20.23 converts notifications from scattered webhook calls into a centralized, reliable, auditable, provider-neutral delivery infrastructure for Pao-hubPro.**

Discord Webhook is only the first adapter.

The strategic outcome is:

```text
Pao-hubPro
    becomes
Notification-aware Agent Control Plane
```

where every agent and pipeline can report meaningful events through one safe path, while the gateway controls:

```text
priority
noise
dedupe
aggregation
rate limits
retries
secrets
delivery state
audit
observability
```

This prepares Pao-hubPro for Telegram, LINE, Email, Slack and other channels without rewriting every producer.

---

**END OF PHASE 20.23**
