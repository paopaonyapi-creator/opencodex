// Phase 20.10 — Actor Registry (spec section 4.1).
//
// Central directory of scrapers and intelligence actors with pricing,
// health scores, capabilities, and priority routing.

import { openAgentOsDb } from "../db";
import type { ActorRegistryItem } from "./types";

export const BUILTIN_ACTORS: ActorRegistryItem[] = [
  {
    id: "adobe-stock-primary",
    provider: "apify",
    actorId: "igolaizola/adobe-stock-scraper",
    category: "stock_market",
    enabled: true,
    priority: 100,
    healthScore: 98.5,
    pricing: { model: "per_result", unitPriceUsd: 0.002 },
    capabilities: ["search", "photo", "video", "illustration", "vector", "ai_filter", "downloads_count"],
    config: { maxResults: 100 },
    createdAt: "2026-09-08T00:00:00Z",
    updatedAt: "2026-09-08T00:00:00Z",
  },
  {
    id: "youtube-trend-scraper",
    provider: "apify",
    actorId: "streamers/youtube-scraper",
    category: "social_video",
    enabled: true,
    priority: 90,
    healthScore: 97.0,
    pricing: { model: "per_result", unitPriceUsd: 0.001 },
    capabilities: ["trending", "views", "likes", "transcripts", "comments", "tags"],
    config: { maxResults: 50 },
    createdAt: "2026-09-08T00:00:00Z",
    updatedAt: "2026-09-08T00:00:00Z",
  },
  {
    id: "tiktok-tag-scraper",
    provider: "apify",
    actorId: "clockworks/tiktok-scraper",
    category: "social_short",
    enabled: true,
    priority: 85,
    healthScore: 95.0,
    pricing: { model: "per_result", unitPriceUsd: 0.0015 },
    capabilities: ["hashtags", "velocity", "sound_trends", "engagement_rate"],
    config: { maxResults: 50 },
    createdAt: "2026-09-08T00:00:00Z",
    updatedAt: "2026-09-08T00:00:00Z",
  },
  {
    id: "instagram-hashtag-scraper",
    provider: "apify",
    actorId: "jaroslav/instagram-scraper",
    category: "visual_social",
    enabled: true,
    priority: 80,
    healthScore: 94.0,
    pricing: { model: "per_result", unitPriceUsd: 0.002 },
    capabilities: ["hashtags", "aesthetics", "carousel", "reels"],
    config: { maxResults: 50 },
    createdAt: "2026-09-08T00:00:00Z",
    updatedAt: "2026-09-08T00:00:00Z",
  },
];

export class ActorRegistry {
  constructor() {
    this.seedDefaults();
  }

  seedDefaults(): void {
    const db = openAgentOsDb();
    const existing = db.query("SELECT COUNT(*) as count FROM trend_actor_registry").get() as { count: number };
    if (existing && existing.count > 0) return;

    for (const actor of BUILTIN_ACTORS) {
      db.query(`INSERT INTO trend_actor_registry (
        id, provider, actor_id, category, enabled, priority, health_score,
        pricing_json, capabilities_json, config_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        actor.id,
        actor.provider,
        actor.actorId,
        actor.category,
        actor.enabled ? 1 : 0,
        actor.priority,
        actor.healthScore,
        JSON.stringify(actor.pricing),
        JSON.stringify(actor.capabilities),
        JSON.stringify(actor.config),
        actor.createdAt,
        actor.updatedAt,
      );
    }
  }

  listActors(category?: string): ActorRegistryItem[] {
    const db = openAgentOsDb();
    const rows = category
      ? (db.query("SELECT * FROM trend_actor_registry WHERE category = ? ORDER BY priority DESC").all(category) as Record<string, unknown>[])
      : (db.query("SELECT * FROM trend_actor_registry ORDER BY priority DESC").all() as Record<string, unknown>[]);

    return rows.map((r) => ({
      id: String(r.id),
      provider: String(r.provider),
      actorId: String(r.actor_id),
      category: String(r.category),
      enabled: Boolean(r.enabled),
      priority: Number(r.priority),
      healthScore: Number(r.health_score),
      pricing: JSON.parse(String(r.pricing_json)),
      capabilities: JSON.parse(String(r.capabilities_json)),
      config: JSON.parse(String(r.config_json)),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }));
  }

  getActor(id: string): ActorRegistryItem | null {
    const db = openAgentOsDb();
    const r = db.query("SELECT * FROM trend_actor_registry WHERE id = ?").get(id) as Record<string, unknown> | null;
    if (!r) return null;

    return {
      id: String(r.id),
      provider: String(r.provider),
      actorId: String(r.actor_id),
      category: String(r.category),
      enabled: Boolean(r.enabled),
      priority: Number(r.priority),
      healthScore: Number(r.health_score),
      pricing: JSON.parse(String(r.pricing_json)),
      capabilities: JSON.parse(String(r.capabilities_json)),
      config: JSON.parse(String(r.config_json)),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  getBestActorForSource(source: string): ActorRegistryItem | null {
    const actors = this.listActors().filter((a) => a.enabled && a.healthScore > 50);
    if (source === "adobe_stock") return actors.find((a) => a.id === "adobe-stock-primary") || actors[0] || null;
    if (source === "youtube") return actors.find((a) => a.id === "youtube-trend-scraper") || actors[0] || null;
    if (source === "tiktok") return actors.find((a) => a.id === "tiktok-tag-scraper") || actors[0] || null;
    if (source === "instagram") return actors.find((a) => a.id === "instagram-hashtag-scraper") || actors[0] || null;
    return actors[0] || null;
  }
}

let registryInstance: ActorRegistry | null = null;
export function getActorRegistry(): ActorRegistry {
  if (!registryInstance) {
    registryInstance = new ActorRegistry();
  }
  return registryInstance;
}
