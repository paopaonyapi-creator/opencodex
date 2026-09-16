/**
 * Pao Market Signal Control Plane — human approval runtime (Phase 20.52 §21).
 *
 * Every execution proposal requires an explicit human decision. Approval
 * actions are permission-checked, idempotent (a resolved request cannot be
 * resolved again), optimistic (version-checked update), expiry-aware, and
 * fully audited.
 */

import type { ActorRef, ApprovalRequest } from "../types";
import type { MarketEventBus } from "../events";
import type { MarketDbStore } from "../db-store";
import { nextId } from "../events";

export type ApprovalAction = "APPROVE" | "REJECT" | "EDIT_AND_APPROVE" | "EXPIRE";

export interface ApprovalPermissions {
  /** Actor ids permitted to resolve approvals. Providers/agents never qualify. */
  readonly canApprove: (actor: ActorRef) => boolean;
  readonly canView: (actor: ActorRef) => boolean;
}

export interface ApprovalServiceDeps {
  readonly store: MarketDbStore;
  readonly bus: MarketEventBus;
  readonly expiryMinutes: number;
  readonly permissions: ApprovalPermissions;
  readonly now?: () => Date;
}

export class ApprovalError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  constructor(code: string, message: string, httpStatus = 409) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export class ApprovalService {
  private readonly store: MarketDbStore;
  private readonly bus: MarketEventBus;
  private readonly expiryMinutes: number;
  private readonly permissions: ApprovalPermissions;
  private readonly now: () => Date;

  constructor(deps: ApprovalServiceDeps) {
    this.store = deps.store;
    this.bus = deps.bus;
    this.expiryMinutes = deps.expiryMinutes;
    this.permissions = deps.permissions;
    this.now = deps.now ?? (() => new Date());
  }

  /** Create the pending approval for a proposal (idempotent per proposal). */
  request(proposalId: string, correlationId: string): ApprovalRequest {
    const existing = this.store.getApprovalByProposal(proposalId);
    if (existing && existing.status === "pending") {
      return existing; // idempotent re-request
    }
    const now = this.now().toISOString();
    const approval: ApprovalRequest = {
      id: nextId("mapr"),
      proposalId,
      status: "pending",
      requestedAt: now,
      expiresAt: new Date(this.now().getTime() + this.expiryMinutes * 60_000).toISOString(),
      version: 1,
    };
    this.store.saveApproval(approval);
    this.bus.publish({
      type: "market.approval.requested",
      payload: { approvalId: approval.id, proposalId },
      correlationId,
      causationId: proposalId,
      actor: { type: "system", id: "market-pipeline" },
    });
    return approval;
  }

  private requireActor(actor: ActorRef): void {
    if (!actor || actor.type !== "user" || !this.permissions.canApprove(actor)) {
      throw new ApprovalError("MARKET_APPROVAL_FORBIDDEN", "Actor is not permitted to resolve approvals", 403);
    }
  }

  approve(approvalId: string, actor: ActorRef, editedFields?: Record<string, unknown>): ApprovalRequest {
    this.requireActor(actor);
    const existing = this.store.getApproval(approvalId);
    if (!existing) throw new ApprovalError("MARKET_APPROVAL_NOT_FOUND", "Approval request not found", 404);
    if (existing.status !== "pending") {
      // Idempotency: re-approving with identical effect returns the record.
      if (existing.status === "approved" && existing.approvedBy === actor.id) return existing;
      throw new ApprovalError("MARKET_APPROVAL_ALREADY_RESOLVED", `Approval already ${existing.status}`, 409);
    }
    if (this.now().getTime() >= Date.parse(existing.expiresAt)) {
      this.expire(approvalId, { type: "system", id: "market-expiry" });
      throw new ApprovalError("MARKET_APPROVAL_EXPIRED", "Approval request expired before resolution", 410);
    }

    const resolved = this.store.resolveApproval(
      approvalId,
      "approved",
      { by: actor.id, at: this.now().toISOString() },
      existing.version,
    );
    if (!resolved) {
      // A concurrent resolver won the race — surface it rather than double-
      // applying.
      throw new ApprovalError("MARKET_APPROVAL_ALREADY_RESOLVED", "Approval was resolved concurrently", 409);
    }
    if (editedFields && Object.keys(editedFields).length > 0) {
      // Edited approval stores the operator's adjusted fields with the record.
      this.store.appendAudit({
        id: nextId("mau"),
        correlationId: `approval-${approvalId}`,
        eventType: "market.approval.edited",
        actorType: actor.type,
        actorId: actor.id,
        resourceType: "approval",
        resourceId: approvalId,
        action: "EDIT_AND_APPROVE",
        result: "success",
        metadata: { editedFields },
        createdAt: this.now().toISOString(),
      });
    }
    this.bus.publish({
      type: "market.approval.approved",
      payload: { approvalId, proposalId: existing.proposalId, approvedBy: actor.id },
      correlationId: `approval-${approvalId}`,
      causationId: existing.proposalId,
      actor,
    });
    return resolved;
  }

  reject(approvalId: string, actor: ActorRef, reason: string): ApprovalRequest {
    this.requireActor(actor);
    const existing = this.store.getApproval(approvalId);
    if (!existing) throw new ApprovalError("MARKET_APPROVAL_NOT_FOUND", "Approval request not found", 404);
    if (existing.status !== "pending") {
      if (existing.status === "rejected" && existing.rejectedBy === actor.id) return existing;
      throw new ApprovalError("MARKET_APPROVAL_ALREADY_RESOLVED", `Approval already ${existing.status}`, 409);
    }
    const resolved = this.store.resolveApproval(
      approvalId,
      "rejected",
      { by: actor.id, at: this.now().toISOString(), reason },
      existing.version,
    );
    if (!resolved) {
      throw new ApprovalError("MARKET_APPROVAL_ALREADY_RESOLVED", "Approval was resolved concurrently", 409);
    }
    this.bus.publish({
      type: "market.approval.rejected",
      payload: { approvalId, proposalId: existing.proposalId, rejectedBy: actor.id },
      correlationId: `approval-${approvalId}`,
      causationId: existing.proposalId,
      actor,
    });
    return resolved;
  }

  expire(approvalId: string, actor: ActorRef): ApprovalRequest | null {
    const existing = this.store.getApproval(approvalId);
    if (!existing || existing.status !== "pending") return existing;
    const resolved = this.store.resolveApproval(approvalId, "expired", { at: this.now().toISOString() }, existing.version);
    if (!resolved) return this.store.getApproval(approvalId);
    this.bus.publish({
      type: "market.approval.expired",
      payload: { approvalId, proposalId: existing.proposalId },
      correlationId: `approval-${approvalId}`,
      actor,
    });
    return resolved;
  }

  /** Scheduler entry: expire every pending request past its deadline. */
  expireStale(): number {
    const now = this.now().getTime();
    let count = 0;
    for (const approval of this.store.listPendingApprovals()) {
      if (now >= Date.parse(approval.expiresAt)) {
        this.expire(approval.id, { type: "scheduler", id: "approval-expiry" });
        count += 1;
      }
    }
    return count;
  }
}
