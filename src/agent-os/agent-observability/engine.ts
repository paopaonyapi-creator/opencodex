// Phase 20.40 — ObservabilityEngine: the shared single-flight scan that all
// API/MCP/SSE clients fan out from (spec §23, §42). One scan serves every
// browser client; a min-interval gate plus an in-flight promise prevent
// overlapping scans. Reads are strictly read-only toward sources; alias
// writes and integrity checks touch only Pao-owned storage. No background
// timers — scans run on demand and respect the configured interval.

import { homedir } from "node:os";
import type { CockpitService } from "../coding-cockpit/service";
import { ClaudeJsonlAdapter } from "./adapter-claude";
import { CodexObservabilityAdapter, GenericJsonlAdapter, PaoNativeAdapter } from "./adapter-misc";
import { AlertEngine } from "./alerts";
import { getObservabilityConfig, resetObservabilityConfigForTests } from "./config";
import { IntegrityEngine } from "./integrity";
import { deriveStates } from "./normalizer";
import { registryHints, scanProcesses } from "./process-evidence";
import { ObservabilityStore, pathHashOf } from "./persistence";
import type {
  AgentSession,
  DiscoveredSource,
  EvidenceRecord,
  FleetSnapshot,
  NormalizedAgentEvent,
  ObservabilityAdapter,
  ObservabilityStats,
  ObservabilityStreamEvent,
  SessionObservationError,
} from "./types";

function adapterIsEnabled(adapter: ObservabilityAdapter): boolean {
  try {
    return adapter.enabled(getObservabilityConfig());
  } catch {
    return false;
  }
}

export class ObservabilityEngine {
  readonly store: ObservabilityStore;
  readonly integrity: IntegrityEngine;
  readonly alerts: AlertEngine;
  private adapters: ObservabilityAdapter[];
  private claudeAdapter: ClaudeJsonlAdapter;
  private cache = new Map<string, { revision: string; latestEvent: NormalizedAgentEvent | null; cachedAt: number }>();
  private inFlight: Promise<FleetSnapshot> | null = null;
  private lastScanAtMs = 0;
  private sequence = 0;
  private streamRing: ObservabilityStreamEvent[] = [];
  private sseClients = 0;
  private stats: ObservabilityStats;
  private parseErrorCounts = new Map<string, number>();
  private lastSnapshot: FleetSnapshot | null = null;
  private claudeSourcePaths = new Map<string, string>();

  constructor(store?: ObservabilityStore) {
    this.store = store ?? new ObservabilityStore();
    this.integrity = new IntegrityEngine();
    this.alerts = new AlertEngine(this.store);
    this.claudeAdapter = new ClaudeJsonlAdapter();
    const root = getObservabilityConfig().adapters.claudeJsonl.root.replace(/^~(?=$|\/|\\)/, homedir());
    this.claudeAdapter.configure(root);
    this.adapters = [this.claudeAdapter, new CodexObservabilityAdapter(), new PaoNativeAdapter()];
    for (const generic of getObservabilityConfig().adapters.genericJsonl) {
      this.adapters.push(new GenericJsonlAdapter(generic));
    }
    this.stats = {
      scanTotal: 0, scanErrorsTotal: 0, lastScanDurationMs: null, lastScanAt: null,
      sourcesTotal: 0, sourceChangesTotal: 0, cacheHitsTotal: 0, cacheMissesTotal: 0,
      tailReadsTotal: 0, parseErrorsTotal: 0, sessionsTotal: 0, sessionsStalled: 0,
      alertsOpen: 0, sseClients: 0,
    };
    this.alerts.ensureBuiltInRules();
  }

  isEnabled(): boolean {
    return getObservabilityConfig().enabled;
  }

  listAdapters(): Array<{ id: string; runtime: string; capabilities: unknown; enabled: boolean }> {
    return this.adapters.map((adapter) => ({
      id: adapter.id,
      runtime: adapter.runtime,
      capabilities: adapter.capabilities,
      enabled: adapterIsEnabled(adapter),
    }));
  }

  /** Single-flight snapshot: serves the cached snapshot when the configured
   *  interval has not elapsed; otherwise runs ONE shared scan. */
  async snapshot(force = false): Promise<FleetSnapshot> {
    if (!this.isEnabled()) {
      return this.emptySnapshot();
    }
    const now = Date.now();
    if (!force && this.lastSnapshot && now - this.lastScanAtMs < getObservabilityConfig().snapshotMs) {
      return this.lastSnapshot;
    }
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runScan().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private emptySnapshot(): FleetSnapshot {
    return {
      observedAt: new Date().toISOString(),
      scan: { durationMs: 0, adapterErrors: 0, cacheHits: 0, cacheMisses: 0, sourcesSeen: 0, sourcesChanged: 0 },
      summary: { sessions: 0, active: 0, recent: 0, idle: 0, stale: 0, stalled: 0, failed: 0, adapterErrors: 0, unknown: 0 },
      sessions: [],
    };
  }

  private async runScan(): Promise<FleetSnapshot> {
    const startedAt = Date.now();
    const config = getObservabilityConfig();
    const nowMs = Date.now();
    let adapterErrors = 0;
    let sourcesSeen = 0;
    let sourcesChanged = 0;
    let cacheHits = 0;
    let cacheMisses = 0;
    const sessions: AgentSession[] = [];

    // Process evidence: one cached OS scan + the Pao child-process registry.
    scanProcesses();
    const registry = registryHints(this.supervisorProcesses());

    for (const adapter of this.adapters) {
      if (!adapterIsEnabled(adapter)) continue;
      const cycleId = this.store.startScanCycle(adapter.id);
      let cycleErrors = 0;
      let cycleEvents = 0;
      try {
        const discovered = await adapter.discover({
          nowMs,
          config,
          emitError: (key, error) => {
            cycleErrors += 1;
            if (error.code === "MALFORMED_RECORD") {
              this.parseErrorCounts.set(key, (this.parseErrorCounts.get(key) ?? 0) + 1);
            }
          },
        });
        sourcesSeen += discovered.length;
        for (const source of discovered.slice(0, 300)) {
          const cacheKey = source.sourcePath ?? source.sourceSessionId ?? source.adapterId;
          const previous = this.cache.get(cacheKey);
          if (previous && previous.revision === source.revision) {
            cacheHits += 1;
          } else {
            cacheMisses += 1;
            sourcesChanged += 1;
          }
          const observation = await adapter.inspectSession(source, {
            nowMs,
            config,
            emitError: () => {
              cycleErrors += 1;
            },
          });
          const lastFileModifiedAt = source.lastModifiedAt;
          const lastRecordedEventAt = observation.lastRecordedEventAt ?? previous?.latestEvent?.recordedAt ?? null;
          const processIds = this.matchPids(source.sourceSessionId, registry);
          const exactProcess = processIds.length > 0;
          const states = deriveStates({
            nowMs,
            config,
            lastRecordedEventAt,
            lastFileModifiedAt,
            explicitEndedAt: observation.explicitEndedAt,
            latestEvent: observation.latestEvent,
            waitingUserHint: observation.waitingUserHint,
            executionHint: observation.executionHint,
            hasMalformedRecords: observation.errors.some((error) => error.code === "MALFORMED_RECORD"),
            errors: observation.errors,
            processMatchConfidence: exactProcess ? 0.9 : 0,
            processExactMatch: exactProcess,
          });
          const session = this.persistObservation(adapter, source, observation, states, lastFileModifiedAt, processIds, new Date(nowMs).toISOString());
          if (session) sessions.push(session);
          if (observation.latestEvent && (!previous || previous.revision !== source.revision)) {
            cycleEvents += 1;
          }
          this.cache.set(cacheKey, { revision: source.revision ?? "", latestEvent: observation.latestEvent, cachedAt: nowMs });
        }
      } catch (error) {
        adapterErrors += 1;
        cycleErrors += 1;
        this.emitStream({ type: "adapter_error", sequence: 0, observedAt: new Date().toISOString(), adapterId: adapter.id, code: error instanceof Error ? error.message.slice(0, 120) : "unknown" });
      }
      this.store.finishScanCycle(cycleId, Date.now() - startedAt, sourcesSeen, sourcesChanged, cycleEvents, cycleErrors);
    }

    // Retention runs opportunistically with scans (batched, internal rows only).
    this.store.retain(nowMs, config.retention.eventsDays, config.retention.scanCyclesDays, config.retention.processEvidenceHours, config.retention.alertsDays, config.retention.integrityDays);

    const durationMs = Date.now() - startedAt;
    const snapshot = this.buildSnapshot(sessions, { durationMs, adapterErrors, cacheHits, cacheMisses, sourcesSeen, sourcesChanged });
    const raised = this.alerts.evaluate(snapshot, this.parseErrorCounts);
    for (const item of raised) {
      if (item.opened) this.emitStream({ type: "alert_opened", sequence: 0, observedAt: new Date().toISOString(), alertId: item.alertId });
    }
    this.stats.scanTotal += 1;
    this.stats.scanErrorsTotal += adapterErrors;
    this.stats.lastScanDurationMs = durationMs;
    this.stats.lastScanAt = snapshot.observedAt;
    this.stats.sourcesTotal = sourcesSeen;
    this.stats.sourceChangesTotal += sourcesChanged;
    this.stats.cacheHitsTotal += cacheHits;
    this.stats.cacheMissesTotal += cacheMisses;
    this.stats.sessionsTotal = snapshot.summary.sessions;
    this.stats.sessionsStalled = snapshot.summary.stalled;
    this.stats.alertsOpen = this.store.listAlerts({ unresolvedOnly: true }).length;
    this.lastScanAtMs = Date.now();
    this.lastSnapshot = snapshot;
    this.emitStream({ type: "snapshot", sequence: 0, observedAt: snapshot.observedAt, summary: snapshot.summary });
    return snapshot;
  }

  private persistObservation(adapter: ObservabilityAdapter, source: DiscoveredSource, observation: Awaited<ReturnType<ObservabilityAdapter["inspectSession"]>>, states: ReturnType<typeof deriveStates>, lastFileModifiedAt: string | null, processIds: number[], observedAt: string): AgentSession | null {
    const config = getObservabilityConfig();
    const sourcePathHash = pathHashOf(source.sourcePath);
    const existing = this.store.findSessionByRuntimeSource(adapter.runtime, observation.sourceSessionId ?? source.sourceSessionId, sourcePathHash);
    const timing = {
      startedAt: observation.startedAt,
      lastRecordedEventAt: observation.lastRecordedEventAt,
      lastFileModifiedAt,
      explicitEndedAt: observation.explicitEndedAt,
      eventType: observation.latestEvent?.kind ?? null,
      role: observation.latestEvent?.role ?? null,
      toolName: observation.latestEvent?.toolName ?? null,
    };
    let sessionId: string;
    const sessionStates = {
      activity: states.activityState,
      process: states.processState,
      execution: states.executionState,
      health: states.healthState,
      integrity: "unchecked",
      confidence: states.confidence,
    };
    if (existing) {
      sessionId = existing.id;
      this.store.updateSessionStates(sessionId, sessionStates);
      this.store.updateSessionTiming(sessionId, timing, { sourceRevision: source.revision, sizeBytes: source.sizeBytes });
      this.emitStream({ type: "session_changed", sequence: 0, observedAt, sessionId });
    } else {
      const created = this.store.insertSession({
        sourceSessionId: observation.sourceSessionId ?? source.sourceSessionId,
        runtime: adapter.runtime,
        sourceType: source.sourcePath ? "jsonl" : "database",
        projectId: source.projectId,
        projectName: source.projectName,
        workingDirectoryHash: pathHashOf(observation.workingDirectory),
        parentSessionId: observation.parentSessionId,
        rootSessionId: observation.parentSessionId,
        depth: observation.parentSessionId ? 1 : 0,
        tier: observation.tier,
        sourcePathHash,
        sourceRevision: source.revision,
        sizeBytes: source.sizeBytes,
      });
      sessionId = created.id;
      this.store.updateSessionStates(sessionId, sessionStates);
      this.store.updateSessionTiming(sessionId, timing, { sourceRevision: source.revision, sizeBytes: source.sizeBytes });
      this.emitStream({ type: "session_added", sequence: 0, observedAt, sessionId });
    }
    this.store.insertEvidenceBatch(sessionId, null, states.evidence);
    if (observation.latestEvent) {
      this.store.insertEvent(observation.latestEvent, config.privacy.persistContentPreview ? observation.latestEvent.contentPreview : null);
      this.emitStream({ type: "agent_event", sequence: 0, observedAt, event: observation.latestEvent });
    }
    if (source.sourcePath) this.registerSourcePath(sessionId, source.sourcePath);
    return this.assembleSession(sessionId, adapter, source, observation, states, timing, lastFileModifiedAt, processIds, observedAt);
  }

  private assembleSession(sessionId: string, adapter: ObservabilityAdapter, source: DiscoveredSource, observation: Awaited<ReturnType<ObservabilityAdapter["inspectSession"]>>, states: ReturnType<typeof deriveStates>, timing: { startedAt: string | null; lastRecordedEventAt: string | null }, lastFileModifiedAt: string | null, processIds: number[], observedAt: string): AgentSession {
    const config = getObservabilityConfig();
    const stored = this.store.getSession(sessionId);
    return {
      id: sessionId,
      sourceSessionId: observation.sourceSessionId ?? source.sourceSessionId,
      runtime: adapter.runtime,
      sourceType: source.sourcePath ? "jsonl" : "database",
      projectId: source.projectId,
      projectName: source.projectName,
      workingDirectory: config.privacy.exposeAbsolutePaths ? observation.workingDirectory : null,
      parentSessionId: observation.parentSessionId,
      rootSessionId: observation.parentSessionId,
      depth: observation.parentSessionId ? 1 : 0,
      tier: observation.tier,
      alias: this.store.getAlias(sessionId),
      activityState: states.activityState,
      processState: states.processState,
      executionState: states.executionState,
      healthState: states.healthState,
      integrityState: stored ? stored.integrityState : "unchecked",
      confidence: states.confidence,
      confidenceFactors: states.confidenceFactors,
      startedAt: timing.startedAt,
      lastRecordedEventAt: timing.lastRecordedEventAt,
      lastFileModifiedAt,
      explicitEndedAt: observation.explicitEndedAt,
      latestEventType: observation.latestEvent?.kind ?? null,
      latestRole: observation.latestEvent?.role ?? null,
      latestToolName: observation.latestEvent?.toolName ?? null,
      processIds,
      sourcePath: config.privacy.exposeAbsolutePaths ? source.sourcePath : null,
      sourceRevision: source.revision,
      sizeBytes: source.sizeBytes,
      errors: observation.errors,
      evidence: states.evidence,
      observedAt,
    };
  }

  private matchPids(sourceSessionId: string | null, registry: Array<{ sessionId: string | null; pid: number }>): number[] {
    if (!sourceSessionId) return [];
    return registry.filter((hint) => hint.sessionId === sourceSessionId).map((hint) => hint.pid);
  }

  private supervisorProcesses(): Array<{ pid: number | null; sessionId: string | null; providerId: string | null; state: string }> {
    try {
      const cockpit = cockpitServiceRef;
      if (!cockpit) return [];
      return cockpit.supervisor.list().map((proc) => ({
        pid: proc.pid,
        sessionId: proc.sessionId,
        providerId: proc.providerId,
        state: proc.state,
      }));
    } catch {
      return [];
    }
  }

  private buildSnapshot(sessions: AgentSession[], scan: FleetSnapshot["scan"]): FleetSnapshot {
    return {
      observedAt: new Date().toISOString(),
      scan,
      summary: {
        sessions: sessions.length,
        active: sessions.filter((session) => session.activityState === "active").length,
        recent: sessions.filter((session) => session.activityState === "recent").length,
        idle: sessions.filter((session) => session.activityState === "idle").length,
        stale: sessions.filter((session) => session.activityState === "stale").length,
        stalled: sessions.filter((session) => session.healthState === "stalled").length,
        failed: sessions.filter((session) => session.executionState === "failed").length,
        adapterErrors: scan.adapterErrors,
        unknown: sessions.filter((session) => session.activityState === "unknown").length,
      },
      sessions,
    };
  }

  // --- Stream fan-out -----------------------------------------------------------------------

  private emitStream(event: ObservabilityStreamEvent): void {
    this.sequence += 1;
    const stamped = { ...event, sequence: this.sequence } as ObservabilityStreamEvent;
    this.streamRing.push(stamped);
    if (this.streamRing.length > 500) this.streamRing.shift();
  }

  streamSince(afterSequence: number): ObservabilityStreamEvent[] {
    return this.streamRing.filter((event) => event.sequence > afterSequence);
  }

  currentSequence(): number {
    return this.sequence;
  }

  clientConnected(): void {
    this.sseClients += 1;
    this.stats.sseClients = this.sseClients;
  }

  clientDisconnected(): void {
    this.sseClients = Math.max(0, this.sseClients - 1);
    this.stats.sseClients = this.sseClients;
  }

  // --- Session inspector / integrity -------------------------------------------------------------

  sessionDetail(sessionId: string): { session: AgentSession; events: NormalizedAgentEvent[]; evidence: EvidenceRecord[]; integrity: { digest: string | null; status: string; sourceRevision: string | null; checkedAt: string } | null } | null {
    const stored = this.store.getSession(sessionId);
    if (!stored) return null;
    const config = getObservabilityConfig();
    const detail: AgentSession = {
      ...stored,
      alias: this.store.getAlias(sessionId),
      workingDirectory: config.privacy.exposeAbsolutePaths ? stored.workingDirectory : null,
      sourcePath: config.privacy.exposeAbsolutePaths ? stored.sourcePath : null,
    };
    return {
      session: detail,
      events: this.store.listEvents({ sessionId, limit: config.io.maxEventsPerSession }),
      evidence: this.store.listEvidence(sessionId),
      integrity: this.store.lastIntegrityCheck(sessionId),
    };
  }

  /** Integrity operates ONLY on the registered session source path — arbitrary
   *  file paths are structurally impossible to request (spec §47). */
  async verifySessionIntegrity(sessionId: string, force: boolean): Promise<{ algorithm: "sha256"; digest: string | null; sourceRevision: string | null; previousDigest: string | null; status: string; checkedAt: string } | null> {
    const stored = this.store.getSession(sessionId);
    if (!stored) return null;
    const sourcePath = this.claudeSourcePaths.get(sessionId) ?? null;
    if (!sourcePath) {
      this.store.insertIntegrityCheck(sessionId, "sha256", null, stored.sourceRevision, "unavailable", force);
      return { algorithm: "sha256", digest: null, sourceRevision: stored.sourceRevision, previousDigest: null, status: "unavailable", checkedAt: new Date().toISOString() };
    }
    const previous = this.store.lastIntegrityCheck(sessionId);
    const result = await this.integrity.verify(sourcePath, stored.sourceRevision, previous?.digest ?? null, { force });
    this.store.insertIntegrityCheck(sessionId, result.algorithm, result.digest, result.sourceRevision, result.status, force);
    return result;
  }

  private registerSourcePath(sessionId: string, sourcePath: string): void {
    this.claudeSourcePaths.set(sessionId, sourcePath);
  }

  setAlias(sessionId: string, alias: string): boolean {
    if (!this.store.getSession(sessionId)) return false;
    this.store.setAlias(sessionId, alias);
    return true;
  }

  timeline(filter: { runtime?: string; sessionId?: string; kinds?: string[]; errorsOnly?: boolean; search?: string; limit: number }): NormalizedAgentEvent[] {
    const config = getObservabilityConfig();
    const limit = Math.min(Math.max(1, filter.limit), config.io.maxTimelineEvents);
    return this.store.listEvents({ ...filter, limit });
  }

  statsSnapshot(): ObservabilityStats & { eventsStored: number } {
    return { ...this.stats, eventsStored: this.store.countEvents() };
  }
}

// --- wiring --------------------------------------------------------------------------------------

let cockpitServiceRef: CockpitService | null = null;

/** Bind the 20.39 cockpit service for high-fidelity child-process registry
 *  evidence. Optional — the engine works without it (no process hints). */
export function bindCockpitService(service: CockpitService): void {
  cockpitServiceRef = service;
}

export function resetObservabilityEngineForTests(): void {
  resetObservabilityConfigForTests();
}

let singleton: ObservabilityEngine | null = null;

export function getObservabilityEngine(): ObservabilityEngine {
  if (!singleton) singleton = new ObservabilityEngine();
  return singleton;
}

export function resetEngineSingletonForTests(): void {
  singleton = null;
}

export function sessionNotFoundError(): SessionObservationError {
  return { code: "SOURCE_NOT_FOUND", message: "session not registered", recoverable: false, observedAt: new Date().toISOString() };
}
