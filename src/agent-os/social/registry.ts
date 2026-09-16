// Phase 20.20 — Social tool registry (spec sections 6, 7, 9).
//
// Normalized local catalog of provider tools. Refresh is idempotent upsert keyed by
// (provider, externalId): a tool absent from one refresh is marked disabled (stale),
// never deleted, because a provider catalog page can legitimately omit an actor that
// still exists. Missing metadata stays null — the registry never invents pricing,
// reliability, or quality numbers.
//
// SQL note: every statement here is static text with `?` placeholders. The list query
// appends only compile-time literal fragments (never user data) and passes all values
// as bound parameters.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import { recordSocialAudit } from "./audit";
import { classifyCapabilities, classifyPlatform } from "./capabilities";
import { getSocialProvider } from "./provider";
import type {
  SocialCapability,
  SocialPlatform,
  SocialProviderRecord,
  SocialTool,
} from "./types";

const DURATIONS_WINDOW = 50;

export interface ToolListFilters {
  providerId?: string;
  platform?: SocialPlatform | "any";
  capability?: SocialCapability;
  enabledOnly?: boolean;
  search?: string;
  limit?: number;
}

export interface RegistryRefreshSummary {
  id: string;
  providerId: string;
  discovered: number;
  inserted: number;
  updated: number;
  unchanged: number;
  markedStale: number;
  status: "completed" | "failed";
  startedAt: string;
  finishedAt: string;
  detail: string | null;
}

export class SocialToolRegistry {
  listProviders(): SocialProviderRecord[] {
    const db = openAgentOsDb();
    const rows = db.query("SELECT * FROM social_providers ORDER BY priority DESC, slug").all() as Record<string, unknown>[];
    return rows.map(rowToProvider);
  }

  listTools(filters: ToolListFilters = {}): SocialTool[] {
    const db = openAgentOsDb();
    const params: Array<string | number> = [];
    // `sql` only ever grows by the literal fragments below; filter values ride in `params`.
    let sql = "SELECT * FROM social_tools WHERE 1=1";
    if (filters.providerId) {
      sql += " AND provider_id = ?";
      params.push(filters.providerId);
    }
    if (filters.platform && filters.platform !== "any") {
      sql += " AND platform = ?";
      params.push(filters.platform);
    }
    if (filters.capability) {
      sql += " AND capabilities_json LIKE ?";
      params.push(`%"${filters.capability}"%`);
    }
    if (filters.enabledOnly) {
      sql += " AND enabled = 1";
    }
    if (filters.search) {
      sql += " AND (name LIKE ? OR title LIKE ? OR description LIKE ?)";
      const like = `%${filters.search}%`;
      params.push(like, like, like);
    }
    sql += " ORDER BY success_count DESC, name LIMIT ?";
    params.push(Math.min(filters.limit ?? 200, 1000));
    const rows = db.query(sql).all(...params) as Record<string, unknown>[];
    return rows.map(rowToTool);
  }

  getTool(id: string): SocialTool | null {
    const db = openAgentOsDb();
    const row = db.query("SELECT * FROM social_tools WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? rowToTool(row) : null;
  }

  getToolByExternalId(providerId: string, externalId: string): SocialTool | null {
    const db = openAgentOsDb();
    const row = db
      .query("SELECT * FROM social_tools WHERE provider_id = ? AND external_id = ?")
      .get(providerId, externalId) as Record<string, unknown> | undefined;
    return row ? rowToTool(row) : null;
  }

  setToolEnabled(id: string, enabled: boolean): SocialTool | null {
    const db = openAgentOsDb();
    const before = this.getTool(id);
    db.query("UPDATE social_tools SET enabled = ?, enabled_source = 'operator', updated_at = ? WHERE id = ?")
      .run(enabled ? 1 : 0, new Date().toISOString(), id);
    if (before && before.enabled !== enabled) {
      recordSocialAudit({
        event: enabled ? "SOCIAL_TOOL_ENABLED" : "SOCIAL_TOOL_DISABLED",
        toolId: id,
        providerId: before.providerId,
        detail: { externalId: before.externalId, name: before.name },
      });
    }
    return this.getTool(id);
  }

  /**
   * Idempotent catalog refresh for one provider (spec section 9): paginate, classify,
   * upsert, mark missing tools disabled (stale), and persist a refresh summary.
   * Never deletes rows.
   */
  async refresh(providerId: string, options: { maxPages?: number; search?: string } = {}): Promise<RegistryRefreshSummary> {
    const db = openAgentOsDb();
    const provider = getSocialProvider(providerId);
    if (!provider) {
      throw new Error(`Social provider "${providerId}" is not registered`);
    }
    this.ensureProviderRow(providerId);

    const startedAt = new Date().toISOString();
    const summaryId = `srfr_${randomUUID().slice(0, 12)}`;

    try {
      const discovered = await provider.discoverTools({ maxPages: options.maxPages, search: options.search });

      let inserted = 0;
      let updated = 0;
      let unchanged = 0;
      let markedStale = 0;
      const now = new Date().toISOString();
      const seenExternalIds = new Set<string>();

      for (const tool of discovered) {
        if (seenExternalIds.has(tool.externalId)) continue; // dedupe within one refresh
        seenExternalIds.add(tool.externalId);

        const existing = this.getToolByExternalId(providerId, tool.externalId);
        // Deterministic classification from provider metadata only.
        const haystack = [tool.name, tool.title, tool.description, tool.categories.join(" ")];
        const platform = classifyPlatform(...haystack);
        const capabilities = classifyCapabilities(...haystack);

        if (!existing) {
          const id = `stool_${randomUUID().slice(0, 16)}`;
          db.query(`INSERT INTO social_tools (
            id, provider_id, external_id, owner, name, title, description, url,
            platform, capabilities_json, categories_json, tags_json, enabled, verified,
            pricing_state, pricing_model, estimated_unit_cost, currency,
            external_created_at, external_modified_at, discovered_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            id, providerId, tool.externalId, tool.owner, tool.name, tool.title, tool.description, tool.url,
            platform, JSON.stringify(capabilities), JSON.stringify(tool.categories), JSON.stringify(tool.tags),
            1, tool.verified ? 1 : 0,
            tool.pricingState, tool.pricingModel, tool.estimatedUnitCost, tool.currency,
            tool.externalCreatedAt, tool.externalModifiedAt, now, now,
          );
          inserted++;
          continue;
        }

        // Refresh mutable metadata; keep internal counters and existing enable state.
        const changed =
          existing.title !== tool.title ||
          existing.description !== tool.description ||
          existing.pricingState !== tool.pricingState ||
          existing.estimatedUnitCost !== tool.estimatedUnitCost ||
          existing.platform !== platform ||
          JSON.stringify(existing.capabilities) !== JSON.stringify(capabilities);
        if (changed || (existing.enabledSource === "auto" && !existing.enabled)) {
          db.query(`UPDATE social_tools SET
            title = ?, description = ?, url = ?, platform = ?, capabilities_json = ?,
            categories_json = ?, pricing_state = ?, pricing_model = ?, estimated_unit_cost = ?, currency = ?,
            verified = ?, external_modified_at = ?, updated_at = ?,
            enabled = CASE WHEN enabled_source = 'auto' THEN 1 ELSE enabled END
            WHERE id = ?`).run(
            tool.title, tool.description, tool.url, platform, JSON.stringify(capabilities),
            JSON.stringify(tool.categories), tool.pricingState, tool.pricingModel, tool.estimatedUnitCost, tool.currency,
            tool.verified ? 1 : 0, tool.externalModifiedAt, now, existing.id,
          );
          updated++;
        } else {
          unchanged++;
        }
      }

      // Stale marking: known tools missing from this refresh get disabled, not deleted.
      // Operator-disabled tools (enabled_source='operator') keep their state.
      const knownRows = db
        .query("SELECT id, external_id, enabled, enabled_source FROM social_tools WHERE provider_id = ?")
        .all(providerId) as { id: string; external_id: string; enabled: number; enabled_source: string }[];
      for (const row of knownRows) {
        if (!seenExternalIds.has(row.external_id)) {
          if (row.enabled_source === "auto") {
            db.query("UPDATE social_tools SET enabled = 0, updated_at = ? WHERE id = ?").run(now, row.id);
          }
          markedStale++;
        }
      }

      db.query("UPDATE social_providers SET status = 'healthy', last_health_check_at = ?, updated_at = ? WHERE id = ?")
        .run(now, now, providerId);

      const finishedAt = new Date().toISOString();
      db.query(`INSERT INTO social_registry_refreshes (
        id, provider_id, discovered, inserted, updated, unchanged, marked_stale, status, detail_json, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        summaryId, providerId, discovered.length, inserted, updated, unchanged, markedStale, "completed", null, startedAt, finishedAt,
      );

      recordSocialAudit({
        event: "SOCIAL_REGISTRY_REFRESHED",
        providerId,
        detail: {
          discovered: discovered.length,
          inserted,
          updated,
          unchanged,
          markedStale,
          status: "completed",
        },
      });

      return {
        id: summaryId, providerId, discovered: discovered.length, inserted, updated,
        unchanged, markedStale, status: "completed", startedAt, finishedAt, detail: null,
      };
    } catch (error) {
      const finishedAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : String(error);
      db.query(`INSERT INTO social_registry_refreshes (
        id, provider_id, discovered, inserted, updated, unchanged, marked_stale, status, detail_json, started_at, finished_at
      ) VALUES (?, ?, 0, 0, 0, 0, 0, ?, ?, ?, ?)`).run(
        summaryId, providerId, "failed", JSON.stringify({ error: message }), startedAt, finishedAt,
      );
      db.query("UPDATE social_providers SET status = 'degraded', last_health_check_at = ?, updated_at = ? WHERE id = ?")
        .run(finishedAt, finishedAt, providerId);
      recordSocialAudit({
        event: "SOCIAL_REGISTRY_REFRESHED",
        providerId,
        detail: { status: "failed", reason: message.slice(0, 200) },
      });
      throw error;
    }
  }

  /**
   * Record one internal run outcome (spec section 13). Reliability shown anywhere in
   * Pao-hubPro comes from these counters, never from provider marketing claims.
   */
  recordRunOutcome(toolId: string, outcome: { ok: boolean; timeout?: boolean; cancelled?: boolean; durationMs?: number }): void {
    const db = openAgentOsDb();
    const now = new Date().toISOString();
    const tool = this.getTool(toolId);
    if (!tool) return;

    const durations = safeParseNumberArray(
      (db.query("SELECT durations_json FROM social_tools WHERE id = ?").get(toolId) as { durations_json: string } | undefined)?.durations_json,
    );
    if (typeof outcome.durationMs === "number" && Number.isFinite(outcome.durationMs)) {
      durations.push(outcome.durationMs);
      while (durations.length > DURATIONS_WINDOW) durations.shift();
    }

    const successCount = tool.successCount + (outcome.ok ? 1 : 0);
    const failureCount = tool.failureCount + (!outcome.ok && !outcome.timeout && !outcome.cancelled ? 1 : 0);
    const timeoutCount = tool.timeoutCount + (outcome.timeout ? 1 : 0);
    const cancelCount = tool.cancelCount + (outcome.cancelled ? 1 : 0);
    const avgDurationMs = durations.length > 0
      ? durations.reduce((sum, d) => sum + d, 0) / durations.length
      : null;
    const sorted = [...durations].sort((a, b) => a - b);
    const p95DurationMs = sorted.length > 0 ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : null;

    db.query(`UPDATE social_tools SET
      success_count = ?, failure_count = ?, timeout_count = ?, cancel_count = ?,
      avg_duration_ms = ?, p95_duration_ms = ?, durations_json = ?,
      last_success_at = ?, last_failure_at = ?, updated_at = ?
      WHERE id = ?`).run(
      successCount, failureCount, timeoutCount, cancelCount,
      avgDurationMs, p95DurationMs, JSON.stringify(durations),
      outcome.ok ? now : tool.lastSuccessAt,
      !outcome.ok ? now : tool.lastFailureAt,
      now, toolId,
    );
  }

  ensureProviderRow(providerId: string): void {
    const db = openAgentOsDb();
    const now = new Date().toISOString();
    const known: Record<string, { slug: string; name: string; priority: number; authType: string; baseUrl: string | null }> = {
      apify: { slug: "apify", name: "Apify", priority: 100, authType: "api_key", baseUrl: "https://api.apify.com/v2" },
    };
    const meta = known[providerId];
    if (!meta) return;
    db.query(`INSERT INTO social_providers (id, slug, name, enabled, priority, base_url, auth_type, status, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?, ?, 'unknown', ?, ?)
      ON CONFLICT(id) DO NOTHING`).run(providerId, meta.slug, meta.name, meta.priority, meta.baseUrl, meta.authType, now, now);
  }
}

function rowToProvider(row: Record<string, unknown>): SocialProviderRecord {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    enabled: Number(row.enabled) === 1,
    priority: Number(row.priority),
    baseUrl: (row.base_url as string | null) ?? null,
    authType: String(row.auth_type) as SocialProviderRecord["authType"],
    status: String(row.status) as SocialProviderRecord["status"],
    lastHealthCheckAt: (row.last_health_check_at as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToTool(row: Record<string, unknown>): SocialTool {
  return {
    id: String(row.id),
    providerId: String(row.provider_id),
    externalId: String(row.external_id),
    owner: (row.owner as string | null) ?? null,
    name: String(row.name),
    title: (row.title as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    url: (row.url as string | null) ?? null,
    platform: String(row.platform) as SocialPlatform,
    capabilities: safeParseArray(row.capabilities_json) as SocialCapability[],
    categories: safeParseArray(row.categories_json) as string[],
    tags: safeParseArray(row.tags_json) as string[],
    enabled: Number(row.enabled) === 1,
    enabledSource: String(row.enabled_source ?? "auto") === "operator" ? "operator" : "auto",
    verified: Number(row.verified) === 1,
    pricingState: String(row.pricing_state) as SocialTool["pricingState"],
    pricingModel: (row.pricing_model as string | null) ?? null,
    estimatedUnitCost: row.estimated_unit_cost === null || row.estimated_unit_cost === undefined ? null : Number(row.estimated_unit_cost),
    currency: (row.currency as string | null) ?? null,
    successCount: Number(row.success_count ?? 0),
    failureCount: Number(row.failure_count ?? 0),
    timeoutCount: Number(row.timeout_count ?? 0),
    cancelCount: Number(row.cancel_count ?? 0),
    avgDurationMs: row.avg_duration_ms === null || row.avg_duration_ms === undefined ? null : Number(row.avg_duration_ms),
    p95DurationMs: row.p95_duration_ms === null || row.p95_duration_ms === undefined ? null : Number(row.p95_duration_ms),
    lastSuccessAt: (row.last_success_at as string | null) ?? null,
    lastFailureAt: (row.last_failure_at as string | null) ?? null,
    lastHealthCheckAt: (row.last_health_check_at as string | null) ?? null,
    externalCreatedAt: (row.external_created_at as string | null) ?? null,
    externalModifiedAt: (row.external_modified_at as string | null) ?? null,
    discoveredAt: String(row.discovered_at),
    updatedAt: String(row.updated_at),
  };
}

function safeParseArray(value: unknown): unknown[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeParseNumberArray(value: unknown): number[] {
  const arr = safeParseArray(value);
  return arr.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}
