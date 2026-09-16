// Phase 20.42 — BotWorkspace operational store: group rounds, agent
// executions, execution events, approvals, routines, routine runs, audit.
// Events are idempotent on (execution_id, sequence); approvals are
// fingerprint-bound and single-use; audit is redacted at the caller.

import { openAgentOsDb } from "../db";
import { BotWorkspaceStore } from "./store";
import type {
  BwAgentExecution, BwApproval, BwExecutionEvent, BwGroupRound, BwRoutine, BwRoutineRun,
  ExecutionStatus, FailurePolicy, OrchestrationMode, RoundStatus, RiskLevel,
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function shortId(prefix: string): string {
  return prefix + "_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

export class BotWorkspaceOpsStore extends BotWorkspaceStore {
  // --- Group rounds ----------------------------------------------------------------------

  insertRound(round: Omit<BwGroupRound, "id" | "createdAt" | "updatedAt">): BwGroupRound {
    const id = shortId("bwrd");
    const now = nowIso();
    this.db
      .query("INSERT INTO bw_group_rounds (id, conversation_id, initiating_message_id, orchestration_mode, requested_agent_order_json, resolved_agent_order_json, status, current_position, failure_policy, stop_reason, started_at, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, round.conversationId, round.initiatingMessageId, round.orchestrationMode, JSON.stringify(round.requestedAgentOrder), JSON.stringify(round.resolvedAgentOrder), round.status, round.currentPosition, round.failurePolicy, round.stopReason, round.startedAt, round.completedAt, now, now);
    return this.getRound(id) as BwGroupRound;
  }

  getRound(id: string): BwGroupRound | null {
    const row = this.db.query("SELECT * FROM bw_group_rounds WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapRound(row) : null;
  }

  updateRoundStatus(id: string, status: RoundStatus, extra: { currentPosition?: number; stopReason?: string | null; startedAt?: string; completedAt?: string } = {}): void {
    const round = this.getRound(id);
    if (!round) throw new Error("[NOT_FOUND] round not found");
    this.db
      .query("UPDATE bw_group_rounds SET status = ?, current_position = ?, stop_reason = ?, started_at = ?, completed_at = ?, updated_at = ? WHERE id = ?")
      .run(status, extra.currentPosition ?? round.currentPosition, extra.stopReason !== undefined ? extra.stopReason : round.stopReason, extra.startedAt ?? round.startedAt, extra.completedAt ?? round.completedAt, nowIso(), id);
  }

  listRounds(conversationId: string, limit = 50): BwGroupRound[] {
    return (this.db.query("SELECT * FROM bw_group_rounds WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?").all(conversationId, limit) as Array<Record<string, unknown>>).map(mapRound);
  }

  listRoundsInState(statuses: string[], limit = 100): BwGroupRound[] {
    return (this.db.query("SELECT * FROM bw_group_rounds WHERE status = ? ORDER BY created_at DESC LIMIT ?").all(statuses[0] ?? "", limit) as Array<Record<string, unknown>>).map(mapRound);
  }

  // --- Executions ------------------------------------------------------------------------------

  insertExecution(execution: Omit<BwAgentExecution, "id" | "createdAt" | "updatedAt">): BwAgentExecution {
    const id = shortId("bwe");
    const now = nowIso();
    this.db
      .query("INSERT INTO bw_agent_executions (id, group_round_id, routine_run_id, agent_id, provider_binding_id, runtime_binding_id, model, position, attempt, status, input_snapshot_ref, output_message_id, error_code, error_message_safe, started_at, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, execution.groupRoundId, execution.routineRunId, execution.agentId, execution.providerBindingId, execution.runtimeBindingId, execution.model, execution.position, execution.attempt, execution.status, execution.inputSnapshotRef, execution.outputMessageId, execution.errorCode, execution.errorMessageSafe, execution.startedAt, execution.completedAt, now, now);
    return this.getExecution(id) as BwAgentExecution;
  }

  getExecution(id: string): BwAgentExecution | null {
    const row = this.db.query("SELECT * FROM bw_agent_executions WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapExecution(row) : null;
  }

  updateExecutionStatus(id: string, status: ExecutionStatus, extra: { startedAt?: string; completedAt?: string; errorCode?: string | null; errorMessageSafe?: string | null; outputMessageId?: string | null } = {}): void {
    const existing = this.getExecution(id);
    if (!existing) throw new Error("[NOT_FOUND] execution not found");
    this.db
      .query("UPDATE bw_agent_executions SET status = ?, started_at = ?, completed_at = ?, error_code = ?, error_message_safe = ?, output_message_id = ?, updated_at = ? WHERE id = ?")
      .run(status, extra.startedAt ?? existing.startedAt, extra.completedAt ?? existing.completedAt, extra.errorCode !== undefined ? extra.errorCode : existing.errorCode, extra.errorMessageSafe !== undefined ? extra.errorMessageSafe : existing.errorMessageSafe, extra.outputMessageId !== undefined ? extra.outputMessageId : existing.outputMessageId, nowIso(), id);
  }

  maxAttemptFor(roundId: string, agentId: string, position: number): number {
    const row = this.db.query("SELECT COALESCE(MAX(attempt), 0) AS n FROM bw_agent_executions WHERE group_round_id = ? AND agent_id = ? AND position = ?").get(roundId, agentId, position) as { n: number };
    return row.n;
  }

  listExecutionsForRound(roundId: string): BwAgentExecution[] {
    return (this.db.query("SELECT * FROM bw_agent_executions WHERE group_round_id = ? ORDER BY position ASC, attempt ASC, created_at ASC").all(roundId) as Array<Record<string, unknown>>).map(mapExecution);
  }

  listExecutionsInState(statuses: ExecutionStatus[], limit = 100): BwAgentExecution[] {
    const rows = this.db.query("SELECT * FROM bw_agent_executions WHERE status = ? ORDER BY created_at ASC LIMIT ?").all(statuses[0] ?? "", limit) as Array<Record<string, unknown>>;
    return rows.map(mapExecution);
  }

  // --- Execution events (idempotent on (execution_id, sequence)) --------------------------------------

  appendEvent(executionId: string, eventType: string, payload: Record<string, unknown>): BwExecutionEvent {
    const row = this.db.query("SELECT COALESCE(MAX(sequence), 0) AS max_seq FROM bw_execution_events WHERE execution_id = ?").get(executionId) as { max_seq: number };
    const sequence = Number(row.max_seq) + 1;
    const id = shortId("bwev");
    this.db
      .query("INSERT INTO bw_execution_events (id, execution_id, sequence, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, executionId, sequence, eventType, JSON.stringify(payload), nowIso());
    return { id, executionId, sequence, eventType, payloadJson: JSON.stringify(payload), createdAt: nowIso() };
  }

  listEvents(executionId: string, afterSequence = 0, limit = 200): BwExecutionEvent[] {
    return (this.db.query("SELECT * FROM bw_execution_events WHERE execution_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?").all(executionId, afterSequence, limit) as Array<Record<string, unknown>>).map(mapEvent);
  }

  // --- Approvals (fingerprint-bound, single-use) ----------------------------------------------------------

  insertApproval(approval: Omit<BwApproval, "id" | "createdAt" | "updatedAt">): BwApproval {
    const id = shortId("bwap");
    const now = nowIso();
    this.db
      .query("INSERT INTO bw_approvals (id, workspace_id, execution_id, requested_by_agent_id, action_type, action_summary, risk_level, action_fingerprint, request_payload_redacted_json, status, decision_by, decision_reason, expires_at, decided_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, approval.workspaceId, approval.executionId, approval.requestedByAgentId, approval.actionType, approval.actionSummary, approval.riskLevel, approval.actionFingerprint, approval.requestPayloadRedactedJson, approval.status, approval.decisionBy, approval.decisionReason, approval.expiresAt, approval.decidedAt, now, now);
    return this.getApproval(id) as BwApproval;
  }

  getApproval(id: string): BwApproval | null {
    const row = this.db.query("SELECT * FROM bw_approvals WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapApproval(row) : null;
  }

  updateApprovalStatus(id: string, status: BwApproval["status"], decidedBy: string | null, decisionReason: string | null): void {
    this.db
      .query("UPDATE bw_approvals SET status = ?, decision_by = ?, decision_reason = ?, decided_at = ?, updated_at = ? WHERE id = ?")
      .run(status, decidedBy, decisionReason, nowIso(), nowIso(), id);
  }

  listApprovals(workspaceId: string, status?: string, limit = 100): BwApproval[] {
    const rows = status
      ? (this.db.query("SELECT * FROM bw_approvals WHERE workspace_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?").all(workspaceId, status, limit) as Array<Record<string, unknown>>)
      : (this.db.query("SELECT * FROM bw_approvals WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?").all(workspaceId, limit) as Array<Record<string, unknown>>);
    return rows.map(mapApproval);
  }

  // --- Routines ---------------------------------------------------------------------------------------------

  insertRoutine(routine: Omit<BwRoutine, "id" | "createdAt" | "updatedAt">): BwRoutine {
    const id = shortId("bwrt");
    const now = nowIso();
    this.db
      .query("INSERT INTO bw_routines (id, workspace_id, name, owner_agent_id, owner_team_id, trigger_type, trigger_config_json, instruction_template, skill_slug, status, concurrency_policy, approval_policy_json, last_run_at, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, routine.workspaceId, routine.name, routine.ownerAgentId, routine.ownerTeamId, routine.triggerType, routine.triggerConfigJson, routine.instructionTemplate, routine.skillSlug, routine.status, routine.concurrencyPolicy, routine.approvalPolicyJson, routine.lastRunAt, routine.nextRunAt, now, now);
    return this.getRoutine(id) as BwRoutine;
  }

  getRoutine(id: string): BwRoutine | null {
    const row = this.db.query("SELECT * FROM bw_routines WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapRoutine(row) : null;
  }

  updateRoutine(id: string, patch: Partial<Omit<BwRoutine, "id" | "workspaceId" | "createdAt">>): BwRoutine {
    const existing = this.getRoutine(id);
    if (!existing) throw new Error("[NOT_FOUND] routine not found");
    const next = { ...existing, ...patch, updatedAt: nowIso() };
    this.db
      .query("UPDATE bw_routines SET name = ?, owner_agent_id = ?, owner_team_id = ?, trigger_type = ?, trigger_config_json = ?, instruction_template = ?, skill_slug = ?, status = ?, concurrency_policy = ?, approval_policy_json = ?, last_run_at = ?, next_run_at = ?, updated_at = ? WHERE id = ?")
      .run(next.name, next.ownerAgentId, next.ownerTeamId, next.triggerType, next.triggerConfigJson, next.instructionTemplate, next.skillSlug, next.status, next.concurrencyPolicy, next.approvalPolicyJson, next.lastRunAt, next.nextRunAt, next.updatedAt, id);
    return next;
  }

  listRoutines(workspaceId: string, includeArchived = false): BwRoutine[] {
    const rows = includeArchived
      ? (this.db.query("SELECT * FROM bw_routines WHERE workspace_id = ? ORDER BY name").all(workspaceId) as Array<Record<string, unknown>>)
      : (this.db.query("SELECT * FROM bw_routines WHERE workspace_id = ? AND status NOT IN ('archived') ORDER BY name").all(workspaceId) as Array<Record<string, unknown>>);
    return rows.map(mapRoutine);
  }

  dueRoutines(nowIso: string): BwRoutine[] {
    return (this.db.query("SELECT * FROM bw_routines WHERE status = 'active' AND trigger_type = 'interval' AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at ASC LIMIT ?").all(nowIso, 20) as Array<Record<string, unknown>>).map(mapRoutine);
  }

  hasOpenRun(routineId: string): boolean {
    const row = this.db.query("SELECT COUNT(*) AS n FROM bw_routine_runs WHERE routine_id = ? AND status IN ('created','running')").get(routineId) as { n: number };
    return row.n > 0;
  }

  insertRoutineRun(run: Omit<BwRoutineRun, "id" | "createdAt">): BwRoutineRun {
    const id = shortId("bwrr");
    this.db
      .query("INSERT INTO bw_routine_runs (id, routine_id, trigger_source, status, root_execution_id, idempotency_key, started_at, completed_at, error_code, error_message_safe, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, run.routineId, run.triggerSource, run.status, run.rootExecutionId, run.idempotencyKey, run.startedAt, run.completedAt, run.errorCode, run.errorMessageSafe, nowIso());
    return this.getRoutineRun(id) as BwRoutineRun;
  }

  getRoutineRun(id: string): BwRoutineRun | null {
    const row = this.db.query("SELECT * FROM bw_routine_runs WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapRun(row) : null;
  }

  findRoutineRunByIdempotencyKey(routineId: string, idempotencyKey: string): BwRoutineRun | null {
    const row = this.db.query("SELECT * FROM bw_routine_runs WHERE routine_id = ? AND idempotency_key = ? LIMIT 1").get(routineId, idempotencyKey) as Record<string, unknown> | null;
    return row ? mapRun(row) : null;
  }

  updateRoutineRun(id: string, patch: Partial<Pick<BwRoutineRun, "status" | "rootExecutionId" | "startedAt" | "completedAt" | "errorCode" | "errorMessageSafe">>): void {
    const existing = this.getRoutineRun(id);
    if (!existing) throw new Error("[NOT_FOUND] routine run not found");
    const next = { ...existing, ...patch };
    this.db
      .query("UPDATE bw_routine_runs SET status = ?, root_execution_id = ?, started_at = ?, completed_at = ?, error_code = ?, error_message_safe = ? WHERE id = ?")
      .run(next.status, next.rootExecutionId, next.startedAt, next.completedAt, next.errorCode, next.errorMessageSafe, id);
  }

  listRoutineRuns(routineId: string, limit = 50): BwRoutineRun[] {
    return (this.db.query("SELECT * FROM bw_routine_runs WHERE routine_id = ? ORDER BY created_at DESC LIMIT ?").all(routineId, limit) as Array<Record<string, unknown>>).map(mapRun);
  }

  // --- Audit (redacted at caller) -----------------------------------------------------------------------------

  insertAudit(event: { workspaceId: string; actorType: string; actorId: string | null; action: string; targetType: string | null; targetId: string | null; outcome?: string; metadataJson?: string }): void {
    this.db
      .query("INSERT INTO bw_audit_events (id, workspace_id, actor_type, actor_id, action, target_type, target_id, outcome, metadata_redacted_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(shortId("bwau"), event.workspaceId, event.actorType, event.actorId, event.action, event.targetType, event.targetId, event.outcome ?? "ok", event.metadataJson ?? null, nowIso());
  }

  listAudit(workspaceId: string, limit = 100): Array<{ id: string; action: string; actorType: string; actorId: string | null; targetId: string | null; outcome: string; createdAt: string }> {
    return (this.db.query("SELECT * FROM bw_audit_events WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?").all(workspaceId, limit) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id), action: String(row.action), actorType: String(row.actor_type), actorId: row.actor_id ? String(row.actor_id) : null,
      targetId: row.target_id ? String(row.target_id) : null, outcome: String(row.outcome), createdAt: String(row.created_at),
    }));
  }
}

function mapRound(row: Record<string, unknown>): BwGroupRound {
  return {
    id: String(row.id), conversationId: String(row.conversation_id), initiatingMessageId: String(row.initiating_message_id),
    orchestrationMode: String(row.orchestration_mode) as OrchestrationMode,
    requestedAgentOrder: JSON.parse(String(row.requested_agent_order_json)) as string[],
    resolvedAgentOrder: JSON.parse(String(row.resolved_agent_order_json)) as string[],
    status: String(row.status) as RoundStatus,
    currentPosition: Number(row.current_position ?? 0),
    failurePolicy: String(row.failure_policy) as FailurePolicy,
    stopReason: row.stop_reason ? String(row.stop_reason) : null,
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function mapExecution(row: Record<string, unknown>): BwAgentExecution {
  return {
    id: String(row.id),
    groupRoundId: row.group_round_id ? String(row.group_round_id) : null,
    routineRunId: row.routine_run_id ? String(row.routine_run_id) : null,
    agentId: String(row.agent_id),
    providerBindingId: row.provider_binding_id ? String(row.provider_binding_id) : null,
    runtimeBindingId: row.runtime_binding_id ? String(row.runtime_binding_id) : null,
    model: row.model ? String(row.model) : null,
    position: row.position == null ? null : Number(row.position),
    attempt: Number(row.attempt ?? 1),
    status: String(row.status) as ExecutionStatus,
    inputSnapshotRef: row.input_snapshot_ref ? String(row.input_snapshot_ref) : null,
    outputMessageId: row.output_message_id ? String(row.output_message_id) : null,
    errorCode: row.error_code ? String(row.error_code) : null,
    errorMessageSafe: row.error_message_safe ? String(row.error_message_safe) : null,
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function mapEvent(row: Record<string, unknown>): BwExecutionEvent {
  return {
    id: String(row.id), executionId: String(row.execution_id), sequence: Number(row.sequence),
    eventType: String(row.event_type), payloadJson: String(row.payload_json ?? "{}"), createdAt: String(row.created_at),
  };
}

function mapApproval(row: Record<string, unknown>): BwApproval {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id),
    executionId: row.execution_id ? String(row.execution_id) : null,
    requestedByAgentId: row.requested_by_agent_id ? String(row.requested_by_agent_id) : null,
    actionType: String(row.action_type), actionSummary: String(row.action_summary),
    riskLevel: String(row.risk_level) as RiskLevel,
    actionFingerprint: String(row.action_fingerprint),
    requestPayloadRedactedJson: String(row.request_payload_redacted_json ?? "{}"),
    status: String(row.status) as BwApproval["status"],
    decisionBy: row.decision_by ? String(row.decision_by) : null,
    decisionReason: row.decision_reason ? String(row.decision_reason) : null,
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    decidedAt: row.decided_at ? String(row.decided_at) : null,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function mapRoutine(row: Record<string, unknown>): BwRoutine {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), name: String(row.name),
    ownerAgentId: row.owner_agent_id ? String(row.owner_agent_id) : null,
    ownerTeamId: row.owner_team_id ? String(row.owner_team_id) : null,
    triggerType: String(row.trigger_type) as BwRoutine["triggerType"],
    triggerConfigJson: String(row.trigger_config_json ?? "{}"),
    instructionTemplate: String(row.instruction_template),
    skillSlug: row.skill_slug ? String(row.skill_slug) : null,
    status: String(row.status) as BwRoutine["status"],
    concurrencyPolicy: String(row.concurrency_policy) as BwRoutine["concurrencyPolicy"],
    approvalPolicyJson: String(row.approval_policy_json ?? "{}"),
    lastRunAt: row.last_run_at ? String(row.last_run_at) : null,
    nextRunAt: row.next_run_at ? String(row.next_run_at) : null,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function mapRun(row: Record<string, unknown>): BwRoutineRun {
  return {
    id: String(row.id), routineId: String(row.routine_id), triggerSource: String(row.trigger_source),
    status: String(row.status) as BwRoutineRun["status"],
    rootExecutionId: row.root_execution_id ? String(row.root_execution_id) : null,
    idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : null,
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    errorCode: row.error_code ? String(row.error_code) : null,
    errorMessageSafe: row.error_message_safe ? String(row.error_message_safe) : null,
    createdAt: String(row.created_at),
  };
}

export type { BwRoutineRun };
