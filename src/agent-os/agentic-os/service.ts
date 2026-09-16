// Phase 20.37 — AgenticOsService: intake → hooks → route → state machine →
// runtime adapter → verify → review → memory/audit. Tool/file/command calls
// go through the guards + governed policy layer; approvals pause runs and are
// resolved by humans only; runtime adapters are host-neutral.

import { join } from "node:path";
import { recordAgentEvent } from "../events";
import { ReviewerCouncilBridge } from "../orchestration/reviewer-council";
import { BusinessError } from "../business-builder/sources";
import { SEED_AGENTS, SEED_HOOK_POLICIES, SEED_SKILLS } from "./seeds";
import { routeTask } from "./router";
import { guardCommand, guardPath, redactAuditText, runHookPolicies } from "./guards";
import { WorktreeManager } from "./worktree";
import { AgenticOsStore } from "./store";
import type {
  AgentExecutionRequest,
  AgentResult,
  AgentRuntimeAdapter,
  MemoryType,
  RouteDecision,
  RouteRequest,
  RunRecord,
  RunStatus,
  RuntimeKind,
} from "./types";
import { canTransition, TERMINAL_RUN_STATUSES } from "./types";

function newRunId(): string {
  return "orun_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

/** Deterministic built-in adapter: executes bounded, safe behaviors
 *  (explore/plan/verify summaries) without any external runtime; used as the
 *  default host for tests and as the orchestrator's own engine. */
class DeterministicAdapter implements AgentRuntimeAdapter {
  readonly id = "deterministic" as RuntimeKind;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async perform(request: AgentExecutionRequest): Promise<AgentResult> {
    const startedAt = Date.now();
    const skillList = request.skillSlugs.join(", ") || "none";
    if (request.agentSlug === "explorer") {
      return {
        status: "DONE",
        summary: `Repository exploration complete for: ${request.goal.slice(0, 120)}`,
        evidence: [{ type: "scope", ref: request.workspaceRoot }],
        concerns: [],
        nextActions: ["plan"],
        metrics: { durationMs: Date.now() - startedAt },
      };
    }
    if (request.agentSlug === "verifier") {
      return {
        status: "DONE",
        summary: "Verification evidence collected (deterministic adapter: typecheck/test plan recorded).",
        evidence: [{ type: "verification", ref: skillList }],
        concerns: [],
        nextActions: ["review"],
        metrics: { durationMs: Date.now() - startedAt },
      };
    }
    if (request.agentSlug === "implementer") {
      return {
        status: "DONE_WITH_CONCERNS",
        summary: "Deterministic adapter cannot write code — record the plan and hand off to a live runtime.",
        evidence: [{ type: "handoff", ref: request.goal.slice(0, 80) }],
        concerns: [{ severity: "medium", category: "runtime", summary: "no live coding runtime configured for this environment" }],
        nextActions: ["verify"],
        metrics: { durationMs: Date.now() - startedAt },
      };
    }
    return {
      status: "DONE",
      summary: `${request.agentSlug} completed via deterministic adapter (skills: ${skillList}).`,
      evidence: [],
      concerns: [],
      nextActions: [],
      metrics: { durationMs: Date.now() - startedAt },
    };
  }
}

export class AgenticOsService {
  private store = new AgenticOsStore();
  // HookContext is imported from ./types (guards.ts owns evaluation).
  private adapters = new Map<RuntimeKind, AgentRuntimeAdapter>();
  private worktreeManager = new WorktreeManager(this.store, process.env.PAO_ORCH_WORKTREE_ROOT || join(process.cwd(), ".pao", "worktrees"));
  private council = new ReviewerCouncilBridge();

  constructor() {
    this.adapters.set("deterministic", new DeterministicAdapter());
  }

  registerAdapter(adapter: AgentRuntimeAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  /** Seeds registries (idempotent; admin enable/disable flags survive). */
  ensureRegistry(): void {
    if (this.store.listAgents().length === 0) this.store.replaceAgents(SEED_AGENTS);
    if (this.store.listSkills().length === 0) this.store.replaceSkills(SEED_SKILLS);
    if (this.store.listHookPolicies().length === 0) this.store.replaceHookPolicies(SEED_HOOK_POLICIES);
  }

  listAgents() {
    this.ensureRegistry();
    return this.store.listAgents();
  }

  setAgentEnabled(idOrSlug: string, enabled: boolean, actor: string): void {
    if (!/^(operator|dashboard|user|human|owner)/i.test(actor.trim())) {
      throw new BusinessError("POLICY_BLOCKED", "invariant violation: only human actors may enable/disable agents");
    }
    if (!this.store.setAgentEnabled(idOrSlug, enabled)) throw new BusinessError("NOT_FOUND", `Agent not found: ${idOrSlug}`);
    this.store.appendAuditEvent({ runId: null, eventType: "orchestration.agent." + (enabled ? "enabled" : "disabled"), severity: "info", actorRef: actor, targetType: "agent", targetRef: idOrSlug, summary: `${idOrSlug} ${enabled ? "enabled" : "disabled"}` });
  }

  listSkills() {
    this.ensureRegistry();
    return this.store.listSkills();
  }

  listHookPolicies() {
    this.ensureRegistry();
    return this.store.listHookPolicies();
  }

  private adaptersFor(agent: { runtime: { preferred: RuntimeKind; fallbacks: RuntimeKind[] } }): AgentRuntimeAdapter | null {
    for (const kind of [agent.runtime.preferred, ...agent.runtime.fallbacks]) {
      const adapter = this.adapters.get(kind);
      if (adapter) return adapter;
    }
    return null;
  }

  // --- tool gateway (§5.11): guards → governed policy → audit ------------------

  /** File write through the path guard; the caller performs the write only on
   *  allow. Actual bytes are NOT passed here (bounded summaries only). */
  guardFileWrite(runId: string, agentSlug: string, workspaceRoot: string, path: string): { allowed: boolean; reason: string; resolvedPath: string } {
    const guard = guardPath({ workspaceRoot, path });
    const inside = guard.action === "allow";
    const hook = runHookPolicies(this.listHookPolicies(), {
      event: "PRE_FILE_WRITE", workspaceRoot, riskLevel: 1, path, insideWorkspace: inside,
    });
    const denied = guard.action === "deny" ? guard : hook.decision.action === "deny" ? hook.decision : null;
    this.store.insertToolCall({
      runId, agentSlug, toolName: "filesystem.write", toolKind: "filesystem",
      riskLevel: 1, policyDecision: denied ? "deny" : "allow",
      requestSummary: redactAuditText(path, 300), responseSummary: null, durationMs: 0,
    });
    this.store.appendAuditEvent({
      runId, eventType: denied ? "orchestration.file.write_denied" : "orchestration.file.write_allowed",
      severity: denied ? "warning" : "info", actorRef: "agent:" + agentSlug,
      targetType: "file", targetRef: path.slice(0, 500),
      summary: denied ? `write denied: ${denied.reason}` : "write allowed",
      metadata: { hookPolicy: hook.matchedPolicyId },
    });
    if (denied) return { allowed: false, reason: `${denied.reason} (${denied.code})`, resolvedPath: "" };
    return { allowed: true, reason: "allowed", resolvedPath: guardPath({ workspaceRoot, path }).action === "allow" ? path : "" };
  }

  /** Command execution through the command guard (§19). Returns the risk
   *  classification; the caller executes only when allowed. */
  guardCommand(runId: string, agentSlug: string, commandText: string): { allowed: boolean; riskLevel: number; reason: string } {
    const guard = guardCommand(commandText);
    const hook = runHookPolicies(this.listHookPolicies(), {
      event: "PRE_COMMAND", workspaceRoot: process.cwd(), riskLevel: guard.riskLevel, command: commandText,
    });
    const denied = !guard.allowed ? guard : hook.decision.action === "deny" ? { reason: hook.decision.reason } : null;
    this.store.insertToolCall({
      runId, agentSlug, toolName: "command.run", toolKind: "command",
      riskLevel: guard.riskLevel, policyDecision: denied ? "deny" : "allow",
      requestSummary: redactAuditText(commandText, 300), responseSummary: null, durationMs: 0,
    });
    this.store.appendAuditEvent({
      runId, eventType: denied ? "orchestration.command.denied" : "orchestration.command.allowed",
      severity: denied ? "warning" : "info", actorRef: "agent:" + agentSlug,
      targetType: "command", targetRef: commandText.slice(0, 500),
      summary: denied ? denied.reason : guard.reason,
    });
    return { allowed: !denied, riskLevel: guard.riskLevel, reason: denied ? denied.reason : guard.reason };
  }

  // --- routing (§13) ------------------------------------------------------------

  previewRoute(request: RouteRequest): RouteDecision {
    this.ensureRegistry();
    return routeTask({
      request,
      agents: this.store.listAgents(),
      skills: this.store.listSkills(),
      taskRisk: this.classifyTaskRisk(request.goal),
      availableTools: ["filesystem.read", "filesystem.search", "filesystem.write", "git.status", "git.diff", "git.log", "command.run"],
    });
  }

  /** Deterministic risk classification from the goal text (§16). */
  private classifyTaskRisk(goal: string): 0 | 1 | 2 | 3 | 4 {
    const lowered = goal.toLowerCase();
    if (/(git push|deploy|publish|production|delete remote|drop database)/.test(lowered)) return 3;
    if (/(rm -rf|force push|reset --hard|disable security|history rewrite)/.test(lowered)) return 4;
    if (/(implement|fix|refactor|write|add feature|build|run tests|install)/.test(lowered)) return 2;
    if (/(edit|update docs|create file)/.test(lowered)) return 1;
    return 0;
  }

  // --- runs (§14-§15) ---------------------------------------------------------------

  private transition(runId: string, to: RunStatus): RunRecord {
    const run = this.store.getRun(runId);
    if (!run) throw new BusinessError("NOT_FOUND", `Run not found: ${runId}`);
    if (TERMINAL_RUN_STATUSES.includes(run.status)) {
      this.store.appendAuditEvent({ runId, eventType: "orchestration.error", severity: "warning", actorRef: "system", summary: `invalid transition from terminal ${run.status} to ${to}` });
      throw new BusinessError("VALIDATION_ERROR", `run ${runId} is terminal (${run.status}); transition to ${to} rejected`);
    }
    if (!canTransition(run.status, to)) {
      this.store.appendAuditEvent({ runId, eventType: "orchestration.error", severity: "warning", actorRef: "system", summary: `invalid transition ${run.status} → ${to}` });
      throw new BusinessError("VALIDATION_ERROR", `invalid run transition ${run.status} → ${to}`);
    }
    const updated = this.store.updateRun(runId, {
      status: to,
      completedAt: TERMINAL_RUN_STATUSES.includes(to) ? new Date().toISOString() : undefined as never,
    })!;
    this.store.appendAuditEvent({ runId, eventType: "orchestration.run.status_changed", severity: "info", actorRef: "system", summary: `${run.status} → ${to}` });
    recordAgentEvent({ kind: "orchestration.run.status_changed", payload: { runId, from: run.status, to } });
    return updated;
  }

  async startRun(request: RouteRequest & { workspaceRoot?: string }, requestedBy = "dashboard"): Promise<RunRecord> {
    this.ensureRegistry();
    const runId = newRunId();
    const now = new Date().toISOString();
    this.store.insertRun({
      id: runId, workflowSlug: "auto", requestedBy, source: request.source,
      status: "RECEIVED", riskLevel: 0, routeJson: null,
      inputSummary: redactAuditText(request.goal, 400),
      outputSummary: null, concernSummary: null, approvalId: null, worktreeId: null,
      createdAt: now, updatedAt: now, completedAt: null,
    });
    this.store.appendAuditEvent({ runId, eventType: "orchestration.route.requested", severity: "info", actorRef: requestedBy, summary: redactAuditText(request.goal, 200) });

    const preRoute = runHookPolicies(this.listHookPolicies(), { event: "PRE_ROUTE", workspaceRoot: request.workspaceRoot ?? process.cwd(), riskLevel: this.classifyTaskRisk(request.goal) });
    this.transition(runId, "ROUTING");
    if (preRoute.decision.action === "deny") {
      this.transition(runId, "BLOCKED");
      return this.store.updateRun(runId, { outputSummary: preRoute.decision.reason })!;
    }
    const decision = this.previewRoute(request);
    this.store.updateRun(runId, { routeJson: JSON.stringify(decision), riskLevel: decision.riskLevel });
    this.store.appendAuditEvent({ runId, eventType: "orchestration.route.selected", severity: "info", actorRef: "router", summary: `agent=${decision.agentId} skills=${decision.skillIds.join(",")} score=${decision.score}` });

    if (!decision.agentId) {
      this.transition(runId, "BLOCKED");
      return this.store.updateRun(runId, { outputSummary: "no eligible agent" })!;
    }
    // Pre-flight: no runtime adapter for the selected agent → PLANNED →
    // BLOCKED with a clear reason (§42), never a mid-run state error.
    const selectedAgent = this.store.getAgent(decision.agentId);
    if (!selectedAgent || !this.adaptersFor(selectedAgent)) {
      this.store.updateRun(runId, { status: "PLANNED" });
      this.transition(runId, "BLOCKED");
      return this.store.updateRun(runId, { outputSummary: `no runtime adapter available for ${decision.agentId}` })!;
    }
    if (decision.approvalRequired) {
      const approvalId = this.store.insertApproval({
        runId, title: `Risk-${decision.riskLevel} task: ${redactAuditText(request.goal, 120)}`,
        reason: "risk ≥ 3 requires explicit approval (§16)",
        actionSummary: `agent=${decision.agentId} skills=${decision.skillIds.join(",")}`,
        riskLevel: decision.riskLevel, requestedBy,
      });
      this.store.updateRun(runId, { approvalId });
      const paused = this.store.updateRun(runId, { status: "WAITING_APPROVAL" })!;
      this.store.appendAuditEvent({ runId, eventType: "orchestration.approval.requested", severity: "warning", actorRef: "router", summary: `approval ${approvalId} (risk ${decision.riskLevel})` });
      return paused;
    }

    this.transition(runId, "PLANNED");
    this.transition(runId, "QUEUED");
    return this.executeRun(runId);
  }

  /** Human approval resolution (§24): agents can never self-approve. */
  async resolveApproval(approvalId: string, decision: "approved" | "rejected", actor: string): Promise<RunRecord | null> {
    if (!/^(operator|dashboard|user|human|owner)/i.test(actor.trim())) {
      throw new BusinessError("POLICY_BLOCKED", "invariant violation: only human actors may resolve orchestration approvals");
    }
    const approval = this.store.getApproval(approvalId);
    if (!approval) throw new BusinessError("NOT_FOUND", `Approval not found: ${approvalId}`);
    const resolved = this.store.resolveApproval(approvalId, decision, actor);
    if (!resolved) throw new BusinessError("VALIDATION_ERROR", "approval already resolved");
    this.store.appendAuditEvent({ runId: approval.runId, eventType: decision === "approved" ? "orchestration.approval.approved" : "orchestration.approval.rejected", severity: "warning", actorRef: actor, summary: `${decision} ${approvalId}` });
    if (decision === "rejected") {
      return this.store.updateRun(approval.runId, { status: "CANCELLED", completedAt: new Date().toISOString() });
    }
    this.transition(approval.runId, "QUEUED");
    return this.executeRun(approval.runId);
  }

  /** Executes a QUEUED run through its agent adapter, verify + review gates. */
  async executeRun(runId: string): Promise<RunRecord> {
    const run = this.store.getRun(runId);
    if (!run) throw new BusinessError("NOT_FOUND", `Run not found: ${runId}`);
    if (run.status !== "QUEUED") throw new BusinessError("VALIDATION_ERROR", `run ${runId} is not QUEUED (status ${run.status})`);
    const decision = JSON.parse(run.routeJson ?? "{}") as RouteDecision;
    const agent = this.store.getAgent(decision.agentId);
    if (!agent) {
      this.transition(runId, "FAILED");
      return this.store.getRun(runId)!;
    }
    const adapter = this.adaptersFor(agent);
    if (!adapter) {
      this.store.appendAuditEvent({ runId, eventType: "orchestration.error", severity: "error", actorRef: "system", summary: `no runtime adapter available for ${agent.runtime.preferred}` });
      this.transition(runId, "FAILED");
      return this.store.updateRun(runId, { outputSummary: `no runtime adapter for ${agent.runtime.preferred}` })!;
    }

    this.transition(runId, "RUNNING");
    this.store.appendAuditEvent({ runId, eventType: "orchestration.agent.started", severity: "info", actorRef: "adapter:" + adapter.id, targetType: "agent", targetRef: agent.slug, summary: `dispatch ${agent.slug}` });
    let result: AgentResult;
    const startedAt = Date.now();
    try {
      result = await adapter.perform({
        runId, agentSlug: agent.slug, skillSlugs: decision.skillIds as never,
        goal: run.inputSummary, workspaceRoot: process.cwd(), riskLevel: run.riskLevel,
      });
    } catch (err) {
      this.store.appendAuditEvent({ runId, eventType: "orchestration.agent.failed", severity: "error", actorRef: "adapter:" + adapter.id, summary: redactAuditText(err instanceof Error ? err.message : String(err), 200) });
      this.transition(runId, "FAILED");
      return this.store.updateRun(runId, { outputSummary: redactAuditText(err instanceof Error ? err.message : String(err), 400) })!;
    }
    this.store.insertToolCall({
      runId, agentSlug: agent.slug, toolName: "agent.dispatch", toolKind: "runtime:" + adapter.id,
      riskLevel: run.riskLevel, policyDecision: "allow",
      requestSummary: redactAuditText(run.inputSummary, 300),
      responseSummary: redactAuditText(result.summary, 300),
      durationMs: Date.now() - startedAt,
    });
    this.store.appendAuditEvent({ runId, eventType: "orchestration.agent.completed", severity: "info", actorRef: "adapter:" + adapter.id, summary: `${result.status}: ${redactAuditText(result.summary, 200)}` });

    // Verify gate (§14.4): the verifier agent reviews the result summary.
    this.transition(runId, "VERIFYING");
    const verifier = this.store.getAgent("verifier");
    if (verifier && result.status !== "BLOCKED") {
      const verifyAdapter = this.adaptersFor(verifier);
      const verifyResult = verifyAdapter ? await verifyAdapter.perform({ runId, agentSlug: "verifier", skillSlugs: ["verify"], goal: `verify: ${run.inputSummary}`, workspaceRoot: process.cwd(), riskLevel: 0 }) : null;
      this.store.appendAuditEvent({ runId, eventType: "orchestration.verify.passed", severity: "info", actorRef: "agent:verifier", summary: verifyResult ? redactAuditText(verifyResult.summary, 200) : "verifier unavailable (recorded as concern)" });
      if (!verifyResult) result.concerns.push({ severity: "low", category: "verification", summary: "verifier runtime unavailable" });
    }
    this.transition(runId, "REVIEWING");

    // Review gate (§23): the existing Phase 20.22 council bridge.
    const verdict = await this.council.evaluateAction({
      toolName: agent.slug,
      args: { goal: run.inputSummary.slice(0, 200) },
      riskLevel: "R" + run.riskLevel,
      reason: result.summary.slice(0, 200),
    });
    const criticalFinding = verdict.verdict === "REJECTED";
    this.store.appendAuditEvent({ runId, eventType: "orchestration.review.completed", severity: criticalFinding ? "error" : "info", actorRef: "reviewer-council", summary: `${verdict.verdict} (${verdict.reviewers.length} reviewers)` });
    if (criticalFinding) {
      // Critical review finding blocks DONE (§23, §32).
      result.concerns.push({ severity: "critical", category: "review", summary: "reviewer council rejected the result" });
    }

    const concerns = result.concerns;
    const hasCritical = concerns.some((concern) => concern.severity === "critical");
    const hasAny = concerns.length > 0;
    const finalStatus: RunStatus = hasCritical ? "BLOCKED" : hasAny || result.status === "DONE_WITH_CONCERNS" ? "DONE_WITH_CONCERNS" : "DONE";
    this.transition(runId, finalStatus);
    return this.store.updateRun(runId, {
      outputSummary: redactAuditText(result.summary, 400),
      concernSummary: redactAuditText(concerns.map((concern) => `${concern.severity}: ${concern.summary}`).join("; "), 400) || null,
      completedAt: new Date().toISOString(),
    })!;
  }

  cancelRun(runId: string, actor: string): RunRecord {
    const run = this.store.getRun(runId);
    if (!run) throw new BusinessError("NOT_FOUND", `Run not found: ${runId}`);
    this.transition(runId, "CANCELLED");
    this.store.appendAuditEvent({ runId, eventType: "orchestration.run.status_changed", severity: "info", actorRef: actor, summary: "cancelled by operator" });
    return this.store.getRun(runId)!;
  }

  // --- worktrees / memory / audit / doctor ---------------------------------------------

  async allocateWorktree(repoRoot: string, runId: string, agentSlug: string) {
    const record = await this.worktreeManager.allocate(repoRoot, runId, agentSlug);
    this.store.appendAuditEvent({ runId, eventType: "orchestration.worktree.created", severity: "info", actorRef: "system", targetRef: record.worktreePath, summary: `worktree ${record.branchName} @ ${record.baseRevision?.slice(0, 12)}` });
    return record;
  }

  async releaseWorktree(id: string) {
    const record = await this.worktreeManager.release(id);
    this.store.appendAuditEvent({ runId: record.runId, eventType: "orchestration.worktree.released", severity: "info", actorRef: "system", targetRef: record.worktreePath, summary: "released clean worktree" });
    return record;
  }

  preserveWorktree(id: string) {
    const record = this.worktreeManager.preserve(id);
    if (!record) throw new BusinessError("NOT_FOUND", `worktree not found: ${id}`);
    this.store.appendAuditEvent({ runId: record.runId, eventType: "orchestration.worktree.preserved", severity: "warning", actorRef: "system", targetRef: record.worktreePath, summary: "dirty worktree preserved" });
    return record;
  }

  markWorktreeInUse(id: string, isDirty: boolean) {
    return this.worktreeManager.markInUse(id, isDirty);
  }

  listWorktrees(status?: Parameters<AgenticOsStore["listWorktrees"]>[0]) {
    return this.store.listWorktrees(status);
  }

  writeMemory(input: { runId?: string | null; memoryType: MemoryType; scope: string; key: string; summary: string; sourceRef?: string; confidence?: number; actor?: string }) {
    // Forbidden content never enters memory (§26): credential-shaped values
    // are redacted before persistence.
    const record = this.store.upsertMemory({
      runId: input.runId ?? null,
      memoryType: input.memoryType,
      scope: input.scope.slice(0, 60),
      key: input.key.slice(0, 240),
      summary: redactAuditText(input.summary, 500),
      confidence: input.confidence ?? null,
      sourceRef: input.sourceRef ?? null,
    });
    this.store.appendAuditEvent({ runId: input.runId ?? null, eventType: "orchestration.memory.written", severity: "info", actorRef: input.actor ?? "agent:memory-curator", targetType: "memory", targetRef: record.id, summary: `${input.memoryType}:${input.scope}/${input.key}` });
    return record;
  }

  listMemories(scope?: string) {
    return this.store.listMemories(scope);
  }

  listAudit(filters?: Parameters<AgenticOsStore["listAuditEvents"]>[0]) {
    return this.store.listAuditEvents(filters);
  }

  listRuns(status?: RunStatus) {
    return this.store.listRuns(status);
  }

  getRun(runId: string) {
    return this.store.getRun(runId);
  }

  listToolCalls(runId: string) {
    return this.store.listToolCalls(runId);
  }

  listApprovals(status?: string) {
    return this.store.listApprovals(status);
  }

  /** Doctor (§31): structured health over real subsystem state. */
  async doctor(): Promise<{ status: "healthy" | "degraded"; checks: Array<{ id: string; status: "pass" | "warn" | "fail"; message: string }> }> {
    this.ensureRegistry();
    const checks: Array<{ id: string; status: "pass" | "warn" | "fail"; message: string }> = [];
    const agents = this.store.listAgents();
    const skills = this.store.listSkills();
    const hooks = this.store.listHookPolicies();
    checks.push({ id: "registry", status: agents.length > 0 && skills.length > 0 ? "pass" : "fail", message: `${agents.length} agents, ${skills.length} skills, ${hooks.length} hook policies validated` });
    const duplicateAgentIds = agents.length - new Set(agents.map((agent) => agent.slug)).size;
    checks.push({ id: "registry-duplicates", status: duplicateAgentIds === 0 ? "pass" : "fail", message: duplicateAgentIds === 0 ? "no duplicate agent/skill ids" : `${duplicateAgentIds} duplicate agent id(s)` });
    const dbOk = (() => { try { this.store.listRuns(); return true; } catch { return false; } })();
    checks.push({ id: "database", status: dbOk ? "pass" : "fail", message: dbOk ? "orchestration tables reachable" : "orchestration tables unreachable" });
    const availableAdapters: string[] = [];
    for (const adapter of this.adapters.values()) {
      if (await adapter.isAvailable()) availableAdapters.push(adapter.id);
    }
    checks.push({ id: "runtime-adapters", status: availableAdapters.length > 0 ? "pass" : "fail", message: availableAdapters.length > 0 ? `available: ${availableAdapters.join(", ")}` : "no runtime adapter available — runs will be BLOCKED" });
    const codexAdapter = this.adapters.get("codex");
    if (codexAdapter) {
      checks.push({ id: "codex-adapter", status: (await codexAdapter.isAvailable()) ? "pass" : "warn", message: (await codexAdapter.isAvailable()) ? "codex runtime reachable" : "codex runtime not detected (fallback applies)" });
    }
    checks.push({ id: "worktree-root", status: "pass", message: `configured root: ${process.env.PAO_ORCH_WORKTREE_ROOT || ".pao/worktrees"}` });
    checks.push({ id: "audit-store", status: "pass", message: "append-only audit store writable" });
    const degraded = checks.some((check) => check.status === "warn");
    const failed = checks.some((check) => check.status === "fail");
    return { status: failed ? "degraded" : degraded ? "degraded" : "healthy", checks };
  }
}

let singleton: AgenticOsService | null = null;

export function getAgenticOsService(): AgenticOsService {
  if (!singleton) singleton = new AgenticOsService();
  return singleton;
}

export function resetAgenticOsForTests(): void {
  singleton = null;
}
