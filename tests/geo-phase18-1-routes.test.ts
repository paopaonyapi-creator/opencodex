import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeAgentOsDbForTests, openAgentOsDb } from "../src/agent-os/db";
import { createSeoProject, listSeoRuns } from "../src/agent-os/seo/seo-models";
import { handleGeoRoutes } from "../src/server/management/geo-routes";
import { runGeoAudit } from "../src/agent-os/seo/geo/geo-orchestrator";
import type { ManagementContext } from "../src/server/management/context";
import { summarizeCouncil } from "../src/agent-os/reviews";

let tempDir = "";

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "geo-routes-181-"));
  openAgentOsDb(tempDir);
});

afterEach(() => {
  closeAgentOsDbForTests();
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

function mockCtx(path: string, method = "GET", body?: unknown): ManagementContext {
  const url = new URL(`http://127.0.0.1:4000${path}`);
  const req = new Request(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { url, req, config: {} as never, principal: "gui-session" as never, deps: {} as never };
}

describe("Phase 18.1 — GEO proposal routes", () => {
  test("GET returns a same-domain llms.txt proposal with an explicit human-approval gate", async () => {
    const project = createSeoProject({
      domain: "worpao.example",
      displayName: "Wor-Pao Group",
      businessDescription: "Digital services group.",
      keyPages: [
        { url: "/services", label: "Services" },
        { url: "https://evil.example/private", label: "External" },
      ],
      primaryTopics: ["Digital services", "Automation"],
    });

    const res = await handleGeoRoutes(mockCtx(`/api/agent-os/seo/geo/projects/${project.id}/llms-txt/proposal`));
    expect(res!.status).toBe(200);
    const body = await res!.json();
    expect(body.proposal.content).toContain("# Wor-Pao Group");
    expect(body.proposal.includedUrls).toEqual([
      "https://worpao.example/",
      "https://worpao.example/services",
    ]);
    expect(body.proposal.excludedCount).toBe(1);
    expect(body.policy).toEqual({ deploymentAllowed: false, humanApprovalRequired: true });
  });

  test("proposal endpoint rejects POST so generation cannot become an accidental deploy path", async () => {
    const project = createSeoProject({ domain: "safe.example" });
    const res = await handleGeoRoutes(mockCtx(`/api/agent-os/seo/geo/projects/${project.id}/llms-txt/proposal`, "POST", {}));
    expect(res!.status).toBe(405);
    const body = await res!.json();
    expect(body.error.code).toBe("method_not_allowed");
  });

  test("unknown project returns 404 without generating a proposal", async () => {
    const res = await handleGeoRoutes(mockCtx("/api/agent-os/seo/geo/projects/missing/llms-txt/proposal"));
    expect(res!.status).toBe(404);
  });
});

describe("Phase 18.1 — GEO council + fix plan routes", () => {
  test("POST council reviews the latest audit, records reviews, and returns a plan-only fix plan", async () => {
    const project = createSeoProject({ domain: "council.example", displayName: "Council Brand" });
    const audit = await runGeoAudit({ project, options: { fetchLive: false } });

    const res = await handleGeoRoutes(mockCtx(`/api/agent-os/seo/geo/projects/${project.id}/council`, "POST"));
    expect(res!.status).toBe(200);
    const body = await res!.json();
    // Fixture audit verifies nothing -> evidence integrity warns -> needs_review.
    expect(body.council.final).toBe("needs_review");
    expect(body.council.reviewers).toHaveLength(3);
    expect(body.fixPlan.executionPath).toBe("none");
    expect(body.fixPlan.steps.length).toBeGreaterThan(0);
    expect(body.fixPlan.steps.every((step: { requiresHumanApproval: boolean }) => step.requiresHumanApproval)).toBe(true);
    expect(body.policy).toEqual({ executionAllowed: false, humanApprovalRequired: true });
    expect(listSeoRuns(project.id)).toHaveLength(1);
    expect(body.council.reviewedRunId).toBe(audit.runId);
    expect(body.council.runId).toBe(audit.runId);
    const repeated = await handleGeoRoutes(mockCtx(`/api/agent-os/seo/geo/projects/${project.id}/council`, "POST"));
    expect(repeated!.status).toBe(200);
    expect(summarizeCouncil("geo_audit", audit.runId)!.reviews).toHaveLength(3);
  });

  test("council route refuses GET and unknown projects", async () => {
    const badMethod = await handleGeoRoutes(mockCtx("/api/agent-os/seo/geo/projects/whatever/council"));
    expect(badMethod!.status).toBe(405);
    const unknown = await handleGeoRoutes(mockCtx("/api/agent-os/seo/geo/projects/missing/council", "POST"));
    expect(unknown!.status).toBe(404);
  });
});
