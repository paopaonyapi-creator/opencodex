// Phase 21.01 — Multi-Agent Work Room Core Engine (§4, §5, §6, §8, §9, §11, §18).
//
// Key principles:
// 1. Explicit addressing: @codex, @claude, @both, @all, @reviewers, @builders.
// 2. Runtime is the source of truth (never trust self-reported model names).
// 3. 4-level tool policy: Level 0 (Safe), Level 1 (Workspace), Level 2 (Network), Level 3 (Dangerous).
// 4. Run Inspector tracking and immutable snapshot capture.

import { sha256Hex } from "../agent-runtime/hash";
import { newParleyId, nowIso, ParleyStore } from "./store";
import {
  type ParleyCommandEvent,
  type ParleyFileEvent,
  type ParleyHandoff,
  type ParleyMessage,
  type ParleyPermissionProfile,
  type ParleyRoom,
  type ParleyRoomAgent,
  type ParleyRoomMode,
  type ParleyRun,
  type ParleyToolCall,
  type RunInspectorData,
  type ToolRiskLevel,
} from "./types";

export interface CreateRoomInput {
  name: string;
  mode?: ParleyRoomMode;
  workspacePath: string;
  permissionProfile?: ParleyPermissionProfile;
  budgetLimitUsd?: number;
}

export interface SendMessageInput {
  roomId: string;
  senderType: "user" | "agent" | "system";
  senderId: string;
  senderDisplayName: string;
  content: string;
}

export class ParleyRoomEngine {
  private readonly store: ParleyStore;

  constructor(store?: ParleyStore) {
    this.store = store ?? new ParleyStore();
  }

  // -------------------------------------------------------------------------
  // Room Management (§4, §13)
  // -------------------------------------------------------------------------

  createRoom(input: CreateRoomInput): ParleyRoom {
    const room: ParleyRoom = {
      id: newParleyId("room"),
      name: input.name,
      mode: input.mode ?? "WORK",
      workspacePath: input.workspacePath,
      permissionProfile: input.permissionProfile ?? "workspace-write",
      autoTurnsLimit: 4,
      budgetLimitUsd: input.budgetLimitUsd ?? 3.0,
      budgetSpentUsd: 0.0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.store.insertRoom(room);
    return room;
  }

  getRoom(roomId: string): ParleyRoom | null {
    return this.store.getRoom(roomId);
  }

  listRooms(): ParleyRoom[] {
    return this.store.listRooms();
  }

  // -------------------------------------------------------------------------
  // Agent Assignment & Runtime Identity (§6, §8)
  // -------------------------------------------------------------------------

  addAgentToRoom(
    roomId: string,
    agent: {
      agentId: string;
      displayName: string;
      role?: "builder" | "reviewer" | "researcher" | "coordinator";
      provider: string;
      actualModelId: string; // Authoritative runtime model ID (§8, §57)
      endpointProfile?: string;
      priority?: number;
    },
  ): ParleyRoomAgent {
    const roomAgent: ParleyRoomAgent = {
      id: newParleyId("rag"),
      roomId,
      agentId: agent.agentId,
      displayName: agent.displayName,
      role: agent.role ?? "builder",
      provider: agent.provider,
      actualModelId: agent.actualModelId,
      endpointProfile: agent.endpointProfile ?? "default",
      enabled: true,
      priority: agent.priority ?? 1,
      createdAt: nowIso(),
    };
    this.store.insertRoomAgent(roomAgent);
    return roomAgent;
  }

  listRoomAgents(roomId: string): ParleyRoomAgent[] {
    return this.store.listRoomAgents(roomId);
  }

  // -------------------------------------------------------------------------
  // Multi-Agent Addressing & Dispatch (§5, §16)
  // -------------------------------------------------------------------------

  /**
   * Parse message addressing tokens: @codex, @claude, @both, @all, @reviewers, @builders.
   */
  parseAddressing(content: string): { targetAgents: string[]; addressedTag: string | null } {
    const lower = content.toLowerCase();
    if (lower.includes("@both")) return { targetAgents: ["codex", "claude"], addressedTag: "@both" };
    if (lower.includes("@all")) return { targetAgents: ["all"], addressedTag: "@all" };
    if (lower.includes("@reviewers")) return { targetAgents: ["reviewer"], addressedTag: "@reviewers" };
    if (lower.includes("@builders")) return { targetAgents: ["builder"], addressedTag: "@builders" };
    if (lower.includes("@claude")) return { targetAgents: ["claude"], addressedTag: "@claude" };
    if (lower.includes("@codex")) return { targetAgents: ["codex"], addressedTag: "@codex" };
    return { targetAgents: [], addressedTag: null };
  }

  postMessage(input: SendMessageInput): { message: ParleyMessage; routedAgents: ParleyRoomAgent[] } {
    const room = this.store.getRoom(input.roomId);
    if (!room) throw new Error(`room not found: ${input.roomId}`);

    const { targetAgents, addressedTag } = this.parseAddressing(input.content);
    const msg: ParleyMessage = {
      id: newParleyId("msg"),
      roomId: input.roomId,
      senderType: input.senderType,
      senderId: input.senderId,
      senderDisplayName: input.senderDisplayName,
      addressedTo: addressedTag,
      content: input.content,
      createdAt: nowIso(),
    };
    this.store.insertMessage(msg);

    // Route message to eligible room agents (§24)
    const availableAgents = this.store.listRoomAgents(input.roomId).filter((a) => a.enabled);
    let routed: ParleyRoomAgent[] = [];

    if (targetAgents.length === 0) {
      // Default: route to first primary builder
      routed = availableAgents.slice(0, 1);
    } else if (targetAgents.includes("all")) {
      routed = availableAgents;
    } else if (targetAgents.includes("reviewer")) {
      routed = availableAgents.filter((a) => a.role === "reviewer");
    } else if (targetAgents.includes("builder")) {
      routed = availableAgents.filter((a) => a.role === "builder");
    } else {
      routed = availableAgents.filter((a) =>
        targetAgents.some((t) => a.agentId.toLowerCase().includes(t) || a.displayName.toLowerCase().includes(t)),
      );
    }

    return { message: msg, routedAgents: routed };
  }

  listMessages(roomId: string): ParleyMessage[] {
    return this.store.listMessages(roomId);
  }

  // -------------------------------------------------------------------------
  // Runs, Execution & Inspector (§7, §8, §11, §14, §15)
  // -------------------------------------------------------------------------

  startRun(
    roomId: string,
    agent: ParleyRoomAgent,
    opts?: { inputTokens?: number; estimatedCostUsd?: number },
  ): ParleyRun {
    const room = this.store.getRoom(roomId);
    if (!room) throw new Error(`room not found: ${roomId}`);

    // Immutable runtime snapshot (§8, §56)
    const snapshot = {
      agent: { id: agent.agentId, name: agent.displayName, role: agent.role },
      provider: agent.provider,
      model: agent.actualModelId,
      endpoint_profile: agent.endpointProfile,
      workspace: room.workspacePath,
      permission_profile: room.permissionProfile,
      captured_at: nowIso(),
    };

    const run: ParleyRun = {
      id: newParleyId("run"),
      roomId,
      agentId: agent.agentId,
      provider: agent.provider,
      actualModelId: agent.actualModelId,
      endpointProfile: agent.endpointProfile,
      permissionProfile: room.permissionProfile,
      status: "running",
      startedAt: nowIso(),
      finishedAt: null,
      durationMs: null,
      inputTokens: opts?.inputTokens ?? 150,
      outputTokens: 0,
      cachedTokens: 0,
      estimatedCostUsd: opts?.estimatedCostUsd ?? 0.01,
      runtimeSnapshotJson: JSON.stringify(snapshot),
      createdAt: nowIso(),
    };

    this.store.insertRun(run);
    return run;
  }

  finishRun(runId: string, outputTokens = 200): ParleyRun {
    const run = this.store.getRun(runId);
    if (!run) throw new Error(`run not found: ${runId}`);
    const finishedAt = nowIso();
    const durationMs = new Date(finishedAt).getTime() - new Date(run.startedAt).getTime();

    const updatedCost = run.estimatedCostUsd + outputTokens * 0.00002;
    this.store.updateRunStatus(runId, "completed", finishedAt, durationMs, outputTokens, updatedCost);
    return this.store.getRun(runId)!;
  }

  // -------------------------------------------------------------------------
  // 4-Level Tool Execution Policy (§11)
  // -------------------------------------------------------------------------

  classifyCommand(cmd: string): { riskLevel: ToolRiskLevel; reason: string } {
    const c = cmd.toLowerCase().trim();
    // Level 3 — Dangerous
    if (
      c.includes("rm -rf /") ||
      c.includes("format") ||
      c.includes("shutdown") ||
      c.includes("drop table") ||
      c.includes("privilege")
    ) {
      return { riskLevel: 3, reason: "potentially destructive system command (BLOCKED by default)" };
    }
    // Level 2 — External / Network
    if (
      c.startsWith("npm install") ||
      c.startsWith("pip install") ||
      c.startsWith("curl") ||
      c.startsWith("git push")
    ) {
      return { riskLevel: 2, reason: "external dependency modification or network mutation" };
    }
    // Level 1 — Workspace Mutation
    if (c.startsWith("npm run build") || c.includes("format") || c.includes("edit")) {
      return { riskLevel: 1, reason: "workspace modification" };
    }
    // Level 0 — Safe
    return { riskLevel: 0, reason: "safe read-only inspection or tests" };
  }

  recordToolExecution(
    runId: string,
    toolName: string,
    action: string,
    riskLevel: ToolRiskLevel,
    input: Record<string, unknown>,
    outputSummary: string,
  ): ParleyToolCall {
    const tc: ParleyToolCall = {
      id: newParleyId("ptc"),
      runId,
      toolName,
      action,
      riskLevel,
      inputRedactedJson: JSON.stringify(input),
      outputSummary,
      status: "completed",
      durationMs: 50,
      createdAt: nowIso(),
    };
    this.store.insertToolCall(tc);
    return tc;
  }

  recordFileEvent(
    runId: string,
    path: string,
    operation: "read" | "create" | "modify" | "delete",
    diffPatch?: string,
  ): ParleyFileEvent {
    const fe: ParleyFileEvent = {
      id: newParleyId("pfe"),
      runId,
      path,
      operation,
      diffPatch: diffPatch ?? null,
      createdAt: nowIso(),
    };
    this.store.insertFileEvent(fe);
    return fe;
  }

  recordCommandEvent(
    runId: string,
    command: string,
    cwd: string,
    exitCode = 0,
    stdout?: string,
  ): ParleyCommandEvent {
    const ce: ParleyCommandEvent = {
      id: newParleyId("pce"),
      runId,
      commandRedacted: command,
      cwd,
      exitCode,
      stdoutSummary: stdout ? stdout.slice(0, 512) : null,
      stderrSummary: null,
      durationMs: 120,
      createdAt: nowIso(),
    };
    this.store.insertCommandEvent(ce);
    return ce;
  }

  // -------------------------------------------------------------------------
  // Multi-Agent Handoff (§18)
  // -------------------------------------------------------------------------

  recordHandoff(input: {
    roomId: string;
    fromRunId: string;
    fromAgentId: string;
    toAgentId: string;
    reason: string;
    artifacts?: string[];
  }): ParleyHandoff {
    const h: ParleyHandoff = {
      id: newParleyId("phf"),
      roomId: input.roomId,
      fromRunId: input.fromRunId,
      fromAgentId: input.fromAgentId,
      toAgentId: input.toAgentId,
      reason: input.reason,
      artifacts: input.artifacts ?? ["git_diff", "test_report"],
      createdAt: nowIso(),
    };
    this.store.insertHandoff(h);
    return h;
  }

  // -------------------------------------------------------------------------
  // Run Inspector Aggregation (§7, §39)
  // -------------------------------------------------------------------------

  getRunInspector(runId: string): RunInspectorData {
    const run = this.store.getRun(runId);
    if (!run) throw new Error(`run not found: ${runId}`);

    const snapshot = JSON.parse(run.runtimeSnapshotJson || "{}");
    const toolCalls = this.store.listToolCalls(runId);
    const fileEvents = this.store.listFileEvents(runId);
    const commandEvents = this.store.listCommandEvents(runId);
    const handoffs = this.store.listHandoffs(run.roomId).filter((h) => h.fromRunId === runId);

    const routingChain = [
      { hop: 1, provider: run.provider, model: run.actualModelId, reason: "primary_assigned_agent" },
    ];

    return {
      run,
      runtimeSnapshot: snapshot,
      toolCalls,
      fileEvents,
      commandEvents,
      handoffs,
      routingChain,
    };
  }

  // -------------------------------------------------------------------------
  // Transcript Exporters (§19, §51)
  // -------------------------------------------------------------------------

  exportTranscriptMarkdown(roomId: string): string {
    const room = this.store.getRoom(roomId);
    const messages = this.store.listMessages(roomId);
    const runs = this.store.listRuns(roomId);

    let md = `# Work Room Transcript: ${room?.name ?? roomId}\n`;
    md += `Mode: ${room?.mode ?? "WORK"} | Workspace: ${room?.workspacePath ?? ""}\n\n`;

    for (const m of messages) {
      md += `[${m.createdAt}] **${m.senderDisplayName}**${m.addressedTo ? ` → ${m.addressedTo}` : ""}:\n${m.content}\n\n`;
    }

    if (runs.length > 0) {
      md += `## Execution Runs\n\n`;
      for (const r of runs) {
        md += `- Run **${r.id}** (${r.provider} • ${r.actualModelId}) - Status: ${r.status} (${r.durationMs ?? 0}ms, $${r.estimatedCostUsd.toFixed(4)})\n`;
      }
    }

    return md;
  }
}
