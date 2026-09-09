import { describe, expect, test } from "bun:test";
import { ModelOptimizer } from "../src/agent-os/economy/model-optimizer";

describe("Phase 24 — ModelOptimizer", () => {
  const optimizer = new ModelOptimizer();

  test("preserves Tier 1 model when budget is healthy and task is complex", () => {
    const rec = optimizer.recommendRoute({
      requestedModelId: "claude-3-5-sonnet-20241022",
      taskType: "feature_code_refactor",
      budgetStatus: "healthy",
      safeguardAction: "none",
    });

    expect(rec.recommendedTier).toBe("tier1_ultra");
    expect(rec.recommendedModelId).toBe("claude-3-5-sonnet-20241022");
    expect(rec.downgraded).toBe(false);
    expect(rec.estimatedSavingsPercent).toBe(0);
  });

  test("downgrades to Tier 2 for low complexity tasks to optimize cost", () => {
    const rec = optimizer.recommendRoute({
      requestedModelId: "claude-3-5-sonnet-20241022",
      taskType: "summary",
      budgetStatus: "healthy",
      safeguardAction: "none",
    });

    expect(rec.recommendedTier).toBe("tier2_balanced");
    expect(rec.recommendedModelId).toBe("claude-3-5-haiku-20241022");
    expect(rec.downgraded).toBe(true);
    expect(rec.estimatedSavingsPercent).toBe(80);
    expect(rec.rationale).toContain("low complexity");
  });

  test("forces downgrade to Tier 2 on budget warning", () => {
    const rec = optimizer.recommendRoute({
      requestedModelId: "gpt-4o",
      taskType: "creative_prompt",
      budgetStatus: "warning",
      safeguardAction: "none",
    });

    expect(rec.recommendedTier).toBe("tier2_balanced");
    expect(rec.downgraded).toBe(true);
    expect(rec.rationale).toContain("Budget warning");
  });

  test("forces fallback to Tier 3 Local/Free on circuit breaker trip", () => {
    const rec = optimizer.recommendRoute({
      requestedModelId: "claude-3-5-sonnet-20241022",
      taskType: "critical_worktree",
      budgetStatus: "circuit_broken",
      safeguardAction: "circuit_broken",
    });

    expect(rec.recommendedTier).toBe("tier3_economy");
    expect(rec.recommendedModelId).toBe("ollama/qwen2.5-coder:32b");
    expect(rec.downgraded).toBe(true);
    expect(rec.estimatedSavingsPercent).toBe(100);
    expect(rec.rationale).toContain("circuit breaker");
  });

  test("calculates token cost savings accurately", () => {
    // 100k input, 20k output
    const savings = optimizer.calculateSavings(100_000, 20_000, "tier1_ultra", "tier2_balanced");
    // Tier 1: (100k * 3.0 + 20k * 15.0) / 1M = 0.30 + 0.30 = $0.60
    // Tier 2: (100k * 0.25 + 20k * 1.25) / 1M = 0.025 + 0.025 = $0.05
    // Savings = $0.55
    expect(savings).toBeCloseTo(0.55, 2);
  });
});
