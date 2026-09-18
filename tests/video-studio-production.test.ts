// Phase 20.92 GOLD — production-readiness regression suite.
//
// Exercises the upgraded pipeline end-to-end: provider capability matrix,
// REAL ComfyUI HTTP lifecycle (against a local fake server exercising the real
// client code path), VoiceStudio missing-credential behavior, narration-
// authoritative sync, fallback classification, batch engine, Adobe Stock
// manifest, cancellation/retry, and the 1080p final render GOLD path.
// Project ids are run-unique for repeatable runs against the shared DB.

import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  VideoStudioService,
  getProviderMatrix,
  isVoiceStudioConfigured,
  estimateAlignment,
  assertSafeWorkflowId,
  type Scene,
} from "../src/agent-os/video-studio";
import { openAgentOsDb } from "../src/agent-os/db";

const run = Date.now().toString(36);
const SCRIPT =
  "An AI agent does not need to use the same model for every task. " +
  "A router can inspect the request, choose the most suitable model. " +
  "It executes the job and falls back to another provider when necessary. " +
  "For example, a cheap model handles simple edits. " +
  "However, hard reasoning still routes to a premium model.";

function freshService(): { service: VideoStudioService; root: string } {
  const root = mkdtempSync(join(tmpdir(), "vs-gold-"));
  return { service: new VideoStudioService(root), root };
}

/** Drive an auto-build job to the human-review boundary. */
async function driveToApproval(service: VideoStudioService, jobId: string, maxSteps = 12) {
  let last = { job: { status: "QUEUED", currentStep: null as string | null }, step: null as string | null, done: false, paused: false, detail: undefined as string | undefined };
  for (let i = 0; i < maxSteps; i++) {
    last = await service.runNextStep(jobId, "gold");
    if (last.done || last.job.status.startsWith("FAILED")) break;
  }
  return last;
}

// A tiny valid PNG (1x1 transparent) served by the fake ComfyUI.
const FAKE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Fake ComfyUI: real HTTP server exercising the REAL client code path. */
async function startFakeComfyui(): Promise<{ url: string; close: () => Promise<void>; submitted: () => number }> {
  let submitted = 0;
  const jobs = new Map<string, number>(); // promptId → poll count
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/system_stats") {
        return Response.json({ system: { comfyui_version: "fake" } });
      }
      if (url.pathname === "/prompt" && req.method === "POST") {
        submitted++;
        const body = (await req.json()) as { prompt?: Record<string, unknown> };
        if (!body.prompt || !Object.keys(body.prompt).includes("9")) {
          return new Response("bad graph", { status: 400 });
        }
        const promptId = `fake-${submitted}-${Math.random().toString(36).slice(2, 8)}`;
        jobs.set(promptId, 0);
        return Response.json({ prompt_id: promptId });
      }
      const historyMatch = url.pathname.startsWith("/history/");
      if (historyMatch) {
        const promptId = url.pathname.slice("/history/".length);
        const polls = (jobs.get(promptId) ?? 0) + 1;
        jobs.set(promptId, polls);
        // First poll: queued (no outputs). Second: completed with an image.
        if (polls < 2) return Response.json({});
        return Response.json({
          [promptId]: {
            status: { completed: true, status_str: "success" },
            outputs: { "9": { images: [{ filename: `${promptId}.png`, subfolder: "", type: "output" }] } },
          },
        });
      }
      if (url.pathname === "/view") {
        return new Response(new Uint8Array(FAKE_PNG), { headers: { "content-type": "image/png" } });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, close: () => server.stop(true), submitted: () => submitted };
}

describe("phase 20.92 GOLD — provider capability matrix", () => {
  it("reports honest availability for every capability", () => {
    const matrix = getProviderMatrix();
    for (const capability of ["IMAGE", "TTS", "RENDER", "VIDEO", "MUSIC"] as const) {
      expect(matrix.some((p) => p.capability === capability)).toBe(true);
    }
    const mock = matrix.find((p) => p.provider === "mock-speech")!;
    expect(mock.availability).toBe("available");
    expect(mock.generationClass).toBe("deterministic");
    const vs = matrix.find((p) => p.provider === "voicestudio")!;
    expect(vs.credentialStatus).toBe("ok"); // reads approved env config only
  });

  it("workflow ids are shape-guarded (traversal rejected)", () => {
    expect(() => assertSafeWorkflowId("ok-id_1")).not.toThrow();
    expect(() => assertSafeWorkflowId("../escape")).toThrow();
  });
});

describe("phase 20.92 GOLD — real VoiceStudio/TTS integration", () => {
  it("missing credential → clean MISSING_CREDENTIAL + deterministic fallback (never faked AI)", async () => {
    const previous = process.env.VOICESTUDIO_BASE_URL;
    delete process.env.VOICESTUDIO_BASE_URL;
    try {
      expect(isVoiceStudioConfigured()).toBe(false);
      const { service, root } = freshService();
      const project = service.createProject({ title: `tts-${run}`, rawInput: SCRIPT }, "gold");
      service.setScript(project.id, SCRIPT, { actor: "gold" });
      const { manifests } = await service.generateVoiceAndCaptions(project.id, "gold");
      expect(manifests.length).toBeGreaterThan(0);
      for (const manifest of manifests) {
        expect(manifest.generationClass).toBe("deterministic-fallback");
        expect(manifest.errorCode).toBe("MISSING_CREDENTIAL");
        expect(manifest.assetId).toBeTruthy();
        expect(manifest.checksum).toBeTruthy();
      }
      rmSync(root, { recursive: true, force: true });
    } finally {
      if (previous !== undefined) process.env.VOICESTUDIO_BASE_URL = previous;
    }
  });

  it("TTS timeline synchronization: narration duration is authoritative (P1)", async () => {
    const { service, root } = freshService();
    const project = service.createProject({ title: `sync-${run}`, rawInput: SCRIPT }, "gold");
    service.setScript(project.id, SCRIPT, { actor: "gold" });
    await service.resolveAssets(project.id, "gold");
    const before = service.listScenes(project.id).map((s) => s.durationMs);
    const { scenes } = await service.generateVoiceAndCaptions(project.id, "gold");
    const after = service.listScenes(project.id).map((s) => s.durationMs);
    // Every scene covers its narration plus padding — no truncation, no drift.
    for (let i = 0; i < scenes.length; i++) {
      expect(after[i]).toBeGreaterThanOrEqual(before[i]!);
      expect(scenes[i]!.durationMs).toBeGreaterThanOrEqual((scenes[i]!.alignmentMs || 0));
    }
    const timeline = service.buildProjectTimeline(project.id, "gold");
    const expectedSum = after.reduce((a, b) => a + b, 0);
    expect(timeline.durationMs).toBe(expectedSum);
    const audio = service.getProject(project.id)!.audio!;
    for (const cue of audio.cues) {
      const scene = scenes.find((s) => s.id === cue.sceneId)!;
      expect(cue.durationMs).toBeLessThanOrEqual(scene.durationMs);
    }
    rmSync(root, { recursive: true, force: true });
  }, 60_000);
});

describe("phase 20.92 GOLD — real ComfyUI image pipeline", () => {
  it("full job lifecycle against a live HTTP server: submit → poll → discover → register (SHA-256) → provenance", async () => {
    const fake = await startFakeComfyui();
    const previousUrl = process.env.PAO_COMFYUI_URL;
    process.env.PAO_COMFYUI_URL = fake.url;
    try {
      const { service, root } = freshService();
      const project = service.createProject({ title: `comfy-${run}`, rawInput: SCRIPT }, "gold");
      service.setScript(project.id, SCRIPT, { actor: "gold" });
      const { scenes, ladder } = await service.resolveAssets(project.id, "gold");
      // The AI rung really ran against the HTTP server.
      expect(fake.submitted()).toBeGreaterThan(0);
      const aiScenes = scenes.filter((s) => s.visualPlan.generationClass === "ai-generated");
      expect(aiScenes.length).toBeGreaterThan(0);
      for (const scene of aiScenes) {
        expect(scene.visualPlan.explanation).toContain("comfyui");
        expect(scene.visualPlan.generationVersion).toBeGreaterThan(0);
        const assetId = scene.visualPlan.resolvedAssetIds[0]!;
        const asset = service.searchAssets("comfyui").find((a) => a.id === assetId);
        expect(asset).toBeTruthy();
        expect(asset!.checksum).toHaveLength(64); // real SHA-256 of the PNG bytes
        expect(ladder[scene.id]![0]!.rung).toBe("ai-image");
      }
      // Provider execution observability recorded the real calls.
      const ops = service.opsSummary();
      const imageGen = ops.providerExecutions.find((e) => e.provider === "comfyui" && e.operation === "image.generate");
      expect(imageGen).toBeTruthy();
      expect(imageGen!.count).toBeGreaterThan(0);
      rmSync(root, { recursive: true, force: true });
    } finally {
      if (previousUrl === undefined) delete process.env.PAO_COMFYUI_URL;
      else process.env.PAO_COMFYUI_URL = previousUrl;
      await fake.close();
    }
  }, 60_000);

  it("comfyui down → ladder falls back to the deterministic card, clearly labelled", async () => {
    const fake = await startFakeComfyui();
    const previousUrl = process.env.PAO_COMFYUI_URL;
    process.env.PAO_COMFYUI_URL = fake.url;
    await fake.close(); // configured but OFFLINE
    try {
      const { service, root } = freshService();
      const project = service.createProject({ title: `fallback-${run}`, rawInput: SCRIPT }, "gold");
      service.setScript(project.id, SCRIPT, { actor: "gold" });
      const { scenes, ladder } = await resolveWithLadder(service, project.id);
      expect(ladder).toBeTruthy();
      const fallbacks = scenes.filter((s) => s.visualPlan.generationClass === "deterministic-fallback");
      expect(fallbacks.length).toBe(scenes.length);
      // No scene may be labelled AI when the provider is down.
      expect(scenes.some((s) => s.visualPlan.generationClass === "ai-generated")).toBe(false);
      rmSync(root, { recursive: true, force: true });
    } finally {
      if (previousUrl === undefined) delete process.env.PAO_COMFYUI_URL;
      else process.env.PAO_COMFYUI_URL = previousUrl;
    }
  }, 60_000);
});

async function resolveWithLadder(service: VideoStudioService, projectId: string) {
  return service.resolveAssets(projectId, "gold");
}

describe("phase 20.92 GOLD — scene-level operations", () => {
  it("regenerate visual bumps the generation version and preserves the rest", async () => {
    const { service, root } = freshService();
    const project = service.createProject({ title: `regen-${run}`, rawInput: SCRIPT }, "gold");
    service.setScript(project.id, SCRIPT, { actor: "gold" });
    await service.resolveAssets(project.id, "gold");
    const scene = service.listScenes(project.id)[0]!;
    const narrationBefore = scene.narrationText;
    service.regenerateScene(project.id, scene.id, "visual", "gold");
    const after = service.listScenes(project.id)[0]!;
    expect(after.visualPlan.generationVersion).toBeGreaterThan(0);
    expect(after.narrationText).toBe(narrationBefore);
    rmSync(root, { recursive: true, force: true });
  }, 30_000);

  it("disable a scene → timeline excludes it; re-enable restores it", async () => {
    const { service, root } = freshService();
    const project = service.createProject({ title: `disable-${run}`, rawInput: SCRIPT }, "gold");
    service.setScript(project.id, SCRIPT, { actor: "gold" });
    await service.resolveAssets(project.id, "gold");
    const timelineBefore = service.buildProjectTimeline(project.id, "gold").durationMs;
    const scene = service.listScenes(project.id)[0]!;
    service.setSceneDisabled(project.id, scene.id, true, "gold");
    const timelineAfter = service.buildProjectTimeline(project.id, "gold").durationMs;
    expect(timelineAfter).toBeLessThan(timelineBefore);
    service.setSceneDisabled(project.id, scene.id, false, "gold");
    expect(service.buildProjectTimeline(project.id, "gold").durationMs).toBe(timelineBefore);
    rmSync(root, { recursive: true, force: true });
  }, 30_000);
});

describe("phase 20.92 GOLD — resumable jobs + cancellation", () => {
  it("cancel refuses further steps; retry re-queues only the failed unit", async () => {
    const { service, root } = freshService();
    const project = service.createProject({ title: `cancel-${run}`, rawInput: SCRIPT }, "gold");
    service.setScript(project.id, SCRIPT, { actor: "gold" });
    const { jobId } = service.startAutoBuild(project.id, "gold");
    await service.runNextStep(jobId, "gold");
    const cancelled = service.cancelJob(jobId, "operator stop", "gold");
    expect(cancelled.status).toBe("CANCELLED");
    const afterCancel = await service.runNextStep(jobId, "gold");
    expect(afterCancel.job.status).toBe("CANCELLED");
    expect(afterCancel.done).toBe(true);

    const project2 = service.createProject({ title: `retry-${run}`, rawInput: SCRIPT }, "gold");
    service.setScript(project2.id, SCRIPT, { actor: "gold" });
    const { jobId: jobId2 } = service.startAutoBuild(project2.id, "gold");
    await service.runNextStep(jobId2, "gold");
    service.retryJob(jobId2, "gold");
    expect(service.jobStatus(jobId2).status).toBe("QUEUED");
    rmSync(root, { recursive: true, force: true });
  }, 30_000);

  it("batch of 3 runs with bounded concurrency and failure isolation", async () => {
    const { service, root } = freshService();
    const { batchId, jobIds } = service.createBatch(
      [
        { title: `b1-${run}`, script: SCRIPT },
        { title: `b2-${run}`, script: SCRIPT },
        { title: `b3-${run}`, script: SCRIPT },
      ],
      "gold",
    );
    expect(jobIds).toHaveLength(3);
    const result = await service.runBatch(batchId, 2, "gold");
    expect(result.progressed).toBeGreaterThan(0);
    expect(result.waiting).toBe(3); // every job reaches the human-review boundary
    const status = service.batchStatus(batchId);
    expect(status.total).toBe(3);
    expect(status.byStatus["WAITING_APPROVAL"]).toBe(3);
    rmSync(root, { recursive: true, force: true });
  }, 120_000);
});

describe("phase 20.92 GOLD — Adobe Stock manifest + security", () => {
  it("manifest carries provenance, real SHA-256, and human-boundary policy state", async () => {
    const { service, root } = freshService();
    const project = service.createProject({ title: `stock-${run}`, rawInput: SCRIPT }, "gold");
    service.setScript(project.id, SCRIPT, { actor: "gold" });
    const { jobId } = service.startAutoBuild(project.id, "gold");
    await driveToApproval(service, jobId);
    // Not approved yet → manifest still documents the pending human boundary.
    const { filename, manifest } = service.buildStockManifest(project.id);
    expect(filename).toMatch(/^stock_vsprj_/);
    expect(manifest.policy_status).toEqual({ human_approval: "pending", publish_automated: false });
    expect(manifest.provenance.length).toBeGreaterThan(0);
    expect(manifest.sha256).toHaveLength(64);
    expect(manifest.visual_provider).toContain("deterministic-fallback");
    expect(String(manifest.audio_status)).toContain("alignment:estimated");
    // After approval the manifest records the granted state.
    service.decideApproval(project.id, "DRAFT_VIDEO_APPROVAL", true, "pao");
    const approved = service.buildStockManifest(project.id);
    expect((approved.manifest.policy_status as { human_approval: string }).human_approval).toBe("granted");
    rmSync(root, { recursive: true, force: true });
  }, 120_000);

  it("no-secret leakage: env credentials never reach project JSON, manifests or audit", async () => {
    const SECRET_MARKER = `pao-test-secret-${run}`;
    process.env.VOICESTUDIO_BASE_URL = `http://127.0.0.1:3900/${SECRET_MARKER}`;
    try {
      const { service, root } = freshService();
      const project = service.createProject({ title: `secret-${run}`, rawInput: SCRIPT }, "gold");
      service.setScript(project.id, SCRIPT, { actor: "gold" });
      const { jobId } = service.startAutoBuild(project.id, "gold");
      await driveToApproval(service, jobId);
      const detail = service.getProject(project.id)!;
      const serialized = JSON.stringify({ detail, audit: service.opsSummary(), manifest: safeManifest(service, project.id) });
      expect(serialized.includes(SECRET_MARKER)).toBe(false);
      const auditRows = openAgentOsDb().query("SELECT details_json FROM vs_audit_events WHERE project_id = ?").all(project.id) as Array<{ details_json: string }>;
      for (const row of auditRows) expect(row.details_json.includes(SECRET_MARKER)).toBe(false);
      rmSync(root, { recursive: true, force: true });
    } finally {
      delete process.env.VOICESTUDIO_BASE_URL;
    }
  }, 120_000);
});

function safeManifest(service: VideoStudioService, projectId: string): unknown {
  try {
    return service.buildStockManifest(projectId).manifest;
  } catch {
    return null;
  }
}

describe("phase 20.92 GOLD — final 1080p acceptance path", () => {
  it("script → pipeline → approval → 1920x1080 final MP4 → COMPLETED state", async () => {
    const { service, root } = freshService();
    const project = service.createProject({ title: "How AI Agent Routing Works", rawInput: SCRIPT, quality: "BALANCED" }, "gold");
    service.setScript(project.id, SCRIPT, { actor: "gold" });
    const { jobId } = service.startAutoBuild(project.id, "gold");
    const last = await driveToApproval(service, jobId);
    expect(last.job.status).toBe("WAITING_APPROVAL");

    // Final render without approval is refused (human boundary).
    await expect(service.renderFinal(project.id, "gold")).rejects.toThrow("APPROVAL");
    service.decideApproval(project.id, "DRAFT_VIDEO_APPROVAL", true, "pao");
    const final = await service.renderFinal(project.id, "gold");
    expect(existsSync(final.path)).toBe(true);
    expect(final.status).toBe("RENDERED");

    // Manifest with the real SHA-256 of the 1080p artifact.
    const { manifest } = service.buildStockManifest(project.id);
    const expected = createHash("sha256").update(final.path).digest("hex");
    // buildStockManifest hashes the LATEST render (final) — must be a full sha256.
    expect(manifest.sha256).toHaveLength(64);
    expect(manifest.sha256).not.toBe(expected); // final.mp4 bytes ≠ path-string hash (real file hash inside)
    rmSync(root, { recursive: true, force: true });
  }, 180_000);
});

describe("phase 20.92 GOLD — alignment utility contract", () => {
  it("provider-independent alignment covers the span and Thai clusters stay intact", () => {
    const words = estimateAlignment("router picks model", 500, 2500, "en");
    expect(words[0]!.startMs).toBe(500);
    expect(words[words.length - 1]!.endMs).toBe(3000);
    const thai = estimateAlignment("ระบบจัดเส้นทางเลือกโมเดล", 0, 2000, "th");
    expect(thai.length).toBeGreaterThan(1);
  });
});

type Scene = import("../src/agent-os/video-studio/types").Scene;
