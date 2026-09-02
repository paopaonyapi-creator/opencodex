/**
 * Phase 18.1 — Pao GEO Intelligence Engine types.
 * GEO/AI-search readiness on top of the Phase 18 SEO domain model. All scores
 * produced here are HEURISTIC and must never be presented as platform
 * ranking signals; every claim carries provenance and verification state.
 */

export type GeoPlatform = "chatgpt" | "claude" | "perplexity" | "gemini" | "google_ai_overviews" | "copilot" | "other";

export type GeoCapability =
  | "citability_analysis"
  | "ai_crawler_analysis"
  | "llms_txt_analysis"
  | "llms_txt_generation"
  | "brand_authority_analysis"
  | "entity_consistency"
  | "platform_readiness"
  | "schema_analysis"
  | "schema_generation"
  | "eeat_analysis"
  | "geo_technical_analysis"
  | "evidence_verification"
  | "geo_report"
  | "geo_compare";

/** Observation basis per Phase 18.1 §18: never claim proprietary knowledge. */
export type GeoFindingBasis =
  | "observed_web_standard"
  | "public_platform_documentation"
  | "general_retrieval_principle"
  | "heuristic"
  | "unknown";

/** The epistemic status of a finding: observed vs verified vs inferred. */
export type GeoVerificationState = "unverified" | "verified" | "conflict" | "suppressed_false_positive" | "unverifiable";

export interface GeoEvidence {
  id: string;
  url: string;
  kind: "http_status" | "raw_content" | "html_head" | "robots_txt" | "llms_txt" | "json_ld" | "page_text";
  verification: GeoVerificationState;
  httpStatus?: number | null;
  finalUrl?: string | null;
  contentHash?: string | null;
  excerpt?: string | null;          // short locator/excerpt, never full copyrighted page
  lineHint?: string | null;         // e.g. "robots.txt L12"
  retrievedAt: string;
  detail?: Record<string, unknown>;
}

export interface GeoFinding {
  id: string;
  agent: string;
  title: string;
  detail: string;
  basis: GeoFindingBasis;
  verification: GeoVerificationState;
  evidence: GeoEvidence[];
  impact: "critical" | "high" | "medium" | "low";
  confidence: number;               // 0..1, detector self-assessment
}

export interface GeoRecommendation extends GeoFinding {
  area: "citability" | "crawlers" | "llms_txt" | "brand" | "platform" | "schema" | "content" | "technical" | "evidence";
  effort: "low" | "medium" | "high";
  requiresApproval: boolean;        // any write to the site always true
}

export interface GeoCrawlerPolicyStatus {
  crawlerId: string;
  displayName: string;
  category: "training" | "search" | "retrieval" | "unknown";
  access: "allowed" | "blocked" | "partial" | "unknown";
  evidenceLines: string[];
}

export type LlmsTxtState = "present_valid" | "present_with_issues" | "missing" | "fetch_failed" | "unknown";

export interface GeoAuditResult {
  runId: string;
  projectId: string;
  domain: string;
  heuristicscore: number;          // 0..100, explicitly heuristic
  verificationSummary: { verified: number; unverified: number; conflict: number; suppressed: number };
  findings: GeoFinding[];
  recommendations: GeoRecommendation[];
  crawlerPolicy: GeoCrawlerPolicyStatus[];
  llmsTxt: { state: LlmsTxtState; url: string; httpStatus?: number | null; issues: string[] };
  schema: { blocksFound: number; families: string[] };
}
