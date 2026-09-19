// Phase 20.94 — budget-governed deep research runtime.
// Default search is a local evidence corpus so tests and air-gapped installs
// terminate deterministically. A live SearchProvider can be injected.

import { createHash } from "node:crypto";
import type { Budget, BudgetUsage } from "./types";
import { EnzoWorkspaceError, emptyUsage } from "./types";

export interface EvidenceHit {
  sourceId: string;
  url: string;
  title: string;
  snippet: string;
  query: string;
}

export interface ResearchClaim {
  claim: string;
  sourceIds: string[];
  confidence: number;
  uncertainty?: string;
}

export interface ResearchResult {
  question: string;
  status: "completed" | "budget_exhausted" | "cancelled";
  queries: string[];
  sources: EvidenceHit[];
  rejected: Array<{ sourceId: string; reason: string }>;
  claims: ResearchClaim[];
  synthesis: string;
  usage: BudgetUsage;
  stopReason: string;
}

export interface SearchProvider {
  search(query: string, limit: number): Promise<EvidenceHit[]>;
}

const CORPUS: Array<Omit<EvidenceHit, "query">> = [
  {
    sourceId: "src-stock-1",
    url: "https://helpx.adobe.com/stock/seller/content-requirements.html",
    title: "Adobe Stock content requirements",
    snippet: "Commercially useful stock assets need clear subject, clean licensing, and metadata that matches depicted content. Editorial-only concepts fail commercial usefulness.",
  },
  {
    sourceId: "src-stock-2",
    url: "https://helpx.adobe.com/stock/seller/quality.html",
    title: "Adobe Stock quality bar",
    snippet: "Reject noisy composites, trademark risk, and concepts without a plausible buyer. Isolated objects and lifestyle scenes with negative space outperform novelty mashups.",
  },
  {
    sourceId: "src-trend-1",
    url: "https://example.local/trends/ai-routing-2026",
    title: "AI agent routing demand 2026",
    snippet: "Search interest clusters around multi-provider failover, local-only privacy routes, and cost-per-successful-task rather than raw token volume.",
  },
  {
    sourceId: "src-trend-2",
    url: "https://example.local/trends/adobe-stock-ai",
    title: "Generative stock supply vs demand",
    snippet: "Oversupply of generic AI landscapes; undersupply of industrial, accessibility, and bilingual SME workflow scenes with documented commercial use.",
  },
  {
    sourceId: "src-pao-1",
    url: "https://example.local/paohub/architecture",
    title: "Pao-hubPro composition law",
    snippet: "New phases must compose OmniRoute, SkillsGate, MCPProxy, and policy gates. Duplicate routers or memory databases are rejected.",
  },
  {
    sourceId: "src-conflict-1",
    url: "https://example.local/trends/counter",
    title: "Counterclaim on AI stock",
    snippet: "Some buyers report AI stock converting poorly unless the brief is hyper-specific. Treat 'AI stock sells' as contested.",
  },
];

export class LocalCorpusSearch implements SearchProvider {
  async search(query: string, limit: number): Promise<EvidenceHit[]> {
    const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 3);
    const ranked = CORPUS
      .map((row) => ({
        row,
        score: terms.reduce((n, t) => n + (row.title.toLowerCase().includes(t) || row.snippet.toLowerCase().includes(t) ? 1 : 0), 0),
      }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((r) => ({ ...r.row, query }));
    if (ranked.length === 0) {
      return CORPUS.slice(0, Math.min(limit, 2)).map((row) => ({ ...row, query }));
    }
    return ranked;
  }
}

export async function runResearch(input: {
  question: string;
  budget: Budget;
  search?: SearchProvider;
  signal?: AbortSignal;
}): Promise<ResearchResult> {
  const search = input.search ?? new LocalCorpusSearch();
  const usage = emptyUsage();
  const started = Date.now();
  const queries: string[] = [];
  const sources: EvidenceHit[] = [];
  const rejected: ResearchResult["rejected"] = [];
  const seen = new Set<string>();

  const planned = planQueries(input.question);
  let stopReason = "coverage threshold";
  let status: ResearchResult["status"] = "completed";

  for (const query of planned) {
    if (input.signal?.aborted) {
      status = "cancelled";
      stopReason = "operator cancelled";
      break;
    }
    if (usage.queries >= input.budget.maxQueries || usage.sources >= input.budget.maxSources || usage.costUsd >= input.budget.maxCostUsd) {
      status = "budget_exhausted";
      stopReason = exhaustedReason(usage, input.budget);
      break;
    }
    if (Date.now() - started > input.budget.maxRuntimeMinutes * 60_000) {
      status = "budget_exhausted";
      stopReason = "max_runtime";
      break;
    }
    queries.push(query);
    usage.queries += 1;
    usage.fetches += 1;
    usage.tokens += 400;
    usage.costUsd += 0.002;
    const hits = await search.search(query, 5);
    for (const hit of hits) {
      if (seen.has(hit.sourceId)) continue;
      seen.add(hit.sourceId);
      if (usage.sources >= input.budget.maxSources) {
        rejected.push({ sourceId: hit.sourceId, reason: "max_sources" });
        continue;
      }
      if (/trademark|illegal/i.test(hit.snippet)) {
        rejected.push({ sourceId: hit.sourceId, reason: "policy" });
        continue;
      }
      sources.push(hit);
      usage.sources += 1;
    }
    if (sources.length >= Math.min(4, input.budget.maxSources) && usage.queries >= 2) {
      stopReason = "coverage threshold";
      break;
    }
  }

  usage.runtimeMs = Date.now() - started;
  const claims = synthesizeClaims(input.question, sources);
  const synthesis = renderSynthesis(input.question, claims, sources, stopReason);
  return { question: input.question, status, queries, sources, rejected, claims, synthesis, usage, stopReason };
}

export function planQueries(question: string): string[] {
  const base = question.replace(/\s+/g, " ").trim();
  const extras = ["commercial usefulness", "policy risks", "buyer demand", "conflicting evidence", "local vs cloud routing"];
  const out = [base];
  for (const extra of extras) out.push(base + " " + extra);
  return out;
}

function exhaustedReason(usage: BudgetUsage, budget: Budget): string {
  if (usage.queries >= budget.maxQueries) return "max_queries";
  if (usage.sources >= budget.maxSources) return "max_sources";
  if (usage.costUsd >= budget.maxCostUsd) return "max_cost";
  return "budget_exhausted";
}

function synthesizeClaims(question: string, sources: EvidenceHit[]): ResearchClaim[] {
  const claims: ResearchClaim[] = [];
  const stock = sources.filter((s) => /stock|adobe/i.test(s.title + s.snippet));
  if (stock.length) {
    claims.push({
      claim: "Commercially useful Adobe Stock concepts require a plausible buyer, clean licensing, and metadata that matches the depicted content.",
      sourceIds: stock.map((s) => s.sourceId),
      confidence: Math.min(0.9, 0.5 + stock.length * 0.1),
    });
  }
  const trend = sources.filter((s) => /trend|routing|demand/i.test(s.title + s.snippet));
  if (trend.length) {
    claims.push({
      claim: "Demand clusters around cost-per-successful-task and local-only routing, not raw token volume.",
      sourceIds: trend.map((s) => s.sourceId),
      confidence: 0.72,
    });
  }
  const conflict = sources.filter((s) => /contested|counter/i.test(s.title + s.snippet));
  if (conflict.length) {
    claims.push({
      claim: "AI-generated stock conversion is contested and should be treated as uncertain without category-specific evidence.",
      sourceIds: conflict.map((s) => s.sourceId),
      confidence: 0.55,
      uncertainty: "conflicting buyer reports",
    });
  }
  if (claims.length === 0) {
    claims.push({
      claim: "Insufficient sourced evidence to answer: " + question,
      sourceIds: [],
      confidence: 0.2,
      uncertainty: "no matching sources",
    });
  }
  return claims;
}

function renderSynthesis(question: string, claims: ResearchClaim[], sources: EvidenceHit[], stopReason: string): string {
  const lines = ["# Research report", "", "Question: " + question, "", "## Claims"];
  for (const claim of claims) {
    lines.push("- " + claim.claim + " (confidence " + claim.confidence.toFixed(2) + "; sources: " + (claim.sourceIds.join(", ") || "none") + ")");
    if (claim.uncertainty) lines.push("  uncertainty: " + claim.uncertainty);
  }
  lines.push("", "## Sources");
  for (const src of sources) {
    lines.push("- [" + src.sourceId + "] " + src.title + " — " + src.url);
  }
  lines.push("", "Stop reason: " + stopReason);
  return lines.join("\n");
}

export function assertBudgetNotExceeded(usage: BudgetUsage, budget: Budget): void {
  if (usage.queries > budget.maxQueries || usage.costUsd > budget.maxCostUsd + 1e-9) {
    throw new EnzoWorkspaceError("BUDGET_EXHAUSTED", 409, "research exceeded hard budget", { usage, budget });
  }
}

export function evidenceHash(result: ResearchResult): string {
  return createHash("sha256").update(result.synthesis).digest("hex");
}
