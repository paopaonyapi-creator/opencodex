/**
 * Phase 20.85 — Model Gateway Test Suite
 * Tests capability routing, budget governance, cumulative retry accounting,
 * local-only enforcement, circuit breaking, and kill switch.
 */

import { describe, expect, it } from "bun:test";
import { PaoModelGateway } from "../src/agent-os/model-gateway/gateway";
import { LocalOnlyViolationError, PolicyViolationError } from "../src/agent-os/model-gateway/envelope";
import { BudgetPolicyError } from "../src/agent-os/model-gateway/budget";
import type { GatewayRequest } from "../src/agent-os/model-gateway/types";

describe("Phase 20.85 — Pao-hubPro Model Gateway", () => {
  it("executes valid request within approved route group successfully", async () => {
    const gateway = new PaoModelGateway({ omnirouteEnabled: false });

    const request: GatewayRequest = {
      requestId: "req_test_01",
      actorId: "actor_tester",
      taskType: "coding",
      prompt: "Implement binary search in TypeScript",
      capabilityRequirements: ["coding"],
      policy: {
        routeGroup: "coding-cheap",
      },
    };

    const response = await gateway.execute(request);

    expect(response.requestId).toBe("req_test_01");
    expect(response.output).toContain("deepseek/deepseek-coder");
    expect(response.routing.resolvedProvider).toBe("deepseek");
    expect(response.routing.resolvedModelFamily).toBe("deepseek");
    expect(response.usage.totalTaskCostUsd).toBeGreaterThanOrEqual(0);
    expect(response.usage.pricingStatus).toBe("known");
  });

  it("enforces local-only guarantee and throws LocalOnlyViolationError if no local model available", async () => {
    const gateway = new PaoModelGateway({ omnirouteEnabled: false });

    // coding-high has only cloud candidates (claude-3-7-sonnet, gpt-4o, deepseek-coder)
    const request: GatewayRequest = {
      requestId: "req_local_fail",
      actorId: "actor_tester",
      taskType: "coding",
      prompt: "Confidential code",
      capabilityRequirements: ["coding"],
      policy: {
        routeGroup: "coding-high",
        localOnly: true, // STRICT LOCAL ONLY
      },
    };

    expect(gateway.execute(request)).rejects.toThrow(LocalOnlyViolationError);
  });

  it("automatically forces localOnly when dataClass is restricted", async () => {
    const gateway = new PaoModelGateway({ omnirouteEnabled: false });

    const request: GatewayRequest = {
      requestId: "req_restricted_fail",
      actorId: "actor_tester",
      taskType: "coding",
      prompt: "Ultra secret database keys",
      capabilityRequirements: ["coding"],
      policy: {
        routeGroup: "coding-high",
        dataClass: "restricted", // MUST FORCE LOCAL ONLY
      },
    };

    expect(gateway.execute(request)).rejects.toThrow(LocalOnlyViolationError);
  });

  it("routes private-local group to verified local model", async () => {
    const gateway = new PaoModelGateway({ omnirouteEnabled: false });

    const request: GatewayRequest = {
      requestId: "req_local_success",
      actorId: "actor_tester",
      taskType: "coding",
      prompt: "Local private task",
      capabilityRequirements: ["coding"],
      policy: {
        routeGroup: "private-local",
        localOnly: true,
      },
    };

    const response = await gateway.execute(request);

    expect(response.routing.isLocal).toBe(true);
    expect(response.routing.resolvedProvider).toBe("ollama");
    expect(response.usage.totalTaskCostUsd).toBe(0.0); // Local models are cost free
    expect(response.governance.localOnly).toBe(true);
  });

  it("enforces hard budget ceilings and preflight checks", async () => {
    const gateway = new PaoModelGateway({ omnirouteEnabled: false });

    const request: GatewayRequest = {
      requestId: "req_budget_exceeded",
      actorId: "actor_tester",
      taskType: "coding",
      prompt: "Very expensive task",
      capabilityRequirements: ["coding"],
      policy: {
        routeGroup: "coding-high",
      },
      budget: {
        maxCostUsd: 0.0001, // Extremely low budget ceiling
      },
    };

    expect(gateway.execute(request)).rejects.toThrow(BudgetPolicyError);
  });

  it("denies unknown pricing models by default (zero-zero invariant)", async () => {
    const gateway = new PaoModelGateway({ omnirouteEnabled: false });

    // Register a mock model with unknown pricing
    gateway.registry.registerModel({
      id: "unknown/mystery-model",
      providerId: "mystery",
      modelName: "mystery-model",
      modelFamily: "mystery",
      capabilities: ["text.chat", "coding"],
      contextWindow: 32000,
      isLocal: false,
      pricing: { inputPerMillion: 0, outputPerMillion: 0, status: "unknown" },
      status: "approved",
    });

    gateway.registry.registerRouteGroup({
      routeGroup: "mystery-route",
      policyType: "quality_first",
      candidates: ["unknown/mystery-model"],
      requiredCapabilities: ["coding"],
    });

    const request: GatewayRequest = {
      requestId: "req_unknown_price",
      actorId: "actor_tester",
      taskType: "coding",
      prompt: "Run mystery",
      capabilityRequirements: ["coding"],
      policy: {
        routeGroup: "mystery-route",
        unknownPriceBehavior: "deny",
      },
    };

    expect(gateway.execute(request)).rejects.toThrow(PolicyViolationError);
  });

  it("tracks cumulative retry/failover cost across attempts", async () => {
    const gateway = new PaoModelGateway({ omnirouteEnabled: false });

    // Simulate circuit failure on candidate 1 to force fallback to candidate 2
    gateway.circuitBreaker.recordFailure("anthropic");
    gateway.circuitBreaker.recordFailure("anthropic");
    gateway.circuitBreaker.recordFailure("anthropic"); // Circuit is now OPEN for anthropic

    const request: GatewayRequest = {
      requestId: "req_fallback_test",
      actorId: "actor_tester",
      taskType: "coding",
      prompt: "Review diff",
      capabilityRequirements: ["coding", "structured_output"],
      policy: {
        routeGroup: "coding-high", // candidate 1: claude-3-7-sonnet (open), candidate 2: gpt-4o
      },
    };

    const response = await gateway.execute(request);

    expect(response.routing.resolvedProvider).toBe("openai");
    expect(response.routing.attempts.length).toBeGreaterThanOrEqual(2);
    expect(response.routing.attempts[0].status).toBe("failed");
    expect(response.routing.attempts[1].status).toBe("success");
    expect(response.usage.totalTaskCostUsd).toBeGreaterThanOrEqual(
      response.usage.finalAttemptCostUsd,
    );
  });

  it("respects kill switch and returns direct adapter health", async () => {
    const gateway = new PaoModelGateway({ omnirouteEnabled: true });
    expect(gateway.isOmniRouteEnabled()).toBe(true);

    gateway.setOmniRouteEnabled(false);
    expect(gateway.isOmniRouteEnabled()).toBe(false);

    const health = await gateway.health();
    expect(health.activeAdapter).toBe("direct");
    expect(health.omnirouteConnected).toBe(false);
  });
});
