// Phase 20.98 — Pure policy engine for OpenHermit execution (spec §13, §14, §15, §18).
//
// Evaluation order (spec §13):
//   identity → workspace → agent → capability → tool/MCP → data → sandbox → network → cost → approval
// Outcomes: allow | deny | require_approval | allow_with_constraints.
// Deny ALWAYS overrides allow.
//
// Risk classes (spec §14):
//   R0: low-risk read (auto allow)
//   R1: controlled read (allow with policy)
//   R2: reversible write (allow with constraints / approval depending on target)
//   R3: external side effect (approval required)
//   R4: destructive / financial / security-critical (explicit human approval + strong audit)

import { canonicalJson, sha256Hex } from "../agent-runtime/hash";
import {
  type ApprovalRequestInput,
  type HermitApproval,
  type PolicyDecision,
  type PolicyOutcome,
  type RiskClass,
  detectInjection,
  riskAtLeast,
} from "./types";

export interface PolicyEvaluationContext {
  actor: string;
  workspaceId: string;
  agentId?: string | null;
  agentKind?: string;
  action: string;
  target: string;
  args: Record<string, unknown>;
  risk: RiskClass;
  costUsd?: number;
  costLimitUsd?: number;
  preApproved?: boolean;
  approval?: HermitApproval | null;
  sandboxIsolated?: boolean;
  networkAllowed?: boolean;
}

/**
 * Computes the deterministic hash binding an approval to its exact action (spec §15).
 * If action parameters change materially after approval, this hash changes and the
 * approval is invalidated.
 */
export function computeActionHash(input: {
  action: string;
  target: string;
  args: Record<string, unknown>;
  artifactHash?: string | null;
  constraints?: string[];
}): string {
  return sha256Hex(
    canonicalJson({
      action: input.action,
      target: input.target,
      args: input.args,
      artifactHash: input.artifactHash ?? null,
      constraints: input.constraints ?? [],
    }),
  );
}

/** Redacts sensitive material from args before persisting in approval/audit rows. */
export function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = /token|secret|password|key|authorization|bearer|cookie/i;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (sensitiveKeys.test(k)) {
      out[k] = "[REDACTED]";
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = redactArgs(v as Record<string, unknown>);
    } else if (typeof v === "string" && v.length > 512) {
      out[k] = v.slice(0, 512) + "...[TRUNCATED]";
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Classify risk based on action kind and target when not explicitly supplied. */
export function inferRisk(action: string, args: Record<string, unknown> = {}): RiskClass {
  const a = action.toLowerCase();
  if (
    a.includes("destroy") ||
    a.includes("drop") ||
    a.includes("purge") ||
    a.includes("force_reset") ||
    a.includes("delete_all") ||
    a.includes("rm_rf")
  ) {
    return "R4";
  }
  if (
    a.includes("bulk_stop") ||
    a.includes("bulk_restart") ||
    a.includes("fleet.") ||
    a.includes("deploy") ||
    a.includes("send_message") ||
    a.includes("publish") ||
    a.includes("write_external") ||
    a.includes("external_side_effect")
  ) {
    return "R3";
  }
  if (
    a.includes("write") ||
    a.includes("update") ||
    a.includes("restart") ||
    a.includes("stop") ||
    a.includes("start") ||
    a.includes("create") ||
    a.includes("assign")
  ) {
    return "R2";
  }
  if (a.includes("read_sensitive") || a.includes("export") || a.includes("lease")) {
    return "R1";
  }
  return "R0";
}

/**
 * Pure, deterministic policy evaluation over an intended action (spec §13, §14).
 * Deny always wins.
 */
export function evaluatePolicy(ctx: PolicyEvaluationContext): PolicyDecision {
  // 1. Identity check
  if (!ctx.actor || ctx.actor.trim() === "") {
    return { outcome: "deny", ruleId: "id-empty-actor", reason: "actor identity is required" };
  }

  // 2. Workspace check
  if (!ctx.workspaceId || ctx.workspaceId.trim() === "") {
    return { outcome: "deny", ruleId: "ws-empty-workspace", reason: "workspace id is required" };
  }

  // 3. Prompt injection detection in args (spec §18)
  for (const [k, v] of Object.entries(ctx.args)) {
    if (typeof v === "string" && detectInjection(v)) {
      return {
        outcome: "deny",
        ruleId: "sec-prompt-injection-detected",
        reason: `untrusted instruction override pattern detected in argument '${k}'`,
      };
    }
  }

  // 4. Host filesystem & Docker socket escape defense (spec §9, §36)
  const argsString = JSON.stringify(ctx.args);
  if (
    argsString.includes("/var/run/docker.sock") ||
    argsString.includes("docker.sock") ||
    argsString.includes("/proc/") ||
    argsString.includes("/sys/")
  ) {
    return {
      outcome: "deny",
      ruleId: "sec-docker-socket-mount-denied",
      reason: "access to container engine socket or host control filesystem is strictly denied",
    };
  }
  if (
    ctx.args.privileged === true ||
    (typeof ctx.args.command === "string" && ctx.args.command.includes("--privileged"))
  ) {
    return {
      outcome: "deny",
      ruleId: "sec-privileged-container-denied",
      reason: "privileged container execution is strictly forbidden",
    };
  }

  // 5. Cost budget guard (spec §19)
  if (
    ctx.costLimitUsd !== undefined &&
    ctx.costUsd !== undefined &&
    ctx.costUsd >= ctx.costLimitUsd
  ) {
    return {
      outcome: "deny",
      ruleId: "budget-cost-exhausted",
      reason: `cost limit of $${ctx.costLimitUsd.toFixed(2)} reached (spent $${ctx.costUsd.toFixed(2)})`,
    };
  }

  // 6. Approval check for R3 / R4 actions (spec §15)
  if (riskAtLeast(ctx.risk, "R3")) {
    const expectedHash = computeActionHash({
      action: ctx.action,
      target: ctx.target,
      args: ctx.args,
    });

    if (!ctx.approval) {
      return {
        outcome: "require_approval",
        ruleId: `risk-${ctx.risk.toLowerCase()}-approval-required`,
        reason: `action has risk level ${ctx.risk}; explicit human approval is required`,
      };
    }

    if (ctx.approval.state !== "approved") {
      return {
        outcome: "deny",
        ruleId: "approval-not-approved",
        reason: `approval is in state '${ctx.approval.state}', not 'approved'`,
      };
    }

    if (ctx.approval.consumedAt != null) {
      return {
        outcome: "deny",
        ruleId: "approval-already-consumed",
        reason: "approval has already been consumed (single-use defense)",
      };
    }

    if (ctx.approval.expiresAt && new Date(ctx.approval.expiresAt).getTime() <= Date.now()) {
      return {
        outcome: "deny",
        ruleId: "approval-expired",
        reason: "approval has expired",
      };
    }

    if (ctx.approval.actionHash !== expectedHash) {
      return {
        outcome: "deny",
        ruleId: "approval-action-hash-mismatch",
        reason: "action parameters changed after approval was granted; approval invalidated",
      };
    }

    // Approval verified
    return {
      outcome: "allow",
      ruleId: "approval-verified",
      reason: `approved by ${ctx.approval.decidedBy ?? "operator"}`,
    };
  }

  // 7. R2 reversible write: allow with constraints
  if (ctx.risk === "R2") {
    return {
      outcome: "allow_with_constraints",
      ruleId: "r2-allow-constrained",
      reason: "reversible write permitted with audit and rollback capability",
      constraints: ["audit_trail_required", "workspace_scoped"],
    };
  }

  // 8. R1 / R0: auto allow
  return {
    outcome: "allow",
    ruleId: `risk-${ctx.risk.toLowerCase()}-allow`,
    reason: `risk level ${ctx.risk} read permitted by default`,
  };
}

/** Helper to construct an approval request record from evaluation input. */
export function buildApprovalRequest(
  input: ApprovalRequestInput,
  idGenerator: () => string,
): HermitApproval {
  const hash = computeActionHash({
    action: input.action,
    target: input.target,
    args: input.args,
    artifactHash: input.artifactHash,
    constraints: input.constraints,
  });
  const now = new Date();
  const ttl = input.ttlMs ?? 10 * 60_000;
  const expires = new Date(now.getTime() + ttl).toISOString();

  return {
    id: idGenerator(),
    agentId: input.agentId ?? null,
    operationId: input.operationId ?? null,
    action: input.action,
    target: input.target,
    actionHash: hash,
    argsRedactedJson: JSON.stringify(redactArgs(input.args)),
    risk: input.risk,
    ttlMs: ttl,
    expiresAt: expires,
    state: "pending",
    requestedBy: input.requestedBy,
    decidedBy: null,
    decidedAt: null,
    consumedAt: null,
    supersededBy: null,
    reason: null,
    createdAt: now.toISOString(),
  };
}
