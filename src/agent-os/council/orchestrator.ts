// Phase 20.4 — Council Orchestrator
//
// Lifecycle manager uniting parallel planning, agent leases, worktrees,
// review pools, trial merges, verification evidence, and merge readiness.

import { openAgentOsDb } from "../db";
import { assertCouncilTransition, canTransitionCouncil } from "./state-machine";
import { buildParallelizationPlan, type PlannerInput } from "./planner";
import { getCouncilConfig } from "./config";
import type {
  CouncilRun,
  CouncilRunState,
  CouncilExecutionMode,
  BudgetMode,
  ParallelizationPlan,
  MergeReadinessReport,
} from "./types";
import { computeMergeReadiness, assertMergeAuthorized } from "./merge-queue";
import { listChangeSets } from "./changesets";
import { listCouncilWorktrees } from "./worktrees";
import { listAgentRuns } from "./agents";
import { listConflictCases } from "./conflicts";
import { getVerificationBundle } from "./verification";
import { assignReviews, computeReviewConsensus } from "./reviewers";
import type { SdlcTask } from "../sdlc/types";

export interface CreateCouncilRunInput {
  cycleId: string;
  baseBranch?: string;
  baseCommitSha?: string;
  parallelismLimit?: number;
  maxParallelHighRisk?: number;
  policyProfile?: string;
  budgetProfile?: BudgetMode;
  executionMode?: CouncilExecutionMode;
  metadata?: Record<string, unknown>;
}

export function createCouncilRun(input: CreateCouncilRunInput): CouncilRun {
  const db = openAgentOsDb();
  const config = getCouncilConfig();
  const id = `crun_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  const run: CouncilRun = {
    id,
    cycleId: input.cycleId,
    status: "CREATED",
    currentStage: "created",
    baseBranch: input.baseBranch ?? "main",
    baseCommitSha: input.baseCommitSha ?? "HEAD",
    parallelismLimit: input.parallelismLimit ?? config.maxParallelAgents ?? 4,
    maxParallelHighRisk: input.maxParallelHighRisk ?? config.maxParallelHighRisk ?? 1,
    policyProfile: input.policyProfile ?? "default",
    budgetProfile: input.budgetProfile ?? config.defaultBudgetMode ?? "BALANCED",
    executionMode: input.executionMode ?? config.defaultExecutionMode ?? "PLAN_ONLY",
    integrationMode: "SEQUENTIAL_APPLY",
    failureReason: null,
    createdAt: now,
    startedAt: null,
    endedAt: null,
    metadata: input.metadata ?? {},
  };

  db.query(`INSERT INTO council_runs (
    id, cycle_id, status, current_stage, base_branch, base_commit_sha,
    parallelism_limit, max_parallel_high_risk, policy_profile, budget_profile,
    execution_mode, integration_mode, failure_reason, metadata_json, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    run.id,
    run.cycleId,
    run.status,
    run.currentStage,
    run.baseBranch,
    run.baseCommitSha,
    run.parallelismLimit,
    run.maxParallelHighRisk,
    run.policyProfile,
    run.budgetProfile,
    run.executionMode,
    run.integrationMode,
    run.failureReason,
    JSON.stringify(run.metadata),
    run.createdAt,
  );

  return run;
}

export function getCouncilRun(id: string): CouncilRun | null {
  const db = openAgentOsDb();
  const row = db.query("SELECT * FROM council_runs WHERE id = ?").get(id) as Record<string, unknown> | null;
  if (!row) return null;

  return {
    id: String(row.id),
    cycleId: String(row.cycle_id),
    status: String(row.status) as CouncilRunState,
    currentStage: String(row.current_stage),
    baseBranch: String(row.base_branch),
    baseCommitSha: String(row.base_commit_sha),
    parallelismLimit: Number(row.parallelism_limit),
    maxParallelHighRisk: Number(row.max_parallel_high_risk),
    policyProfile: String(row.policy_profile),
    budgetProfile: String(row.budget_profile) as BudgetMode,
    executionMode: String(row.execution_mode) as CouncilExecutionMode,
    integrationMode: String(row.integration_mode) as never,
    failureReason: row.failure_reason ? String(row.failure_reason) : null,
    createdAt: String(row.created_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    endedAt: row.ended_at ? String(row.ended_at) : null,
    metadata: row.metadata_json ? JSON.parse(String(row.metadata_json)) : {},
  };
}

export function listCouncilRuns(cycleId?: string): CouncilRun[] {
  const db = openAgentOsDb();
  const rows = cycleId
    ? (db.query("SELECT * FROM council_runs WHERE cycle_id = ? ORDER BY created_at DESC").all(cycleId) as Record<string, unknown>[])
    : (db.query("SELECT * FROM council_runs ORDER BY created_at DESC LIMIT 50").all() as Record<string, unknown>[]);

  return rows.map((row) => ({
    id: String(row.id),
    cycleId: String(row.cycle_id),
    status: String(row.status) as CouncilRunState,
    currentStage: String(row.current_stage),
    baseBranch: String(row.base_branch),
    baseCommitSha: String(row.base_commit_sha),
    parallelismLimit: Number(row.parallelism_limit),
    maxParallelHighRisk: Number(row.max_parallel_high_risk),
    policyProfile: String(row.policy_profile),
    budgetProfile: String(row.budget_profile) as BudgetMode,
    executionMode: String(row.execution_mode) as CouncilExecutionMode,
    integrationMode: String(row.integration_mode) as never,
    failureReason: row.failure_reason ? String(row.failure_reason) : null,
    createdAt: String(row.created_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    endedAt: row.ended_at ? String(row.ended_at) : null,
    metadata: row.metadata_json ? JSON.parse(String(row.metadata_json)) : {},
  }));
}

export function updateCouncilRunStatus(id: string, newStatus: CouncilRunState, stage?: string, failureReason?: string): CouncilRun {
  const run = getCouncilRun(id);
  if (!run) throw new Error(`Council run ${id} not found`);

  assertCouncilTransition(run.status, newStatus);
  const now = new Date().toISOString();
  const db = openAgentOsDb();

  const updates: Record<string, unknown> = { status: newStatus };
  if (stage) updates.current_stage = stage;
  if (failureReason !== undefined) updates.failure_reason = failureReason;
  if (!run.startedAt && newStatus !== "CREATED" && newStatus !== "CANCELLED") {
    updates.started_at = now;
  }
  if (newStatus === "COMPLETED" || newStatus === "FAILED" || newStatus === "CANCELLED") {
    updates.ended_at = now;
  }

  const setClauses = Object.keys(updates).map((k) => `${k} = ?`).join(", ");
  const values = Object.values(updates) as (string | number | boolean | null)[];
  db.query(`UPDATE council_runs SET ${setClauses} WHERE id = ?`).run(...values, id);

  return { ...run, ...updates } as CouncilRun;
}

export function cancelCouncilRun(id: string, reason = "User requested cancellation"): CouncilRun {
  const run = getCouncilRun(id);
  if (!run) throw new Error(`Council run ${id} not found`);
  if (run.status === "COMPLETED" || run.status === "CANCELLED") return run;

  return updateCouncilRunStatus(id, "CANCELLED", "cancelled", reason);
}

export function planRunParallelism(runId: string, tasks: SdlcTask[]): ParallelizationPlan {
  const run = getCouncilRun(runId);
  if (!run) throw new Error(`Council run ${runId} not found`);

  const plan = buildParallelizationPlan({
    councilRunId: run.id,
    cycleId: run.cycleId,
    tasks,
    maxParallel: run.parallelismLimit,
    maxParallelHighRisk: run.maxParallelHighRisk,
  });

  const db = openAgentOsDb();
  db.query(`INSERT INTO council_parallelization_plans (
    id, council_run_id, cycle_id, task_keys_json, parallel_groups_json,
    serialized_groups_json, conflict_risks_json, resource_estimate_json,
    generator, version, plan_hash, generated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    plan.id,
    plan.councilRunId,
    plan.cycleId,
    JSON.stringify(plan.taskKeys),
    JSON.stringify(plan.parallelGroups),
    JSON.stringify(plan.serializedGroups),
    JSON.stringify(plan.conflictRisks),
    JSON.stringify(plan.resourceEstimate),
    plan.generator,
    plan.version,
    plan.planHash,
    plan.generatedAt,
  );

  if (canTransitionCouncil(run.status, "PLANNING")) {
    updateCouncilRunStatus(run.id, "PLANNING", "planned");
  }

  return plan;
}

export function getParallelizationPlanForRun(runId: string): ParallelizationPlan | null {
  const db = openAgentOsDb();
  const row = db.query("SELECT * FROM council_parallelization_plans WHERE council_run_id = ? ORDER BY generated_at DESC LIMIT 1").get(runId) as Record<string, unknown> | null;
  if (!row) return null;

  return {
    id: String(row.id),
    councilRunId: String(row.council_run_id),
    cycleId: String(row.cycle_id),
    taskKeys: JSON.parse(String(row.task_keys_json)),
    parallelGroups: JSON.parse(String(row.parallel_groups_json)),
    serializedGroups: JSON.parse(String(row.serialized_groups_json)),
    conflictRisks: JSON.parse(String(row.conflict_risks_json)),
    resourceEstimate: JSON.parse(String(row.resource_estimate_json)),
    generator: String(row.generator),
    version: Number(row.version),
    planHash: String(row.plan_hash),
    generatedAt: String(row.generated_at),
  };
}
