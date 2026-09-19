// Phase 20.93 — Visual Agentic Workflow Studio: canonical domain model.
//
// Clean-room implementation (the Agentic Signal reference is AGPL-licensed and
// is used as concept inspiration only). The studio is the orchestration layer:
// capability logic stays in its own plane and is exposed through nodes.
//
// Laws:
// - Canvas JSON never executes directly — the compiler produces an immutable
//   ExecutionPlan (planHash) that the runtime interprets.
// - Typed ports are validated before execution.
// - Secrets appear only as `secret://` references, never as values.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Ports & node contracts
// ---------------------------------------------------------------------------

export const PortTypeSchema = z.enum([
  "text", "markdown", "json", "binary", "file", "url", "agent-message",
  "rag-context", "artifact", "approval-token", "execution-context", "any",
]);
export type PortType = z.infer<typeof PortTypeSchema>;

export const PortDefinitionSchema = z.object({
  name: z.string(),
  type: PortTypeSchema,
  required: z.boolean().default(false),
});
export type PortDefinition = z.infer<typeof PortDefinitionSchema>;

export const NodeCategorySchema = z.enum([
  "trigger", "control", "ai", "knowledge", "tool", "browser", "engineering", "media", "human", "output",
]);
export type NodeCategory = z.infer<typeof NodeCategorySchema>;

export const RiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export interface WorkflowNodeDefinition {
  type: string;
  version: string;
  category: NodeCategory;
  title: string;
  description: string;
  inputPorts: PortDefinition[];
  outputPorts: PortDefinition[];
  configSchema: z.ZodTypeAny;
  /** Capabilities checked against the shared policy layer (Phase 05). */
  requiredCapabilities: string[];
  riskLevel: RiskLevel;
  executionMode: "local" | "remote" | "hybrid";
  supportsRetry: boolean;
  supportsResume: boolean;
  timeoutMs: number;
  /** Side-effect class drives the approval requirement (source §11/§12). */
  sideEffect: "none" | "local-write" | "external" | "destructive";
  /** Execute one node. Local-first; returns the output payload per port. */
  execute: (ctx: NodeExecutionContext) => Promise<Record<string, unknown>>;
}

export interface NodeExecutionContext {
  runId: string;
  nodeId: string;
  attempt: number;
  config: Record<string, unknown>;
  /** Inputs resolved from upstream node outputs, keyed by port name. */
  inputs: Record<string, unknown>;
  /** Run-scoped key/value memory (memory read/write nodes use this). */
  memory: Map<string, unknown>;
  actor: string;
  studioRoot: string;
  signal: AbortSignal;
}

// ---------------------------------------------------------------------------
// Canvas graph (authored JSON — never executed directly)
// ---------------------------------------------------------------------------

export const GraphNodeSchema = z.object({
  id: z.string().regex(/^[\w-]+$/),
  type: z.string().min(1),
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
  config: z.record(z.string(), z.unknown()).default({}),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEdgeSchema = z.object({
  id: z.string().regex(/^[\w-]+$/),
  source: z.string(),
  sourcePort: z.string().default("output"),
  target: z.string(),
  targetPort: z.string().default("input"),
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const WorkflowGraphSchema = z.object({
  schemaVersion: z.literal("1.0"),
  name: z.string().min(1).max(120),
  description: z.string().default(""),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
});
export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;

// ---------------------------------------------------------------------------
// Compiled plan
// ---------------------------------------------------------------------------

export interface CompilerDiagnostic {
  nodeId: string | null;
  severity: "error" | "warning";
  message: string;
}

export interface ExecutionGroup {
  /** Nodes whose dependencies are satisfied simultaneously. */
  nodeIds: string[];
}

export interface ExecutionPlan {
  schemaVersion: "1.0";
  workflowName: string;
  planHash: string;
  nodes: Array<{ id: string; type: string; version: string; config: Record<string, unknown>; riskLevel: RiskLevel; capabilities: string[] }>;
  edges: GraphEdge[];
  executionGroups: ExecutionGroup[];
  requiredCapabilities: string[];
  estimatedRisk: RiskLevel;
  policyGates: Array<{ nodeId: string; capability: string }>;
}

// ---------------------------------------------------------------------------
// Runtime states
// ---------------------------------------------------------------------------

export const RunStatusSchema = z.enum([
  "PENDING", "QUEUED", "RUNNING", "WAITING_FOR_APPROVAL", "RETRYING",
  "SUCCEEDED", "FAILED", "CANCELLED", "PAUSED",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const NodeRunStatusSchema = z.enum([
  "PENDING", "READY", "RUNNING", "SUCCEEDED", "FAILED", "SKIPPED", "WAITING_FOR_APPROVAL", "CANCELLED",
]);
export type NodeRunStatus = z.infer<typeof NodeRunStatusSchema>;

export interface NodeRunRecord {
  id: string;
  runId: string;
  nodeId: string;
  nodeType: string;
  status: NodeRunStatus;
  attempt: number;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  outputJson: string | null;
  errorJson: string | null;
  provider: string | null;
  model: string | null;
}

export interface WorkflowRunRecord {
  id: string;
  workflowId: string;
  workflowVersionId: string;
  version: number;
  status: RunStatus;
  planHash: string;
  trigger: string;
  memoryJson: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowVersionRecord {
  id: string;
  workflowId: string;
  version: number;
  status: "draft" | "published";
  graphJson: string;
  planJson: string | null;
  planHash: string | null;
  createdAt: string;
}

export interface WorkflowRecord {
  id: string;
  name: string;
  description: string;
  activeVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface RunEventRecord {
  id: string;
  runId: string;
  nodeId: string | null;
  type: string;
  payloadJson: string;
  createdAt: string;
}

export interface ArtifactRecord {
  id: string;
  runId: string;
  nodeId: string;
  name: string;
  uri: string;
  mimeType: string;
  sha256: string;
  sizeBytes: number;
  createdAt: string;
}

export interface ApprovalRequestRecord {
  id: string;
  runId: string;
  nodeId: string;
  nodeType: string;
  proposedAction: string;
  payloadJson: string;
  riskLevel: RiskLevel;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  reviewer: string | null;
  reviewerNote: string | null;
  createdAt: string;
  decidedAt: string | null;
}

// ---------------------------------------------------------------------------
// Secret references — values never enter workflow data
// ---------------------------------------------------------------------------

export const SecretRefSchema = z.string().regex(/^secret:\/\/[\w/-]+$/, "secret references must be secret://<scope>/<name>");
export type SecretRef = z.infer<typeof SecretRefSchema>;

/** Redact any secret-looking value from payloads destined for logs/UI/exports. */
export function redactSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9]{8,}/g, "sk-[REDACTED]")
    .replace(/ghp_[A-Za-z0-9]{8,}/g, "ghp_[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]")
    .replace(/(password|token|secret|api[_-]?key)(\s*[:=]\s*)\S+/gi, "$1$2[REDACTED]");
}

export function parseOrThrow<T>(schema: { parse: (v: unknown) => T }, payload: unknown, what: string): T {
  try {
    return schema.parse(payload);
  } catch (err) {
    const detail = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : String(err);
    throw new WorkflowStudioError("SCHEMA_INVALID", 422, `${what} failed structured validation`, { detail });
  }
}

export type WorkflowStudioErrorCode =
  | "WORKFLOW_NOT_FOUND" | "VERSION_NOT_FOUND" | "RUN_NOT_FOUND" | "SCHEMA_INVALID"
  | "GRAPH_INVALID" | "CYCLE_DETECTED" | "PORT_TYPE_MISMATCH" | "NODE_TYPE_UNKNOWN"
  | "MISSING_CREDENTIAL" | "PROVIDER_UNAVAILABLE" | "APPROVAL_REQUIRED" | "APPROVAL_NOT_PENDING"
  | "POLICY_DENIED" | "INVALID_TRANSITION" | "NODE_FAILED" | "CAPABILITY_UNAVAILABLE";

export class WorkflowStudioError extends Error {
  readonly code: WorkflowStudioErrorCode;
  readonly httpStatus: number;
  readonly detail: Record<string, unknown>;
  constructor(code: WorkflowStudioErrorCode, httpStatus: number, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "WorkflowStudioError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.detail = detail ?? {};
  }
}
