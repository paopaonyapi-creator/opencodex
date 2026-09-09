import { describe, it, expect } from "bun:test";
import type { MediaMemoryItem, MediaTechnicalSpecs, MediaVector } from "../src/agent-os/media-memory/types";

describe("Phase 20.14 — Media Memory Types & Schema", () => {
  it("validates unified MediaMemoryItem structure", () => {
    const specs: MediaTechnicalSpecs = {
      width: 1920,
      height: 1080,
      durationSec: 15.0,
      fps: 30,
      orientation: "landscape",
      aspectRatio: "16:9",
      codec: "h264",
    };

    const item: MediaMemoryItem = {
      id: "mitem_test_01",
      mediaType: "video",
      sourceUrl: "https://example.com/demo.mp4",
      title: "Sample Video",
      summary: "Sample test video for media memory",
      tags: ["technology", "landscape"],
      concepts: ["ai", "video"],
      entities: ["h264"],
      technicalSpecs: specs,
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(item.id).toBe("mitem_test_01");
    expect(item.mediaType).toBe("video");
    expect(item.technicalSpecs.width).toBe(1920);
    expect(item.technicalSpecs.height).toBe(1080);
    expect(item.tags).toContain("technology");
  });

  it("validates MediaVector representation", () => {
    const vec: MediaVector = {
      id: "mvec_01",
      itemId: "mitem_test_01",
      vectorType: "multimodal",
      dimension: 64,
      vector: new Array(64).fill(0.125),
      model: "pao-multimodal-v1",
      createdAt: new Date().toISOString(),
    };

    expect(vec.dimension).toBe(64);
    expect(vec.vector.length).toBe(64);
    expect(vec.vectorType).toBe("multimodal");
  });
});
