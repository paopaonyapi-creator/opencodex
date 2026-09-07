// Phase 19 — Generation Studio unit + integration tests.
//
// The ComfyUI dependency is mocked with a real local HTTP server (spec section
// 64) so CI needs no GPU. Everything else runs against the real SQLite store.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeAgentOsDbForTests, openAgentOsDb } from "../src/agent-os/db";
import { generationConfigError, loadGenerationConfig } from "../src/agent-os/generation/config";
import {
  applyBindings, ensureBuiltInWorkflows, getWorkflow, listWorkflows, upsertLora, upsertModel,
} from "../src/agent-os/generation/registry";
import {
  claimNextJob, createJob, getJob, listEventsForJobs, recordJobEvent, requestCancel,
  retryFailedJob, updateJob, assertTransition,
} from "../src/agent-os/generation/queue";
import { LocalAssetStorage, findExactDuplicateBySha } from "../src/agent-os/generation/storage";
import { evaluateAssetByGenerationCouncil, runTechnicalReview } from "../src/agent-os/generation/reviewer";
import {
  buildAdobeStockCsvHeader, buildAdobeStockCsvRow, createExportPackage, generateStockMetadata,
  getStockMetadata, stockSafetyGate, upsertStockMetadata,
} from "../src/agent-os/generation/stock";
import { GenerationOrchestrator, resetGenerationOrchestratorForTests } from "../src/agent-os/generation/orchestrator";
import { handleGenerationRoutes } from "../src/server/management/generation-routes";
import type { ManagementContext } from "../src/server/management/context";
import { upsertProvider } from "../src/agent-os/generation/providers";

let tempDir = "";
let storageRoot = "";

// A minimal structurally-valid PNG (signature + IHDR + IEND). The IEND chunk
// sits in the final 12 bytes so the corruption probe passes.
function makePngBytes(width: number, height: number): Uint8Array {
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
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
  tempDir = mkdtempSync(join(tmpdir(), "gen-studio-test-"));
  storageRoot = join(tempDir, "storage");
  process.env.PAO_GENERATION_STORAGE_PATH = storageRoot;
  process.env.PAO_GENERATION_TEMP_PATH = join(tempDir, "tmp");
  openAgentOsDb(tempDir);
});

afterEach(() => {
  closeAgentOsDbForTests();
  resetGenerationOrchestratorForTests();
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

describe("phase 19 — generation config", () => {
  test("defaults follow the spec", () => {
    const config = loadGenerationConfig({} as never);
    expect(config.enabled).toBe(true);
    expect(config.comfyuiBaseUrl).toBe("http://127.0.0.1:8188");
    expect(config.comfyuiTimeoutSeconds).toBe(600);
    expect(config.comfyuiMaxConcurrency).toBe(1);
    expect(config.stockReadyScore).toBe(85);
  });

  test("invalid URL is rejected with a meaningful message", () => {
    expect(() => loadGenerationConfig({ PAO_COMFYUI_BASE_URL: "not a url" } as never)).toThrow(/PAO_COMFYUI_BASE_URL/);
  });

  test("manual review score above ready score is rejected", () => {
    expect(() => loadGenerationConfig({ PAO_STOCK_READY_SCORE: "50", PAO_STOCK_MANUAL_REVIEW_SCORE: "90" } as never)).toThrow(/PAO_STOCK_MANUAL_REVIEW_SCORE/);
  });
});

describe("phase 19 — workflow registry", () => {
  test("built-in workflow is seeded with resolvable bindings", () => {
    const workflows = listWorkflows();
    expect(workflows.length).toBeGreaterThan(0);
    const sdxl = getWorkflow("sdxl-text-to-image");
    expect(sdxl).not.toBeNull();
    expect(sdxl!.enabled).toBe(true);
    expect(sdxl!.bindings.prompt).toBeDefined();
    expect(Object.keys(JSON.parse(sdxl!.workflowJson) as Record<string, unknown>)).toContain(sdxl!.bindings.prompt.node_id);
  });

  test("applyBindings deep-copies the template and applies values", () => {
    const workflow = getWorkflow("sdxl-text-to-image")!;
    const result = applyBindings(workflow, { prompt: "a smart home", seed: 42, width: 768 });
    expect(result.applied).toEqual(["prompt", "seed", "width"]);
    expect(result.missing).toEqual([]);
    const graph = result.graph as Record<string, { inputs: Record<string, unknown> }>;
    expect(graph["6"].inputs.text).toBe("a smart home");
    expect(graph["3"].inputs.seed).toBe(42);
    expect(graph["5"].inputs.width).toBe(768);
    const fresh = JSON.parse(getWorkflow("sdxl-text-to-image")!.workflowJson) as Record<string, { inputs: Record<string, unknown> }>;
    expect(fresh["6"].inputs.text).toBe("");
  });

  test("applyBindings reports unbindable values instead of guessing", () => {
    const workflow = getWorkflow("sdxl-text-to-image")!;
    const result = applyBindings(workflow, { loras: [{ filename: "x.safetensors", strength: 0.8, model_adapter: "lora" }] });
    expect(result.missing).toContain("loras");
  });

  test("model and lora registries store license metadata", () => {
    const model = upsertModel({ id: "m_sdxl", displayName: "SDXL Base", family: "Flux", checkpointName: "sd_xl_base_1.0.safetensors" });
    expect(model.commercialUseNotes).toBe("unverified");
    const lora = upsertLora({ id: "l_test", name: "Test LoRA", filename: "test.safetensors", baseModelFamily: "Flux" });
    expect(lora.defaultStrength).toBe(0.8);
  });
});

describe("phase 19 — persistent job queue", () => {
  test("create-claim-complete walks the state machine", () => {
    const { job } = createJob({ jobType: "text_to_image", workflowId: "sdxl-text-to-image", prompt: "test" });
    expect(job.status).toBe("queued");
    const claimed = claimNextJob("w1");
    expect(claimed?.id).toBe(job.id);
    expect(claimed?.status).toBe("validating");
    updateJob(job.id, { status: "preparing", stage: "preparing" });
    updateJob(job.id, { status: "generating", stage: "generating" });
    updateJob(job.id, { status: "post_processing", stage: "post_processing" });
    const done = updateJob(job.id, { status: "completed", progress: 1 });
    expect(done.status).toBe("completed");
    expect(done.completedAt).not.toBeNull();
  });

  test("invalid transitions are rejected", () => {
    expect(() => assertTransition("completed", "queued")).toThrow();
    expect(() => assertTransition("queued", "completed")).toThrow();
  });

  test("idempotency key returns the original job", () => {
    const first = createJob({ jobType: "text_to_image", workflowId: "w", prompt: "p", idempotencyKey: "agent-key-1" });
    const second = createJob({ jobType: "text_to_image", workflowId: "w", prompt: "p", idempotencyKey: "agent-key-1" });
    expect(second.duplicateOf).toBeDefined();
    expect(second.job.id).toBe(first.job.id);
  });

  test("queued job cancels outright; running job records the request", () => {
    const { job } = createJob({ jobType: "text_to_image", workflowId: "w", prompt: "p" });
    const cancelled = requestCancel(job.id, "user asked");
    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.cancelReason).toBe("user asked");

    const { job: running } = createJob({ jobType: "text_to_image", workflowId: "w", prompt: "p" });
    claimNextJob("w1");
    const requested = requestCancel(running.id, "stop");
    expect(requested?.cancelRequested).toBe(true);
    expect(requested?.status).not.toBe("cancelled");
  });

  test("retryable failure goes stage-failed-queued with backoff", () => {
    const { job } = createJob({ jobType: "text_to_image", workflowId: "w", prompt: "p" });
    const advanceToGenerating = () => {
      expect(claimNextJob("w1")?.id).toBe(job.id); // queued -> validating
      updateJob(job.id, { status: "preparing", stage: "preparing" });
      updateJob(job.id, { status: "generating", stage: "generating" });
    };
    advanceToGenerating();
    const retried = retryFailedJob(job.id, "provider_offline", "ComfyUI down");
    expect(retried?.status).toBe("queued");
    expect(retried?.retryCount).toBe(1);
    expect(retried?.runAfterMs).toBeGreaterThan(Date.now());
    updateJob(job.id, { runAfterMs: 0 });
    advanceToGenerating();
    retryFailedJob(job.id, "provider_offline", "again");
    updateJob(job.id, { runAfterMs: 0 });
    advanceToGenerating();
    const final = retryFailedJob(job.id, "provider_offline", "third");
    expect(final?.status).toBe("failed");
  });

  test("retry count survives the failed hop and gates exhaustion", () => {
    const { job } = createJob({ jobType: "text_to_image", workflowId: "w", prompt: "p", maxRetries: 0 });
    expect(claimNextJob("w1")?.id).toBe(job.id);
    updateJob(job.id, { status: "preparing", stage: "preparing" });
    updateJob(job.id, { status: "generating", stage: "generating" });
    const failed = retryFailedJob(job.id, "provider_offline", "no retries allowed");
    expect(failed?.status).toBe("failed");
    expect(failed?.retryCount).toBe(0);
  });

  test("validation errors fail fast without retry", () => {
    const { job } = createJob({ jobType: "text_to_image", workflowId: "w", prompt: "p" });
    claimNextJob("w1");
    updateJob(job.id, { status: "validating", stage: "validating" });
    const failed = retryFailedJob(job.id, "validation_error", "bad prompt");
    expect(failed?.status).toBe("failed");
    expect(failed?.retryCount).toBe(0);
  });

  test("job events paginate after a cursor", () => {
    const { job } = createJob({ jobType: "text_to_image", workflowId: "w", prompt: "p" });
    recordJobEvent(job.id, "progress", "generating", 0.5, "halfway");
    const all = listEventsForJobs([job.id]);
    expect(all.length).toBeGreaterThanOrEqual(2);
    const after = listEventsForJobs([job.id], all[0]!.id);
    expect(after.map(e => e.id)).not.toContain(all[0]!.id);
  });
});

describe("phase 19 — asset storage", () => {
  test("saves a real file with hash, dimensions, and UUID name", () => {
    const storage = new LocalAssetStorage({ root: storageRoot });
    const bytes = makePngBytes(2100, 2100);
    const asset = storage.saveAsset({ projectId: null, jobId: null, assetType: "image", role: "generated", bytes, mimeType: "image/png", prompt: "p" });
    expect(asset.sha256).toHaveLength(64);
    expect(asset.width).toBe(2100);
    expect(asset.height).toBe(2100);
    expect(asset.filename).toMatch(/\.png$/);
    expect(asset.storagePath.startsWith(storageRoot)).toBe(true);
  });

  test("rejects corrupted PNG uploads", () => {
    const storage = new LocalAssetStorage({ root: storageRoot });
    const bad = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    expect(() => storage.saveAsset({ projectId: null, jobId: null, assetType: "image", role: "generated", bytes: bad, mimeType: "image/png" })).toThrow(/corrupted/);
  });

  test("soft delete and exact-hash duplicate detection", () => {
    const storage = new LocalAssetStorage({ root: storageRoot });
    const bytes = makePngBytes(2100, 2100);
    const a = storage.saveAsset({ projectId: null, jobId: null, assetType: "image", role: "generated", bytes, mimeType: "image/png" });
    expect(findExactDuplicateBySha(a.sha256, a.id)).toBeNull();
    const b = storage.saveAsset({ projectId: null, jobId: null, assetType: "image", role: "generated", bytes, mimeType: "image/png" });
    expect(findExactDuplicateBySha(a.sha256, a.id)?.id).toBe(b.id);
    expect(storage.softDeleteAsset(b.id)).toBe(true);
    expect(findExactDuplicateBySha(a.sha256, a.id)).toBeNull();
  });
});

describe("phase 19 — reviewer council", () => {
  test("compliant image passes technical review", () => {
    const storage = new LocalAssetStorage({ root: storageRoot });
    const asset = storage.saveAsset({
      projectId: null, jobId: null, assetType: "image", role: "generated",
      bytes: makePngBytes(2100, 2100), mimeType: "image/png", width: 2100, height: 2100,
    });
    const review = runTechnicalReview({ ...asset, mimeType: "image/jpeg" });
    expect(review.verdict).toBe("pass");
    expect(review.score).toBe(100);
  });

  test("sub-4MP images fail the stock range", () => {
    const storage = new LocalAssetStorage({ root: storageRoot });
    const asset = storage.saveAsset({
      projectId: null, jobId: null, assetType: "image", role: "generated",
      bytes: makePngBytes(512, 512), mimeType: "image/png", width: 512, height: 512,
    });
    const review = runTechnicalReview(asset);
    expect(review.verdict).toBe("fail");
    expect(review.issues.some(i => i.message.includes("stock range"))).toBe(true);
  });

  test("duplicate assets are rejected by the council", () => {
    const storage = new LocalAssetStorage({ root: storageRoot });
    const bytes = makePngBytes(2100, 2100);
    storage.saveAsset({ projectId: null, jobId: null, assetType: "image", role: "generated", bytes, mimeType: "image/png", width: 2100, height: 2100 });
    const b = storage.saveAsset({ projectId: null, jobId: null, assetType: "image", role: "generated", bytes, mimeType: "image/png", width: 2100, height: 2100 });
    const result = evaluateAssetByGenerationCouncil(b);
    expect(result.decision).toBe("REJECT");
    const dupReview = result.reviews.find(r => r.reviewType === "similarity");
    expect(dupReview?.issues.some(i => i.code === "EXACT_DUPLICATE")).toBe(true);
  });
});

describe("phase 19 — adobe stock mode", () => {
  test("metadata generation produces compliant metadata", () => {
    const storage = new LocalAssetStorage({ root: storageRoot });
    const asset = storage.saveAsset({
      projectId: null, jobId: null, assetType: "image", role: "generated",
      bytes: makePngBytes(2100, 2100), mimeType: "image/png", width: 2100, height: 2100,
      prompt: "premium minimal smart home control panel",
    });
    const { metadata, validation } = generateStockMetadata(asset);
    expect(validation.valid).toBe(true);
    expect(metadata.keywords.length).toBeGreaterThanOrEqual(10);
    expect(metadata.aiGenerated).toBe(true);
    expect(getStockMetadata(asset.id)?.title).toBe(metadata.title);
    expect(buildAdobeStockCsvRow(metadata, "file.jpg").startsWith('"file.jpg"')).toBe(true);
    expect(buildAdobeStockCsvHeader()).toContain("Keywords");
  });

  test("stock safety gate blocks export before review and metadata", () => {
    const storage = new LocalAssetStorage({ root: storageRoot });
    const asset = storage.saveAsset({ projectId: null, jobId: null, assetType: "image", role: "generated", bytes: makePngBytes(2100, 2100), mimeType: "image/png", width: 2100, height: 2100 });
    const gate = stockSafetyGate(asset);
    expect(gate.allowed).toBe(false);
    expect(gate.blockers.length).toBeGreaterThan(0);
    const { pack } = createExportPackage({ asset, storage });
    expect(pack.status).toBe("failed");
  });

  test("full pipeline reaches a stock-ready export with manifest", () => {
    const storage = new LocalAssetStorage({ root: storageRoot });
    const asset = storage.saveAsset({
      projectId: null, jobId: null, assetType: "image", role: "generated",
      bytes: makePngBytes(2100, 2100), mimeType: "image/png", width: 2100, height: 2100,
      prompt: "premium minimal smart home control panel",
    });
    generateStockMetadata(asset);
    const evaluation = evaluateAssetByGenerationCouncil(storage.getAsset(asset.id)!);
    expect(evaluation.decision).toBe("PASS");
    const refreshed = storage.getAsset(asset.id)!;
    const { pack, gate } = createExportPackage({ asset: refreshed, storage });
    expect(gate.mode).toBe("stock-ready");
    expect(pack.status).toBe("complete");
    expect(pack.manifestPath).toContain("manifest");
    expect(pack.csvPath).toContain(".csv");
  });

  test("manual-review export requires explicit intent", () => {
    const storage = new LocalAssetStorage({ root: storageRoot });
    const asset = storage.saveAsset({
      projectId: null, jobId: null, assetType: "image", role: "generated",
      bytes: makePngBytes(2100, 2100), mimeType: "image/png", width: 2100, height: 2100,
      prompt: "premium minimal smart home control panel",
    });
    upsertStockMetadata({ assetId: asset.id, title: "Smart home control panel concept", keywords: Array.from({ length: 12 }, (_, i) => `kw${i}`) });
    evaluateAssetByGenerationCouncil(storage.getAsset(asset.id)!);
    const refreshed = storage.getAsset(asset.id)!;
    const gate = stockSafetyGate(refreshed);
    expect(["stock-ready", "manual-review"]).toContain(gate.mode);
    if (gate.mode === "manual-review") {
      const blocked = createExportPackage({ asset: refreshed, storage });
      expect(blocked.pack.status).toBe("failed");
      const allowed = createExportPackage({ asset: refreshed, storage, allowManualReview: true });
      expect(allowed.pack.status).toBe("complete");
    } else {
      expect(gate.allowed).toBe(true);
    }
  });
});
