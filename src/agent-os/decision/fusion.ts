/**
 * Phase 20.84 — 10-Stage Policy Fusion Engine
 * Reconciles machine-native probabilistic recommendations with deterministic security policies.
 * Invariant: Provider confidence is never permission. Hard policy strictly outranks probability.
 */

import type { DecisionDisposition, DecisionResult } from "./types";
import type { ThresholdProfile } from "./calibration";

export interface AuthorizationContext {
  contractId: string;
  candidateChoice: string;
  confidence: number;
  thresholdProfile: ThresholdProfile;
  hardDenied: boolean;
  hardDenyReasons: string[];
  requiresHumanApproval: boolean;
  humanApproved: boolean;
  calibrationTrusted: boolean;
  withinScope: boolean;
  sandboxValid: boolean;
}

export interface AuthorizationDecision {
  disposition: DecisionDisposition;
  reason: string;
  stage: number;
  authorized: boolean;
}

export class PolicyFusionEngine {
  /**
   * Evaluates authorization across 10 deterministic precedence stages.
   */
  public static authorize(ctx: AuthorizationContext): AuthorizationDecision {
    // Stage 1: Hard Deny Rules (Global denylists, banned primitives)
    if (ctx.hardDenied) {
      return {
        disposition: "deny",
        reason: `Hard policy denied: ${ctx.hardDenyReasons.join("; ")}`,
        stage: 1,
        authorized: false,
      };
    }

    // Stage 2: Mandatory Approval Policies (Destructive or Privileged operations)
    if (ctx.requiresHumanApproval && !ctx.humanApproved) {
      return {
        disposition: "review",
        reason: "Mandatory human approval required for this risk tier.",
        stage: 2,
        authorized: false,
      };
    }

    // Stage 3: Scope Validation
    if (!ctx.withinScope) {
      return {
        disposition: "deny",
        reason: "Action attempts to operate outside declared workspace scope.",
        stage: 3,
        authorized: false,
      };
    }

    // Stage 4: Sandbox Constraints
    if (!ctx.sandboxValid) {
      return {
        disposition: "deny",
        reason: "Sandbox isolation constraints violated.",
        stage: 4,
        authorized: false,
      };
    }

    // Stage 5: Local Calibration Status
    if (!ctx.calibrationTrusted) {
      return {
        disposition: "review",
        reason: "Decision model calibration is untrusted (high ECE drift); escalating to review.",
        stage: 5,
        authorized: false,
      };
    }

    // Stage 6: Explicit User Approval Grant (Satisfies human review requirement)
    if (ctx.humanApproved) {
      return {
        disposition: "allow",
        reason: "Authorized by explicit user approval grant.",
        stage: 6,
        authorized: true,
      };
    }

    // Stage 7: Hard Approval Profile Override
    if (ctx.thresholdProfile.humanApprovalAlways) {
      return {
        disposition: "review",
        reason: `Threshold profile '${ctx.thresholdProfile.name}' enforces human review for all actions.`,
        stage: 7,
        authorized: false,
      };
    }

    // Stage 8: Confidence below Review threshold -> Abstain/Review
    if (ctx.confidence < ctx.thresholdProfile.minConfidenceReview) {
      return {
        disposition: "abstain",
        reason: `Confidence (${ctx.confidence.toFixed(2)}) is below review threshold (${ctx.thresholdProfile.minConfidenceReview.toFixed(2)}).`,
        stage: 8,
        authorized: false,
      };
    }

    // Stage 9: Confidence between Review and Allow threshold -> Review
    if (ctx.confidence < ctx.thresholdProfile.minConfidenceAllow) {
      return {
        disposition: "review",
        reason: `Confidence (${ctx.confidence.toFixed(2)}) is below allow threshold (${ctx.thresholdProfile.minConfidenceAllow.toFixed(2)}).`,
        stage: 9,
        authorized: false,
      };
    }

    // Stage 10: Final Autonomous Execution
    return {
      disposition: "allow",
      reason: `Calibrated high confidence (${ctx.confidence.toFixed(2)}) satisfies all hard policy stages.`,
      stage: 10,
      authorized: true,
    };
  }
}
