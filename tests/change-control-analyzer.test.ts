import { describe, expect, test } from "bun:test";
import { ChangeAnalyzer } from "../src/agent-os/change-control/analyzer";

describe("Phase 22 — ChangeAnalyzer", () => {
  const analyzer = new ChangeAnalyzer();

  test("classifies pure documentation changes as R0 with minimal blast radius", () => {
    const report = analyzer.analyze({
      files: ["docs/README.md", "docs/architecture.md"],
      intentCategory: "docs",
    });

    expect(report.riskTier).toBe("R0");
    expect(report.score).toBeLessThanOrEqual(0.1);
    expect(report.criticalPathsTouched.length).toBe(0);
    expect(report.explanation.some((e) => e.includes("documentation"))).toBe(true);
  });

  test("classifies single non-critical leaf code change as R1", () => {
    const report = analyzer.analyze({
      files: ["src/utils/format-helper.ts"],
      intentCategory: "fix",
    });

    expect(report.riskTier).toBe("R1");
    expect(report.score).toBeLessThan(0.25);
    expect(report.criticalPathsTouched.length).toBe(0);
  });

  test("classifies multi-file feature additions as R2 or R3", () => {
    const report = analyzer.analyze({
      files: [
        "src/agent-os/tasks.ts",
        "src/agent-os/teams.ts",
        "src/agent-os/workflow.ts",
        "gui/src/pages/AgentControlCenter.tsx",
      ],
      intentCategory: "feature",
    });

    expect(["R2", "R3"]).toContain(report.riskTier);
    expect(report.score).toBeGreaterThanOrEqual(0.25);
    expect(report.directDependents.length).toBeGreaterThan(0);
  });

  test("classifies changes touching critical proxy paths as R4 with critical warnings", () => {
    const report = analyzer.analyze({
      files: ["src/router.ts", "src/server/lifecycle.ts"],
      intentCategory: "refactor",
    });

    expect(report.riskTier).toBe("R4");
    expect(report.criticalPathsTouched).toContain("src/router.ts");
    expect(report.criticalPathsTouched).toContain("src/server/lifecycle.ts");
    expect(report.explanation.some((e) => e.includes("Critical system boundaries"))).toBe(true);
  });

  test("classifies critical security and auth boundary touches as R4 or R5", () => {
    const report = analyzer.analyze({
      files: [
        "src/server/auth.ts",
        "src/ai-gateway/auth/budget.ts",
        "src/router.ts",
        "scripts/release.ts",
      ],
      intentCategory: "security",
    });

    expect(["R4", "R5"]).toContain(report.riskTier);
    expect(report.score).toBeGreaterThanOrEqual(0.7);
  });
});
