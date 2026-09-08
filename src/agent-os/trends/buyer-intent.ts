// Phase 20.10 — Buyer Intent Engine (spec section 13).
//
// Extracts commercial buyer intent, identifies target business buyer personas,
// enterprise pain points, industry verticals, and commercial use cases.

import type { NormalizedTrendSignal } from "./types";

export interface BuyerIntentAnalysis {
  buyerIntentScore: number; // 0..100
  targetIndustry: string;
  buyerPersonas: string[];
  commercialUseCases: string[];
  painPoints: string[];
  businessContext: string;
  purchaseLikelihood: "high" | "medium" | "low";
}

const INDUSTRY_KEYWORDS: Record<string, { industry: string; buyers: string[]; useCases: string[]; painPoints: string[] }> = {
  agriculture: {
    industry: "Agriculture & AgTech",
    buyers: ["AgTech marketers", "Smart farming enterprises", "Agricultural publishers", "Drone service providers"],
    useCases: ["Precision farming promos", "Sustainability reports", "Agricultural machinery brochures"],
    painPoints: ["Crop yield optimization", "Labor shortages", "Climate impact monitoring"],
  },
  farming: {
    industry: "Agriculture & AgTech",
    buyers: ["Farm equipment manufacturers", "Agri-business advertisers", "Food supply chain analysts"],
    useCases: ["Modern farming campaigns", "Investor presentations", "Agronomy articles"],
    painPoints: ["Drought management", "Automated harvesting", "Resource efficiency"],
  },
  technology: {
    industry: "Enterprise Technology & SaaS",
    buyers: ["SaaS marketing teams", "Tech event organizers", "Cloud infrastructure vendors"],
    useCases: ["Landing pages", "Product launch keynote slides", "Technical whitepapers"],
    painPoints: ["Complex data visualization", "System reliability", "Legacy migration"],
  },
  ai: {
    industry: "Artificial Intelligence & Robotics",
    buyers: ["AI startup founders", "Tech news media", "Corporate venture decks"],
    useCases: ["AI product marketing", "Ethics & safety articles", "Enterprise digital transformation"],
    painPoints: ["Overly abstract concepts", "Black box opacity", "Automation anxiety"],
  },
  solar: {
    industry: "Clean Energy & Renewables",
    buyers: ["Solar installation companies", "Renewable energy utilities", "ESG reporting teams"],
    useCases: ["Green energy advertisements", "Corporate sustainability decks", "Clean tech case studies"],
    painPoints: ["Dust/efficiency reduction", "Grid integration", "Installation safety"],
  },
  energy: {
    industry: "Clean Energy & Utilities",
    buyers: ["Utility operators", "Environmental agencies", "Clean energy investors"],
    useCases: ["Renewable transition promos", "Energy grid documentaries", "Infrastructure proposals"],
    painPoints: ["Decarbonization targets", "High capital costs", "Energy storage scaling"],
  },
  healthcare: {
    industry: "Healthcare & Life Sciences",
    buyers: ["Hospital marketing departments", "MedTech vendors", "Pharmaceutical publishers"],
    useCases: ["Patient care brochures", "Medical device commercials", "Health insurance campaigns"],
    painPoints: ["Patient anxiety", "Staff burnout", "Regulatory compliance"],
  },
  finance: {
    industry: "Banking & Financial Services",
    buyers: ["FinTech growth marketers", "Wealth management firms", "Banking app designers"],
    useCases: ["Mobile banking ads", "Retirement planning webinars", "Corporate investment reviews"],
    painPoints: ["Fraud prevention", "Market volatility", "Financial literacy"],
  },
  logistics: {
    industry: "Logistics & Supply Chain",
    buyers: ["Freight operators", "E-commerce fulfillment companies", "Warehouse robotics vendors"],
    useCases: ["Last-mile delivery promotions", "Global trade presentations", "Supply chain dashboards"],
    painPoints: ["Delivery delays", "Warehouse congestion", "Fuel price spikes"],
  },
};

export function analyzeBuyerIntent(
  topic: string,
  keywords: string[] = [],
  signals: NormalizedTrendSignal[] = [],
): BuyerIntentAnalysis {
  const normalizedText = [topic, ...keywords].join(" ").toLowerCase();

  // Match domain industry
  let matchedConfig = INDUSTRY_KEYWORDS.technology; // default baseline
  for (const [key, config] of Object.entries(INDUSTRY_KEYWORDS)) {
    if (normalizedText.includes(key)) {
      matchedConfig = config;
      break;
    }
  }

  // Base commercial keywords density
  const commercialSignals = [
    "b2b", "commercial", "enterprise", "business", "corporate", "professional",
    "solution", "service", "automated", "industry", "efficiency", "management",
    "smart", "sustainable", "technology", "finance", "healthcare",
  ];

  const matchedWords = commercialSignals.filter((word) => normalizedText.includes(word));
  let intentScore = 40 + matchedWords.length * 10;

  // Boost if any signals have strong downloads or engagement
  const stockDownloads = signals
    .filter((s) => s.source === "adobe_stock")
    .reduce((sum, s) => sum + (s.downloads || 0), 0);
  if (stockDownloads > 50) intentScore += 15;
  else if (stockDownloads > 10) intentScore += 8;

  intentScore = Math.max(20, Math.min(95, intentScore));

  let purchaseLikelihood: "high" | "medium" | "low" = "medium";
  if (intentScore >= 75) purchaseLikelihood = "high";
  else if (intentScore < 50) purchaseLikelihood = "low";

  return {
    buyerIntentScore: intentScore,
    targetIndustry: matchedConfig.industry,
    buyerPersonas: matchedConfig.buyers,
    commercialUseCases: matchedConfig.useCases,
    painPoints: matchedConfig.painPoints,
    businessContext: `Commercial demand driven by ${matchedConfig.industry.toLowerCase()} needing authentic, modern stock assets illustrating ${topic}.`,
    purchaseLikelihood,
  };
}
