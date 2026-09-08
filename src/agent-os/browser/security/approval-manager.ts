// Phase 20.11 — Human Approval Gate Manager
//
// Coordinates human-in-the-loop approvals for Level 3 (CONFIRM_REQUIRED) actions,
// supporting Approve Once, Approve For Session, and Reject with audit persistence.

import { openAgentOsDb } from "../../db";
import type { ApprovalRequest, ApprovalStatus } from "../types";

export class BrowserApprovalManager {
  private sessionApprovedKeys = new Set<string>(); // e.g. "session_123:stock.adobe.com:submit"
  private approvalSessionIds = new Map<string, string>();
  private pendingResolvers = new Map<
    string,
    (status: "approved_once" | "approved_session" | "rejected") => void
  >();

  public isSessionApproved(sessionId: string, website: string, actionTool: string): boolean {
    const key = `${sessionId}:${website.toLowerCase()}:${actionTool.toLowerCase()}`;
    const defaultKey = `default:${website.toLowerCase()}:${actionTool.toLowerCase()}`;
    return this.sessionApprovedKeys.has(key) || this.sessionApprovedKeys.has(defaultKey);
  }

  public async requestApproval(
    agent: string,
    actionTool: string,
    website: string,
    reason: string,
    affectedData: Record<string, unknown> = {},
    sessionId = "default",
  ): Promise<{ status: "approved_once" | "approved_session" | "rejected"; request: ApprovalRequest }> {
    // Check if session already approved
    if (this.isSessionApproved(sessionId, website, actionTool)) {
      const autoApproved: ApprovalRequest = {
        id: `appr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        agent,
        actionTool,
        website,
        reason: `${reason} (Session Pre-Approved)`,
        affectedData,
        status: "approved_session",
        reviewedBy: "session_cache",
        createdAt: Date.now(),
        reviewedAt: Date.now(),
      };
      return { status: "approved_session", request: autoApproved };
    }

    const id = `appr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.approvalSessionIds.set(id, sessionId);
    const request: ApprovalRequest = {
      id,
      agent,
      actionTool,
      website,
      reason,
      affectedData,
      status: "pending",
      createdAt: Date.now(),
    };

    // Persist to database
    const db = openAgentOsDb();
    db.query(`
      INSERT INTO browser_approvals (id, agent, action_tool, website, reason, affected_data_json, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      agent,
      actionTool,
      website,
      reason,
      JSON.stringify(affectedData),
      "pending",
      request.createdAt,
    );

    // Wait for resolution or timeout (default 30s)
    const decisionPromise = new Promise<"approved_once" | "approved_session" | "rejected">(
      (resolve) => {
        this.pendingResolvers.set(id, resolve);

        // Auto-reject on timeout if unhandled
        setTimeout(() => {
          if (this.pendingResolvers.has(id)) {
            this.reject(id, "system_timeout");
          }
        }, 30000);
      },
    );

    const decision = await decisionPromise;
    request.status = decision;
    request.reviewedAt = Date.now();

    return { status: decision, request };
  }

  public approve(id: string, mode: "once" | "session" = "once", reviewer = "human_user"): boolean {
    const resolver = this.pendingResolvers.get(id);
    const db = openAgentOsDb();

    const status: ApprovalStatus = mode === "session" ? "approved_session" : "approved_once";
    const reviewedAt = Date.now();

    db.query(`
      UPDATE browser_approvals
      SET status = ?, reviewed_by = ?, reviewed_at = ?
      WHERE id = ?
    `).run(status, reviewer, reviewedAt, id);

    // Cache if session approved
    if (mode === "session") {
      const row = db.query("SELECT website, action_tool FROM browser_approvals WHERE id = ?").get(id) as {
        website: string;
        action_tool: string;
      } | null;
      if (row) {
        const sid = this.approvalSessionIds.get(id) || "default";
        this.sessionApprovedKeys.add(`${sid}:${row.website.toLowerCase()}:${row.action_tool.toLowerCase()}`);
        this.sessionApprovedKeys.add(`default:${row.website.toLowerCase()}:${row.action_tool.toLowerCase()}`);
      }
    }

    if (resolver) {
      this.pendingResolvers.delete(id);
      resolver(status);
      return true;
    }
    return false;
  }

  public reject(id: string, reviewer = "human_user"): boolean {
    const resolver = this.pendingResolvers.get(id);
    const db = openAgentOsDb();
    const reviewedAt = Date.now();

    db.query(`
      UPDATE browser_approvals
      SET status = 'rejected', reviewed_by = ?, reviewed_at = ?
      WHERE id = ?
    `).run(reviewer, reviewedAt, id);

    if (resolver) {
      this.pendingResolvers.delete(id);
      resolver("rejected");
      return true;
    }
    return false;
  }

  public listPending(): ApprovalRequest[] {
    const db = openAgentOsDb();
    const rows = db.query("SELECT * FROM browser_approvals WHERE status = 'pending' ORDER BY created_at ASC").all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      agent: String(r.agent),
      actionTool: String(r.action_tool),
      website: String(r.website),
      reason: String(r.reason),
      affectedData: JSON.parse(String(r.affected_data_json || "{}")),
      status: String(r.status) as ApprovalStatus,
      createdAt: Number(r.created_at),
      reviewedBy: r.reviewed_by ? String(r.reviewed_by) : undefined,
      reviewedAt: r.reviewed_at ? Number(r.reviewed_at) : undefined,
    }));
  }

  public getApproval(id: string): ApprovalRequest | null {
    const db = openAgentOsDb();
    const r = db.query("SELECT * FROM browser_approvals WHERE id = ?").get(id) as Record<string, unknown> | null;
    if (!r) return null;
    return {
      id: String(r.id),
      agent: String(r.agent),
      actionTool: String(r.action_tool),
      website: String(r.website),
      reason: String(r.reason),
      affectedData: JSON.parse(String(r.affected_data_json || "{}")),
      status: String(r.status) as ApprovalStatus,
      createdAt: Number(r.created_at),
      reviewedBy: r.reviewed_by ? String(r.reviewed_by) : undefined,
      reviewedAt: r.reviewed_at ? Number(r.reviewed_at) : undefined,
    };
  }

  public clearSessionApprovals(): void {
    this.sessionApprovedKeys.clear();
    this.approvalSessionIds.clear();
    for (const [id, resolver] of this.pendingResolvers.entries()) {
      resolver("rejected");
    }
    this.pendingResolvers.clear();
  }
}

let approvalManagerInstance: BrowserApprovalManager | null = null;
export function getBrowserApprovalManager(): BrowserApprovalManager {
  if (!approvalManagerInstance) {
    approvalManagerInstance = new BrowserApprovalManager();
  }
  return approvalManagerInstance;
}
