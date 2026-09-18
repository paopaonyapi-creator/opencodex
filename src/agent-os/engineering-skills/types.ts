// Phase 20.91b — Pao-hubPro × Addy Osmani Agent Skills: Engineering Skill Runtime
// domain types. (Proposed renumber 20.93 — open collision with 20.91a Apra Fleet,
// pending user decision; runtime content is independent of the phase number.)
//
// Core law (source §46): external skill packs are INSTRUCTIONS, not authorities.
// A skill may request capabilities; only Pao-hubPro grants them. No "done" claim
// without verifiable evidence — an LLM statement is never sufficient by itself.

/** Lifecycle stage in the canonical engineering workflow (source §9). */
export type LifecycleStage =
  | "intake"
  | "define"
  | "plan"
  | "build"
  | "verify"
  | "review"
  | "ship"
  | "observe";

/** Canonical workflow states (10) + exceptional states (6), source §9. */
export type WorkflowStatus =
  | "INTAKE"
  | "DEFINE"
  | "PLAN"
  | "BUILD"
  | "VERIFY"
  | "REVIEW"
  | "READY_TO_SHIP"
  | "SHIP"
  | "OBSERVE"
  | "DONE"
  | "BLOCKED"
  | "NEEDS_HUMAN"
  | "FAILED_VERIFICATION"
  | "FAILED_REVIEW"
  | "ROLLBACK_REQUIRED"
  | "CANCELLED";

/** Pack lifecycle — quarantine-first; nothing reaches ACTIVE without evals. */
export type PackLifecycleStatus = "QUARANTINED" | "CANDIDATE" | "ACTIVE" | "ROLLED_BACK";

/** Risk classes (source §18) mapped onto the Pao R0–R4 gate. */
export type RiskLevel = "low" | "medium" | "high" | "critical";

/** Reviewer verdicts (source §16). */
export type ReviewVerdict = "pass" | "pass_with_notes" | "changes_required" | "blocked";

/** The four independent specialist lanes (source §15). */
export type ReviewerType = "code_reviewer" | "test_engineer" | "security_auditor" | "webperf_auditor";

/** Evidence types (source §14.2). */
export type EvidenceType =
  | "test_result"
  | "build_result"
  | "lint_result"
  | "typecheck_result"
  | "browser_runtime"
  | "network_trace"
  | "console_log"
  | "screenshot"
  | "diff"
  | "security_scan"
  | "review_verdict"
  | "deployment_result"
  | "health_check"
  | "artifact_exists";

/** Permission classes (source §17.1) — deny-by-default for third-party packs. */
export type PermissionClass =
  | "filesystem.read"
  | "filesystem.write"
  | "shell.execute"
  | "network.outbound"
  | "browser.control"
  | "secrets.use"
  | "git.write"
  | "deployment.execute";

export type PermissionTier =
  | "denied"
  | "docs_only"
  | "selected"
  | "project"
  | "safe_allowlist"
  | "guarded"
  | "unrestricted"
  | "allowlist"
  | "isolated"
  | "borrowed_tab"
  | "privileged_session"
  | "scoped_reference"
  | "injected_runtime_only"
  | "read"
  | "branch_write"
  | "commit"
  | "push"
  | "merge"
  | "staging"
  | "production_with_approval";

/** Policy decisions — the source's native enum, shared with the 20.89 policy vocabulary. */
export type PolicyDecision = "ALLOW" | "DENY" | "REQUIRE_APPROVAL" | "QUARANTINE";

/** Machine-checkable error codes (operator-actionable, never generic). */
export type EngineeringSkillsErrorCode =
  | "PACK_NOT_FOUND"
  | "SKILL_NOT_FOUND"
  | "WORKFLOW_NOT_FOUND"
  | "PACK_QUARANTINED"
  | "PACK_NOT_ACTIVE"
  | "COMMIT_PIN_REQUIRED"
  | "INTEGRITY_MISMATCH"
  | "INVALID_TRANSITION"
  | "EVIDENCE_REQUIRED"
  | "EVIDENCE_REJECTED"
  | "REVIEW_BLOCKED"
  | "APPROVAL_REQUIRED"
  | "STOP_CONDITION"
  | "PERMISSION_DENIED"
  | "MALICIOUS_CONTENT_DETECTED"
  | "CAPABILITY_EXPANSION_DETECTED"
  | "ROUTE_FAILED";

export class EngineeringSkillsError extends Error {
  readonly code: EngineeringSkillsErrorCode;
  readonly httpStatus: number;
  readonly detail: Record<string, unknown>;

  constructor(code: EngineeringSkillsErrorCode, httpStatus: number, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "EngineeringSkillsError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.detail = detail ?? {};
  }
}

/** Audit event vocabulary (source §19 hooks, condensed to persisted event types). */
export type EngineeringSkillsAuditEvent =
  | "skill.pack.imported"
  | "skill.pack.quarantined"
  | "skill.pack.validated"
  | "skill.pack.promoted"
  | "skill.pack.rollback"
  | "skill.pack.disabled"
  | "skill.route.completed"
  | "skill.route.rejected"
  | "workflow.started"
  | "workflow.stage.enter"
  | "workflow.stage.exit"
  | "workflow.step.blocked"
  | "tool.permission.denied"
  | "evidence.created"
  | "evidence.rejected"
  | "review.completed"
  | "review.blocked"
  | "policy.evaluated"
  | "approval.granted"
  | "approval.denied"
  | "ship.completed"
  | "ship.failed"
  | "rollback.started";

/** Feature flags (source §28) — env-overridable, safe defaults. */
export interface EngineeringSkillsFlags {
  phaseEnabled: boolean;
  externalPacksEnabled: boolean;
  routerEnabled: boolean;
  evidenceGatesEnabled: boolean;
  reviewerCouncilEnabled: boolean;
  /** Statically false by policy: pack updates never auto-promote. */
  skillPackAutoUpdate: false;
}

export function readEngineeringSkillsFlags(env: Record<string, string | undefined> = process.env as never): EngineeringSkillsFlags {
  const on = (v: string | undefined, dflt: boolean) => (v === undefined ? dflt : v === "1" || v === "true");
  return {
    phaseEnabled: on(env.PAO_PHASE_20_91_ENABLED, true),
    externalPacksEnabled: on(env.PAO_EXTERNAL_SKILL_PACKS_ENABLED, true),
    routerEnabled: on(env.PAO_ENGINEERING_SKILL_ROUTER_ENABLED, true),
    evidenceGatesEnabled: on(env.PAO_EVIDENCE_GATES_ENABLED, true),
    reviewerCouncilEnabled: on(env.PAO_REVIEWER_COUNCIL_ENABLED, true),
    skillPackAutoUpdate: false,
  };
}

/** Normalized skill record (source §8) — every pack's frontmatter normalizes to this. */
export interface NormalizedSkill {
  id: string;
  packId: string;
  slug: string;
  name: string;
  description: string;
  lifecycleStages: LifecycleStage[];
  triggers: { intents: string[]; keywords: string[] };
  declaredCapabilities: string[];
  inferredCapabilities: string[];
  permissions: Partial<Record<PermissionClass, PermissionTier>>;
  riskLevel: RiskLevel;
  entrypoint: string;
  references: string[];
  compatibleProviders: string[];
  verificationRules: string[];
  reviewRequired: boolean;
  sourceHash: string;
  trusted: boolean;
  enabled: boolean;
}

/** Routing explanation — the router must always be debuggable (source §30.2). */
export interface RouteExplanation {
  intent: string;
  risk: RiskLevel;
  selected: Array<{ slug: string; packId: string; stage: LifecycleStage; reason: string }>;
  rejected: Array<{ slug: string; reason: string }>;
  stagesCovered: LifecycleStage[];
}

/** Anti-rationalization reply (source §13.2): the missing gate, not a generic error. */
export interface SkipRequestReply {
  event: "workflow_step_skip_requested";
  step: string;
  reason: string;
  policy_decision: "deny";
  required_evidence: EvidenceType[];
  message: string;
}
