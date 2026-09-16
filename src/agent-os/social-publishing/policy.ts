// Phase 20.60 — Social Publishing policy engine.
//
// Pure, deterministic rule functions (capability-lab `decidePublish`
// precedent). Every decision records the rule that produced it so denials are
// explainable (spec §13, §34 "Policy denials are explainable"). The unsafe
// automation families from spec §13.6 are structural: agents can only reach
// publishing through the controlled executor, which enforces policy +
// approval server-side regardless of what the caller claims.

import type {
  ApprovalMode,
  OpenPostInstanceConfig,
  PolicyDecision,
  PolicyRuleResult,
  Publication,
  Rendition,
  SocialAccount,
} from "./types";

function rule(effect: PolicyRuleResult["effect"], ruleId: string, reason: string): PolicyRuleResult {
  return { effect, ruleId, reason };
}

function combine(results: PolicyRuleResult[]): PolicyDecision {
  if (results.some((r) => r.effect === "deny")) return { effect: "deny", ruleResults: results };
  if (results.some((r) => r.effect === "require_approval")) return { effect: "require_approval", ruleResults: results };
  return { effect: "allow", ruleResults: results };
}

const READINESS_BLOCKING = new Set(["requires_reauth", "requires_scope", "requires_review", "disabled", "unsupported_format"]);

/**
 * Account + instance + destination rules (spec §13.1). Runs before any
 * dispatch or high-impact mutation.
 */
export function decideAccountEligibility(input: {
  account: SocialAccount;
  instance: Pick<OpenPostInstanceConfig, "status">;
}): PolicyDecision {
  const results: PolicyRuleResult[] = [];
  if (!input.account.enabled) {
    results.push(rule("deny", "social.account.disabled", "account is disabled in Pao-hubPro"));
  } else {
    results.push(rule("allow", "social.account.enabled", "account enabled"));
  }
  if (READINESS_BLOCKING.has(input.account.readinessState)) {
    results.push(rule("deny", "social.account.readiness", `account readiness is ${input.account.readinessState}`));
  } else if (input.account.readinessState === "unknown") {
    results.push(rule("deny", "social.account.readiness_unknown", "account readiness has never been synced; run capability sync first"));
  } else {
    results.push(rule("allow", "social.account.readiness", `account readiness is ${input.account.readinessState}`));
  }
  if (input.instance.status === "unavailable") {
    results.push(rule("deny", "social.instance.unavailable", "OpenPost instance is currently unavailable"));
  } else {
    results.push(rule("allow", "social.instance.status", `OpenPost instance status is ${input.instance.status}`));
  }
  return combine(results);
}

/**
 * Content rules (spec §13.2): required master fields, duplicate-publication
 * guard. Media-type checks live in the capability-driven rendition validator.
 */
export function decideContentEligibility(input: {
  publication: Pick<Publication, "masterTitle" | "masterCaption" | "masterDescription" | "assetIds">;
  hasRemoteAlready?: boolean;
}): PolicyDecision {
  const results: PolicyRuleResult[] = [];
  const hasText = Boolean((input.publication.masterCaption ?? "").trim() || (input.publication.masterDescription ?? "").trim());
  const hasTitle = Boolean((input.publication.masterTitle ?? "").trim());
  const hasMedia = input.publication.assetIds.length > 0;
  if (!hasText && !hasMedia && !hasTitle) {
    results.push(rule("deny", "social.content.empty", "publication has neither text nor media"));
  } else {
    results.push(rule("allow", "social.content.present", "publication carries content"));
  }
  if (input.hasRemoteAlready) {
    results.push(rule("deny", "social.content.duplicate", "an OpenPost publication already exists for this publication; use reconcile instead of re-creating"));
  } else {
    results.push(rule("allow", "social.content.no_duplicate", "no existing remote publication"));
  }
  return combine(results);
}

/**
 * Scheduling rules (spec §13.3): explicit timezone is enforced at the model
 * level; the timestamp itself must parse and not be unreasonably stale.
 */
export function decideScheduleTime(input: {
  scheduledAt: string;
  now?: Date;
  maxPastSkewMs?: number;
}): PolicyDecision {
  const now = input.now ?? new Date();
  const maxPastSkewMs = input.maxPastSkewMs ?? 5 * 60_000;
  const results: PolicyRuleResult[] = [];
  const when = new Date(input.scheduledAt);
  if (Number.isNaN(when.getTime())) {
    results.push(rule("deny", "social.schedule.invalid_time", "scheduledAt is not a parseable ISO-8601 timestamp"));
  } else if (when.getTime() < now.getTime() - maxPastSkewMs) {
    results.push(rule("deny", "social.schedule.past", "scheduledAt is unreasonably far in the past"));
  } else {
    results.push(rule("allow", "social.schedule.time_ok", "scheduledAt is a valid future timestamp"));
  }
  return combine(results);
}

/**
 * Approval rules (spec §13.4): every mutating operation is human-required by
 * default; publishing additionally needs a stored approval bound to the exact
 * content hash. The executor enforces this against persisted state — an
 * agent's claim that approval happened is never sufficient (spec §37.9).
 */
export function decideMutationApproval(input: {
  approvalMode: ApprovalMode;
  operation: "schedule" | "publish_now" | "cancel";
  hasValidApproval: boolean;
  approvedContentHash: string | null;
  currentContentHash: string;
}): PolicyDecision {
  const results: PolicyRuleResult[] = [];
  if (input.operation === "cancel") {
    results.push(rule("allow", "social.approval.cancel", "cancelling does not require prior approval"));
    return combine(results);
  }
  if (input.approvalMode !== "human_required") {
    // Only reachable if an operator changes config; default stays human_required.
    results.push(rule("allow", "social.approval.mode_override", `approval mode is ${input.approvalMode}`));
    return combine(results);
  }
  if (!input.hasValidApproval) {
    results.push(rule("require_approval", "social.approval.missing", `human approval is required before ${input.operation}`));
  } else if (input.approvedContentHash !== input.currentContentHash) {
    results.push(rule("deny", "social.approval.stale", "stored approval was bound to different content; request re-approval"));
  } else {
    results.push(rule("allow", "social.approval.valid", "stored human approval matches the current content hash"));
  }
  return combine(results);
}

/**
 * Delivery readiness rules: rendition must be validated and the account
 * capable of carrying it (checked again at dispatch time against the snapshot
 * taken at approval).
 */
export function decideRenditionDispatchability(input: { rendition: Pick<Rendition, "validationStatus" | "validationIssues" | "deliveryStatus"> }): PolicyDecision {
  const results: PolicyRuleResult[] = [];
  if (input.rendition.validationStatus === "invalid") {
    const first = input.rendition.validationIssues.find((i) => i.severity === "error");
    results.push(rule("deny", "social.rendition.invalid", first ? first.message : "rendition failed validation"));
  } else if (input.rendition.validationStatus === "unvalidated") {
    results.push(rule("deny", "social.rendition.unvalidated", "rendition must be validated before dispatch"));
  } else {
    results.push(rule("allow", "social.rendition.valid", "rendition passed validation"));
  }
  return combine(results);
}
