/**
 * Phase 18 — SEO Orchestrator (slice 1: research & analysis lane).
 *
 * Loads project context, checks provider capabilities, runs the allowed agents
 * against the provider, enforces the project policy (research/audit gates),
 * scores recommendations, records one seo_run per execution, and emits
 * prioritized recommendations into the inbox. Write actions are NEVER taken
 * here: anything needing a change lands as requiresApproval = true.
 */
import type { SeoProvider, SeoProjectContext, SeoCapability, SeoPolicy } from "./types";
import { addSeoRecommendation, recordSeoRun } from "./seo-models";

export interface SeoOrchestratorResult {
  runId: string;
  projectId: string;
  provider: string;
  provenance: string;
  domainSnapshot: Record<string, unknown> | null;
  keywords: Array<Record<string, unknown>>;
  competitors: Array<Record<string, unknown>>;
  backlinks: Record<string, unknown> | null;
  recommendations: Array<{ id: string; title: string; impact: string; requiresApproval: boolean }>;
  policy: SeoPolicy;
}

export class SeoPolicyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeoPolicyViolationError";
  }
}

function impactFor(overlapKeywords: number | null | undefined, difficulty: number | null | undefined): "critical" | "high" | "medium" | "low" {
  const overlap = overlapKeywords ?? 0;
  if (overlap >= 300) return "critical";
  if (overlap >= 150 || (difficulty ?? 100) < 25) return "high";
  if (overlap >= 50) return "medium";
  return "low";
}

export async function runSeoAnalysis(input: {
  project: SeoProjectContext;
  provider: SeoProvider;
  capabilities?: SeoCapability[];
}): Promise<SeoOrchestratorResult> {
  const { project, provider } = input;
  const policy = project.policy;
  const startedMs = Date.now();
  if (!policy.allowResearch) {
    const runId = recordSeoRun({ projectId: project.id, kind: "analyze", status: "policy_denied", provider: provider.id, startedMs, durationMs: 0 });
    throw new SeoPolicyViolationError(`SEO research is disabled by policy for project ${project.id} (run ${runId})`);
  }

  const capabilities = input.capabilities ?? await provider.listCapabilities();
  const has = (capability: SeoCapability) => capabilities.includes(capability);

  const domainSnapshot = has("domain_overview") && provider.analyzeDomain
    ? await provider.analyzeDomain({ domain: project.domain })
    : null;
  const keywordResearch = has("keyword_research") && provider.keywordResearch
    ? await provider.keywordResearch({
        seeds: project.seedKeywords.length > 0 ? project.seedKeywords : [project.domain],
        country: project.country,
        language: project.language,
        limit: 15,
      })
    : null;
  const competitorAnalysis = has("competitor_analysis") && provider.analyzeCompetitors
    ? await provider.analyzeCompetitors({ domain: project.domain, limit: 5 })
    : null;
  const backlinks = has("backlink_overview") && provider.analyzeBacklinks
    ? await provider.analyzeBacklinks({ domain: project.domain })
    : null;

  const recommendations: SeoOrchestratorResult["recommendations"] = [];
  if (keywordResearch) {
    const quickWins = keywordResearch.keywords
      .filter(k => (k.difficulty ?? 100) <= 30 && (k.volume ?? 0) >= 200)
      .slice(0, 5);
    for (const k of quickWins) {
      recommendations.push(addSeoRecommendation({
        projectId: project.id,
        area: "keywords",
        title: `Target keyword: ${k.keyword}`,
        detail: `volume=${k.volume ?? "?"} difficulty=${k.difficulty ?? "?"} intent=${k.intent} (provenance: ${k.provenance})`,
        impact: (k.volume ?? 0) >= 1000 ? "high" : "medium",
        effort: "medium",
        evidence: { keyword: k.keyword, volume: k.volume, difficulty: k.difficulty, intent: k.intent, provenance: k.provenance },
      }));
    }
  }
  if (competitorAnalysis) {
    for (const c of competitorAnalysis.competitors.slice(0, 3)) {
      recommendations.push(addSeoRecommendation({
        projectId: project.id,
        area: "competitors",
        title: `Study competitor: ${c.domain}`,
        detail: `overlap=${c.overlapKeywords ?? "?"} keywords; their traffic=${c.organicTraffic ?? "?"}`,
        impact: impactFor(c.overlapKeywords, null),
        effort: "low",
        evidence: { domain: c.domain, overlapKeywords: c.overlapKeywords, organicTraffic: c.organicTraffic, provenance: competitorAnalysis.provenance },
      }));
    }
  }

  const runId = recordSeoRun({
    projectId: project.id,
    kind: "analyze",
    status: "succeeded",
    provider: provider.id,
    provenance: domainSnapshot?.provenance ?? keywordResearch?.provenance ?? competitorAnalysis?.provenance ?? "mock",
    result: { capabilities: capabilities.filter(c => c !== "unknown"), domainSnapshot, keywordCount: keywordResearch?.keywords.length ?? 0, competitorCount: competitorAnalysis?.competitors.length ?? 0, backlinks },
    startedMs,
    durationMs: Date.now() - startedMs,
  });

  return {
    runId,
    projectId: project.id,
    provider: provider.id,
    provenance: domainSnapshot?.provenance ?? keywordResearch?.provenance ?? competitorAnalysis?.provenance ?? "mock",
    domainSnapshot: domainSnapshot as unknown as Record<string, unknown>,
    keywords: (keywordResearch?.keywords ?? []) as unknown as Array<Record<string, unknown>>,
    competitors: (competitorAnalysis?.competitors ?? []) as unknown as Array<Record<string, unknown>>,
    backlinks: backlinks as unknown as Record<string, unknown>,
    recommendations,
    policy,
  };
}
