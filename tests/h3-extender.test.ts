// Phase 21.02 — Pao-hubPro × MiniMax H3 Extender test suite.

import { describe, expect, it } from "bun:test";
import { openAgentOsDb, AGENT_OS_SCHEMA_VERSION } from "../src/agent-os/db";
import {
  getH3ExtenderService,
  createH3McpTools,
  computeGenerationHash,
} from "../src/agent-os/h3-extender";

describe("Phase 21.02 — MiniMax H3 Extender Video Execution Plane", () => {
  // -------------------------------------------------------------------------
  // 1. Schema & DB State Plane (§26)
  // -------------------------------------------------------------------------
  describe("Schema & DB State Plane", () => {
    it("reports schema version at least 74", () => {
      expect(AGENT_OS_SCHEMA_VERSION).toBeGreaterThanOrEqual(74);
    });

    it("verifies all h3_* tables exist and accept queries", () => {
      const db = openAgentOsDb();
      const tables = [
        "h3_projects",
        "h3_clips",
        "h3_clip_attempts",
        "h3_assets",
        "h3_clip_references",
        "h3_clip_loras",
        "h3_clip_guides",
        "h3_extender_jobs",
        "h3_approvals",
        "h3_audit_events",
      ];
      for (const table of tables) {
        const row = db.query(`SELECT COUNT(*) as count FROM ${table}`).get() as any;
        expect(row).toBeDefined();
        expect(typeof row.count).toBe("number");
      }
    });
  });

  // -------------------------------------------------------------------------
  // 2. Project & Clip Planning (§8, §13)
  // -------------------------------------------------------------------------
  describe("Project & Clip Planning", () => {
    it("creates an H3 project and adds sequenced scene clips with deterministic hashes", () => {
      const svc = getH3ExtenderService();
      const project = svc.createProject("Commercial Energy Drink 15s", "continuous", 5.0);
      expect(project.id).toBeDefined();
      expect(project.name).toBe("Commercial Energy Drink 15s");
      expect(project.status).toBe("draft");

      const clip0 = svc.addClip(project.id, 0, { subject: "cold condensation can", action: "macro rotating shot" }, 5.0, "42");
      expect(clip0.id).toBeDefined();
      expect(clip0.sequenceIndex).toBe(0);
      expect(clip0.state).toBe("draft");
      expect(clip0.generationHash).toBeDefined();

      const clip1 = svc.addClip(project.id, 1, { subject: "athlete drinking", action: "drinking and smiling" }, 5.0, "43");
      expect(clip1.sequenceIndex).toBe(1);

      const clips = svc.listClips(project.id);
      expect(clips.length).toBe(2);
      expect(clips[0].sequenceIndex).toBe(0);
      expect(clips[1].sequenceIndex).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Generation, Validation & Invalidation Engine (§13, §14, §15)
  // -------------------------------------------------------------------------
  describe("Generation, Validation & Invalidation Engine", () => {
    it("generates preview attempt, validates, and invalidates when prompt mutates", () => {
      const svc = getH3ExtenderService();
      const project = svc.createProject("Coffee B-roll", "continuous");
      const clip = svc.addClip(project.id, 0, { prompt: "espresso pouring into cup" }, 4.0, "101");

      // 1. Generate preview
      const attempt = svc.generateClip(clip.id);
      expect(attempt.attemptNumber).toBe(1);
      expect(attempt.status).toBe("success");

      const updatedClip = svc.getClip(clip.id)!;
      expect(updatedClip.state).toBe("preview_ready");
      expect(updatedClip.activeAttemptId).toBe(attempt.id);

      // 2. Validate clip
      const validatedClip = svc.validateClip(clip.id, "senior-editor");
      expect(validatedClip.state).toBe("validated");
      expect(validatedClip.validatedById).toBe("senior-editor");
      expect(validatedClip.validatedHash).toBe(validatedClip.generationHash);

      // 3. Mutating prompt invalidates validation state (§15)
      const mutatedClip = svc.updateClipPrompt(clip.id, { prompt: "espresso pouring into glass with cream" });
      expect(mutatedClip.state).toBe("draft");
      expect(mutatedClip.validatedHash).toBeNull();
      expect(mutatedClip.validatedAt).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 4. MCP Tools Integration
  // -------------------------------------------------------------------------
  describe("MCP Tools Integration", () => {
    it("registers pao.video.h3.* tools and creates projects through MCP", async () => {
      const tools = createH3McpTools();
      expect(tools.length).toBe(4);

      const createTool = tools.find((t) => t.name === "pao.video.h3.project.create");
      expect(createTool).toBeDefined();

      const result = await createTool!.handler({ name: "MCP Generated Video", productionMode: "continuous" });
      expect(result.ok).toBe(true);
      expect((result.project as any).name).toBe("MCP Generated Video");
    });
  });
});
