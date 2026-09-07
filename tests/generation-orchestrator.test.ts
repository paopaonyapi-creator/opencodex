// Phase 19 — orchestrator integration tests against a mock ComfyUI HTTP server.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeAgentOsDbForTests, openAgentOsDb } from "../src/agent-os/db";
import { loadGenerationConfig } from "../src/agent-os/generation/config";
import { ensureBuiltInWorkflows } from "../src/agent-os/generation/registry";
import { createJob, getJob, listEventsForJobs, updateJob } from "../src/agent-os/generation/queue";
import { upsertProvider } from "../src/agent-os/generation/providers";
import { GenerationOrchestrator, resetGenerationOrchestratorForTests } from "../src/agent-os/generation/orchestrator";

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
  closeAgentOsDbForTests();
  tempDir = mkdtempSync(join(tmpdir(), "gen-orch-test-"));
  storageRoot = join(tempDir, "storage");
  process.env.PAO_GENERATION_STORAGE_PATH = storageRoot;
  process.env.PAO_GENERATION_TEMP_PATH = join(tempDir, "tmp");
  openAgentOsDb(tempDir);
  ensureBuiltInWorkflows();
});

afterEach(() => {
  closeAgentOsDbForTests();
  resetGenerationOrchestratorForTests();
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

function orchestrator(): GenerationOrchestrator {
  return new GenerationOrchestrator({
    ...loadGenerationConfig({} as never),
    storagePath: storageRoot,
    tempPath: join(tempDir, "tmp"),
    enabled: true,
  });
}

describe("phase 19 — orchestrator", () => {
  test("end-to-end happy path: queue-generate-download-review-complete", async () => {
    let historyPolls = 0;
    const png = makePngBytes(2100, 2100);
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/system_stats") return Response.json({ system: { comfyui_version: "mock" } });
        if (url.pathname === "/prompt" && req.method === "POST") return Response.json({ prompt_id: "mock_prompt_1", number: 1 });
        if (url.pathname.startsWith("/history/")) {
          historyPolls++;
          const completed = historyPolls >= 2;
          return Response.json({
            mock_prompt_1: {
              prompt: {},
              outputs: completed ? { "80": { images: [{ filename: "out.png", subfolder: "", type: "output" }] } } : {},
              status: { completed, messages: [] },
            },
          });
        }
        if (url.pathname === "/view") return new Response(png, { headers: { "Content-Type": "image/png" } });
        if (url.pathname === "/interrupt") return new Response(null, { status: 200 });
        return new Response("nf", { status: 404 });
      },
    });
    try {
      upsertProvider({ id: "comfyui-local", name: "Mock ComfyUI", baseUrl: `http://127.0.0.1:${server.port}`, timeoutSeconds: 10 });
      const orch = orchestrator();
      const { job } = createJob({ jobType: "text_to_image", workflowId: "sdxl-text-to-image", prompt: "premium smart home", seed: 7, width: 1024, height: 1024, batchSize: 1, autoMetadata: true });

      await orch.processTick(); // claim + queue to mock ComfyUI
      expect(getJob(job.id)?.status).toBe("generating");
      await orch.processTick(); // first poll: not completed yet
      await orch.processTick(); // second poll: completed -> full chain

      const finished = getJob(job.id)!;
      expect(finished.status).toBe("completed");
      expect(finished.resolvedSeed).toBe(7);
      const events = listEventsForJobs([job.id]);
      expect(events.some(e => e.type === "output_created")).toBe(true);
      expect(events.some(e => e.type === "review_completed")).toBe(true);
      expect(events.some(e => e.type === "metadata_completed")).toBe(true);
    } finally {
      server.stop(true);
    }
  }, 20_000);

  test("cancel interrupts the provider and finalizes the job", async () => {
    let interrupted = false;
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/system_stats") return Response.json({});
        if (url.pathname === "/prompt" && req.method === "POST") return Response.json({ prompt_id: "p2", number: 1 });
        if (url.pathname.startsWith("/history/")) return Response.json({ p2: { prompt: {}, outputs: {}, status: { completed: false, messages: [] } } });
        if (url.pathname === "/interrupt") { interrupted = true; return new Response(null, { status: 200 }); }
        return new Response("nf", { status: 404 });
      },
    });
    try {
      upsertProvider({ id: "comfyui-local", name: "Mock", baseUrl: `http://127.0.0.1:${server.port}`, timeoutSeconds: 10 });
      const orch = orchestrator();
      const { job } = createJob({ jobType: "text_to_image", workflowId: "sdxl-text-to-image", prompt: "p" });
      await orch.processTick();
      await orch.cancel(job.id, "user", "test");
      await orch.processTick();
      expect(interrupted).toBe(true);
      expect(getJob(job.id)?.status).toBe("cancelled");
    } finally {
      server.stop(true);
    }
  }, 20_000);

  test("provider offline re-queues with backoff, then fails permanently", async () => {
    upsertProvider({ id: "comfyui-local", name: "Dead", baseUrl: "http://127.0.0.1:59999", timeoutSeconds: 1 });
    const orch = orchestrator();
    const { job } = createJob({ jobType: "text_to_image", workflowId: "sdxl-text-to-image", prompt: "p", maxRetries: 1 });
    await orch.processTick();
    const afterFirst = getJob(job.id)!;
    expect(["queued", "failed"]).toContain(afterFirst.status);
    if (afterFirst.status === "queued") {
      updateJob(job.id, { runAfterMs: 0 });
      await orch.processTick();
      expect(getJob(job.id)?.status).toBe("failed");
    }
  }, 20_000);

  test("completed run with no outputs is output_corrupted", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/system_stats") return Response.json({});
        if (url.pathname === "/prompt" && req.method === "POST") return Response.json({ prompt_id: "p3", number: 1 });
        if (url.pathname.startsWith("/history/")) return Response.json({ p3: { prompt: {}, outputs: {}, status: { completed: true, messages: [] } } });
        return new Response("nf", { status: 404 });
      },
    });
    try {
      upsertProvider({ id: "comfyui-local", name: "Mock", baseUrl: `http://127.0.0.1:${server.port}`, timeoutSeconds: 10 });
      const orch = orchestrator();
      const { job } = createJob({ jobType: "text_to_image", workflowId: "sdxl-text-to-image", prompt: "p", maxRetries: 0 });
      await orch.processTick();
      await orch.processTick();
      expect(getJob(job.id)?.status).toBe("failed");
    } finally {
      server.stop(true);
    }
  }, 20_000);
});
