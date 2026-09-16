// Phase 20.29 — Workflow runtime: dry-run, governed execution, approval gate,
// retry, pause/resume/cancel/replay (doc §11-§16, §50-§51).
//
// Steps are advisory by default (markdown narrative). A step becomes a real
// governed side effect only when a matching tool step is declared and its
// performer is registered — side effects dispatch through the Phase 20.28
// Governance Gateway, never directly.

import { existsSync } from "node:fs";
import { parseWorkflowMarkdown, scanDangerousPatterns, WorkflowParseError } from "./parser";
import { compileWorkflow } from "./compiler";
import { WorkflowStore } from "./store";
import {
  newWorkflowId,
  type CompiledWorkflow,
  type ParsedWorkflow,
  type RunState,
  type StepState,
  type WorkflowAuditEntry,
  type WorkflowRisk,
  type WorkflowRun,
  type WorkflowStepRun,
} from "./types";

export interface WorkflowFlags {
  engine: boolean;
  scheduler: boolean;
  import: boolean;
  builder: boolean;
  safeMode: boolean;
}

function flag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export function workflowFlags(): WorkflowFlags {
  return {
    engine: flag("WORKFLOW_ENGINE_ENABLED", true),
    scheduler: flag("WORKFLOW_SCHEDULER_ENABLED", true),
    import: flag("WORKFLOW_IMPORT_ENABLED", true),
    builder: flag("WORKFLOW_BUILDER_ENABLED", true),
    safeMode: flag("WORKFLOW_SAFE_MODE", true),
  };
}

export interface WorkflowToolPerformer {
  readonly name: string;
  readonly riskLevel: WorkflowRisk;
  perform(input: Record<string, unknown>): Promise<{ output: unknown }>;
}

export class WorkflowEngine {
  readonly store: WorkflowStore;
  private flags: WorkflowFlags;
  private performers = new Map<string, WorkflowToolPerformer>();

  constructor(store?: WorkflowStore) {
    this.store = store ?? new WorkflowStore();
    this.flags = workflowFlags();
  }

  registerPerformer(performer: WorkflowToolPerformer): void {
    this.performers.set(performer.name, performer);
  }

  // --- Import / register (doc §19: install disabled by default) -------------------

  importWorkflow(raw: string, source: string): { blocked?: string; registered: boolean; workflowId?: string; compiled?: CompiledWorkflow } {
    if (!this.flags.import && source === "imported") {
      throw new Error("[WORKFLOW_IMPORT_DISABLED] workflow import is disabled by flag");
    }
    const dangerous = scanDangerousPatterns(raw);
    if (dangerous) {
      const parsedAttempt = this.tryParse(raw);
      const workflowId = parsedAttempt?.frontMatter.id ?? newWorkflowId("wfblocked");
      this.store.appendAudit({
        id: newWorkflowId("waud"),
        timestamp: new Date().toISOString(),
        workflowId,
        version: parsedAttempt?.frontMatter.version ?? "0",
        eventType: "security.blocked",
        detail: "dangerous pattern: " + dangerous,
      });
      return { blocked: dangerous, registered: false, workflowId };
    }
    const parsed = parseWorkflowMarkdown(raw);
    const compiled = compileWorkflow(parsed);
    // Imported workflows are ALWAYS registered disabled (doc §19, §64).
    const enabled = source === "local" || source === "system";
    this.store.registerWorkflow(parsed, compiled, source, enabled);
    this.store.appendAudit({
      id: newWorkflowId("waud"),
      timestamp: new Date().toISOString(),
      workflowId: parsed.frontMatter.id,
      version: parsed.frontMatter.version,
      eventType: "workflow.registered",
      detail: "source " + source + ", risk " + compiled.riskLevel + ", enabled " + enabled,
    });
    return { registered: true, workflowId: parsed.frontMatter.id, compiled };
  }

  private tryParse(raw: string): ParsedWorkflow | null {
    try {
      return parseWorkflowMarkdown(raw);
    } catch {
      return null;
    }
  }

  listWorkflows(): Array<Record<string, unknown>> {
    return this.store.listWorkflows();
  }

  setEnabled(id: string, enabled: boolean): boolean {
    return this.store.setEnabled(id, enabled);
  }

  // --- Dry run (doc §11) — never side-effects ---------------------------------------

  dryRun(id: string): Record<string, unknown> | null {
    const latest = this.store.getLatestRaw(id);
    if (!latest) return null;
    const compiled = compileWorkflow(latest.raw);
    return {
      workflow: compiled.name,
      id: compiled.workflowId,
      version: compiled.version,
      plannedSteps: compiled.steps.length,
      steps: compiled.steps.map((s) => s.title),
      permissions: compiled.permissions,
      warnings: compiled.warnings,
      riskScore: compiled.riskScore,
      riskLevel: compiled.riskLevel,
      requiresApproval: compiled.requiresApproval,
      checksum: compiled.checksum,
      note: "no external action will be executed",
    };
  }

  // --- Run lifecycle (doc §12) ---------------------------------------------------------

  async startRun(id: string, opts: { dryRun?: boolean; mode?: "normal" | "safe" } = {}): Promise<WorkflowRun | null> {
    if (!this.flags.engine) throw new Error("[WORKFLOW_ENGINE_DISABLED] workflow engine is disabled by flag");
    const meta = this.store.getWorkflowMeta(id);
    if (!meta) return null;
    if (!meta.enabled && !opts.dryRun) {
      throw new Error("[WORKFLOW_DISABLED] workflow " + id + " is disabled; imported workflows must be reviewed and enabled");
    }
    const latest = this.store.getLatestRaw(id)!;
    const compiled = compileWorkflow(latest.raw);

    // Checksum integrity (doc §56): an approved checksum that no longer
    // matches blocks execution until re-approval.
    if (latest.approvedChecksum && latest.approvedChecksum !== compiled.checksum && !opts.dryRun) {
      throw new Error("[WORKFLOW_TAMPERED] workflow checksum changed after approval; re-approval required");
    }

    if (opts.dryRun) {
      const dry = this.dryRun(id)!;
      const run: WorkflowRun = {
        id: newWorkflowId("wfrun"),
        workflowId: id,
        version: compiled.version,
        checksum: compiled.checksum,
        state: "completed",
        dryRun: true,
        mode: opts.mode ?? "normal",
        currentStepIndex: 0,
        retryCount: 0,
        riskLevel: compiled.riskLevel,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.store.createRun(run);
      this.audit(run.id, id, compiled.version, "run.completed", "dry run (no side effects)");
      return { ...run, state: "completed" };
    }

    const mode: "normal" | "safe" = opts.mode ?? (this.flags.safeMode ? "safe" : "normal");
    const now = new Date().toISOString();
    const run: WorkflowRun = {
      id: newWorkflowId("wfrun"),
      workflowId: id,
      version: compiled.version,
      checksum: compiled.checksum,
      state: compiled.requiresApproval ? "awaiting_approval" : "running",
      dryRun: false,
      mode,
      currentStepIndex: 0,
      retryCount: 0,
      riskLevel: compiled.riskLevel,
      createdAt: now,
      updatedAt: now,
    };
    this.store.createRun(run);
    this.audit(run.id, id, compiled.version, "run.started", "risk " + compiled.riskLevel + " mode " + mode);

    for (const step of compiled.steps) {
      this.store.saveStepRun({
        id: newWorkflowId("wfstep"),
        runId: run.id,
        stepIndex: step.index,
        title: step.title,
        state: "pending" as StepState,
        retryCount: 0,
      });
    }

    if (run.state === "awaiting_approval") {
      this.audit(run.id, id, compiled.version, "approval.requested", "risk " + compiled.riskLevel);
      return this.store.getRun(run.id)!;
    }
    return this.advanceRun(run.id, compiled);
  }

  /** Human approval resumes an awaiting_approval run (doc §10). */
  async approveRun(runId: string, approvedBy: string): Promise<WorkflowRun | null> {
    const run = this.store.getRun(runId);
    if (!run || run.state !== "awaiting_approval") return null;
    this.store.updateRunState(runId, "running");
    this.audit(runId, run.workflowId, run.version, "approval.approved", "approved by " + approvedBy);
    const latest = this.store.getLatestRaw(run.workflowId)!;
    return this.advanceRun(runId, compileWorkflow(latest.raw));
  }

  denyRun(runId: string, deniedBy: string): WorkflowRun | null {
    const run = this.store.getRun(runId);
    if (!run) return null;
    this.store.updateRunState(runId, "cancelled", { error: "denied by " + deniedBy });
    this.audit(runId, run.workflowId, run.version, "approval.denied", "denied by " + deniedBy);
    return this.store.getRun(runId);
  }

  cancelRun(runId: string, actor: string): WorkflowRun | null {
    const run = this.store.getRun(runId);
    if (!run) return null;
    if (run.state === "completed" || run.state === "cancelled") return run;
    // A cancelled run is never reported as success.
    this.store.updateRunState(runId, "cancelled", { error: "cancelled by " + actor });
    this.audit(runId, run.workflowId, run.version, "run.cancelled", "cancelled by " + actor);
    return this.store.getRun(runId);
  }

  private async advanceRun(runId: string, compiled: CompiledWorkflow): Promise<WorkflowRun | null> {
    const run = this.store.getRun(runId)!;
    const steps = this.store.listStepRuns(runId);
    const mode = run.mode;

    for (const step of steps) {
      if (step.state === "completed" || step.state === "skipped") continue;
      const startedAt = new Date().toISOString();
      this.store.saveStepRun({ ...step, state: "running", startedAt });
      this.audit(runId, run.workflowId, compiled.version, "step.started", "step " + step.stepIndex + ": " + step.title);

      // Safe mode denies shell/external side effects entirely.
      const shellRequested = /shell|command|script/i.test(step.title);
      const externalRequested = /publish|upload|deploy|submit|purchase|send email/i.test(step.title);
      const deleteRequested = /\bdelete\b|\brm\b/i.test(step.title);
      let state: StepState = "completed";
      let outputSummary = "advisory step (markdown narrative); no side effect";
      let errorCode: string | undefined;

      if (mode === "safe" && (shellRequested || externalRequested || deleteRequested)) {
        state = "skipped";
        outputSummary = "skipped by safe mode";
        this.audit(runId, run.workflowId, compiled.version, "security.blocked", "step " + step.stepIndex + " skipped by safe mode");
      } else if (shellRequested || externalRequested || deleteRequested) {
        // Real side-effect steps must be dispatched through the Governance
        // Gateway; until a governed performer is wired for this step's tool,
        // the run fails honestly instead of faking success (doc §17, §64).
        state = "failed";
        errorCode = "GOVERNANCE_PROVIDER_DISABLED";
        outputSummary = "no governed performer wired for this side-effect step";
      }

      const completedAt = new Date().toISOString();
      this.store.saveStepRun({ ...step, state, outputSummary, error: errorCode, startedAt, completedAt });
      this.audit(runId, run.workflowId, compiled.version, state === "failed" ? "step.failed" : "step.completed", "step " + step.stepIndex + " " + state);

      if (state === "failed") {
        // Bounded retry (doc §14): retry once for transient-style failures.
        const retryConfig = 1;
        if (step.retryCount < retryConfig) {
          this.store.updateRunState(runId, "retrying", { currentStepIndex: step.stepIndex });
          this.store.saveStepRun({ ...step, state: "pending", retryCount: step.retryCount + 1 });
          this.audit(runId, run.workflowId, compiled.version, "run.retrying", "step " + step.stepIndex + " retry " + (step.retryCount + 1));
          // MVP: immediate retry without backoff timers.
          return this.advanceRun(runId, compiled);
        }
        this.store.updateRunState(runId, "failed", { error: errorCode });
        this.audit(runId, run.workflowId, compiled.version, "run.failed", "step " + step.stepIndex + " failed");
        return this.store.getRun(runId);
      }
      this.store.updateRunState(runId, "running", { currentStepIndex: step.stepIndex });
    }

    const now = new Date().toISOString();
    this.store.updateRunState(runId, "completed");
    this.audit(runId, run.workflowId, compiled.version, "run.completed", "all steps processed");
    return this.store.getRun(runId);
  }

  /** Replay from step 1 as a fresh run (high-risk steps re-approve, doc §16). */
  async replayRun(runId: string, actor: string): Promise<WorkflowRun | null> {
    const run = this.store.getRun(runId);
    if (!run || run.dryRun) return null;
    this.audit(runId, run.workflowId, run.version, "run.replay_requested", "by " + actor);
    const latest = this.store.getLatestRaw(run.workflowId);
    if (!latest) return null;
    const compiled = compileWorkflow(latest.raw);
    const now = new Date().toISOString();
    const replay: WorkflowRun = {
      id: newWorkflowId("wfrun"),
      workflowId: run.workflowId,
      version: compiled.version,
      checksum: compiled.checksum,
      state: compiled.requiresApproval ? "awaiting_approval" : "running",
      dryRun: false,
      mode: run.mode,
      currentStepIndex: 0,
      retryCount: 0,
      riskLevel: compiled.riskLevel,
      createdAt: now,
      updatedAt: now,
    };
    this.store.createRun(replay);
    for (const step of compiled.steps) {
      this.store.saveStepRun({
        id: newWorkflowId("wfstep"),
        runId: replay.id,
        stepIndex: step.index,
        title: step.title,
        state: "pending",
        retryCount: 0,
      });
    }
    if (replay.state === "awaiting_approval") {
      this.audit(replay.id, run.workflowId, compiled.version, "approval.requested", "replay requires fresh approval");
      return this.store.getRun(replay.id)!;
    }
    return this.advanceRun(replay.id, compiled);
  }

  // --- Scheduler tick (doc §21-§23) -------------------------------------------------------

  async schedulerTick(): Promise<Array<{ workflowId: string; runId?: string; skipped?: string }>> {
    if (!this.flags.scheduler) return [];
    const due = this.store.dueScheduledWorkflows(Date.now());
    const results: Array<{ workflowId: string; runId?: string; skipped?: string }> = [];
    for (const item of due) {
      // Concurrency mode single (default): skip when an active run exists.
      if (this.store.hasActiveRun(item.workflowId)) {
        results.push({ workflowId: item.workflowId, skipped: "active run exists (concurrency=single)" });
        continue;
      }
      this.store.markScheduledRun(item.workflowId);
      const run = await this.startRun(item.workflowId, {});
      results.push({ workflowId: item.workflowId, runId: run?.id });
    }
    return results;
  }

  private audit(runId: string, workflowId: string, version: string, eventType: string, detail: string): void {
    this.store.appendAudit({
      id: newWorkflowId("waud"),
      timestamp: new Date().toISOString(),
      workflowId,
      version,
      runId,
      eventType,
      detail,
    });
  }
}
