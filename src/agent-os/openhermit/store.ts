// Phase 20.98 — OpenHermit persistence store over oh_* SQLite tables.
// Single-line bound SQL over oh_* tables; every statement uses ? placeholders.

import { openAgentOsDb } from "../db";
import { canonicalJson } from "../agent-runtime/hash";
import type {
  ActualAgentState,
  ApprovalState,
  AssignmentStatus,
  DesiredAgentState,
  HermitAgent,
  HermitAgentMcp,
  HermitAgentSkill,
  HermitApproval,
  HermitChannelBinding,
  HermitOperation,
  HermitResearchRun,
  HermitSession,
  OperationState,
  ResearchClaim,
  ResearchEvidence,
  ResearchRunState,
  ResearchSource,
  RiskClass,
  SessionStatus,
  SideEffectClass,
  SourceStatus,
  SupportType,
} from "./types";

export function nowIso(): string {
  return new Date().toISOString();
}

export function newOhId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

interface AgentRow {
  id: string;
  workspace_id: string;
  name: string;
  kind: string;
  desired_state: string;
  runtime_state: string;
  runtime_provider: string | null;
  runtime_agent_id: string | null;
  runtime_instance_id: string | null;
  blueprint_version: number;
  policy_profile: string;
  approval_profile: string;
  instruction_digest: string;
  drift: string | null;
  last_activity_at: string | null;
  cost_usd: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

function rowToAgent(r: AgentRow): HermitAgent {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    kind: r.kind as HermitAgent["kind"],
    desiredState: r.desired_state as DesiredAgentState,
    runtimeState: r.runtime_state as ActualAgentState,
    runtimeProvider: r.runtime_provider,
    runtimeAgentId: r.runtime_agent_id,
    runtimeInstanceId: r.runtime_instance_id,
    blueprintVersion: r.blueprint_version,
    policyProfile: r.policy_profile,
    approvalProfile: r.approval_profile,
    instructionDigest: r.instruction_digest,
    drift: r.drift,
    lastActivityAt: r.last_activity_at,
    costUsd: Number(r.cost_usd ?? 0),
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface SessionRow {
  id: string;
  agent_id: string;
  runtime_session_id: string | null;
  status: string;
  trace_id: string;
  actor_id: string;
  checkpoint_json: string | null;
  message_count: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

function rowToSession(r: SessionRow): HermitSession {
  return {
    id: r.id,
    agentId: r.agent_id,
    runtimeSessionId: r.runtime_session_id,
    status: r.status as SessionStatus,
    traceId: r.trace_id,
    actorId: r.actor_id,
    checkpointJson: r.checkpoint_json,
    messageCount: r.message_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    closedAt: r.closed_at,
  };
}

interface OpRow {
  id: string;
  agent_id: string | null;
  session_id: string | null;
  kind: string;
  state: string;
  idempotency_key: string;
  attempt: number;
  max_attempts: number;
  side_effect: string;
  checkpoint_json: string | null;
  request_json: string;
  result_json: string | null;
  error_redacted: string | null;
  approval_id: string | null;
  trace_id: string;
  cost_usd: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

function rowToOp(r: OpRow): HermitOperation {
  return {
    id: r.id,
    agentId: r.agent_id,
    sessionId: r.session_id,
    kind: r.kind,
    state: r.state as OperationState,
    idempotencyKey: r.idempotency_key,
    attempt: r.attempt,
    maxAttempts: r.max_attempts,
    sideEffect: r.side_effect as SideEffectClass,
    checkpointJson: r.checkpoint_json,
    requestJson: r.request_json,
    resultJson: r.result_json,
    errorRedacted: r.error_redacted,
    approvalId: r.approval_id,
    traceId: r.trace_id,
    costUsd: Number(r.cost_usd ?? 0),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
  };
}

interface ApprovalRow {
  id: string;
  agent_id: string | null;
  operation_id: string | null;
  action: string;
  target: string;
  action_hash: string;
  args_redacted_json: string;
  risk: string;
  ttl_ms: number;
  expires_at: string | null;
  state: string;
  requested_by: string;
  decided_by: string | null;
  decided_at: string | null;
  consumed_at: string | null;
  superseded_by: string | null;
  reason: string | null;
  created_at: string;
}

function rowToApproval(r: ApprovalRow): HermitApproval {
  return {
    id: r.id,
    agentId: r.agent_id,
    operationId: r.operation_id,
    action: r.action,
    target: r.target,
    actionHash: r.action_hash,
    argsRedactedJson: r.args_redacted_json,
    risk: r.risk as RiskClass,
    ttlMs: r.ttl_ms,
    expiresAt: r.expires_at,
    state: r.state as ApprovalState,
    requestedBy: r.requested_by,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    consumedAt: r.consumed_at,
    supersededBy: r.superseded_by,
    reason: r.reason,
    createdAt: r.created_at,
  };
}

export class OpenHermitStore {
  // -------------------------------------------------------------------------
  // Agents
  // -------------------------------------------------------------------------

  insertAgent(agent: HermitAgent): void {
    openAgentOsDb()
      .query(
        "INSERT INTO oh_agents (id, workspace_id, name, kind, desired_state, runtime_state, runtime_provider, runtime_agent_id, runtime_instance_id, blueprint_version, policy_profile, approval_profile, instruction_digest, drift, last_activity_at, cost_usd, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        agent.id,
        agent.workspaceId,
        agent.name,
        agent.kind,
        agent.desiredState,
        agent.runtimeState,
        agent.runtimeProvider,
        agent.runtimeAgentId,
        agent.runtimeInstanceId,
        agent.blueprintVersion,
        agent.policyProfile,
        agent.approvalProfile,
        agent.instructionDigest,
        agent.drift,
        agent.lastActivityAt,
        agent.costUsd,
        agent.createdBy,
        agent.createdAt,
        agent.updatedAt,
      );
  }

  getAgent(id: string): HermitAgent | null {
    const row = openAgentOsDb()
      .query("SELECT * FROM oh_agents WHERE id = ?")
      .get(id) as AgentRow | undefined;
    return row ? rowToAgent(row) : null;
  }

  listAgents(workspaceId?: string): HermitAgent[] {
    const db = openAgentOsDb();
    if (workspaceId !== undefined) {
      const rows = db
        .query("SELECT * FROM oh_agents WHERE workspace_id = ? ORDER BY updated_at DESC")
        .all(workspaceId) as AgentRow[];
      return rows.map(rowToAgent);
    }
    const rows = db.query("SELECT * FROM oh_agents ORDER BY updated_at DESC").all() as AgentRow[];
    return rows.map(rowToAgent);
  }

  updateAgentStates(
    id: string,
    updates: {
      desiredState?: DesiredAgentState;
      runtimeState?: ActualAgentState;
      runtimeAgentId?: string | null;
      runtimeProvider?: string | null;
      runtimeInstanceId?: string | null;
      drift?: string | null;
      lastActivityAt?: string;
      costUsdIncrement?: number;
    },
  ): HermitAgent | null {
    const current = this.getAgent(id);
    if (!current) return null;
    const nextDesired = updates.desiredState ?? current.desiredState;
    const nextRuntime = updates.runtimeState ?? current.runtimeState;
    const nextRId = updates.runtimeAgentId !== undefined ? updates.runtimeAgentId : current.runtimeAgentId;
    const nextProv = updates.runtimeProvider !== undefined ? updates.runtimeProvider : current.runtimeProvider;
    const nextInst = updates.runtimeInstanceId !== undefined ? updates.runtimeInstanceId : current.runtimeInstanceId;
    const nextDrift = updates.drift !== undefined ? updates.drift : current.drift;
    const nextAct = updates.lastActivityAt ?? current.lastActivityAt;
    const nextCost = current.costUsd + (updates.costUsdIncrement ?? 0);
    const now = nowIso();

    openAgentOsDb()
      .query(
        "UPDATE oh_agents SET desired_state = ?, runtime_state = ?, runtime_agent_id = ?, runtime_provider = ?, runtime_instance_id = ?, drift = ?, last_activity_at = ?, cost_usd = ?, updated_at = ? WHERE id = ?",
      )
      .run(nextDesired, nextRuntime, nextRId, nextProv, nextInst, nextDrift, nextAct, nextCost, now, id);

    return this.getAgent(id);
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  insertSession(session: HermitSession): void {
    openAgentOsDb()
      .query(
        "INSERT INTO oh_sessions (id, agent_id, runtime_session_id, status, trace_id, actor_id, checkpoint_json, message_count, created_at, updated_at, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        session.id,
        session.agentId,
        session.runtimeSessionId,
        session.status,
        session.traceId,
        session.actorId,
        session.checkpointJson,
        session.messageCount,
        session.createdAt,
        session.updatedAt,
        session.closedAt,
      );
  }

  getSession(id: string): HermitSession | null {
    const row = openAgentOsDb()
      .query("SELECT * FROM oh_sessions WHERE id = ?")
      .get(id) as SessionRow | undefined;
    return row ? rowToSession(row) : null;
  }

  listSessionsForAgent(agentId: string): HermitSession[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM oh_sessions WHERE agent_id = ? ORDER BY created_at DESC")
      .all(agentId) as SessionRow[];
    return rows.map(rowToSession);
  }

  updateSession(
    id: string,
    updates: {
      status?: SessionStatus;
      runtimeSessionId?: string | null;
      checkpointJson?: string | null;
      incrementMessages?: number;
      closedAt?: string | null;
    },
  ): HermitSession | null {
    const cur = this.getSession(id);
    if (!cur) return null;
    const nextStatus = updates.status ?? cur.status;
    const nextRId = updates.runtimeSessionId !== undefined ? updates.runtimeSessionId : cur.runtimeSessionId;
    const nextCp = updates.checkpointJson !== undefined ? updates.checkpointJson : cur.checkpointJson;
    const nextMsgs = cur.messageCount + (updates.incrementMessages ?? 0);
    const nextClosed = updates.closedAt !== undefined ? updates.closedAt : cur.closedAt;
    const now = nowIso();

    openAgentOsDb()
      .query(
        "UPDATE oh_sessions SET status = ?, runtime_session_id = ?, checkpoint_json = ?, message_count = ?, closed_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(nextStatus, nextRId, nextCp, nextMsgs, nextClosed, now, id);

    return this.getSession(id);
  }

  // -------------------------------------------------------------------------
  // Operations (state machine + idempotency)
  // -------------------------------------------------------------------------

  insertOperation(op: HermitOperation): void {
    openAgentOsDb()
      .query(
        "INSERT INTO oh_operations (id, agent_id, session_id, kind, state, idempotency_key, attempt, max_attempts, side_effect, checkpoint_json, request_json, result_json, error_redacted, approval_id, trace_id, cost_usd, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        op.id,
        op.agentId,
        op.sessionId,
        op.kind,
        op.state,
        op.idempotencyKey,
        op.attempt,
        op.maxAttempts,
        op.sideEffect,
        op.checkpointJson,
        op.requestJson,
        op.resultJson,
        op.errorRedacted,
        op.approvalId,
        op.traceId,
        op.costUsd,
        op.createdAt,
        op.updatedAt,
        op.completedAt,
      );
  }

  getOperation(id: string): HermitOperation | null {
    const row = openAgentOsDb()
      .query("SELECT * FROM oh_operations WHERE id = ?")
      .get(id) as OpRow | undefined;
    return row ? rowToOp(row) : null;
  }

  getOperationByIdempotencyKey(key: string): HermitOperation | null {
    const row = openAgentOsDb()
      .query("SELECT * FROM oh_operations WHERE idempotency_key = ?")
      .get(key) as OpRow | undefined;
    return row ? rowToOp(row) : null;
  }

  updateOperationState(
    id: string,
    updates: {
      state: OperationState;
      checkpointJson?: string | null;
      resultJson?: string | null;
      errorRedacted?: string | null;
      approvalId?: string | null;
      incrementAttempt?: boolean;
      costUsdIncrement?: number;
      completedAt?: string | null;
    },
  ): HermitOperation | null {
    const cur = this.getOperation(id);
    if (!cur) return null;
    const nextCp = updates.checkpointJson !== undefined ? updates.checkpointJson : cur.checkpointJson;
    const nextRes = updates.resultJson !== undefined ? updates.resultJson : cur.resultJson;
    const nextErr = updates.errorRedacted !== undefined ? updates.errorRedacted : cur.errorRedacted;
    const nextAppr = updates.approvalId !== undefined ? updates.approvalId : cur.approvalId;
    const nextAttempt = cur.attempt + (updates.incrementAttempt ? 1 : 0);
    const nextCost = cur.costUsd + (updates.costUsdIncrement ?? 0);
    const nextCompleted = updates.completedAt !== undefined ? updates.completedAt : cur.completedAt;
    const now = nowIso();

    openAgentOsDb()
      .query(
        "UPDATE oh_operations SET state = ?, checkpoint_json = ?, result_json = ?, error_redacted = ?, approval_id = ?, attempt = ?, cost_usd = ?, completed_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        updates.state,
        nextCp,
        nextRes,
        nextErr,
        nextAppr,
        nextAttempt,
        nextCost,
        nextCompleted,
        now,
        id,
      );

    return this.getOperation(id);
  }

  listIncompleteOperations(): HermitOperation[] {
    const rows = openAgentOsDb()
      .query(
        "SELECT * FROM oh_operations WHERE state NOT IN ('succeeded', 'cancelled', 'dead_letter') ORDER BY created_at ASC",
      )
      .all() as OpRow[];
    return rows.map(rowToOp);
  }

  // -------------------------------------------------------------------------
  // Approvals (exact-action hash-bound)
  // -------------------------------------------------------------------------

  insertApproval(appr: HermitApproval): void {
    openAgentOsDb()
      .query(
        "INSERT INTO oh_approvals (id, agent_id, operation_id, action, target, action_hash, args_redacted_json, risk, ttl_ms, expires_at, state, requested_by, decided_by, decided_at, consumed_at, superseded_by, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        appr.id,
        appr.agentId,
        appr.operationId,
        appr.action,
        appr.target,
        appr.actionHash,
        appr.argsRedactedJson,
        appr.risk,
        appr.ttlMs,
        appr.expiresAt,
        appr.state,
        appr.requestedBy,
        appr.decidedBy,
        appr.decidedAt,
        appr.consumedAt,
        appr.supersededBy,
        appr.reason,
        appr.createdAt,
      );
  }

  getApproval(id: string): HermitApproval | null {
    const row = openAgentOsDb()
      .query("SELECT * FROM oh_approvals WHERE id = ?")
      .get(id) as ApprovalRow | undefined;
    return row ? rowToApproval(row) : null;
  }

  findActiveApprovalByHash(actionHash: string): HermitApproval | null {
    const now = nowIso();
    const row = openAgentOsDb()
      .query(
        "SELECT * FROM oh_approvals WHERE action_hash = ? AND state = 'approved' AND consumed_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT 1",
      )
      .get(actionHash, now) as ApprovalRow | undefined;
    return row ? rowToApproval(row) : null;
  }

  listApprovals(filter?: { state?: ApprovalState; agentId?: string }): HermitApproval[] {
    const db = openAgentOsDb();
    if (filter?.state && filter?.agentId) {
      const rows = db
        .query("SELECT * FROM oh_approvals WHERE state = ? AND agent_id = ? ORDER BY created_at DESC")
        .all(filter.state, filter.agentId) as ApprovalRow[];
      return rows.map(rowToApproval);
    }
    if (filter?.state) {
      const rows = db
        .query("SELECT * FROM oh_approvals WHERE state = ? ORDER BY created_at DESC")
        .all(filter.state) as ApprovalRow[];
      return rows.map(rowToApproval);
    }
    if (filter?.agentId) {
      const rows = db
        .query("SELECT * FROM oh_approvals WHERE agent_id = ? ORDER BY created_at DESC")
        .all(filter.agentId) as ApprovalRow[];
      return rows.map(rowToApproval);
    }
    const rows = db.query("SELECT * FROM oh_approvals ORDER BY created_at DESC").all() as ApprovalRow[];
    return rows.map(rowToApproval);
  }

  decideApproval(
    id: string,
    state: "approved" | "rejected",
    decidedBy: string,
    reason?: string,
  ): HermitApproval | null {
    const now = nowIso();
    openAgentOsDb()
      .query(
        "UPDATE oh_approvals SET state = ?, decided_by = ?, decided_at = ?, reason = ? WHERE id = ? AND state = 'pending'",
      )
      .run(state, decidedBy, now, reason ?? null, id);
    return this.getApproval(id);
  }

  markApprovalConsumed(id: string): void {
    openAgentOsDb()
      .query("UPDATE oh_approvals SET consumed_at = ? WHERE id = ?")
      .run(nowIso(), id);
  }

  expirePendingApprovals(): number {
    const now = nowIso();
    const res = openAgentOsDb()
      .query(
        "UPDATE oh_approvals SET state = 'expired', decided_at = ? WHERE state = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?",
      )
      .run(now, now);
    return Number(res.changes ?? 0);
  }

  // -------------------------------------------------------------------------
  // Skills & MCP assignments
  // -------------------------------------------------------------------------

  upsertAgentSkill(skill: HermitAgentSkill): void {
    openAgentOsDb()
      .query(
        "INSERT INTO oh_agent_skills (id, agent_id, skill_id, version, provenance_hash, risk_class, status, assigned_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(agent_id, skill_id) DO UPDATE SET version = excluded.version, provenance_hash = excluded.provenance_hash, risk_class = excluded.risk_class, status = excluded.status, assigned_by = excluded.assigned_by, updated_at = excluded.updated_at",
      )
      .run(
        skill.id,
        skill.agentId,
        skill.skillId,
        skill.version,
        skill.provenanceHash,
        skill.riskClass,
        skill.status,
        skill.assignedBy,
        skill.createdAt,
        skill.updatedAt,
      );
  }

  listAgentSkills(agentId: string): HermitAgentSkill[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM oh_agent_skills WHERE agent_id = ? ORDER BY created_at ASC")
      .all(agentId) as Array<{
      id: string;
      agent_id: string;
      skill_id: string;
      version: string;
      provenance_hash: string;
      risk_class: string;
      status: string;
      assigned_by: string;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      agentId: r.agent_id,
      skillId: r.skill_id,
      version: r.version,
      provenanceHash: r.provenance_hash,
      riskClass: r.risk_class as RiskClass,
      status: r.status as AssignmentStatus,
      assignedBy: r.assigned_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  upsertAgentMcp(mcp: HermitAgentMcp): void {
    openAgentOsDb()
      .query(
        "INSERT INTO oh_agent_mcp (id, agent_id, server_id, tool_name, capability_json, risk_class, status, assigned_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        mcp.id,
        mcp.agentId,
        mcp.serverId,
        mcp.toolName,
        mcp.capabilityJson,
        mcp.riskClass,
        mcp.status,
        mcp.assignedBy,
        mcp.createdAt,
        mcp.updatedAt,
      );
  }

  listAgentMcp(agentId: string): HermitAgentMcp[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM oh_agent_mcp WHERE agent_id = ? ORDER BY created_at ASC")
      .all(agentId) as Array<{
      id: string;
      agent_id: string;
      server_id: string;
      tool_name: string | null;
      capability_json: string;
      risk_class: string;
      status: string;
      assigned_by: string;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      agentId: r.agent_id,
      serverId: r.server_id,
      toolName: r.tool_name,
      capabilityJson: r.capability_json,
      riskClass: r.risk_class as RiskClass,
      status: r.status as AssignmentStatus,
      assignedBy: r.assigned_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  // -------------------------------------------------------------------------
  // Research ledgers (spec §16, §17)
  // -------------------------------------------------------------------------

  insertResearchRun(run: HermitResearchRun): void {
    openAgentOsDb()
      .query(
        "INSERT INTO oh_research_runs (id, agent_id, question, state, plan_json, plan_hash, plan_approved_by, budget_json, spent_json, report_json, checkpoint_json, council_json, error_redacted, started_at, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        run.id,
        run.agentId,
        run.question,
        run.state,
        run.planJson,
        run.planHash,
        run.planApprovedBy,
        run.budgetJson,
        run.spentJson,
        run.reportJson,
        run.checkpointJson,
        run.councilJson,
        run.errorRedacted,
        run.startedAt,
        run.completedAt,
        run.createdAt,
        run.updatedAt,
      );
  }

  getResearchRun(id: string): HermitResearchRun | null {
    const r = openAgentOsDb()
      .query("SELECT * FROM oh_research_runs WHERE id = ?")
      .get(id) as
      | {
          id: string;
          agent_id: string | null;
          question: string;
          state: string;
          plan_json: string | null;
          plan_hash: string | null;
          plan_approved_by: string | null;
          budget_json: string;
          spent_json: string;
          report_json: string | null;
          checkpoint_json: string | null;
          council_json: string | null;
          error_redacted: string | null;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!r) return null;
    return {
      id: r.id,
      agentId: r.agent_id,
      question: r.question,
      state: r.state as ResearchRunState,
      planJson: r.plan_json,
      planHash: r.plan_hash,
      planApprovedBy: r.plan_approved_by,
      budgetJson: r.budget_json,
      spentJson: r.spent_json,
      reportJson: r.report_json,
      checkpointJson: r.checkpoint_json,
      councilJson: r.council_json,
      errorRedacted: r.error_redacted,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  updateResearchRun(
    id: string,
    updates: {
      state?: ResearchRunState;
      planJson?: string | null;
      planHash?: string | null;
      planApprovedBy?: string | null;
      spentJson?: string;
      reportJson?: string | null;
      checkpointJson?: string | null;
      councilJson?: string | null;
      errorRedacted?: string | null;
      startedAt?: string | null;
      completedAt?: string | null;
    },
  ): HermitResearchRun | null {
    const cur = this.getResearchRun(id);
    if (!cur) return null;
    const now = nowIso();
    openAgentOsDb()
      .query(
        "UPDATE oh_research_runs SET state = ?, plan_json = ?, plan_hash = ?, plan_approved_by = ?, spent_json = ?, report_json = ?, checkpoint_json = ?, council_json = ?, error_redacted = ?, started_at = ?, completed_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        updates.state ?? cur.state,
        updates.planJson !== undefined ? updates.planJson : cur.planJson,
        updates.planHash !== undefined ? updates.planHash : cur.planHash,
        updates.planApprovedBy !== undefined ? updates.planApprovedBy : cur.planApprovedBy,
        updates.spentJson ?? cur.spentJson,
        updates.reportJson !== undefined ? updates.reportJson : cur.reportJson,
        updates.checkpointJson !== undefined ? updates.checkpointJson : cur.checkpointJson,
        updates.councilJson !== undefined ? updates.councilJson : cur.councilJson,
        updates.errorRedacted !== undefined ? updates.errorRedacted : cur.errorRedacted,
        updates.startedAt !== undefined ? updates.startedAt : cur.startedAt,
        updates.completedAt !== undefined ? updates.completedAt : cur.completedAt,
        now,
        id,
      );
    return this.getResearchRun(id);
  }

  insertSource(s: ResearchSource): void {
    openAgentOsDb()
      .query(
        "INSERT INTO oh_research_sources (id, run_id, uri, title, content_hash, excerpt, status, rejection_reason, flagged, acquired_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        s.id,
        s.runId,
        s.uri,
        s.title,
        s.contentHash,
        s.excerpt,
        s.status,
        s.rejectionReason,
        s.flagged ? 1 : 0,
        s.acquiredAt,
      );
  }

  listSources(runId: string): ResearchSource[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM oh_research_sources WHERE run_id = ? ORDER BY acquired_at ASC")
      .all(runId) as Array<{
      id: string;
      run_id: string;
      uri: string;
      title: string | null;
      content_hash: string;
      excerpt: string;
      status: string;
      rejection_reason: string | null;
      flagged: number;
      acquired_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      uri: r.uri,
      title: r.title,
      contentHash: r.content_hash,
      excerpt: r.excerpt,
      status: r.status as SourceStatus,
      rejectionReason: r.rejection_reason,
      flagged: r.flagged === 1,
      acquiredAt: r.acquired_at,
    }));
  }

  insertClaim(c: ResearchClaim): void {
    openAgentOsDb()
      .query("INSERT INTO oh_research_claims (id, run_id, text, status, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(c.id, c.runId, c.text, c.status, c.createdAt);
  }

  listClaims(runId: string): ResearchClaim[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM oh_research_claims WHERE run_id = ? ORDER BY created_at ASC")
      .all(runId) as Array<{ id: string; run_id: string; text: string; status: string; created_at: string }>;
    return rows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      text: r.text,
      status: r.status as ResearchClaim["status"],
      createdAt: r.created_at,
    }));
  }

  updateClaimStatus(id: string, status: ResearchClaim["status"]): void {
    openAgentOsDb().query("UPDATE oh_research_claims SET status = ? WHERE id = ?").run(status, id);
  }

  insertEvidence(e: ResearchEvidence): void {
    openAgentOsDb()
      .query(
        "INSERT INTO oh_research_evidence (id, run_id, source_id, claim_id, excerpt, location, support, relevance, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(e.id, e.runId, e.sourceId, e.claimId, e.excerpt, e.location, e.support, e.relevance, e.createdAt);
  }

  listEvidence(runId: string): ResearchEvidence[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM oh_research_evidence WHERE run_id = ? ORDER BY created_at ASC")
      .all(runId) as Array<{
      id: string;
      run_id: string;
      source_id: string;
      claim_id: string | null;
      excerpt: string;
      location: string;
      support: string;
      relevance: number;
      created_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      sourceId: r.source_id,
      claimId: r.claim_id,
      excerpt: r.excerpt,
      location: r.location,
      support: r.support as SupportType,
      relevance: Number(r.relevance),
      createdAt: r.created_at,
    }));
  }

  // -------------------------------------------------------------------------
  // Channels + schedules
  // -------------------------------------------------------------------------

  upsertChannel(ch: HermitChannelBinding): void {
    openAgentOsDb()
      .query(
        "INSERT INTO oh_channels (id, channel, channel_identity, pao_identity, agent_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(channel, channel_identity) DO UPDATE SET pao_identity = excluded.pao_identity, agent_id = excluded.agent_id, status = excluded.status, updated_at = excluded.updated_at",
      )
      .run(
        ch.id,
        ch.channel,
        ch.channelIdentity,
        ch.paoIdentity,
        ch.agentId,
        ch.status,
        ch.createdAt,
        ch.updatedAt,
      );
  }

  listChannels(): HermitChannelBinding[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM oh_channels ORDER BY created_at ASC")
      .all() as Array<{
      id: string;
      channel: string;
      channel_identity: string;
      pao_identity: string;
      agent_id: string | null;
      status: string;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      channel: r.channel as HermitChannelBinding["channel"],
      channelIdentity: r.channel_identity,
      paoIdentity: r.pao_identity,
      agentId: r.agent_id,
      status: r.status as "active" | "disabled",
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  // -------------------------------------------------------------------------
  // Events / audit (spec §27, §29)
  // -------------------------------------------------------------------------

  appendEvent(input: {
    eventType: string;
    actor: string;
    agentId?: string | null;
    sessionId?: string | null;
    operationId?: string | null;
    payload?: Record<string, unknown>;
  }): void {
    const id = newOhId("ohev");
    openAgentOsDb()
      .query(
        "INSERT INTO oh_events (id, event_type, agent_id, session_id, operation_id, actor, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        input.eventType,
        input.agentId ?? null,
        input.sessionId ?? null,
        input.operationId ?? null,
        input.actor,
        canonicalJson(input.payload ?? {}),
        nowIso(),
      );
  }

  listEvents(filter?: { agentId?: string; eventType?: string; limit?: number }): Array<{
    id: string;
    eventType: string;
    agentId: string | null;
    sessionId: string | null;
    operationId: string | null;
    actor: string;
    payload: Record<string, unknown>;
    createdAt: string;
  }> {
    const limit = Math.min(200, Math.max(1, filter?.limit ?? 50));
    const db = openAgentOsDb();
    let rows: Array<{
      id: string;
      event_type: string;
      agent_id: string | null;
      session_id: string | null;
      operation_id: string | null;
      actor: string;
      payload_json: string;
      created_at: string;
    }>;
    if (filter?.agentId && filter?.eventType) {
      rows = db
        .query("SELECT * FROM oh_events WHERE agent_id = ? AND event_type = ? ORDER BY created_at DESC LIMIT ?")
        .all(filter.agentId, filter.eventType, limit) as typeof rows;
    } else if (filter?.agentId) {
      rows = db
        .query("SELECT * FROM oh_events WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?")
        .all(filter.agentId, limit) as typeof rows;
    } else if (filter?.eventType) {
      rows = db
        .query("SELECT * FROM oh_events WHERE event_type = ? ORDER BY created_at DESC LIMIT ?")
        .all(filter.eventType, limit) as typeof rows;
    } else {
      rows = db.query("SELECT * FROM oh_events ORDER BY created_at DESC LIMIT ?").all(limit) as typeof rows;
    }

    return rows.map((r) => {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(r.payload_json);
      } catch {}
      return {
        id: r.id,
        eventType: r.event_type,
        agentId: r.agent_id,
        sessionId: r.session_id,
        operationId: r.operation_id,
        actor: r.actor,
        payload: parsed,
        createdAt: r.created_at,
      };
    });
  }
}
