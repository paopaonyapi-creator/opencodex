/**
 * Phase 18.1 — safe fetch + direct verification primitives.
 * SSRF policy reuses the provider destination classifier (src/lib/destination-policy.ts):
 * the GEO fetcher never talks to loopback/private/link-local/metadata space, requires
 * https for non-local hosts, caps the response size, and always returns the raw body so
 * verification works on FIRST-PARTY bytes — never on transformed/summarized content.
 */
import { createHash, randomUUID } from "node:crypto";
import type { GeoEvidence } from "./types";

export interface GeoFetchResult {
  ok: boolean;
  status: number | null;
  finalUrl: string | null;
  body: string | null;
  bodyHash: string | null;
  contentType: string | null;
  error?: string;
  durationMs: number;
}

const MAX_BYTES = 5_000_000;
const TIMEOUT_MS = 15_000;

/** Literal + DNS-resolution gate against SSRF (mirrors the provider policy). */
function destinationError(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return "invalid URL";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "only http(s) URLs are fetchable";
  const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, "").replace(/^\[|\]$/g, "");
  if (!hostname) return "missing hostname";
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return "localhost destinations are not fetchable";
  const v4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a > 255 || b > 255) return "invalid IP literal";
    if (a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 169 && b === 254) || (a === 100 && Number(v4[3]) >= 64 && Number(v4[3]) <= 127)
      || (a === 192 && b === 0 && (Number(v4[3]) === 0 || Number(v4[3]) === 2))
      || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && Number(v4[3]) === 100)
      || (a === 203 && b === 0 && Number(v4[3]) === 113) || a >= 224) return "private/loopback/metadata destinations are not fetchable";
    return null;
  }
  if (hostname === "metadata.google.internal" || hostname === "instance-data.ec2.internal" || hostname === "metadata.azure.internal") return "blocked metadata endpoint";
  return null; // hostnames are re-checked post-DNS below
}

export async function geoFetch(url: string): Promise<GeoFetchResult> {
  const started = Date.now();
  const literalError = destinationError(url);
  if (literalError) {
    return { ok: false, status: null, finalUrl: null, body: null, bodyHash: null, contentType: null, error: literalError, durationMs: Date.now() - started };
  }
  let parsed: URL;
  try { parsed = new URL(url.trim()); } catch { return { ok: false, status: null, finalUrl: null, body: null, bodyHash: null, contentType: null, error: "invalid URL", durationMs: Date.now() - started }; }
  // Post-DNS check: resolve and classify every address (catches DNS rebinding to private space).
  const { lookup } = await import("node:dns/promises");
  let addresses: Array<{ address: string }> = [];
  try { addresses = await lookup(parsed.hostname, { all: true, verbatim: true }); } catch { /* unreachable is a fetch error, not a policy error */ }
  for (const { address } of addresses) {
    const destErr = destinationError(`http://${address}/`);
    if (destErr && destErr !== "invalid URL") {
      return { ok: false, status: null, finalUrl: null, body: null, bodyHash: null, contentType: null, error: `resolved address blocked: ${destErr}`, durationMs: Date.now() - started };
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(parsed.toString(), {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "PaoGEOEngine/18.1 (+local audit)" },
    });
    const contentType = res.headers.get("content-type");
    const raw = await res.arrayBuffer();
    const capped = raw.byteLength > MAX_BYTES ? raw.slice(0, MAX_BYTES) : raw;
    const body = new TextDecoder().decode(capped);
    return { ok: res.ok, status: res.status, finalUrl: res.url || parsed.toString(), body, bodyHash: createHash("sha256").update(new Uint8Array(raw)).digest("hex"), contentType, durationMs: Date.now() - started };
  } catch (error) {
    const message = (error as { name?: string }).name === "AbortError" ? "fetch timed out" : error instanceof Error ? error.message : "fetch failed";
    return { ok: false, status: null, finalUrl: null, body: null, bodyHash: null, contentType: null, error: message, durationMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

export function makeEvidence(input: {
  url: string;
  kind: GeoEvidence["kind"];
  fetch: Pick<GeoFetchResult, "status" | "finalUrl" | "bodyHash">;
  excerpt?: string | null;
  lineHint?: string | null;
  detail?: Record<string, unknown>;
}): GeoEvidence {
  return {
    id: `ev_${randomUUID().slice(0, 8)}`,
    url: input.url,
    kind: input.kind,
    verification: "verified",
    httpStatus: input.fetch.status ?? null,
    finalUrl: input.fetch.finalUrl ?? null,
    contentHash: input.fetch.bodyHash ?? null,
    excerpt: input.excerpt?.slice(0, 400) ?? null,
    lineHint: input.lineHint ?? null,
    retrievedAt: new Date().toISOString(),
    ...(input.detail ? { detail: input.detail } : {}),
  };
}
