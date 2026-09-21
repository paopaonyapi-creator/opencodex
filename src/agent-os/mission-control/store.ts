// Phase 21.02 — Mission Control Store over SQLite tables (mc_*).

import { openAgentOsDb } from "../db";
import type {
  MissionControlAgent,
  MissionControlAgentStatus,
  MissionControlApproval,
  MissionControlAuditLog,
  MissionControlCostUsage,
  MissionControlDlqItem,
  MissionControlIncident,
  MissionControlOverviewKpi,
  MissionControlQueue,
  MissionControlRun,
  MissionControlRunEvent,
  MissionControlRunStatus,
} from "./types";

export function nowIso(): string {
  return new Date().toISOString();
}

export function newMissionControlId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export class MissionControlStore {
  // -------------------------------------------------------------------------
  // Agents
  // -------------------------------------------------------------------------
  upsertAgent(agent: MissionControlAgent): void {
    openAgentOsDb()
      .query(`
        INSERT INTO mc_agents (
          id, name, agent_type, status, host_id, provider, model, current_run_id,
          last_heartbeat, queue_depth, active_tools_json, capabilities_json,
          skills_json, mcp_servers_json, allowed_providers_json, allowed_hosts_json,
          risk_ceiling, takeover_state, total_tokens, estimated_cost, last_error,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          agent_type = excluded.agent_type,
          status = excluded.status,
          host_id = excluded.host_id,
          provider = excluded.provider,
          model = excluded.model,
          current_run_id = excluded.current_run_id,
          last_heartbeat = excluded.last_heartbeat,
          queue_depth = excluded.queue_depth,
          active_tools_json = excluded.active_tools_json,
          capabilities_json = excluded.capabilities_json,
          skills_json = excluded.skills_json,
          mcp_servers_json = excluded.mcp_servers_json,
          allowed_providers_json = excluded.allowed_providers_json,
          allowed_hosts_json = excluded.allowed_hosts_json,
          risk_ceiling = excluded.risk_ceiling,
          takeover_state = excluded.takeover_state,
          total_tokens = excluded.total_tokens,
          estimated_cost = excluded.estimated_cost,
          last_error = excluded.last_error,
          updated_at = excluded.updated_at
      `)
      .run(
        agent.id,
        agent.name,
        agent.agentType,
        agent.status,
        agent.hostId ?? null,
        agent.provider ?? null,
        agent.model ?? null,
        agent.currentRunId ?? null,
        agent.lastHeartbeat ?? null,
        agent.queueDepth,
        JSON.stringify(agent.activeTools || []),
        JSON.stringify(agent.capabilities || []),
        JSON.stringify(agent.skills || []),
        JSON.stringify(agent.mcpServers || []),
        JSON.stringify(agent.allowedProviders || ["*"]),
        JSON.stringify(agent.allowedHosts || ["*"]),
        agent.riskCeiling,
        agent.takeoverState,
        agent.totalTokens,
        agent.estimatedCost,
        agent.lastError ?? null,
        agent.createdAt,
        agent.updatedAt,
      );
  }

  getAgent(id: string): MissionControlAgent | null {
    const r = openAgentOsDb()
      .query("SELECT * FROM mc_agents WHERE id = ?")
      .get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      agentType: r.agent_type,
      status: r.status,
      hostId: r.host_id,
      provider: r.provider,
      model: r.model,
      currentRunId: r.current_run_id,
      lastHeartbeat: r.last_heartbeat,
      queueDepth: Number(r.queue_depth || 0),
      activeTools: JSON.parse(r.active_tools_json || "[]"),
      capabilities: JSON.parse(r.capabilities_json || "[]"),
      skills: JSON.parse(r.skills_json || "[]"),
      mcpServers: JSON.parse(r.mcp_servers_json || "[]"),
      allowedProviders: JSON.parse(r.allowed_providers_json || '["*"]'),
      allowedHosts: JSON.parse(r.allowed_hosts_json || '["*"]'),
      riskCeiling: r.risk_ceiling,
      takeoverState: r.takeover_state,
      totalTokens: Number(r.total_tokens || 0),
      estimatedCost: Number(r.estimated_cost || 0),
      lastError: r.last_error,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  listAgents(): MissionControlAgent[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM mc_agents ORDER BY name ASC")
      .all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      agentType: r.agent_type,
      status: r.status,
      hostId: r.host_id,
      provider: r.provider,
      model: r.model,
      currentRunId: r.current_run_id,
      lastHeartbeat: r.last_heartbeat,
      queueDepth: Number(r.queue_depth || 0),
      activeTools: JSON.parse(r.active_tools_json || "[]"),
      capabilities: JSON.parse(r.capabilities_json || "[]"),
      skills: JSON.parse(r.skills_json || "[]"),
      mcpServers: JSON.parse(r.mcp_servers_json || "[]"),
      allowedProviders: JSON.parse(r.allowed_providers_json || '["*"]'),
      allowedHosts: JSON.parse(r.allowed_hosts_json || '["*"]'),
      riskCeiling: r.risk_ceiling,
      takeoverState: r.takeover_state,
      totalTokens: Number(r.total_tokens || 0),
      estimatedCost: Number(r.estimated_cost || 0),
      lastError: r.last_error,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  updateAgentStatus(id: string, status: MissionControlAgentStatus, error?: string | null): void {
    openAgentOsDb()
      .query("UPDATE mc_agents SET status = ?, last_error = ?, updated_at = ? WHERE id = ?")
      .run(status, error ?? null, nowIso(), id);
  }

  updateAgentHeartbeat(id: string): void {
    openAgentOsDb()
      .query("UPDATE mc_agents SET last_heartbeat = ?, updated_at = ? WHERE id = ?")
      .run(nowIso(), nowIso(), id);
  }

  // -------------------------------------------------------------------------
  // Runs
  // -------------------------------------------------------------------------
  createRun(run: MissionControlRun): void {
    openAgentOsDb()
      .query(`
        INSERT INTO mc_runs (
          id, workflow_id, agent_id, parent_run_id, status, priority, provider, model,
          host, current_step, input_tokens, output_tokens, cached_tokens, reasoning_tokens,
          estimated_cost, retry_count, max_retries, approval_state, execution_snapshot_json,
          error_code, error_message, started_at, completed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        run.id,
        run.workflowId ?? null,
        run.agentId ?? null,
        run.parentRunId ?? null,
        run.status,
        run.priority,
        run.provider ?? null,
        run.model ?? null,
        run.host ?? null,
        run.currentStep ?? null,
        run.inputTokens,
        run.outputTokens,
        run.cachedTokens,
        run.reasoningTokens,
        run.estimatedCost,
        run.retryCount,
        run.maxRetries,
        run.approvalState ?? null,
        run.executionSnapshot ? JSON.stringify(run.executionSnapshot) : null,
        run.errorCode ?? null,
        run.errorMessage ?? null,
        run.startedAt ?? null,
        run.completedAt ?? null,
        run.createdAt,
        run.updatedAt,
      );
  }

  getRun(id: string): MissionControlRun | null {
    const r = openAgentOsDb()
      .query("SELECT * FROM mc_runs WHERE id = ?")
      .get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      workflowId: r.workflow_id,
      agentId: r.agent_id,
      parentRunId: r.parent_run_id,
      status: r.status,
      priority: Number(r.priority || 100),
      provider: r.provider,
      model: r.model,
      host: r.host,
      currentStep: r.current_step,
      inputTokens: Number(r.input_tokens || 0),
      outputTokens: Number(r.output_tokens || 0),
      cachedTokens: Number(r.cached_tokens || 0),
      reasoningTokens: Number(r.reasoning_tokens || 0),
      estimatedCost: Number(r.estimated_cost || 0),
      retryCount: Number(r.retry_count || 0),
      maxRetries: Number(r.max_retries || 3),
      approvalState: r.approval_state,
      executionSnapshot: r.execution_snapshot_json ? JSON.parse(r.execution_snapshot_json) : null,
      errorCode: r.error_code,
      errorMessage: r.error_message,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  listRuns(limit = 100): MissionControlRun[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM mc_runs ORDER BY created_at DESC LIMIT ?")
      .all(limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      workflowId: r.workflow_id,
      agentId: r.agent_id,
      parentRunId: r.parent_run_id,
      status: r.status,
      priority: Number(r.priority || 100),
      provider: r.provider,
      model: r.model,
      host: r.host,
      currentStep: r.current_step,
      inputTokens: Number(r.input_tokens || 0),
      outputTokens: Number(r.output_tokens || 0),
      cachedTokens: Number(r.cached_tokens || 0),
      reasoningTokens: Number(r.reasoning_tokens || 0),
      estimatedCost: Number(r.estimated_cost || 0),
      retryCount: Number(r.retry_count || 0),
      maxRetries: Number(r.max_retries || 3),
      approvalState: r.approval_state,
      executionSnapshot: r.execution_snapshot_json ? JSON.parse(r.execution_snapshot_json) : null,
      errorCode: r.error_code,
      errorMessage: r.error_message,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  updateRunStatus(id: string, status: MissionControlRunStatus, err?: { code?: string; message?: string }): void {
    const now = nowIso();
    const completed = status === "COMPLETED" || status === "FAILED" || status === "CANCELLED" ? now : null;
    openAgentOsDb()
      .query(`
        UPDATE mc_runs SET
          status = ?,
          error_code = COALESCE(?, error_code),
          error_message = COALESCE(?, error_message),
          completed_at = COALESCE(?, completed_at),
          updated_at = ?
        WHERE id = ?
      `)
      .run(status, err?.code ?? null, err?.message ?? null, completed, now, id);
  }

  // -------------------------------------------------------------------------
  // Run Events
  // -------------------------------------------------------------------------
  addRunEvent(event: MissionControlRunEvent): void {
    openAgentOsDb()
      .query("INSERT INTO mc_run_events (id, run_id, agent_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(
        event.id,
        event.runId,
        event.agentId ?? null,
        event.eventType,
        JSON.stringify(event.payload || {}),
        event.createdAt,
      );
  }

  listRunEvents(runId: string): MissionControlRunEvent[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM mc_run_events WHERE run_id = ? ORDER BY created_at ASC")
      .all(runId) as any[];
    return rows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      agentId: r.agent_id,
      eventType: r.event_type,
      payload: JSON.parse(r.payload_json || "{}"),
      createdAt: r.created_at,
    }));
  }

  // -------------------------------------------------------------------------
  // Approvals
  // -------------------------------------------------------------------------
  createApproval(app: MissionControlApproval): void {
    openAgentOsDb()
      .query(`
        INSERT INTO mc_approvals (
          id, run_id, agent_id, action, risk_level, policy_rule, status, requested_by, requested_at, resolved_at, resolved_by, decision_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        app.id,
        app.runId,
        app.agentId ?? null,
        app.action,
        app.riskLevel,
        app.policyRule ?? null,
        app.status,
        app.requestedBy ?? null,
        app.requestedAt,
        app.resolvedAt ?? null,
        app.resolvedBy ?? null,
        app.decisionReason ?? null,
      );
  }

  getApproval(id: string): MissionControlApproval | null {
    const r = openAgentOsDb()
      .query("SELECT * FROM mc_approvals WHERE id = ?")
      .get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      runId: r.run_id,
      agentId: r.agent_id,
      action: r.action,
      riskLevel: r.risk_level,
      policyRule: r.policy_rule,
      status: r.status,
      requestedBy: r.requested_by,
      requestedAt: r.requested_at,
      resolvedAt: r.resolved_at,
      resolvedBy: r.resolved_by,
      decisionReason: r.decision_reason,
    };
  }

  listApprovals(status?: string): MissionControlApproval[] {
    let query = "SELECT * FROM mc_approvals";
    const params: any[] = [];
    if (status) {
      query += " WHERE status = ?";
      params.push(status);
    }
    query += " ORDER BY requested_at DESC";
    const rows = openAgentOsDb().query(query).all(...params) as any[];
    return rows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      agentId: r.agent_id,
      action: r.action,
      riskLevel: r.risk_level,
      policyRule: r.policy_rule,
      status: r.status,
      requestedBy: r.requested_by,
      requestedAt: r.requested_at,
      resolvedAt: r.resolved_at,
      resolvedBy: r.resolved_by,
      decisionReason: r.decision_reason,
    }));
  }

  resolveApproval(id: string, status: "APPROVED" | "REJECTED" | "ESCALATED", resolvedBy: string, reason?: string): void {
    openAgentOsDb()
      .query("UPDATE mc_approvals SET status = ?, resolved_by = ?, resolved_at = ?, decision_reason = ? WHERE id = ?")
      .run(status, resolvedBy, nowIso(), reason ?? null, id);
  }

  // -------------------------------------------------------------------------
  // Queues & DLQ
  // -------------------------------------------------------------------------
  upsertQueue(q: MissionControlQueue): void {
    openAgentOsDb()
      .query(`
        INSERT INTO mc_queues (id, name, status, priority, concurrency_limit, active_runs_count, paused_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          status = excluded.status,
          priority = excluded.priority,
          concurrency_limit = excluded.concurrency_limit,
          active_runs_count = excluded.active_runs_count,
          paused_at = excluded.paused_at,
          updated_at = excluded.updated_at
      `)
      .run(
        q.id,
        q.name,
        q.status,
        q.priority,
        q.concurrencyLimit,
        q.activeRunsCount,
        q.pausedAt ?? null,
        q.createdAt,
        q.updatedAt,
      );
  }

  listQueues(): MissionControlQueue[] {
    const rows = openAgentOsDb().query("SELECT * FROM mc_queues ORDER BY priority DESC").all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      priority: Number(r.priority || 100),
      concurrencyLimit: Number(r.concurrency_limit || 5),
      activeRunsCount: Number(r.active_runs_count || 0),
      pausedAt: r.paused_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  addDlqItem(item: MissionControlDlqItem): void {
    openAgentOsDb()
      .query(`
        INSERT INTO mc_dlq (
          id, run_id, agent_id, failure_reason, stack_trace, retry_count, last_provider,
          last_model, input_snapshot_json, tool_context_json, policy_context_json, status, resolved_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        item.id,
        item.runId,
        item.agentId ?? null,
        item.failureReason,
        item.stackTrace ?? null,
        item.retryCount,
        item.lastProvider ?? null,
        item.lastModel ?? null,
        JSON.stringify(item.inputSnapshot || {}),
        JSON.stringify(item.toolContext || {}),
        JSON.stringify(item.policyContext || {}),
        item.status,
        item.resolvedAt ?? null,
        item.createdAt,
      );
  }

  listDlqItems(status?: string): MissionControlDlqItem[] {
    let query = "SELECT * FROM mc_dlq";
    const params: any[] = [];
    if (status) {
      query += " WHERE status = ?";
      params.push(status);
    }
    query += " ORDER BY created_at DESC";
    const rows = openAgentOsDb().query(query).all(...params) as any[];
    return rows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      agentId: r.agent_id,
      failureReason: r.failure_reason,
      stackTrace: r.stack_trace,
      retryCount: Number(r.retry_count || 0),
      lastProvider: r.last_provider,
      lastModel: r.last_model,
      inputSnapshot: JSON.parse(r.input_snapshot_json || "{}"),
      toolContext: JSON.parse(r.tool_context_json || "{}"),
      policyContext: JSON.parse(r.policy_context_json || "{}"),
      status: r.status,
      resolvedAt: r.resolved_at,
      createdAt: r.created_at,
    }));
  }

  // -------------------------------------------------------------------------
  // Incidents & Emergency Stop
  // -------------------------------------------------------------------------
  setIncident(incident: MissionControlIncident): void {
    openAgentOsDb()
      .query(`
        INSERT INTO mc_incidents (id, mode, title, description, trigger_reason, created_by, resolved_by, resolved_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          mode = excluded.mode,
          title = excluded.title,
          description = excluded.description,
          trigger_reason = excluded.trigger_reason,
          resolved_by = excluded.resolved_by,
          resolved_at = excluded.resolved_at
      `)
      .run(
        incident.id,
        incident.mode,
        incident.title,
        incident.description ?? null,
        incident.triggerReason,
        incident.createdBy,
        incident.resolvedBy ?? null,
        incident.resolvedAt ?? null,
        incident.createdAt,
      );
  }

  getLatestIncident(): MissionControlIncident | null {
    const r = openAgentOsDb().query("SELECT * FROM mc_incidents ORDER BY created_at DESC LIMIT 1").get() as any;
    if (!r) return null;
    return {
      id: r.id,
      mode: r.mode,
      title: r.title,
      description: r.description,
      triggerReason: r.trigger_reason,
      createdBy: r.created_by,
      resolvedBy: r.resolved_by,
      resolvedAt: r.resolved_at,
      createdAt: r.created_at,
    };
  }

  // -------------------------------------------------------------------------
  // Audit Logs
  // -------------------------------------------------------------------------
  addAuditLog(log: MissionControlAuditLog): void {
    openAgentOsDb()
      .query(`
        INSERT INTO mc_audit_logs (
          id, actor, actor_type, action, resource_type, resource_id, before_state, after_state, reason, ip_address, session_id, correlation_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        log.id,
        log.actor,
        log.actorType,
        log.action,
        log.resourceType,
        log.resourceId,
        log.beforeState ?? null,
        log.afterState ?? null,
        log.reason ?? null,
        log.ipAddress ?? null,
        log.sessionId ?? null,
        log.correlationId,
        log.createdAt,
      );
  }

  listAuditLogs(limit = 100): MissionControlAuditLog[] {
    const rows = openAgentOsDb().query("SELECT * FROM mc_audit_logs ORDER BY created_at DESC LIMIT ?").all(limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      actor: r.actor,
      actorType: r.actor_type,
      action: r.action,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      beforeState: r.before_state,
      afterState: r.after_state,
      reason: r.reason,
      ipAddress: r.ip_address,
      sessionId: r.session_id,
      correlationId: r.correlation_id,
      createdAt: r.created_at,
    }));
  }

  // -------------------------------------------------------------------------
  // Overview / KPI Aggregations
  // -------------------------------------------------------------------------
  getOverviewKpi(): MissionControlOverviewKpi {
    const db = openAgentOsDb();
    const activeAgents = (db.query("SELECT COUNT(*) as c FROM mc_agents WHERE status IN ('RUNNING', 'STARTING', 'WAITING_APPROVAL')").get() as any).c || 0;
    const offlineAgents = (db.query("SELECT COUNT(*) as c FROM mc_agents WHERE status = 'OFFLINE'").get() as any).c || 0;
    const activeRuns = (db.query("SELECT COUNT(*) as c FROM mc_runs WHERE status IN ('RUNNING', 'STARTING', 'WAITING_APPROVAL')").get() as any).c || 0;
    const waitingApproval = (db.query("SELECT COUNT(*) as c FROM mc_approvals WHERE status = 'PENDING'").get() as any).c || 0;
    const failedRuns = (db.query("SELECT COUNT(*) as c FROM mc_runs WHERE status = 'FAILED'").get() as any).c || 0;
    const queueDepth = (db.query("SELECT COUNT(*) as c FROM mc_runs WHERE status = 'QUEUED'").get() as any).c || 0;
    const costToday = (db.query("SELECT SUM(cost_usd) as s FROM mc_cost_usage").get() as any).s || 0;
    const tokensToday = (db.query("SELECT SUM(input_tokens + output_tokens) as s FROM mc_cost_usage").get() as any).s || 0;
    const latestInc = this.getLatestIncident();
    const incidentMode = latestInc ? latestInc.mode : "NORMAL";

    return {
      activeAgents: Number(activeAgents),
      activeRuns: Number(activeRuns),
      waitingApproval: Number(waitingApproval),
      queueDepth: Number(queueDepth),
      failedRuns: Number(failedRuns),
      offlineAgents: Number(offlineAgents),
      costTodayUsd: Number(costToday),
      tokensToday: Number(tokensToday),
      incidentMode,
    };
  }
}
