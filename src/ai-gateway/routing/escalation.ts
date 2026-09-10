/**
 * Pao AI Gateway — escalation ladder.
 *
 * The ladder is consulted only after an attempt FAILS, and its rules exist to stop
 * four specific mistakes:
 *
 *   1. Retrying a request that cannot succeed (auth, policy, budget). Those are
 *      non-escalating by construction.
 *   2. Escalating past a privacy boundary. A private request may not climb onto a
 *      public route, however badly it failed. This is the rule most likely to be
 *      "simplified" away, and it is the one that leaks.
 *   3. Climbing forever. The count is bounded by policy and by the ladder length.
 *   4. Escalating on a transient blip. A single timeout on a healthy provider
 *      retries the SAME rung before moving up, because escalation costs quality
 *      budget that a retry does not.
 */

import type { GatewayConfig } from "../types";
import type { Classification } from "./adaptive";

/**
 * Failure codes that make escalation pointless. An auth failure, a policy denial,
 * or an exhausted budget will fail identically one rung higher — escalating them
 * only spends money and time, and for auth it risks a lockout.
 */
const NON_ESCALATABLE: ReadonlySet<string> = new Set([
  "auth_failure",
  "policy_denial",
  "budget_denial",
  "secret_leakage_block",
  "prompt_injection_block",
  "local_only_violation",
  "guardrail_failure",
  "context_overflow",
]);

/** Codes where retrying the SAME rung is worthwhile before climbing. */
const RETRY_SAME_RUNG: ReadonlySet<string> = new Set([
  "provider_timeout",
  "provider_unreachable",
  "provider_5xx",
  "malformed_response",
  "tool_call_failure",
  "structured_output_failure",
]);

/** Codes that are a property of the model, so retrying it is wasted effort. */
const ESCALATE_IMMEDIATELY: ReadonlySet<string> = new Set([
  "capability_mismatch",
  "insufficient_quality",
  "evaluator_failure",
  "review_failed",
]);

export interface EscalationInput {
  readonly classification: Classification;
  readonly currentAlias: string;
  readonly failureCode: string;
  readonly attemptsOnCurrentAlias: number;
  readonly totalEscalations: number;
  readonly config: GatewayConfig;
}

export interface EscalationDecision {
  readonly action: "retry_same" | "escalate" | "stop";
  readonly nextAlias: string | null;
  readonly reason: string;
  /** True when the caller must surface this to a human rather than continue. */
  readonly requiresHuman: boolean;
}

export function decideEscalation(input: EscalationInput): EscalationDecision {
  const { classification, currentAlias, failureCode, attemptsOnCurrentAlias, totalEscalations } = input;

  // 1. Non-escalatable failures stop the request. Surfacing them is the correct
  //    outcome: an operator needs to fix a credential or a budget, not watch the
  //    router spend more money failing.
  if (NON_ESCALATABLE.has(failureCode)) {
    return {
      action: "stop",
      nextAlias: null,
      reason: `Failure '${failureCode}' cannot be resolved by routing; it needs a configuration or policy fix.`,
      requiresHuman: true,
    };
  }

  // 2. Bounded retry on the same rung before paying to escalate.
  if (RETRY_SAME_RUNG.has(failureCode) && attemptsOnCurrentAlias < 2) {
    return {
      action: "retry_same",
      nextAlias: currentAlias,
      reason: `'${failureCode}' is transient; retrying ${currentAlias} before escalating.`,
      requiresHuman: false,
    };
  }

  // 3. Escalation budget. The bound is the policy's, and the ladder is walked in
  //    order so the next rung is never a jump straight to premium.
  const maxEscalations = maxEscalationsFor(input.config, classification.agentId);
  if (totalEscalations >= maxEscalations) {
    return {
      action: "stop",
      nextAlias: null,
      reason: `Escalation budget exhausted (${totalEscalations}/${maxEscalations}); stopping rather than climbing further.`,
      requiresHuman: true,
    };
  }

  // 4. Privacy floor. A restricted request has a one-entry ladder by construction,
  //    so this is a defence-in-depth assertion rather than the primary control.
  if (classification.sensitivity === "restricted") {
    return {
      action: "stop",
      nextAlias: null,
      reason: "Restricted task may not leave the local route; escalation is refused.",
      requiresHuman: true,
    };
  }

  const ladder = classification.ladder;
  const index = ladder.indexOf(currentAlias);
  if (index === ladder.length - 1) {
    return {
      action: "stop",
      nextAlias: null,
      reason: `No rung above ${currentAlias} in the ladder; stopping.`,
      requiresHuman: true,
    };
  }

  // The current alias is not a rung of the ladder.
  //
  // This happens when an explicit caller preference or a capability failure moved
  // the request off the ladder entirely, and it is exactly the case where STOPPING
  // would be wrong: a capability mismatch on a fixed alias is precisely what
  // escalation exists to fix. The ladder's first rung is the right target, because
  // it is the rung the classifier would have chosen had the request started there.
  if (index === -1) {
    const fallbackAlias = ladder[0];
    if (!fallbackAlias) {
      return {
        action: "stop",
        nextAlias: null,
        reason: "Ladder is empty; nothing to escalate to.",
        requiresHuman: true,
      };
    }
    return {
      action: "escalate",
      nextAlias: fallbackAlias,
      reason: `${currentAlias} is not on the ladder; escalating to the ladder's first rung ${fallbackAlias} after '${failureCode}'.`,
      requiresHuman: false,
    };
  }

  const nextAlias = ladder[index + 1]!;

  // A capability failure means the model could not do the job at all; a quality
  // failure means it could but badly. The ladder handles both the same way, but
  // the reason differs so the trace is diagnosable.
  const why = ESCALATE_IMMEDIATELY.has(failureCode)
    ? `'${failureCode}' is a property of ${currentAlias}; escalating to ${nextAlias}.`
    : `Escalating ${currentAlias} -> ${nextAlias} after '${failureCode}'.`;

  return { action: "escalate", nextAlias, reason: why, requiresHuman: false };
}

/**
 * Per-agent escalation bound, from policy, with a global fallback.
 *
 * The name `max_escalations` is what the environment exposes; a policy file can
 * lower it per agent, and nothing can raise it above the environment ceiling.
 */
function maxEscalationsFor(config: GatewayConfig, agentId: string): number {
  const global = config.maxEscalations ?? 2;
  const policy = config.identities.find((identity) => identity.id === agentId);
  const perAgent = (policy as { maxEscalations?: number } | undefined)?.maxEscalations;
  if (typeof perAgent === "number" && perAgent >= 0) return Math.min(perAgent, global);
  return global;
}
