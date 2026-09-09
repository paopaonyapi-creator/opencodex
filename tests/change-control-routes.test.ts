import { describe, expect, test } from "bun:test";
import { handleChangeControlRoutes } from "../src/server/management/change-control-routes";
import type { ManagementContext } from "../src/server/management/context";

function makeCtx(path: string, method = "GET", body?: any): ManagementContext {
  const url = new URL(`http://localhost:10100${path}`);
  const req = new Request(url.toString(), {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    url,
    req,
    session: null,
    runtimeConfig: null as any,
    requestEpoch: 1,
  };
}

describe("Phase 22 — Change Control Management API Routes", () => {
  let createdId = "";

  test("POST /api/agent-os/change-control/proposals creates a proposal", async () => {
    const ctx = makeCtx("/api/agent-os/change-control/proposals", "POST", {
      title: "docs(acc): api documentation update",
      author: "pao-tester",
      sourceBranch: "pao/docs-test",
      files: ["docs/test.md"],
      intentCategory: "docs",
    });

    const res = await handleChangeControlRoutes(ctx);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(201);

    const data = await res?.json();
    expect(data.proposal.id).toBeDefined();
    expect(data.proposal.blastRadius.riskTier).toBe("R0");
    createdId = data.proposal.id;
  });

  test("GET /api/agent-os/change-control/proposals lists proposals", async () => {
    const ctx = makeCtx("/api/agent-os/change-control/proposals", "GET");
    const res = await handleChangeControlRoutes(ctx);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);

    const data = await res?.json();
    expect(Array.isArray(data.proposals)).toBe(true);
    expect(data.proposals.some((p: any) => p.id === createdId)).toBe(true);
  });

  test("GET /api/agent-os/change-control/proposals/:id returns proposal details", async () => {
    const ctx = makeCtx(`/api/agent-os/change-control/proposals/${createdId}`, "GET");
    const res = await handleChangeControlRoutes(ctx);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);

    const data = await res?.json();
    expect(data.proposal.id).toBe(createdId);
  });

  test("POST /api/agent-os/change-control/proposals/:id/sandbox runs sandbox", async () => {
    const ctx = makeCtx(`/api/agent-os/change-control/proposals/${createdId}/sandbox`, "POST");
    const res = await handleChangeControlRoutes(ctx);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);

    const data = await res?.json();
    expect(data.proposal.sandboxResult.success).toBe(true);
  });

  test("POST /api/agent-os/change-control/proposals/:id/audit runs council review", async () => {
    const ctx = makeCtx(`/api/agent-os/change-control/proposals/${createdId}/audit`, "POST");
    const res = await handleChangeControlRoutes(ctx);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);

    const data = await res?.json();
    expect(data.proposal.councilVerdict.consensus).toBeDefined();
  });

  test("POST /api/agent-os/change-control/proposals/:id/gate evaluates decision gate", async () => {
    const ctx = makeCtx(`/api/agent-os/change-control/proposals/${createdId}/gate`, "POST");
    const res = await handleChangeControlRoutes(ctx);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);

    const data = await res?.json();
    expect(["auto_merge", "freeze_awaiting_approval"]).toContain(data.action);
  });

  test("POST /api/agent-os/change-control/proposals/:id/rollback triggers rollback", async () => {
    const ctx = makeCtx(`/api/agent-os/change-control/proposals/${createdId}/rollback`, "POST", {
      operator: "admin",
    });
    const res = await handleChangeControlRoutes(ctx);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);

    const data = await res?.json();
    expect(data.proposal.status).toBe("rolled_back");
  });
});
