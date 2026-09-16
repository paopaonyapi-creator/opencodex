/**
 * Pao Market Signal Control Plane — Phase 20.52 analysis layer tests.
 *
 * Covers spec §66: AI unsupported numbers are flagged, fabrication patterns
 * are detected, the reviewer council votes deterministically, and council
 * consensus can never override a hard risk failure.
 */

import { describe, test, expect } from "bun:test";
import { validateAnalysisNumbers, detectFabricationPhrases } from "../src/agent-os/market/analysis/hallucination-guard";
import { runReviewerCouncil, deterministicAnalysisModel, PROMPT_VERSIONS } from "../src/agent-os/market/analysis/orchestrator";
import { AnalysisOrchestrator } from "../src/agent-os/market/analysis/orchestrator";
import type { MarketAIAnalysisDraft, TrustedNumericContext } from "../src/agent-os/market/analysis/analysis-types";
import type { MarketSignal, RiskAssessment, SignalQuality } from "../src/agent-os/market/types";

const TRUSTED: TrustedNumericContext = {
  currencyValues: [200.25, 196, 208],
  percentValues: [0.5, 70],
  plainValues: [100, 8],
};

function draft(overrides: Partial<MarketAIAnalysisDraft> = {}): MarketAIAnalysisDraft {
  return {
    summary: "Provider issued an entry signal at entry 200.25 with stop 196 and target 208.",
    bullishFactors: ["Provider direction is long"],
    bearishFactors: [],
    invalidationFactors: ["Thesis invalidates at the provider stop 196"],
    riskNotes: ["Analysis is decision support only."],
    confidence: 0.7,
    confidenceBasis: ["provider-reported confidence"],
    dataSufficient: true,
    missingData: [],
    ...overrides,
  };
}

function signal(overrides: Partial<MarketSignal> = {}): MarketSignal {
  return {
    id: "msig-1",
    provider: "kamden",
    eventType: "entry",
    symbol: "AAPL",
    assetClass: "equity",
    direction: "long",
    entryPrice: 200.25,
    stopPrice: 196,
    targetPrice: 208,
    providerConfidence: 0.7,
    providerScore: 8,
    signalTime: "2026-01-01T00:00:00.000Z",
    receivedAt: "2026-01-01T00:00:01.000Z",
    normalizedAt: "2026-01-01T00:00:01.000Z",
    verified: true,
    duplicate: false,
    tags: [],
    rawEventId: "mraw-1",
    metadata: {},
    ...overrides,
  };
}

describe("Phase 20.52 — hallucination guard", () => {
  test("numbers present in trusted context pass", () => {
    const validation = validateAnalysisNumbers(draft(), TRUSTED);
    expect(validation.valid).toBe(true);
    expect(validation.unsupportedClaims).toHaveLength(0);
  });

  test("an unsupported numeric claim is flagged, not silently accepted", () => {
    const withFabricatedPrice = draft({
      summary: "Momentum is building and the stock could reach $225.50 soon.",
    });
    const validation = validateAnalysisNumbers(withFabricatedPrice, TRUSTED);
    expect(validation.valid).toBe(false);
    expect(validation.unsupportedClaims.length).toBeGreaterThan(0);
    expect(validation.unsupportedClaims[0]).toContain("225.50");
    expect(validation.warnings.length).toBeGreaterThan(0);
  });

  test("percent claims are checked against the percent context", () => {
    const ok = validateAnalysisNumbers(draft({ riskNotes: ["Planned risk is 0.5% of paper equity."] }), TRUSTED);
    expect(ok.valid).toBe(true);
    const bad = validateAnalysisNumbers(draft({ riskNotes: ["Planned risk is 5.5% of paper equity."] }), TRUSTED);
    expect(bad.valid).toBe(false);
  });

  test("small integer counts are tolerated as enumerations", () => {
    const validation = validateAnalysisNumbers(draft({ summary: "3 factors support the setup; entry 200.25." }), TRUSTED);
    expect(validation.valid).toBe(true);
  });

  test("fabrication patterns (live price, earnings, market cap) are detected", () => {
    const hits = detectFabricationPhrases(
      draft({
        summary: "The stock is trading at record highs and the market cap of the company keeps growing.",
        riskNotes: ["Earnings date is next week."],
      }),
    );
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(hits.some(h => h.includes("market cap"))).toBe(true);
    expect(hits.some(h => h.toLowerCase().includes("earnings date"))).toBe(true);
  });
});

const quality: SignalQuality = { grade: "A", reasons: [] };

describe("Phase 20.52 — reviewer council", () => {

  test("all-clear context produces support", () => {
    const consensus = runReviewerCouncil({ signal: signal(), draft: draft(), validation: { valid: true, unsupportedClaims: [] }, quality });
    expect(consensus.result).toBe("support");
    expect(consensus.votes.map(v => v.reviewer)).toContain("DevilsAdvocateReviewer");
  });

  test("a hard risk failure makes the RiskReviewer oppose", () => {
    const riskAssessment: RiskAssessment = {
      id: "mrsk-1",
      signalId: "msig-1",
      passed: false,
      hardFailures: [{ policyId: "max_daily_loss", severity: "HARD_FAIL", code: "MARKET_RISK_HARD_FAIL", message: "Daily loss limit breached" }],
      warnings: [],
      infos: [],
      createdAt: new Date().toISOString(),
    };
    const consensus = runReviewerCouncil({ signal: signal(), draft: draft(), validation: { valid: true, unsupportedClaims: [] }, riskAssessment, quality });
    expect(consensus.result).toBe("oppose");
    expect(consensus.votes.find(v => v.reviewer === "RiskReviewer")?.verdict).toBe("oppose");
  });

  test("high conviction on incomplete data is challenged", () => {
    const consensus = runReviewerCouncil({
      signal: signal(),
      draft: draft({ confidence: 0.95, dataSufficient: false }),
      validation: { valid: true, unsupportedClaims: [] },
      quality: { grade: "insufficient", reasons: ["missing data"] },
    });
    const devil = consensus.votes.find(v => v.reviewer === "DevilsAdvocateReviewer")!;
    expect(devil.verdict).toBe("oppose");
  });

  test("unsupported claims make the PolicyReviewer abstain", () => {
    const consensus = runReviewerCouncil({
      signal: signal(),
      draft: draft(),
      validation: { valid: false, unsupportedClaims: ['summary: "$225.50"'] },
      quality,
    });
    expect(consensus.votes.find(v => v.reviewer === "PolicyReviewer")?.warnings.length).toBeGreaterThan(0);
  });
});

describe("Phase 20.52 — analysis orchestrator", () => {
  test("the deterministic default model only restates trusted context", async () => {
    const orchestrator = new AnalysisOrchestrator({ model: deterministicAnalysisModel(), councilEnabled: true });
    const analysis = await orchestrator.analyze({ signal: signal(), quality });
    expect(analysis.summary).toContain("200.25");
    expect(analysis.summary).not.toContain("225");
    expect(analysis.validation.valid).toBe(true);
    expect(analysis.reviewerConsensus?.result).toBe("support");
    expect(analysis.riskNotes.join(" ")).toContain("decision support");
    expect(analysis.modelRuns.every(r => r.success)).toBe(true);
    expect(analysis.modelRuns[0]?.promptVersion).toBe(PROMPT_VERSIONS.summary);
  });

  test("a failing model stage degrades the analysis without inventing content", async () => {
    const orchestrator = new AnalysisOrchestrator({
      model: async request => {
        if (request.stage === "market_context") throw new Error("model unavailable");
        return { ...(await deterministicAnalysisModel()(request)) };
      },
      councilEnabled: false,
    });
    const analysis = await orchestrator.analyze({ signal: signal(), quality });
    expect(analysis.modelRuns.some(r => r.success === false && r.errorCode === "model unavailable")).toBe(true);
    expect(analysis.reviewerConsensus).toBeUndefined();
  });
});
