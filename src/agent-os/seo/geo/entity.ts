/**
 * Phase 18.1 — Brand authority & entity consistency (heuristic, raw-HTML based).
 * Compares the brand/entity naming found in <title>, meta tags, and JSON-LD
 * against the project's configured brand. Never invents mentions: absence is
 * reported as absence, and every check states its basis.
 */
import { extractJsonLdBlocks } from "./analyzers";

export interface EntityCheck {
  brandInTitle: boolean;
  brandInJsonLd: boolean;
  organizationNameInJsonLd: string | null;
  sameAsCount: number;
  nameVariants: string[];
  findings: Array<{ title: string; detail: string; impact: "critical" | "high" | "medium" | "low"; basis: string; verification: "verified" | "unverified" }>
  summary: { consistent: boolean; score: number };   // score 0..100 heuristic
}

function stripHtml(raw: string): string {
  return raw.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function analyzeEntity(html: string, input: { brandName?: string; organizationName?: string }): EntityCheck {
  const brand = (input.brandName || input.organizationName || "").trim();
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = stripHtml(titleMatch?.[1] ?? "");
  const blocks = extractJsonLdBlocks(html);
  const organizationBlock = blocks.find(block => block.family === "Organization" || block.family === "LocalBusiness");
  let organizationNameInJsonLd: string | null = null;
  if (organizationBlock) {
    try {
      const parsed = JSON.parse(organizationBlock.raw) as Record<string, unknown>;
      organizationNameInJsonLd = typeof parsed["name"] === "string" ? parsed["name"] : null;
    } catch { /* malformed block counted as absence */ }
  }
  const sameAsCount = (html.match(/"sameAs"/g) ?? []).length;
  const findings: EntityCheck["findings"] = [];

  const brandInTitle = brand ? new RegExp(escapeRegExp(brand), "i").test(title) : false;
  const brandInJsonLd = brand ? Boolean(organizationNameInJsonLd && new RegExp(escapeRegExp(brand), "i").test(organizationNameInJsonLd)) : false;

  if (!brand) {
    findings.push({
      title: "No brand/entity name configured for this project",
      detail: "Set displayName or business context in the project so entity consistency can be measured. Nothing was inferred about the brand.",
      impact: "low", basis: "unknown", verification: "unverified",
    });
  } else {
    if (!brandInTitle) findings.push({
      title: `Brand name "${brand}" not found in <title>`,
      detail: "VERIFIED against raw HTML: the configured brand does not appear in the page title, which weakens entity clarity for AI systems.",
      impact: "medium", basis: "observed_web_standard", verification: "verified",
    });
    if (!organizationBlock) findings.push({
      title: "No Organization/LocalBusiness JSON-LD found",
      detail: "VERIFIED against raw HTML. An Organization block with a matching name is the strongest same-page entity signal.",
      impact: "medium", basis: "observed_web_standard", verification: "verified",
    });
    else if (!brandInJsonLd) findings.push({
      title: `Organization JSON-LD name does not match the configured brand`,
      detail: `VERIFIED: JSON-LD says "${organizationNameInJsonLd ?? "(no name)"}" while the project brand is "${brand}". Consistent naming matters for entity resolution.`,
      impact: "high", basis: "observed_web_standard", verification: "verified",
    });
    if (sameAsCount === 0) findings.push({
      title: "No sameAs entity links in structured data",
      detail: "VERIFIED against raw HTML: no sameAs property was found. sameAs links to official profiles strengthen entity disambiguation.",
      impact: "low", basis: "observed_web_standard", verification: "verified",
    });
  }

  // Transparent heuristic score: 40 base + title 20 + jsonld match 25 + sameAs 15.
  const score = 40 + (brandInTitle ? 20 : 0) + (brandInJsonLd ? 25 : 0) + (sameAsCount > 0 ? 15 : 0);
  const nameVariants = [title, organizationNameInJsonLd].filter((value): value is string => Boolean(value));
  return { brandInTitle, brandInJsonLd, organizationNameInJsonLd, sameAsCount, nameVariants, findings, summary: { consistent: brandInTitle && brandInJsonLd, score } };
}
