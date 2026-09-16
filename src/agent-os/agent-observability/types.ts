// Phase 20.40 — Agent Observability Control Plane (JSONL liveness, session
// health, live activity). READ-ONLY by construction: this plane observes
// transcripts/processes/event buses and never mutates monitored sources,
// never kills/restarts/controls processes, and never sends prompts. All
// derived states carry explicit evidence + confidence; missing evidence
// means "unknown", never "stopped" or "completed" (spec §1, §55).

// --- Runtimes / sources (spec §8) --------------------------------------------------

export type AgentRuntime =
  | "claude_code"
  | "openai_codex"
  | "pao_native"
  | "generic_jsonl"
  | "mcp_worker"
  | "unknown";

export type ObservationSource =
  | "jsonl"
  | "process_table"
  | "native_event_bus"
  | "database"
  | "filesystem"
  | "api"
  | "unknown";

// --- State planes (spec §8.3–§8.7) ---------------------------------------------------

export type ActivityState = "active" | "recent" | "idle" | "stale" | "unknown";
export type ProcessState = "running" | "not_observed" | "unknown" | "unsupported";
export type ExecutionState =
  | "thinking" | "generating" | "tool_running" | "waiting_user" | "waiting_agent"
  | "queued" | "retrying" | "completed" | "failed" | "cancelled" | "unknown";
export type HealthState = "healthy" | "degraded" | "stalled" | "error" | "unknown";
export type IntegrityState = "unchecked" | "verified" | "changed" | "unavailable" | "error";

// --- Evidence (spec §11) -----------------------------------------------------------------

export type EvidenceType =
  | "file_revision" | "file_mtime" | "message_timestamp" | "event_type" | "pid_match"
  | "process_scan" | "explicit_end_marker" | "tool_call" | "tool_result" | "error_event"
  | "hash" | "adapter_signal";

export interface EvidenceRecord {
  type: EvidenceType;
  source: ObservationSource;
  value: unknown;
  observedAt: string;
  confidence: number;
}

export type SessionObservationErrorCode =
  | "SOURCE_NOT_FOUND"
  | "SOURCE_UNREADABLE"
  | "SOURCE_OUTSIDE_ROOT"
  | "MALFORMED_RECORD"
  | "TAIL_LIMIT_REACHED"
  | "PROCESS_SCAN_FAILED"
  | "HASH_FAILED"
  | "ADAPTER_TIMEOUT"
  | "UNSUPPORTED"
  | "UNKNOWN";

export interface SessionObservationError {
  code: SessionObservationErrorCode;
  message: string;
  recoverable: boolean;
  observedAt: string;
}

// --- Normalized event (spec §10) ---------------------------------------------------------------

export type EventKind =
  | "user_message" | "assistant_message" | "thinking" | "tool_call" | "tool_result"
  | "system" | "session_start" | "session_end" | "error" | "retry" | "workflow"
  | "metadata" | "unknown";

export type EventRole = "user" | "assistant" | "system" | "tool" | "unknown";

export interface NormalizedAgentEvent {
  id: string;
  sessionId: string;
  parentSessionId: string | null;
  runtime: AgentRuntime;
  kind: EventKind;
  role: EventRole;
  recordedAt: string | null;
  observedAt: string;
  toolName: string | null;
  summary: string | null;
  contentPreview: string | null;
  sourcePath: string | null;
  sourceOffset: number | null;
  sourceRevision: string | null;
  truncated: boolean;
  malformed: boolean;
  metadata: Record<string, unknown>;
}

// --- Canonical session (spec §9) --------------------------------------------------------------------

export type SessionTier = "session" | "subagent" | "workflow_agent" | "workflow_journal" | "worker";

export interface AgentSession {
  id: string;
  sourceSessionId: string | null;
  runtime: AgentRuntime;
  sourceType: ObservationSource;
  projectId: string | null;
  projectName: string | null;
  workingDirectory: string | null;
  parentSessionId: string | null;
  rootSessionId: string | null;
  depth: number;
  tier: SessionTier;
  alias: string | null;
  activityState: ActivityState;
  processState: ProcessState;
  executionState: ExecutionState;
  healthState: HealthState;
  integrityState: IntegrityState;
  confidence: number;
  confidenceFactors: ConfidenceFactor[];
  startedAt: string | null;
  lastRecordedEventAt: string | null;
  lastFileModifiedAt: string | null;
  explicitEndedAt: string | null;
  latestEventType: string | null;
  latestRole: string | null;
  latestToolName: string | null;
  processIds: number[];
  sourcePath: string | null;
  sourceRevision: string | null;
  sizeBytes: number | null;
  errors: SessionObservationError[];
  evidence: EvidenceRecord[];
  observedAt: string;
}

export interface ConfidenceFactor {
  rule: string;
  weight: number;
}

// --- Adapter contract (spec §12) ------------------------------------------------------------------------

export interface AdapterContext {
  nowMs: number;
  config: ObservabilityConfig;
  emitError: (sessionKey: string, error: SessionObservationError) => void;
}

export interface DiscoveredSource {
  adapterId: string;
  runtime: AgentRuntime;
  sourceSessionId: string | null;
  sourcePath: string | null;
  projectId: string | null;
  projectName: string | null;
  revision: string | null;
  sizeBytes: number | null;
  lastModifiedAt: string | null;
  metadata: Record<string, unknown>;
}

export interface AdapterSessionObservation {
  sourceSessionId: string | null;
  workingDirectory: string | null;
  parentSessionId: string | null;
  tier: SessionTier;
  startedAt: string | null;
  explicitEndedAt: string | null;
  latestEvent: NormalizedAgentEvent | null;
  lastRecordedEventAt: string | null;
  errors: SessionObservationError[];
  evidence: EvidenceRecord[];
  executionHint: ExecutionState | null;
  waitingUserHint: boolean;
}

export interface ReadEventsOptions {
  afterOffset?: number;
  limit: number;
  maxTailBytes: number;
}

export interface AdapterEventBatch {
  events: NormalizedAgentEvent[];
  nextOffset: number | null;
  truncated: boolean;
  errors: SessionObservationError[];
}

export interface ProcessHint {
  pid: number;
  processName: string;
  runtime: AgentRuntime;
  matchType: "exact_session_arg" | "registry" | "process_name_only";
  matchConfidence: number;
  sessionId: string | null;
  commandHash: string | null;
}

export interface IntegrityOptions {
  algorithm: "sha256";
  force: boolean;
}

export interface IntegrityResult {
  algorithm: "sha256";
  digest: string | null;
  sourceRevision: string | null;
  previousDigest: string | null;
  status: IntegrityState;
  checkedAt: string;
  error: SessionObservationError | null;
}

export interface AdapterCapabilities {
  discovery: boolean;
  events: boolean;
  processEvidence: boolean;
  explicitCompletion: boolean;
  integrity: boolean;
}

export interface ObservabilityAdapter {
  id: string;
  runtime: AgentRuntime;
  capabilities: AdapterCapabilities;
  enabled(config: ObservabilityConfig): boolean;
  discover(context: AdapterContext): Promise<DiscoveredSource[]>;
  inspectSession(source: DiscoveredSource, context: AdapterContext): Promise<AdapterSessionObservation>;
  readEvents(source: DiscoveredSource, options: ReadEventsOptions, context: AdapterContext): Promise<AdapterEventBatch>;
  collectProcessHints?(context: AdapterContext): Promise<ProcessHint[]>;
  verifyIntegrity?(source: DiscoveredSource, options: IntegrityOptions, context: AdapterContext): Promise<IntegrityResult>;
}

// --- Configuration (spec §39) ------------------------------------------------------------------------------

export interface ObservabilityConfig {
  enabled: boolean;
  snapshotMs: number;
  processMs: number;
  thresholds: { activeMs: number; recentMs: number; idleMs: number; stalledMs: number };
  io: { tailChunkBytes: number; headMaxBytes: number; detailTailMaxBytes: number; maxEventsPerSession: number; maxTimelineEvents: number };
  privacy: { persistContentPreview: boolean; exposeAbsolutePaths: boolean; persistAbsolutePaths: boolean };
  integrity: { algorithm: "sha256"; autoHash: boolean };
  adapters: {
    claudeJsonl: { enabled: boolean; root: string };
    codex: { enabled: boolean };
    paoNative: { enabled: boolean };
    genericJsonl: Array<{ id: string; root: string; sessionIdField: string; timestampField: string; typeField: string; roleField: string; cwdField: string }>;
  };
  retention: { eventsDays: number; scanCyclesDays: number; processEvidenceHours: number; alertsDays: number; integrityDays: number };
}

// --- Alerts (spec §35) -----------------------------------------------------------------------------------------

export type AlertSeverity = "info" | "warning" | "error" | "critical";

export type AlertConditionType =
  | "session_stalled"
  | "explicit_failure"
  | "adapter_unhealthy"
  | "repeated_parse_errors"
  | "integrity_changed"
  | "silent_running";

export interface AlertRule {
  id: string;
  name: string;
  conditionType: AlertConditionType;
  severity: AlertSeverity;
  enabled: boolean;
  cooldownSeconds: number;
  scopeJson: string;
  conditionJson: string;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  sessionId: string | null;
  severity: AlertSeverity;
  title: string;
  detailsJson: string;
  dedupeKey: string;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  notificationState: string;
}

// --- Fleet snapshot / timeline (spec §24, §27) -----------------------------------------------------------------------

export interface FleetSummary {
  sessions: number;
  active: number;
  recent: number;
  idle: number;
  stale: number;
  stalled: number;
  failed: number;
  adapterErrors: number;
  unknown: number;
}

export interface FleetSnapshot {
  observedAt: string;
  scan: { durationMs: number; adapterErrors: number; cacheHits: number; cacheMisses: number; sourcesSeen: number; sourcesChanged: number };
  summary: FleetSummary;
  sessions: AgentSession[];
}

export interface TimelineFilter {
  runtime?: AgentRuntime;
  projectId?: string;
  sessionId?: string;
  parentSessionId?: string;
  rootSessionId?: string;
  kinds?: EventKind[];
  role?: EventRole;
  tier?: SessionTier;
  errorsOnly?: boolean;
  search?: string;
  sinceIso?: string;
  untilIso?: string;
  limit: number;
}

export interface ScanCycleRecord {
  id: string;
  adapterId: string;
  startedAt: string;
  finishedAt: string | null;
  scanMs: number;
  sourcesSeen: number;
  sourcesChanged: number;
  eventsEmitted: number;
  errorsCount: number;
}

export interface ObservabilityStats {
  scanTotal: number;
  scanErrorsTotal: number;
  lastScanDurationMs: number | null;
  lastScanAt: string | null;
  sourcesTotal: number;
  sourceChangesTotal: number;
  cacheHitsTotal: number;
  cacheMissesTotal: number;
  tailReadsTotal: number;
  parseErrorsTotal: number;
  sessionsTotal: number;
  sessionsStalled: number;
  alertsOpen: number;
  sseClients: number;
}

// --- SSE stream (spec §28) -----------------------------------------------------------------------------------------------

export type ObservabilityStreamEvent =
  | { type: "snapshot"; sequence: number; observedAt: string; summary: FleetSummary }
  | { type: "session_changed"; sequence: number; observedAt: string; sessionId: string }
  | { type: "session_added"; sequence: number; observedAt: string; sessionId: string }
  | { type: "session_removed"; sequence: number; observedAt: string; sessionId: string }
  | { type: "agent_event"; sequence: number; observedAt: string; event: NormalizedAgentEvent }
  | { type: "alert_opened"; sequence: number; observedAt: string; alertId: string }
  | { type: "alert_resolved"; sequence: number; observedAt: string; alertId: string }
  | { type: "adapter_error"; sequence: number; observedAt: string; adapterId: string; code: string }
  | { type: "heartbeat"; sequence: number; observedAt: string };
