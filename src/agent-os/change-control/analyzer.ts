/**
 * Phase 22 — Pao Autonomous Change Control: Analyzer
 * Computes blast radius, dependency graph impact, and risk tier scoring (R0-R5).
 */

import type { BlastRadiusReport, IntentCategory, RiskTier } from "./types";

export const DEFAULT_CRITICAL_PATTERNS = [
  "src/router.ts",
  "src/server/lifecycle.ts",
  "src/server/responses/core.ts",
  "src/server/auth",
  "src/ai-gateway/auth",
  "src/agent-os/governance",
  ".github/workflows",
  "scripts/release.ts",
];

export interface AnalyzeOptions {
  files: string[];
  diffText?: string;
  intentCategory?: IntentCategory;
  criticalPatterns?: string[];
}

export class ChangeAnalyzer {
  private criticalPatterns: string[];

  constructor(criticalPatterns: string[] = DEFAULT_CRITICAL_PATTERNS) {
    this.criticalPatterns = criticalPatterns;
  }

  /**
   * Analyze list of changed files and optional git diff text
   */
  public analyze(options: AnalyzeOptions): BlastRadiusReport {
    const { files, diffText = "", intentCategory } = options;
    const explanations: string[] = [];

    // 1. Identify critical paths touched
    const criticalPathsTouched = files.filter((f) =>
      this.criticalPatterns.some((pattern) => f.includes(pattern))
    );

    if (criticalPathsTouched.length > 0) {
      explanations.push(
        `Critical system boundaries touched: ${criticalPathsTouched.join(", ")}`
      );
    }

    // 2. Identify direct and transitive dependents (heuristic simulation)
    const directDependents = this.resolveDirectDependents(files);
    const transitiveDependents = this.resolveTransitiveDependents(directDependents);

    // 3. Calculate Blast Radius Score (0.0 to 1.0)
    // Formula: B = min(1.0, 0.15*fileCount + 0.05*transitives + 0.4*hasCritical + 0.2*isSecurity)
    const fileCountWeight = Math.min(0.4, files.length * 0.08);
    const dependentWeight = Math.min(0.3, transitiveDependents.length * 0.04);
    const criticalWeight = criticalPathsTouched.length > 0 ? 0.4 : 0.0;
    const isSecurityOrAuth =
      intentCategory === "security" ||
      files.some((f) => f.includes("auth") || f.includes("secret") || f.includes("token"));
    const securityWeight = isSecurityOrAuth ? 0.2 : 0.0;

    let rawScore = fileCountWeight + dependentWeight + criticalWeight + securityWeight;

    // Check for pure documentation / comments / minor edits
    const isPureDocs = files.length > 0 && files.every((f) => f.endsWith(".md") || f.includes("docs/"));
    if (isPureDocs) {
      rawScore = Math.min(rawScore, 0.05);
      explanations.push("Changes strictly confined to documentation (.md files).");
    } else {
      rawScore += 0.05; // Base executable code change delta
    }

    const score = Number(Math.min(1.0, Math.max(0.0, rawScore)).toFixed(3));

    // 4. Assign Risk Tier R0 - R5
    const riskTier = this.classifyRiskTier(score, criticalPathsTouched.length > 0, isSecurityOrAuth, isPureDocs);

    explanations.push(`Calculated Blast Radius Score: ${score} -> Classified as Risk Tier ${riskTier}`);
    if (directDependents.length > 0) {
      explanations.push(`Direct dependent modules: ${directDependents.length}`);
    }
    if (transitiveDependents.length > 0) {
      explanations.push(`Transitive dependent modules: ${transitiveDependents.length}`);
    }

    return {
      score,
      touchedFiles: [...files],
      directDependents,
      transitiveDependents,
      criticalPathsTouched,
      riskTier,
      explanation: explanations,
    };
  }

  /**
   * Determine Risk Tier based on score and critical factors
   */
  private classifyRiskTier(
    score: number,
    hasCriticalPaths: boolean,
    isSecurity: boolean,
    isPureDocs: boolean
  ): RiskTier {
    if (isPureDocs && score < 0.1) return "R0";
    if (isSecurity || hasCriticalPaths) {
      if (score >= 0.8) return "R5";
      return "R4";
    }
    if (score >= 0.75) return "R4";
    if (score >= 0.5) return "R3";
    if (score >= 0.25) return "R2";
    if (score >= 0.1) return "R1";
    return "R0";
  }

  /**
   * Mock / heuristic dependency discovery based on standard Pao-hubPro modular paths
   */
  private resolveDirectDependents(files: string[]): string[] {
    const dependents = new Set<string>();

    for (const f of files) {
      if (f.includes("src/ai-gateway/")) {
        dependents.add("src/server/management/sidebar-routes.ts");
        dependents.add("gui/src/pages/AiGateway.tsx");
      }
      if (f.includes("src/agent-os/")) {
        dependents.add("src/server/management/agent-os-routes.ts");
        dependents.add("gui/src/pages/AgentControlCenter.tsx");
      }
      if (f.includes("src/router.ts")) {
        dependents.add("src/server/lifecycle.ts");
        dependents.add("src/server/responses/core.ts");
        dependents.add("src/server/index.ts");
      }
      if (f.includes("gui/src/")) {
        dependents.add("gui/src/App.tsx");
      }
    }

    return Array.from(dependents);
  }

  private resolveTransitiveDependents(directDependents: string[]): string[] {
    const transitives = new Set<string>();

    for (const dep of directDependents) {
      if (dep.includes("src/server/index.ts")) {
        transitives.add("src/cli/index.ts");
      }
      if (dep.includes("gui/src/App.tsx")) {
        transitives.add("gui/dist/index.html");
      }
    }

    return Array.from(transitives);
  }
}
