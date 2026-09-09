import { describe, expect, it } from "bun:test";
import { VideoJobManager } from "../src/agent-os/video-intelligence/job-manager";

describe("Phase 20.13 — VideoJobManager", () => {
  it("rejects unsafe URLs at submission time", async () => {
    const manager = new VideoJobManager();
    expect(async () => {
      await manager.submitJob("http://127.0.0.1:8080/test.mp4");
    }).toThrow("Security validation failed");
  });

  it("submits and executes a job to completion with report", async () => {
    const manager = new VideoJobManager();
    const job = await manager.submitJob("https://example.com/sample_video.mp4", {
      intent: "adobe_stock_qc",
      sampling: "uniform",
      enableHookMicroscope: true,
    });

    expect(job.id).toBeDefined();
    expect(job.source).toBe("https://example.com/sample_video.mp4");
    expect(job.status).toBeDefined();

    // Poll until complete or max 3 seconds
    let finalJob = manager.getJob(job.id);
    const start = Date.now();
    while (finalJob && finalJob.status !== "completed" && finalJob.status !== "failed" && Date.now() - start < 3000) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      finalJob = manager.getJob(job.id);
    }

    expect(finalJob).toBeDefined();
    expect(finalJob!.status).toBe("completed");
    expect(finalJob!.progressPercent).toBe(100);
    expect(finalJob!.report).toBeDefined();
    expect(finalJob!.report?.metadata).toBeDefined();
    expect(finalJob!.report?.pacing).toBeDefined();
    expect(finalJob!.report?.stockQc).toBeDefined();
    expect(finalJob!.report?.markdownReport).toContain("# Pao-hubPro Video Intelligence Report");
  });

  it("lists and filters jobs correctly", async () => {
    const manager = new VideoJobManager();
    await manager.submitJob("https://example.com/vid1.mp4", { intent: "youtube_godmode" });
    await manager.submitJob("https://example.com/vid2.mp4", { intent: "adobe_stock_qc" });

    const allJobs = manager.listJobs();
    expect(allJobs.length).toBeGreaterThanOrEqual(2);

    const ytJobs = manager.listJobs({ intent: "youtube_godmode" });
    expect(ytJobs.every((j) => j.config.intent === "youtube_godmode")).toBe(true);

    const stockJobs = manager.listJobs({ intent: "adobe_stock_qc" });
    expect(stockJobs.every((j) => j.config.intent === "adobe_stock_qc")).toBe(true);
  });

  it("cancels a queued or active job", async () => {
    const manager = new VideoJobManager();
    const job = await manager.submitJob("https://example.com/long_task.mp4");
    
    // Attempt cancellation
    const cancelled = manager.cancelJob(job.id);
    // If it already finished very fast, cancel returns false, otherwise true
    const fetched = manager.getJob(job.id);
    expect(fetched).toBeDefined();
    if (cancelled) {
      expect(fetched!.status).toBe("cancelled");
    } else {
      expect(["completed", "failed"]).toContain(fetched!.status);
    }
  });

  it("infers smart auto-intent from source string and orientation", () => {
    const manager = new VideoJobManager();
    expect(manager.inferAutoIntent("https://example.com/adobe_stock_clip.mp4")).toBe("adobe_stock_qc");
    expect(manager.inferAutoIntent("https://example.com/screen_recording_bug.mp4")).toBe("screen_debug");
    expect(manager.inferAutoIntent("https://example.com/tiktok_shorts_reel.mp4")).toBe("hook_analysis");
    expect(manager.inferAutoIntent("https://example.com/guide_tutorial.mp4")).toBe("tutorial_extract");
    expect(manager.inferAutoIntent("https://example.com/unknown.mp4")).toBe("general");
  });

  it("generates automated regeneration feedback for AI Video Factory", () => {
    const manager = new VideoJobManager();
    const passFeedback = manager.generateFactoryFeedback({
      verdict: "PASS",
      score: 95,
      confidence: 0.9,
      issues: [],
      recommendations: [],
    });
    expect(passFeedback.action).toBe("pass_to_export");

    const failFeedback = manager.generateFactoryFeedback({
      verdict: "FAIL",
      score: 30,
      confidence: 0.9,
      issues: [{ severity: "high", timestamp: 5.2, type: "temporal_hand_defect", message: "Hand deformation" }],
      recommendations: [],
    });
    expect(failFeedback.action).toBe("regenerate");
    expect(failFeedback.reason).toBe("temporal_hand_defect");
    expect(failFeedback.timestamp).toBe(5.2);
  });

  it("utilizes deterministic cache on repeat job submission", async () => {
    const manager = new VideoJobManager();
    const source = "https://example.com/cached_video.mp4";

    const job1 = await manager.submitJob(source, { intent: "summary", useCache: true });
    let final1 = manager.getJob(job1.id);
    const start = Date.now();
    while (final1 && final1.status !== "completed" && Date.now() - start < 3000) {
      await new Promise((r) => setTimeout(r, 40));
      final1 = manager.getJob(job1.id);
    }

    expect(final1?.status).toBe("completed");
    expect(final1?.report?.provenance).toBeDefined();

    // Second submission with exact same source and config should hit cache
    const job2 = await manager.submitJob(source, { intent: "summary", useCache: true });
    let final2 = manager.getJob(job2.id);
    const start2 = Date.now();
    while (final2 && final2.status !== "completed" && Date.now() - start2 < 1000) {
      await new Promise((r) => setTimeout(r, 20));
      final2 = manager.getJob(job2.id);
    }

    expect(final2?.status).toBe("completed");
    expect(final2?.currentStage).toContain("cache");
  });
});
