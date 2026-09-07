// Phase 20.2 — SDLC Orchestrator REST Management API Routes Tests
// Direct dispatch testing for all endpoints under /api/sdlc/*

import { describe, it, expect, beforeEach } from "bun:test";
import { openAgentOsDb } from "../src/agent-os/db";
import { handleSdlcRoutes } from "../src/server/management/sdlc-routes";
import type { ManagementContext } from "../src/server/management/context";
import { resetSdlcOrchestratorForTests } from "../src/agent-os/sdlc/orchestrator";
import { ApprovalEngine } from "../src/agent-os/sdlc/approvals";

function cleanDb() {
  const db = openAgentOsDb();
  db.run("DELETE FROM sdlc_cycles");
  db.run("DELETE FROM sdlc_requirements");
  db.run("DELETE FROM sdlc_acceptance_criteria");
  db.run("DELETE FROM sdlc_clarifications");
  db.run("DELETE FROM sdlc_adrs");
  db.run("DELETE FROM sdlc_tasks");
  db.run("DELETE FROM sdlc_gates");
  db.run("DELETE FROM sdlc_reviews");
  db.run("DELETE FROM sdlc_evidence");
  db.run("DELETE FROM sdlc_approvals");
  db.run("DELETE FROM sdlc_artifacts");
  db.run("DELETE FROM sdlc_locks");
}

function mockCtx(path: string, method = "GET", body?: unknown, headers?: Record<string, string>): ManagementContext {
  const url = new URL(`http://127.0.0.1:4000${path}`);
  const req = new Request(url.toString(), {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(headers ?? {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { url, req, config: {} as never, principal: { role: "admin", isLoopback: true } as never, deps: {} as never };
}

describe("SDLC REST Management API — /api/sdlc/* Routes", () => {
  beforeEach(() => {
    cleanDb();
    resetSdlcOrchestratorForTests();
  });

  it("returns null for non-sdlc routes", async () => {
    const res = await handleSdlcRoutes(mockCtx("/api/other/endpoint"));
    expect(res).toBeNull();
  });

  it("handles cycle collection routes (POST to create, GET to list)", async () => {
    // 1. Missing fields validation
    const badRes = await handleSdlcRoutes(mockCtx("/api/sdlc/cycles", "POST", {}));
    expect(badRes?.status).toBe(400);

    // 2. Successful creation
    const createRes = await handleSdlcRoutes(mockCtx("/api/sdlc/cycles", "POST", {
      title: "Real-time Metrics Dashboard",
      sourceIdea: "Stream telemetry data into Prometheus and Grafana",
      riskLevel: "LOW",
      priority: 6,
    }));
    expect(createRes?.status).toBe(201);
    const createJson = (await createRes!.json()) as { success: boolean; cycle: { id: string; title: string; status: string } };
    expect(createJson.success).toBe(true);
    expect(createJson.cycle.id).toBeDefined();
    expect(createJson.cycle.status).toBe("DRAFT");

    // 3. List cycles
    const listRes = await handleSdlcRoutes(mockCtx("/api/sdlc/cycles", "GET"));
    expect(listRes?.status).toBe(200);
    const listJson = (await listRes!.json()) as { cycles: Array<{ id: string; title: string }> };
    expect(listJson.cycles.length).toBe(1);
    expect(listJson.cycles[0].title).toBe("Real-time Metrics Dashboard");
  });

  it("handles cycle detail GET route and 404 for unknown cycle", async () => {
    // Unknown cycle
    const notFoundRes = await handleSdlcRoutes(mockCtx("/api/sdlc/cycles/non-existent-id", "GET"));
    expect(notFoundRes?.status).toBe(404);

    // Create a cycle
    const createRes = await handleSdlcRoutes(mockCtx("/api/sdlc/cycles", "POST", {
      title: "Test Detail Cycle",
      sourceIdea: "Testing cycle detail fetching",
    }));
    const createJson = (await createRes!.json()) as { cycle: { id: string } };
    const cycleId = createJson.cycle.id;

    // Fetch detail
    const detailRes = await handleSdlcRoutes(mockCtx(`/api/sdlc/cycles/${cycleId}`, "GET"));
    expect(detailRes?.status).toBe(200);
    const detailJson = (await detailRes!.json()) as {
      cycle: { id: string };
      requirements: unknown[];
      acceptanceCriteria: unknown[];
      tasks: unknown[];
    };
    expect(detailJson.cycle.id).toBe(cycleId);
    expect(Array.isArray(detailJson.requirements)).toBe(true);
    expect(Array.isArray(detailJson.acceptanceCriteria)).toBe(true);
    expect(Array.isArray(detailJson.tasks)).toBe(true);
  });

  it("dispatches stage execution actions (/specify, /clarify, /plan, /tasks, /analyze, /checklist, /test, /review, /converge, /rollback)", async () => {
    // Create cycle
    const createRes = await handleSdlcRoutes(mockCtx("/api/sdlc/cycles", "POST", {
      title: "Full Route Stages Test",
      sourceIdea: "Testing stage action handlers through REST API",
    }));
    const { cycle } = (await createRes!.json()) as { cycle: { id: string } };
    const cycleId = cycle.id;

    // 1. /specify
    const specRes = await handleSdlcRoutes(mockCtx(`/api/sdlc/cycles/${cycleId}/specify`, "POST"));
    expect(specRes?.status).toBe(200);
    const specJson = (await specRes!.json()) as { success: boolean; requirements: unknown[] };
    expect(specJson.success).toBe(true);
    expect(specJson.requirements.length).toBeGreaterThan(0);

    // 2. /clarify
    const clarifyRes = await handleSdlcRoutes(mockCtx(`/api/sdlc/cycles/${cycleId}/clarify`, "POST"));
    expect(clarifyRes?.status).toBe(200);

    // 3. /plan
    const planRes = await handleSdlcRoutes(mockCtx(`/api/sdlc/cycles/${cycleId}/plan`, "POST"));
    expect(planRes?.status).toBe(200);

    // 4. /tasks
    const tasksRes = await handleSdlcRoutes(mockCtx(`/api/sdlc/cycles/${cycleId}/tasks`, "POST"));
    expect(tasksRes?.status).toBe(200);
    const tasksJson = (await tasksRes!.json()) as { success: boolean; tasks: Array<{ id: string }> };
    expect(tasksJson.tasks.length).toBeGreaterThan(0);

    // 5. /analyze
    const analyzeRes = await handleSdlcRoutes(mockCtx(`/api/sdlc/cycles/${cycleId}/analyze`, "POST"));
    expect(analyzeRes?.status).toBe(200);
    const analyzeJson = (await analyzeRes!.json()) as { success: boolean; coverage: { requirementCoveragePercent: number } };
    expect(analyzeJson.coverage.requirementCoveragePercent).toBe(100);

    // 6. /checklist
    const checklistRes = await handleSdlcRoutes(mockCtx(`/api/sdlc/cycles/${cycleId}/checklist`, "POST"));
    expect(checklistRes?.status).toBe(200);

    // 7. /implement
    const firstTaskId = tasksJson.tasks[0]!.id;
    const implementRes = await handleSdlcRoutes(mockCtx(`/api/sdlc/cycles/${cycleId}/implement`, "POST", { taskId: firstTaskId }));
    expect(implementRes?.status).toBe(200);

    // 8. /test (fastCheck: true)
    const testRes = await handleSdlcRoutes(mockCtx(`/api/sdlc/cycles/${cycleId}/test`, "POST", { fastCheck: true }));
    expect(testRes?.status).toBe(200);
    const testJson = (await testRes!.json()) as { success: boolean; verification: { passed: boolean } };
    expect(testJson.verification.passed).toBe(true);

    // 9. /review
    const reviewRes = await handleSdlcRoutes(mockCtx(`/api/sdlc/cycles/${cycleId}/review`, "POST"));
    expect(reviewRes?.status).toBe(200);

    // 10. /rollback
    const rollbackRes = await handleSdlcRoutes(mockCtx(`/api/sdlc/cycles/${cycleId}/rollback`, "POST", { reason: "Operator manual rollback" }));
    expect(rollbackRes?.status).toBe(200);
    const rollbackJson = (await rollbackRes!.json()) as { success: boolean; cycle: { status: string } };
    expect(rollbackJson.cycle.status).toBe("ROLLED_BACK");
  });

  it("handles sub-resources endpoints (/artifacts, /gates, /evidence)", async () => {
    const createRes = await handleSdlcRoutes(mockCtx("/api/sdlc/cycles", "POST", {
      title: "Sub-resources Test",
      sourceIdea: "Testing subresource endpoints",
    }));
    const { cycle } = (await createRes!.json()) as { cycle: { id: string } };

    // Run specify to generate an artifact and gate
    await handleSdlcRoutes(mockCtx(`/api/sdlc/cycles/${cycle.id}/specify`, "POST"));

    const artRes = await handleSdlcRoutes(mockCtx(`/api/sdlc/cycles/${cycle.id}/artifacts`, "GET"));
    expect(artRes?.status).toBe(200);
    const artJson = (await artRes!.json()) as { artifacts: unknown[] };
    expect(artJson.artifacts.length).toBeGreaterThanOrEqual(1);

    const gatesRes = await handleSdlcRoutes(mockCtx(`/api/sdlc/cycles/${cycle.id}/gates`, "GET"));
    expect(gatesRes?.status).toBe(200);
    const gatesJson = (await gatesRes!.json()) as { gates: unknown[] };
    expect(gatesJson.gates.length).toBeGreaterThanOrEqual(1);

    const evRes = await handleSdlcRoutes(mockCtx(`/api/sdlc/cycles/${cycle.id}/evidence`, "GET"));
    expect(evRes?.status).toBe(200);
  });

  it("handles approvals REST endpoints (GET list, POST approve/reject)", async () => {
    // Create cycle and request approval
    const createRes = await handleSdlcRoutes(mockCtx("/api/sdlc/cycles", "POST", {
      title: "Approval Route Test",
      sourceIdea: "Testing approval REST endpoints",
      riskLevel: "CRITICAL",
    }));
    const { cycle } = (await createRes!.json()) as { cycle: { id: string } };

    const approval = ApprovalEngine.requestApproval({
      cycleId: cycle.id,
      actionType: "destructive_migration",
      reason: "Altering database partition",
      riskLevel: "CRITICAL",
    });

    // 1. List approvals
    const listRes = await handleSdlcRoutes(mockCtx("/api/sdlc/approvals", "GET"));
    expect(listRes?.status).toBe(200);
    const listJson = (await listRes!.json()) as { approvals: Array<{ id: string; status: string }> };
    expect(listJson.approvals.length).toBe(1);
    expect(listJson.approvals[0].id).toBe(approval.id);

    // 2. Invalid action
    const badActionRes = await handleSdlcRoutes(mockCtx(`/api/sdlc/approvals/${approval.id}/defer`, "POST"));
    expect(badActionRes?.status).toBe(400);

    // 3. Approve
    const approveRes = await handleSdlcRoutes(mockCtx(`/api/sdlc/approvals/${approval.id}/approve`, "POST", {
      decidedBy: "chief-architect",
    }));
    expect(approveRes?.status).toBe(200);
    const approveJson = (await approveRes!.json()) as { success: boolean; approval: { status: string; decidedBy: string } };
    expect(approveJson.success).toBe(true);
    expect(approveJson.approval.status).toBe("approved");
    expect(approveJson.approval.decidedBy).toBe("chief-architect");
  });
});
