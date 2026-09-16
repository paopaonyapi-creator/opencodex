// Phase 20.24 — Pao-hubPro × OmniGet Local Media Acquisition & MCP Engine
// Automated Tests for the 14 Media Acquisition MCP Tools

import { describe, expect, test } from "bun:test";
import { MEDIA_ACQUISITION_MCP_TOOLS } from "../src/agent-os/media-acquisition/mcp-tools";

describe("Phase 20.24 Canonical MCP Tools Suite", () => {
  test("registers exactly 14 explicit MCP tools", () => {
    expect(MEDIA_ACQUISITION_MCP_TOOLS.length).toBe(14);
    const names = MEDIA_ACQUISITION_MCP_TOOLS.map((t) => t.name);

    // 7 Read-safe tools
    expect(names).toContain("media_inspect");
    expect(names).toContain("media_list_jobs");
    expect(names).toContain("media_get_job");
    expect(names).toContain("media_get_metadata");
    expect(names).toContain("media_get_transcript");
    expect(names).toContain("media_list_artifacts");
    expect(names).toContain("media_health");

    // 7 Controlled action tools
    expect(names).toContain("media_download");
    expect(names).toContain("media_download_batch");
    expect(names).toContain("media_extract_audio");
    expect(names).toContain("media_transcribe");
    expect(names).toContain("media_convert");
    expect(names).toContain("media_cancel");
    expect(names).toContain("media_retry");
  });

  test("each tool has a valid JSON schema and non-empty description", () => {
    for (const tool of MEDIA_ACQUISITION_MCP_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.properties).toBeDefined();
    }
  });

  test("media_health returns provider statuses", async () => {
    const healthTool = MEDIA_ACQUISITION_MCP_TOOLS.find((t) => t.name === "media_health")!;
    const res = await healthTool.handler({});
    expect(res.content[0].type).toBe("text");
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.native).toBeDefined();
    expect(parsed.native.status).toBe("healthy");
  });

  test("media_inspect parses URL and detects invalid targets", async () => {
    const inspectTool = MEDIA_ACQUISITION_MCP_TOOLS.find((t) => t.name === "media_inspect")!;

    // SSRF attempt must fail
    const ssrfRes = await inspectTool.handler({ url: "http://127.0.0.1:9000/media" });
    expect(ssrfRes.isError).toBe(true);
    expect(ssrfRes.content[0].text).toContain("SSRF");

    // Public URL must succeed
    const okRes = await inspectTool.handler({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
    expect(okRes.isError).toBeFalsy();
    const parsed = JSON.parse(okRes.content[0].text);
    expect(parsed.sourcePlatform).toBe("youtube");
  });

  test("media_download enqueues job safely", async () => {
    const downloadTool = MEDIA_ACQUISITION_MCP_TOOLS.find((t) => t.name === "media_download")!;
    const res = await downloadTool.handler({
      url: "https://vimeo.com/987654",
      preset: "best",
      priority: "P1",
    });

    expect(res.isError).toBeFalsy();
    const job = JSON.parse(res.content[0].text);
    expect(job.id).toBeDefined();
    expect(["queued", "running"]).toContain(job.status);
  });

  test("media_list_jobs lists enqueued jobs", async () => {
    const listTool = MEDIA_ACQUISITION_MCP_TOOLS.find((t) => t.name === "media_list_jobs")!;
    const res = await listTool.handler({});
    expect(res.isError).toBeFalsy();
    const jobs = JSON.parse(res.content[0].text);
    expect(Array.isArray(jobs)).toBe(true);
  });
});
