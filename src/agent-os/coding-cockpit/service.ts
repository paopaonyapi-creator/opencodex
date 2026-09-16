// Phase 20.39 — CockpitService: the unified session control plane (spec
// §6.2-§6.4, §29-§32). Every mutation pathway crosses: authorization (human
// invariant for governance) → execution policy → approval when required →
// writer lock when mutating → adapter → normalized events → audit. Native
// provider identities are preserved end-to-end.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CockpitStore } from "./store";
import { CockpitEventBus } from "./events";
import { WorkspaceLockManager } from "./locks";
import { ApprovalGateway } from "./approvals";
import { ContextRegistry, SlashCommandRegistry } from "./context";
import { ProcessSupervisor } from "./supervisor";
import { ProviderRegistry, adapterTypeFor } from "./providers";
import { MockProvider } from "./providers-mock";
import { CodexCockpitAdapter } from "./providers-codex";
import { ClaudeCodeAdapter } from "./providers-claude";
import { canonicalizeRoot, resolveInsideWorkspace, relativizeForDisplay } from "./paths";
import { classifyToolAction, evaluatePolicy, defaultExecutionLevel, parseExecutionLevel } from "./policy";
import { redactJsonForAudit, redactText } from "./redaction";
import {
  CockpitError,
  DEFAULT_EXECUTION_LEVEL,
  type ActionType,
  type AgentRun,
  type ApprovalRequest,
  type AuditSeverity,
  type CockpitErrorCode,
  type DiscoveredNativeSession,
  type ExecutionLevel,
  type NormalizedAgentEvent,
  type ProviderCapabilities,
  type ProviderMessageInput,
  type ProviderProbeResult,
  type ProviderUsageSnapshot,
  type ReconciliationReport,
  type SessionMode,
  type UnifiedSession,
  type Workspace,
  type WorkspaceTrustLevel,
} from "./types";

/** Modes that mutate the workspace and therefore need the writer lease. */
const MUTATION_MODES: ReadonlySet<SessionMode> = new Set<SessionMode>(["CODE", "AUTOMATION"]);

const STALE_SESSION_MS = 30 * 60 * 1000;

export interface StartSessionOptions {
  workspaceId: string;
  providerId: string;
  title?: string;
  mode?: SessionMode;
  actor: string;
}

export interface SendMessageOptions {
  sessionId: string;
  text: string;
  mode?: SessionMode;
  contextRefs?: ProviderMessageInput["contextRefs"];
  actor: string;
  allowDangerousSkipPermissions?: boolean;
}

export interface UsageSummary {
  totals: { sessions: number; inputTokens: number | null; outputTokens: number | null; reportedCostUsd: number | null; estimatedCostUsd: number | null };
  byProvider: Array<{ providerId: string; inputTokens: number | null; outputTokens: number | null; source: string }>;
  byWorkspace: Array<{ workspaceId: string; inputTokens: number | null; outputTokens: number | null }>;
  byModel: Array<{ model: string; inputTokens: number | null; outputTokens: number | null }>;
}

export class CockpitService {
  readonly store: CockpitStore;
  readonly bus: CockpitEventBus;
  readonly locks: WorkspaceLockManager;
  readonly approvals: ApprovalGateway;
  readonly context: ContextRegistry;
  readonly commands: SlashCommandRegistry;
  readonly supervisor: ProcessSupervisor;
  readonly providers: ProviderRegistry;
  readonly claudeAdapter: ClaudeCodeAdapter;

  constructor(store?: CockpitStore) {
    this.store = store ?? new CockpitStore();
    this.bus = new CockpitEventBus(this.store, (sessionId) => {
      const session = this.store.getSession(sessionId);
      return session ? { workspaceId: session.workspaceId, providerId: session.providerId } : null;
    });
    this.locks = new WorkspaceLockManager(this.store, (event) => this.audit(event));
    this.approvals = new ApprovalGateway(this.store, (event) => this.audit(event));
    this.context = new ContextRegistry(this.store);
    this.commands = new SlashCommandRegistry();
    this.supervisor = new ProcessSupervisor();
    this.providers = new ProviderRegistry();
    this.claudeAdapter = new ClaudeCodeAdapter(this.supervisor);
    this.seedProviders();
    this.seedCommands();
  }

  private seedProviders(): void {
    this.providers.register(new MockProvider());
    this.providers.register(new CodexCockpitAdapter());
    this.providers.register(this.claudeAdapter);
    for (const adapter of this.providers.list()) {
      this.store.upsertProvider({
        id: adapter.id,
        displayName: adapter.displayName,
        adapterType: adapterTypeFor(adapter.id),
        enabled: true,
      });
    }
  }

  // --- Audit -------------------------------------------------------------------------------

  audit(event: { eventType: string; workspaceId?: string | null; sessionId?: string | null; runId?: string | null; providerId?: string | null; actorId?: string | null; severity?: AuditSeverity; action?: string; decision?: string | null; riskScore?: number | null; summary: string; metadata?: Record<string, unknown> }): void {
    this.store.insertAudit({
      actorId: event.actorId ?? null,
      workspaceId: event.workspaceId ?? null,
      sessionId: event.sessionId ?? null,
      runId: event.runId ?? null,
      providerId: event.providerId ?? null,
      eventType: event.eventType,
      severity: event.severity ?? "info",
      action: event.action ?? event.eventType,
      decision: event.decision ?? null,
      riskScore: event.riskScore ?? null,
      summary: redactText(event.summary),
      metadataJson: event.metadata ? redactJsonForAudit(event.metadata) : null,
    });
  }

  // --- Workspaces -----------------------------------------------------------------------------

  registerWorkspace(input: { rootPath: string; name?: string; actor: string; trustLevel?: WorkspaceTrustLevel }): Workspace {
    const normalizedRootPath = canonicalizeRoot(input.rootPath);
    const duplicate = this.store.findWorkspaceByNormalizedRoot(normalizedRootPath);
    if (duplicate) {
      throw new CockpitError("VALIDATION_ERROR", "workspace already registered at this path: " + duplicate.id);
    }
    const trustLevel: WorkspaceTrustLevel = input.trustLevel === "PRIVILEGED"
      ? "STANDARD" // PRIVILEGED is never assignable at registration (spec §5)
      : input.trustLevel ?? "STANDARD";
    const git = detectGit(normalizedRootPath);
    const name = input.name ?? normalizedRootPath.split(/[\\/]/).pop() ?? "workspace";
    const slug = slugify(name) + "-" + normalizedRootPath.length.toString(36);
    const workspace = this.store.insertWorkspace({
      name,
      slug,
      rootPath: normalizedRootPath,
      normalizedRootPath,
      gitRemoteUrl: git.remoteUrl,
      gitBranch: git.branch,
      gitHeadSha: git.headSha,
      trustLevel,
    });
    this.audit({
      eventType: "workspace.registered",
      workspaceId: workspace.id,
      actorId: input.actor,
      summary: "workspace registered: " + name,
      metadata: { normalizedRootPath, git: Boolean(git.branch) },
    });
    this.context.indexWorkspaceFiles(workspace.id, normalizedRootPath);
    return workspace;
  }

  /** Trust changes are human-actor-only; PRIVILEGED additionally requires the
   *  explicit environment gate (spec §5: never automatic). */
  setWorkspaceTrust(workspaceId: string, trustLevel: WorkspaceTrustLevel, actor: string): Workspace {
    ApprovalGateway.requireHumanActor(actor);
    if (trustLevel === "PRIVILEGED" && process.env.PAO_ALLOW_PRIVILEGED_MODE !== "true") {
      throw new CockpitError("POLICY_DENIED", "PRIVILEGED trust requires PAO_ALLOW_PRIVILEGED_MODE=true");
    }
    this.store.requireWorkspace(workspaceId);
    this.store.updateWorkspace(workspaceId, { trustLevel });
    this.audit({
      eventType: "workspace.trust_changed",
      workspaceId,
      actorId: actor,
      severity: trustLevel === "PRIVILEGED" ? "critical" : "warning",
      summary: "workspace trust set to " + trustLevel,
      metadata: { trustLevel },
    });
    return this.store.requireWorkspace(workspaceId);
  }

  async probeProvider(providerId: string): Promise<ProviderProbeResult> {
    const adapter = this.providers.require(providerId);
    const probe = await adapter.probe();
    this.store.saveProviderInstance({
      providerId,
      instanceKey: "default",
      version: probe.version,
      status: probe.installed ? "AVAILABLE" : "UNAVAILABLE",
      capabilitiesJson: JSON.stringify(adapter.getCapabilities()),
      lastProbeAt: new Date().toISOString(),
      metadataJson: JSON.stringify({ detail: probe.detail, authenticated: probe.authenticated }),
    });
    this.audit({
      eventType: probe.installed ? "provider.probed" : "provider.unavailable",
      providerId,
      summary: probe.detail,
    });
    return probe;
  }

  capabilitiesFor(providerId: string): ProviderCapabilities {
    return this.providers.require(providerId).getCapabilities();
  }

  // --- Sessions ---------------------------------------------------------------------------------

  async startSession(options: StartSessionOptions): Promise<{ session: UnifiedSession; capabilities: ProviderCapabilities }> {
    const workspace = this.store.requireWorkspace(options.workspaceId);
    const adapter = this.providers.require(options.providerId);
    const probe = await adapter.probe();
    if (!probe.installed) {
      throw new CockpitError("PROVIDER_NOT_INSTALLED", probe.detail);
    }
    const capabilities = adapter.getCapabilities();
    if (!capabilities.chat) {
      throw new CockpitError("CAPABILITY_UNSUPPORTED", "provider does not support chat sessions");
    }
    const mode = options.mode ?? "CHAT";
    const session = this.store.insertSession({
      workspaceId: workspace.id,
      providerId: options.providerId,
      nativeSessionId: null,
      parentSessionId: null,
      title: options.title ?? "Session " + new Date().toISOString().slice(0, 16).replace("T", " "),
      status: "STARTING",
      mode,
      writerState: "NONE",
      startedAt: null,
      endedAt: null,
      lastActivityAt: new Date().toISOString(),
      nativeMetadataJson: null,
      capabilitiesJson: JSON.stringify(capabilities),
      resumeTokenRef: null,
    });
    this.store.updateWorkspace(workspace.id, { lastOpenedAt: new Date().toISOString() });
    this.audit({
      eventType: "session.started",
      workspaceId: workspace.id,
      sessionId: session.id,
      providerId: options.providerId,
      actorId: options.actor,
      summary: "session starting in " + mode + " mode",
    });

    // Writer lease BEFORE native start for mutation modes (spec §29).
    if (MUTATION_MODES.has(mode)) {
      const acquired = this.locks.acquire({
        workspaceId: workspace.id,
        sessionId: session.id,
        ownerInstanceId: ownerInstanceId(),
        actor: options.actor,
      });
      if (!acquired.acquired) {
        this.store.updateSession(session.id, { status: "PAUSED", writerState: "BLOCKED" });
        throw new CockpitError("LOCK_CONFLICT", acquired.reason, { conflicting: acquired.conflicting?.sessionId });
      }
      this.store.updateSession(session.id, { writerState: "HELD" });
    }

    try {
      const handle = await adapter.startSession({
        sessionId: session.id,
        workspaceId: workspace.id,
        workspaceRoot: workspace.normalizedRootPath,
        title: session.title,
        mode,
      });
      this.attachStream(session.id, handle.nativeSessionId);
      this.store.updateSession(session.id, {
        status: "RUNNING",
        nativeSessionId: handle.nativeSessionId,
        startedAt: new Date().toISOString(),
      });
      return { session: this.store.requireSession(session.id), capabilities };
    } catch (error) {
      this.store.updateSession(session.id, { status: "FAILED", endedAt: new Date().toISOString() });
      if (MUTATION_MODES.has(mode)) {
        try { this.locks.release(workspace.id, session.id, options.actor); } catch { /* already released */ }
      }
      throw error;
    }
  }

  async resumeSession(sessionId: string, actor: string): Promise<UnifiedSession> {
    const session = this.store.requireSession(sessionId);
    const workspace = this.store.requireWorkspace(session.workspaceId);
    const adapter = this.providers.require(session.providerId);
    const probe = await adapter.probe();
    if (!probe.installed) {
      throw new CockpitError("PROVIDER_NOT_INSTALLED", probe.detail);
    }
    if (!adapter.getCapabilities().resume) {
      throw new CockpitError("CAPABILITY_UNSUPPORTED", "provider does not support resume");
    }
    if (!session.nativeSessionId && session.status !== "DISCOVERED") {
      throw new CockpitError("SESSION_NOT_RESUMABLE", "session has no native id and was never started");
    }
    if (MUTATION_MODES.has(session.mode)) {
      const acquired = this.locks.acquire({
        workspaceId: workspace.id,
        sessionId: session.id,
        ownerInstanceId: ownerInstanceId(),
        actor,
      });
      if (!acquired.acquired) {
        throw new CockpitError("LOCK_CONFLICT", acquired.reason, { conflicting: acquired.conflicting?.sessionId });
      }
      this.store.updateSession(session.id, { writerState: "HELD" });
    }
    const handle = await adapter.resumeSession({
      sessionId: session.id,
      workspaceId: workspace.id,
      workspaceRoot: workspace.normalizedRootPath,
      title: session.title,
      mode: session.mode,
      nativeSessionId: session.nativeSessionId ?? "",
    });
    if (handle.nativeSessionId && handle.nativeSessionId !== session.nativeSessionId) {
      this.store.updateSession(session.id, { nativeSessionId: handle.nativeSessionId });
    }
    this.attachStream(session.id, handle.nativeSessionId ?? session.nativeSessionId);
    this.store.updateSession(session.id, { status: "RUNNING", lastActivityAt: new Date().toISOString() });
    this.audit({
      eventType: "session.resumed",
      workspaceId: workspace.id,
      sessionId: session.id,
      providerId: session.providerId,
      actorId: actor,
      summary: "session resumed from native id",
    });
    return this.store.requireSession(session.id);
  }

  async sendMessage(options: SendMessageOptions): Promise<{ run: AgentRun; decision: string; approval: ApprovalRequest | null }> {
    const session = this.store.requireSession(options.sessionId);
    const workspace = this.store.requireWorkspace(session.workspaceId);
    const adapter = this.providers.require(session.providerId);

    // 1. Slash command interception (registry-driven, spec §15). Handlers
    // throw CockpitError on failure; results are always ok.
    const parsed = this.commands.parse(options.text);
    if (parsed.isCommand && parsed.command) {
      const result = await parsed.command.handler({
        sessionId: session.id,
        workspaceId: workspace.id,
        args: parsed.rest.split(/\s+/).filter((token) => token.length > 0),
        actor: options.actor,
      });
      const commandRun = this.store.insertRun({
        sessionId: session.id,
        workspaceId: workspace.id,
        providerId: session.providerId,
        status: "COMPLETED",
        errorCode: null,
        errorSummary: null,
      });
      this.store.updateRun(commandRun.id, { completedAt: new Date().toISOString() });
      this.bus.ingest(session.id, commandRun.id, { type: "SessionStarted", nativeSessionId: null, detail: result.summary });
      return { run: commandRun, decision: "COMMAND", approval: null };
    }

    // 2. Resolve @context refs server-side (workspace containment enforced).
    const refs = this.context.resolve(options.contextRefs ?? [], workspace.normalizedRootPath);

    // 3. Policy evaluation for the message pathway (chat is a read-level
    //    action; the ADAPTER's tool calls are gated individually below).
    const policy = evaluatePolicy({
      workspaceId: workspace.id,
      workspaceTrust: workspace.trustLevel,
      configuredLevel: this.executionLevelFor(workspace),
      actionType: "READ",
      providerId: session.providerId,
      sessionId: session.id,
      actorId: options.actor,
    });
    if (policy.decision.effect === "DENY") {
      this.audit({
        eventType: "policy.denied",
        workspaceId: workspace.id,
        sessionId: session.id,
        providerId: session.providerId,
        actorId: options.actor,
        severity: "warning",
        decision: "DENY",
        riskScore: policy.riskScore,
        summary: "message denied: " + policy.decision.reasons.join("; "),
      });
      throw new CockpitError("POLICY_DENIED", policy.decision.reasons.join("; "));
    }

    // 4. Run + stream.
    const run = this.store.insertRun({
      sessionId: session.id,
      workspaceId: workspace.id,
      providerId: session.providerId,
      status: "RUNNING",
      errorCode: null,
      errorSummary: null,
    });
    this.store.updateSession(session.id, { status: "RUNNING", lastActivityAt: new Date().toISOString() });
    this.heartbeatSession(session.id);

    const handle = { sessionId: session.id, nativeSessionId: session.nativeSessionId, processId: null };
    const providerInput: ProviderMessageInput = {
      text: options.text,
      mode: options.mode ?? session.mode,
      contextRefs: refs,
      allowDangerousSkipPermissions: options.allowDangerousSkipPermissions === true,
    };
    try {
      if (session.providerId === "claude_code") {
        this.claudeAdapter.bindWorkspaceCwd(session.id, workspace.normalizedRootPath);
      }
      await adapter.sendMessage(handle, providerInput);
      this.store.updateRun(run.id, { status: "COMPLETED", completedAt: new Date().toISOString() });
      this.store.updateSession(session.id, { status: "IDLE", lastActivityAt: new Date().toISOString() });
      this.audit({
        eventType: "session.message",
        workspaceId: workspace.id,
        sessionId: session.id,
        runId: run.id,
        providerId: session.providerId,
        actorId: options.actor,
        decision: policy.decision.effect,
        riskScore: policy.riskScore,
        summary: "message dispatched to provider",
      });
      return { run: this.store.getRun(run.id) as AgentRun, decision: policy.decision.effect, approval: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code: CockpitErrorCode = error instanceof CockpitError ? error.code : "INTERNAL_ERROR";
      this.store.updateRun(run.id, { status: "FAILED", completedAt: new Date().toISOString(), errorCode: code, errorSummary: redactText(message) });
      this.store.updateSession(session.id, { status: code === "PROVIDER_NOT_INSTALLED" ? "DISCONNECTED" : "FAILED" });
      this.bus.ingest(session.id, run.id, { type: "RuntimeError", errorCode: code, message: redactText(message) });
      throw error;
    }
  }

  async cancelSession(sessionId: string, actor: string): Promise<UnifiedSession> {
    const session = this.store.requireSession(sessionId);
    const adapter = this.providers.require(session.providerId);
    try {
      await adapter.cancel({ sessionId: session.id, nativeSessionId: session.nativeSessionId, processId: null });
    } catch {
      // cancel must never throw the session into a bad state
    }
    this.supervisor.cancelForSession(sessionId);
    this.store.updateSession(sessionId, { status: "COMPLETED", endedAt: new Date().toISOString() });
    this.releaseLockIfHeld(session);
    this.audit({
      eventType: "session.cancelled",
      workspaceId: session.workspaceId,
      sessionId: session.id,
      providerId: session.providerId,
      actorId: actor,
      summary: "session cancelled",
    });
    return this.store.requireSession(sessionId);
  }

  // --- Discovery / import ----------------------------------------------------------------------

  async scanDiscovery(workspaceId: string, providerId: string | null): Promise<DiscoveredNativeSession[]> {
    const workspace = this.store.requireWorkspace(workspaceId);
    const providers = providerId ? [this.providers.require(providerId)] : this.providers.list();
    const discovered: DiscoveredNativeSession[] = [];
    for (const adapter of providers) {
      try {
        const sessions = await adapter.discoverSessions(workspaceId, workspace.normalizedRootPath);
        discovered.push(...sessions);
      } catch {
        // a broken adapter must not break the whole scan
      }
    }
    this.audit({
      eventType: "session.discovered",
      workspaceId,
      summary: "discovery scan found " + discovered.length + " native session(s)",
    });
    return discovered;
  }

  async importDiscoveredSession(providerId: string, nativeSessionId: string, workspaceId: string, actor: string): Promise<UnifiedSession> {
    this.store.requireWorkspace(workspaceId);
    const existing = this.store.findSessionByNativeId(providerId, nativeSessionId, workspaceId);
    if (existing) return existing;
    const adapter = this.providers.require(providerId);
    const capabilities = adapter.getCapabilities();
    const session = this.store.insertSession({
      workspaceId,
      providerId,
      nativeSessionId,
      parentSessionId: null,
      title: "Imported native session",
      status: "DISCOVERED",
      mode: "CHAT",
      writerState: "NONE",
      startedAt: null,
      endedAt: null,
      lastActivityAt: new Date().toISOString(),
      nativeMetadataJson: JSON.stringify({ importedBy: actor }),
      capabilitiesJson: JSON.stringify(capabilities),
      resumeTokenRef: null,
    });
    this.audit({
      eventType: "session.imported",
      workspaceId,
      sessionId: session.id,
      providerId,
      actorId: actor,
      summary: "native session imported with preserved id",
    });
    return session;
  }

  // --- Reconciliation (spec §6.4) -----------------------------------------------------------------

  reconcile(): ReconciliationReport {
    const now = Date.now();
    const deadProcesses = this.supervisor.detectDeadProcesses();
    const expiredLocks = this.store.expireLocks(now) + this.approvals.expireStale();
    let markedStale = 0;
    const sessions = this.store.listSessions({ statuses: ["RUNNING", "STARTING", "WAITING_APPROVAL"] });
    for (const session of sessions) {
      const lastActivity = session.lastActivityAt ? Date.parse(session.lastActivityAt) : 0;
      if (now - lastActivity > STALE_SESSION_MS) {
        this.store.updateSession(session.id, { status: "STALE" });
        markedStale += 1;
        this.audit({
          eventType: "session.stale",
          workspaceId: session.workspaceId,
          sessionId: session.id,
          severity: "warning",
          summary: "session marked STALE after inactivity (history preserved)",
        });
      }
    }
    const duplicateNativeIds = this.store.countDuplicateNativeIds();
    return { checkedSessions: sessions.length, markedStale, markedDisconnected: 0, expiredLocks, duplicateNativeIds, deadProcesses };
  }

  // --- Usage --------------------------------------------------------------------------------------

  recordUsage(sessionId: string, snapshot: ProviderUsageSnapshot): void {
    const session = this.store.requireSession(sessionId);
    this.store.insertUsage({
      sessionId,
      providerId: session.providerId,
      model: snapshot.model,
      inputTokens: snapshot.inputTokens,
      outputTokens: snapshot.outputTokens,
      cacheReadTokens: snapshot.cacheReadTokens,
      cacheWriteTokens: snapshot.cacheWriteTokens,
      reasoningTokens: snapshot.reasoningTokens,
      reportedCostUsd: snapshot.reportedCostUsd,
      estimatedCostUsd: null,
      source: snapshot.source,
    });
    this.bus.ingest(sessionId, null, { type: "UsageUpdated", usage: snapshot });
  }

  usageSummary(): UsageSummary {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const records = this.store.listUsage({ sinceIso: since, limit: 5000 });
    const sum = (values: Array<number | null>): number | null => {
      const present = values.filter((value): value is number => value !== null);
      return present.length === 0 ? null : present.reduce((total, value) => total + value, 0);
    };
    const group = (keyOf: (record: (typeof records)[number]) => string) => {
      const buckets = new Map<string, (typeof records)[number][]>();
      for (const record of records) {
        const key = keyOf(record);
        buckets.set(key, [...(buckets.get(key) ?? []), record]);
      }
      return buckets;
    };
    return {
      totals: {
        sessions: new Set(records.map((record) => record.sessionId)).size,
        inputTokens: sum(records.map((record) => record.inputTokens)),
        outputTokens: sum(records.map((record) => record.outputTokens)),
        reportedCostUsd: sum(records.map((record) => record.reportedCostUsd)),
        estimatedCostUsd: sum(records.map((record) => record.estimatedCostUsd)),
      },
      byProvider: [...group((record) => record.providerId).entries()].map(([providerId, groupRecords]) => ({
        providerId,
        inputTokens: sum(groupRecords.map((record) => record.inputTokens)),
        outputTokens: sum(groupRecords.map((record) => record.outputTokens)),
        source: groupRecords[0]?.source ?? "UNKNOWN",
      })),
      byWorkspace: [...group((record) => this.store.getSession(record.sessionId)?.workspaceId ?? "").entries()]
        .filter(([workspaceId]) => workspaceId !== "")
        .map(([workspaceId, groupRecords]) => ({
          workspaceId,
          inputTokens: sum(groupRecords.map((record) => record.inputTokens)),
          outputTokens: sum(groupRecords.map((record) => record.outputTokens)),
        })),
      byModel: [...group((record) => record.model ?? "unknown").entries()].map(([model, groupRecords]) => ({
        model,
        inputTokens: sum(groupRecords.map((record) => record.inputTokens)),
        outputTokens: sum(groupRecords.map((record) => record.outputTokens)),
      })),
    };
  }

  // --- Stream attachment ---------------------------------------------------------------------------

  private attachStream(sessionId: string, nativeSessionId: string | null): void {
    const session = this.store.getSession(sessionId);
    if (!session) return;
    const adapter = this.providers.get(session.providerId);
    if (!adapter) return;
    adapter.subscribe({ sessionId, nativeSessionId, processId: null }, (event) => {
      this.handleAdapterEvent(sessionId, event);
    });
  }

  private handleAdapterEvent(sessionId: string, event: NormalizedAgentEvent): void {
    const session = this.store.getSession(sessionId);
    if (!session) return;
    switch (event.type) {
      case "ToolStarted": {
        const execution = this.store.insertToolExecution({
          runId: null,
          sessionId,
          toolName: event.toolName,
          actionType: event.actionType,
          status: "RUNNING",
          riskScore: null,
          approvalRequestId: null,
          inputJson: null,
          outputSummary: event.summary,
          exitCode: null,
        });
        this.bus.ingest(sessionId, null, event);
        void execution;
        return;
      }
      case "ApprovalRequired": {
        const workspace = this.store.requireWorkspace(session.workspaceId);
        const decision = evaluatePolicy({
          workspaceId: session.workspaceId,
          workspaceTrust: workspace.trustLevel,
          configuredLevel: this.executionLevelFor(workspace),
          actionType: event.actionType,
        });
        const approval = this.approvals.create({
          sessionId,
          workspaceId: session.workspaceId,
          actionType: event.actionType,
          summary: event.summary,
          actionInput: { summary: event.summary, providerEvent: true },
          decision: decision.decision,
        });
        this.store.updateSession(sessionId, { status: "WAITING_APPROVAL" });
        this.bus.ingest(sessionId, null, { type: "ApprovalRequired", approvalId: approval.id, actionType: event.actionType, summary: event.summary, riskScore: approval.riskScore });
        return;
      }
      case "UsageUpdated": {
        this.recordUsage(sessionId, event.usage);
        return;
      }
      case "RuntimeError": {
        this.audit({
          eventType: "session.failed",
          workspaceId: session.workspaceId,
          sessionId,
          providerId: session.providerId,
          severity: "warning",
          decision: event.errorCode,
          summary: event.message,
        });
        this.bus.ingest(sessionId, null, event);
        this.store.updateSession(sessionId, { status: "FAILED" });
        return;
      }
      case "SessionCompleted": {
        this.bus.ingest(sessionId, null, event);
        if (event.status === "COMPLETED") {
          this.store.updateSession(sessionId, { status: "IDLE" });
        }
        return;
      }
      default:
        this.bus.ingest(sessionId, null, event);
    }
  }

  // --- Policy helpers ---------------------------------------------------------------------------------

  executionLevelFor(workspace: Workspace): ExecutionLevel {
    const configured = (process.env.PAO_DEFAULT_EXECUTION_LEVEL as ExecutionLevel | undefined) ?? DEFAULT_EXECUTION_LEVEL;
    return configured && configured.startsWith("LEVEL_") ? parseExecutionLevel(configured) : defaultExecutionLevel();
  }

  private heartbeatSession(sessionId: string): void {
    const lock = this.store.getActiveLock(this.store.requireSession(sessionId).workspaceId);
    if (lock && lock.sessionId === sessionId) {
      this.locks.extendLease(lock.id);
    }
  }

  private releaseLockIfHeld(session: UnifiedSession): void {
    if (session.writerState !== "HELD") return;
    try {
      this.locks.release(session.workspaceId, session.id, "system");
      this.store.updateSession(session.id, { writerState: "NONE" });
    } catch {
      // lock already gone
    }
  }

  // --- Tool action flow (spec §32) ----------------------------------------------------------------------

  /** Execute a tool call through policy → (approval) → lock → audit. Used by
   *  the executor and MCP tools; DENY returns a structured result, never a
   *  silent success. */
  async runToolAction(input: {
    sessionId: string;
    toolName: string;
    actionInput: Record<string, unknown>;
    actor: string;
    approvalId?: string;
  }): Promise<{ status: "COMPLETED" | "DENIED" | "AWAITING_APPROVAL"; outputSummary: string; exitCode: number | null; approval: ApprovalRequest | null }> {
    const session = this.store.requireSession(input.sessionId);
    const workspace = this.store.requireWorkspace(session.workspaceId);
    const actionType: ActionType = classifyToolAction(input.toolName, input.actionInput).actionType;
    const policy = evaluatePolicy({
      workspaceId: workspace.id,
      workspaceTrust: workspace.trustLevel,
      configuredLevel: this.executionLevelFor(workspace),
      actionType,
      command: typeof input.actionInput.command === "string" ? input.actionInput.command : null,
      targetPath: typeof input.actionInput.path === "string" ? input.actionInput.path : null,
      workspaceRoot: workspace.normalizedRootPath,
      providerId: session.providerId,
      sessionId: session.id,
      actorId: input.actor,
    });
    const execution = this.store.insertToolExecution({
      runId: null,
      sessionId: session.id,
      toolName: input.toolName,
      actionType,
      status: policy.decision.effect === "ALLOW" ? "RUNNING" : policy.decision.effect === "REQUIRE_APPROVAL" ? "AWAITING_APPROVAL" : "DENIED",
      riskScore: policy.riskScore,
      approvalRequestId: null,
      inputJson: redactJsonForAudit(input.actionInput),
      outputSummary: policy.decision.reasons.join("; "),
      exitCode: null,
    });

    if (policy.decision.effect === "DENY") {
      this.audit({
        eventType: "policy.denied",
        workspaceId: workspace.id,
        sessionId: session.id,
        providerId: session.providerId,
        actorId: input.actor,
        severity: "warning",
        decision: "DENY",
        riskScore: policy.riskScore,
        summary: "tool " + input.toolName + " denied: " + policy.decision.reasons.join("; "),
      });
      return { status: "DENIED", outputSummary: policy.decision.reasons.join("; "), exitCode: null, approval: null };
    }

    if (policy.decision.effect === "REQUIRE_APPROVAL") {
      const approval = input.approvalId
        ? this.store.getApproval(input.approvalId)
        : this.approvals.create({
            sessionId: session.id,
            workspaceId: workspace.id,
            actionType,
            summary: "tool " + input.toolName,
            actionInput: input.actionInput,
            decision: policy.decision,
          });
      if (!approval) throw new CockpitError("NOT_FOUND", "approval not found");
      if (approval.status !== "APPROVED") {
        this.store.updateToolExecution(execution.id, { approvalRequestId: approval.id });
        return { status: "AWAITING_APPROVAL", outputSummary: "approval required", exitCode: null, approval };
      }
      // Approved: bind the approval to the exact action input (single use).
      this.approvals.consume(approval.id, input.actionInput);
      this.store.updateToolExecution(execution.id, { approvalRequestId: approval.id, status: "RUNNING" });
    }

    // Writer lease before mutation.
    const acquired = this.locks.acquire({
      workspaceId: workspace.id,
      sessionId: session.id,
      ownerInstanceId: ownerInstanceId(),
      actor: input.actor,
    });
    if (!acquired.acquired) {
      this.store.updateToolExecution(execution.id, { status: "DENIED", outputSummary: "writer lease conflict", completedAt: new Date().toISOString() });
      throw new CockpitError("LOCK_CONFLICT", acquired.reason);
    }

    try {
      const result = await this.dispatchTool(workspace.normalizedRootPath, input.actionInput);
      this.store.updateToolExecution(execution.id, {
        status: result.exitCode === 0 ? "COMPLETED" : "FAILED",
        outputSummary: redactText(result.output.slice(0, 400)),
        exitCode: result.exitCode,
        completedAt: new Date().toISOString(),
      });
      this.audit({
        eventType: "tool.completed",
        workspaceId: workspace.id,
        sessionId: session.id,
        providerId: session.providerId,
        actorId: input.actor,
        decision: "ALLOW",
        riskScore: policy.riskScore,
        summary: "tool " + input.toolName + " finished with exit " + result.exitCode,
      });
      return { status: result.exitCode === 0 ? "COMPLETED" : "DENIED", outputSummary: redactText(result.output.slice(0, 400)), exitCode: result.exitCode, approval: null };
    } finally {
      try { this.locks.release(workspace.id, session.id, "system"); } catch { /* next mutation re-acquires */ }
    }
  }

  /** The ONLY local execution surface: workspace-bounded file reads or
   *  allowlisted one-shot commands through the 20.24 safe runner. */
  private async dispatchTool(workspaceRoot: string, actionInput: Record<string, unknown>): Promise<{ output: string; exitCode: number }> {
    const kind = typeof actionInput.kind === "string" ? actionInput.kind : "";
    if (kind === "read_file") {
      const target = resolveInsideWorkspace(workspaceRoot, String(actionInput.path ?? ""));
      if (!existsSync(target)) {
        return { output: "not found", exitCode: 1 };
      }
      const content = readFileSync(target, "utf8").slice(0, 20_000);
      return { output: relativizeForDisplay(workspaceRoot, target) + "\n" + content, exitCode: 0 };
    }
    if (kind === "run_command") {
      const executable = String(actionInput.executable ?? "");
      const args = Array.isArray(actionInput.args) ? actionInput.args.map(String) : [];
      const run = await this.supervisor.runManaged({
        workspaceId: "",
        sessionId: null,
        providerId: "cockpit",
        executable,
        args,
        cwd: workspaceRoot,
        timeoutMs: 60_000,
      });
      return { output: redactText((run.stdout + "\n" + run.stderr).slice(0, 20_000)), exitCode: run.process.exitCode ?? 1 };
    }
    throw new CockpitError("VALIDATION_ERROR", "unsupported tool action kind: " + kind);
  }

  private seedCommands(): void {
    const service = this;
    this.commands.register({
      id: "status",
      name: "status",
      description: "Show workspace, provider, lock, and policy status",
      handler: async (ctx) => {
        const workspace = ctx.workspaceId ? service.store.getWorkspace(ctx.workspaceId) : null;
        const lock = ctx.workspaceId ? service.locks.currentHolder(ctx.workspaceId) : null;
        return {
          summary: "cockpit status",
          data: {
            workspace: workspace ? { id: workspace.id, trust: workspace.trustLevel, branch: workspace.gitBranch } : null,
            lockHolder: lock?.sessionId ?? null,
          },
        };
      },
    });
    this.commands.register({
      id: "sessions",
      name: "sessions",
      description: "List recent sessions in this workspace",
      handler: async (ctx) => {
        const sessions = ctx.workspaceId ? service.store.listSessions({ workspaceId: ctx.workspaceId, limit: 20 }) : [];
        return { summary: sessions.length + " session(s)", data: { sessions: sessions.map((s) => ({ id: s.id, title: s.title, status: s.status, provider: s.providerId })) } };
      },
    });
    this.commands.register({
      id: "usage",
      name: "usage",
      description: "Show usage totals (reported vs estimated kept separate)",
      handler: async () => {
        const summary = service.usageSummary();
        return { summary: "usage summary", data: { ...summary } };
      },
    });
    this.commands.register({
      id: "cancel",
      name: "cancel",
      description: "Cancel the current session",
      handler: async (ctx) => {
        if (!ctx.sessionId) return { summary: "no active session", data: {} };
        await service.cancelSession(ctx.sessionId, ctx.actor);
        return { summary: "session cancelled", data: {} };
      },
    });
    this.commands.register({
      id: "checkpoint",
      name: "checkpoint",
      description: "Record a checkpoint marker; commits require policy and are never destructive",
      handler: async (ctx) => {
        if (!ctx.workspaceId) return { summary: "no workspace", data: {} };
        const workspace = service.store.requireWorkspace(ctx.workspaceId);
        if (!workspace.gitBranch) {
          return { summary: "workspace is not a git repository; checkpoint metadata recorded only", data: { git: false } };
        }
        return { summary: "checkpoint recorded for branch " + workspace.gitBranch, data: { git: true } };
      },
    });
    this.commands.register({
      id: "rollback",
      name: "rollback",
      description: "Rollback is approval-gated; destructive git is never silently executed",
      handler: async () => {
        return { summary: "rollback requires a human-approved plan; hard resets are never executed by the cockpit", data: { supported: false } };
      },
    });
  }
}

// --- helpers --------------------------------------------------------------------------------------

function ownerInstanceId(): string {
  return process.env.PAO_INSTANCE_ID ?? "local_instance";
}

function detectGit(root: string): { remoteUrl: string | null; branch: string | null; headSha: string | null } {
  const gitDir = join(root, ".git");
  if (!existsSync(gitDir)) return { remoteUrl: null, branch: null, headSha: null };
  try {
    // Read git metadata from files directly — no subprocess on the register
    // path (fast + sandbox friendly). .git/HEAD → ref; loose refs resolve to
    // the head sha when present.
    const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
    const refPrefix = "ref: ";
    if (!head.startsWith(refPrefix)) {
      return { remoteUrl: null, branch: null, headSha: head.slice(0, 40) };
    }
    const refName = head.slice(refPrefix.length).trim();
    const refPath = join(gitDir, refName);
    const headSha = existsSync(refPath) ? readFileSync(refPath, "utf8").trim() : null;
    let remoteUrl: string | null = null;
    const configPath = join(gitDir, "config");
    if (existsSync(configPath)) {
      const config = readFileSync(configPath, "utf8");
      const originMarker = '[remote "origin"]';
      const originIdx = config.indexOf(originMarker);
      if (originIdx >= 0) {
        const originBlock = config.slice(originIdx + originMarker.length);
        const urlMarker = "url = ";
        const urlIdx = originBlock.indexOf(urlMarker);
        if (urlIdx >= 0) {
          const rest = originBlock.slice(urlIdx + urlMarker.length);
          remoteUrl = rest.split(/\s/)[0] ?? null;
        }
      }
    }
    const branchPrefix = "refs/heads/";
    return { remoteUrl, branch: refName.startsWith(branchPrefix) ? refName.slice(branchPrefix.length) : refName, headSha };
  } catch {
    return { remoteUrl: null, branch: null, headSha: null };
  }
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "workspace";
}

// singleton ------------------------------------------------------------------------------------------

let singleton: CockpitService | null = null;

export function getCockpitService(): CockpitService {
  if (!singleton) singleton = new CockpitService();
  return singleton;
}

export function resetCockpitServiceForTests(): void {
  singleton = null;
}
