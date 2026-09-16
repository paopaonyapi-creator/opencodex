// Phase 20.35 — Pao-hubPro × Transgentic-inspired Unified AI Runtime Control
// Plane: canonical contracts. CLEAN-ROOM: built from Pao-hubPro requirements
// and public protocol contracts (OpenAI-compatible API, MCP); no Transgentic
// source, naming, or assets are used or referenced (doc §73).
//
// Architectural mapping (no duplicate subsystems): the opencodex proxy IS the
// OpenAI-compatible gateway (/v1/models, /v1/chat/completions) and Phase
// 20.30 already provides capability-aware candidates with reasoned previews.
// This module adds the MISSING control-plane layer on top: mode affinity,
// provider/agent execution classes, circuit breakers, context/secret
// firewalls, workspace permissions, and the attachment pipeline.

export type ProviderType =
  | "openai_compatible"
  | "local_http"
  | "local_process"
  | "cli"
  | "mcp"
  | "browser"
  | "custom";

/** Capability taxonomy (spec §2.2). `agent_only` marks capabilities that are
 *  meaningless in provider mode and require authorized workspace grants. */
export type ProviderCapability =
  | "text" | "vision" | "image_generation" | "image_editing"
  | "video_generation" | "video_editing" | "audio_input" | "audio_output"
  | "tool_calling" | "structured_output" | "long_context" | "code_execution"
  | "filesystem_access" | "shell_access" | "mcp_client" | "streaming"
  | "json_schema" | "reasoning";

export interface ProviderCapabilities {
  text: boolean;
  vision: boolean;
  image_generation: boolean;
  video_generation: boolean;
  audio_input: boolean;
  audio_output: boolean;
  tool_calling: boolean;
  structured_output: boolean;
  long_context: boolean;
  code_execution: boolean;
  streaming: boolean;
  json_schema: boolean;
  reasoning: boolean;
  /** Agent-only capabilities: enabled only inside an authorized workspace. */
  filesystem_access: "no" | "agent_only";
  shell_access: "no" | "agent_only";
  mcp_client: boolean;
}

export type AIMode =
  | "general" | "coding" | "research" | "writing" | "image" | "video"
  | "audio" | "automation" | "review" | "adobe_stock" | "private_local";

export type ProviderHealthState =
  | "healthy" | "degraded" | "cooldown" | "offline"
  | "auth_error" | "rate_limited" | "disabled";

export interface ProviderManifest {
  id: string;
  name: string;
  type: ProviderType;
  enabled: boolean;
  isLocal: boolean;
  capabilities: ProviderCapabilities;
  /** Base priority and per-mode affinities (0..100). */
  routing: { basePriority: number; modes: Partial<Record<AIMode, number>> };
  limits: { concurrency: number; timeoutMs: number };
  policy: ProviderPolicyEntry;
  /** connection config; secretRef is an env-var NAME, never a value. */
  config: { baseUrl?: string; secretRef?: string; modelId?: string };
}

/** Provider policy registry (spec §15) — declared constraints, never bypasses. */
export interface ProviderPolicyEntry {
  access: { api: boolean; cli: boolean; browser: boolean };
  automation: { browser_actions: boolean; bulk: boolean };
  credentials: { api_key: boolean; oauth: boolean; browser_session: boolean };
  respectRemoteRateLimit: boolean;
  notes: string[];
}

export type ExecutionClass = "provider_mode" | "agent_mode";

export interface WorkspacePermissionSet {
  workspaceId: string;
  grants: Partial<Record<WorkspacePermission, boolean>>;
  updatedAt: string;
}

export type WorkspacePermission =
  | "READ_FILES" | "WRITE_FILES" | "RUN_COMMANDS" | "GIT_READ" | "GIT_WRITE"
  | "NETWORK" | "MCP_TOOLS" | "BROWSER" | "SECRETS_READ" | "LOCAL_MODEL" | "CLOUD_MODEL";

export const WORKSPACE_PERMISSIONS: readonly WorkspacePermission[] = [
  "READ_FILES", "WRITE_FILES", "RUN_COMMANDS", "GIT_READ", "GIT_WRITE",
  "NETWORK", "MCP_TOOLS", "BROWSER", "SECRETS_READ", "LOCAL_MODEL", "CLOUD_MODEL",
];

/** Context sensitivity tags (spec §18). LOCAL_ONLY never leaves the machine;
 *  SECRET/CREDENTIAL are redacted before any provider sees them. */
export type ContextSensitivity =
  | "PUBLIC" | "INTERNAL" | "PRIVATE" | "SECRET" | "CREDENTIAL" | "LOCAL_ONLY";

export interface ContextItem {
  namespace: "request" | "session" | "conversation" | "project" | "workspace" | "retrieved" | "preferences" | "provider_native" | "long_term";
  key: string;
  value: string;
  sensitivity: ContextSensitivity;
}

export interface ContextEnvelope {
  requestId: string;
  sessionId?: string;
  conversationId?: string;
  projectId?: string;
  workspaceId?: string;
  items: ContextItem[];
}

export interface AttachmentRef {
  name: string;
  /** data: for staged local attachments; https:// for remote fetches. */
  source: string;
  mimeHint?: string;
}

export interface UnifiedAIRequest {
  id?: string;
  model: string;
  messages?: Array<{ role: string; content: string }>;
  prompt?: string;
  mode?: AIMode;
  attachments?: AttachmentRef[];
  tools?: boolean;
  responseFormat?: "text" | "json_object" | "json_schema";
  execution?: { class: ExecutionClass; workspaceId?: string };
  routing?: { requiredCapabilities?: ProviderCapability[]; preferLocal?: boolean; strategy?: string };
}

export interface RouteReason {
  providerId: string;
  score: number;
  included: boolean;
  reasons: string[];
}

export interface RoutePreviewResult {
  mode: AIMode;
  requirements: ProviderCapability[];
  selected: string | null;
  fallbacks: string[];
  candidates: RouteReason[];
  excluded: RouteReason[];
  policyDecisions: string[];
  executionClass: ExecutionClass;
}

export interface UnifiedAIResponse {
  id: string;
  providerId: string;
  modelId?: string;
  output: unknown;
  usage?: { inputTokens?: number; outputTokens?: number; estimatedCostUsd?: number };
  timing: { totalMs: number };
  routing: { selectedProvider: string; fallbacksTried: string[]; mode: AIMode };
}

export interface RetryClassification {
  retryable: boolean;
  reason: string;
}

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";
