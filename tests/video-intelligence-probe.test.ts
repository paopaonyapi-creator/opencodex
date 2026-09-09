import { describe, expect, test } from "bun:test";
import { MediaProbe } from "../src/agent-os/video-intelligence/media-probe";

describe("Phase 20.13 — MediaProbe", () => {
  const probe = new MediaProbe();

  test("computes geometry and orientation correctly", () => {
    const landscape = probe.computeGeometry(1920, 1080);
    expect(landscape.orientation).toBe("landscape");
    expect(landscape.aspectRatio).toBe("16:9");

    const portrait = probe.computeGeometry(1080, 1920);
    expect(portrait.orientation).toBe("portrait");
    expect(portrait.aspectRatio).toBe("9:16");

    const square = probe.computeGeometry(1080, 1080);
    expect(square.orientation).toBe("square");
    expect(square.aspectRatio).toBe("1:1");
  });

  test("probes media source and returns structured VideoMetadata", async () => {
    const meta = await probe.probe("sample_landscape_video.mp4");
    expect(meta.width).toBeGreaterThanOrEqual(720);
    expect(meta.height).toBeGreaterThanOrEqual(720);
    expect(meta.durationSec).toBeGreaterThan(0);
    expect(meta.fps).toBeGreaterThanOrEqual(24);
    expect(meta.videoCodec).toBeDefined();
    expect(meta.aspectRatio).toBeDefined();
  });
});
