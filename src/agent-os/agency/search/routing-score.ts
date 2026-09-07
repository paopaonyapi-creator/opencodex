// Phase 20.8 — Explainable Routing Score Formula
// Evaluates agent match against search query and task requirements.

import type { AgencyAgent, RoutingScoreBreakdown } from "../types";

export interface ScoreEvaluationResult {
  score: number;
  reasons: string[];
  breakdown: RoutingScoreBreakdown;
}

export function calculateRoutingScore(
  agent: AgencyAgent,
  query: string,
  targetCapabilities: string[] = [],
  preferredDivision?: string,
): ScoreEvaluationResult {
  const q = query.toLowerCase().trim();
  const reasons: string[] = [];

  // 1. Capability Match (Weight: 0.35)
  let capabilityScore = 0.0;
  const agentCaps = (agent.capabilities ?? []).map((c) => c.toLowerCase());
  let matchedCapsCount = 0;

  for (const cap of targetCapabilities) {
    const cLower = cap.toLowerCase();
    if (agentCaps.some((ac) => ac.includes(cLower) || cLower.includes(ac))) {
      matchedCapsCount++;
      reasons.push(`Direct capability match: ${cap}`);
    }
  }

  if (targetCapabilities.length > 0) {
    capabilityScore = Math.min(1.0, matchedCapsCount / targetCapabilities.length);
  } else {
    // If no explicit target capabilities, test if agent capabilities appear in query
    const inQuery = agentCaps.filter((ac) => q.includes(ac));
    if (inQuery.length > 0) {
      capabilityScore = Math.min(1.0, inQuery.length * 0.4);
      reasons.push(`Capabilities match query terms: ${inQuery.slice(0, 2).join(", ")}`);
    }
  }

  // 2. Keyword & Token Match (Weight: 0.25)
  let keywordScore = 0.0;
  const qWords = q.split(/\s+/).filter((w) => w.length > 2);
  const agentKeywords = new Set([
    ...agent.keywords.map((k) => k.toLowerCase()),
    ...agent.slug.toLowerCase().split("-"),
    agent.name.toLowerCase(),
  ]);

  let matchedWords = 0;
  for (const word of qWords) {
    if (agentKeywords.has(word) || Array.from(agentKeywords).some((ak) => ak.includes(word))) {
      matchedWords++;
    }
  }

  if (qWords.length > 0) {
    keywordScore = Math.min(1.0, matchedWords / Math.min(qWords.length, 5));
    if (keywordScore > 0.4) {
      reasons.push(`Strong lexical relevance to query`);
    }
  }

  // 3. Division Fit (Weight: 0.15)
  let divisionScore = 0.5; // neutral baseline
  if (preferredDivision) {
    if (agent.division.toLowerCase() === preferredDivision.toLowerCase()) {
      divisionScore = 1.0;
      reasons.push(`Exact match for division '${preferredDivision}'`);
    } else {
      divisionScore = 0.2;
    }
  } else {
    // Check if query implies division
    if (q.includes(agent.division.toLowerCase())) {
      divisionScore = 0.9;
      reasons.push(`Matches division '${agent.division}' referenced in request`);
    }
  }

  // 4. Deliverable Fit (Weight: 0.15)
  let deliverableScore = 0.3;
  const deliverablesText = (agent.deliverables ?? []).join(" ").toLowerCase();
  const dMatches = qWords.filter((w) => deliverablesText.includes(w));
  if (dMatches.length > 0) {
    deliverableScore = Math.min(1.0, 0.4 + (dMatches.length * 0.2));
    reasons.push(`Specialist deliverables align with task outputs`);
  }

  // 5. Reliability / History Score (Weight: 0.10)
  const perf = agent.performance;
  let reliabilityScore = 0.9; // high default for clean bundled agents
  if (perf && perf.runs > 0) {
    reliabilityScore = perf.successRate;
    if (reliabilityScore > 0.8) {
      reasons.push(`High historical success rate (${Math.round(reliabilityScore * 100)}%)`);
    }
  }

  // Composite calculation
  const compositeScore =
    capabilityScore * 0.35 +
    keywordScore * 0.25 +
    divisionScore * 0.15 +
    deliverableScore * 0.15 +
    reliabilityScore * 0.10;

  const roundedScore = Math.round(compositeScore * 100) / 100;

  return {
    score: roundedScore,
    reasons: reasons.length > 0 ? reasons : [`Standard profile match for ${agent.name}`],
    breakdown: {
      capability: Math.round(capabilityScore * 100) / 100,
      semantic: 0.0,
      keyword: Math.round(keywordScore * 100) / 100,
      division: Math.round(divisionScore * 100) / 100,
      deliverable: Math.round(deliverableScore * 100) / 100,
      reliability: Math.round(reliabilityScore * 100) / 100,
    },
  };
}
