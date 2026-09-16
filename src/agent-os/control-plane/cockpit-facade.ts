// Phase 20.27 — Agent Cockpit service facade.
//
// Wires the cockpit layer onto the Phase 20.16 control plane: sessions map to
// task envelopes, authorization flows through access-policy.ts (which wraps
// the Phase 20.16 policy engine's guards), and every privileged step records
// evidence and audit. Git access is read-only and goes through a fixed-argv,
// allowlisted subprocess runner — never a shell. Context artifacts live in
// context-plane.ts.

import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { runProcessSafely } from "../media-acquisition/process-runner";
import { runAgentProcess } from "./cockpit-agents";
import { CockpitStore } from "./cockpit-store";
import { builtinAgentAdapters, type AgentAdapter } from "./cockpit-agents";
import { evaluateCockpitAction } from "./access-policy";
import { evidenceHash, isEvidenceExpired, runGateEngine } from "./cockpit-gate";
import { writeContextArtifact } from "./context-plane";
import {
  newCockpitId,
  type AccessMode,
  type AgentEvent,
  type AgentProfile,
  type AgentSession,
  type AgentType,
  type CockpitAction,
  type CockpitApproval,
  type CockpitPolicyResult,
  type CockpitTask,
  type CommandSpec,
  type ContextSnapshot,
  type EvidenceRecord,
  type EvidenceType,
  type GateProfile,
  type GateFinding,
  type GateRun,
  type ProviderState,
  type ReleaseMark,
  type ReviewFinding,
  type ReviewRun,
} from "./cockpit-types";

export interface CockpitFlags {
  controlPlane: boolean;
  agentCockpit: boolean;
  architectureGraph: boolean;
  readinessGate: boolean;
  providerVerification: boolean;
  viberavenAdapter: boolean;
  reviewerGate: boolean;
}

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export function cockpitFlags(): CockpitFlags {
  return {
    controlPlane: envFlag("CONTROL_PLANE_ENABLED", true),
    agentCockpit: envFlag("AGENT_COCKPIT_ENABLED", true),
    architectureGraph: envFlag("ARCHITECTURE_GRAPH_ENABLED", true),
    readinessGate: envFlag("READINESS_GATE_ENABLED", true),
    providerVerification: envFlag("PROVIDER_VERIFICATION_ENABLED", true),
    viberavenAdapter: envFlag("VIBERAVEN_ADAPTER_ENABLED", false),
    reviewerGate: envFlag("REVIEWER_GATE_ENABLED", true),
  };
}

interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Read-only git access with fixed argv and an allowlisted binary. */
async function runGit(args: string[], cwd: string, timeoutMs = 20_000): Promise<GitResult> {
  const result = await runProcessSafely({
    binary: "git",
    args,
    cwd,
    timeoutMs,
    maxBufferBytes: 8 * 1024 * 1024,
  });
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
}

const HUMAN_ACTOR_PATTERN = /^(operator|dashboard|user|human|owner)/i;

export class AgentCockpitService {
  readonly store: CockpitStore;
  private adapters: Map<AgentType, AgentAdapter>;
  private flags: CockpitFlags;
  private workspaceRoot: string;

  constructor(store?: CockpitStore, adapters?: AgentAdapter[], workspaceRoot?: string) {
    this.store = store ?? new CockpitStore();
    this.adapters = new Map((adapters ?? builtinAgentAdapters()).map((a) => [a.type, a]));
    this.flags = cockpitFlags();
    this.workspaceRoot = workspaceRoot ?? process.cwd();
  }

  // --- Agents (doc §11-§14, §121) ------------------------------------------------

  async listAgents(): Promise<AgentProfile[]> {
    const profiles: AgentProfile[] = [];
    for (const adapter of this.adapters.values()) {
      const detection = adapter.detect();
      const persistedMode = this.store.getAccessMode("agent_" + adapter.type, "ask");
      profiles.push({
        id: "agent_" + adapter.type,
        type: adapter.type,
        displayName: adapter.displayName,
        transport: "cli",
        status: detection.detected ? "ready" : "unavailable",
        version: detection.version,
        accessMode: persistedMode,
        policyProfile: "coding-safe",
        capabilities: adapter.capabilities(),
        workspaceScope: this.workspaceRoot,
        lastHealthCheckAt: new Date().toISOString(),
        reason: detection.reason,
      });
    }
    return profiles;
  }

  async agentDoctor(type: AgentType): Promise<{ detected: boolean; binary?: string; version?: string; launchable: boolean; reason?: string }> {
    const adapter = this.adapters.get(type);
    if (!adapter) return { detected: false, launchable: false, reason: "unknown agent type" };
    const detection = adapter.detect();
    if (!detection.detected) {
      return { detected: false, launchable: false, reason: detection.reason };
    }
    const version = adapter.probeVersion ? await adapter.probeVersion() : undefined;
    return { detected: true, binary: detection.binary, version, launchable: Boolean(detection.binary) };
  }

  async setAccessMode(agentType: AgentType, mode: AccessMode, actor: string): Promise<void> {
    if (actor.startsWith("agent")) {
      throw new Error("invariant: an agent cannot change its own access mode");
    }
    const adapter = this.adapters.get(agentType);
    if (!adapter) throw new Error("unknown agent type " + agentType);
    this.store.setAccessMode("agent_" + agentType, mode, adapter.displayName, agentType);
  }

  // --- Policy (the single decision path) ------------------------------------------

  evaluate(action: CockpitAction): CockpitPolicyResult {
    const mode = this.store.getAccessMode("agent_" + (action.agentType ?? "codex"), action.accessMode);
    return evaluateCockpitAction({ ...action, accessMode: mode });
  }

  // --- Sessions (doc §81-§84) --------------------------------------------------------

  async startSession(input: { agentType: AgentType; prompt: string; taskId?: string; requestedBy?: string }): Promise<AgentSession> {
    if (!this.flags.agentCockpit) throw new Error("agent cockpit is disabled by flag");
    const adapter = this.adapters.get(input.agentType);
    if (!adapter) throw new Error("unknown agent type " + input.agentType);
    const detection = adapter.detect();
    if (!detection.detected) {
      throw new Error("agent " + input.agentType + " is not available: " + (detection.reason ?? "not found"));
    }
    const accessMode = this.store.getAccessMode("agent_" + input.agentType, "ask");
    const now = new Date().toISOString();
    const session: AgentSession = {
      id: newCockpitId("csess"),
      agentId: "agent_" + input.agentType,
      agentType: input.agentType,
      accessMode,
      policyProfile: "coding-safe",
      workspaceScope: this.workspaceRoot,
      taskId: input.taskId,
      status: "running",
      createdAt: now,
      updatedAt: now,
    };
    this.store.saveSession(session);
    this.store.appendEvent(session.id, "session.started", input.prompt.slice(0, 200), "R3");
    this.store.appendEvent(session.id, "message.user", input.prompt.slice(0, 500));
    await this.runSessionCommand(session, adapter.buildCommand({ prompt: input.prompt, workspaceScope: this.workspaceRoot }));
    return this.store.getSession(session.id)!;
  }

  private async runSessionCommand(session: AgentSession, spec: CommandSpec): Promise<void> {
    this.store.appendEvent(session.id, "command.started", spec.binary + " with " + spec.args.length + " argv elements (fixed shape)", "R3");
    const result = await runAgentProcess(spec.binary, spec.args, spec.cwd, spec.timeoutMs);
    const output = (result.stdout + "\n" + result.stderr).slice(0, 8000);
    this.store.appendEvent(session.id, "tool.output", output || "(no output)", "R3");
    const now = new Date().toISOString();
    if (result.timedOut) {
      this.store.saveSession({ ...session, status: "failed", updatedAt: now, completedAt: now, error: "timed out" });
      this.store.appendEvent(session.id, "session.failed", "timed out");
      return;
    }
    this.recordEvidence({
      type: "command_result",
      source: "cockpit-session:" + session.agentType,
      summary: result.exitCode === 0 ? "session command completed" : "session command exited " + result.exitCode,
    });
    if (result.exitCode === 0) {
      this.store.saveSession({ ...session, status: "completed", updatedAt: now, completedAt: now });
      this.store.appendEvent(session.id, "session.completed", "exit 0");
    } else {
      this.store.saveSession({ ...session, status: "failed", updatedAt: now, completedAt: now, error: "exit " + result.exitCode });
      this.store.appendEvent(session.id, "session.failed", "exit " + result.exitCode);
    }
  }

  cancelSession(sessionId: string, actor: string): AgentSession | null {
    const session = this.store.getSession(sessionId);
    if (!session) return null;
    if (session.status === "completed" || session.status === "cancelled") return session;
    const now = new Date().toISOString();
    // A cancelled session is never reported as success (doc §84).
    const updated: AgentSession = { ...session, status: "cancelled", updatedAt: now, completedAt: now };
    this.store.saveSession(updated);
    this.store.appendEvent(sessionId, "session.cancelled", "cancelled by " + actor);
    return updated;
  }

  sessionEvents(sessionId: string, limit = 200): AgentEvent[] {
    return this.store.listEvents(sessionId, limit);
  }

  // --- Approvals (doc §22-§23) -----------------------------------------------------------

  requestApproval(input: { action: string; agentId?: string; sessionId?: string; resource?: string; risk: CockpitApproval["risk"]; reason: string; preview?: string; scope: CockpitApproval["scope"]; requestedBy: string; ttlMs?: number }): CockpitApproval {
    const approval: CockpitApproval = {
      id: newCockpitId("cappr"),
      action: input.action,
      agentId: input.agentId,
      sessionId: input.sessionId,
      resource: input.resource ?? "",
      risk: input.risk,
      reason: input.reason,
      preview: (input.preview ?? "").slice(0, 500),
      scope: input.scope,
      status: "pending",
      requestedBy: input.requestedBy,
      createdAt: new Date().toISOString(),
      expiresAt: input.ttlMs ? new Date(Date.now() + input.ttlMs).toISOString() : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
    this.store.saveApproval(approval);
    if (input.sessionId) {
      this.store.appendEvent(input.sessionId, "approval.required", approval.action + " (" + approval.risk + ")");
    }
    return approval;
  }

  /**
   * Resolve a pending approval. An agent can NEVER resolve its own protected
   * approval (doc §183): only human actors (operator/dashboard/user) may.
   */
  resolveApproval(id: string, decision: "approved" | "rejected", decidedBy: string): CockpitApproval | null {
    if (!HUMAN_ACTOR_PATTERN.test(decidedBy)) {
      throw new Error("invariant: approvals are resolved by humans only, not by " + decidedBy);
    }
    const approval = this.store.getApproval(id);
    if (!approval || approval.status !== "pending") return null;
    if (approval.expiresAt && new Date(approval.expiresAt).getTime() < Date.now()) {
      const expired: CockpitApproval = { ...approval, status: "expired" };
      this.store.saveApproval(expired);
      return expired;
    }
    const resolved: CockpitApproval = {
      ...approval,
      status: decision,
      decidedAt: new Date().toISOString(),
      decidedBy,
    };
    this.store.saveApproval(resolved);
    if (approval.sessionId) {
      this.store.appendEvent(approval.sessionId, "approval.resolved", approval.action + " " + decision + " by " + decidedBy);
    }
    return resolved;
  }

  /** True when an active (non-expired) approval covers the action for the scope. */
  hasActiveApproval(action: string, sessionId?: string): boolean {
    const approved = this.store.listApprovals("approved", 100);
    const now = Date.now();
    return approved.some((a) => {
      if (a.action !== action) return false;
      if (a.scope === "session" && a.sessionId && sessionId && a.sessionId !== sessionId) return false;
      if (a.expiresAt && new Date(a.expiresAt).getTime() < now) return false;
      return true;
    });
  }

  // --- Context plane (doc §29-§34; artifacts via context-plane.ts) ----------------------------

  async createContextSnapshot(attachments: Array<{ kind: string; ref: string }> = []): Promise<ContextSnapshot> {
    const git = await this.gitState();
    const snapshot: ContextSnapshot = {
      id: newCockpitId("ctx"),
      schemaVersion: 1,
      gitSha: git.headSha,
      branch: git.branch,
      policyHash: evidenceHash(cockpitFlags()),
      attachments,
      createdAt: new Date().toISOString(),
      fresh: true,
    };
    this.store.saveContextSnapshot(snapshot);
    try {
      writeContextArtifact(this.workspaceRoot, join("snapshots", snapshot.id + ".json"), snapshot);
    } catch {
      // .pao/ writes are best-effort; the snapshot is durable in the store.
    }
    return snapshot;
  }

  getContextSnapshot(id: string): ContextSnapshot | null {
    return this.store.getContextSnapshot(id);
  }

  // --- Git / release intelligence (doc §41-§46, read-only) --------------------------------------

  async gitState(): Promise<{ available: boolean; branch?: string; headSha?: string; dirty?: boolean; reason?: string }> {
    const head = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], this.workspaceRoot);
    if (head.exitCode !== 0) {
      return { available: false, reason: "git unavailable: " + head.stderr.slice(0, 120) };
    }
    const sha = await runGit(["rev-parse", "HEAD"], this.workspaceRoot);
    const status = await runGit(["status", "--porcelain"], this.workspaceRoot);
    return {
      available: true,
      branch: head.stdout.trim(),
      headSha: sha.stdout.trim() || undefined,
      dirty: status.stdout.trim().length > 0,
    };
  }

  async compareWithKnownGood(): Promise<{ knownGood?: ReleaseMark; commits: number; changedFiles: string[]; securitySensitive: string[]; diffHash?: string }> {
    const knownGood = this.store.latestKnownGood();
    const head = await runGit(["rev-parse", "HEAD"], this.workspaceRoot);
    const toSha = head.stdout.trim();
    if (!knownGood) {
      return { commits: 0, changedFiles: [], securitySensitive: [] };
    }
    const log = await runGit(["log", "--oneline", knownGood.sha + ".." + toSha], this.workspaceRoot);
    const nameOnly = await runGit(["diff", "--name-only", knownGood.sha + ".." + toSha], this.workspaceRoot);
    const changedFiles = nameOnly.stdout.split(/\r?\n/).filter((line) => line.trim() !== "");
    const securitySensitive = changedFiles.filter((file) => /auth|permission|secret|security|policy|gate|approval|redact|credential/i.test(file));
    const diffHash = createHash("sha256").update(changedFiles.join("\n")).digest("hex");
    return {
      knownGood,
      commits: log.stdout.split(/\r?\n/).filter((line) => line.trim() !== "").length,
      changedFiles,
      securitySensitive,
      diffHash,
    };
  }

  /**
   * Mark a release known-good/bad. HUMAN-ONLY: an agent cannot mark a release
   * known-good merely because tests passed (doc §46, §183).
   */
  markRelease(sha: string, state: ReleaseMark["state"], markedBy: string, reason?: string): ReleaseMark {
    if (!HUMAN_ACTOR_PATTERN.test(markedBy)) {
      throw new Error("invariant: releases are marked by humans only, not by " + markedBy);
    }
    const mark: ReleaseMark = { sha, state, markedBy, reason, createdAt: new Date().toISOString() };
    this.store.saveReleaseMark(mark);
    return mark;
  }

  // --- Evidence ledger (doc §76-§78) -------------------------------------------------------------

  recordEvidence(input: { type: EvidenceType; source: string; summary: string; gitSha?: string; contextSnapshotId?: string; ttlMs?: number; payload?: unknown }): EvidenceRecord {
    const record: EvidenceRecord = {
      id: newCockpitId("ev"),
      type: input.type,
      source: input.source,
      hash: evidenceHash(input.payload ?? input.summary),
      summary: input.summary,
      gitSha: input.gitSha,
      contextSnapshotId: input.contextSnapshotId,
      createdAt: new Date().toISOString(),
      expiresAt: input.ttlMs ? new Date(Date.now() + input.ttlMs).toISOString() : undefined,
    };
    this.store.saveEvidence(record);
    return record;
  }

  listEvidence(limit = 100): EvidenceRecord[] {
    return this.store.listEvidence(limit);
  }

  // --- Providers (doc §49-§52: detected != verified) ------------------------------------------------

  async refreshProviders(): Promise<ProviderState[]> {
    if (!this.flags.providerVerification) return this.store.listProviders();
    const definitions: Array<{ id: string; name: string; envVars: string[] }> = [
      { id: "provider_github", name: "GitHub", envVars: ["GITHUB_TOKEN", "GH_TOKEN"] },
      { id: "provider_openai", name: "OpenAI", envVars: ["OPENAI_API_KEY"] },
      { id: "provider_anthropic", name: "Anthropic", envVars: ["ANTHROPIC_API_KEY"] },
      { id: "provider_stripe", name: "Stripe", envVars: ["STRIPE_SECRET_KEY"] },
      { id: "provider_supabase", name: "Supabase", envVars: ["SUPABASE_URL", "SUPABASE_ANON_KEY"] },
      { id: "provider_vercel", name: "Vercel", envVars: ["VERCEL_TOKEN"] },
      { id: "provider_sentry", name: "Sentry", envVars: ["SENTRY_DSN"] },
      { id: "provider_discord", name: "Discord", envVars: ["DISCORD_WEBHOOK_URL"] },
    ];
    for (const definition of definitions) {
      const configuredVar = definition.envVars.find((name) => Boolean(process.env[name]));
      const prior = this.store.listProviders().find((p) => p.id === definition.id);
      const stillVerified = Boolean(prior?.runtimeVerified && prior.verificationExpiresAt && new Date(prior.verificationExpiresAt).getTime() > Date.now());
      const state: ProviderState = {
        id: definition.id,
        name: definition.name,
        status: stillVerified ? "verified" : configuredVar ? "verification_required" : "not_detected",
        detectionEvidence: configuredVar
          ? "credential reference present (" + configuredVar + " set; value never read)"
          : "no configuration detected in this environment",
        credentialConfigured: Boolean(configuredVar),
        runtimeVerified: stillVerified,
        lastVerifiedAt: stillVerified ? prior!.lastVerifiedAt : undefined,
        verificationExpiresAt: stillVerified ? prior!.verificationExpiresAt : undefined,
      };
      this.store.upsertProvider(state);
    }
    return this.store.listProviders();
  }

  /**
   * Runtime provider verification is permission-controlled and evidence-backed.
   * MVP: records a verification ONLY with an explicit human attestation
   * (doc §52) — never from repo detection alone.
   */
  verifyProvider(providerId: string, attestedBy: string, note: string): ProviderState | null {
    if (!this.flags.providerVerification) throw new Error("provider verification is disabled by flag");
    if (!HUMAN_ACTOR_PATTERN.test(attestedBy)) {
      throw new Error("invariant: provider runtime verification requires a human attestation");
    }
    const provider = this.store.listProviders().find((p) => p.id === providerId);
    if (!provider) return null;
    const verified: ProviderState = {
      ...provider,
      status: "verified",
      runtimeVerified: true,
      lastVerifiedAt: new Date().toISOString(),
      verificationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
    this.store.upsertProvider(verified);
    this.recordEvidence({
      type: "provider_verification",
      source: "cockpit:" + providerId,
      summary: "runtime verification attested by " + attestedBy + ": " + note.slice(0, 200),
      ttlMs: 24 * 60 * 60 * 1000,
    });
    return verified;
  }

  // --- Reviewer bridge (doc §71-§75) ----------------------------------------------------------------

  submitReview(findings: ReviewFinding[], contextSnapshotId?: string, diffSummary = ""): ReviewRun {
    const reviewers = new Set(findings.map((f) => f.reviewer));
    const disagreements: string[] = [];
    for (const reviewerA of reviewers) {
      for (const reviewerB of reviewers) {
        if (reviewerA >= reviewerB) continue;
        const a = findings.find((f) => f.reviewer === reviewerA);
        const b = findings.find((f) => f.reviewer === reviewerB);
        if (a && b && (a.verdict === "pass") !== (b.verdict === "pass")) {
          disagreements.push(reviewerA + " vs " + reviewerB + ": pass verdicts disagree (surfaced, not hidden)");
        }
      }
    }
    const run: ReviewRun = {
      id: newCockpitId("crev"),
      contextSnapshotId,
      diffSummary: diffSummary.slice(0, 400),
      findings,
      disagreements,
      createdAt: new Date().toISOString(),
    };
    this.store.saveReviewRun(run);
    for (const finding of findings) {
      if (finding.severity === "blocker" || finding.severity === "critical") {
        this.recordEvidence({
          type: "reviewer_finding",
          source: "reviewer:" + finding.reviewer,
          summary: finding.title + (finding.needsVerification ? " [needs_verification]" : ""),
        });
      }
    }
    return run;
  }

  // --- Gate (doc §57-§70) ------------------------------------------------------------------------------

  async runGate(profile: GateProfile): Promise<GateRun> {
    if (!this.flags.readinessGate) throw new Error("readiness gate is disabled by flag");
    const [git, providers] = await Promise.all([this.gitState(), this.refreshProviders()]);
    const run = runGateEngine({
      profile,
      evidence: this.listEvidence(200),
      providers,
      gitDirty: git.dirty === true,
      policyFilesChangedByAgent: false,
      gitSha: git.headSha,
    });
    this.store.saveGateRun(run);
    this.store.saveFindings(run.id, run.findings);
    try {
      writeContextArtifact(this.workspaceRoot, join("gates", run.id + ".json"), run);
    } catch {
      // .pao/ is best-effort; the gate result is durable in the store.
    }
    return run;
  }

  latestGate(): GateRun | null {
    return this.store.latestGateRun();
  }

  // --- Tasks ---------------------------------------------------------------------------------------------

  createTask(input: { title: string; ownerAgentId?: string; risk: CockpitTask["risk"]; requiredGateProfile?: GateProfile }): CockpitTask {
    const now = new Date().toISOString();
    const task: CockpitTask = {
      id: newCockpitId("ctask"),
      title: input.title,
      ownerAgentId: input.ownerAgentId,
      workspaceScope: this.workspaceRoot,
      risk: input.risk,
      status: "planned",
      requiredGateProfile: input.requiredGateProfile ?? "pull_request",
      createdAt: now,
      updatedAt: now,
    };
    this.store.saveTask(task);
    return task;
  }

  listTasks(status?: CockpitTask["status"]): CockpitTask[] {
    return this.store.listTasks(status);
  }

  // --- Optional VibeRaven evidence adapter (doc §54-§55, §110; flag OFF by default) -----------------------

  viberavenStatus(): { enabled: boolean; available: boolean; reason?: string } {
    if (!this.flags.viberavenAdapter) {
      return { enabled: false, available: false, reason: "VIBERAVEN_ADAPTER_ENABLED is off; VibeRaven is reference-only" };
    }
    const home = process.env.VIBERAVEN_HOME;
    if (!home) return { enabled: true, available: false, reason: "VIBERAVEN_HOME is not configured" };
    return { enabled: true, available: true };
  }

  /**
   * Normalize external VibeRaven findings into Pao evidence. Upstream output is
   * UNTRUSTED: severity is mapped conservatively (unknown maps UP to blocker,
   * never down), source is recorded, and the gate re-evaluates applicability
   * itself (doc §194).
   */
  normalizeVibeRavenFindings(payload: { source_version?: string; findings?: Array<{ id?: string; severity?: string; title?: string }> }): Array<{ findingId: string; severity: "info" | "warning" | "blocker" | "critical"; title: string }> {
    const allowed = new Set(["info", "warning", "blocker", "critical"]);
    return (payload.findings ?? [])
      .filter((f) => typeof f.id === "string" && typeof f.title === "string")
      .map((f) => ({
        findingId: f.id as string,
        severity: (typeof f.severity === "string" && allowed.has(f.severity) ? f.severity : "blocker") as "info" | "warning" | "blocker" | "critical",
        title: f.title as string,
      }));
  }

  // --- Cockpit overview (doc §90) ---------------------------------------------------------------------------

  async overview(): Promise<Record<string, unknown>> {
    const [git, providers] = await Promise.all([this.gitState(), this.refreshProviders()]);
    const gate = this.latestGate();
    const openBlockers = gate
      ? gate.findings.filter((f: GateFinding) => f.status === "open" && (f.severity === "blocker" || f.severity === "critical")).length
      : 0;
    return {
      flags: this.flags,
      git,
      readiness: gate ? { verdict: gate.verdict, profile: gate.profile, blockers: openBlockers } : null,
      openBlockers,
      pendingApprovals: this.store.listApprovals("pending").length,
      agents: (await this.listAgents()).map((a) => ({ id: a.id, type: a.type, status: a.status, accessMode: a.accessMode })),
      providers: providers.map((p) => ({ id: p.id, status: p.status })),
      lastKnownGood: this.store.latestKnownGood(),
      viberaven: this.viberavenStatus(),
    };
  }

  /** Audit-friendly correlation id for a cockpit operation. */
  correlationId(): string {
    return "corr_" + randomUUID().slice(0, 8);
  }

  // --- MCP tools (doc §53) --------------------------------------------------------------------------------------

  mcpToolNames(): string[] {
    return [
      "pao_control_agent_list",
      "pao_control_agent_health",
      "pao_control_context_snapshot",
      "pao_control_git_status",
      "pao_control_release_compare",
      "pao_control_provider_list",
      "pao_control_provider_verify",
      "pao_control_gate_check",
      "pao_control_gate_strict",
      "pao_control_evidence_get",
    ];
  }
}

let service: AgentCockpitService | null = null;

export function getAgentCockpitService(): AgentCockpitService {
  if (!service) service = new AgentCockpitService();
  return service;
}

/** Test seam: forget the cached singleton. */
export function resetAgentCockpitServiceForTests(): void {
  service = null;
}

export type { AgentProfile, AgentSession, GateRun };
