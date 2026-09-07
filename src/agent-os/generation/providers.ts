// Phase 19 — Provider store + selection (multi-provider ready; spec section 9).

import { openAgentOsDb } from "../db";
import type { GenerationProvider } from "./types";

function rowToProvider(row: Record<string, unknown>): GenerationProvider {
  return {
    id: row.id as string,
    name: row.name as string,
    type: row.type as string,
    baseUrl: row.base_url as string,
    enabled: row.enabled === 1,
    priority: row.priority as number,
    maxConcurrency: row.max_concurrency as number,
    timeoutSeconds: row.timeout_seconds as number,
    capabilities: JSON.parse((row.capabilities_json as string) ?? "{}") as Record<string, unknown>,
    healthStatus: row.health_status as GenerationProvider["healthStatus"],
    lastHealthCheckMs: (row.last_health_check_ms as number | null) ?? null,
    metadata: JSON.parse((row.metadata_json as string) ?? "{}") as Record<string, unknown>,
    createdAt: row.created_at as string,
  };
}

export interface UpsertProviderInput {
  id: string;
  name: string;
  type?: string;
  baseUrl: string;
  enabled?: boolean;
  priority?: number;
  maxConcurrency?: number;
  timeoutSeconds?: number;
  capabilities?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export function upsertProvider(input: UpsertProviderInput): GenerationProvider {
  const db = openAgentOsDb();
  const now = new Date().toISOString();
  db.query(`
    INSERT INTO gen_providers
      (id, name, type, base_url, enabled, priority, max_concurrency, timeout_seconds,
       capabilities_json, health_status, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, type = excluded.type, base_url = excluded.base_url,
      enabled = excluded.enabled, priority = excluded.priority,
      max_concurrency = excluded.max_concurrency, timeout_seconds = excluded.timeout_seconds,
      capabilities_json = excluded.capabilities_json, metadata_json = excluded.metadata_json
  `).run(
    input.id, input.name, input.type ?? "comfyui", input.baseUrl,
    (input.enabled ?? true) ? 1 : 0, input.priority ?? 5, input.maxConcurrency ?? 1,
    input.timeoutSeconds ?? 600, JSON.stringify(input.capabilities ?? {}),
    JSON.stringify(input.metadata ?? {}), now,
  );
  return getProvider(input.id)!;
}

export function getProvider(id: string): GenerationProvider | null {
  const row = openAgentOsDb().query("SELECT * FROM gen_providers WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToProvider(row) : null;
}

export function listProviders(options?: { enabledOnly?: boolean }): GenerationProvider[] {
  const rows = (options?.enabledOnly
    ? openAgentOsDb().query("SELECT * FROM gen_providers WHERE enabled = 1 ORDER BY priority DESC, id").all()
    : openAgentOsDb().query("SELECT * FROM gen_providers ORDER BY priority DESC, id").all()) as Record<string, unknown>[];
  return rows.map(rowToProvider);
}

export function recordProviderHealth(id: string, status: GenerationProvider["healthStatus"]): void {
  openAgentOsDb()
    .query("UPDATE gen_providers SET health_status = ?, last_health_check_ms = ? WHERE id = ?")
    .run(status, Date.now(), id);
}

/**
 * Provider selection: enabled + healthy first, then priority order. Capacity
 * / VRAM / model-locality aware routing is the Phase 20 grid (interface stays).
 */
export function selectProvider(preferredId?: string | null): GenerationProvider | null {
  const enabled = listProviders({ enabledOnly: true });
  if (preferredId) {
    const preferred = enabled.find(p => p.id === preferredId);
    if (preferred) return preferred;
  }
  const healthy = enabled.filter(p => p.healthStatus === "healthy");
  if (healthy.length > 0) return healthy[0]!;
  const untested = enabled.filter(p => p.healthStatus === "unknown");
  if (untested.length > 0) return untested[0]!;
  return enabled[0] ?? null;
}
