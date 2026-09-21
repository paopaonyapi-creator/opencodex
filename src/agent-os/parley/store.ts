// Phase 21.01 — Pao-hubPro × Parley Store over parley_* SQLite tables.
// Single-line bound SQL over parley_* tables; all queries strictly use ? placeholders.

import { openAgentOsDb } from "../db";
import type {
  ParleyCommandEvent,
  ParleyFileEvent,
  ParleyHandoff,
  ParleyMessage,
  ParleyRoom,
  ParleyRoomAgent,
  ParleyRun,
  ParleyRunStatus,
  ParleyToolCall,
} from "./types";

export function nowIso(): string {
  return new Date().toISOString();
}

export function newParleyId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export class ParleyStore {
  // -------------------------------------------------------------------------
  // Rooms
  // -------------------------------------------------------------------------

  insertRoom(room: ParleyRoom): void {
    openAgentOsDb()
      .query(
        "INSERT INTO parley_rooms (id, name, mode, workspace_path, permission_profile, auto_turns_limit, budget_limit_usd, budget_spent_usd, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        room.id,
        room.name,
        room.mode,
        room.workspacePath,
        room.permissionProfile,
        room.autoTurnsLimit,
        room.budgetLimitUsd,
        room.budgetSpentUsd,
        room.createdAt,
        room.updatedAt,
      );
  }

  getRoom(id: string): ParleyRoom | null {
    const r = openAgentOsDb()
      .query("SELECT * FROM parley_rooms WHERE id = ?")
      .get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      mode: r.mode,
      workspacePath: r.workspace_path,
      permissionProfile: r.permission_profile,
      autoTurnsLimit: r.auto_turns_limit,
      budgetLimitUsd: r.budget_limit_usd,
      budgetSpentUsd: r.budget_spent_usd,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  listRooms(): ParleyRoom[] {
    const rows = openAgentOsDb().query("SELECT * FROM parley_rooms ORDER BY updated_at DESC").all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      mode: r.mode,
      workspacePath: r.workspace_path,
      permissionProfile: r.permission_profile,
      autoTurnsLimit: r.auto_turns_limit,
      budgetLimitUsd: r.budget_limit_usd,
      budgetSpentUsd: r.budget_spent_usd,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  // -------------------------------------------------------------------------
  // Room Agents
  // -------------------------------------------------------------------------

  insertRoomAgent(agent: ParleyRoomAgent): void {
    openAgentOsDb()
      .query(
        "INSERT INTO parley_room_agents (id, room_id, agent_id, display_name, role, provider, actual_model_id, endpoint_profile, enabled, priority, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(room_id, agent_id) DO UPDATE SET display_name = excluded.display_name, role = excluded.role, provider = excluded.provider, actual_model_id = excluded.actual_model_id, endpoint_profile = excluded.endpoint_profile, enabled = excluded.enabled",
      )
      .run(
        agent.id,
        agent.roomId,
        agent.agentId,
        agent.displayName,
        agent.role,
        agent.provider,
        agent.actualModelId,
        agent.endpointProfile,
        agent.enabled ? 1 : 0,
        agent.priority,
        agent.createdAt,
      );
  }

  listRoomAgents(roomId: string): ParleyRoomAgent[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM parley_room_agents WHERE room_id = ? ORDER BY priority ASC")
      .all(roomId) as any[];
    return rows.map((r) => ({
      id: r.id,
      roomId: r.room_id,
      agentId: r.agent_id,
      displayName: r.display_name,
      role: r.role,
      provider: r.provider,
      actualModelId: r.actual_model_id,
      endpointProfile: r.endpoint_profile,
      enabled: r.enabled === 1,
      priority: r.priority,
      createdAt: r.created_at,
    }));
  }

  // -------------------------------------------------------------------------
  // Messages & Timeline
  // -------------------------------------------------------------------------

  insertMessage(msg: ParleyMessage): void {
    openAgentOsDb()
      .query(
        "INSERT INTO parley_messages (id, room_id, sender_type, sender_id, sender_display_name, addressed_to, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        msg.id,
        msg.roomId,
        msg.senderType,
        msg.senderId,
        msg.senderDisplayName,
        msg.addressedTo ?? null,
        msg.content,
        msg.createdAt,
      );
  }

  listMessages(roomId: string): ParleyMessage[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM parley_messages WHERE room_id = ? ORDER BY created_at ASC")
      .all(roomId) as any[];
    return rows.map((r) => ({
      id: r.id,
      roomId: r.room_id,
      senderType: r.sender_type,
      senderId: r.sender_id,
      senderDisplayName: r.sender_display_name,
      addressedTo: r.addressed_to,
      content: r.content,
      createdAt: r.created_at,
    }));
  }

  // -------------------------------------------------------------------------
  // Runs & Inspector
  // -------------------------------------------------------------------------

  insertRun(run: ParleyRun): void {
    openAgentOsDb()
      .query(
        "INSERT INTO parley_runs (id, room_id, agent_id, provider, actual_model_id, endpoint_profile, permission_profile, status, started_at, finished_at, duration_ms, input_tokens, output_tokens, cached_tokens, estimated_cost_usd, runtime_snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        run.id,
        run.roomId,
        run.agentId,
        run.provider,
        run.actualModelId,
        run.endpointProfile,
        run.permissionProfile,
        run.status,
        run.startedAt,
        run.finishedAt,
        run.durationMs,
        run.inputTokens,
        run.outputTokens,
        run.cachedTokens,
        run.estimatedCostUsd,
        run.runtimeSnapshotJson,
        run.createdAt,
      );
  }

  updateRunStatus(
    runId: string,
    status: ParleyRunStatus,
    finishedAt: string,
    durationMs: number,
    outputTokens: number,
    estimatedCostUsd: number,
  ): void {
    openAgentOsDb()
      .query(
        "UPDATE parley_runs SET status = ?, finished_at = ?, duration_ms = ?, output_tokens = ?, estimated_cost_usd = ? WHERE id = ?",
      )
      .run(status, finishedAt, durationMs, outputTokens, estimatedCostUsd, runId);
  }

  getRun(id: string): ParleyRun | null {
    const r = openAgentOsDb().query("SELECT * FROM parley_runs WHERE id = ?").get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      roomId: r.room_id,
      agentId: r.agent_id,
      provider: r.provider,
      actualModelId: r.actual_model_id,
      endpointProfile: r.endpoint_profile,
      permissionProfile: r.permission_profile,
      status: r.status as ParleyRunStatus,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      durationMs: r.duration_ms,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      cachedTokens: r.cached_tokens,
      estimatedCostUsd: r.estimated_cost_usd,
      runtimeSnapshotJson: r.runtime_snapshot_json,
      createdAt: r.created_at,
    };
  }

  listRuns(roomId: string): ParleyRun[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM parley_runs WHERE room_id = ? ORDER BY created_at DESC")
      .all(roomId) as any[];
    return rows.map((r) => ({
      id: r.id,
      roomId: r.room_id,
      agentId: r.agent_id,
      provider: r.provider,
      actualModelId: r.actual_model_id,
      endpointProfile: r.endpoint_profile,
      permissionProfile: r.permission_profile,
      status: r.status as ParleyRunStatus,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      durationMs: r.duration_ms,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      cachedTokens: r.cached_tokens,
      estimatedCostUsd: r.estimated_cost_usd,
      runtimeSnapshotJson: r.runtime_snapshot_json,
      createdAt: r.created_at,
    }));
  }

  insertToolCall(tc: ParleyToolCall): void {
    openAgentOsDb()
      .query(
        "INSERT INTO parley_tool_calls (id, run_id, tool_name, action, risk_level, input_redacted_json, output_summary, status, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        tc.id,
        tc.runId,
        tc.toolName,
        tc.action,
        tc.riskLevel,
        tc.inputRedactedJson,
        tc.outputSummary,
        tc.status,
        tc.durationMs,
        tc.createdAt,
      );
  }

  listToolCalls(runId: string): ParleyToolCall[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM parley_tool_calls WHERE run_id = ? ORDER BY created_at ASC")
      .all(runId) as any[];
    return rows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      toolName: r.tool_name,
      action: r.action,
      riskLevel: r.risk_level,
      inputRedactedJson: r.input_redacted_json,
      outputSummary: r.output_summary,
      status: r.status,
      durationMs: r.duration_ms,
      createdAt: r.created_at,
    }));
  }

  insertFileEvent(fe: ParleyFileEvent): void {
    openAgentOsDb()
      .query(
        "INSERT INTO parley_file_events (id, run_id, path, operation, diff_patch, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(fe.id, fe.runId, fe.path, fe.operation, fe.diffPatch, fe.createdAt);
  }

  listFileEvents(runId: string): ParleyFileEvent[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM parley_file_events WHERE run_id = ? ORDER BY created_at ASC")
      .all(runId) as any[];
    return rows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      path: r.path,
      operation: r.operation,
      diffPatch: r.diff_patch,
      createdAt: r.created_at,
    }));
  }

  insertCommandEvent(ce: ParleyCommandEvent): void {
    openAgentOsDb()
      .query(
        "INSERT INTO parley_command_events (id, run_id, command_redacted, cwd, exit_code, stdout_summary, stderr_summary, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        ce.id,
        ce.runId,
        ce.commandRedacted,
        ce.cwd,
        ce.exitCode,
        ce.stdoutSummary,
        ce.stderrSummary,
        ce.durationMs,
        ce.createdAt,
      );
  }

  listCommandEvents(runId: string): ParleyCommandEvent[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM parley_command_events WHERE run_id = ? ORDER BY created_at ASC")
      .all(runId) as any[];
    return rows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      commandRedacted: r.command_redacted,
      cwd: r.cwd,
      exitCode: r.exit_code,
      stdoutSummary: r.stdout_summary,
      stderrSummary: r.stderr_summary,
      durationMs: r.duration_ms,
      createdAt: r.created_at,
    }));
  }

  insertHandoff(h: ParleyHandoff): void {
    openAgentOsDb()
      .query(
        "INSERT INTO parley_handoffs (id, room_id, from_run_id, from_agent_id, to_agent_id, reason, artifacts_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        h.id,
        h.roomId,
        h.fromRunId,
        h.fromAgentId,
        h.toAgentId,
        h.reason,
        JSON.stringify(h.artifacts),
        h.createdAt,
      );
  }

  listHandoffs(roomId: string): ParleyHandoff[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM parley_handoffs WHERE room_id = ? ORDER BY created_at ASC")
      .all(roomId) as any[];
    return rows.map((r) => ({
      id: r.id,
      roomId: r.room_id,
      fromRunId: r.from_run_id,
      fromAgentId: r.from_agent_id,
      toAgentId: r.to_agent_id,
      reason: r.reason,
      artifacts: JSON.parse(r.artifacts_json || "[]"),
      createdAt: r.created_at,
    }));
  }
}
