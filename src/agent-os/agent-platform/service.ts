/**
 * Pao Agent Platform — service composition + audit ledger (Phase 20.54).
 *
 * Wires registry, capabilities, policy, approvals, executor, receipts,
 * compiler, memory gateway, orchestration and smoke evaluation behind one
 * governed flow:
 *
 *   task -> route -> compile context -> plan -> for each step:
 *     policy -> approval (if required) -> secure executor -> receipt -> audit
 *
 * Audit events are append-oriented JSONL under data/agent-platform/.
 * Error messages are static strings; structured details (ids, capability
 * names, approval ids) go to the audit ledger, never into interpolated
 * exception text.
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CapabilityRegistry, PATTERNS, listPatterns, validateManifest } from "./registry";
import { PolicyEngine, ScopedApprovalService, argumentsHash as computeArgumentsHash } from "./governance";
import { ReceiptService, SecureToolExecutor, nextId, sha256Hex, type ExecutorSandbox, type ToolImplementation } from "./execution";
import { ContextCompiler, NoopMemoryAdapter, type MemoryGateway, type MemoryWriteRequest } from "./context-memory";
import { McpRegistry, Supervisor, aggregateReviews, buildAgentCard, routeAgents, runSmokeSuite, type McpServerRecord, type SmokeTest } from "./orchestration";
import { PlatformError, type AgentManifest, type CompiledContextPackage, type ContextItem, type PolicyInput, type ReceiptRecord, type ReviewResult, type RouteCandidate, type ToolExecutionResult } from "./types";

const AUDIT_DIR = "data/agent-platform";

export interface AgentPlatformOptions {
  readonly sandbox: ExecutorSandbox;
  readonly tools: Readonly<Record<string, ToolImplementation>>;
  readonly approvalsExpiryMinutes?: number;
  readonly canApprove?: (actorId: string) => boolean;
  readonly receiptsEnabled?: boolean;
  readonly rootDir?: string;
  readonly memory?: MemoryGateway;
}

export interface RegisteredAgent {
  readonly manifest: AgentManifest;
  readonly registeredAt: string;
  readonly enabled: boolean;
}

export class AgentPlatform {
  readonly capabilities: CapabilityRegistry;
  readonly policy: PolicyEngine;
  readonly approvals: ScopedApprovalService;
  readonly receipts: ReceiptService;
  readonly executor: SecureToolExecutor;
  readonly memory: MemoryGateway;
  readonly mcp: McpRegistry;
  private readonly agents = new Map<string, RegisteredAgent>();
  private readonly auditDir: string;
  private readonly canApprove: (actorId: string) => boolean;

  constructor(options: AgentPlatformOptions) {
    this.capabilities = new CapabilityRegistry();
    this.policy = new PolicyEngine();
    this.canApprove = options.canApprove ?? (actorId => actorId === "admin");
    this.approvals = new ScopedApprovalService({
      expiryMinutes: options.approvalsExpiryMinutes ?? 30,
      canApprove: this.canApprove,
    });
    this.receipts = new ReceiptService({ enabled: options.receiptsEnabled ?? true });
    this.executor = new SecureToolExecutor({ sandbox: options.sandbox, tools: options.tools });
    this.memory = options.memory ?? new NoopMemoryAdapter();
    this.mcp = new McpRegistry();
    this.auditDir = join(options.rootDir ?? ".", AUDIT_DIR);
  }

  // ---------------------------------------------------------------------------
  // Registry
  // ---------------------------------------------------------------------------

  registerAgent(manifest: AgentManifest): RegisteredAgent {
    const issues = validateManifest(manifest, this.capabilities, { knownAgentIds: new Set(this.agents.keys()) });
    if (issues.length > 0) {
      const detail = issues.map(i => i.code).join(",");
      throw new PlatformError("AGENT_NOT_FOUND", "Manifest invalid, failed checks: " + detail, 422);
    }
    const registered: RegisteredAgent = { manifest, registeredAt: new Date().toISOString(), enabled: true };
    this.agents.set(manifest.metadata.id, registered);
    this.audit("agent.registered", undefined, { agentId: manifest.metadata.id, version: manifest.metadata.version });
    return registered;
  }

  getAgent(id: string): RegisteredAgent | undefined {
    return this.agents.get(id);
  }

  listAgents(): RegisteredAgent[] {
    return [...this.agents.values()];
  }

  setAgentEnabled(id: string, enabled: boolean): void {
    const agent = this.agents.get(id);
    if (!agent) throw new PlatformError("AGENT_NOT_FOUND", "AGENT_NOT_FOUND", 404);
    this.agents.set(id, { ...agent, enabled });
  }

  listPatterns() {
    return listPatterns();
  }

  listCapabilities() {
    return this.capabilities.list();
  }

  listMcpServers(): McpServerRecord[] {
    return this.mcp.list();
  }

  registerMcpServer(record: McpServerRecord): void {
    this.mcp.register(record);
  }

  agentCard(id: string, url: string) {
    const agent = this.agents.get(id);
    if (!agent) throw new PlatformError("AGENT_NOT_FOUND", "AGENT_NOT_FOUND", 404);
    return buildAgentCard(agent.manifest, url);
  }

  // ---------------------------------------------------------------------------
  // Governed capability pipeline (the spec §2.9 required path)
  // ---------------------------------------------------------------------------

  async runCapability(input: {
    taskId: string;
    agentId: string;
    capability: string;
    toolId: string;
    args: Readonly<Record<string, unknown>>;
    resource?: string;
    environment?: "development" | "staging" | "production";
    sandboxAllowed?: boolean;
    approvalId?: string;
  }): Promise<{ result: ToolExecutionResult; approvalId?: string; receipt?: ReceiptRecord | null; policyDecisionId: string }> {
    const agent = this.agents.get(input.agentId);
    if (!agent) throw new PlatformError("AGENT_NOT_FOUND", "AGENT_NOT_FOUND", 404);
    if (!agent.enabled) throw new PlatformError("AGENT_DISABLED", "AGENT_DISABLED", 403);

    const capability = this.capabilities.get(input.capability);
    if (!capability) throw new PlatformError("CAPABILITY_MISSING", "CAPABILITY_MISSING", 404);

    const { taskId, agentId, capability: capabilityId, toolId } = input;
    const argsHash = computeArgumentsHash(input.args);
    const existingApproval = input.approvalId ? this.approvals.get(input.approvalId) : undefined;
    if (input.approvalId && (!existingApproval || existingApproval.taskId !== taskId)) {
      throw new PlatformError("APPROVAL_EXPIRED", "APPROVAL_EXPIRED", 403);
    }
    if (existingApproval && (existingApproval.consumed || existingApproval.status === "executed")) {
      throw new PlatformError("SECURITY_VIOLATION", "SECURITY_VIOLATION", 403, { reasonCode: "POLICY_APPROVAL_REPLAY_BLOCKED" });
    }
    const policyInput: PolicyInput = {
      actor: agentId,
      taskId,
      capability: capabilityId,
      tool: toolId,
      resource: input.resource,
      argumentsHash: argsHash,
      risk: capability.riskLevel,
      environment: input.environment ?? "development",
      approvalContext: this.approvals.approvalContext(existingApproval),
    };
    const decision = this.policy.decide(policyInput);
    const policyDecisionId = nextId("pd");
    this.audit("policy.decided", taskId, { agentId, capability: capabilityId, decision: decision.decision, reasonCode: decision.reasonCode, policyDecisionId });

    let approvalId: string | undefined;
    if (decision.reasonCode === "POLICY_APPROVAL_REPLAY_BLOCKED" || decision.reasonCode === "POLICY_APPROVAL_MISMATCH") {
      throw new PlatformError("SECURITY_VIOLATION", "SECURITY_VIOLATION", 403, { reasonCode: decision.reasonCode });
    }
    if (decision.decision === "DENY") {
      const denied: ToolExecutionResult = {
        toolCallId: nextId("tc"),
        status: "denied",
        errorCode: "POLICY_DENIED",
        result: decision.reason,
        resultHash: sha256Hex(decision.reason),
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      return { result: denied, policyDecisionId };
    }
    if (decision.decision === "REQUIRE_REVIEW") {
      throw new PlatformError("POLICY_DENIED", "POLICY_DENIED", 403, { reasonCode: decision.reasonCode });
    }
    if (decision.decision === "REQUIRE_APPROVAL") {
      const pending = this.approvals.request({
        taskId,
        agentId,
        capabilityId,
        target: input.resource,
        argumentsHash: argsHash,
        riskLevel: capability.riskLevel,
        expectedSideEffect: capabilityId,
        rollbackAvailable: capability.rollbackSupported,
      });
      this.audit("approval.requested", taskId, { approvalId: pending.id, capability: capabilityId, risk: capability.riskLevel, target: input.resource });
      throw new PlatformError("APPROVAL_REQUIRED", "APPROVAL_REQUIRED", 202, { approvalId: pending.id, taskId, capability: capabilityId });
    }

    // Approved path: verify the approval is still live before dispatching.
    if (decision.reasonCode === "POLICY_APPROVAL_APPLIED") {
      approvalId = decision.policyId.slice("approval-".length);
      const record = this.approvals.get(approvalId);
      if (!record || record.status !== "approved") {
        throw new PlatformError("APPROVAL_EXPIRED", "APPROVAL_EXPIRED", 403);
      }
    }

    const result = await this.executor.dispatch(
      {
        toolCallId: nextId("tc"),
        taskId,
        agentId,
        toolId,
        capability: capabilityId,
        arguments: input.args,
        argumentsHash: argsHash,
        sandboxProfile: decision.decision === "ALLOW_WITH_SANDBOX" || capability.sandboxRequired ? ("workspace-write" as const) : ("read-only" as const),
        requestedAt: new Date().toISOString(),
        policyDecisionId,
        approvalId,
      },
      input.sandboxAllowed ?? true,
    );

    if (result.status === "success" && approvalId) {
      this.approvals.markConsumed(approvalId, capability.riskLevel);
    }

    // Receipts for R3/R4 (privileged) actions.
    const receipt: ReceiptRecord | null =
      result.status === "success" && capability.receiptRequired
        ? this.receipts.createReceipt({
            taskId,
            agentId,
            action: capabilityId,
            target: input.resource,
            argumentsHash: argsHash,
            policyDecision: decision.decision,
            approvalId,
            result: result.status,
            resultHash: result.resultHash,
          })
        : null;
    if (receipt) {
      this.audit("receipt.created", taskId, { receiptId: receipt.payload.receiptId, capability: capabilityId });
    }

    this.audit("tool.executed", taskId, { toolCallId: result.toolCallId, status: result.status, capability: capabilityId, errorCode: result.errorCode });
    return { result, approvalId, receipt, policyDecisionId };
  }

  // ---------------------------------------------------------------------------
  // Context compilation + memory
  // ---------------------------------------------------------------------------

  compileContext(items: readonly ContextItem[], totalTokens: number): CompiledContextPackage {
    const compiler = new ContextCompiler({
      budget: {
        totalTokens,
        reserveOutputTokens: Math.floor(totalTokens * 0.12),
        allocations: {
          POLICY: 0.1, SYSTEM: 0.05, TASK: 0.07, USER: 0.05, PROJECT: 0.12,
          MEMORY: 0.15, KNOWLEDGE: 0.22, TOOLS: 0.1, PLAN: 0.06, EXECUTION_RESULT: 0.08,
        },
      },
    });
    const compiled = compiler.compile(items);
    this.audit("context.compiled", undefined, { totalTokens: compiled.totalTokens, dropped: compiled.dropped.length, compressed: compiled.compressed.length });
    return compiled;
  }

  async writeMemory(request: MemoryWriteRequest) {
    const outcome = await this.memory.write(request);
    this.audit("memory.write", request.taskId, { decision: outcome.gate.decision, reason: outcome.gate.reason, memoryType: request.memoryType });
    return outcome;
  }

  // ---------------------------------------------------------------------------
  // Orchestration
  // ---------------------------------------------------------------------------

  route(factors: Parameters<typeof routeAgents>[1]) {
    const candidates: RouteCandidate[] = this.listAgents()
      .filter(a => a.enabled)
      .map(a => ({
        agentId: a.manifest.metadata.id,
        skills: a.manifest.metadata.labels?.domain ? [a.manifest.metadata.labels.domain] : [],
        capabilities: [...a.manifest.spec.capabilities.required],
        trustTier: a.manifest.metadata.labels?.trust_tier ?? "standard",
        modelsAvailable: true,
        healthy: true,
        avgLatencyMs: 0,
        avgCostUsd: 0,
        localOnly: a.manifest.spec.patterns.includes("local-agent"),
        evaluationScore: 0.7,
      }));
    return routeAgents(candidates, factors);
  }

  async runReview(reviewers: ReadonlyArray<{ reviewerId: string; review: () => Promise<ReviewResult> | ReviewResult }>): Promise<ReturnType<typeof aggregateReviews>> {
    const results: ReviewResult[] = [];
    for (const reviewer of reviewers) {
      results.push(await reviewer.review());
    }
    const aggregated = aggregateReviews(results);
    this.audit("review.completed", undefined, { consensus: aggregated.consensus, disagreements: aggregated.disagreements.length });
    return aggregated;
  }

  async runSmokeSuite(suite: { suite: string; tests: readonly SmokeTest[] }, target: Parameters<typeof runSmokeSuite>[1]) {
    const report = await runSmokeSuite(suite, target);
    this.audit("evaluation.completed", undefined, { suite: suite.suite, passed: report.passed });
    return report;
  }

  validateManifest(manifest: unknown) {
    return validateManifest(manifest, this.capabilities, { knownAgentIds: new Set(this.agents.keys()) });
  }

  // ---------------------------------------------------------------------------
  // Audit ledger (append-oriented JSONL; secrets never enter payloads)
  // ---------------------------------------------------------------------------

  private audit(eventType: string, taskId: string | undefined, payload: Record<string, unknown>): void {
    try {
      const record = {
        id: nextId("apx"),
        eventType,
        taskId: taskId ?? null,
        payload,
        createdAt: new Date().toISOString(),
      };
      mkdirSync(dirname(join(this.auditDir, "audit.jsonl")), { recursive: true });
      appendFileSync(join(this.auditDir, "audit.jsonl"), JSON.stringify(record) + "\n", "utf-8");
    } catch {
      // Audit failures surface through health, never break execution.
    }
  }

  patternCatalog() {
    return Object.keys(PATTERNS);
  }

  bootstrapReferenceAgents(): RegisteredAgent[] {
    const registered: RegisteredAgent[] = [];
    for (const manifest of loadReferenceAgentManifests()) {
      if (this.agents.has(manifest.metadata.id)) continue;
      registered.push(this.registerAgent(manifest));
    }
    return registered;
  }

  resolveApproval(id: string, actorId: string, decision: "approved" | "rejected") {
    const record = this.approvals.resolve(id, actorId, decision);
    this.audit("approval.resolved", record.taskId, { approvalId: id, decision, actorId });
    return record;
  }

  listApprovals() {
    return this.approvals.listAll();
  }

  listReceipts(agentId?: string) {
    return this.receipts.list(agentId);
  }

  verifyReceipt(record: ReceiptRecord) {
    return this.receipts.verifyReceipt(record);
  }

  verifyReceiptChain(agentId: string) {
    return this.receipts.verifyChain(agentId);
  }

  readAudit(limit = 100): Array<Record<string, unknown>> {
    try {
      const text = readFileSync(join(this.auditDir, "audit.jsonl"), "utf-8");
      const lines = text.trim().length === 0 ? [] : text.trim().split("\n");
      return lines.slice(-limit).map(line => JSON.parse(line) as Record<string, unknown>);
    } catch {
      return [];
    }
  }
}

// Supervisor is re-exported for orchestration consumers.
export { Supervisor };

export function loadReferenceAgentManifests(): AgentManifest[] {
  const path = join(dirname(fileURLToPath(import.meta.url)), "reference-agents.json");
  const parsed = JSON.parse(readFileSync(path, "utf-8")) as { agents: AgentManifest[] };
  return parsed.agents ?? [];
}

let platformSingleton: AgentPlatform | null = null;

export function getAgentPlatform(options?: Partial<AgentPlatformOptions>): AgentPlatform {
  if (!platformSingleton) {
    platformSingleton = new AgentPlatform({
      sandbox: options?.sandbox ?? {
        allowedPaths: [process.cwd().replace(/\\/g, "/")],
        maxOutputChars: 20_000,
        timeoutMs: 15_000,
        denyShellMetacharacters: true,
        allowedCommandPrefixes: [],
      },
      tools: options?.tools ?? {
        "knowledge.search": () => ({ hits: [] }),
        "filesystem.read": () => ({ skipped: true, reason: "read-only stub" }),
        "git.read": () => ({ skipped: true, reason: "read-only stub" }),
        "memory.read": () => ({ items: [] }),
      },
      canApprove: options?.canApprove ?? (actor => actor === "admin" || actor === "supervisor"),
      receiptsEnabled: options?.receiptsEnabled ?? true,
      rootDir: options?.rootDir,
      memory: options?.memory,
      approvalsExpiryMinutes: options?.approvalsExpiryMinutes,
    });
    platformSingleton.bootstrapReferenceAgents();
  }
  return platformSingleton;
}

export function resetAgentPlatformForTests(): void {
  platformSingleton = null;
}
