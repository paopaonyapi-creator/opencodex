/**
 * Phase 25 — Pao Autonomous Security & Zero-Trust Threat Immunity Shield (ASTIS)
 * Core Domain Types & Threat Taxonomy
 */

export type ThreatSeverity = "low" | "medium" | "high" | "critical";

export type ThreatCategory =
  | "prompt_injection"
  | "jailbreak"
  | "privilege_escalation"
  | "secret_leak"
  | "destructive_command"
  | "data_exfiltration"
  | "action_anomaly";

export interface ThreatIncident {
  id: string;
  timestamp: string;
  agentId: string;
  category: ThreatCategory;
  severity: ThreatSeverity;
  score: number; // 0.0 to 1.0
  summary: string;
  details: Record<string, unknown>;
  blocked: boolean;
  mitigated: boolean;
}

export interface ActionProof {
  id: string;
  agentId: string;
  actionType: string;
  payloadHash: string;
  timestamp: number;
  nonce: string;
  signature: string;
}

export type AgentSecurityState = "active" | "monitored" | "quarantined" | "revoked";

export interface AgentSecurityRecord {
  agentId: string;
  state: AgentSecurityState;
  threatScore: number;
  incidentCount: number;
  lastIncidentAt?: string;
  quarantinedAt?: string;
  reason?: string;
  registeredAt: string;
  updatedAt: string;
}

export interface SecurityInspectionResult {
  safe: boolean;
  blocked: boolean;
  threatScore: number;
  category?: ThreatCategory;
  severity?: ThreatSeverity;
  summary: string;
  sanitizedText?: string;
  detectedSecretsCount?: number;
  tripwiresTriggered?: string[];
}

export interface SecurityShieldMetrics {
  shieldStatus: "ARMED & IMMUNE" | "DEGRADED" | "STANDBY";
  totalThreatsDetected: number;
  totalThreatsBlocked: number;
  criticalThreatsCount: number;
  activeTripwiresCount: number;
  activeAgentsCount: number;
  quarantinedAgentsCount: number;
  lastIncidentTimestamp?: string;
}
