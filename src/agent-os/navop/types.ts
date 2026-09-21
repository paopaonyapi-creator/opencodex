// Phase Navop & 21.03 — Host-Authoritative Operations Runtime types.

export type NavopRiskLevel = "R0" | "R1" | "R2" | "R3" | "R4" | "R5";
// R0: informational, R1: read-only, R2: controlled mutation, R3: privileged mutation, R4: destructive, R5: irreversible

export type NavopPermissionProfile = "observe" | "guarded" | "trusted" | "operator";

export interface NavopResource {
  id: string;
  resourceUri: string; // e.g. host://local/windows, host://vps/main, files://project/pao
  resourceType: "host" | "files" | "terminal" | "database" | "docker" | "git";
  displayName: string;
  adapterType: string;
  credentialRef?: string | null;
  config: Record<string, unknown>;
  labels: Record<string, string>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NavopCapability {
  id: string;
  name: string; // e.g. pao.files.read, pao.ssh.exec
  version: string;
  adapterType: string;
  riskLevel: NavopRiskLevel;
  mutates: boolean;
  supportsDryRun: boolean;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
}

export interface NavopSession {
  id: string;
  sessionType: string;
  agentKey: string;
  projectId?: string | null;
  status: "active" | "paused" | "terminated";
  policyProfile: NavopPermissionProfile;
  startedAt: string;
  expiresAt?: string | null;
  endedAt?: string | null;
}

export interface NavopToolInvocation {
  id: string;
  traceId: string;
  sessionId?: string | null;
  capabilityName: string;
  resourceUri?: string | null;
  inputRedacted: Record<string, unknown>;
  riskLevel: NavopRiskLevel;
  policyDecision: "allowed" | "denied" | "requires_approval";
  approvalId?: string | null;
  status: "started" | "completed" | "failed" | "blocked";
  startedAt: string;
  finishedAt?: string | null;
  resultSummary?: Record<string, unknown> | null;
  errorCode?: string | null;
}

export interface NavopApproval {
  id: string;
  traceId: string;
  sessionId?: string | null;
  actionSummary: string;
  riskLevel: NavopRiskLevel;
  requestPayload: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "consumed" | "expired";
  decisionBy?: string | null;
  decisionNote?: string | null;
  requestedAt: string;
  expiresAt?: string | null;
  decidedAt?: string | null;
}

export interface NavopAuditEvent {
  id: string;
  traceId?: string | null;
  eventType: string;
  actorType: "HUMAN" | "AGENT" | "SYSTEM";
  actorId: string;
  resourceUri?: string | null;
  payloadRedacted: Record<string, unknown>;
  createdAt: string;
}

// CC-Switch specific types
export interface CcsProvider {
  id: string;
  name: string;
  providerFamily: string;
  protocol: string;
  baseUrl?: string | null;
  trustClass: string;
  enabled: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CcsProviderModel {
  id: string;
  providerId: string;
  upstreamModelId: string;
  displayName?: string | null;
  capabilities: string[];
  contextWindow?: number | null;
  active: boolean;
}

export interface CcsRuntime {
  id: string;
  runtimeType: string; // codex | claude | opencode | grok | gemini
  displayName: string;
  executablePath?: string | null;
  configPath?: string | null;
  detectedVersion?: string | null;
  status: string;
  lastSeenAt?: string | null;
  metadata: Record<string, unknown>;
}

export type CcsCircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CcsRouteCandidate {
  providerId: string;
  modelId?: string | null;
  priority: number;
}

export interface CcsRoute {
  id: string;
  name: string;
  runtimeId?: string | null;
  routingMode: "direct" | "gateway" | "policy" | "auto-failover" | "local-only" | "offline";
  candidates: CcsRouteCandidate[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CcsCircuitBreaker {
  providerId: string;
  state: CcsCircuitState;
  failureCount: number;
  successCount: number;
  openedAt?: string | null;
  halfOpenAt?: string | null;
  lastFailureAt?: string | null;
  updatedAt: string;
}

export interface CcsUsageEvent {
  id: string;
  routeId?: string | null;
  providerId: string;
  modelId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  requestClass: "idempotent" | "side_effecting";
  outcome: "success" | "failed" | "failover" | "blocked";
  replayed: boolean;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  latencyMs?: number | null;
  errorCode?: string | null;
  traceId?: string | null;
  createdAt: string;
}

export interface CcsRouteAttempt {
  providerId: string;
  modelId?: string | null;
  outcome: "success" | "failed" | "skipped_open" | "blocked_unsafe_replay";
  errorCode?: string | null;
}

export interface CcsRouteDecision {
  routeId: string;
  traceId: string;
  selectedProviderId?: string | null;
  selectedModelId?: string | null;
  status: "completed" | "failed" | "blocked";
  failoverCount: number;
  replayed: boolean;
  attempts: CcsRouteAttempt[];
  reason: string;
}

export interface CcsConfigProjection {
  id: string;
  runtimeId: string;
  targetPath: string;
  beforeHash: string;
  afterHash: string;
  beforeText: string;
  afterText: string;
  drift: boolean;
  status: "preview" | "applied" | "restored";
  createdAt: string;
}

export interface CcsRuntimeConfigView {
  runtimeType: "codex" | "claude";
  targetPath: string;
  exists: boolean;
  model?: string | null;
  baseUrl?: string | null;
  drift: boolean;
  projectedText: string;
}

export interface CcsCredentialRef {
  id: string;
  providerId: string;
  secretRef: string;
  envelope: Record<string, unknown>;
  createdAt: string;
}
