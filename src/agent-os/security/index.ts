/**
 * Phase 25 — Pao Autonomous Security & Zero-Trust Threat Immunity Shield (ASTIS)
 * Public API & Singletons
 */

import { ActionAuthenticator } from "./action-authenticator";
import { QuarantineGuard } from "./quarantine-guard";
import { SecurityVault } from "./security-vault";
import { ThreatDetector } from "./threat-detector";
import type { ActionProof, SecurityInspectionResult } from "./types";

export * from "./types";
export { ThreatDetector } from "./threat-detector";
export { ActionAuthenticator } from "./action-authenticator";
export { QuarantineGuard } from "./quarantine-guard";
export { SecurityVault } from "./security-vault";

let defaultThreatDetector: ThreatDetector | null = null;
let defaultActionAuthenticator: ActionAuthenticator | null = null;
let defaultQuarantineGuard: QuarantineGuard | null = null;
let defaultSecurityVault: SecurityVault | null = null;

export function getThreatDetector(): ThreatDetector {
  if (!defaultThreatDetector) {
    defaultThreatDetector = new ThreatDetector();
  }
  return defaultThreatDetector;
}

export function getActionAuthenticator(): ActionAuthenticator {
  if (!defaultActionAuthenticator) {
    defaultActionAuthenticator = new ActionAuthenticator();
  }
  return defaultActionAuthenticator;
}

export function getQuarantineGuard(): QuarantineGuard {
  if (!defaultQuarantineGuard) {
    defaultQuarantineGuard = new QuarantineGuard();
    // Seed baseline agent security records
    defaultQuarantineGuard.getAgentRecord("agent-lead-architect");
    defaultQuarantineGuard.getAgentRecord("agent-code-reviewer");
    defaultQuarantineGuard.getAgentRecord("agent-test-runner");
    defaultQuarantineGuard.getAgentRecord("agent-devops-deployer");
  }
  return defaultQuarantineGuard;
}

export function getSecurityVault(): SecurityVault {
  if (!defaultSecurityVault) {
    defaultSecurityVault = new SecurityVault();
  }
  return defaultSecurityVault;
}

export function resetSecurityShield(): void {
  defaultThreatDetector = null;
  defaultActionAuthenticator = null;
  defaultQuarantineGuard = null;
  defaultSecurityVault = null;
}

export interface ExecutionInspectionParams {
  agentId: string;
  actionType: string;
  payload: string | Record<string, unknown>;
  proof?: ActionProof;
  secret?: string;
  context?: "prompt" | "command" | "output";
}

/**
 * High-level Zero-Trust guard hook executed before any agent action/tool invocation.
 */
export function inspectAgentExecution(params: ExecutionInspectionParams): SecurityInspectionResult {
  const guard = getQuarantineGuard();
  const detector = getThreatDetector();
  const vault = getSecurityVault();
  const authenticator = getActionAuthenticator();

  // 1. Check Quarantine Isolation Gate
  const allowance = guard.isAgentAllowed(params.agentId);
  if (!allowance.allowed) {
    vault.logIncident({
      agentId: params.agentId,
      category: "privilege_escalation",
      severity: "high",
      score: 0.9,
      summary: allowance.reason ?? "Quarantined agent execution rejected.",
      details: { actionType: params.actionType },
      blocked: true,
      mitigated: true,
    });
    return {
      safe: false,
      blocked: true,
      threatScore: 0.9,
      category: "privilege_escalation",
      severity: "high",
      summary: allowance.reason ?? "Agent is isolated in quarantine.",
    };
  }

  // 2. If ActionProof provided, verify cryptographic authenticity
  if (params.proof && params.secret) {
    const proofResult = authenticator.verifyProof(
      params.proof,
      params.agentId,
      params.payload,
      params.secret
    );
    if (!proofResult.valid) {
      vault.logIncident({
        agentId: params.agentId,
        category: "action_anomaly",
        severity: "critical",
        score: 0.95,
        summary: proofResult.reason ?? "Invalid or forged ActionProof.",
        details: { actionType: params.actionType, proof: params.proof },
        blocked: true,
        mitigated: true,
      });
      guard.recordIncident(params.agentId, "critical", 0.95, proofResult.reason ?? "ActionProof failure");
      return {
        safe: false,
        blocked: true,
        threatScore: 0.95,
        category: "action_anomaly",
        severity: "critical",
        summary: proofResult.reason ?? "ActionProof verification failed.",
      };
    }
  }

  // 3. Multi-Vector Threat Inspection
  const rawText = typeof params.payload === "string" ? params.payload : JSON.stringify(params.payload);
  const inspection = detector.inspect(rawText, { context: params.context });

  if (!inspection.safe) {
    vault.logIncident({
      agentId: params.agentId,
      category: inspection.category ?? "action_anomaly",
      severity: inspection.severity ?? "high",
      score: inspection.threatScore,
      summary: inspection.summary,
      details: {
        actionType: params.actionType,
        tripwires: inspection.tripwiresTriggered,
        detectedSecrets: inspection.detectedSecretsCount,
      },
      blocked: inspection.blocked,
      mitigated: !inspection.blocked,
    });

    if (inspection.severity) {
      guard.recordIncident(params.agentId, inspection.severity, inspection.threatScore, inspection.summary);
    }
  }

  return inspection;
}
