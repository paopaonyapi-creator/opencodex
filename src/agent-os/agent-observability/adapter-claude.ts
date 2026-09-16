// Phase 20.40 — Adapter registry + Claude Code JSONL adapter (spec §12, §13).
// Clean-room decoder for generic agent JSONL shapes: tolerant field mapping,
// complete records only, tier detection from structured sidechain evidence
// before filename conventions. Discovery never follows directory symlinks
// and rejects sources resolving outside the configured root.

import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import {
  listCandidateFiles,
  makeError,
  pathInsideRoot,
  readHeadText,
  readLastCompleteLine,
  revisionOf,
  statSourceSafe,
} from "./scanner";
import { buildContentPreview } from "./redaction";
import type {
  AdapterCapabilities,
  AdapterContext,
  AdapterEventBatch,
  AdapterSessionObservation,
  DiscoveredSource,
  EventKind,
  EventRole,
  NormalizedAgentEvent,
  ObservabilityAdapter,
  ObservabilityConfig,
  ReadEventsOptions,
  SessionTier,
} from "./types";

const MAX_DISCOVERY_FILES = 5000;

export function adapterDisabledError(): AdapterSessionObservation {
  return {
    sourceSessionId: null,
    workingDirectory: null,
    parentSessionId: null,
    tier: "session",
    startedAt: null,
    explicitEndedAt: null,
    latestEvent: null,
    lastRecordedEventAt: null,
    errors: [makeError("UNSUPPORTED", "adapter disabled by configuration")],
    evidence: [],
    executionHint: null,
    waitingUserHint: false,
  };
}

function emptyCapabilities(): AdapterCapabilities {
  return { discovery: false, events: false, processEvidence: false, explicitCompletion: false, integrity: false };
}

// --- Claude Code JSONL adapter ------------------------------------------------------

interface JsonlRecord {
  sessionId?: unknown;
  type?: unknown;
  timestamp?: unknown;
  cwd?: unknown;
  parentUuid?: unknown;
  isSidechain?: unknown;
  message?: { role?: unknown; content?: unknown };
  toolName?: unknown;
  subtype?: unknown;
  [key: string]: unknown;
}

export type JsonlRecordShape = JsonlRecord;

export class ClaudeJsonlAdapter implements ObservabilityAdapter {
  readonly id = "claude_jsonl";
  readonly runtime = "claude_code" as const;
  readonly capabilities: AdapterCapabilities = { ...emptyCapabilities(), discovery: true, events: true, processEvidence: true, explicitCompletion: true, integrity: true };

  enabled(config: ObservabilityConfig): boolean {
    return config.adapters.claudeJsonl.enabled;
  }

  private rootOverride = "";

  configure(root: string): void {
    this.rootOverride = root;
  }

  private rootPath(): string {
    return this.rootOverride;
  }

  async discover(context: AdapterContext): Promise<DiscoveredSource[]> {
    if (!this.enabled(context.config)) return [];
    const root = this.rootPath();
    if (root.length === 0 || !existsSync(root)) return [];
    const files = listCandidateFiles(root, ".jsonl", MAX_DISCOVERY_FILES);
    const sources: DiscoveredSource[] = [];
    for (const file of files) {
      const stat = statSourceSafe(file.path);
      if (!stat) continue;
      if (!pathInsideRoot(root, file.path)) {
        context.emitError(file.path, makeError("SOURCE_OUTSIDE_ROOT", "source resolves outside the configured root"));
        continue;
      }
      sources.push({
        adapterId: this.id,
        runtime: this.runtime,
        sourceSessionId: sessionIdFromName(basename(file.path)),
        sourcePath: file.path,
        projectId: basename(root === file.path ? file.path : file.path.split(root)[1] ?? file.path, ".jsonl"),
        projectName: pathInsideRoot(root, file.path) ? projectLabel(root, file.path) : null,
        revision: revisionOf(stat),
        sizeBytes: stat.sizeBytes,
        lastModifiedAt: stat.lastModifiedAt,
        metadata: { depth: file.depth },
      });
    }
    return sources;
  }

  async inspectSession(source: DiscoveredSource, context: AdapterContext): Promise<AdapterSessionObservation> {
    if (!source.sourcePath) return adapterDisabledError();
    const stat = statSourceSafe(source.sourcePath);
    if (!stat) {
      return {
        ...adapterDisabledError(),
        errors: [makeError("SOURCE_NOT_FOUND", "source file disappeared during scan")],
      };
    }
    const config = context.config;
    const tail = readLastCompleteLine(source.sourcePath, { chunkBytes: config.io.tailChunkBytes, maxTailBytes: config.io.detailTailMaxBytes });
    const head = readHeadText(source.sourcePath, config.io.headMaxBytes);
    const headMeta = headMetadata(head);
    const errors = tail?.errors ?? [];
    let latestEvent: NormalizedAgentEvent | null = null;
    let lastRecordedEventAt: string | null = null;
    let explicitEndedAt: string | null = null;
    let executionHint: AdapterSessionObservation["executionHint"] = null;
    let waitingUserHint = false;
    if (tail && tail.line.length > 0) {
      const record = safeParse<JsonlRecord>(tail.line);
      if (record) {
        const decoded = decodeRecord(record, source, tail.endOffset, revisionOf(stat));
        latestEvent = decoded;
        lastRecordedEventAt = decoded.recordedAt;
        executionHint = executionHintFor(decoded.kind);
        if (decoded.kind === "session_end") explicitEndedAt = decoded.recordedAt;
        if (decoded.kind === "error") executionHint = "failed";
        if (decoded.kind === "tool_call" || decoded.kind === "tool_result") {
          executionHint = decoded.kind === "tool_call" ? "tool_running" : executionHint;
        }
        if (decoded.summary !== null && /waiting for (user|your) input/i.test(decoded.summary)) waitingUserHint = true;
      } else {
        errors.push(makeError("MALFORMED_RECORD", "latest complete record failed to parse"));
      }
    }
    const evidence: AdapterSessionObservation["evidence"] = [
      { type: "file_revision", source: "jsonl", value: revisionOf(stat), observedAt: new Date(context.nowMs).toISOString(), confidence: 0.6 },
      { type: "file_mtime", source: "filesystem", value: stat.lastModifiedAt, observedAt: new Date(context.nowMs).toISOString(), confidence: 0.05 },
    ];
    if (latestEvent?.recordedAt) {
      evidence.push({ type: "message_timestamp", source: "jsonl", value: latestEvent.recordedAt, observedAt: new Date(context.nowMs).toISOString(), confidence: 0.25 });
    }
    if (tail?.malformed) {
      evidence.push({ type: "adapter_signal", source: "jsonl", value: "malformed_latest_record", observedAt: new Date(context.nowMs).toISOString(), confidence: 0.1 });
    }
    return {
      sourceSessionId: headMeta.sessionId ?? source.sourceSessionId,
      workingDirectory: headMeta.cwd,
      parentSessionId: headMeta.parentSessionId,
      tier: headMeta.tier,
      startedAt: headMeta.startedAt,
      explicitEndedAt,
      latestEvent,
      lastRecordedEventAt,
      errors,
      evidence,
      executionHint,
      waitingUserHint,
    };
  }

  async readEvents(source: DiscoveredSource, options: ReadEventsOptions, context: AdapterContext): Promise<AdapterEventBatch> {
    void context;
    if (!source.sourcePath) return { events: [], nextOffset: null, truncated: false, errors: [makeError("UNSUPPORTED", "no source path")] };
    // Event listing uses the tail window only (bounded); full-history
    // indexing is not performed during scans (spec §41).
    const tail = readLastCompleteLine(source.sourcePath, { chunkBytes: options.maxTailBytes, maxTailBytes: options.maxTailBytes });
    const errors = tail?.errors ?? [];
    const events: NormalizedAgentEvent[] = [];
    if (tail && tail.line.length > 0) {
      const record = safeParse<JsonlRecord>(tail.line);
      if (record) {
        const stat = statSourceSafe(source.sourcePath);
        const decoded = decodeRecord(record, source, tail.endOffset, stat ? revisionOf(stat) : null);
        events.push(decoded);
      }
    }
    return { events, nextOffset: null, truncated: false, errors };
  }

  async verifyIntegrity(source: DiscoveredSource, options: { algorithm: "sha256"; force: boolean }, context: AdapterContext): Promise<{ algorithm: "sha256"; digest: string | null; sourceRevision: string | null; previousDigest: string | null; status: "unchecked" | "verified" | "changed" | "unavailable" | "error"; checkedAt: string; error: import("./types").SessionObservationError | null }> {
    void context;
    void source;
    void options;
    // Implemented by the engine (which owns the hash cache); adapters do not
    // hash directly. Reported unsupported at the adapter level.
    return { algorithm: "sha256", digest: null, sourceRevision: source.revision, previousDigest: null, status: "unavailable", checkedAt: new Date().toISOString(), error: makeError("UNSUPPORTED", "integrity verification is engine-owned") };
  }
}

// --- record decoding ---------------------------------------------------------------

function safeParse<T>(line: string): T | null {
  try {
    return JSON.parse(line) as T;
  } catch {
    return null;
  }
}

function sessionIdFromName(name: string): string | null {
  const stem = name.replace(/\.jsonl$/, "");
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stem)) return stem;
  return null;
}

function projectLabel(root: string, filePath: string): string {
  const relative = filePath.startsWith(root) ? filePath.slice(root.length) : filePath;
  const segments = relative.split(/[/\\]/).filter((segment) => segment.length > 0);
  return segments.length > 1 ? segments[0] : "project";
}

function headMetadata(head: string): { sessionId: string | null; cwd: string | null; parentSessionId: string | null; tier: SessionTier; startedAt: string | null } {
  const lines = head.split("\n").filter((line) => line.trim().length > 0);
  let sessionId: string | null = null;
  let cwd: string | null = null;
  let parentSessionId: string | null = null;
  let tier: SessionTier = "session";
  let startedAt: string | null = null;
  let sidechain = false;
  for (const line of lines.slice(0, 64)) {
    const record = safeParse<JsonlRecord>(line);
    if (!record) continue;
    if (typeof record.sessionId === "string" && sessionId === null) sessionId = record.sessionId;
    if (typeof record.cwd === "string" && cwd === null) cwd = record.cwd;
    if (typeof record.timestamp === "string" && startedAt === null) startedAt = record.timestamp;
    if (record.isSidechain === true) sidechain = true;
    if (typeof record.parentUuid === "string" && parentSessionId === null) parentSessionId = null; // parentUuid is message-level, not session-level
  }
  if (sidechain) tier = "subagent";
  if (sessionId === null) sessionId = null;
  return { sessionId, cwd, parentSessionId, tier, startedAt };
}

function kindFor(record: JsonlRecord): EventKind {
  const type = typeof record.type === "string" ? record.type : "";
  if (type === "user") return "user_message";
  if (type === "assistant") {
    if (hasToolUse(record)) return "tool_call";
    return "assistant_message";
  }
  if (type === "system") {
    if (record.subtype === "init") return "session_start";
    return "system";
  }
  if (type === "summary") return "metadata";
  if (type === "result") return "session_end";
  if (type === "error") return "error";
  return "unknown";
}

function hasToolUse(record: JsonlRecord): boolean {
  const content = record.message?.content;
  if (!Array.isArray(content)) return false;
  return content.some((block) => block && typeof block === "object" && (block as { type?: unknown }).type === "tool_use");
}

function firstToolName(record: JsonlRecord): string | null {
  const content = record.message?.content;
  if (!Array.isArray(content)) {
    return typeof record.toolName === "string" ? record.toolName : null;
  }
  for (const block of content) {
    if (block && typeof block === "object") {
      const candidate = block as { type?: unknown; name?: unknown };
      if (candidate.type === "tool_use" && typeof candidate.name === "string") return candidate.name;
    }
  }
  return null;
}

function firstText(record: JsonlRecord): string | null {
  const content = record.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (block && typeof block === "object") {
      const candidate = block as { type?: unknown; text?: unknown };
      if (candidate.type === "text" && typeof candidate.text === "string") return candidate.text;
    }
  }
  return null;
}

function roleFor(kind: EventKind, record: JsonlRecord): EventRole {
  if (kind === "user_message") return "user";
  if (kind === "assistant_message" || kind === "tool_call" || kind === "thinking") return "assistant";
  if (kind === "system" || kind === "session_start" || kind === "session_end") return "system";
  if (kind === "error") return "system";
  const messageRole = typeof record.message?.role === "string" ? record.message.role : "";
  if (messageRole === "user" || messageRole === "assistant" || messageRole === "system" || messageRole === "tool") return messageRole;
  return "unknown";
}

function executionHintFor(kind: EventKind): AdapterSessionObservation["executionHint"] {
  switch (kind) {
    case "tool_call":
      return "tool_running";
    case "tool_result":
      return "generating";
    case "assistant_message":
      return "generating";
    case "user_message":
      return "thinking";
    case "session_end":
      return "completed";
    case "error":
      return "failed";
    default:
      return null;
  }
}

export function decodeRecord(record: JsonlRecord, source: DiscoveredSource, endOffset: number, revision: string | null): NormalizedAgentEvent {
  const kind = kindFor(record);
  const text = firstText(record);
  const toolName = firstToolName(record);
  return {
    id: "nev_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20),
    sessionId: source.sourceSessionId ?? "unknown",
    parentSessionId: null,
    runtime: source.runtime,
    kind,
    role: roleFor(kind, record),
    recordedAt: typeof record.timestamp === "string" ? record.timestamp : null,
    observedAt: new Date().toISOString(),
    toolName,
    summary: kind === "tool_call" && toolName ? "tool call: " + toolName : buildContentPreview(text, 160),
    contentPreview: buildContentPreview(text),
    sourcePath: source.sourcePath,
    sourceOffset: endOffset,
    sourceRevision: revision,
    truncated: false,
    malformed: false,
    metadata: { adapter: source.adapterId, tier: (record.isSidechain === true ? "subagent" : "session") as SessionTier },
  };
}

/** Shared helper for building joined paths safely. */
export function joinUnder(root: string, child: string): string | null {
  const full = join(root, child);
  return pathInsideRoot(root, full) ? full : null;
}
