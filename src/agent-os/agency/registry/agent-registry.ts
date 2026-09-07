// Phase 20.8 — SQLite-backed Agency Agent Registry
// Fast query and indexing store for specialist agents with zero full-body preloading.

import { openAgentOsDb } from "../../db";
import type { AgencyAgent, AgentDivision } from "../types";

export interface RegistryStats {
  totalAgents: number;
  enabledAgents: number;
  blockedAgents: number;
  divisionsCount: number;
  lastSyncAt: string | null;
}

export class AgentRegistry {
  private get db() {
    return openAgentOsDb();
  }

  /**
   * Upserts an agent into the SQLite database.
   */
  upsertAgent(agent: AgencyAgent): void {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO agency_agents (
        id, slug, name, description, division, source_id, source_path, source_commit,
        capabilities_json, keywords_json, deliverables_json, critical_rules_json,
        success_metrics_json, metadata_hash, body_hash, trust_source,
        prompt_safety_status, safety_findings_json, enabled, is_custom, extends_slug,
        color, emoji, vibe, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
      ON CONFLICT(slug) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        division = excluded.division,
        source_id = excluded.source_id,
        source_path = excluded.source_path,
        source_commit = excluded.source_commit,
        capabilities_json = excluded.capabilities_json,
        keywords_json = excluded.keywords_json,
        deliverables_json = excluded.deliverables_json,
        critical_rules_json = excluded.critical_rules_json,
        success_metrics_json = excluded.success_metrics_json,
        metadata_hash = excluded.metadata_hash,
        body_hash = excluded.body_hash,
        trust_source = excluded.trust_source,
        prompt_safety_status = excluded.prompt_safety_status,
        safety_findings_json = excluded.safety_findings_json,
        enabled = excluded.enabled,
        is_custom = excluded.is_custom,
        extends_slug = excluded.extends_slug,
        color = excluded.color,
        emoji = excluded.emoji,
        vibe = excluded.vibe,
        updated_at = excluded.updated_at
    `).run(
      agent.id,
      agent.slug,
      agent.name,
      agent.description,
      agent.division,
      agent.sourceId ?? null,
      agent.sourcePath || "bundled",
      agent.sourceCommit ?? null,
      JSON.stringify(agent.capabilities),
      JSON.stringify(agent.keywords),
      JSON.stringify(agent.deliverables),
      JSON.stringify(agent.criticalRules),
      JSON.stringify(agent.successMetrics),
      agent.hashes.metadata,
      agent.hashes.body ?? null,
      agent.trust.source,
      agent.safety.status,
      JSON.stringify(agent.safety.findings),
      agent.enabled ? 1 : 0,
      agent.isCustom ? 1 : 0,
      agent.extendsSlug ?? null,
      agent.color ?? null,
      agent.emoji ?? null,
      agent.vibe ?? null,
      now,
      now,
    );
  }

  /**
   * Retrieves an agent by its unique slug.
   */
  getAgentBySlug(slug: string): AgencyAgent | null {
    const row = this.db.query("SELECT * FROM agency_agents WHERE slug = ?").get(slug) as any;
    if (!row) return null;
    return this.rowToAgent(row);
  }

  /**
   * Lists agents with optional division and enabled filters.
   */
  listAgents(options: { division?: string; enabledOnly?: boolean; limit?: number } = {}): AgencyAgent[] {
    let sql = "SELECT * FROM agency_agents WHERE 1=1";
    const params: any[] = [];

    if (options.division) {
      sql += " AND division = ?";
      params.push(options.division.toLowerCase());
    }
    if (options.enabledOnly ?? true) {
      sql += " AND enabled = 1 AND prompt_safety_status != 'blocked'";
    }

    sql += " ORDER BY division ASC, name ASC";

    if (options.limit && options.limit > 0) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }

    const rows = this.db.query(sql).all(...params) as any[];
    return rows.map((r) => this.rowToAgent(r));
  }

  /**
   * Returns distinct divisions and their agent counts.
   */
  listDivisions(): { division: AgentDivision; count: number }[] {
    const rows = this.db.query(`
      SELECT division, COUNT(*) as cnt
      FROM agency_agents
      WHERE enabled = 1 AND prompt_safety_status != 'blocked'
      GROUP BY division
      ORDER BY cnt DESC
    `).all() as any[];

    return rows.map((r) => ({
      division: r.division,
      count: Number(r.cnt),
    }));
  }

  /**
   * Returns an array of distinct division names.
   */
  getDivisions(): string[] {
    return this.listDivisions().map((d) => d.division);
  }

  /**
   * Returns a map of division names to agent counts.
   */
  getDivisionStats(): Record<string, number> {
    const list = this.listDivisions();
    const result: Record<string, number> = {};
    for (const item of list) {
      result[item.division] = item.count;
    }
    return result;
  }

  /**
   * Toggle agent enabled state.
   */
  setAgentEnabled(slug: string, enabled: boolean): boolean {
    const res = this.db.query("UPDATE agency_agents SET enabled = ? WHERE slug = ?").run(enabled ? 1 : 0, slug);
    return res.changes > 0;
  }

  /**
   * Record specialist run outcome to update performance telemetry.
   */
  recordAgentRunMetrics(slug: string, success: boolean, latencyMs: number): void {
    const agent = this.getAgentBySlug(slug);
    if (!agent) return;

    const currentRuns = agent.performance?.runs ?? 0;
    const currentSuccessRate = agent.performance?.successRate ?? 1.0;
    const currentAvgLatency = agent.performance?.avgLatencyMs ?? 0;

    const newRuns = currentRuns + 1;
    const newSuccessRate = ((currentRuns * currentSuccessRate) + (success ? 1 : 0)) / newRuns;
    const newAvgLatency = ((currentRuns * currentAvgLatency) + latencyMs) / newRuns;

    this.db.query(`
      UPDATE agency_agents
      SET runs_count = ?, success_rate = ?, avg_latency_ms = ?
      WHERE slug = ?
    `).run(newRuns, newSuccessRate, newAvgLatency, slug);
  }

  recordRunMetric(slug: string, success: boolean, latencyMs: number): void {
    this.recordAgentRunMetrics(slug, success, latencyMs);
  }

  /**
   * Returns high level stats of the registry.
   */
  getStats(): RegistryStats {
    const total = (this.db.query("SELECT COUNT(*) as c FROM agency_agents").get() as any)?.c ?? 0;
    const enabled = (this.db.query("SELECT COUNT(*) as c FROM agency_agents WHERE enabled = 1 AND prompt_safety_status != 'blocked'").get() as any)?.c ?? 0;
    const blocked = (this.db.query("SELECT COUNT(*) as c FROM agency_agents WHERE prompt_safety_status = 'blocked'").get() as any)?.c ?? 0;
    const divs = (this.db.query("SELECT COUNT(DISTINCT division) as c FROM agency_agents").get() as any)?.c ?? 0;
    const lastSync = (this.db.query("SELECT MAX(updated_at) as s FROM agency_agents").get() as any)?.s ?? null;

    return {
      totalAgents: Number(total),
      enabledAgents: Number(enabled),
      blockedAgents: Number(blocked),
      divisionsCount: Number(divs),
      lastSyncAt: lastSync,
    };
  }

  private rowToAgent(row: any): AgencyAgent {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      division: row.division,
      sourceId: row.source_id ?? undefined,
      sourcePath: row.source_path,
      sourceCommit: row.source_commit ?? undefined,
      capabilities: JSON.parse(row.capabilities_json || "[]"),
      keywords: JSON.parse(row.keywords_json || "[]"),
      deliverables: JSON.parse(row.deliverables_json || "[]"),
      criticalRules: JSON.parse(row.critical_rules_json || "[]"),
      successMetrics: JSON.parse(row.success_metrics_json || "[]"),
      bodyLoaded: false,
      hashes: {
        metadata: row.metadata_hash,
        body: row.body_hash ?? undefined,
      },
      trust: {
        source: row.trust_source,
        verified: row.prompt_safety_status !== "blocked",
      },
      safety: {
        status: row.prompt_safety_status,
        findings: JSON.parse(row.safety_findings_json || "[]"),
      },
      enabled: Boolean(row.enabled),
      isCustom: Boolean(row.is_custom),
      extendsSlug: row.extends_slug ?? undefined,
      color: row.color ?? undefined,
      emoji: row.emoji ?? undefined,
      vibe: row.vibe ?? undefined,
      performance: {
        runs: Number(row.runs_count ?? 0),
        successRate: Number(row.success_rate ?? 1.0),
        avgLatencyMs: Number(row.avg_latency_ms ?? 0),
      },
    };
  }
}

let defaultRegistryInstance: AgentRegistry | null = null;
export function getAgentRegistry(): AgentRegistry {
  if (!defaultRegistryInstance) {
    defaultRegistryInstance = new AgentRegistry();
  }
  return defaultRegistryInstance;
}
