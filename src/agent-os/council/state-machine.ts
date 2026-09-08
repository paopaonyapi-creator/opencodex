// Phase 20.4 — Council Run State Machine (spec section 131).
//
// Explicit transitions only. Failure branches (BLOCKED/FAILED/CANCELLED/
// RECOVERY_REQUIRED) are reachable from any live stage, but recovery back into
// the happy path is deliberately narrow.

import type { CouncilRunState } from "./types";

const VALID_TRANSITIONS: Record<CouncilRunState, CouncilRunState[]> = {
  CREATED: ["PLANNING", "CANCELLED", "FAILED"],
  PLANNING: ["SCHEDULING", "MERGE_READY", "COMPLETED", "FAILED", "CANCELLED", "RECOVERY_REQUIRED"],
  // PLAN_ONLY runs go PLANNING -> COMPLETED without touching git.
  SCHEDULING: ["EXECUTING", "FAILED", "CANCELLED", "RECOVERY_REQUIRED"],
  EXECUTING: [
    "EXECUTING",
    "REVIEWING",
    "VERIFYING",
    "INTEGRATING",
    "FAILED",
    "CANCELLED",
    "RECOVERY_REQUIRED",
  ],
  REVIEWING: [
    "EXECUTING",
    "VERIFYING",
    "REVIEWING",
    "INTEGRATING",
    "WAITING_APPROVAL",
    "FAILED",
    "CANCELLED",
    "RECOVERY_REQUIRED",
  ],
  VERIFYING: [
    "EXECUTING",
    "REVIEWING",
    "INTEGRATING",
    "FAILED",
    "CANCELLED",
    "RECOVERY_REQUIRED",
  ],
  INTEGRATING: [
    "FULL_VERIFY",
    "EXECUTING",
    "FAILED",
    "CANCELLED",
    "RECOVERY_REQUIRED",
  ],
  FULL_VERIFY: [
    "WAITING_APPROVAL",
    "MERGE_READY",
    "INTEGRATING",
    "EXECUTING",
    "FAILED",
    "CANCELLED",
    "RECOVERY_REQUIRED",
  ],
  WAITING_APPROVAL: [
    "MERGE_READY",
    "EXECUTING",
    "INTEGRATING",
    "FAILED",
    "CANCELLED",
    "RECOVERY_REQUIRED",
  ],
  // Spec section 178: a moved target branch can invalidate MERGE_READY.
  MERGE_READY: ["COMPLETED", "INTEGRATING", "FULL_VERIFY", "CANCELLED", "FAILED"],
  COMPLETED: [],
  FAILED: ["RECOVERY_REQUIRED", "CANCELLED"],
  CANCELLED: [],
  RECOVERY_REQUIRED: ["PLANNING", "SCHEDULING", "EXECUTING", "INTEGRATING", "CANCELLED", "FAILED"],
};

/** Stages from which no further scheduling should occur. */
const TERMINAL: ReadonlySet<CouncilRunState> = new Set<CouncilRunState>([
  "COMPLETED",
  "CANCELLED",
]);

export function isTerminalCouncilState(state: CouncilRunState): boolean {
  return TERMINAL.has(state);
}

export function canTransitionCouncil(from: CouncilRunState, to: CouncilRunState): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

export function allowedCouncilTransitions(from: CouncilRunState): CouncilRunState[] {
  return [...(VALID_TRANSITIONS[from] ?? [])];
}

export class CouncilTransitionError extends Error {
  constructor(
    readonly from: CouncilRunState,
    readonly to: CouncilRunState,
  ) {
    super(
      `Illegal council transition ${from} -> ${to}. Allowed: ${
        allowedCouncilTransitions(from).join(", ") || "(none, terminal)"
      }`,
    );
    this.name = "CouncilTransitionError";
  }
}

export function assertCouncilTransition(from: CouncilRunState, to: CouncilRunState): void {
  if (!canTransitionCouncil(from, to)) throw new CouncilTransitionError(from, to);
}
