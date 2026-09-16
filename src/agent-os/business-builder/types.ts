// Phase 30.36 — Pao-hubPro × Software Income Playbooks: Business Builder
// canonical domain models (spec §7.2, §8). External repositories are
// READ-ONLY reference sources: imported content is normalized into these
// internal records, which are the runtime source of truth (spec §6).

export type OpportunityStatus =
  | "imported"
  | "normalized"
  | "shortlisted"
  | "in_experiment"
  | "validated"
  | "archived";

export type DeliveryModel =
  | "manual" | "productized_service" | "monitoring" | "dashboard"
  | "micro_saas" | "api" | "marketplace";

export interface OpportunitySource {
  type: "software_income_playbooks" | "manual" | "ai_research" | "internal";
  repo?: string;
  url?: string;
  path?: string;
  commit?: string;
  importedAt: string;
  contentHash: string;
  license: string; // SPDX-ish id or LICENSE_UNKNOWN
}

export interface BusinessOpportunity {
  id: string;
  slug: string;
  name: string;
  summary: string;

  market: string;
  category: string;
  customerSegments: string[];
  buyerRoles: string[];

  painPoints: string[];
  valueProposition: string;
  solution: string;

  businessModel: string;
  pricingModel: string;
  suggestedPrice: number | null;
  currency: string;

  deliveryModel: DeliveryModel;

  requiredApis: string[];
  requiredCapabilities: string[];
  requiredModels: string[];
  requiredDataSources: string[];

  difficulty: "low" | "medium" | "high";
  estimatedBuildHours: number;
  estimatedTimeToMvpDays: number;

  revenuePotential: number;   // 0..100 dimension scores used by the engine
  recurringRevenuePotential: number;
  speedToCash: number;
  automationPotential: number;
  marketDemand: number;
  competitionLevel: number;   // 0..100, higher = more competition
  complianceRisk: number;     // 0..100, higher = riskier
  apiCostLevel: number;       // 0..100, higher = costlier

  paoFitScore: number | null;
  opportunityScore: number | null;
  scoreConfidence: number | null;
  scoreEvidence: ScoreEvidence[];

  gtmChannels: string[];
  salesMotion: string;
  validationPlan: string;

  source: OpportunitySource;
  editedManually: boolean;
  status: OpportunityStatus;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ScoreEvidence {
  dimension: string;
  score: number;
  confidence: number;
  evidence: Array<{ type: string; source: string; summary: string }>;
}

export interface CapabilityRecord {
  id: string;
  name: string;
  type: string;
  status: "available" | "degraded" | "unavailable";
  /** How the status was derived — never a hardcoded score. */
  derivedFrom: string;
  updatedAt: string;
}

export interface ScoreWeights {
  revenuePotential: number;
  speedToCash: number;
  recurringRevenue: number;
  buildSimplicity: number;
  automationPotential: number;
  marketDemand: number;
  paoFit: number;
  lowApiCost: number;
  lowCompetition: number;
  complianceSafety: number;
}

export interface OpportunityScore {
  score: number;
  confidence: number;
  evidenceCount: number;
  dimensions: Array<{ dimension: string; raw: number; weighted: number }>;
  paoFit: number;
  evaluatedAt: string;
  weightsVersion: string;
}

export type ComplianceStatus = "GREEN" | "YELLOW" | "RED" | "UNKNOWN";

export interface ComplianceDimension {
  dimension: string;
  status: ComplianceStatus;
  reason: string;
}

export interface ComplianceCheck {
  id: string;
  opportunityId: string;
  dimensions: ComplianceDimension[];
  overall: ComplianceStatus;
  requiresReview: boolean;
  reviewedBy: string | null;
  createdAt: string;
}

export interface ApiDependency {
  name: string;
  required: boolean;
  estimatedMonthlyCost: number;
  currency: string;
  fallbackAvailable: boolean;
  tosStatus: ComplianceStatus;
}

export interface CostEstimate {
  id: string;
  opportunityId: string;
  categories: Record<string, number>;
  currency: string;
  prototypeCost: number;
  monthlyFixedCost: number;
  costPerCustomer: number;
  suggestedPrice: number;
  grossMarginPerCustomer: number;
  breakEvenCustomers: number | null;
  createdAt: string;
}

export interface MvpSpec {
  id: string;
  opportunityId: string;
  slug: string;
  outputDir: string;
  artifacts: Record<string, string>; // file name → content
  blocked: boolean;
  blockReasons: string[];
  warnings: string[];
  createdAt: string;
}

export type ExperimentStatus = "running" | "decided" | "stopped";
export type ExperimentDecision = "KEEP" | "ITERATE" | "PIVOT" | "KILL" | "PENDING";

export interface ExperimentMetrics {
  leadsContacted: number;
  replies: number;
  qualified: number;
  demos: number;
  trials: number;
  paidCustomers: number;
  churned: number;
  revenue: number;
  cost: number;
}

export interface RevenueExperiment {
  id: string;
  opportunityId: string;
  hypothesis: string;
  customerSegment: string;
  offer: string;
  price: number;
  currency: string;
  acquisitionChannel: string;
  landingPageUrl: string | null;
  metrics: ExperimentMetrics;
  conversion: {
    replyRate: number;
    qualifiedRate: number;
    demoRate: number;
    paidConversion: number;
    cac: number | null;
  };
  status: ExperimentStatus;
  decision: ExperimentDecision;
  decisionReasons: string[];
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
}
