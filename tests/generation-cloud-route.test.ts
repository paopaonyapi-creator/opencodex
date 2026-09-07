import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MockRunPodServer } from "../src/agent-os/generation/cloud/runpod/mock";
import { GenerationOrchestrator, resetGenerationOrchestratorForTests } from "../src/agent-os/generation/orchestrator";
import { createJob, getJob } from "../src/agent-os/generation/queue";
import { loadGenerationConfig } from "../src/agent-os/generation/config";
import { openAgentOsDb, closeAgentOsDbForTests } from "../src/agent-os/db";
import { ensureBuiltInWorkflows } from "../src/agent-os/generation/registry";
import type { Server } from "bun";

describe("phase 20 — cloud route end-to-end integration", () => {
  let mockRunPod: MockRunPodServer;
  let mockRunPodUrl: string;
  let mockComfyServer: Server;
  let mockComfyPort: number;
  let tempDir = "";
  let storageRoot = "";

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "gen-cloud-test-"));
    storageRoot = join(tempDir, "storage");
    process.env.PAO_GENERATION_STORAGE_PATH = storageRoot;
    process.env.PAO_GENERATION_TEMP_PATH = join(tempDir, "tmp");
    openAgentOsDb(tempDir);
    ensureBuiltInWorkflows();

    // 1. Start Mock ComfyUI server that answers /system_stats, /prompt, /history, /view
    mockComfyServer = Bun.serve({
      port: 0,
      fetch(req: Request) {
        const url = new URL(req.url);
        if (url.pathname === "/system_stats") {
          return new Response(JSON.stringify({ devices: [{ name: "RTX 4090", vram_total: 24000000000 }] }), { status: 200 });
        }
        if (url.pathname === "/prompt" && req.method === "POST") {
          return new Response(JSON.stringify({ prompt_id: "prompt_cloud_test_123", number: 1 }), { status: 200 });
        }
        if (url.pathname.startsWith("/history/")) {
          return new Response(JSON.stringify({
            prompt_cloud_test_123: {
              status: { completed: true },
              outputs: {
                "9": {
                  images: [{ filename: "cloud_rendered_img.png", subfolder: "", type: "output" }],
                },
              },
            },
          }), { status: 200 });
        }
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

        if (url.pathname === "/view") {
          const mockPng = makePngBytes(1920, 1080);
          return new Response(mockPng, { headers: { "Content-Type": "image/png" } });
        }
        return new Response("Not found", { status: 404 });
      },
    });
    mockComfyPort = mockComfyServer.port;

    // 2. Start Mock RunPod Server configured to return our mock ComfyUI port
    mockRunPod = new MockRunPodServer({
      validApiKey: "cloud_test_api_key_456",
      comfyPort: mockComfyPort,
    });
    mockRunPodUrl = await mockRunPod.start();
  });

  afterAll(() => {
    mockRunPod.stop();
    mockComfyServer.stop(true);
    closeAgentOsDbForTests();
    resetGenerationOrchestratorForTests();
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it("routes heavy job to RunPod, provisions mock pod, executes generation, and stores asset", async () => {
    const baseConfig = loadGenerationConfig();
    const testConfig = {
      ...baseConfig,
      runpodEnabled: true,
      runpodApiKey: "cloud_test_api_key_456",
      runpodApiBaseUrl: mockRunPodUrl,
      gpuPreferLocal: false, // force cloud routing for heavy job
      runpodDailyBudget: 50.00,
    };

    const orchestrator = new GenerationOrchestrator(testConfig);

    // Create heavy job that requests cloud or exceeds local VRAM
    const { job } = createJob({
      jobType: "text_to_video",
      prompt: "epic cinematic drone shot over mountains",
      workflowId: "sdxl-text-to-image",
      workflowVersion: 1,
      width: 1920,
      height: 1080,
      batchSize: 1,
      stockMode: true,
      autoReview: true,
      autoMetadata: false,
      autoExport: false,
    });

    expect(job.status).toBe("queued");

    // Execute job through orchestrator
    await orchestrator.executeJob(job);

    // Wait for active generation to be polled and completed
    await orchestrator.processTick();

    const completed = getJob(job.id);
    expect(completed?.status).toBe("completed");

    // Verify assets were saved to database
    const db = openAgentOsDb();
    const assets = db.query("SELECT * FROM gen_assets WHERE job_id = ?").all(job.id) as Array<Record<string, unknown>>;
    expect(assets.length).toBeGreaterThan(0);

    // Verify RunPod pod was recorded and then unassigned
    const podRows = db.query("SELECT * FROM gen_runpod_pods WHERE current_job_id IS NULL").all();
    expect(podRows.length).toBeGreaterThan(0);

    // Verify placement decision was recorded
    const decisions = db.query("SELECT * FROM gen_placement_decisions WHERE job_id = ?").all(job.id) as Array<Record<string, unknown>>;
    expect(decisions.length).toBe(1);
    expect(decisions[0].selected_provider).toBe("runpod");

    orchestrator.stop();
  });
});
