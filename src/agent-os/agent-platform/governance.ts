/**
 * Pao Agent Platform — deterministic policy engine + scoped human approvals
 * (Phase 20.54 §10-11).
 *
 * The engine is pure and inspectable: same inputs = same decision, always.
 * An LLM may propose; this engine disposes. Approvals are scoped to
 * task/capability/target/arguments-hash, time-limited, and one-time use for
 * R4. Fail closed: unverifiable policy/approval state denies.
 */

import { createHash } from "node:crypto";
import { nextId } from "./events";
import type {
  ApprovalRecord,
  ApprovalStatus,
  PolicyInput,
  PolicyOutput,
  RiskLevel,
} from "./types";

export function argumentsHash(args: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(args ?? {})).digest("hex")}`;
}

/** Deterministic key-sorted JSON serialization used for hashes and receipts. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(v => canonicalJson(v)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(",")}}`;
}

export interface PolicyRuleOverride {
  readonly capability: string;
  readonly decision: "ALLOW" | "DENY" | "ALLOW_WITH_SANDBOX" | "REQUIRE_APPROVAL" | "REQUIRE_REVIEW";
  readonly reason: string;
}

export interface PolicyEngineOptions {
  /** Manifest-level per-capability overrides (spec §5 approvals.rules). */
  readonly overrides?: readonly PolicyRuleOverride[];
  readonly r3ApprovalRequired?: boolean;
  readonly r4ApprovalRequired?: boolean;
  readonly now?: () => number;
}

const RISK_ORDER: Readonly<Record<RiskLevel, number>> = { R0: 0, R1: 1, R2: 2, R3: 3, R4: 4 };

export class PolicyEngine {
  private readonly overrides: ReadonlyMap<string, PolicyRuleOverride>;
  private readonly r3ApprovalRequired: boolean;
  private readonly r4ApprovalRequired: boolean;
  private readonly now: () => number;

  constructor(options: PolicyEngineOptions = {}) {
    this.overrides = new Map((options.overrides ?? []).map(o => [o.capability, o]));
    this.r3ApprovalRequired = options.r3ApprovalRequired ?? true;
    this.r4ApprovalRequired = options.r4ApprovalRequired ?? true;
    this.now = options.now ?? Date.now;
  }

  decide(input: PolicyInput): PolicyOutput {
    const override = this.overrides.get(input.capability);
    if (override?.decision === "DENY") {
      return { decision: "DENY", reason: override.reason, policyId: `override-${input.capability}`, reasonCode: "POLICY_DENIED_UNREGISTERED" };
    }

    // Approval path: verify scope and one-time-use semantics FIRST. A stale,
    // mismatched, or already-consumed approval never upgrades a decision.
    const approval = input.approvalContext;
    if (approval?.approvalId) {
      if (approval.consumed) {
        return { decision: "REQUIRE_APPROVAL", reason: "Approval already consumed", policyId: "approval-replay", reasonCode: "POLICY_APPROVAL_REPLAY_BLOCKED" };
      }
      if (approval.approvedForCapability !== input.capability) {
        return { decision: "REQUIRE_APPROVAL", reason: "Approval capability mismatch", policyId: "approval-scope", reasonCode: "POLICY_APPROVAL_MISMATCH" };
      }
      if (approval.approvedForTarget && input.resource && approval.approvedForTarget !== input.resource) {
        return { decision: "REQUIRE_APPROVAL", reason: "Approval target mismatch", policyId: "approval-scope", reasonCode: "POLICY_APPROVAL_MISMATCH" };
      }
      if (approval.approvedArgumentsHash && input.argumentsHash && approval.approvedArgumentsHash !== input.argumentsHash) {
        return { decision: "REQUIRE_APPROVAL", reason: "Approval arguments mismatch", policyId: "approval-scope", reasonCode: "POLICY_APPROVAL_MISMATCH" };
      }
      return { decision: "ALLOW", reason: "Valid scoped approval applied", policyId: `approval-${approval.approvalId}`, reasonCode: "POLICY_APPROVAL_APPLIED" };
    }

    if (override) {
      if (override.decision === "ALLOW") return { decision: "ALLOW", reason: override.reason, policyId: `override-${input.capability}`, reasonCode: "POLICY_ALLOWED" };
      if (override.decision === "ALLOW_WITH_SANDBOX") return { decision: "ALLOW_WITH_SANDBOX", reason: override.reason, policyId: `override-${input.capability}`, reasonCode: "POLICY_SANDBOX_REQUIRED" };
      if (override.decision === "REQUIRE_APPROVAL") return { decision: "REQUIRE_APPROVAL", reason: override.reason, policyId: `override-${input.capability}`, reasonCode: "POLICY_RISK_APPROVAL_REQUIRED" };
      if (override.decision === "REQUIRE_REVIEW") return { decision: "REQUIRE_REVIEW", reason: override.reason, policyId: `override-${input.capability}`, reasonCode: "POLICY_REVIEW_REQUIRED" };
    }

    const risk = RISK_ORDER[input.risk];
    if (input.risk === "R4" && this.r4ApprovalRequired) {
      return { decision: "REQUIRE_APPROVAL", reason: "R4 capability requires explicit human approval", policyId: "risk-r4", reasonCode: "POLICY_RISK_APPROVAL_REQUIRED" };
    }
    if (input.risk === "R3" && this.r3ApprovalRequired) {
      return { decision: "REQUIRE_APPROVAL", reason: "R3 capability requires approval by default", policyId: "risk-r3", reasonCode: "POLICY_RISK_APPROVAL_REQUIRED" };
    }
    if (input.risk === "R2") {
      return { decision: "ALLOW_WITH_SANDBOX", reason: "R2 mutation executes under sandbox profile", policyId: "risk-r2", reasonCode: "POLICY_SANDBOX_REQUIRED" };
    }
    void risk;
    return { decision: "ALLOW", reason: "Read-only or low-impact capability", policyId: "risk-default", reasonCode: "POLICY_ALLOWED" };
  }
}

// ---------------------------------------------------------------------------
// Approval service
// ---------------------------------------------------------------------------

export interface ApprovalServiceOptions {
  readonly expiryMinutes: number;
  readonly canApprove: (actorId: string) => boolean;
  readonly now?: () => number;
}

export class ScopedApprovalService {
  private readonly approvals = new Map<string, ApprovalRecord>();
  private readonly expiryMinutes: number;
  private readonly canApprove: (actorId: string) => boolean;
  private readonly now: () => number;

  constructor(options: ApprovalServiceOptions) {
    this.expiryMinutes = options.expiryMinutes;
    this.canApprove = options.canApprove;
    this.now = options.now ?? Date.now;
  }

  request(input: {
    taskId: string;
    agentId: string;
    capabilityId: string;
    target?: string;
    argumentsHash?: string;
    riskLevel: RiskLevel;
    expectedSideEffect: string;
    rollbackAvailable: boolean;
  }): ApprovalRecord {
    const record: ApprovalRecord = {
      id: nextId("apr"),
      taskId: input.taskId,
      agentId: input.agentId,
      capabilityId: input.capabilityId,
      target: input.target,
      argumentsHash: input.argumentsHash,
      riskLevel: input.riskLevel,
      expectedSideEffect: input.expectedSideEffect,
      rollbackAvailable: input.rollbackAvailable,
      status: "pending",
      requestedAt: new Date(this.now()).toISOString(),
      expiresAt: new Date(this.now() + this.expiryMinutes * 60_000).toISOString(),
      consumed: false,
    };
    this.approvals.set(record.id, record);
    return record;
  }

  get(id: string): ApprovalRecord | undefined {
    const record = this.approvals.get(id);
    if (!record) return undefined;
    if (record.status === "pending" && this.now() >= Date.parse(record.expiresAt)) {
      const expired = { ...record, status: "expired" as ApprovalStatus };
      this.approvals.set(id, expired);
      return expired;
    }
    return record;
  }

  listPending(): ApprovalRecord[] {
    return [...this.approvals.values()].filter(r => r.status === "pending");
  }

  listAll(): ApprovalRecord[] {
    return [...this.approvals.keys()].map(id => this.get(id)!).filter(Boolean);
  }

  resolve(id: string, actorId: string, decision: "approved" | "rejected"): ApprovalRecord {
    const record = this.get(id);
    if (!record) throw new Error("APPROVAL_NOT_FOUND");
    if (record.status !== "pending") throw new Error(`APPROVAL_ALREADY_RESOLVED: already ${record.status}`);
    if (record.riskLevel === "R4" && actorId === record.agentId) {
      throw new Error("APPROVAL_FORBIDDEN: R4 cannot self-approve");
    }
    if (!this.canApprove(actorId)) {
      throw new Error("APPROVAL_FORBIDDEN: actor may not resolve approvals");
    }
    const resolved: ApprovalRecord = {
      ...record,
      status: decision,
      resolvedAt: new Date(this.now()).toISOString(),
      resolvedBy: actorId,
    };
    this.approvals.set(id, resolved);
    return resolved;
  }

  /**
   * Mark an approval consumed at execution time. R4 approvals are one-time
   * use; R2/R3 may be re-used within scope until expiry.
   */
  markConsumed(id: string, riskLevel: RiskLevel): void {
    const record = this.approvals.get(id);
    if (!record) return;
    this.approvals.set(id, { ...record, consumed: riskLevel === "R4" ? true : record.consumed, status: "executed" as ApprovalStatus });
  }

  approvalContext(record: ApprovalRecord | undefined) {
    if (!record || record.status !== "approved") return null;
    return {
      approvalId: record.id,
      approvedForCapability: record.capabilityId,
      approvedForTarget: record.target,
      approvedArgumentsHash: record.argumentsHash,
      consumed: record.consumed,
    };
  }
}
