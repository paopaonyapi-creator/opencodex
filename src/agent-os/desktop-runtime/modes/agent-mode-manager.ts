// Phase 20.9 — Agent Mode Manager
// Enforces tool execution boundaries across 4 operational modes:
// 'off', 'ask', 'safe_auto', 'full_auto'

import type { AgentMode, ToolRisk, ToolDescriptor, PolicyEvaluationResult } from "../types";

export interface ModeEvaluationContext {
  mode: AgentMode;
  tool: ToolDescriptor;
  arguments?: Record<string, unknown>;
  sessionApprovedToolIds?: Set<string>;
}

export class AgentModeManager {
  private currentMode: AgentMode = "ask";
  private sessionApprovals = new Set<string>();

  constructor(initialMode: AgentMode = "ask") {
    this.currentMode = initialMode;
  }

  getMode(): AgentMode {
    return this.currentMode;
  }

  setMode(mode: AgentMode): void {
    this.currentMode = mode;
  }

  grantSessionApproval(toolId: string, risk: ToolRisk): boolean {
    // Invariant: Critical actions can NEVER be approved for the entire session
    if (risk === "critical") {
      return false;
    }
    this.sessionApprovals.add(toolId);
    return true;
  }

  revokeSessionApproval(toolId: string): void {
    this.sessionApprovals.delete(toolId);
  }

  clearSessionApprovals(): void {
    this.sessionApprovals.clear();
  }

  isSessionApproved(toolId: string): boolean {
    return this.sessionApprovals.has(toolId);
  }

  hasSessionApproval(toolId: string): boolean {
    return this.isSessionApproved(toolId);
  }

  evaluatePermission(mode: AgentMode, risk: ToolRisk, toolId?: string): PolicyEvaluationResult {
    if (toolId && this.isSessionApproved(toolId) && risk !== "critical") {
      return { allowed: true, requiresApproval: false, risk };
    }
    if (mode === "off") {
      return {
        allowed: false,
        requiresApproval: false,
        reason: "Agent mode is 'off'; tool execution is completely disabled.",
        risk,
      };
    }
    if (mode === "ask") {
      if (risk === "read_only") return { allowed: true, requiresApproval: false, risk };
      return {
        allowed: false,
        requiresApproval: true,
        reason: `Risk '${risk}' requires user approval in 'ask' mode.`,
        risk,
      };
    }
    if (mode === "safe_auto") {
      if (risk === "read_only" || risk === "low") return { allowed: true, requiresApproval: false, risk };
      return {
        allowed: false,
        requiresApproval: true,
        reason: `Risk '${risk}' requires user approval in 'safe_auto' mode.`,
        risk,
      };
    }
    // full_auto
    if (risk === "critical") {
      return {
        allowed: false,
        requiresApproval: true,
        reason: "Critical risk actions ALWAYS require explicit human approval.",
        risk,
      };
    }
    return { allowed: true, requiresApproval: false, risk };
  }

  /**
   * Evaluates if a proposed tool call can run automatically or requires human approval.
   */
  evaluateToolPermission(
    tool: ToolDescriptor,
    modeOverride?: AgentMode,
    args: Record<string, unknown> = {},
  ): PolicyEvaluationResult {
    const activeMode = modeOverride ?? this.currentMode;
    const risk = tool.risk;

    // Check if tool was approved for this session (and not critical)
    if (this.isSessionApproved(tool.id) && risk !== "critical") {
      return {
        allowed: true,
        requiresApproval: false,
        risk,
      };
    }

    switch (activeMode) {
      case "off":
        return {
          allowed: false,
          requiresApproval: false,
          reason: "Agent is in 'off' mode. Autonomous tool execution is completely disabled.",
          risk,
        };

      case "ask":
        if (risk === "read_only") {
          return {
            allowed: true,
            requiresApproval: false,
            risk,
          };
        }
        return {
          allowed: false,
          requiresApproval: true,
          reason: `Tool '${tool.name}' has '${risk}' risk and requires user approval in 'ask' mode.`,
          risk,
        };

      case "safe_auto":
        if (risk === "read_only" || risk === "low") {
          // Extra safety check: prevent sensitive paths or commands even if classified as low
          if (this.containsSensitiveTargets(args)) {
            return {
              allowed: false,
              requiresApproval: true,
              reason: "Operation targets sensitive files or commands; requires approval in 'safe_auto' mode.",
              risk,
            };
          }
          return {
            allowed: true,
            requiresApproval: false,
            risk,
          };
        }
        // Medium, High, Critical all require approval in safe_auto
        return {
          allowed: false,
          requiresApproval: true,
          reason: `Tool '${tool.name}' has '${risk}' risk and exceeds automatic execution bounds in 'safe_auto' mode.`,
          risk,
        };

      case "full_auto":
        // Invariant: Critical actions ALWAYS require human approval, even in full_auto mode
        if (risk === "critical") {
          return {
            allowed: false,
            requiresApproval: true,
            reason: `CRITICAL ACTION: Tool '${tool.name}' has critical destructive risk and always requires explicit human approval.`,
            risk,
          };
        }
        return {
          allowed: true,
          requiresApproval: false,
          risk,
        };

      default:
        return {
          allowed: false,
          requiresApproval: true,
          reason: "Unknown agent mode; defaulting to mandatory approval.",
          risk,
        };
    }
  }

  private containsSensitiveTargets(args: Record<string, unknown>): boolean {
    const stringified = JSON.stringify(args).toLowerCase();
    return (
      stringified.includes(".env") ||
      stringified.includes("id_rsa") ||
      stringified.includes(".ssh") ||
      stringified.includes("credentials") ||
      stringified.includes("secret") ||
      stringified.includes("token")
    );
  }
}

let defaultModeManager: AgentModeManager | null = null;
export function getAgentModeManager(): AgentModeManager {
  if (!defaultModeManager) {
    defaultModeManager = new AgentModeManager("ask");
  }
  return defaultModeManager;
}
