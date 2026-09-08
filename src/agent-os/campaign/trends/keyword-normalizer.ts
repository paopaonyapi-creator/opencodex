// Pao Stock Autonomous Campaign Planner — Keyword Normalizer & Classifier (Phase 21)
//
// Normalizes raw trend signals, extracts commercial intent modifiers,
// and maps queries to high-value commercial stock categories.

export interface NormalizedKeywordResult {
  normalized: string;
  category: string;
  commercialIntent: number; // [0, 1]
  detectedModifiers: string[];
  isHighValueNiche: boolean;
}

const COMMERCIAL_MODIFIERS: Record<string, number> = {
  enterprise: 0.95,
  industrial: 0.90,
  commercial: 0.90,
  sustainable: 0.85,
  autonomous: 0.85,
  corporate: 0.80,
  professional: 0.80,
  infrastructure: 0.85,
  smart: 0.75,
  modular: 0.75,
  advanced: 0.70,
  renewable: 0.85,
  precision: 0.80,
  consumer: 0.70,
  concept: 0.75,
  lifestyle: 0.65,
  retail: 0.75,
};

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  clean_tech: ["solar", "wind", "hydrogen", "battery", "renewable", "clean energy", "microgrid", "geothermal", "storage"],
  robotics: ["robot", "cobot", "automation", "manipulator", "humanoid", "warehouse robot", "mechatronics"],
  ai_infrastructure: ["datacenter", "data center", "server", "gpu", "neural", "compute", "cooling rack", "fiber"],
  sustainable_mobility: ["ev", "electric vehicle", "micro-mobility", "micromobility", "charging station", "scooter", "transit"],
  agritech: ["vertical farm", "hydroponics", "precision agriculture", "crop monitoring", "automated greenhouse"],
  biotech: ["genomics", "laboratory", "crispr", "pharmaceutical", "biomedical", "assay", "cellular"],
  fintech: ["payment", "fintech", "contactless", "digital banking", "ledger", "pos terminal"],
};

/**
 * Strips noise, lowercases, and normalizes spacing in raw trend keywords.
 */
export function normalizeKeyword(raw: string): string {
  if (!raw) return "";
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s-_]/g, " ")
    .replace(/[\s_-]+/g, " ")
    .trim();
}

/**
 * Classifies the commercial category of a normalized keyword.
 */
export function classifyCommercialCategory(keyword: string): { category: string; confidence: number } {
  const normalized = normalizeKeyword(keyword);
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (normalized.includes(kw)) {
        return { category: cat, confidence: 0.9 };
      }
    }
  }
  return { category: "commercial_editorial", confidence: 0.5 };
}

/**
 * Evaluates commercial intent modifiers present in the keyword.
 */
export function extractCommercialIntent(keyword: string): { intentScore: number; modifiers: string[] } {
  const normalized = normalizeKeyword(keyword);
  const words = normalized.split(/\s+/);
  const detected: string[] = [];
  let scoreSum = 0;

  for (const word of words) {
    if (COMMERCIAL_MODIFIERS[word] !== undefined) {
      detected.push(word);
      scoreSum += COMMERCIAL_MODIFIERS[word];
    }
  }

  // Baseline intent is 0.50. Modifiers boost towards 1.0.
  const baseline = 0.50;
  const boost = detected.length > 0 ? (scoreSum / detected.length) * 0.45 : 0;
  const finalScore = Number(Math.min(0.98, baseline + boost).toFixed(2));

  return {
    intentScore: finalScore,
    modifiers: detected,
  };
}

/**
 * Full analysis pipeline for an incoming trend keyword.
 */
export function analyzeTrendKeyword(raw: string): NormalizedKeywordResult {
  const normalized = normalizeKeyword(raw);
  const { category } = classifyCommercialCategory(normalized);
  const { intentScore, modifiers } = extractCommercialIntent(normalized);

  return {
    normalized,
    category,
    commercialIntent: intentScore,
    detectedModifiers: modifiers,
    isHighValueNiche: intentScore >= 0.70 && category !== "commercial_editorial",
  };
}
