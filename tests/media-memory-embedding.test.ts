import { describe, it, expect } from "bun:test";
import { MediaEmbeddingEngine } from "../src/agent-os/media-memory/embedding-engine";

describe("Phase 20.14 — MediaEmbeddingEngine", () => {
  const engine = new MediaEmbeddingEngine(64);

  it("computes cosine similarity accurately", () => {
    const vecA = [1, 0, 0, 0];
    const vecB = [1, 0, 0, 0];
    const vecC = [0, 1, 0, 0];
    const vecD = [0.7071, 0.7071, 0, 0];

    expect(engine.cosineSimilarity(vecA, vecB)).toBe(1.0);
    expect(engine.cosineSimilarity(vecA, vecC)).toBe(0.0);
    expect(engine.cosineSimilarity(vecA, vecD)).toBeCloseTo(0.7071, 2);
  });

  it("handles empty and mismatch vectors gracefully", () => {
    expect(engine.cosineSimilarity([], [])).toBe(0);
    expect(engine.cosineSimilarity([1, 2], [0, 0])).toBe(0);
  });

  it("generates deterministic L2 normalized text vectors", () => {
    const text1 = "Autonomous AI video generator for YouTube Shorts";
    const text2 = "Autonomous AI video generator for YouTube Shorts";
    const text3 = "Cooking traditional pasta recipes in Italy";

    const vec1 = engine.generateTextVector(text1);
    const vec2 = engine.generateTextVector(text2);
    const vec3 = engine.generateTextVector(text3);

    expect(vec1.length).toBe(64);
    expect(vec1).toEqual(vec2); // Deterministic

    // Euclidean norm should be ~1.0
    const norm = Math.sqrt(vec1.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 2);

    // Semantic similarity between identical text is 1.0, but distinct text is much lower
    const simSame = engine.cosineSimilarity(vec1, vec2);
    const simDiff = engine.cosineSimilarity(vec1, vec3);

    expect(simSame).toBe(1.0);
    expect(simDiff).toBeLessThan(0.4);
  });

  it("generates visual vectors from technical specs", () => {
    const landscapeSpecs = { width: 1920, height: 1080, durationSec: 15, fps: 30, orientation: "landscape" as const };
    const portraitSpecs = { width: 1080, height: 1920, durationSec: 15, fps: 30, orientation: "portrait" as const };

    const vecL = engine.generateVisualVector(landscapeSpecs, 0.9, 10);
    const vecP = engine.generateVisualVector(portraitSpecs, 0.9, 10);

    expect(vecL.length).toBe(64);
    expect(vecP.length).toBe(64);
    expect(vecL).not.toEqual(vecP);
  });

  it("fuses multimodal representations correctly", () => {
    const item = {
      title: "Tech Startup Pitch Video",
      summary: "Founder presenting high-tech AI platform",
      tags: ["tech", "startup"],
      concepts: ["saas", "ai"],
      technicalSpecs: { width: 1920, height: 1080, durationSec: 60, orientation: "landscape" as const },
      transcriptText: "Hello everyone, today we present our brand new AI system.",
    };

    const mmVec = engine.generateMultimodalVector(item);
    expect(mmVec.length).toBe(64);
    const norm = Math.sqrt(mmVec.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 2);
  });
});
