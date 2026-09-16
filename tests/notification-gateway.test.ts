// Phase 20.23 — Unified Notification Gateway behavior and integration tests.
// All Discord I/O uses injected local fakes. No test sends a network request.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AGENT_OS_SCHEMA_VERSION, closeAgentOsDbForTests, openAgentOsDb } from "../src/agent-os/db";
import {
  validateAndNormalizeNotificationInput,
} from "../src/agent-os/notifications/validation";
import {
  calculateRetryDelayMs,
  classifyNotificationFailure,
} from "../src/agent-os/notifications/retry";
import {
  parseDiscordRateLimitResponse,
} from "../src/agent-os/notifications/discord/headers";
import {
  validateDiscordWebhookUrl,
} from "../src/agent-os/notifications/discord/url-policy";
import {
  redactNotificationSecrets,
} from "../src/agent-os/notifications/redaction";
import { NotificationStore } from "../src/agent-os/notifications/store";
import { NotificationGateway } from "../src/agent-os/notifications/gateway";
import { DEFAULT_NOTIFICATION_CONFIG } from "../src/agent-os/notifications/config";
import { DiscordWebhookProvider } from "../src/agent-os/notifications/discord/provider";
import { NotificationWorker } from "../src/agent-os/notifications/worker";

describe("Phase 20.23 notification safety primitives", () => {
  test("normalizes an event while removing credential-bearing fields before persistence", () => {
    const event = validateAndNormalizeNotificationInput({
      source: "codex",
      eventType: "codex.task.completed",
      title: "Build completed",
      message: "Authorization: Bearer " + "t".repeat(28),
      severity: "success",
      priority: "P2",
      tags: [" build ", "build", "phase-20.23"],
      data: {
        filesChanged: 7,
        password: "owner-password",
        nested: { sessionToken: "session-secret-value", safe: "kept" },
      },
    });

    expect(event.tags).toEqual(["build", "phase-20.23"]);
    expect(event.message).toBe("Authorization: Bearer [REDACTED]");
    expect(event.data).toEqual({
      filesChanged: 7,
      password: "[REDACTED]",
      nested: { sessionToken: "[REDACTED]", safe: "kept" },
    });
  });

  test("rejects malformed event names and empty user-visible content", () => {
    expect(() => validateAndNormalizeNotificationInput({
      source: "system",
      eventType: "not a valid event",
      title: " ",
      severity: "info",
      priority: "P3",
    })).toThrow("eventType");
  });

  test("accepts only HTTPS Discord webhook endpoints on an exact Discord host and path", () => {
    expect(validateDiscordWebhookUrl("https://discord.com/api/webhooks/123456/token-value").ok).toBe(true);
    expect(validateDiscordWebhookUrl("https://discordapp.com/api/webhooks/123456/token-value").ok).toBe(true);
    expect(validateDiscordWebhookUrl("http://discord.com/api/webhooks/123456/token-value").ok).toBe(false);
    expect(validateDiscordWebhookUrl("https://discord.com.attacker.test/api/webhooks/123456/token-value").ok).toBe(false);
    expect(validateDiscordWebhookUrl("https://discord.com/api/not-webhooks/123456/token-value").ok).toBe(false);
    expect(validateDiscordWebhookUrl("https://user:pass@discord.com/api/webhooks/123456/token-value").ok).toBe(false);
  });

  test("redacts Discord webhook tokens without hiding the non-secret webhook id", () => {
    const input = "delivery failed at https://discord.com/api/webhooks/123456/synthetic-token-value?wait=true";
    const output = redactNotificationSecrets(input);
    expect(output).toContain("/api/webhooks/123456/[REDACTED]");
    expect(output).not.toContain("synthetic-token-value");
    expect(output).not.toContain("wait=true");
  });

  test("learns relative Discord limits and numeric Retry-After case-insensitively", () => {
    const parsed = parseDiscordRateLimitResponse({
      status: 429,
      headers: new Headers({
        "x-ratelimit-limit": "5",
        "X-RateLimit-Remaining": "0",
        "x-ratelimit-reset-after": "1.25",
        "X-RateLimit-Bucket": "bucket-a",
        "X-RateLimit-Scope": "shared",
        "Retry-After": "1.5",
      }),
      bodyText: "{\"retry_after\":9,\"global\":false}",
      nowMs: 10_000,
    });

    expect(parsed).toEqual({
      limit: 5,
      remaining: 0,
      resetAfterMs: 1_250,
      resetAtMs: 11_250,
      bucketId: "bucket-a",
      scope: "shared",
      retryAfterMs: 1_500,
      global: false,
    });
  });

  test("uses a 429 body cooldown and global flag when headers omit them", () => {
    const parsed = parseDiscordRateLimitResponse({
      status: 429,
      headers: new Headers(),
      bodyText: "{\"retry_after\":2.25,\"global\":true}",
      nowMs: 50_000,
    });

    expect(parsed.retryAfterMs).toBe(2_250);
    expect(parsed.global).toBe(true);
    expect(parsed.limit).toBeNull();
    expect(parsed.bucketId).toBeNull();
  });

  test("classifies Discord outcomes without blindly retrying deterministic 4xx failures", () => {
    expect(classifyNotificationFailure({ status: 429 })).toMatchObject({ retryable: true, code: "DISCORD_RATE_LIMITED" });
    expect(classifyNotificationFailure({ status: 503 })).toMatchObject({ retryable: true, code: "DISCORD_SERVER_ERROR" });
    expect(classifyNotificationFailure({ status: 400 })).toMatchObject({ retryable: false, code: "DISCORD_BAD_REQUEST" });
    expect(classifyNotificationFailure({ status: 401 })).toMatchObject({ retryable: false, code: "DISCORD_AUTH_INVALID", opensCircuit: true });
    expect(classifyNotificationFailure({ status: 403 })).toMatchObject({ retryable: false, code: "DISCORD_FORBIDDEN", opensCircuit: true });
    expect(classifyNotificationFailure({ status: 404 })).toMatchObject({ retryable: false, code: "DISCORD_WEBHOOK_NOT_FOUND", opensCircuit: true });
  });

  test("bounds exponential retry delay and applies injected jitter deterministically", () => {
    expect(calculateRetryDelayMs(1, { baseMs: 1_000, maxMs: 30_000, jitterMs: 500 }, () => 0.5)).toBe(1_250);
    expect(calculateRetryDelayMs(6, { baseMs: 1_000, maxMs: 30_000, jitterMs: 500 }, () => 1)).toBe(30_500);
  });
});

describe("Phase 20.23 persistent notification queue", () => {
  let dir = "";
  let store: NotificationStore;
  let gateway: NotificationGateway;

  beforeEach(() => {
    closeAgentOsDbForTests();
    dir = mkdtempSync(join(tmpdir(), "ocx-notifications-"));
    store = new NotificationStore(dir);
    gateway = new NotificationGateway({
      store,
      config: {
        enabled: true,
        maxPayloadBytes: 65_536,
        maxAttempts: 5,
        dedupeWindowMs: 30_000,
        aggregationWindowMs: 10_000,
      },
    });
    store.upsertDestination({
      id: "discord-default",
      provider: "discord_webhook",
      name: "Discord General",
      enabled: true,
      environment: "all",
      channelClass: "general",
      secretRef: "env:DISCORD_TEST_WEBHOOK",
    });
    store.upsertSubscription({
      id: "sub-all",
      eventPattern: "*",
      destinationId: "discord-default",
      enabled: true,
    });
  });

  afterEach(() => {
    closeAgentOsDbForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  test("migrates the shared Agent OS database additively to the notification schema", () => {
    expect(AGENT_OS_SCHEMA_VERSION).toBeGreaterThanOrEqual(29);
    const db = openAgentOsDb(dir);
    const tableRows = db.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'notification_%' ORDER BY name",
    ).all() as Array<{ name: string }>;
    expect(tableRows.map((row) => row.name)).toEqual([
      "notification_aggregations",
      "notification_attempts",
      "notification_audit_events",
      "notification_circuits",
      "notification_dead_letters",
      "notification_deliveries",
      "notification_destinations",
      "notification_events",
      "notification_invalid_requests",
      "notification_provider_gates",
      "notification_rate_limit_states",
      "notification_subscriptions",
    ]);
    expect(db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").get()).toBeTruthy();
  });

  test("persists only a secret reference in destination records and public views", () => {
    const destination = store.getDestination("discord-default");
    expect(destination?.secretRef).toBe("env:DISCORD_TEST_WEBHOOK");
    expect(store.listDestinationsPublic()[0]).not.toHaveProperty("secretRef");
    expect(JSON.stringify(store.listDestinationsPublic())).not.toContain("DISCORD_TEST_WEBHOOK");
  });

  test("reserves the highest-priority runnable delivery and serializes each destination", () => {
    const low = gateway.emitEvent({
      source: "system",
      eventType: "system.debug",
      title: "Low priority",
      severity: "debug",
      priority: "P4",
    }, { eventId: "evt-low", nowMs: 1_000 });
    const critical = gateway.emitEvent({
      source: "system",
      eventType: "system.service.down",
      title: "Critical",
      severity: "critical",
      priority: "P0",
    }, { eventId: "evt-critical", nowMs: 1_001 });

    expect(low.deliveriesQueued).toBe(1);
    expect(critical.deliveriesQueued).toBe(1);
    const first = store.reserveNextDelivery({ workerId: "worker-a", nowMs: 2_000, leaseMs: 500 });
    expect(first?.eventId).toBe("evt-critical");
    expect(store.reserveNextDelivery({ workerId: "worker-b", nowMs: 2_000, leaseMs: 500 })).toBeNull();
  });

  test("recovers an expired reservation without losing or duplicating the logical delivery", () => {
    gateway.emitEvent({
      source: "system",
      eventType: "system.health.failed",
      title: "Health failed",
      severity: "error",
      priority: "P1",
    }, { eventId: "evt-recover", nowMs: 5_000 });

    const first = store.reserveNextDelivery({ workerId: "worker-dead", nowMs: 5_100, leaseMs: 100 });
    const recovered = store.reserveNextDelivery({ workerId: "worker-replacement", nowMs: 5_201, leaseMs: 100 });
    expect(first?.id).toBeTruthy();
    expect(recovered?.id).toBe(first?.id);
    expect(store.listDeliveries().length).toBe(1);
  });

  test("uses one idempotent logical delivery when the same event id is emitted twice", () => {
    const input = {
      source: "codex" as const,
      eventType: "codex.task.completed",
      title: "Task complete",
      severity: "success" as const,
      priority: "P2" as const,
    };
    const first = gateway.emitEvent(input, { eventId: "evt-idempotent", nowMs: 10_000 });
    const second = gateway.emitEvent(input, { eventId: "evt-idempotent", nowMs: 10_001 });
    expect(first.deliveriesQueued).toBe(1);
    expect(second.deliveriesQueued).toBe(0);
    expect(store.listDeliveries().length).toBe(1);
  });

  test("suppresses a repeated dedupe key inside its configured window", () => {
    const input = {
      source: "runpod" as const,
      eventType: "runpod.cost.warning",
      title: "GPU cost warning",
      severity: "warning" as const,
      priority: "P1" as const,
      dedupeKey: "runpod:pod-7:cost",
    };
    const first = gateway.emitEvent(input, { eventId: "evt-dedupe-1", nowMs: 20_000 });
    const second = gateway.emitEvent(input, { eventId: "evt-dedupe-2", nowMs: 20_100 });
    expect(first.status).toBe("accepted");
    expect(second.status).toBe("deduplicated");
    expect(second.suppressed).toBe(1);
    expect(store.listDeliveries().length).toBe(1);
  });

  test("coalesces a noisy aggregation window into one scheduled delivery", () => {
    for (let index = 0; index < 100; index++) {
      gateway.emitEvent({
        source: "stock_pipeline",
        eventType: "stock.asset.generated",
        title: "Stock asset generated",
        severity: "info",
        priority: "P3",
        aggregationKey: "stock-batch:batch-1",
        data: { generated: 1 },
      }, { eventId: `evt-stock-${index}`, nowMs: 30_000 + index });
    }

    const deliveries = store.listDeliveries();
    const aggregations = store.listAggregations();
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.availableAtMs).toBe(40_000);
    expect(aggregations).toHaveLength(1);
    expect(aggregations[0]?.eventCount).toBe(100);
    expect(aggregations[0]?.summary).toEqual({
      eventTypes: { "stock.asset.generated": 100 },
      numericTotals: { generated: 100 },
    });
  });
});

describe("Phase 20.23 Discord delivery worker", () => {
  let dir = "";
  let store: NotificationStore;
  let gateway: NotificationGateway;

  beforeEach(() => {
    closeAgentOsDbForTests();
    dir = mkdtempSync(join(tmpdir(), "ocx-notification-worker-"));
    store = new NotificationStore(dir);
    gateway = new NotificationGateway({
      store,
      config: {
        enabled: true,
        maxPayloadBytes: 65_536,
        maxAttempts: 5,
        dedupeWindowMs: 30_000,
        aggregationWindowMs: 10_000,
      },
    });
    store.upsertDestination({
      id: "discord-default",
      provider: "discord_webhook",
      name: "Discord General",
      enabled: true,
      environment: "all",
      channelClass: "general",
      secretRef: "env:DISCORD_TEST_WEBHOOK",
    });
    store.upsertSubscription({ id: "sub-all", eventPattern: "*", destinationId: "discord-default" });
  });

  afterEach(() => {
    closeAgentOsDbForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  function createWorker(
    responses: Array<Response | Error>,
    options: { random?: () => number; config?: Partial<typeof DEFAULT_NOTIFICATION_CONFIG> } = {},
  ): { worker: NotificationWorker; sentBodies: string[]; calls: () => number } {
    let callCount = 0;
    const sentBodies: string[] = [];
    const provider = new DiscordWebhookProvider({
      fetchFn: async (_input, init) => {
        callCount++;
        sentBodies.push(String(init?.body ?? ""));
        const next = responses.shift();
        if (!next) throw new Error("fake Discord response sequence exhausted");
        if (next instanceof Error) throw next;
        return next;
      },
      secretResolver: () => "https://discord.com/api/webhooks/123456/synthetic-webhook-token",
      timeoutMs: 1_000,
    });
    const worker = new NotificationWorker({
      store,
      config: { ...DEFAULT_NOTIFICATION_CONFIG, ...options.config, enabled: true, workerEnabled: true },
      providers: new Map([["discord_webhook", provider]]),
      random: options.random ?? (() => 0),
    });
    return { worker, sentBodies, calls: () => callCount };
  }

  test("delivers one provider-neutral event through Discord and persists its receipt", async () => {
    gateway.emitEvent({
      source: "codex",
      eventType: "codex.task.completed",
      title: "Phase 20.23 complete",
      message: "Tests passed",
      severity: "success",
      priority: "P2",
      data: { filesChanged: 12 },
    }, { eventId: "evt-success", nowMs: 1_000 });
    const fixture = createWorker([new Response(null, { status: 204 })]);

    const outcome = await fixture.worker.runOnce({ workerId: "worker-a", nowMs: 1_001 });

    expect(outcome.kind).toBe("delivered");
    const delivery = store.listDeliveries()[0]!;
    expect(delivery.status).toBe("DELIVERED");
    expect(delivery.attempt).toBe(1);
    expect(store.listAttempts(delivery.id)).toHaveLength(1);
    expect(store.getDestination("discord-default")?.health).toBe("healthy");
    const payload = JSON.parse(fixture.sentBodies[0]!) as Record<string, unknown>;
    expect(JSON.stringify(payload)).toContain("Phase 20.23 complete");
    expect(JSON.stringify(payload)).not.toContain("synthetic-webhook-token");
  });

  test("reschedules a 429 from Retry-After plus jitter and learns its shared bucket", async () => {
    gateway.emitEvent({
      source: "system",
      eventType: "system.rate.test",
      title: "Rate limit test",
      severity: "info",
      priority: "P2",
    }, { eventId: "evt-429", nowMs: 10_000 });
    const fixture = createWorker([
      new Response("{\"retry_after\":9,\"global\":false}", {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": "1.5",
          "X-RateLimit-Limit": "5",
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset-After": "1.25",
          "X-RateLimit-Bucket": "bucket-shared",
          "X-RateLimit-Scope": "shared",
        },
      }),
      new Response(null, { status: 204 }),
    ], { random: () => 0.5 });

    const limited = await fixture.worker.runOnce({ workerId: "worker-a", nowMs: 10_000 });
    const afterLimited = store.listDeliveries()[0]!;
    expect(limited.kind).toBe("retry_scheduled");
    expect(afterLimited.status).toBe("RATE_LIMITED");
    expect(afterLimited.availableAtMs).toBe(11_750);
    expect(store.listRateLimitStates()).toContainEqual(expect.objectContaining({
      bucketId: "bucket-shared",
      scope: "shared",
      remaining: 0,
      blockedUntilMs: 11_500,
      rateLimitedCount: 1,
    }));
    expect((await fixture.worker.runOnce({ workerId: "worker-a", nowMs: 11_500 })).kind).toBe("idle");
    expect((await fixture.worker.runOnce({ workerId: "worker-a", nowMs: 11_750 })).kind).toBe("delivered");
    expect(store.listDeliveries()[0]?.attempt).toBe(2);
  });

  test("persists a global 429 gate and defers every Discord destination without another request", async () => {
    store.upsertDestination({
      id: "discord-errors",
      provider: "discord_webhook",
      name: "Discord Errors",
      enabled: true,
      environment: "all",
      channelClass: "errors",
      secretRef: "env:DISCORD_ERRORS_WEBHOOK",
    });
    gateway.emitEvent({
      source: "system",
      eventType: "system.one",
      title: "One",
      severity: "warning",
      priority: "P1",
      requestedDestinations: ["discord-default"],
    }, { eventId: "evt-global-1", nowMs: 20_000 });
    gateway.emitEvent({
      source: "system",
      eventType: "system.two",
      title: "Two",
      severity: "warning",
      priority: "P1",
      requestedDestinations: ["discord-errors"],
    }, { eventId: "evt-global-2", nowMs: 20_000 });
    const fixture = createWorker([
      new Response("{\"retry_after\":2,\"global\":true}", { status: 429, headers: { "Content-Type": "application/json" } }),
      new Response(null, { status: 204 }),
    ]);

    expect((await fixture.worker.runOnce({ workerId: "worker-a", nowMs: 20_000 })).kind).toBe("retry_scheduled");
    expect(store.getProviderGate("discord_webhook")?.blockedUntilMs).toBe(22_000);
    expect((await fixture.worker.runOnce({ workerId: "worker-b", nowMs: 20_001 })).kind).toBe("deferred");
    expect(fixture.calls()).toBe(1);
    expect(store.listDeliveries().filter((delivery) => delivery.attempt === 0)).toHaveLength(1);
  });

  test("proactively waits after observing remaining zero instead of provoking a second 429", async () => {
    for (const id of ["evt-proactive-1", "evt-proactive-2"]) {
      gateway.emitEvent({
        source: "system",
        eventType: "system.proactive.test",
        title: id,
        severity: "info",
        priority: "P2",
      }, { eventId: id, nowMs: 30_000 });
    }
    const fixture = createWorker([
      new Response(null, { status: 204, headers: {
        "X-RateLimit-Limit": "1",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset-After": "1",
        "X-RateLimit-Bucket": "bucket-one",
      } }),
      new Response(null, { status: 204 }),
    ]);

    expect((await fixture.worker.runOnce({ workerId: "worker-a", nowMs: 30_000 })).kind).toBe("delivered");
    expect((await fixture.worker.runOnce({ workerId: "worker-a", nowMs: 30_001 })).kind).toBe("deferred");
    expect(fixture.calls()).toBe(1);
    const waiting = store.listDeliveries().find((delivery) => delivery.status === "RATE_LIMITED")!;
    expect(waiting.attempt).toBe(0);
    expect(waiting.availableAtMs).toBe(31_000);
    expect((await fixture.worker.runOnce({ workerId: "worker-a", nowMs: 31_000 })).kind).toBe("delivered");
    expect(fixture.calls()).toBe(2);
  });

  test("uses bounded queue backoff for transient 5xx responses and succeeds on a later attempt", async () => {
    gateway.emitEvent({
      source: "runpod",
      eventType: "runpod.instance.ready",
      title: "Pod ready",
      severity: "success",
      priority: "P2",
    }, { eventId: "evt-5xx", nowMs: 40_000 });
    const fixture = createWorker([
      new Response("temporary", { status: 500 }),
      new Response("temporary", { status: 503 }),
      new Response(null, { status: 204 }),
    ]);

    expect((await fixture.worker.runOnce({ workerId: "worker-a", nowMs: 40_000 })).kind).toBe("retry_scheduled");
    expect(store.listDeliveries()[0]?.availableAtMs).toBe(41_000);
    expect((await fixture.worker.runOnce({ workerId: "worker-a", nowMs: 41_000 })).kind).toBe("retry_scheduled");
    expect(store.listDeliveries()[0]?.availableAtMs).toBe(43_000);
    expect((await fixture.worker.runOnce({ workerId: "worker-a", nowMs: 43_000 })).kind).toBe("delivered");
    expect(store.listDeliveries()[0]?.attempt).toBe(3);
    expect(store.listAttempts(store.listDeliveries()[0]!.id)).toHaveLength(3);
  });

  test("dead-letters invalid credentials, opens the circuit, and disables the destination", async () => {
    gateway.emitEvent({
      source: "system",
      eventType: "system.discord.auth_failed",
      title: "Credential check",
      severity: "error",
      priority: "P1",
    }, { eventId: "evt-401", nowMs: 50_000 });
    const fixture = createWorker([new Response("unauthorized", { status: 401 })]);

    expect((await fixture.worker.runOnce({ workerId: "worker-a", nowMs: 50_000 })).kind).toBe("dead_lettered");
    expect(store.listDeliveries()[0]?.status).toBe("DEAD_LETTER");
    expect(store.listDeadLetters()).toHaveLength(1);
    expect(store.getDestination("discord-default")).toMatchObject({ enabled: false, health: "invalid" });
    expect(store.getCircuit("discord-default")).toMatchObject({ state: "OPEN", openedUntilMs: null, reason: "DISCORD_AUTH_INVALID" });
    expect(store.invalidRequestSummary(50_001).authFailures10m).toBe(1);
  });

  test("redacts a webhook URL echoed by a network error before ledger and audit persistence", async () => {
    gateway.emitEvent({
      source: "system",
      eventType: "system.discord.network_failed",
      title: "Network check",
      severity: "error",
      priority: "P1",
    }, { eventId: "evt-secret-error", nowMs: 60_000 });
    const fixture = createWorker([
      new Error("connect failed https://discord.com/api/webhooks/123456/synthetic-webhook-token"),
    ]);

    await fixture.worker.runOnce({ workerId: "worker-a", nowMs: 60_000 });
    const serialized = JSON.stringify({
      deliveries: store.listDeliveries(),
      attempts: store.listAttempts(store.listDeliveries()[0]!.id),
      audit: store.listAuditEvents(),
      deadLetters: store.listDeadLetters(),
    });
    expect(serialized).not.toContain("synthetic-webhook-token");
    expect(serialized).toContain("[REDACTED]");
  });
});
