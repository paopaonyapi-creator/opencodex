/**
 * Phase 20.100 — Pao-hubPro × ZCode Permission Bridge
 * Enforces 10-stage permission evaluation, side-effect scoping, runtime mode constraints, and approval queue.
 */

import { getDecisionEngine } from "../decision/engine";
import type {
  PermissionDecision,
  ZCodeRiskLevel,
  ZCodeRuntimeMode,
  ZCodeSideEffectScope,
} from "./types";

export interface ToolEvaluationRequest {
  sessionId: string;
  toolName: string;
  args: Record<string, unknown>;
  runtimeMode: ZCodeRuntimeMode;
  workspacePath: string;
  sideEffectScope: ZCodeSideEffectScope;
}

export interface PendingApprovalItem {
  approvalId: string;
  sessionId: string;
  toolName: string;
  args: Record<string, unknown>;
  riskLevel: ZCodeRiskLevel;
  scope: ZCodeSideEffectScope;
  reason: string;
  status: "pending" | "allowed" | "denied";
  createdAt: string;
  resolvedAt?: string;
}

export class ZCodePermissionBridge {
  private sessionGrants = new Map<string, Set<string>>(); // sessionId -> Set of allowed toolName
  private approvalQueue = new Map<string, PendingApprovalItem>();
  private decisionEngine = getDecisionEngine();

  /**
   * Evaluates a requested tool execution against Pao-hubPro 10-stage security precedence.
   */
  public async evaluateTool(req: ToolEvaluationRequest): Promise<PermissionDecision> {
    const { sessionId, toolName, args, runtimeMode, sideEffectScope } = req;

    // 1. Hard Deny Policy: Global forbidden tools/commands
    const rawArgs = JSON.stringify(args);
    if (
      toolName === "shell" &&
      (rawArgs.includes("rm -rf /") || rawArgs.includes(":(){ :|:& };:") || rawArgs.includes("mkfs"))
    ) {
      return {
        decision: "deny",
        riskLevel: "critical",
        sideEffectScope,
        reason: "Hard policy denied: destructive shell command signature detected.",
      };
    }

    // 2. Security Boundary Validation: Path traversal check
    if (rawArgs.includes("..\\..\\") || rawArgs.includes("../../etc/passwd") || rawArgs.includes("../../Windows/System32")) {
      return {
        decision: "deny",
        riskLevel: "critical",
        sideEffectScope,
        reason: "Security boundary violation: path traversal detected.",
      };
    }

    // 3. Credential Scope Validation
    if (
      rawArgs.includes("id_rsa") ||
      rawArgs.includes(".aws/credentials") ||
      rawArgs.includes("admin-api-token")
    ) {
      return {
        decision: "deny",
        riskLevel: "critical",
        sideEffectScope,
        reason: "Credential isolation policy: raw private key or admin credential access is denied.",
      };
    }

    // 4. Runtime Mode Policy Check (§17)
    if (runtimeMode === "SAFE") {
      // SAFE mode: strictly read-only
      if (
        sideEffectScope.startsWith("write.") ||
        sideEffectScope.startsWith("delete.") ||
        sideEffectScope.startsWith("shell.") ||
        sideEffectScope.startsWith("git.write") ||
        sideEffectScope.startsWith("git.push")
      ) {
        return {
          decision: "deny",
          riskLevel: "high",
          sideEffectScope,
          reason: `SAFE mode strictly denies side-effect scope '${sideEffectScope}'.`,
        };
      }
    }

    if (runtimeMode === "REVIEW") {
      // REVIEW mode: diff and test inspection only; no workspace mutation unless approved
      if (sideEffectScope === "write.files" || sideEffectScope === "delete.files" || sideEffectScope === "git.push") {
        return {
          decision: "ask",
          riskLevel: "medium",
          sideEffectScope,
          reason: `REVIEW mode requires explicit authorization for '${sideEffectScope}'.`,
        };
      }
    }

    // 5. Session Rule: Already approved for this session?
    const grants = this.sessionGrants.get(sessionId);
    if (grants && grants.has(toolName)) {
      return {
        decision: "allow",
        riskLevel: "low",
        sideEffectScope,
        reason: "Authorized by active session-scoped grant.",
      };
    }

    // 6. Probabilistic & Decision Intelligence Evaluation (Phase 20.84 integration)
    let contractId = "mcp.tool.risk";
    if (toolName === "shell" || toolName === "bash" || toolName === "exec") {
      contractId = "shell.command.risk";
    }

    try {
      const decisionResult = await this.decisionEngine.evaluate({
        requestId: `perm_${Date.now()}`,
        contractId,
        state: { toolName, args, sideEffectScope, runtimeMode },
      });

      if (decisionResult.disposition === "deny") {
        return {
          decision: "deny",
          riskLevel: "critical",
          sideEffectScope,
          reason: `Decision contract '${contractId}' denied execution.`,
        };
      }

      if (decisionResult.disposition === "review" || sideEffectScope === "git.push" || sideEffectScope === "delete.files") {
        // Enqueue into Approval Queue
        const approvalId = `appr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        this.approvalQueue.set(approvalId, {
          approvalId,
          sessionId,
          toolName,
          args,
          riskLevel: "high",
          scope: sideEffectScope,
          reason: `Action requires human confirmation (${sideEffectScope}).`,
          status: "pending",
          createdAt: new Date().toISOString(),
        });

        return {
          decision: "ask",
          riskLevel: "high",
          sideEffectScope,
          ruleId: approvalId,
          reason: `Operation classified as high impact (${sideEffectScope}); routed to human approval queue.`,
        };
      }
    } catch {
      // Fail closed on evaluation failure
      return {
        decision: "ask",
        riskLevel: "high",
        sideEffectScope,
        reason: "Decision engine unavailable; failing closed to human review.",
      };
    }

    // Default Allow for verified bounded operations
    return {
      decision: "allow",
      riskLevel: "low",
      sideEffectScope,
      reason: "Action passed all policy stages and scope constraints.",
    };
  }

  public grantSessionPermission(sessionId: string, toolName: string): void {
    if (!this.sessionGrants.has(sessionId)) {
      this.sessionGrants.set(sessionId, new Set());
    }
    this.sessionGrants.get(sessionId)!.add(toolName);
  }

  public resolveApproval(approvalId: string, allowed: boolean): boolean {
    const item = this.approvalQueue.get(approvalId);
    if (!item || item.status !== "pending") return false;

    item.status = allowed ? "allowed" : "denied";
    item.resolvedAt = new Date().toISOString();

    if (allowed) {
      this.grantSessionPermission(item.sessionId, item.toolName);
    }
    return true;
  }

  public getPendingApprovals(): PendingApprovalItem[] {
    return Array.from(this.approvalQueue.values()).filter((a) => a.status === "pending");
  }
}
