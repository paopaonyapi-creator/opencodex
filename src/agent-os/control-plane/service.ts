// Phase 20.16 — Multi-AI Control Plane: orchestration service.
//
// THIS IS THE ONLY PLACE A TOOL REQUEST IS AUTHORIZED. Every path — MCP tool,
// management route, or an internal agent — reaches the policy engine through
// `requestTool`. Nothing else may decide that a tool may run, which is what makes
// the audit trail complete rather than illustrative.

import { randomUUID, createHash } from "node:crypto";
import {
  type AgentIdentity,
  type AgentRole,
  type ArtifactRecord,
  type CreateTaskInput,
  type ReviewConsensus,
  type ReviewIssue,
  type ReviewSeverity,
  type ReviewSubmission,
  type ReviewVerdict,
  type TaskEnvelope,
  type TaskStatus,
  type ToolCallRecord,
  nowIso,
} from "./types";
import { evaluateRequest, type PolicyDecision } from "./policy";
import { computeConsensus, createReview, isApplicationBlocked } from "./reviewers";
import { routeTask } from "./router";
import { getControlPlaneStore, type ControlPlaneStore } from "./store";
import { getSecretRedactor } from "../desktop-runtime/security/secret-redactor";

export interface ToolRequest {
  readonly taskId: string;
  readonly runId: string;
  readonly tool: string;
  readonly arguments?: Record<string, unknown>;
  /** Approval id, when the caller believes one has been granted. */
  readonly approvalId?: string | null;
  /** The work to perform, invoked ONLY after the gate allows it. */
  readonly execute?: () => Promise<unknown> | unknown;
}

export interface ToolRequestResult {
  readonly decision: PolicyDecision;
  readonly status: "succeeded" | "denied" | "approval_required" | "failed";
  readonly output?: unknown;
  readonly error?: string;
  readonly toolCall: ToolCallRecord;
}

export class ControlPlaneService {
  private store: ControlPlaneStore;

  constructor(deps: { store?: ControlPlaneStore } = {}) {
    this.store = deps.store ?? getControlPlaneStore();
    this.store.init();
  }

  getStore(): ControlPlaneStore {
    return this.store;
  }

  // -- Tasks ---------------------------------------------------------------

  createTask(input: CreateTaskInput): { task: TaskEnvelope; routing: ReturnType<typeof routeTask> } {
    const task = this.store.createTask(input);
    const routing = routeTask(task.task_type);
    return { task, routing };
  }

  getTask(taskId: string): TaskEnvelope | null {
    return this.store.getTask(taskId);
  }

  listTasks(status?: TaskStatus): TaskEnvelope[] {
    return this.store.listTasks(status);
  }

  setTaskStatus(taskId: string, status: TaskStatus): boolean {
    return this.store.setTaskStatus(taskId, status);
  }

  // -- Runs ----------------------------------------------------------------

  startRun(input: {
    taskId: string;
    agent: AgentIdentity;
    role: AgentRole;
    model?: string;
    inputRefs?: readonly string[];
    runId?: string;
  }) {
    const task = this.store.getTask(input.taskId);
    if (!task) throw new Error("Unknown task " + input.taskId + "; a run cannot exist without a task.");
    const run = this.store.startRun(input);
    if (task.status === "queued") this.store.setTaskStatus(task.task_id, "running");
    return run;
  }

  finishRun(input: Parameters<ControlPlaneStore["finishRun"]>[0]): boolean {
    return this.store.finishRun(input);
  }

  // -- Tool authorization --------------------------------------------------

  /**
   * Authorize and, when permitted, execute a tool request.
   *
   * The order is fixed: the policy decision is computed and RECORDED before any
   * work happens, so a denied attempt is auditable even though nothing ran. A
   * caller cannot obtain execution without a recorded decision.
   */
  async requestTool(request: ToolRequest): Promise<ToolRequestResult> {
    const task = this.store.getTask(request.taskId);
    if (!task) {
      throw new Error("Unknown task " + request.taskId + "; tool requests must name a task.");
    }

    const decision = evaluateRequest({
      task: {
        task_id: task.task_id,
        workspace_root: task.workspace_root,
        allowed_tools: task.allowed_tools,
        forbidden_tools: task.forbidden_tools,
        risk_level: task.risk_level,
      },
      tool: request.tool,
      arguments: request.arguments ?? {},
    });

    // Arguments are redacted BEFORE they are persisted. An audit row must never be
    // the place a credential survives.
    const redactor = getSecretRedactor();
    const redactedArgs = redactor.redactJson(request.arguments ?? {}) as Record<string, unknown>;

    const baseRecord = {
      taskId: request.taskId,
      runId: request.runId,
      tool: request.tool,
      argumentsRedacted: redactedArgs,
      risk: decision.risk,
    };

    if (!decision.allowed) {
      const toolCall = this.store.recordToolCall({
        ...baseRecord,
        outcome: decision.requiresApproval ? "approval_required" : "denied",
        reason: decision.reason,
      });
      return {
        decision,
        status: decision.requiresApproval ? "approval_required" : "denied",
        toolCall,
      };
    }

    // An allowed-but-approval-flagged operation needs a granted approval on record.
    if (decision.requiresApproval) {
      const approvalId = request.approvalId;
      if (!approvalId) {
        const pending = this.requestApproval({
          taskId: request.taskId,
          runId: request.runId,
          tool: request.tool,
          risk: decision.risk,
          reason: decision.reason,
        });
        const toolCall = this.store.recordToolCall({
          ...baseRecord,
          outcome: "approval_required",
          reason: decision.reason,
          approvalId: pending.id,
        });
        return { decision, status: "approval_required", toolCall };
      }
      const approval = this.getApproval(approvalId);
      if (!approval || approval.status !== "granted" || approval.task_id !== request.taskId || approval.tool !== request.tool) {
        const toolCall = this.store.recordToolCall({
          ...baseRecord,
          outcome: "denied",
          reason: "Approval " + approvalId + " is missing, ungranted, or does not cover this task and tool.",
          approvalId,
        });
        return {
          decision: {
            ...decision,
            allowed: false,
            reason: "Approval " + approvalId + " does not authorize " + request.tool + " for this task.",
            rule: "approval.mismatch",
          },
          status: "denied",
          toolCall,
        };
      }
    }

    // EXECUTE. Only now, and only for a permitted request.
    const started = Date.now();
    try {
      const output = request.execute ? await request.execute() : undefined;
      const toolCall = this.store.recordToolCall({
        ...baseRecord,
        outcome: "succeeded",
        reason: decision.reason,
        approvalId: request.approvalId ?? null,
        durationMs: Date.now() - started,
      });
      return { decision, status: "succeeded", output, toolCall };
    } catch (error) {
      const toolCall = this.store.recordToolCall({
        ...baseRecord,
        outcome: "failed",
        reason: redactor.redact(String(error)).redacted,
        approvalId: request.approvalId ?? null,
        durationMs: Date.now() - started,
      });
      return {
        decision,
        status: "failed",
        error: String(error),
        toolCall,
      };
    }
  }

  // -- Approvals -----------------------------------------------------------

  requestApproval(input: {
    taskId: string;
    runId?: string | null;
    tool: string;
    risk: string;
    reason?: string;
  }): { id: string } {
    const id = "capr_" + randomUUID();
    const db = this.store.getDb();
    db.query(
      `INSERT INTO cp_approvals (id, task_id, run_id, tool, risk, reason, status, requested_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    ).run(id, input.taskId, input.runId ?? null, input.tool, input.risk, input.reason ?? "", nowIso());
    this.store.setTaskStatus(input.taskId, "awaiting_approval");
    return { id };
  }

  getApproval(id: string): { id: string; task_id: string; tool: string; status: string; risk: string } | null {
    const row = this.store.getDb()
      .query("SELECT id, task_id, tool, status, risk FROM cp_approvals WHERE id = ?")
      .get(id) as { id: string; task_id: string; tool: string; status: string; risk: string } | undefined;
    return row ?? null;
  }

  listApprovals(status = "pending") {
    return this.store.getDb()
      .query("SELECT * FROM cp_approvals WHERE status = ? ORDER BY requested_at DESC LIMIT 200")
      .all(status) as Record<string, unknown>[];
  }

  decideApproval(id: string, decision: "grant" | "deny", decidedBy: string) {
    const current = this.getApproval(id);
    if (!current) return null;
    if (current.status !== "pending") return null;
    this.store.getDb()
      .query("UPDATE cp_approvals SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?")
      .run(decision === "grant" ? "granted" : "denied", nowIso(), decidedBy, id);
    return this.getApproval(id);
  }

  // -- Reviews -------------------------------------------------------------

  submitReview(input: {
    taskId: string;
    reviewer: AgentIdentity;
    role: AgentRole;
    verdict: ReviewVerdict;
    severity: ReviewSeverity;
    issues?: readonly ReviewIssue[];
    suggestions?: readonly string[];
    confidence?: number;
  }): ReviewSubmission {
    const review = createReview(input);
    this.store.submitReview(review);
    this.store.setTaskStatus(input.taskId, "awaiting_review");
    return review;
  }

  getConsensus(taskId: string): ReviewConsensus {
    return computeConsensus(taskId, this.store.listReviews(taskId));
  }

  /**
   * Whether a task may be applied.
   *
   * Reviews are required when the task asks for them, and a blocking consensus is
   * final. This is the check the apply path calls; it is intentionally the only way
   * to learn whether application is permitted.
   */
  canApply(taskId: string): { allowed: boolean; reasons: string[] } {
    const task = this.store.getTask(taskId);
    if (!task) return { allowed: false, reasons: ["Unknown task " + taskId + "."] };

    const reasons: string[] = [];
    if (task.requires_user_approval) reasons.push("Task is flagged requires_user_approval.");

    if (task.requires_review) {
      const consensus = this.getConsensus(taskId);
      if (consensus.decision === "pending") {
        reasons.push("No review has been submitted for this task.");
      } else if (isApplicationBlocked(consensus)) {
        reasons.push(...consensus.blockingReasons);
        if (consensus.blockingReasons.length === 0) {
          reasons.push("Council decision is " + consensus.decision + ".");
        }
      }
    }

    return { allowed: reasons.length === 0, reasons };
  }

  // -- Artifacts -----------------------------------------------------------

  registerArtifact(input: {
    taskId: string;
    runId?: string | null;
    artifactType: ArtifactRecord["artifact_type"];
    name: string;
    project?: string;
    provenance?: Record<string, unknown>;
    content?: string;
  }): ArtifactRecord {
    const artifact: ArtifactRecord = {
      id: "art_" + randomUUID(),
      task_id: input.taskId,
      run_id: input.runId ?? null,
      artifact_type: input.artifactType,
      name: input.name,
      project: input.project ?? "",
      provenance: input.provenance ?? {},
      content_hash: createHash("sha256").update(input.content ?? input.name).digest("hex"),
      status: "candidate",
      created_at: nowIso(),
    };
    return this.store.registerArtifact(artifact);
  }

  listArtifacts(taskId?: string): ArtifactRecord[] {
    return this.store.listArtifacts(taskId);
  }

  // -- Audit ---------------------------------------------------------------

  listToolCalls(taskId?: string): ToolCallRecord[] {
    return this.store.listToolCalls(taskId);
  }

  /** Operation counters derived from the recorded audit trail. */
  metrics(): Record<string, number> {
    const calls = this.store.listToolCalls(undefined, 500);
    const tasks = this.store.listTasks(undefined, 500);
    const byOutcome: Record<string, number> = {};
    for (const call of calls) {
      const key = "tool_calls_" + call.outcome + "_total";
      byOutcome[key] = (byOutcome[key] ?? 0) + 1;
    }
    return {
      tasks_total: tasks.length,
      tasks_failed_total: tasks.filter((task) => task.status === "failed").length,
      tool_calls_total: calls.length,
      ...byOutcome,
    };
  }
}

let defaultService: ControlPlaneService | null = null;
export function getControlPlaneService(): ControlPlaneService {
  if (!defaultService) defaultService = new ControlPlaneService();
  return defaultService;
}

export function resetControlPlaneService(): void {
  defaultService = null;
}
