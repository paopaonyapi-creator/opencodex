// Phase 20.8 — Cached Snapshot Agency Provider
// Manages local immutable cache snapshots under .pao/cache/agency-agents/
// Enables 100% offline resilience if remote git or external catalog is unreachable.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgencyAgent, AgencySyncResult } from "../types";
import type { AgencyCatalogProvider } from "./agency-catalog-provider";

export class CachedSnapshotProvider implements AgencyCatalogProvider {
  readonly name = "cached-snapshot";
  readonly sourceType = "cached-snapshot";

  private cacheDir: string;
  private manifestPath: string;
  private agentsCache = new Map<string, AgencyAgent>();

  constructor(cacheDir?: string) {
    this.cacheDir = cacheDir ?? join(process.cwd(), ".pao", "cache", "agency-agents");
    this.manifestPath = join(this.cacheDir, "manifest.json");
  }

  isAvailable(): boolean {
    return existsSync(this.manifestPath);
  }

  isSnapshotValid(): boolean {
    return this.isAvailable();
  }

  async sync(): Promise<AgencySyncResult> {
    const startTime = Date.now();
    if (!this.isAvailable()) {
      return {
        source: this.cacheDir,
        sourceType: this.sourceType,
        syncedCount: 0,
        skippedCount: 0,
        blockedCount: 0,
        durationMs: Date.now() - startTime,
        errors: ["No cached snapshot manifest found"],
      };
    }

    try {
      const manifestRaw = readFileSync(this.manifestPath, "utf8");
      const manifest = JSON.parse(manifestRaw) as {
        commitHash?: string;
        agents: AgencyAgent[];
      };

      this.agentsCache.clear();
      for (const agent of manifest.agents) {
        this.agentsCache.set(agent.slug, agent);
      }

      return {
        source: this.cacheDir,
        sourceType: this.sourceType,
        syncedCount: this.agentsCache.size,
        skippedCount: 0,
        blockedCount: 0,
        commitHash: manifest.commitHash,
        durationMs: Date.now() - startTime,
        errors: [],
      };
    } catch (err) {
      return {
        source: this.cacheDir,
        sourceType: this.sourceType,
        syncedCount: 0,
        skippedCount: 0,
        blockedCount: 0,
        durationMs: Date.now() - startTime,
        errors: [`Failed to read cached snapshot: ${String(err)}`],
      };
    }
  }

  async listAgents(): Promise<AgencyAgent[]> {
    if (this.agentsCache.size === 0) {
      await this.sync();
    }
    return Array.from(this.agentsCache.values());
  }

  async loadSnapshot(): Promise<AgencyAgent[]> {
    return this.listAgents();
  }

  async getAgent(slug: string): Promise<AgencyAgent | null> {
    if (this.agentsCache.size === 0) {
      await this.sync();
    }
    return this.agentsCache.get(slug) ?? null;
  }

  async getAgentBody(slug: string): Promise<string> {
    const bodyFile = join(this.cacheDir, "bodies", `${slug}.md`);
    if (existsSync(bodyFile)) {
      return readFileSync(bodyFile, "utf8");
    }
    throw new Error(`Cached body not found for '${slug}' at ${bodyFile}`);
  }

  /**
   * Saves an active list of agents and their bodies to the offline cache directory.
   */
  saveSnapshot(agents: AgencyAgent[], commitHash?: string, bodies?: Map<string, string>): void {
    mkdirSync(join(this.cacheDir, "bodies"), { recursive: true });

    const manifest = {
      snapshotVersion: "1.0",
      createdAt: new Date().toISOString(),
      commitHash: commitHash ?? "local-snapshot",
      agentCount: agents.length,
      agents,
    };

    writeFileSync(this.manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    if (bodies) {
      for (const [slug, body] of bodies.entries()) {
        writeFileSync(join(this.cacheDir, "bodies", `${slug}.md`), body, "utf8");
      }
    }
  }
}
