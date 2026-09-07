// Phase 20.9 — Pao-hubPro × Ponytail Minimal-Code Governance Layer
// Reuse Scanner: Repository Inspection for Existing Implementations

import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, relative, basename } from "node:path";

export interface ReuseScanResult {
  hasExistingEquivalent: boolean;
  candidates: Array<{
    filePath: string;
    score: number;
    matchedKeywords: string[];
    description?: string;
  }>;
  suggestedRung: "rung_2_reuse" | "rung_6_local_patch" | "rung_7_new_subsystem";
  recommendation: string;
}

export class ReuseScanner {
  private workspaceRoot: string;

  constructor(workspaceRoot = process.cwd()) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Scans repository for existing modules or functions matching the given intent keywords.
   */
  scan(keywords: string[], options?: { maxResults?: number; targetDirs?: string[] }): ReuseScanResult {
    const maxResults = options?.maxResults ?? 5;
    const targetDirs = options?.targetDirs ?? ["src", "gui/src", "skills"];
    const validKeywords = keywords
      .map((k) => k.toLowerCase().trim())
      .filter((k) => k.length >= 3 && !["and", "the", "for", "with", "add", "make", "create"].includes(k));

    if (validKeywords.length === 0) {
      return {
        hasExistingEquivalent: false,
        candidates: [],
        suggestedRung: "rung_6_local_patch",
        recommendation: "No specific keywords provided; proceed to minimal local patch.",
      };
    }

    const matchedFiles: Array<{ filePath: string; score: number; matchedKeywords: string[] }> = [];

    for (const dir of targetDirs) {
      const fullDir = join(this.workspaceRoot, dir);
      if (existsSync(fullDir)) {
        this.crawlDirectory(fullDir, validKeywords, matchedFiles);
      }
    }

    // Sort by relevance score descending
    matchedFiles.sort((a, b) => b.score - a.score);
    const topCandidates = matchedFiles.slice(0, maxResults);

    const hasExistingEquivalent = topCandidates.length > 0 && topCandidates[0].score >= 2;
    const suggestedRung = hasExistingEquivalent ? "rung_2_reuse" : "rung_6_local_patch";

    const recommendation = hasExistingEquivalent
      ? `Found ${topCandidates.length} existing candidate(s) (e.g. ${topCandidates[0].filePath}). Prefer reusing or extending existing modules.`
      : "No clear existing equivalent module found. Prefer a small local patch before creating new abstractions.";

    return {
      hasExistingEquivalent,
      candidates: topCandidates,
      suggestedRung,
      recommendation,
    };
  }

  private crawlDirectory(
    currentDir: string,
    keywords: string[],
    results: Array<{ filePath: string; score: number; matchedKeywords: string[] }>,
  ): void {
    let entries: string[] = [];
    try {
      entries = readdirSync(currentDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (
        entry.startsWith(".") ||
        entry === "node_modules" ||
        entry === "dist" ||
        entry === "build" ||
        entry === "data" ||
        entry === "coverage"
      ) {
        continue;
      }

      const fullPath = join(currentDir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        this.crawlDirectory(fullPath, keywords, results);
      } else if (stat.isFile() && /\.(ts|tsx|js|mjs)$/.test(entry) && !entry.endsWith(".test.ts") && !entry.endsWith(".test.tsx")) {
        const relPath = relative(this.workspaceRoot, fullPath).replace(/\\/g, "/");
        const baseNameLower = basename(entry).toLowerCase();

        let score = 0;
        const matchedKeywords: string[] = [];

        for (const kw of keywords) {
          if (baseNameLower.includes(kw)) {
            score += 3; // high weight for filename match
            matchedKeywords.push(kw);
          }
        }

        // Sample content for shallow inspection if file is small (< 50KB)
        if (stat.size < 50000) {
          try {
            const content = readFileSync(fullPath, "utf8").toLowerCase();
            for (const kw of keywords) {
              if (content.includes(kw) && !matchedKeywords.includes(kw)) {
                score += 1;
                matchedKeywords.push(kw);
              }
            }
          } catch {
            // Best-effort
          }
        }

        if (score > 0) {
          results.push({
            filePath: relPath,
            score,
            matchedKeywords,
          });
        }
      }
    }
  }
}

let defaultReuseScanner: ReuseScanner | null = null;
export function getReuseScanner(workspaceRoot?: string): ReuseScanner {
  if (!defaultReuseScanner || workspaceRoot) {
    defaultReuseScanner = new ReuseScanner(workspaceRoot);
  }
  return defaultReuseScanner;
}
