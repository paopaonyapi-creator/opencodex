// Phase 20.22 — Pao-hubPro x LangChain Agent Orchestration & MCP Runtime Layer
// Tool Policy Engine & Risk Classification

import { resolve, normalize, isAbsolute } from "node:path";
import type { ToolRiskLevel, PolicyDecision, ToolPolicyResult } from "./types";

export interface ToolInvocationContext {
  toolName: string;
  serverName: string;
  args: Record<string, unknown>;
  workspaceDir?: string;
  operatorApproved?: boolean;
}

const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\s+-[rf]{1,2}\s+[\/\\]/i,
  /\bmkfs\b/i,
  /\bformat\s+[a-z]:/i,
  /\bdd\s+if=/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/, // fork bomb
  />\s*\/dev\/sd[a-z]/i,
];

const SENSITIVE_PATH_PATTERNS = [
  /(^|[\\\/])\.ssh([\\\/]|$)/i,
  /(^|[\\\/])\.aws([\\\/]|$)/i,
  /(^|[\\\/])\.env(\.[a-z0-9_-]+)?$/i,
  /(^|[\\\/])id_rsa/i,
  /(^|[\\\/])etc[\\\/]shadow/i,
  /(^|[\\\/])Windows[\\\/]System32/i,
];

export class ToolPolicyEngine {
  private defaultWorkspace: string;

  constructor(workspaceDir = process.cwd()) {
    this.defaultWorkspace = resolve(workspaceDir);
  }

  classifyTool(toolName: string, args: Record<string, unknown>): ToolRiskLevel {
    const name = toolName.toLowerCase();

    // R4: Privileged / destructive
    if (
      name.includes("kill") ||
      name.includes("sudo") ||
      name.includes("credential") ||
      name.includes("admin") ||
      name.includes("drop_database")
    ) {
      return "R4";
    }

    // R3: Shell / execution
    if (
      name.includes("shell") ||
      name.includes("exec") ||
      name.includes("command") ||
      name.includes("terminal") ||
      name.includes("deploy")
    ) {
      return "R3";
    }

    // R2: Write / state modification
    if (
      name.includes("write") ||
      name.includes("edit") ||
      name.includes("delete") ||
      name.includes("modify") ||
      name.includes("create") ||
      name.includes("update")
    ) {
      return "R2";
    }

    // R1: Query / network
    if (
      name.includes("fetch") ||
      name.includes("search") ||
      name.includes("query") ||
      name.includes("http") ||
      name.includes("api")
    ) {
      return "R1";
    }

    // R0: Harmless read
    return "R0";
  }

  evaluateTool(ctx: ToolInvocationContext): ToolPolicyResult {
    const riskLevel = this.classifyTool(ctx.toolName, ctx.args);
    const workspace = resolve(ctx.workspaceDir || this.defaultWorkspace);

    // 1. Path checking
    const pathArg = (ctx.args.path as string) || (ctx.args.targetPath as string) || (ctx.args.file as string);
    if (pathArg) {
      const containment = this.verifyWorkspaceContainment(pathArg, workspace);
      if (!containment.allowed) {
        return {
          decision: "DENY",
          riskLevel: "R4",
          reason: containment.reason,
        };
      }
    }

    // 2. Command checking
    const commandArg = (ctx.args.command as string) || (ctx.args.cmd as string);
    if (commandArg) {
      for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
        if (pattern.test(commandArg)) {
          return {
            decision: "DENY",
            riskLevel: "R4",
            reason: `Command matches dangerous pattern: ${pattern.source}`,
          };
        }
      }
    }

    // 3. Operator pre-approval check
    if (ctx.operatorApproved) {
      return {
        decision: "ALLOW",
        riskLevel,
        reason: "Explicitly approved by operator",
      };
    }

    // 4. Risk-based gating
    if (riskLevel === "R4") {
      return {
        decision: "APPROVAL_REQUIRED",
        riskLevel: "R4",
        reason: "Privileged action requires explicit Reviewer Council or Operator approval",
        requiresReviewerCouncil: true,
      };
    }

    if (riskLevel === "R3") {
      return {
        decision: "APPROVAL_REQUIRED",
        riskLevel: "R3",
        reason: "Execution action requires operator approval",
      };
    }

    if (riskLevel === "R2") {
      // Allow workspace-contained writes automatically in normal workflow, or require approval if dangerous
      return {
        decision: "ALLOW",
        riskLevel: "R2",
        reason: "Workspace modification allowed by policy",
      };
    }

    // R0 and R1: Harmless
    return {
      decision: "ALLOW",
      riskLevel,
      reason: "Safe read/query action allowed",
    };
  }

  verifyWorkspaceContainment(targetPath: string, workspaceDir: string): { allowed: boolean; reason: string } {
    // Check sensitive paths
    for (const pattern of SENSITIVE_PATH_PATTERNS) {
      if (pattern.test(targetPath)) {
        return {
          allowed: false,
          reason: `Target path touches protected system pattern: ${pattern.source}`,
        };
      }
    }

    const normalizedTarget = normalize(targetPath);
    const resolvedTarget = isAbsolute(normalizedTarget)
      ? resolve(normalizedTarget)
      : resolve(workspaceDir, normalizedTarget);

    const normalizedWorkspace = normalize(workspaceDir);

    // Case-insensitive containment check for Windows, standard for Unix
    const normTargetLower = resolvedTarget.toLowerCase();
    const normWorkspaceLower = normalizedWorkspace.toLowerCase();

    if (!normTargetLower.startsWith(normWorkspaceLower)) {
      return {
        allowed: false,
        reason: `Access denied: target path '${resolvedTarget}' escapes workspace root '${workspaceDir}'`,
      };
    }

    return { allowed: true, reason: "Inside workspace containment" };
  }

  redactSecrets(input: string): string {
    if (!input || typeof input !== "string") return input;

    let result = input;
    // OpenAI API keys
    result = result.replace(/sk-[a-zA-Z0-9]{20,}/g, "sk-[REDACTED_API_KEY]");
    // GitHub tokens
    result = result.replace(/ghp_[a-zA-Z0-9]{20,}/g, "ghp_[REDACTED_GH_TOKEN]");
    result = result.replace(/github_pat_[a-zA-Z0-9_]{30,}/g, "github_pat_[REDACTED]");
    // AWS keys
    result = result.replace(/AKIA[0-9A-Z]{16}/g, "AKIA[REDACTED_AWS_KEY]");
    // Database connection strings
    result = result.replace(/postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@[^\s/]+/g, "postgresql://[REDACTED_DB_CREDENTIALS]@host");
    result = result.replace(/mongodb(?:\+srv)?:\/\/[^:\s]+:[^@\s]+@[^\s/]+/g, "mongodb://[REDACTED_DB_CREDENTIALS]@host");

    return result;
  }
}
