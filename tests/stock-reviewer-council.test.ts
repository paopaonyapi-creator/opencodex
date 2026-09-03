import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeAgentOsDbForTests, openAgentOsDb } from "../src/agent-os/db";
import { createStockAsset, getStockAsset, type StockAsset } from "../src/agent-os/stock-models";
import {
  runTechnicalQcAgent,
  runVisualArtifactAgent,
  runCommercialValueReviewer,
  runSimilarityReviewer,
  runComplianceReviewer,
} from "../src/agent-os/reviewers/stock-reviewers";
import {
  evaluateAssetByCouncil,
  applyHumanCouncilOverride,
} from "../src/agent-os/reviewers/reviewer-council";
import {
  calculateTextSimilarity,
  calculateVisualSimilarity,
  evaluateSimilarity,
} from "../src/agent-os/similarity/similarity-engine";

let tempDir = "";

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "stock-council-test-"));
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

function createMockAsset(overrides: Partial<StockAsset> = {}): StockAsset {
  return createStockAsset({
    projectId: "proj_factory",
    type: "image",
    mode: "stock_image",
    status: "GENERATED",
    path: "./storage/assets/test_img.jpg",
    width: 3840,
    height: 2160, // 8.29 MP
    megapixels: 8.29,
    provider: "comfyui",
    model: "sdxl-stock-v1",
    prompt: {
      positivePrompt: "modern industrial warehouse with clean automated logistics and copy space",
      fileSizeBytes: 4 * 1024 * 1024,
    },
    generatedAi: true,
    fictionalPeopleProperty: false,
    ...overrides,
  });
}

describe("Phase 16 — Similarity Engine", () => {
  test("calculates text token similarity accurately", () => {
    const textA = "Modern automated factory robotic arm with microchips";
    const textB = "Modern automated factory robotic arm with circuit boards";
    const textC = "Cozy sunset coffee shop interior with wooden table";

    const simAB = calculateTextSimilarity(textA, textB);
    const simAC = calculateTextSimilarity(textA, textC);

    expect(simAB).toBeGreaterThan(0.6);
    expect(simAC).toBeLessThan(0.15);
  });

  test("calculates visual perceptual hash similarity accurately", () => {
    const hashA = "ffff88000000ffff";
    const hashExactA = "ffff88000000ffff";
    const hashNearA = "ffff88000000fffe"; // 1 bit diff
    const hashDifferent = "000077ffffff0000";

    expect(calculateVisualSimilarity(hashA, hashExactA)).toBe(1.0);
    expect(calculateVisualSimilarity(hashA, hashNearA)!).toBeGreaterThan(0.95);
    expect(calculateVisualSimilarity(hashA, hashDifferent)!).toBeLessThan(0.3);
  });

  test("evaluates and classifies similarity categories correctly", () => {
    const candidate = { id: "ast_1", promptText: "Modern robotic arm factory", perceptualHash: "ffff88000000ffff" };
    const exactSibling = [{ id: "ast_2", promptText: "Modern robotic arm factory", perceptualHash: "ffff88000000ffff" }];
    const distinctSibling = [{ id: "ast_3", promptText: "Sunset mountain landscape", perceptualHash: "000077ffffff0000" }];

    const dupResult = evaluateSimilarity(candidate, exactSibling);
    expect(dupResult.category).toBe("DUPLICATE");
    expect(dupResult.score).toBeGreaterThanOrEqual(0.9);

    const distResult = evaluateSimilarity(candidate, distinctSibling);
    expect(distResult.category).toBe("UNIQUE");
    expect(distResult.score).toBeLessThan(0.4);
  });
});

describe("Phase 16 — 5 Reviewer Council Agents", () => {
  test("1. Technical QC Agent validates specs", () => {
    const validAsset = createMockAsset();
    const validReport = runTechnicalQcAgent(validAsset);
    expect(validReport.verdict).toBe("pass");
    expect(validReport.score).toBe(100);

    const badAsset = createMockAsset({ width: 800, height: 600 }); // 0.48 MP (<4MP)
    const badReport = runTechnicalQcAgent(badAsset);
    expect(badReport.verdict).toBe("fail");
    expect(badReport.issues.length).toBeGreaterThan(0);
  });

  test("2. Visual Artifact Agent flags anatomical defects and blur", () => {
    const asset = createMockAsset();

    const cleanReport = runVisualArtifactAgent(asset, {});
    expect(cleanReport.verdict).toBe("pass");

    const flawedReport = runVisualArtifactAgent(asset, { hasAnatomyDefect: true });
    expect(flawedReport.verdict).toBe("fail");
    expect(flawedReport.issues.some((i) => i.includes("Anatomical"))).toBe(true);

    const blurReport = runVisualArtifactAgent(asset, { hasBlurOrOverSharpen: true });
    expect(blurReport.verdict).toBe("warn");
  });

  test("3. Commercial Value Reviewer flags low utility", () => {
    const asset = createMockAsset();

    const goodReport = runCommercialValueReviewer(asset, { hasClearSubject: true, buyerUtilityRating: 5 });
    expect(goodReport.verdict).toBe("pass");
    expect(goodReport.score).toBe(100);

    const badReport = runCommercialValueReviewer(asset, { hasClearSubject: false, buyerUtilityRating: 1, compositionClarity: "poor" });
    expect(badReport.verdict).toBe("fail");
  });

  test("4. Similarity Reviewer catches near-duplicates", () => {
    const asset = createMockAsset({ id: "ast_cand" });
    const siblings = [{ id: "ast_sib1", promptText: "modern industrial warehouse with clean automated logistics and copy space" }];

    const report = runSimilarityReviewer(asset, siblings);
    expect(report.verdict).toBe("fail");
    expect(report.issues.some((i) => i.includes("duplicate") || i.includes("similarity"))).toBe(true);
  });

  test("5. Compliance Reviewer flags trademark risks without auto-failing", () => {
    const asset = createMockAsset({
      prompt: { positivePrompt: "Nike running shoes on Marvel hero in Disney park" },
    });

    const report = runComplianceReviewer(asset);
    expect(report.verdict).toBe("warn");
    expect(report.issues.some((i) => i.includes("trademark risk"))).toBe(true);
    expect(report.details.requiresHumanVerification).toBe(true);
  });
});

describe("Phase 16 — Council Orchestration & State Lifecycle", () => {
  test("all pass -> READY_FOR_HUMAN_SUBMISSION_REVIEW (HUMAN_REVIEW status)", () => {
    const asset = createMockAsset({ id: "ast_clean" });
    const summary = evaluateAssetByCouncil(asset, {
      siblings: [],
      commercialContext: { buyerUtilityRating: 5 },
    });

    expect(summary.decision).toBe("READY_FOR_HUMAN_SUBMISSION_REVIEW");
    expect(summary.recommendedAssetStatus).toBe("HUMAN_REVIEW");
    expect(summary.compositeScore).toBeGreaterThanOrEqual(85);

    const updated = getStockAsset(asset.id);
    expect(updated?.status).toBe("HUMAN_REVIEW");
  });

  test("technical failure -> NEEDS_FIXES", () => {
    const asset = createMockAsset({ id: "ast_lowres", width: 500, height: 500 });
    const summary = evaluateAssetByCouncil(asset);

    expect(summary.decision).toBe("NEEDS_FIXES");
    expect(summary.recommendedAssetStatus).toBe("NEEDS_FIXES");

    const updated = getStockAsset(asset.id);
    expect(updated?.status).toBe("NEEDS_FIXES");
  });

  test("compliance flag -> HOLD_FOR_COMPLIANCE_REVIEW", () => {
    const asset = createMockAsset({
      id: "ast_ip_risk",
      prompt: { positivePrompt: "Cleanroom robot with Apple logo on chassis" },
    });
    const summary = evaluateAssetByCouncil(asset);

    expect(summary.decision).toBe("HOLD_FOR_COMPLIANCE_REVIEW");
    expect(summary.recommendedAssetStatus).toBe("HOLD_COMPLIANCE");

    const updated = getStockAsset(asset.id);
    expect(updated?.status).toBe("HOLD_COMPLIANCE");
  });

  test("human supervisor can override Council decision with audit trail", () => {
    const asset = createMockAsset({ id: "ast_hold_to_approve" });
    evaluateAssetByCouncil(asset, {
      metadata: { title: "Industrial robot", keywords: ["nike", "tech"] }, // will trigger compliance hold
    });

    let current = getStockAsset(asset.id);
    expect(current?.status).toBe("HOLD_COMPLIANCE");

    // Human supervisor reviews and confirms false positive
    const override = applyHumanCouncilOverride(
      asset.id,
      "APPROVED",
      "Human verified: keyword 'nike' was a false match, actual visual content is 100% unbranded generic machinery.",
      "senior-reviewer-pao",
    );

    expect(override.success).toBe(true);
    expect(override.newStatus).toBe("EXPORT_READY");

    current = getStockAsset(asset.id);
    expect(current?.status).toBe("EXPORT_READY");
  });
});
