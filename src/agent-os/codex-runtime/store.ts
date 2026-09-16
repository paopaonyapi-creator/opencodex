// Phase 20.21 — Pao-hubPro x OpenAI Codex Native Runtime Integration
// SQLite Persistence Layer for Codex Runtime Subsystem.

import { openAgentOsDb } from "../db";
import type {
  RuntimeNode,
  CodexSession,
  CodexTurn,
  ApprovalRequest,
  McpToolInventoryItem,
  AuditLogEntry,
  PaoRuntimeEvent,
  CodexCapabilityReport,
  ApprovalStatus,
  SessionStatus,
  JobState,
  CodexPolicyProfile,
  CodexRuntimeMode,
} from "./types";

export class CodexRuntimeStore {
  private get db() {
    return openAgentOsDb();
  }

  // ── Nodes ───────────────────────────────────────────────────────────
  upsertNode(node: RuntimeNode): void {
    const stmt = this.db.query(`
      INSERT INTO codex_runtime_nodes (
        id, name, platform, hostname, codex_version, runtime_mode,
        connection_state, last_seen, capability_report_json,
        policy_profile, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        platform = excluded.platform,
        hostname = excluded.hostname,
        codex_version = excluded.codex_version,
        runtime_mode = excluded.runtime_mode,
        connection_state = excluded.connection_state,
        last_seen = excluded.last_seen,
        capability_report_json = excluded.capability_report_json,
        policy_profile = excluded.policy_profile,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      node.id,
      node.name,
      node.platform,
      node.hostname,
      node.codexVersion,
      node.runtimeMode,
      node.connectionState,
      node.lastSeen,
      JSON.stringify(node.capabilityReport),
      node.policyProfile,
      node.enabled ? 1 : 0,
      node.createdAt,
      node.updatedAt,
    );
  }

  getNode(id: string): RuntimeNode | null {
    const row = this.db
      .query("SELECT * FROM codex_runtime_nodes WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapNode(row) : null;
  }

  listNodes(): RuntimeNode[] {
    const rows = this.db
      .query("SELECT * FROM codex_runtime_nodes ORDER BY name ASC")
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.mapNode(r));
  }

  updateNodeConnection(id: string, state: "online" | "offline" | "degraded", lastSeen = new Date().toISOString()): void {
    this.db
      .query("UPDATE codex_runtime_nodes SET connection_state = ?, last_seen = ?, updated_at = ? WHERE id = ?")
      .run(state, lastSeen, lastSeen, id);
  }

  // ── Sessions ────────────────────────────────────────────────────────
  createSession(session: CodexSession): void {
    const stmt = this.db.query(`
      INSERT INTO codex_runtime_sessions (
        id, thread_id, workspace_root, node_id, runtime_mode,
        status, policy_profile, title, active_turn_id, last_error,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      session.id,
      session.threadId,
      session.workspaceRoot,
      session.nodeId,
      session.runtimeMode,
      session.status,
      session.policyProfile,
      session.title,
      session.activeTurnId,
      session.lastError,
      session.createdAt,
      session.updatedAt,
    );
  }

  getSession(id: string): CodexSession | null {
    const row = this.db
      .query("SELECT * FROM codex_runtime_sessions WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapSession(row) : null;
  }

  getSessionByThreadId(threadId: string): CodexSession | null {
    const row = this.db
      .query("SELECT * FROM codex_runtime_sessions WHERE thread_id = ?")
      .get(threadId) as Record<string, unknown> | undefined;
    return row ? this.mapSession(row) : null;
  }

  listSessions(limit = 100): CodexSession[] {
    const rows = this.db
      .query("SELECT * FROM codex_runtime_sessions ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => this.mapSession(r));
  }

  updateSessionStatus(id: string, status: SessionStatus, activeTurnId: string | null = null, lastError: string | null = null): void {
    const now = new Date().toISOString();
    this.db
      .query("UPDATE codex_runtime_sessions SET status = ?, active_turn_id = ?, last_error = ?, updated_at = ? WHERE id = ?")
      .run(status, activeTurnId, lastError, now, id);
  }

  updateSessionThreadId(id: string, threadId: string): void {
    const now = new Date().toISOString();
    this.db
      .query("UPDATE codex_runtime_sessions SET thread_id = ?, updated_at = ? WHERE id = ?")
      .run(threadId, now, id);
  }

  // ── Jobs / Turns ───────────────────────────────────────────────────
  createJob(job: CodexTurn): void {
    const stmt = this.db.query(`
      INSERT INTO codex_runtime_jobs (
        id, session_id, turn_id, node_id, type, state,
        priority, prompt, error, created_at, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      job.id,
      job.sessionId,
      job.threadId,
      job.nodeId,
      "turn",
      job.status,
      0,
      job.prompt,
      job.error,
      job.createdAt,
      job.startedAt,
      job.finishedAt,
    );
  }

  getJob(id: string): CodexTurn | null {
    const row = this.db
      .query("SELECT * FROM codex_runtime_jobs WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapJob(row) : null;
  }

  listJobsForSession(sessionId: string): CodexTurn[] {
    const rows = this.db
      .query("SELECT * FROM codex_runtime_jobs WHERE session_id = ? ORDER BY created_at ASC")
      .all(sessionId) as Record<string, unknown>[];
    return rows.map((r) => this.mapJob(r));
  }

  updateJobState(id: string, state: JobState, error: string | null = null, finishedAt: string | null = null): void {
    this.db
      .query("UPDATE codex_runtime_jobs SET state = ?, error = ?, finished_at = ? WHERE id = ?")
      .run(state, error, finishedAt, id);
  }

  // ── Events ──────────────────────────────────────────────────────────
  recordEvent(sessionId: string, turnId: string | null, event: PaoRuntimeEvent): void {
    const id = `ev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.db
      .query("INSERT INTO codex_runtime_events (id, session_id, turn_id, type, payload_json, timestamp) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, sessionId, turnId, event.type, JSON.stringify(event), event.timestamp);
  }

  listEventsForSession(sessionId: string, limit = 200): PaoRuntimeEvent[] {
    const rows = this.db
      .query("SELECT payload_json FROM codex_runtime_events WHERE session_id = ? ORDER BY timestamp ASC LIMIT ?")
      .all(sessionId, limit) as { payload_json: string }[];
    return rows.map((r) => JSON.parse(r.payload_json) as PaoRuntimeEvent);
  }

  // ── Approvals ───────────────────────────────────────────────────────
  createApproval(req: ApprovalRequest): void {
    const stmt = this.db.query(`
      INSERT INTO codex_runtime_approvals (
        id, session_id, turn_id, node_id, tool_name, command, path,
        network_intent, risk_level, status, decision, decided_by,
        decided_at, requested_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      req.id,
      req.sessionId,
      req.turnId,
      req.nodeId,
      req.toolName,
      req.command ?? null,
      req.path ?? null,
      req.networkIntent ?? null,
      req.riskLevel,
      req.status,
      req.decision ?? null,
      req.decidedBy ?? null,
      req.decidedAt ?? null,
      req.requestedAt,
      req.expiresAt,
    );
  }

  getApproval(id: string): ApprovalRequest | null {
    const row = this.db
      .query("SELECT * FROM codex_runtime_approvals WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapApproval(row) : null;
  }

  listApprovals(status?: ApprovalStatus, limit = 100): ApprovalRequest[] {
    const query = status
      ? "SELECT * FROM codex_runtime_approvals WHERE status = ? ORDER BY requested_at DESC LIMIT ?"
      : "SELECT * FROM codex_runtime_approvals ORDER BY requested_at DESC LIMIT ?";
    const rows = (status
      ? this.db.query(query).all(status, limit)
      : this.db.query(query).all(limit)) as Record<string, unknown>[];
    return rows.map((r) => this.mapApproval(r));
  }

  resolveApproval(id: string, status: ApprovalStatus, decision: "allow" | "deny" | "cancel", decidedBy: string): void {
    const now = new Date().toISOString();
    this.db
      .query("UPDATE codex_runtime_approvals SET status = ?, decision = ?, decided_by = ?, decided_at = ? WHERE id = ?")
      .run(status, decision, decidedBy, now, id);
  }

  // ── Audit Logs ──────────────────────────────────────────────────────
  recordAuditLog(entry: AuditLogEntry): void {
    const stmt = this.db.query(`
      INSERT INTO codex_runtime_audit_logs (
        id, timestamp, actor, session_id, turn_id, node_id,
        action, risk, result, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      entry.id,
      entry.timestamp,
      entry.actor,
      entry.sessionId ?? null,
      entry.turnId ?? null,
      entry.nodeId ?? null,
      entry.action,
      entry.risk,
      entry.result,
      JSON.stringify(entry.metadata),
    );
  }

  listAuditLogs(limit = 100): AuditLogEntry[] {
    const rows = this.db
      .query("SELECT * FROM codex_runtime_audit_logs ORDER BY timestamp DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      timestamp: String(r.timestamp),
      actor: String(r.actor),
      sessionId: r.session_id ? String(r.session_id) : null,
      turnId: r.turn_id ? String(r.turn_id) : null,
      nodeId: r.node_id ? String(r.node_id) : null,
      action: String(r.action),
      risk: r.risk as AuditLogEntry["risk"],
      result: r.result as AuditLogEntry["result"],
      metadata: JSON.parse(String(r.metadata_json || "{}")),
    }));
  }

  // ── MCP Tools ───────────────────────────────────────────────────────
  upsertMcpTool(tool: McpToolInventoryItem): void {
    const stmt = this.db.query(`
      INSERT INTO codex_runtime_mcp_tools (
        id, server_name, tool_name, description, risk,
        approval_behavior, source, health, last_error, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(server_name, tool_name) DO UPDATE SET
        description = excluded.description,
        risk = excluded.risk,
        approval_behavior = excluded.approval_behavior,
        source = excluded.source,
        health = excluded.health,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      tool.id,
      tool.serverName,
      tool.toolName,
      tool.description,
      tool.risk,
      tool.approvalBehavior,
      tool.source,
      tool.health,
      tool.lastError ?? null,
      tool.updatedAt,
    );
  }

  listMcpTools(): McpToolInventoryItem[] {
    const rows = this.db
      .query("SELECT * FROM codex_runtime_mcp_tools ORDER BY server_name ASC, tool_name ASC")
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      serverName: String(r.server_name),
      toolName: String(r.tool_name),
      description: String(r.description ?? ""),
      risk: r.risk as McpToolInventoryItem["risk"],
      approvalBehavior: r.approval_behavior as McpToolInventoryItem["approvalBehavior"],
      source: r.source as McpToolInventoryItem["source"],
      health: r.health as McpToolInventoryItem["health"],
      lastError: r.last_error ? String(r.last_error) : undefined,
      updatedAt: String(r.updated_at),
    }));
  }

  // ── Private Mappers ─────────────────────────────────────────────────
  private mapNode(r: Record<string, unknown>): RuntimeNode {
    return {
      id: String(r.id),
      name: String(r.name),
      platform: r.platform as RuntimeNode["platform"],
      hostname: String(r.hostname),
      codexVersion: r.codex_version ? String(r.codex_version) : null,
      runtimeMode: r.runtime_mode as CodexRuntimeMode,
      connectionState: r.connection_state as RuntimeNode["connectionState"],
      lastSeen: r.last_seen ? String(r.last_seen) : null,
      capabilityReport: JSON.parse(String(r.capability_report_json || "{}")) as CodexCapabilityReport,
      policyProfile: r.policy_profile as CodexPolicyProfile,
      enabled: Boolean(r.enabled),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  private mapSession(r: Record<string, unknown>): CodexSession {
    return {
      id: String(r.id),
      threadId: r.thread_id ? String(r.thread_id) : null,
      workspaceRoot: String(r.workspace_root),
      nodeId: String(r.node_id),
      runtimeMode: r.runtime_mode as CodexRuntimeMode,
      status: r.status as SessionStatus,
      policyProfile: r.policy_profile as CodexPolicyProfile,
      title: r.title ? String(r.title) : null,
      activeTurnId: r.active_turn_id ? String(r.active_turn_id) : null,
      lastError: r.last_error ? String(r.last_error) : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  private mapJob(r: Record<string, unknown>): CodexTurn {
    return {
      id: String(r.id),
      sessionId: String(r.session_id),
      threadId: r.turn_id ? String(r.turn_id) : null,
      nodeId: String(r.node_id),
      prompt: String(r.prompt ?? ""),
      status: r.state as JobState,
      fileChanges: [],
      resultSummary: null,
      error: r.error ? String(r.error) : null,
      createdAt: String(r.created_at),
      startedAt: r.started_at ? String(r.started_at) : null,
      finishedAt: r.finished_at ? String(r.finished_at) : null,
    };
  }

  private mapApproval(r: Record<string, unknown>): ApprovalRequest {
    return {
      id: String(r.id),
      sessionId: String(r.session_id),
      turnId: r.turn_id ? String(r.turn_id) : null,
      nodeId: String(r.node_id),
      toolName: String(r.tool_name),
      command: r.command ? String(r.command) : undefined,
      path: r.path ? String(r.path) : undefined,
      networkIntent: r.network_intent ? String(r.network_intent) : undefined,
      riskLevel: r.risk_level as ApprovalRequest["riskLevel"],
      status: r.status as ApprovalStatus,
      decision: r.decision as ApprovalRequest["decision"],
      decidedBy: r.decided_by ? String(r.decided_by) : undefined,
      decidedAt: r.decided_at ? String(r.decided_at) : undefined,
      requestedAt: String(r.requested_at),
      expiresAt: String(r.expires_at),
    };
  }
}
