// Phase 20.2 — Spec-Driven AI SDLC Master Orchestrator
//
// Central coordination layer governing the lifecycle from Idea to Convergence.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import { loadSdlcConfig } from "./config";
import { SdlcStateMachine } from "./state-machine";
import { ConstitutionManager } from "./constitution";
import { SpecifyEngine, type SpecifyResult } from "./specify";
import { ClarifyEngine, type ClarifyResult } from "./clarify";
import { PlanEngine, type PlanResult } from "./plan";
import { TasksEngine, type TasksResult } from "./tasks";
import { AnalyzeEngine } from "./analyze";
import { ChecklistEngine, type ChecklistResult } from "./checklist";
import { SafeImplementationRunner } from "./runner";
import { DeterministicVerifier, type VerificationRunResult } from "./verifier";
import { SoftwareReviewerCouncil, type ReviewCouncilResult } from "./reviewers";
import { ApprovalEngine } from "./approvals";
import { ConvergenceEngine, type ConvergenceResult } from "./converge";
import { RecoveryEngine } from "./recovery";
import type {
  SdlcCycle,
  SdlcConfig,
  SdlcRequirement,
  SdlcAcceptanceCriteria,
  SdlcTask,
  CoverageMatrix,
  RiskLevel,
  AutoRunMode,
  CycleState,
} from "./types";

export interface CreateCycleInput {
  title?: string;
  sourceIdea?: string;
  rawIdea?: string;
  projectId?: string | null;
  priority?: number;
  riskLevel?: RiskLevel;
  autoRunMode?: AutoRunMode;
  targetModule?: string;
  constraints?: string[];
  createdBy?: string;
}

export class SdlcOrchestrator {
  readonly config: SdlcConfig;

  constructor(config?: SdlcConfig) {
    this.config = config ?? loadSdlcConfig();
  }

  /**
   * Initializes a new SDLC Cycle in DRAFT state.
   */
  createCycle(input: CreateCycleInput): SdlcCycle {
    const db = openAgentOsDb();
    const now = new Date().toISOString();
    const id = `cycle_${Date.now()}_${randomUUID().slice(0, 6)}`;
    const sourceIdea = input.sourceIdea || input.rawIdea || "Untitled Idea";
    const title = input.title || sourceIdea.slice(0, 50).trim() || "Untitled Feature";
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "feature";
    const featureKey = `FEAT-${randomUUID().slice(0, 4).toUpperCase()}`;
    const branchName = `${this.config.defaultBranchPrefix}${slug}`;
    const constitution = ConstitutionManager.getBaselineConstitution();

    db.query(`
      INSERT INTO sdlc_cycles
        (id, project_id, feature_key, slug, title, summary, source_idea, status, current_stage,
         risk_level, priority, auto_run_mode, branch_name, base_branch, constitution_version,
         policy_version, created_by, created_at, updated_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', 'DRAFT', ?, ?, ?, ?, 'main', ?, 1, ?, ?, ?, ?)
    `).run(
      id,
      input.projectId ?? null,
      featureKey,
      slug,
      title,
      sourceIdea.slice(0, 160),
      sourceIdea,
      input.riskLevel ?? "MEDIUM",
      input.priority ?? 5,
      input.autoRunMode ?? this.config.defaultMode,
      branchName,
      constitution.version,
      input.createdBy ?? "operator",
      now,
      now,
      JSON.stringify({ constraints: input.constraints ?? [], targetModule: input.targetModule }),
    );

    return this.getCycle(id);
  }

  getCycle(cycleId: string): SdlcCycle {
    const db = openAgentOsDb();
    const r = db.query("SELECT * FROM sdlc_cycles WHERE id = ?").get(cycleId) as Record<string, unknown> | undefined;
    if (!r) throw new Error(`SDLC Cycle '${cycleId}' not found`);

    return {
      id: r.id as string,
      projectId: r.project_id as string | null,
      featureKey: r.feature_key as string,
      slug: r.slug as string,
      title: r.title as string,
      summary: r.summary as string | null,
      sourceIdea: r.source_idea as string,
      status: r.status as CycleState,
      currentStage: r.current_stage as string,
      currentGate: r.current_gate as any,
      riskLevel: r.risk_level as RiskLevel,
      priority: r.priority as number,
      autoRunMode: r.auto_run_mode as AutoRunMode,
      branchName: r.branch_name as string | null,
      baseBranch: r.base_branch as string,
      worktreePath: r.worktree_path as string | null,
      repoHeadAtStart: r.repo_head_at_start as string | null,
      latestCommitSha: r.latest_commit_sha as string | null,
      constitutionVersion: r.constitution_version as number,
      policyVersion: r.policy_version as number,
      createdBy: r.created_by as string,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
      startedAt: r.started_at as string | null,
      completedAt: r.completed_at as string | null,
      metadata: JSON.parse((r.metadata_json as string) || "{}"),
    };
  }

  listCycles(options?: { status?: CycleState }): SdlcCycle[] {
    const db = openAgentOsDb();
    const whereSql = options?.status ? "WHERE status = ?" : "";
    const params = options?.status ? [options.status] : [];
    const rows = db.query(`SELECT * FROM sdlc_cycles ${whereSql} ORDER BY created_at DESC`).all(...params) as Record<string, unknown>[];

    return rows.map(r => ({
      id: r.id as string,
      projectId: r.project_id as string | null,
      featureKey: r.feature_key as string,
      slug: r.slug as string,
      title: r.title as string,
      summary: r.summary as string | null,
      sourceIdea: r.source_idea as string,
      status: r.status as CycleState,
      currentStage: r.current_stage as string,
      currentGate: r.current_gate as any,
      riskLevel: r.risk_level as RiskLevel,
      priority: r.priority as number,
      autoRunMode: r.auto_run_mode as AutoRunMode,
      branchName: r.branch_name as string | null,
      baseBranch: r.base_branch as string,
      worktreePath: r.worktree_path as string | null,
      repoHeadAtStart: r.repo_head_at_start as string | null,
      latestCommitSha: r.latest_commit_sha as string | null,
      constitutionVersion: r.constitution_version as number,
      policyVersion: r.policy_version as number,
      createdBy: r.created_by as string,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
      startedAt: r.started_at as string | null,
      completedAt: r.completed_at as string | null,
      metadata: JSON.parse((r.metadata_json as string) || "{}"),
    }));
  }

  /**
   * Executes /specify stage.
   */
  async specify(cycleId: string): Promise<SpecifyResult> {
    const cycle = this.getCycle(cycleId);
    SdlcStateMachine.assertTransition(cycle.status, "SPECIFYING");
    this.updateCycleState(cycleId, "SPECIFYING", "SPECIFYING");

    const res = SpecifyEngine.generateSpec({
      cycleId,
      title: cycle.title,
      sourceIdea: cycle.sourceIdea,
      constraints: (cycle.metadata?.constraints as string[]) ?? [],
    });

    if (res.specGate.status === "passed") {
      this.updateCycleState(cycleId, "SPECIFIED", "SPECIFIED", "SPEC_GATE");
    } else {
      this.updateCycleState(cycleId, "BLOCKED", "SPECIFYING", "SPEC_GATE");
    }

    return res;
  }

  /**
   * Executes /clarify stage.
   */
  async clarify(cycleId: string): Promise<ClarifyResult> {
    const cycle = this.getCycle(cycleId);
    SdlcStateMachine.assertTransition(cycle.status, "CLARIFYING");
    this.updateCycleState(cycleId, "CLARIFYING", "CLARIFYING");

    const reqs = openAgentOsDb().query("SELECT id, key, title, description FROM sdlc_requirements WHERE cycle_id = ?").all(cycleId) as any[];
    const res = ClarifyEngine.analyzeAndClarify({ cycleId, requirements: reqs });

    if (res.canProceed) {
      this.updateCycleState(cycleId, "CLARIFIED", "CLARIFIED");
    } else {
      this.updateCycleState(cycleId, "APPROVAL_REQUIRED", "CLARIFYING");
    }

    return res;
  }

  /**
   * Executes /plan stage.
   */
  async plan(cycleId: string): Promise<PlanResult> {
    const cycle = this.getCycle(cycleId);
    SdlcStateMachine.assertTransition(cycle.status, "PLANNING");
    this.updateCycleState(cycleId, "PLANNING", "PLANNING");

    const reqs = this.getRequirements(cycleId);
    const res = PlanEngine.generatePlan({ cycleId, title: cycle.title, requirements: reqs });

    if (res.planGate.status === "passed") {
      this.updateCycleState(cycleId, "PLANNED", "PLANNED", "PLAN_GATE");
    } else {
      this.updateCycleState(cycleId, "BLOCKED", "PLANNING", "PLAN_GATE");
    }

    return res;
  }

  /**
   * Executes /tasks stage.
   */
  async generateTasks(cycleId: string): Promise<TasksResult> {
    const cycle = this.getCycle(cycleId);
    SdlcStateMachine.assertTransition(cycle.status, "TASKING");
    this.updateCycleState(cycleId, "TASKING", "TASKED");

    const acs = this.getAcceptanceCriteria(cycleId);
    const res = TasksEngine.generateTasks({ cycleId, title: cycle.title, acceptanceCriteria: acs });

    if (res.tasksGate.status === "passed") {
      this.updateCycleState(cycleId, "TASKED", "TASKED", "TASKS_GATE");
    } else {
      this.updateCycleState(cycleId, "BLOCKED", "TASKING", "TASKS_GATE");
    }

    return res;
  }

  /**
   * Executes /analyze stage.
   */
  async analyze(cycleId: string): Promise<CoverageMatrix> {
    const cycle = this.getCycle(cycleId);
    SdlcStateMachine.assertTransition(cycle.status, "ANALYZING");
    this.updateCycleState(cycleId, "ANALYZING", "ANALYZING");

    const res = AnalyzeEngine.analyzeCycle(cycleId);
    const hasBlockingGaps = res.gaps.some(g => g.severity === "BLOCKING");

    if (!hasBlockingGaps) {
      this.updateCycleState(cycleId, "ANALYZED", "ANALYZED");
    } else {
      this.updateCycleState(cycleId, "BLOCKED", "ANALYZING");
    }

    return res;
  }

  /**
   * Evaluates pre-implementation checklist.
   */
  async evaluateChecklist(cycleId: string, gitClean = true): Promise<ChecklistResult> {
    const cycle = this.getCycle(cycleId);
    const res = ChecklistEngine.evaluatePreImplementation(cycleId, gitClean);

    if (res.passed) {
      this.updateCycleState(cycleId, "READY_FOR_IMPLEMENTATION", "READY_FOR_IMPLEMENTATION", "IMPLEMENT_GATE");
    } else {
      this.updateCycleState(cycleId, "BLOCKED", cycle.currentStage, "IMPLEMENT_GATE");
    }

    return res;
  }

  /**
   * Executes /implement task runner.
   */
  async implementTask(cycleId: string, taskId: string, ownerId = "worker-1"): Promise<{ success: boolean; message: string }> {
    const cycle = this.getCycle(cycleId);
    SafeImplementationRunner.assertApprovalGranted(cycleId, cycle.riskLevel);

    const lock = SafeImplementationRunner.acquireTaskLock(taskId, cycleId, ownerId);
    if (!lock) {
      return { success: false, message: `Task ${taskId} is currently locked by another worker` };
    }

    const db = openAgentOsDb();
    const now = new Date().toISOString();

    try {
      this.updateCycleState(cycleId, "IMPLEMENTING", "IMPLEMENTING");
      db.query("UPDATE sdlc_tasks SET status = 'in_progress', assigned_to = ?, updated_at = ? WHERE id = ?").run(ownerId, now, taskId);

      // Implementation simulated or executed cleanly
      db.query("UPDATE sdlc_tasks SET status = 'completed', updated_at = ? WHERE id = ?").run(now, taskId);
      return { success: true, message: `Task ${taskId} completed successfully` };
    } finally {
      SafeImplementationRunner.releaseTaskLock(taskId, ownerId);
    }
  }

  /**
   * Executes /test deterministic verification.
   */
  async runTests(
    cycleId: string,
    options?: { cwd?: string; runFullSuite?: boolean; fastCheck?: boolean }
  ): Promise<VerificationRunResult> {
    const cycle = this.getCycle(cycleId);
    this.updateCycleState(cycleId, "VERIFYING", "VERIFYING");

    const res = await DeterministicVerifier.runVerification(cycleId, options);
    return res;
  }

  /**
   * Executes /review Software Reviewer Council.
   */
  async runReview(cycleId: string, options?: { simulatedFailure?: boolean }): Promise<ReviewCouncilResult> {
    const cycle = this.getCycle(cycleId);
    this.updateCycleState(cycleId, "REVIEWING", "REVIEWING");

    const res = await SoftwareReviewerCouncil.evaluateCycle(cycleId, options);
    if (res.overallVerdict === "FAIL") {
      this.updateCycleState(cycleId, "REWORK_REQUIRED", "REVIEWING", "REVIEW_GATE");
    }

    return res;
  }

  /**
   * Executes /converge Definition of Done evaluation.
   */
  async converge(cycleId: string): Promise<ConvergenceResult> {
    const cycle = this.getCycle(cycleId);
    this.updateCycleState(cycleId, "CONVERGING", "CONVERGING");

    const res = ConvergenceEngine.evaluateConvergence(cycleId);
    if (res.converged) {
      this.updateCycleState(cycleId, "CLOSED", "CLOSED", "CONVERGE_GATE");
      openAgentOsDb().query("UPDATE sdlc_cycles SET completed_at = ? WHERE id = ?").run(new Date().toISOString(), cycleId);
    } else {
      this.updateCycleState(cycleId, "BLOCKED", "CONVERGING", "CONVERGE_GATE");
    }

    return res;
  }

  /**
   * Rolls back a cycle to safe clean state.
   */
  rollback(cycleId: string, reason = "Rollback requested by operator"): SdlcCycle {
    const cycle = this.getCycle(cycleId);
    const db = openAgentOsDb();
    const now = new Date().toISOString();

    // Release all active locks
    db.run("DELETE FROM sdlc_locks WHERE cycle_id = ?", [cycleId]);

    db.query(`
      UPDATE sdlc_cycles
      SET status = 'ROLLED_BACK', current_stage = 'ROLLED_BACK', updated_at = ?,
          metadata_json = json_set(metadata_json, '$.rollbackReason', ?)
      WHERE id = ?
    `).run(now, reason, cycleId);

    return this.getCycle(cycleId);
  }

  getRequirements(cycleId: string): SdlcRequirement[] {
    const db = openAgentOsDb();
    const rows = db.query("SELECT * FROM sdlc_requirements WHERE cycle_id = ? ORDER BY key ASC").all(cycleId) as Record<string, unknown>[];
    return rows.map(r => ({
      id: r.id as string,
      cycleId: r.cycle_id as string,
      key: r.key as string,
      type: r.type as any,
      priority: r.priority as number,
      title: r.title as string,
      description: r.description as string,
      source: r.source as string | null,
      status: r.status as any,
      riskLevel: r.risk_level as any,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    }));
  }

  getAcceptanceCriteria(cycleId: string): SdlcAcceptanceCriteria[] {
    const db = openAgentOsDb();
    const rows = db.query("SELECT * FROM sdlc_acceptance_criteria WHERE cycle_id = ? ORDER BY key ASC").all(cycleId) as Record<string, unknown>[];
    return rows.map(r => ({
      id: r.id as string,
      requirementId: r.requirement_id as string,
      cycleId: r.cycle_id as string,
      key: r.key as string,
      description: r.description as string,
      verificationType: r.verification_type as any,
      status: r.status as any,
      verifiedBy: r.verified_by as string | null,
      verifiedAt: r.verified_at as string | null,
      evidenceId: r.evidence_id as string | null,
    }));
  }

  getTasks(cycleId: string): SdlcTask[] {
    const db = openAgentOsDb();
    const rows = db.query("SELECT * FROM sdlc_tasks WHERE cycle_id = ? ORDER BY key ASC").all(cycleId) as Record<string, unknown>[];
    return rows.map(r => ({
      id: r.id as string,
      cycleId: r.cycle_id as string,
      key: r.key as string,
      title: r.title as string,
      description: r.description as string,
      taskType: r.task_type as any,
      status: r.status as any,
      priority: r.priority as number,
      assignedTo: r.assigned_to as string | null,
      dependencies: JSON.parse((r.dependencies_json as string) || "[]"),
      targetFiles: JSON.parse((r.target_files_json as string) || "[]"),
      acceptanceCriteriaKeys: JSON.parse((r.acceptance_criteria_keys_json as string) || "[]"),
      estimatedMinutes: r.estimated_minutes as number | null,
      actualMinutes: r.actual_minutes as number | null,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    }));
  }

  private updateCycleState(cycleId: string, status: CycleState, currentStage?: string, currentGate?: any): void {
    const db = openAgentOsDb();
    const now = new Date().toISOString();
    const updates: string[] = ["status = ?", "updated_at = ?"];
    const params: (string | number | null)[] = [status, now];

    if (currentStage) {
      updates.push("current_stage = ?");
      params.push(currentStage);
    }
    if (currentGate !== undefined) {
      updates.push("current_gate = ?");
      params.push(currentGate);
    }
    params.push(cycleId);

    db.query(`UPDATE sdlc_cycles SET ${updates.join(", ")} WHERE id = ?`).run(...(params as [string, ...string[]]));
  }
}

let orchestratorSingleton: SdlcOrchestrator | null = null;

export function getSdlcOrchestrator(): SdlcOrchestrator {
  if (!orchestratorSingleton) {
    orchestratorSingleton = new SdlcOrchestrator();
  }
  return orchestratorSingleton;
}

export function resetSdlcOrchestratorForTests(): void {
  orchestratorSingleton = null;
}
