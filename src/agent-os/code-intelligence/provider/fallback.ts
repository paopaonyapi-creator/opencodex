// Phase 20.62 — Reduced-confidence fallback provider (spec §45).
//
// When Graft is unavailable, LOW-risk read-only discovery may fall back to a
// plain filesystem text scan. Every result is explicitly marked as fallback —
// it must never pretend to carry dependency completeness. High-risk
// operations refuse the fallback entirely (the service blocks them).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CodeIntelError, type BlastRadiusReport, type CodeIntelligenceCapabilities, type CodeIntelligenceProvider, type CodeOccurrence, type CodeSearchResult, type DependencyTrace, type FileApiSurface, type FindAllInput, type FindCodeInput, type FreshnessReport, type GraphBuildResult, type ProviderHealth, type RepositoryMap } from "../types";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", "vendor", ".venv"]);
const MAX_SCAN_FILES = 2_000;
const MAX_FILE_BYTES = 512 * 1024;

export class FallbackProvider implements CodeIntelligenceProvider {
  readonly provider = "fallback";

  private health(): ProviderHealth {
    return {
      available: true,
      provider: this.provider,
      version: null,
      nodeVersion: process.versions.node ?? null,
      compatible: false,
      incompatibilityReason: "reduced-confidence filesystem fallback; no dependency graph",
      telemetryDisabled: true,
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    return this.health();
  }

  async getCapabilities(): Promise<CodeIntelligenceCapabilities> {
    return {
      provider: this.provider, version: null, structural: false, deepEnrichment: false,
      mcpTools: [], compatible: false, incompatibilityReason: "fallback only supports exhaustive text find",
    };
  }

  async getRepositoryMap(): Promise<RepositoryMap> {
    throw new CodeIntelError("CODEINTEL_PROVIDER_UNAVAILABLE", 503, "repository map requires the structural provider");
  }

  async findCode(_input: FindCodeInput): Promise<CodeSearchResult[]> {
    throw new CodeIntelError("CODEINTEL_PROVIDER_UNAVAILABLE", 503, "semantic code search requires the structural provider");
  }

  async getFileApi(): Promise<FileApiSurface> {
    throw new CodeIntelError("CODEINTEL_PROVIDER_UNAVAILABLE", 503, "file API surface requires the structural provider");
  }

  async traceCalls(): Promise<DependencyTrace> {
    throw new CodeIntelError("CODEINTEL_PROVIDER_UNAVAILABLE", 503, "dependency tracing requires the structural provider");
  }

  async blastRadius(): Promise<BlastRadiusReport> {
    throw new CodeIntelError("CODEINTEL_PROVIDER_UNAVAILABLE", 503, "blast radius requires the structural provider");
  }

  async checkFreshness(): Promise<FreshnessReport> {
    return { state: "missing", drift: "no graph exists in fallback mode" };
  }

  async buildGraph(): Promise<GraphBuildResult> {
    throw new CodeIntelError("CODEINTEL_PROVIDER_UNAVAILABLE", 503, "graph build requires the structural provider");
  }

  /** Bounded recursive text scan (bounded by design; no shell, no regex on paths). */
  async findAll(input: FindAllInput): Promise<CodeOccurrence[]> {
    const needle = input.pattern.toLowerCase();
    const occurrences: CodeOccurrence[] = [];
    const root = input.cwd;
    const scan = (dir: string, depth: number): void => {
      if (depth > 8 || occurrences.length >= 50) return;
      let entries: string[] = [];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (SKIP_DIRS.has(entry) || occurrences.length >= 50) continue;
        const full = join(dir, entry);
        let stat;
        try {
          stat = statSync(full);
        } catch {
          continue;
        }
        if (stat.isDirectory()) {
          scan(full, depth + 1);
          continue;
        }
        if (stat.size > MAX_FILE_BYTES || occurrences.length >= 50) continue;
        let content: string;
        try {
          content = readFileSync(full, "utf8");
        } catch {
          continue;
        }
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(needle)) {
            occurrences.push({ path: full.slice(root.length + 1).replace(/\\/g, "/"), line: i + 1, text: lines[i].slice(0, 200), symbol: null });
            if (occurrences.length >= 50) break;
          }
        }
        void MAX_SCAN_FILES;
      }
    };
    scan(root, 0);
    return occurrences;
  }
}
