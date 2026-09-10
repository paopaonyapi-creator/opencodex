// Phase 20.9 — Policy Engine
// Central governance over filesystem access, shell execution, and Git operations.

import type { WorkspacePolicy, PolicyEvaluationResult, ToolRisk } from "../types";
import { normalize, resolve, relative, isAbsolute } from "node:path";
import { CODE_EXECUTION_PROGRAMS, commandProgram, parseShellCommand } from "../security/shell-tokenizer";

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
   * Evaluates shell command execution against the allowlist.
   *
   * The allowlist is matched per SIMPLE COMMAND, never against the raw line.
   * Matching the raw line with startsWith is what let "git status; cat ~/.ssh/id_rsa"
   * through: it begins with an allowlisted prefix and the shell then ran the rest.
   * Every segment must pass on its own, so a chained, piped, or redirected command
   * has to justify each of its parts.
   */
  evaluateShellCommand(commandLine: string): PolicyEvaluationResult {
    const clean = commandLine.trim();
    if (clean === "") {
      return { allowed: false, requiresApproval: true, reason: "Empty command.", risk: "low" };
    }

    const parsed = parseShellCommand(clean);

    // 0. Constructs the scanner could not read confidently are never auto-approved.
    if (parsed.opaqueConstructs.length > 0) {
      return {
        allowed: false,
        requiresApproval: true,
        reason: `Command contains constructs that cannot be verified statically (${parsed.opaqueConstructs.join(", ")}); requires explicit approval.`,
        risk: "high",
      };
    }

    // 1. Invariant: destructive or elevated patterns are hard-denied, evaluated over
    // the whole line. The previous form used an unparenthesised boolean expression,
    // so `clean.includes("curl") && clean.includes("|")` bound more loosely than the
    // surrounding || chain and the destructive branch never saw a chained payload in
    // isolation.
    const destructive = /(?:^|[\s;&|])(rm\s+-rf\s+[\/\\]|del\s+\/[sfa-z]*\s+[a-z]:|format\s+[a-z]:|mkfs|shutdown|reboot)/i;
    const remoteExec = /\b(?:curl|wget|irm|iwr|invoke-webrequest)\b[^|;&]*\|\s*(?:sh|bash|zsh|powershell|pwsh|cmd|iex|invoke-expression)\b/i;
    const encodedShell = /\b(?:powershell|pwsh|cmd)\b[^|;&]*\s-(?:e|enc|encodedcommand)\b/i;
    if (destructive.test(clean) || remoteExec.test(clean) || encodedShell.test(clean)) {
      return {
        allowed: false,
        requiresApproval: true,
        reason: `Command '${commandLine}' matches the hard security denylist`,
        risk: "critical",
      };
    }

    // 2. Force push is never silently allowed.
    if (/\bgit\s+push\b[^|;&]*(?:--force\b|-f\b|--force-with-lease)/i.test(clean)) {
      return {
        allowed: false,
        requiresApproval: true,
        reason: "git push --force is denied by default policy and requires explicit approval",
        risk: "critical",
      };
    }

    // 3. Every simple command must be covered by the allowlist on its own.
    const uncovered: string[] = [];
    for (const segment of parsed.segments) {
      const program = commandProgram(segment.text);
      if (CODE_EXECUTION_PROGRAMS.has(program)) {
        return {
          allowed: false,
          requiresApproval: true,
          reason: `Command '${segment.text}' invokes '${program}', which executes arbitrary code; a shell or interpreter can never be auto-approved.`,
          risk: "high",
        };
      }
      const covered = this.policy.shellAllowlist.some((allowed) => {
        const normalizedAllowed = allowed.trim().toLowerCase();
        const normalizedSegment = segment.text.toLowerCase();
        return (
          normalizedSegment === normalizedAllowed ||
          normalizedSegment.startsWith(`${normalizedAllowed} `)
        );
      });
      if (!covered) uncovered.push(segment.text);
    }

    if (uncovered.length === 0) {
      // A single allowlisted command needs no approval. Anything carrying an operator
      // was inspected in full and is still surfaced to a human, because chaining is
      // itself an escalation even when every part is familiar.
      if (parsed.isSingleSimpleCommand) {
        return { allowed: true, requiresApproval: false, risk: "low" };
      }
      const uniqueOperators = Array.from(new Set(parsed.operators));
      return {
        allowed: false,
        requiresApproval: true,
        reason: `Command chains ${parsed.operators.length} operator(s) (${uniqueOperators.join(", ")}); each part is allowlisted but the compound command requires approval.`,
        risk: "medium",
      };
    }

    return {
      allowed: false,
      requiresApproval: true,
      reason: `Command component(s) not in the shell allowlist: ${uncovered.join(" | ")}; requires user approval`,
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
