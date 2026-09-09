import { describe, expect, test } from "bun:test";
import { SandboxRunner } from "../src/agent-os/change-control/sandbox";

describe("Phase 22 — SandboxRunner", () => {
  const runner = new SandboxRunner(".tmp/test-sandboxes");

  test("runs default gate check verification successfully", async () => {
    const result = await runner.runVerification({
      proposalId: "prop-01",
      sourceBranch: "pao/feature-branch",
    });

    expect(result.success).toBe(true);
    expect(result.receipt.allPassed).toBe(true);
    expect(result.receipt.typecheck.passed).toBe(true);
    expect(result.receipt.lint.passed).toBe(true);
    expect(result.receipt.unitTests.passed).toBe(true);
    expect(result.receipt.boundaryTests.passed).toBe(true);
    expect(result.receipt.privacyScan.passed).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("handles simulated failure in mock results gracefully", async () => {
    const result = await runner.runVerification({
      proposalId: "prop-02",
      sourceBranch: "pao/failing-branch",
      mockResults: {
        typecheck: { passed: false, durationMs: 250, error: "TS2304: Cannot find name 'foo'" },
      },
    });

    expect(result.success).toBe(false);
    expect(result.receipt.allPassed).toBe(false);
    expect(result.receipt.typecheck.passed).toBe(false);
  });

  test("cleans up ephemeral sandbox directory", async () => {
    const cleaned = await runner.cleanup(".tmp/test-sandboxes/prop-01");
    expect(cleaned).toBe(true);
  });
});
