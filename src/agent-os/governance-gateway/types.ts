// Phase 20.28 — Pao-hubPro × OpenBot-inspired Governed Agent Computer &
// Safe Execution Fabric: canonical contracts.
//
// Concepts adopted at architecture level (gateway = action boundary, deny
// before allow, fail closed, skill != permission, unknown MCP = write/high,
// pre-action audit, human takeover); NO OpenBot code or runtime dependency.
// Pao-hubPro remains the control plane; authorization lives above providers.
// Named governance-gateway/ because agent-os/governance/ is the existing
// Ponytail minimal-code governance module.

export type ActionEffect =
  | "read" | "write" | "execute"
  | "external_write" | "destructive"
  | "credential" | "admin" | "unknown";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

export type GovernanceSurface =
  | "chat" | "codex" | "mcp" | "browser" | "chrome-extension"
  | "automation" | "reviewer-council" | "api" | "system";

export interface ActionRequest {
  actionId: string;
  timestamp: string;
  actor: { id: string; type: "user" | "automation" | "system"; roles?: string[] };
  agent: { id: string; type?: string };
  run: { runId: string; sessionId?: string; parentRunId?: string; delegationDepth?: number };
  source: { surface: GovernanceSurface };
  tool: { provider: string; name: string; effect?: ActionEffect };
  resource: { kind: string; id?: string; path?: string; host?: string; url?: string; metadata?: Record<string, unknown> };
  intent?: string;
  arguments: unknown;
  credentialRefs?: string[];
  requestedAt: string;
}

export interface PolicyDecision {
  decisionId: string;
  actionId: string;
  decision: "allow" | "deny" | "require_approval";
  risk: RiskLevel;
  matchedPolicyIds: string[];
  matchedRuleIds: string[];
  reasonCode: string;
  reason: string;
  decidedAt: string;
}

export interface ExecutionResult {
  actionId: string;
  status: "success" | "failed" | "denied" | "cancelled" | "timeout";
  startedAt?: string;
  finishedAt: string;
  output?: unknown;
  error?: { code: string; message: string };
  redactions?: string[];
}

export interface CapabilityGrant {
  id: string;
  subjectType: "agent" | "role" | "user" | "automation";
  subjectId: string;
  provider: string;
  capability: string;
  resourcePattern?: string;
  effectCeiling?: ActionEffect;
  expiresAt?: string;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type GovernanceCondition =
  | { field: "risk"; op: "eq" | "in"; value: string | string[] }
  | { field: "effect"; op: "eq" | "in"; value: string | string[] }
  | { field: "provider"; op: "eq" | "in"; value: string | string[] }
  | { field: "tool"; op: "eq" | "in"; value: string | string[] }
  | { field: "resource.kind"; op: "eq" | "in"; value: string | string[] }
  | { field: "resource.path"; op: "matches"; value: string }
  | { field: "resource.host"; op: "in" | "matches"; value: string | string[] }
  | { all: GovernanceCondition[] }
  | { any: GovernanceCondition[] }
  | { not: GovernanceCondition };

export interface GovernancePolicy {
  id: string;
  version: number;
  name: string;
  enabled: boolean;
  deny: Array<{ id: string; when: GovernanceCondition; reasonCode: string }>;
  requireApproval: Array<{ id: string; when: GovernanceCondition; reasonCode: string }>;
  allow: Array<{ id: string; when: GovernanceCondition; reasonCode: string }>;
}

export type GovernanceMode = "normal" | "read_only" | "paused";

export type ControlMode = "agent" | "human" | "paused";

export interface GovernanceApproval {
  id: string;
  actionId: string;
  status: "pending" | "approved" | "denied" | "expired" | "cancelled";
  risk: RiskLevel;
  summary: string;
  requestedByAgentId: string;
  argumentPreview: unknown;
  createdAt: string;
  expiresAt?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionReason?: string;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  actionId?: string;
  runId?: string;
  sessionId?: string;
  actorId?: string;
  agentId?: string;
  eventType: string;
  provider?: string;
  tool?: string;
  risk?: RiskLevel;
  decision?: string;
  resourceSummary?: string;
  metadata?: Record<string, unknown>;
  redacted: boolean;
  prevEventHash?: string;
  eventHash: string;
}

/** A provider performs governed work; it NEVER authorizes it (doc §68). */
export interface GovernanceProvider {
  readonly id: string;
  readonly capabilities: string[];
  readonly available: boolean;
  readonly unavailableReason?: string;
  perform(action: ActionRequest, grant: CapabilityGrant): Promise<{ output: unknown }>;
}

export type GovernanceErrorCode =
  | "GOVERNANCE_GRANT_DENIED"
  | "GOVERNANCE_POLICY_DENIED"
  | "GOVERNANCE_POLICY_INVALID"
  | "GOVERNANCE_APPROVAL_REQUIRED"
  | "GOVERNANCE_APPROVAL_DENIED"
  | "GOVERNANCE_APPROVAL_EXPIRED"
  | "GOVERNANCE_GLOBAL_PAUSED"
  | "GOVERNANCE_READ_ONLY"
  | "GOVERNANCE_PROVIDER_DISABLED"
  | "GOVERNANCE_RESOURCE_OUT_OF_SCOPE"
  | "GOVERNANCE_CREDENTIAL_DENIED"
  | "GOVERNANCE_BYPASS_BLOCKED";

import { randomUUID } from "node:crypto";

export function newGovId(prefix: string): string {
  return prefix + "_" + randomUUID().slice(0, 12);
}
