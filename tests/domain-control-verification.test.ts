import { describe, expect, test } from "bun:test";
import {
  assertHealthy,
  assertPropagated,
  normalizeValue,
  verifyHttpHealth,
  verifyPropagation,
  verifyTls,
  type ResolveFn,
} from "../src/agent-os/domain-control/verification";
import { DomainControlError } from "../src/agent-os/domain-control/types";

/** Scripted resolver: resolver -> list of answers, one consumed per call. */
function scriptedResolver(script: Record<string, string[][]>): {
  fn: ResolveFn;
  calls: { resolver: string; type: string }[];
} {
  const state: Record<string, number> = {};
  const calls: { resolver: string; type: string }[] = [];
  const fn: ResolveFn = async (_hostname, type, resolver) => {
    calls.push({ resolver, type });
    const idx = state[resolver] ?? 0;
    const answers = script[resolver] ?? [];
    state[resolver] = idx + 1;
    return { resolver, values: answers[Math.min(idx, answers.length - 1)] ?? [] };
  };
  return { fn, calls };
}

const noSleep = async (): Promise<void> => {};

describe("Phase 20.15 — DNS propagation verification", () => {
  test("verifies once every resolver reports the expected value", async () => {
    const { fn } = scriptedResolver({
      "1.1.1.1": [["203.0.113.10"]],
      "8.8.8.8": [["203.0.113.10"]],
    });
    const result = await verifyPropagation(
      {
        hostname: "dev.example.com",
        type: "A",
        expected: ["203.0.113.10"],
        resolvers: ["1.1.1.1", "8.8.8.8"],
        timeoutMs: 100,
        intervalMs: 1,
        sleep: noSleep,
      },
      fn,
    );
    expect(result.status).toBe("verified");
    expect(result.results["1.1.1.1"]).toContain("203.0.113.10");
    expect(result.results["8.8.8.8"]).toContain("203.0.113.10");
  });

  test("keeps polling until a lagging resolver catches up", async () => {
    // Bounded retry rather than one look: the second resolver only answers on the
    // third attempt, which is exactly the real propagation case.
    const { fn, calls } = scriptedResolver({
      "1.1.1.1": [["203.0.113.10"]],
      "8.8.8.8": [[], [], ["203.0.113.10"]],
    });
    const result = await verifyPropagation(
      {
        hostname: "dev.example.com",
        type: "A",
        expected: ["203.0.113.10"],
        resolvers: ["1.1.1.1", "8.8.8.8"],
        timeoutMs: 5000,
        intervalMs: 1,
        sleep: noSleep,
      },
      fn,
    );
    expect(result.status).toBe("verified");
    expect(result.attempts).toBeGreaterThanOrEqual(3);
    expect(calls.length).toBeGreaterThan(3);
  });

  test("reports a mismatch when a resolver answers with something else", async () => {
    const { fn } = scriptedResolver({
      "1.1.1.1": [["198.51.100.1"]],
      "8.8.8.8": [["198.51.100.1"]],
    });
    const result = await verifyPropagation(
      {
        hostname: "dev.example.com",
        type: "A",
        expected: ["203.0.113.10"],
        resolvers: ["1.1.1.1", "8.8.8.8"],
        timeoutMs: 0,
        intervalMs: 1,
        sleep: noSleep,
      },
      fn,
    );
    expect(result.status).toBe("mismatch");
    // The observed value is reported so an operator can see what is actually live.
    expect(result.results["1.1.1.1"]).toContain("198.51.100.1");
  });

  test("reports a timeout when no resolver has an answer yet", async () => {
    const { fn } = scriptedResolver({ "1.1.1.1": [[]], "8.8.8.8": [[]] });
    const result = await verifyPropagation(
      {
        hostname: "dev.example.com",
        type: "A",
        expected: ["203.0.113.10"],
        resolvers: ["1.1.1.1", "8.8.8.8"],
        timeoutMs: 0,
        intervalMs: 1,
        sleep: noSleep,
      },
      fn,
    );
    expect(result.status).toBe("timeout");
    expect(result.attempts).toBeGreaterThanOrEqual(1);
  });

  test("a thrown resolver error is not recorded as an observed value", async () => {
    const fn: ResolveFn = async (_h, _t, resolver) => {
      if (resolver === "8.8.8.8") throw new Error("SERVFAIL");
      return { resolver, values: ["203.0.113.10"] };
    };
    const result = await verifyPropagation(
      {
        hostname: "dev.example.com",
        type: "A",
        expected: ["203.0.113.10"],
        resolvers: ["1.1.1.1", "8.8.8.8"],
        timeoutMs: 0,
        intervalMs: 1,
        sleep: noSleep,
      },
      fn,
    );
    expect(result.status).toBe("timeout");
    expect(result.results["8.8.8.8"]).toBe("");
  });

  test("normalizes quotes, case, and trailing dots before comparing", () => {
    expect(normalizeValue('"Example.COM."')).toBe("example.com");
    expect(normalizeValue(" 203.0.113.10 ")).toBe("203.0.113.10");
  });

  test("assertPropagated raises DNS_VERIFY_TIMEOUT on timeout and RECORD_CONFLICT on mismatch", () => {
    try {
      assertPropagated({ status: "timeout", expected: "1.1.1.1", results: {}, attempts: 3, elapsedMs: 10 });
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as DomainControlError).code).toBe("DNS_VERIFY_TIMEOUT");
    }
    try {
      assertPropagated({ status: "mismatch", expected: "1.1.1.1", results: {}, attempts: 1, elapsedMs: 1 });
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as DomainControlError).code).toBe("RECORD_CONFLICT");
    }
  });
});

describe("Phase 20.15 — TLS and HTTP health verification", () => {
  test("TLS verification reports the certificate and remaining days", async () => {
    const validTo = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const result = await verifyTls("dev.example.com", async () => ({
      ok: true,
      issuer: "Let's Encrypt",
      validTo,
    }));
    expect(result.ok).toBe(true);
    expect(result.issuer).toBe("Let's Encrypt");
    expect(result.daysRemaining).toBeGreaterThan(28);
  });

  test("a throwing TLS probe becomes an honest failure, not an exception", async () => {
    const result = await verifyTls("dev.example.com", async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });

  test("HTTP health accepts 2xx and 3xx and rejects 4xx and 5xx", async () => {
    const ok = await verifyHttpHealth("https://dev.example.com/health", async () => ({
      status: 200,
      latencyMs: 12,
    }));
    expect(ok.ok).toBe(true);

    const redirect = await verifyHttpHealth("https://dev.example.com/health", async () => ({
      status: 302,
      latencyMs: 12,
    }));
    expect(redirect.ok).toBe(true);

    // A 404 from the origin means the route was never wired: the exact failure this
    // check exists to catch, so it must not be treated as healthy.
    const notFound = await verifyHttpHealth("https://dev.example.com/health", async () => ({
      status: 404,
      latencyMs: 12,
    }));
    expect(notFound.ok).toBe(false);

    const serverError = await verifyHttpHealth("https://dev.example.com/health", async () => ({
      status: 500,
      latencyMs: 12,
    }));
    expect(serverError.ok).toBe(false);
  });

  test("a transport failure becomes HEALTH_CHECK_FAILED with a retry hint", async () => {
    const result = await verifyHttpHealth("https://dev.example.com/health", async () => {
      throw new Error("timeout");
    });
    expect(result.ok).toBe(false);
    try {
      assertHealthy(result);
      throw new Error("expected a throw");
    } catch (error) {
      const typed = error as DomainControlError;
      expect(typed.code).toBe("HEALTH_CHECK_FAILED");
      expect(typed.retryable).toBe(true);
    }
  });
});
