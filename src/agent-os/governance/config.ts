// Phase 20.9 — Pao-hubPro × Ponytail Minimal-Code Governance Layer
// Governance Configuration & Environment Variable Resolvers

import type { GovernanceConfig, GovernanceMode } from "./types";

function parseBoolean(val: string | undefined, fallback: boolean): boolean {
  if (val === undefined || val === "") return fallback;
  return val.toLowerCase() === "true" || val === "1";
}

function parseMode(val: string | undefined, fallback: GovernanceMode): GovernanceMode {
  if (!val) return fallback;
  const lower = val.toLowerCase().trim();
  if (lower === "off" || lower === "lite" || lower === "full" || lower === "ultra") {
    return lower;
  }
  return fallback;
}

let runtimeOverrides: Partial<GovernanceConfig> = {};

export function getGovernanceConfig(): GovernanceConfig {
  const env = process.env;

  const resolved: GovernanceConfig = {
    enabled: parseBoolean(env.PAO_GOVERNANCE_ENABLED, true),
    mode: parseMode(env.PAO_GOVERNANCE_MODE || env.PONYTAIL_DEFAULT_MODE, "full"),
    diffGuard: parseBoolean(env.PAO_GOVERNANCE_DIFF_GUARD, true),
    dependencyGuard: parseBoolean(env.PAO_GOVERNANCE_DEPENDENCY_GUARD, true),
    reuseScan: parseBoolean(env.PAO_GOVERNANCE_REUSE_SCAN, true),
    reviewerCouncil: parseBoolean(env.PAO_GOVERNANCE_REVIEWER_COUNCIL, true),
    logDecisions: parseBoolean(env.PAO_GOVERNANCE_LOG_DECISIONS, true),
    subagentMatcher: env.PONYTAIL_SUBAGENT_MATCHER || "coding|bugfix|refactor|mcp|builder|engineer|general",
  };

  return {
    ...resolved,
    ...runtimeOverrides,
  };
}

export function updateGovernanceConfig(overrides: Partial<GovernanceConfig>): GovernanceConfig {
  runtimeOverrides = { ...runtimeOverrides, ...overrides };
  return getGovernanceConfig();
}

export function resetGovernanceConfigForTests(): void {
  runtimeOverrides = {};
}
