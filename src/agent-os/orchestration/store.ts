// Phase 20.22 — Pao-hubPro x LangChain Agent Orchestration & MCP Runtime Layer
// SQLite Persistence Layer for Orchestration Subsystem.

import { openAgentOsDb } from "../db";
import type {
  OrchestrationRun,
  OrchestrationEvent,
  OrchestrationCheckpoint,
  OrchestrationApproval,
  OrchestrationToolCall,
  OrchestrationMcpServer,
  OrchestrationRunStatus,
  ApprovalStatus,
  ToolRiskLevel,
  McpTrustLevel,
  AgentRuntimeType,
} from "./types";

export class OrchestrationStore {
  private get db() {
    return openAgentOsDb();
  }

  // ── Runs ─────────────────────────────────────────────────────────────
  upsertRun(run: OrchestrationRun): void {
    const stmt = this.db.query(`
      INSERT INTO orchestration_runs (
        id, session_id, workflow_id, runtime_type, status, prompt,
        resolved_prompt, primary_model, fallback_model, model_call_count,
        tool_call_count, total_input_tokens, total_output_tokens, total_cost_usd,
        max_model_calls, max_tool_calls, timeout_ms, output_text,
        structured_output_json, error_text, error_code, metadata_json,
        created_at, started_at, completed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        session_id = excluded.session_id,
        workflow_id = excluded.workflow_id,
        runtime_type = excluded.runtime_type,
        status = excluded.status,
        prompt = excluded.prompt,
        resolved_prompt = excluded.resolved_prompt,
        primary_model = excluded.primary_model,
        fallback_model = excluded.fallback_model,
        model_call_count = excluded.model_call_count,
        tool_call_count = excluded.tool_call_count,
        total_input_tokens = excluded.total_input_tokens,
        total_output_tokens = excluded.total_output_tokens,
        total_cost_usd = excluded.total_cost_usd,
        max_model_calls = excluded.max_model_calls,
        max_tool_calls = excluded.max_tool_calls,
        timeout_ms = excluded.timeout_ms,
        output_text = excluded.output_text,
        structured_output_json = excluded.structured_output_json,
        error_text = excluded.error_text,
        error_code = excluded.error_code,
        metadata_json = excluded.metadata_json,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      run.id,
      run.sessionId ?? null,
      run.workflowId ?? null,
      run.runtimeType,
      run.status,
      run.prompt,
      run.resolvedPrompt ?? null,
      run.primaryModel,
      run.fallbackModel ?? null,
      run.modelCallCount,
      run.toolCallCount,
      run.totalInputTokens,
      run.totalOutputTokens,
      run.totalCostUsd,
      run.maxModelCalls,
      run.maxToolCalls,
      run.timeoutMs,
      run.outputText ?? null,
      run.structuredOutputJson ?? null,
      run.errorText ?? null,
      run.errorCode ?? null,
      JSON.stringify(run.metadata || {}),
      run.createdAt,
      run.startedAt ?? null,
      run.completedAt ?? null,
      run.updatedAt
    );
  }

  getRun(id: string): OrchestrationRun | null {
    const row = this.db.query("SELECT * FROM orchestration_runs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapRun(row);
  }

  listRuns(limit = 50, status?: OrchestrationRunStatus): OrchestrationRun[] {
    if (status) {
      const rows = this.db
        .query("SELECT * FROM orchestration_runs WHERE status = ? ORDER BY created_at DESC LIMIT ?")
        .all(status, limit) as Record<string, unknown>[];
      return rows.map((r) => this.mapRun(r));
    }
    const rows = this.db
      .query("SELECT * FROM orchestration_runs ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => this.mapRun(r));
  }

  updateRunStatus(
    id: string,
    status: OrchestrationRunStatus,
    extra?: {
      outputText?: string;
      structuredOutputJson?: string;
      errorText?: string;
      errorCode?: string;
      completedAt?: string;
      modelCallCount?: number;
      toolCallCount?: number;
      totalInputTokens?: number;
      totalOutputTokens?: number;
      totalCostUsd?: number;
    }
  ): void {
    const existing = this.getRun(id);
    if (!existing) return;

    const now = new Date().toISOString();
    existing.status = status;
    existing.updatedAt = now;
    if (extra?.outputText !== undefined) existing.outputText = extra.outputText;
    if (extra?.structuredOutputJson !== undefined) existing.structuredOutputJson = extra.structuredOutputJson;
    if (extra?.errorText !== undefined) existing.errorText = extra.errorText;
    if (extra?.errorCode !== undefined) existing.errorCode = extra.errorCode;
    if (extra?.completedAt !== undefined) existing.completedAt = extra.completedAt;
    if (extra?.modelCallCount !== undefined) existing.modelCallCount = extra.modelCallCount;
    if (extra?.toolCallCount !== undefined) existing.toolCallCount = extra.toolCallCount;
    if (extra?.totalInputTokens !== undefined) existing.totalInputTokens = extra.totalInputTokens;
    if (extra?.totalOutputTokens !== undefined) existing.totalOutputTokens = extra.totalOutputTokens;
    if (extra?.totalCostUsd !== undefined) existing.totalCostUsd = extra.totalCostUsd;

    this.upsertRun(existing);
  }

  // ── Events ───────────────────────────────────────────────────────────
  recordEvent(event: OrchestrationEvent): void {
    const stmt = this.db.query(`
      INSERT INTO orchestration_events (
        id, run_id, sequence_number, event_type, agent_role, tool_name,
        input_payload_json, output_payload_json, duration_ms, tokens_used, cost_usd, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      event.id,
      event.runId,
      event.sequenceNumber,
      event.eventType,
      event.agentRole ?? null,
      event.toolName ?? null,
      event.inputPayload ? JSON.stringify(event.inputPayload) : null,
      event.outputPayload ? JSON.stringify(event.outputPayload) : null,
      event.durationMs ?? null,
      event.tokensUsed ?? null,
      event.costUsd ?? null,
      event.timestamp
    );
  }

  listEventsForRun(runId: string): OrchestrationEvent[] {
    const rows = this.db.query(
      "SELECT * FROM orchestration_events WHERE run_id = ? ORDER BY sequence_number ASC"
    ).all(runId) as Record<string, unknown>[];
    return rows.map((r) => this.mapEvent(r));
  }

  // ── Checkpoints ──────────────────────────────────────────────────────
  saveCheckpoint(checkpoint: OrchestrationCheckpoint): void {
    const stmt = this.db.query(`
      INSERT INTO orchestration_checkpoints (
        id, run_id, step_number, state_hash, state_json, pending_action_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, step_number) DO UPDATE SET
        state_hash = excluded.state_hash,
        state_json = excluded.state_json,
        pending_action_json = excluded.pending_action_json,
        created_at = excluded.created_at
    `);
    stmt.run(
      checkpoint.id,
      checkpoint.runId,
      checkpoint.stepNumber,
      checkpoint.stateHash,
      JSON.stringify(checkpoint.state),
      checkpoint.pendingAction ? JSON.stringify(checkpoint.pendingAction) : null,
      checkpoint.createdAt
    );
  }

  getLatestCheckpoint(runId: string): OrchestrationCheckpoint | null {
    const row = this.db.query(
      "SELECT * FROM orchestration_checkpoints WHERE run_id = ? ORDER BY step_number DESC LIMIT 1"
    ).get(runId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapCheckpoint(row);
  }

  listCheckpointsForRun(runId: string): OrchestrationCheckpoint[] {
    const rows = this.db.query(
      "SELECT * FROM orchestration_checkpoints WHERE run_id = ? ORDER BY step_number ASC"
    ).all(runId) as Record<string, unknown>[];
    return rows.map((r) => this.mapCheckpoint(r));
  }

  // ── Approvals ────────────────────────────────────────────────────────
  createApproval(approval: OrchestrationApproval): void {
    const stmt = this.db.query(`
      INSERT INTO orchestration_approvals (
        id, run_id, tool_name, risk_level, action_summary, tool_args_json,
        status, requested_at, expires_at, decided_at, decided_by, reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      approval.id,
      approval.runId,
      approval.toolName,
      approval.riskLevel,
      approval.actionSummary,
      JSON.stringify(approval.toolArgs),
      approval.status,
      approval.requestedAt,
      approval.expiresAt,
      approval.decidedAt ?? null,
      approval.decidedBy ?? null,
      approval.reason ?? null
    );
  }

  getApproval(id: string): OrchestrationApproval | null {
    const row = this.db.query("SELECT * FROM orchestration_approvals WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapApproval(row);
  }

  listApprovals(status?: ApprovalStatus, limit = 50): OrchestrationApproval[] {
    if (status) {
      const rows = this.db
        .query("SELECT * FROM orchestration_approvals WHERE status = ? ORDER BY requested_at DESC LIMIT ?")
        .all(status, limit) as Record<string, unknown>[];
      return rows.map((r) => this.mapApproval(r));
    }
    const rows = this.db
      .query("SELECT * FROM orchestration_approvals ORDER BY requested_at DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => this.mapApproval(r));
  }

  resolveApproval(
    id: string,
    status: "approved" | "rejected" | "timed_out",
    decidedBy: string,
    reason?: string
  ): OrchestrationApproval | null {
    const now = new Date().toISOString();
    const stmt = this.db.query(`
      UPDATE orchestration_approvals
      SET status = ?, decided_at = ?, decided_by = ?, reason = ?
      WHERE id = ?
    `);
    stmt.run(status, now, decidedBy, reason ?? null, id);
    return this.getApproval(id);
  }

  // ── Tool Calls ───────────────────────────────────────────────────────
  recordToolCall(call: OrchestrationToolCall): void {
    const stmt = this.db.query(`
      INSERT INTO orchestration_tool_calls (
        id, run_id, tool_name, server_name, risk_level, input_args_json,
        output_result_json, status, execution_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        output_result_json = excluded.output_result_json,
        status = excluded.status,
        execution_ms = excluded.execution_ms
    `);
    stmt.run(
      call.id,
      call.runId,
      call.toolName,
      call.serverName,
      call.riskLevel,
      JSON.stringify(call.inputArgs),
      call.outputResult ? JSON.stringify(call.outputResult) : null,
      call.status,
      call.executionMs ?? null,
      call.createdAt
    );
  }

  listToolCallsForRun(runId: string): OrchestrationToolCall[] {
    const rows = this.db.query(
      "SELECT * FROM orchestration_tool_calls WHERE run_id = ? ORDER BY created_at ASC"
    ).all(runId) as Record<string, unknown>[];
    return rows.map((r) => this.mapToolCall(r));
  }

  // ── MCP Servers ──────────────────────────────────────────────────────
  upsertMcpServer(server: OrchestrationMcpServer): void {
    const stmt = this.db.query(`
      INSERT INTO orchestration_mcp_servers (
        id, server_name, trust_level, transport, endpoint_or_command,
        status, tool_count, last_heartbeat, metadata_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(server_name) DO UPDATE SET
        trust_level = excluded.trust_level,
        transport = excluded.transport,
        endpoint_or_command = excluded.endpoint_or_command,
        status = excluded.status,
        tool_count = excluded.tool_count,
        last_heartbeat = excluded.last_heartbeat,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      server.id,
      server.serverName,
      server.trustLevel,
      server.transport,
      server.endpointOrCommand,
      server.status,
      server.toolCount,
      server.lastHeartbeat ?? null,
      JSON.stringify(server.metadata || {}),
      server.updatedAt
    );
  }

  listMcpServers(): OrchestrationMcpServer[] {
    const rows = this.db.query(
      "SELECT * FROM orchestration_mcp_servers ORDER BY server_name ASC"
    ).all() as Record<string, unknown>[];
    return rows.map((r) => this.mapMcpServer(r));
  }

  getMcpServer(serverName: string): OrchestrationMcpServer | null {
    const row = this.db.query(
      "SELECT * FROM orchestration_mcp_servers WHERE server_name = ?"
    ).get(serverName) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapMcpServer(row);
  }

  // ── Mappers ──────────────────────────────────────────────────────────
  private mapRun(row: Record<string, unknown>): OrchestrationRun {
    return {
      id: String(row.id),
      sessionId: row.session_id ? String(row.session_id) : undefined,
      workflowId: row.workflow_id ? String(row.workflow_id) : undefined,
      runtimeType: row.runtime_type as AgentRuntimeType,
      status: row.status as OrchestrationRunStatus,
      prompt: String(row.prompt),
      resolvedPrompt: row.resolved_prompt ? String(row.resolved_prompt) : undefined,
      primaryModel: String(row.primary_model),
      fallbackModel: row.fallback_model ? String(row.fallback_model) : undefined,
      modelCallCount: Number(row.model_call_count || 0),
      toolCallCount: Number(row.tool_call_count || 0),
      totalInputTokens: Number(row.total_input_tokens || 0),
      totalOutputTokens: Number(row.total_output_tokens || 0),
      totalCostUsd: Number(row.total_cost_usd || 0),
      maxModelCalls: Number(row.max_model_calls || 25),
      maxToolCalls: Number(row.max_tool_calls || 50),
      timeoutMs: Number(row.timeout_ms || 300000),
      outputText: row.output_text ? String(row.output_text) : undefined,
      structuredOutputJson: row.structured_output_json ? String(row.structured_output_json) : undefined,
      errorText: row.error_text ? String(row.error_text) : undefined,
      errorCode: row.error_code ? String(row.error_code) : undefined,
      metadata: this.parseJson(row.metadata_json),
      createdAt: String(row.created_at),
      startedAt: row.started_at ? String(row.started_at) : undefined,
      completedAt: row.completed_at ? String(row.completed_at) : undefined,
      updatedAt: String(row.updated_at),
    };
  }

  private mapEvent(row: Record<string, unknown>): OrchestrationEvent {
    return {
      id: String(row.id),
      runId: String(row.run_id),
      sequenceNumber: Number(row.sequence_number),
      eventType: row.event_type as OrchestrationEvent["eventType"],
      agentRole: row.agent_role ? String(row.agent_role) : undefined,
      toolName: row.tool_name ? String(row.tool_name) : undefined,
      inputPayload: row.input_payload_json ? this.parseJson(row.input_payload_json) : undefined,
      outputPayload: row.output_payload_json ? this.parseJson(row.output_payload_json) : undefined,
      durationMs: row.duration_ms !== null ? Number(row.duration_ms) : undefined,
      tokensUsed: row.tokens_used !== null ? Number(row.tokens_used) : undefined,
      costUsd: row.cost_usd !== null ? Number(row.cost_usd) : undefined,
      timestamp: String(row.timestamp),
    };
  }

  private mapCheckpoint(row: Record<string, unknown>): OrchestrationCheckpoint {
    return {
      id: String(row.id),
      runId: String(row.run_id),
      stepNumber: Number(row.step_number),
      stateHash: String(row.state_hash),
      state: this.parseJson(row.state_json),
      pendingAction: row.pending_action_json ? this.parseJson(row.pending_action_json) : undefined,
      createdAt: String(row.created_at),
    };
  }

  private mapApproval(row: Record<string, unknown>): OrchestrationApproval {
    return {
      id: String(row.id),
      runId: String(row.run_id),
      toolName: String(row.tool_name),
      riskLevel: row.risk_level as ToolRiskLevel,
      actionSummary: String(row.action_summary),
      toolArgs: this.parseJson(row.tool_args_json),
      status: row.status as ApprovalStatus,
      requestedAt: String(row.requested_at),
      expiresAt: String(row.expires_at),
      decidedAt: row.decided_at ? String(row.decided_at) : undefined,
      decidedBy: row.decided_by ? String(row.decided_by) : undefined,
      reason: row.reason ? String(row.reason) : undefined,
    };
  }

  private mapToolCall(row: Record<string, unknown>): OrchestrationToolCall {
    return {
      id: String(row.id),
      runId: String(row.run_id),
      toolName: String(row.tool_name),
      serverName: String(row.server_name),
      riskLevel: row.risk_level as ToolRiskLevel,
      inputArgs: this.parseJson(row.input_args_json),
      outputResult: row.output_result_json ? this.parseJson(row.output_result_json) : undefined,
      status: row.status as OrchestrationToolCall["status"],
      executionMs: row.execution_ms !== null ? Number(row.execution_ms) : undefined,
      createdAt: String(row.created_at),
    };
  }

  private mapMcpServer(row: Record<string, unknown>): OrchestrationMcpServer {
    return {
      id: String(row.id),
      serverName: String(row.server_name),
      trustLevel: row.trust_level as McpTrustLevel,
      transport: row.transport as OrchestrationMcpServer["transport"],
      endpointOrCommand: String(row.endpoint_or_command),
      status: row.status as OrchestrationMcpServer["status"],
      toolCount: Number(row.tool_count || 0),
      lastHeartbeat: row.last_heartbeat ? String(row.last_heartbeat) : undefined,
      metadata: this.parseJson(row.metadata_json),
      updatedAt: String(row.updated_at),
    };
  }

  private parseJson(val: unknown): Record<string, unknown> {
    if (!val || typeof val !== "string") return {};
    try {
      const parsed = JSON.parse(val);
      return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }
}
