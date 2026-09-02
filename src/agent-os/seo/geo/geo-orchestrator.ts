/**
 * Phase 18.1 — GEO orchestrator: runs the capability-gated GEO audit over the
 * Phase 18 project model, verifies every important finding against raw
 * first-party responses, suppresses false positives, and emits recommendations
 * through the existing Phase 18 inbox. Never writes to the audited website.
 */
import { randomUUID } from "node:crypto";
import { recordSeoRun } from "../seo-models";
import type { SeoProjectContext } from "../types";
import { addSeoRecommendation } from "../seo-models";
import type { GeoAuditResult, GeoEvidence, GeoFinding, GeoRecommendation } from "./types";
import { checkCrawlerPolicy, checkLlmsTxt, checkSchema, type CrawlersCheck, type LlmsTxtCheck, type SchemaCheck } from "./analyzers";

export class GeoDisabledError extends Error {
  constructor() { super("GEO engine is disabled for this project"); this.name = "GeoDisabledError"; }
}

export interface GeoAuditOptions {
  /** Default true; tests/air-gapped runs can disable the network lane. */
  fetchLive?: boolean;
}

/**
 * False-positive suppression rule (Phase 18.1 §85): a finding whose evidence
 * contradicts the detector is dropped and recorded as suppressed.
 */
function suppressContradicted(findings: GeoFinding[]): { kept: GeoFinding[]; suppressed: GeoFinding[] } {
  const kept: GeoFinding[] = [];
  const suppressed: GeoFinding[] = [];
  for (const finding of findings) {
    const contradicted = finding.evidence.some(evidence =>
      evidence.verification === "verified" && evidence.detail?.["contradicts"] === true,
    );
    (contradicted ? suppressed : kept).push({ ...finding, verification: contradicted ? "suppressed_false_positive" : finding.verification });
  }
  return { kept, suppressed };
}

export async function runGeoAudit(input: {
  project: SeoProjectContext;
  options?: GeoAuditOptions;
}): Promise<GeoAuditResult> {
  const { project } = input;
  const fetchLive = input.options?.fetchLive ?? true;
  const startedMs = Date.now();
  // For an example.com-style fixture domain the network lane is skipped unless
  // the caller explicitly opts in; in production this follows project config.
  const domain = project.domain;
  const isFixture = /(^|\.)example$/.test(domain) || /(^|\.)invalid$/.test(domain) || /(^|\.)test$/.test(domain) || /(^|\.)localhost$/.test(domain);
  const live = fetchLive && !isFixture;

  const findings: GeoFinding[] = [];
  const evidence: GeoEvidence[] = [];
  let crawlerPolicy: GeoAuditResult["crawlerPolicy"] = [];
  let llmsTxt: GeoAuditResult["llmsTxt"] = { state: "unknown", url: `https://${domain}/llms.txt`, httpStatus: null, issues: [] };
  let schema: GeoAuditResult["schema"] = { blocksFound: 0, families: [] };

  if (live) {
    const [crawlers, llms, schemaCheck] = await Promise.all([
      checkCrawlerPolicy(domain),
      checkLlmsTxt(domain),
      checkSchema(domain),
    ] as const);
    crawlerPolicy = (crawlers as CrawlersCheck).statuses;
    findings.push(...(crawlers as CrawlersCheck).findings, ...(llms as LlmsTxtCheck).findings, ...(schemaCheck as SchemaCheck).findings);
    evidence.push(...crawlers.evidence, ...llms.evidence, ...schemaCheck.evidence);
    llmsTxt = { state: (llms as LlmsTxtCheck).state, url: (llms as LlmsTxtCheck).url, httpStatus: (llms as LlmsTxtCheck).httpStatus, issues: (llms as LlmsTxtCheck).issues };
    schema = { blocksFound: (schemaCheck as SchemaCheck).blocksFound, families: (schemaCheck as SchemaCheck).families };
  } else {
    // Fixture/air-gapped mode: all network findings are explicitly unverified,
    // never fabricated — the report says what could NOT be checked.
    findings.push({
      id: `f_${randomUUID().slice(0, 8)}`, agent: "geo-orchestrator",
      title: "Network verification skipped for this domain",
      detail: `Domain ${domain} is a fixture/reserved name; robots.txt, llms.txt, and raw-HTML schema checks were NOT executed. Nothing is claimed about the live site.`,
      basis: "unknown", verification: "unverifiable", evidence: [], impact: "low", confidence: 1,
    });
  }

  const { kept, suppressed } = suppressContradicted(findings);
  const verifiedCount = kept.filter(finding => finding.verification === "verified").length;
  const conflictCount = kept.filter(finding => finding.verification === "conflict").length;
  const unverifiedCount = kept.filter(finding => finding.verification === "unverified" || finding.verification === "unverifiable").length;

  // Transparent heuristic score: start neutral, subtract for verified problems.
  // Explicitly a HEURISTIC SCORE — never a platform ranking prediction.
  let heuristicscore = 100;
  for (const finding of kept) {
    if (finding.verification !== "verified") continue;
    heuristicscore -= finding.impact === "critical" ? 25 : finding.impact === "high" ? 15 : finding.impact === "medium" ? 8 : 3;
  }
  heuristicscore = Math.max(0, heuristicscore);

  const recommendations: GeoRecommendation[] = kept
    .filter(finding => finding.impact !== "low")
    .map(finding => ({
      ...finding,
      area: finding.agent === "ai-crawler-policy" ? "crawlers" as const
        : finding.agent === "llms-txt" ? "llms_txt" as const
        : finding.agent === "schema-intelligence" ? "schema" as const
        : "technical" as const,
      effort: "medium" as const,
      requiresApproval: finding.title.toLowerCase().includes("blocked") || finding.agent === "schema-intelligence",
    }));

  // Persist recommendations into the Phase 18 inbox (same store, same lifecycle).
  for (const recommendation of recommendations) {
    addSeoRecommendation({
      projectId: project.id,
      area: recommendation.area,
      title: `[GEO] ${recommendation.title}`,
      detail: recommendation.detail,
      impact: recommendation.impact,
      effort: recommendation.effort,
      requiresApproval: recommendation.requiresApproval,
      evidence: { verification: recommendation.verification, basis: recommendation.basis, evidenceIds: recommendation.evidence.map(item => item.id) },
    });
  }

  const runId = recordSeoRun({
    projectId: project.id,
    kind: "geo_audit",
    status: "succeeded",
    provider: "geo-engine",
    provenance: live ? "live" : "mock",
    result: { heuristicscore, verified: verifiedCount, unverified: unverifiedCount, conflict: conflictCount, suppressed: suppressed.length, crawlerPolicy: crawlerPolicy.map(status => ({ id: status.crawlerId, access: status.access })) },
    startedMs,
    durationMs: Date.now() - startedMs,
  });

  return {
    runId,
    projectId: project.id,
    domain,
    heuristicscore,
    verificationSummary: { verified: verifiedCount, unverified: unverifiedCount, conflict: conflictCount, suppressed: suppressed.length },
    findings: kept,
    recommendations,
    crawlerPolicy,
    llmsTxt,
    schema,
  };
}
