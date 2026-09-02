/**
 * Phase 18.1 — E-E-A-T content signals (HEURISTIC, raw-HTML based).
 * Experience/Expertise/Authoritativeness/Trust signals that are directly
 * observable on the page: author bylines, dates, about/contact links,
 * outbound references, https. No fact is fabricated; absence is reported.
 */

export interface EeatCheck {
  score: number;                     // 0..100 heuristic
  signals: Array<{ id: string; present: boolean; detail: string }>;
  findings: Array<{ title: string; detail: string; impact: "critical" | "high" | "medium" | "low"; basis: string; verification: "verified" | "unverified" }>;
}

export function analyzeEeat(html: string, url: string): EeatCheck {
  const signals: EeatCheck["signals"] = [];
  const lower = html.toLowerCase();
  const author = /(?:author|byline|ผู้เขียน|เขียนโดย)/i.test(html) || html.includes("Person") && html.includes("author");
  signals.push({ id: "author_byline", present: author, detail: author ? "author marker found" : "no author byline detected" });
  const date = /(?:datePublished|dateModified|datetime=|โพสต์เมื่อ|updated)/i.test(html);
  signals.push({ id: "freshness_date", present: date, detail: date ? "date marker found" : "no visible/structured date detected" });
  const about = /<a[^>]+href="[^"]*(?:about|เกี่ยวกับ)[^"]*"/i.test(html);
  signals.push({ id: "about_link", present: about, detail: about ? "about page link found" : "no about-page link found" });
  const contact = /<a[^>]+href="[^"]*(?:contact|ติดต่อ)[^"]*"/i.test(html);
  signals.push({ id: "contact_link", present: contact, detail: contact ? "contact link found" : "no contact link found" });
  const outbound = (html.match(/<a[^>]+href="https?:\/\//gi) ?? []).length;
  signals.push({ id: "outbound_references", present: outbound > 0, detail: `${outbound} outbound reference link(s)` });
  const secure = url.startsWith("https://");
  signals.push({ id: "transport_secure", present: secure, detail: secure ? "served over https" : "not served over https" });

  let score = 40;
  if (author) score += 15;
  if (date) score += 15;
  if (about) score += 10;
  if (contact) score += 10;
  if (outbound > 0) score += 5;
  if (secure) score += 5;
  score = Math.min(100, score);

  const findings: EeatCheck["findings"] = [];
  if (!author) findings.push({
    title: "No author byline detected",
    detail: "VERIFIED against raw HTML: no author marker was found. For AI-search trust, a named author with real credentials helps.",
    impact: "medium", basis: "general_retrieval_principle", verification: "verified",
  });
  if (!date) findings.push({
    title: "No content date detected",
    detail: "VERIFIED against raw HTML: no datePublished/dateModified marker found. Freshness signals are invisible to crawlers.",
    impact: "medium", basis: "general_retrieval_principle", verification: "verified",
  });
  return { score, signals, findings };
}
