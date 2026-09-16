// Phase 20.63 — Trust/risk/confidence intelligence (spec §21-§23).
//
// Three separate dimensions, versioned scoring policy, evidence-backed. A
// score is never a permission: policy consumes scores as one input among
// lifecycle, approval and data-class checks.

import type { DiscoveredApiRecord, HealthStatus, ProviderLifecycle } from "./types";

export const TRUST_POLICY_VERSION = "eap-trust-1";

export interface TrustEvidence {
  factor: string;
  points: number;
}

export interface TrustAssessment {
  trustScore: number;
  riskScore: number;
  confidence: number;
  trustEvidence: TrustEvidence[];
  riskEvidence: TrustEvidence[];
  policyVersion: string;
}

export interface TrustInput {
  record: Pick<DiscoveredApiRecord, "https" | "cors" | "authLabel"> | null;
  lifecycle: ProviderLifecycle;
  health: HealthStatus;
  docsReachable: boolean | null;
  specAvailable: boolean | null;
  mutatingOperations: number;
  sensitiveDataClasses: boolean;
  operatorApproved: boolean;
  consecutiveHealthFailures: number;
  incidentReported: boolean;
}

export function assessTrust(input: TrustInput): TrustAssessment {
  const trustEvidence: TrustEvidence[] = [];
  const riskEvidence: TrustEvidence[] = [];
  const add = (list: TrustEvidence[], factor: string, points: number) => {
    if (points !== 0) list.push({ factor, points });
  };

  // Trust evidence (spec §22 example weights; policy version pinned).
  if (input.record?.https) add(trustEvidence, "verified_https", 15);
  if (input.docsReachable) add(trustEvidence, "docs_reachable", 10);
  if (input.specAvailable) add(trustEvidence, "valid_spec", 15);
  if (input.record) {
    const authType = normalizeAuth(input.record.authLabel);
    if (authType === "api_key" || authType === "oauth2" || authType === "bearer") {
      add(trustEvidence, "documented_auth", 10);
    }
  }
  if (input.operatorApproved) add(trustEvidence, "human_approval", 20);

  // Risk evidence.
  if (input.record?.https === false) add(riskEvidence, "http_only", 20);
  if (input.docsReachable === false) add(riskEvidence, "docs_dead", 20);
  if (input.mutatingOperations > 0) add(riskEvidence, "write_capable", 25);
  if (input.sensitiveDataClasses) add(riskEvidence, "sensitive_data", 30);
  if (input.consecutiveHealthFailures >= 3) add(riskEvidence, "unstable_health", 15);
  if (input.incidentReported) add(riskEvidence, "security_incident", 40);

  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  const trustScore = clamp(trustEvidence.reduce((s, e) => s + e.points, 0));
  const riskScore = clamp(riskEvidence.reduce((s, e) => s + e.points, 0));

  // Confidence: how much independent evidence backs the assessment.
  let confidence = 20;
  if (input.record) confidence += 20;
  if (input.docsReachable !== null) confidence += 20;
  if (input.specAvailable !== null) confidence += 20;
  if (input.health !== "unknown") confidence += 20;

  return { trustScore, riskScore, confidence, trustEvidence, riskEvidence, policyVersion: TRUST_POLICY_VERSION };
}

function normalizeAuth(label: string): string {
  const normalized = label.trim().toLowerCase();
  if (normalized === "no" || normalized === "") return "none";
  if (normalized.includes("oauth")) return "oauth2";
  if (normalized.includes("api") && normalized.includes("key")) return "api_key";
  return "custom";
}

/**
 * Data classification for an operation (spec §23). Unknown fails toward
 * stricter handling — the caller must treat unknown as sensitive.
 */
export function classifyDataClass(pathTemplate: string, summary: string | null): string[] {
  const text = (pathTemplate + " " + (summary ?? "")).toLowerCase();
  const classes: string[] = ["PUBLIC"];
  if (/token|auth|login|session|password/.test(text)) classes.push("AUTHENTICATION");
  if (/payment|billing|price|stock|invoice|transaction/.test(text)) classes.push("FINANCIAL");
  if (/user|profile|email|customer|identity/.test(text)) classes.push("PERSONAL");
  if (/health|medical|patient/.test(text)) classes.push("HEALTH");
  if (/location|geo|latitude|longitude|address/.test(text)) classes.push("LOCATION");
  if (classes.length > 1) classes.push("INTERNAL");
  return classes;
}
