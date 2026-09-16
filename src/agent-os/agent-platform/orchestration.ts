/**
 * Pao Agent Platform — orchestration: agent router, supervisor lifecycle,
 * A2A gateway with context minimization, MCP registry mapping, reviewer
 * contract, smoke-test runner (Phase 20.54 §12-14, §23-25, §34-35, §53).
 *
 * Hard constraints: hard policy limits override router score; delegation
 * depth is bounded; A2A delegation never forwards secrets, hidden system
 * prompts or unrelated memory; reviewer disagreements are preserved.
 */

import { nextId } from "./events";
import { canonicalJson } from "./governance";
import { PlatformError, type AgentCard, type A2ADelegation, type AgentManifest, type ContextType, type PlanGraph, type ReviewResult, type RouteCandidate, type RoutingFactors, type SupervisorStatus } from "./types";

// ---------------------------------------------------------------------------
// Router (§14)
// ---------------------------------------------------------------------------

export const ROUTING_WEIGHTS = {
  skillMatch: 0.3,
  capabilityMatch: 0.2,
  trustCompatibility: 0.15,
  reliability: 0.15,
  latency: 0.08,
  cost: 0.07,
  locality: 0.05,
} as const;

export function scoreCandidate(candidate: RouteCandidate, factors: RoutingFactors): number {
  const skills = new Set(candidate.skills);
  const caps = new Set(candidate.capabilities);
  const skillMatch = factors.requiredSkills.length === 0
    ? 0.5
    : factors.requiredSkills.filter(s => skills.has(s)).length / factors.requiredSkills.length;
  const capabilityMatch = factors.requiredCapabilities.length === 0
    ? 1
    : factors.requiredCapabilities.filter(c => caps.has(c)).length / factors.requiredCapabilities.length;
  const trustCompatibility = candidate.trustTier === "production" || candidate.trustTier === "internal" ? 1 : 0.6;
  const reliability = candidate.healthy ? Math.min(1, Math.max(0, candidate.evaluationScore)) : 0;
  const latency = factors.latencyBudgetMs && candidate.avgLatencyMs > 0
    ? Math.min(1, factors.latencyBudgetMs / candidate.avgLatencyMs)
    : 0.5;
  const cost = factors.costBudgetUsd && candidate.avgCostUsd >= 0
    ? (candidate.avgCostUsd <= factors.costBudgetUsd ? 1 : 0)
    : 0.5;
  const locality = factors.requireLocal ? (candidate.localOnly ? 1 : 0) : 0.5;
  return (
    skillMatch * ROUTING_WEIGHTS.skillMatch +
    capabilityMatch * ROUTING_WEIGHTS.capabilityMatch +
    trustCompatibility * ROUTING_WEIGHTS.trustCompatibility +
    reliability * ROUTING_WEIGHTS.reliability +
    latency * ROUTING_WEIGHTS.latency +
    cost * ROUTING_WEIGHTS.cost +
    locality * ROUTING_WEIGHTS.locality
  );
}

export function routeAgents(candidates: readonly RouteCandidate[], factors: RoutingFactors): Array<{ candidate: RouteCandidate; score: number }> {
  return candidates
    .map(candidate => ({ candidate, score: scoreCandidate(candidate, factors) }))
    .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Supervisor (§24) — explicit lifecycle with bounded transitions
// ---------------------------------------------------------------------------

const SUPERVISOR_TRANSITIONS: Readonly<Record<SupervisorStatus["state"], readonly SupervisorStatus["state"][]>> = {
  RECEIVED: ["ANALYZING", "CANCELLED"],
  ANALYZING: ["PLANNING", "FAILED"],
  PLANNING: ["DELEGATING", "FAILED"],
  DELEGATING: ["EXECUTING", "WAITING_APPROVAL", "FAILED"],
  EXECUTING: ["REVIEWING", "WAITING_APPROVAL", "FAILED"],
  REVIEWING: ["FINALIZING", "EXECUTING", "FAILED"],
  WAITING_APPROVAL: ["EXECUTING", "FAILED", "CANCELLED"],
  FINALIZING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export class Supervisor {
  private state: SupervisorStatus;
  private readonly states: SupervisorStatus[] = [];
  private readonly maxDelegationDepth: number;
  private delegationDepth = 0;

  constructor(options: { maxDelegationDepth?: number } = {}) {
    this.maxDelegationDepth = options.maxDelegationDepth ?? 3;
    this.state = { state: "RECEIVED", at: new Date().toISOString() };
    this.states.push(this.state);
  }

  current(): SupervisorStatus {
    return this.state;
  }

  trail(): readonly SupervisorStatus[] {
    return this.states;
  }

  transition(to: SupervisorStatus["state"]): void {
    const allowed = SUPERVISOR_TRANSITIONS[this.state.state];
    if (!allowed.includes(to)) {
      throw new PlatformError("SECURITY_VIOLATION", `Invalid supervisor transition ${this.state.state} -> ${to}`, 409);
    }
    this.state = { state: to, at: new Date().toISOString() };
    this.states.push(this.state);
  }

  enterDelegation(): void {
    this.delegationDepth += 1;
    if (this.delegationDepth > this.maxDelegationDepth) {
      throw new PlatformError("SECURITY_VIOLATION", `Delegation depth ${this.delegationDepth} exceeds the maximum ${this.maxDelegationDepth}`, 429);
    }
  }

  exitDelegation(): void {
    this.delegationDepth = Math.max(0, this.delegationDepth - 1);
  }

  /** Bounded plan validation: max steps, dependency sanity. */
  static validatePlan(plan: PlanGraph, maxSteps: number): void {
    if (plan.steps.length > maxSteps) {
      throw new PlatformError("SECURITY_VIOLATION", `Plan has ${plan.steps.length} steps; maximum is ${maxSteps}`, 422);
    }
    const ids = new Set(plan.steps.map(s => s.id));
    for (const step of plan.steps) {
      for (const dep of step.dependsOn) {
        if (!ids.has(dep)) {
          throw new PlatformError("TOOL_SCHEMA_INVALID", `Plan step ${step.id} depends on unknown step ${dep}`, 422);
        }
      }
    }
    // Cycle detection via DFS.
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (id: string): void => {
      if (done.has(id)) return;
      if (visiting.has(id)) throw new PlatformError("SECURITY_VIOLATION", `Plan dependency cycle at ${id}`, 422);
      visiting.add(id);
      const step = plan.steps.find(s => s.id === id)!;
      for (const dep of step.dependsOn) visit(dep);
      visiting.delete(id);
      done.add(id);
    };
    for (const step of plan.steps) visit(step.id);
  }
}

// ---------------------------------------------------------------------------
// A2A gateway (§13, §53)
// ---------------------------------------------------------------------------

export function buildAgentCard(manifest: AgentManifest, url: string): AgentCard {
  return {
    name: manifest.metadata.name,
    description: manifest.spec.description,
    url,
    version: manifest.metadata.version,
    skills: (manifest.spec.capabilities.required ?? []).map(id => ({
      id,
      name: id,
      description: `Capability ${id}`,
    })),
    capabilities: { streaming: false, artifacts: true, pushNotifications: false },
    pao: {
      trustTier: manifest.metadata.labels?.trust_tier ?? "standard",
      policyProfile: manifest.metadata.labels?.policy_profile ?? "default",
    },
  };
}

const SECRET_SHAPES = /sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;

/**
 * Context minimization before delegation (§53): strip secret-shaped material,
 * drop POLICY/SYSTEM items (hidden runtime prompts never leave the trust
 * boundary), and attach provenance.
 */
export function minimizeForDelegation(
  items: ReadonlyArray<{ type: string; content: unknown }>,
  taskSummary: string,
): A2ADelegation {
  const context: Array<{ type: ContextType; content: string }> = [];
  const provenance: string[] = [];
  for (const item of items) {
    if (item.type === "POLICY" || item.type === "SYSTEM" || item.type === "APPROVAL") {
      continue; // hidden runtime prompts and approvals never leave
    }
    const text = typeof item.content === "string" ? item.content : canonicalJson(item.content);
    if (SECRET_SHAPES.test(text)) continue;
    if (text.trim() === "") continue;
    context.push({ type: item.type as ContextType, content: text.slice(0, 2_000) });
    provenance.push(`${item.type}:${nextId("prov")}`);
  }
  return {
    delegationId: nextId("a2a"),
    toAgent: "",
    taskSummary,
    context,
    provenance,
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// MCP registry mapping (§12) — registry + capability mapping + policy hook.
// The MCP wire protocol itself is delegated to existing runtime infrastructure.
// ---------------------------------------------------------------------------

export interface McpServerRecord {
  readonly id: string;
  readonly endpoint: string;
  readonly enabled: boolean;
  readonly trust: "internal" | "external";
  readonly tools: ReadonlyArray<{ readonly toolId: string; readonly mappedCapability: string }>;
}

export class McpRegistry {
  private readonly servers = new Map<string, McpServerRecord>();

  register(record: McpServerRecord): void {
    this.servers.set(record.id, record);
  }

  get(id: string): McpServerRecord | undefined {
    return this.servers.get(id);
  }

  list(): McpServerRecord[] {
    return [...this.servers.values()];
  }

  /**
   * Resolve a tool to its mapped capability. A connected MCP server NEVER
   * grants permission implicitly: an unmapped tool resolves to null and the
   * caller must deny.
   */
  resolveCapability(serverId: string, toolId: string): string | null {
    const server = this.servers.get(serverId);
    if (!server || !server.enabled) return null;
    return server.tools.find(t => t.toolId === toolId)?.mappedCapability ?? null;
  }
}

// ---------------------------------------------------------------------------
// Reviewer contract + council aggregation (§25)
// ---------------------------------------------------------------------------

export function aggregateReviews(reviews: readonly ReviewResult[]): {
  consensus: "pass" | "pass_with_notes" | "fail" | "uncertain";
  reviews: readonly ReviewResult[];
  disagreements: readonly string[];
  requiredActions: readonly string[];
} {
  const requiredActions = reviews.flatMap(r => r.requiredActions);
  const disagreements: string[] = [];
  const failVerdicts = reviews.filter(r => r.verdict === "fail");
  const passVerdicts = reviews.filter(r => r.verdict === "pass" || r.verdict === "pass_with_notes");
  const criticalSafety = reviews.flatMap(r => r.findings.filter(f => f.severity === "critical" && (f.dimension === "security" || f.dimension === "privacy")));

  // Preserve disagreements: do NOT average minority safety concerns away.
  if (failVerdicts.length > 0 && passVerdicts.length > 0) {
    disagreements.push(
      `reviewers disagree: ${failVerdicts.map(r => r.reviewerId).join(", ")} fail; ${passVerdicts.map(r => r.reviewerId).join(", ")} pass`,
    );
  }
  let consensus: ReturnType<typeof aggregateReviews>["consensus"];
  if (failVerdicts.length > 0 || criticalSafety.length > 0) consensus = "fail";
  else if (reviews.every(r => r.verdict === "pass")) consensus = "pass";
  else if (reviews.every(r => r.verdict === "uncertain")) consensus = "uncertain";
  else consensus = "pass_with_notes";
  return { consensus, reviews, disagreements, requiredActions: [...new Set(requiredActions)] };
}

// ---------------------------------------------------------------------------
// Smoke-test runner (§35)
// ---------------------------------------------------------------------------

export interface SmokeAssertion {
  readonly containsAll?: readonly string[];
  readonly containsNone?: readonly string[];
  readonly toolUsedAny?: readonly string[];
  readonly toolNotExecuted?: readonly string[];
  readonly policyDecisionAny?: readonly string[];
}

export interface SmokeTest {
  readonly id: string;
  readonly prompt: string;
  readonly assertions: SmokeAssertion;
}

export interface SmokeRunResult {
  readonly testId: string;
  readonly passed: boolean;
  readonly failures: readonly string[];
}

export interface SmokeTarget {
  run(prompt: string): Promise<{ response: string; toolsUsed: readonly string[]; policyDecisions: readonly string[] }>;
}

export async function runSmokeSuite(
  suite: { suite: string; tests: readonly SmokeTest[] },
  target: SmokeTarget,
): Promise<{ suite: string; passed: boolean; results: readonly SmokeRunResult[] }> {
  const results: SmokeRunResult[] = [];
  for (const test of suite.tests) {
    const failures: string[] = [];
    const run = await target.run(test.prompt);
    if (test.assertions.containsAll) {
      for (const needle of test.assertions.containsAll) {
        if (!run.response.includes(needle)) failures.push(`missing text: ${needle}`);
      }
    }
    if (test.assertions.containsNone) {
      for (const needle of test.assertions.containsNone) {
        if (run.response.includes(needle)) failures.push(`forbidden text present: ${needle}`);
      }
    }
    if (test.assertions.toolUsedAny && !test.assertions.toolUsedAny.some(t => run.toolsUsed.includes(t))) {
      failures.push(`expected one of tools: ${test.assertions.toolUsedAny.join(", ")}`);
    }
    if (test.assertions.toolNotExecuted) {
      for (const tool of test.assertions.toolNotExecuted) {
        if (run.toolsUsed.includes(tool)) failures.push(`forbidden tool executed: ${tool}`);
      }
    }
    if (test.assertions.policyDecisionAny && !test.assertions.policyDecisionAny.some(d => run.policyDecisions.includes(d))) {
      failures.push(`expected policy decision among: ${test.assertions.policyDecisionAny.join(", ")}`);
    }
    results.push({ testId: test.id, passed: failures.length === 0, failures });
  }
  return { suite: suite.suite, passed: results.every(r => r.passed), results };
}
