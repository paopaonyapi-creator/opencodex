/**
 * Phase 20.84 (Decision Intelligence) & Phase 20.85 (Reviewer Council Correlation Guard) Test Suite
 */

import { describe, expect, it } from "bun:test";
import { getDecisionEngine } from "../src/agent-os/decision";
import { CalibrationEngine } from "../src/agent-os/decision/calibration";
import { ReviewerCorrelationGuard, type ReviewerVote } from "../src/agent-os/council/correlation-guard";

describe("Phase 20.84 — Decision Runtime", () => {
  it("evaluates agent.route decision with calibrated confidence", async () => {
    const engine = getDecisionEngine();

    const result = await engine.evaluate({
      requestId: "dec_test_01",
      contractId: "agent.route",
      state: { task: "code refactoring", repo: "frontend" },
    });

    expect(result.requestId).toBe("dec_test_01");
    expect(result.contractId).toBe("agent.route");
    expect(result.selected).toBe("codex");
    expect(result.confidence).toBeGreaterThan(0.9);
    expect(result.disposition).toBe("allow");
  });

  it("enforces Stage 1 hard deny even if provider confidence is 0.999 (probability != permission)", async () => {
    const engine = getDecisionEngine();

    const result = await engine.evaluate(
      {
        requestId: "dec_test_deny",
        contractId: "mcp.tool.risk",
        state: { tool: "dangerous_exec", args: ["rm -rf /"] },
      },
      {
        hardDenied: true,
        hardDenyReasons: ["Command matches forbidden destructive pattern"],
      },
    );

    expect(result.disposition).toBe("deny");
    expect(result.policy?.hardDenied).toBe(true);
    expect(result.policy?.reasons[0]).toContain("Hard policy denied");
  });

  it("requires human approval for critical risk contracts unless explicitly approved", async () => {
    const engine = getDecisionEngine();

    // shell.command.risk is riskTier: "critical"
    const unapproved = await engine.evaluate({
      requestId: "dec_shell_unapproved",
      contractId: "shell.command.risk",
      state: { command: "apt-get update" },
    });

    expect(unapproved.disposition).toBe("review");
    expect(unapproved.policy?.reasons[0]).toContain("Mandatory human approval required");

    // With explicit human approval
    const approved = await engine.evaluate(
      {
        requestId: "dec_shell_approved",
        contractId: "shell.command.risk",
        state: { command: "apt-get update" },
      },
      {
        humanApproved: true,
      },
    );

    expect(approved.disposition).toBe("allow");
  });

  it("calculates Brier score and Expected Calibration Error accurately", () => {
    const calibration = new CalibrationEngine();

    const samples = [
      { predictedProbability: 0.95, actualOutcome: 1 as const },
      { predictedProbability: 0.9, actualOutcome: 1 as const },
      { predictedProbability: 0.85, actualOutcome: 1 as const },
      { predictedProbability: 0.7, actualOutcome: 0 as const }, // Overconfident error
      { predictedProbability: 0.2, actualOutcome: 0 as const },
    ];

    const brier = calibration.calculateBrierScore(samples);
    const ece = calibration.calculateECE(samples);

    expect(brier).toBeGreaterThan(0);
    expect(brier).toBeLessThan(0.2);
    expect(ece).toBeGreaterThanOrEqual(0);
  });
});

describe("Phase 20.85 — Reviewer Council Correlation Guard", () => {
  it("detects correlated reviewers when multiple aliases share the same model family", () => {
    const votes: ReviewerVote[] = [
      {
        reviewerId: "reviewer_1",
        provider: "anthropic",
        model: "claude-3-7-sonnet",
        modelFamily: "claude",
        verdict: "PASS",
        confidence: 0.95,
      },
      {
        reviewerId: "reviewer_2",
        provider: "anthropic",
        model: "claude-3-5-haiku",
        modelFamily: "claude", // SAME FAMILY!
        verdict: "PASS",
        confidence: 0.92,
      },
    ];

    const evaluation = ReviewerCorrelationGuard.evaluate(votes, 2);

    expect(evaluation.isCorrelated).toBe(true);
    expect(evaluation.correlatedFamilies).toContain("claude");
    expect(evaluation.effectiveIndependentVotes).toBe(1); // Only 1 family represented!
    expect(evaluation.warning).toContain("Reviewer correlation detected");
  });

  it("passes when reviewers originate from distinct model families", () => {
    const votes: ReviewerVote[] = [
      {
        reviewerId: "reviewer_1",
        provider: "anthropic",
        model: "claude-3-7-sonnet",
        modelFamily: "claude",
        verdict: "PASS",
        confidence: 0.95,
      },
      {
        reviewerId: "reviewer_2",
        provider: "openai",
        model: "gpt-4o",
        modelFamily: "gpt-4", // DISTINCT FAMILY!
        verdict: "PASS",
        confidence: 0.94,
      },
      {
        reviewerId: "reviewer_3",
        provider: "google",
        model: "gemini-2.0-flash",
        modelFamily: "gemini", // DISTINCT FAMILY!
        verdict: "PASS",
        confidence: 0.91,
      },
    ];

    const evaluation = ReviewerCorrelationGuard.evaluate(votes, 2);

    expect(evaluation.isCorrelated).toBe(false);
    expect(evaluation.passed).toBe(true);
    expect(evaluation.effectiveIndependentVotes).toBe(3);
    expect(evaluation.distinctFamilies.length).toBe(3);
  });

  it("records reviewer run and diluted vote weights in SQLite", () => {
    const votes: ReviewerVote[] = [
      {
        reviewerId: "rev_a",
        provider: "anthropic",
        model: "claude-sonnet",
        modelFamily: "claude",
        verdict: "PASS",
        confidence: 0.9,
      },
      {
        reviewerId: "rev_b",
        provider: "anthropic",
        model: "claude-haiku",
        modelFamily: "claude",
        verdict: "PASS",
        confidence: 0.9,
      },
    ];

    const runId = ReviewerCorrelationGuard.recordReviewerRun(
      "diff_hash_12345",
      "pr_check",
      votes,
      "PASS",
    );

    expect(runId).toContain("crun_");
  });
});
