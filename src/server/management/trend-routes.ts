// Phase 20.10 — Trend Intelligence Management REST API Routes (spec section 24).
//
// Endpoints mounted under /api/trends/* and /api/agent-os/trends/*
// Exposes research jobs, trend signals, opportunity evaluations, stock concepts,
// studio dispatch, actor registry, and financial cost guard.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getTrendOrchestrator } from "../../agent-os/trends/research-orchestrator";
import { getActorRegistry } from "../../agent-os/trends/actor-registry";
import { getTrendConfig } from "../../agent-os/trends/config";
import type { TrendPlatformSource } from "../../agent-os/trends/types";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_request", message } }, 400, req, {});
}

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

export async function handleTrendRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;

  let path = "";
  if (url.pathname.startsWith("/api/trends/")) {
    path = url.pathname.slice("/api/trends/".length);
  } else if (url.pathname === "/api/trends") {
    path = "";
  } else if (url.pathname.startsWith("/api/agent-os/trends/")) {
    path = url.pathname.slice("/api/agent-os/trends/".length);
  } else if (url.pathname === "/api/agent-os/trends") {
    path = "";
  } else {
    return null;
  }

  const orchestrator = getTrendOrchestrator();
  const actorRegistry = getActorRegistry();
  const config = getTrendConfig();

  // 1. GET /api/trends/status or /api/trends
  if (path === "" || path === "status") {
    if (req.method === "GET") {
      const cost = orchestrator.getCostSummary();
      return jsonResponse(
        {
          status: "online",
          version: "20.10.0",
          enabled: config.enabled,
          defaultMarket: config.defaultMarket,
          defaultSources: config.defaultSources,
          mockMode: config.mockMode,
          cost,
        },
        200,
        req,
        {},
      );
    }
    return null;
  }

  // 2. /api/trends/jobs
  if (path === "jobs") {
    if (req.method === "GET") {
      const limit = Number(url.searchParams.get("limit") || "50");
      const jobs = orchestrator.listJobs(limit);
      return jsonResponse({ jobs, count: jobs.length }, 200, req, {});
    }

    if (req.method === "POST") {
      let body: any = {};
      try {
        body = await req.json();
      } catch {
        return badRequest(req, "Invalid JSON payload in request body");
      }

      if (!body.query || typeof body.query !== "string") {
        return badRequest(req, "Missing or invalid required field 'query'");
      }

      const job = orchestrator.createJob({
        query: body.query,
        market: body.market,
        assetType: body.asset_type,
        requestedSources: Array.isArray(body.sources) ? (body.sources as TrendPlatformSource[]) : undefined,
        config: body.config,
      });

      // Synchronously execute run if requested (default to true for immediate results)
      const executeNow = body.execute !== false;
      if (executeNow) {
        try {
          const runResult = await orchestrator.runJob(job.id);
          return jsonResponse(
            {
              job: runResult.job,
              opportunity: runResult.opportunity,
              concepts: runResult.concepts,
              signalCount: runResult.signalCount,
              totalCostUsd: runResult.totalCostUsd,
            },
            201,
            req,
            {},
          );
        } catch (err: any) {
          return jsonResponse({ error: { code: "execution_failed", message: err?.message || String(err) } }, 500, req, {});
        }
      }

      return jsonResponse({ job }, 201, req, {});
    }
    return null;
  }

  // 3. /api/trends/jobs/:id/*
  if (path.startsWith("jobs/")) {
    const sub = path.slice("jobs/".length);
    const parts = sub.split("/");
    const jobId = parts[0];
    const action = parts[1];

    if (!jobId) return badRequest(req, "Missing jobId in URL");

    const job = orchestrator.getJob(jobId);
    if (!job) return notFound(req, `Research job "${jobId}" not found`);

    if (!action) {
      if (req.method === "GET") {
        const opps = orchestrator.getJobOpportunities(jobId);
        const concepts = orchestrator.getJobConcepts(jobId);
        return jsonResponse({ job, opportunities: opps, concepts }, 200, req, {});
      }
      return null;
    }

    if (action === "cancel" && req.method === "POST") {
      const ok = orchestrator.cancelJob(jobId);
      return jsonResponse({ success: ok, jobId, status: ok ? "cancelled" : job.status }, 200, req, {});
    }

    if (action === "signals" && req.method === "GET") {
      const signals = orchestrator.getJobSignals(jobId);
      return jsonResponse({ jobId, signals, count: signals.length }, 200, req, {});
    }

    if (action === "opportunities" && req.method === "GET") {
      const opportunities = orchestrator.getJobOpportunities(jobId);
      return jsonResponse({ jobId, opportunities, count: opportunities.length }, 200, req, {});
    }

    if (action === "concepts" && req.method === "GET") {
      const concepts = orchestrator.getJobConcepts(jobId);
      return jsonResponse({ jobId, concepts, count: concepts.length }, 200, req, {});
    }

    return null;
  }

  // 4. POST /api/trends/concepts/:id/dispatch
  if (path.startsWith("concepts/")) {
    const sub = path.slice("concepts/".length);
    const parts = sub.split("/");
    const conceptId = parts[0];
    const action = parts[1];

    if (action === "dispatch" && req.method === "POST") {
      const result = orchestrator.dispatchConceptToStudio(conceptId);
      if (!result.success) {
        return badRequest(req, result.message);
      }
      return jsonResponse(result, 200, req, {});
    }
    return null;
  }

  // 5. GET /api/trends/actors
  if (path === "actors") {
    if (req.method === "GET") {
      const category = url.searchParams.get("category") || undefined;
      const actors = actorRegistry.listActors(category);
      return jsonResponse({ actors, count: actors.length }, 200, req, {});
    }
    return null;
  }

  // 6. GET /api/trends/costs
  if (path === "costs") {
    if (req.method === "GET") {
      const cost = orchestrator.getCostSummary();
      return jsonResponse({ cost }, 200, req, {});
    }
    return null;
  }

  return null;
}
