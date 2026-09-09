/**
 * Pao AI Gateway — Deterministic Risk Classifier (R0 to R5).
 *
 * Implements Section 17 of Phase 20.13 specification:
 * - Deterministically classifies task/request risk level
 * - Assigns required council review policy based on risk
 * - Fail-closed: Ambiguous dangerous operations map to R4 or R5
 */

import type {
  RiskClassificationResult,
  RiskLevel,
  ReviewRequirement,
} from "./types";

// Patterns indicating R5 destructive or security-critical operations
const R5_PATTERNS = [
  /rm\s+(-[rfRF]{1,4}\s+[\/\*]|--recursive)/i,
  /\bdrop\s+(database|table|schema)\b/i,
  /\btruncate\s+table\b/i,
  /\bdelete\s+from\s+\w+\s*;?$/i, // unconstrained delete without WHERE
  /\bformat\s+[c-z]:/i,
  /\bdd\s+if=.*of=\/dev\//i,
  /\bgit\s+push\s+.*(--force|-f)\b/i,
  /\bdeploy\s+.*(--prod|--production)\b/i,
  /\bexport\s+.*(?:private_key|secret_key|root_token)\b/i,
  /\.env\b.*(?:overwrite|write|delete)/i,
];

// Patterns indicating R4 privileged / local execution
const R4_PATTERNS = [
  /\bsudo\b/i,
  /\bchmod\s+[0-7]{3,4}\b/i,
  /\bchown\b/i,
  /\b(kill|pkill|killall)\s+-9\b/i,
  /\bcurl\s+.*\|\s*(bash|sh)\b/i,
  /\b(run_command|exec|spawn|subprocess)\b/i,
  /\bnetcat\b|\bnc\s+-l/i,
  /\biptables\b/i,
  /\bsystemctl\s+(stop|disable|mask)\b/i,
];

// Patterns indicating R3 dependency / configuration / migration
const R3_PATTERNS = [
  /\b(npm|bun|pnpm|yarn)\s+(install|add|remove|uninstall)\b/i,
  /\bpip\s+(install|uninstall)\b/i,
  /\b(cargo|go)\s+(add|get)\b/i,
  /\b(migration|schema|ddl)\b/i,
  /\b(tsconfig\.json|package\.json|vite\.config)\b/i,
  /\bconfig\/ai-gateway\//i,
  /\balter\s+table\b/i,
];

// Patterns indicating R2 multi-file or feature work
const R2_PATTERNS = [
  /\brefactor\b/i,
  /\bnew feature\b/i,
  /\barchitecture\b/i,
  /\bmultiple files\b/i,
  /\bacross\s+\w+\s+files\b/i,
];

// Patterns indicating R0 read-only / informational
const R0_PATTERNS = [
  /\b(explain|what is|how does|why does|describe|summarize|lookup|view|read)\b/i,
  /\bhow to\b/i,
  /\bdocumentation\b/i,
];

/**
 * Determine the ReviewRequirement based on the RiskLevel.
 */
export function getReviewRequirementForRisk(level: RiskLevel): ReviewRequirement {
  switch (level) {
    case "R5":
      return {
        type: "human_approval_required",
        minReviewers: 2,
        requiredRoles: ["reviewer-security", "reviewer-architecture"],
        requireDifferentProviders: true,
        humanApprovalRequired: true,
      };
    case "R4":
      return {
        type: "full_council",
        minReviewers: 2,
        requiredRoles: ["reviewer-security", "reviewer-architecture"],
        requireDifferentProviders: true,
        humanApprovalRequired: false,
      };
    case "R3":
      return {
        type: "mandatory_single",
        minReviewers: 1,
        requiredRoles: ["reviewer-architecture"],
        requireDifferentProviders: true,
        humanApprovalRequired: false,
      };
    case "R2":
      return {
        type: "optional",
        minReviewers: 1,
        requiredRoles: ["reviewer-correctness"],
        requireDifferentProviders: false,
        humanApprovalRequired: false,
      };
    case "R1":
    case "R0":
    default:
      return {
        type: "none",
        minReviewers: 0,
        requiredRoles: [],
        requireDifferentProviders: false,
        humanApprovalRequired: false,
      };
  }
}

/**
 * Classify a task, command, or prompt into a RiskLevel.
 */
export function classifyRisk(input: {
  text: string;
  affectedFiles?: readonly string[];
  command?: string;
  alias?: string;
}): RiskClassificationResult {
  const reasons: string[] = [];
  const detectedPatterns: string[] = [];
  const fullContent = [input.text, input.command, ...(input.affectedFiles ?? [])].filter(Boolean).join("\n");

  // Alias explicit override
  if (input.alias === "pao-critical") {
    reasons.push("Explicit pao-critical alias requested");
    return {
      level: "R4",
      score: 85,
      reasons,
      detectedPatterns: ["pao-critical"],
      reviewRequirement: getReviewRequirementForRisk("R4"),
    };
  }

  // Check R5 Destructive
  for (const pattern of R5_PATTERNS) {
    if (pattern.test(fullContent)) {
      detectedPatterns.push(pattern.source);
      reasons.push(`Detected potentially destructive or security-critical pattern: ${pattern.source}`);
      return {
        level: "R5",
        score: 100,
        reasons,
        detectedPatterns,
        reviewRequirement: getReviewRequirementForRisk("R5"),
      };
    }
  }

  // Check R4 Privileged
  for (const pattern of R4_PATTERNS) {
    if (pattern.test(fullContent)) {
      detectedPatterns.push(pattern.source);
      reasons.push(`Detected privileged execution pattern: ${pattern.source}`);
      return {
        level: "R4",
        score: 80,
        reasons,
        detectedPatterns,
        reviewRequirement: getReviewRequirementForRisk("R4"),
      };
    }
  }

  // Check affected files count
  const fileCount = input.affectedFiles?.length ?? 0;
  if (fileCount > 5) {
    reasons.push(`Large multi-file change (${fileCount} files)`);
    return {
      level: "R3",
      score: 65,
      reasons,
      detectedPatterns: ["multi_file_large"],
      reviewRequirement: getReviewRequirementForRisk("R3"),
    };
  }

  // Check R3 Dependency / Config / Migration
  for (const pattern of R3_PATTERNS) {
    if (pattern.test(fullContent)) {
      detectedPatterns.push(pattern.source);
      reasons.push(`Detected dependency, config, or database schema pattern: ${pattern.source}`);
      return {
        level: "R3",
        score: 60,
        reasons,
        detectedPatterns,
        reviewRequirement: getReviewRequirementForRisk("R3"),
      };
    }
  }

  // Check R2 Multi-file edit / Feature
  if (fileCount >= 2) {
    reasons.push(`Multi-file edit detected (${fileCount} files)`);
    return {
      level: "R2",
      score: 40,
      reasons,
      detectedPatterns: ["multi_file_edit"],
      reviewRequirement: getReviewRequirementForRisk("R2"),
    };
  }

  for (const pattern of R2_PATTERNS) {
    if (pattern.test(fullContent)) {
      detectedPatterns.push(pattern.source);
      reasons.push(`Detected feature or refactoring pattern: ${pattern.source}`);
      return {
        level: "R2",
        score: 35,
        reasons,
        detectedPatterns,
        reviewRequirement: getReviewRequirementForRisk("R2"),
      };
    }
  }

  // Check R0 Informational
  for (const pattern of R0_PATTERNS) {
    if (pattern.test(fullContent)) {
      return {
        level: "R0",
        score: 5,
        reasons: ["Informational or inquiry task"],
        detectedPatterns: [pattern.source],
        reviewRequirement: getReviewRequirementForRisk("R0"),
      };
    }
  }

  // Default to R1 Reversible edit
  return {
    level: "R1",
    score: 20,
    reasons: ["Standard low-risk single-file or targeted task"],
    detectedPatterns: [],
    reviewRequirement: getReviewRequirementForRisk("R1"),
  };
}
