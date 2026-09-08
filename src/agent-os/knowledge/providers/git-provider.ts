// Phase 21 — Git Knowledge Provider (spec section 17).
//
// Read-only inspection of repository history and active commit context
// using direct argument arrays without shell interpolation.

import type { KnowledgeDocument, KnowledgeQuery, ProviderHealth, SearchResult } from "../types";
import type { KnowledgeProvider } from "./provider-interface";

export class GitKnowledgeProvider implements KnowledgeProvider {
  readonly name = "git";

  async search(query: KnowledgeQuery): Promise<SearchResult[]> {
    const term = query.query.trim();
    if (!term || term.length < 3) return [];

    const results: SearchResult[] = [];
    try {
      // 1. Safe git log search
      const logProc = Bun.spawnSync(["git", "log", "-n", "10", "--grep", term, "--oneline"], {
        stdout: "pipe",
        stderr: "pipe",
      });

      if (logProc.exitCode === 0) {
        const out = logProc.stdout.toString().trim();
        if (out.length > 0) {
          const lines = out.split("\n");
          for (const line of lines.slice(0, 3)) {
            results.push({
              documentId: `git_commit_${line.slice(0, 8)}`,
              title: `Git Commit: ${line}`,
              type: "general",
              path: ".git/HEAD",
              section: "Commit History",
              snippet: line,
              score: 0.85,
              provider: this.name,
              sourcePriority: 95,
            });
          }
        }
      }
    } catch {
      // Non-fatal if git is temporarily unavailable
    }

    return results;
  }

  async getDocument(id: string): Promise<KnowledgeDocument | null> {
    if (!id.startsWith("git_")) return null;
    return {
      id,
      type: "general",
      title: id,
      path: ".git",
      hash: "head",
      version: 1,
      status: "active",
      sourcePriority: 95,
      tags: ["git"],
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      indexedAt: new Date().toISOString(),
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    const started = Date.now();
    try {
      const proc = Bun.spawnSync(["git", "rev-parse", "--is-inside-work-tree"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const ok = proc.exitCode === 0;
      return {
        provider: this.name,
        status: ok ? "healthy" : "unavailable",
        latencyMs: Date.now() - started,
        documentCount: 1,
      };
    } catch (err: any) {
      return {
        provider: this.name,
        status: "unavailable",
        latencyMs: Date.now() - started,
        documentCount: 0,
        error: err?.message || String(err),
      };
    }
  }
}
