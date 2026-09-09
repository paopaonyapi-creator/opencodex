import { beforeEach, describe, expect, it } from "bun:test";
import { runVideoCli } from "../scripts/pao-video";
import { resetVideoJobManager } from "../src/agent-os/video-intelligence";

describe("Phase 20.13 — Video Intelligence CLI Runner", () => {
  beforeEach(() => {
    resetVideoJobManager();
  });

  it("prints help and exits with 0 on --help flag", async () => {
    const code = await runVideoCli(["--help"]);
    expect(code).toBe(0);
  });

  it("returns 1 on unknown command", async () => {
    const code = await runVideoCli(["unknown_cmd"]);
    expect(code).toBe(1);
  });

  it("returns 1 when source parameter is missing", async () => {
    const code = await runVideoCli(["analyze"]);
    expect(code).toBe(1);
  });

  it("runs video analyze with options and succeeds", async () => {
    const code = await runVideoCli([
      "analyze",
      "https://example.com/test_sample.mp4",
      "--intent",
      "summary",
      "--sampling",
      "uniform",
      "--no-hook",
      "--local-only",
      "--json",
    ]);
    expect(code).toBe(0);
  });

  it("supports 'video analyze' command prefix", async () => {
    const code = await runVideoCli([
      "video",
      "analyze",
      "https://example.com/sample_prefixed.mp4",
      "--intent",
      "adobe_stock_qc",
      "--reviewer-council",
      "--json",
    ]);
    expect(code).toBe(0);
  });
});
