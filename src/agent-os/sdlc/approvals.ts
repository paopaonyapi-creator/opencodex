// Phase 20.2 — Human Approval Gate
//
// Governs human authorization for high-risk and critical engineering operations.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import type { SdlcApproval, ApprovalActionType, RiskLevel, ApprovalStatus } from "./types";

export class ApprovalEngine {
  /**
   * Requests a human approval for a high-risk operation.
   */
  static requestApproval(input: {
    cycleId: string;
    actionType: ApprovalActionType;
    reason: string;
    riskLevel: RiskLevel;
    requestedBy?: string;
    ttlMinutes?: number;
  }): SdlcApproval {
    const db = openAgentOsDb();
    const now = new Date().toISOString();
    const ttl = (input.ttlMinutes ?? 60) * 60 * 1000;
    const expiresAt = Date.now() + ttl;
    const id = `appr_${randomUUID().slice(0, 12)}`;
    const token = `tok_${randomUUID().replace(/-/g, "")}`;

    db.query(`
      INSERT INTO sdlc_approvals
        (id, cycle_id, action_type, reason, risk_level, status, token, requested_by, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
    `).run(
      id,
      input.cycleId,
      input.actionType,
      input.reason,
      input.riskLevel,
      token,
      input.requestedBy ?? "system",
      expiresAt,
      now,
    );

    return {
      id,
      cycleId: input.cycleId,
      actionType: input.actionType,
      reason: input.reason,
      riskLevel: input.riskLevel,
      status: "pending",
      token,
      requestedBy: input.requestedBy ?? "system",
      decidedBy: null,
      expiresAt,
      createdAt: now,
      decidedAt: null,
    };
  }

  /**
   * Approves a pending request using its token or approval ID.
   */
  static decideApproval(idOrToken: string, decision: "approve" | "reject", decidedBy: string): SdlcApproval {
    const db = openAgentOsDb();
    const now = Date.now();
    const nowDate = new Date().toISOString();

    const row = db.query(`
      SELECT * FROM sdlc_approvals
      WHERE (id = ? OR token = ?)
    `).get(idOrToken, idOrToken) as Record<string, unknown> | undefined;

    if (!row) {
      throw new Error(`Approval request '${idOrToken}' not found`);
    }

    if (row.status !== "pending") {
      throw new Error(`Approval request '${idOrToken}' is already ${row.status}`);
    }

    if (Number(row.expires_at) <= now) {
      db.query("UPDATE sdlc_approvals SET status = 'expired' WHERE id = ?").run(row.id as string);
      throw new Error(`Approval request '${idOrToken}' has expired`);
    }

    const newStatus: ApprovalStatus = decision === "approve" ? "approved" : "rejected";
    db.query(`
      UPDATE sdlc_approvals
      SET status = ?, decided_by = ?, decided_at = ?
      WHERE id = ?
    `).run(newStatus, decidedBy, nowDate, row.id as string);

    return {
      id: row.id as string,
      cycleId: row.cycle_id as string,
      actionType: row.action_type as ApprovalActionType,
      reason: row.reason as string,
      riskLevel: row.risk_level as RiskLevel,
      status: newStatus,
      token: row.token as string,
      requestedBy: row.requested_by as string,
      decidedBy,
      expiresAt: Number(row.expires_at),
      createdAt: row.created_at as string,
      decidedAt: nowDate,
    };
  }

  /**
   * Lists pending approvals for a cycle.
   */
  static listPendingApprovals(cycleId?: string): SdlcApproval[] {
    const db = openAgentOsDb();
    const now = Date.now();
    const sql = cycleId
      ? "SELECT * FROM sdlc_approvals WHERE cycle_id = ? AND status = 'pending' AND expires_at > ? ORDER BY created_at DESC"
      : "SELECT * FROM sdlc_approvals WHERE status = 'pending' AND expires_at > ? ORDER BY created_at DESC";
    const params = cycleId ? [cycleId, now] : [now];

    const rows = db.query(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => ({
      id: r.id as string,
      cycleId: r.cycle_id as string,
      actionType: r.action_type as ApprovalActionType,
      reason: r.reason as string,
      riskLevel: r.risk_level as RiskLevel,
      status: r.status as ApprovalStatus,
      token: r.token as string,
      requestedBy: r.requested_by as string,
      decidedBy: r.decided_by as string | null,
      expiresAt: Number(r.expires_at),
      createdAt: r.created_at as string,
      decidedAt: r.decided_at as string | null,
    }));
  }
}
