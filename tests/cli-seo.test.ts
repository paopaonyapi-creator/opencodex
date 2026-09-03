import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { handleSeoCommand } from "../src/cli/seo";
import { runtimeBaseUrl } from "../src/cli/runtime-api";

type Recorded = { path: string; method: string };
const servers: Array<ReturnType<typeof Bun.serve>> = [];

let logLines: string[];
let errorLines: string[];
let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  logLines = [];
  errorLines = [];
  logSpy = spyOn(console, "log").mockImplementation((...parts: unknown[]) => { logLines.push(parts.map(String).join(" ")); });
  errorSpy = spyOn(console, "error").mockImplementation((...parts: unknown[]) => { errorLines.push(parts.map(String).join(" ")); });
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  for (const server of servers.splice(0)) server.stop(true);
});

function fakeRuntime(responder?: (req: Request) => unknown) {
  const requests: Recorded[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      requests.push({ path: new URL(req.url).pathname, method: req.method });
      const custom = responder?.(req);
      if (custom !== undefined) return Response.json(custom);
      return Response.json({ ok: true });
    },
  });
  servers.push(server);
  return { requests, deps: { baseUrl: `http://127.0.0.1:${server.port}` } };
}

describe("ocx seo (Phase 18/18.1 CLI surface)", () => {
  test("runtime discovery retries a transient restart handoff before declaring the proxy stopped", async () => {
    let calls = 0;
    const url = await runtimeBaseUrl({
      findLiveProxyImpl: async () => {
        calls += 1;
        return calls === 1 ? null : { pid: 42, port: 10123, hostname: "127.0.0.1", source: "runtime" as const };
      },
      sleepImpl: async () => {},
    } as never);
    expect(url).toBe("http://127.0.0.1:10123");
    expect(calls).toBe(2);
  });

  test("health prints provider status without mutation", async () => {
    const { requests, deps } = fakeRuntime(() => ({ provider: "mock", status: "healthy", activeMode: "mock", latencyMs: 3, capabilities: ["keyword_research"], security: { status: "safe" } }));
    const code = await handleSeoCommand(["health", "--json"], deps);
    expect(code).toBe(0);
    expect(requests).toEqual([{ path: "/api/agent-os/seo/provider/health", method: "GET" }]);
    const json = JSON.parse(logLines.join("\n")) as { provider: string; status: string };
    expect(json.provider).toBe("mock");
    expect(json.status).toBe("healthy");
  });

  test("projects lists configured SEO projects", async () => {
    const { requests, deps } = fakeRuntime(() => ({ projects: [{ id: "seo_a", domain: "a.example", displayName: "A" }] }));
    const code = await handleSeoCommand(["projects"], deps);
    expect(code).toBe(0);
    expect(requests).toEqual([{ path: "/api/agent-os/seo/projects", method: "GET" }]);
    expect(logLines.join("\n")).toContain("seo_a");
    expect(logLines.join("\n")).toContain("a.example");
  });

  test("analyze runs the Phase 18 analysis lane for a project", async () => {
    const { requests, deps } = fakeRuntime(req => {
      if (req.method === "POST" && new URL(req.url).pathname === "/api/agent-os/seo/projects/seo_a/analyze") {
        return { runId: "run_1", provider: "mock", provenance: "mock", recommendations: [] };
      }
      return undefined;
    });
    const code = await handleSeoCommand(["analyze", "seo_a", "--json"], deps);
    expect(code).toBe(0);
    expect(requests).toEqual([{ path: "/api/agent-os/seo/projects/seo_a/analyze", method: "POST" }]);
    const json = JSON.parse(logLines.join("\n")) as { runId: string };
    expect(json.runId).toBe("run_1");
  });

  test("geo audit runs the Phase 18.1 GEO lane and reports the fix plan gate", async () => {
    const { requests, deps } = fakeRuntime(req => {
      if (req.method === "POST" && new URL(req.url).pathname === "/api/agent-os/seo/geo/projects/seo_a/audit") {
        return { runId: "run_g1", heuristicscore: 72, verificationSummary: { verified: 4, unverified: 0, conflict: 0, suppressed: 1 }, llmsProposal: { content: "# P", includedUrls: ["https://a.example/"], excludedCount: 0, warnings: [] } };
      }
      return undefined;
    });
    const code = await handleSeoCommand(["geo-audit", "seo_a"], deps);
    expect(code).toBe(0);
    expect(requests).toEqual([{ path: "/api/agent-os/seo/geo/projects/seo_a/audit", method: "POST" }]);
    const out = logLines.join("\n");
    expect(out).toContain("run_g1");
    expect(out).toContain("72/100");
  });

  test("council runs the reviewer council and prints the approval-bound fix plan", async () => {
    const { requests, deps } = fakeRuntime(req => {
      if (req.method === "POST" && new URL(req.url).pathname === "/api/agent-os/seo/geo/projects/seo_a/council") {
        return {
          council: { final: "needs_review", reviewers: [{ reviewer: "geo_risk_reviewer", verdict: "warn", score: 75, notes: "one medium finding" }] },
          fixPlan: { executionPath: "none", steps: [{ order: 1, title: "Fix technical issue", detail: "Sitemap missing", target: "sitemap.xml", requiresHumanApproval: true }] },
          policy: { executionAllowed: false, humanApprovalRequired: true },
        };
      }
      return undefined;
    });
    const code = await handleSeoCommand(["council", "seo_a"], deps);
    expect(code).toBe(0);
    expect(requests).toEqual([{ path: "/api/agent-os/seo/geo/projects/seo_a/council", method: "POST" }]);
    const out = logLines.join("\n");
    expect(out).toContain("needs_review");
    expect(out).toContain("geo_risk_reviewer");
    expect(out).toContain("sitemap.xml");
    expect(out).toContain("plan only");
  });

  test("report lists audit runs and GEO recommendations for a project", async () => {
    const { requests, deps } = fakeRuntime(req => {
      const url = new URL(req.url);
      if (url.pathname === "/api/agent-os/seo/projects/seo_a/runs") return { runs: [{ id: "run_1", kind: "analyze", status: "succeeded", provider: "mock", provenance: "mock" }] };
      if (url.pathname === "/api/agent-os/seo/geo/projects/seo_a/recommendations") return { recommendations: [{ id: "rec_1", title: "[GEO] Fix robots", impact: "medium", status: "open" }] };
      if (url.pathname === "/api/agent-os/seo/projects/seo_a/recommendations") return { recommendations: [{ id: "rec_2", title: "Target keyword: cctv", impact: "high", status: "open" }] };
      return undefined;
    });
    const code = await handleSeoCommand(["report", "seo_a"], deps);
    expect(code).toBe(0);
    expect(requests).toHaveLength(3);
    const out = logLines.join("\n");
    expect(out).toContain("run_1");
    expect(out).toContain("[GEO] Fix robots");
    expect(out).toContain("Target keyword: cctv");
  });

  test("missing project id is a usage error with exit 2 and no request", async () => {
    const { requests, deps } = fakeRuntime();
    const code = await handleSeoCommand(["analyze"], deps);
    expect(code).toBe(2);
    expect(requests).toHaveLength(0);
    expect(errorLines.join("\n")).toContain("project id is required");
  });

  test("unknown subcommand is a usage error", async () => {
    const { requests, deps } = fakeRuntime();
    const code = await handleSeoCommand(["wat"], deps);
    expect(code).toBe(2);
    expect(requests).toHaveLength(0);
  });
});
