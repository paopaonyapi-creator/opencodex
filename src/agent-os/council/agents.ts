// Phase 20.4 — Agent Profiles, Provider Abstraction & Assignment Engine
// (spec sections 18-23, 92, 93, 129).
//
// Profiles are provider-agnostic (spec section 18): a profile says what a role
// needs, the provider registry says who can supply it. Nothing here hardcodes a
// single vendor (spec section 19).

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import type {
  AgentProfile,
  AgentProfileId,
  AgentRun,
  AgentRunStatus,
  CouncilTaskClass,
} from "./types";
import type { RiskLevel } from "../sdlc/types";

/** Spec section 18 — built-in profiles. Provider is a default, not a binding. */
export const BUILTIN_AGENT_PROFILES: AgentProfile[] = [
  {
    profileId: "backend_implementer",
    providerId: "default",
    model: null,
    roles: ["implementer"],
    handles: ["BACKEND", "MCP", "CONFIG", "REFACTOR", "INFRA"],
    languages: ["typescript", "javascript"],
    maxContext: 128_000,
    supportsTools: true,
    supportsPatch: true,
    supportsShell: true,
    supportsTests: true,
    costClass: "medium",
    speedClass: "medium",
    isReviewer: false,
    enabled: true,
  },
  {
    profileId: "frontend_implementer",
    providerId: "default",
    model: null,
    roles: ["implementer"],
    handles: ["FRONTEND", "DESKTOP"],
    languages: ["typescript", "tsx", "css"],
    maxContext: 128_000,
    supportsTools: true,
    supportsPatch: true,
    supportsShell: true,
    supportsTests: true,
    costClass: "medium",
    speedClass: "fast",
    isReviewer: false,
    enabled: true,
  },
  {
    profileId: "database_engineer",
    providerId: "default",
    model: null,
    roles: ["implementer"],
    handles: ["DATABASE", "MIGRATION"],
    languages: ["sql", "typescript"],
    maxContext: 128_000,
    supportsTools: true,
    supportsPatch: true,
    supportsShell: true,
    supportsTests: true,
    costClass: "high",
    speedClass: "slow",
    isReviewer: false,
    enabled: true,
  },
  {
    profileId: "test_engineer",
    providerId: "default",
    model: null,
    roles: ["implementer"],
    handles: ["TEST"],
    languages: ["typescript"],
    maxContext: 128_000,
    supportsTools: true,
    supportsPatch: true,
    supportsShell: true,
    supportsTests: true,
    costClass: "low",
    speedClass: "fast",
    isReviewer: false,
    enabled: true,
  },
  {
    profileId: "docs_engineer",
    providerId: "default",
    model: null,
    roles: ["implementer"],
    handles: ["DOCS", "RESEARCH"],
    languages: ["markdown"],
    maxContext: 64_000,
    supportsTools: true,
    supportsPatch: true,
    supportsShell: false,
    supportsTests: false,
    costClass: "low",
    speedClass: "fast",
    isReviewer: false,
    enabled: true,
  },
  {
    profileId: "infra_engineer",
    providerId: "default",
    model: null,
    roles: ["implementer"],
    handles: ["INFRA", "CONFIG"],
    languages: ["yaml", "dockerfile", "typescript"],
    maxContext: 64_000,
    supportsTools: true,
    supportsPatch: true,
    supportsShell: true,
    supportsTests: false,
    costClass: "medium",
    speedClass: "medium",
    isReviewer: false,
    enabled: true,
  },
  // --- Reviewers (spec sections 50, 85-88) ---
  {
    profileId: "security_reviewer",
    providerId: "default",
    model: null,
    roles: ["reviewer"],
    handles: ["SECURITY", "BACKEND", "MCP", "CONFIG", "INFRA", "DATABASE", "MIGRATION"],
    languages: ["typescript"],
    maxContext: 128_000,
    supportsTools: true,
    supportsPatch: false,
    supportsShell: false,
    supportsTests: false,
    costClass: "high",
    speedClass: "medium",
    isReviewer: true,
    enabled: true,
  },
  {
    profileId: "architecture_reviewer",
    providerId: "default",
    model: null,
    roles: ["reviewer"],
    handles: ["BACKEND", "FRONTEND", "REFACTOR", "INFRA", "DATABASE"],
    languages: ["typescript"],
    maxContext: 128_000,
    supportsTools: true,
    supportsPatch: false,
    supportsShell: false,
    supportsTests: false,
    costClass: "high",
    speedClass: "slow",
    isReviewer: true,
    enabled: true,
  },
  {
    profileId: "api_reviewer",
    providerId: "default",
    model: null,
    roles: ["reviewer"],
    handles: ["BACKEND", "MCP"],
    languages: ["typescript"],
    maxContext: 128_000,
    supportsTools: true,
    supportsPatch: false,
    supportsShell: false,
    supportsTests: false,
    costClass: "medium",
    speedClass: "medium",
    isReviewer: true,
    enabled: true,
  },
  {
    profileId: "mcp_reviewer",
    providerId: "default",
    model: null,
    roles: ["reviewer"],
    handles: ["MCP"],
    languages: ["typescript"],
    maxContext: 128_000,
    supportsTools: true,
    supportsPatch: false,
    supportsShell: false,
    supportsTests: false,
    costClass: "medium",
    speedClass: "medium",
    isReviewer: true,
    enabled: true,
  },
  {
    profileId: "code_quality_reviewer",
    providerId: "default",
    model: null,
    roles: ["reviewer"],
    handles: [
      "BACKEND", "FRONTEND", "TEST", "DOCS", "CONFIG", "REFACTOR",
      "INFRA", "DATABASE", "MIGRATION", "SECURITY", "MCP", "DESKTOP",
      "RESEARCH", "INVESTIGATION",
    ],
    languages: ["typescript"],
    maxContext: 128_000,
    supportsTools: true,
    supportsPatch: false,
    supportsShell: false,
    supportsTests: false,
    costClass: "low",
    speedClass: "fast",
    isReviewer: true,
    enabled: true,
  },
  {
    profileId: "integration_reviewer",
    providerId: "default",
    model: null,
    roles: ["reviewer"],
    handles: [
      "BACKEND", "FRONTEND", "DATABASE", "MIGRATION", "TEST",
      "SECURITY", "MCP", "DESKTOP", "INFRA", "CONFIG",
    ],
    languages: ["typescript"],
    maxContext: 200_000,
    supportsTools: true,
    supportsPatch: false,
    supportsShell: false,
    supportsTests: false,
    costClass: "high",
    speedClass: "slow",
    isReviewer: true,
    enabled: true,
  },
];

export function listAgentProfiles(options: { reviewersOnly?: boolean } = {}): AgentProfile[] {
  const db = openAgentOsDb();
  const rows = db.query("SELECT * FROM council_agent_profiles").all() as Array<
    Record<string, unknown>
  >;

  const stored: AgentProfile[] = rows.map(r => ({
    profileId: r.profile_id as AgentProfileId,
    providerId: r.provider_id as string,
    model: (r.model as string | null) ?? null,
    roles: JSON.parse(r.roles_json as string) as string[],
    handles: JSON.parse(r.handles_json as string) as CouncilTaskClass[],
    languages: JSON.parse(r.languages_json as string) as string[],
    maxContext: r.max_context as number,
    supportsTools: r.supports_tools === 1,
    supportsPatch: r.supports_patch === 1,
    supportsShell: r.supports_shell === 1,
    supportsTests: r.supports_tests === 1,
    costClass: r.cost_class as AgentProfile["costClass"],
    speedClass: r.speed_class as AgentProfile["speedClass"],
    isReviewer: r.is_reviewer === 1,
    enabled: r.enabled === 1,
  }));

  // Stored rows override builtins of the same id; builtins fill the rest.
  const byId = new Map<string, AgentProfile>();
  for (const p of BUILTIN_AGENT_PROFILES) byId.set(p.profileId, p);
  for (const p of stored) byId.set(p.profileId, p);

  let out = [...byId.values()].filter(p => p.enabled);
  if (options.reviewersOnly) out = out.filter(p => p.isReviewer);
  return out.sort((a, b) => a.profileId.localeCompare(b.profileId));
}

export function upsertAgentProfile(profile: AgentProfile): void {
  const db = openAgentOsDb();
  db.query(
    `INSERT INTO council_agent_profiles
       (profile_id, provider_id, model, roles_json, handles_json, languages_json,
        max_context, supports_tools, supports_patch, supports_shell, supports_tests,
        cost_class, speed_class, is_reviewer, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(profile_id) DO UPDATE SET
       provider_id = excluded.provider_id, model = excluded.model,
       roles_json = excluded.roles_json, handles_json = excluded.handles_json,
       languages_json = excluded.languages_json, max_context = excluded.max_context,
       supports_tools = excluded.supports_tools, supports_patch = excluded.supports_patch,
       supports_shell = excluded.supports_shell, supports_tests = excluded.supports_tests,
       cost_class = excluded.cost_class, speed_class = excluded.speed_class,
       is_reviewer = excluded.is_reviewer, enabled = excluded.enabled`,
  ).run(
    profile.profileId,
    profile.providerId,
    profile.model,
    JSON.stringify(profile.roles),
    JSON.stringify(profile.handles),
    JSON.stringify(profile.languages),
    profile.maxContext,
    profile.supportsTools ? 1 : 0,
    profile.supportsPatch ? 1 : 0,
    profile.supportsShell ? 1 : 0,
    profile.supportsTests ? 1 : 0,
    profile.costClass,
    profile.speedClass,
    profile.isReviewer ? 1 : 0,
    profile.enabled ? 1 : 0,
  );
}

// --- Provider health (spec section 92) ------------------------------------

export type ProviderHealth = "healthy" | "degraded" | "unavailable";

const providerHealth = new Map<string, ProviderHealth>();

export function setProviderHealth(providerId: string, health: ProviderHealth): void {
  providerHealth.set(providerId, health);
}

export function getProviderHealth(providerId: string): ProviderHealth {
  return providerHealth.get(providerId) ?? "healthy";
}

export function resetProviderHealthForTests(): void {
  providerHealth.clear();
}

// --- Assignment engine (spec section 21) ----------------------------------

export interface AssignmentRequest {
  taskClass: CouncilTaskClass;
  risk: RiskLevel;
  role: "implementer" | "reviewer";
  /** Profiles already used for this changeset — used to keep reviewers distinct. */
  excludeProfiles?: string[];
  preferCheap?: boolean;
}

export type AssignmentOutcome =
  | { ok: true; profile: AgentProfile }
  | { ok: false; reason: "no_capable_profile" | "BLOCKED_PROVIDER" };

/**
 * Spec section 21 — pick a profile by capability, then provider health, then
 * cost/speed. Spec section 92: when the preferred provider is unavailable we
 * fall back to a compatible profile, and if none exists we return
 * BLOCKED_PROVIDER rather than silently skipping the requirement.
 */
export function selectAgentProfile(req: AssignmentRequest): AssignmentOutcome {
  const exclude = new Set(req.excludeProfiles ?? []);
  const candidates = listAgentProfiles()
    .filter(p => (req.role === "reviewer" ? p.isReviewer : !p.isReviewer))
    .filter(p => p.handles.includes(req.taskClass))
    .filter(p => !exclude.has(p.profileId));

  if (candidates.length === 0) return { ok: false, reason: "no_capable_profile" };

  const usable = candidates.filter(p => getProviderHealth(p.providerId) !== "unavailable");
  if (usable.length === 0) return { ok: false, reason: "BLOCKED_PROVIDER" };

  const costRank = { low: 0, medium: 1, high: 2 } as const;
  const speedRank = { fast: 0, medium: 1, slow: 2 } as const;
  const highRisk = req.risk === "HIGH" || req.risk === "CRITICAL";

  const sorted = [...usable].sort((a, b) => {
    // Healthy beats degraded.
    const ha = getProviderHealth(a.providerId) === "healthy" ? 0 : 1;
    const hb = getProviderHealth(b.providerId) === "healthy" ? 0 : 1;
    if (ha !== hb) return ha - hb;

    // Prefer specialists: fewer handled classes == more specialized.
    if (a.handles.length !== b.handles.length) return a.handles.length - b.handles.length;

    // High-risk work favours capability over cost; otherwise favour cheap/fast.
    if (highRisk && !req.preferCheap) {
      if (costRank[a.costClass] !== costRank[b.costClass]) {
        return costRank[b.costClass] - costRank[a.costClass];
      }
    } else {
      if (costRank[a.costClass] !== costRank[b.costClass]) {
        return costRank[a.costClass] - costRank[b.costClass];
      }
      if (speedRank[a.speedClass] !== speedRank[b.speedClass]) {
        return speedRank[a.speedClass] - speedRank[b.speedClass];
      }
    }
    return a.profileId.localeCompare(b.profileId);
  });

  return { ok: true, profile: sorted[0]! };
}

// --- Agent run records (spec sections 20, 23, 24, 44, 48) -----------------

export interface CreateAgentRunInput {
  councilRunId: string;
  taskKey: string;
  profileId: string;
  providerId: string;
  role: "implementer" | "reviewer" | "resolver";
  worktreeId?: string | null;
  attempt?: number;
}

export function assignAgentToTask(input: {
  councilRunId: string;
  taskKey: string;
  taskClass?: CouncilTaskClass;
  preferredProfileId?: string;
  worktreeId?: string;
}): AgentRun {
  const profileId = (input.preferredProfileId || "backend_implementer") as AgentProfileId;
  const outcome = selectAgentProfile({
    taskClass: input.taskClass || "BACKEND",
    risk: "MEDIUM",
    role: "implementer",
  });

  const resolvedProfile = outcome.ok ? outcome.profile.profileId : profileId;
  const providerId = outcome.ok ? outcome.profile.providerId : "default";

  return createAgentRun({
    councilRunId: input.councilRunId,
    taskKey: input.taskKey,
    profileId: resolvedProfile,
    providerId,
    role: "implementer",
    worktreeId: input.worktreeId ?? null,
  });
}

export function createAgentRun(input: CreateAgentRunInput): AgentRun {
  const db = openAgentOsDb();
  const now = new Date().toISOString();

  const prior = db
    .query(
      `SELECT MAX(attempt) AS a FROM council_agent_runs
       WHERE council_run_id = ? AND task_key = ? AND role = ?`,
    )
    .get(input.councilRunId, input.taskKey, input.role) as { a: number | null };
  const attempt = input.attempt ?? (prior?.a ?? 0) + 1;

  const run: AgentRun = {
    id: `carun_${randomUUID().slice(0, 12)}`,
    councilRunId: input.councilRunId,
    taskKey: input.taskKey,
    profileId: input.profileId,
    providerId: input.providerId,
    role: input.role,
    worktreeId: input.worktreeId ?? null,
    status: "PENDING",
    attempt,
    startedAt: null,
    endedAt: null,
    heartbeatAt: null,
    currentStage: null,
    tokensUsed: null,
    estimatedCostUsd: null,
    failureReason: null,
  };

  db.query(
    `INSERT INTO council_agent_runs
       (id, council_run_id, task_key, profile_id, provider_id, role, worktree_id,
        status, attempt, current_stage, heartbeat_ms, tokens_used, estimated_cost_usd,
        failure_reason, report_json, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
  ).run(
    run.id,
    run.councilRunId,
    run.taskKey,
    run.profileId,
    run.providerId,
    run.role,
    run.worktreeId,
    run.attempt,
  );

  void now;
  return run;
}

export function markAgentRunStarted(agentRunId: string): void {
  const db = openAgentOsDb();
  db.run(
    "UPDATE council_agent_runs SET status = 'RUNNING', started_at = ?, heartbeat_ms = ? WHERE id = ?",
    [new Date().toISOString(), Date.now(), agentRunId],
  );
}

/** Spec section 44 — heartbeat. Never records raw command args (may hold secrets). */
export function heartbeatAgentRun(
  agentRunId: string,
  stage: string | null,
): boolean {
  const db = openAgentOsDb();
  const res = db.run(
    "UPDATE council_agent_runs SET heartbeat_ms = ?, current_stage = ? WHERE id = ? AND status = 'RUNNING'",
    [Date.now(), stage, agentRunId],
  );
  return (res.changes ?? 0) > 0;
}

export function finishAgentRun(
  agentRunId: string,
  status: Extract<AgentRunStatus, "COMPLETED" | "FAILED" | "TIMED_OUT" | "CANCELLED" | "BLOCKED_PROVIDER">,
  options: {
    failureReason?: string | null;
    report?: unknown;
    tokensUsed?: number | null;
    estimatedCostUsd?: number | null;
  } = {},
): void {
  const db = openAgentOsDb();
  db.run(
    `UPDATE council_agent_runs
     SET status = ?, ended_at = ?, failure_reason = ?, report_json = ?,
         tokens_used = ?, estimated_cost_usd = ?
     WHERE id = ?`,
    [
      status,
      new Date().toISOString(),
      options.failureReason ?? null,
      options.report ? JSON.stringify(options.report) : null,
      options.tokensUsed ?? null,
      options.estimatedCostUsd ?? null,
      agentRunId,
    ],
  );
}

function rowToAgentRun(r: Record<string, unknown>): AgentRun {
  return {
    id: r.id as string,
    councilRunId: r.council_run_id as string,
    taskKey: r.task_key as string,
    profileId: r.profile_id as string,
    providerId: r.provider_id as string,
    role: r.role as AgentRun["role"],
    worktreeId: (r.worktree_id as string | null) ?? null,
    status: r.status as AgentRunStatus,
    attempt: r.attempt as number,
    startedAt: (r.started_at as string | null) ?? null,
    endedAt: (r.ended_at as string | null) ?? null,
    heartbeatAt: (r.heartbeat_ms as number | null) ?? null,
    currentStage: (r.current_stage as string | null) ?? null,
    tokensUsed: (r.tokens_used as number | null) ?? null,
    estimatedCostUsd: (r.estimated_cost_usd as number | null) ?? null,
    failureReason: (r.failure_reason as string | null) ?? null,
  };
}

export function getAgentRun(agentRunId: string): AgentRun | null {
  const db = openAgentOsDb();
  const row = db.query("SELECT * FROM council_agent_runs WHERE id = ?").get(agentRunId) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToAgentRun(row) : null;
}

export function listAgentRuns(councilRunId: string): AgentRun[] {
  const db = openAgentOsDb();
  const rows = db
    .query("SELECT * FROM council_agent_runs WHERE council_run_id = ? ORDER BY task_key, attempt")
    .all(councilRunId) as Array<Record<string, unknown>>;
  return rows.map(rowToAgentRun);
}

/** Spec section 45 — find runs whose heartbeat has gone stale. */
export function findStalledAgentRuns(
  councilRunId: string,
  idleTimeoutSeconds: number,
): AgentRun[] {
  const cutoff = Date.now() - idleTimeoutSeconds * 1000;
  return listAgentRuns(councilRunId).filter(
    r => r.status === "RUNNING" && (r.heartbeatAt ?? 0) < cutoff,
  );
}

/** Spec section 93 — provider cost tracking; unknown usage is recorded as null. */
export function recordResourceUsage(input: {
  councilRunId: string;
  agentRunId?: string | null;
  providerId?: string | null;
  model?: string | null;
  taskKey?: string | null;
  role?: string | null;
  tokensInput?: number | null;
  tokensOutput?: number | null;
  estimatedCostUsd?: number | null;
  durationMs?: number | null;
}): void {
  const db = openAgentOsDb();
  db.query(
    `INSERT INTO council_resource_usage
       (id, council_run_id, agent_run_id, provider_id, model, task_key, role,
        tokens_input, tokens_output, estimated_cost_usd, duration_ms, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `cusage_${randomUUID().slice(0, 12)}`,
    input.councilRunId,
    input.agentRunId ?? null,
    input.providerId ?? null,
    input.model ?? null,
    input.taskKey ?? null,
    input.role ?? null,
    input.tokensInput ?? null,
    input.tokensOutput ?? null,
    input.estimatedCostUsd ?? null,
    input.durationMs ?? null,
    new Date().toISOString(),
  );
}

export function totalRunCost(councilRunId: string): {
  estimatedCostUsd: number;
  tokens: number;
  unknownEntries: number;
} {
  const db = openAgentOsDb();
  const rows = db
    .query("SELECT * FROM council_resource_usage WHERE council_run_id = ?")
    .all(councilRunId) as Array<Record<string, unknown>>;

  let cost = 0;
  let tokens = 0;
  let unknown = 0;
  for (const r of rows) {
    const c = r.estimated_cost_usd as number | null;
    const ti = r.tokens_input as number | null;
    const to = r.tokens_output as number | null;
    if (c === null && ti === null && to === null) unknown++;
    cost += c ?? 0;
    tokens += (ti ?? 0) + (to ?? 0);
  }
  return { estimatedCostUsd: cost, tokens, unknownEntries: unknown };
}
