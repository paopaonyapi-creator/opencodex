// Phase 20.40 — Codex, generic-JSONL and Pao-native observability adapters.
// Codex reads the Phase 20.21 runtime tables (database source — no new
// transcript scraping); the generic adapter maps user-configured JSONL
// fields; the Pao-native adapter reads the Phase 20.39 cockpit event bus
// (highest-fidelity native evidence). Capabilities degrade honestly: an
// empty/unavailable source is reported as no evidence, never as a state.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { openAgentOsDb } from "../db";
import {
  listCandidateFiles,
  makeError,
  pathInsideRoot,
  readLastCompleteLine,
  revisionOf,
  statSourceSafe,
} from "./scanner";
import { buildContentPreview } from "./redaction";
import { adapterDisabledError, type JsonlRecordShape } from "./adapter-claude";
import type {
  AdapterCapabilities,
  AdapterContext,
  AdapterSessionObservation,
  DiscoveredSource,
  NormalizedAgentEvent,
  ObservabilityAdapter,
  ObservabilityConfig,
  ProcessHint,
} from "./types";

const MAX_DISCOVERY_FILES = 5000;

function emptyCaps(): AdapterCapabilities {
  return { discovery: false, events: false, processEvidence: false, explicitCompletion: false, integrity: false };
}

function db(): ReturnType<typeof openAgentOsDb> {
  return openAgentOsDb();
}

// --- Codex adapter (Phase 20.21 tables) ------------------------------------------------

export class CodexObservabilityAdapter implements ObservabilityAdapter {
  readonly id = "codex_db";
  readonly runtime = "openai_codex" as const;
  readonly capabilities: AdapterCapabilities = { ...emptyCaps(), discovery: true, events: true, processEvidence: true, explicitCompletion: true };

  enabled(config: ObservabilityConfig): boolean {
    return config.adapters.codex.enabled;
  }

  async discover(context: AdapterContext): Promise<DiscoveredSource[]> {
    if (!this.enabled(context.config)) return [];
    try {
      const rows = db().query("SELECT id, thread_id, workspace_root, status, title, created_at, updated_at FROM codex_runtime_sessions ORDER BY updated_at DESC LIMIT ?").all(500) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        adapterId: this.id,
        runtime: this.runtime,
        sourceSessionId: String(row.id),
        sourcePath: null,
        projectId: row.workspace_root ? String(row.workspace_root) : null,
        projectName: row.workspace_root ? workspaceLabel(String(row.workspace_root)) : null,
        revision: String(row.updated_at ?? ""),
        sizeBytes: null,
        lastModifiedAt: row.updated_at ? String(row.updated_at) : null,
        metadata: { threadId: row.thread_id, status: row.status, title: row.title, createdAt: row.created_at },
      }));
    } catch {
      return [];
    }
  }

  async inspectSession(source: DiscoveredSource, context: AdapterContext): Promise<AdapterSessionObservation> {
    if (!source.sourceSessionId) return adapterDisabledError();
    let latest: NormalizedAgentEvent | null = null;
    const errors: AdapterSessionObservation["errors"] = [];
    try {
      const rows = db().query("SELECT id, type, created_at, turn_id FROM codex_runtime_events WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").all(source.sourceSessionId) as Array<Record<string, unknown>>;
      if (rows.length > 0) {
        const row = rows[0];
        latest = {
          id: "nev_codex_" + String(row.id),
          sessionId: source.sourceSessionId,
          parentSessionId: null,
          runtime: this.runtime,
          kind: codexKind(String(row.type ?? "")),
          role: "assistant",
          recordedAt: row.created_at ? String(row.created_at) : null,
          observedAt: new Date(context.nowMs).toISOString(),
          toolName: null,
          summary: "codex event " + String(row.type ?? "unknown"),
          contentPreview: null,
          sourcePath: null,
          sourceOffset: null,
          sourceRevision: source.revision,
          truncated: false,
          malformed: false,
          metadata: { source: "codex_runtime_events", turnId: row.turn_id },
        };
      }
    } catch (error) {
      errors.push(makeError("SOURCE_UNREADABLE", error instanceof Error ? error.message : String(error)));
    }
    const status = typeof source.metadata.status === "string" ? source.metadata.status : "";
    const explicitEndedAt = status === "completed" || status === "failed" ? source.lastModifiedAt : null;
    return {
      sourceSessionId: source.sourceSessionId,
      workingDirectory: typeof source.projectId === "string" ? source.projectId : null,
      parentSessionId: null,
      tier: "session",
      startedAt: typeof source.metadata.createdAt === "string" ? source.metadata.createdAt : null,
      explicitEndedAt,
      latestEvent: latest,
      lastRecordedEventAt: latest?.recordedAt ?? null,
      errors,
      evidence: latest ? [{ type: "message_timestamp", source: "database", value: latest.recordedAt, observedAt: new Date(context.nowMs).toISOString(), confidence: 0.25 }] : [],
      executionHint: codexExecutionHint(status, latest?.kind ?? null),
      waitingUserHint: false,
    };
  }

  async readEvents(source: DiscoveredSource, options: { limit: number }, context: AdapterContext): Promise<{ events: NormalizedAgentEvent[]; nextOffset: null; truncated: boolean; errors: AdapterSessionObservation["errors"] }> {
    void context;
    if (!source.sourceSessionId) return { events: [], nextOffset: null, truncated: false, errors: [] };
    try {
      const rows = db().query("SELECT id, type, created_at, turn_id FROM codex_runtime_events WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?").all(source.sourceSessionId, Math.min(options.limit, 200)) as Array<Record<string, unknown>>;
      return {
        events: rows.map((row) => ({
          id: "nev_codex_" + String(row.id),
          sessionId: source.sourceSessionId as string,
          parentSessionId: null,
          runtime: this.runtime,
          kind: codexKind(String(row.type ?? "")),
          role: "assistant",
          recordedAt: row.created_at ? String(row.created_at) : null,
          observedAt: new Date().toISOString(),
          toolName: null,
          summary: "codex event " + String(row.type ?? "unknown"),
          contentPreview: null,
          sourcePath: null,
          sourceOffset: null,
          sourceRevision: source.revision,
          truncated: false,
          malformed: false,
          metadata: { source: "codex_runtime_events" },
        })),
        nextOffset: null,
        truncated: false,
        errors: [],
      };
    } catch {
      return { events: [], nextOffset: null, truncated: false, errors: [] };
    }
  }
}

function codexKind(type: string): NormalizedAgentEvent["kind"] {
  if (type === "TurnStarted") return "user_message";
  if (type === "AgentMessageCompleted" || type === "AgentMessageDelta") return "assistant_message";
  if (type === "ToolStarted") return "tool_call";
  if (type === "ToolCompleted") return "tool_result";
  if (type === "ApprovalRequested") return "system";
  if (type === "ToolFailed" || type === "SandboxViolation") return "error";
  if (type === "ThreadStarted") return "session_start";
  if (type === "RuntimeDisconnected") return "system";
  return "unknown";
}

function codexExecutionHint(status: string, kind: NormalizedAgentEvent["kind"] | null): AdapterSessionObservation["executionHint"] {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (kind === "tool_call") return "tool_running";
  if (kind === "assistant_message") return "generating";
  if (status === "running") return "generating";
  return null;
}

function workspaceLabel(root: string): string {
  const segments = root.split(/[/\\]/).filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? root;
}

// --- Generic JSONL adapter ---------------------------------------------------------------

export interface GenericSourceConfig {
  id: string;
  root: string;
  sessionIdField: string;
  timestampField: string;
  typeField: string;
  roleField: string;
  cwdField: string;
}

export class GenericJsonlAdapter implements ObservabilityAdapter {
  readonly id: string;
  readonly runtime = "generic_jsonl" as const;
  readonly capabilities: AdapterCapabilities = { ...emptyCaps(), discovery: true, events: true, integrity: true };
  private sourceConfig: GenericSourceConfig;

  constructor(config: GenericSourceConfig) {
    this.id = "generic_" + config.id;
    this.sourceConfig = config;
  }

  enabled(config: ObservabilityConfig): boolean {
    return config.adapters.genericJsonl.some((entry) => entry.id === this.sourceConfig.id);
  }

  async discover(context: AdapterContext): Promise<DiscoveredSource[]> {
    if (!this.enabled(context.config)) return [];
    const root = this.sourceConfig.root;
    if (root.length === 0 || !existsSync(root)) return [];
    if (root === "/" || root === homedir()) {
      context.emitError(this.id, makeError("SOURCE_OUTSIDE_ROOT", "refusing to scan a dangerous root (configure a specific directory)"));
      return [];
    }
    const files = listCandidateFiles(root, ".jsonl", MAX_DISCOVERY_FILES);
    const sources: DiscoveredSource[] = [];
    for (const file of files) {
      const stat = statSourceSafe(file.path);
      if (!stat) continue;
      if (!pathInsideRoot(root, file.path)) continue;
      sources.push({
        adapterId: this.id,
        runtime: this.runtime,
        sourceSessionId: null,
        sourcePath: file.path,
        projectId: this.sourceConfig.id,
        projectName: this.sourceConfig.id,
        revision: revisionOf(stat),
        sizeBytes: stat.sizeBytes,
        lastModifiedAt: stat.lastModifiedAt,
        metadata: { configId: this.sourceConfig.id },
      });
    }
    return sources;
  }

  async inspectSession(source: DiscoveredSource, context: AdapterContext): Promise<AdapterSessionObservation> {
    if (!source.sourcePath) return adapterDisabledError();
    const stat = statSourceSafe(source.sourcePath);
    if (!stat) return { ...adapterDisabledError(), errors: [makeError("SOURCE_NOT_FOUND", "source vanished")] };
    const tail = readLastCompleteLine(source.sourcePath, { chunkBytes: context.config.io.tailChunkBytes, maxTailBytes: context.config.io.detailTailMaxBytes });
    const errors = tail?.errors ?? [];
    let latestEvent: NormalizedAgentEvent | null = null;
    if (tail && tail.line.length > 0) {
      const parsed = safeParse(tail.line);
      if (parsed) {
        latestEvent = mapGenericRecord(parsed, this.sourceConfig, source, tail.endOffset, revisionOf(stat));
      } else {
        errors.push(makeError("MALFORMED_RECORD", "latest complete record failed to parse"));
      }
    }
    return {
      sourceSessionId: latestEvent?.sessionId ?? null,
      workingDirectory: latestEvent ? (latestEvent.metadata.cwd as string | undefined ?? null) : null,
      parentSessionId: null,
      tier: "worker",
      startedAt: null,
      explicitEndedAt: latestEvent?.kind === "session_end" ? latestEvent.recordedAt : null,
      latestEvent,
      lastRecordedEventAt: latestEvent?.recordedAt ?? null,
      errors,
      evidence: latestEvent ? [{ type: "message_timestamp", source: "jsonl", value: latestEvent.recordedAt, observedAt: new Date(context.nowMs).toISOString(), confidence: 0.25 }] : [],
      executionHint: latestEvent?.kind === "tool_call" ? "tool_running" : latestEvent?.kind === "assistant_message" ? "generating" : null,
      waitingUserHint: false,
    };
  }

  async readEvents(source: DiscoveredSource, options: { limit: number }): Promise<{ events: NormalizedAgentEvent[]; nextOffset: null; truncated: boolean; errors: AdapterSessionObservation["errors"] }> {
    void source;
    void options;
    return { events: [], nextOffset: null, truncated: false, errors: [] };
  }
}

function safeParse(line: string): JsonlRecordShape | null {
  try {
    return JSON.parse(line) as JsonlRecordShape;
  } catch {
    return null;
  }
}

function fieldOf(record: JsonlRecordShape, field: string): unknown {
  return record[field];
}

export function mapGenericRecord(record: JsonlRecordShape, config: GenericSourceConfig, source: DiscoveredSource, endOffset: number, revision: string | null): NormalizedAgentEvent {
  const typeRaw = fieldOf(record, config.typeField);
  const sessionId = typeof fieldOf(record, config.sessionIdField) === "string" ? String(fieldOf(record, config.sessionIdField)) : null;
  const role = typeof fieldOf(record, config.roleField) === "string" ? String(fieldOf(record, config.roleField)) : "unknown";
  const timestamp = typeof fieldOf(record, config.timestampField) === "string" ? String(fieldOf(record, config.timestampField)) : null;
  const cwd = typeof fieldOf(record, config.cwdField) === "string" ? String(fieldOf(record, config.cwdField)) : null;
  const kind: NormalizedAgentEvent["kind"] = typeRaw === "user" || typeRaw === "user_message" ? "user_message"
    : typeRaw === "assistant" || typeRaw === "assistant_message" ? "assistant_message"
    : typeRaw === "tool_call" ? "tool_call"
    : typeRaw === "tool_result" ? "tool_result"
    : typeRaw === "error" ? "error"
    : typeRaw === "session_end" ? "session_end"
    : typeRaw === "session_start" ? "session_start"
    : "unknown";
  return {
    id: "nev_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20),
    sessionId: sessionId ?? source.sourcePath ?? "unknown",
    parentSessionId: null,
    runtime: "generic_jsonl",
    kind,
    role: (role === "user" || role === "assistant" || role === "system" || role === "tool" ? role : "unknown"),
    recordedAt: timestamp,
    observedAt: new Date().toISOString(),
    toolName: null,
    summary: buildContentPreview(typeof typeRaw === "string" ? typeRaw : null, 120),
    contentPreview: buildContentPreview(JSON.stringify(record).slice(0, 400)),
    sourcePath: source.sourcePath,
    sourceOffset: endOffset,
    sourceRevision: revision,
    truncated: false,
    malformed: false,
    metadata: cwd ? { cwd } : {},
  };
}

// --- Pao-native adapter (Phase 20.39 cockpit bus) --------------------------------------------

export class PaoNativeAdapter implements ObservabilityAdapter {
  readonly id = "pao_native";
  readonly runtime = "pao_native" as const;
  readonly capabilities: AdapterCapabilities = { ...emptyCaps(), discovery: true, events: true, processEvidence: true, explicitCompletion: true };

  enabled(config: ObservabilityConfig): boolean {
    return config.adapters.paoNative.enabled;
  }

  async discover(context: AdapterContext): Promise<DiscoveredSource[]> {
    if (!this.enabled(context.config)) return [];
    try {
      const rows = db().query("SELECT id, provider_id, native_session_id, title, status, mode, workspace_id, updated_at, created_at FROM cc_sessions ORDER BY COALESCE(last_activity_at, updated_at) DESC LIMIT ?").all(500) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        adapterId: this.id,
        runtime: this.runtime,
        sourceSessionId: String(row.id),
        sourcePath: null,
        projectId: row.workspace_id ? String(row.workspace_id) : null,
        projectName: row.workspace_id ? "workspace " + String(row.workspace_id).slice(-6) : null,
        revision: String(row.updated_at ?? ""),
        sizeBytes: null,
        lastModifiedAt: row.updated_at ? String(row.updated_at) : null,
        metadata: { providerId: row.provider_id, status: row.status, mode: row.mode, title: row.title, createdAt: row.created_at },
      }));
    } catch {
      return [];
    }
  }

  async inspectSession(source: DiscoveredSource, context: AdapterContext): Promise<AdapterSessionObservation> {
    if (!source.sourceSessionId) return adapterDisabledError();
    let latest: NormalizedAgentEvent | null = null;
    try {
      const rows = db().query("SELECT sequence, type, payload_json, created_at FROM cc_session_events WHERE session_id = ? ORDER BY sequence DESC LIMIT 1").all(source.sourceSessionId) as Array<Record<string, unknown>>;
      if (rows.length > 0) {
        const row = rows[0];
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(String(row.payload_json)) as Record<string, unknown>;
        } catch {
          payload = {};
        }
        latest = {
          id: "nev_pao_" + String(row.sequence),
          sessionId: source.sourceSessionId,
          parentSessionId: null,
          runtime: this.runtime,
          kind: paoKind(String(row.type ?? "")),
          role: payload.type === "MessageCompleted" || payload.type === "MessageDelta" ? "assistant" : "system",
          recordedAt: row.created_at ? String(row.created_at) : null,
          observedAt: new Date(context.nowMs).toISOString(),
          toolName: typeof payload.toolName === "string" ? payload.toolName : null,
          summary: String(payload.type ?? row.type ?? "unknown"),
          contentPreview: buildContentPreview(typeof payload.text === "string" ? payload.text : null),
          sourcePath: null,
          sourceOffset: null,
          sourceRevision: source.revision,
          truncated: false,
          malformed: false,
          metadata: { source: "cc_session_events", providerId: source.metadata.providerId },
        };
      }
    } catch (error) {
      return { ...adapterDisabledError(), errors: [makeError("SOURCE_UNREADABLE", error instanceof Error ? error.message : String(error))] };
    }
    const status = typeof source.metadata.status === "string" ? source.metadata.status : "";
    return {
      sourceSessionId: source.sourceSessionId,
      workingDirectory: null,
      parentSessionId: null,
      tier: "session",
      startedAt: typeof source.metadata.createdAt === "string" ? source.metadata.createdAt : null,
      explicitEndedAt: status === "COMPLETED" || status === "FAILED" ? source.lastModifiedAt : null,
      latestEvent: latest,
      lastRecordedEventAt: latest?.recordedAt ?? null,
      errors: [],
      evidence: latest ? [{ type: "message_timestamp", source: "native_event_bus", value: latest.recordedAt, observedAt: new Date(context.nowMs).toISOString(), confidence: 0.45 }] : [],
      executionHint: paoExecutionHint(status, latest?.kind ?? null),
      waitingUserHint: status === "WAITING_APPROVAL",
    };
  }

  async readEvents(source: DiscoveredSource, options: { limit: number }): Promise<{ events: NormalizedAgentEvent[]; nextOffset: null; truncated: boolean; errors: AdapterSessionObservation["errors"] }> {
    if (!source.sourceSessionId) return { events: [], nextOffset: null, truncated: false, errors: [] };
    try {
      const rows = db().query("SELECT sequence, type, payload_json, created_at FROM cc_session_events WHERE session_id = ? ORDER BY sequence DESC LIMIT ?").all(source.sourceSessionId, Math.min(options.limit, 200)) as Array<Record<string, unknown>>;
      return {
        events: rows.map((row) => {
          let payload: Record<string, unknown> = {};
          try {
            payload = JSON.parse(String(row.payload_json)) as Record<string, unknown>;
          } catch {
            payload = {};
          }
          return {
            id: "nev_pao_" + String(row.sequence),
            sessionId: source.sourceSessionId as string,
            parentSessionId: null,
            runtime: this.runtime,
            kind: paoKind(String(row.type ?? "")),
            role: "assistant",
            recordedAt: row.created_at ? String(row.created_at) : null,
            observedAt: new Date().toISOString(),
            toolName: typeof payload.toolName === "string" ? payload.toolName : null,
            summary: String(payload.type ?? row.type ?? "unknown"),
            contentPreview: null,
            sourcePath: null,
            sourceOffset: null,
            sourceRevision: source.revision,
            truncated: false,
            malformed: false,
            metadata: { source: "cc_session_events" },
          };
        }),
        nextOffset: null,
        truncated: false,
        errors: [],
      };
    } catch {
      return { events: [], nextOffset: null, truncated: false, errors: [] };
    }
  }
}

function paoKind(type: string): NormalizedAgentEvent["kind"] {
  if (type === "MessageCompleted" || type === "MessageDelta") return "assistant_message";
  if (type === "ToolStarted") return "tool_call";
  if (type === "ToolCompleted" || type === "ToolOutput") return "tool_result";
  if (type === "ApprovalRequired") return "system";
  if (type === "RuntimeError") return "error";
  if (type === "SessionStarted") return "session_start";
  if (type === "SessionCompleted") return "session_end";
  if (type === "UsageUpdated") return "metadata";
  return "unknown";
}

function paoExecutionHint(status: string, kind: NormalizedAgentEvent["kind"] | null): AdapterSessionObservation["executionHint"] {
  if (status === "WAITING_APPROVAL") return "waiting_user";
  if (status === "FAILED") return "failed";
  if (status === "COMPLETED") return "completed";
  if (status === "RUNNING") {
    if (kind === "tool_call") return "tool_running";
    return "generating";
  }
  return null;
}
