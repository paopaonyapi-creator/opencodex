// Phase 20.9 — Pao-hubPro × Ponytail Minimal-Code Governance Layer
// Governance Mode Router: Agent Scoping & Task Mode Routing

import type { GovernanceMode, TaskType } from "./types";
import { getGovernanceConfig } from "./config";

export class ModeRouter {
  /**
   * Determine whether a subagent type should receive Ponytail minimal-code instructions.
   * Reviewer and research agents are strictly excluded to preserve independent judgment.
   */
  shouldApplyGovernance(agentType?: string): boolean {
    const config = getGovernanceConfig();
    if (!config.enabled) return false;
    if (!agentType) return true; // Default to applying if unspecified

    const normalized = agentType.toLowerCase().trim();

    // Strict exclusion list for reviewers and research-only agents
    if (
      normalized.includes("reviewer") ||
      normalized.includes("council") ||
      normalized.includes("research") ||
      normalized.includes("search") ||
      normalized.includes("explorer") ||
      normalized.includes("audit_inspector")
    ) {
      return false;
    }

    // Match against configured matcher regex
    try {
      const regex = new RegExp(config.subagentMatcher, "i");
      return regex.test(normalized);
    } catch {
      return true;
    }
  }

  /**
   * Resolve effective governance mode based on agent role, task type, and explicit override.
   */
  resolveMode(params: {
    explicitMode?: GovernanceMode;
    agentType?: string;
    taskType?: TaskType;
  }): GovernanceMode {
    const config = getGovernanceConfig();
    if (!config.enabled) return "off";

    // Explicit valid override takes precedence
    if (params.explicitMode) {
      if (["off", "lite", "full", "ultra"].includes(params.explicitMode)) {
        return params.explicitMode;
      }
    }

    // Check agent applicability
    if (params.agentType && !this.shouldApplyGovernance(params.agentType)) {
      return "off";
    }

    // Task-specific automatic routing
    if (params.taskType) {
      switch (params.taskType) {
        case "research":
        case "documentation":
          return "off";
        case "planning":
          return "lite";
        case "refactor":
          return "ultra";
        case "bugfix":
        case "feature":
        case "migration":
        case "security":
        case "infrastructure":
        case "mcp-tool":
        case "agent-definition":
        case "test-only":
          return config.mode; // default: "full"
      }
    }

    return config.mode;
  }
}

let defaultModeRouter: ModeRouter | null = null;
export function getModeRouter(): ModeRouter {
  if (!defaultModeRouter) {
    defaultModeRouter = new ModeRouter();
  }
  return defaultModeRouter;
}
