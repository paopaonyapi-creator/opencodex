// Phase 20.20 — Apify provider adapter (spec sections 6, 9).
//
// Live mode talks to two public Apify endpoints:
//   GET  /v2/store            — actor catalog discovery (paginated, no token needed)
//   POST /v2/acts/{id}/run-sync-get-dataset-items — bounded synchronous runs
// Mock mode (the default, matching the trends subsystem) produces a deterministic
// offline catalog and runs so tests and first-run UX need no token or network.

import { getSocialConfig, type SocialIntelligenceConfig } from "./config";
import { SocialError } from "./errors";
import {
  registerSocialProvider,
  type CostEstimate,
  type DiscoveredTool,
  type DiscoverToolsInput,
  type ProviderRunInput,
  type ProviderRunOutput,
  type SocialDataProvider,
} from "./provider";
import type { PricingState } from "./types";

const STORE_BASE = "https://api.apify.com/v2";
const DISCOVERY_TIMEOUT_MS = 15_000;
const RUN_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 3;

interface StoreActor {
  name: string;
  username: string;
  title?: string;
  description?: string;
  url?: string;
  categories?: string[];
  stats?: { totalRuns?: number };
  currentPricingInfo?: {
    pricingModel?: string;
    price?: { value?: number; unitName?: string } | "FREE";
    trial?: unknown;
  };
  created_at?: string;
  modified_at?: string;
}

export interface ApifyProviderOptions {
  /** Injectable fetch for tests; defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  config?: SocialIntelligenceConfig;
}

export class ApifyProvider implements SocialDataProvider {
  readonly id = "apify";
  readonly name = "Apify";

  private readonly fetchImpl: typeof fetch;
  private readonly config: SocialIntelligenceConfig;

  constructor(options: ApifyProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.config = options.config ?? getSocialConfig();
  }

  async discoverTools(input: DiscoverToolsInput = {}): Promise<DiscoveredTool[]> {
    if (this.config.mockMode) {
      // Mock mode never touches the network. Discovery by search in mock mode
      // filters the synthetic catalog instead of issuing a live request.
      return this.mockCatalog().filter((tool) =>
        input.search
          ? `${tool.name} ${tool.title ?? ""} ${tool.description ?? ""}`.toLowerCase().includes(input.search.toLowerCase())
          : true,
      );
    }

    const pageSize = Math.min(Math.max(input.pageSize ?? 100, 10), 100);
    const maxPages = Math.min(Math.max(input.maxPages ?? 10, 1), 50);
    const tools: DiscoveredTool[] = [];

    for (let page = 0; page < maxPages; page++) {
      const url = new URL(`${STORE_BASE}/store`);
      url.searchParams.set("limit", String(pageSize));
      url.searchParams.set("offset", String(page * pageSize));
      if (input.search) url.searchParams.set("search", input.search);

      const body = await this.fetchJsonWithRetry(url, DISCOVERY_TIMEOUT_MS);
      const actors: StoreActor[] = Array.isArray(body?.data?.items) ? body.data.items : [];
      for (const actor of actors) tools.push(this.mapStoreActor(actor));
      if (actors.length < pageSize) break;
    }
    return tools;
  }

  async getTool(externalId: string): Promise<DiscoveredTool | null> {
    if (this.config.mockMode) {
      return this.mockCatalog().find((tool) => tool.externalId === externalId) ?? null;
    }
    const url = new URL(`${STORE_BASE}/acts/${encodeURIComponent(externalId)}`);
    try {
      const body = await this.fetchJsonWithRetry(url, DISCOVERY_TIMEOUT_MS);
      return body?.data ? this.mapStoreActor(body.data as StoreActor) : null;
    } catch {
      return null;
    }
  }

  async estimateCost(input: ProviderRunInput): Promise<CostEstimate> {
    const tool = await this.resolveTool(input.tool.externalId);
    if (!tool) {
      return { estimatedUsd: null, pricingState: "unknown", pricingModel: null, currency: "USD", basis: "tool not found in provider catalog" };
    }
    if (tool.pricingState === "free") {
      return { estimatedUsd: 0, pricingState: "free", pricingModel: tool.pricingModel, currency: "USD", basis: "provider lists this tool as free" };
    }
    if (tool.pricingState === "paid" && tool.estimatedUnitCost !== null) {
      const perResult = tool.pricingModel === "per_result";
      const estimatedUsd = perResult ? tool.estimatedUnitCost * input.maxItems : tool.estimatedUnitCost;
      return {
        estimatedUsd,
        pricingState: "paid",
        pricingModel: tool.pricingModel,
        currency: tool.currency ?? "USD",
        basis: perResult
          ? `provider unit price ${tool.estimatedUnitCost} per result x maxItems ${input.maxItems}`
          : `provider flat run price ${tool.estimatedUnitCost}`,
      };
    }
    return { estimatedUsd: null, pricingState: tool.pricingState, pricingModel: tool.pricingModel, currency: "USD", basis: "provider metadata carries no verifiable price" };
  }

  async run(input: ProviderRunInput): Promise<ProviderRunOutput> {
    if (this.config.mockMode) {
      return this.mockRun(input);
    }
    if (!this.config.apifyToken) {
      throw new SocialError("AUTH_MISSING", "APIFY_API_TOKEN is not configured for live Apify runs");
    }
    const url = new URL(`${STORE_BASE}/acts/${encodeURIComponent(input.tool.externalId)}/run-sync-get-dataset-items`);
    url.searchParams.set("token", this.config.apifyToken);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: input.query,
          maxItems: input.maxItems,
          ...(input.market ? { country: input.market } : {}),
        }),
        signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof SocialError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (/abort|timeout/i.test(message)) throw new SocialError("PROVIDER_TIMEOUT", message);
      throw new SocialError("TRANSIENT_NETWORK_ERROR", message);
    }

    if (response.status === 429) throw new SocialError("PROVIDER_RATE_LIMITED", "Apify rate limit reached");
    if (response.status === 401 || response.status === 403) {
      throw new SocialError("AUTH_INVALID", "Apify rejected the configured token");
    }
    if (!response.ok) {
      throw new SocialError(
        response.status >= 500 ? "PROVIDER_ERROR" : "PROVIDER_UNAVAILABLE",
        `Apify run failed with HTTP ${response.status}`,
      );
    }

    const items = (await response.json()) as Record<string, unknown>[];
    const providerRunId = `apify_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    return {
      providerRunId,
      status: "succeeded",
      items: Array.isArray(items) ? items.slice(0, input.maxItems) : [],
      // The run-sync endpoint does not report spend; actual cost stays unknown
      // rather than estimated. Usage ledger keeps the two fields separate.
      actualCostUsd: null,
      itemCount: Array.isArray(items) ? Math.min(items.length, input.maxItems) : 0,
    };
  }

  async getRunStatus(): Promise<{ status: "succeeded"; itemCount: number }> {
    // run-sync-get-dataset-items resolves before returning, so every observed run
    // is terminal. Long-running async runs arrive with the async run API in a
    // later phase.
    return { status: "succeeded", itemCount: 0 };
  }

  // --- internals -----------------------------------------------------------

  private async resolveTool(externalId: string): Promise<DiscoveredTool | null> {
    return this.getTool(externalId);
  }

  private async fetchJsonWithRetry(url: URL, timeoutMs: number, maxRetries = MAX_RETRIES): Promise<any> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
        if (response.status === 429 || response.status >= 500) {
          throw new SocialError(
            response.status === 429 ? "PROVIDER_RATE_LIMITED" : "PROVIDER_ERROR",
            `Apify store responded with HTTP ${response.status}`,
          );
        }
        if (!response.ok) {
          throw new SocialError("PROVIDER_UNAVAILABLE", `Apify store responded with HTTP ${response.status}`);
        }
        return await response.json();
      } catch (error) {
        lastError = error;
        const retryable = error instanceof SocialError
          ? error.retryable
          : !/abort|timeout/i.test(error instanceof Error ? error.message : String(error));
        if (!retryable || attempt === maxRetries) break;
        // Bounded exponential backoff: 250ms, 500ms, 1s.
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
      }
    }
    throw lastError instanceof Error ? lastError : new SocialError("PROVIDER_UNAVAILABLE", "Apify store discovery failed");
  }

  private mapStoreActor(actor: StoreActor): DiscoveredTool {
    const pricing = actor.currentPricingInfo;
    const price = pricing?.price;
    const isFree = price === "FREE" || (typeof price === "object" && price !== null && price.value === 0);
    let pricingState: PricingState = "unknown";
    let estimatedUnitCost: number | null = null;
    let pricingModel: string | null = null;
    if (pricing && price) {
      if (isFree) {
        pricingState = "free";
        pricingModel = "free";
      } else if (typeof price === "object" && typeof price.value === "number") {
        pricingState = "paid";
        estimatedUnitCost = price.value;
        pricingModel = pricing.pricingModel ?? (price.unitName === "result" ? "per_result" : "per_run");
      }
    }
    return {
      externalId: `${actor.username}/${actor.name}`,
      owner: actor.username,
      name: actor.name,
      title: actor.title ?? null,
      description: actor.description ?? null,
      url: actor.url ?? null,
      categories: Array.isArray(actor.categories) ? actor.categories : [],
      tags: [],
      verified: false,
      pricingState,
      pricingModel,
      estimatedUnitCost,
      currency: estimatedUnitCost !== null ? "USD" : null,
      externalCreatedAt: actor.created_at ?? null,
      externalModifiedAt: actor.modified_at ?? null,
    };
  }

  // --- deterministic offline simulation ------------------------------------

  private mockCatalog(): DiscoveredTool[] {
    const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
    const t = (
      externalId: string,
      name: string,
      title: string,
      description: string,
      categories: string[],
      pricing: { state: PricingState; model?: string; unit?: number },
      modifiedDaysAgo = 30,
    ): DiscoveredTool => ({
      externalId,
      owner: externalId.split("/")[0] ?? null,
      name,
      title,
      description,
      url: `https://apify.com/${externalId}`,
      categories,
      tags: [],
      verified: true,
      pricingState: pricing.state,
      pricingModel: pricing.model ?? null,
      estimatedUnitCost: pricing.unit ?? null,
      currency: pricing.unit != null ? "USD" : null,
      externalCreatedAt: at(modifiedDaysAgo + 400),
      externalModifiedAt: at(modifiedDaysAgo),
    });

    return [
      t("mock/tiktok-keyword-scraper", "tiktok-keyword-scraper", "TikTok Keyword Video Scraper", "Search TikTok videos by keyword with views, likes, comments, shares and hashtags.", ["social"], { state: "paid", model: "per_result", unit: 0.0008 }),
      t("mock/tiktok-comments-scraper", "tiktok-comments-scraper", "TikTok Comments Scraper", "Extract comments and replies from TikTok videos.", ["social"], { state: "paid", model: "per_result", unit: 0.0012 }),
      t("mock/tiktok-trending-scraper", "tiktok-trending-scraper", "TikTok Trending Explorer", "Discover trending hashtags and sounds on TikTok.", ["social"], { state: "paid", model: "per_run", unit: 0.05 }),
      t("mock/instagram-hashtag-scraper", "instagram-hashtag-scraper", "Instagram Hashtag Posts Scraper", "Scrape Instagram posts by hashtag with engagement metrics.", ["social"], { state: "paid", model: "per_result", unit: 0.0015 }),
      t("mock/youtube-keyword-scraper", "youtube-keyword-scraper", "YouTube Keyword Videos Scraper", "Search YouTube videos by keyword with channel and engagement metadata.", ["social"], { state: "paid", model: "per_result", unit: 0.0005 }),
      t("mock/youtube-transcript-scraper", "youtube-transcript-scraper", "YouTube Transcript Fetcher", "Fetch transcripts and captions for YouTube videos.", ["social"], { state: "paid", model: "per_result", unit: 0.0002 }),
      t("mock/reddit-keyword-scraper", "reddit-keyword-scraper", "Reddit Keyword Post Scraper", "Search Reddit posts and comments by keyword across subreddits.", ["social"], { state: "free" }),
      t("mock/pinterest-keyword-scraper", "pinterest-keyword-scraper", "Pinterest Keyword Pin Scraper", "Scrape Pinterest pins by keyword for visual trend research.", ["social"], { state: "paid", model: "per_result", unit: 0.001 }),
      t("mock/x-keyword-scraper", "x-keyword-scraper", "X (Twitter) Keyword Posts Scraper", "Search recent tweets and engagement metrics by keyword.", ["social"], { state: "unknown" }),
      t("mock/bluesky-keyword-scraper", "bluesky-keyword-scraper", "Bluesky Keyword Post Scraper", "Search Bluesky posts by keyword.", ["social"], { state: "free" }),
      t("mock/linkedin-public-scraper", "linkedin-public-scraper", "LinkedIn Public Page Metadata", "Fetch public LinkedIn page metadata.", ["social"], { state: "paid", model: "per_result", unit: 0.004 }),
      t("mock/telegram-public-scraper", "telegram-public-scraper", "Telegram Public Channel Messages", "Collect public Telegram channel messages by keyword.", ["social"], { state: "unknown" }),
    ];
  }

  private mockRun(input: ProviderRunInput): ProviderRunOutput {
    const platformHint = input.tool.externalId;
    const items: Record<string, unknown>[] = [];
    const count = Math.min(input.maxItems, 10);
    const slug = input.query.toLowerCase().replace(/\s+/g, "");

    for (let i = 1; i <= count; i++) {
      if (platformHint.includes("tiktok")) {
        items.push({
          id: `tt_${slug}_${i}`,
          text: `${input.query} aesthetic moment #${slug} #trending #dailyvibe`,
          author: { id: `author_${i % 3}`, name: `creator${i % 3}` },
          views: 120_000 * (11 - i),
          likes: 18_000 * (11 - i),
          commentsCount: 850 * (11 - i),
          shares: 2_400 * (11 - i),
          createTime: new Date(Date.now() - i * 86_400_000).toISOString(),
          webVideoUrl: `https://www.tiktok.com/@creator${i % 3}/video/mock_${i}`,
          lang: "en",
        });
      } else if (platformHint.includes("instagram")) {
        items.push({
          id: `ig_${slug}_${i}`,
          caption: `${input.query} visual aesthetic #${slug} #visualsoflife`,
          owner: { id: `ig_author_${i % 2}`, username: `studio${i % 2}` },
          likesCount: 4_500 * (11 - i),
          commentsCount: 140 * (11 - i),
          timestamp: new Date(Date.now() - i * 3 * 86_400_000).toISOString(),
          url: `https://www.instagram.com/p/mock_${i}/`,
        });
      } else if (platformHint.includes("youtube")) {
        items.push({
          videoId: `yt_${slug}_${i}`,
          title: `How ${input.query} is transforming modern workflows #${i}`,
          description: `Exploring ${input.query} trends, insights and professional use cases.`,
          channel: { id: `ch_${i % 2}`, name: `channel${i % 2}` },
          viewCount: 50_000 * (11 - i),
          likeCount: 2_500 * (11 - i),
          commentCount: 320 * (11 - i),
          publishedAt: new Date(Date.now() - i * 2 * 86_400_000).toISOString(),
          url: `https://www.youtube.com/watch?v=mock_${i}`,
        });
      } else if (platformHint.includes("reddit")) {
        items.push({
          id: `rd_${slug}_${i}`,
          title: `${input.query} — what actually works (discussion)`,
          selftext: `Long-form community discussion about ${input.query} with practical trade-offs.`,
          subreddit: `r/${slug}tips`,
          author: `u_redditor${i % 4}`,
          score: 900 * (11 - i),
          numComments: 65 * (11 - i),
          createdUtc: new Date(Date.now() - i * 86_400_000).toISOString(),
          url: `https://www.reddit.com/r/${slug}tips/comments/mock_${i}/`,
        });
      } else {
        items.push({
          id: `px_${slug}_${i}`,
          text: `${input.query} inspiration board item ${i} #${slug}`,
          author: { id: `px_author_${i % 2}`, name: `pinner${i % 2}` },
          views: 30_000 * (11 - i),
          likes: 900 * (11 - i),
          publishedAt: new Date(Date.now() - i * 86_400_000).toISOString(),
          url: `https://www.pinterest.com/pin/mock_${i}/`,
        });
      }
    }

    const providerRunId = `mockrun_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    return {
      providerRunId,
      status: "succeeded",
      items,
      actualCostUsd: null,
      itemCount: items.length,
    };
  }
}

let instance: ApifyProvider | null = null;

/** Idempotent registration so every entry point can call this safely. */
export function getApifySocialProvider(): ApifyProvider {
  if (!instance) {
    instance = new ApifyProvider();
    registerSocialProvider(instance);
  }
  return instance;
}
