/**
 * Phase 20.84 — Machine-Native Decision Intelligence Runtime Types
 * Typed Probabilistic Policy Decisions, RLCD Confidence & Escalation Control.
 */

export type DecisionDisposition = "allow" | "review" | "deny" | "abstain";

export interface DecisionCandidate<T = string> {
  value: T;
  probability: number;
}

export interface DecisionRequest<TState = unknown, TDecision = string> {
  requestId: string;
  contractId: string;
  contractVersion?: string;
  state: TState;
  traceId?: string;
  thresholdProfile?: string;
  preferredProvider?: string;
}

export interface DecisionResult<T = string> {
  requestId: string;
  contractId: string;
  contractVersion: string;
  provider: string;
  model: string;

  selected: T;
  disposition: DecisionDisposition;

  confidence: number;
  candidates: DecisionCandidate<T>[];

  latencyMs: number;
  providerCostUsd?: number;

  policy?: {
    hardDenied: boolean;
    reasons: string[];
  };

  calibration?: {
    profile: string;
    trusted: boolean;
    ece?: number;
  };

  createdAt: string;
}

export interface ProviderHealth {
  providerId: string;
  status: "healthy" | "degraded" | "unhealthy";
  latencyP95Ms: number;
  circuitState: "closed" | "open" | "half_open";
}

export interface DecisionProvider {
  readonly id: string;

  computeDecision<TState, TDecision>(
    request: DecisionRequest<TState, TDecision>,
  ): Promise<DecisionResult<TDecision>>;

  health(): Promise<ProviderHealth>;
}

export interface DecisionContractDefinition<TState = unknown, TDecision = string> {
  id: string;
  version: string;
  category: string;
  riskTier: "low" | "normal" | "privileged" | "critical" | "destructive";
  allowedChoices: TDecision[];
  requiresHardPolicy: boolean;
  humanApprovalBypass: boolean;
  thresholdProfile: string;
  fallbackChoice: TDecision;
  validateState?: (state: TState) => boolean;
}
