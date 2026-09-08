// Pao Stock Autonomous Campaign Planner — Trend Signal Collector (Phase 21)
//
// Ingests, evaluates, and stores commercial market trend signals for high-demand,
// low-saturation stock asset production.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../../db";
import type {
  NicheScoringInput,
  TrendSignal,
  TrendSignalStatus,
} from "../types";
import { calculateNVS } from "./niche-scorer";

export interface TrendSeed {
  keyword: string;
  category: string;
  source: string;
  metrics: NicheScoringInput;
}

export const COMMERCIAL_TREND_SEEDS: TrendSeed[] = [
  {
    keyword: "green hydrogen fuel cell logistics",
    category: "clean_tech",
    source: "industrial_energy_index",
    metrics: {
      commercialIntent: 0.92,
      searchVelocity: 0.85,
      saturationIndex: 0.22,
      ipRiskPenalty: 0.05,
    },
  },
  {
    keyword: "floating offshore wind turbine maintenance",
    category: "clean_tech",
    source: "renewables_market_watch",
    metrics: {
      commercialIntent: 0.88,
      searchVelocity: 0.78,
      saturationIndex: 0.18,
      ipRiskPenalty: 0.02,
    },
  },
  {
    keyword: "humanoid warehouse palletizing robot",
    category: "robotics",
    source: "automation_tech_radar",
    metrics: {
      commercialIntent: 0.95,
      searchVelocity: 0.91,
      saturationIndex: 0.3,
      ipRiskPenalty: 0.08,
    },
  },
  {
    keyword: "surgical robotic arm microsurgery",
    category: "robotics",
    source: "medtech_demand_stream",
    metrics: {
      commercialIntent: 0.94,
      searchVelocity: 0.72,
      saturationIndex: 0.25,
      ipRiskPenalty: 0.05,
    },
  },
  {
    keyword: "liquid cooled enterprise ai datacenter",
    category: "ai_infrastructure",
    source: "cloud_infra_analytics",
    metrics: {
      commercialIntent: 0.96,
      searchVelocity: 0.94,
      saturationIndex: 0.35,
      ipRiskPenalty: 0.04,
    },
  },
  {
    keyword: "edge ai industrial machine vision",
    category: "ai_infrastructure",
    source: "smart_factory_insights",
    metrics: {
      commercialIntent: 0.89,
      searchVelocity: 0.81,
      saturationIndex: 0.28,
      ipRiskPenalty: 0.03,
    },
  },
  {
    keyword: "electric heavy duty cargo haulage",
    category: "sustainable_mobility",
    source: "fleet_electrification_feed",
    metrics: {
      commercialIntent: 0.87,
      searchVelocity: 0.76,
      saturationIndex: 0.26,
      ipRiskPenalty: 0.05,
    },
  },
  {
    keyword: "urban air mobility evtol vertiport",
    category: "sustainable_mobility",
    source: "aerospace_future_forecast",
    metrics: {
      commercialIntent: 0.85,
      searchVelocity: 0.82,
      saturationIndex: 0.2,
      ipRiskPenalty: 0.06,
    },
  },
  {
    keyword: "vertical farm automated hydroponics",
    category: "agritech",
    source: "sustainable_ag_digest",
    metrics: {
      commercialIntent: 0.84,
      searchVelocity: 0.75,
      saturationIndex: 0.32,
      ipRiskPenalty: 0.02,
    },
  },
  {
    keyword: "sodium ion battery grid storage",
    category: "clean_tech",
    source: "battery_materials_bulletin",
    metrics: {
      commercialIntent: 0.9,
      searchVelocity: 0.88,
      saturationIndex: 0.15,
      ipRiskPenalty: 0.04,
    },
  },
];

interface TrendSignalRow {
  id: string;
  keyword: string;
  category: string;
  source: string;
  search_velocity: number;
  commercial_intent: number;
  saturation_index: number;
  niche_viability_score: number;
  priority_tier: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function mapRowToSignal(row: TrendSignalRow): TrendSignal {
  return {
    id: row.id,
    keyword: row.keyword,
    category: row.category,
    source: row.source,
    searchVelocity: row.search_velocity,
    commercialIntent: row.commercial_intent,
    saturationIndex: row.saturation_index,
    nicheViabilityScore: row.niche_viability_score,
    priorityTier: row.priority_tier as TrendSignal["priorityTier"],
    status: row.status as TrendSignalStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Saves or updates a TrendSignal in SQLite.
 */
export function saveTrendSignal(signal: TrendSignal): void {
  const db = openAgentOsDb();
  db.query(`
    INSERT INTO stock_trend_signals (
      id, keyword, category, source, search_velocity,
      commercial_intent, saturation_index, niche_viability_score,
      priority_tier, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      keyword = excluded.keyword,
      category = excluded.category,
      source = excluded.source,
      search_velocity = excluded.search_velocity,
      commercial_intent = excluded.commercial_intent,
      saturation_index = excluded.saturation_index,
      niche_viability_score = excluded.niche_viability_score,
      priority_tier = excluded.priority_tier,
      status = excluded.status,
      updated_at = excluded.updated_at
  `).run(
    signal.id,
    signal.keyword,
    signal.category,
    signal.source,
    signal.searchVelocity,
    signal.commercialIntent,
    signal.saturationIndex,
    signal.nicheViabilityScore,
    signal.priorityTier,
    signal.status,
    signal.createdAt,
    signal.updatedAt
  );
}

/**
 * Fetches a single TrendSignal by ID.
 */
export function getTrendSignal(id: string): TrendSignal | null {
  const db = openAgentOsDb();
  const row = db
    .query("SELECT * FROM stock_trend_signals WHERE id = ?")
    .get(id) as TrendSignalRow | undefined;
  return row ? mapRowToSignal(row) : null;
}

/**
 * Finds a TrendSignal by exact keyword.
 */
export function getTrendSignalByKeyword(keyword: string): TrendSignal | null {
  const db = openAgentOsDb();
  const row = db
    .query("SELECT * FROM stock_trend_signals WHERE keyword = ?")
    .get(keyword) as TrendSignalRow | undefined;
  return row ? mapRowToSignal(row) : null;
}

/**
 * Lists TrendSignals filtered by category, status, minScore.
 */
export function listTrendSignals(options?: {
  category?: string;
  status?: TrendSignalStatus;
  minScore?: number;
  limit?: number;
}): TrendSignal[] {
  const db = openAgentOsDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (options?.category) {
    conditions.push("category = ?");
    params.push(options.category);
  }
  if (options?.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }
  if (options?.minScore !== undefined) {
    conditions.push("niche_viability_score >= ?");
    params.push(options.minScore);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limitClause = options?.limit ? `LIMIT ${options.limit}` : "LIMIT 100";

  const rows = db
    .query(`SELECT * FROM stock_trend_signals ${whereClause} ORDER BY niche_viability_score DESC ${limitClause}`)
    .all(...params) as TrendSignalRow[];

  return rows.map(mapRowToSignal);
}

/**
 * Updates trend signal status.
 */
export function updateTrendSignalStatus(
  id: string,
  status: TrendSignalStatus
): void {
  const db = openAgentOsDb();
  const now = new Date().toISOString();
  db.query(`UPDATE stock_trend_signals SET status = ?, updated_at = ? WHERE id = ?`).run(
    status,
    now,
    id
  );
}

/**
 * Scans market trends, applies NVS scoring, persists results to DB,
 * and returns matching high-viability signals.
 */
export async function scanMarketTrends(options?: {
  categories?: string[];
  minViabilityScore?: number;
  customSeeds?: TrendSeed[];
}): Promise<TrendSignal[]> {
  const seeds = [...COMMERCIAL_TREND_SEEDS, ...(options?.customSeeds ?? [])];
  const targetCategories = options?.categories
    ? new Set(options.categories.map((c) => c.toLowerCase()))
    : null;

  const now = new Date().toISOString();
  const scannedSignals: TrendSignal[] = [];

  for (const seed of seeds) {
    if (targetCategories && !targetCategories.has(seed.category.toLowerCase())) {
      continue;
    }

    const nvsResult = calculateNVS(seed.metrics);

    // Check if signal already exists by keyword
    const existing = getTrendSignalByKeyword(seed.keyword);
    const id = existing?.id ?? `sig_${randomUUID().slice(0, 8)}`;
    const createdAt = existing?.createdAt ?? now;

    const signal: TrendSignal = {
      id,
      keyword: seed.keyword,
      category: seed.category,
      source: seed.source,
      searchVelocity: nvsResult.breakdown.searchVelocity,
      commercialIntent: nvsResult.breakdown.commercialIntent,
      saturationIndex: nvsResult.breakdown.saturationIndex,
      nicheViabilityScore: nvsResult.nvs,
      priorityTier: nvsResult.priorityTier,
      status: existing?.status ?? "new",
      createdAt,
      updatedAt: now,
    };

    saveTrendSignal(signal);

    const minScore = options?.minViabilityScore ?? 0.5;
    if (signal.nicheViabilityScore >= minScore) {
      scannedSignals.push(signal);
    }
  }

  // Sort descending by score
  return scannedSignals.sort(
    (a, b) => b.nicheViabilityScore - a.nicheViabilityScore
  );
}
