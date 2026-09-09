import { beforeEach, describe, expect, it } from "bun:test";
import { handleVideoIntelligenceRoutes } from "../src/server/management/video-intelligence-routes";
import { resetVideoJobManager } from "../src/agent-os/video-intelligence";
import type { ManagementContext } from "../src/server/management/context";

function makeContext(path: string, method = "GET", body?: unknown): ManagementContext {
  const url = new URL(`http://127.0.0.1:10100${path}`);
  const reqInit: RequestInit = {
    method,
    headers: {
      Host: url.host,
      "Content-Type": "application/json",
    },
  };
  if (body !== undefined) {
    reqInit.body = JSON.stringify(body);
  }
  const req = new Request(url, reqInit);
  return {
    req,
    url,
    config: {} as any,
    configActions: {} as any,
  };
}

describe("Phase 20.13 — Video Intelligence Management Routes", () => {
  beforeEach(() => {
    resetVideoJobManager();
  });

  it("handles GET /api/agent-os/video-intelligence/jobs initially empty", async () => {
    const ctx = makeContext("/api/agent-os/video-intelligence/jobs", "GET");
    const res = await handleVideoIntelligenceRoutes(ctx);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const data = await res!.json() as { jobs: any[] };
    expect(Array.isArray(data.jobs)).toBe(true);
    expect(data.jobs.length).toBe(0);
  });

  it("rejects POST /jobs without source", async () => {
    const ctx = makeContext("/api/agent-os/video-intelligence/jobs", "POST", {});
    const res = await handleVideoIntelligenceRoutes(ctx);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
    const data = await res!.json() as { error: { message: string } };
    expect(data.error.message).toContain("source");
  });

  it("creates job via POST /api/agent-os/video-intelligence/jobs and fetches it", async () => {
    const postCtx = makeContext("/api/agent-os/video-intelligence/jobs", "POST", {
      source: "https://example.com/demo.mp4",
      intent: "adobe_stock_qc",
      sampling: "uniform",
    });
    const postRes = await handleVideoIntelligenceRoutes(postCtx);
    expect(postRes).not.toBeNull();
    expect(postRes!.status).toBe(201);
    const postData = await postRes!.json() as { job: { id: string; status: string } };
    const jobId = postData.job.id;
    expect(jobId).toBeDefined();

    // GET /jobs/:id
    const getCtx = makeContext(`/api/agent-os/video-intelligence/jobs/${jobId}`, "GET");
    const getRes = await handleVideoIntelligenceRoutes(getCtx);
    expect(getRes).not.toBeNull();
    expect(getRes!.status).toBe(200);
    const getData = await getRes!.json() as { job: { id: string; status: string } };
    expect(getData.job.id).toBe(jobId);

    // GET /jobs/:id/frames
    const framesCtx = makeContext(`/api/agent-os/video-intelligence/jobs/${jobId}/frames`, "GET");
    const framesRes = await handleVideoIntelligenceRoutes(framesCtx);
    expect(framesRes!.status).toBe(200);

    // GET /jobs/:id/transcript
    const transCtx = makeContext(`/api/agent-os/video-intelligence/jobs/${jobId}/transcript`, "GET");
    const transRes = await handleVideoIntelligenceRoutes(transCtx);
    expect(transRes!.status).toBe(200);

    // GET /jobs/:id/report
    const repCtx = makeContext(`/api/agent-os/video-intelligence/jobs/${jobId}/report`, "GET");
    const repRes = await handleVideoIntelligenceRoutes(repCtx);
    expect([200, 202]).toContain(repRes!.status);

    // POST /jobs/:id/cancel
    const cancelCtx = makeContext(`/api/agent-os/video-intelligence/jobs/${jobId}/cancel`, "POST");
    const cancelRes = await handleVideoIntelligenceRoutes(cancelCtx);
    expect(cancelRes!.status).toBe(200);
  });

  it("supports alias /api/video/jobs", async () => {
    const ctx = makeContext("/api/video/jobs", "GET");
    const res = await handleVideoIntelligenceRoutes(ctx);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
  });

  it("returns 404 for non-existent job", async () => {
    const ctx = makeContext("/api/agent-os/video-intelligence/jobs/vjob_nonexistent", "GET");
    const res = await handleVideoIntelligenceRoutes(ctx);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);
  });

  it("returns null for unrelated route paths", async () => {
    const ctx = makeContext("/api/agent-os/other", "GET");
    const res = await handleVideoIntelligenceRoutes(ctx);
    expect(res).toBeNull();
  });
});
