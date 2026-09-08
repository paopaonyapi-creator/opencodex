// Phase 20.10 — Opportunity Scoring Engine (spec sections 8-12).
//
// Calculates Demand, Competition, AI Saturation, Social Momentum,
// Buyer Intent, and the Composite Opportunity Score.

import type { NormalizedTrendSignal, OpportunityRecommendation, OpportunityScore } from "./types";

export interface ScoreBreakdown {
  demandScore: number;
  momentumScore: number;
  buyerIntentScore: number;
  competitionScore: number;
  competitionGapScore: number;
  freshnessScore: number;
  productionFeasibilityScore: number;
  aiSaturationScore: number;
  opportunityScore: number;
  recommendation: OpportunityRecommendation;
  reasoning: {
    summary: string;
    pros: string[];
    cons: string[];
    suggestedAssetTypes: string[];
  };
}

export function calculateOpportunityScore(topic: string, signals: NormalizedTrendSignal[]): ScoreBreakdown {
  if (signals.length === 0) {
    return {
      demandScore: 20,
      momentumScore: 20,
      buyerIntentScore: 30,
      competitionScore: 50,
      competitionGapScore: 30,
      freshnessScore: 50,
      productionFeasibilityScore: 80,
      aiSaturationScore: 40,
      opportunityScore: 25,
      recommendation: "AVOID",
      reasoning: {
        summary: `Insufficient market signals for "${topic}"`,
        pros: [],
        cons: ["No clear signal activity detected across platforms"],
        suggestedAssetTypes: ["photo_raw"],
      },
    };
  }

  // 1. Demand Score D (0..100)
  const stockSignals = signals.filter((s) => s.source === "adobe_stock");
  const totalDownloads = stockSignals.reduce((acc, s) => acc + s.downloads, 0);
  const avgStockViews = stockSignals.length > 0 ? stockSignals.reduce((acc, s) => acc + s.views, 0) / stockSignals.length : 0;
  const demandScore = Math.min(100, Math.round((totalDownloads / 30) + (avgStockViews / 100) + 25));

  // 2. Momentum Score M (0..100)
  const socialSignals = signals.filter((s) => s.source !== "adobe_stock");
  const avgEngagement = socialSignals.length > 0
    ? socialSignals.reduce((acc, s) => acc + s.engagementRate, 0) / socialSignals.length
    : 0.04;
  const momentumScore = Math.min(100, Math.round(avgEngagement * 600 + (socialSignals.length > 3 ? 30 : 15)));

  // 3. Buyer Intent Score I_buyer (0..100)
  const avgIntent = signals.reduce((acc, s) => acc + s.commercialBuyerIntentScore, 0) / signals.length;
  const buyerIntentScore = Math.min(100, Math.round(avgIntent));

  // 4. Competition Score C (0..100)
  // Higher number of existing stock assets = higher competition
  const competitionScore = Math.min(100, Math.round(stockSignals.length * 8 + 20));

  // 5. AI Saturation Score S_ai (0..100)
  const aiCount = stockSignals.filter((s) => s.aiGenerated).length;
  const aiRatio = stockSignals.length > 0 ? aiCount / stockSignals.length : 0.3;
  const aiSaturationScore = Math.min(100, Math.round(aiRatio * 100));

  // 6. Competition Gap Score G (0..100)
  // High demand with low competition or low AI quality represents a massive gap
  const competitionGapScore = Math.max(0, Math.min(100, Math.round(demandScore * 1.1 - competitionScore * 0.5)));

  // 7. Freshness Score F (0..100)
  const freshnessScore = Math.min(100, Math.round(85 - signals.length * 2));

  // 8. Production Feasibility Score P_feas (0..100)
  // Generative AI in ComfyUI/MiniMax handles photos and 4k videos well
  const productionFeasibilityScore = 88;

  // 9. Composite Opportunity Score (0..100)
  // Opp = 0.30*D + 0.25*M + 0.20*I + 0.15*G - 0.10*C - 0.10*S_ai
  const rawOpp = (
    0.30 * demandScore +
    0.25 * momentumScore +
    0.20 * buyerIntentScore +
    0.15 * competitionGapScore -
    0.10 * competitionScore -
    0.10 * aiSaturationScore
  );
  const opportunityScore = Math.max(0, Math.min(100, Math.round(rawOpp)));

  // Recommendation Tier
  let recommendation: OpportunityRecommendation;
  if (opportunityScore >= 75) recommendation = "MUST_PRODUCE";
  else if (opportunityScore >= 55) recommendation = "GOOD_OPPORTUNITY";
  else if (opportunityScore >= 35) recommendation = "EXPLORE";
  else recommendation = "AVOID";

  // Detailed Reasoning Pros and Cons
  const pros: string[] = [];
  const cons: string[] = [];

  if (demandScore >= 60) pros.push(`Strong commercial download velocity (Demand score: ${demandScore})`);
  if (momentumScore >= 60) pros.push(`High social engagement and viral interest (Momentum score: ${momentumScore})`);
  if (buyerIntentScore >= 60) pros.push(`High business and advertising utility (Buyer Intent: ${buyerIntentScore})`);
  if (competitionGapScore >= 50) pros.push(`Significant market supply gap detected (Gap score: ${competitionGapScore})`);

  if (competitionScore >= 70) cons.push(`High existing competitor inventory on stock platforms (Competition: ${competitionScore})`);
  if (aiSaturationScore >= 60) cons.push(`Substantial generic AI imagery already flooding market (AI Saturation: ${aiSaturationScore})`);

  return {
    demandScore,
    momentumScore,
    buyerIntentScore,
    competitionScore,
    competitionGapScore,
    freshnessScore,
    productionFeasibilityScore,
    aiSaturationScore,
    opportunityScore,
    recommendation,
    reasoning: {
      summary: `Opportunity score ${opportunityScore}/100 (${recommendation}) for "${topic}"`,
      pros: pros.length > 0 ? pros : ["Standard commercial interest"],
      cons: cons.length > 0 ? cons : ["No major structural headwinds detected"],
      suggestedAssetTypes: opportunityScore >= 60 ? ["video_4k", "photo_raw"] : ["photo_raw"],
    },
  };
}
