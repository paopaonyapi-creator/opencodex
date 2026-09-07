// Phase 20 — Compute & RunPod management API routes tests.

import { afterEach, beforeEach, describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeAgentOsDbForTests, openAgentOsDb } from "../src/agent-os/db";
import { handleGenerationRoutes } from "../src/server/management/generation-routes";
import type { ManagementContext } from "../src/server/management/context";
import { MockRunPodServer } from "../src/agent-os/generation/cloud/runpod/mock";
import { resetGenerationOrchestratorForTests, GenerationOrchestrator } from "../src/agent-os/generation/orchestrator";
import { ensureBuiltInWorkflows } from "../src/agent-os/generation/registry";

let tempDir = "";
let storageRoot = "";
let mockRunPod: MockRunPodServer;
let mockRunPodUrl = "";

beforeAll(async () => {
  mockRunPod = new MockRunPodServer({ validApiKey: "routes_test_api_key_789" });
  mockRunPodUrl = await mockRunPod.start();
});

afterAll(() => {
  mockRunPod.stop();
});

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gen-compute-routes-test-"));
  storageRoot = join(tempDir, "storage");
  process.env.PAO_GENERATION_STORAGE_PATH = storageRoot;
  process.env.PAO_GENERATION_TEMP_PATH = join(tempDir, "tmp");
  process.env.PAO_RUNPOD_ENABLED = "true";
  process.env.PAO_RUNPOD_API_KEY = "routes_test_api_key_789";
  process.env.PAO_RUNPOD_API_BASE_URL = mockRunPodUrl;

  openAgentOsDb(tempDir);
  ensureBuiltInWorkflows();
});

afterEach(() => {
  closeAgentOsDbForTests();
  resetGenerationOrchestratorForTests();
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

function mockCtx(
  path: string,
  method = "GET",
  body?: unknown,
  principal: unknown = { role: "admin", isLoopback: true },
): ManagementContext {
  const url = new URL(`http://127.0.0.1:4000${path}`);
  const req = new Request(url.toString(), {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { url, req, config: {} as never, principal: principal as never, deps: {} as never };
}

describe("phase 20 — compute and runpod management API routes", () => {
  test("GET /api/generation/compute/providers returns local and cloud providers", async () => {
    const res = await handleGenerationRoutes(mockCtx("/api/generation/compute/providers"));
    expect(res?.status).toBe(200);
    const data = await res!.json() as { providers: Array<{ id: string; type: string }> };
    expect(data.providers.length).toBeGreaterThanOrEqual(2);
    expect(data.providers.some(p => p.id === "comfyui-local")).toBe(true);
    expect(data.providers.some(p => p.id === "runpod")).toBe(true);
  });

  test("GET /api/generation/compute/capacity returns aggregated metrics", async () => {
    const res = await handleGenerationRoutes(mockCtx("/api/generation/compute/capacity"));
    expect(res?.status).toBe(200);
    const data = await res!.json() as {
      local: { vramGb: number; queueDepth: number };
      cloud: { enabled: boolean; maxActivePods: number };
      activeHourlyBurn: number;
    };
    expect(data.local.vramGb).toBeGreaterThanOrEqual(12);
    expect(data.cloud.enabled).toBe(true);
    expect(data.cloud.maxActivePods).toBeGreaterThan(0);
  });

  test("POST /api/generation/compute/route-preview previews placement without creating jobs", async () => {
    const body = {
      jobType: "text_to_video",
      width: 1920,
      height: 1080,
      batchSize: 1,
      routingMode: "AUTO",
    };
    const res = await handleGenerationRoutes(mockCtx("/api/generation/compute/route-preview", "POST", body));
    expect(res?.status).toBe(200);
    const data = await res!.json() as {
      requirements: { minVramGb: number; workloadClass: string };
      decision: { selectedProvider: string; decisionScore: number };
      candidateScores: unknown[];
    };
    expect(data.requirements.minVramGb).toBeGreaterThanOrEqual(16);
    expect(data.decision.selectedProvider).toBeDefined();
    expect(data.candidateScores.length).toBeGreaterThan(0);
  });

  test("runpod pods lifecycle via API: list, provision, inspect, stop, start, drain, and terminate", async () => {
    // 1. List initially empty
    const listRes1 = await handleGenerationRoutes(mockCtx("/api/generation/runpod/pods"));
    expect(listRes1?.status).toBe(200);
    const list1 = await listRes1!.json() as { pods: unknown[] };
    expect(list1.pods.length).toBe(0);

    // 2. Provision new pod
    const provRes = await handleGenerationRoutes(mockCtx("/api/generation/runpod/pods", "POST", {
      gpuType: "NVIDIA GeForce RTX 4090",
      hourlyPrice: 0.74,
    }));
    expect(provRes?.status).toBe(201);
    const provData = await provRes!.json() as { pod: { id: string; runpodPodId: string; actualState: string } };
    const podId = provData.pod.runpodPodId;
    expect(podId).toBeDefined();

    // 3. Inspect pod
    const getRes = await handleGenerationRoutes(mockCtx(`/api/generation/runpod/pods/${podId}`));
    expect(getRes?.status).toBe(200);
    const getData = await getRes!.json() as { pod: { runpodPodId: string } };
    expect(getData.pod.runpodPodId).toBe(podId);

    // 4. Stop pod
    const stopRes = await handleGenerationRoutes(mockCtx(`/api/generation/runpod/pods/${podId}/stop`, "POST"));
    expect(stopRes?.status).toBe(200);
    const stopData = await stopRes!.json() as { ok: boolean; pod: { actualState: string } };
    expect(stopData.ok).toBe(true);
    expect(stopData.pod.actualState).toBe("stopped");

    // 5. Start pod
    const startRes = await handleGenerationRoutes(mockCtx(`/api/generation/runpod/pods/${podId}/start`, "POST"));
    expect(startRes?.status).toBe(200);
    const startData = await startRes!.json() as { ok: boolean; pod: { actualState: string } };
    expect(startData.ok).toBe(true);
    expect(startData.pod.actualState).toBe("ready");

    // 6. Drain pod
    const drainRes = await handleGenerationRoutes(mockCtx(`/api/generation/runpod/pods/${podId}/drain`, "POST"));
    expect(drainRes?.status).toBe(200);

    // 7. Terminate pod
    const delRes = await handleGenerationRoutes(mockCtx(`/api/generation/runpod/pods/${podId}`, "DELETE"));
    expect(delRes?.status).toBe(200);
  });

  test("templates API returns reference template and validates compatibility", async () => {
    const listRes = await handleGenerationRoutes(mockCtx("/api/generation/runpod/templates"));
    expect(listRes?.status).toBe(200);
    const data = await listRes!.json() as { templates: Array<{ id: string }> };
    expect(data.templates.some(t => t.id === "hs44di56w7")).toBe(true);

    const valRes = await handleGenerationRoutes(mockCtx("/api/generation/runpod/templates/hs44di56w7/validate"));
    expect(valRes?.status).toBe(200);
    const valData = await valRes!.json() as { valid: boolean; checks: Record<string, boolean> };
    expect(valData.valid).toBe(true);
  });

  test("cost, billing, and settings endpoints operate correctly", async () => {
    // 1. Cost endpoint
    const costRes = await handleGenerationRoutes(mockCtx("/api/generation/runpod/cost"));
    expect(costRes?.status).toBe(200);
    const costData = await costRes!.json() as { finOps: { dailyBudget: number } };
    expect(costData.finOps.dailyBudget).toBeGreaterThan(0);

    // 2. Billing endpoint
    const billRes = await handleGenerationRoutes(mockCtx("/api/generation/runpod/billing"));
    expect(billRes?.status).toBe(200);
    const billData = await billRes!.json() as { entries: unknown[] };
    expect(Array.isArray(billData.entries)).toBe(true);

    // 3. Settings GET
    const setGetRes = await handleGenerationRoutes(mockCtx("/api/generation/runpod/settings"));
    expect(setGetRes?.status).toBe(200);
    const setData = await setGetRes!.json() as { dailyBudget: number };
    expect(setData.dailyBudget).toBeDefined();

    // 4. Settings POST (update limit)
    const setPostRes = await handleGenerationRoutes(mockCtx("/api/generation/runpod/settings", "POST", {
      dailyBudget: 75.00,
      maxHourlyGpuPrice: 1.50,
      preferLocal: false,
    }));
    expect(setPostRes?.status).toBe(200);
    const updated = await setPostRes!.json() as { updatedSettings: { dailyBudget: number; preferLocal: boolean } };
    expect(updated.updatedSettings.dailyBudget).toBe(75.00);
    expect(updated.updatedSettings.preferLocal).toBe(false);
  });

  test("emergency-stop halts managed pods", async () => {
    const res = await handleGenerationRoutes(mockCtx("/api/generation/runpod/emergency-stop", "POST"));
    expect(res?.status).toBe(200);
    const data = await res!.json() as { ok: boolean; stoppedPods: number };
    expect(data.ok).toBe(true);
  });

  test("unauthorized principal cannot mutate compute or cloud resources", async () => {
    const readerCtx = mockCtx(
      "/api/generation/runpod/pods",
      "POST",
      { gpuType: "NVIDIA RTX 4090" },
      { role: "viewer", isLoopback: true }, // viewer is not admin, reviewer, or creator
    );
    const res = await handleGenerationRoutes(readerCtx);
    expect(res?.status).toBe(403);
  });
});
