// Phase 20.82 — Pao-hubPro × CortexKit AFT: Sensorimotor Execution Runtime.
//
// Types + error taxonomy. Perception → planning → action → observation loop
// over a workspace. All execution is transactional: every mutating action is
// checkpointed before it runs, and observation records the health delta so a
// failed action can be rolled back or resumed deterministically.

export const SENSORIMOTOR_POLICY_VERSION = "aft-1";

export type SensorimotorErrorCode =
  | "SENSORIMOTOR_DISABLED"
  | "SENSORIMOTOR_SESSION_NOT_FOUND"
  | "SENSORIMOTOR_ACTION_NOT_FOUND"
  | "SENSORIMOTOR_INVALID_ACTION"
  | "SENSORIMOTOR_PATH_OUTSIDE_WORKSPACE"
  | "SENSORIMOTOR_POLICY_DENIED"
  | "SENSORIMOTOR_APPROVAL_REQUIRED"
  | "SENSORIMOTOR_CHECKPOINT_FAILED"
  | "SENSORIMOTOR_TIMEOUT"
  | "SENSORIMOTOR_ABORTED"
  | "SENSORIMOTOR_TARGET_MISSING"
  | "SENSORIMOTOR_HEALTH_DEGRADED"
  | "SENSORIMOTOR_ROLLBACK_FAILED";

export class SensorimotorError extends Error {
  readonly code: SensorimotorErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;

  constructor(code: SensorimotorErrorCode, httpStatus: number, message: string, retryable = false) {
    super(message);
    this.name = "SensorimotorError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }
}

// --- action lifecycle (spec §7 transactional mutation state machine) ---

export type ActionStatus =
  | "pending"      // recorded, pre-flight policy check not yet run
  | "planning"     // pre-flight policy/approval evaluation
  | "checkpointed" // rollback snapshot persisted
  | "running"      // mutation in flight
  | "succeeded"
  | "failed"       // non-retryable failure
  | "retryable"    // failed, attempt < max_attempts
  | "aborted"      // user/caller cancellation
  | "timed_out"
  | "rolled_back";

export type ActionKind = "fs.write" | "fs.delete" | "fs.move" | "shell.exec" | "git.mutate";

export interface PerceptionRequest {
  sessionId: string;
  workspaceRoot: string;
  kind?: "tree" | "symbols";
  maxFiles?: number;
}

export interface PerceptionFileEntry {
  relativePath: string;
  sizeBytes: number;
  mtimeMs: number;
}

export interface PerceptionResult {
  perceptionId: string;
  sessionId: string;
  kind: string;
  workspaceRoot: string;
  fileCount: number;
  symbolCount: number;
  contentHash: string;
  files: PerceptionFileEntry[];
  createdAt: string;
}

export interface ActionRequest {
  sessionId: string;
  kind: ActionKind;
  /** Target relative path (fs.* actions) or command string (shell.exec). */
  target: string;
  /** New content for fs.write; ignored otherwise. */
  content?: string;
  /** Destination relative path for fs.move. */
  destination?: string;
  timeoutMs?: number;
  maxAttempts?: number;
}

export interface HealthDelta {
  filesChanged: number;
  filesAdded: number;
  filesRemoved: number;
  contentHashBefore: string | null;
  contentHashAfter: string | null;
  degraded: boolean;
  reasons: string[];
}

export interface ActionOutcome {
  actionId: string;
  sessionId: string;
  kind: ActionKind;
  target: string;
  status: ActionStatus;
  attempt: number;
  maxAttempts: number;
  checkpointId: string | null;
  rolledBack: boolean;
  observation: {
    outcome: "success" | "failed" | "aborted" | "rolled_back";
    healthDelta: HealthDelta;
  } | null;
  error: { code: SensorimotorErrorCode; message: string } | null;
  durationMs: number;
}

export interface SensorimotorSession {
  id: string;
  workspaceRoot: string;
  actorId: string;
  status: "active" | "closed" | "aborted";
  goal: string | null;
  createdAt: string;
  updatedAt: string;
}
