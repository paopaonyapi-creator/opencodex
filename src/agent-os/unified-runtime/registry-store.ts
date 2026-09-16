// Phase 20.35 — unified runtime persistence over the shared agent-os SQLite
// store (§X mapped to the repo's single-DB convention). Static single-line
// SQL, check-then-insert, no dynamic fragments.

import { openAgentOsDb } from "../db";
import type { ProviderManifest, WorkspacePermissionSet } from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export class UnifiedRuntimeStore {
  upsertProvider(manifest: ProviderManifest): void {
    const db = openAgentOsDb();
    const existing = db.query("SELECT id FROM unified_providers WHERE id = ?").get(manifest.id);
    if (existing) {
      db.query("UPDATE unified_providers SET name = ?, type = ?, is_local = ?, capabilities_json = ?, routing_json = ?, limits_json = ?, policy_json = ?, config_json = ?, updated_at = ? WHERE id = ?")
        .run(manifest.name, manifest.type, manifest.isLocal ? 1 : 0, JSON.stringify(manifest.capabilities), JSON.stringify(manifest.routing), JSON.stringify(manifest.limits), JSON.stringify(manifest.policy), JSON.stringify(manifest.config), nowIso(), manifest.id);
      return;
    }
    db.query("INSERT INTO unified_providers (id, name, type, enabled, is_local, capabilities_json, routing_json, limits_json, policy_json, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(manifest.id, manifest.name, manifest.type, manifest.enabled ? 1 : 0, manifest.isLocal ? 1 : 0, JSON.stringify(manifest.capabilities), JSON.stringify(manifest.routing), JSON.stringify(manifest.limits), JSON.stringify(manifest.policy), JSON.stringify(manifest.config), nowIso(), nowIso());
  }

  getProvider(id: string): ProviderManifest | null {
    const row = openAgentOsDb().query("SELECT * FROM unified_providers WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapProviderRow(row) : null;
  }

  listProviders(): ProviderManifest[] {
    const rows = openAgentOsDb().query("SELECT * FROM unified_providers ORDER BY rowid ASC").all() as Array<Record<string, unknown>>;
    return rows.map(mapProviderRow);
  }

  setProviderEnabled(id: string, enabled: boolean): void {
    openAgentOsDb().query("UPDATE unified_providers SET enabled = ?, updated_at = ? WHERE id = ?").run(enabled ? 1 : 0, nowIso(), id);
  }

  saveProviderHealth(providerId: string, state: string, latencyMs: number, circuitState: string, message?: string): void {
    openAgentOsDb().query("INSERT INTO unified_provider_health (id, provider_id, checked_at, state, latency_ms, circuit_state, message) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(newId("uph"), providerId, nowIso(), state, latencyMs, circuitState, message ?? null);
  }

  latestProviderHealth(providerId: string): { state: string; latencyMs: number; circuitState: string; checkedAt: string; message: string | null } | null {
    const row = openAgentOsDb().query("SELECT * FROM unified_provider_health WHERE provider_id = ? ORDER BY checked_at DESC, rowid DESC LIMIT 1").get(providerId) as Record<string, unknown> | null;
    if (!row) return null;
    return {
      state: String(row.state),
      latencyMs: Number(row.latency_ms ?? 0),
      circuitState: String(row.circuit_state),
      checkedAt: String(row.checked_at),
      message: row.message ? String(row.message) : null,
    };
  }

  insertRouteExecution(entry: { id: string; virtualModel: string; mode: string; selectedProvider: string | null; fallbacksTried: string[]; status: string; executionClass: string; workspaceId: string | null; totalMs: number; estimatedCostUsd: number; errorCode: string | null; requestJson: string }): void {
    openAgentOsDb().query("INSERT INTO unified_route_executions (id, virtual_model, mode, selected_provider, fallbacks_json, status, execution_class, workspace_id, total_ms, estimated_cost_usd, error_code, request_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(entry.id, entry.virtualModel, entry.mode, entry.selectedProvider, JSON.stringify(entry.fallbacksTried), entry.status, entry.executionClass, entry.workspaceId, entry.totalMs, entry.estimatedCostUsd, entry.errorCode, entry.requestJson, nowIso());
  }

  updateRouteExecution(id: string, patch: { status: string; selectedProvider: string | null; fallbacksTried: string[]; totalMs: number; estimatedCostUsd: number; errorCode: string | null }): void {
    openAgentOsDb().query("UPDATE unified_route_executions SET status = ?, selected_provider = ?, fallbacks_json = ?, total_ms = ?, estimated_cost_usd = ?, error_code = ? WHERE id = ?")
      .run(patch.status, patch.selectedProvider, JSON.stringify(patch.fallbacksTried), patch.totalMs, patch.estimatedCostUsd, patch.errorCode, id);
  }

  /** Store-boundary read: execution inputs are reloaded from the persisted,
   *  sanitized record before any provider adapter is invoked. */
  getRouteExecutionRequest(id: string): { model: string; prompt: string; messages: Array<{ role: string; content: string }>; responseFormat?: string; mode: string; executionClass: string; workspaceId: string | null } | null {
    const row = openAgentOsDb().query("SELECT * FROM unified_route_executions WHERE id = ?").get(id) as Record<string, unknown> | null;
    if (!row) return null;
    const request = JSON.parse(String(row.request_json ?? "{}")) as Record<string, unknown>;
    return {
      model: typeof request.model === "string" ? request.model : String(row.virtual_model),
      prompt: typeof request.prompt === "string" ? request.prompt : "",
      messages: Array.isArray(request.messages) ? (request.messages as Array<{ role: string; content: string }>).filter((message) => typeof message?.role === "string" && typeof message?.content === "string").slice(0, 64) : [],
      responseFormat: typeof request.responseFormat === "string" ? request.responseFormat : undefined,
      mode: String(row.mode),
      executionClass: String(row.execution_class),
      workspaceId: row.workspace_id ? String(row.workspace_id) : null,
    };
  }

  usageSummary(): Array<{ providerId: string; requests: number; failures: number; avgMs: number; costUsd: number }> {
    const rows = openAgentOsDb().query("SELECT selected_provider AS p, COUNT(*) AS n, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS f, AVG(total_ms) AS avg_ms, SUM(estimated_cost_usd) AS cost FROM unified_route_executions GROUP BY selected_provider ORDER BY n DESC").all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({ providerId: String(row.p ?? "none"), requests: Number(row.n), failures: Number(row.f), avgMs: Number(row.avg_ms ?? 0), costUsd: Number(row.cost ?? 0) }));
  }

  getGrants(workspaceId: string): WorkspacePermissionSet | null {
    const row = openAgentOsDb().query("SELECT * FROM unified_workspace_grants WHERE workspace_id = ?").get(workspaceId) as Record<string, unknown> | null;
    if (!row) return null;
    return { workspaceId: String(row.workspace_id), grants: JSON.parse(String(row.grants_json)) as WorkspacePermissionSet["grants"], updatedAt: String(row.updated_at) };
  }

  saveGrants(set: WorkspacePermissionSet): void {
    const db = openAgentOsDb();
    const existing = db.query("SELECT workspace_id FROM unified_workspace_grants WHERE workspace_id = ?").get(set.workspaceId);
    if (existing) {
      db.query("UPDATE unified_workspace_grants SET grants_json = ?, updated_at = ? WHERE workspace_id = ?").run(JSON.stringify(set.grants), nowIso(), set.workspaceId);
      return;
    }
    db.query("INSERT INTO unified_workspace_grants (id, workspace_id, grants_json, updated_at) VALUES (?, ?, ?, ?)").run(newId("uwg"), set.workspaceId, JSON.stringify(set.grants), nowIso());
  }

  appendAudit(entry: { actor: string; event: string; risk: string; decision: string; workspaceId?: string | null; executionId?: string | null; metadata?: Record<string, unknown> }): void {
    openAgentOsDb().query("INSERT INTO unified_audit (ts, actor, event, risk, decision, workspace_id, execution_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(nowIso(), entry.actor, entry.event, entry.risk, entry.decision, entry.workspaceId ?? null, entry.executionId ?? null, JSON.stringify(entry.metadata ?? {}));
  }

  listAudit(limit = 50): Array<{ ts: string; actor: string; event: string; risk: string; decision: string; workspaceId: string | null; executionId: string | null; metadata: Record<string, unknown> }> {
    const rows = openAgentOsDb().query("SELECT * FROM unified_audit ORDER BY ts DESC, id DESC LIMIT ?").all(Math.min(limit, 200)) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      ts: String(row.ts),
      actor: String(row.actor),
      event: String(row.event),
      risk: String(row.risk),
      decision: String(row.decision),
      workspaceId: row.workspace_id ? String(row.workspace_id) : null,
      executionId: row.execution_id ? String(row.execution_id) : null,
      metadata: row.metadata_json ? (JSON.parse(String(row.metadata_json)) as Record<string, unknown>) : {},
    }));
  }
}

function mapProviderRow(row: Record<string, unknown>): ProviderManifest {
  return {
    id: String(row.id),
    name: String(row.name),
    type: String(row.type) as ProviderManifest["type"],
    enabled: Number(row.enabled ?? 1) === 1,
    isLocal: Number(row.is_local ?? 0) === 1,
    capabilities: JSON.parse(String(row.capabilities_json)) as ProviderManifest["capabilities"],
    routing: JSON.parse(String(row.routing_json)) as ProviderManifest["routing"],
    limits: JSON.parse(String(row.limits_json)) as ProviderManifest["limits"],
    policy: JSON.parse(String(row.policy_json)) as ProviderManifest["policy"],
    config: JSON.parse(String(row.config_json ?? "{}")) as ProviderManifest["config"],
  };
}
