// GOLD mode integration test — Adobe Stock End-to-End Production Pipeline
// (Phases 20.10, 20.14b, 20.31, Reviewer Council, Export Builder; GOLD §25).
//
// Verifies the complete real business pipeline:
// 1. Trend Discovery & Market Opportunity Scoring
// 2. Multi-shot Campaign Planning & Portfolio Generation
// 3. Reviewer Council Automated Visual & IP Quality Control Gate
// 4. Adobe Stock CSV Manifest Generation (Title, Keywords, Category, Releases)
// 5. Package Assembly & Lineage Tracking
// 6. Non-bypassable Safety Posture: No auto-upload to Adobe Stock without operator approval

import { describe, expect, test } from "bun:test";
import { StockAutonomousPipelineEngine } from "../src/agent-os/stock-pipeline/pipeline-engine";
import { buildAdobeStockExportPackage } from "../src/agent-os/export/stock-export-builder";
import { createStockAsset, updateStockAssetStatus, recordStockQcReview, type StockAsset } from "../src/agent-os/stock-models";
import { openAgentOsDb } from "../src/agent-os/db";

describe("Adobe Stock End-to-End Production Pipeline (GOLD §25)", () => {
  const engine = new StockAutonomousPipelineEngine();

  test("runs automated pipeline from market query through trend, plan, QC, and CSV manifest", async () => {
    const run = await engine.runFullPipeline({
      query: "smart agriculture iot sensors drone farming",
      market: "US",
      targetAssetCount: 3,
      autoDispatchGen: false,
      skipBrowserUpload: true,
    });

    // Pipeline ran through stages 1 to 6
    expect(run.id).toMatch(/^pipe_run_/);
    expect(run.currentStage).toBe(6);
    expect(run.status).toBe("waiting_approval");

    // Stage 1: Trend Discovery output verified
    expect(run.conceptSummary).toBeDefined();
    expect(typeof run.conceptSummary.opportunityScore).toBe("number");
    expect(run.conceptSummary.opportunityScore).toBeGreaterThanOrEqual(0);
    expect(run.conceptSummary.topConcept).toBeDefined();

    // Stage 2: Campaign Portfolio Planning verified
    expect(run.campaignId).toBeDefined();
    expect(run.campaignSummary).toBeDefined();
    expect(run.campaignSummary.totalItems).toBe(3);

    // Stage 4: Automated QC evaluations verified
    expect(run.qcSummary).toBeDefined();
    expect(run.qcSummary.totalEvaluated).toBe(3);
    expect(run.qcSummary.evaluations.length).toBe(3);
    expect(run.qcSummary.passedCount + run.qcSummary.rejectedCount).toBe(3);

    // Stage 5: Adobe Stock CSV Manifest verified
    expect(run.summary?.manifest).toBeDefined();
    const manifest = run.summary!.manifest!;
    expect(manifest.rowCount).toBe(3);
    expect(manifest.csvBytes).toBeGreaterThan(0);
    expect(manifest.csvPreview).toContain("Filename,Title,Keywords,Category,Releases");
  });

  test("builds official Adobe Stock export submission package with QC certificate & lineage", () => {
    const assetId = `stock_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    // Setup an asset that passed Reviewer Council
    createStockAsset({
      id: assetId,
      projectId: "proj_default",
      type: "png",
      mode: "text2image",
      status: "EXPORT_READY",
      path: "/storage/assets/test.png",
      generatedAi: true,
      fictionalPeopleProperty: false,
      megapixels: 12.0,
    });

    // Record Reviewer Council approval reviews
    recordStockQcReview({
      assetId,
      reviewer: "technical_qc",
      verdict: "pass",
      score: 95,
      issues: [],
      reviewedAt: now,
    });
    recordStockQcReview({
      assetId,
      reviewer: "compliance_reviewer",
      verdict: "pass",
      score: 98,
      issues: [],
      reviewedAt: now,
    });
    recordStockQcReview({
      assetId,
      reviewer: "human_supervisor",
      verdict: "pass",
      score: 100,
      issues: [],
      reviewedAt: now,
    });

    const exportBundle = buildAdobeStockExportPackage(assetId, {
      title: "Smart modern agricultural farming with sensors and autonomous tractors",
      keywords: [
        "agriculture", "smart farm", "iot sensors", "drone farming", "sustainable",
        "future technology", "autonomous", "modern harvest", "clean energy", "cultivation"
      ],
      category: 3,
    });

    expect(exportBundle.valid).toBe(true);
    expect(exportBundle.errors).toHaveLength(0);
    expect(exportBundle.manifest.assetId).toBe(assetId);
    expect(exportBundle.manifest.generatedAi).toBe(true);
    expect(exportBundle.manifest.qcSummary.compositeScore).toBeGreaterThanOrEqual(95);

    // CSV conforms to Adobe Stock standard columns
    expect(exportBundle.csvContent).toContain("Filename,Title,Keywords,Category,Releases");
    expect(exportBundle.csvContent).toContain("Smart modern agricultural farming with sensors and autonomous tractors");
    expect(exportBundle.csvContent).toContain("iot sensors");
  });

  test("enforces safety gate: rejects export package if asset failed Reviewer Council", () => {
    const unapprovedAssetId = `stock_unapproved_${Date.now()}`;
    const now = new Date().toISOString();

    createStockAsset({
      id: unapprovedAssetId,
      projectId: "proj_default",
      type: "png",
      mode: "text2image",
      status: "NEEDS_FIXES", // Has not passed review
      path: "/storage/assets/unapproved.png",
      generatedAi: true,
      fictionalPeopleProperty: false,
    });

    const exportBundle = buildAdobeStockExportPackage(unapprovedAssetId, {
      title: "Unapproved rough sketch with low quality",
      keywords: ["sketch", "draft"],
    });

    expect(exportBundle.valid).toBe(false);
    expect(exportBundle.errors.some((e) => e.includes("must pass Reviewer Council"))).toBe(true);
  });
});
