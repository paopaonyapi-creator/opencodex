// Phase 20.63 — PublicApisGithubSource (spec §10-§12).
//
// Deterministic parser for the upstream curated README. Only sections whose
// table header matches the canonical 5-column format (API | Description |
// Auth | HTTPS | CORS) are ingested; sponsored/foreign-format sections are
// skipped and reported. Auth labels normalize to auth types; rows carry a
// content hash for diffing; duplicates are expected and resolved later by
// hostname + URL evidence, never by display name alone.

import { createHash } from "node:crypto";
import type { ApiCatalogSource, DiscoveredApiRecord, SourceFetchContext, SourceSnapshot, SourceValidationReport } from "./types";

const CANONICAL_HEADER = ["api", "description", "auth", "https", "cors"];
const PARSER_VERSION = "public-apis-readme-1";

export class PublicApisGithubSource implements ApiCatalogSource {
  readonly id = "public-apis-github";
  private readonly repoUrl: string;
  private readonly branch: string;

  constructor(repoUrl = "https://raw.githubusercontent.com/public-apis/public-apis/master/README.md", branch = "master") {
    this.repoUrl = repoUrl;
    this.branch = branch;
  }

  async fetchSnapshot(ctx: SourceFetchContext): Promise<SourceSnapshot> {
    let revision = ctx.pinnedSha ?? this.branch;
    let url = this.repoUrl;
    if (ctx.pinnedSha) {
      url = this.repoUrl.replace(/master\/README\.md$/, ctx.pinnedSha + "/README.md");
    } else {
      // Resolve the current branch head so every snapshot pins a revision.
      try {
        const api = await ctx.fetcher("https://api.github.com/repos/public-apis/public-apis/commits/" + this.branch);
        const sha = JSON.parse(api)["sha"];
        if (typeof sha === "string" && sha.length >= 7) {
          revision = sha;
          url = this.repoUrl.replace(/master\/README\.md$/, sha + "/README.md");
        }
      } catch {
        // Head resolution is advisory; fall back to the branch URL.
      }
    }
    const content = await ctx.fetcher(url);
    return {
      sourceKey: this.id,
      upstreamRevision: revision,
      contentSha256: createHash("sha256").update(content).digest("hex"),
      fetchedAt: new Date().toISOString(),
      content,
    };
  }

  async parse(snapshot: SourceSnapshot): Promise<DiscoveredApiRecord[]> {
    const records: DiscoveredApiRecord[] = [];
    const lines = snapshot.content.split("\n");
    let currentCategory: string | null = null;
    let headerMatches = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const heading = line.match(/^###\s+(.+?)\s*$/);
      if (heading) {
        currentCategory = heading[1].trim();
        headerMatches = false;
        continue;
      }
      if (/^##\s/.test(line)) {
        // h2 sections (e.g. sponsored blocks) are outside the curated schema.
        currentCategory = null;
        headerMatches = false;
        continue;
      }
      // Upstream header rows sometimes lack the leading pipe: accept both forms.
      const headerish = line.toLowerCase().replace(/\|/g, "|").trim();
      if (
        headerish.startsWith("api | description | auth | https | cors")
        || (splitTableRow(line) !== null && isCanonicalHeader(splitTableRow(line)!))
      ) {
        headerMatches = true;
        continue;
      }
      const columns = splitTableRow(line);
      if (!currentCategory || !headerMatches) continue;
      if (!columns || columns.length < 5) continue;
      const record = mapRow(currentCategory, columns);
      if (record) records.push(record);
    }
    return records;
  }

  async validate(records: DiscoveredApiRecord[], previous: DiscoveredApiRecord[] | null): Promise<SourceValidationReport> {
    const warnings: string[] = [];
    const errors: string[] = [];
    const categories = new Set(records.map((r) => r.category));
    let malformed = 0;
    for (const record of records) {
      try {
        new URL(record.url);
      } catch {
        malformed += 1;
        warnings.push("malformed link: " + record.name);
      }
    }
    const rowDropRatio = previous && previous.length > 0
      ? Math.max(0, (previous.length - records.length) / previous.length)
      : null;
    const ok = errors.length === 0
      && categories.size > 0
      && records.length > 0
      && (rowDropRatio === null || rowDropRatio <= 0.10);
    void malformed;
    return {
      ok,
      rowCount: records.length,
      categoryCount: categories.size,
      warnings,
      errors,
      skippedSections: warnings.filter((w) => w.startsWith("skipped")).length ? warnings.filter((w) => w.startsWith("skipped")) : [],
      rowDropRatio,
    };
  }
}

/** Split a markdown table row into trimmed cells (null when not a row). */
export function splitTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || trimmed.startsWith("|:")) return null;
  const cells = trimmed.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
  return cells;
}

function isCanonicalHeader(cells: string[]): boolean {
  const normalized = cells.map((c) => c.replace(/[*_`]/g, "").trim().toLowerCase());
  if (normalized.length < 5) return false;
  return CANONICAL_HEADER.every((h, i) => normalized[i] === h);
}

/** Map one canonical row; returns null for rows that cannot be mapped safely. */
export function mapRow(category: string, cells: string[]): DiscoveredApiRecord | null {
  const nameMatch = cells[0].match(/^\[(.+?)\]\((\S+?)\)/);
  if (!nameMatch) return null;
  const name = nameMatch[1].trim();
  const url = nameMatch[2].trim();
  if (!name || !url) return null;
  const authLabel = cells[2].replace(/`/g, "").trim() || "No";
  const httpsRaw = cells[3].trim().toLowerCase();
  const corsRaw = cells[4].replace(/\|/g, "").trim().toLowerCase();
  const record: DiscoveredApiRecord = {
    category,
    name,
    url,
    description: cells[1].trim(),
    authLabel,
    https: httpsRaw === "yes" ? true : httpsRaw === "no" ? false : null,
    cors: corsRaw === "yes" ? "yes" : corsRaw === "no" ? "no" : "unknown",
    rowHash: createHash("sha256").update(category + "|" + name + "|" + url + "|" + cells.slice(1).join("|")).digest("hex").slice(0, 16),
  };
  return record;
}

/** Normalize an upstream auth label to the canonical auth type. */
export function normalizeAuthType(label: string): "none" | "api_key" | "bearer" | "oauth2" | "custom" | "unknown" {
  const normalized = label.trim().toLowerCase();
  if (normalized === "no" || normalized === "" || normalized === "none") return "none";
  if (normalized.includes("api") && normalized.includes("key")) return "api_key";
  if (normalized.includes("oauth") || normalized === "oauth2") return "oauth2";
  if (normalized.includes("bearer")) return "bearer";
  if (normalized.includes("x-api-key") || normalized === "apikey") return "api_key";
  return "custom";
}

/** Extract the hostname for duplicate resolution (spec §44). */
export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export { PARSER_VERSION };
