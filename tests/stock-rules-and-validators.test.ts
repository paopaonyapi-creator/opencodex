import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ADOBE_STOCK_RULES } from "../src/agent-os/config/adobe-stock-rules";
import { validateStockJpeg } from "../src/agent-os/validators/stock-jpeg-validator";
import { validateStockPng, inspectAlphaChannel } from "../src/agent-os/validators/stock-png-validator";
import { validateStockVideo } from "../src/agent-os/validators/stock-video-validator";
import { validateStockMetadata } from "../src/agent-os/validators/stock-metadata-validator";
import { closeAgentOsDbForTests, openAgentOsDb } from "../src/agent-os/db";
import {
  createStockOpportunity,
  listStockOpportunities,
  createStockConcept,
  listStockConcepts,
  createStockAsset,
  getStockAsset,
  updateStockAssetStatus,
  recordStockLineage,
  recordStockQcReview,
  createStockExportPack,
} from "../src/agent-os/stock-models";

let tempDir = "";

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "stock-factory-test-"));
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

describe("Phase 16 — Adobe Stock Rules Configuration", () => {
  test("rules configuration is centralized and versioned", () => {
    expect(ADOBE_STOCK_RULES.rulesVersion).toBe("adobe-stock-2026-06-11");
    expect(ADOBE_STOCK_RULES.image.minMegapixels).toBe(4.0);
    expect(ADOBE_STOCK_RULES.image.maxMegapixels).toBe(100.0);
    expect(ADOBE_STOCK_RULES.png.requireTrueAlpha).toBe(true);
    expect(ADOBE_STOCK_RULES.video.minDurationSeconds).toBe(5.0);
    expect(ADOBE_STOCK_RULES.video.maxDurationSeconds).toBe(60.0);
    expect(ADOBE_STOCK_RULES.compliance.requireGenerativeAiTag).toBe(true);
    expect(ADOBE_STOCK_RULES.compliance.requireHumanReviewBeforeSubmission).toBe(true);
  });
});

describe("Phase 16 — Stock JPEG Validator", () => {
  test("valid JPEG passes technical gate", () => {
    const result = validateStockJpeg({
      width: 3000,
      height: 2000, // 6.0 MP
      fileSizeBytes: 4 * 1024 * 1024, // 4 MB
      format: "jpeg",
      colorProfile: "sRGB",
    });

    expect(result.valid).toBe(true);
    expect(result.megapixels).toBe(6.0);
    expect(result.errors).toHaveLength(0);
    expect(result.details.resolutionPass).toBe(true);
    expect(result.details.fileSizePass).toBe(true);
    expect(result.details.formatPass).toBe(true);
  });

  test("rejects image below 4MP resolution", () => {
    const result = validateStockJpeg({
      width: 1000,
      height: 1000, // 1.0 MP
      fileSizeBytes: 1024 * 1024,
      format: "jpg",
    });

    expect(result.valid).toBe(false);
    expect(result.megapixels).toBe(1.0);
    expect(result.details.resolutionPass).toBe(false);
    expect(result.errors.some((e) => e.includes("at least 4"))).toBe(true);
  });

  test("rejects image exceeding 100MP resolution", () => {
    const result = validateStockJpeg({
      width: 12000,
      height: 10000, // 120.0 MP
      fileSizeBytes: 20 * 1024 * 1024,
      format: "jpg",
    });

    expect(result.valid).toBe(false);
    expect(result.megapixels).toBe(120.0);
    expect(result.details.resolutionPass).toBe(false);
    expect(result.errors.some((e) => e.includes("maximum is 100"))).toBe(true);
  });

  test("rejects file exceeding 45MB limit", () => {
    const result = validateStockJpeg({
      width: 4000,
      height: 3000, // 12.0 MP
      fileSizeBytes: 50 * 1024 * 1024, // 50 MB
      format: "jpeg",
    });

    expect(result.valid).toBe(false);
    expect(result.details.fileSizePass).toBe(false);
    expect(result.errors.some((e) => e.includes("exceeds limit"))).toBe(true);
  });

  test("rejects non-JPEG formats", () => {
    const result = validateStockJpeg({
      width: 4000,
      height: 3000,
      fileSizeBytes: 2 * 1024 * 1024,
      format: "png",
    });

    expect(result.valid).toBe(false);
    expect(result.details.formatPass).toBe(false);
  });

  test("warns on non-sRGB color profile without failing", () => {
    const result = validateStockJpeg({
      width: 3000,
      height: 2000,
      fileSizeBytes: 3 * 1024 * 1024,
      format: "jpeg",
      colorProfile: "Display P3",
    });

    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("Non-sRGB"))).toBe(true);
  });
});

describe("Phase 16 — Stock Transparent PNG Validator", () => {
  test("valid transparent PNG with clean alpha passes", () => {
    const result = validateStockPng({
      width: 3000,
      height: 3000, // 9.0 MP
      fileSizeBytes: 5 * 1024 * 1024,
      format: "png",
      alphaStats: {
        hasAlphaChannel: true,
        transparentPixelCount: 3600000,
        totalPixelCount: 9000000,
        transparentRatio: 0.4, // 40% transparent
        subjectBounds: { minX: 500, maxX: 2500, minY: 500, maxY: 2500, width: 2000, height: 2000, areaRatio: 0.44 },
        edgeFringeScore: 0.02,
      },
    });

    expect(result.valid).toBe(true);
    expect(result.alphaPassed).toBe(true);
    expect(result.details.transparentRatioPass).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("rejects PNG without alpha channel", () => {
    const result = validateStockPng({
      width: 2500,
      height: 2500,
      fileSizeBytes: 3 * 1024 * 1024,
      format: "png",
      alphaStats: {
        hasAlphaChannel: false,
        transparentPixelCount: 0,
        totalPixelCount: 6250000,
        transparentRatio: 0,
      },
    });

    expect(result.valid).toBe(false);
    expect(result.alphaPassed).toBe(false);
    expect(result.details.alphaChannelPass).toBe(false);
    expect(result.errors.some((e) => e.includes("Missing alpha channel"))).toBe(true);
  });

  test("rejects solid PNG (<5% transparent) and empty canvas (>95% transparent)", () => {
    const solidResult = inspectAlphaChannel({ hasAlphaChannel: true, transparentRatio: 0.01 });
    expect(solidResult.alphaPassed).toBe(false);
    expect(solidResult.errors.some((e) => e.includes("appears solid"))).toBe(true);

    const emptyResult = inspectAlphaChannel({ hasAlphaChannel: true, transparentRatio: 0.98 });
    expect(emptyResult.alphaPassed).toBe(false);
    expect(emptyResult.errors.some((e) => e.includes("virtually empty"))).toBe(true);
  });

  test("warns when subject bounding box is too small or fringe risk is detected", () => {
    const alphaResult = inspectAlphaChannel({
      hasAlphaChannel: true,
      transparentRatio: 0.85,
      subjectBounds: { minX: 100, maxX: 400, minY: 100, maxY: 400, width: 300, height: 300, areaRatio: 0.09 },
      edgeFringeScore: 0.15, // > 0.08 tolerance
    });

    expect(alphaResult.alphaPassed).toBe(true);
    expect(alphaResult.warnings.some((w) => w.includes("Excessive empty canvas"))).toBe(true);
    expect(alphaResult.warnings.some((w) => w.includes("Potential edge halo"))).toBe(true);
  });
});

describe("Phase 16 — Stock Video Validator", () => {
  test("valid 1080p stock clip passes", () => {
    const result = validateStockVideo({
      durationSeconds: 12.5,
      container: "mp4",
      codec: "h264",
      fps: 29.97,
      width: 1920,
      height: 1080,
    });

    expect(result.valid).toBe(true);
    expect(result.details.durationPass).toBe(true);
    expect(result.details.containerPass).toBe(true);
    expect(result.details.codecPass).toBe(true);
    expect(result.details.resolutionPass).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("rejects clip shorter than 5 seconds", () => {
    const result = validateStockVideo({
      durationSeconds: 3.2,
      container: "mov",
      codec: "prores",
      fps: 24,
      width: 3840,
      height: 2160,
    });

    expect(result.valid).toBe(false);
    expect(result.details.durationPass).toBe(false);
    expect(result.errors.some((e) => e.includes("too short"))).toBe(true);
  });

  test("rejects clip longer than 60 seconds", () => {
    const result = validateStockVideo({
      durationSeconds: 75.0,
      container: "mp4",
      codec: "h264",
      fps: 30,
      width: 1920,
      height: 1080,
    });

    expect(result.valid).toBe(false);
    expect(result.details.durationPass).toBe(false);
    expect(result.errors.some((e) => e.includes("exceeds limit"))).toBe(true);
  });

  test("rejects unsupported container and codec", () => {
    const result = validateStockVideo({
      durationSeconds: 10.0,
      container: "avi",
      codec: "wmv3",
      fps: 25,
      width: 1920,
      height: 1080,
    });

    expect(result.valid).toBe(false);
    expect(result.details.containerPass).toBe(false);
    expect(result.details.codecPass).toBe(false);
  });

  test("warns on non-standard frame rate", () => {
    const result = validateStockVideo({
      durationSeconds: 10.0,
      container: "mp4",
      codec: "h264",
      fps: 18.0, // Non-standard
      width: 1920,
      height: 1080,
    });

    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("Non-standard frame rate"))).toBe(true);
  });
});

describe("Phase 16 — Stock Metadata Validator & Sanitizer", () => {
  test("valid title and deduplicated keywords pass", () => {
    const result = validateStockMetadata({
      title: "Automated modern factory robotic arm assembling electronics",
      keywords: [
        "Robotics",
        "AUTOMATION",
        "factory",
        "robotics", // Duplicate to be removed
        "technology",
        "modern",
        "industrial",
        "smart manufacturing",
      ],
      generatedAi: true,
    });

    expect(result.valid).toBe(true);
    expect(result.cleanedKeywords).toEqual([
      "robotics",
      "automation",
      "factory",
      "technology",
      "modern",
      "industrial",
      "smart manufacturing",
    ]);
    expect(result.details.prohibitedTermsPass).toBe(true);
    expect(result.details.generatedAiPass).toBe(true);
  });

  test("detects and rejects prohibited brand/artist/celebrity references", () => {
    const result = validateStockMetadata({
      title: "Mickey Mouse wearing Nike shoes painted in Marvel comic style",
      keywords: ["disney", "superman", "steve jobs", "taylor swift", "art"],
      generatedAi: true,
    });

    expect(result.valid).toBe(false);
    expect(result.details.prohibitedTermsPass).toBe(false);
    expect(result.flaggedProhibitedTerms.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes("Prohibited term"))).toBe(true);
  });

  test("rejects missing Generative AI flag when required", () => {
    const result = validateStockMetadata({
      title: "Clean photoreal commercial industrial background",
      keywords: ["industrial", "clean", "minimal", "commercial", "space", "texture"],
      generatedAi: false,
    });

    expect(result.valid).toBe(false);
    expect(result.details.generatedAiPass).toBe(false);
    expect(result.errors.some((e) => e.includes("Generative AI declaration"))).toBe(true);
  });

  test("rejects titles that are too short or exceed length limit", () => {
    const shortResult = validateStockMetadata({
      title: "Hi",
      keywords: ["one", "two", "three", "four", "five"],
      generatedAi: true,
    });
    expect(shortResult.valid).toBe(false);
    expect(shortResult.details.titlePass).toBe(false);

    const longResult = validateStockMetadata({
      title: "A".repeat(250),
      keywords: ["one", "two", "three", "four", "five"],
      generatedAi: true,
    });
    expect(longResult.valid).toBe(false);
    expect(longResult.details.titlePass).toBe(false);
  });
});

describe("Phase 16 — Stock Domain Storage & State Machine", () => {
  test("creates and lists stock opportunities and concepts", () => {
    const opp = createStockOpportunity({
      projectId: "proj_factory",
      title: "Industrial Automation B-Roll",
      niche: "smart_factory",
      buyerPersona: "tech_marketer",
      score: 88,
      confidence: 75,
      evidenceClass: "B",
      evidence: { demandSources: ["buyer_survey_2026"] },
    });

    expect(opp.id.startsWith("opp_")).toBe(true);
    expect(opp.score).toBe(88);

    const opps = listStockOpportunities("proj_factory");
    expect(opps).toHaveLength(1);
    expect(opps[0].title).toBe("Industrial Automation B-Roll");

    const concept = createStockConcept({
      projectId: "proj_factory",
      opportunityId: opp.id,
      title: "Robotic Hand Precise Placement",
      description: "Close-up slow dolly shot of robotic end-effector placing microchip",
      commercialUseCase: "B-roll for AI hardware launch",
      copySpace: "Left third clean negative space",
      differentiation: "Real industrial cleanroom aesthetics, no fantasy glow",
      productionMode: "stock_video",
    });

    expect(concept.id.startsWith("cpt_")).toBe(true);
    const concepts = listStockConcepts("proj_factory");
    expect(concepts).toHaveLength(1);
    expect(concepts[0].productionMode).toBe("stock_video");
  });

  test("handles full stock asset lifecycle from DRAFT to EXPORTED with lineage & QC", () => {
    const asset = createStockAsset({
      projectId: "proj_factory",
      type: "image",
      mode: "stock_image",
      status: "DRAFT",
      path: "./storage/assets/ast_001.jpg",
      width: 4000,
      height: 3000,
      megapixels: 12.0,
      provider: "comfyui",
      model: "sdxl-stock-v1",
      prompt: { prompt: "clean industrial automation" },
      generatedAi: true,
      fictionalPeopleProperty: false,
    });

    expect(asset.id.startsWith("ast_")).toBe(true);
    expect(asset.status).toBe("DRAFT");

    // Lineage record
    const lineage = recordStockLineage({
      assetId: asset.id,
      step: "initial_generation",
      details: { seed: 42, sampler: "dpmpp_2m" },
    });
    expect(lineage.step).toBe("initial_generation");

    // State transition to TECH_QC
    updateStockAssetStatus(asset.id, "TECH_QC");
    let current = getStockAsset(asset.id);
    expect(current?.status).toBe("TECH_QC");

    // Record Reviewer Council review
    const qc = recordStockQcReview({
      assetId: asset.id,
      reviewer: "technical_qc_agent",
      verdict: "pass",
      score: 95,
      report: { resolutionPass: true, fileSizePass: true },
    });
    expect(qc.verdict).toBe("pass");

    // Progress through state machine to EXPORT_READY
    updateStockAssetStatus(asset.id, "HUMAN_REVIEW");
    updateStockAssetStatus(asset.id, "EXPORT_READY");
    current = getStockAsset(asset.id);
    expect(current?.status).toBe("EXPORT_READY");

    // Create Export Pack
    const exportPack = createStockExportPack({
      projectId: "proj_factory",
      batchId: "batch_2026_08",
      manifest: {
        rulesVersion: "adobe-stock-2026-06-11",
        assets: [asset.id],
      },
      humanReviewRequired: true,
    });
    expect(exportPack.humanReviewRequired).toBe(true);

    // Final state transition
    updateStockAssetStatus(asset.id, "EXPORTED");
    current = getStockAsset(asset.id);
    expect(current?.status).toBe("EXPORTED");
  });
});
