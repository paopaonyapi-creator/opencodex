// Phase 20.2 — SDLC Cycle State Machine
//
// Governs explicit stage progression and failure / control transitions.

import type { CycleState } from "./types";

const VALID_TRANSITIONS: Record<CycleState, CycleState[]> = {
  DRAFT: ["SPECIFYING", "CANCELLED", "PAUSED"],
  IDEA: ["SPECIFYING", "CANCELLED", "PAUSED"],
  SPECIFYING: ["SPECIFIED", "BLOCKED", "FAILED", "PAUSED", "CANCELLED"],
  SPECIFIED: ["CLARIFYING", "PLANNING", "PAUSED", "CANCELLED"],
  CLARIFYING: ["CLARIFIED", "BLOCKED", "APPROVAL_REQUIRED", "PAUSED", "CANCELLED"],
  CLARIFIED: ["PLANNING", "SPECIFYING", "PAUSED", "CANCELLED"],
  PLANNING: ["PLANNED", "BLOCKED", "FAILED", "PAUSED", "CANCELLED"],
  PLANNED: ["TASKING", "PLANNING", "PAUSED", "CANCELLED"],
  TASKING: ["TASKED", "BLOCKED", "FAILED", "PAUSED", "CANCELLED"],
  TASKED: ["ANALYZING", "TASKING", "PAUSED", "CANCELLED"],
  ANALYZING: ["ANALYZED", "READY_FOR_DEV", "READY_FOR_IMPLEMENTATION", "BLOCKED", "REWORK_REQUIRED", "PAUSED", "CANCELLED"],
  ANALYZED: ["READY_FOR_DEV", "READY_FOR_IMPLEMENTATION", "PLANNING", "TASKING", "PAUSED", "CANCELLED"],
  READY_FOR_DEV: ["IMPLEMENTING", "APPROVAL_REQUIRED", "PAUSED", "CANCELLED"],
  READY_FOR_IMPLEMENTATION: ["IMPLEMENTING", "APPROVAL_REQUIRED", "PAUSED", "CANCELLED"],
  IMPLEMENTING: ["IMPLEMENTED", "VERIFYING", "APPROVAL_REQUIRED", "FAILED", "PAUSED", "CANCELLED", "REWORK_REQUIRED"],
  IMPLEMENTED: ["VERIFYING", "REVIEWING", "FAILED", "PAUSED", "CANCELLED"],
  VERIFYING: ["VERIFIED", "REVIEWING", "IMPLEMENTING", "FAILED", "REWORK_REQUIRED", "PAUSED", "CANCELLED"],
  VERIFIED: ["REVIEWING", "CONVERGING", "FAILED", "PAUSED", "CANCELLED"],
  REVIEWING: ["REVIEWED", "CONVERGING", "REWORK_REQUIRED", "APPROVAL_REQUIRED", "FAILED", "PAUSED", "CANCELLED"],
  REVIEWED: ["CONVERGING", "REWORK_REQUIRED", "APPROVAL_REQUIRED", "FAILED", "PAUSED", "CANCELLED"],
  CONVERGING: ["CONVERGED", "READY_FOR_STAGING", "CLOSED", "REWORK_REQUIRED", "FAILED", "PAUSED", "CANCELLED"],
  CONVERGED: ["READY_FOR_STAGING", "CLOSED", "REWORK_REQUIRED", "CANCELLED"],
  READY_FOR_STAGING: ["STAGING", "ROLLBACK_REQUIRED", "PAUSED", "CANCELLED"],
  STAGING: ["READY_FOR_DEPLOYMENT", "ROLLBACK_REQUIRED", "FAILED", "PAUSED"],
  READY_FOR_DEPLOYMENT: ["DEPLOYED", "APPROVAL_REQUIRED", "ROLLBACK_REQUIRED", "PAUSED"],
  DEPLOYED: ["OPERATING", "ROLLBACK_REQUIRED", "CLOSED"],
  OPERATING: ["CLOSED", "ROLLBACK_REQUIRED"],
  CLOSED: [],

  // Control / Failure States
  BLOCKED: ["DRAFT", "IDEA", "SPECIFYING", "CLARIFYING", "PLANNING", "TASKING", "IMPLEMENTING", "CANCELLED"],
  PAUSED: [
    "DRAFT", "IDEA", "SPECIFYING", "SPECIFIED", "CLARIFYING", "CLARIFIED",
    "PLANNING", "PLANNED", "TASKING", "TASKED", "ANALYZING", "ANALYZED",
    "READY_FOR_DEV", "READY_FOR_IMPLEMENTATION", "IMPLEMENTING", "IMPLEMENTED", "VERIFYING", "VERIFIED", "REVIEWING", "REVIEWED",
    "CONVERGING", "CONVERGED", "CANCELLED",
  ],
  CANCELLED: [],
  FAILED: ["DRAFT", "IDEA", "REWORK_REQUIRED", "PLANNING", "IMPLEMENTING", "CANCELLED"],
  REWORK_REQUIRED: ["PLANNING", "TASKING", "IMPLEMENTING", "CANCELLED"],
  APPROVAL_REQUIRED: ["IMPLEMENTING", "CONVERGING", "DEPLOYED", "BLOCKED", "REWORK_REQUIRED", "CANCELLED"],
  ROLLBACK_REQUIRED: ["ROLLED_BACK", "FAILED"],
  ROLLED_BACK: ["CLOSED", "REWORK_REQUIRED"],
};

export class SdlcStateMachine {
  static canTransition(current: CycleState, target: CycleState): boolean {
    if (current === target) return true;
    const allowed = VALID_TRANSITIONS[current] ?? [];
    return allowed.includes(target);
  }

  static assertTransition(current: CycleState, target: CycleState): void {
    if (!this.canTransition(current, target)) {
      throw new Error(`Illegal SDLC transition from state '${current}' to '${target}'`);
    }
  }

  static isTerminal(state: CycleState): boolean {
    return state === "CLOSED" || state === "CANCELLED" || state === "ROLLED_BACK";
  }

  static isPausedOrBlocked(state: CycleState): boolean {
    return state === "PAUSED" || state === "BLOCKED" || state === "APPROVAL_REQUIRED";
  }
}

export function isValidTransition(current: CycleState, target: CycleState): boolean {
  return SdlcStateMachine.canTransition(current, target);
}

export function assertValidTransition(current: CycleState, target: CycleState): void {
  SdlcStateMachine.assertTransition(current, target);
}

export function transitionCycleState(cycleId: string, targetState: CycleState, stage?: string): boolean {
  const { openAgentOsDb } = require("../db");
  const db = openAgentOsDb();
  const row = db.query("SELECT status FROM sdlc_cycles WHERE id = ?").get(cycleId) as { status: CycleState } | undefined;
  if (!row) throw new Error(`Cycle ${cycleId} not found`);

  assertValidTransition(row.status, targetState);
  const now = new Date().toISOString();
  if (stage) {
    db.query("UPDATE sdlc_cycles SET status = ?, current_stage = ?, updated_at = ? WHERE id = ?").run(targetState, stage, now, cycleId);
  } else {
    db.query("UPDATE sdlc_cycles SET status = ?, updated_at = ? WHERE id = ?").run(targetState, now, cycleId);
  }
  return true;
}
