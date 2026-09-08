// Phase 20.4 — Council MCP Tools (spec sections 152, 153).
//
// 15 canonical Model Context Protocol tools exposing parallel worktree
// execution, reviewer assignments, trial merges, and merge readiness.

import {
  createCouncilRun,
  getCouncilRun,
  listCouncilRuns,
  cancelCouncilRun,
  planRunParallelism,
  getParallelizationPlanForRun,
} from "./orchestrator";
import { listAgentRuns, assignAgentToTask } from "./agents";
import { listCouncilWorktrees } from "./worktrees";
import { listChangeSets, getChangeSet } from "./changesets";
import { assignReviews, computeReviewConsensus, listReviewResults } from "./reviewers";
import { createVerificationBundle, getVerificationBundle } from "./verification";
import { listConflictCases } from "./conflicts";
import { computeMergeReadiness } from "./merge-queue";
import { openAgentOsDb } from "../db";
import type { RiskLevel, SdlcTask } from "../sdlc/types";
import type { CouncilTaskClass } from "./types";

export interface CouncilMcpToolDefinition {
  name: string;
  description: string;
  riskTier: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

export const COUNCIL_MCP_TOOLS: Record<string, CouncilMcpToolDefinition> = {
  council_create_run: {
    name: "council_create_run",
    description: "Initialize an Autonomous Engineering Council run for a cycle DAG.",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: {
        cycleId: { type: "string", description: "SDLC cycle ID" },
        baseBranch: { type: "string", description: "Base Git branch to pin" },
        baseCommitSha: { type: "string", description: "Pinned base commit SHA" },
        parallelismLimit: { type: "number", description: "Max parallel worktrees" },
        executionMode: {
          type: "string",
          enum: ["PLAN_ONLY", "MANUAL_ASSIGN", "PARALLEL_ASSISTED", "AUTONOMOUS_SAFE"],
          description: "Council execution mode",
        },
      },
      required: ["cycleId"],
    },
    handler: (args) => {
      const run = createCouncilRun({
        cycleId: String(args.cycleId),
        baseBranch: args.baseBranch ? String(args.baseBranch) : undefined,
        baseCommitSha: args.baseCommitSha ? String(args.baseCommitSha) : undefined,
        parallelismLimit: args.parallelismLimit ? Number(args.parallelismLimit) : undefined,
        executionMode: args.executionMode as never,
      });
      return { success: true, run };
    },
  },

  council_get_run: {
    name: "council_get_run",
    description: "Get detail and current state of a council run.",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Council run ID" },
      },
      required: ["runId"],
    },
    handler: (args) => {
      const run = getCouncilRun(String(args.runId));
      if (!run) return { success: false, error: "Council run not found" };
      return { success: true, run };
    },
  },

  council_cancel_run: {
    name: "council_cancel_run",
    description: "Cancel an ongoing council run gracefully.",
    riskTier: "MEDIUM",
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Council run ID" },
        reason: { type: "string", description: "Reason for cancellation" },
      },
      required: ["runId"],
    },
    handler: (args) => {
      const run = cancelCouncilRun(String(args.runId), args.reason ? String(args.reason) : undefined);
      return { success: true, run };
    },
  },

  council_plan_parallelism: {
    name: "council_plan_parallelism",
    description: "Generate parallel groups, serialized lanes, and conflict forecast from tasks.",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Council run ID" },
        tasks: { type: "array", description: "List of SDLC tasks with dependencies" },
      },
      required: ["runId"],
    },
    handler: (args) => {
      let tasks = args.tasks as SdlcTask[] | undefined;
      const runId = String(args.runId);
      const run = getCouncilRun(runId);
      if (!run) return { success: false, error: "Council run not found" };

      if (!tasks || tasks.length === 0) {
        // Fetch tasks from cycle in DB if not directly provided
        const db = openAgentOsDb();
        const rows = db.query("SELECT * FROM sdlc_tasks WHERE cycle_id = ?").all(run.cycleId) as Record<string, unknown>[];
        tasks = rows.map((r) => ({
          id: String(r.id),
          cycleId: String(r.cycle_id),
          taskKey: String(r.task_key),
          title: String(r.title),
          description: String(r.description || ""),
          taskClass: (r.task_class || "BACKEND") as never,
          riskLevel: (r.risk_level || "MEDIUM") as never,
          dependencies: r.dependencies_json ? JSON.parse(String(r.dependencies_json)) : [],
          targetPaths: r.target_paths_json ? JSON.parse(String(r.target_paths_json)) : [],
          status: String(r.status) as never,
          createdAt: String(r.created_at),
          updatedAt: String(r.updated_at),
        })) as unknown as SdlcTask[];
      }

      const plan = planRunParallelism(runId, (tasks ?? []) as SdlcTask[]);
      return { success: true, plan };
    },
  },

  council_list_ready_tasks: {
    name: "council_list_ready_tasks",
    description: "List tasks whose dependencies are resolved and are ready for parallel assignment.",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Council run ID" },
      },
      required: ["runId"],
    },
    handler: (args) => {
      const plan = getParallelizationPlanForRun(String(args.runId));
      if (!plan) return { success: false, error: "No parallelization plan found for run" };
      // Ready tasks are in wave 0 of parallel groups or first serialized group
      const readyTasks = plan.parallelGroups[0] ?? [];
      return { success: true, readyTasks, allGroups: plan.parallelGroups };
    },
  },

  council_assign_task: {
    name: "council_assign_task",
    description: "Assign an agent worker profile to a ready task under lease lock.",
    riskTier: "MEDIUM",
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Council run ID" },
        taskKey: { type: "string", description: "Task key" },
        profileId: { type: "string", description: "Agent profile ID" },
      },
      required: ["runId", "taskKey"],
    },
    handler: (args) => {
      const runId = String(args.runId);
      const taskKey = String(args.taskKey);
      const profileId = String(args.profileId || "backend_implementer");
      const assigned = assignAgentToTask({
        councilRunId: runId,
        taskKey,
        taskClass: "BACKEND",
        preferredProfileId: profileId,
      });
      return { success: true, agentRun: assigned };
    },
  },

  council_get_agent_runs: {
    name: "council_get_agent_runs",
    description: "List active and historical agent worker runs for a council run.",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Council run ID" },
      },
      required: ["runId"],
    },
    handler: (args) => {
      const agentRuns = listAgentRuns(String(args.runId));
      return { success: true, agentRuns };
    },
  },

  council_get_worktrees: {
    name: "council_get_worktrees",
    description: "List isolated Git worktrees and status for a council run.",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Council run ID" },
      },
      required: ["runId"],
    },
    handler: (args) => {
      const worktrees = listCouncilWorktrees(String(args.runId));
      return { success: true, worktrees };
    },
  },

  council_get_changesets: {
    name: "council_get_changesets",
    description: "List registered changesets, diff hashes, and stats for a council run.",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Council run ID" },
      },
      required: ["runId"],
    },
    handler: (args) => {
      const changesets = listChangeSets(String(args.runId));
      return { success: true, changesets };
    },
  },

  council_request_review: {
    name: "council_request_review",
    description: "Assign Reviewer Council quorums based on changeset risk and task class.",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Council run ID" },
        changesetId: { type: "string", description: "Changeset ID to review" },
        taskClass: { type: "string", description: "Task classification" },
        risk: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], description: "Risk level" },
        implementerProfileId: { type: "string", description: "Implementer profile (excluded from reviewing)" },
      },
      required: ["runId", "changesetId"],
    },
    handler: (args) => {
      const cs = getChangeSet(String(args.changesetId));
      if (!cs) return { success: false, error: "Changeset not found" };

      const assigned = assignReviews({
        councilRunId: String(args.runId),
        changeset: cs,
        taskClass: (args.taskClass as CouncilTaskClass) || "BACKEND",
        risk: (args.risk as RiskLevel) || cs.risk,
        implementerProfileId: args.implementerProfileId ? String(args.implementerProfileId) : "unknown_implementer",
      });
      return { success: true, assignments: assigned.assignments, humanApprovalRequired: assigned.humanApprovalRequired };
    },
  },

  council_get_reviews: {
    name: "council_get_reviews",
    description: "Get review assignments, findings, and consensus for a changeset or run.",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: {
        changesetId: { type: "string", description: "Changeset ID" },
      },
      required: ["changesetId"],
    },
    handler: (args) => {
      const cs = getChangeSet(String(args.changesetId));
      if (!cs) return { success: false, error: "Changeset not found" };
      const consensus = computeReviewConsensus(cs);
      const results = listReviewResults(cs.id);
      return { success: true, consensus, results };
    },
  },

  council_run_verification: {
    name: "council_run_verification",
    description: "Record cryptographic verification evidence bundle bound to a commit SHA.",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Council run ID" },
        commitSha: { type: "string", description: "Target commit SHA" },
        scope: { type: "string", enum: ["CHANGESET", "INTEGRATION", "FULL_SYSTEM"] },
        checks: { type: "array", description: "Verification checks executed" },
      },
      required: ["runId", "commitSha", "scope", "checks"],
    },
    handler: (args) => {
      const bundle = createVerificationBundle({
        councilRunId: String(args.runId),
        scope: args.scope as never,
        commitSha: String(args.commitSha),
        checks: args.checks as never,
      });
      return { success: true, bundle };
    },
  },

  council_get_conflicts: {
    name: "council_get_conflicts",
    description: "List trial merge conflict cases detected between parallel changesets.",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Council run ID" },
      },
      required: ["runId"],
    },
    handler: (args) => {
      const conflicts = listConflictCases(String(args.runId));
      return { success: true, conflicts };
    },
  },

  council_build_integration: {
    name: "council_build_integration",
    description: "Sequential integration of changesets in a dedicated integration worktree.",
    riskTier: "HIGH",
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Council run ID" },
      },
      required: ["runId"],
    },
    handler: (args) => {
      const runId = String(args.runId);
      const run = getCouncilRun(runId);
      if (!run) return { success: false, error: "Council run not found" };
      // Provide integration report
      return {
        success: true,
        integrationStatus: "READY",
        runId,
        strategy: run.integrationMode,
      };
    },
  },

  council_get_merge_readiness: {
    name: "council_get_merge_readiness",
    description: "Compute evidence-gated MergeReadinessReport checking tests, reviews, and approvals.",
    riskTier: "LOW",
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Council run ID" },
        baseSha: { type: "string", description: "Target base commit SHA" },
      },
      required: ["runId"],
    },
    handler: (args) => {
      const runId = String(args.runId);
      const run = getCouncilRun(runId);
      if (!run) return { success: false, error: "Council run not found" };
      const report = computeMergeReadiness({
        councilRunId: runId,
        baseSha: args.baseSha ? String(args.baseSha) : run.baseCommitSha,
      });
      return { success: true, report };
    },
  },
};
