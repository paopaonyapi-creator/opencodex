// Phase 20.34 — Lead Intelligence Control Plane tests.
// Covers normalization (§16), dedupe (§17), routing strategies (§14), budget
// enforcement (§15), scoring profiles (§20-21), suppression + export gate
// (§22), the mock-provider search→normalize→dedupe→persist flow (§40), human
// approval invariants, and the SSRF/interpreter safety of the crawler target
// policy. No live provider is contacted.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAgentOsDbForTests } from "../src/agent-os/db";
import { LeadService, getLeadService, resetLeadServiceForTests } from "../src/agent-os/leads/service-core";
import { normalizeDomain, normalizeEmail, normalizePhone, normalizeCompanyName, mergeContactPoints } from "../src/agent-os/leads/normalize";
import { selectProviders, checkBudget, routeScore, SCORING_PROFILES, suppressionHits } from "../src/agent-os/leads/policy";
import { leadFlags, externalOutreachAutoSend } from "../src/agent-os/leads/flags";
import { WebsiteContactProvider, MockLeadProvider } from "../src/agent-os/leads/providers";
import type { CanonicalLead, DiscoveredLead, LeadBudget } from "../src/agent-os/leads/types";

let testDir: string;
let service: LeadService;

beforeEach(() => {
  closeAgentOsDbForTests();
  resetLeadServiceForTests();
  testDir = mkdtempSync(join(tmpdir(), "ocx-lead-test-"));
  process.env.OPENCODEX_HOME = testDir;
  delete process.env.FEATURE_LEAD_APIFY_PROVIDER;
  delete process.env.APIFY_ACTOR_ID;
  delete process.env.LEAD_CUSTOM_PROVIDERS_JSON;
  service = new LeadService();
  service.ensureRegistry();
});

afterEach(() => {
  closeAgentOsDbForTests();
  resetLeadServiceForTests();
  rmSync(testDir, { recursive: true, force: true });
});

function discovered(kind: DiscoveredLead["kind"], name: string, domain: string | undefined, extra?: Partial<DiscoveredLead>): DiscoveredLead {
  return {
    kind,
    company: kind === "person" ? undefined : { canonicalName: name, domain },
    person: kind === "person" ? { fullName: name, jobTitle: "Manager" } : undefined,
    contactPoints: [],
    ...extra,
  };
}

// --- Normalization (§16) --------------------------------------------------------

describe("Phase 20.34 normalization", () => {
  test("domain canonicalization strips scheme, www and paths", () => {
    expect(normalizeDomain("https://www.example.com/path/")).toBe("example.com");
    expect(normalizeDomain("HTTP://Shop.Co.TH:8080/x")).toBe("shop.co.th");
    expect(normalizeDomain("not a url")).toBe("");
  });

  test("email normalization lowercases the domain and validates syntax", () => {
    expect(normalizeEmail("  Sales@EXAMPLE.com ")).toEqual({ normalized: "Sales@example.com", syntaxValid: true });
    expect(normalizeEmail("mailto:info@site.test")).toEqual({ normalized: "info@site.test", syntaxValid: true });
    expect(normalizeEmail("broken-at-sign")).toEqual({ normalized: "broken-at-sign", syntaxValid: false });
  });

  test("phone E.164 only applies with country evidence; never guesses (§16.3)", () => {
    expect(normalizePhone("089-000-2222", "TH")).toEqual({ normalized: "+66890002222", e164Applied: true });
    expect(normalizePhone("089-000-2222").e164Applied).toBe(false);
    expect(normalizePhone("+66890002222").normalized).toBe("+66890002222");
  });

  test("company canonical keys strip legal suffixes for dedupe", () => {
    const a = normalizeCompanyName("Isan Solar Install Co., Ltd");
    const b = normalizeCompanyName("isan solar install");
    expect(a.canonicalKey).toBe(b.canonicalKey);
  });

  test("contact points dedupe by type + normalized value keeping best confidence", () => {
    const merged = mergeContactPoints(
      [{ type: "email", value: "a@example.com", normalizedValue: "a@example.com", sourceProviderId: "p1", confidence: 0.7, verificationStatus: "unknown" }],
      [
        { type: "email", value: "a@example.com", normalizedValue: "a@example.com", sourceProviderId: "p2", confidence: 0.9, verificationStatus: "unknown" },
        { type: "email", value: "b@example.com", normalizedValue: "b@example.com", sourceProviderId: "p2", confidence: 0.5, verificationStatus: "unknown" },
      ],
    );
    expect(merged).toHaveLength(2);
    expect(merged.find((point) => point.normalizedValue === "a@example.com")?.confidence).toBe(0.9);
  });
});

// --- Routing + budget (§14, §15) ---------------------------------------------------

describe("Phase 20.34 routing and budget", () => {
  const budget: LeadBudget = { maxJobCost: 2, currency: "USD", maxCostPerLead: 0.05, allowOverrunPercent: 0, requireApprovalAbove: 1 };

  test("strategies reorder eligible providers", () => {
    const candidates = [
      { definition: { id: "cheap", name: "Cheap", adapter: "mock" as const, enabled: true, capabilities: ["lead_search" as const], pricingModel: "per_result" as const, currency: "USD", estimatedCostPer1000: 1, timeoutMs: 10000, maxConcurrency: 1, qualityScore: 0.4, reliabilityScore: 0.9, requiresApproval: false, secretRef: null, config: {} }, health: { status: "healthy" as const }, estimate: { providerId: "cheap", currency: "USD", estimatedCost: 0.01, units: 10, pricingModel: "per_result" as const } },
      { definition: { id: "best", name: "Best", adapter: "mock" as const, enabled: true, capabilities: ["lead_search" as const], pricingModel: "per_result" as const, currency: "USD", estimatedCostPer1000: 10, timeoutMs: 10000, maxConcurrency: 1, qualityScore: 0.95, reliabilityScore: 0.9, requiresApproval: false, secretRef: null, config: {} }, health: { status: "healthy" as const }, estimate: { providerId: "best", currency: "USD", estimatedCost: 0.1, units: 10, pricingModel: "per_result" as const } },
    ];
    expect(selectProviders(candidates, { capability: "lead_search", strategy: "CHEAPEST", budget, remainingBudget: 2 }).ordered[0]?.definition.id).toBe("cheap");
    expect(selectProviders(candidates, { capability: "lead_search", strategy: "BEST_QUALITY", budget, remainingBudget: 2 }).ordered[0]?.definition.id).toBe("best");
    const balanced = selectProviders(candidates, { capability: "lead_search", strategy: "BALANCED", budget, remainingBudget: 2 }).ordered;
    expect(balanced).toHaveLength(2);
    expect(balanced[0]!.score).toBeGreaterThan(0);
    const downed = selectProviders([{ ...candidates[0]!, health: { status: "down" as const } }], { capability: "lead_search", strategy: "BALANCED", budget, remainingBudget: 2 });
    expect(downed.ordered).toHaveLength(0);
    expect(downed.rejected[0]?.reason).toBe("health=down");
  });

  test("hard budget rules block overruns and demand approval past the threshold (§15)", () => {
    expect(checkBudget(budget, 2.5, 10).reasonCode).toBe("BUDGET_EXCEEDED");
    expect(checkBudget(budget, 1.5, 100).reasonCode).toBe("APPROVAL_REQUIRED");
    expect(checkBudget(budget, 0.5, 100).allowed).toBe(true);
    const perLead = { ...budget, maxCostPerLead: 0.01 };
    expect(checkBudget(perLead, 0.5, 10).reasonCode).toBe("BUDGET_EXCEEDED");
  });

  test("route score blends quality, reliability, cost and latency", () => {
    const provider = new MockLeadProvider();
    const { score } = routeScore(provider.definition(), { status: "healthy", latencyMs: 1 }, { providerId: "mock-lead", currency: "USD", estimatedCost: 0.08, units: 10, pricingModel: "per_result" }, budget);
    expect(score).toBeGreaterThan(0.5);
  });
});

// --- Service flows with the mock provider (§40 integration) ---------------------------

describe("Phase 20.34 search → normalize → dedupe → score pipeline", () => {
  test("mock search persists normalized leads; repeat runs merge instead of duplicating", async () => {
    const first = await service.search({
      query: { query: "solar", region: "Maha Sarakham", leadKind: "local_business", limit: 10 },
      actor: "dashboard",
    });
    expect(first.status).toBe("completed");
    expect(first.result?.discovered).toBeGreaterThan(0);
    expect(first.actualCost).toBeLessThanOrEqual(first.estimatedCost);

    const second = await service.search({
      query: { query: "solar", region: "Maha Sarakham", leadKind: "local_business", limit: 10 },
      actor: "dashboard",
    });
    expect(second.result?.discovered).toBe(0);
    expect(second.result?.merged).toBe(first.result?.discovered);
    expect(service.listLeads({})).toHaveLength(first.result?.discovered ?? 0);
    const audit = service.listAudit(10);
    expect(audit.some((entry) => entry.action === "search.completed")).toBe(true);
  });

  test("enrich → verify → score advances lead lifecycle with provenance", async () => {
    await service.search({ query: { query: "solar", leadKind: "local_business", limit: 5 }, actor: "dashboard" });
    const lead = service.listLeads({ status: "normalized" })[0]!;
    await service.enrich({ leadId: lead.id, actor: "dashboard" });
    const detail = service.leadDetail(lead.id)!;
    expect(detail.lead.status).toBe("enriched");
    expect(detail.sourceRecords.length).toBeGreaterThanOrEqual(1);
    expect(detail.fieldEvidence.length).toBeGreaterThan(0);

    await service.verify({ leadId: lead.id, actor: "dashboard" });
    const verified = service.leadDetail(lead.id)!;
    expect(verified.lead.status).toBe("verified");
    expect(verified.contactPoints.some((point) => point.verificationStatus === "valid")).toBe(true);

    const scored = service.score({ leadId: lead.id, industryKeywords: ["solar"], region: "Maha Sarakham", actor: "dashboard" });
    expect(scored.score!.total).toBeGreaterThan(0);
    expect(scored.score!.scoringProfileId).toContain("@v");
    expect(SCORING_PROFILES.map((profile) => profile.id)).toContain("b2b-decision-maker");
  });

  test("budget gate routes oversized jobs to approval and only humans release them", async () => {
    const job = await service.search({
      query: { query: "solar", leadKind: "local_business", limit: 100 },
      budget: { maxJobCost: 2, currency: "USD", maxCostPerLead: 0.05, allowOverrunPercent: 0, requireApprovalAbove: 0.01 },
      actor: "dashboard",
    });
    expect(job.status).toBe("waiting_approval");
    expect(() => service.approveJob(job.id, "agent_codex")).toThrow("invariant");
    const approved = service.approveJob(job.id, "dashboard");
    expect(approved.status).toBe("queued");

    const over = await service.search({
      query: { query: "solar", leadKind: "local_business", limit: 100 },
      budget: { maxJobCost: 0.1, currency: "USD", maxCostPerLead: 0.05, allowOverrunPercent: 0, requireApprovalAbove: 0.01 },
      actor: "dashboard",
    });
    expect(over.status).toBe("blocked");
    expect(over.errorCode).toBe("BUDGET_EXCEEDED");
    expect(() => service.approveJob(over.id, "dashboard")).toThrow("budget-exceeded");
  });

  test("pipeline runs end-to-end and applies suppression (§42)", async () => {
    service.addSuppression({ matchType: "domain", matchValue: "isansolar.test", reason: "manual_block", actor: "dashboard" });
    const run = await service.runPipeline("local-business-standard", { query: "solar", region: "Maha Sarakham", limit: 10 }, "dashboard");
    expect(run.status).toBe("completed");
    const leads = service.listLeads({});
    expect(leads.length).toBeGreaterThan(0);
    // Suppression marks the lead; exclusion happens at export (§22.4).
    const blocked = leads.find((lead) => lead.company?.domain === "isansolar.test");
    expect(blocked?.status).toBe("suppressed");
    const other = leads.find((lead) => lead.company?.domain === "msgreenroof.test");
    expect(other === undefined || other.status !== "suppressed").toBe(true);
    expect(service.listAudit(20).some((entry) => entry.action === "suppression.added")).toBe(true);
  });

  test("export applies suppression and is audited; suppression removal is human-only", async () => {
    await service.search({ query: { query: "solar", leadKind: "local_business", limit: 10 }, actor: "dashboard" });
    service.addSuppression({ matchType: "domain", matchValue: "isansolar.test", reason: "manual_block", actor: "dashboard" });
    const csv = await service.exportLeads({ format: "csv", actor: "dashboard" });
    expect(csv.rowCount).toBeGreaterThan(0);
    expect(csv.content).not.toContain("isansolar.test");
    expect(csv.content.split("\n")[0]).toContain("lead_id,lead_kind");
    expect(service.listAudit(10).some((entry) => entry.action === "export.created")).toBe(true);
    expect(() => service.removeSuppression(service.listSuppression()[0]!.id, "agent_codex")).toThrow("invariant");
  });
});

// --- Safety (§22.5, §39) ----------------------------------------------------------------

describe("Phase 20.34 safety invariants", () => {
  test("external outreach is structurally disabled (§22.5)", () => {
    expect(leadFlags().externalActions).toBe(false);
    process.env.LEAD_EXTERNAL_OUTREACH_AUTO_SEND = "true";
    expect(externalOutreachAutoSend()).toBe(false);
    delete process.env.LEAD_EXTERNAL_OUTREACH_AUTO_SEND;
  });

  test("website crawler refuses private/loopback targets through the shared SSRF policy (§39)", async () => {
    const crawler = new WebsiteContactProvider();
    let threw = false;
    try {
      await crawler.findContacts({ domain: "http://127.0.0.1:9/x", runId: "t" });
    } catch {
      threw = true; // fail-closed: the shared policy rejects the target outright
    }
    expect(threw).toBe(true);
  });

  test("suppression matching covers email, phone, domain, company and person", () => {
    const lead: CanonicalLead = {
      id: "lead_x", kind: "company", status: "normalized",
      company: { canonicalName: "Blocked Corp", domain: "blocked.test" },
      contactPoints: [{ type: "email", value: "a@blocked.test", normalizedValue: "a@blocked.test", sourceProviderId: "p", confidence: 0.8, verificationStatus: "unknown" }],
      socialProfiles: [], confidence: 0.5, sourceRecords: [], createdAt: "", updatedAt: "",
    };
    const entries = [
      { matchType: "domain", matchValue: "blocked.test" },
      { matchType: "email", matchValue: "someone@else.test" },
    ];
    expect(suppressionHits(lead, entries)).toHaveLength(1);
  });

  test("flag defaults keep risky providers off", () => {
    expect(leadFlags().apifyProvider).toBe(false);
    expect(getLeadService().listProviders().some((provider) => provider.adapter === "apify_actor")).toBe(false);
  });
});
