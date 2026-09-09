import { describe, expect, test } from "bun:test";
import { PacingAnalyzer } from "../src/agent-os/video-intelligence/pacing-analyzer";
import type { SceneCut, VideoMetadata } from "../src/agent-os/video-intelligence/types";

describe("Phase 20.13 — PacingAnalyzer", () => {
  const analyzer = new PacingAnalyzer();

  const baseMeta: VideoMetadata = {
    durationSec: 30.0,
    width: 1920,
    height: 1080,
    fps: 30,
    videoCodec: "h264",
    orientation: "landscape",
    aspectRatio: "16:9",
  };

  test("analyzes high-energy fast cuts accurately", () => {
    // 15 cuts in 30 seconds = 28 cuts per minute
    const scenes: SceneCut[] = [];
    for (let i = 0; i < 15; i++) {
      scenes.push({ timestamp: i * 2.0, frameIndex: i + 1, sceneScore: 0.8 });
    }

    const metrics = analyzer.analyzePacing(scenes, baseMeta);
    expect(metrics.shotCount).toBe(15);
    expect(metrics.cutsPerMinute).toBeGreaterThanOrEqual(24);
    expect(metrics.rhythmProfile).toBe("high-energy");
    expect(metrics.meanShotLengthSec).toBeCloseTo(2.0, 1);
  });

  test("identifies contemplative or static pacing when few cuts occur", () => {
    const scenes: SceneCut[] = [
      { timestamp: 0.0, frameIndex: 1, sceneScore: 1.0 },
      { timestamp: 18.0, frameIndex: 2, sceneScore: 0.6 },
    ];

    const metrics = analyzer.analyzePacing(scenes, baseMeta);
    expect(metrics.shotCount).toBe(2);
    expect(metrics.cutsPerMinute).toBeLessThan(5);
    expect(["contemplative", "static"]).toContain(metrics.rhythmProfile);
  });
});
