/**
 * Pao AI Gateway — Bounded fallback controller (Phase 20.51).
 *
 * Executes a governed request across the ordered candidate routes with hard
 * limits: a maximum route attempts cap, a per-provider attempt cap, a total
 * request deadline, and a bounded backoff between attempts.
 *
 * Fallback eligibility is decided by the Phase 20.51 classifier, not by a
 * blind catch-and-retry: auth/permission/content failures stop the loop,
 * budget failures may only fall back to routes at most as expensive as the
 * failed one, and every skip, attempt, and stop is reported through the
 * attempt/event sinks so the decision ledger can reconstruct the whole trace.
 *
 * All state is local to one execution. Concurrent requests share nothing.
 */

import type { GatewayEventRecord, RouteAttemptRecord, FallbackLimits } from "../types";
import { classifyGatewayFailure, type FailureBehavior } from "../resilience/classifier";
import { costScore } from "./quota-router";
import type { ScoredRouteCandidate } from "./quota-router";

export interface FallbackGateResult {
  readonly allowed: boolean;
  readonly reasonCode?: string;
}

export interface GovernedExecutionCallbacks<R> {
  /** Execute one attempt. Throws on failure. */
  readonly executor: (candidate: ScoredRouteCandidate) => Promise<R>;
  /** Pre-attempt gate: open circuits, quarantine, operator disables. */
  readonly gate: (candidate: ScoredRouteCandidate) => FallbackGateResult;
  readonly onAttempt: (record: RouteAttemptRecord) => void;
  readonly onSkip: (candidate: ScoredRouteCandidate, reasonCode: string) => void;
  readonly onEvent: (event: GatewayEventRecord) => void;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface GovernedExecutionInput<R> {
  readonly requestId: string;
  readonly candidates: readonly ScoredRouteCandidate[];
  readonly policy: FallbackLimits;
  readonly callbacks: GovernedExecutionCallbacks<R>;
}

export interface GovernedExecutionResult<R> {
  readonly outcome: "success" | "failed" | "no_eligible_route" | "deadline_exceeded";
  readonly result?: R;
  readonly selected?: ScoredRouteCandidate;
  readonly attempts: readonly RouteAttemptRecord[];
  readonly failures: ReadonlyArray<{ candidate: ScoredRouteCandidate; behavior: FailureBehavior }>;
  readonly fallbackDepth: number;
}

export async function executeGoverned<R>(
  input: GovernedExecutionInput<R>,
): Promise<GovernedExecutionResult<R>> {
  const now = input.callbacks.now ?? (() => Date.now());
  const sleep = input.callbacks.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const { policy } = input;
  const deadlineAt = now() + policy.totalDeadlineMs;

  const attempts: RouteAttemptRecord[] = [];
  const failures: Array<{ candidate: ScoredRouteCandidate; behavior: FailureBehavior }> = [];
  const perProviderAttempts = new Map<string, number>();
  // Set when a budget_blocked failure occurs: remaining candidates must be at
  // most as expensive as the failed route (higher costScore = cheaper).
  let cheaperCostCeiling: number | undefined;

  let attemptNo = 0;
  let deadlineHit = false;

  for (const candidate of input.candidates) {
    if (attemptNo >= policy.maxRouteAttempts) break;
    if (now() >= deadlineAt) {
      deadlineHit = true;
      break;
    }

    if (cheaperCostCeiling !== undefined && costScore(candidate.model) < cheaperCostCeiling) {
      input.callbacks.onSkip(candidate, "ROUTE_REJECTED_BUDGET");
      continue;
    }

    const gate = input.callbacks.gate(candidate);
    if (!gate.allowed) {
      input.callbacks.onSkip(candidate, gate.reasonCode ?? "ROUTE_REJECTED_POLICY");
      continue;
    }

    const providerAttemptCount = perProviderAttempts.get(candidate.providerId) ?? 0;
    if (providerAttemptCount >= policy.maxSameProviderAttempts) {
      input.callbacks.onSkip(candidate, "FALLBACK_SAME_PROVIDER_CAP");
      continue;
    }

    attemptNo += 1;
    perProviderAttempts.set(candidate.providerId, providerAttemptCount + 1);
    const startedAt = new Date(now()).toISOString();
    const startMs = now();

    try {
      const result = await input.callbacks.executor(candidate);
      const record: RouteAttemptRecord = {
        requestId: input.requestId,
        attemptNo,
        providerId: candidate.providerId,
        modelId: candidate.modelId,
        startedAt,
        completedAt: new Date(now()).toISOString(),
        latencyMs: now() - startMs,
        outcome: "success",
      };
      attempts.push(record);
      input.callbacks.onAttempt(record);
      return {
        outcome: "success",
        result,
        selected: candidate,
        attempts,
        failures,
        fallbackDepth: attemptNo - 1,
      };
    } catch (error) {
      const behavior = classifyGatewayFailure({ error });
      const record: RouteAttemptRecord = {
        requestId: input.requestId,
        attemptNo,
        providerId: candidate.providerId,
        modelId: candidate.modelId,
        startedAt,
        completedAt: new Date(now()).toISOString(),
        latencyMs: now() - startMs,
        outcome: "failure",
        failureClass: behavior.failureClass,
        reasonCode: behavior.reasonCode,
      };
      attempts.push(record);
      input.callbacks.onAttempt(record);
      failures.push({ candidate, behavior });

      input.callbacks.onEvent({
        timestamp: new Date(now()).toISOString(),
        severity: "warning",
        eventType: "ROUTE_ATTEMPT_FAILED",
        providerId: candidate.providerId,
        modelId: candidate.modelId,
        reasonCode: behavior.reasonCode,
        details: { failureClass: behavior.failureClass, attemptNo },
      });

      if (!behavior.fallbackAllowed) {
        return {
          outcome: "failed",
          selected: candidate,
          attempts,
          failures,
          fallbackDepth: attemptNo - 1,
        };
      }
      if (behavior.cheaperFallbackOnly) {
        cheaperCostCeiling = costScore(candidate.model);
      }

      if (now() >= deadlineAt) {
        deadlineHit = true;
        break;
      }
      if (attemptNo < policy.maxRouteAttempts) {
        const backoff = policy.backoffMs[Math.min(attemptNo - 1, policy.backoffMs.length - 1)] ?? 0;
        if (backoff > 0 && now() + backoff < deadlineAt) {
          await sleep(backoff);
        }
      }
    }
  }

  return {
    outcome: attemptNo === 0 ? "no_eligible_route" : deadlineHit ? "deadline_exceeded" : "failed",
    attempts,
    failures,
    fallbackDepth: Math.max(0, attemptNo - 1),
  };
}
