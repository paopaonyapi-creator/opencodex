// Phase 20.9 — Approval Gateway
// Human-in-the-Loop authorization gate for sensitive and high-risk tool execution.
// Invariant: Critical actions (destructive commands, force push) cannot be approved for entire sessions.

import type {
  ApprovalCard,
  ApprovalDecision,
  ApprovalResult,
  ToolExecutionRequest,
  ToolRisk,
} from "../types";
import { openAgentOsDb } from "../../db";
import { getAgentModeManager } from "../modes/agent-mode-manager";

export class ApprovalGateway {
  private pendingApprovals = new Map<string, ApprovalCard>();

  private get db() {
    return openAgentOsDb();
  }

  /**
   * Creates and registers a pending approval card for an operation.
   */
  requestApproval(params: {
    runId: string;
    toolCall: ToolExecutionRequest;
    model: string;
    agentName?: string;
    serverName?: string;
    command?: string;
    affectedFiles?: string[];
    reason?: string;
    estimatedSideEffects?: string[];
  }): ApprovalCard {
    const id = `appr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const card: ApprovalCard = {
      id,
      runId: params.runId,
      toolCallId: params.toolCall.id,
      agent: params.agentName ?? "Pao Desktop Agent",
      model: params.model,
      tool: `${params.toolCall.namespace}__${params.toolCall.name}`,
      server: params.serverName,
      risk: params.toolCall.risk,
      arguments: params.toolCall.arguments,
      affectedFiles: params.affectedFiles ?? [],
      command: params.command,
      workingDirectory: process.cwd(),
      reason: params.reason ?? `Action classified as '${params.toolCall.risk}' requires human approval`,
      estimatedSideEffects: params.estimatedSideEffects ?? this.estimateSideEffects(params.toolCall.risk, params.toolCall.name),
      requestedAt: new Date().toISOString(),
    };

    this.pendingApprovals.set(id, card);

    // Persist in SQLite
    try {
      this.db.query(`
        INSERT INTO desktop_agent_approvals (
          id, run_id, tool_call_id, tool_name, risk, decision, requested_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?)
      `).run(
        card.id,
        card.runId,
        card.toolCallId,
        card.tool,
        card.risk,
        card.requestedAt,
      );
    } catch {
      // Best-effort
    }

    return card;
  }

  private waiters = new Map<string, (result: ApprovalResult) => void>();

  getPendingApproval(id: string): ApprovalCard | null {
    return this.pendingApprovals.get(id) ?? null;
  }

  listPendingApprovals(): ApprovalCard[] {
    return Array.from(this.pendingApprovals.values());
  }

  /**
   * Asynchronously wait for a human operator decision (e.g. from Web Dashboard).
   */
  async waitForDecision(id: string, timeoutMs = 60000): Promise<ApprovalResult> {
    const card = this.pendingApprovals.get(id);
    if (!card) {
      return { id, decision: "reject", decidedBy: "system", decidedAt: new Date().toISOString() };
    }

    return new Promise<ApprovalResult>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        resolve({
          id,
          decision: "reject",
          decidedBy: "system-timeout",
          decidedAt: new Date().toISOString(),
          reason: `Approval timed out after ${timeoutMs}ms`,
        });
      }, timeoutMs);

      this.waiters.set(id, (res) => {
        clearTimeout(timer);
        this.waiters.delete(id);
        resolve(res);
      });
    });
  }

  /**
   * Records a user decision on an approval card.
   */
  decide(id: string, decision: ApprovalDecision, operator = "human-operator", reason?: string): ApprovalResult {
    const card = this.pendingApprovals.get(id);
    if (!card) {
      throw new Error(`Approval request '${id}' not found or already decided`);
    }

    // Invariant check: Critical actions cannot be session-approved
    if (decision === "approve_session" && card.risk === "critical") {
      throw new Error("Security Violation: Critical risk actions cannot be approved for entire session");
    }

    const now = new Date().toISOString();
    const result: ApprovalResult = {
      id,
      decision,
      decidedBy: operator,
      decidedAt: now,
      reason,
    };

    // If session approval granted, register in ModeManager
    if (decision === "approve_session") {
      const modeManager = getAgentModeManager();
      modeManager.grantSessionApproval(card.tool, card.risk);
    }

    this.pendingApprovals.delete(id);

    // Resolve any awaiting asynchronous promises (e.g. AgentRuntime)
    const waiter = this.waiters.get(id);
    if (waiter) {
      waiter(result);
    }

    try {
      this.db.query(`
        UPDATE desktop_agent_approvals
        SET decision = ?, decided_by = ?, decided_at = ?, reason = ?
        WHERE id = ?
      `).run(decision, operator, now, reason ?? null, id);
    } catch {
      // Best-effort
    }

    return result;
  }

  private estimateSideEffects(risk: ToolRisk, toolName: string): string[] {
    const effects: string[] = [];
    if (risk === "critical") {
      effects.push("Irreversible data deletion or system modification");
      effects.push("Potential remote repository or database corruption");
    } else if (risk === "high") {
      effects.push("File modification or network write");
      effects.push("External service state change");
    } else if (risk === "medium") {
      effects.push("Local workspace file write");
    } else {
      effects.push("No permanent system side-effects");
    }
    return effects;
  }
}

let defaultApprovalGateway: ApprovalGateway | null = null;
export function getApprovalGateway(): ApprovalGateway {
  if (!defaultApprovalGateway) {
    defaultApprovalGateway = new ApprovalGateway();
  }
  return defaultApprovalGateway;
}
