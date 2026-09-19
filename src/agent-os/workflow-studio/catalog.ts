// Phase 20.93 — Workflow node catalog (pure functions over a definition list).
//
// SECURITY NOTE: definitions are source-code constants; nothing here touches
// SQL, shell, subprocess, or the filesystem.

import { WorkflowStudioError, type WorkflowNodeDefinition } from "./types";

let defs: WorkflowNodeDefinition[] = [];
let builtInsInstalled = false;

/**
 * Lazily install the built-in node definitions. Deferred (rather than a static
 * import) so catalog.ts stays free of an import cycle with built-in.ts, which
 * imports the executors in nodes.ts.
 */
function ensureBuiltIns(): void {
  if (builtInsInstalled) return;
  builtInsInstalled = true;
  const { BUILT_IN_NODES } = require("./built-in") as typeof import("./built-in");
  for (const def of BUILT_IN_NODES) registerNode(def);
}

/** Add one definition; re-registering the same type+version replaces it. */
export function registerNode(def: WorkflowNodeDefinition): void {
  const others = defs.filter((d) => !(d.type === def.type && d.version === def.version));
  defs = [...others, def];
}

export function registerAll(list: WorkflowNodeDefinition[]): void {
  for (const def of list) registerNode(def);
}

/** Latest definition for a node type (version-sorted). */
export function findNode(type: string): WorkflowNodeDefinition | null {
  ensureBuiltIns();
  const candidates = defs
    .filter((d) => d.type === type)
    .sort((a, b) => b.version.localeCompare(a.version));
  return candidates[0] ?? null;
}

export function definitionFor(type: string): WorkflowNodeDefinition {
  const def = findNode(type);
  if (!def) throw new WorkflowStudioError("NODE_TYPE_UNKNOWN", 422, `node type '${type}' is not registered`, { type });
  return def;
}

/** All distinct node types (latest version per type). */
export function listNodes(): WorkflowNodeDefinition[] {
  ensureBuiltIns();
  const distinct: WorkflowNodeDefinition[] = [];
  for (const def of defs) {
    const already = distinct.some((d) => d.type === def.type);
    if (!already) distinct.push(def);
  }
  return distinct;
}

export interface AdvanceContext {
  plan: import("./types").ExecutionPlan;
  listNodeRuns: (runId: string) => import("./types").NodeRunRecord[];
  nodeRun: (runId: string, nodeId: string) => import("./types").NodeRunRecord | null;
  markNodeRunning: (runId: string, nodeId: string, attempt: number) => void;
  completeNode: (runId: string, nodeId: string, attempt: number, output: Record<string, unknown>, durationMs: number) => void;
  failNode: (runId: string, nodeId: string, attempt: number, message: string, code: string) => void;
  markRunRunning: (runId: string) => void;
  markRunFailed: (runId: string, message: string) => void;
  markRunSucceeded: (runId: string) => void;
  event: (runId: string, nodeId: string | null, type: string, payload: Record<string, unknown>) => void;
  runMemory: Record<string, unknown>;
  persistMemory: (runId: string, memory: Record<string, unknown>) => void;
  invokeNode: (nodeType: string, context: import("./types").NodeExecutionContext) => Promise<Record<string, unknown>>;
  /** Intercept an approval node: create the request and pause the run. */
  requestApproval: (runId: string, nodeId: string, nodeType: string, proposedAction: string, payload: unknown, riskLevel: string) => void;
  /** True when a decision for this approval node is already recorded in memory. */
  hasApprovalDecision: (memory: Record<string, unknown>, nodeId: string) => boolean;
  /** Persist per-attempt cost/token usage + the effective (possibly failed-over) type. */
  recordUsage: (runId: string, nodeId: string, usage: import("./types").NodeUsage, effectiveNodeType: string) => void;
  /** Switch a node to its failover type (provider failover) before scheduling it. */
  applyFailover: (runId: string, nodeId: string, failoverNodeType: string) => void;
  actor: string;
  studioRoot: string;
  currentStatus: import("./types").RunStatus;
}

export interface AdvanceOutcome {
  status: import("./types").RunStatus;
  executed: string[];
  paused: boolean;
}

/** Read node autonomy controls from graph node config (defaults: 3 attempts). */
function readNodeControls(config: Record<string, unknown>): { maxAttempts: number; failoverNodeType: string | null } {
  let maxAttempts = 3;
  let failoverNodeType: string | null = null;
  for (const [k, v] of Object.entries(config)) {
    if (k === "maxAttempts" && typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 10) maxAttempts = Math.floor(v);
    if (k === "failoverNodeType" && typeof v === "string" && /^[\w.]+$/.test(v)) failoverNodeType = v;
  }
  return { maxAttempts, failoverNodeType };
}

/** Fire condition-routing edges: an output entry whose key matches the edge's source port. */
function portEntry(source: Record<string, unknown>, sourcePort: string): Array<[string, unknown]> {
  return Object.entries(source).filter(([k]) => k === sourcePort).map(([k, v]) => [k, v] as [string, unknown]);
}

/** Collect delivered inputs for one node from its succeeded upstream edges. */
function collectInputs(plan: import("./types").ExecutionPlan, outputs: Array<{ id: string; output: Record<string, unknown> }>, nodeId: string): { ready: boolean; inputs: Record<string, unknown> } {
  const incoming = plan.edges.filter((edge) => edge.target === nodeId);
  const inputEntries: Array<[string, unknown]> = [];
  let allFired = true;
  for (const edge of incoming) {
    const match = outputs.find((pair) => pair.id === edge.source);
    if (match === undefined) { allFired = false; continue; }
    const entries = portEntry(match.output, edge.sourcePort);
    if (entries.length === 0) { allFired = false; continue; }
    for (const [, value] of entries) inputEntries.push([edge.targetPort, value]);
  }
  if (incoming.length > 0 && !allFired) return { ready: false, inputs: {} };
  return { ready: true, inputs: Object.fromEntries(inputEntries) };
}

/** Outputs of every succeeded node in the run (id → output pairs). */
function succeededOutputs(listNodeRuns: AdvanceContext["listNodeRuns"], runId: string): Array<{ id: string; output: Record<string, unknown> }> {
  const pairs: Array<{ id: string; output: Record<string, unknown> }> = [];
  for (const nodeRun of listNodeRuns(runId)) {
    if (nodeRun.status === "SUCCEEDED" && nodeRun.outputJson) {
      pairs.push({ id: nodeRun.nodeId, output: JSON.parse(nodeRun.outputJson) as Record<string, unknown> });
    }
  }
  return pairs;
}

/**
 * Advance a run one scheduling pass-set: execute nodes whose upstream edges
 * have all fired (condition routing via source ports), pausing on approval
 * nodes, retrying transient failures up to the node's maxAttempts, applying
 * provider FAILOVER to the configured alternate node type, failing fast with
 * structured errors, and persisting checkpoints at every node boundary.
 */
export async function advanceRunDeps(input: AdvanceContext, runId: string): Promise<AdvanceOutcome> {
  if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(input.currentStatus)) {
    return { status: input.currentStatus, executed: [], paused: false };
  }
  if (input.currentStatus === "WAITING_FOR_APPROVAL" || input.currentStatus === "PAUSED") {
    return { status: input.currentStatus, executed: [], paused: true };
  }
  const plan = input.plan;
  const memory = new Map<string, unknown>(Object.entries(input.runMemory));
  const executed: string[] = [];
  input.markRunRunning(runId);

  for (let pass = 0; pass < plan.nodes.length + 1; pass++) {
    const pairs = succeededOutputs(input.listNodeRuns, runId);
    let progressed = false;
    for (const group of plan.executionGroups) {
      for (const nodeId of group.nodeIds) {
        const nodeRun = input.nodeRun(runId, nodeId);
        const skip = nodeRun === null || ["SUCCEEDED", "SKIPPED", "CANCELLED"].includes(nodeRun.status);
        if (skip || !nodeRun) continue;
        const { ready, inputs } = collectInputs(plan, pairs, nodeId);
        if (!ready) continue;

        const plannedConfig = plan.nodes.find((n) => n.id === nodeId)?.config ?? {};
        const controls = readNodeControls(plannedConfig);
        const plannedType = nodeRun.nodeType;
        // Failover precedence: the configured alternate type wins once the
        // planned type has exhausted its attempts; otherwise the recorded
        // effective type (if any) is reused.
        const failoverType = nodeRun.failoverNodeType ?? controls.failoverNodeType ?? null;
        const useFailover = nodeRun.attempt >= controls.maxAttempts && failoverType !== null;
        const effectiveType = useFailover
          ? failoverType
          : (nodeRun.effectiveNodeType ?? plannedType);
        if (useFailover && nodeRun.failoverNodeType !== failoverType) {
          input.applyFailover(runId, nodeId, failoverType);
          input.event(runId, nodeId, "node.failover", { from: plannedType, to: failoverType, attempt: nodeRun.attempt });
        }

        const attempt = nodeRun.attempt + 1;
        // Approval nodes are INTERCEPTED: without a recorded decision the run
        // pauses (WAITING_FOR_APPROVAL) instead of executing the node.
        if (effectiveType === "human.approval" && !input.hasApprovalDecision(input.runMemory, nodeId)) {
          input.requestApproval(runId, nodeId, effectiveType, "human approval required", inputs, "medium");
          return { status: "WAITING_FOR_APPROVAL", executed, paused: true };
        }
        input.markNodeRunning(runId, nodeId, attempt);
        input.event(runId, nodeId, "node.started", { nodeType: effectiveType, attempt });
        const startedAt = Date.now();
        const abort = new AbortController();
        let usage: import("./types").NodeUsage = {};
        const context: import("./types").NodeExecutionContext = {
          runId, nodeId, attempt, effectiveType, config: plannedConfig,
          inputs, memory, actor: input.actor, studioRoot: input.studioRoot, signal: abort.signal,
          reportUsage: (reported) => { usage = { ...usage, ...reported }; },
        };
        try {
          const output = await input.invokeNode(effectiveType, context);
          input.completeNode(runId, nodeId, attempt, output, Date.now() - startedAt);
          input.recordUsage(runId, nodeId, usage, effectiveType);
          input.persistMemory(runId, Object.fromEntries(memory));
          executed.push(nodeId);
          progressed = true;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const code = (err as { code?: string }).code ?? "NODE_FAILED";
          input.failNode(runId, nodeId, attempt, message, code);
          input.recordUsage(runId, nodeId, usage, effectiveType);
          input.event(runId, nodeId, "node.failed", { error: message, code, attempt, maxAttempts: controls.maxAttempts });
          // Retry policy: transient/provider failures retry while attempts remain
          // (and while a failover alternative exists for the final attempts).
          const retryable = code === "PROVIDER_UNAVAILABLE" || code === "CAPABILITY_UNAVAILABLE" || code === "NODE_FAILED";
          // A configured failover is an alternative attempt path even after the
          // planned type's attempts are exhausted.
          const failoverAvailable = failoverType !== null && failoverType !== effectiveType;
          const attemptsLeft = attempt < controls.maxAttempts || failoverAvailable;
          if (retryable && attemptsLeft) {
            input.event(runId, nodeId, "node.retrying", { attempt: attempt + 1, nextType: failoverAvailable ? failoverType : effectiveType });
            continue;
          }
          input.markRunFailed(runId, message);
          return { status: "FAILED", executed, paused: false };
        }
      }
    }
    if (!progressed) break;
  }

  const nodeRuns = input.listNodeRuns(runId);
  const waiting = nodeRuns.find((n) => n.status === "WAITING_FOR_APPROVAL");
  if (waiting) return { status: "WAITING_FOR_APPROVAL", executed, paused: true };
  const pending = nodeRuns.filter((n) => n.status !== "SUCCEEDED" && n.status !== "SKIPPED");
  if (pending.length === 0) {
    input.markRunSucceeded(runId);
    input.event(runId, null, "workflow.completed", {});
    return { status: "SUCCEEDED", executed, paused: false };
  }
  return { status: "RUNNING", executed, paused: false };
}
