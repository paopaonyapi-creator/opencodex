// Phase 20.34 — Pao-hubPro × Lead Gen API Stack: Lead Intelligence Control Plane.
// Canonical domain model (spec §8), provider adapter contract (§9), and job/
// pipeline types. The reference repository is a provider *catalog* — it is
// treated as research seed only; no upstream code or affiliate rankings ship.

export type LeadKind = "company" | "person" | "local_business";

export type LeadStatus =
  | "raw"
  | "normalized"
  | "enriched"
  | "verified"
  | "qualified"
  | "suppressed"
  | "archived";

export interface CompanyProfile {
  canonicalName: string;
  legalName?: string;
  domain?: string;
  websiteUrl?: string;
  description?: string;
  industry?: string;
  employeeRange?: string;
  country?: string;
  region?: string;
  city?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
}

export interface PersonProfile {
  fullName: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  seniority?: string;
  department?: string;
  companyName?: string;
  companyDomain?: string;
  country?: string;
  region?: string;
  city?: string;
}

export type ContactType = "email" | "phone" | "website";

export type VerificationStatus = "unknown" | "valid" | "invalid" | "risky" | "catch_all";

export interface ContactPoint {
  type: ContactType;
  value: string;
  normalizedValue: string;
  sourceProviderId: string;
  confidence: number;
  verificationStatus: VerificationStatus;
  verifiedAt?: string;
  isBusinessContact?: boolean;
  isPrimary?: boolean;
}

export interface SocialProfile {
  platform: string;
  url: string;
  sourceProviderId: string;
}

export interface SourceRecord {
  id: string;
  providerId: string;
  providerRunId?: string;
  sourceUrl?: string;
  collectedAt: string;
  rawRef?: string;
}

export interface LeadScore {
  total: number;
  grade: "A" | "B" | "C" | "D";
  deterministicScore: number;
  aiScore?: number;
  confidence: number;
  reasons: string[];
  calculatedAt: string;
  scoringProfileId: string;
}

export interface CanonicalLead {
  id: string;
  kind: LeadKind;
  status: LeadStatus;
  company?: CompanyProfile;
  person?: PersonProfile;
  contactPoints: ContactPoint[];
  socialProfiles: SocialProfile[];
  score?: LeadScore;
  confidence: number;
  sourceRecords: SourceRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface FieldEvidence {
  field: string;
  valuePreview: string;
  providerId: string;
  confidence: number;
  collectedAt: string;
}

// --- Provider contract (spec §9) ------------------------------------------

export type LeadCapability =
  | "lead_search"
  | "company_enrichment"
  | "person_enrichment"
  | "contact_discovery"
  | "contact_verification";

export type PricingModel = "per_result" | "per_request" | "per_compute" | "subscription" | "unknown";

export interface ProviderDefinition {
  id: string;
  name: string;
  adapter: "mock" | "apify_actor" | "website_crawler" | "custom_http";
  enabled: boolean;
  capabilities: LeadCapability[];
  pricingModel: PricingModel;
  currency: string;
  estimatedCostPer1000: number;
  timeoutMs: number;
  maxConcurrency: number;
  qualityScore: number;
  reliabilityScore: number;
  requiresApproval: boolean;
  secretRef: string | null;
  config: Record<string, unknown>;
  termsUrl?: string;
}

export interface ProviderHealth {
  status: "healthy" | "degraded" | "down" | "disabled";
  latencyMs?: number;
  successRate24h?: number;
  errorRate24h?: number;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  message?: string;
}

export interface CostEstimate {
  providerId: string;
  currency: string;
  estimatedCost: number;
  units: number;
  pricingModel: PricingModel;
}

// --- Requests / results -----------------------------------------------------

export interface LeadQuery {
  leadKind: LeadKind;
  query: string;
  industryKeywords?: string[];
  country?: string;
  region?: string;
  city?: string;
  jobTitle?: string;
  companySize?: string;
  limit: number;
  requiredFields?: string[];
}

export interface SearchRequest {
  query: LeadQuery;
  runId: string;
}

export interface DiscoveredLead {
  kind: LeadKind;
  company?: CompanyProfile;
  person?: PersonProfile;
  contactPoints: ContactPoint[];
  socialProfiles?: SocialProfile[];
  sourceUrl?: string;
  providerExternalId?: string;
}

export interface SearchOutcome {
  leads: DiscoveredLead[];
  providerRunId?: string;
  units: number;
}

export interface EnrichmentOutcome {
  company?: Partial<CompanyProfile>;
  contactPoints?: ContactPoint[];
  socialProfiles?: SocialProfile[];
  providerRunId?: string;
  units: number;
}

export interface VerificationOutcome {
  verificationStatus: VerificationStatus;
  confidence: number;
  units: number;
}

export type RoutingStrategyName = "CHEAPEST" | "BEST_QUALITY" | "FASTEST" | "BALANCED" | "MANUAL";

export interface LeadBudget {
  maxJobCost: number;
  currency: string;
  maxCostPerLead: number;
  allowOverrunPercent: number;
  requireApprovalAbove: number;
}

export interface LeadJob {
  id: string;
  type: "search" | "enrich" | "verify" | "score" | "export";
  status: "queued" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled" | "blocked";
  request: Record<string, unknown>;
  strategy: RoutingStrategyName;
  budget: LeadBudget;
  selectedProviders: string[];
  estimatedCost: number;
  actualCost: number;
  currency: string;
  result: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface PipelineStep {
  id: string;
  action: string;
  when?: string;
  status?: "pending" | "running" | "completed" | "skipped" | "failed";
  provider?: string;
  estimatedCost?: number;
  actualCost?: number;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface PipelineDefinition {
  id: string;
  name: string;
  steps: PipelineStep[];
  enabled: boolean;
}

export interface PipelineRun {
  id: string;
  pipelineId: string;
  status: "queued" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";
  request: Record<string, unknown>;
  steps: PipelineStep[];
  estimatedCost: number;
  actualCost: number;
  errorCode: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface SuppressionEntry {
  id: string;
  matchType: "email" | "phone" | "domain" | "company" | "person";
  matchValue: string;
  reason: "manual_block" | "opt_out" | "invalid" | "legal_hold" | "do_not_contact" | "internal_test";
  createdBy: string;
  createdAt: string;
}

export interface ScoringProfile {
  id: string;
  name: string;
  version: number;
  weights: Record<string, number>;
}
