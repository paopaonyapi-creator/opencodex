// Phase 20.61 — Evidence collection and independent verification (spec §13, §14).
//
// A worker saying "finished" is never sufficient: DONE requires evidence, and
// DONE -> VERIFIED requires an independent verifier distinct from the worker
// that implemented the change.

import { createHash } from "node:crypto";
import { AgentRuntimeHttpError, type TaskEvidence, type TaskStatus, type VerifierOutput, type WorkerRole } from "./types";
import { containsSecretLikeMaterial } from "./secrets";

const EVIDENCE_TYPES: readonly TaskEvidence["evidenceType"][] = [
  "diff", "commit", "test_report", "lint_report", "typecheck_report", "build_report",
  "security_report", "worker_transcript", "runtime_log", "screenshot", "artifact", "review_report",
];

export function assertEvidenceType(type: string): TaskEvidence["evidenceType"] {
  if (!EVIDENCE_TYPES.includes(type as TaskEvidence["evidenceType"])) {
    throw new AgentRuntimeHttpError("AGENT_INVALID_INPUT", 400, "unknown evidence type: " + type);
  }
  return type as TaskEvidence["evidenceType"];
}

/** Evidence text is scrubbed before persistence; secret leakage is a hard error. */
export function assertEvidenceSafe(metadata: Record<string, unknown>, summary?: string): void {
  const serialized = JSON.stringify(metadata) + (summary ?? "");
  if (containsSecretLikeMaterial(serialized)) {
    throw new AgentRuntimeHttpError("AGENT_POLICY_DENIED", 403, "evidence payload contains secret-like material and was not persisted");
  }
}

export function evidenceSha256(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Minimum verification packet (spec §14): the task must carry requirement,
 * diff, test evidence, and a completion report before verification starts.
 */
export function assertVerificationPacket(input: {
  acceptanceCriteria: string[];
  evidence: TaskEvidence[];
}): void {
  const types = new Set(input.evidence.map((e) => e.evidenceType));
  if (input.acceptanceCriteria.length === 0) {
    throw new AgentRuntimeHttpError("AGENT_VERIFICATION_REQUIRED", 409, "task has no acceptance criteria to verify against");
  }
  if (!types.has("diff") && !types.has("commit")) {
    throw new AgentRuntimeHttpError("AGENT_VERIFICATION_REQUIRED", 409, "verification requires diff or commit evidence");
  }
  if (!types.has("test_report")) {
    throw new AgentRuntimeHttpError("AGENT_VERIFICATION_REQUIRED", 409, "verification requires test evidence");
  }
}

/**
 * Independent-verifier rule (spec §14): the verifier must not be the same
 * worker/session that implemented the change.
 */
export function assertVerifierIndependent(input: {
  verifierWorkerId: string;
  implementerClaimOwner: string | null;
  verifierRole: WorkerRole;
}): void {
  if (input.verifierRole !== "reviewer" && input.verifierRole !== "release-controller") {
    throw new AgentRuntimeHttpError("AGENT_VERIFICATION_REQUIRED", 403, "verification must be performed by a reviewer or release-controller");
  }
  if (input.implementerClaimOwner && input.verifierWorkerId === input.implementerClaimOwner) {
    throw new AgentRuntimeHttpError("AGENT_VERIFICATION_REQUIRED", 403, "the verifier must be independent of the implementer");
  }
}

/** Evaluate a verifier output into the resulting task status (spec §14). */
export function verificationOutcome(verdict: VerifierOutput): { status: TaskStatus; summary: string } {
  if (verdict.verdict === "pass" && verdict.recommendedAction === "approve") {
    return { status: "verified", summary: "all acceptance criteria passed" };
  }
  if (verdict.verdict === "needs_changes" || verdict.recommendedAction === "rework") {
    return { status: "rejected", summary: "verifier requested rework: " + (verdict.regressions[0] ?? verdict.risks[0] ?? "unmet criteria") };
  }
  return { status: "rejected", summary: "verifier rejected: " + (verdict.regressions[0] ?? verdict.risks[0] ?? "requirements unmet") };
}

/** Bounded retry budget check (spec §12): no infinite auto-retry. */
export function recoveryPermitted(input: { attempt: number; maxAttempts: number }): boolean {
  return input.attempt < input.maxAttempts;
}
