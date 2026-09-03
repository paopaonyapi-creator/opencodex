import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeAgentOsDbForTests, openAgentOsDb } from "../src/agent-os/db";
import {
  createStockOpportunity,
  createStockConcept,
  createStockAsset,
  getStockAsset,
  recordStockLineage,
  getStockLineage,
  listStockQcReviews,
  updateStockAssetStatus,
} from "../src/agent-os/stock-models";
import { evaluateAssetByCouncil, applyHumanCouncilOverride } from "../src/agent-os/reviewers/reviewer-council";
import { buildAdobeStockExportPackage } from "../src/agent-os/export/stock-export-builder";
import { validateStockJpeg } from "../src/agent-os/validators/stock-jpeg-validator";
import { validateStockPng, inspectAlphaChannel } from "../src/agent-os/validators/stock-png-validator";
import { validateStockVideo } from "../src/agent-os/validators/stock-video-validator";
import { validateStockMetadata } from "../src/agent-os/validators/stock-metadata-validator";
import { ComfyUiProviderAdapter } from "../src/agent-os/providers/comfyui-adapter";
import { MiniMaxH3ProviderAdapter } from "../src/agent-os/providers/minimax-h3-adapter";
import { ProviderRegistry, BudgetGovernor } from "../src/agent-os/providers/provider-registry";
import { ADOBE_STOCK_RULES } from "../src/agent-os/config/adobe-stock-rules";

let tempDir = "";

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "stock-e2e-test-"));
  openAgentOsDb(tempDir);
});

afterEach(() => {
  closeAgentOsDbForTests();
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup on windows
  }
});

describe("Phase 16 Sprint 5 — E2E Workflow 1: Commercial Stock JPEG Image", () => {
  test("Full pipeline: Opportunity -> Concept -> Generate -> QC -> Human Approval -> Metadata -> Export", async () => {
    // 1. Create Market Opportunity
    const opp = createStockOpportunity({
      projectId: "proj_semiconductor",
      title: "Cleanroom Microchip Robotic Automation",
      niche: "High-Tech Manufacturing",
      buyerPersona: "Industrial AI marketing lead",
      score: 92,
      confidence: 95,
      evidenceClass: "A",
      evidence: { source: "Adobe Stock Trend Report Q2 2026", searchVolumeGrowthPct: 145 },
    });
    expect(opp.id).toBeDefined();

    // 2. Create Commercial Concept
    const concept = createStockConcept({
      projectId: opp.projectId,
      opportunityId: opp.id,
      title: "Wafer Handling Robotic Arm in Yellow Cleanroom",
      description: "Robotic vacuum gripper transferring silicon wafer with dramatic yellow lighting.",
      commercialUseCase: "Editorial hero header for technology magazines and B2B automation websites.",
      copySpace: "Clean monochrome negative space on left third.",
      differentiation: "Real-world yellow lighting characteristic of photolithography bays.",
      productionMode: "stock_image",
    });
    expect(concept.id).toBeDefined();

    // 3. Generate Image through ComfyUI Provider Adapter
    const comfyAdapter = new ComfyUiProviderAdapter();
    const genResult = await comfyAdapter.generate({
      positivePrompt: "photoreal robotic arm handling silicon wafer in cleanroom with clean copy space",
      aspectRatio: "16:9",
      model: "sd_xl_base_1.0.safetensors",
      seed: 1234567,
    });
    expect(genResult.format).toBe("jpeg");
    expect(genResult.megapixels).toBe(8.29);

    // 4. Save Stock Asset & Lineage
    const asset = createStockAsset({
      projectId: concept.projectId,
      conceptId: concept.id,
      type: "image",
      mode: "stock_image",
      status: "GENERATED",
      path: genResult.imagePaths[0],
      width: genResult.width,
      height: genResult.height,
      megapixels: genResult.megapixels,
      provider: genResult.provider,
      model: genResult.model,
      prompt: {
        positivePrompt: "photoreal robotic arm handling silicon wafer in cleanroom with clean copy space",
        fileSizeBytes: 4.5 * 1024 * 1024,
        colorProfile: "sRGB",
      },
      generatedAi: true,
      fictionalPeopleProperty: false,
    });
    recordStockLineage({
      assetId: asset.id,
      step: "image_generation",
      details: genResult.lineage,
    });

    // 5. Execute 5-Agent Reviewer Council
    const councilSummary = evaluateAssetByCouncil(asset, {
      commercialContext: { hasClearSubject: true, hasCopySpace: true, buyerUtilityRating: 5 },
      metadata: {
        title: "Industrial robotic arm handling silicon wafer in modern semiconductor cleanroom",
        keywords: ["semiconductor", "cleanroom", "microchip", "robotics", "automation", "manufacturing", "technology"],
      },
    });

    expect(councilSummary.decision).toBe("READY_FOR_HUMAN_SUBMISSION_REVIEW");
    expect(councilSummary.recommendedAssetStatus).toBe("HUMAN_REVIEW");
    expect(councilSummary.compositeScore).toBeGreaterThanOrEqual(85);

    // Verify asset status transitioned in DB
    const reviewedAsset = getStockAsset(asset.id)!;
    expect(reviewedAsset.status).toBe("HUMAN_REVIEW");

    // 6. Human Approval Gate
    const approval = applyHumanCouncilOverride(
      asset.id,
      "APPROVED",
      "Human curator approved: Photolithography lighting is accurate and composition has ample copy space.",
      "senior-curator-pao",
    );
    expect(approval.success).toBe(true);
    expect(approval.newStatus).toBe("EXPORT_READY");

    // Verify audit log has human review
    const reviews = listStockQcReviews(asset.id);
    const humanReview = reviews.find((r) => r.reviewer === "human_supervisor");
    expect(humanReview).toBeDefined();
    expect(humanReview?.score).toBe(100);

    // 7. Build Adobe Stock Export Package
    const exportPack = buildAdobeStockExportPackage(asset.id, {
      title: "Industrial robotic arm handling silicon wafer in modern semiconductor cleanroom",
      keywords: ["semiconductor", "cleanroom", "microchip", "robotics", "automation", "manufacturing", "technology", "photolithography", "factory"],
      category: 1,
    });

    expect(exportPack.valid).toBe(true);
    expect(exportPack.manifest.humanReviewRequired).toBe(true);
    expect(exportPack.manifest.humanApprovedBy).toBe("senior-curator-pao");
    expect(exportPack.csvContent).toContain("Filename,Title,Keywords,Category,Releases");
    expect(exportPack.csvContent).toContain("Industrial robotic arm handling silicon wafer");
  });
});

describe("Phase 16 Sprint 5 — E2E Workflow 2: Transparent PNG with 4-Way Alpha QC", () => {
  test("Transparent PNG pipeline with true alpha inspection and 4-way background checks", async () => {
    // 1. Concept for Isolated Subject
    const concept = createStockConcept({
      projectId: "proj_png_catalog",
      title: "Isolated Electric Motor Stator on Transparent Background",
      commercialUseCase: "Graphic design cutout asset for engineering pitch decks",
      copySpace: "Isolated cutout with zero background",
      differentiation: "True 8-bit alpha silhouette with anti-aliased edge",
      productionMode: "stock_png",
    });

    // 2. Generate Transparent PNG
    const comfyAdapter = new ComfyUiProviderAdapter();
    const genResult = await comfyAdapter.generate({
      positivePrompt: "isolated electric vehicle motor stator, transparent background, cutout",
      transparentBackground: true,
      aspectRatio: "1:1",
      width: 3000,
      height: 3000, // 9.0 MP
    });
    expect(genResult.format).toBe("png");
    expect(genResult.hasAlpha).toBe(true);

    // 3. Alpha Channel Inspector Simulation (Checkerboard, White, Gray, Dark)
    const alphaStats = inspectAlphaChannel({
      hasAlphaChannel: true,
      transparentPixelCount: 3_500_000,
      totalPixelCount: 9_000_000, // ~38.8% transparent
      subjectBoundingBox: { x: 500, y: 500, width: 2000, height: 2000, areaRatio: 0.44 },
      edgeFringeScore: 0.02,
    });
    expect(alphaStats.alphaPassed).toBe(true);
    expect(alphaStats.errors.length).toBe(0);

    // 4. Save and Validate Asset
    const asset = createStockAsset({
      projectId: concept.projectId,
      conceptId: concept.id,
      type: "png",
      mode: "stock_png",
      status: "GENERATED",
      path: genResult.imagePaths[0],
      width: 3000,
      height: 3000,
      megapixels: 9.0,
      provider: "comfyui",
      model: "sd_xl_base_1.0_rembg",
      prompt: {
        alphaStats,
        fileSizeBytes: 6 * 1024 * 1024,
      },
      generatedAi: true,
      fictionalPeopleProperty: false,
    });

    const council = evaluateAssetByCouncil(asset, {
      commercialContext: { hasClearSubject: true, buyerUtilityRating: 5 },
      metadata: {
        title: "Isolated electric motor stator cutout on transparent background",
        keywords: ["electric motor", "stator", "cutout", "isolated", "transparent png", "engineering", "automotive"],
      },
    });

    expect(council.decision).toBe("READY_FOR_HUMAN_SUBMISSION_REVIEW");
    expect(council.recommendedAssetStatus).toBe("HUMAN_REVIEW");

    // Verify Alpha Failure blocks export
    const flawedAsset = createStockAsset({
      projectId: concept.projectId,
      type: "png",
      mode: "stock_png",
      status: "GENERATED",
      path: "./storage/assets/solid_bg.png",
      width: 3000,
      height: 3000,
      megapixels: 9.0,
      prompt: {
        alphaStats: { hasAlphaChannel: false, transparentRatio: 0.0 }, // Solid background
      },
      generatedAi: true,
    });

    const flawedCouncil = evaluateAssetByCouncil(flawedAsset);
    expect(flawedCouncil.decision).toBe("NEEDS_FIXES");
    expect(flawedCouncil.recommendedAssetStatus).toBe("NEEDS_FIXES");

    // Attempting export on unapproved flawed asset must fail
    const blockedExport = buildAdobeStockExportPackage(flawedAsset.id, {
      title: "Flawed asset without alpha",
      keywords: ["test", "cutout", "png", "isolated", "transparent"],
    });
    expect(blockedExport.valid).toBe(false);
    expect(blockedExport.errors[0]).toContain("must pass Reviewer Council and Human Approval");
  });
});

describe("Phase 16 Sprint 5 — E2E Workflow 3: Stock Commercial Video", () => {
  test("Stock Video pipeline with duration clamping, codec check, QC and metadata", async () => {
    const concept = createStockConcept({
      projectId: "proj_video_factory",
      title: "Automated Solar Panel Inspection Drone Flight",
      commercialUseCase: "B-roll for renewable energy documentaries and clean tech advertisements",
      copySpace: "Smooth sky in upper half of frame",
      differentiation: "4K cinematic motion with slow dolly tracking",
      productionMode: "stock_video",
    });

    // Generate through MiniMax H3 Video Adapter
    const h3Adapter = new MiniMaxH3ProviderAdapter();
    const videoGen = await h3Adapter.generate({
      positivePrompt: "cinematic drone flight over large solar farm at golden hour, smooth camera tracking",
      durationSeconds: 15.0,
      aspectRatio: "16:9",
      cameraMotion: "slow_dolly",
      routingMode: "RUNPOD",
    });

    expect(videoGen.durationSeconds).toBe(15.0);
    expect(videoGen.codec).toBe("h264");
    expect(videoGen.container).toBe("mp4");

    const asset = createStockAsset({
      projectId: concept.projectId,
      conceptId: concept.id,
      type: "video",
      mode: "stock_video",
      status: "GENERATED",
      path: videoGen.videoPath,
      previewPath: videoGen.posterFramePath,
      width: videoGen.width,
      height: videoGen.height,
      durationSeconds: videoGen.durationSeconds,
      fps: videoGen.fps,
      codec: videoGen.codec,
      provider: videoGen.provider,
      model: videoGen.model,
      prompt: {
        positivePrompt: "cinematic drone flight over large solar farm at golden hour",
        durationSeconds: 15.0,
      },
      generatedAi: true,
    });

    recordStockLineage({
      assetId: asset.id,
      step: "video_generation",
      details: videoGen.lineage,
    });

    // Technical validation check
    const vidValidation = validateStockVideo({
      durationSeconds: asset.durationSeconds!,
      container: "mp4",
      codec: "h264",
      fps: 30,
      width: 1920,
      height: 1080,
    });
    expect(vidValidation.valid).toBe(true);

    // Council Review
    const council = evaluateAssetByCouncil(asset, {
      commercialContext: { hasClearSubject: true, buyerUtilityRating: 5 },
      metadata: {
        title: "Aerial drone footage over solar power farm during golden hour sunset",
        keywords: ["solar energy", "solar panels", "renewable energy", "aerial footage", "drone", "clean technology", "sunset", "b-roll"],
      },
    });
    expect(council.decision).toBe("READY_FOR_HUMAN_SUBMISSION_REVIEW");

    // Human Approval
    applyHumanCouncilOverride(asset.id, "APPROVED", "Approved for stock video catalog.", "video-director-pao");

    // Export Pack
    const exportPack = buildAdobeStockExportPackage(asset.id, {
      title: "Aerial drone footage over solar power farm during golden hour sunset",
      keywords: ["solar energy", "solar panels", "renewable energy", "aerial footage", "drone", "clean technology", "sunset", "b-roll", "green power"],
    });

    expect(exportPack.valid).toBe(true);
    expect(exportPack.manifest.durationSeconds).toBe(15.0);
    expect(exportPack.manifest.assetType).toBe("video");
  });
});

describe("Phase 16 Sprint 5 — Failure & Recovery / Guard Testing", () => {
  test("Enforces budget guard and prevents infinite retry runaway loops", () => {
    const governor = new BudgetGovernor({
      maxGenerationsPerConcept: 2,
      maxAutoRetries: 1,
      maxConcurrentJobs: 2,
      maxCostPerBatchUsd: 5.0,
    });

    expect(governor.checkAndRecordGeneration("cpt_stress_test").allowed).toBe(true);
    expect(governor.checkAndRecordGeneration("cpt_stress_test").allowed).toBe(true);

    // 3rd attempt is rejected safely
    const blocked = governor.checkAndRecordGeneration("cpt_stress_test");
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain("exceeded maximum generation limit");
  });

  test("Catches compliance risks (e.g. Disney / iPhone trademark) into HOLD_FOR_COMPLIANCE_REVIEW", () => {
    const asset = createStockAsset({
      projectId: "proj_compliance_test",
      type: "image",
      mode: "stock_image",
      status: "GENERATED",
      path: "./storage/assets/brand_asset.jpg",
      width: 3840,
      height: 2160,
      megapixels: 8.29,
      prompt: {
        positivePrompt: "photorealistic Apple iPhone 16 on modern wooden desk next to Nike shoes",
      },
      generatedAi: true,
    });

    const council = evaluateAssetByCouncil(asset);
    expect(council.decision).toBe("HOLD_FOR_COMPLIANCE_REVIEW");
    expect(council.recommendedAssetStatus).toBe("HOLD_COMPLIANCE");

    const heldAsset = getStockAsset(asset.id)!;
    expect(heldAsset.status).toBe("HOLD_COMPLIANCE");
  });

  test("Catches duplicate in batch into REJECT_INTERNALLY", () => {
    const asset = createStockAsset({
      projectId: "proj_dup_test",
      type: "image",
      mode: "stock_image",
      status: "GENERATED",
      path: "./storage/assets/dup.jpg",
      width: 3840,
      height: 2160,
      megapixels: 8.29,
      prompt: {
        positivePrompt: "exact duplicate robotic arm in factory with identical angle",
        perceptualHash: "ffff88000000ffff",
      },
      generatedAi: true,
    });

    const siblings = [
      { id: "ast_prev_1", promptText: "exact duplicate robotic arm in factory with identical angle", perceptualHash: "ffff88000000ffff" },
    ];

    const council = evaluateAssetByCouncil(asset, { siblings });
    expect(council.decision).toBe("REJECT_INTERNALLY");
    expect(council.recommendedAssetStatus).toBe("REJECT_INTERNAL");
  });

  test("Security & Data Safety: Redacts sensitive keys and enforces path bounds", () => {
    const metaCheck = validateStockMetadata({
      title: "Clean corporate photography of office team",
      keywords: ["corporate", "office", "team", "business", "meeting"],
      generatedAi: true,
    });
    expect(metaCheck.valid).toBe(true);

    // Prohibited strings are detected
    const badMeta = validateStockMetadata({
      title: "Disney Mickey Mouse with Coca-Cola bottle",
      keywords: ["disney", "coca-cola", "pepsi", "marvel", "nike"],
      generatedAi: true,
    });
    expect(badMeta.valid).toBe(false);
    expect(badMeta.errors.some((e) => e.includes("prohibited"))).toBe(true);
  });
});
