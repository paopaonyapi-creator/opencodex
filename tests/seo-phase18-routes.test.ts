import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeAgentOsDbForTests, openAgentOsDb } from "../src/agent-os/db";
import { handleSeoRoutes } from "../src/server/management/seo-routes";
import type { ManagementContext } from "../src/server/management/context";

let tempDir = "";

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "seo-routes-"));
  openAgentOsDb(tempDir);
});

afterEach(() => {
  closeAgentOsDbForTests();
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

function mockCtx(path: string, method = "GET", body?: unknown): ManagementContext {
  const url = new URL(`http://127.0.0.1:4000${path}`);
  const req = new Request(url.toString(), {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { url, req, config: {} as never, principal: { role: "admin", isLoopback: true } as never, deps: {} as never };
}

describe("Phase 18 — SEO Management API (/api/agent-os/seo/*)", () => {
  test("provider health defaults to a healthy mock without leaking config", async () => {
    const res = await handleSeoRoutes(mockCtx("/api/agent-os/seo/provider/health"));
    expect(res!.status).toBe(200);
    const json = await res!.json();
    expect(json.provider).toBe("mock");
    expect(json.status).toBe("healthy");
    expect(json.activeMode).toBe("mock");
    expect(JSON.stringify(json)).not.toContain("apiKey");
  });

  test("provider capabilities list normalized mock capabilities", async () => {
    const res = await handleSeoRoutes(mockCtx("/api/agent-os/seo/provider/capabilities"));
    const json = await res!.json();
    expect(json.provider).toBe("mock");
    expect(json.capabilities).toContain("keyword_research");
  });

  test("project CRUD round-trip", async () => {
    const postRes = await handleSeoRoutes(mockCtx("/api/agent-os/seo/projects", "POST", {
      domain: "worpaogroup.example",
      displayName: "Wor-Pao Group",
      seedKeywords: ["บริการดิจิทัล"],
      competitors: ["rival.example"],
    }));
    expect(postRes!.status).toBe(201);
    const { project } = await postRes!.json();
    expect(project.domain).toBe("worpaogroup.example");

    const listRes = await handleSeoRoutes(mockCtx("/api/agent-os/seo/projects"));
    const listJson = await listRes!.json();
    expect(listJson.projects).toHaveLength(1);

    const getRes = await handleSeoRoutes(mockCtx(`/api/agent-os/seo/projects/${project.id}`));
    expect((await getRes!.json()).project.displayName).toBe("Wor-Pao Group");

    const patchRes = await handleSeoRoutes(mockCtx(`/api/agent-os/seo/projects/${project.id}`, "PATCH", { goals: ["rank #1"] }));
    expect((await patchRes!.json()).project.goals).toEqual(["rank #1"]);

    const delRes = await handleSeoRoutes(mockCtx(`/api/agent-os/seo/projects/${project.id}`, "DELETE"));
    expect((await delRes!.json()).deleted).toBe(true);
  });

  test("analyze endpoint runs the mock lane and exposes runs + recommendations", async () => {
    const postRes = await handleSeoRoutes(mockCtx("/api/agent-os/seo/projects", "POST", { domain: "shop.example", seedKeywords: ["shoes"] }));
    const { project } = await postRes!.json();

    const analyzeRes = await handleSeoRoutes(mockCtx(`/api/agent-os/seo/projects/${project.id}/analyze`, "POST", {}));
    expect(analyzeRes!.status).toBe(200);
    const analysis = await analyzeRes!.json();
    expect(analysis.provider).toBe("mock");
    expect(analysis.provenance).toBe("mock");
    expect(analysis.keywords.length).toBeGreaterThan(0);

    const recsRes = await handleSeoRoutes(mockCtx(`/api/agent-os/seo/projects/${project.id}/recommendations`));
    const recs = await recsRes!.json();
    expect(recs.recommendations.length).toBe(analysis.recommendations.length);

    const runsRes = await handleSeoRoutes(mockCtx(`/api/agent-os/seo/projects/${project.id}/runs`));
    expect((await runsRes!.json()).runs).toHaveLength(1);
  });

  test("policy denial surfaces as HTTP 403 with a policy code", async () => {
    const postRes = await handleSeoRoutes(mockCtx("/api/agent-os/seo/projects", "POST", { domain: "locked.example" }));
    const { project } = await postRes!.json();
    await handleSeoRoutes(mockCtx(`/api/agent-os/seo/projects/${project.id}`, "PATCH", { policy: { allowResearch: false } }));
    const res = await handleSeoRoutes(mockCtx(`/api/agent-os/seo/projects/${project.id}/analyze`, "POST", {}));
    expect(res!.status).toBe(403);
    const json = await res!.json();
    expect(json.error.code).toBe("policy_denied");
  });

  test("unknown project and unknown endpoints 404 cleanly", async () => {
    expect((await handleSeoRoutes(mockCtx("/api/agent-os/seo/projects/nope")))!.status).toBe(404);
    expect((await handleSeoRoutes(mockCtx("/api/agent-os/seo/whatever")))!.status).toBe(404);
    expect(await handleSeoRoutes(mockCtx("/api/other/route"))).toBeNull();
  });

  test("recommendation status endpoint validates the status value", async () => {
    const res = await handleSeoRoutes(mockCtx("/api/agent-os/seo/recommendations/rec_x/status", "POST", { status: "bogus" }));
    expect(res!.status).toBe(400);
  });
});
