// Phase 20.8 — Agency Sync Service
// Coordinates multi-source syncing, snapshot creation, and registry population.

import { openAgentOsDb } from "../../db";
import { BundledAgencyProvider } from "../providers/bundled-agency-provider";
import { CachedSnapshotProvider } from "../providers/cached-snapshot-provider";
import { getAgentRegistry } from "../registry/agent-registry";
import { getPresetLoader } from "../teams/preset-loader";
import type { AgencySyncResult } from "../types";

export class AgencySyncService {
  private get db() {
    return openAgentOsDb();
  }
  private bundledProvider = new BundledAgencyProvider();
  private cachedProvider = new CachedSnapshotProvider();

  /**
   * Syncs agents from local/bundled sources, stores them in SQLite, and takes a cached snapshot.
   */
  async sync(options: { forceSnapshot?: boolean } = {}): Promise<AgencySyncResult> {
    const startTime = Date.now();
    const sourceId = "src_bundled_local";
    const now = new Date().toISOString();

    // 1. Record sync started
    this.db.query(`
      INSERT INTO agency_sources (
        id, type, name, status, created_at
      ) VALUES (?, 'bundled-fallback', 'Local & Bundled Agency Skills', 'syncing', ?)
      ON CONFLICT(id) DO UPDATE SET status = 'syncing', error_message = NULL
    `).run(sourceId, now);

    try {
      // 2. Sync from Bundled Provider
      const syncResult = await this.bundledProvider.sync();
      const agents = await this.bundledProvider.listAgents();

      const registry = getAgentRegistry();
      const bodiesMap = new Map<string, string>();

      // 3. Upsert agents into registry
      for (const agent of agents) {
        agent.sourceId = sourceId;
        registry.upsertAgent(agent);
        try {
          const body = await this.bundledProvider.getAgentBody(agent.slug);
          bodiesMap.set(agent.slug, body);
        } catch {
          // Body not readable offline
        }
      }

      // 4. Save offline cache snapshot
      this.cachedProvider.saveSnapshot(agents, syncResult.commitHash, bodiesMap);

      // 5. Initialize team presets in SQLite
      getPresetLoader().initPresets();

      // 6. Update source record as synced
      this.db.query(`
        UPDATE agency_sources
        SET status = 'synced', agent_count = ?, last_synced_at = ?
        WHERE id = ?
      `).run(agents.length, new Date().toISOString(), sourceId);

      return {
        ...syncResult,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      const errMsg = String(err);
      this.db.query(`
        UPDATE agency_sources
        SET status = 'error', error_message = ?
        WHERE id = ?
      `).run(errMsg, sourceId);

      // Graceful fallback to cached snapshot if bundled failed
      if (this.cachedProvider.isAvailable()) {
        const fallbackResult = await this.cachedProvider.sync();
        const cachedAgents = await this.cachedProvider.listAgents();
        const registry = getAgentRegistry();
        for (const a of cachedAgents) {
          registry.upsertAgent(a);
        }
        return {
          ...fallbackResult,
          errors: [`Primary sync failed (${errMsg}), fell back to cached snapshot`],
          durationMs: Date.now() - startTime,
        };
      }

      throw err;
    }
  }

  /**
   * Retrieves status of the active catalog sources.
   */
  getStatus(): {
    sources: any[];
    stats: any;
    offlineReady: boolean;
  } {
    const sources = this.db.query("SELECT * FROM agency_sources").all();
    const stats = getAgentRegistry().getStats();
    const offlineReady = this.cachedProvider.isAvailable();

    return {
      sources,
      stats,
      offlineReady,
    };
  }
}

let defaultSyncService: AgencySyncService | null = null;
export function getAgencySyncService(): AgencySyncService {
  if (!defaultSyncService) {
    defaultSyncService = new AgencySyncService();
  }
  return defaultSyncService;
}
