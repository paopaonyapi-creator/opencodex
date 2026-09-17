// Phase 20.82/20.85 — Gateway doctor + OmniRoute fast-fail + Jev readiness.
//
// Deterministic integration tests for the live-validation layer added in the
// Phase 20.82 closeout: `ocx gateway doctor`, the adapter's fast-fail on a
// freshly cached unreachable daemon (with negative-cache propagation and
// recovery), and the staged Jev activation report. All daemons are in-process
// Bun servers on ephemeral ports; no external service, no credentials
// (credential-shaped strings are synthesized at runtime).

import { afterEach, describe, expect, it } from "bun:test";
import { OmniRouteGatewayAdapter, OmniRouteFailure } from "../src/agent-os/model-gateway/adapters/omniroute";
import { CapabilityRegistry } from "../src/agent-os/model-gateway/registry";
import { BudgetGovernanceEngine } from "../src/agent-os/model-gateway/budget";
import { PaoModelGateway } from "../src/agent-os/model-gateway/gateway";
import {
  describeJevIntegration,
  validateJevReadiness,
} from "../src/agent-os/decision/provider-mode";
import { handleModelRouter } from "../src/cli/model-router";
import type { GatewayRequest, PolicyEnvelope } from "../src/agent-os/model-gateway/types";

const FAKE_KEY = "sk-" + "d".repeat(24) + "octor";

function makeRequest(id: string): GatewayRequest {
  return {
    requestId: id,
    actorId: "doctor-suite",
    taskType: "test",
    prompt: "ping",
    policy: { routeGroup: "coding-cheap" },
  } as GatewayRequest;
}

const ENVELOPE = {
  routeGroup: "coding-cheap",
  policyDecisionId: "pol_doctor",
  dataClass: "internal",
  localOnly: false,
  maxAttempts: 3,
  allowFallback: true,
  hardBudgetUsd: 1,
} as unknown as PolicyEnvelope;

interface DaemonState {
  healthzUp: boolean;
  chatUp: boolean;
  chatCalls: number;
  healthCalls: number;
}

/** Ephemeral OmniRoute daemon simulator with independently toggleable endpoints. */
function startDaemon(): { server: ReturnType<typeof Bun.serve>; state: DaemonState; url: () => string } {
  const state: DaemonState = { healthzUp: true, chatUp: true, chatCalls: 0, healthCalls: 0 };
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      const path = new URL(req.url).pathname;
      if (path === "/healthz") {
        state.healthCalls++;
        return state.healthzUp ? new Response("ok") : new Response("down", { status: 503 });
      }
      if (path === "/v1/chat/completions") {
        state.chatCalls++;
        if (!state.chatUp) return new Response("daemon degraded", { status: 503 });
        return Response.json({ choices: [{ message: { content: "pong" } }], usage: { prompt_tokens: 2, completion_tokens: 1 } });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { server, state, url: () => `http://127.0.0.1:${server.port}` };
}

const ENV_KEYS = ["PAO_JEV_PROVIDER", "TYPESAFE_API_KEY", "PAO_OMNIROUTE_RETRY_MAX", "PAO_OMNIROUTE_HEALTH_TTL_MS"];

async function withEnv(values: Record<string, string | undefined>, fn: () => Promise<void> | void): Promise<void> {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe("OmniRoute adapter fast-fail", () => {
  it("skips the network entirely when a fresh cached probe says unreachable", async () => {
    const { server, state, url } = startDaemon();
    try {
      state.healthzUp = false; // daemon is "down" for probing, but /v1/chat would still answer
      const adapter = new OmniRouteGatewayAdapter(new CapabilityRegistry(), new BudgetGovernanceEngine(), {
        baseUrl: url(),
        retryMax: 0,
        healthTtlMs: 60_000,
      });
      await adapter.connectionHealth(true); // populate the cache
      expect(state.chatCalls).toBe(0);

      const outcome = adapter.executeCandidate("anthropic/claude-3-5-haiku", makeRequest("ff1"), ENVELOPE);
      await expect(outcome).rejects.toBeInstanceOf(OmniRouteFailure);
      const err = await outcome.catch((e) => e as OmniRouteFailure);
      expect(err.failureClass).toBe("provider_unavailable");
      expect(err.attempt).toBe(0); // no network attempt was made
      expect(err.message).toContain("known-unreachable");
      expect(state.chatCalls).toBe(0); // fast-failed, never touched the completion endpoint
    } finally {
      server.stop(true);
    }
  });

  it("still attempts for real when fast-fail is disabled", async () => {
    const { server, state, url } = startDaemon();
    try {
      state.healthzUp = false;
      const adapter = new OmniRouteGatewayAdapter(new CapabilityRegistry(), new BudgetGovernanceEngine(), {
        baseUrl: url(),
        retryMax: 0,
        healthTtlMs: 60_000,
        fastFailOnUnreachable: false,
      });
      await adapter.connectionHealth(true);
      const result = await adapter.executeCandidate("anthropic/claude-3-5-haiku", makeRequest("ff2"), ENVELOPE);
      expect(result.output).toBe("pong");
      expect(state.chatCalls).toBe(1);
    } finally {
      server.stop(true);
    }
  });

  it("recovers through the full failure→negative-cache→fast-fail→success cycle", async () => {
    const { server, state, url } = startDaemon();
    try {
      const adapter = new OmniRouteGatewayAdapter(new CapabilityRegistry(), new BudgetGovernanceEngine(), {
        baseUrl: url(),
        retryMax: 0,
        healthTtlMs: 60_000,
      });

      // Healthy phase: success marks the cache connected.
      state.chatUp = true;
      const ok = await adapter.executeCandidate("anthropic/claude-3-5-haiku", makeRequest("c1"), ENVELOPE);
      expect(ok.output).toBe("pong");

      // Daemon dies: the next call attempts (cache said connected), fails,
      // and negative-caches the unreachable state.
      state.chatUp = false;
      state.healthzUp = false;
      const err1 = await adapter.executeCandidate("anthropic/claude-3-5-haiku", makeRequest("c2"), ENVELOPE)
        .catch((e) => e as OmniRouteFailure);
      expect(err1.failureClass).toBe("provider_unavailable");
      expect(err1.attempt).toBe(1);
      const callsAfterFailure = state.chatCalls;

      // Third call fast-fails on the fresh negative cache: no new chat traffic.
      const err2 = await adapter.executeCandidate("anthropic/claude-3-5-haiku", makeRequest("c3"), ENVELOPE)
        .catch((e) => e as OmniRouteFailure);
      expect(err2.message).toContain("known-unreachable");
      expect(state.chatCalls).toBe(callsAfterFailure);

      // Daemon recovers; the TTL is long, so force-refresh restores connectivity.
      state.healthzUp = true;
      state.chatUp = true;
      const health = await adapter.connectionHealth(true);
      expect(health.status).toBe("connected");
      const ok2 = await adapter.executeCandidate("anthropic/claude-3-5-haiku", makeRequest("c4"), ENVELOPE);
      expect(ok2.output).toBe("pong");
    } finally {
      server.stop(true);
    }
  });
});

describe("ocx gateway doctor", () => {
  it("reports a degraded verdict with an unreachable daemon and a staged Jev report — never throws", async () => {
    await withEnv({ PAO_OMNIROUTE_BASE_URL: "http://127.0.0.1:9", PAO_OMNIROUTE_RETRY_MAX: "0" }, async () => {
      const gateway = new PaoModelGateway({ omnirouteEnabled: true });
      const report = await gateway.doctor({});
      expect(report.verdict).toBe("degraded");
      expect(report.omniroute.enabled).toBe(true);
      expect(report.omniroute.connection?.status).toBe("unreachable");
      expect(report.omniroute.liveProbe.attempted).toBe(false); // probe requires a connected daemon
      expect(report.directFallback.available).toBe(true);
      expect(report.jev.mode).toBe("simulated");
      expect(report.jev.checks.length).toBeGreaterThanOrEqual(4);
      expect(report.jev.nextAction).toContain("PAO_JEV_PROVIDER=real");
    });
  });

  it("performs a live one-shot completion round-trip against a connected daemon", async () => {
    const { server, state, url } = startDaemon();
    try {
      await withEnv({ PAO_OMNIROUTE_BASE_URL: url(), PAO_OMNIROUTE_RETRY_MAX: "0" }, async () => {
        const gateway = new PaoModelGateway({ omnirouteEnabled: true });
        const report = await gateway.doctor({ probe: true });
        expect(report.omniroute.connection?.status).toBe("connected");
        expect(report.omniroute.liveProbe.attempted).toBe(true);
        expect(report.omniroute.liveProbe.ok).toBe(true);
        expect(report.omniroute.liveProbe.adapter).toContain("/");
        expect(report.omniroute.liveProbe.error).toBeNull();
        expect(state.chatCalls).toBe(1);
        expect(report.verdict).toBe("ready");
      });
    } finally {
      server.stop(true);
    }
  });

  it("reports a failed live probe as exactly that when the daemon serves healthz but fails completions", async () => {
    const { server, state, url } = startDaemon();
    try {
      state.chatUp = false;
      await withEnv({ PAO_OMNIROUTE_BASE_URL: url(), PAO_OMNIROUTE_RETRY_MAX: "0" }, async () => {
        const gateway = new PaoModelGateway({ omnirouteEnabled: true });
        const report = await gateway.doctor({ probe: true });
        expect(report.omniroute.connection?.status).toBe("connected");
        expect(report.omniroute.liveProbe.attempted).toBe(true);
        expect(report.omniroute.liveProbe.ok).toBe(false);
        expect(report.omniroute.liveProbe.error).toContain("503");
        expect(report.verdict).toBe("degraded");
      });
    } finally {
      server.stop(true);
    }
  });

  it("the CLI doctor subcommand exits 0 with honest degraded output (daemon offline)", async () => {
    await withEnv({ PAO_OMNIROUTE_BASE_URL: "http://127.0.0.1:9" }, async () => {
      const exit = await handleModelRouter(["doctor"]);
      expect(exit).toBe(0);
    });
  });
});

describe("TypeSafe Jev staged readiness report", () => {
  const ENV_KEYS_JEV = ["PAO_JEV_PROVIDER", "TYPESAFE_API_KEY"];
  let saved: Record<string, string | undefined>;

  afterEach(() => {
    for (const [k, v] of Object.entries(saved ?? {})) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    saved = {};
  });

  function isolate(values: Record<string, string | undefined>): void {
    saved = Object.fromEntries(ENV_KEYS_JEV.map((k) => [k, process.env[k]]));
    delete process.env.PAO_JEV_PROVIDER;
    delete process.env.TYPESAFE_API_KEY;
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  it("simulated mode: mode passes, remaining stages are not required, go-live action is named", () => {
    isolate({});
    const report = validateJevReadiness();
    expect(report.mode).toBe("simulated");
    expect(report.checks.find((c) => c.id === "mode")?.status).toBe("pass");
    expect(report.checks.filter((c) => c.status === "not_required")).toHaveLength(3);
    expect(report.nextAction).toContain("PAO_JEV_PROVIDER=real");
  });

  it("real mode without credentials: the credential stage fails with its exact remediation", () => {
    isolate({ PAO_JEV_PROVIDER: "real" });
    const report = validateJevReadiness();
    expect(report.realAvailable).toBe(false);
    expect(report.checks.find((c) => c.id === "credential")?.status).toBe("fail");
    expect(report.nextAction).toContain("TYPESAFE_API_KEY");
    expect(report.checks.find((c) => c.id === "transport")?.detail).toContain("refusing to fake");
  });

  it("real mode with a credential but no schema: the schema stage fails and names bindJevSchema", () => {
    isolate({ PAO_JEV_PROVIDER: "real", TYPESAFE_API_KEY: FAKE_KEY });
    const report = validateJevReadiness();
    expect(report.checks.find((c) => c.id === "credential")?.status).toBe("pass");
    expect(report.checks.find((c) => c.id === "schema")?.status).toBe("fail");
    expect(report.nextAction).toContain("bindJevSchema");
  });

  it("disabled mode: a single honest pass check and no pending action", () => {
    isolate({ PAO_JEV_PROVIDER: "disabled" });
    const report = validateJevReadiness();
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]?.status).toBe("pass");
    expect(report.nextAction).toBeNull();
  });

  it("the report never contains credential material — last-4 hint at most", () => {
    isolate({ PAO_JEV_PROVIDER: "real", TYPESAFE_API_KEY: FAKE_KEY });
    const serialized = JSON.stringify({ report: validateJevReadiness(), describe: describeJevIntegration() });
    expect(serialized).not.toContain(FAKE_KEY);
    expect(serialized).toContain("***ctor");
  });
});
