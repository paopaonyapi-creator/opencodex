/**
 * Pao AI Gateway — Phase 20.51 tests: failure classifier, connection state
 * machine, and the autonomous recovery worker.
 */

import { describe, test, expect } from "bun:test";
import { classifyGatewayFailure, FAILURE_BEHAVIORS } from "../src/ai-gateway/resilience/classifier";
import { ConnectionStore } from "../src/ai-gateway/resilience/connection-state";
import { startRecoveryWorker } from "../src/ai-gateway/resilience/recovery";
import type { GatewayEventRecord } from "../src/ai-gateway/types";

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

describe("Phase 20.51 — failure classifier", () => {
  test("HTTP status mapping", () => {
    expect(classifyGatewayFailure({ status: 401 }).failureClass).toBe("auth_invalid");
    expect(classifyGatewayFailure({ status: 403 }).failureClass).toBe("permission_denied");
    expect(classifyGatewayFailure({ status: 402 }).failureClass).toBe("quota_exhausted");
    expect(classifyGatewayFailure({ status: 404 }).failureClass).toBe("model_unavailable");
    expect(classifyGatewayFailure({ status: 408 }).failureClass).toBe("network_timeout");
    expect(classifyGatewayFailure({ status: 429 }).failureClass).toBe("rate_limited");
    expect(classifyGatewayFailure({ status: 500 }).failureClass).toBe("provider_unavailable");
    expect(classifyGatewayFailure({ status: 529 }).failureClass).toBe("provider_overloaded");
  });

  test("429 with a quota message is quota exhaustion, not a plain rate limit", () => {
    const behavior = classifyGatewayFailure({ status: 429, error: new Error("insufficient_quota for this account") });
    expect(behavior.failureClass).toBe("quota_exhausted");
    expect(behavior.cooldownUntilReset).toBe(true);
  });

  test("400 splits into content rejection, capability mismatch, and protocol error", () => {
    expect(classifyGatewayFailure({ status: 400, error: new Error("content filter flagged the request") }).failureClass).toBe(
      "content_rejected",
    );
    expect(classifyGatewayFailure({ status: 400, error: new Error("context length exceeded") }).failureClass).toBe(
      "capability_mismatch",
    );
    expect(classifyGatewayFailure({ status: 400, error: new Error("malformed request body") }).failureClass).toBe(
      "protocol_error",
    );
  });

  test("legacy adapter codes take precedence", () => {
    expect(classifyGatewayFailure({ legacyCode: "provider_429" }).failureClass).toBe("rate_limited");
    expect(classifyGatewayFailure({ legacyCode: "provider_5xx", status: 500 }).failureClass).toBe("provider_unavailable");
    expect(classifyGatewayFailure({ legacyCode: "auth_failure" }).failureClass).toBe("auth_invalid");
    expect(classifyGatewayFailure({ legacyCode: "timeout" }).failureClass).toBe("network_timeout");
  });

  test("message-only signals still classify", () => {
    expect(classifyGatewayFailure({ error: new Error("Invalid API key provided") }).failureClass).toBe("auth_invalid");
    expect(classifyGatewayFailure({ error: new Error("request timed out") }).failureClass).toBe("network_timeout");
    expect(classifyGatewayFailure({ error: new Error("Unexpected end of JSON input") }).failureClass).toBe("protocol_error");
  });

  test("policy table: auth never retries or hops; budget only falls back cheaper; content never hops", () => {
    const auth = FAILURE_BEHAVIORS.auth_invalid;
    expect(auth.retrySameRoute).toBe("no");
    expect(auth.fallbackAllowed).toBe(false);
    expect(auth.quarantineRoute).toBe(true);

    const budget = FAILURE_BEHAVIORS.budget_blocked;
    expect(budget.cheaperFallbackOnly).toBe(true);
    expect(budget.fallbackAllowed).toBe(true);

    expect(FAILURE_BEHAVIORS.content_rejected.fallbackAllowed).toBe(false);
    expect(FAILURE_BEHAVIORS.quota_exhausted.cooldownUntilReset).toBe(true);
    expect(FAILURE_BEHAVIORS.rate_limited.reasonCode).toBe("FALLBACK_RATE_LIMIT");
  });
});

// ---------------------------------------------------------------------------
// Connection state machine
// ---------------------------------------------------------------------------

describe("Phase 20.51 — connection state machine", () => {
  function makeStore(): { store: ConnectionStore; events: GatewayEventRecord[] } {
    const events: GatewayEventRecord[] = [];
    const store = new ConnectionStore({ onEvent: e => events.push(e) });
    return { store, events };
  }

  test("success promotes unknown to healthy", () => {
    const { store } = makeStore();
    expect(store.get("p/m").state).toBe("unknown");
    store.recordSuccess("p/m");
    expect(store.get("p/m").state).toBe("healthy");
  });

  test("transient ladder: healthy -> degraded -> cooldown", () => {
    const { store } = makeStore();
    store.recordSuccess("p/m");
    store.recordFailure("p/m", { kind: "transient", failureClass: "provider_unavailable" });
    expect(store.get("p/m").state).toBe("degraded");
    store.recordFailure("p/m", { kind: "transient", failureClass: "provider_unavailable" });
    store.recordFailure("p/m", { kind: "transient", failureClass: "provider_unavailable" });
    expect(store.get("p/m").state).toBe("cooldown");
  });

  test("rate limit enters cooldown immediately with its own reason code", () => {
    const { store, events } = makeStore();
    store.recordSuccess("p/m");
    store.recordFailure("p/m", { kind: "rate_limit", failureClass: "rate_limited" });
    expect(store.get("p/m").state).toBe("cooldown");
    expect(events.some(e => e.reasonCode === "CB_RATE_LIMIT")).toBe(true);
  });

  test("quota exhaustion cools down until slightly past a known reset", () => {
    const { store } = makeStore();
    const resetAt = new Date(Date.now() + 120_000).toISOString();
    store.recordSuccess("p/m");
    store.recordFailure("p/m", { kind: "quota_exhausted", failureClass: "quota_exhausted", resetAt });
    const record = store.get("p/m");
    expect(record.state).toBe("cooldown");
    const remaining = (record.cooldownUntil ?? 0) - Date.now();
    // ~120s reset + 30s guard, bounded below the 30min cap.
    expect(remaining).toBeGreaterThan(100_000);
    expect(remaining).toBeLessThanOrEqual(150_000);
  });

  test("auth failures quarantine the route", () => {
    const { store, events } = makeStore();
    store.recordSuccess("p/m");
    store.recordFailure("p/m", { kind: "permanent", failureClass: "auth_invalid" });
    expect(store.get("p/m").state).toBe("quarantined");
    expect(events.some(e => e.reasonCode === "CONNECTION_QUARANTINED_AUTH_INVALID")).toBe(true);
  });

  test("cooldown routes become probeable once due; two probes restore healthy", () => {
    const { store } = makeStore();
    store.recordSuccess("p/m");
    // Quota reset in the past -> cooldown expires immediately.
    store.recordFailure("p/m", {
      kind: "quota_exhausted",
      failureClass: "quota_exhausted",
      resetAt: new Date(Date.now() - 61_000).toISOString(),
    });
    expect(store.probeDue()).toContain("p/m");
    store.recordProbe("p/m", true);
    expect(store.get("p/m").state).toBe("recovering");
    store.recordProbe("p/m", true);
    expect(store.get("p/m").state).toBe("healthy");
  });

  test("a failed probe re-enters cooldown", () => {
    const { store } = makeStore();
    store.recordSuccess("p/m");
    store.recordFailure("p/m", {
      kind: "quota_exhausted",
      failureClass: "quota_exhausted",
      resetAt: new Date(Date.now() - 61_000).toISOString(),
    });
    store.recordProbe("p/m", false, "provider_unavailable");
    expect(store.get("p/m").state).toBe("cooldown");
  });

  test("operator actions: quarantine, disable, and recovery request", () => {
    const { store } = makeStore();
    store.quarantine("p/m", "auth_invalid", "CONNECTION_QUARANTINED_AUTH");
    expect(store.get("p/m").state).toBe("quarantined");
    store.beginRecovery("p/m");
    expect(store.get("p/m").state).toBe("recovering");
    store.disable("p/m");
    expect(store.get("p/m").state).toBe("disabled");
    expect(store.probeDue()).not.toContain("p/m");
  });

  test("quarantined routes are never probeable", () => {
    const { store } = makeStore();
    store.quarantine("p/m", "auth_invalid", "CONNECTION_QUARANTINED_AUTH");
    expect(store.probeDue()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Recovery worker
// ---------------------------------------------------------------------------

describe("Phase 20.51 — recovery worker", () => {
  test("probes due cooldown routes and restores them after repeated success", async () => {
    const events: GatewayEventRecord[] = [];
    const store = new ConnectionStore({ onEvent: e => events.push(e) });
    store.recordSuccess("p/m");
    store.recordFailure("p/m", {
      kind: "quota_exhausted",
      failureClass: "quota_exhausted",
      resetAt: new Date(Date.now() - 61_000).toISOString(),
    });
    expect(store.get("p/m").state).toBe("cooldown");

    let probes = 0;
    const worker = startRecoveryWorker(
      {
        connections: store,
        probe: async () => {
          probes += 1;
          return true;
        },
      },
      { intervalMs: 20, jitter: 0, onEvent: e => events.push(e) },
    );

    try {
      // Two probe cycles at ~20ms each; allow generous wall-clock slack.
      for (let i = 0; i < 100 && store.get("p/m").state !== "healthy"; i++) {
        await sleep(10);
      }
      expect(probes).toBeGreaterThanOrEqual(2);
      expect(store.get("p/m").state).toBe("healthy");
      expect(events.some(e => e.reasonCode === "RECOVERY_PROBE_SUCCESS")).toBe(true);
    } finally {
      worker.stop();
    }
  });

  test("a failing probe keeps the route cooling down", async () => {
    const store = new ConnectionStore();
    store.recordSuccess("p/m");
    store.recordFailure("p/m", {
      kind: "quota_exhausted",
      failureClass: "quota_exhausted",
      resetAt: new Date(Date.now() - 61_000).toISOString(),
    });

    const worker = startRecoveryWorker(
      {
        connections: store,
        probe: async () => false,
      },
      { intervalMs: 20, jitter: 0 },
    );

    try {
      await sleep(80);
      expect(store.get("p/m").state).toBe("cooldown");
    } finally {
      worker.stop();
    }
  });
});
