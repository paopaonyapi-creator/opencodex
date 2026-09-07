// Phase 20.9 — Pao-hubPro × Chatbox Agent Desktop Runtime
// Core Domain Models, Contracts, and Type Definitions

export type AgentMode = "off" | "ask" | "safe_auto" | "full_auto";

export type ToolRisk = "read_only" | "low" | "medium" | "high" | "critical";

export type ToolSource = "builtin" | "mcp" | "skill" | "sandbox" | "custom";

export type DesktopAgentState =
  | "IDLE"
  | "PLANNING"
  | "WAITING_MODEL"
  | "TOOL_PROPOSED"
  | "POLICY_CHECK"
  | "WAITING_APPROVAL"
  | "EXECUTING"
  | "OBSERVING"
  | "REVIEWING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "TIMEOUT";

export interface ModelCapabilities {
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
  structuredOutput: boolean;
  streaming: boolean;
  maxContext?: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  capabilities: ModelCapabilities;
  contextWindow?: number;
  maxOutputTokens?: number;
  isDefault?: boolean;
}

export interface GenerateRequest {
  model: string;
  systemPrompt?: string;
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    toolCallId?: string;
    toolCalls?: Array<{
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }>;
  }>;
  tools?: ToolDescriptor[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  abortSignal?: AbortSignal;
}

export interface GenerateResponse {
  text: string;
  finishReason: "stop" | "tool_calls" | "length" | "error";
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface StreamEvent {
  type: "text_delta" | "tool_call_delta" | "finish" | "error";
  delta?: string;
  toolCall?: {
    id: string;
    name: string;
    argumentsDelta?: string;
  };
  error?: string;
}

export interface AIProvider {
  id: string;
  name: string;
  listModels(): Promise<ModelInfo[]>;
  generate(request: GenerateRequest): Promise<GenerateResponse>;
  stream(request: GenerateRequest): AsyncIterable<StreamEvent>;
  supportsTools(): boolean;
  supportsVision(): boolean;
  supportsStructuredOutput(): boolean;
}

export interface ToolDescriptor {
  id: string;
  namespace: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  risk: ToolRisk;
  source: ToolSource;
  requiresApproval: boolean;
  execute?: (args: Record<string, unknown>, context?: ToolExecutionContext) => Promise<unknown>;
}

export interface ToolExecutionContext {
  runId: string;
  workspaceRoot: string;
  sessionId?: string;
  abortSignal?: AbortSignal;
}

export interface ToolExecutionRequest {
  id: string;
  runId: string;
  toolId: string;
  namespace: string;
  name: string;
  risk: ToolRisk;
  arguments: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface ToolExecutionResult {
  toolCallId: string;
  success: boolean;
  output?: unknown;
  errorMessage?: string;
  latencyMs: number;
}

export type MCPTransportType = "stdio" | "http" | "sse";

export interface MCPServerConfig {
  id: string;
  name: string;
  transport: MCPTransportType;
  command?: string;
  args?: string[];
  url?: string;
  envWhitelist?: string[];
  cwd?: string;
  trustLevel?: "trusted" | "untrusted";
  enabled?: boolean;
}

export interface MCPHealth {
  status: "healthy" | "unhealthy" | "unknown";
  latencyMs?: number;
  lastChecked: string;
  error?: string;
}

export interface SandboxOptions {
  sessionId?: string;
  workspaceRoot: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  maxProcessCount?: number;
  envAllowlist?: string[];
}

export interface SandboxSession {
  id: string;
  workspaceRoot: string;
  createdAt: string;
  activeProcessCount: number;
}

export interface ExecRequest {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
  timedOut?: boolean;
}

export interface Sandbox {
  createSession(options: SandboxOptions): Promise<SandboxSession>;
  exec(sessionId: string, request: ExecRequest): Promise<ExecResult>;
  readFile(sessionId: string, path: string): Promise<string>;
  writeFile(sessionId: string, path: string, content: string): Promise<void>;
  destroySession(sessionId: string): Promise<void>;
}

export interface WorkspacePolicy {
  defaultMode: AgentMode;
  allowedRoots: string[];
  deniedPaths: string[];
  shellAllowlist: string[];
  gitPolicy: {
    allowStatus: boolean;
    allowDiff: boolean;
    allowCommit: "always" | "ask" | "deny";
    allowPush: "always" | "ask" | "deny";
    allowForcePush: boolean;
  };
}

export interface PolicyEvaluationResult {
  allowed: boolean;
  reason?: string;
  requiresApproval: boolean;
  risk: ToolRisk;
}

export interface ReviewResult {
  reviewer: string;
  approve: boolean;
  confidence: number;
  risk: ToolRisk;
  concerns: string[];
  recommendations: string[];
}

export interface CouncilDecision {
  decision: "approve" | "reject" | "human_review";
  confidence: number;
  risk: ToolRisk;
  reasons: string[];
}

export interface CouncilReviewInput {
  runId: string;
  mission: string;
  toolCall: ToolExecutionRequest;
  diff?: string;
  risk: ToolRisk;
}

export interface ApprovalCard {
  id: string;
  runId: string;
  toolCallId: string;
  agent: string;
  model: string;
  tool: string;
  server?: string;
  risk: ToolRisk;
  arguments: Record<string, unknown>;
  affectedFiles?: string[];
  command?: string;
  workingDirectory?: string;
  reason?: string;
  estimatedSideEffects?: string[];
  requestedAt: string;
}

export type ApprovalDecision = "approve_once" | "approve_session" | "reject";

export interface ApprovalResult {
  id: string;
  decision: ApprovalDecision;
  decidedBy: string;
  decidedAt: string;
  reason?: string;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  runId: string;
  actor: string;
  eventType:
    | "RUN_STARTED"
    | "MODEL_REQUEST"
    | "MODEL_RESPONSE"
    | "TOOL_PROPOSED"
    | "POLICY_ALLOWED"
    | "POLICY_DENIED"
    | "APPROVAL_REQUESTED"
    | "APPROVAL_GRANTED"
    | "APPROVAL_REJECTED"
    | "TOOL_STARTED"
    | "TOOL_COMPLETED"
    | "TOOL_FAILED"
    | "COUNCIL_REVIEW"
    | "GOVERNANCE_EVALUATED"
    | "RUN_COMPLETED"
    | "RUN_CANCELLED";
  tool?: string;
  risk?: ToolRisk;
  status: string;
  metadata?: Record<string, unknown>;
}

export interface DesktopAgentRun {
  id: string;
  mission: string;
  agentMode: AgentMode;
  providerId?: string;
  modelId?: string;
  status: DesktopAgentState;
  activeTools: string[];
  activeSkills: string[];
  currentTask?: string;
  errorMessage?: string;
  startedAt: string;
  finishedAt?: string;
  createdAt: string;
}

export interface SkillMetadata {
  id: string;
  name: string;
  description: string;
  version: string;
  sourcePath: string;
  enabled: boolean;
  validationStatus: "valid" | "invalid" | "untrusted";
  capabilities?: string[];
}

export interface KnowledgeResult {
  source: string;
  title: string;
  snippet: string;
  score: number;
}
