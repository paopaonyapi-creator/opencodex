// Phase 20.25 — Universal Registry service facade.
//
// One singleton, like every other Agent OS phase service: the routes and the
// CLI call into this; this calls the store, planner, and engine. Approvals are
// fail-closed — nothing runs without a permission decision, and risk >= 3
// always needs a human.

import { getConfigDir } from "../../config";
import { UniversalRegistryStore } from "./registry-store";
import { CircuitBreaker, executeStep, newRunId } from "./engine";
import { createPlan } from "./planner";
import { searchTools } from "./search";
import { registryFlags, type RegistryFlags } from "./flags";
import { sanitizeForAudit } from "./util";
import type {
  ApprovalRecord,
  AuditEventInput,
  IngestedToolInput,
  RegistryToolStatus,
  RunRecord,
  RunStepRecord,
  SearchFilters,
  ToolchainPlan,
  ToolRecord,
} from "./types";
import { syncRegistry, type SyncResult } from "./ingest";

export interface PlanRequest {
  goal: string;
  profile?: ToolchainPlan["profile"];
  dryRun?: boolean;
}

export interface RunInputStep {
  stepId: string;
  input: Record<string, unknown>;
}

export class UniversalRegistryService {
  readonly store: UniversalRegistryStore;
  private breaker = new CircuitBreaker();
  private flags: RegistryFlags;
  private adapters?: import("./types").ToolAdapter[];
  /** runId → approved action keys for in-flight runs (process lifetime). */
  private approvedByRun = new Map<string, Set<string>>();

  constructor(store?: UniversalRegistryStore, adapters?: import("./types").ToolAdapter[]) {
    this.store = store ?? new UniversalRegistryStore();
    this.adapters = adapters;
    this.flags = registryFlags();
  }

  status(): Record<string, unknown> {
    return {
      phase: "20.25",
      flags: this.flags,
      totals: this.store.countByType(),
      health: this.store.countByHealth(),
      totalTools: this.store.listTools().length,
    };
  }

  sync(sources?: string[]): SyncResult {
    const result = syncRegistry(this.store, sources);
    this.store.appendAudit({
      actor: "operator",
      action: "registry_sync",
      status: "ok",
      inputSummary: sanitizeForAudit(JSON.stringify(result.bySource)),
      outputSummary: `ingested ${result.ingested} tools`,
    });
    return result;
  }

  /**
   * MVP health pass: derives health from accumulated execution metrics and
   * stores a health sample per tool. Network probes for remote providers are
   * a documented follow-up (doc §20).
   */
  healthCheck(): { health: Record<string, number>; rechecked: number } {
    const tools = this.store.listTools();
    let rechecked = 0;
    for (const tool of tools) {
      if (tool.status === "disabled") continue;
      const errorRate = tool.metrics.runs >= 3 ? tool.metrics.failures / tool.metrics.runs : null;
      const derived: ToolRecord["health"] = errorRate === null
        ? "unknown"
        : errorRate >= 0.5 ? "offline" : errorRate >= 0.2 ? "degraded" : "healthy";
      if (tool.health !== derived) {
        this.store.setToolHealth(tool.id, derived);
        rechecked += 1;
      }
      this.store.addHealthSample({ toolId: tool.id, status: derived });
    }
    this.store.appendAudit({ actor: "system", action: "health_check", status: "ok", outputSummary: `rechecked ${rechecked} tools` });
    return { health: this.store.countByHealth(), rechecked };
  }

  listTools(filters: SearchFilters = {}): ToolRecord[] {
    const all = this.store.listTools();
    return all.filter((tool) => {
      if (filters.type && tool.type !== filters.type) return false;
      if (filters.provider && !tool.provider.toLowerCase().includes(filters.provider.toLowerCase())) return false;
      if (filters.health && tool.health !== filters.health) return false;
      if (filters.riskMax !== undefined && tool.risk.level > filters.riskMax) return false;
      if (filters.executableOnly && !tool.executable) return false;
      if (filters.sourceKind && tool.source.kind !== filters.sourceKind) return false;
      if (filters.capability && !tool.capabilities.includes(filters.capability)) return false;
      return true;
    });
  }

  getTool(id: string): ToolRecord | null {
    return this.store.getTool(id);
  }

  search(query: string, filters: SearchFilters = {}, limit = 20) {
    return searchTools(this.store, query, filters, { limit });
  }

  setToolEnabled(id: string, enabled: boolean): ToolRecord | null {
    const status: RegistryToolStatus = enabled ? "active" : "disabled";
    if (!this.store.setToolStatus(id, status)) return null;
    this.store.appendAudit({
      actor: "operator",
      action: enabled ? "tool_enabled" : "tool_disabled",
      toolId: id,
      status: "ok",
    });
    return this.store.getTool(id);
  }

  upsertTool(input: IngestedToolInput): ToolRecord {
    return this.store.upsertTool(input);
  }

  // --- Planner -------------------------------------------------------------

  plan(request: PlanRequest): RunRecord {
    if (!this.flags.planner) {
      throw new Error("ENABLE_TOOLCHAIN_PLANNER is disabled");
    }
    const goal = sanitizeForAudit(String(request.goal ?? ""), 400);
    if (!goal) throw new Error("goal is required");
    const { plan } = createPlan(this.store, goal, { profile: request.profile, dryRun: request.dryRun });
    const now = new Date().toISOString();
    const run: RunRecord = {
      id: newRunId(),
      goal,
      profile: plan.profile,
      mode: request.dryRun ? "dry_run" : "execute",
      status: "planned",
      plan,
      riskLevel: plan.riskLevel,
      approvalRequired: plan.approvalRequired,
      estimatedCost: plan.estimatedCost,
      createdAt: now,
      updatedAt: now,
    };
    this.store.saveRun(run);
    plan.steps.forEach((step, index) => {
      this.store.saveStep({
        id: `${run.id}:${step.id}`,
        runId: run.id,
        stepIndex: index,
        capability: step.capability,
        toolId: step.selectedToolId,
        toolName: step.selectedToolName,
        status: "pending",
        inputSummary: "",
      });
    });
    this.store.appendAudit({
      runId: run.id, actor: "planner",
      action: request.dryRun ? "plan_dry_run" : "plan_created",
      status: "ok",
      inputSummary: goal,
      outputSummary: `${plan.steps.length} steps, risk ${plan.riskLevel}, approval ${plan.approvalRequired ? "required" : "not required"}`,
    });
    return run;
  }

  // --- Execution ------------------------------------------------------------

  async executeRun(runId: string, inputs: RunInputStep[] = []): Promise<RunRecord> {
    const run = this.store.getRun(runId);
    if (!run) throw new Error(`run ${runId} not found`);
    if (run.mode === "dry_run") {
      // A dry run never executes; it only reports what WOULD happen.
      return run;
    }
    if (run.status === "completed" || run.status === "cancelled") return run;

    const inputByStep = new Map<string, Record<string, unknown>>();
    for (const item of inputs) inputByStep.set(item.stepId, item.input);

    this.store.saveRun({ ...run, status: "running", updatedAt: new Date().toISOString() });
    const approved = this.approvedByRun.get(runId) ?? new Set<string>();
    this.approvedByRun.set(runId, approved);

    let waitingApproval = false;
    let failed = false;
    for (const step of run.plan.steps) {
      const rowId = `${runId}:${step.id}`;
      const existing = this.store.listSteps(runId).find((s) => s.id === rowId);
      if (existing && (existing.status === "completed" || existing.status === "fallback_used")) continue;

      const outcome = await executeStep(
        { store: this.store, workspaceRoot: getConfigDir(), actor: "universal-registry", adapters: this.adapters },
        this.breaker,
        {
          runId,
          step,
          input: inputByStep.get(step.id) ?? {},
          approvedActionKeys: approved,
        },
      );
      if (outcome.status === "waiting_approval") {
        waitingApproval = true;
        break;
      }
      if (outcome.status === "failed") {
        failed = true;
        break;
      }
      if (outcome.status === "completed" || outcome.status === "fallback_used") {
        // "Approve once" is consumed by the execution that used it.
        approved.delete(`${outcome.step.toolId}::${step.capability}`);
      }
    }

    const steps = this.store.listSteps(runId);
    const now = new Date().toISOString();
    const status: RunRecord["status"] = waitingApproval
      ? "waiting_approval"
      : failed
        ? "failed"
        : "completed";
    const updated: RunRecord = { ...run, status, updatedAt: now, completedAt: status === "completed" ? now : undefined };
    this.store.saveRun(updated);
    void steps;
    return updated;
  }

  // --- Approvals --------------------------------------------------------------

  listApprovals(status?: ApprovalRecord["status"]): ApprovalRecord[] {
    return this.store.listApprovals(status);
  }

  /**
   * Resolve a pending approval. Approving adds the action key for exactly one
   * execution ("once") or for the process session ("session", max 8h). There
   * is deliberately no "approve forever".
   */
  resolveApproval(id: string, decision: "approved" | "rejected", decidedBy = "dashboard-operator"): ApprovalRecord | null {
    const approval = this.store.resolveApproval(id, decision, decidedBy);
    if (!approval) return null;
    this.store.appendAudit({
      runId: approval.runId, stepId: approval.stepId, toolId: approval.toolId,
      actor: decidedBy,
      action: decision === "approved" ? "approval_granted" : "approval_rejected",
      status: decision === "approved" ? "ok" : "denied",
      approvalId: approval.id,
      riskLevel: approval.riskLevel,
    });
    if (decision !== "approved" || !approval.runId) return approval;
    const approved = this.approvedByRun.get(approval.runId) ?? new Set<string>();
    this.approvedByRun.set(approval.runId, approved);
    approved.add(`${approval.toolId}::${this.capabilityForApproval(approval)}`);
    return approval;
  }

  private capabilityForApproval(approval: ApprovalRecord): string {
    // Action strings look like "execute:<capability>".
    const prefix = "execute:";
    return approval.action.startsWith(prefix) ? approval.action.slice(prefix.length) : approval.action;
  }

  // --- Replay ------------------------------------------------------------------

  /**
   * Replay a stored run. Every replay starts a FRESH run with cleared
   * approvals — destructive steps always require new human approval (doc §36,
   * §88). `mode` "latest_tools" re-selects tools from the current registry;
   * "exact" reuses the stored selection.
   */
  async replay(runId: string, mode: "exact" | "latest_tools" | "from_failed" = "exact"): Promise<RunRecord> {
    if (!this.flags.replay) throw new Error("ENABLE_REPLAY is disabled");
    const source = this.store.getRun(runId);
    if (!source) throw new Error(`run ${runId} not found`);

    let plan = source.plan;
    if (mode === "latest_tools") {
      const replanned = createPlan(this.store, source.goal, { profile: source.profile });
      plan = replanned.plan;
    }

    const now = new Date().toISOString();
    const replayRun: RunRecord = {
      id: newRunId(),
      goal: source.goal,
      profile: source.profile,
      mode: "execute",
      status: "planned",
      plan,
      riskLevel: plan.riskLevel,
      approvalRequired: plan.approvalRequired,
      estimatedCost: plan.estimatedCost,
      createdAt: now,
      updatedAt: now,
    };
    this.store.saveRun(replayRun);
    plan.steps.forEach((step, index) => {
      this.store.saveStep({
        id: `${replayRun.id}:${step.id}`,
        runId: replayRun.id,
        stepIndex: index,
        capability: step.capability,
        toolId: step.selectedToolId,
        toolName: step.selectedToolName,
        status: "pending",
        inputSummary: mode === "from_failed" ? "replay from failed step" : "replay",
      });
    });
    this.store.appendAudit({
      runId: replayRun.id, actor: "operator",
      action: "replay_created:" + mode, status: "ok",
      inputSummary: runId,
      outputSummary: "approvals reset; high-risk steps will re-request human approval",
    });
    return this.executeRun(replayRun.id);
  }

  // --- Observability -------------------------------------------------------------

  audit(limit = 100, runId?: string): Array<Record<string, unknown>> {
    return this.store.listAudit(limit, runId);
  }

  listRuns(limit = 50): RunRecord[] {
    return this.store.listRuns(limit);
  }

  getRun(runId: string): { run: RunRecord; steps: RunStepRecord[] } | null {
    const run = this.store.getRun(runId);
    if (!run) return null;
    return { run, steps: this.store.listSteps(runId) };
  }

  stats(): Record<string, unknown> {
    const tools = this.store.listTools();
    const runs = this.store.listRuns(200);
    const byStatus: Record<string, number> = {};
    for (const run of runs) byStatus[run.status] = (byStatus[run.status] ?? 0) + 1;
    return {
      toolsTotal: tools.length,
      toolsExecutable: tools.filter((t) => t.executable).length,
      toolsMetadataOnly: tools.filter((t) => t.status === "metadata_only").length,
      byType: this.store.countByType(),
      byHealth: this.store.countByHealth(),
      runs: byStatus,
      pendingApprovals: this.store.listApprovals("pending").length,
    };
  }

  feedback(toolId: string, useful: boolean, prefer: boolean, userId = "local"): boolean {
    const tool = this.store.getTool(toolId);
    if (!tool) return false;
    const current = this.store.getPreferenceWeight(toolId, userId);
    const next = Math.max(-1, Math.min(1, current + (useful ? 0.5 : -0.5) + (prefer ? 0.5 : 0)));
    this.store.setPreference(toolId, next, useful ? "feedback: useful" : "feedback: not useful", userId);
    this.store.appendAudit({
      toolId, actor: userId, action: "tool_feedback",
      status: "ok",
      outputSummary: `preference weight ${next.toFixed(2)}`,
    });
    return true;
  }
}

let service: UniversalRegistryService | null = null;

export function getUniversalRegistryService(): UniversalRegistryService {
  if (!service) service = new UniversalRegistryService();
  return service;
}

/** Test seam: forget the cached singleton. */
export function resetUniversalRegistryServiceForTests(): void {
  service = null;
}

export type { AuditEventInput };
