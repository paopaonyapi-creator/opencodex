/**
 * Pao Agent Platform — pattern registry, capability registry, manifest
 * validation (Phase 20.54 §5-9, §58).
 */

import type {
  AgentManifest,
  CapabilityRecord,
  ManifestValidationIssue,
  PatternRecord,
  RiskLevel,
} from "./types";

// ---------------------------------------------------------------------------
// Pattern registry (§6-7) — the ten minimum patterns
// ---------------------------------------------------------------------------

export const PATTERNS: Readonly<Record<string, PatternRecord>> = {
  "tool-use": {
    id: "tool-use",
    version: "1.0.0",
    category: "execution",
    description: "Agent resolves capabilities through the governed tool pipeline and consumes typed results.",
    recommendedFor: ["single_agent_tasks", "external_actions"],
    antiPatterns: ["unbounded_tool_loops"],
    requiredComponents: ["capability_resolver", "policy_engine", "tool_executor"],
    limits: { max_tool_calls: 30 },
    requiredEvents: ["tool.requested", "policy.decided", "tool.completed"],
  },
  rag: {
    id: "rag",
    version: "1.0.0",
    category: "execution",
    description: "Query planning, governed retrieval, evidence ranking and grounded answers.",
    recommendedFor: ["knowledge_tasks", "evidence_grounded_answers"],
    antiPatterns: ["ungrounded_claims"],
    requiredComponents: ["retrieval", "context_compiler"],
    limits: { max_retrievals: 10 },
    requiredEvents: ["context.compiled"],
  },
  "planner-worker": {
    id: "planner-worker",
    version: "1.0.0",
    category: "orchestration",
    description: "Planner emits a typed task graph; workers execute; planner re-plans within limits.",
    recommendedFor: ["complex_multi_step_tasks", "tasks_requiring_replanning"],
    antiPatterns: ["trivial_single_tool_call"],
    requiredComponents: ["planner", "task_graph", "worker_executor", "completion_checker"],
    limits: { max_replans: 3, max_steps: 30 },
    requiredEvents: ["plan.created", "task.started", "task.completed", "plan.revised"],
  },
  router: {
    id: "router",
    version: "1.0.0",
    category: "orchestration",
    description: "Structured routing of requests to specialized agents by skills, policy, cost and health.",
    recommendedFor: ["multi_agent_fleets"],
    antiPatterns: ["routing_on_prompt_similarity_alone"],
    requiredComponents: ["agent_registry", "routing_scorer"],
    limits: { max_candidates: 20 },
    requiredEvents: ["agent.started"],
  },
  supervisor: {
    id: "supervisor",
    version: "1.0.0",
    category: "orchestration",
    description: "Owns decomposition, delegation, conflict handling and completion criteria.",
    recommendedFor: ["long_running_goals"],
    antiPatterns: ["unbounded_delegation_depth"],
    requiredComponents: ["planner", "agent_router", "artifact_aggregator"],
    limits: { max_delegation_depth: 3, max_fanout: 5 },
    requiredEvents: ["task.started", "task.completed"],
  },
  reviewer: {
    id: "reviewer",
    version: "1.0.0",
    category: "review",
    description: "Produces structured review verdicts; never silently rewrites worker output.",
    recommendedFor: ["quality_gates", "safety_review"],
    antiPatterns: ["reviewer_as_silent_editor"],
    requiredComponents: ["review_contract", "aggregator"],
    limits: { max_reviewers: 6 },
    requiredEvents: ["review.completed"],
  },
  reflection: {
    id: "reflection",
    version: "1.0.0",
    category: "review",
    description: "Agent reviews its own result against explicit criteria before returning or escalating.",
    recommendedFor: ["quality_critical_tasks"],
    antiPatterns: ["reflection_loops"],
    requiredComponents: ["criteria_checker"],
    limits: { max_iterations: 2 },
    requiredEvents: ["review.completed"],
  },
  "multi-agent": {
    id: "multi-agent",
    version: "1.0.0",
    category: "orchestration",
    description: "Reviewer council with structured disagreement preservation.",
    recommendedFor: ["high_stakes_decisions"],
    antiPatterns: ["averaging_away_safety_concerns"],
    requiredComponents: ["review_contract", "aggregator"],
    limits: { max_reviewers: 6 },
    requiredEvents: ["review.completed"],
  },
  "computer-use": {
    id: "computer-use",
    version: "1.0.0",
    category: "execution",
    description: "Browser/desktop actions with action previews, domain allowlists and destructive confirmation.",
    recommendedFor: ["browser_automation"],
    antiPatterns: ["unconfirmed_destructive_actions"],
    requiredComponents: ["action_classifier", "policy_engine", "approval_gate"],
    limits: { max_actions: 40 },
    requiredEvents: ["tool.requested", "policy.decided"],
  },
  "local-agent": {
    id: "local-agent",
    version: "1.0.0",
    category: "execution",
    description: "Offline/degraded mode restricted to local models, knowledge and tools.",
    recommendedFor: ["provider_outages", "data_residency"],
    antiPatterns: ["silent_policy_bypass"],
    requiredComponents: ["local_model_adapter"],
    limits: { max_tool_calls: 15 },
    requiredEvents: ["agent.started", "agent.completed"],
  },
};

export function listPatterns(): PatternRecord[] {
  return Object.values(PATTERNS);
}

// ---------------------------------------------------------------------------
// Capability registry (§8-9) — default catalog with risk defaults
// ---------------------------------------------------------------------------

function cap(
  id: string,
  description: string,
  riskLevel: RiskLevel,
  mutability: CapabilityRecord["mutability"],
  approvalDefault: CapabilityRecord["approvalDefault"],
  extra: Partial<CapabilityRecord> = {},
): CapabilityRecord {
  return {
    id,
    description,
    riskLevel,
    mutability,
    dataSensitivity: extra.dataSensitivity ?? "internal",
    approvalDefault,
    sandboxRequired: extra.sandboxRequired ?? (riskLevel >= "R2"),
    rollbackSupported: extra.rollbackSupported ?? mutability !== "external_irreversible",
    receiptRequired: extra.receiptRequired ?? (riskLevel === "R3" || riskLevel === "R4"),
  };
}

export const DEFAULT_CAPABILITIES: Readonly<Record<string, CapabilityRecord>> = {
  "knowledge.search": cap("knowledge.search", "Search approved knowledge sources", "R0", "read_only", "none", { sandboxRequired: false }),
  "memory.read": cap("memory.read", "Read governed agent memory", "R0", "read_only", "none", { sandboxRequired: false, dataSensitivity: "confidential" }),
  "memory.write": cap("memory.write", "Write governed agent memory (gated)", "R1", "local_reversible", "policy", { sandboxRequired: false }),
  "filesystem.read": cap("filesystem.read", "Read files within workspace scope", "R0", "read_only", "none", { sandboxRequired: false }),
  "filesystem.write": cap("filesystem.write", "Write files within workspace scope", "R1", "local_reversible", "policy"),
  "filesystem.delete": cap("filesystem.delete", "Delete files", "R4", "external_irreversible", "required", { rollbackSupported: false, dataSensitivity: "confidential" }),
  "shell.execute": cap("shell.execute", "Execute shell commands in a sandbox", "R3", "external_reversible", "required", { dataSensitivity: "confidential" }),
  "network.http.read": cap("network.http.read", "HTTP GET against allowlisted domains", "R1", "read_only", "policy"),
  "network.http.write": cap("network.http.write", "HTTP POST/PUT against allowlisted domains", "R3", "external_reversible", "required"),
  "browser.navigate": cap("browser.navigate", "Navigate the governed browser", "R1", "read_only", "policy"),
  "browser.submit": cap("browser.submit", "Submit forms in the governed browser", "R3", "external_reversible", "required"),
  "email.send": cap("email.send", "Send email", "R3", "external_irreversible", "required", { rollbackSupported: false }),
  "git.read": cap("git.read", "Read repository state", "R0", "read_only", "none", { sandboxRequired: false }),
  "git.commit": cap("git.commit", "Commit locally", "R2", "local_reversible", "policy"),
  "git.push": cap("git.push", "Push to remote", "R3", "external_reversible", "required"),
  "deploy.preview": cap("deploy.preview", "Deploy a preview environment", "R2", "external_reversible", "policy"),
  "deploy.production": cap("deploy.production", "Deploy to production", "R4", "external_irreversible", "required", { rollbackSupported: false, dataSensitivity: "confidential" }),
  "secrets.read": cap("secrets.read", "Read secrets", "R4", "read_only", "required", { sandboxRequired: false, dataSensitivity: "secret", rollbackSupported: false }),
  "purchase.execute": cap("purchase.execute", "Execute purchases", "R4", "external_irreversible", "required", { rollbackSupported: false, dataSensitivity: "secret" }),
  "system.restart": cap("system.restart", "Restart system services", "R4", "external_irreversible", "required", { rollbackSupported: false }),
};

export class CapabilityRegistry {
  private readonly capabilities = new Map<string, CapabilityRecord>();

  constructor(records: readonly CapabilityRecord[] = Object.values(DEFAULT_CAPABILITIES)) {
    for (const record of records) this.capabilities.set(record.id, record);
  }

  register(record: CapabilityRecord): void {
    this.capabilities.set(record.id, record);
  }

  get(id: string): CapabilityRecord | undefined {
    return this.capabilities.get(id);
  }

  list(): CapabilityRecord[] {
    return [...this.capabilities.values()];
  }
}

// ---------------------------------------------------------------------------
// Manifest validation (§58)
// ---------------------------------------------------------------------------

const SEMVER = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;

export function validateManifest(
  manifest: unknown,
  capabilities: CapabilityRegistry,
  opts: { readonly knownAgentIds?: ReadonlySet<string> } = {},
): ManifestValidationIssue[] {
  const issues: ManifestValidationIssue[] = [];
  const m = manifest as AgentManifest | null;

  if (!m || typeof m !== "object") {
    return [{ code: "MANIFEST_INVALID", message: "manifest is not an object" }];
  }
  if (m.apiVersion !== "pao.ai/v1") issues.push({ code: "MANIFEST_API_VERSION", message: "apiVersion must be pao.ai/v1" });
  if (m.kind !== "Agent") issues.push({ code: "MANIFEST_KIND", message: "kind must be Agent" });

  const meta = m.metadata;
  if (!meta?.id || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(meta.id)) {
    issues.push({ code: "MANIFEST_ID_INVALID", message: "metadata.id must be kebab-case (3-64 chars)" });
  }
  if (opts.knownAgentIds?.has(meta?.id ?? "")) {
    issues.push({ code: "MANIFEST_DUPLICATE_ID", message: `duplicate agent id: ${meta?.id}` });
  }
  if (!meta?.version || !SEMVER.test(meta.version)) {
    issues.push({ code: "MANIFEST_VERSION_INVALID", message: "metadata.version must be semantic version" });
  }
  if (!meta?.owner) issues.push({ code: "MANIFEST_OWNER_MISSING", message: "metadata.owner is required" });

  const spec = m.spec;
  if (!spec) {
    issues.push({ code: "MANIFEST_SPEC_MISSING", message: "spec is required" });
    return issues;
  }

  // Patterns must be known.
  for (const pattern of spec.patterns ?? []) {
    if (!PATTERNS[pattern]) {
      issues.push({ code: "MANIFEST_UNKNOWN_PATTERN", message: `unknown pattern: ${pattern}` });
    }
  }

  // Capabilities must be registered; privileged ones need a security profile.
  const caps = [...(spec.capabilities?.required ?? []), ...(spec.capabilities?.optional ?? [])];
  for (const id of caps) {
    const record = capabilities.get(id);
    if (!record) {
      issues.push({ code: "MANIFEST_UNKNOWN_CAPABILITY", message: `unknown capability: ${id}` });
      continue;
    }
    const privileged = record.riskLevel === "R3" || record.riskLevel === "R4";
    if (privileged && (!spec.security || spec.security.sandbox === "none")) {
      issues.push({
        code: "MANIFEST_PRIVILEGED_WITHOUT_SECURITY",
        message: `privileged capability ${id} requires a security sandbox profile`,
      });
    }
  }

  // Runtime limits: positive, bounded.
  const runtime = spec.runtime;
  if (!runtime) {
    issues.push({ code: "MANIFEST_RUNTIME_MISSING", message: "spec.runtime is required" });
  } else {
    if (!(runtime.timeoutSeconds > 0)) issues.push({ code: "MANIFEST_NEGATIVE_LIMIT", message: "timeout_seconds must be positive" });
    if (!(runtime.maxSteps > 0)) issues.push({ code: "MANIFEST_NEGATIVE_LIMIT", message: "max_steps must be positive" });
    if (!(runtime.maxToolCalls > 0)) issues.push({ code: "MANIFEST_NEGATIVE_LIMIT", message: "max_tool_calls must be positive" });
  }

  // Context budget: positive tokens.
  const context = spec.context;
  if (!context || !(context.maxTokens > 0)) {
    issues.push({ code: "MANIFEST_CONTEXT_BUDGET_INVALID", message: "spec.context.maxTokens must be positive" });
  }

  // A2A exposure requires trust settings (labels carry trust tier).
  if (spec.protocols?.a2a?.enabled && spec.protocols.a2a.exposeAgentCard && !meta.labels?.trust_tier) {
    issues.push({ code: "MANIFEST_A2A_WITHOUT_TRUST", message: "A2A agent-card exposure requires a trust_tier label" });
  }

  // Production-tier agents need an evaluation suite.
  if (meta.labels?.trust_tier === "production" && !spec.evaluation?.suite) {
    issues.push({ code: "MANIFEST_EVALUATION_MISSING", message: "production-tier agents must declare an evaluation suite" });
  }

  return issues;
}
