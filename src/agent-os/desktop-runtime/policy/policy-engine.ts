// Phase 20.9 — Policy Engine
// Central governance over filesystem access, shell execution, and Git operations.

import type { WorkspacePolicy, PolicyEvaluationResult, ToolRisk } from "../types";
import { normalize, resolve, relative, isAbsolute } from "node:path";

export const DEFAULT_WORKSPACE_POLICY: WorkspacePolicy = {
  defaultMode: "ask",
  allowedRoots: [process.cwd()],
  deniedPaths: [
    ".env",
    ".env.local",
    "id_rsa",
    "id_ed25519",
    ".ssh",
    "credentials",
    "secrets",
  ],
  shellAllowlist: [
    "npm test",
    "npm run lint",
    "npm run typecheck",
    "bun test",
    "bun run lint:gui",
    "bun run typecheck",
    "bun run build:gui",
    "git status",
    "git diff",
    "git log",
  ],
  gitPolicy: {
    allowStatus: true,
    allowDiff: true,
    allowCommit: "ask",
    allowPush: "ask",
    allowForcePush: false,
  },
};

export class PolicyEngine {
  private policy: WorkspacePolicy;

  constructor(customPolicy: Partial<WorkspacePolicy> = {}) {
    this.policy = {
      ...DEFAULT_WORKSPACE_POLICY,
      ...customPolicy,
      gitPolicy: {
        ...DEFAULT_WORKSPACE_POLICY.gitPolicy,
        ...(customPolicy.gitPolicy || {}),
      },
    };
  }

  getPolicy(): WorkspacePolicy {
    return { ...this.policy };
  }

  setPolicy(policy: WorkspacePolicy): void {
    this.policy = policy;
  }

  updatePolicy(partial: Partial<WorkspacePolicy>): void {
    this.policy = {
      ...this.policy,
      ...partial,
      gitPolicy: {
        ...this.policy.gitPolicy,
        ...(partial.gitPolicy || {}),
      },
    };
  }

  evaluateAction(params: {
    actionType: string;
    targetPath?: string;
    command?: string;
    gitOperation?: "status" | "diff" | "commit" | "push" | "force_push";
  }): PolicyEvaluationResult {
    if (params.command) {
      return this.evaluateShellCommand(params.command);
    }
    if (params.targetPath) {
      const mode = params.actionType.includes("write") ? "write" : "read";
      return this.evaluatePathAccess(params.targetPath, mode);
    }
    if (params.gitOperation) {
      return this.evaluateGitOperation(params.gitOperation);
    }
    return {
      allowed: true,
      requiresApproval: false,
      risk: "low",
    };
  }

  /**
   * Evaluates if a target path is permitted under filesystem policies.
   */
  evaluatePathAccess(targetPath: string, mode: "read" | "write"): PolicyEvaluationResult {
    const normalized = normalize(resolve(targetPath));

    // 1. Check denied path tokens
    const lower = normalized.toLowerCase();
    for (const denied of this.policy.deniedPaths) {
      if (lower.includes(denied.toLowerCase())) {
        return {
          allowed: false,
          requiresApproval: true,
          reason: `Access to '${targetPath}' is blocked by policy: denied pattern '${denied}'`,
          risk: "high",
        };
      }
    }

    // 2. Check containment within allowed roots
    const isContained = this.policy.allowedRoots.some((root) => {
      const rel = relative(normalize(resolve(root)), normalized);
      return !rel.startsWith("..") && !isAbsolute(rel);
    });

    if (!isContained) {
      return {
        allowed: false,
        requiresApproval: true,
        reason: `Path '${targetPath}' escapes allowed workspace roots`,
        risk: "high",
      };
    }

    return {
      allowed: true,
      requiresApproval: mode === "write",
      risk: mode === "write" ? "medium" : "read_only",
    };
  }

  /**
   * Evaluates shell command execution against allowlist.
   */
  evaluateShellCommand(commandLine: string): PolicyEvaluationResult {
    const clean = commandLine.trim();

    // 1. Invariant: Block destructive or elevated patterns immediately
    if (
      clean.includes("rm -rf /") ||
      clean.includes("del /s c:") ||
      clean.includes("format c:") ||
      clean.includes("shutdown") ||
      clean.includes("powershell -e") ||
      clean.includes("curl") && clean.includes("|")
    ) {
      return {
        allowed: false,
        requiresApproval: true,
        reason: `Command '${commandLine}' matches hard security denylist`,
        risk: "critical",
      };
    }

    // 2. Check if in allowlist
    const inAllowlist = this.policy.shellAllowlist.some((allowed) =>
      clean.toLowerCase().startsWith(allowed.toLowerCase())
    );

    if (inAllowlist) {
      return {
        allowed: true,
        requiresApproval: false,
        risk: "low",
      };
    }

    return {
      allowed: false,
      requiresApproval: true,
      reason: `Command '${commandLine}' is not in the shell allowlist; requires user approval`,
      risk: "high",
    };
  }

  /**
   * Evaluates Git operations.
   */
  evaluateGitOperation(action: "status" | "diff" | "commit" | "push" | "force_push"): PolicyEvaluationResult {
    if (action === "force_push") {
      // Invariant: Force push is NEVER allowed silently
      if (!this.policy.gitPolicy.allowForcePush) {
        return {
          allowed: false,
          requiresApproval: true,
          reason: "Git force push is denied by default policy and requires explicit approval",
          risk: "critical",
        };
      }
    }

    if (action === "status" && this.policy.gitPolicy.allowStatus) {
      return { allowed: true, requiresApproval: false, risk: "read_only" };
    }

    if (action === "diff" && this.policy.gitPolicy.allowDiff) {
      return { allowed: true, requiresApproval: false, risk: "read_only" };
    }

    if (action === "commit") {
      const rule = this.policy.gitPolicy.allowCommit;
      return {
        allowed: rule !== "deny",
        requiresApproval: rule === "ask",
        risk: "medium",
      };
    }

    if (action === "push") {
      const rule = this.policy.gitPolicy.allowPush;
      return {
        allowed: rule !== "deny",
        requiresApproval: rule === "ask",
        risk: "high",
      };
    }

    return { allowed: false, requiresApproval: true, risk: "medium" };
  }
}

let defaultPolicyEngine: PolicyEngine | null = null;
export function getPolicyEngine(): PolicyEngine {
  if (!defaultPolicyEngine) {
    defaultPolicyEngine = new PolicyEngine();
  }
  return defaultPolicyEngine;
}
