import { beforeEach, describe, expect, it } from "bun:test";
import {
  VIDEO_INTELLIGENCE_MCP_TOOLS,
  resetVideoJobManager,
  type WebMcpToolDefinition,
} from "../src/agent-os/video-intelligence";

describe("Phase 20.13 — Video Intelligence MCP Tools", () => {
  beforeEach(() => {
    resetVideoJobManager();
  });

  function getTool(name: string): WebMcpToolDefinition {
    const tool = VIDEO_INTELLIGENCE_MCP_TOOLS.find((t) => t.name === name);
    if (!tool) throw new Error(`MCP tool ${name} not found`);
    return tool;
  }

  it("exports exactly 11 valid WebMCP tools with appropriate metadata", () => {
    expect(VIDEO_INTELLIGENCE_MCP_TOOLS.length).toBe(11);
    for (const tool of VIDEO_INTELLIGENCE_MCP_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(["R0", "R1", "R2", "R3", "R4"]).toContain(tool.riskTier);
      expect(typeof tool.readOnly).toBe("boolean");
      expect(typeof tool.execute).toBe("function");
    }
  });

  describe("Validation on missing arguments", () => {
    it("video_analyze throws when source is missing", async () => {
      const tool = getTool("video_analyze");
      expect(tool.execute({})).rejects.toThrow("Missing required 'source' argument");
    });

    it("video_inspect throws when source is missing", async () => {
      const tool = getTool("video_inspect");
      expect(tool.execute({})).rejects.toThrow("Missing 'source'");
    });

    it("video_transcribe throws when source is missing", async () => {
      const tool = getTool("video_transcribe");
      expect(tool.execute({})).rejects.toThrow("Missing 'source'");
    });

    it("video_extract_frames throws when source is missing", async () => {
      const tool = getTool("video_extract_frames");
      expect(tool.execute({})).rejects.toThrow("Missing 'source'");
    });

    it("video_analyze_hook throws when source is missing", async () => {
      const tool = getTool("video_analyze_hook");
      expect(tool.execute({})).rejects.toThrow("Missing 'source'");
    });

    it("video_analyze_pacing throws when source is missing", async () => {
      const tool = getTool("video_analyze_pacing");
      expect(tool.execute({})).rejects.toThrow("Missing 'source'");
    });

    it("video_stock_qc throws when source is missing", async () => {
      const tool = getTool("video_stock_qc");
      expect(tool.execute({})).rejects.toThrow("Missing 'source'");
    });

    it("video_debug_screen throws when source is missing", async () => {
      const tool = getTool("video_debug_screen");
      expect(tool.execute({})).rejects.toThrow("Missing 'source'");
    });

    it("video_get_report throws when job_id is missing or not found", async () => {
      const tool = getTool("video_get_report");
      expect(() => tool.execute({})).toThrow("Missing 'job_id'");
      expect(() => tool.execute({ job_id: "nonexistent" })).toThrow("not found");
    });

    it("video_cancel_job throws when job_id is missing", async () => {
      const tool = getTool("video_cancel_job");
      expect(() => tool.execute({})).toThrow("Missing 'job_id'");
    });
  });

  describe("Execution of analysis tools", () => {
    const dummySource = "https://example.com/sample_video.mp4";

    it("video_inspect probes video metadata", async () => {
      const tool = getTool("video_inspect");
      const res = (await tool.execute({ source: dummySource })) as any;
      expect(res).toBeDefined();
      expect(res.aspectRatio).toBeDefined();
      expect(res.durationSec).toBeGreaterThan(0);
      expect(res.width).toBeGreaterThan(0);
      expect(res.height).toBeGreaterThan(0);
      expect(res.videoCodec).toBeDefined();
    });

    it("video_transcribe extracts transcript segments", async () => {
      const tool = getTool("video_transcribe");
      const res = (await tool.execute({ source: dummySource, local_only: true })) as any;
      expect(res).toBeDefined();
      expect(res.provider).toBeDefined();
      expect(Array.isArray(res.segments)).toBe(true);
    });

    it("video_extract_frames extracts scenes and hero frames", async () => {
      const tool = getTool("video_extract_frames");
      const res = (await tool.execute({ source: dummySource, sampling: "uniform" })) as any;
      expect(res).toBeDefined();
      expect(Array.isArray(res.scenes)).toBe(true);
      expect(Array.isArray(res.heroFrames)).toBe(true);
    });

    it("video_analyze_hook evaluates hook retention", async () => {
      const tool = getTool("video_analyze_hook");
      const res = (await tool.execute({ source: dummySource })) as any;
      expect(res).toBeDefined();
      expect(typeof res.visualHookScore).toBe("number");
      expect(typeof res.openingType).toBe("string");
      expect(Array.isArray(res.timeline)).toBe(true);
    });

    it("video_analyze_pacing computes editorial pacing metrics", async () => {
      const tool = getTool("video_analyze_pacing");
      const res = (await tool.execute({ source: dummySource })) as any;
      expect(res).toBeDefined();
      expect(typeof res.cutsPerMinute).toBe("number");
      expect(typeof res.rhythmProfile).toBe("string");
    });

    it("video_stock_qc validates against Adobe Stock standards", async () => {
      const tool = getTool("video_stock_qc");
      const res = (await tool.execute({ source: dummySource })) as any;
      expect(res).toBeDefined();
      expect(typeof res.verdict).toBe("string");
      expect(Array.isArray(res.issues)).toBe(true);
      expect(Array.isArray(res.recommendations)).toBe(true);
    });
  });

  describe("Job lifecycle management tools", () => {
    const dummySource = "https://example.com/sample_job.mp4";

    it("video_analyze submits a job and video_list_jobs lists it", async () => {
      const analyzeTool = getTool("video_analyze");
      const listTool = getTool("video_list_jobs");

      const job = (await analyzeTool.execute({
        source: dummySource,
        intent: "general",
        local_only: true,
      })) as any;

      expect(job).toBeDefined();
      expect(job.id).toMatch(/^vjob_/);
      expect(job.status).toBeDefined();

      const list = (await listTool.execute({ limit: 10 })) as any[];
      expect(list.length).toBeGreaterThan(0);
      expect(list.some((j) => j.id === job.id)).toBe(true);
    });

    it("video_debug_screen submits a screen_debug job", async () => {
      const tool = getTool("video_debug_screen");
      const job = (await tool.execute({ source: dummySource })) as any;
      expect(job).toBeDefined();
      expect(job.id).toMatch(/^vjob_/);
      expect(job.config.intent).toBe("screen_debug");
    });

    it("video_cancel_job cancels an active job", async () => {
      const analyzeTool = getTool("video_analyze");
      const cancelTool = getTool("video_cancel_job");

      const job = (await analyzeTool.execute({ source: dummySource })) as any;
      const cancelRes = (await cancelTool.execute({ job_id: job.id })) as any;

      expect(typeof cancelRes.success).toBe("boolean");
      expect(["cancelled", "completed"]).toContain(cancelRes.job.status);
    });

    it("video_get_report returns report information for a job", async () => {
      const analyzeTool = getTool("video_analyze");
      const getReportTool = getTool("video_get_report");

      const job = (await analyzeTool.execute({ source: dummySource })) as any;

      // Wait a moment for background processing if needed, or query status
      const reportRes = (await getReportTool.execute({ job_id: job.id })) as any;
      expect(reportRes).toBeDefined();
      expect(reportRes.status).toBeDefined();
      expect(reportRes.progressPercent).toBeDefined();
    });
  });
});
