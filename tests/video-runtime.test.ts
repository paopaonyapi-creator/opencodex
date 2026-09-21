import { describe, expect, it } from "bun:test";
import {
  DEFAULT_BRAND_PROFILE,
  MOBILE_9_16_TEMPLATE,
  MediaQcEvaluator,
  TimelineCompiler,
  createVideoMcpTools,
  type SceneDraft,
} from "../src/agent-os/video-runtime";

describe("Phase 20.88 — Pao-hubPro × Remotion AI Video Runtime", () => {
  describe("Timeline Compiler & Caption Alignment", () => {
    it("aligns word-level timestamps and generates kinetic caption segments", () => {
      const narration = "Master high performance agent workflows in minutes";
      const segments = TimelineCompiler.alignCaptions(narration, 0.0, 3.0, 30);

      expect(segments.length).toBeGreaterThanOrEqual(1);
      expect(segments[0].words).toHaveLength(4);
      expect(segments[0].startFrame).toBe(0);
      expect(segments[0].endFrame).toBeGreaterThan(0);
      expect(segments[0].words[0].word).toBe("Master");
    });

    it("compiles dynamic 6-scene narrative into frame-accurate composition", () => {
      const drafts: SceneDraft[] = [
        { type: "hook", title: "Hook", narrationText: "Stop scrolling right now", audioDurationSec: 2.5 },
        { type: "problem", title: "Problem", narrationText: "Editing videos manually takes all day", audioDurationSec: 3.0 },
        { type: "solution", title: "Solution", narrationText: "Use video as code with Remotion", audioDurationSec: 3.5 },
        { type: "workflow", title: "Workflow", narrationText: "Render directly from your terminal", audioDurationSec: 3.0 },
        { type: "benefit", title: "Benefit", narrationText: "Scale batch variations with zero lag", audioDurationSec: 2.5 },
        { type: "cta", title: "CTA", narrationText: "Check the link in bio to build yours", audioDurationSec: 2.5 },
      ];

      const comp = TimelineCompiler.compile(drafts, MOBILE_9_16_TEMPLATE, DEFAULT_BRAND_PROFILE);

      expect(comp.width).toBe(1080);
      expect(comp.height).toBe(1920);
      expect(comp.fps).toBe(30);
      expect(comp.scenes).toHaveLength(6);
      expect(comp.durationSeconds).toBe(17.0);
      expect(comp.totalFrames).toBe(510); // 17.0s * 30fps
      expect(comp.scenes[0].captions.length).toBeGreaterThan(0);
    });
  });

  describe("Automated Media QC & Reviewer Council Gate", () => {
    it("passes compliant 1080p short-form composition", () => {
      const drafts: SceneDraft[] = [
        { type: "hook", title: "Hook", narrationText: "Clean compliant mobile video", audioDurationSec: 4.0 },
        { type: "cta", title: "CTA", narrationText: "Follow for more AI insights", audioDurationSec: 3.0 },
      ];
      const comp = TimelineCompiler.compile(drafts, MOBILE_9_16_TEMPLATE, DEFAULT_BRAND_PROFILE);

      const qc = MediaQcEvaluator.evaluate(comp);
      expect(qc.passed).toBe(true);
      expect(qc.score).toBeGreaterThanOrEqual(75);
      expect(qc.checks.resolutionCheck).toBe(true);
      expect(qc.checks.safeAreaCheck).toBe(true);

      const gate = MediaQcEvaluator.evaluateRenderGate(qc);
      expect(gate.allowed).toBe(true);
      expect(gate.reason).toContain("authorized for worker queue");
    });

    it("blocks compositions violating standard resolutions or safe areas", () => {
      const drafts: SceneDraft[] = [
        { type: "hook", title: "Hook", narrationText: "Low resolution test video", audioDurationSec: 5.0 },
      ];
      const badTemplate = { ...MOBILE_9_16_TEMPLATE, width: 640, height: 480 };
      const comp = TimelineCompiler.compile(drafts, badTemplate, { ...DEFAULT_BRAND_PROFILE, safeZonePaddingPx: 10 });

      const qc = MediaQcEvaluator.evaluate(comp);
      expect(qc.passed).toBe(false);
      expect(qc.checks.resolutionCheck).toBe(false);
      expect(qc.checks.safeAreaCheck).toBe(false);

      // Blocked by gate without human override
      const gate = MediaQcEvaluator.evaluateRenderGate(qc);
      expect(gate.allowed).toBe(false);
      expect(gate.reason).toContain("blocked by Media QC Gate");

      // Allowed with explicit supervisor override
      const overrideGate = MediaQcEvaluator.evaluateRenderGate(qc, {
        forceOverride: true,
        humanApproved: true,
      });
      expect(overrideGate.allowed).toBe(true);
      expect(overrideGate.reason).toContain("explicit human supervisor override");
    });
  });

  describe("Video MCP Tools", () => {
    it("plans, compiles, runs QC, and queues render through MCP tools", async () => {
      const tools = createVideoMcpTools();
      expect(tools).toHaveLength(4);

      // 1. Plan scenes
      const planTool = tools.find((t) => t.name === "video.plan_scenes")!;
      const planRes = await planTool.handler({ topic: "Pao-hubPro AI Agent Architecture" });
      expect(planRes.ok).toBe(true);
      expect(planRes.sceneCount).toBe(6);

      // 2. Compile timeline
      const compileTool = tools.find((t) => t.name === "video.compile_timeline")!;
      const compileRes = await compileTool.handler({
        title: "Agent Architecture Explainer",
        scenes: planRes.scenesDraft,
      });
      expect(compileRes.ok).toBe(true);
      expect(compileRes.jobId).toBeDefined();

      // 3. Run QC
      const qcTool = tools.find((t) => t.name === "video.run_qc")!;
      const qcRes = await qcTool.handler({ jobId: compileRes.jobId });
      expect(qcRes.ok).toBe(true);
      expect(qcRes.qcPassed).toBe(true);

      // 4. Queue render
      const renderTool = tools.find((t) => t.name === "video.queue_render")!;
      const renderRes = await renderTool.handler({
        jobId: compileRes.jobId,
        humanApproved: true,
      });
      expect(renderRes.ok).toBe(true);
      expect(renderRes.status).toBe("completed");
      expect((renderRes.renderOutput as { format: string }).format).toBe("mp4");
    });
  });
});
