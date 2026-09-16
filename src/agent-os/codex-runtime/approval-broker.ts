// Phase 20.21 — Pao-hubPro x OpenAI Codex Native Runtime Integration
// Approval Broker: Bounded Timeouts, Headless MCP Safety & Operator Decision Gateway.

import { CodexRuntimeStore } from "./store";
import { CodexAuditService } from "./audit";
import type {
  ApprovalRequest,
  ApprovalStatus,
  RiskClassification,
} from "./types";

export interface CreateApprovalParams {
  sessionId: string;
  turnId?: string | null;
  nodeId: string;
  toolName: string;
  command?: string;
  path?: string;
  networkIntent?: string;
  riskLevel: RiskClassification;
  timeoutSeconds?: number;
}

export interface ApprovalResolution {
  decision: "allow" | "deny" | "cancel";
  status: ApprovalStatus;
  decidedBy: string;
  reason?: string;
}

type ResolverFunction = (res: ApprovalResolution) => void;

export class ApprovalBroker {
  private activeTimeouts = new Map<string, Timer>();
  private activeResolvers = new Map<string, ResolverFunction>();

  constructor(
    private store = new CodexRuntimeStore(),
    private audit = new CodexAuditService(),
    private defaultTimeoutSeconds = 120,
  ) {
    const envTimeout = process.env.PAO_CODEX_APPROVAL_TIMEOUT_SECONDS;
    if (envTimeout && !isNaN(Number(envTimeout))) {
      this.defaultTimeoutSeconds = Math.max(5, Number(envTimeout));
    }
  }

  async requestApproval(params: CreateApprovalParams): Promise<ApprovalResolution> {
    const id = `appr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date();
    const timeoutSec = params.timeoutSeconds || this.defaultTimeoutSeconds;
    const expiresAt = new Date(now.getTime() + timeoutSec * 1000).toISOString();

    const request: ApprovalRequest = {
      id,
      sessionId: params.sessionId,
      turnId: params.turnId ?? null,
      nodeId: params.nodeId,
      toolName: params.toolName,
      command: params.command,
      path: params.path,
      networkIntent: params.networkIntent,
      riskLevel: params.riskLevel,
      status: "pending",
      requestedAt: now.toISOString(),
      expiresAt,
    };

    this.store.createApproval(request);
    this.audit.log({
      sessionId: params.sessionId,
      turnId: params.turnId,
      nodeId: params.nodeId,
      action: "approval.request",
      risk: params.riskLevel,
      result: "ok",
      metadata: {
        approvalId: id,
        toolName: params.toolName,
        command: params.command,
        expiresAt,
        timeoutSeconds: timeoutSec,
      },
    });

    // Return promise awaiting resolution or timeout
    return new Promise<ApprovalResolution>((resolve) => {
      this.activeResolvers.set(id, resolve);

      // Set bounded timeout to prevent hanging forever
      const timer = setTimeout(() => {
        this.handleTimeout(id);
      }, timeoutSec * 1000);

      this.activeTimeouts.set(id, timer);
    });
  }

  resolve(
    id: string,
    decision: "allow" | "deny" | "cancel",
    operatorName = "operator",
    reason?: string,
  ): boolean {
    const resolver = this.activeResolvers.get(id);
    const timer = this.activeTimeouts.get(id);

    if (timer) {
      clearTimeout(timer);
      this.activeTimeouts.delete(id);
    }

    const status: ApprovalStatus =
      decision === "allow" ? "approved_once" : decision === "cancel" ? "cancelled" : "denied";

    this.store.resolveApproval(id, status, decision, operatorName);

    const approval = this.store.getApproval(id);
    if (approval) {
      this.audit.log({
        sessionId: approval.sessionId,
        turnId: approval.turnId,
        nodeId: approval.nodeId,
        action: `approval.${decision}`,
        risk: approval.riskLevel,
        result: decision === "allow" ? "ok" : "denied",
        metadata: {
          approvalId: id,
          decidedBy: operatorName,
          reason,
        },
      });
    }

    if (resolver) {
      this.activeResolvers.delete(id);
      resolver({
        decision,
        status,
        decidedBy: operatorName,
        reason,
      });
      return true;
    }

    return false;
  }

  private handleTimeout(id: string): void {
    const resolver = this.activeResolvers.get(id);
    this.activeResolvers.delete(id);
    this.activeTimeouts.delete(id);

    this.store.resolveApproval(id, "timed_out", "deny", "system_timeout");

    const approval = this.store.getApproval(id);
    if (approval) {
      this.audit.log({
        sessionId: approval.sessionId,
        turnId: approval.turnId,
        nodeId: approval.nodeId,
        action: "approval.timeout",
        risk: approval.riskLevel,
        result: "timed_out",
        metadata: {
          approvalId: id,
          reason: "Bounded approval timeout elapsed without operator response (Headless Safety Invariant)",
        },
      });
    }

    if (resolver) {
      resolver({
        decision: "deny",
        status: "timed_out",
        decidedBy: "system_timeout",
        reason: "Approval request timed out after configured duration",
      });
    }
  }

  cancelAllForSession(sessionId: string): void {
    const pending = this.store.listApprovals("pending");
    for (const appr of pending) {
      if (appr.sessionId === sessionId) {
        this.resolve(appr.id, "cancel", "session_cancellation", "Session cancelled by user or system");
      }
    }
  }

  getPendingApprovals(): ApprovalRequest[] {
    return this.store.listApprovals("pending");
  }
}
