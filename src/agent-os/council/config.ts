// Phase 20.4 — Engineering Council Configuration (spec section 158).
//
// Default DISABLED (spec section 159): Phase 20.2 must keep working as a
// single-executor orchestrator when Phase 20.4 is off.

import { join } from "node:path";
import type { BudgetMode, CouncilConfig, CouncilExecutionMode, ResourceBudget } from "./types";

function boolEnv(val: string | undefined, defaultVal: boolean): boolean {
  if (val === undefined) return defaultVal;
  return val.toLowerCase() === "true" || val === "1";
}

function numberEnv(val: string | undefined, defaultVal: number): number {
  if (val === undefined) return defaultVal;
  const parsed = Number(val);
  return Number.isFinite(parsed) ? parsed : defaultVal;
}

function listEnv(val: string | undefined, defaultVal: string[]): string[] {
  if (val === undefined || val.trim() === "") return defaultVal;
  return val
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

const BUDGET_MODES: BudgetMode[] = ["ECONOMY", "BALANCED", "FAST", "CUSTOM"];
const EXECUTION_MODES: CouncilExecutionMode[] = [
  "PLAN_ONLY",
  "MANUAL_ASSIGN",
  "PARALLEL_ASSISTED",
  "AUTONOMOUS_SAFE",
];

export function getCouncilConfig(): CouncilConfig {
  return loadCouncilConfig();
}

export function loadCouncilConfig(
  env: Record<string, string | undefined> = process.env,
): CouncilConfig {
  const budgetRaw = env.PAO_COUNCIL_DEFAULT_BUDGET_MODE?.toUpperCase();
  const defaultBudgetMode: BudgetMode = BUDGET_MODES.includes(budgetRaw as BudgetMode)
    ? (budgetRaw as BudgetMode)
    : "BALANCED";

  const modeRaw = env.PAO_COUNCIL_DEFAULT_EXECUTION_MODE?.toUpperCase();
  const defaultExecutionMode: CouncilExecutionMode = EXECUTION_MODES.includes(
    modeRaw as CouncilExecutionMode,
  )
    ? (modeRaw as CouncilExecutionMode)
    : "PLAN_ONLY";

  return {
    // Spec section 159: default disabled.
    enabled: boolEnv(env.PAO_COUNCIL_ENABLED, false),
    maxParallelAgents: Math.max(1, numberEnv(env.PAO_COUNCIL_MAX_PARALLEL_AGENTS, 4)),
    maxParallelHighRisk: Math.max(1, numberEnv(env.PAO_COUNCIL_MAX_PARALLEL_HIGH_RISK, 1)),
    defaultBudgetMode,
    defaultExecutionMode,
    maxReviewRounds: Math.max(1, numberEnv(env.PAO_COUNCIL_MAX_REVIEW_ROUNDS, 3)),
    agentIdleTimeoutSeconds: numberEnv(env.PAO_COUNCIL_AGENT_IDLE_TIMEOUT_SECONDS, 300),
    agentStartupTimeoutSeconds: numberEnv(env.PAO_COUNCIL_AGENT_STARTUP_TIMEOUT_SECONDS, 60),
    taskTimeoutSeconds: numberEnv(env.PAO_COUNCIL_TASK_TIMEOUT_SECONDS, 1800),
    commandTimeoutMs: numberEnv(env.PAO_COUNCIL_COMMAND_TIMEOUT_MS, 120_000),
    reviewTimeoutSeconds: numberEnv(env.PAO_COUNCIL_REVIEW_TIMEOUT_SECONDS, 600),
    keepFailedWorktrees: boolEnv(env.PAO_COUNCIL_KEEP_FAILED_WORKTREES, true),
    keepSuccessfulWorktrees: numberEnv(env.PAO_COUNCIL_KEEP_SUCCESSFUL_WORKTREES, 3),
    cleanupAfterDays: numberEnv(env.PAO_COUNCIL_CLEANUP_AFTER_DAYS, 7),
    // Spec section 77: remote push disabled by default.
    remotePushEnabled: boolEnv(env.PAO_COUNCIL_REMOTE_PUSH_ENABLED, false),
    // Spec section 75 / 156: never auto-merge a protected branch by default.
    autoMergeProtectedBranch: boolEnv(env.PAO_COUNCIL_AUTO_MERGE_PROTECTED_BRANCH, false),
    worktreeRoot: env.PAO_COUNCIL_WORKTREE_ROOT ?? join(".pao", "worktrees"),
    branchPrefix: env.PAO_COUNCIL_BRANCH_PREFIX ?? "pao",
    // Spec section 76.
    protectedBranches: listEnv(env.PAO_COUNCIL_PROTECTED_BRANCHES, [
      "main",
      "master",
      "production",
      "release/*",
    ]),
    leaseTtlSeconds: numberEnv(env.PAO_COUNCIL_LEASE_TTL_SECONDS, 300),
    minFreeDiskBytes: numberEnv(env.PAO_COUNCIL_MIN_FREE_DISK_BYTES, 2 * 1024 * 1024 * 1024),
    desktopLaneEnabled: boolEnv(env.PAO_COUNCIL_DESKTOP_LANE_ENABLED, false),
  };
}

/** Spec section 42/43 — resolve a budget mode into concrete caps. */
export function resolveResourceBudget(
  config: CouncilConfig,
  mode: BudgetMode = config.defaultBudgetMode,
): ResourceBudget {
  const base: ResourceBudget = {
    maxParallelAgents: config.maxParallelAgents,
    maxParallelHighRisk: config.maxParallelHighRisk,
    maxWorktrees: config.maxParallelAgents + 1, // +1 for the integration lane
    maxProcesses: config.maxParallelAgents * 2,
    maxWallClockMinutes: Math.ceil((config.taskTimeoutSeconds / 60) * 4),
    maxProviderCostUsd: null,
    minFreeDiskBytes: config.minFreeDiskBytes,
  };

  switch (mode) {
    case "ECONOMY":
      return {
        ...base,
        maxParallelAgents: Math.max(1, Math.min(2, config.maxParallelAgents)),
        maxParallelHighRisk: 1,
        maxWorktrees: Math.max(2, Math.min(3, base.maxWorktrees)),
        maxProcesses: 4,
      };
    case "FAST":
      // FAST raises concurrency. Spec section 43: it must NOT bypass any gate,
      // so only resource caps move here — never review/verification policy.
      return {
        ...base,
        maxParallelAgents: config.maxParallelAgents,
        maxWorktrees: config.maxParallelAgents + 2,
        maxProcesses: config.maxParallelAgents * 3,
      };
    case "BALANCED":
    case "CUSTOM":
    default:
      return base;
  }
}

/** Spec section 76 — protected-branch matching with trailing wildcard support. */
export function isProtectedBranch(branch: string, config: CouncilConfig): boolean {
  return config.protectedBranches.some(pattern => {
    if (pattern.endsWith("/*")) return branch.startsWith(pattern.slice(0, -1));
    if (pattern.endsWith("*")) return branch.startsWith(pattern.slice(0, -1));
    return branch === pattern;
  });
}
