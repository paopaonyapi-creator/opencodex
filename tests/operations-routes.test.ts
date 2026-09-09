import { describe, expect, test } from "bun:test";
import { handleOperationsRoutes } from "../src/server/management/operations-routes";
import type { ManagementContext } from "../src/server/management/context";

function makeCtx(path: string, method = "GET", body?: unknown): ManagementContext {
  const url = new URL(`http://localhost:10100${path}`);
  const req = new Request(url.toString(), {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    url,
    req,
    session: null,
    runtimeConfig: null as never,
    requestEpoch: 1,
  };
}

describe("Phase 23 — Operations Management API Routes", () => {
  let registeredNodeId = "";
  let createdJobId = "";

  test("GET /api/agent-os/operations/fleet returns fleet nodes", async () => {
    const ctx = makeCtx("/api/agent-os/operations/fleet", "GET");
    const res = await handleOperationsRoutes(ctx);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);

    const data = (await res?.json()) as { nodes: Array<{ id: string }> };
    expect(Array.isArray(data.nodes)).toBe(true);
    expect(data.nodes.some((n) => n.id === "node-local-primary")).toBe(true);
  });

  test("POST /api/agent-os/operations/fleet/register registers new node", async () => {
    const ctx = makeCtx("/api/agent-os/operations/fleet/register", "POST", {
      name: "Cloud Burst Node 01",
      nodeType: "cloud_vm",
      capabilities: ["bulk_inference", "image_upscale"],
      maxConcurrency: 8,
    });

    const res = await handleOperationsRoutes(ctx);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(201);

    const data = (await res?.json()) as { node: { id: string; name: string } };
    expect(data.node.id).toBeDefined();
    expect(data.node.name).toBe("Cloud Burst Node 01");
    registeredNodeId = data.node.id;
  });

  test("POST /api/agent-os/operations/fleet/:id/heartbeat records heartbeat", async () => {
    const ctx = makeCtx(`/api/agent-os/operations/fleet/${registeredNodeId}/heartbeat`, "POST", {
      latencyMs: 18,
      cpuLoadPercent: 35,
    });

    const res = await handleOperationsRoutes(ctx);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);

    const data = (await res?.json()) as { node: { latencyMs: number; cpuLoadPercent: number } };
    expect(data.node.latencyMs).toBe(18);
    expect(data.node.cpuLoadPercent).toBe(35);
  });

  test("POST /api/agent-os/operations/fleet/:id/drain marks node draining", async () => {
    const ctx = makeCtx(`/api/agent-os/operations/fleet/${registeredNodeId}/drain`, "POST");
    const res = await handleOperationsRoutes(ctx);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);

    const data = (await res?.json()) as { node: { status: string } };
    expect(data.node.status).toBe("draining");
  });

  test("POST /api/agent-os/operations/jobs creates and auto-dispatches job", async () => {
    const ctx = makeCtx("/api/agent-os/operations/jobs", "POST", {
      taskType: "browser_audit",
      priority: "P1",
      payload: { url: "https://example.com" },
      requiredCapabilities: ["browser_control"],
    });

    const res = await handleOperationsRoutes(ctx);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(201);

    const data = (await res?.json()) as { job: { id: string; status: string }; dispatched: boolean };
    expect(data.job.id).toBeDefined();
    expect(data.dispatched).toBe(true);
    createdJobId = data.job.id;
  });

  test("POST /api/agent-os/operations/jobs/:id/checkpoint updates checkpoint", async () => {
    const ctx = makeCtx(`/api/agent-os/operations/jobs/${createdJobId}/checkpoint`, "POST", {
      step: "dom_rendered",
      nodesFound: 14,
    });

    const res = await handleOperationsRoutes(ctx);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);

    const data = (await res?.json()) as { job: { status: string; checkpointData: { step: string } } };
    expect(data.job.status).toBe("running");
    expect(data.job.checkpointData.step).toBe("dom_rendered");
  });

  test("POST /api/agent-os/operations/jobs/:id/complete completes job", async () => {
    const ctx = makeCtx(`/api/agent-os/operations/jobs/${createdJobId}/complete`, "POST");
    const res = await handleOperationsRoutes(ctx);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);

    const data = (await res?.json()) as { job: { status: string } };
    expect(data.job.status).toBe("completed");
  });

  test("GET /api/agent-os/operations/slo returns SLO metrics", async () => {
    const ctx = makeCtx("/api/agent-os/operations/slo", "GET");
    const res = await handleOperationsRoutes(ctx);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);

    const data = (await res?.json()) as { metrics: { targetAvailabilityPercent: number } };
    expect(data.metrics.targetAvailabilityPercent).toBe(99.9);
  });

  test("POST /api/agent-os/operations/failover/trigger executes failover", async () => {
    const ctx = makeCtx("/api/agent-os/operations/failover/trigger", "POST", {
      nodeId: registeredNodeId,
      reason: "Test failover simulation",
    });

    const res = await handleOperationsRoutes(ctx);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);

    const data = (await res?.json()) as { event: { failedNodeId: string } };
    expect(data.event.failedNodeId).toBe(registeredNodeId);
  });

  test("POST and GET /api/agent-os/operations/swarm/* manages swarm messaging", async () => {
    const pubCtx = makeCtx("/api/agent-os/operations/swarm/publish", "POST", {
      topic: "sdlc_event",
      senderAgentId: "test-agent",
      payload: { action: "code_verified" },
    });
    const pubRes = await handleOperationsRoutes(pubCtx);
    expect(pubRes?.status).toBe(201);

    const getCtx = makeCtx("/api/agent-os/operations/swarm/messages?topic=sdlc_event", "GET");
    const getRes = await handleOperationsRoutes(getCtx);
    expect(getRes?.status).toBe(200);

    const data = (await getRes?.json()) as { messages: Array<{ topic: string; senderAgentId: string }> };
    expect(data.messages.some((m) => m.topic === "sdlc_event" && m.senderAgentId === "test-agent")).toBe(true);
  });

  test("returns 404 for unknown operations route", async () => {
    const ctx = makeCtx("/api/agent-os/operations/nonexistent_path", "GET");
    const res = await handleOperationsRoutes(ctx);
    expect(res?.status).toBe(404);
  });
});
