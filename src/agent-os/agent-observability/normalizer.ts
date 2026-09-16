// Phase 20.40 — Evidence normalizer / state engine (spec §8, §18, §19).
// Five INDEPENDENT state planes derived from explicit evidence:
//   activity   — observed recency only (mtime alone counts, at low weight)
//   process    — advisory OS/registry evidence; missing PID ≠ stopped
//   execution  — direct event evidence only; uncertain → unknown
//   health     — independent of activity; stall needs a strong evidence
//                combination, inactivity alone NEVER implies completed
//   confidence — transparent additive weights, clamped [0,1], factors shown

import type {
  ActivityState,
  AgentSession,
  ConfidenceFactor,
  EvidenceRecord,
  ExecutionState,
  HealthState,
  NormalizedAgentEvent,
  ObservabilityConfig,
  ProcessState,
  SessionObservationError,
} from "./types";

export interface DeriveInput {
  nowMs: number;
  config: ObservabilityConfig;
  lastRecordedEventAt: string | null;
  lastFileModifiedAt: string | null;
  explicitEndedAt: string | null;
  latestEvent: NormalizedAgentEvent | null;
  waitingUserHint: boolean;
  executionHint: ExecutionState | null;
  hasMalformedRecords: boolean;
  errors: SessionObservationError[];
  processMatchConfidence: number;
  processExactMatch: boolean;
}

export interface DerivedStates {
  activityState: ActivityState;
  processState: ProcessState;
  executionState: ExecutionState;
  healthState: HealthState;
  confidence: number;
  confidenceFactors: ConfidenceFactor[];
  evidence: EvidenceRecord[];
}

function ageMs(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  // Future timestamps clamp to zero age (spec §44).
  return Math.max(0, nowMs - parsed);
}

export function deriveActivity(recencyIso: string | null, config: ObservabilityConfig, nowMs: number): { state: ActivityState; age: number | null } {
  const age = ageMs(recencyIso, nowMs);
  if (age === null) return { state: "unknown", age: null };
  if (age < config.thresholds.activeMs) return { state: "active", age };
  if (age < config.thresholds.recentMs) return { state: "recent", age };
  if (age < config.thresholds.idleMs) return { state: "idle", age };
  return { state: "stale", age };
}

export function deriveStates(input: DeriveInput): DerivedStates {
  const evidence: EvidenceRecord[] = [];
  const factors: ConfidenceFactor[] = [];
  let confidence = 0;

  // --- Activity: prefer recorded event recency; fall back to file mtime at
  // low evidential weight (mtime alone is never "working").
  const eventRecency = deriveActivity(input.lastRecordedEventAt, input.config, input.nowMs);
  const fileRecency = deriveActivity(input.lastFileModifiedAt, input.config, input.nowMs);
  let activityState: ActivityState = "unknown";
  if (eventRecency.age !== null) {
    activityState = eventRecency.state;
    evidence.push({ type: "message_timestamp", source: "jsonl", value: input.lastRecordedEventAt, observedAt: new Date(input.nowMs).toISOString(), confidence: 0.25 });
    factors.push({ rule: "recent valid message event", weight: 0.25 });
    confidence += 0.25;
  } else if (fileRecency.age !== null) {
    activityState = fileRecency.state;
    evidence.push({ type: "file_mtime", source: "filesystem", value: input.lastFileModifiedAt, observedAt: new Date(input.nowMs).toISOString(), confidence: 0.05 });
    factors.push({ rule: "filesystem mtime only", weight: 0.05 });
    confidence += 0.05;
  } else {
    activityState = "unknown";
  }

  // --- Process: advisory only.
  let processState: ProcessState = "unknown";
  if (input.processExactMatch) {
    processState = "running";
    evidence.push({ type: "pid_match", source: "process_table", value: "exact session match", observedAt: new Date(input.nowMs).toISOString(), confidence: 0.2 });
    factors.push({ rule: "exact PID/session match", weight: 0.2 });
    confidence += 0.2;
  } else if (input.processMatchConfidence >= 0) {
    processState = input.processMatchConfidence > 0 ? "unknown" : "not_observed";
  }

  // --- Execution: direct evidence or runtime decoder hint; otherwise unknown.
  let executionState: ExecutionState = "unknown";
  const latestKind = input.latestEvent?.kind ?? null;
  if (input.explicitEndedAt) {
    executionState = input.latestEvent?.kind === "error" ? "failed" : "completed";
    evidence.push({ type: "explicit_end_marker", source: input.latestEvent ? "native_event_bus" : "jsonl", value: input.explicitEndedAt, observedAt: new Date(input.nowMs).toISOString(), confidence: 0.4 });
    factors.push({ rule: "explicit session end marker", weight: 0.4 });
    confidence += 0.4;
  } else if (input.waitingUserHint) {
    executionState = "waiting_user";
  } else if (latestKind === "tool_call") {
    executionState = "tool_running";
    evidence.push({ type: "tool_call", source: "jsonl", value: input.latestEvent?.toolName ?? "tool", observedAt: new Date(input.nowMs).toISOString(), confidence: 0.3 });
    factors.push({ rule: "latest event is an open tool call", weight: 0.3 });
    confidence += 0.3;
  } else if (input.executionHint) {
    executionState = input.executionHint;
    if (input.executionHint === "tool_running") {
      evidence.push({ type: "tool_call", source: "native_event_bus", value: input.latestEvent?.toolName ?? "tool", observedAt: new Date(input.nowMs).toISOString(), confidence: 0.45 });
      factors.push({ rule: "explicit native execution event", weight: 0.45 });
      confidence += 0.45;
    } else if (input.executionHint === "generating" || input.executionHint === "thinking") {
      evidence.push({ type: "event_type", source: "native_event_bus", value: latestKind, observedAt: new Date(input.nowMs).toISOString(), confidence: 0.25 });
      factors.push({ rule: "recent valid message event", weight: 0.25 });
      confidence += 0.25;
    }
  }

  // --- Health: independent derivation (spec §18).
  const hasHardError = input.errors.some((error) => !error.recoverable || error.code === "SOURCE_UNREADABLE" || error.code === "SOURCE_NOT_FOUND")
    || latestKind === "error"
    || executionState === "failed";
  const hasConflict = processState === "running" && (activityState === "stale" || activityState === "idle") && executionState === "completed";
  const stallCandidate = processState === "running"
    && !input.waitingUserHint
    && (executionState === "tool_running" || executionState === "generating" || executionState === "retrying")
    && eventRecency.age !== null
    && eventRecency.age >= input.config.thresholds.stalledMs;
  let healthState: HealthState;
  if (hasHardError) {
    healthState = "error";
  } else if (stallCandidate) {
    healthState = "stalled";
    evidence.push({ type: "adapter_signal", source: "process_table", value: "no progress within stall threshold while process evidence is running", observedAt: new Date(input.nowMs).toISOString(), confidence: 0.5 });
  } else if (input.hasMalformedRecords || hasConflict) {
    healthState = "degraded";
  } else if (activityState === "active" || activityState === "recent") {
    healthState = "healthy";
  } else {
    healthState = "unknown";
  }

  // --- Confidence adjustments (spec §19) + clamp.
  if (input.hasMalformedRecords) {
    confidence -= 0.2;
    factors.push({ rule: "malformed source", weight: -0.2 });
  }
  if (hasConflict) {
    confidence -= 0.25;
    factors.push({ rule: "conflicting evidence", weight: -0.25 });
  }
  confidence = Math.max(0, Math.min(1, confidence));

  if (input.latestEvent) {
    evidence.push({ type: "event_type", source: input.latestEvent.runtime === "pao_native" ? "native_event_bus" : "jsonl", value: input.latestEvent.kind, observedAt: new Date(input.nowMs).toISOString(), confidence: 0.2 });
  }

  return { activityState, processState, executionState, healthState, confidence, confidenceFactors: factors, evidence };
}

/** Session assembly helper used by the engine after adapter observation. */
export function buildSessionRecord(base: {
  id: string;
  sourceSessionId: string | null;
  runtime: AgentSession["runtime"];
  sourceType: AgentSession["sourceType"];
  projectId: string | null;
  projectName: string | null;
  workingDirectory: string | null;
  parentSessionId: string | null;
  rootSessionId: string | null;
  depth: number;
  tier: AgentSession["tier"];
  sourcePath: string | null;
  sourceRevision: string | null;
  sizeBytes: number | null;
}, states: DerivedStates, timing: { startedAt: string | null; lastRecordedEventAt: string | null; lastFileModifiedAt: string | null; explicitEndedAt: string | null }, latestEvent: NormalizedAgentEvent | null, errors: SessionObservationError[], processIds: number[], observedAt: string): AgentSession {
  return {
    ...base,
    alias: null,
    activityState: states.activityState,
    processState: states.processState,
    executionState: states.executionState,
    healthState: states.healthState,
    integrityState: "unchecked",
    confidence: states.confidence,
    confidenceFactors: states.confidenceFactors,
    startedAt: timing.startedAt,
    lastRecordedEventAt: timing.lastRecordedEventAt,
    lastFileModifiedAt: timing.lastFileModifiedAt,
    explicitEndedAt: timing.explicitEndedAt,
    latestEventType: latestEvent?.kind ?? null,
    latestRole: latestEvent?.role ?? null,
    latestToolName: latestEvent?.toolName ?? null,
    processIds,
    errors,
    evidence: states.evidence,
    observedAt,
  };
}
