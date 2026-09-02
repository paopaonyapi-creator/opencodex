/**
 * Phase 18.1 — GEO analyzers: crawler policy (robots.txt), llms.txt, schema.
 * All analyzers verify against RAW first-party responses (never transformed
 * markdown), attach evidence, and mark anything unverifiable as unverified.
 */
import { createHash } from "node:crypto";
import { geoFetch, makeEvidence, type GeoFetchResult } from "./geo-fetch";
import type { GeoCrawlerPolicyStatus, GeoEvidence, GeoFinding, LlmsTxtState } from "./types";

// --- AI crawler registry (config-style data, not logic) -------------------

const AI_CRAWLERS: ReadonlyArray<{ id: string; displayName: string; userAgents: string[]; category: "training" | "search" | "retrieval" | "unknown" }> = [
  { id: "gptbot", displayName: "GPTBot", userAgents: ["GPTBot"], category: "training" },
  { id: "claudebot", displayName: "ClaudeBot", userAgents: ["ClaudeBot", "anthropic-ai"], category: "training" },
  { id: "perplexitybot", displayName: "PerplexityBot", userAgents: ["PerplexityBot"], category: "search" },
  { id: "google-extended", displayName: "Google-Extended", userAgents: ["Google-Extended"], category: "training" },
  { id: "applebot-extended", displayName: "Applebot-Extended", userAgents: ["Applebot-Extended"], category: "training" },
  { id: "ccbot", displayName: "CCBot", userAgents: ["CCBot"], category: "training" },
  { id: "bytespider", displayName: "Bytespider", userAgents: ["Bytespider"], category: "training" },
];

export interface RobotsGroup { userAgent: string[]; allow: string[]; disallow: string[]; lineStart: number; }

/** Deterministic robots.txt group parser (no evaluation, plain line grammar). */
export function parseRobotsTxt(body: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  body.split(/\r?\n/).forEach((line, index) => {
    const clean = line.split("#")[0]!.trim();
    if (!clean) return;
    const sep = clean.indexOf(":");
    if (sep < 0) return;
    const field = clean.slice(0, sep).trim().toLowerCase();
    const value = clean.slice(sep + 1).trim();
    if (field === "user-agent") {
      if (!current || current.allow.length > 0 || current.disallow.length > 0) {
        current = { userAgent: [], allow: [], disallow: [], lineStart: index + 1 };
        groups.push(current);
      }
      current.userAgent.push(value);
      return;
    }
    if (!current) return;
    if (field === "allow") current.allow.push(value);
    else if (field === "disallow") current.disallow.push(value);
  });
  return groups;
}

/** Longest-match user-agent wins (RFC 9309); * matches any UA. */
function rulesFor(groups: RobotsGroup[], userAgents: string[]): { allow: string[]; disallow: string[] } | null {
  let best: RobotsGroup | null = null;
  for (const group of groups) {
    const matches = group.userAgent.some(ua => ua === "*" || userAgents.some(needle => ua.toLowerCase() === needle.toLowerCase()));
    if (!matches) continue;
    if (group.userAgent.includes("*")) { if (!best) best = group; continue; }
    if (!best || best.userAgent.includes("*") || group.userAgent.length > best.userAgent.length) best = group;
  }
  if (!best) return null;
  return { allow: best.allow, disallow: best.disallow };
}

function classifyAccess(rules: { allow: string[]; disallow: string[] } | null): "allowed" | "blocked" | "partial" | "unknown" {
  if (!rules) return "unknown";
  if (rules.disallow.some(rule => rule === "/")) {
    return rules.allow.some(rule => rule.startsWith("/")) ? "partial" : "blocked";
  }
  return "allowed";
}

export interface CrawlersCheck {
  statuses: GeoCrawlerPolicyStatus[];
  findings: GeoFinding[];
  evidence: GeoEvidence[];
}

export async function checkCrawlerPolicy(domain: string): Promise<CrawlersCheck> {
  const url = `https://${domain}/robots.txt`;
  const fetchResult = await geoFetch(url);
  const statuses: GeoCrawlerPolicyStatus[] = [];
  const findings: GeoFinding[] = [];
  const evidence: GeoEvidence[] = [];
  if (!fetchResult.ok || fetchResult.body === null) {
    evidence.push({
      id: `ev_${createHash("sha256").update(url).digest("hex").slice(0, 8)}`,
      url, kind: "robots_txt", verification: fetchResult.status === 404 ? "verified" : "unverifiable",
      httpStatus: fetchResult.status ?? null, finalUrl: fetchResult.finalUrl ?? null, contentHash: fetchResult.bodyHash ?? null,
      excerpt: fetchResult.error ?? null, retrievedAt: new Date().toISOString(),
      detail: { note: fetchResult.status === 404 ? "robots.txt explicitly 404 (no rules file)" : "robots.txt fetch failed" },
    });
    for (const crawler of AI_CRAWLERS) statuses.push({ crawlerId: crawler.id, displayName: crawler.displayName, category: crawler.category, access: fetchResult.status === 404 ? "allowed" : "unknown", evidenceLines: [] });
    if (fetchResult.status !== 404) {
      findings.push({
        id: `f_${randomId()}`, agent: "ai-crawler-policy", title: "robots.txt could not be verified",
        detail: `Fetch ${url} failed (${fetchResult.error ?? fetchResult.status}). Crawler access is UNKNOWN — do not assume either way.`,
        basis: "observed_web_standard", verification: "unverifiable", evidence, impact: "medium", confidence: 0.95,
      });
    }
    return { statuses, findings, evidence };
  }
  const groups = parseRobotsTxt(fetchResult.body);
  const rawLines = fetchResult.body.split(/\r?\n/);
  evidence.push(makeEvidence({ url, kind: "robots_txt", fetch: fetchResult, excerpt: fetchResult.body.slice(0, 400), detail: { groups: groups.length } }));
  for (const crawler of AI_CRAWLERS) {
    const rules = rulesFor(groups, crawler.userAgents);
    const access = classifyAccess(rules);
    const lines = collectEvidenceLines(rawLines, crawler.userAgents);
    statuses.push({ crawlerId: crawler.id, displayName: crawler.displayName, category: crawler.category, access, evidenceLines: lines });
  }
  const blocked = statuses.filter(status => status.access === "blocked");
  if (blocked.length > 0) {
    findings.push({
      id: `f_${randomId()}`, agent: "ai-crawler-policy",
      title: `AI crawlers blocked: ${blocked.map(b => b.displayName).join(", ")}`,
      detail: "Verified against raw robots.txt. Blocking is a legitimate business/privacy choice — only change it if the project explicitly wants AI-search visibility.",
      basis: "observed_web_standard", verification: "verified", evidence, impact: "medium", confidence: 0.9,
    });
  }
  return { statuses, findings, evidence };
}

function collectEvidenceLines(rawLines: string[], userAgents: string[]): string[] {
  const needles = [...userAgents.map(ua => ua.toLowerCase()), "*"];
  const lines: string[] = [];
  let capturing = false;
  rawLines.forEach((line, index) => {
    const clean = line.split("#")[0]!.trim().toLowerCase();
    if (clean.startsWith("user-agent:")) {
      capturing = needles.includes(clean.slice("user-agent:".length).trim());
    }
    if (capturing && (clean.startsWith("allow:") || clean.startsWith("disallow:"))) {
      lines.push(`L${index + 1}: ${line.trim()}`);
    }
  });
  return lines.slice(0, 12);
}

// --- llms.txt ---------------------------------------------------------------

export interface LlmsTxtCheck {
  state: LlmsTxtState;
  url: string;
  httpStatus: number | null;
  issues: string[];
  findings: GeoFinding[];
  evidence: GeoEvidence[];
}

export async function checkLlmsTxt(domain: string): Promise<LlmsTxtCheck> {
  const url = `https://${domain}/llms.txt`;
  const fetchResult = await geoFetch(url);
  const evidence: GeoEvidence[] = [];
  if (fetchResult.status === 404) {
    evidence.push(makeEvidence({ url, kind: "llms_txt", fetch: fetchResult, detail: { note: "direct GET returned 404" } }));
    return { state: "missing", url, httpStatus: 404, issues: [], findings: [{
      id: `f_${randomId()}`, agent: "llms-txt", title: "llms.txt is missing",
      detail: "Direct GET /llms.txt returned 404 (verified). A proposal can be generated for human review — never deployed without approval.",
      basis: "public_platform_documentation", verification: "verified", evidence, impact: "low", confidence: 1,
    }], evidence };
  }
  if (!fetchResult.ok || fetchResult.body === null) {
    evidence.push(makeEvidence({ url, kind: "llms_txt", fetch: { ...fetchResult, status: fetchResult.status ?? null }, excerpt: fetchResult.error ?? null }));
    return { state: "fetch_failed", url, httpStatus: fetchResult.status ?? null, issues: [fetchResult.error ?? "fetch failed"], findings: [{
      id: `f_${randomId()}`, agent: "llms-txt", title: "llms.txt existence could not be verified",
      detail: `Direct GET failed (${fetchResult.error ?? "unknown"}). State stays UNKNOWN — never report MISSING without a 404.`,
      basis: "public_platform_documentation", verification: "unverifiable", evidence, impact: "low", confidence: 1,
    }], evidence };
  }
  const issues: string[] = [];
  const body = fetchResult.body;
  const links = Array.from(body.matchAll(/^\s*-?\s*\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/gm)).map(match => match[1]!);
  const foreign = links.filter(link => { try { return new URL(link).hostname !== domain && !new URL(link).hostname.endsWith("." + domain); } catch { return true; } });
  if (foreign.length > 0) issues.push(`${foreign.length} link(s) point outside ${domain}`);
  if (body.length < 40) issues.push("file is suspiciously short");
  evidence.push(makeEvidence({ url, kind: "llms_txt", fetch: fetchResult, excerpt: body.slice(0, 400), detail: { links: links.length } }));
  return { state: issues.length > 0 ? "present_with_issues" : "present_valid", url, httpStatus: fetchResult.status ?? null, issues, findings: [], evidence };
}

// --- Schema (raw HTML verification) ------------------------------------------

export interface SchemaCheck {
  blocksFound: number;
  families: string[];
  findings: GeoFinding[];
  evidence: GeoEvidence[];
}

export function extractJsonLdBlocks(html: string): Array<{ family: string; raw: string }> {
  const blocks: Array<{ family: string; raw: string }> = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    const raw = match[1]!.trim();
    try {
      const parsed = JSON.parse(raw) as unknown;
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        const record = node as Record<string, unknown>;
        const type = record["@type"];
        const family = Array.isArray(type) ? String(type[0] ?? "") : String(type ?? "");
        if (family) blocks.push({ family, raw: raw.slice(0, 800) });
      }
    } catch { /* malformed JSON-LD is reported by the caller as an issue, not a crash */ }
  }
  return blocks;
}

export async function checkSchema(domain: string, suppliedFetch?: GeoFetchResult): Promise<SchemaCheck> {
  const url = `https://${domain}/`;
  const fetchResult = suppliedFetch ?? await geoFetch(url);
  const evidence: GeoEvidence[] = [];
  if (!fetchResult.ok || fetchResult.body === null) {
    evidence.push(makeEvidence({ url, kind: "html_head", fetch: { ...fetchResult, status: fetchResult.status ?? null }, excerpt: fetchResult.error ?? null }));
    return { blocksFound: 0, families: [], findings: [{
      id: `f_${randomId()}`, agent: "schema-intelligence", title: "Homepage HTML could not be verified",
      detail: `Raw HTML fetch failed (${fetchResult.error ?? fetchResult.status}); schema presence stays UNKNOWN.`,
      basis: "observed_web_standard", verification: "unverifiable", evidence, impact: "low", confidence: 1,
    }], evidence };
  }
  const blocks = extractJsonLdBlocks(fetchResult.body);
  const families = [...new Set(blocks.map(block => block.family))];
  evidence.push(makeEvidence({
    url, kind: "json_ld", fetch: fetchResult,
    excerpt: blocks.length > 0 ? blocks[0]!.raw.slice(0, 300) : null,
    detail: { blocks: blocks.length, families },
  }));
  const findings: GeoFinding[] = [];
  if (!families.includes("Organization")) {
    findings.push({
      id: `f_${randomId()}`, agent: "schema-intelligence", title: "No Organization JSON-LD on the homepage",
      detail: "VERIFIED against raw HTML: no Organization JSON-LD block was found. Entity clarity for AI systems may suffer; a schema proposal would require human approval before any patch.",
      basis: "observed_web_standard", verification: "verified", evidence, impact: "medium", confidence: 0.85,
    });
  }
  return { blocksFound: blocks.length, families, findings, evidence };
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}
