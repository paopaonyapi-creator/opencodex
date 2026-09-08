// Phase 20.4 — Council Management REST API Routes (spec section 154).
//
// Endpoints mounted under /api/council/* and /api/agent-os/council/*
// Exposes council runs, parallel plans, task distribution, worktrees, reviews,
// conflict cases, trial merges, verification evidence, and merge readiness.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import {
  createCouncilRun,
  getCouncilRun,
  listCouncilRuns,
  cancelCouncilRun,
  planRunParallelism,
  getParallelizationPlanForRun,
} from "../../agent-os/council/orchestrator";
import { listAgentRuns } from "../../agent-os/council/agents";
import { listCouncilWorktrees } from "../../agent-os/council/worktrees";
import { listChangeSets } from "../../agent-os/council/changesets";
import { computeReviewConsensus, listReviewResults } from "../../agent-os/council/reviewers";
import { createVerificationBundle } from "../../agent-os/council/verification";
import { listConflictCases } from "../../agent-os/council/conflicts";
import { computeMergeReadiness } from "../../agent-os/council/merge-queue";
import { getCouncilConfig } from "../../agent-os/council/config";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_request", message } }, 400, req, {});
}

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

export async function handleCouncilRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;

  let path = "";
  if (url.pathname.startsWith("/api/council/")) {
    path = url.pathname.slice("/api/council/".length);
  } else if (url.pathname === "/api/council") {
    path = "";
  } else if (url.pathname.startsWith("/api/agent-os/council/")) {
    path = url.pathname.slice("/api/agent-os/council/".length);
  } else if (url.pathname === "/api/agent-os/council") {
    path = "";
  } else {
    return null;
  }

  // 1. GET /api/council/status or /api/council
  if (path === "" || path === "status") {
    if (req.method === "GET") {
      const config = getCouncilConfig();
      return jsonResponse(
        {
          status: "online",
          version: "20.4.0",
          councilEnabled: config.enabled,
          executionMode: config.defaultExecutionMode,
          budgetMode: config.defaultBudgetMode,
          maxParallelWorktrees: config.maxParallelAgents,
          maxParallelHighRisk: config.maxParallelHighRisk,
          pushEnabled: config.remotePushEnabled,
        },
        200,
        req,
        {},
      );
    }
  }

  // 2. /api/council/runs (GET = list, POST = create)
  if (path === "runs") {
    if (req.method === "GET") {
      const cycleId = url.searchParams.get("cycleId") || undefined;
      const runs = listCouncilRuns(cycleId);
      return jsonResponse({ runs, count: runs.length }, 200, req, {});
    }

    if (req.method === "POST") {
      let body: Record<string, unknown> = {};
      try {
        body = await req.json();
      } catch {
        // empty body ok if cycleId provided in query
      }
      const cycleId = String(body.cycleId || url.searchParams.get("cycleId") || "");
      if (!cycleId) return badRequest(req, "cycleId is required");

      const run = createCouncilRun({
        cycleId,
        baseBranch: body.baseBranch ? String(body.baseBranch) : undefined,
        baseCommitSha: body.baseCommitSha ? String(body.baseCommitSha) : undefined,
        parallelismLimit: body.parallelismLimit ? Number(body.parallelismLimit) : undefined,
        maxParallelHighRisk: body.maxParallelHighRisk ? Number(body.maxParallelHighRisk) : undefined,
        policyProfile: body.policyProfile ? String(body.policyProfile) : undefined,
        budgetProfile: body.budgetProfile as never,
        executionMode: body.executionMode as never,
        metadata: body.metadata as Record<string, unknown> | undefined,
      });

      return jsonResponse({ success: true, run }, 201, req, {});
    }
  }

  // 3. /api/council/runs/:id subroutes
  if (path.startsWith("runs/")) {
    const parts = path.slice("runs/".length).split("/");
    const runId = parts[0];
    const sub = parts[1];

    if (!runId) return badRequest(req, "runId is required");
    const run = getCouncilRun(runId);
    if (!run) return notFound(req, `Council run ${runId} not found`);

    // GET /api/council/runs/:id
    if (!sub && req.method === "GET") {
      const plan = getParallelizationPlanForRun(runId);
      const changesets = listChangeSets(runId);
      const worktrees = listCouncilWorktrees(runId);
      return jsonResponse({ run, plan, changesets, worktrees }, 200, req, {});
    }

    // POST /api/council/runs/:id/cancel
    if (sub === "cancel" && req.method === "POST") {
      let body: Record<string, unknown> = {};
      try {
        body = await req.json();
      } catch {
        // empty body ok
      }
      const cancelled = cancelCouncilRun(runId, body.reason ? String(body.reason) : undefined);
      return jsonResponse({ success: true, run: cancelled }, 200, req, {});
    }

    // GET /api/council/runs/:id/tasks or POST (plan tasks)
    if (sub === "tasks") {
      if (req.method === "GET") {
        const plan = getParallelizationPlanForRun(runId);
        return jsonResponse({ runId, plan }, 200, req, {});
      }
      if (req.method === "POST") {
        const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
        const tasks = (body.tasks ?? []) as never;
        const plan = planRunParallelism(runId, tasks);
        return jsonResponse({ success: true, plan }, 200, req, {});
      }
    }

    // GET /api/council/runs/:id/agents
    if (sub === "agents" && req.method === "GET") {
      const agents = listAgentRuns(runId);
      return jsonResponse({ runId, agents, count: agents.length }, 200, req, {});
    }

    // GET /api/council/runs/:id/worktrees
    if (sub === "worktrees" && req.method === "GET") {
      const worktrees = listCouncilWorktrees(runId);
      return jsonResponse({ runId, worktrees, count: worktrees.length }, 200, req, {});
    }

    // GET /api/council/runs/:id/reviews
    if (sub === "reviews" && req.method === "GET") {
      const changesets = listChangeSets(runId);
      const reviews = changesets.map((cs) => ({
        changesetId: cs.id,
        taskKey: cs.taskKey,
        consensus: computeReviewConsensus(cs),
        results: listReviewResults(cs.id),
      }));
      return jsonResponse({ runId, reviews }, 200, req, {});
    }

    // GET /api/council/runs/:id/conflicts
    if (sub === "conflicts" && req.method === "GET") {
      const conflicts = listConflictCases(runId);
      return jsonResponse({ runId, conflicts, count: conflicts.length }, 200, req, {});
    }

    // GET /api/council/runs/:id/merge-readiness
    if (sub === "merge-readiness" && req.method === "GET") {
      const baseSha = url.searchParams.get("baseSha") || run.baseCommitSha;
      const report = computeMergeReadiness({ councilRunId: runId, baseSha });
      return jsonResponse({ runId, report }, 200, req, {});
    }

    // POST /api/council/runs/:id/verify
    if (sub === "verify" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const scope = String(body.scope || "CHANGESET");
      const commitSha = String(body.commitSha || run.baseCommitSha);
      const checks = (body.checks ?? []) as never;
      const bundle = createVerificationBundle({
        councilRunId: runId,
        scope: scope as never,
        commitSha,
        checks,
      });
      return jsonResponse({ success: true, bundle }, 200, req, {});
    }

    // POST /api/council/runs/:id/integrate
    if (sub === "integrate" && req.method === "POST") {
      return jsonResponse(
        {
          success: true,
          runId,
          integrationStatus: "QUEUED",
          strategy: run.integrationMode,
        },
        200,
        req,
        {},
      );
    }
  }

  return null;
}
