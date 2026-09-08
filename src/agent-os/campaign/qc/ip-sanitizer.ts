// Pao Stock Autonomous Campaign Planner — IP & Trademark Sanitizer (Phase 21)
//
// Protects generated commercial stock assets against trademark infringement,
// prohibited brand names, copyrighted logos, and unauthorized likeness risks.

import type { IpClearanceStatus } from "../types";

export interface IpClearanceResult {
  status: IpClearanceStatus;
  cleared: boolean;
  flaggedTerms: string[];
  riskScore: number; // [0, 1]
  recommendation: string;
}

const PROHIBITED_TRADEMARKS = new Set([
  // Tech & Electronics
  "apple", "iphone", "ipad", "macbook", "samsung", "galaxy", "sony", "playstation",
  "xbox", "microsoft", "windows", "intel", "nvidia", "amd", "tesla", "cybertruck",
  "nintendo", "switch", "huawei", "xiaomi", "lenovo", "dell", "hp", "canon", "nikon",
  // Automotive & Transport
  "ferrari", "lamborghini", "porsche", "bmw", "mercedes", "audi", "ford", "chevrolet",
  "toyota", "honda", "boeing", "airbus", "harley davidson", "vespa",
  // Apparel & Fashion
  "nike", "adidas", "puma", "reebok", "gucci", "prada", "louis vuitton", "chanel",
  "rolex", "omega", "cartier", "zara", "h&m", "uniqlo", "under armour",
  // Food & Beverage / Retail
  "coca-cola", "coke", "pepsi", "starbucks", "mcdonalds", "mcdonald's", "burger king",
  "nestle", "red bull", "walmart", "amazon", "ikea", "target", "costco",
  // Media & Entertainment
  "disney", "marvel", "pixar", "warner bros", "star wars", "batman", "superman",
  "spider-man", "pokemon", "lego", "barbie", "netflix",
]);

const LIKENESS_INDICATORS = new Set([
  "celebrity", "portrait of elon musk", "portrait of steve jobs", "taylor swift",
  "donald trump", "joe biden", "barack obama", "bill gates", "mark zuckerberg",
  "keanu reeves", "tom cruise", "leonardo dicaprio", "famous actor", "famous politician",
]);

/**
 * Scans strings or token arrays for trademark or celebrity likeness liability.
 */
export function scanIpClearance(input: string | string[]): IpClearanceResult {
  const combined = Array.isArray(input) ? input.join(" ") : input;
  const normalized = combined.toLowerCase().replace(/[^a-z0-9\s-]/g, " ");

  const flaggedTrademarks: string[] = [];
  const flaggedLikeness: string[] = [];

  // Check trademarks
  for (const tm of PROHIBITED_TRADEMARKS) {
    const regex = new RegExp(`\\b${tm}\\b`, "i");
    if (regex.test(normalized)) {
      flaggedTrademarks.push(tm);
    }
  }

  // Check likeness triggers
  for (const like of LIKENESS_INDICATORS) {
    if (normalized.includes(like)) {
      flaggedLikeness.push(like);
    }
  }

  if (flaggedTrademarks.length > 0) {
    return {
      status: "flagged_trademark",
      cleared: false,
      flaggedTerms: flaggedTrademarks,
      riskScore: 0.95,
      recommendation: `Remove prohibited trademark terms: ${flaggedTrademarks.join(", ")}`,
    };
  }

  if (flaggedLikeness.length > 0) {
    return {
      status: "flagged_likeness",
      cleared: false,
      flaggedTerms: flaggedLikeness,
      riskScore: 0.85,
      recommendation: `Likeness detected: ${flaggedLikeness.join(", ")}. Requires signed model release or exclusion.`,
    };
  }

  return {
    status: "cleared",
    cleared: true,
    flaggedTerms: [],
    riskScore: 0.0,
    recommendation: "Asset is fully cleared for commercial stock submission.",
  };
}
