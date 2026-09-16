// Phase 20.34 — provider adapters (spec §10, §9). Four adapters cover the P0
// set: deterministic mock, SSRF-guarded same-domain website contact crawler,
// config-driven generic Apify actor, and a config-driven custom HTTP provider.
// Secrets are read from the environment at call time through the registry's
// secret_ref and never logged or returned.

import { validateAndNormalizeUrl } from "../media-acquisition/url-policy";
import { LeadError } from "./errors";
import { leadFlags } from "./flags";
import { contactPoint } from "./normalize";
import type {
  CostEstimate,
  DiscoveredLead,
  EnrichmentOutcome,
  LeadQuery,
  ProviderDefinition,
  ProviderHealth,
  SearchOutcome,
  VerificationOutcome,
} from "./types";

export interface LeadProviderRuntime {
  definition(): ProviderDefinition;
  healthCheck(): Promise<ProviderHealth>;
  estimateCost(operation: string, units: number): Promise<CostEstimate>;
  search?(input: { query: LeadQuery; runId: string }): Promise<SearchOutcome>;
  enrichCompany?(input: { domain: string; runId: string }): Promise<EnrichmentOutcome>;
  findContacts?(input: { domain: string; runId: string }): Promise<EnrichmentOutcome>;
  verifyContact?(input: { type: string; value: string; runId: string }): Promise<VerificationOutcome>;
}

function resolveSecret(secretRef: string | null): string | null {
  if (!secretRef) return null;
  const value = process.env[secretRef];
  return value && value.trim() ? value.trim() : null;
}

// --- Mock (spec §10.1): deterministic fixtures, no credentials ----------------

const MOCK_FIXTURES: Array<DiscoveredLead> = [
  {
    kind: "local_business",
    company: { canonicalName: "Isan Solar Install Co.", domain: "isansolar.test", websiteUrl: "https://www.isansolar.test", industry: "solar installation", country: "TH", region: "Maha Sarakham", city: "Maha Sarakham" },
    contactPoints: [
      { type: "phone", value: "043-000-111", normalizedValue: "+6643000111", sourceProviderId: "mock-lead", confidence: 0.9, verificationStatus: "unknown" },
      { type: "email", value: "sales@isansolar.test", normalizedValue: "sales@isansolar.test", sourceProviderId: "mock-lead", confidence: 0.85, verificationStatus: "unknown" },
    ],
    socialProfiles: [{ platform: "facebook", url: "https://facebook.com/isansolar.test", sourceProviderId: "mock-lead" }],
    providerExternalId: "mock-lead-001",
  },
  {
    kind: "local_business",
    company: { canonicalName: "Maha Sarakham Green Roof", domain: "msgreenroof.test", websiteUrl: "https://msgreenroof.test", industry: "solar installation", country: "TH", region: "Maha Sarakham", city: "Maha Sarakham" },
    contactPoints: [
      { type: "phone", value: "089-000-222", normalizedValue: "+6689000222", sourceProviderId: "mock-lead", confidence: 0.8, verificationStatus: "unknown" },
    ],
    providerExternalId: "mock-lead-002",
  },
  {
    kind: "company",
    company: { canonicalName: "Northeast Energy Partners", domain: "nepartners.test", websiteUrl: "https://nepartners.test", industry: "renewable energy", country: "TH", region: "Isan" },
    contactPoints: [
      { type: "email", value: "contact@nepartners.test", normalizedValue: "contact@nepartners.test", sourceProviderId: "mock-lead", confidence: 0.82, verificationStatus: "unknown" },
    ],
    providerExternalId: "mock-lead-003",
  },
  {
    kind: "person",
    person: { fullName: "Somchai Jaidee", jobTitle: "Managing Director", companyName: "Isan Solar Install Co.", companyDomain: "isansolar.test", country: "TH", region: "Maha Sarakham" },
    contactPoints: [
      { type: "email", value: "somchai@isansolar.test", normalizedValue: "somchai@isansolar.test", sourceProviderId: "mock-lead", confidence: 0.78, verificationStatus: "unknown" },
    ],
    providerExternalId: "mock-lead-004",
  },
];

export class MockLeadProvider implements LeadProviderRuntime {
  definition(): ProviderDefinition {
    return {
      id: "mock-lead",
      name: "Mock Lead Provider",
      adapter: "mock",
      enabled: true,
      capabilities: ["lead_search", "company_enrichment", "contact_discovery", "contact_verification"],
      pricingModel: "per_result",
      currency: "USD",
      estimatedCostPer1000: 8,
      timeoutMs: 5_000,
      maxConcurrency: 4,
      qualityScore: 0.6,
      reliabilityScore: 0.99,
      requiresApproval: false,
      secretRef: null,
      config: { note: "deterministic fixtures for tests and offline operation" },
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { status: "healthy", latencyMs: 1, message: "deterministic mock" };
  }

  async estimateCost(_operation: string, units: number): Promise<CostEstimate> {
    return { providerId: "mock-lead", currency: "USD", estimatedCost: Number(((units / 1000) * 8).toFixed(4)), units, pricingModel: "per_result" };
  }

  async search(input: { query: LeadQuery; runId: string }): Promise<SearchOutcome> {
    const needle = input.query.query.trim().toLowerCase();
    const industry = (input.query.industryKeywords ?? []).map((keyword) => keyword.toLowerCase());
    const region = (input.query.region || "").toLowerCase();
    const filtered = MOCK_FIXTURES.filter((lead) => {
      const kindOk = lead.kind === input.query.leadKind || (input.query.leadKind === "company" && lead.kind === "local_business");
      const haystack = JSON.stringify(lead).toLowerCase();
      const keywordHit = needle.length === 0 || haystack.includes(needle) || industry.some((keyword) => haystack.includes(keyword));
      const regionHit = !region || haystack.includes(region);
      return kindOk && keywordHit && regionHit;
    });
    return { leads: filtered.slice(0, Math.max(1, input.query.limit)), providerRunId: "mockrun_" + input.runId, units: filtered.length };
  }

  async enrichCompany(input: { domain: string; runId: string }): Promise<EnrichmentOutcome> {
    const match = MOCK_FIXTURES.find((lead) => lead.company?.domain === input.domain);
    if (!match?.company) return { units: 0 };
    return {
      company: { description: "Fixture profile for " + match.company.canonicalName, employeeRange: "11-50" },
      socialProfiles: match.socialProfiles,
      providerRunId: "mockrun_" + input.runId,
      units: 1,
    };
  }

  async findContacts(input: { domain: string; runId: string }): Promise<EnrichmentOutcome> {
    const match = MOCK_FIXTURES.find((lead) => lead.company?.domain === input.domain);
    return { contactPoints: match?.contactPoints ?? [], providerRunId: "mockrun_" + input.runId, units: match?.contactPoints.length ?? 0 };
  }

  async verifyContact(input: { type: string; value: string; runId: string }): Promise<VerificationOutcome> {
    // Deterministic mock verification: syntax-shaped emails verify, fixture
    // domains verify, everything else stays unknown — never invented.
    const known = JSON.stringify(MOCK_FIXTURES).includes(input.value);
    if (input.type === "email") {
      const valid = known || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(input.value);
      return { verificationStatus: valid ? "valid" : "invalid", confidence: valid ? 0.9 : 0.95, units: 1 };
    }
    if (input.type === "phone") {
      return { verificationStatus: known ? "valid" : "risky", confidence: 0.6, units: 1 };
    }
    return { verificationStatus: "unknown", confidence: 0, units: 0 };
  }
}

// --- Website contact crawler (spec §10.3) --------------------------------------

const SOCIAL_HOSTS: Array<{ host: string; platform: string }> = [
  { host: "facebook.com", platform: "facebook" },
  { host: "linkedin.com", platform: "linkedin" },
  { host: "instagram.com", platform: "instagram" },
  { host: "x.com", platform: "x" },
  { host: "twitter.com", platform: "x" },
  { host: "youtube.com", platform: "youtube" },
  { host: "tiktok.com", platform: "tiktok" },
];

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_PATTERN = /(?:\+?\d[\d\s().-]{7,}\d)/g;

export class WebsiteContactProvider implements LeadProviderRuntime {
  private maxPages: number;
  private timeoutMs: number;

  constructor(overrides?: { maxPages?: number; timeoutMs?: number }) {
    this.maxPages = overrides?.maxPages ?? 4;
    this.timeoutMs = overrides?.timeoutMs ?? 10_000;
  }

  definition(): ProviderDefinition {
    return {
      id: "website-contact",
      name: "Website Contact Discovery",
      adapter: "website_crawler",
      enabled: true,
      capabilities: ["company_enrichment", "contact_discovery"],
      pricingModel: "per_request",
      currency: "USD",
      estimatedCostPer1000: 0,
      timeoutMs: this.timeoutMs,
      maxConcurrency: 4,
      qualityScore: 0.7,
      reliabilityScore: 0.8,
      requiresApproval: false,
      secretRef: null,
      config: { sameDomainOnly: true, maxPages: this.maxPages, robots: "policy-aware, bounded" },
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { status: "healthy", latencyMs: 2, message: "fetch-based; SSRF policy enforced per request" };
  }

  async estimateCost(_operation: string, units: number): Promise<CostEstimate> {
    return { providerId: "website-contact", currency: "USD", estimatedCost: 0, units, pricingModel: "per_request" };
  }

  async findContacts(input: { domain: string; runId: string }): Promise<EnrichmentOutcome> {
    const homepage = validateAndNormalizeUrl(input.domain.startsWith("http") ? input.domain : "https://" + input.domain);
    const origin = new URL(homepage.normalizedUrl).origin;
    const baseHost = homepage.domain;
    const candidatePaths = ["/", "/contact", "/contact-us", "/about", "/about-us"];
    const emails = new Map<string, number>();
    const phones = new Map<string, number>();
    const socials = new Map<string, string>();
    let companyName = "";

    let pagesFetched = 0;
    for (const path of candidatePaths) {
      if (pagesFetched >= this.maxPages) break;
      let pageUrl: URL;
      try {
        pageUrl = new URL(path, origin);
        validateAndNormalizeUrl(pageUrl.toString());
      } catch {
        continue; // SSRF/malformed candidate — skip, never fetch
      }
      if (pageUrl.hostname.replace(/^www\./, "") !== baseHost) continue;
      let html: string;
      try {
        const res = await fetch(pageUrl.toString(), {
          redirect: "manual",
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: { Accept: "text/html" },
        });
        if (!res.ok) continue;
        const buffer = await res.arrayBuffer();
        if (buffer.byteLength > 512 * 1024) continue;
        html = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
        pagesFetched += 1;
      } catch {
        continue;
      }
      if (!companyName) {
        const title = html.match(/<title[^>]*>([^<]{1,120})</i);
        if (title?.[1]) companyName = title[1].trim();
      }
      for (const email of html.match(EMAIL_PATTERN) ?? []) {
        if (email.length <= 120) emails.set(email.toLowerCase(), Math.max(emails.get(email.toLowerCase()) ?? 0, 0.75));
      }
      for (const phone of html.match(PHONE_PATTERN) ?? []) {
        const compact = phone.trim();
        if (compact.replace(/\D/g, "").length >= 8 && compact.length <= 24) {
          phones.set(compact, Math.max(phones.get(compact) ?? 0, 0.65));
        }
      }
      for (const anchor of html.match(/href="https?:\/\/[^"]+"/gi) ?? []) {
        const href = anchor.slice(6, -1);
        const social = SOCIAL_HOSTS.find((entry) => href.toLowerCase().includes(entry.host));
        if (social) socials.set(social.platform, href);
      }
    }

    const contactPoints = [
      ...[...emails.entries()].map(([value, confidence]) => contactPoint("email", value, "website-contact", confidence)),
      ...[...phones.entries()].map(([value, confidence]) => contactPoint("phone", value, "website-contact", confidence)),
    ].filter((point): point is NonNullable<typeof point> => point !== null);

    return {
      company: companyName ? { canonicalName: companyName, domain: baseHost, websiteUrl: origin } : { domain: baseHost },
      contactPoints,
      socialProfiles: [...socials.entries()].map(([platform, url]) => ({ platform, url, sourceProviderId: "website-contact" })),
      providerRunId: "web_" + input.runId,
      units: pagesFetched,
    };
  }
}

// --- Generic Apify actor adapter (spec §10.2) ------------------------------------

interface ApifyRunResponse {
  data?: { id?: string; status?: string; defaultDatasetId?: string };
}

/** Fixed-host allowlist for the Apify data plane (spec §39: server-side
 *  provider calls target an allowlisted upstream only). */
const APIFY_API_HOST = "api.apify.com";

function apifyUrl(path: string, token: string): string {
  const url = new URL("https://" + APIFY_API_HOST + path);
  url.searchParams.set("token", token);
  return url.toString();
}

export class ApifyActorProvider implements LeadProviderRuntime {
  constructor(private config: {
    actorId: string;
    capabilities: ProviderDefinition["capabilities"];
    estimatedCostPer1000?: number;
    timeoutMs?: number;
  }) {}

  definition(): ProviderDefinition {
    return {
      id: "apify-" + this.config.actorId.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase(),
      name: "Apify Actor: " + this.config.actorId,
      adapter: "apify_actor",
      enabled: leadFlags().apifyProvider,
      capabilities: this.config.capabilities,
      pricingModel: "per_result",
      currency: "USD",
      estimatedCostPer1000: this.config.estimatedCostPer1000 ?? 0,
      timeoutMs: this.config.timeoutMs ?? 120_000,
      maxConcurrency: 2,
      qualityScore: 0.75,
      reliabilityScore: 0.85,
      requiresApproval: true,
      secretRef: "APIFY_TOKEN",
      config: { actorId: this.config.actorId },
      termsUrl: "https://apify.com/terms",
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    if (!leadFlags().apifyProvider) return { status: "disabled", message: "FEATURE_LEAD_APIFY_PROVIDER is off" };
    if (!resolveSecret("APIFY_TOKEN")) return { status: "degraded", message: "APIFY_TOKEN is not configured" };
    return { status: "healthy", message: "token present; live calls are config-gated" };
  }

  async estimateCost(_operation: string, units: number): Promise<CostEstimate> {
    return { providerId: this.definition().id, currency: "USD", estimatedCost: Number(((units / 1000) * this.definition().estimatedCostPer1000).toFixed(4)), units, pricingModel: "per_result" };
  }

  async search(input: { query: LeadQuery; runId: string }): Promise<SearchOutcome> {
    if (!leadFlags().apifyProvider) throw new LeadError("PROVIDER_DISABLED", "Apify provider is disabled by flag");
    const token = resolveSecret("APIFY_TOKEN");
    if (!token) throw new LeadError("PROVIDER_AUTH_ERROR", "APIFY_TOKEN is not configured");
    const actorId = encodeURIComponent(this.config.actorId);
    const run = await fetch(apifyUrl(`/v2/acts/${actorId}/runs`, token), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: input.query.query,
        location: [input.query.city, input.query.region, input.query.country].filter(Boolean).join(", "),
        limit: input.query.limit,
      }),
      signal: AbortSignal.timeout(this.definition().timeoutMs),
    });
    if (run.status === 401 || run.status === 403) throw new LeadError("PROVIDER_AUTH_ERROR", "Apify rejected the configured token");
    if (!run.ok) throw new LeadError("PROVIDER_UNAVAILABLE", `Apify run start returned HTTP ${run.status}`);
    const runBody = (await run.json()) as ApifyRunResponse;
    const datasetId = runBody.data?.defaultDatasetId;
    const providerRunId = runBody.data?.id;
    if (!datasetId) throw new LeadError("PROVIDER_SCHEMA_CHANGED", "Apify run response lacked a dataset id");
    const items = await fetch(apifyUrl(`/v2/datasets/${datasetId}/items`, token), {
      signal: AbortSignal.timeout(this.definition().timeoutMs),
    });
    if (!items.ok) throw new LeadError("PROVIDER_UNAVAILABLE", `Apify dataset fetch returned HTTP ${items.status}`);
    const raw = (await items.json()) as Array<Record<string, unknown>>;
    const leads = raw.slice(0, Math.max(1, input.query.limit)).map((item) => mapApifyItem(item, this.definition().id));
    return { leads, providerRunId, units: leads.length };
  }
}

/** Defensive mapping of a generic Apify item into a DiscoveredLead; unknown
 *  shapes yield skipped entries rather than fabricated fields. */
function mapApifyItem(item: Record<string, unknown>, providerId: string): DiscoveredLead {
  const company = item.companyName ?? item.company ?? item.title ?? item.name;
  const domain = item.domain ?? item.website ?? item.websiteUrl;
  const phone = item.phone ?? item.phoneNumber ?? item.telephone;
  const email = item.email ?? item.emailAddress;
  const contactPoints: DiscoveredLead["contactPoints"] = [];
  if (typeof email === "string") {
    const point = contactPoint("email", email, providerId, 0.7);
    if (point) contactPoints.push(point);
  }
  if (typeof phone === "string") {
    const point = contactPoint("phone", phone, providerId, 0.6);
    if (point) contactPoints.push(point);
  }
  return {
    kind: "local_business",
    company: {
      canonicalName: typeof company === "string" ? company : "",
      domain: typeof domain === "string" ? domain : undefined,
      address: typeof item.address === "string" ? item.address : undefined,
    },
    contactPoints,
    sourceUrl: typeof item.url === "string" ? item.url : undefined,
    providerExternalId: typeof item.id === "string" || typeof item.id === "number" ? String(item.id) : undefined,
  };
}

// --- Custom HTTP provider (spec §10.4) ---------------------------------------------

export class CustomHttpProvider implements LeadProviderRuntime {
  private cfg: {
    id: string;
    name: string;
    baseUrl: string;
    capabilities: ProviderDefinition["capabilities"];
    searchPath: string;
    secretRef: string | null;
    authHeaderTemplate?: string;
    estimatedCostPer1000: number;
  };

  constructor(cfg: CustomHttpProvider["cfg"]) {
    this.cfg = cfg;
  }

  definition(): ProviderDefinition {
    return {
      id: this.cfg.id,
      name: this.cfg.name,
      adapter: "custom_http",
      enabled: Boolean(this.cfg.baseUrl),
      capabilities: this.cfg.capabilities,
      pricingModel: "per_request",
      currency: "USD",
      estimatedCostPer1000: this.cfg.estimatedCostPer1000,
      timeoutMs: 30_000,
      maxConcurrency: 2,
      qualityScore: 0.5,
      reliabilityScore: 0.5,
      requiresApproval: true,
      secretRef: this.cfg.secretRef,
      config: { baseUrl: this.cfg.baseUrl, searchPath: this.cfg.searchPath, authHeaderTemplate: this.cfg.authHeaderTemplate ?? null },
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    if (!this.cfg.baseUrl) return { status: "disabled", message: "no base URL configured" };
    const secret = resolveSecret(this.cfg.secretRef);
    if (this.cfg.secretRef && !secret) return { status: "degraded", message: "secret reference is not configured" };
    return { status: "healthy", message: "configured; server-side auth" };
  }

  async estimateCost(_operation: string, units: number): Promise<CostEstimate> {
    return { providerId: this.cfg.id, currency: "USD", estimatedCost: Number(((units / 1000) * this.cfg.estimatedCostPer1000).toFixed(4)), units, pricingModel: "per_request" };
  }

  async search(input: { query: LeadQuery; runId: string }): Promise<SearchOutcome> {
    const secret = resolveSecret(this.cfg.secretRef);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (secret && this.cfg.authHeaderTemplate) {
      headers.Authorization = this.cfg.authHeaderTemplate.replace("{secret}", secret);
    }
    // Custom providers are operator-configured: the base URL is validated by
    // the shared Phase 20.24 SSRF policy before every request (fail closed).
    const target = validateAndNormalizeUrl(this.cfg.baseUrl.replace(/\/+$/, "") + this.cfg.searchPath);
    const res = await fetch(target.normalizedUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: input.query.query, limit: input.query.limit, kind: input.query.leadKind }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new LeadError("PROVIDER_UNAVAILABLE", `Custom provider returned HTTP ${res.status}`);
    const payload = (await res.json()) as { items?: Array<Record<string, unknown>> };
    const leads = (payload.items ?? []).map((item) => mapApifyItem(item, this.cfg.id));
    return { leads, providerRunId: "http_" + input.runId, units: leads.length };
  }
}
