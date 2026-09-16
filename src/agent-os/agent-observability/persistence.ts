// Phase 20.40 — ObservabilityStore: persistence for the read-only control
// plane on the shared agent-os SQLite store (schema v40, additive). Literal
// single-line SQL with positional parameters only; upserts are
// read-then-write against unique keys. Wide session rows are written in
// narrow statements (insert base + state/timing updates). Absolute paths
// are persisted only when privacy.persistAbsolutePaths is enabled; otherwise
// a path hash is the durable correlation key (spec §32).

import { createHash } from "node:crypto";
import { openAgentOsDb } from "../db";
import type {
  AgentSession,
  AlertEvent,
  AlertRule,
  EvidenceRecord,
  EventKind,
  EventRole,
  NormalizedAgentEvent,
  ScanCycleRecord,
  SessionObservationError,
  SessionTier,
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function shortId(prefix: string): string {
  return prefix + "_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

export function pathHashOf(path: string | null): string | null {
  if (!path) return null;
  return "sha256:" + createHash("sha256").update(path).digest("hex").slice(0, 24);
}

export interface SessionRowInput {
  sourceSessionId: string | null;
  runtime: AgentSession["runtime"];
  sourceType: AgentSession["sourceType"];
  projectId: string | null;
  projectName: string | null;
  workingDirectoryHash: string | null;
  parentSessionId: string | null;
  rootSessionId: string | null;
  depth: number;
  tier: SessionTier;
  sourcePathHash: string | null;
  sourceRevision: string | null;
  sizeBytes: number | null;
}

export interface SessionStates {
  activity: string;
  process: string;
  execution: string;
  health: string;
  integrity: string;
  confidence: number;
}

export interface SessionTiming {
  startedAt: string | null;
  lastRecordedEventAt: string | null;
  lastFileModifiedAt: string | null;
  explicitEndedAt: string | null;
  eventType: string | null;
  role: string | null;
  toolName: string | null;
}

export class ObservabilityStore {
  private db = openAgentOsDb();

  // --- Sessions (lookup by (runtime, source_session_id) then path hash) ---

  findSessionByRuntimeSource(runtime: string, sourceSessionId: string | null, sourcePathHash: string | null): AgentSession | null {
    if (sourceSessionId) {
      const row = this.db.query("SELECT * FROM observability_sessions WHERE runtime = ? AND source_session_id = ? LIMIT 1").get(runtime, sourceSessionId) as Record<string, unknown> | null;
      if (row) return mapSession(row);
    }
    if (sourcePathHash) {
      const row = this.db.query("SELECT * FROM observability_sessions WHERE source_path_hash = ? LIMIT 1").get(sourcePathHash) as Record<string, unknown> | null;
      if (row) return mapSession(row);
    }
    return null;
  }

  getSession(id: string): AgentSession | null {
    const row = this.db.query("SELECT * FROM observability_sessions WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapSession(row) : null;
  }

  /** Insert the identity half of a session row, then apply state + timing
   *  halves as narrow updates (keeps every statement small). */
  insertSession(input: SessionRowInput): AgentSession {
    const id = shortId("obs");
    const now = nowIso();
    this.db
      .query("INSERT INTO observability_sessions (id, source_session_id, runtime, source_type, project_id, project_name, working_directory_hash, parent_session_id, root_session_id, depth, tier, source_path_hash, source_revision, source_size_bytes, first_observed_at, last_observed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, input.sourceSessionId, input.runtime, input.sourceType, input.projectId, input.projectName, input.workingDirectoryHash, input.parentSessionId, input.rootSessionId, input.depth, input.tier, input.sourcePathHash, input.sourceRevision, input.sizeBytes, now, now, now, now);
    return this.getSession(id) as AgentSession;
  }

  updateSessionStates(id: string, states: SessionStates): void {
    this.db
      .query("UPDATE observability_sessions SET activity_state = ?, process_state = ?, execution_state = ?, health_state = ?, integrity_state = ?, confidence = ?, updated_at = ? WHERE id = ?")
      .run(states.activity, states.process, states.execution, states.health, states.integrity, states.confidence, nowIso(), id);
  }

  updateSessionTiming(id: string, timing: SessionTiming, revision: { sourceRevision: string | null; sizeBytes: number | null }): void {
    this.db
      .query("UPDATE observability_sessions SET started_at = ?, last_recorded_event_at = ?, last_file_modified_at = ?, explicit_ended_at = ?, latest_event_type = ?, latest_role = ?, latest_tool_name = ?, source_revision = ?, source_size_bytes = ?, last_observed_at = ?, updated_at = ? WHERE id = ?")
      .run(timing.startedAt, timing.lastRecordedEventAt, timing.lastFileModifiedAt, timing.explicitEndedAt, timing.eventType, timing.role, timing.toolName, revision.sourceRevision, revision.sizeBytes, nowIso(), nowIso(), id);
  }

  listSessions(filter: { runtime?: string; healthState?: string; activityState?: string; limit?: number } = {}): AgentSession[] {
    const limit = filter.limit ?? 500;
    let rows: Array<Record<string, unknown>>;
    if (filter.runtime) {
      rows = this.db.query("SELECT * FROM observability_sessions WHERE runtime = ? ORDER BY COALESCE(last_recorded_event_at, last_observed_at) DESC LIMIT ?").all(filter.runtime, limit) as Array<Record<string, unknown>>;
    } else if (filter.healthState) {
      rows = this.db.query("SELECT * FROM observability_sessions WHERE health_state = ? ORDER BY COALESCE(last_recorded_event_at, last_observed_at) DESC LIMIT ?").all(filter.healthState, limit) as Array<Record<string, unknown>>;
    } else if (filter.activityState) {
      rows = this.db.query("SELECT * FROM observability_sessions WHERE activity_state = ? ORDER BY COALESCE(last_recorded_event_at, last_observed_at) DESC LIMIT ?").all(filter.activityState, limit) as Array<Record<string, unknown>>;
    } else {
      rows = this.db.query("SELECT * FROM observability_sessions ORDER BY COALESCE(last_recorded_event_at, last_observed_at) DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>;
    }
    return rows.map(mapSession);
  }

  // --- Events -------------------------------------------------------------------------

  insertEvent(event: NormalizedAgentEvent, contentPreview: string | null): void {
    this.db
      .query("INSERT INTO observability_events (id, session_id, runtime, kind, role, recorded_at, observed_at, tool_name, summary, content_preview, source_offset, source_revision, truncated, malformed, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(event.id, event.sessionId, event.runtime, event.kind, event.role, event.recordedAt, event.observedAt, event.toolName, event.summary, contentPreview, event.sourceOffset, event.sourceRevision, event.truncated ? 1 : 0, event.malformed ? 1 : 0, JSON.stringify(event.metadata), nowIso());
  }

  listEvents(filter: { sessionId?: string; kinds?: string[]; errorsOnly?: boolean; search?: string; sinceIso?: string; limit: number }): NormalizedAgentEvent[] {
    const limit = Math.max(1, Math.min(filter.limit, 500));
    let rows: Array<Record<string, unknown>>;
    if (filter.sessionId) {
      rows = this.db.query("SELECT * FROM observability_events WHERE session_id = ? ORDER BY COALESCE(recorded_at, observed_at) DESC LIMIT ?").all(filter.sessionId, limit) as Array<Record<string, unknown>>;
    } else if (filter.sinceIso) {
      rows = this.db.query("SELECT * FROM observability_events WHERE COALESCE(recorded_at, observed_at) >= ? ORDER BY COALESCE(recorded_at, observed_at) DESC LIMIT ?").all(filter.sinceIso, limit) as Array<Record<string, unknown>>;
    } else {
      rows = this.db.query("SELECT * FROM observability_events ORDER BY COALESCE(recorded_at, observed_at) DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>;
    }
    let mapped = rows.map(mapEvent);
    if (filter.kinds && filter.kinds.length > 0) {
      const allowed = new Set(filter.kinds);
      mapped = mapped.filter((event) => allowed.has(event.kind));
    }
    if (filter.errorsOnly) {
      mapped = mapped.filter((event) => event.kind === "error" || event.malformed);
    }
    if (filter.search && filter.search.length > 0) {
      const needle = filter.search.toLowerCase();
      mapped = mapped.filter((event) =>
        (event.summary ?? "").toLowerCase().includes(needle)
        || (event.contentPreview ?? "").toLowerCase().includes(needle)
        || (event.toolName ?? "").toLowerCase().includes(needle));
    }
    return mapped;
  }

  countEvents(): number {
    const row = this.db.query("SELECT COUNT(*) AS n FROM observability_events").get() as { n: number };
    return row.n;
  }

  // --- Evidence ---------------------------------------------------------------------------

  insertEvidenceBatch(sessionId: string, cycleId: string | null, evidence: EvidenceRecord[]): void {
    for (const item of evidence.slice(0, 32)) {
      this.db
        .query("INSERT INTO observability_evidence (id, session_id, observation_cycle_id, type, source, value_json, confidence, observed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(shortId("evd"), sessionId, cycleId, item.type, item.source, JSON.stringify(item.value), item.confidence, item.observedAt, nowIso());
    }
  }

  listEvidence(sessionId: string, limit = 50): EvidenceRecord[] {
    const rows = this.db.query("SELECT * FROM observability_evidence WHERE session_id = ? ORDER BY observed_at DESC LIMIT ?").all(sessionId, limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      type: String(row.type) as EvidenceRecord["type"],
      source: String(row.source) as EvidenceRecord["source"],
      value: row.value_json ? JSON.parse(String(row.value_json)) : null,
      observedAt: String(row.observed_at),
      confidence: Number(row.confidence ?? 0),
    }));
  }

  // --- Process evidence ---------------------------------------------------------------------

  insertProcessEvidence(items: Array<{ sessionId: string | null; runtime: string; pid: number; processName: string; matchType: string; matchConfidence: number; commandHash: string | null; expiresAt: string }>): void {
    for (const item of items.slice(0, 200)) {
      this.db
        .query("INSERT INTO observability_process_evidence (id, session_id, runtime, pid, process_name, match_type, match_confidence, command_hash, observed_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(shortId("prc"), item.sessionId, item.runtime, item.pid, item.processName, item.matchType, item.matchConfidence, item.commandHash, nowIso(), item.expiresAt);
    }
  }

  listProcessEvidence(sessionId: string, limit = 20): Array<{ pid: number; processName: string; matchType: string; matchConfidence: number; observedAt: string }> {
    const rows = this.db.query("SELECT * FROM observability_process_evidence WHERE session_id = ? ORDER BY observed_at DESC LIMIT ?").all(sessionId, limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      pid: Number(row.pid),
      processName: String(row.process_name),
      matchType: String(row.match_type),
      matchConfidence: Number(row.match_confidence),
      observedAt: String(row.observed_at),
    }));
  }

  // --- Integrity ------------------------------------------------------------------------------

  lastIntegrityCheck(sessionId: string): { digest: string | null; status: string; sourceRevision: string | null; checkedAt: string } | null {
    const row = this.db.query("SELECT * FROM observability_integrity_checks WHERE session_id = ? ORDER BY checked_at DESC LIMIT 1").get(sessionId) as Record<string, unknown> | null;
    if (!row) return null;
    return { digest: row.fingerprint ? String(row.fingerprint) : null, status: String(row.status), sourceRevision: row.source_revision ? String(row.source_revision) : null, checkedAt: String(row.checked_at) };
  }

  insertIntegrityCheck(sessionId: string, algorithm: string, fingerprint: string | null, sourceRevision: string | null, status: string, forced: boolean): void {
    this.db
      .query("INSERT INTO observability_integrity_checks (id, session_id, algorithm, fingerprint, source_revision, status, forced, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(shortId("ich"), sessionId, algorithm, fingerprint, sourceRevision, status, forced ? 1 : 0, nowIso());
  }

  // --- Aliases (Pao-owned metadata; never touches source transcripts) ----------------------------

  setAlias(sessionId: string, alias: string): void {
    const existing = this.db.query("SELECT id FROM observability_aliases WHERE session_id = ?").get(sessionId) as { id: string } | null;
    if (existing) {
      this.db.query("UPDATE observability_aliases SET alias = ?, updated_at = ? WHERE id = ?").run(alias, nowIso(), existing.id);
      return;
    }
    this.db
      .query("INSERT INTO observability_aliases (id, session_id, alias, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(shortId("als"), sessionId, alias, nowIso(), nowIso());
  }

  getAlias(sessionId: string): string | null {
    const row = this.db.query("SELECT alias FROM observability_aliases WHERE session_id = ?").get(sessionId) as { alias: string } | null;
    return row ? row.alias : null;
  }

  // --- Alerts ------------------------------------------------------------------------------------

  listAlertRules(): AlertRule[] {
    const rows = this.db.query("SELECT * FROM observability_alert_rules ORDER BY name").all() as Array<Record<string, unknown>>;
    return rows.map(mapAlertRule);
  }

  upsertAlertRule(rule: Pick<AlertRule, "name" | "conditionType" | "severity"> & { enabled?: boolean; cooldownSeconds?: number }): AlertRule {
    const existing = this.db.query("SELECT * FROM observability_alert_rules WHERE name = ?").get(rule.name) as Record<string, unknown> | null;
    const emptyScope = "{}";
    const emptyCondition = "{}";
    if (existing) {
      this.db
        .query("UPDATE observability_alert_rules SET condition_type = ?, severity = ?, enabled = ?, cooldown_seconds = ?, updated_at = ? WHERE id = ?")
        .run(rule.conditionType, rule.severity, rule.enabled === false ? 0 : 1, rule.cooldownSeconds ?? 300, nowIso(), String(existing.id));
      return mapAlertRule(this.db.query("SELECT * FROM observability_alert_rules WHERE id = ?").get(String(existing.id)) as Record<string, unknown>);
    }
    const id = shortId("arl");
    this.db
      .query("INSERT INTO observability_alert_rules (id, name, scope_json, condition_type, condition_json, severity, enabled, cooldown_seconds, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, rule.name, emptyScope, rule.conditionType, emptyCondition, rule.severity, rule.enabled === false ? 0 : 1, rule.cooldownSeconds ?? 300, nowIso(), nowIso());
    return mapAlertRule(this.db.query("SELECT * FROM observability_alert_rules WHERE id = ?").get(id) as Record<string, unknown>);
  }

  /** Open-or-refresh by (rule_id, dedupe_key). An unresolved alert with the
   *  same key refreshes last_seen instead of duplicating (spec §35). */
  openAlert(ruleId: string, sessionId: string | null, severity: string, title: string, details: Record<string, unknown>, dedupeKey: string): AlertEvent {
    const existing = this.db.query("SELECT * FROM observability_alert_events WHERE rule_id = ? AND dedupe_key = ? AND resolved_at IS NULL ORDER BY first_seen_at DESC LIMIT 1").get(ruleId, dedupeKey) as Record<string, unknown> | null;
    if (existing) {
      this.db.query("UPDATE observability_alert_events SET last_seen_at = ? WHERE id = ?").run(nowIso(), String(existing.id));
      return mapAlertEvent(existing);
    }
    const id = shortId("alt");
    const now = nowIso();
    const detailsJson = JSON.stringify({ ...details, dedupeKey });
    this.db
      .query("INSERT INTO observability_alert_events (id, rule_id, session_id, severity, title, details_json, dedupe_key, first_seen_at, last_seen_at, resolved_at, notification_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, ruleId, sessionId, severity, title, detailsJson, dedupeKey, now, now, null, "local");
    return this.getAlert(id) as AlertEvent;
  }

  getAlert(id: string): AlertEvent | null {
    const row = this.db.query("SELECT * FROM observability_alert_events WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapAlertEvent(row) : null;
  }

  listAlerts(filter: { unresolvedOnly?: boolean; limit?: number } = {}): AlertEvent[] {
    const limit = filter.limit ?? 100;
    const rows = filter.unresolvedOnly
      ? (this.db.query("SELECT * FROM observability_alert_events WHERE resolved_at IS NULL ORDER BY first_seen_at DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>)
      : (this.db.query("SELECT * FROM observability_alert_events ORDER BY first_seen_at DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>);
    return rows.map(mapAlertEvent);
  }

  resolveAlert(id: string): void {
    this.db.query("UPDATE observability_alert_events SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL").run(nowIso(), id);
  }

  cooldownHit(ruleId: string, dedupeKey: string, cooldownSeconds: number): boolean {
    const row = this.db.query("SELECT last_seen_at FROM observability_alert_events WHERE rule_id = ? AND dedupe_key = ? ORDER BY last_seen_at DESC LIMIT 1").get(ruleId, dedupeKey) as { last_seen_at: string } | null;
    if (!row) return false;
    return Date.parse(row.last_seen_at) > Date.now() - cooldownSeconds * 1000;
  }

  // --- Scan cycles ---------------------------------------------------------------------------------

  startScanCycle(adapterId: string): string {
    const id = shortId("cyc");
    const now = nowIso();
    const zero = 0;
    const emptyMetadata = "{}";
    this.db
      .query("INSERT INTO observability_scan_cycles (id, adapter_id, started_at, finished_at, scan_ms, sources_seen, sources_changed, events_emitted, errors_count, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, adapterId, now, null, zero, zero, zero, zero, zero, emptyMetadata);
    return id;
  }

  finishScanCycle(id: string, scanMs: number, sourcesSeen: number, sourcesChanged: number, eventsEmitted: number, errorsCount: number): void {
    this.db
      .query("UPDATE observability_scan_cycles SET finished_at = ?, scan_ms = ?, sources_seen = ?, sources_changed = ?, events_emitted = ?, errors_count = ? WHERE id = ?")
      .run(nowIso(), scanMs, sourcesSeen, sourcesChanged, eventsEmitted, errorsCount, id);
  }

  listScanCycles(limit = 50): ScanCycleRecord[] {
    const rows = this.db.query("SELECT * FROM observability_scan_cycles ORDER BY started_at DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      adapterId: String(row.adapter_id),
      startedAt: String(row.started_at),
      finishedAt: row.finished_at ? String(row.finished_at) : null,
      scanMs: Number(row.scan_ms ?? 0),
      sourcesSeen: Number(row.sources_seen ?? 0),
      sourcesChanged: Number(row.sources_changed ?? 0),
      eventsEmitted: Number(row.events_emitted ?? 0),
      errorsCount: Number(row.errors_count ?? 0),
    }));
  }

  // --- Retention (internal rows only — NEVER source transcript files) ---------------------------------

  retain(nowMs: number, eventsDays: number, scanCyclesDays: number, processEvidenceHours: number, alertsDays: number, integrityDays: number): { events: number; scanCycles: number; processEvidence: number; alerts: number; integrity: number } {
    const eventsCutoff = new Date(nowMs - eventsDays * 86_400_000).toISOString();
    const cyclesCutoff = new Date(nowMs - scanCyclesDays * 86_400_000).toISOString();
    const processCutoff = new Date(nowMs - processEvidenceHours * 3_600_000).toISOString();
    const alertsCutoff = new Date(nowMs - alertsDays * 86_400_000).toISOString();
    const integrityCutoff = new Date(nowMs - integrityDays * 86_400_000).toISOString();
    const events = this.db.query("DELETE FROM observability_events WHERE id IN (SELECT id FROM observability_events WHERE COALESCE(recorded_at, observed_at) < ? LIMIT 500)").run(eventsCutoff).changes;
    const scanCycles = this.db.query("DELETE FROM observability_scan_cycles WHERE id IN (SELECT id FROM observability_scan_cycles WHERE started_at < ? LIMIT 500)").run(cyclesCutoff).changes;
    const processEvidence = this.db.query("DELETE FROM observability_process_evidence WHERE id IN (SELECT id FROM observability_process_evidence WHERE expires_at < ? LIMIT 500)").run(processCutoff).changes;
    const alerts = this.db.query("DELETE FROM observability_alert_events WHERE id IN (SELECT id FROM observability_alert_events WHERE first_seen_at < ? AND resolved_at IS NOT NULL LIMIT 500)").run(alertsCutoff).changes;
    const integrity = this.db.query("DELETE FROM observability_integrity_checks WHERE id IN (SELECT id FROM observability_integrity_checks WHERE checked_at < ? LIMIT 500)").run(integrityCutoff).changes;
    return { events, scanCycles, processEvidence, alerts, integrity };
  }
}

// --- row mappers --------------------------------------------------------------------------------------

function str(value: unknown): string | null {
  return typeof value === "string" ? value : value == null ? null : String(value);
}
function numOr(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : value == null ? fallback : Number(value);
}

function mapSession(row: Record<string, unknown>): AgentSession {
  return {
    id: String(row.id),
    sourceSessionId: str(row.source_session_id),
    runtime: String(row.runtime) as AgentSession["runtime"],
    sourceType: String(row.source_type) as AgentSession["sourceType"],
    projectId: str(row.project_id),
    projectName: str(row.project_name),
    workingDirectory: null,
    parentSessionId: str(row.parent_session_id),
    rootSessionId: str(row.root_session_id),
    depth: numOr(row.depth, 0),
    tier: String(row.tier) as SessionTier,
    alias: null,
    activityState: String(row.activity_state) as AgentSession["activityState"],
    processState: String(row.process_state) as AgentSession["processState"],
    executionState: String(row.execution_state) as AgentSession["executionState"],
    healthState: String(row.health_state) as AgentSession["healthState"],
    integrityState: String(row.integrity_state) as AgentSession["integrityState"],
    confidence: numOr(row.confidence, 0),
    confidenceFactors: [],
    startedAt: str(row.started_at),
    lastRecordedEventAt: str(row.last_recorded_event_at),
    lastFileModifiedAt: str(row.last_file_modified_at),
    explicitEndedAt: str(row.explicit_ended_at),
    latestEventType: str(row.latest_event_type),
    latestRole: str(row.latest_role),
    latestToolName: str(row.latest_tool_name),
    processIds: [],
    sourcePath: null,
    sourceRevision: str(row.source_revision),
    sizeBytes: numOr(row.source_size_bytes, 0),
    errors: [],
    evidence: [],
    observedAt: String(row.last_observed_at),
  };
}

function mapEvent(row: Record<string, unknown>): NormalizedAgentEvent {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    parentSessionId: null,
    runtime: String(row.runtime) as NormalizedAgentEvent["runtime"],
    kind: String(row.kind) as EventKind,
    role: String(row.role) as EventRole,
    recordedAt: str(row.recorded_at),
    observedAt: String(row.observed_at),
    toolName: str(row.tool_name),
    summary: str(row.summary),
    contentPreview: row.content_preview === null ? null : String(row.content_preview),
    sourcePath: null,
    sourceOffset: row.source_offset == null ? null : Number(row.source_offset),
    sourceRevision: str(row.source_revision),
    truncated: Number(row.truncated ?? 0) === 1,
    malformed: Number(row.malformed ?? 0) === 1,
    metadata: {},
  };
}

function mapAlertRule(row: Record<string, unknown>): AlertRule {
  return {
    id: String(row.id),
    name: String(row.name),
    conditionType: String(row.condition_type) as AlertRule["conditionType"],
    severity: String(row.severity) as AlertRule["severity"],
    enabled: Number(row.enabled ?? 1) === 1,
    cooldownSeconds: numOr(row.cooldown_seconds, 300),
    scopeJson: String(row.scope_json ?? "{}"),
    conditionJson: String(row.condition_json ?? "{}"),
  };
}

function mapAlertEvent(row: Record<string, unknown>): AlertEvent {
  return {
    id: String(row.id),
    ruleId: String(row.rule_id),
    sessionId: str(row.session_id),
    severity: String(row.severity) as AlertEvent["severity"],
    title: String(row.title),
    detailsJson: String(row.details_json ?? "{}"),
    dedupeKey: String(row.dedupe_key ?? ""),
    firstSeenAt: String(row.first_seen_at),
    lastSeenAt: String(row.last_seen_at),
    resolvedAt: str(row.resolved_at),
    notificationState: String(row.notification_state ?? "local"),
  };
}

export function errorsToJson(errors: SessionObservationError[]): string {
  return JSON.stringify(errors.slice(0, 8));
}
