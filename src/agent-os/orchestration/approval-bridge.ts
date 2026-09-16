// Phase 20.22 — Pao-hubPro x LangChain Agent Orchestration & MCP Runtime Layer
// Bounded Approval Bridge & Headless Safety

import type {
  OrchestrationApproval,
  ToolRiskLevel,
} from "./types";
import { OrchestrationStore } from "./store";

export class ApprovalBridge {
  private store: OrchestrationStore;
  private defaultTtlMs = 60000; // 60s bounded timeout

  constructor(store?: OrchestrationStore, defaultTtlMs = 60000) {
    this.store = store || new OrchestrationStore();
    this.defaultTtlMs = defaultTtlMs;
  }

  requestApproval(
    runId: string,
    toolName: string,
    riskLevel: ToolRiskLevel,
    actionSummary: string,
    toolArgs: Record<string, unknown>,
    ttlMs?: number
  ): OrchestrationApproval {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (ttlMs || this.defaultTtlMs)).toISOString();

    const approval: OrchestrationApproval = {
      id: `appr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      runId,
      toolName,
      riskLevel,
      actionSummary,
      toolArgs,
      status: "pending",
      requestedAt: now.toISOString(),
      expiresAt,
    };

    this.store.createApproval(approval);
    return approval;
  }

  resolve(
    approvalId: string,
    approved: boolean,
    decidedBy = "operator",
    reason?: string
  ): OrchestrationApproval {
    const existing = this.store.getApproval(approvalId);
    if (!existing) {
      throw new Error(`Approval '${approvalId}' not found`);
    }

    if (existing.status !== "pending") {
      return existing;
    }

    // Check expiration
    const now = new Date();
    if (new Date(existing.expiresAt).getTime() < now.getTime()) {
      const timedOut = this.store.resolveApproval(approvalId, "timed_out", "system", "Approval request expired (headless safety)");
      return timedOut || existing;
    }

    const nextStatus = approved ? "approved" : "rejected";
    const resolved = this.store.resolveApproval(approvalId, nextStatus, decidedBy, reason);
    return resolved || existing;
  }

  checkPendingExpirations(): OrchestrationApproval[] {
    const pending = this.store.listApprovals("pending");
    const now = Date.now();
    const expired: OrchestrationApproval[] = [];

    for (const app of pending) {
      if (new Date(app.expiresAt).getTime() < now) {
        const res = this.store.resolveApproval(app.id, "timed_out", "system", "TTL expired");
        if (res) expired.push(res);
      }
    }
    return expired;
  }
}
