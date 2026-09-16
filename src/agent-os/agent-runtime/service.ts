// Phase 20.61 — Agent Runtime orchestrator (spec §0-§3, §12, §14-§16).
//
// Pao-hubPro stays the canonical control plane: the state machine, claims,
// policy, evidence, verification, approvals and audit all live here. amux is
// reached only through the adapter seam. Feature-flagged; everything fails
// closed when disabled or when the runtime is unreachable/incompatible.

import { randomUUID } from "node:crypto";
import { getAgentRuntimeConfig, type AgentRuntimeConfig } from "./config";
import { resolveRuntimeToken, redactSecrets } from "./secrets";
import { newId, nowIso, AgentRuntimeStore } from "./store";
import {
  AgentRuntimeHttpError,
  assertTransition,
  type AgentTask,
  type AgentWorkerConfig,
  type ApprovalRequest,
  type CreateTaskInput,
  type ExecutionDecision,
  type ExecutionRequest,
  type TaskEvidence,
  type TaskStatus,
  type VerifierOutput,
  type WorkerRole,
} from "./types";
import type { RuntimeHealth, WorkerRuntimeAdapter } from "./adapter/types";
import { AmuxAdapter } from "./adapter/amux-adapter";
import { createFetchRuntimeTransport } from "./adapter/transport";
import { RuntimeAdapterError } from "./adapter/types";
import { decideExecution, requirePolicyAllowed, approvalRequirement, decideMergeTarget } from "./policy";
import { assertEvidenceType, assertEvidenceSafe, assertVerificationPacket, assertVerifierIndependent, verificationOutcome, recoveryPermitted } from "./evidence";
import { createWorktree, removeWorktree, worktreeBranchFor, worktreePathFor } from "./worktrees";
import { idempotencyKey, payloadHashOf, sha256Hex } from "./hash";
import { recordAgentEvent } from "../events";
import { registerOptionalShutdownHook } from "../../lib/optional-shutdown-hooks";

export type AdapterFactory = () => WorkerRuntimeAdapter;

function defaultAdapterFactory(config: AgentRuntimeConfig): WorkerRuntimeAdapter {
  const token = resolveRuntimeToken(config.amuxTokenSecretRef);
  return new AmuxAdapter({
    transport: createFetchRuntimeTransport({
      baseUrl: config.amuxBaseUrl,
      token,
      requestTimeoutMs: config.requestTimeoutMs,
      maxResponseBytes: 8 * 1024 * 1024,
    }),
    pinnedCommit: config.pinnedRuntimeCommit,
  });
}

export class AgentRuntimeService {
  readonly store: AgentRuntimeStore;
  private readonly config: AgentRuntimeConfig;
  private readonly adapterFactory: AdapterFactory;
  private adapterInstance: WorkerRuntimeAdapter | null = null;
  private monitorTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options?: { config?: AgentRuntimeConfig; store?: AgentRuntimeStore; adapterFactory?: AdapterFactory }) {
    this.config = options?.config ?? getAgentRuntimeConfig();
    this.store = options?.store ?? new AgentRuntimeStore();
    this.adapterFactory = options?.adapterFactory ?? (() => defaultAdapterFactory(this.config));
  }

  requireEnabled(): void {
    if (!this.config.enabled) {
      throw new AgentRuntimeHttpError("AGENT_DISABLED", 409, "agent runtime is disabled (PAO_AGENT_RUNTIME_ENABLED != true)");
    }
  }

  adapter(): WorkerRuntimeAdapter {
    this.requireEnabled();
    if (!this.adapterInstance) this.adapterInstance = this.adapterFactory();
    return this.adapterInstance;
  }

  // --- events + audit ---

  private recordEvent(eventType: Parameters<AgentRuntimeStore["insertEvent"]>[0]["eventType"], input: { taskId?: string | null; sessionId?: string | null; payload?: Record<string, unknown>; idempotencyKey?: string }): boolean {
    const key = input.idempotencyKey ?? idempotencyKey(eventType, { taskId: input.taskId ?? null, sessionId: input.sessionId ?? null, payload: input.payload ?? {} });
    const inserted = this.store.insertEvent({
      id: newId("are"),
      eventType,
      taskId: input.taskId ?? null,
      sessionId: input.sessionId ?? null,
      source: "pao-agent-runtime",
      idempotencyKey: key,
      payload: input.payload ?? {},
      occurredAt: nowIso(),
    });
    if (inserted) {
      recordAgentEvent({ kind: "agent-runtime." + eventType, payload: { taskId: input.taskId ?? null, ...input.payload } });
    }
    // Duplicate deliveries are harmless by design (INSERT OR IGNORE).
    return inserted;
  }

  private audit(actorType: string, actorId: string, action: string, decision: string, input?: { taskId?: string | null; sessionId?: string | null; requestHash?: string | null; details?: Record<string, unknown> }): void {
    this.store.appendAudit({
      taskId: input?.taskId ?? null,
      sessionId: input?.sessionId ?? null,
      actorType,
      actorId,
      action,
      decision,
      requestHash: input?.requestHash ?? null,
      details: input?.details ?? {},
    });
  }

  // --- idempotent operation wrapper (spec §3) ---

  async idempotent<T>(operation: string, request: unknown, fn: () => Promise<T> | T): Promise<T> {
    const key = idempotencyKey(operation, request);
    const cached = this.store.findIdempotentResponse<T>(key);
    if (cached !== null) return cached;
    const result = await fn();
    this.store.recordIdempotentResponse(key, operation, sha256Hex(JSON.stringify(request ?? null)), result as unknown);
    return result;
  }

  // --- workers ---

  registerWorker(input: { name: string; provider?: string; roles: WorkerRole[]; capabilities: AgentWorkerConfig["capabilities"]; maxConcurrency?: number; runtimeWorkerId?: string | null }): AgentWorkerConfig {
    this.requireEnabled();
    if (this.store.findWorkerByName(input.name)) {
      throw new AgentRuntimeHttpError("AGENT_DUPLICATE_OPERATION", 409, "worker name already registered");
    }
    const worker: AgentWorkerConfig = {
      id: newId("arw"),
      name: input.name,
      provider: input.provider ?? this.config.provider,
      roles: input.roles,
      capabilities: input.capabilities,
      maxConcurrency: input.maxConcurrency ?? 1,
      status: "unknown",
      runtimeWorkerId: input.runtimeWorkerId ?? null,
      lastSeenAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.store.insertWorker(worker);
    this.audit("system", "system", "worker.registered", "ok", { details: { workerId: worker.id, roles: worker.roles } });
    return worker;
  }

  listWorkers(): AgentWorkerConfig[] {
    return this.store.listWorkers();
  }

  private requireWorker(id: string): AgentWorkerConfig {
    const worker = this.store.getWorker(id);
    if (!worker) throw new AgentRuntimeHttpError("AGENT_NOT_FOUND", 404, "worker not found");
    return worker;
  }

  // --- tasks ---

  createTask(input: CreateTaskInput): AgentTask {
    this.requireEnabled();
    const task: AgentTask = {
      id: newId("art"),
      parentTaskId: input.parentTaskId ?? null,
      title: input.title,
      description: input.description,
      acceptanceCriteria: input.acceptanceCriteria ?? [],
      status: "draft",
      priority: input.priority ?? 50,
      role: input.role ?? "implementer",
      claimOwner: null,
      claimToken: null,
      claimVersion: 0,
      claimedAt: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      attempt: 0,
      maxAttempts: input.maxAttempts ?? this.config.maxAttempts,
      runtimeProvider: null,
      runtimeTaskId: null,
      runtimeSessionId: null,
      policyProfile: input.policyProfile ?? this.config.defaultPolicyProfile,
      requiresHumanApproval: input.requiresHumanApproval ?? true,
      repoRoot: input.repoRoot ?? null,
      worktreePath: null,
      branch: null,
      checkpoint: { status: "draft", summary: "", completedSteps: [], nextStep: null, changedFiles: [], commandsRun: [], evidenceIds: [], blockers: [], updatedAt: nowIso() },
      createdByType: input.actorType ?? "human",
      createdById: input.actorId ?? "operator",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.store.insertTask(task);
    this.recordEvent("task.created", { taskId: task.id, payload: { title: task.title, role: task.role } });
    this.audit(task.createdByType, task.createdById, "task.created", "ok", { taskId: task.id });
    return task;
  }

  listTasks(filter?: { status?: string }): AgentTask[] {
    return this.store.listTasks(filter);
  }

  getTask(taskId: string): { task: AgentTask; evidence: TaskEvidence[]; approvals: ApprovalRequest[]; sessions: Array<Record<string, unknown>> } {
    const task = this.requireTask(taskId);
    return {
      task,
      evidence: this.store.listEvidence(task.id),
      approvals: this.store.listApprovals().filter((a) => a.taskId === task.id),
      sessions: this.store.listSessions({ taskId: task.id }),
    };
  }

  requireTask(taskId: string): AgentTask {
    const task = this.store.getTask(taskId);
    if (!task) throw new AgentRuntimeHttpError("AGENT_NOT_FOUND", 404, "task not found");
    return task;
  }

  queueTask(taskId: string): AgentTask {
    const task = this.requireTask(taskId);
    assertTransition(task.status, "queued");
    return this.store.updateTaskStatus({ taskId: task.id, status: "queued" });
  }

  cancelTask(taskId: string, actor?: { type: string; id: string }): AgentTask {
    const task = this.requireTask(taskId);
    assertTransition(task.status, "cancelled");
    const updated = this.store.updateTaskStatus({ taskId: task.id, status: "cancelled" });
    this.recordEvent("session.stopped", { taskId: task.id, payload: { reason: "task cancelled" } });
    this.audit(actor?.type ?? "human", actor?.id ?? "operator", "task.cancelled", "ok", { taskId: task.id });
    void this.cleanupWorktree(task).catch(() => undefined);
    return updated;
  }

  private async cleanupWorktree(task: AgentTask): Promise<void> {
    if (!task.repoRoot || !task.worktreePath || !task.branch) return;
    await removeWorktree({ repoRoot: task.repoRoot, path: task.worktreePath, branch: task.branch });
  }

  // --- dispatch: claim + worktree + runtime handoff (spec §3, §4) ---

  async dispatchTask(taskId: string, input?: { workerId?: string }): Promise<{ task: AgentTask; decision: ExecutionDecision }> {
    this.requireEnabled();
    if (!this.config.dispatchEnabled) {
      throw new AgentRuntimeHttpError("AGENT_DISABLED", 409, "dispatch is disabled (stage A/B rollout: PAO_AGENT_RUNTIME_DISPATCH_ENABLED != true)");
    }
    const task = this.requireTask(taskId);
    assertTransition(task.status, "queued");
    const queued = this.store.updateTaskStatus({ taskId: task.id, status: "queued" });

    const worker = input?.workerId ? this.requireWorker(input.workerId) : this.pickWorker(queued.role);
    if (!worker) {
      throw new AgentRuntimeHttpError("AGENT_NOT_FOUND", 409, "no registered worker for role " + queued.role);
    }

    // Worktree isolation BEFORE the runtime sees the task (spec §4).
    if (queued.repoRoot) {
      const handle = await createWorktree({
        repoRoot: queued.repoRoot,
        workspaceRoot: this.config.workspaceRoot,
        taskId: queued.id,
        role: queued.role,
      });
      this.store.updateTask(queued.id, { worktreePath: handle.path, branch: handle.branch });
    }

    // Atomic claim: exactly one affected row wins (spec §3).
    const claimToken = randomUUID();
    const leaseExpiresAt = new Date(Date.now() + this.config.leaseSeconds * 1000).toISOString();
    const claimed = this.store.claimTaskAtomic({
      taskId: queued.id,
      workerId: worker.id,
      claimToken,
      leaseExpiresAt,
    });
    if (!claimed.claimed) {
      throw new AgentRuntimeHttpError("AGENT_CLAIM_CONFLICT", 409, "task was claimed by another worker", { currentOwner: claimed.task?.claimOwner ?? null });
    }
    this.recordEvent("task.claimed", { taskId: queued.id, payload: { workerId: worker.id, attempt: claimed.task!.attempt } });

    const claimedTask = claimed.task!;
    this.store.updateTaskStatus({ taskId: queued.id, status: "running", expectClaimToken: claimToken });
    this.recordEvent("task.started", { taskId: queued.id, payload: { workerId: worker.id } });

    const session = { id: newId("ars"), taskId: queued.id, workerId: worker.id, runtimeSessionId: worker.runtimeWorkerId ?? worker.name, status: "running", attempt: claimedTask.attempt };
    this.store.insertSession(session);
    this.recordEvent("session.created", { taskId: queued.id, sessionId: session.id, payload: { runtimeSessionId: session.runtimeSessionId } });

    // Handoff to the runtime; a failure here surfaces as RUNTIME_* and the
    // recovery controller owns the retry (fail closed, bounded).
    const decision = decideExecution({
      worker,
      task: this.requireTask(queued.id),
      request: {
        taskId: queued.id,
        workerId: worker.id,
        commandClass: "command.safe_dev",
        argv: ["agent-dispatch", queued.title],
      },
      networkDefault: this.config.networkDefault,
    });
    try {
      await this.adapter().dispatchTask({
        runtimeWorkerId: session.runtimeSessionId,
        title: queued.title,
        description: queued.description,
        message: this.buildDispatchMessage(claimedTask, worker),
      });
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error));
      this.store.updateTaskStatus({ taskId: queued.id, status: "recovering", expectClaimToken: claimToken });
      this.recordEvent("session.suspect", { taskId: queued.id, sessionId: session.id, payload: { reason: message } });
      throw error;
    }
    this.store.updateTask(queued.id, { runtimeProvider: this.config.provider, runtimeTaskId: queued.id, runtimeSessionId: session.runtimeSessionId });
    return { task: this.requireTask(queued.id), decision };
  }

  private pickWorker(role: WorkerRole): AgentWorkerConfig | null {
    return this.store.listWorkers().find((w) => w.roles.includes(role)) ?? null;
  }

  private buildDispatchMessage(task: AgentTask, worker: AgentWorkerConfig): string {
    const criteria = task.acceptanceCriteria.map((c, i) => `AC-${i + 1}: ${c}`).join("; ");
    return [
      "Task " + task.id + " (" + worker.name + "/" + task.role + "): " + task.title,
      task.description,
      criteria ? "Acceptance criteria: " + criteria : "",
      "Work in the isolated worktree; record evidence; report a structured checkpoint when done.",
      "Do not push, merge, or access secrets — those require human approval.",
    ].filter(Boolean).join("\n");
  }

  // --- heartbeat + checkpoints (spec §12, §13) ---

  heartbeat(taskId: string, input: { claimToken: string; checkpoint?: AgentTask["checkpoint"] }): boolean {
    const task = this.requireTask(taskId);
    const leaseExpiresAt = new Date(Date.now() + this.config.leaseSeconds * 1000).toISOString();
    const ok = this.store.heartbeat(task.id, task.claimOwner ?? "", input.claimToken, leaseExpiresAt);
    if (!ok) {
      throw new AgentRuntimeHttpError("AGENT_CLAIM_STALE", 409, "heartbeat rejected: stale claim token or task not running");
    }
    if (input.checkpoint) {
      this.store.updateTask(task.id, { checkpoint: { ...input.checkpoint, updatedAt: nowIso() } });
    }
    this.recordEvent("task.heartbeat", { taskId: task.id, payload: { summary: input.checkpoint?.summary ?? "" } });
    return ok;
  }

  completeTask(taskId: string, input: { claimToken: string; summary?: string }): AgentTask {
    const task = this.requireTask(taskId);
    assertTransition(task.status, "done");
    // Duplicate completion events are harmless: the guarded update is a no-op
    // when the token does not match (spec §3).
    const updated = this.store.updateTaskStatus({ taskId: task.id, status: "done", expectClaimToken: input.claimToken });
    this.recordEvent("task.done", { taskId: task.id, payload: { summary: input.summary ?? "" } });
    this.audit("agent", task.claimOwner ?? "worker", "task.completed", "ok", { taskId: task.id });
    return updated;
  }

  // --- recovery controller (spec §12) ---

  /**
   * Detect abandoned leases and run the bounded recovery algorithm. Executed
   * by the monitor interval; never auto-retries beyond max_attempts.
   */
  async runRecoverySweep(): Promise<{ suspected: number; recovered: number; failed: number }> {
    if (!this.config.recoveryEnabled) return { suspected: 0, recovered: 0, failed: 0 };
    const now = nowIso();
    const stale = this.store
      .listTasks({ status: "running" })
      .filter((t) => t.leaseExpiresAt !== null && t.leaseExpiresAt <= now);
    let recovered = 0;
    let failed = 0;
    for (const task of stale) {
      this.recordEvent("session.suspect", { taskId: task.id, payload: { reason: "lease expired" } });
      const graceEnd = new Date((task.leaseExpiresAt ? Date.parse(task.leaseExpiresAt) : Date.now()) + this.config.recoveryGraceSeconds * 1000);
      if (Date.now() < graceEnd.getTime()) continue;
      if (!recoveryPermitted({ attempt: task.attempt, maxAttempts: task.maxAttempts })) {
        this.store.updateTaskStatus({ taskId: task.id, status: "failed" });
        this.recordEvent("task.failed", { taskId: task.id, payload: { reason: "recovery exhausted" } });
        failed += 1;
        this.audit("system", "recovery-controller", "recovery.exhausted", "failed", { taskId: task.id });
        continue;
      }
      const reclaimed = this.store.reclaimExpiredLease({ taskId: task.id, nowIso: now });
      if (!reclaimed) continue; // lost the reclaim race; the owner is still live
      const requeued = this.store.updateTaskStatus({ taskId: task.id, status: "queued" });
      this.recordEvent("session.recovered", { taskId: task.id, payload: { attempt: requeued.attempt } });
      this.audit("system", "recovery-controller", "recovery.reclaimed", "ok", { taskId: task.id, details: { attempt: requeued.attempt } });
      recovered += 1;
    }
    return { suspected: stale.length, recovered, failed };
  }

  startMonitor(): void {
    if (this.monitorTimer || !this.config.enabled) return;
    const intervalMs = Math.max(5, this.config.heartbeatSeconds) * 1000;
    this.monitorTimer = setInterval(() => {
      void this.runRecoverySweep().catch(() => undefined);
    }, intervalMs);
    registerOptionalShutdownHook("agent-runtime-monitor", () => this.stopMonitor());
  }

  stopMonitor(): void {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
  }

  // --- execution gateway (spec §10): decide + enforce; no raw shell ---

  async evaluate(request: ExecutionRequest): Promise<ExecutionDecision> {
    this.requireEnabled();
    const task = this.requireTask(request.taskId);
    const worker = this.requireWorker(request.workerId);
    const decision = decideExecution({
      worker,
      task,
      request: { ...request, argv: request.argv.map((a) => redactSecrets(a)) },
      networkDefault: this.config.networkDefault,
    });
    if (decision.effect === "deny") {
      this.recordEvent("policy.denied", { taskId: task.id, payload: { ruleResults: decision.ruleResults } });
      this.audit("agent", request.workerId, "execution.denied", "denied", { taskId: task.id, details: { argv: request.argv } });
      requirePolicyAllowed(decision); // throws AGENT_POLICY_DENIED
    }
    if (decision.effect === "require_approval") {
      this.recordEvent("policy.allowed", { taskId: task.id, payload: { requiresApproval: true } });
      this.requestApproval(task.id, { action: "execute:" + request.commandClass, payload: { argv: request.argv, paths: request.paths ?? [] }, requestedBy: request.workerId });
      throw new AgentRuntimeHttpError("AGENT_APPROVAL_REQUIRED", 403, "execution requires human approval", { ruleResults: decision.ruleResults });
    }
    this.recordEvent("policy.allowed", { taskId: task.id, payload: { commandClass: request.commandClass } });
    this.audit("agent", request.workerId, "execution.allowed", "allowed", { taskId: task.id, details: { commandClass: request.commandClass } });
    return decision;
  }

  // --- evidence + verification (spec §14) ---

  addEvidence(taskId: string, input: { evidenceType: string; uri?: string | null; content?: string; metadata?: Record<string, unknown>; createdBy?: string }): TaskEvidence {
    const task = this.requireTask(taskId);
    const evidenceType = assertEvidenceType(input.evidenceType);
    assertEvidenceSafe(input.metadata ?? {}, input.uri ?? undefined);
    const evidence: TaskEvidence = {
      id: newId("arev"),
      taskId: task.id,
      evidenceType,
      uri: input.uri ?? null,
      sha256: input.content ? sha256Hex(input.content) : null,
      metadata: input.metadata ?? {},
      createdBy: input.createdBy ?? task.claimOwner ?? "worker",
      createdAt: nowIso(),
    };
    this.store.insertEvidence(evidence);
    this.recordEvent("evidence.created", { taskId: task.id, payload: { evidenceType, evidenceId: evidence.id } });
    return evidence;
  }

  /**
   * DONE -> VERIFYING -> VERIFIED|REJECTED. The verifier must be independent
   * of the implementer; worker self-report alone never verifies (spec §14).
   */
  async verifyTask(taskId: string, input: { verifierWorkerId: string; verifierRole?: WorkerRole; verdict: VerifierOutput; actorId?: string }): Promise<{ task: AgentTask; outcome: { status: TaskStatus; summary: string } }> {
    const task = this.requireTask(taskId);
    assertTransition(task.status, "verifying");
    this.store.updateTaskStatus({ taskId: task.id, status: "verifying" });
    this.recordEvent("verification.started", { taskId: task.id, payload: { verifier: input.verifierWorkerId } });

    const state = this.getTask(task.id);
    assertVerificationPacket({ acceptanceCriteria: task.acceptanceCriteria, evidence: state.evidence });
    assertVerifierIndependent({
      verifierWorkerId: input.verifierWorkerId,
      implementerClaimOwner: task.claimOwner,
      verifierRole: input.verifierRole ?? "reviewer",
    });

    const outcome = verificationOutcome(input.verdict);
    this.store.updateTaskStatus({ taskId: task.id, status: outcome.status });
    this.recordEvent(outcome.status === "verified" ? "verification.passed" : "verification.failed", { taskId: task.id, payload: { verdict: input.verdict.verdict } });
    this.audit("agent", input.verifierWorkerId, "verification.completed", outcome.status, { taskId: task.id, details: { verdict: input.verdict.verdict } });

    if (outcome.status === "verified") {
      return { task: this.afterVerified(this.requireTask(task.id)), outcome };
    }
    return { task: this.requireTask(task.id), outcome };
  }

  /** VERIFIED -> APPROVAL_REQUIRED (default) or APPROVED when not required. */
  private afterVerified(task: AgentTask): AgentTask {
    if (task.requiresHumanApproval) {
      assertTransition(task.status, "approval_required");
      return this.store.updateTaskStatus({ taskId: task.id, status: "approval_required" });
    }
    assertTransition(task.status, "approved");
    return this.store.updateTaskStatus({ taskId: task.id, status: "approved" });
  }

  // --- approvals (spec §11) ---

  requestApproval(taskId: string, input: { action: string; payload: unknown; requestedBy: string }): ApprovalRequest {
    const task = this.requireTask(taskId);
    const requirement = approvalRequirement(input.action);
    if (requirement === "allow") {
      throw new AgentRuntimeHttpError("AGENT_INVALID_INPUT", 409, "action does not require approval: " + input.action);
    }
    const payloadHash = payloadHashOf(input.payload);
    const approval: ApprovalRequest = {
      id: newId("arap"),
      taskId: task.id,
      action: input.action,
      riskLevel: requirement === "restricted" ? "high" : "critical",
      status: "pending",
      requestedBy: input.requestedBy,
      requestedAt: nowIso(),
      decidedBy: null,
      decidedAt: null,
      decisionReason: null,
      payloadHash,
    };
    this.store.insertApproval(approval);
    this.recordEvent("approval.requested", { taskId: task.id, payload: { action: input.action, payloadHash, approvalId: approval.id } });
    this.audit("agent", input.requestedBy, "approval.requested", "pending", { taskId: task.id, requestHash: payloadHash, details: { action: input.action } });
    return approval;
  }

  /**
   * Decide an approval. The payload hash is re-verified against the CURRENT
   * request payload — a changed payload invalidates (stales) the approval
   * (spec §11). Merge candidates additionally respect protected branches.
   */
  decideApproval(approvalId: string, input: { decision: "approved" | "rejected"; approverId: string; reason?: string | null; currentPayload?: unknown }): { approval: ApprovalRequest; task: AgentTask | null } {
    const approval = this.store.getApproval(approvalId);
    if (!approval) throw new AgentRuntimeHttpError("AGENT_NOT_FOUND", 404, "approval request not found");
    if (approval.status !== "pending") {
      throw new AgentRuntimeHttpError("AGENT_APPROVAL_STALE", 409, "approval request already decided");
    }
    if (input.currentPayload !== undefined) {
      const fresh = payloadHashOf(input.currentPayload);
      if (fresh !== approval.payloadHash) {
        this.store.decideApproval(approval.id, "stale", input.approverId, "payload changed after approval was requested");
        this.recordEvent("approval.rejected", { taskId: approval.taskId, payload: { approvalId: approval.id, reason: "payload changed" } });
        throw new AgentRuntimeHttpError("AGENT_APPROVAL_STALE", 409, "payload changed after the approval was requested; request re-approval");
      }
    }
    this.store.decideApproval(approval.id, input.decision, input.approverId, input.reason ?? null);
    this.recordEvent(input.decision === "approved" ? "approval.approved" : "approval.rejected", { taskId: approval.taskId, payload: { approvalId: approval.id } });
    this.audit("human", input.approverId, input.decision === "approved" ? "approval.approved" : "approval.rejected", input.decision, { taskId: approval.taskId, requestHash: approval.payloadHash });

    let task: AgentTask | null = null;
    if (input.decision === "approved" && approval.action === "protected.merge") {
      task = this.requireTask(approval.taskId);
      const mergeDecision = decideMergeTarget({ branch: task.branch, targetBranch: "main", protectedBranches: this.config.protectedBranches });
      requirePolicyAllowed(mergeDecision);
      assertTransition(task.status, "approved");
      task = this.store.updateTaskStatus({ taskId: task.id, status: "approved" });
    }
    return { approval: this.store.getApproval(approval.id)!, task };
  }

  /** APPROVED -> MERGED (merge candidate promotion). Always human-approved upstream. */
  promoteMergeCandidate(taskId: string, input: { targetBranch: string; approverId: string; payload: unknown }): AgentTask {
    const task = this.requireTask(taskId);
    const mergeDecision = decideMergeTarget({ branch: task.branch, targetBranch: input.targetBranch, protectedBranches: this.config.protectedBranches });
    requirePolicyAllowed(mergeDecision);
    const latest = this.store.latestApprovalForPayload(task.id, "protected.merge", payloadHashOf(input.payload));
    if (!latest || latest.status !== "approved") {
      throw new AgentRuntimeHttpError("AGENT_APPROVAL_REQUIRED", 403, "no valid human approval for this merge payload");
    }
    assertTransition(task.status, "merged");
    this.audit("human", input.approverId, "merge.promoted", "merged", { taskId: task.id, details: { targetBranch: input.targetBranch } });
    return this.store.updateTaskStatus({ taskId: task.id, status: "merged" });
  }

  retryTask(taskId: string, actor?: { type: string; id: string }): AgentTask {
    const task = this.requireTask(taskId);
    assertTransition(task.status, "queued");
    if (!recoveryPermitted({ attempt: task.attempt, maxAttempts: task.maxAttempts })) {
      throw new AgentRuntimeHttpError("AGENT_INVALID_TRANSITION", 409, "retry budget exhausted (max attempts " + task.maxAttempts + ")");
    }
    const updated = this.store.updateTaskStatus({ taskId: task.id, status: "queued" });
    this.audit(actor?.type ?? "human", actor?.id ?? "operator", "task.retried", "ok", { taskId: task.id, details: { attempt: updated.attempt } });
    return updated;
  }

  // --- runtime health / event feed ---

  async runtimeHealth(): Promise<RuntimeHealth> {
    try {
      return await this.adapter().health();
    } catch (error) {
      if (error instanceof RuntimeAdapterError) {
        return { healthy: false, provider: this.config.provider, version: null, commit: null, compatible: false, incompatibilityReason: redactSecrets(error.message), raw: {} };
      }
      throw error;
    }
  }

  listEvents(filter?: { taskId?: string; limit?: number }) {
    return this.store.listEvents(filter);
  }

  listSessions(filter?: { taskId?: string; status?: string }) {
    return this.store.listSessions(filter);
  }
}

// --- singleton ---

let singleton: AgentRuntimeService | null = null;

export function getAgentRuntimeService(): AgentRuntimeService {
  if (!singleton) {
    singleton = new AgentRuntimeService();
    if (getAgentRuntimeConfig().enabled) singleton.startMonitor();
  }
  return singleton;
}

export function resetAgentRuntimeServiceForTests(): void {
  if (singleton) singleton.stopMonitor();
  singleton = null;
}

export function setAgentRuntimeServiceForTests(service: AgentRuntimeService): void {
  if (singleton) singleton.stopMonitor();
  singleton = service;
}

export { worktreeBranchFor, worktreePathFor };
