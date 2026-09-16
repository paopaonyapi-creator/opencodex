// Phase 20.37 — Pao-hubPro × OrchestKit-inspired Agentic Development OS:
// canonical contracts. CLEAN-ROOM: OrchestKit is an architectural reference
// only (registry/hook/router/worktree PATTERNS); all code, naming and tests
// are original to this repository and host-neutral. Lives in agentic-os/
// because src/agent-os/orchestration/ is the existing Phase 20.22 module.
//
// Reuse map (no duplicate subsystems): policy/approvals/tool execution ride
// the Phase 20.28 governedDispatch (tool gateway), command/path guards reuse
// the Phase 20.27 access policy, review reuses the Phase 20.22 council bridge,
// redaction reuses Phase 20.35, shell execution reuses the Phase 20.33
// governed shell provider. NEW here: agent/skill registries, the deterministic
// auto router, the run state machine, the hook engine, worktree isolation and
// the memory/decision store.

export type AgentSlug =
  | "orchestrator" | "explorer" | "planner" | "implementer" | "reviewer"
  | "verifier" | "security-auditor" | "test-engineer" | "memory-curator";

export type RuntimeKind = "codex" | "claude" | "local-ai" | "deterministic";

export interface AgentManifest {
  slug: AgentSlug;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  runtime: { preferred: RuntimeKind; fallbacks: RuntimeKind[] };
  /** Risk ceiling 0..4 — the agent can never execute above it (§16). */
  riskCeiling: 0 | 1 | 2 | 3 | 4;
  capabilities: string[];
  tools: { allow: string[]; deny: string[] };
  skills: string[];
  routing: { triggerTerms: string[]; priority: number };
  limits: { maxParallelTasks: number; maxRuntimeSeconds: number };
}

export type SkillSlug =
  | "brainstorm" | "explore" | "plan" | "implement" | "verify" | "review"
  | "security-audit" | "test" | "refactor" | "docs" | "remember" | "commit-check";

export interface SkillManifest {
  slug: SkillSlug;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  riskLevel: 0 | 1 | 2 | 3 | 4;
  triggerTerms: string[];
  capabilities: string[];
  tools: { required: string[]; optional: string[] };
  workflow: { requires: SkillSlug[]; followedBy: SkillSlug[] };
}

export type HookEvent =
  | "PRE_ROUTE" | "POST_ROUTE" | "PRE_AGENT_DISPATCH" | "POST_AGENT_DISPATCH"
  | "PRE_TOOL_USE" | "POST_TOOL_USE" | "PRE_FILE_WRITE" | "PRE_COMMAND"
  | "PRE_COMMIT" | "RUN_STATUS_CHANGE" | "ERROR";

export interface HookPolicy {
  id: string;
  event: HookEvent;
  priority: number;
  mode: "enforce" | "audit" | "disabled";
  action: "allow" | "deny" | "require_approval" | "warn" | "emit_audit";
  when: {
    pathMatches?: string[];
    outsideWorkspace?: boolean;
    commandMatches?: string[];
    riskGte?: number;
    verificationNotPassed?: boolean;
  };
  message: string;
}

export interface HookContext {
  event: HookEvent;
  workspaceRoot: string;
  riskLevel: number;
  path?: string;
  command?: string;
  verificationPassed?: boolean;
  insideWorkspace?: boolean;
}

export type HookDecision =
  | { action: "allow" }
  | { action: "deny"; reason: string; code: string }
  | { action: "require_approval"; reason: string; riskLevel: number }
  | { action: "warn"; message: string }
  | { action: "emit_audit"; event: string };

// --- Routing (§13) -----------------------------------------------------------

export interface RouteRequest {
  goal: string;
  source: "chat" | "api" | "automation" | "dashboard" | "internal";
  requestedAgent?: string;
  requestedSkill?: string;
  requestedTools?: string[];
}

export interface RouteDecision {
  agentId: string;
  skillIds: string[];
  riskLevel: 0 | 1 | 2 | 3 | 4;
  approvalRequired: boolean;
  score: number;
  reasons: string[];
  rejected: Array<{ agentId: string; reasons: string[] }>;
}

// --- Run state machine (§15) ---------------------------------------------------

export type RunStatus =
  | "RECEIVED" | "ROUTING" | "PLANNED" | "QUEUED" | "RUNNING"
  | "WAITING_APPROVAL" | "VERIFYING" | "REVIEWING"
  | "DONE" | "DONE_WITH_CONCERNS" | "BLOCKED" | "FAILED" | "CANCELLED";

export const RUN_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  RECEIVED: ["ROUTING"],
  ROUTING: ["PLANNED", "BLOCKED", "FAILED"],
  PLANNED: ["QUEUED", "WAITING_APPROVAL", "BLOCKED"],
  QUEUED: ["RUNNING", "CANCELLED"],
  WAITING_APPROVAL: ["QUEUED", "CANCELLED", "BLOCKED"],
  RUNNING: ["VERIFYING", "WAITING_APPROVAL", "FAILED", "CANCELLED"],
  VERIFYING: ["REVIEWING", "RUNNING", "FAILED"],
  REVIEWING: ["DONE", "DONE_WITH_CONCERNS", "RUNNING", "BLOCKED", "FAILED"],
  DONE: [], DONE_WITH_CONCERNS: [], BLOCKED: [], FAILED: [], CANCELLED: [],
};

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ["DONE", "DONE_WITH_CONCERNS", "BLOCKED", "FAILED", "CANCELLED"];

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return RUN_TRANSITIONS[from]?.includes(to) ?? false;
}

// --- Agent result protocol (§10) -------------------------------------------------

export type AgentResultStatus = "DONE" | "DONE_WITH_CONCERNS" | "BLOCKED" | "NEEDS_CONTEXT" | "FAILED";

export interface AgentResult {
  status: AgentResultStatus;
  summary: string;
  evidence: Array<{ type: string; ref: string }>;
  concerns: Array<{ severity: "info" | "low" | "medium" | "high" | "critical"; category: string; summary: string }>;
  nextActions: string[];
  metrics: { durationMs: number };
}

export interface AgentExecutionRequest {
  runId: string;
  agentSlug: AgentSlug;
  skillSlugs: SkillSlug[];
  goal: string;
  workspaceRoot: string;
  riskLevel: number;
}

export interface AgentRuntimeAdapter {
  id: RuntimeKind;
  isAvailable(): Promise<boolean>;
  perform(request: AgentExecutionRequest): Promise<AgentResult>;
}

// --- Worktrees (§21) ----------------------------------------------------------------

export type WorktreeStatus = "ALLOCATING" | "READY" | "IN_USE" | "PRESERVED" | "RELEASED" | "ERROR";

export interface WorktreeRecord {
  id: string;
  runId: string | null;
  repoRoot: string;
  worktreePath: string;
  branchName: string | null;
  baseRevision: string | null;
  status: WorktreeStatus;
  isDirty: boolean;
  createdAt: string;
  releasedAt: string | null;
}

// --- Memory (§26) ----------------------------------------------------------------------

export type MemoryType = "decision" | "convention" | "safe_command" | "pattern" | "failure_cause" | "repo_fact" | "preference";

export interface MemoryRecord {
  id: string;
  runId: string | null;
  memoryType: MemoryType;
  scope: string;
  key: string;
  summary: string;
  confidence: number | null;
  sourceRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunRecord {
  id: string;
  workflowSlug: string;
  requestedBy: string;
  source: string;
  status: RunStatus;
  riskLevel: number;
  routeJson: string | null;
  inputSummary: string;
  outputSummary: string | null;
  concernSummary: string | null;
  approvalId: string | null;
  worktreeId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}
