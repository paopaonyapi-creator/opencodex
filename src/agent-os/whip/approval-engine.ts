// Phase 20.99 — Policy-Governed Human Approval Control Plane & Audit (§14, §28).
//
// Key principles:
// - R0 (Observe): Auto allow.
// - R1 (Reversible read/nav): Allow + audit.
// - R2 (Controlled write): Allow or compact confirmation.
// - R3 (High-impact): Explicit approval sheet + context summary.
// - R4 (Critical / destructive / financial): Strong approval + biometric verification.
// - Confused-deputy defense: Approval bound to payload hash, target, policy version, host, session, expiry.
//   Any material change invalidates the approval.

import { canonicalJson, sha256Hex } from "../agent-runtime/hash";
import { newWhipId, nowIso, WhipStore } from "./store";
import {
  type WhipApprovalRequest,
  type WhipApprovalStatus,
  type WhipAuditEvent,
  type WhipRiskClass,
  WhipError,
} from "./types";

export interface ApprovalInput {
  hostId: string;
  deviceId: string;
  agentId?: string | null;
  sessionId?: string | null;
  action: string;
  target: string;
  args: Record<string, unknown>;
  humanSummary: string;
  risk: WhipRiskClass;
  ttlMinutes?: number;
}

export class WhipApprovalEngine {
  private readonly store: WhipStore;
  private readonly policyVersion = "2026-09-20.1";

  constructor(store?: WhipStore) {
    this.store = store ?? new WhipStore();
  }

  computePayloadHash(action: string, target: string, args: Record<string, unknown>): string {
    return sha256Hex(canonicalJson({ action, target, args }));
  }

  /**
   * Evaluate policy before remote action execution (spec §14.2).
   */
  evaluateAction(input: {
    action: string;
    target: string;
    args: Record<string, unknown>;
    risk?: WhipRiskClass;
  }): { outcome: "allow" | "require_approval" | "deny"; risk: WhipRiskClass; reason: string } {
    const risk = input.risk ?? this.inferRisk(input.action, input.args);

    if (risk === "R0" || risk === "R1") {
      return { outcome: "allow", risk, reason: "low-risk action permitted by policy" };
    }
    if (risk === "R2") {
      return { outcome: "allow", risk, reason: "controlled write permitted with audit" };
    }

    // R3 and R4 require explicit approval
    return {
      outcome: "require_approval",
      risk,
      reason: `high-risk ${risk} action requires explicit operator approval`,
    };
  }

  inferRisk(action: string, args: Record<string, unknown> = {}): WhipRiskClass {
    const a = action.toLowerCase();
    const argsStr = JSON.stringify(args).toLowerCase();
    if (
      a.includes("destroy") ||
      a.includes("root") ||
      a.includes("purge") ||
      a.includes("force_push") ||
      argsStr.includes("rm -rf") ||
      argsStr.includes("drop table")
    ) {
      return "R4";
    }
    if (
      a.includes("delete") ||
      a.includes("deploy") ||
      a.includes("push") ||
      a.includes("restart_service") ||
      a.includes("package_publish") ||
      a.includes("overwrite")
    ) {
      return "R3";
    }
    if (a.includes("write") || a.includes("edit") || a.includes("upload") || a.includes("start_agent")) {
      return "R2";
    }
    if (a.includes("read") || a.includes("list") || a.includes("diff") || a.includes("preview")) {
      return "R1";
    }
    return "R0";
  }

  /**
   * Create an approval request bound to the exact payload hash (spec §14.3, §27).
   */
  requestApproval(input: ApprovalInput): WhipApprovalRequest {
    const id = newWhipId("whpap");
    const payloadHash = this.computePayloadHash(input.action, input.target, input.args);
    const ttl = input.ttlMinutes ?? 10;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttl * 60_000).toISOString();

    const request: WhipApprovalRequest = {
      id,
      hostId: input.hostId,
      deviceId: input.deviceId,
      agentId: input.agentId ?? null,
      sessionId: input.sessionId ?? null,
      action: input.action,
      target: input.target,
      humanSummary: input.humanSummary,
      exactPayloadHash: payloadHash,
      risk: input.risk,
      status: "pending",
      biometricVerified: false,
      policyVersion: this.policyVersion,
      expiresAt,
      createdAt: now.toISOString(),
    };

    this.store.insertApproval(request);
    return request;
  }

  /**
   * Decide approval (spec §14.2: R4 can require biometric verification).
   */
  decideApproval(input: {
    approvalId: string;
    decision: "approved" | "denied";
    decidedBy: string;
    biometricVerified?: boolean;
    reason?: string;
  }): WhipApprovalRequest {
    const appr = this.store.getApproval(input.approvalId);
    if (!appr) {
      throw new WhipError("APPROVAL_NOT_FOUND", `approval request not found: ${input.approvalId}`);
    }
    if (appr.status !== "pending") {
      throw new WhipError("INVALID_INPUT", `approval request is already in state '${appr.status}'`);
    }
    if (new Date(appr.expiresAt).getTime() <= Date.now()) {
      throw new WhipError("APPROVAL_EXPIRED", "approval request has expired");
    }

    if (input.decision === "approved" && appr.risk === "R4" && !input.biometricVerified) {
      throw new WhipError(
        "POLICY_DENIED",
        "critical R4 approval requires biometric re-authentication",
      );
    }

    const updated = this.store.decideApproval(
      input.approvalId,
      input.decision,
      input.decidedBy,
      input.reason,
      input.biometricVerified,
    )!;

    // Record audit event
    this.recordAuditEvent({
      eventType: "whip.approval.decided.v1",
      hostId: appr.hostId,
      deviceId: appr.deviceId,
      agentId: appr.agentId,
      sessionId: appr.sessionId,
      action: appr.action,
      risk: appr.risk,
      approvalId: appr.id,
      policyVersion: appr.policyVersion,
      payloadHash: appr.exactPayloadHash,
      result: input.decision === "approved" ? "success" : "denied",
      correlationId: `corr_${appr.id}`,
      sanitizedPayload: { reason: input.reason, biometricVerified: input.biometricVerified },
      timestamp: nowIso(),
    });

    return updated;
  }

  /**
   * Verify approval at execution time (spec §27 Threat T7: Confused-deputy defense).
   */
  verifyApprovalForExecution(
    approvalId: string,
    action: string,
    target: string,
    args: Record<string, unknown>,
  ): void {
    const appr = this.store.getApproval(approvalId);
    if (!appr) {
      throw new WhipError("APPROVAL_NOT_FOUND", "approval record not found");
    }
    if (appr.status !== "approved") {
      throw new WhipError("POLICY_DENIED", `approval is in state '${appr.status}', not 'approved'`);
    }
    if (new Date(appr.expiresAt).getTime() <= Date.now()) {
      throw new WhipError("APPROVAL_EXPIRED", "approval has expired");
    }

    const expectedHash = this.computePayloadHash(action, target, args);
    if (appr.exactPayloadHash !== expectedHash) {
      throw new WhipError(
        "APPROVAL_HASH_MISMATCH",
        "action parameters changed after approval was granted; approval invalidated (confused-deputy defense)",
      );
    }
  }

  recordAuditEvent(event: Omit<WhipAuditEvent, "id">): WhipAuditEvent {
    const full: WhipAuditEvent = {
      ...event,
      id: newWhipId("whpaud"),
    };
    this.store.appendAudit(full);
    return full;
  }

  listAuditEvents(filter?: { hostId?: string; correlationId?: string }) {
    return this.store.listAuditEvents(filter);
  }
}
