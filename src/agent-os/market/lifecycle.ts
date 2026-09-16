/**
 * Pao Market Signal Control Plane — signal lifecycle state machine.
 *
 * Arbitrary status jumps are rejected. Every transition is explicit and the
 * allowed-transition map below is the single authority (spec §11).
 */

import type { SignalStatus } from "./types";

const TRANSITIONS: Readonly<Record<SignalStatus, readonly SignalStatus[]>> = {
  RECEIVED: ["VERIFYING"],
  VERIFYING: ["VERIFIED", "FAILED_VERIFICATION"],
  FAILED_VERIFICATION: [],
  VERIFIED: ["NORMALIZED", "DUPLICATE"],
  DUPLICATE: [],
  NORMALIZED: ["ANALYZING"],
  ANALYZING: ["ANALYZED", "ANALYSIS_FAILED"],
  ANALYSIS_FAILED: [],
  ANALYZED: ["RISK_CHECK"],
  RISK_CHECK: ["PROPOSAL_READY", "RISK_REJECTED"],
  RISK_REJECTED: [],
  PROPOSAL_READY: ["AWAITING_APPROVAL"],
  AWAITING_APPROVAL: ["APPROVED", "REJECTED", "EXPIRED"],
  REJECTED: [],
  EXPIRED: [],
  APPROVED: ["PAPER_EXECUTION_PENDING"],
  PAPER_EXECUTION_PENDING: ["PAPER_EXECUTED"],
  PAPER_EXECUTED: ["CLOSED"],
  CLOSED: [],
};

export function canTransition(from: SignalStatus, to: SignalStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Throwing variant used by the pipeline; callers convert to 409-class errors. */
export function requireTransition(from: SignalStatus, to: SignalStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`MARKET_LIFECYCLE_INVALID_TRANSITION: ${from} -> ${to}`);
  }
}

export function lifecycleSuccessors(from: SignalStatus): readonly SignalStatus[] {
  return TRANSITIONS[from] ?? [];
}
