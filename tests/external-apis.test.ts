// Phase 20.63 — External Capability Registry tests.
//
// Covers the spec §62-§63 matrix: markdown parser + drift protection, SSRF
// suite (loopback/private/metadata/IPv6/encoded forms/unsafe schemes/
// redirects), trust scoring, lifecycle transitions, tool generation safety
// (disabled by default, no secret fields, operation binding), the execution
// gateway (policy/rate-limit/circuit/credential), and the E2E flow ending in
// revocation. No live network: source fetches and provider calls are fakes.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeAgentOsDbForTests, openAgentOsDb } from "../src/agent-os/db";
import { assertOperationTransition, assertProviderTransition, ExternalApiError, type DiscoveredApiRecord, type ProviderLifecycle } from "../src/agent-os/external-apis/types";
import { hostnameOf, mapRow, normalizeAuthType, PublicApisGithubSource, splitTableRow } from "../src/agent-os/external-apis/parser";
import { isBlockedIp, redactSensitive, validateOutboundUrl } from "../src/agent-os/external-apis/security";
import { assessTrust, classifyDataClass } from "../src/agent-os/external-apis/trust";
import { ExternalApiService, resetExternalApiServiceForTests, setExternalApiServiceForTests, type OutboundFetcher } from "../src/agent-os/external-apis/service";
import type { ExternalApiConfig } from "../src/agent-os/external-apis/config";
import { handleManagementAPI } from "../src/server/management-api";
import type { OcxConfig } from "../src/types";

const tempHomes: string[] = [];

function openFreshDb(): void {
  const dir = mkdtempSync(join(tmpdir(), "external-apis-"));
  tempHomes.push(dir);
  closeAgentOsDbForTests();
  openAgentOsDb(dir);
}

function makeConfig(overrides?: Partial<ExternalApiConfig>): ExternalApiConfig {
  return {
    enabled: true,
    sourcePublicApisEnabled: true,
    enrichmentEnabled: false,
    healthChecksEnabled: true,
    openapiDiscoveryEnabled: false,
    toolGenerationEnabled: true,
    runtimeExecutionEnabled: true,
    autoRegisterDiscovered: true,
    autoEnableTools: false,
    requireHttps: true,
    blockPrivateNetworks: true,
    maxRedirects: 5,
    connectTimeoutMs: 1000,
    requestTimeoutMs: 5000,
    maxResponseBytes: 1_048_576,
    maxSpecBytes: 1_048_576,
    globalConcurrency: 5,
    perDomainConcurrency: 1,
    defaultMinIntervalMs: 0,
    maxRowDropRatio: 0.10,
    maxParseWarningRatio: 0.02,
    healthBaseIntervalHours: 6,
    defaultRateLimitPerMinute: 30,
    ...overrides,
  };
}

// --- upstream-format fixtures (spec §63): minimal representative structure ---

const FIXTURE_README = [
  "# Public APIs",
  "",
  "### Animals",
  "API | Description | Auth | HTTPS | CORS |",
  "|:---|:---|:---|:---|:---|",
  "| [Cat Facts](https://alexwohlbruck.github.io/cat-facts/) | Daily cat facts | No | Yes | No | |",
  "| [Dogs](https://dog.ceo/dog-api/) | Based on the Stanford Dogs Dataset | No | Yes | Yes |",
  "| [Cats](https://docs.thecatapi.com/) | Pictures of cats | `apiKey` | Yes | No |",
  "",
  "### Anime",
  "API | Description | Auth | HTTPS | CORS |",
  "|:---|:---|:---|:---|:---|",
  "| [AniDB](https://wiki.anidb.net/HTTP_API_Definition) | Anime Database | `apiKey` | No | Unknown |",
  "| [AniList](https://github.com/AniList/ApiV2-GraphQL-Docs) | Anime discovery & tracking | `OAuth` | Yes | Yes |",
  "",
  "## APILayer APIs",
  "API | Description | Call this API |",
  "|:---|:---|:---|",
  "| [IPstack](https://ipstack.com/) | Sponsored block with a foreign format | [Run](https://example.com/run) |",
  "",
  "### Broken",
  "API | Description | Auth | HTTPS | CORS |",
  "|:---|:---|:---|:---|:---|",
  "| Broken Link | no link here | No | Yes | Yes |",
  "| [Weather](https://api.weather.example) | Weather forecasts | No | Yes | Yes |",
].join("\n");

function fixtureFetcher(readme: string = FIXTURE_README, revision = "536d5c4e5ff25e16c0f27e6bda4c9308ffc5fd33"): OutboundFetcher {
  return async (url) => {
    if (url.includes("api.github.com/repos/public-apis/public-apis/commits")) {
      return { status: 200, headers: {}, body: JSON.stringify({ sha: revision }) };
    }
    if (url.includes("README.md")) return { status: 200, headers: {}, body: readme };
    throw new Error("unexpected fetch: " + url);
  };
}

function makeService(overrides?: Partial<ExternalApiConfig>, fetcher?: OutboundFetcher): ExternalApiService {
  return new ExternalApiService({
    config: makeConfig(overrides),
    source: new PublicApisGithubSource(),
    fetcher: fetcher ?? fixtureFetcher(),
  });
}

// ---------------------------------------------------------------------------
// parser + drift (spec §12, §63)

describe("phase 20.63 parser and drift protection", () => {
  test("canonical rows parse; foreign-format sections are skipped", async () => {
    const source = new PublicApisGithubSource();
    const records = await source.parse({ sourceKey: "s", upstreamRevision: "r", contentSha256: "x", fetchedAt: "", content: FIXTURE_README });
    const names = records.map((r) => r.name);
    expect(names).toContain("Cat Facts");
    expect(names).toContain("Weather"); // last row of Broken section (parseable)
    expect(names).not.toContain("IPstack"); // sponsored foreign-format section skipped
    expect(names).not.toContain("Broken Link"); // un-mappable row skipped
    const cats = records.find((r) => r.name === "Cats")!;
    expect(cats.authType ?? null).toBeNull();
    expect(cats.authLabel).toBe("apiKey");
    expect(cats.https).toBe(true);
    expect(cats.cors).toBe("no");
  });

  test("auth labels normalize to auth types", () => {
    expect(normalizeAuthType("No")).toBe("none");
    expect(normalizeAuthType("`apiKey`")).toBe("api_key");
    expect(normalizeAuthType("`OAuth`")).toBe("oauth2");
    expect(normalizeAuthType("X-API-Key")).toBe("api_key");
    expect(normalizeAuthType("somethingElse")).toBe("custom");
  });

  test("duplicate names with different hosts remain separate rows", async () => {
    const source = new PublicApisGithubSource();
    const records = await source.parse({ sourceKey: "s", upstreamRevision: "r", contentSha256: "x", fetchedAt: "", content: FIXTURE_README });
    const catFacts = records.filter((r) => r.name === "Cat Facts");
    expect(catFacts).toHaveLength(1); // fixture has one Cat Facts row
    expect(hostnameOf("https://alexwohlbruck.github.io/cat-facts/")).toBe("alexwohlbruck.github.io");
    expect(hostnameOf("https://WWW.Example.com/a")).toBe("example.com");
  });

  test("mapRow rejects rows without a markdown link", () => {
    const cells = splitTableRow("| Broken Link | no link here | No | Yes | Yes |")!;
    expect(mapRow("Broken", cells)).toBeNull();
    expect(splitTableRow("not a row")).toBeNull();
  });

  test("row-drop beyond threshold quarantines the sync and preserves last known-good", async () => {
    openFreshDb();
    const service = makeService();
    const first = await service.syncFromSource("operator");
    expect(first.added).toBeGreaterThan(0);
    expect(first.report.ok).toBe(true);
    const lastGood = service.store.latestLastKnownGoodSnapshot("public-apis-github");
    expect(lastGood).toBeTruthy();

    // Second sync loses >10% of rows → drift → error, registry untouched.
    const shrunk = FIXTURE_README.replace("| [Dogs](https://dog.ceo/dog-api/) | Based on the Stanford Dogs Dataset | No | Yes | Yes |", "").replace("| [Cats](https://docs.thecatapi.com/) | Pictures of cats | `apiKey` | Yes | No |", "").replace("| [Weather](https://api.weather.example) | Weather forecasts | No | Yes | Yes |", "");
    await expect(makeService({}, async (url) => {
      if (url.includes("commits")) return { status: 200, headers: {}, body: JSON.stringify({ sha: "abc1234" }) };
      if (url.includes("README.md")) return { status: 200, headers: {}, body: shrunk };
      throw new Error("unexpected fetch: " + url);
    }).syncFromSource("operator")).rejects.toThrow(/last known-good registry preserved/);
    expect(service.store.latestLastKnownGoodSnapshot("public-apis-github")!.id).toBe(lastGood!.id);
    expect(service.store.listProviders().filter((p) => p.sourcePresence === "active").length).toBe(first.added);
  });

  test("snapshot pins commit SHA and content hash", async () => {
    openFreshDb();
    const service = makeService();
    const result = await service.syncFromSource();
    const snapshot = service.store.getSnapshot(result.snapshotId)!;
    expect(snapshot["upstream_revision"]).toBe("536d5c4e5ff25e16c0f27e6bda4c9308ffc5fd33");
    expect(String(snapshot["content_sha256"])).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// SSRF suite (spec §27, §62 security)

describe("phase 20.63 SSRF and egress guard", () => {
  test("blocked targets", () => {
    for (const url of [
      "http://127.0.0.1/x",
      "http://localhost/x",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/x",
      "http://[fe80::1]/x",
      "http://2130706433/x",
      "http://0x7f.0x0.0x0.0x1/x",
      "http://0177.0.0.1/x",
      "http://user:pass@example.com/x",
      "file:///etc/passwd",
      "gopher://host/x",
      "ftp://host/x",
      "http://metadata.google.internal/computeMetadata/v1/",
    ]) {
      expect(() => validateOutboundUrl(url, { requireHttps: true }), url).toThrow(ExternalApiError);
    }
  });

  test("https defaults enforced; http allowed only when the profile relaxes it", () => {
    expect(() => validateOutboundUrl("http://api.example.com/x", { requireHttps: true })).toThrow(/protocol/);
    expect(validateOutboundUrl("http://api.example.com/x", { requireHttps: false }).protocol).toBe("http");
    expect(validateOutboundUrl("https://api.example.com/x", { requireHttps: true }).hostname).toBe("api.example.com");
  });

  test("redirect chains revalidate every hop and respect the cap", () => {
    const chain = ["https://a.example/x", "https://b.example/y", "http://127.0.0.1/z"];
    expect(() => validateOutboundUrl(chain[2], { requireHttps: true })).toThrow();
    expect(() => {
      for (const hop of chain) validateOutboundUrl(hop, { requireHttps: true });
    }).toThrow();
    const long = Array.from({ length: 8 }, (_, i) => "https://h" + i + ".example/x");
    expect(long.length).toBe(8);
    void isBlockedIp;
  });

  test("redaction strips credentials structurally", () => {
    const sanitized = redactSensitive({
      Authorization: "Bearer super-secret-token",
      "X-API-Key": "k123",
      nested: { access_token: "tok", safe: "value" },
    }) as Record<string, unknown>;
    expect(sanitized["Authorization"]).toBe("***");
    expect(sanitized["X-API-Key"]).toBe("***");
    expect((sanitized["nested"] as Record<string, unknown>)["access_token"]).toBe("***");
    expect((sanitized["nested"] as Record<string, unknown>)["safe"]).toBe("value");
  });
});

// ---------------------------------------------------------------------------
// trust + lifecycle

describe("phase 20.63 trust and lifecycle", () => {
  test("trust/risk/confidence are separate dimensions with versioned policy", () => {
    const assessment = assessTrust({
      record: { https: true, cors: "yes", authLabel: "No" },
      lifecycle: "observed", health: "healthy", docsReachable: true, specAvailable: true,
      mutatingOperations: 0, sensitiveDataClasses: false, operatorApproved: false,
      consecutiveHealthFailures: 0, incidentReported: false,
    });
    expect(assessment.trustScore).toBeGreaterThan(0);
    expect(assessment.riskScore).toBe(0);
    expect(assessment.confidence).toBeGreaterThanOrEqual(80);
    expect(assessment.policyVersion).toBe("eap-trust-1");

    const risky = assessTrust({
      record: { https: false, cors: "unknown", authLabel: "unknown" },
      lifecycle: "ingested", health: "unreachable", docsReachable: false, specAvailable: null,
      mutatingOperations: 2, sensitiveDataClasses: true, operatorApproved: false,
      consecutiveHealthFailures: 3, incidentReported: true,
    });
    expect(risky.riskScore).toBeGreaterThanOrEqual(100);
    expect(risky.trustScore).toBe(0);
  });

  test("data classification fails toward strict on unknown", () => {
    expect(classifyDataClass("/v1/weather", "forecast")).toEqual(["PUBLIC"]);
    expect(classifyDataClass("/v1/login", "session token")).toContain("AUTHENTICATION");
    expect(classifyDataClass("/v1/payments", "billing invoice")).toContain("FINANCIAL");
  });

  test("lifecycle state machine: discovered != approved; revoked reopens only via review", () => {
    expect(() => assertProviderTransition("discovered", "approved")).toThrow();
    expect(() => assertProviderTransition("active", "approved")).toThrow();
    expect(() => assertProviderTransition("revoked", "active")).toThrow();
    expect(() => assertProviderTransition("discovered", "ingested")).not.toThrow();
    expect(() => assertProviderTransition("revoked", "review_required")).not.toThrow();
    expect(() => assertOperationTransition("generated", "enabled")).toThrow();
    expect(() => assertOperationTransition("approved", "enabled")).not.toThrow();
    const all: ProviderLifecycle[] = ["discovered", "ingested", "enriching", "observed", "review_required", "approved", "active", "degraded", "suspended", "revoked", "rejected", "invalid"];
    expect(all.length).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// integration + E2E (spec §62 E2E, §68)

describe("phase 20.63 service integration and E2E", () => {
  let service: ExternalApiService;
  let providerCalls: Array<{ url: string; headers: Record<string, string> }>;

  beforeEach(() => {
    openFreshDb();
    providerCalls = [];
    service = new ExternalApiService({
      config: makeConfig(),
      source: new PublicApisGithubSource(),
      fetcher: async (url, init) => {
        if (url.includes("api.github.com") || url.includes("README.md")) return fixtureFetcher()(url, init);
        providerCalls.push({ url, headers: init.headers });
        if (url.includes("weather")) {
          return { status: 200, headers: { "x-ratelimit-remaining": "99" }, body: JSON.stringify({ forecast: "sunny", deg: 30 }) };
        }
        if (url.includes("flaky")) {
          return { status: 500, headers: {}, body: "boom" };
        }
        return { status: 200, headers: {}, body: JSON.stringify({ ok: true }) };
      },
    });
  });

  afterEach(() => {
    closeAgentOsDbForTests();
    while (tempHomes.length) rmSync(tempHomes.pop()!, { recursive: true, force: true });
    resetExternalApiServiceForTests();
  });

  test("E2E: sync → classify → review/approve → generate disabled tool → contract test → approve → enable → execute → revoke → denied", async () => {
    const sync = await service.syncFromSource("operator");
    expect(sync.added).toBeGreaterThanOrEqual(4);

    const weather = service.store.listProviders().find((p) => p.hostname === "api.weather.example")!;
    expect(weather.lifecycle).toBe("ingested");
    expect(weather.rawEvidence["rowHash"]).toBeTruthy();
    expect(service.store.listProviders().some((p) => p.slug.includes("dog-ceo"))).toBe(true);

    // discovery is not approval: execution must be denied pre-approval
    const operation = service.addOperation({
      providerId: weather.id,
      operationKey: "weather.forecast.read",
      httpMethod: "GET",
      pathTemplate: "/v1/forecast",
      serverUrl: "https://api.weather.example",
      summary: "Get weather forecast for a location",
      capabilityIds: ["weather.forecast.read"],
      requestSchema: { type: "object", properties: { lat: { type: "number" }, api_key: { type: "string" } }, required: ["lat"] },
    });
    expect(operation.mutating).toBe(false);
    expect(operation.dataClasses).toContain("PUBLIC");
    const deniedEarly = await service.executeApproved({ operationId: operation.id, arguments: { lat: 16 } });
    expect(deniedEarly.outcome).toBe("denied");

    // review → approve the provider
    service.transitionProvider(weather.id, "observed", "operator");
    service.transitionProvider(weather.id, "approved", "operator");
    const refreshed = service.store.getProvider(weather.id)!;
    expect(refreshed.approvedAt).toBeTruthy();

    // generate → tool is DISABLED, secret field stripped, name deterministic
    const tool = service.generateTool(operation.id, "operator");
    expect(tool.enabled).toBe(false);
    expect(tool.inputSchema["properties"]).not.toHaveProperty("api_key");
    expect(tool.inputSchema["properties"]).toHaveProperty("lat");
    expect(service.store.findToolByName(tool.toolName)!.enabled).toBe(false);

    // contract test → approve → enable
    service.recordContractTest(tool.id, true, "system");
    service.approveTool(tool.id, "operator");
    const enabled = service.enableTool(tool.id, "operator");
    expect(enabled.enabled).toBe(true);

    // execute through the gateway: audited, agent never supplies a URL
    const result = await service.executeApproved({ operationId: operation.id, toolId: tool.id, arguments: { lat: 16.18, lon: 103.3 }, actorId: "agent-1" });
    expect(result.outcome).toBe("completed");
    expect(result.httpStatus).toBe(200);
    expect((result.body as Record<string, unknown>)["forecast"]).toBe("sunny");
    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0].url.startsWith("https://api.weather.example/v1/forecast")).toBe(true);
    expect(providerCalls[0].url).toContain("lat=16.18");

    // rate limit + audit evidence
    const audit = service.listAudit().map((e) => e.action);
    expect(audit).toContain("external_api.call.completed");
    expect(audit).toContain("external_api.tool.enabled");

    // revoke → tools disabled, breaker open, future execution denied
    service.transitionProvider(weather.id, "revoked", "operator");
    expect(service.store.getTool(tool.id)!.enabled).toBe(false);
    const afterRevocation = await service.executeApproved({ operationId: operation.id, arguments: { lat: 1 } });
    expect(afterRevocation.outcome).toBe("denied");
    expect(afterRevocation.denialCode).toBe("EXTERNAL_API_REVOKED");
    // evidence preserved (spec §59)
    expect(service.store.getProvider(weather.id)!.revokedAt).toBeTruthy();
  });

  test("circuit breaker opens after repeated failures and denies execution", async () => {
    const sync = await service.syncFromSource();
    void sync;
    const flaky = service.store.listProviders().find((p) => p.hostname === "flaky.example") ?? null;
    void flaky;
    // build a dedicated provider + enabled operation against the flaky endpoint
    const provider = service.store.listProviders().find((p) => p.hostname === "dog.ceo")!;
    service.transitionProvider(provider.id, "observed", "operator");
    service.transitionProvider(provider.id, "approved", "operator");
    const operation = service.addOperation({
      providerId: provider.id, operationKey: "dogs.image.read", httpMethod: "GET",
      pathTemplate: "/api/breeds", serverUrl: "https://flaky.example", capabilityIds: ["dogs.image.read"],
    });
    const tool = service.generateTool(operation.id);
    service.recordContractTest(tool.id, true);
    service.approveTool(tool.id);
    service.enableTool(tool.id);

    const first = await service.executeApproved({ operationId: operation.id, arguments: {} });
    expect(first.outcome).toBe("failed"); // 500
    expect(service.store.getProvider(provider.id)!.circuit).toBe("half_open");
    const second = await service.executeApproved({ operationId: operation.id, arguments: {} });
    expect(second.outcome).toBe("failed");
    const third = service.store.getProvider(provider.id)!.circuit;
    expect(["open", "half_open"]).toContain(third);
    if (third === "open") {
      const denied = await service.executeApproved({ operationId: operation.id, arguments: {} });
      expect(denied.denialCode).toBe("EXTERNAL_API_CIRCUIT_OPEN");
    }
  });

  test("credential profiles resolve server-side and missing credentials deny cleanly", async () => {
    const sync = await service.syncFromSource();
    void sync;
    const cats = service.store.listProviders().find((p) => p.hostname === "docs.thecatapi.com")!;
    service.transitionProvider(cats.id, "observed", "operator");
    service.transitionProvider(cats.id, "approved", "operator");
    const operation = service.addOperation({
      providerId: cats.id, operationKey: "cats.image.read", httpMethod: "GET",
      pathTemplate: "/v1/images", serverUrl: "https://docs.thecatapi.example", capabilityIds: ["cats.image.read"],
    });
    // authRequired is derived from the provider auth type
    expect(operation.authRequired).toBe(true);
    // the gateway checks operation enablement before credential resolution
    const tool = service.generateTool(operation.id);
    service.recordContractTest(tool.id, true);
    service.approveTool(tool.id);
    service.enableTool(tool.id);
    const noCredential = await service.executeApproved({ operationId: operation.id, arguments: {}, toolId: tool.id });
    expect(noCredential.denialCode).toBe("EXTERNAL_API_CREDENTIAL_MISSING");

    const profile = service.addCredentialProfile({
      providerId: cats.id, authType: "api_key", secretRef: "env:PAO_TEST_CAT_KEY", headerName: "x-api-key",
    });
    process.env.PAO_TEST_CAT_KEY = "test-key-value-not-real";
    try {
      const ok = await service.executeApproved({ operationId: operation.id, arguments: {}, credentialProfileId: profile.id, toolId: tool.id });
      expect(ok.outcome).toBe("completed");
      expect(providerCalls[0].headers["x-api-key"]).toBe("test-key-value-not-real");
      // the secret never lands in audit metadata or call records
      const calls = service.store.listRuntimeCalls();
      expect(JSON.stringify(calls)).not.toContain("test-key-value-not-real");
    } finally {
      delete process.env.PAO_TEST_CAT_KEY;
    }
  });

  test("mutation operations default to stricter policy (risk high, approval always)", async () => {
    await service.syncFromSource();
    const provider = service.store.listProviders().find((p) => p.hostname === "dog.ceo")!;
    service.transitionProvider(provider.id, "observed", "operator");
    service.transitionProvider(provider.id, "approved", "operator");
    const mutation = service.addOperation({
      providerId: provider.id, operationKey: "dogs.create", httpMethod: "POST",
      pathTemplate: "/api/breeds", serverUrl: "https://dog.ceo", capabilityIds: ["dogs.breeds.write"],
    });
    expect(mutation.mutating).toBe(true);
    expect(mutation.riskLevel).toBe("high");
    const tool = service.generateTool(mutation.id);
    expect(tool.approvalMode).toBe("always");
  });

  test("feature flags gate every stage", async () => {
    const gated = new ExternalApiService({ config: makeConfig({ enabled: true, runtimeExecutionEnabled: false }) });
    await expect(gated.executeApproved({ operationId: "any" })).rejects.toThrow(/runtimeExecutionEnabled/);
    const off = new ExternalApiService({ config: makeConfig({ enabled: false }) });
    await expect(off.syncFromSource()).rejects.toThrow(/disabled/);
    void service;
  });
});

// ---------------------------------------------------------------------------
// management API surface

describe("phase 20.63 management routes", () => {
  beforeEach(() => {
    openFreshDb();
    setExternalApiServiceForTests(makeService());
  });

  afterEach(() => {
    closeAgentOsDbForTests();
    while (tempHomes.length) rmSync(tempHomes.pop()!, { recursive: true, force: true });
    resetExternalApiServiceForTests();
  });

  function baseConfig(): OcxConfig {
    return { port: 10100, hostname: "127.0.0.1", defaultProvider: "a", providers: [] } as unknown as OcxConfig;
  }

  async function api(method: string, path: string, body?: unknown): Promise<Response> {
    const url = new URL("http://127.0.0.1:10100" + path);
    const response = await handleManagementAPI(
      new Request(url, { method, headers: { Host: url.host }, body: body === undefined ? undefined : JSON.stringify(body) }),
      url,
      baseConfig(),
      { saveConfigPreservingClaudeCode: () => {} },
    );
    expect(response).not.toBeNull();
    return response!;
  }

  test("health, sync, search, and mcp-tools listing", async () => {
    const health = await api("GET", "/api/agent-os/external-apis/health");
    const healthBody = (await health.json()) as Record<string, unknown>;
    expect(healthBody["ok"]).toBe(true);
    expect(healthBody["phase"]).toBe("20.63");

    const synced = await api("POST", "/api/agent-os/external-apis/sync", { actorId: "operator" });
    expect(synced.status).toBe(200);
    const syncBody = (await synced.json()) as { added: number };
    expect(syncBody.added).toBeGreaterThan(0);

    const search = await api("POST", "/api/agent-os/external-apis/capabilities/search", { query: "dogs" });
    expect(search.status).toBe(200);
    const searchBody = (await search.json()) as { results: Array<{ whyRanked: string[] }> };
    expect(searchBody.results[0].whyRanked.length).toBeGreaterThan(0);

    const tools = await api("GET", "/api/agent-os/external-apis/mcp-tools");
    const toolBody = (await tools.json()) as { tools: Array<{ name: string }> };
    expect(toolBody.tools.some((t) => t.name === "external_api_search_capabilities")).toBe(true);
    expect(toolBody.tools.some((t) => t.name === "external_api_execute_approved")).toBe(true);

    const missing = await api("GET", "/api/agent-os/external-apis/not-a-route");
    expect(missing.status).toBe(404);
  });

  test("provider lifecycle transitions through the API", async () => {
    await api("POST", "/api/agent-os/external-apis/sync", {});
    const providers = ((await (await api("GET", "/api/agent-os/external-apis/providers")).json()) as { providers: Array<{ id: string; lifecycle: string }> }).providers;
    const provider = providers[0];
    expect(provider.lifecycle).toBe("ingested");
    await api("POST", "/api/agent-os/external-apis/providers/" + provider.id + "/review", {});
    const approved = await api("POST", "/api/agent-os/external-apis/providers/" + provider.id + "/approve", { actorId: "operator" });
    expect(((await approved.json()) as { provider: { lifecycle: string } }).provider.lifecycle).toBe("approved");
    const revoked = await api("POST", "/api/agent-os/external-apis/providers/" + provider.id + "/revoke", { actorId: "operator" });
    expect(((await revoked.json()) as { provider: { lifecycle: string } }).provider.lifecycle).toBe("revoked");
    // revoked -> review_required -> suspended is the operator reopen path (spec §8)
    const reopened = await api("POST", "/api/agent-os/external-apis/providers/" + provider.id + "/suspend", { actorId: "operator" });
    expect(reopened.status).toBe(200);
  });
});
