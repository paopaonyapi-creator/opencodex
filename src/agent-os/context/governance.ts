/**
 * Pao Context Control Plane — memory governance + experience confidence
 * (Phase 20.53 §26-35, §96-99, §121).
 *
 * Memory is governed state: every candidate gets a review state by policy,
 * every mutation is audited with before/after, promotion to shared knowledge
 * requires a human for high-impact classes, and suppressed memory never
 * injects. Experience confidence is ADVISORY — never an authorization input.
 */

import { nextId } from "./events";
import { scanMemoryCandidate } from "./security/secret-scan";
import type {
  MemoryGovernanceRecord,
  MemoryReviewAction,
  MemoryReviewRecord,
  MemoryReviewState,
} from "./types";
import type { ContextDbStore } from "./db-store";

export type GovernanceError = "CTX_BLOCKED_SECRET" | "CTX_NOT_FOUND" | "CTX_MEMORY_PROMOTION_REQUIRES_HUMAN" | "CTX_FORBIDDEN" | "CTX_BLOCKED_POLICY";

export class MemoryGovernanceError extends Error {
  readonly code: GovernanceError;
  readonly httpStatus: number;
  constructor(code: GovernanceError, message: string, httpStatus = 409) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** High-impact classes that ALWAYS require human promotion approval (§99). */
const HUMAN_PROMOTION_REQUIRED: ReadonlySet<string> = new Set([
  "security_policy",
  "production_runbook",
  "financial_policy",
  "credential_procedure",
  "global_agent_behavior",
  "shared_architecture_invariant",
]);

export interface MemoryCandidateInput {
  readonly memoryUri: string;
  readonly memoryType?: string;
  readonly ownerUserId?: string;
  readonly workspaceId?: string;
  readonly peerId?: string;
  readonly contentPreview: string;
  readonly sourceSessionId?: string;
  /** Explicit human confirmation of a stable preference. */
  readonly userConfirmed?: boolean;
  readonly riskLevel?: "low" | "normal" | "elevated" | "high";
}

export interface MemoryGovernanceServiceDeps {
  readonly store: ContextDbStore;
  /** Actor ids permitted to review/promote (spec: humans only). */
  readonly canReview: (actorId: string) => boolean;
  readonly now?: () => Date;
}

export class MemoryGovernanceService {
  private readonly store: ContextDbStore;
  private readonly canReview: (actorId: string) => boolean;
  private readonly now: () => Date;

  constructor(deps: MemoryGovernanceServiceDeps) {
    this.store = deps.store;
    this.canReview = deps.canReview;
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Register a memory candidate with the default review state per §28:
   *   private low-risk preference      -> auto_accepted_private
   *   shared/peer workspace fact       -> pending_review
   *   secret-like candidate            -> REJECTED (no write), alert
   *   conflicting identity statement   -> pending_review
   */
  registerCandidate(input: MemoryCandidateInput): { record: MemoryGovernanceRecord | null; rejectedForSecret: boolean } {
    const scan = scanMemoryCandidate(input.contentPreview);
    if (scan.blocked) {
      // Secret-like candidates are rejected and alerted — never written.
      const rejectedRecord: MemoryGovernanceRecord = {
        id: nextId("ctxmg"),
        memoryUri: input.memoryUri,
        memoryType: input.memoryType,
        ownerUserId: input.ownerUserId,
        workspaceId: input.workspaceId,
        peerId: input.peerId,
        reviewState: "rejected",
        pinned: false,
        suppressed: false,
        riskLevel: "high",
        sourceSessionId: input.sourceSessionId,
        contentPreview: "[REDACTED: secret-like content blocked]",
        createdAt: this.now().toISOString(),
        updatedAt: this.now().toISOString(),
      };
      this.store.upsertMemoryGovernance(rejectedRecord);
      this.appendReview(rejectedRecord.id, "reject", "system", undefined, "deterministic secret filter", rejectedRecord, rejectedRecord);
      return { record: rejectedRecord, rejectedForSecret: true };
    }

    const isPrivate = input.ownerUserId !== undefined && input.workspaceId === undefined;
    const reviewState: MemoryReviewState = isPrivate
      ? "auto_accepted_private"
      : input.userConfirmed === true
        ? "approved"
        : "pending_review";
    const riskLevel = input.riskLevel ?? (isPrivate ? "low" : "normal");

    const record: MemoryGovernanceRecord = {
      id: nextId("ctxmg"),
      memoryUri: input.memoryUri,
      memoryType: input.memoryType,
      ownerUserId: input.ownerUserId,
      workspaceId: input.workspaceId,
      peerId: input.peerId,
      reviewState,
      pinned: false,
      suppressed: false,
      riskLevel,
      sourceSessionId: input.sourceSessionId,
      contentPreview: input.contentPreview.slice(0, 200),
      lastVerifiedAt: this.now().toISOString(),
      createdAt: this.now().toISOString(),
      updatedAt: this.now().toISOString(),
    };
    this.store.upsertMemoryGovernance(record);
    return { record, rejectedForSecret: false };
  }

  private requireReviewPermission(actorId: string): void {
    if (!this.canReview(actorId)) {
      throw new MemoryGovernanceError("CTX_FORBIDDEN", "Actor is not permitted to review memory", 403);
    }
  }

  private apply(governanceId: string, action: MemoryReviewAction, mutate: (record: MemoryGovernanceRecord) => MemoryGovernanceRecord, actorId: string, reason?: string): MemoryGovernanceRecord {
    const before = this.store.getMemoryGovernance(governanceId);
    if (!before) throw new MemoryGovernanceError("CTX_NOT_FOUND", "Memory governance record not found", 404);
    const after = mutate(before);
    this.store.upsertMemoryGovernance({ ...after, updatedAt: this.now().toISOString() });
    this.appendReview(governanceId, action, "user", actorId, reason, before, after);
    return after;
  }

  approve(governanceId: string, actorId: string, reason?: string): MemoryGovernanceRecord {
    this.requireReviewPermission(actorId);
    return this.apply(governanceId, "approve", r => ({ ...r, reviewState: "approved", lastVerifiedAt: this.now().toISOString() }), actorId, reason);
  }

  reject(governanceId: string, actorId: string, reason?: string): MemoryGovernanceRecord {
    this.requireReviewPermission(actorId);
    return this.apply(governanceId, "reject", r => ({ ...r, reviewState: "rejected" }), actorId, reason);
  }

  pin(governanceId: string, actorId: string, reason?: string): MemoryGovernanceRecord {
    this.requireReviewPermission(actorId);
    // Pinning must not bypass ACL/sensitivity: only approved records pin.
    const record = this.store.getMemoryGovernance(governanceId);
    if (!record) throw new MemoryGovernanceError("CTX_NOT_FOUND", "Memory governance record not found", 404);
    if (record.reviewState !== "approved" && record.reviewState !== "auto_accepted_private") {
      throw new MemoryGovernanceError("CTX_BLOCKED_POLICY", "Only approved memory can be pinned", 409);
    }
    return this.apply(governanceId, "pin", r => ({ ...r, pinned: true }), actorId, reason);
  }

  unpin(governanceId: string, actorId: string): MemoryGovernanceRecord {
    this.requireReviewPermission(actorId);
    return this.apply(governanceId, "unpin", r => ({ ...r, pinned: false }), actorId);
  }

  suppress(governanceId: string, actorId: string, reason: string): MemoryGovernanceRecord {
    this.requireReviewPermission(actorId);
    return this.apply(governanceId, "suppress", r => ({ ...r, suppressed: true }), actorId, reason);
  }

  unsuppress(governanceId: string, actorId: string): MemoryGovernanceRecord {
    this.requireReviewPermission(actorId);
    return this.apply(governanceId, "unsuppress", r => ({ ...r, suppressed: false }), actorId);
  }

  expire(governanceId: string, actorId: string): MemoryGovernanceRecord {
    this.requireReviewPermission(actorId);
    return this.apply(governanceId, "expire", r => ({ ...r, reviewState: "expired" }), actorId);
  }

  markSuperseded(governanceId: string, actorId: string, reason?: string): MemoryGovernanceRecord {
    this.requireReviewPermission(actorId);
    return this.apply(governanceId, "mark_superseded", r => ({ ...r, reviewState: "superseded" }), actorId, reason);
  }

  /**
   * Promotion to shared knowledge. Human approval is required whenever the
   * candidate is high-impact or currently pending review (§99); the caller
   * passes the impact class so the gate is explicit.
   */
  promote(governanceId: string, actorId: string, impactClass: string, targetUri?: string): MemoryGovernanceRecord {
    this.requireReviewPermission(actorId);
    const record = this.store.getMemoryGovernance(governanceId);
    if (!record) throw new MemoryGovernanceError("CTX_NOT_FOUND", "Memory governance record not found", 404);
    const requiresHuman = HUMAN_PROMOTION_REQUIRED.has(impactClass) || record.reviewState === "pending_review";
    if (requiresHuman && this.canReview(actorId) !== true) {
      throw new MemoryGovernanceError("CTX_MEMORY_PROMOTION_REQUIRES_HUMAN", "Promotion requires human review", 403);
    }
    const after = this.apply(
      governanceId,
      "promote",
      r => ({ ...r, reviewState: "approved", notes: `${r.notes ? `${r.notes}; ` : ""}promoted as ${impactClass} -> ${targetUri ?? "shared resource"} (provenance preserved)` }),
      actorId,
      `promoted as ${impactClass}`,
    );
    return after;
  }

  /** Review queue for the operator UX (§100). */
  reviewQueue(): MemoryGovernanceRecord[] {
    return this.store.listMemoriesForReview();
  }

  reviewHistory(governanceId: string): MemoryReviewRecord[] {
    return this.store.listMemoryReviews(governanceId);
  }

  private appendReview(governanceId: string, action: MemoryReviewAction, reviewerType: "user" | "system" | "policy", reviewerId: string | undefined, reason: string | undefined, before: MemoryGovernanceRecord, after: MemoryGovernanceRecord): void {
    try {
      this.store.saveMemoryReview(
        { id: nextId("ctxmr"), governanceId, action, reviewerType, reviewerId, reason, createdAt: this.now().toISOString() },
        before,
        after,
      );
    } catch {
      // Review ledger failures surface via health, never break the action.
    }
  }
}

// ---------------------------------------------------------------------------
// Experience confidence (§35) — advisory only
// ---------------------------------------------------------------------------

export function computeExperienceConfidence(input: {
  reuseCount: number;
  successCount: number;
  failureCount: number;
  humanApproved: boolean;
  lastUsedAt?: string;
  now: () => number;
}): number {
  const total = input.reuseCount;
  if (total === 0) return 0;
  const successRate = input.successCount / Math.max(1, input.successCount + input.failureCount);
  const sampleFactor = Math.min(1, total / 5); // needs ~5 reuses for full weight
  const approvalBoost = input.humanApproved ? 0.15 : 0;
  let recencyFactor = 0.5;
  if (input.lastUsedAt) {
    const ageDays = (input.now() - Date.parse(input.lastUsedAt)) / 86_400_000;
    if (Number.isFinite(ageDays)) recencyFactor = Math.max(0, 1 - ageDays / 60);
  }
  return Math.min(1, successRate * sampleFactor * (0.7 + 0.3 * recencyFactor) + approvalBoost);
}
