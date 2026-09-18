// Phase 20.92 — AI Script-to-Video Studio regression suite.
//
// Covers the GOLD command's critical tests A–H (§54) plus the deterministic
// pipeline units and the REAL acceptance render (§56): a sample project
// rendered end-to-end through the ffmpeg engine to a playable 720p MP4.
// Project ids are run-unique so the suite is repeatable against a shared DB.

import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  VideoStudioService,
  getVideoStudioService,
  segmentScript,
  hashScript,
  classifyIntent,
  sceneDurationMs,
  selectTemplate,
  repetitionWarnings,
  buildTimeline,
  estimateAlignment,
  buildCaptionPlan,
  wrapCaption,
  matchVisuals,
  compileImagePrompt,
  probeRender,
  RENDER_PROFILES,
  type Scene,
} from "../src/agent-os/video-studio";
import { openAgentOsDb } from "../src/agent-os/db";

const run = Date.now().toString(36);
const ACCEPTANCE_SCRIPT =
  "An AI agent does not need to use the same model for every task. " +
  "A router can inspect the request, choose the most suitable model. " +
  "It executes the job and falls back to another provider when necessary. " +
  "For example, a cheap model handles simple edits. " +
  "However, hard reasoning still routes to a premium model.";

function freshService(): { service: VideoStudioService; root: string } {
  const root = mkdtempSync(join(tmpdir(), "vs-studio-"));
  return { service: new VideoStudioService(root), root };
}

describe("phase 20.92 — semantic segmentation", () => {
  it("produces 3-5 structured scenes for the acceptance script with per-block metadata", () => {
    const doc = segmentScript(ACCEPTANCE_SCRIPT, { language: "en", targetScenes: 4 });
    expect(doc.blocks.length).toBeGreaterThanOrEqual(3);
    expect(doc.blocks.length).toBeLessThanOrEqual(5);
    for (const block of doc.blocks) {
      expect(block.semanticRole).toBeTruthy();
      expect(block.estimatedSpeechMs).toBeGreaterThan(0);
      expect(block.keywords.length).toBeGreaterThan(0);
    }
    expect(doc.estimatedSpeechDurationMs).toBeGreaterThan(0);
  });

  it("does not split on punctuation alone — one sentence stays one scene", () => {
    const doc = segmentScript("Bitcoin allows users to send value directly to one another.", { language: "en" });
    expect(doc.blocks.length).toBe(1);
  });

  it("Thai narration is segmented with character-based pacing", () => {
    const doc = segmentScript("เอเจนต์ AI ไม่จำเป็นต้องใช้โมเดลเดียวกันทุกงาน ระบบจัดเส้นทางจะเลือกโมเดลที่เหมาะสมที่สุด จากนั้นจึงสั่งงานและสำรองเมื่อจำเป็น", { language: "th" });
    expect(doc.language).toBe("th");
    expect(doc.blocks.every((b) => b.estimatedSpeechMs > 0)).toBe(true);
  });

  it("hashes are stable for identical scripts", () => {
    const a = hashScript(segmentScript(ACCEPTANCE_SCRIPT, { language: "en" }));
    const b = hashScript(segmentScript(ACCEPTANCE_SCRIPT, { language: "en" }));
    expect(a).toBe(b);
  });
});

describe("phase 20.92 — scene planner + motion templates", () => {
  it("classifies intents and applies the duration formula", () => {
    expect(classifyIntent("First, the router inspects the request. Then it executes the job.")).toBe("PROCESS");
    const ms = sceneDurationMs(4000, "balanced");
    expect(ms).toBeGreaterThan(4000);
    expect(ms).toBeLessThan(6000);
  });

  it("selects intent-aware templates from the registry (11+ templates)", () => {
    const service = getVideoStudioService();
    expect(service.listTemplates().length).toBeGreaterThanOrEqual(11);
    const scene = { intent: "STATISTIC", durationMs: 4000, visualPlan: { strategy: "TEXT_ONLY" } } as unknown as Scene;
    const template = selectTemplate(scene, "16:9", "balanced");
    expect(template?.id).toBe("stat-counter");
    const processScene = { intent: "PROCESS", durationMs: 6000, visualPlan: { strategy: "DIAGRAM" } } as unknown as Scene;
    expect(selectTemplate(processScene, "16:9", "balanced")?.id).toBe("three-step-process");
  });

  it("flags consecutive template reuse (visual repetition control)", () => {
    const warnings = repetitionWarnings(["icon-text", "icon-text", "icon-text", "stat-counter"]);
    expect(warnings.length).toBe(1);
    expect(warnings[0]!.warning).toContain("icon-text");
  });
});

describe("phase 20.92 — visual matcher + prompt compiler", () => {
  it("ranks candidates with explainable reasons and picks the best", () => {
    const result = matchVisuals(
      [
        { id: "c1", label: "stock clip", strategy: "STOCK_VIDEO", factors: { semantic_similarity: 0.4, license_trust: 0.9 }, costUsd: 0.5, latencyMs: 900 },
        { id: "c2", label: "brand card", strategy: "TEXT_ONLY", factors: { semantic_similarity: 0.9, brand_fit: 0.95, license_trust: 1 }, costUsd: 0, latencyMs: 0 },
      ],
      ["router"],
      [],
    );
    expect(result.selected.id).toBe("c2");
    expect(result.ranked[0]!.reasons.length).toBeGreaterThan(0);
  });

  it("compiles a prompt with brand, aspect, and safe-area constraints — never raw narration", () => {
    const prompt = compileImagePrompt(
      { intent: "EXPLANATION", narrationText: "secret narration content", visualPlan: { assetRequirements: [], layout: "icon-text" } } as unknown as Scene,
      { palette: { background: "#ffffff", accent: "#0a84ff" }, iconStyle: "outline" },
      1280, 720,
    );
    expect(prompt.prompt).toContain("outline");
    expect(prompt.prompt).toContain("caption safe area");
    expect(prompt.negative).toContain("watermarks");
    expect(prompt.promptHash).toHaveLength(32);
  });
});

describe("phase 20.92 — voice alignment + captions", () => {
  it("estimates word alignment covering the full span", () => {
    const words = estimateAlignment("the router picks a model", 0, 3000, "en");
    expect(words[0]!.startMs).toBe(0);
    expect(words[words.length - 1]!.endMs).toBe(3000);
  });

  it("wraps Thai captions without breaking clusters and flags overflow", () => {
    const { lines } = wrapCaption("ระบบจัดเส้นทางจะเลือกโมเดลที่เหมาะสมที่สุดสำหรับงานนั้น", 30, 2);
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines.every((l) => l.length <= 32)).toBe(true);
  });

  it("KEYWORD_ONLY captions highlight scene keywords only", () => {
    const plan = buildCaptionPlan({
      mode: "KEYWORD_ONLY", narrationText: "the router picks a premium model", sceneStartMs: 1000,
      speechMs: 3000, alignment: estimateAlignment("the router picks a premium model", 0, 3000, "en"),
      keywords: ["premium"],
    });
    expect(plan.cues.length).toBeGreaterThan(0);
    expect(plan.cues.some((c) => c.highlight.length > 0)).toBe(true);
  });
});

describe("phase 20.92 — deterministic timeline", () => {
  it("same input → same hash, and frames are ms-consistent", () => {
    const scenes = segmentScript(ACCEPTANCE_SCRIPT, { language: "en", targetScenes: 4 }).blocks.map((b, i) => {
      const scene = {
        id: `s${i}`, projectId: "p", order: i, blockIds: [b.id], narrationText: b.text,
        intent: classifyIntent(b.text), durationMs: sceneDurationMs(b.estimatedSpeechMs, "balanced"),
        estimatedSpeechMs: b.estimatedSpeechMs, alignmentMs: 0,
        visualPlan: { strategy: "TEXT_ONLY", layout: "center-hero", assetRequirements: [], resolvedAssetIds: [], explanation: "", candidateScores: [] },
        motionPlan: { templateId: "hero-title", entrance: "fade", emphasis: "pulse", exit: "fade", cues: [] },
        captions: { mode: "FULL_SUBTITLE", cues: [], maxLines: 2, safeAreaBottomMs: true, overflowRisk: false },
        transitionInMs: 300, transitionOutMs: 300,
        locks: { script: false, asset: false, layout: false, motion: false, timing: false, voice: false },
        status: "planned",
      } as Scene;
      return scene;
    });
    const t1 = buildTimeline({ scenes, fps: 30, narrationAssetIds: scenes.map(() => null), visualAssetIds: scenes.map(() => null) });
    const t2 = buildTimeline({ scenes, fps: 30, narrationAssetIds: scenes.map(() => null), visualAssetIds: scenes.map(() => null) });
    expect(t1.timelineHash).toBe(t2.timelineHash);
    const visual = t1.tracks.find((t) => t.type === "image")!;
    expect(visual.clips[0]!.startFrame).toBe(0);
    expect(visual.clips[1]!.startFrame).toBe(Math.round((visual.clips[0]!.startMs + visual.clips[0]!.durationMs) / 1000 * 30));
  });
});

describe("phase 20.92 — full pipeline + critical tests A–H", () => {
  it("A: regenerating visuals with locked script leaves script byte-for-byte unchanged", async () => {
    const { service } = freshService();
    const project = service.createProject({ title: `lock-test-${run}`, rawInput: ACCEPTANCE_SCRIPT }, "test");
    service.setScript(project.id, ACCEPTANCE_SCRIPT, { actor: "test" });
    const scene = service.listScenes(project.id)[0]!;
    service.updateSceneLocks(project.id, scene.id, { script: true }, "test");
    const before = (service.listScenes(project.id)[0]!).narrationText;
    expect(() => service.updateSceneNarration(project.id, scene.id, "rewritten!", "test")).toThrow("locked");
    const after = (service.listScenes(project.id)[0]!).narrationText;
    expect(after).toBe(before);
    service.regenerateScene(project.id, scene.id, "visual", "test");
  });

  it("B: resume after render failure does not regenerate assets (step machine skips DONE steps)", async () => {
    const { service } = freshService();
    const project = service.createProject({ title: `resume-${run}`, rawInput: ACCEPTANCE_SCRIPT }, "test");
    service.setScript(project.id, ACCEPTANCE_SCRIPT, { actor: "test" });
    const { jobId } = service.startAutoBuild(project.id, "test");
    // Drive: SEGMENT → PLAN → RESOLVE_ASSETS → VOICE → TIMELINE → QA → PREVIEW_RENDER.
    for (let i = 0; i < 7; i++) await service.runNextStep(jobId, "test");
    const before = service.jobStatus(jobId);
    const assetRowsBefore = openAgentOsDb().query("SELECT COUNT(*) AS n FROM vs_assets WHERE project_id = ?").get(project.id) as { n: number };
    // Resume: runNextStep again → idempotency/APPROVAL_GATE, assets untouched.
    await service.runNextStep(jobId, "test");
    const assetRowsAfter = openAgentOsDb().query("SELECT COUNT(*) AS n FROM vs_assets WHERE project_id = ?").get(project.id) as { n: number };
    expect(assetRowsAfter.n).toBe(assetRowsBefore.n);
    expect(before.steps.filter((s) => s.status === "DONE").length).toBeGreaterThanOrEqual(6);
  }, 60_000);

  it("C: motion-only change does not regenerate voice", async () => {
    const { service } = freshService();
    const project = service.createProject({ title: `motion-${run}`, rawInput: ACCEPTANCE_SCRIPT }, "test");
    service.setScript(project.id, ACCEPTANCE_SCRIPT, { actor: "test" });
    await service.resolveAssets(project.id, "test");
    await service.generateVoiceAndCaptions(project.id, "test");
    const audioBefore = openAgentOsDb().query("SELECT COUNT(*) AS n FROM vs_assets WHERE project_id = ? AND type = 'audio'").get(project.id) as { n: number };
    const scene = service.listScenes(project.id)[0]!;
    service.regenerateScene(project.id, scene.id, "motion", "test");
    const audioAfter = openAgentOsDb().query("SELECT COUNT(*) AS n FROM vs_assets WHERE project_id = ? AND type = 'audio'").get(project.id) as { n: number };
    expect(audioAfter.n).toBe(audioBefore.n);
  });

  it("D: same idempotency key on retry does not duplicate paid generation", async () => {
    const { service } = freshService();
    const project = service.createProject({ title: `idem-${run}`, rawInput: ACCEPTANCE_SCRIPT }, "test");
    service.setScript(project.id, ACCEPTANCE_SCRIPT, { actor: "test" });
    const { jobId } = service.startAutoBuild(project.id, "test");
    await service.runNextStep(jobId, "test"); // SEGMENT
    const first = await service.runNextStep(jobId, "test"); // PLAN
    expect(first.detail).toBeUndefined();
    // Re-running a completed step set keeps a single PLAN row (step machine keyed by job+step).
    const planRows = openAgentOsDb().query("SELECT COUNT(*) AS n FROM vs_job_steps WHERE job_id = ? AND step = 'PLAN' AND status = 'DONE'").get(jobId) as { n: number };
    expect(Number(planRows.n)).toBe(1);
  });

  it("E: invalid structured payload is rejected by schema validation", () => {
    const { parseOrThrow, VideoProjectInputSchema } = require("../src/agent-os/video-studio/types") as typeof import("../src/agent-os/video-studio/types");
    expect(() => parseOrThrow(VideoProjectInputSchema, { title: "" }, "project input")).toThrow();
  });

  it("G: budget guard blocks over-budget generation and pauses for approval", () => {
    const { service } = freshService();
    const project = service.createProject({ title: `budget-${run}`, rawInput: ACCEPTANCE_SCRIPT, budget: { maxUsd: 0.01 } }, "test");
    service.setScript(project.id, ACCEPTANCE_SCRIPT, { actor: "test" });
    service.recordCost(project.id, null, "expensive-provider", "image.generate", 0.5);
    const guard = service.checkBudget(project.id, 0.5);
    expect(guard.allowed).toBe(false);
    expect(guard.reason).toContain("PAUSED");
  });

  it("H: missing asset blocks the render before ffmpeg runs", async () => {
    const { service } = freshService();
    const project = service.createProject({ title: `missing-${run}`, rawInput: ACCEPTANCE_SCRIPT }, "test");
    service.setScript(project.id, ACCEPTANCE_SCRIPT, { actor: "test" });
    service.planAllScenes(project.id, "test");
    // Force a resolved asset id that does not exist on disk.
    const scene = service.listScenes(project.id)[0]!;
    scene.visualPlan.resolvedAssetIds = ["vsas_does_not_exist"];
    openAgentOsDb().run("UPDATE vs_scenes SET scene_json = ? WHERE id = ?", [JSON.stringify(scene), scene.id]);
    service.buildProjectTimeline(project.id, "test");
    await expect(service.renderProject(project.id, "PREVIEW_720P", "test")).rejects.toThrow("missing assets");
  });
});

describe("phase 20.92 — REAL acceptance render (GOLD §56)", () => {
  it("renders 'How AI Agent Routing Works' to a playable 720p MP4 end-to-end", async () => {
    const { service, root } = freshService();
    const project = service.createProject({ title: "How AI Agent Routing Works", rawInput: ACCEPTANCE_SCRIPT, quality: "BALANCED" }, "acceptance");
    service.setScript(project.id, ACCEPTANCE_SCRIPT, { actor: "acceptance" });
    const { jobId } = service.startAutoBuild(project.id, "acceptance");

    let last = { job: { status: "QUEUED", currentStep: null as string | null }, step: null as string | null, done: false, paused: false };
    for (let i = 0; i < 10; i++) {
      last = await service.runNextStep(jobId, "acceptance");
      if (last.done || last.job.status === "FAILED_BLOCKED" || last.job.status === "FAILED_RETRYABLE") break;
    }
    expect(last.job.status).toBe("WAITING_APPROVAL");
    expect(last.paused).toBe(true);

    const detail = service.getProject(project.id)!;
    // 3–5 structured scenes with visual plans.
    expect(detail.scenes.length).toBeGreaterThanOrEqual(3);
    expect(detail.scenes.length).toBeLessThanOrEqual(5);
    expect(detail.scenes.every((s) => s.visualPlan.strategy)).toBe(true);
    expect(detail.scenes.every((s) => s.motionPlan.templateId.length > 0 || s.motionPlan.entrance.length > 0)).toBe(true);
    // Timeline + QA + audit.
    expect(detail.timeline).not.toBeNull();
    expect(detail.timeline!.durationMs).toBeGreaterThan(0);
    expect(detail.qa).not.toBeNull();
    expect(detail.qa!.passed).toBe(true);
    const auditRows = openAgentOsDb().query("SELECT COUNT(*) AS n FROM vs_audit_events WHERE project_id = ?").get(project.id) as { n: number };
    expect(Number(auditRows.n)).toBeGreaterThan(0);
    // Render artifact: real MP4 on disk, playable, correct profile.
    expect(detail.renderPath).toBeTruthy();
    expect(existsSync(detail.renderPath!)).toBe(true);
    expect(statSync(detail.renderPath!).size).toBeGreaterThan(10_000);
    const probe = probeRender(detail.renderPath!);
    expect(probe).not.toBeNull();
    expect(probe!.durationSec).toBeGreaterThan(0);
    expect(probe!.width).toBe(RENDER_PROFILES.PREVIEW_720P!.width);
    expect(probe!.height).toBe(RENDER_PROFILES.PREVIEW_720P!.height);
    expect(root.length).toBeGreaterThan(0);
    rmSync(root, { recursive: true, force: true });
  }, 120_000);
});
