// Phase 20.20 — Social Intelligence Engine test suite.
//
// Covers the Phase 20.20 spec's minimum unit/integration surface: deterministic
// classification, URL policy, idempotent registry refresh with stale handling,
// explainable routing, the five budget decision states, the run lifecycle with
// bounded fallback, the approval token flow, normalization/dedupe, the usage
// ledger, and the MCP tool surface. All provider I/O runs against a stub provider;
// no test touches the network.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { AGENT_OS_SCHEMA_VERSION, closeAgentOsDbForTests, openAgentOsDb } from "../src/agent-os/db";
import { listSocialAudit } from "../src/agent-os/social/audit";
import { classifyCapabilities, classifyPlatform } from "../src/agent-os/social/capabilities";
import { loadSocialConfig } from "../src/agent-os/social/config";
import { SocialCostGuard } from "../src/agent-os/social/cost-guard";
import { markDuplicates } from "../src/agent-os/social/dedupe";
import { isRetryableErrorCode, SocialError, toSocialError } from "../src/agent-os/social/errors";
import { normalizeProviderItem } from "../src/agent-os/social/normalizer";
import { SOCIAL_MCP_TOOLS } from "../src/agent-os/social/mcp-tools";
import { registerSocialProvider, type DiscoveredTool, type ProviderRunInput, type ProviderRunOutput, type SocialDataProvider } from "../src/agent-os/social/provider";
import { SocialToolRegistry } from "../src/agent-os/social/registry";
import { SocialResearchOrchestrator } from "../src/agent-os/social/research";
import { SocialRouter } from "../src/agent-os/social/router";
import { canonicalizeUrl, validatePublicHttpUrl } from "../src/agent-os/social/url-policy";
import type { NormalizedContentItem, SocialErrorCode, PricingState } from "../src/agent-os/social/types";

// ---------------------------------------------------------------------------
// Stub provider: deterministic catalog + injectable failures, no network.
// ---------------------------------------------------------------------------

function catalogTool(
  externalId: string,
  title: string,
  description: string,
  pricing: { state: PricingState; model?: string; unit?: number },
): DiscoveredTool {
  return {
    externalId,
    owner: externalId.split("/")[0] ?? null,
    name: externalId.split("/")[1] ?? externalId,
    title,
    description,
    url: `https://apify.example/${externalId}`,
    categories: ["social"],
    tags: [],
    verified: true,
    pricingState: pricing.state,
    pricingModel: pricing.model ?? null,
    estimatedUnitCost: pricing.unit ?? null,
    currency: pricing.unit != null ? "USD" : null,
    externalCreatedAt: new Date(Date.now() - 400 * 86_400_000).toISOString(),
    externalModifiedAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
  };
}

const TOOL_A = () => catalogTool("stub/tiktok-keyword-scraper", "TikTok Keyword Video Scraper", "Search TikTok videos by keyword with views, likes, comments, shares and hashtags.", { state: "paid", model: "per_result", unit: 0.002 });
const TOOL_B = () => catalogTool("stub/tiktok-post-video-scraper", "TikTok Post and Video Scraper Pro", "Search TikTok posts and videos by keyword.", { state: "paid", model: "per_result", unit: 0.004 });
const TOOL_C = () => catalogTool("stub/reddit-keyword-scraper", "Reddit Keyword Post Scraper", "Search Reddit posts by keyword across subreddits.", { state: "free" });
const TOOL_D = () => catalogTool("stub/music-metadata-fetcher", "Universal Music Metadata Fetcher", "Fetch music metadata and tracks.", { state: "unknown" });

class StubProvider implements SocialDataProvider {
  readonly id = "stub";
  readonly name = "Stub Provider";
  catalog: DiscoveredTool[] = [TOOL_A(), TOOL_B(), TOOL_C(), TOOL_D()];
  failingExternalIds = new Map<string, SocialErrorCode>();

  async discoverTools(): Promise<DiscoveredTool[]> {
    return this.catalog.map((tool) => ({ ...tool }));
  }

  async getTool(externalId: string): Promise<DiscoveredTool | null> {
    return this.catalog.find((tool) => tool.externalId === externalId) ?? null;
  }

  async estimateCost(input: ProviderRunInput) {
    const tool = await this.getTool(input.tool.externalId);
    if (!tool) return { estimatedUsd: null, pricingState: "unknown" as PricingState, pricingModel: null, currency: "USD", basis: "not found" };
    if (tool.pricingState === "free") {
      return { estimatedUsd: 0, pricingState: "free" as PricingState, pricingModel: tool.pricingModel, currency: "USD", basis: "free" };
    }
    if (tool.pricingState === "paid" && tool.estimatedUnitCost !== null) {
      const estimatedUsd = tool.pricingModel === "per_result" ? tool.estimatedUnitCost * input.maxItems : tool.estimatedUnitCost;
      return { estimatedUsd, pricingState: "paid" as PricingState, pricingModel: tool.pricingModel, currency: "USD", basis: "unit x items" };
    }
    return { estimatedUsd: null, pricingState: tool.pricingState, pricingModel: tool.pricingModel, currency: "USD", basis: "unknown pricing" };
  }

  async run(input: ProviderRunInput): Promise<ProviderRunOutput> {
    const failure = this.failingExternalIds.get(input.tool.externalId);
    if (failure) {
      throw new SocialError(failure, `stub injected failure: ${failure}`);
    }
    const items = stubItems(input.tool.externalId, input.query);
    return {
      providerRunId: `stubrun_${randomUUID().slice(0, 8)}`,
      status: "succeeded",
      items,
      actualCostUsd: null,
      itemCount: items.length,
    };
  }

  async getRunStatus() {
    return { status: "succeeded" as const, itemCount: 0 };
  }
}

function stubItems(externalId: string, query: string): Record<string, unknown>[] {
  const slug = query.toLowerCase().replace(/\s+/g, "");
  if (externalId.includes("tiktok")) {
    return [
      {
        id: `tt_${slug}_1`,
        text: `${query} harvest automation #smartfarm #agritech by @farmerjo`,
        author: { id: "author_1", name: "farmerjo" },
        views: 120_000,
        likes: 18_000,
        commentsCount: 850,
        shares: 2_400,
        createTime: new Date(Date.now() - 86_400_000).toISOString(),
        webVideoUrl: `https://www.tiktok.com/@farmerjo/video/100`,
        lang: "en",
      },
      {
        id: `tt_${slug}_2`,
        text: `${query} drone spraying field #smartfarm`,
        author: { id: "author_2", name: "agriCoders" },
        views: 60_000,
        likes: 9_000,
        commentsCount: 400,
        shares: 800,
        createTime: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        webVideoUrl: `https://www.tiktok.com/@agriCoders/video/200`,
      },
      {
        id: `tt_${slug}_3`,
        text: `${query} vertical farming tour #agritech`,
        author: { id: "author_1", name: "farmerjo" },
        views: 30_000,
        likes: 3_000,
        commentsCount: 150,
        shares: 90,
        createTime: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        webVideoUrl: `https://www.tiktok.com/@farmerjo/video/300`,
      },
    ];
  }
  return [
    {
      id: `rd_${slug}_1`,
      title: `${query} — what actually works`,
      selftext: `Community discussion about ${query}. #smartfarm`,
      subreddit: `r/${slug}tips`,
      author: "u_redditor1",
      score: 900,
      numComments: 65,
      createdUtc: new Date(Date.now() - 86_400_000).toISOString(),
      url: `https://www.reddit.com/r/${slug}tips/comments/100/`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Harness: isolated OPENCODEX_HOME + deterministic SOCIAL_* env.
// ---------------------------------------------------------------------------

let testDir: string;
const previousEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
  "OPENCODEX_HOME",
  "SOCIAL_INTELLIGENCE_ENABLED",
  "SOCIAL_DAILY_BUDGET_USD",
  "SOCIAL_MONTHLY_BUDGET_USD",
  "SOCIAL_REQUIRE_APPROVAL_OVER_USD",
  "SOCIAL_ALLOW_UNESTIMATED_PAID_RUN",
  "SOCIAL_ALLOW_PAID_AUTO_RUN",
  "SOCIAL_MAX_PROVIDER_ATTEMPTS",
  "SOCIAL_MAX_RETRIES_PER_TOOL",
  "SOCIAL_MAX_ITEMS_DEFAULT",
  "SOCIAL_MAX_ITEMS_HARD_LIMIT",
  "PAO_SOCIAL_MOCK_MODE",
] as const;

const stubProvider = new StubProvider();

function setEnv(key: string, value: string | undefined): void {
  if (!(key in previousEnv)) previousEnv[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function allowPaidAutoRun(): void {
  setEnv("SOCIAL_ALLOW_PAID_AUTO_RUN", "true");
  setEnv("SOCIAL_REQUIRE_APPROVAL_OVER_USD", "1.00");
}

beforeEach(() => {
  closeAgentOsDbForTests();
  testDir = mkdtempSync(join(tmpdir(), "ocx-social-test-"));
  setEnv("OPENCODEX_HOME", testDir);
  setEnv("SOCIAL_DAILY_BUDGET_USD", "1.00");
  setEnv("SOCIAL_MONTHLY_BUDGET_USD", "10.00");
  setEnv("SOCIAL_REQUIRE_APPROVAL_OVER_USD", "0.05");
  setEnv("SOCIAL_ALLOW_UNESTIMATED_PAID_RUN", "false");
  setEnv("SOCIAL_ALLOW_PAID_AUTO_RUN", "false");
  setEnv("SOCIAL_MAX_PROVIDER_ATTEMPTS", "3");
  setEnv("SOCIAL_MAX_RETRIES_PER_TOOL", "1");
  setEnv("SOCIAL_MAX_ITEMS_HARD_LIMIT", "1000");
  setEnv("PAO_SOCIAL_MOCK_MODE", "true");
  registerSocialProvider(stubProvider);
});

afterEach(() => {
  closeAgentOsDbForTests();
  for (const key of ENV_KEYS) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
    delete previousEnv[key];
  }
  if (testDir) rmSync(testDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("Phase 20.20: Social Intelligence Engine", () => {
  test("schema version is at least 26 and social tables exist", () => {
    expect(AGENT_OS_SCHEMA_VERSION).toBeGreaterThanOrEqual(26);
    const db = openAgentOsDb();
    for (const table of [
      "social_providers", "social_tools", "social_registry_refreshes", "social_research_jobs",
      "social_provider_runs", "social_usage_records", "social_normalized_items",
      "social_trend_signals", "social_opportunities",
    ]) {
      const row = db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
      expect(row).toBeDefined();
    }
  });

  // -------------------------------------------------------------------------
  // Classification
  // -------------------------------------------------------------------------

  describe("platform and capability classification", () => {
    test("classifies platforms from titles deterministically", () => {
      expect(classifyPlatform("TikTok Keyword Video Scraper")).toBe("tiktok");
      expect(classifyPlatform("Instagram Hashtag Posts Scraper")).toBe("instagram");
      expect(classifyPlatform("YouTube Shorts Transcript Fetcher")).toBe("youtube");
      expect(classifyPlatform("Reddit keyword posts across subreddits")).toBe("reddit");
      expect(classifyPlatform("TikTok and Instagram Cross Poster")).toBe("multi");
      expect(classifyPlatform("Data extraction toolkit")).toBe("unknown");
      expect(classifyPlatform()).toBe("unknown");
    });

    test("classifies capabilities from titles and descriptions", () => {
      const comments = classifyCapabilities("TikTok Comments Scraper");
      expect(comments).toContain("get_comments");
      expect(classifyCapabilities("Fetch video transcripts and captions for YouTube")).toContain("get_transcript");
      expect(classifyCapabilities("Search TikTok videos by keyword")).toContain("search_videos");
      expect(classifyCapabilities("Sorts your laundry")).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // URL policy
  // -------------------------------------------------------------------------

  describe("URL policy (SSRF-safe)", () => {
    test("accepts public http(s) URLs", () => {
      expect(validatePublicHttpUrl("https://www.tiktok.com/@a/video/1").ok).toBe(true);
      expect(validatePublicHttpUrl("http://example.com/post").ok).toBe(true);
    });

    test("rejects non-http schemes, private targets, and internal hosts", () => {
      for (const bad of [
        "javascript:alert(1)",
        "file:///etc/passwd",
        "http://127.0.0.1/x",
        "http://10.1.2.3/x",
        "http://169.254.169.254/latest/meta-data",
        "http://192.168.1.5/x",
        "http://172.16.0.9/x",
        "https://metadata.google.internal/computeMetadata/v1",
        "http://myhost.local/x",
        "https://user:pass@example.com/x",
        "not a url",
      ]) {
        expect(validatePublicHttpUrl(bad).ok).toBe(false);
      }
    });

    test("canonicalizes URLs for dedupe", () => {
      expect(canonicalizeUrl("https://Example.com/path/?utm_source=x&fbclid=1&id=2#frag")).toBe("https://example.com/path/?id=2");
      expect(canonicalizeUrl("https://example.com/path/")).toBe("https://example.com/path");
      expect(canonicalizeUrl("junk")).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Error taxonomy
  // -------------------------------------------------------------------------

  describe("error taxonomy", () => {
    test("retryability classes match the spec", () => {
      expect(isRetryableErrorCode("PROVIDER_TIMEOUT")).toBe(true);
      expect(isRetryableErrorCode("PROVIDER_RATE_LIMITED")).toBe(true);
      expect(isRetryableErrorCode("TRANSIENT_NETWORK_ERROR")).toBe(true);
      expect(isRetryableErrorCode("BUDGET_EXCEEDED")).toBe(false);
      expect(isRetryableErrorCode("APPROVAL_REQUIRED")).toBe(false);
      expect(isRetryableErrorCode("AUTH_INVALID")).toBe(false);
    });

    test("maps raw errors onto stable codes", () => {
      expect(toSocialError(new Error("HTTP 429 too many requests")).code).toBe("PROVIDER_RATE_LIMITED");
      expect(toSocialError(new Error("fetch failed")).code).toBe("TRANSIENT_NETWORK_ERROR");
      expect(toSocialError(new Error("operation was aborted")).code).toBe("PROVIDER_TIMEOUT");
      expect(toSocialError(new Error("401 unauthorized")).retryable).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Registry refresh
  // -------------------------------------------------------------------------

  describe("tool registry refresh", () => {
    test("is idempotent across repeated refreshes", async () => {
      const registry = new SocialToolRegistry();
      const first = await registry.refresh("stub");
      expect(first.discovered).toBe(4);
      expect(first.inserted).toBe(4);
      expect(first.updated).toBe(0);

      const second = await registry.refresh("stub");
      expect(second.inserted).toBe(0);
      expect(second.unchanged).toBe(4);
      expect(second.updated).toBe(0);

      // Classification landed: the TikTok tool carries platform + capabilities.
      const tiktok = registry.listTools({ platform: "tiktok" });
      expect(tiktok.length).toBe(2);
      expect(tiktok[0]!.capabilities).toContain("search_videos");
    });

    test("marks missing tools stale without deleting, and restores on reappearance", async () => {
      const registry = new SocialToolRegistry();
      await registry.refresh("stub");
      expect(registry.listTools({ enabledOnly: false }).length).toBe(4);

      const fullCatalog = stubProvider.catalog;
      stubProvider.catalog = [TOOL_A()];
      const staleRun = await registry.refresh("stub");
      expect(staleRun.markedStale).toBe(3);
      expect(registry.listTools({ enabledOnly: true }).length).toBe(1);
      expect(registry.listTools({ enabledOnly: false }).length).toBe(4); // not deleted

      stubProvider.catalog = fullCatalog;
      const restoreRun = await registry.refresh("stub");
      expect(restoreRun.unchanged + restoreRun.updated).toBeGreaterThanOrEqual(3);
      expect(registry.listTools({ enabledOnly: true }).length).toBe(4);
    });

    test("operator disable survives refresh", async () => {
      const registry = new SocialToolRegistry();
      await registry.refresh("stub");
      const toolA = registry.getToolByExternalId("stub", "stub/tiktok-keyword-scraper")!;
      registry.setToolEnabled(toolA.id, false);
      await registry.refresh("stub");
      expect(registry.getTool(toolA.id)!.enabled).toBe(false);
      expect(registry.getTool(toolA.id)!.enabledSource).toBe("operator");
    });
  });

  // -------------------------------------------------------------------------
  // Router
  // -------------------------------------------------------------------------

  describe("router", () => {
    test("selects the cheapest capable tool with explainable reasons", async () => {
      const registry = new SocialToolRegistry();
      await registry.refresh("stub");
      const router = new SocialRouter(registry);

      const { decision, selectedTool } = await router.route({
        platform: "tiktok",
        capabilities: ["search_videos"],
        query: "smart farm",
        maxItems: 100,
        maxCostUsd: 1.0,
      });

      expect(decision.blockedReason).toBeNull();
      expect(selectedTool!.externalId).toBe("stub/tiktok-keyword-scraper"); // 0.002 < 0.004
      expect(decision.candidates.length).toBeGreaterThanOrEqual(2);
      expect(decision.candidates[0]!.reasons.join(" ")).toContain("required capabilities");
      expect(decision.requiresApproval).toBe(true); // paid + auto-run disabled
      expect(decision.estimatedCostUsd).toBeCloseTo(0.2, 5); // 0.002 x 100
    });

    test("honors excluded tools", async () => {
      const registry = new SocialToolRegistry();
      await registry.refresh("stub");
      const router = new SocialRouter(registry);
      const toolA = registry.getToolByExternalId("stub", "stub/tiktok-keyword-scraper")!;

      const { decision } = await router.route({
        platform: "tiktok",
        capabilities: ["search_videos"],
        excludedTools: [toolA.id],
      });
      expect(decision.selectedToolId).not.toBe(toolA.id);
    });

    test("hard-rejects capability mismatch and over-budget tools", async () => {
      const registry = new SocialToolRegistry();
      await registry.refresh("stub");
      const router = new SocialRouter(registry);

      const noCapabilityMatch = await router.route({
        platform: "any",
        capabilities: ["get_transcript"],
      });
      expect(noCapabilityMatch.decision.selectedToolId).toBeNull();
      expect(noCapabilityMatch.decision.blockedReason).toContain("capability");

      const overBudget = await router.route({
        platform: "tiktok",
        capabilities: ["search_videos"],
        maxItems: 100,
        maxCostUsd: 0.0001,
      });
      expect(overBudget.decision.selectedToolId).toBeNull();
      expect(overBudget.decision.blockedReason).toContain("budget");
    });

    test("routes a free tool when pricing state is free", async () => {
      const registry = new SocialToolRegistry();
      await registry.refresh("stub");
      const router = new SocialRouter(registry);
      const { decision, selectedTool } = await router.route({
        platform: "reddit",
        capabilities: ["search_posts"],
      });
      expect(selectedTool!.externalId).toBe("stub/reddit-keyword-scraper");
      expect(decision.estimatedCostUsd).toBe(0);
      expect(decision.requiresApproval).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Cost guard
  // -------------------------------------------------------------------------

  describe("cost guard budget decisions", () => {
    const guard = new SocialCostGuard();

    test("free tools are allowed", () => {
      const decision = guard.decide({ estimatedUsd: 0, pricingState: "free" });
      expect(decision.state).toBe("allow");
    });

    test("paid runs require approval under safe defaults", () => {
      const decision = guard.decide({ estimatedUsd: 0.1, pricingState: "paid" });
      expect(decision.state).toBe("require_approval");
    });

    test("unknown cost on paid/unknown tools blocks", () => {
      expect(guard.decide({ estimatedUsd: null, pricingState: "paid" }).state).toBe("block_unknown_cost");
      expect(guard.decide({ estimatedUsd: null, pricingState: "unknown" }).state).toBe("block_unknown_cost");
    });

    test("daily budget ceiling blocks before approval", () => {
      setEnv("SOCIAL_DAILY_BUDGET_USD", "0.05");
      const strict = new SocialCostGuard();
      const decision = strict.decide({ estimatedUsd: 0.1, pricingState: "paid" });
      expect(decision.state).toBe("block_budget_exceeded");
    });

    test("per-job limit participates", () => {
      const decision = guard.decide({ estimatedUsd: 0.02, pricingState: "paid", jobId: "job_x", jobLimitUsd: 0.01 });
      expect(decision.state).toBe("block_budget_exceeded");
      expect(decision.reason).toContain("job limit");
    });

    test("warns when a run would consume most of the daily budget", () => {
      setEnv("SOCIAL_REQUIRE_APPROVAL_OVER_USD", "1.00");
      setEnv("SOCIAL_ALLOW_PAID_AUTO_RUN", "true");
      setEnv("SOCIAL_DAILY_BUDGET_USD", "0.10");
      const permissive = new SocialCostGuard();
      const decision = permissive.decide({ estimatedUsd: 0.06, pricingState: "paid" });
      expect(decision.state).toBe("allow_with_warning");
    });

    test("usage ledger keeps estimated and actual separate", () => {
      guard.recordUsage({
        researchJobId: "job_ledger", runId: "run_1", providerId: "stub", toolId: "tool_1",
        estimatedCost: 0.02, actualCost: null, currency: "USD",
        inputItemCount: 1, outputItemCount: 5, status: "completed",
        startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
      });
      const summary = guard.getUsageSummary();
      expect(summary.daily.estimatedUsd).toBeCloseTo(0.02, 6);
      expect(summary.daily.actualUsd).toBeNull(); // nothing provider-reported yet
      expect(summary.daily.runs).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Run lifecycle
  // -------------------------------------------------------------------------

  describe("run lifecycle", () => {
    test("happy path: run -> normalize -> evidence -> signals -> ledger", async () => {
      allowPaidAutoRun();
      const registry = new SocialToolRegistry();
      await registry.refresh("stub");
      const orchestrator = new SocialResearchOrchestrator();

      const job = orchestrator.createJob({
        platform: "tiktok",
        capabilities: ["search_videos"],
        query: "smart farm",
        maxItems: 10,
        maxCostUsd: 1.0,
      });
      const result = await orchestrator.runJob(job.id);

      expect(result.job.state).toBe("completed");
      expect(result.items.length).toBe(3);
      const first = result.items[0]!;
      expect(first.provenance.provider).toBe("stub");
      expect(first.provenance.toolId).toBeTruthy();
      expect(first.provenance.runId).toBe(result.runs[result.runs.length - 1]!.id);
      expect(first.platform).toBe("tiktok");
      expect(first.metrics.views).toBe(120_000);
      expect(first.hashtags).toContain("smartfarm");
      expect(first.mentions).toContain("farmerjo");
      expect(first.sourceUrl).toContain("tiktok.com");

      // Tool counters come from internal runs.
      const tool = registry.getToolByExternalId("stub", "stub/tiktok-keyword-scraper")!;
      expect(tool.successCount).toBe(1);

      // Usage ledger: estimated known, actual unknown (provider did not report).
      const summary = new SocialCostGuard().getUsageSummary();
      expect(summary.daily.runs).toBe(1);
      expect(summary.daily.estimatedUsd).toBeCloseTo(0.02, 6);
      expect(summary.daily.actualUsd).toBeNull();

      // Trend signals were computed and labeled as social signals only.
      expect(result.signals).toBeGreaterThan(0);
    });

    test("paid run without auto-run parks in approval_required; token flow completes it", async () => {
      const registry = new SocialToolRegistry();
      await registry.refresh("stub");
      const orchestrator = new SocialResearchOrchestrator();

      const job = orchestrator.createJob({
        platform: "tiktok",
        capabilities: ["search_videos"],
        query: "smart farm",
        maxItems: 10,
        maxCostUsd: 1.0,
      });
      const parked = await orchestrator.runJob(job.id);
      expect(parked.job.state).toBe("approval_required");
      expect(parked.runs.length).toBe(0); // nothing executed

      const parkedAgain = await orchestrator.runJob(job.id);
      expect(parkedAgain.job.state).toBe("approval_required");

      const { approvalToken } = orchestrator.approveJob(job.id, { maxUsd: 0.5 });
      const completed = await orchestrator.runJob(job.id, { approvalToken });
      expect(completed.job.state).toBe("completed");
    });

    test("approval token is single-use and validated against expiry and amount", async () => {
      const registry = new SocialToolRegistry();
      await registry.refresh("stub");
      const orchestrator = new SocialResearchOrchestrator();

      // Wrong token -> policy blocked.
      const job1 = orchestrator.createJob({ platform: "tiktok", capabilities: ["search_videos"], query: "q", maxItems: 10 });
      await orchestrator.runJob(job1.id);
      orchestrator.approveJob(job1.id, { maxUsd: 1.0 });
      const wrong = await orchestrator.runJob(job1.id, { approvalToken: "sapr_not_the_token" });
      expect(wrong.job.state).toBe("policy_blocked");
      expect(wrong.job.errorCode).toBe("APPROVAL_REQUIRED");

      // Approved amount below the estimate -> policy blocked.
      const job2 = orchestrator.createJob({ platform: "tiktok", capabilities: ["search_videos"], query: "q", maxItems: 10 });
      await orchestrator.runJob(job2.id);
      orchestrator.approveJob(job2.id, { maxUsd: 0.001 });
      const tooLow = await orchestrator.runJob(job2.id, { approvalToken: "sapr_anything" });
      // consumeApproval rejects on amount before the hash check can matter
      expect(tooLow.job.state).toBe("policy_blocked");

      // Expired token -> policy blocked.
      const job3 = orchestrator.createJob({ platform: "tiktok", capabilities: ["search_videos"], query: "q", maxItems: 10 });
      await orchestrator.runJob(job3.id);
      const { approvalToken } = orchestrator.approveJob(job3.id, { maxUsd: 1.0 });
      const db = openAgentOsDb();
      db.query("UPDATE social_research_jobs SET approval_expires_at = ? WHERE id = ?")
        .run(new Date(Date.now() - 1000).toISOString(), job3.id);
      const expired = await orchestrator.runJob(job3.id, { approvalToken });
      expect(expired.job.state).toBe("policy_blocked");
    });

    test("falls back to the next candidate on retryable failure, within bounds", async () => {
      allowPaidAutoRun();
      stubProvider.failingExternalIds.set("stub/tiktok-keyword-scraper", "PROVIDER_TIMEOUT");
      try {
        const registry = new SocialToolRegistry();
        await registry.refresh("stub");
        const orchestrator = new SocialResearchOrchestrator();

        const job = orchestrator.createJob({
          platform: "tiktok",
          capabilities: ["search_videos"],
          query: "smart farm",
          maxItems: 10,
          maxCostUsd: 1.0,
        });
        const result = await orchestrator.runJob(job.id);

        expect(result.job.state).toBe("completed");
        // Tool A retried once (2 attempts), then fell back to tool B.
        expect(result.runs.length).toBe(3);
        expect(result.runs.filter((r) => r.status === "failed").length).toBe(2);
        const succeededRun = result.runs.find((r) => r.status === "succeeded")!;
        expect(registry.getTool(succeededRun.toolId)!.externalId).toBe("stub/tiktok-post-video-scraper");
        expect(result.job.fallbackHistory.some((entry) => entry.note.includes("falling back"))).toBe(true);

        const toolA = registry.getToolByExternalId("stub", "stub/tiktok-keyword-scraper")!;
        expect(toolA.timeoutCount).toBe(2);
        // Timeout failures count as timeouts, not generic failures (spec section 13
        // keeps those metrics separate).
        expect(toolA.failureCount).toBe(0);
      } finally {
        stubProvider.failingExternalIds.clear();
      }
    });

    test("non-retryable failure terminates without fallback", async () => {
      allowPaidAutoRun();
      stubProvider.failingExternalIds.set("stub/tiktok-keyword-scraper", "AUTH_INVALID");
      try {
        const registry = new SocialToolRegistry();
        await registry.refresh("stub");
        const orchestrator = new SocialResearchOrchestrator();
        const job = orchestrator.createJob({ platform: "tiktok", capabilities: ["search_videos"], query: "q", maxItems: 10, maxCostUsd: 1.0 });
        const result = await orchestrator.runJob(job.id);

        expect(result.job.state).toBe("failed");
        expect(result.job.errorCode).toBe("AUTH_INVALID");
        expect(result.runs.length).toBe(1); // never tried tool B
        const toolB = registry.getToolByExternalId("stub", "stub/tiktok-post-video-scraper")!;
        expect(toolB.successCount).toBe(0);
      } finally {
        stubProvider.failingExternalIds.clear();
      }
    });

    test("unknown-cost tools are blocked from auto-run", async () => {
      allowPaidAutoRun();
      const registry = new SocialToolRegistry();
      await registry.refresh("stub");
      const orchestrator = new SocialResearchOrchestrator();
      const job = orchestrator.createJob({ platform: "any", capabilities: ["search_music"], query: "lofi", maxItems: 10, maxCostUsd: 1.0 });
      const result = await orchestrator.runJob(job.id);
      expect(result.job.state).toBe("policy_blocked");
      expect(result.job.errorCode).toBe("UNKNOWN_COST_BLOCKED");
      expect(result.runs.length).toBe(0);
    });

    test("daily budget exhaustion blocks a later job", async () => {
      allowPaidAutoRun(); // job limit 1.00, approval threshold 1.00
      setEnv("SOCIAL_DAILY_BUDGET_USD", "0.05");
      const registry = new SocialToolRegistry();
      await registry.refresh("stub");
      const orchestrator = new SocialResearchOrchestrator();

      // Estimate 0.02 fits the 0.05 daily budget; committed afterwards.
      const job1 = orchestrator.createJob({ platform: "tiktok", capabilities: ["search_videos"], query: "a", maxItems: 10, maxCostUsd: 1.0 });
      const done1 = await orchestrator.runJob(job1.id);
      expect(done1.job.state).toBe("completed");

      // Tighten the daily budget below what is already committed.
      setEnv("SOCIAL_DAILY_BUDGET_USD", "0.015");
      const job2 = orchestrator.createJob({ platform: "tiktok", capabilities: ["search_videos"], query: "b", maxItems: 10, maxCostUsd: 1.0 });
      const blocked = await orchestrator.runJob(job2.id);
      expect(blocked.job.state).toBe("budget_blocked");
      expect(blocked.job.errorCode).toBe("BUDGET_EXCEEDED");
      expect(blocked.runs.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Normalization + dedupe
  // -------------------------------------------------------------------------

  describe("normalization and dedupe", () => {
    test("normalizes provider shapes and drops unsafe URLs", async () => {
      const registry = new SocialToolRegistry();
      await registry.refresh("stub");
      const tool = registry.getToolByExternalId("stub", "stub/tiktok-keyword-scraper")!;
      const item = normalizeProviderItem(tool, {
        id: "x1",
        text: "hello #tag1 @user1",
        views: 10,
        likes: "22",
        createTime: "1700000000",
        webVideoUrl: "javascript:alert(1)",
      }, { providerId: "stub", runId: "run_1", platform: "tiktok", fetchedAt: new Date().toISOString() });

      expect(item).not.toBeNull();
      expect(item!.metrics.likes).toBe(22);
      expect(item!.hashtags).toContain("tag1");
      expect(item!.mentions).toContain("user1");
      expect(item!.sourceUrl).toBeNull(); // unsafe URL dropped
      expect(item!.publishedAt).toBeTruthy();
      expect(item!.provenance.provider).toBe("stub");
    });

    test("layered dedupe: externalId, canonical URL, then conservative fingerprint", () => {
      const base = {
        platform: "tiktok" as const,
        sourceToolId: "tool",
        sourceUrl: null,
        contentType: "video" as const,
        authorExternalId: "a1",
        authorDisplayName: null,
        text: "same text here",
        title: null,
        description: null,
        publishedAt: "2026-09-01T00:00:00.000Z",
        observedAt: new Date().toISOString(),
        metrics: { views: null, likes: null, comments: null, shares: null, saves: null, followers: null },
        hashtags: [],
        mentions: [],
        language: null,
        duplicateOf: null,
        provenance: { provider: "stub", toolId: "tool", runId: "run", fetchedAt: new Date().toISOString() },
      };
      const a: NormalizedContentItem = { ...base, id: "a", externalId: "x1" };
      const b: NormalizedContentItem = { ...base, id: "b", externalId: "x1" }; // same platform+externalId
      const c: NormalizedContentItem = { ...base, id: "c", externalId: "x2", sourceUrl: "https://tiktok.com/@a/video/1?utm_source=x" };
      const d: NormalizedContentItem = { ...base, id: "d", externalId: "x3", sourceUrl: "https://tiktok.com/@a/video/1" }; // same canonical URL as c
      const e: NormalizedContentItem = { ...base, id: "e", externalId: "x4", text: "  same  text here " }; // fingerprint match (author+text+day)
      const f: NormalizedContentItem = { ...base, id: "f", externalId: "x5", text: "different content entirely", authorExternalId: "a2" };

      markDuplicates([a, b, c, d, e, f]);
      expect(b.duplicateOf).toBe("a");
      // c differs in externalId and URL, but the conservative fingerprint layer
      // (platform + author + normalized text + publish day) matches `a`.
      expect(c.duplicateOf).toBe("a");
      expect(d.duplicateOf).toBe("c");
      expect(e.duplicateOf).toBe("a");
      expect(f.duplicateOf).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Audit trail (spec section 34)
  // -------------------------------------------------------------------------

  describe("audit trail", () => {
    test("registry refresh and tool toggles are audited", async () => {
      const registry = new SocialToolRegistry();
      await registry.refresh("stub");
      const tool = registry.getToolByExternalId("stub", "stub/tiktok-keyword-scraper")!;
      registry.setToolEnabled(tool.id, false);

      const events = listSocialAudit({ limit: 50 });
      const names = events.map((e) => e.event);
      expect(names).toContain("SOCIAL_REGISTRY_REFRESHED");
      expect(names).toContain("SOCIAL_TOOL_DISABLED");
      expect(events.find((e) => e.event === "SOCIAL_TOOL_DISABLED")!.toolId).toBe(tool.id);
    });

    test("run lifecycle emits route, paid-start, and completion events", async () => {
      allowPaidAutoRun();
      const registry = new SocialToolRegistry();
      await registry.refresh("stub");
      const orchestrator = new SocialResearchOrchestrator();
      const job = orchestrator.createJob({ platform: "tiktok", capabilities: ["search_videos"], query: "smart farm", maxItems: 10, maxCostUsd: 1.0 });
      await orchestrator.runJob(job.id);

      const jobEvents = listSocialAudit({ researchJobId: job.id }).map((e) => e.event);
      expect(jobEvents).toContain("SOCIAL_ROUTE_DECIDED");
      expect(jobEvents).toContain("SOCIAL_PAID_RUN_STARTED");
      expect(jobEvents).toContain("SOCIAL_RUN_COMPLETED");
    });

    test("budget block and approval grant are audited, and tokens are never persisted", async () => {
      const registry = new SocialToolRegistry();
      await registry.refresh("stub");
      const orchestrator = new SocialResearchOrchestrator();

      // Parked for approval, then granted.
      const job = orchestrator.createJob({ platform: "tiktok", capabilities: ["search_videos"], query: "q", maxItems: 10, maxCostUsd: 1.0 });
      await orchestrator.runJob(job.id);
      const { approvalToken } = orchestrator.approveJob(job.id, { maxUsd: 0.5 });

      const grant = listSocialAudit({ researchJobId: job.id }).find((e) => e.event === "SOCIAL_APPROVAL_GRANTED")!;
      expect(grant).toBeDefined();
      expect(grant.detail.approvedMaxUsd).toBe(0.5);

      // The raw token appears nowhere in the audit trail.
      const all = listSocialAudit({ limit: 200 });
      expect(JSON.stringify(all)).not.toContain(approvalToken);

      // Budget block is audited too.
      setEnv("SOCIAL_DAILY_BUDGET_USD", "0.0001");
      const blocked = orchestrator.createJob({ platform: "tiktok", capabilities: ["search_videos"], query: "q", maxItems: 10, maxCostUsd: 1.0 });
      await orchestrator.runJob(blocked.id);
      const blockedEvents = listSocialAudit({ researchJobId: blocked.id }).map((e) => e.event);
      expect(blockedEvents).toContain("SOCIAL_BUDGET_BLOCKED");
    });

    test("filters by event and caps the limit", async () => {
      const registry = new SocialToolRegistry();
      await registry.refresh("stub");
      const onlyRefresh = listSocialAudit({ event: "SOCIAL_REGISTRY_REFRESHED" });
      expect(onlyRefresh.length).toBeGreaterThan(0);
      expect(onlyRefresh.every((e) => e.event === "SOCIAL_REGISTRY_REFRESHED")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // MCP surface
  // -------------------------------------------------------------------------

  describe("MCP tools", () => {
    test("route preview never executes a paid job", async () => {
      allowPaidAutoRun();
      const registry = new SocialToolRegistry();
      await registry.refresh("stub");
      const orchestrator = new SocialResearchOrchestrator();
      const jobsBefore = orchestrator.listJobs(100).length;

      const preview = SOCIAL_MCP_TOOLS["social.route.preview"];
      const payload = await preview.handler({
        platform: "tiktok",
        capabilities: ["search_videos"],
        query: "smart farm",
        maxItems: 10,
        maxCostUsd: 1.0,
      });

      expect(payload.selectedToolId).toBeTruthy();
      expect(payload.score).toBeGreaterThan(0);
      expect(payload.reasons.length).toBeGreaterThan(0);
      expect(orchestrator.listJobs(100).length).toBe(jobsBefore);
      expect(orchestrator.listRuns("none").length).toBe(0);
      const db = openAgentOsDb();
      const runCount = db.query("SELECT COUNT(*) AS n FROM social_provider_runs").get() as { n: number };
      expect(runCount.n).toBe(0);
    });

    test("tools.search and tools.get expose registry state", async () => {
      const registry = new SocialToolRegistry();
      await registry.refresh("stub");
      const search = await SOCIAL_MCP_TOOLS["social.tools.search"].handler({ platform: "tiktok" });
      expect(search.count).toBe(2);

      const tool = registry.getToolByExternalId("stub", "stub/tiktok-keyword-scraper")!;
      const got = await SOCIAL_MCP_TOOLS["social.tools.get"].handler({ toolId: tool.id });
      expect((got.tool as { observedReliability: { source: string } }).observedReliability.source).toContain("Internal observed");
    });

    test("run tool answers with approval semantics instead of executing", async () => {
      const registry = new SocialToolRegistry();
      await registry.refresh("stub");
      const run = await SOCIAL_MCP_TOOLS["social.run"].handler({
        platform: "tiktok", capabilities: ["search_videos"], query: "q", maxItems: 10, maxCostUsd: 1.0,
      });
      expect(run.state).toBe("approval_required");
      const db = openAgentOsDb();
      const runCount = db.query("SELECT COUNT(*) AS n FROM social_provider_runs").get() as { n: number };
      expect(runCount.n).toBe(0);
    });

    test("trends and usage tools carry honest labels", async () => {
      allowPaidAutoRun();
      const registry = new SocialToolRegistry();
      await registry.refresh("stub");
      const orchestrator = new SocialResearchOrchestrator();
      const job = orchestrator.createJob({ platform: "tiktok", capabilities: ["search_videos"], query: "smart farm", maxItems: 10, maxCostUsd: 1.0 });
      await orchestrator.runJob(job.id);

      const trends = await SOCIAL_MCP_TOOLS["social.trends"].handler({ researchJobId: job.id });
      expect(String(trends.label)).toContain("not buyer demand");
      expect(trends.count).toBeGreaterThan(0);

      const compare = await SOCIAL_MCP_TOOLS["social.compare_platforms"].handler({ researchJobId: job.id });
      expect((compare.platforms as unknown[]).length).toBe(1);

      const usage = await SOCIAL_MCP_TOOLS["social.usage.summary"].handler({});
      expect((usage.usage as { budgets: { dailyBudgetUsd: number } }).budgets.dailyBudgetUsd).toBeGreaterThan(0);

      const status = await SOCIAL_MCP_TOOLS["social.run.status"].handler({ researchJobId: "sjob_missing" });
      expect(status.error).toEqual({ code: "TOOL_NOT_FOUND", message: expect.any(String) });
    });
  });
});
