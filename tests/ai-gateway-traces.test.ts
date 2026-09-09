/**
 * Pao AI Gateway — Trace & Usage Ledger Tests.
 *
 * Validates trace recording, retrieval, aggregation, and isolation
 * using a dedicated temporary test directory.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  recordTrace,
  recordAttempt,
  readTraces,
  readTodayTraces,
  aggregateUsage,
} from "../src/ai-gateway/traces/ledger";
import type { GatewayTraceRecord, GatewayAttemptRecord } from "../src/ai-gateway/types";

const TEST_TRACE_DIR = join(process.cwd(), ".tmp", "test-gateway-traces");

describe("Pao AI Gateway — Trace & Ledger", () => {
  beforeAll(() => {
    try {
      rmSync(TEST_TRACE_DIR, { recursive: true, force: true });
    } catch {}
    mkdirSync(TEST_TRACE_DIR, { recursive: true });
  });

  afterAll(() => {
    try {
      rmSync(TEST_TRACE_DIR, { recursive: true, force: true });
    } catch {}
  });

  test("records and reads back daily trace records", () => {
    const today = new Date().toISOString().slice(0, 10);
    const trace1: GatewayTraceRecord = {
      requestId: "req-1",
      timestamp: new Date().toISOString(),
      identityId: "dev-alex",
      alias: "pao-fast",
      selectedProviderId: "mock-openai",
      selectedModelId: "gpt-4o-mini",
      durationMs: 250,
      inputTokens: 100,
      outputTokens: 50,
      estimatedCostUsd: 0.001,
      actualCostUsd: 0.0009,
      status: "success",
      routeDecision: {
        alias: "pao-fast",
        selectedRoute: { modelId: "gpt-4o-mini", priority: 100 },
        selectedModelId: "gpt-4o-mini",
        selectedProviderId: "mock-openai",
        reasons: ["highest_priority"],
        candidatesConsidered: 1,
      },
    };

    const trace2: GatewayTraceRecord = {
      requestId: "req-2",
      timestamp: new Date().toISOString(),
      identityId: "ci-pipeline",
      alias: "pao-code",
      selectedProviderId: "mock-anthropic",
      selectedModelId: "claude-3-5-sonnet",
      durationMs: 820,
      inputTokens: 500,
      outputTokens: 300,
      estimatedCostUsd: 0.005,
      actualCostUsd: 0.0048,
      status: "success",
      routeDecision: {
        alias: "pao-code",
        selectedRoute: { modelId: "claude-3-5-sonnet", priority: 90 },
        selectedModelId: "claude-3-5-sonnet",
        selectedProviderId: "mock-anthropic",
        reasons: ["highest_priority"],
        candidatesConsidered: 2,
      },
    };

    recordTrace(TEST_TRACE_DIR, trace1);
    recordTrace(TEST_TRACE_DIR, trace2);

    const traces = readTraces(TEST_TRACE_DIR, today);
    expect(traces.length).toBe(2);
    expect(traces[0]!.requestId).toBe("req-1");
    expect(traces[1]!.requestId).toBe("req-2");

    const todayTraces = readTodayTraces(TEST_TRACE_DIR);
    expect(todayTraces.length).toBe(2);
  });

  test("records provider attempts without error", () => {
    const attempt: GatewayAttemptRecord = {
      requestId: "req-1",
      attemptNumber: 1,
      providerId: "mock-openai",
      modelId: "gpt-4o-mini",
      status: "success",
      durationMs: 240,
    };

    expect(() => recordAttempt(TEST_TRACE_DIR, attempt)).not.toThrow();
  });

  test("aggregateUsage computes accurate metrics by identity, alias, provider", () => {
    const traces: GatewayTraceRecord[] = [
      {
        requestId: "r1",
        timestamp: "2026-09-09T10:00:00Z",
        identityId: "dev-alex",
        alias: "pao-fast",
        selectedProviderId: "openai",
        selectedModelId: "gpt-4o",
        durationMs: 300,
        inputTokens: 1000,
        outputTokens: 200,
        estimatedCostUsd: 0.01,
        actualCostUsd: 0.009,
        status: "success",
        routeDecision: {
          alias: "pao-fast",
          selectedRoute: { modelId: "gpt-4o", priority: 100 },
          selectedModelId: "gpt-4o",
          selectedProviderId: "openai",
          reasons: [],
          candidatesConsidered: 1,
        },
      },
      {
        requestId: "r2",
        timestamp: "2026-09-09T10:05:00Z",
        identityId: "dev-alex",
        alias: "pao-fast",
        selectedProviderId: "openai",
        selectedModelId: "gpt-4o",
        durationMs: 400,
        inputTokens: 2000,
        outputTokens: 400,
        estimatedCostUsd: 0.02,
        actualCostUsd: 0.018,
        status: "success",
        routeDecision: {
          alias: "pao-fast",
          selectedRoute: { modelId: "gpt-4o", priority: 100 },
          selectedModelId: "gpt-4o",
          selectedProviderId: "openai",
          reasons: [],
          candidatesConsidered: 1,
        },
      },
      {
        requestId: "r3",
        timestamp: "2026-09-09T10:10:00Z",
        identityId: "ci-pipeline",
        alias: "pao-code",
        selectedProviderId: "anthropic",
        selectedModelId: "claude-sonnet",
        durationMs: 500,
        inputTokens: 3000,
        outputTokens: 600,
        estimatedCostUsd: 0.03,
        actualCostUsd: 0.028,
        status: "error",
        routeDecision: {
          alias: "pao-code",
          selectedRoute: { modelId: "claude-sonnet", priority: 100 },
          selectedModelId: "claude-sonnet",
          selectedProviderId: "anthropic",
          reasons: [],
          candidatesConsidered: 1,
        },
      },
    ];

    const summary = aggregateUsage(traces);

    expect(summary.totalRequests).toBe(3);
    expect(summary.totalInputTokens).toBe(6000);
    expect(summary.totalOutputTokens).toBe(1200);
    expect(summary.totalActualCostUsd).toBeCloseTo(0.055, 3);

    // By identity
    expect(summary.byIdentity["dev-alex"]?.requests).toBe(2);
    expect(summary.byIdentity["dev-alex"]?.costUsd).toBeCloseTo(0.027, 3);
    expect(summary.byIdentity["ci-pipeline"]?.requests).toBe(1);

    // By alias
    expect(summary.byAlias["pao-fast"]?.requests).toBe(2);
    expect(summary.byAlias["pao-code"]?.requests).toBe(1);

    // By provider
    expect(summary.byProvider["openai"]?.requests).toBe(2);
    expect(summary.byProvider["anthropic"]?.requests).toBe(1);

    // By status
    expect(summary.byStatus["success"]).toBe(2);
    expect(summary.byStatus["error"]).toBe(1);
  });

  test("returns empty array when reading non-existent date traces", () => {
    const traces = readTraces(TEST_TRACE_DIR, "1999-01-01");
    expect(traces).toEqual([]);
  });
});
