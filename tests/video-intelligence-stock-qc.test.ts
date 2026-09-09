import { describe, expect, it } from "bun:test";
import { StockQcEngine } from "../src/agent-os/video-intelligence/stock-qc";
import type { VideoMetadata } from "../src/agent-os/video-intelligence/types";

describe("Phase 20.13 — StockQcEngine", () => {
  const engine = new StockQcEngine();

  const idealMetadata: VideoMetadata = {
    durationSec: 15.0,
    width: 3840,
    height: 2160,
    fps: 30,
    aspectRatio: "16:9",
    orientation: "landscape",
    codec: "h264",
    audioCodec: "aac",
    bitrateKbps: 45000,
    fileSizeBytes: 85000000,
  };

  it("evaluates clean 4K clip as PASS with high score", () => {
    const result = engine.evaluate(idealMetadata);
    expect(result.verdict).toBe("PASS");
    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.issues.length).toBe(0);
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendations[0]).toContain("meets Adobe Stock technical baseline");
  });

  it("evaluates 720p clip as REVIEW due to sub-1080p warning", () => {
    const meta720p: VideoMetadata = {
      ...idealMetadata,
      width: 1280,
      height: 720,
    };
    const result = engine.evaluate(meta720p);
    expect(result.verdict).toBe("REVIEW");
    expect(result.score).toBeLessThan(95);
    expect(result.issues.some((i) => i.type === "sub_1080p_resolution")).toBe(true);
  });

  it("evaluates <720p clip as FAIL due to low resolution", () => {
    const meta480p: VideoMetadata = {
      ...idealMetadata,
      width: 854,
      height: 480,
    };
    const result = engine.evaluate(meta480p);
    expect(result.verdict).toBe("FAIL");
    expect(result.issues.some((i) => i.type === "low_resolution" && i.severity === "high")).toBe(true);
  });

  it("evaluates clips shorter than 4 seconds as FAIL", () => {
    const metaShort: VideoMetadata = {
      ...idealMetadata,
      durationSec: 2.5,
    };
    const result = engine.evaluate(metaShort);
    expect(result.verdict).toBe("FAIL");
    expect(result.issues.some((i) => i.type === "duration_too_short" && i.severity === "high")).toBe(true);
  });

  it("evaluates clips longer than 120 seconds with a medium warning", () => {
    const metaLong: VideoMetadata = {
      ...idealMetadata,
      durationSec: 180.0,
    };
    const result = engine.evaluate(metaLong);
    expect(result.verdict).toBe("REVIEW");
    expect(result.issues.some((i) => i.type === "duration_too_long")).toBe(true);
  });

  it("flags watermark / trademark keywords in raw context as FAIL", () => {
    const result = engine.evaluate(idealMetadata, "Contains Shutterstock watermark preview");
    expect(result.verdict).toBe("FAIL");
    expect(result.issues.some((i) => i.type === "watermark_or_brand_indicator")).toBe(true);
  });
});
