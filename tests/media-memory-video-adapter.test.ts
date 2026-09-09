import { describe, it, expect } from "bun:test";
import { VideoMemoryAdapter } from "../src/agent-os/media-memory/video-adapter";
import type { VideoAnalysisReport } from "../src/agent-os/video-intelligence/types";

describe("Phase 20.14 — VideoMemoryAdapter", () => {
  it("converts Phase 20.13 VideoAnalysisReport into unified MediaMemoryItem", () => {
    const report: VideoAnalysisReport = {
      jobId: "vjob_e2e_sample",
      source: "https://example.com/adobe_stock_clip.mp4",
      sourceType: "url",
      intent: "adobe_stock_qc",
      metadata: {
        durationSec: 15.0,
        width: 1920,
        height: 1080,
        fps: 30,
        videoCodec: "h264",
        audioCodec: "aac",
        bitrateKbps: 5000,
        fileSizeBytes: 9437184,
        orientation: "landscape",
        aspectRatio: "16:9",
      },
      pacing: {
        shotCount: 5,
        cutsPerMinute: 20,
        meanShotLengthSec: 3.0,
        medianShotLengthSec: 2.8,
        longestShotSec: 4.2,
        shortestShotSec: 2.1,
        openingCutRate: 3,
        rhythmProfile: "balanced",
      },
      hook: {
        openingType: "Kinetic Visual Hook",
        firstCutTimestamp: 2.1,
        visualHookScore: 88,
        pacingSummary: "3 dynamic events in first 10s",
        timeline: [{ timestamp: 0, event: "Opening frame", type: "visual" }],
      },
      transcript: {
        language: "en",
        provider: "local-whisper",
        fullText: "Experience the next level of generative video creation.",
        segments: [{ start: 0, end: 4.5, text: "Experience the next level of generative video creation." }],
      },
      heroFrames: [
        { frameIndex: 1, timestamp: 0.0, framePath: "frames/hero1.jpg", score: 0.94, reason: "Opening hook" },
      ],
      stockQc: {
        verdict: "PASS",
        score: 95,
        confidence: 0.92,
        issues: [],
        recommendations: ["Asset meets Adobe Stock standards."],
      },
      knowledgeRecord: {
        type: "video_analysis",
        source: "https://example.com/adobe_stock_clip.mp4",
        title: "Video Analysis: adobe_stock_clip.mp4",
        summary: "Analysis for adobe_stock_qc (15.0s runtime). Pacing: balanced. Hook Score: 88/100.",
        concepts: ["adobe_stock_qc", "landscape", "balanced", "hook:Kinetic Visual Hook"],
        entities: ["h264", "aac"],
        reportPath: "data/knowledge/report.json",
        createdAt: new Date().toISOString(),
      },
      markdownReport: "# Analysis Report\nStatus: PASS",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };

    const item = VideoMemoryAdapter.fromVideoAnalysisReport(report);

    expect(item.id).toBe("mitem_vjob_e2e_sample");
    expect(item.mediaType).toBe("video");
    expect(item.title).toContain("adobe_stock_clip.mp4");
    expect(item.tags).toContain("adobe_stock_qc");
    expect(item.tags).toContain("landscape");
    expect(item.tags).toContain("qc:pass");
    expect(item.concepts).toContain("adobe_stock_qc");
    expect(item.technicalSpecs.width).toBe(1920);
    expect(item.technicalSpecs.height).toBe(1080);
    expect(item.technicalSpecs.orientation).toBe("landscape");
    expect(item.pacing?.rhythmProfile).toBe("balanced");
    expect(item.hook?.visualHookScore).toBe(88);
    expect(item.transcriptText).toBe("Experience the next level of generative video creation.");
    expect(item.transcriptSegments?.length).toBe(1);
    expect(item.heroFrames?.length).toBe(1);
  });
});
