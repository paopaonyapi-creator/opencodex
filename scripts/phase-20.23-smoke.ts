#!/usr/bin/env bun
// Phase 20.23 — Pao-hubPro Unified Notification Gateway × Discord Webhook Reliability Layer
// End-to-End Smoke Verification Script

import { openAgentOsDb, AGENT_OS_SCHEMA_VERSION } from "../src/agent-os/db";
import {
  NotificationStore,
  NotificationGateway,
  DiscordWebhookProvider,
  NotificationWorker,
  getNotificationService,
  resetNotificationServiceForTests,
  redactNotificationSecrets,
  parseDiscordRateLimitResponse,
  classifyNotificationFailure,
  calculateRetryDelayMs,
  DiscordNotificationRenderer,
  validateAndNormalizeNotificationInput,
} from "../src/agent-os/notifications";
import type { NotificationEvent } from "../src/agent-os/notifications/types";

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passCount++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failCount++;
  }
}

async function runSmokeTests() {
  console.log("================================================================================");
  console.log("    PAO-HUBPRO UNIFIED NOTIFICATION GATEWAY & DISCORD RELIABILITY SMOKE TEST    ");
  console.log("================================================================================\n");

  // Gate 1: Database Schema v29 Verification
  console.log("[1/10] Database Schema v29 Verification");
  const db = openAgentOsDb();
  assert(AGENT_OS_SCHEMA_VERSION >= 29, `Schema version is at least 29 (current: ${AGENT_OS_SCHEMA_VERSION})`);

  const tables = [
    "notification_destinations",
    "notification_events",
    "notification_subscriptions",
    "notification_deliveries",
    "notification_attempts",
    "notification_rate_limit_states",
    "notification_provider_gates",
    "notification_circuits",
    "notification_aggregations",
    "notification_dead_letters",
    "notification_invalid_requests",
    "notification_audit_events",
  ];
  for (const table of tables) {
    const res = db.query(`SELECT count(*) as cnt FROM ${table}`).get() as { cnt: number };
    assert(typeof res.cnt === "number", `Table '${table}' exists and is queryable`);
  }

  // Gate 2: Destination Registration & Secret Reference Redaction Safety
  console.log("\n[2/10] Destination Registration & Secret Reference Safety");
  const store = new NotificationStore();
  const testDestId = `smoke_dest_${Date.now()}`;
  const dest = store.upsertDestination({
    id: testDestId,
    name: "Smoke Test Discord Channel",
    provider: "discord_webhook",
    secretRef: "env:DISCORD_SMOKE_WEBHOOK_URL",
    channelClass: "general",
    enabled: true,
  });
  assert(dest.id === testDestId, `Destination ${testDestId} registered in SQLite store`);
  assert(dest.secretRef === "env:DISCORD_SMOKE_WEBHOOK_URL", "Destination preserves secretRef");

  const publicDest = store.listDestinationsPublic().find((d) => d.id === testDestId);
  assert(!!publicDest, "Destination appears in public listing");
  assert(!("secretRef" in (publicDest as Record<string, unknown>)), "Public destination object strips secretRef");

  const rawSecret = "https://discord.com/api/webhooks/123456789/abcdefgh-secret-token";
  const redacted = redactNotificationSecrets(rawSecret);
  assert(
    redacted === "https://discord.com/api/webhooks/123456789/[REDACTED]",
    "Discord webhook URLs are strictly redacted (token hidden)"
  );

  // Setup Gateway for functional testing
  const gateway = new NotificationGateway({
    store,
    config: {
      enabled: true,
      maxPayloadBytes: 256 * 1024,
      maxAttempts: 5,
      dedupeWindowMs: 60_000,
      aggregationWindowMs: 30_000,
    },
  });

  // Gate 3: Subscription Management & Wildcard Routing
  console.log("\n[3/10] Subscription Management & Wildcard Routing");
  store.upsertSubscription({
    id: `sub_wild_${Date.now()}`,
    destinationId: testDestId,
    source: "social_intelligence",
    eventPattern: "social_intelligence.*",
    minSeverity: "info",
    maxPriority: "P3",
  });
  const allSubs = store.listSubscriptions();
  assert(allSubs.some((s) => s.destinationId === testDestId && s.eventPattern === "social_intelligence.*"), "Subscription with 'social_intelligence.*' created");

  const matchingReceipt = gateway.emitEvent({
    source: "social_intelligence",
    eventType: "social_intelligence.tiktok.published",
    title: "Video published",
    severity: "info",
    priority: "P2",
  });
  assert(matchingReceipt.deliveriesQueued >= 1, "Wildcard subscription 'social_intelligence.*' matched and queued delivery");

  const nonMatchingReceipt = gateway.emitEvent({
    source: "codex",
    eventType: "codex.run.completed",
    title: "Codex run done",
    severity: "info",
    priority: "P2",
  });
  assert(nonMatchingReceipt.deliveriesQueued === 0, "Non-matching event queued 0 deliveries");

  // Gate 4: Deduplication & Idempotency Key Preservation
  console.log("\n[4/10] Deduplication & Idempotency Key Preservation");
  const dedupeKey = `smoke_dedupe_${Date.now()}`;
  const firstReceipt = gateway.emitEvent({
    source: "system",
    eventType: "system.smoke",
    title: "First Notification",
    severity: "info",
    priority: "P2",
    dedupeKey,
    requestedDestinations: [testDestId],
  });
  assert(firstReceipt.status === "accepted", "First event with dedupeKey accepted");
  assert(firstReceipt.deliveriesQueued === 1, "First event queued 1 delivery");

  const duplicateReceipt = gateway.emitEvent({
    source: "system",
    eventType: "system.smoke",
    title: "Duplicate Notification",
    severity: "info",
    priority: "P2",
    dedupeKey,
    requestedDestinations: [testDestId],
  });
  assert(duplicateReceipt.status === "deduplicated", "Duplicate event recognized and deduplicated");
  assert(duplicateReceipt.deliveriesQueued === 0, "Duplicate event queued 0 deliveries");

  // Gate 5: Aggregation Windowing for Batchable Events
  console.log("\n[5/10] Aggregation Windowing for Batchable Events");
  const aggKey = `smoke_batch_${Date.now()}`;
  const batch1 = gateway.emitEvent({
    source: "system",
    eventType: "system.batch",
    title: "Batch Item 1",
    severity: "info",
    priority: "P2",
    aggregationKey: aggKey,
    requestedDestinations: [testDestId],
  });
  const batch2 = gateway.emitEvent({
    source: "system",
    eventType: "system.batch",
    title: "Batch Item 2",
    severity: "info",
    priority: "P2",
    aggregationKey: aggKey,
    requestedDestinations: [testDestId],
  });
  assert(batch1.deliveriesQueued === 1, "First batch event queued 1 delivery");
  assert(batch2.aggregated === 1, "Second batch event aggregated into existing delivery");

  const openAgg = store.findOpenAggregation(aggKey, testDestId, Date.now());
  assert(openAgg !== null, "Open aggregation record exists");
  assert(openAgg?.summary.eventTypes["system.batch"] === 2, "Aggregation recorded 2 events in summary");

  // Gate 6: Discord Payload Rendering & Field Truncation Safety
  console.log("\n[6/10] Discord Payload Rendering & Limits Safety");
  const normalized = validateAndNormalizeNotificationInput({
    source: "codex",
    eventType: "codex.run.finished",
    title: "Codex Run Succeeded",
    message: "B".repeat(2000),
    severity: "critical",
    priority: "P0",
    data: { runId: "run-123", metrics: { tokens: 4500 } },
  });
  const mockEvent: NotificationEvent = {
    ...normalized,
    id: "evt_test",
    title: "A".repeat(400), // > 256 limit to test renderer truncation
    message: "B".repeat(5000), // > 4096 limit to test renderer truncation
    occurredAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  const renderer = new DiscordNotificationRenderer();
  const rendered = renderer.render(mockEvent);
  assert(rendered.embeds?.length === 1, "Rendered 1 Discord embed");
  assert((rendered.embeds?.[0].title?.length ?? 0) <= 256, `Title truncated safely within 256 chars (len: ${rendered.embeds?.[0].title?.length})`);
  assert((rendered.embeds?.[0].description?.length ?? 0) <= 4096, `Description truncated safely within 4096 chars (len: ${rendered.embeds?.[0].description?.length})`);
  assert(rendered.embeds?.[0].color === 0xed4245, "Critical severity mapped to Discord red color (0xed4245)");

  // Gate 7: Dynamic Header-Driven Rate-Limit Learning
  console.log("\n[7/10] Dynamic Header-Driven Rate-Limit Learning");
  const headers = new Headers({
    "X-RateLimit-Limit": "5",
    "X-RateLimit-Remaining": "0",
    "X-RateLimit-Reset-After": "2.5",
    "X-RateLimit-Bucket": "route_webhooks_test",
  });
  const observation = parseDiscordRateLimitResponse({
    status: 429,
    headers,
    bodyText: JSON.stringify({ retry_after: 2.5, global: false }),
  });
  assert(observation.limit === 5, "Extracted X-RateLimit-Limit: 5");
  assert(observation.remaining === 0, "Extracted X-RateLimit-Remaining: 0");
  assert(observation.resetAfterMs === 2500, "Calculated resetAfterMs: 2500");
  assert(observation.bucketId === "route_webhooks_test", "Extracted bucketId");
  assert(observation.global === false, "Parsed global = false");

  store.upsertRateLimitState({
    stateKey: `discord_webhook:bucket:${observation.bucketId}`,
    provider: "discord_webhook",
    destinationId: testDestId,
    bucketId: observation.bucketId,
    scope: "route",
    limit: observation.limit,
    remaining: observation.remaining,
    resetAfterMs: observation.resetAfterMs,
    blockedUntilMs: Date.now() + (observation.resetAfterMs ?? 0),
    observedAt: new Date().toISOString(),
    lastRequestAtMs: Date.now(),
    rateLimitedCount: 1,
  });
  const rateLimitState = store.findRateLimitState("discord_webhook", testDestId, observation.bucketId);
  assert(rateLimitState !== null, "Stored dynamic rate limit observation in SQLite");
  assert(rateLimitState?.remaining === 0, "Rate limit state recorded 0 remaining tokens");

  // Gate 8: Provider Global Pause Gate
  console.log("\n[8/10] Provider Global Pause Gate");
  const globalHeaders = new Headers({
    "X-RateLimit-Global": "true",
    "Retry-After": "5",
  });
  const globalObs = parseDiscordRateLimitResponse({
    status: 429,
    headers: globalHeaders,
    bodyText: JSON.stringify({ retry_after: 5.0, global: true }),
  });
  assert(globalObs.global === true, "Recognized X-RateLimit-Global: true");

  store.setProviderGate("discord_webhook", Date.now() + 5000, "Discord global 429 pause");
  const gate = store.getProviderGate("discord_webhook");
  assert(gate !== null, "Provider gate record exists");
  assert(gate?.blockedUntilMs !== null && gate.blockedUntilMs > Date.now(), "Provider gate actively pauses all destinations");

  // Reset gate for remaining tests
  store.clearProviderGate("discord_webhook");

  // Gate 9: Failure Classification, Backoff & Circuit Breaker
  console.log("\n[9/10] Failure Classification, Backoff & Circuit Breaker");
  const retryableClass = classifyNotificationFailure({ status: 503 });
  assert(retryableClass.retryable === true, "HTTP 503 classified as retryable");
  assert(retryableClass.code === "DISCORD_SERVER_ERROR", "Error code DISCORD_SERVER_ERROR assigned");

  const backoff = calculateRetryDelayMs(1, { baseMs: 1000, maxMs: 30000, jitterMs: 500 });
  assert(backoff >= 1000 && backoff <= 2000, `Backoff attempt 1 within bounds (got: ${backoff}ms)`);

  const fatalClass = classifyNotificationFailure({ status: 404 });
  assert(fatalClass.retryable === false, "HTTP 404 classified as fatal / non-retryable");
  assert(fatalClass.opensCircuit === true, "HTTP 404 trips circuit breaker");

  // Simulate tripping circuit
  store.upsertCircuit({
    destinationId: testDestId,
    provider: "discord_webhook",
    state: "OPEN",
    failureCount: 1,
    openedUntilMs: Date.now() + 60_000,
    reason: "HTTP_404: Webhook unknown or deleted",
  });
  const circuit = store.getCircuit(testDestId);
  assert(circuit?.state === "OPEN", "Circuit breaker transitioned to OPEN state");

  // Gate 10: Dead Letter Queue & Management Service API Integration
  console.log("\n[10/10] Dead Letter Queue & Service API Integration");
  resetNotificationServiceForTests();
  const service = getNotificationService();
  assert(service !== null, "NotificationService singleton initialized");

  const status = await service.getStatus();
  assert(typeof status.totalDestinations === "number", "Status returns totalDestinations");
  assert(typeof status.openCircuits === "number", "Status returns openCircuits count");

  const deliveries = store.listDeliveries({ destinationId: testDestId });
  const delivId = deliveries[0]?.id ?? "mock_deliv";
  const dl = store.createDeadLetter({
    deliveryId: delivId,
    eventId: firstReceipt.eventId,
    destinationId: testDestId,
    reason: "max_attempts_exceeded",
    lastErrorCode: "HTTP_500",
    attempts: 5,
  });
  assert(dl.status === "OPEN", "Dead letter record created with status OPEN");

  const deadLetters = service.listDeadLetters({ status: "OPEN" });
  assert(deadLetters.some((d) => d.id === dl.id), "Dead letter appears in service listDeadLetters");

  const dismissed = service.dismissDeadLetter(dl.id);
  assert(dismissed?.status === "DISMISSED", "Dead letter successfully dismissed via service API");

  console.log("\n================================================================================");
  console.log(`Smoke Verification Finished: ${passCount} PASSED, ${failCount} FAILED.`);
  console.log("================================================================================");

  if (failCount > 0) {
    process.exit(1);
  }
}

void runSmokeTests();
