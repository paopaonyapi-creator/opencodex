// Phase 20.39 — Approval gateway (spec §18, §53 binding invariants). Every
// approval request stores the normalized (redacted) input and its SHA-256
// hash; execution consumes the approval ONLY when the pending hash matches
// the action about to run. That makes approvals single-use and bound to the
// exact approved parameters — no replay across unrelated actions. Decisions
// come from human actors only; expired requests can never be approved.

import { createHash } from "node:crypto";
import { CockpitError, type ActionType, type ApprovalRequest, type PolicyDecision } from "./types";
import type { CockpitStore } from "./store";
import { redactJsonForAudit } from "./redaction";

export const DEFAULT_APPROVAL_TTL_MS = 10 * 60 * 1000;

export interface ApprovalCreateInput {
  sessionId: string;
  workspaceId: string;
  actionType: ActionType;
  summary: string;
  actionInput: Record<string, unknown>;
  decision: PolicyDecision;
  ttlMs?: number;
}

export class ApprovalGateway {
  constructor(
    private readonly store: CockpitStore,
    private readonly audit: (event: { eventType: string; workspaceId: string; sessionId: string; summary: string; severity?: "info" | "warning" | "critical"; decision?: string; riskScore?: number; metadata?: Record<string, unknown> }) => void,
  ) {}

  create(input: ApprovalCreateInput): ApprovalRequest {
    const normalizedJson = redactJsonForAudit(input.actionInput);
    const inputHash = "sha256:" + createHash("sha256").update(normalizedJson).digest("hex").slice(0, 32);
    const ttl = input.ttlMs ?? DEFAULT_APPROVAL_TTL_MS;
    const approval = this.store.insertApproval({
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      actionType: input.actionType,
      summary: input.summary,
      normalizedInputJson: normalizedJson,
      inputHash,
      riskScore: input.decision.riskScore,
      reasonsJson: JSON.stringify(input.decision.reasons),
      status: "PENDING",
      expiresAt: new Date(Date.now() + ttl).toISOString(),
      decidedAt: null,
      decidedBy: null,
    });
    this.audit({
      eventType: "approval.requested",
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      summary: input.summary,
      decision: "PENDING",
      riskScore: input.decision.riskScore,
      metadata: { approvalId: approval.id, actionType: input.actionType, reasons: input.decision.reasons },
    });
    return approval;
  }

  decide(approvalId: string, approve: boolean, actor: string): ApprovalRequest {
    ApprovalGateway.requireHumanActor(actor);
    const approval = this.store.getApproval(approvalId);
    if (!approval) throw new CockpitError("NOT_FOUND", "approval not found: " + approvalId);
    if (approval.status !== "PENDING") {
      throw new CockpitError("VALIDATION_ERROR", "approval is not pending (status " + approval.status + ")");
    }
    if (approval.expiresAt && Date.parse(approval.expiresAt) < Date.now()) {
      this.store.updateApprovalStatus(approvalId, "EXPIRED", actor);
      this.audit({
        eventType: "approval.expired",
        workspaceId: approval.workspaceId,
        sessionId: approval.sessionId,
        summary: "approval expired before decision",
        severity: "warning",
        decision: "EXPIRED",
        riskScore: approval.riskScore,
      });
      throw new CockpitError("APPROVAL_EXPIRED", "approval expired before decision");
    }
    const nextStatus: ApprovalRequest["status"] = approve ? "APPROVED" : "DENIED";
    const updated = this.store.updateApprovalStatus(approvalId, nextStatus, actor);
    this.audit({
      eventType: approve ? "approval.approved" : "approval.denied",
      workspaceId: approval.workspaceId,
      sessionId: approval.sessionId,
      summary: approval.summary,
      decision: nextStatus,
      riskScore: approval.riskScore,
      metadata: { approvalId, actor, actionType: approval.actionType },
    });
    return updated;
  }

  /** Human-actor gate (repo-wide invariant). Non-human actors can decide
   *  nothing. */
  static requireHumanActor(actor: string): void {
    if (!/^(operator|dashboard|user|human|owner)/i.test(actor)) {
      throw new CockpitError("POLICY_DENIED", "approval decisions require a human actor");
    }
  }

  /** Consume a single-use approval for an EXACT action. The hash of the
   *  redacted action input must match the approved request's stored hash —
   *  otherwise the approval cannot be applied (spec §53). */
  consume(approvalId: string, actionInput: Record<string, unknown>): ApprovalRequest {
    const approval = this.store.getApproval(approvalId);
    if (!approval) throw new CockpitError("NOT_FOUND", "approval not found: " + approvalId);
    if (approval.status === "CONSUMED") {
      throw new CockpitError("POLICY_DENIED", "approval already consumed (single-use)");
    }
    if (approval.status === "EXPIRED" || (approval.expiresAt && Date.parse(approval.expiresAt) < Date.now())) {
      if (approval.status === "PENDING") this.store.updateApprovalStatus(approvalId, "EXPIRED", null);
      throw new CockpitError("APPROVAL_EXPIRED", "approval expired");
    }
    if (approval.status !== "APPROVED") {
      throw new CockpitError("APPROVAL_DENIED", "approval is " + approval.status);
    }
    const candidateHash = "sha256:" + createHash("sha256").update(redactJsonForAudit(actionInput)).digest("hex").slice(0, 32);
    if (candidateHash !== approval.inputHash) {
      this.audit({
        eventType: "approval.binding_mismatch",
        workspaceId: approval.workspaceId,
        sessionId: approval.sessionId,
        summary: "approval hash mismatch — action parameters differ from the approved request",
        severity: "critical",
        decision: "REJECTED",
        riskScore: approval.riskScore,
        metadata: { approvalId },
      });
      throw new CockpitError("POLICY_DENIED", "approval is bound to different action parameters");
    }
    return this.store.updateApprovalStatus(approvalId, "CONSUMED", approval.decidedBy);
  }

  expireStale(): number {
    return this.store.expireStaleApprovals(Date.now());
  }
}
