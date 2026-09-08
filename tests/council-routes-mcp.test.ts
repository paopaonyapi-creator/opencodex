import { describe, it, expect, beforeEach } from "bun:test";
import { handleCouncilRoutes } from "../src/server/management/council-routes";
import { COUNCIL_MCP_TOOLS } from "../src/agent-os/council/mcp-tools";
import { createCouncilRun, getCouncilRun } from "../src/agent-os/council/orchestrator";
import { openAgentOsDb } from "../src/agent-os/db";
import type { ManagementContext } from "../src/server/management/context";

function makeContext(method: string, path: string, body?: unknown): ManagementContext {
  const url = new URL(`http://localhost:18080${path}`);
  const init: RequestInit = {
    method,
    headers: {
      "content-type": "application/json",
      host: "localhost:18080",
    },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const req = new Request(url.toString(), init);
  return {
    req,
    url,
    config: {} as never,
    principal: { kind: "admin" } as never,
  };
}

describe("Phase 20.4 — Council REST Management API & MCP Tools", () => {
  beforeEach(() => {
    openAgentOsDb();
  });

  describe("1. REST API Endpoints (/api/council/*)", () => {
    it("GET /api/council/status returns status and config", async () => {
      const ctx = makeContext("GET", "/api/council/status");
      const res = await handleCouncilRoutes(ctx);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);

      const json = await res!.json() as Record<string, unknown>;
      expect(json.status).toBe("online");
      expect(json.version).toBe("20.4.0");
      expect(json.maxParallelWorktrees).toBeDefined();
    });

    it("POST /api/council/runs creates a new run", async () => {
      const ctx = makeContext("POST", "/api/council/runs", {
        cycleId: "cycle-api-1",
        parallelismLimit: 3,
        executionMode: "PARALLEL_ASSISTED",
      });
      const res = await handleCouncilRoutes(ctx);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(201);

      const json = await res!.json() as { success: boolean; run: { id: string; cycleId: string; status: string } };
      expect(json.success).toBe(true);
      expect(json.run.id).toMatch(/^crun_/);
      expect(json.run.cycleId).toBe("cycle-api-1");
      expect(json.run.status).toBe("CREATED");
    });

    it("GET /api/council/runs lists runs", async () => {
      const ctx = makeContext("GET", "/api/council/runs?cycleId=cycle-api-1");
      const res = await handleCouncilRoutes(ctx);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);

      const json = await res!.json() as { runs: Array<{ id: string }> };
      expect(json.runs.length).toBeGreaterThan(0);
    });

    it("GET /api/council/runs/:id returns run details", async () => {
      const created = createCouncilRun({ cycleId: "cycle-api-2" });
      const ctx = makeContext("GET", `/api/council/runs/${created.id}`);
      const res = await handleCouncilRoutes(ctx);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);

      const json = await res!.json() as { run: { id: string } };
      expect(json.run.id).toBe(created.id);
    });

    it("POST /api/council/runs/:id/tasks generates parallel plan", async () => {
      const created = createCouncilRun({ cycleId: "cycle-api-tasks" });
      const ctx = makeContext("POST", `/api/council/runs/${created.id}/tasks`, {
        tasks: [
          { taskKey: "T1", title: "Task 1", dependencies: [], targetPaths: ["src/a.ts"] },
          { taskKey: "T2", title: "Task 2", dependencies: [], targetPaths: ["src/b.ts"] },
        ],
      });
      const res = await handleCouncilRoutes(ctx);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);

      const json = await res!.json() as { success: boolean; plan: { parallelGroups: string[][] } };
      expect(json.success).toBe(true);
      expect(json.plan.parallelGroups.length).toBeGreaterThan(0);
    });

    it("GET /api/council/runs/:id/merge-readiness computes readiness", async () => {
      const created = createCouncilRun({ cycleId: "cycle-api-mr" });
      const ctx = makeContext("GET", `/api/council/runs/${created.id}/merge-readiness`);
      const res = await handleCouncilRoutes(ctx);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);

      const json = await res!.json() as { report: { ready: boolean; blockingReasons: string[] } };
      expect(json.report).toBeDefined();
      expect(json.report.ready).toBe(false); // no changesets yet
    });

    it("POST /api/council/runs/:id/verify records verification bundle", async () => {
      const created = createCouncilRun({ cycleId: "cycle-api-verif" });
      const ctx = makeContext("POST", `/api/council/runs/${created.id}/verify`, {
        scope: "CHANGESET",
        commitSha: "sha12345",
        checks: [
          { name: "typecheck", command: "tsc", outcome: "PASS", exitCode: 0, durationMs: 10 },
        ],
      });
      const res = await handleCouncilRoutes(ctx);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);

      const json = await res!.json() as { success: boolean; bundle: { bundleHash: string } };
      expect(json.success).toBe(true);
      expect(json.bundle.bundleHash).toBeDefined();
    });

    it("POST /api/council/runs/:id/cancel cancels the run", async () => {
      const created = createCouncilRun({ cycleId: "cycle-api-cancel" });
      const ctx = makeContext("POST", `/api/council/runs/${created.id}/cancel`, {
        reason: "Cancelled by test",
      });
      const res = await handleCouncilRoutes(ctx);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);

      const json = await res!.json() as { success: boolean; run: { status: string } };
      expect(json.success).toBe(true);
      expect(json.run.status).toBe("CANCELLED");
    });
  });

  describe("2. 15 Canonical Council MCP Tools", () => {
    it("exposes all 15 canonical MCP tools", () => {
      const expectedTools = [
        "council_create_run",
        "council_get_run",
        "council_cancel_run",
        "council_plan_parallelism",
        "council_list_ready_tasks",
        "council_assign_task",
        "council_get_agent_runs",
        "council_get_worktrees",
        "council_get_changesets",
        "council_request_review",
        "council_get_reviews",
        "council_run_verification",
        "council_get_conflicts",
        "council_build_integration",
        "council_get_merge_readiness",
      ];

      for (const name of expectedTools) {
        expect(COUNCIL_MCP_TOOLS[name]).toBeDefined();
        expect(COUNCIL_MCP_TOOLS[name]!.parameters.type).toBe("object");
        expect(COUNCIL_MCP_TOOLS[name]!.handler).toBeInstanceOf(Function);
      }
    });

    it("executes council_create_run and council_get_run", async () => {
      const createRes = await COUNCIL_MCP_TOOLS.council_create_run.handler({
        cycleId: "cycle-mcp-1",
        parallelismLimit: 4,
      }) as { success: boolean; run: { id: string; status: string } };

      expect(createRes.success).toBe(true);
      expect(createRes.run.id).toBeDefined();

      const getRes = await COUNCIL_MCP_TOOLS.council_get_run.handler({
        runId: createRes.run.id,
      }) as { success: boolean; run: { id: string; status: string } };

      expect(getRes.success).toBe(true);
      expect(getRes.run.id).toBe(createRes.run.id);
    });

    it("executes council_plan_parallelism and council_list_ready_tasks", async () => {
      const createRes = await COUNCIL_MCP_TOOLS.council_create_run.handler({
        cycleId: "cycle-mcp-2",
      }) as { success: boolean; run: { id: string } };

      const planRes = await COUNCIL_MCP_TOOLS.council_plan_parallelism.handler({
        runId: createRes.run.id,
        tasks: [
          { taskKey: "T_A", title: "Task A", dependencies: [], targetPaths: ["a.ts"] },
          { taskKey: "T_B", title: "Task B", dependencies: ["T_A"], targetPaths: ["b.ts"] },
        ],
      }) as { success: boolean; plan: { parallelGroups: string[][] } };

      expect(planRes.success).toBe(true);
      expect(planRes.plan.parallelGroups[0]).toContain("T_A");

      const readyRes = await COUNCIL_MCP_TOOLS.council_list_ready_tasks.handler({
        runId: createRes.run.id,
      }) as { success: boolean; readyTasks: string[] };

      expect(readyRes.success).toBe(true);
      expect(readyRes.readyTasks).toContain("T_A");
    });

    it("executes council_run_verification, council_get_conflicts, and council_get_merge_readiness", async () => {
      const createRes = await COUNCIL_MCP_TOOLS.council_create_run.handler({
        cycleId: "cycle-mcp-3",
      }) as { success: boolean; run: { id: string } };

      const verifRes = await COUNCIL_MCP_TOOLS.council_run_verification.handler({
        runId: createRes.run.id,
        commitSha: "headsha",
        scope: "CHANGESET",
        checks: [
          { name: "lint", command: "oxlint", outcome: "PASS", exitCode: 0, durationMs: 5 },
        ],
      }) as { success: boolean; bundle: { passed: boolean } };

      expect(verifRes.success).toBe(true);
      expect(verifRes.bundle.passed).toBe(true);

      const conflictsRes = await COUNCIL_MCP_TOOLS.council_get_conflicts.handler({
        runId: createRes.run.id,
      }) as { success: boolean; conflicts: unknown[] };

      expect(conflictsRes.success).toBe(true);
      expect(Array.isArray(conflictsRes.conflicts)).toBe(true);

      const mrRes = await COUNCIL_MCP_TOOLS.council_get_merge_readiness.handler({
        runId: createRes.run.id,
        baseSha: "headsha",
      }) as { success: boolean; report: { ready: boolean } };

      expect(mrRes.success).toBe(true);
      expect(mrRes.report.ready).toBe(false);
    });

    it("executes council_cancel_run", async () => {
      const createRes = await COUNCIL_MCP_TOOLS.council_create_run.handler({
        cycleId: "cycle-mcp-cancel",
      }) as { success: boolean; run: { id: string } };

      const cancelRes = await COUNCIL_MCP_TOOLS.council_cancel_run.handler({
        runId: createRes.run.id,
        reason: "Test cancel",
      }) as { success: boolean; run: { status: string } };

      expect(cancelRes.success).toBe(true);
      expect(cancelRes.run.status).toBe("CANCELLED");
    });
  });
});
