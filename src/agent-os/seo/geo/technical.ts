/**
 * Phase 18.1 — GEO technical agent: sitemap, canonical, freshness.
 * All checks verify RAW responses directly (sitemap.xml, llms.txt, homepage
 * HTML head) and report absence honestly; nothing is inferred.
 */
import { extractJsonLdBlocks, checkLlmsTxt } from "./analyzers";
import { geoFetch, type GeoFetchResult } from "./geo-fetch";

export interface TechnicalCheck {
  sitemap: { state: "present" | "missing" | "unknown"; urls: number | null };
  canonical: { present: boolean; url: string | null };
  freshness: { hasDate: boolean; datePublished: string | null };
  findings: Array<{ title: string; detail: string; impact: "critical" | "high" | "medium" | "low"; basis: string; verification: "verified" | "unverified" }>;
}

export async function checkTechnical(
  domain: string,
  homepage: { ok: boolean; body: string | null; status: number | null },
  fetcher: (url: string) => Promise<GeoFetchResult> = geoFetch,
): Promise<TechnicalCheck> {
  const findings: TechnicalCheck["findings"] = [];

  // 1. sitemap.xml — direct GET.
  let sitemapState: "present" | "missing" | "unknown" = "unknown";
  let sitemapUrls: number | null = null;
  try {
    const sitemapFetch = await fetcher(`https://${domain}/sitemap.xml`);
    if (sitemapFetch.status === 404) {
      sitemapState = "missing";
      findings.push({
        title: "sitemap.xml is missing (verified 404)",
        detail: "Direct GET /sitemap.xml returned 404. AI crawlers use sitemaps to discover pages efficiently; a missing sitemap slows discovery.",
        impact: "medium", basis: "observed_web_standard", verification: "verified",
      });
    } else if (sitemapFetch.ok && sitemapFetch.body) {
      sitemapState = "present";
      sitemapUrls = (sitemapFetch.body.match(/<loc>/g) ?? []).length;
    }
  } catch { /* network errors leave state unknown honestly */ }

  // 2. canonical — from the homepage HTML.
  let canonicalPresent = false;
  let canonicalUrl: string | null = null;
  if (homepage.ok && homepage.body) {
    const canonicalMatch = homepage.body.match(/<link[^>]+rel=["']canonical["'][^>]*>/i);
    if (canonicalMatch) {
      canonicalPresent = true;
      canonicalUrl = canonicalMatch[0].match(/href=["']([^"']+)["']/i)?.[1] ?? null;
    } else {
      findings.push({
        title: "No canonical link on the homepage (verified)",
        detail: "Raw HTML contains no <link rel=canonical>. Ambiguous canonical signals can split entity authority across URL variants.",
        impact: "medium", basis: "observed_web_standard", verification: "verified",
      });
    }
  }

  // 3. freshness — datePublished/dateModified in JSON-LD or visible meta.
  let hasDate = false;
  let datePublished: string | null = null;
  if (homepage.ok && homepage.body) {
    const blocks = extractJsonLdBlocks(homepage.body);
    for (const block of blocks) {
      try {
        const parsed = JSON.parse(block.raw) as Record<string, unknown>;
        for (const key of ["datePublished", "dateModified"]) {
          const value = parsed[key];
          if (typeof value === "string") { hasDate = true; datePublished = value; }
        }
      } catch { /* ignore malformed */ }
    }
    if (!hasDate && /datetime=|datePublished/i.test(homepage.body)) hasDate = true;
    if (!hasDate) {
      findings.push({
        title: "No freshness date on the homepage (verified)",
        detail: "No datePublished/dateModified found in JSON-LD or HTML. AI systems prefer dated content for freshness-sensitive queries.",
        impact: "low", basis: "general_retrieval_principle", verification: "verified",
      });
    }
  }

  return {
    sitemap: { state: sitemapState, urls: sitemapUrls },
    canonical: { present: canonicalPresent, url: canonicalUrl },
    freshness: { hasDate, datePublished },
    findings,
  };
}

// Re-export for orchestrator convenience.
export { checkLlmsTxt };
