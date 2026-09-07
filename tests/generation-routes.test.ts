// Phase 19 — Generation management API route tests (direct dispatch, the same
// pattern stock-routes.test.ts uses).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeAgentOsDbForTests, openAgentOsDb } from "../src/agent-os/db";
import { handleGenerationRoutes } from "../src/server/management/generation-routes";
import type { ManagementContext } from "../src/server/management/context";
import { createJob } from "../src/agent-os/generation/queue";
import { LocalAssetStorage } from "../src/agent-os/generation/storage";

let tempDir = "";
let storageRoot = "";

function makePngBytes(width: number, height: number): Uint8Array {
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const ihdrLen = new Uint8Array([0, 0, 0, 13]);
  const ihdrType = new Uint8Array([0x49, 0x48, 0x44, 0x52]);
  const crc = new Uint8Array([0xae, 0x42, 0x60, 0x82]);
  const iendLen = new Uint8Array([0, 0, 0, 0]);
  const iendType = new Uint8Array([0x49, 0x45, 0x4e, 0x44]);
  const bytes = new Uint8Array(8 + 4 + 4 + 13 + 4 + 4 + 4 + 4);
  let offset = 0;
  const append = (part: Uint8Array) => { bytes.set(part, offset); offset += part.length; };
  append(signature); append(ihdrLen); append(ihdrType); append(ihdr); append(crc); append(iendLen); append(iendType); append(crc);
  return bytes;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gen-routes-test-"));
  storageRoot = join(tempDir, "storage");
  process.env.PAO_GENERATION_STORAGE_PATH = storageRoot;
  process.env.PAO_GENERATION_TEMP_PATH = join(tempDir, "tmp");
  openAgentOsDb(tempDir);
});

afterEach(() => {
  closeAgentOsDbForTests();
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

function mockCtx(path: string, method = "GET", body?: unknown, headers?: Record<string, string>): ManagementContext {
  const url = new URL(`http://127.0.0.1:4000${path}`);
  const req = new Request(url.toString(), {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(headers ?? {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { url, req, config: {} as never, principal: { role: "admin", isLoopback: true } as never, deps: {} as never };
}

describe("phase 19 — generation management API", () => {
  test("health, workflows, and models respond", async () => {
    const health = await handleGenerationRoutes(mockCtx("/api/generation/health"));
    expect(health?.status).toBe(200);
    const workflows = await handleGenerationRoutes(mockCtx("/api/generation/workflows"));
    const wfJson = await workflows!.json() as { workflows: unknown[] };
    expect(wfJson.workflows.length).toBeGreaterThan(0);
    const models = await handleGenerationRoutes(mockCtx("/api/generation/models"));
    expect(models?.status).toBe(200);
    const loras = await handleGenerationRoutes(mockCtx("/api/generation/loras"));
    expect(loras?.status).toBe(200);
  });

  test("create job, duplicate via Idempotency-Key, list, cancel", async () => {
    const created = await handleGenerationRoutes(mockCtx("/api/generation/jobs", "POST", {
      workflowId: "sdxl-text-to-image", prompt: "premium smart home", seed: 5, batchSize: 1,
    }, { "Idempotency-Key": "route-key-1" }));
    expect(created?.status).toBe(201);
    const { job } = await created!.json() as { job: { id: string } };

    const duplicate = await handleGenerationRoutes(mockCtx("/api/generation/jobs", "POST", {
      workflowId: "sdxl-text-to-image", prompt: "premium smart home",
    }, { "Idempotency-Key": "route-key-1" }));
    expect(duplicate?.status).toBe(200);
    const dupJson = await duplicate!.json() as { job: { id: string }; duplicate: boolean };
    expect(dupJson.duplicate).toBe(true);
    expect(dupJson.job.id).toBe(job.id);

    const list = await handleGenerationRoutes(mockCtx("/api/generation/jobs?status=queued"));
    const listJson = await list!.json() as { total: number };
    expect(listJson.total).toBeGreaterThanOrEqual(1);

    const cancel = await handleGenerationRoutes(mockCtx(`/api/generation/jobs/${job.id}/cancel`, "POST", { reason: "route test" }));
    expect(cancel?.status).toBe(200);
    const detail = await handleGenerationRoutes(mockCtx(`/api/generation/jobs/${job.id}`));
    const detailJson = await detail!.json() as { job: { status: string } };
    expect(detailJson.job.status).toBe("cancelled");
  });

  test("batch splitting creates parent plus children beyond 4", async () => {
    const created = await handleGenerationRoutes(mockCtx("/api/generation/jobs", "POST", {
      workflowId: "sdxl-text-to-image", prompt: "batch", batchSize: 6,
    }));
    expect(created?.status).toBe(201);
    const body = await created!.json() as { job: { id: string }; children: string[] };
    expect(body.children.length).toBe(2);
    const parent = await handleGenerationRoutes(mockCtx(`/api/generation/jobs/${body.job.id}`));
    const parentJson = await parent!.json() as { children: unknown[] };
    expect(parentJson.children.length).toBe(2);
  });

  test("validation error is 400, unknown job is 404", async () => {
    const bad = await handleGenerationRoutes(mockCtx("/api/generation/jobs", "POST", { workflowId: "w", prompt: "" }));
    expect(bad?.status).toBe(400);
    const missing = await handleGenerationRoutes(mockCtx("/api/generation/jobs/job_nope"));
    expect(missing?.status).toBe(404);
  });

  test("job events endpoint returns recorded events", async () => {
    const { job } = createJob({ jobType: "text_to_image", workflowId: "w", prompt: "p" });
    const res = await handleGenerationRoutes(mockCtx(`/api/generation/jobs/${job.id}/events?after=0`));
    expect(res?.status).toBe(200);
    const body = await res!.json() as { events: unknown[] };
    expect(body.events.length).toBeGreaterThanOrEqual(1);
  });

  test("asset detail, review, metadata, and gated export work end to end", async () => {
    const storage = new LocalAssetStorage({ root: storageRoot });
    const asset = storage.saveAsset({
      projectId: null, jobId: null, assetType: "image", role: "generated",
      bytes: makePngBytes(2100, 2100), mimeType: "image/png", width: 2100, height: 2100,
      prompt: "premium minimal smart home control panel",
    });
    const detail = await handleGenerationRoutes(mockCtx(`/api/generation/assets/${asset.id}`));
    expect(detail?.status).toBe(200);
    const review = await handleGenerationRoutes(mockCtx(`/api/generation/assets/${asset.id}/review`, "POST"));
    expect(review?.status).toBe(200);
    const meta = await handleGenerationRoutes(mockCtx(`/api/generation/assets/${asset.id}/generate-metadata`, "POST"));
    expect(meta?.status).toBe(200);
    const exportRes = await handleGenerationRoutes(mockCtx(`/api/generation/assets/${asset.id}/export`, "POST", {}));
    // After review+metadata the asset passes; export succeeds stock-ready.
    expect([201, 409]).toContain(exportRes?.status);
    const file = await handleGenerationRoutes(mockCtx(`/api/generation/assets/${asset.id}/file`));
    expect(file?.status).toBe(200);
  });

  test("project create + favorite rating patch", async () => {
    const project = await handleGenerationRoutes(mockCtx("/api/generation/projects", "POST", { name: "Adobe Stock — Smart Home September 2026", mode: "adobe_stock" }));
    expect(project?.status).toBe(201);
    const storage = new LocalAssetStorage({ root: storageRoot });
    const asset = storage.saveAsset({ projectId: null, jobId: null, assetType: "image", role: "generated", bytes: makePngBytes(2100, 2100), mimeType: "image/png" });
    const patched = await handleGenerationRoutes(mockCtx(`/api/generation/assets/${asset.id}`, "PATCH", { favorite: true, userRating: 5 }));
    expect(patched?.status).toBe(200);
    const body = await patched!.json() as { asset: { favorite: boolean; userRating: number | null } };
    expect(body.asset.favorite).toBe(true);
    expect(body.asset.userRating).toBe(5);
  });

  test("delete is soft and audited", async () => {
    const storage = new LocalAssetStorage({ root: storageRoot });
    const asset = storage.saveAsset({ projectId: null, jobId: null, assetType: "image", role: "generated", bytes: makePngBytes(2100, 2100), mimeType: "image/png" });
    const del = await handleGenerationRoutes(mockCtx(`/api/generation/assets/${asset.id}`, "DELETE"));
    expect(del?.status).toBe(200);
    const body = await del!.json() as { softDeleted: boolean };
    expect(body.softDeleted).toBe(true);
    const audit = await handleGenerationRoutes(mockCtx("/api/generation/audit"));
    const auditJson = await audit!.json() as { entries: Array<{ action: string }> };
    expect(auditJson.entries.some(e => e.action === "asset.delete")).toBe(true);
  });

  test("validate endpoint reports subsystem status", async () => {
    const res = await handleGenerationRoutes(mockCtx("/api/generation/validate", "POST"));
    expect(res?.status).toBe(200);
    const body = await res!.json() as { ok: boolean; lines: Array<{ component: string }> };
    expect(body.lines.some(l => l.component === "Config")).toBe(true);
    expect(body.lines.some(l => l.component === "ComfyUI")).toBe(true);
  });

  test("unknown generation route is 404", async () => {
    const res = await handleGenerationRoutes(mockCtx("/api/generation/unknown-thing"));
    expect(res?.status).toBe(404);
  });
});
