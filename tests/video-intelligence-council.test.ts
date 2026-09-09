import { beforeEach, describe, expect, it } from "bun:test";
import {
  VideoReviewerCouncil,
  KnowledgeAdapter,
  VideoDbStore,
  getVideoJobManager,
  resetVideoJobManager,
} from "../src/agent-os/video-intelligence";

describe("Phase 20.13 — Video Intelligence Council & Knowledge Ingest", () => {
  beforeEach(() => {
    resetVideoJobManager();
  });

  const sampleSource = "https://example.com/cinematic_drone.mp4";

  it("triggers Reviewer Council on adobe_stock_qc and produces consensus", async () => {
    const manager = getVideoJobManager();
    const job = await manager.submitJob(sampleSource, {
      intent: "adobe_stock_qc",
      reviewerCouncil: true,
    });

    // Wait until job finishes
    let current = manager.getJob(job.id);
    const start = Date.now();
    while (current && current.status !== "completed" && current.status !== "failed" && Date.now() - start < 3000) {
      await new Promise((r) => setTimeout(r, 40));
      current = manager.getJob(job.id);
    }

    expect(current).toBeDefined();
    expect(current!.status).toBe("completed");
    expect(current!.report).toBeDefined();
    expect(current!.report?.councilReview).toBeDefined();

    const council = current!.report!.councilReview!;
    expect(council.reviewers.length).toBe(3);
    expect(["pass", "review", "fail"]).toContain(council.consensus);
    expect(council.confidence).toBeGreaterThan(0.5);

    // Verify markdown contains Reviewer Council table
    expect(current!.report?.markdownReport).toContain("Reviewer Council");
  });

  it("creates structured Knowledge Ingest record with extracted concepts and entities", async () => {
    const manager = getVideoJobManager();
    const job = await manager.submitJob(sampleSource, {
      intent: "hook_analysis",
      enableHookMicroscope: true,
      ingestKnowledge: true,
    });

    let current = manager.getJob(job.id);
    const start = Date.now();
    while (current && current.status !== "completed" && current.status !== "failed" && Date.now() - start < 3000) {
      await new Promise((r) => setTimeout(r, 40));
      current = manager.getJob(job.id);
    }

    expect(current).toBeDefined();
    expect(current!.report?.knowledgeRecord).toBeDefined();

    const record = current!.report!.knowledgeRecord!;
    expect(record.type).toBe("video_analysis");
    expect(record.source).toBe(sampleSource);
    expect(record.title).toContain("Video Analysis");
    expect(record.summary).toBeTruthy();
    expect(record.concepts.length).toBeGreaterThan(0);
    expect(record.concepts).toContain("hook_analysis");
  });

  it("persists jobs and retrieves from VideoDbStore", async () => {
    const dbStore = new VideoDbStore();
    const manager = getVideoJobManager();
    const job = await manager.submitJob(sampleSource, { intent: "general" });

    // Ensure save and fetch
    dbStore.saveJob(job);
    const fetched = dbStore.getJob(job.id);

    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(job.id);
    expect(fetched!.source).toBe(job.source);
    expect(fetched!.status).toBe(job.status);
  });
});
