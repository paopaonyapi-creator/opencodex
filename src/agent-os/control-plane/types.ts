// Phase 20.16 — Pao-hubPro Multi-AI Control Plane: task and run envelopes.
//
// A task is the unit of authorization. It names the workspace, the tools the
// agent may use, and the risk ceiling it may reach without a human — so permission
// is granted per unit of work rather than to the agent as an identity. That
// distinction is the core of the phase: an agent does not hold machine rights; it
// requests a task, and the control plane decides what that task may do.

import { randomUUID } from "node:crypto";

export type TaskType =
  | "research"
  | "architecture"
  | "feature"
  | "bugfix"
  | "refactor"
  | "test"
  | "review"
  | "security_review"
  | "image_concept"
  | "video_concept"
  | "local_execution"
  | "other";

export type TaskStatus =
  | "queued"
  | "running"
  | "awaiting_review"
  | "awaiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled";

/**
 * Risk levels, ordered. Index is the severity rank, so a comparison never depends
 * on string collation.
 *
 *  L0 read-only      free
 *  L1 sandbox write  free (bounded to a scratch area)
 *  L2 project write  policy-checked
 *  L3 sensitive      explicit human approval, always
 */
export const RISK_LEVELS = ["L0", "L1", "L2", "L3"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export function riskRank(level: RiskLevel): number {
  return RISK_LEVELS.indexOf(level);
}

/** Highest of two levels. Used to escalate, never to de-escalate. */
export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return riskRank(a) >= riskRank(b) ? a : b;
}

export type AgentIdentity =
  | "chatgpt"
  | "codex"
  | "supergrok"
  | "grok-expert"
  | "grok-imagine"
  | "pao-hubpro"
  | "local-worker";

export type AgentRole =
  | "planner"
  | "researcher"
  | "reviewer"
  | "builder"
  | "creative"
  | "operator";

export interface TaskEnvelope {
  readonly task_id: string;
  readonly project_id: string;
  readonly created_by: AgentIdentity | "user";
  readonly goal: string;
  readonly task_type: TaskType;
  /** Ceiling this task may reach without human approval. */
  readonly risk_level: RiskLevel;
  readonly workspace_root: string;
  readonly allowed_tools: readonly string[];
  readonly forbidden_tools: readonly string[];
  readonly inputs: readonly string[];
  readonly expected_outputs: readonly string[];
  readonly requires_review: boolean;
  readonly requires_user_approval: boolean;
  readonly status: TaskStatus;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface AgentRunEnvelope {
  readonly run_id: string;
  readonly task_id: string;
  readonly agent: AgentIdentity;
  readonly role: AgentRole;
  readonly model: string;
  readonly started_at: string;
  readonly finished_at: string | null;
  readonly status: "running" | "succeeded" | "failed" | "cancelled";
  readonly input_refs: readonly string[];
  readonly output_refs: readonly string[];
  readonly token_usage: Readonly<Record<string, number>>;
  readonly cost: Readonly<Record<string, number>>;
  readonly verdict: string | null;
  readonly error: string | null;
}

export type ToolCallOutcome =
  | "allowed"
  | "denied"
  | "approval_required"
  | "succeeded"
  | "failed";

export interface ToolCallRecord {
  readonly id: string;
  readonly run_id: string;
  readonly task_id: string;
  readonly tool: string;
  readonly arguments_redacted: Record<string, unknown>;
  readonly risk: RiskLevel;
  readonly outcome: ToolCallOutcome;
  readonly reason: string | null;
  readonly approval_id: string | null;
  readonly duration_ms: number | null;
  readonly created_at: string;
}

/**
 * Structured evidence from a research agent. Free-form prose is not acceptable
 * input to a decision, because it cannot be re-checked later.
 */
export interface ResearchEvidence {
  readonly findings: readonly string[];
  readonly sources: readonly { title: string; url: string; retrievedAt: string }[];
  readonly risks: readonly string[];
  readonly recommended_option: string;
  /** 0..1. A low value is information, not a failure. */
  readonly confidence: number;
}

/**
 * Structured review verdict. CRITICAL blocks application automatically — that is
 * enforced in code, not left to whoever reads the report.
 */
export type ReviewVerdict = "approve" | "changes_requested" | "reject";
export type ReviewSeverity = "low" | "medium" | "high" | "critical";

export interface ReviewIssue {
  readonly severity: ReviewSeverity;
  readonly title: string;
  readonly detail: string;
  readonly file?: string;
  /** Stable identity so two reviewers reporting one defect are not double-counted. */
  readonly fingerprint: string;
}

export interface ReviewSubmission {
  readonly id: string;
  readonly task_id: string;
  readonly reviewer: AgentIdentity;
  readonly role: AgentRole;
  readonly verdict: ReviewVerdict;
  readonly severity: ReviewSeverity;
  readonly issues: readonly ReviewIssue[];
  readonly suggestions: readonly string[];
  readonly confidence: number;
  readonly created_at: string;
}

export interface ReviewConsensus {
  readonly task_id: string;
  readonly decision: ReviewVerdict | "pending";
  readonly severity: ReviewSeverity;
  /** True when a blocking finding must stop application. */
  readonly blocked: boolean;
  readonly blockingReasons: readonly string[];
  readonly reviewers: readonly AgentIdentity[];
  readonly issueCount: number;
  /** Points where reviewers disagree, surfaced rather than majority-voted away. */
  readonly disagreements: readonly ReviewDisagreement[];
}

export interface ReviewDisagreement {
  readonly topic: string;
  readonly positions: readonly { reviewer: AgentIdentity; position: string }[];
  readonly riskIfWrong: readonly string[];
}

export interface ArtifactRecord {
  readonly id: string;
  readonly task_id: string;
  readonly run_id: string | null;
  readonly artifact_type: "image" | "video" | "document" | "patch" | "dataset" | "other";
  readonly name: string;
  readonly project: string;
  /** Generation lineage: prompt, seed, parameters, generator. */
  readonly provenance: Readonly<Record<string, unknown>>;
  readonly content_hash: string;
  readonly status: "candidate" | "reviewed" | "approved" | "rejected";
  readonly created_at: string;
}

export interface CreateTaskInput {
  readonly project_id: string;
  readonly goal: string;
  readonly task_type: TaskType;
  readonly risk_level?: RiskLevel;
  readonly workspace_root: string;
  readonly created_by?: AgentIdentity | "user";
  readonly allowed_tools?: readonly string[];
  readonly forbidden_tools?: readonly string[];
  readonly inputs?: readonly string[];
  readonly expected_outputs?: readonly string[];
  readonly requires_review?: boolean;
  readonly requires_user_approval?: boolean;
}

export function newTaskId(): string {
  return "tsk_" + randomUUID();
}

export function newRunId(): string {
  return "run_" + randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

