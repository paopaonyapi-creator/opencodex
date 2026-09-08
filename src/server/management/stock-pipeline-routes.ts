// End-to-End Autonomous Stock Production & Submission Pipeline — Management API Routes
//
// Endpoints under /api/stock/pipeline/* (and /api/agent-os/stock/pipeline/*):
// - POST /api/stock/pipeline/run — start full autonomous pipeline run
// - POST /api/stock/pipeline/create — create new pipeline run
// - GET  /api/stock/pipeline/runs — list pipeline runs
// - GET  /api/stock/pipeline/runs/:id — get run detail and stage outputs
// - POST /api/stock/pipeline/runs/:id/step — trigger specific stage
// - POST /api/stock/pipeline/runs/:id/finalize — submit approval/rejection decision
// - POST /api/stock/pipeline/runs/:id/cancel — cancel pipeline run

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getStockPipelineEngine } from "../../agent-os/stock-pipeline/pipeline-engine";
import type { PipelineStatus, StartPipelineInput } from "../../agent-os/stock-pipeline/types";

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_body", message } }, 400, req, {});
}

export async function handleStockPipelineRoutes(
  ctx: ManagementContext,
): Promise<Response | null> {
  const { url, req } = ctx;

  let subPath = "";
  if (url.pathname.startsWith("/api/stock/pipeline/")) {
    subPath = url.pathname.slice("/api/stock/pipeline/".length);
  } else if (url.pathname.startsWith("/api/agent-os/stock/pipeline/")) {
    subPath = url.pathname.slice("/api/agent-os/stock/pipeline/".length);
  } else if (url.pathname === "/api/stock/pipeline" || url.pathname === "/api/agent-os/stock/pipeline") {
    subPath = "";
  } else {
    return null;
  }

  const engine = getStockPipelineEngine();

  // POST /api/stock/pipeline/run
  if (req.method === "POST" && subPath === "run") {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return badRequest(req, "Invalid JSON body");
    }

    if (!body.query || typeof body.query !== "string") {
      return badRequest(req, "query is required");
    }

    const input: StartPipelineInput = {
      query: body.query.trim(),
      market: typeof body.market === "string" ? body.market : "US",
      targetAssetCount: typeof body.targetAssetCount === "number" ? body.targetAssetCount : 10,
      autoDispatchGen: body.autoDispatchGen !== false,
      skipBrowserUpload: Boolean(body.skipBrowserUpload),
      targetDomain: typeof body.targetDomain === "string" ? body.targetDomain : "stock.adobe.com",
    };

    const run = await engine.runFullPipeline(input);
    return jsonResponse({ ok: true, run }, 200, req, {});
  }

  // POST /api/stock/pipeline/create
  if (req.method === "POST" && subPath === "create") {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return badRequest(req, "Invalid JSON body");
    }

    if (!body.query || typeof body.query !== "string") {
      return badRequest(req, "query is required");
    }

    const run = engine.createPipelineRun({
      query: body.query.trim(),
      market: typeof body.market === "string" ? body.market : "US",
      targetAssetCount: typeof body.targetAssetCount === "number" ? body.targetAssetCount : 10,
    });
    return jsonResponse({ ok: true, run }, 201, req, {});
  }

  // GET /api/stock/pipeline/runs
  if (req.method === "GET" && (subPath === "runs" || subPath === "")) {
    const status = url.searchParams.get("status") as PipelineStatus | null;
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : 50;

    const runs = engine.listPipelineRuns({
      status: status || undefined,
      limit,
    });
    return jsonResponse({ ok: true, count: runs.length, runs }, 200, req, {});
  }

  // Routes with run ID
  const match = subPath.match(/^runs\/([^/]+)(?:\/(step|finalize|cancel))?$/);
  if (match) {
    const runId = match[1];
    const action = match[2];

    // GET /api/stock/pipeline/runs/:id
    if (req.method === "GET" && !action) {
      const run = engine.getPipelineRun(runId);
      if (!run) return notFound(req, `Pipeline run '${runId}' not found`);
      return jsonResponse({ ok: true, run }, 200, req, {});
    }

    // POST /api/stock/pipeline/runs/:id/step
    if (req.method === "POST" && action === "step") {
      let body: Record<string, unknown> = {};
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        return badRequest(req, "Invalid JSON body");
      }

      const stage = Number(body.stage || 1);
      const targetDomain = typeof body.targetDomain === "string" ? body.targetDomain : "stock.adobe.com";

      switch (stage) {
        case 1:
          return jsonResponse({ ok: true, ...(await engine.stepTrends(runId)) }, 200, req, {});
        case 2:
          return jsonResponse({ ok: true, ...engine.stepPlanCampaign(runId) }, 200, req, {});
        case 3:
          return jsonResponse({ ok: true, ...engine.stepDispatchGeneration(runId) }, 200, req, {});
        case 4:
          return jsonResponse({ ok: true, ...engine.stepRunQc(runId) }, 200, req, {});
        case 5:
          return jsonResponse({ ok: true, ...engine.stepPackageManifest(runId) }, 200, req, {});
        case 6:
          return jsonResponse(
            { ok: true, ...(await engine.stepPrepareBrowserMission(runId, targetDomain)) },
            200,
            req,
            {},
          );
        default:
          return badRequest(req, `Invalid stage '${stage}'. Must be 1 to 6.`);
      }
    }

    // POST /api/stock/pipeline/runs/:id/finalize
    if (req.method === "POST" && action === "finalize") {
      let body: Record<string, unknown> = {};
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        return badRequest(req, "Invalid JSON body");
      }

      const decision = String(body.decision || "approve") as "approve" | "reject";
      const reason = typeof body.reason === "string" ? body.reason : undefined;

      const res = engine.stepFinalizeSubmission(runId, decision, reason);
      return jsonResponse({ ok: true, ...res }, 200, req, {});
    }

    // POST /api/stock/pipeline/runs/:id/cancel
    if (req.method === "POST" && action === "cancel") {
      let body: Record<string, unknown> = {};
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        // empty is fine
      }
      const reason = typeof body.reason === "string" ? body.reason : "Cancelled by operator";
      const run = engine.getPipelineRun(runId);
      if (!run) return notFound(req, `Pipeline run '${runId}' not found`);

      if (run.approvalId && run.status === "waiting_approval") {
        engine.stepFinalizeSubmission(runId, "reject", reason);
      }
      return jsonResponse({ ok: true, run: engine.getPipelineRun(runId) }, 200, req, {});
    }
  }

  return notFound(req, `Unknown stock pipeline endpoint: ${url.pathname}`);
}
