// Phase 20.3 — Desktop Agent State Machines
//
// Validated state transitions for DesktopSession and DesktopGoal.
// Every transition is guarded and logged. Invalid transitions throw.

import type { SessionStatus, GoalStatus } from "./types";

// ─── Session State Machine ──────────────────────────────────────────

const SESSION_TRANSITIONS: Record<SessionStatus, readonly SessionStatus[]> = {
  CREATED:           ["STARTING"],
  STARTING:          ["RUNNING", "FAILED"],
  RUNNING:           ["PAUSED", "WAITING_APPROVAL", "BLOCKED", "STOPPING", "FAILED", "COMPLETED", "EMERGENCY_STOPPED"],
  PAUSED:            ["RUNNING", "STOPPING", "EMERGENCY_STOPPED"],
  WAITING_APPROVAL:  ["RUNNING", "PAUSED", "STOPPING", "EMERGENCY_STOPPED"],
  BLOCKED:           ["RUNNING", "PAUSED", "STOPPING", "FAILED", "EMERGENCY_STOPPED"],
  STOPPING:          ["STOPPED", "FAILED"],
  STOPPED:           [],
  FAILED:            [],
  COMPLETED:         [],
  EMERGENCY_STOPPED: [],
} as const;

export function validateSessionTransition(from: SessionStatus, to: SessionStatus): boolean {
  const allowed = SESSION_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

export function transitionSession(from: SessionStatus, to: SessionStatus): SessionStatus {
  if (!validateSessionTransition(from, to)) {
    throw new Error(`Invalid session transition: ${from} → ${to}`);
  }
  return to;
}

export function isSessionTerminal(status: SessionStatus): boolean {
  return status === "STOPPED" || status === "FAILED" || status === "COMPLETED" || status === "EMERGENCY_STOPPED";
}

export function isSessionActive(status: SessionStatus): boolean {
  return status === "RUNNING" || status === "PAUSED" || status === "WAITING_APPROVAL" || status === "BLOCKED";
}

// ─── Goal State Machine ────────────────────────────────────────────

const GOAL_TRANSITIONS: Record<GoalStatus, readonly GoalStatus[]> = {
  PENDING:           ["READY", "CANCELLED"],
  READY:             ["RUNNING", "CANCELLED"],
  RUNNING:           ["VERIFYING", "WAITING_APPROVAL", "SUCCEEDED", "FAILED", "BLOCKED", "CANCELLED"],
  VERIFYING:         ["SUCCEEDED", "FAILED", "RUNNING"],
  WAITING_APPROVAL:  ["RUNNING", "CANCELLED", "FAILED"],
  SUCCEEDED:         [],
  FAILED:            [],
  BLOCKED:           ["RUNNING", "CANCELLED", "FAILED"],
  CANCELLED:         [],
} as const;

export function validateGoalTransition(from: GoalStatus, to: GoalStatus): boolean {
  const allowed = GOAL_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

export function transitionGoal(from: GoalStatus, to: GoalStatus): GoalStatus {
  if (!validateGoalTransition(from, to)) {
    throw new Error(`Invalid goal transition: ${from} → ${to}`);
  }
  return to;
}

export function isGoalTerminal(status: GoalStatus): boolean {
  return status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED";
}

export function isGoalActive(status: GoalStatus): boolean {
  return status === "RUNNING" || status === "VERIFYING" || status === "WAITING_APPROVAL" || status === "BLOCKED";
}

// ─── Skill Run State Machine ───────────────────────────────────────

export type SkillRunStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";

const SKILL_RUN_TRANSITIONS: Record<SkillRunStatus, readonly SkillRunStatus[]> = {
  PENDING:   ["RUNNING", "CANCELLED"],
  RUNNING:   ["SUCCEEDED", "FAILED", "CANCELLED"],
  SUCCEEDED: [],
  FAILED:    [],
  CANCELLED: [],
} as const;

export function validateSkillRunTransition(from: SkillRunStatus, to: SkillRunStatus): boolean {
  const allowed = SKILL_RUN_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

export function transitionSkillRun(from: SkillRunStatus, to: SkillRunStatus): SkillRunStatus {
  if (!validateSkillRunTransition(from, to)) {
    throw new Error(`Invalid skill run transition: ${from} → ${to}`);
  }
  return to;
}
