// Phase 20.34 — Pao-hubPro × Lead Gen API Stack: Lead Intelligence Control
// Plane routes (repo convention: /api/agent-os/leads/*). Full-literal pathname
// guards; entity ids travel in the JSON body (Phase 20.29/20.33 precedent).

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getLeadService } from "../../agent-os/leads/service-core";
import { LeadError } from "../../agent-os/leads/errors";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ ok: false, error: { code: "VALIDATION_ERROR", message } }, 400, req, {});
}

function notFound(req: Request, message: string): Response {
  return jsonResponse({ ok: false, error: { code: "NOT_FOUND", message } }, 404, req, {});
}

function errorResponse(req: Request, err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  const match = message.match(/^\[([A-Z_]+)\]/);
  const code = match ? match[1] : "INTERNAL_ERROR";
  const status = code === "NOT_FOUND" ? 404 : code === "VALIDATION_ERROR" || code === "BUDGET_EXCEEDED" ? 400 : code === "POLICY_BLOCKED" || code === "APPROVAL_REQUIRED" ? 403 : 422;
  return jsonResponse({ ok: false, error: { code, message } }, status, req, {});
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function handleLeadRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  const service = getLeadService();

  // 1. POST /api/agent-os/leads/search
  if (req.method === "POST" && pathname === "/api/agent-os/leads/search") {
    const body = await readJsonBody(req);
    try {
      const job = await service.search({
        query: (body.query ?? body) as Record<string, unknown>,
        strategy: typeof body.strategy === "string" ? (body.strategy as never) : undefined,
        budget: body.budget as Record<string, unknown> | undefined,
        actor: typeof body.actor === "string" ? body.actor : "dashboard",
      });
      return jsonResponse({ ok: true, data: { job } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 2. POST /api/agent-os/leads/cost-estimate (pre-run cost preview, §15)
  if (req.method === "POST" && pathname === "/api/agent-os/leads/cost-estimate") {
    const body = await readJsonBody(req);
    try {
      const estimate = await service.estimateSearchCost({ query: (body.query ?? {}) as Record<string, unknown>, strategy: typeof body.strategy === "string" ? (body.strategy as never) : undefined });
      return jsonResponse({ ok: true, data: estimate }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 3. GET /api/agent-os/leads/jobs
  if (req.method === "GET" && pathname === "/api/agent-os/leads/jobs") {
    const limitParam = Number.parseInt(url.searchParams.get("limit") || "", 10);
    return jsonResponse({ ok: true, data: { jobs: service.listJobs(Number.isFinite(limitParam) ? limitParam : 50) } }, 200, req, {});
  }

  // 4. POST /api/agent-os/leads/jobs/detail
  if (req.method === "POST" && pathname === "/api/agent-os/leads/jobs/detail") {
    const body = await readJsonBody(req);
    if (typeof body.jobId !== "string") return badRequest(req, "Field 'jobId' is required");
    const job = service.getJob(body.jobId);
    if (!job) return notFound(req, `Lead job not found: ${body.jobId}`);
    return jsonResponse({ ok: true, data: { job } }, 200, req, {});
  }

  // 5. POST /api/agent-os/leads/jobs/approve (human only)
  if (req.method === "POST" && pathname === "/api/agent-os/leads/jobs/approve") {
    const body = await readJsonBody(req);
    if (typeof body.jobId !== "string") return badRequest(req, "Field 'jobId' is required");
    try {
      const job = service.approveJob(body.jobId, typeof body.actor === "string" ? body.actor : "dashboard");
      return jsonResponse({ ok: true, data: { job } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 6. POST /api/agent-os/leads/jobs/cancel
  if (req.method === "POST" && pathname === "/api/agent-os/leads/jobs/cancel") {
    const body = await readJsonBody(req);
    if (typeof body.jobId !== "string") return badRequest(req, "Field 'jobId' is required");
    try {
      const job = service.cancelJob(body.jobId, typeof body.actor === "string" ? body.actor : "dashboard");
      return jsonResponse({ ok: true, data: { job } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 7. GET /api/agent-os/leads (list with status/kind filters)
  if (req.method === "GET" && pathname === "/api/agent-os/leads") {
    const status = url.searchParams.get("status") || undefined;
    const kind = url.searchParams.get("kind") || undefined;
    const limitParam = Number.parseInt(url.searchParams.get("limit") || "", 10);
    return jsonResponse({ ok: true, data: { leads: service.listLeads({ status, kind, limit: Number.isFinite(limitParam) ? limitParam : 100 }) } }, 200, req, {});
  }

  // 8. POST /api/agent-os/leads/detail (lead + contacts + sources + evidence)
  if (req.method === "POST" && pathname === "/api/agent-os/leads/detail") {
    const body = await readJsonBody(req);
    if (typeof body.leadId !== "string") return badRequest(req, "Field 'leadId' is required");
    const detail = service.leadDetail(body.leadId);
    if (!detail) return notFound(req, `Lead not found: ${body.leadId}`);
    return jsonResponse({ ok: true, data: detail }, 200, req, {});
  }

  // 9. POST /api/agent-os/leads/enrich
  if (req.method === "POST" && pathname === "/api/agent-os/leads/enrich") {
    const body = await readJsonBody(req);
    if (typeof body.leadId !== "string") return badRequest(req, "Field 'leadId' is required");
    try {
      const job = await service.enrich({ leadId: body.leadId, actor: typeof body.actor === "string" ? body.actor : "dashboard" });
      return jsonResponse({ ok: true, data: { job } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 10. POST /api/agent-os/leads/verify
  if (req.method === "POST" && pathname === "/api/agent-os/leads/verify") {
    const body = await readJsonBody(req);
    if (typeof body.leadId !== "string") return badRequest(req, "Field 'leadId' is required");
    try {
      const job = await service.verify({ leadId: body.leadId, actor: typeof body.actor === "string" ? body.actor : "dashboard" });
      return jsonResponse({ ok: true, data: { job } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 11. POST /api/agent-os/leads/score
  if (req.method === "POST" && pathname === "/api/agent-os/leads/score") {
    const body = await readJsonBody(req);
    if (typeof body.leadId !== "string") return badRequest(req, "Field 'leadId' is required");
    try {
      const outcome = service.score({
        leadId: body.leadId,
        profileId: typeof body.profileId === "string" ? body.profileId : undefined,
        industryKeywords: Array.isArray(body.industryKeywords) ? (body.industryKeywords as string[]) : undefined,
        region: typeof body.region === "string" ? body.region : undefined,
        actor: typeof body.actor === "string" ? body.actor : "dashboard",
      });
      return jsonResponse({ ok: true, data: outcome }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 12. GET /api/agent-os/leads/providers
  if (req.method === "GET" && pathname === "/api/agent-os/leads/providers") {
    return jsonResponse({ ok: true, data: { providers: service.listProviders(), scoringProfiles: service.scoringProfiles() } }, 200, req, {});
  }

  // 13. POST /api/agent-os/leads/providers/test
  if (req.method === "POST" && pathname === "/api/agent-os/leads/providers/test") {
    const body = await readJsonBody(req);
    if (typeof body.providerId !== "string") return badRequest(req, "Field 'providerId' is required");
    try {
      return jsonResponse({ ok: true, data: await service.testProvider(body.providerId, typeof body.actor === "string" ? body.actor : "dashboard") }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 14. POST /api/agent-os/leads/providers/enable (human only)
  if (req.method === "POST" && pathname === "/api/agent-os/leads/providers/enable") {
    const body = await readJsonBody(req);
    if (typeof body.providerId !== "string") return badRequest(req, "Field 'providerId' is required");
    try {
      service.setProviderEnabled(body.providerId, body.enabled !== false, typeof body.actor === "string" ? body.actor : "dashboard");
      return jsonResponse({ ok: true, data: { providerId: body.providerId, enabled: body.enabled !== false } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 15. GET /api/agent-os/leads/pipelines
  if (req.method === "GET" && pathname === "/api/agent-os/leads/pipelines") {
    return jsonResponse({ ok: true, data: { pipelines: service.listPipelines(), runs: service.listPipelineRuns(15) } }, 200, req, {});
  }

  // 16. POST /api/agent-os/leads/pipelines/run
  if (req.method === "POST" && pathname === "/api/agent-os/leads/pipelines/run") {
    const body = await readJsonBody(req);
    if (typeof body.pipelineId !== "string") return badRequest(req, "Field 'pipelineId' is required");
    try {
      const run = await service.runPipeline(body.pipelineId, (body.request ?? {}) as Record<string, unknown>, typeof body.actor === "string" ? body.actor : "dashboard");
      return jsonResponse({ ok: true, data: { run } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 17. POST /api/agent-os/leads/pipelines/detail
  if (req.method === "POST" && pathname === "/api/agent-os/leads/pipelines/detail") {
    const body = await readJsonBody(req);
    if (typeof body.runId !== "string") return badRequest(req, "Field 'runId' is required");
    const run = service.getPipelineRun(body.runId);
    if (!run) return notFound(req, `Pipeline run not found: ${body.runId}`);
    return jsonResponse({ ok: true, data: { run } }, 200, req, {});
  }

  // 18. POST /api/agent-os/leads/exports (create; suppression + audit inside)
  if (req.method === "POST" && pathname === "/api/agent-os/leads/exports") {
    const body = await readJsonBody(req);
    const format = body.format === "json" ? "json" : "csv";
    try {
      const outcome = await service.exportLeads({
        format,
        actor: typeof body.actor === "string" ? body.actor : "dashboard",
        filters: { status: typeof body.status === "string" ? body.status : undefined, kind: typeof body.kind === "string" ? body.kind : undefined },
      });
      return jsonResponse({ ok: true, data: { id: outcome.id, rowCount: outcome.rowCount, content: outcome.content } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 19. POST /api/agent-os/leads/exports/detail
  if (req.method === "POST" && pathname === "/api/agent-os/leads/exports/detail") {
    const body = await readJsonBody(req);
    if (typeof body.exportId !== "string") return badRequest(req, "Field 'exportId' is required");
    const record = service.getExport(body.exportId);
    if (!record) return notFound(req, `Export not found: ${body.exportId}`);
    return jsonResponse({ ok: true, data: record }, 200, req, {});
  }

  // 20. GET /api/agent-os/leads/suppression
  if (req.method === "GET" && pathname === "/api/agent-os/leads/suppression") {
    return jsonResponse({ ok: true, data: { entries: service.listSuppression() } }, 200, req, {});
  }

  // 21. POST /api/agent-os/leads/suppression (add)
  if (req.method === "POST" && pathname === "/api/agent-os/leads/suppression") {
    const body = await readJsonBody(req);
    if (typeof body.matchType !== "string" || typeof body.matchValue !== "string" || typeof body.reason !== "string") {
      return badRequest(req, "Fields 'matchType', 'matchValue' and 'reason' are required");
    }
    try {
      const entry = service.addSuppression({
        matchType: body.matchType as never,
        matchValue: body.matchValue,
        reason: body.reason as never,
        actor: typeof body.actor === "string" ? body.actor : "dashboard",
      });
      return jsonResponse({ ok: true, data: { entry } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 22. POST /api/agent-os/leads/suppression/remove (human only)
  if (req.method === "POST" && pathname === "/api/agent-os/leads/suppression/remove") {
    const body = await readJsonBody(req);
    if (typeof body.entryId !== "string") return badRequest(req, "Field 'entryId' is required");
    try {
      service.removeSuppression(body.entryId, typeof body.actor === "string" ? body.actor : "dashboard");
      return jsonResponse({ ok: true, data: { removed: true } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 23. POST /api/agent-os/leads/suppression/check
  if (req.method === "POST" && pathname === "/api/agent-os/leads/suppression/check") {
    const body = await readJsonBody(req);
    if (typeof body.matchType !== "string" || typeof body.matchValue !== "string") {
      return badRequest(req, "Fields 'matchType' and 'matchValue' are required");
    }
    return jsonResponse({ ok: true, data: service.checkSuppression({ matchType: body.matchType as never, matchValue: body.matchValue }) }, 200, req, {});
  }

  // 24. GET /api/agent-os/leads/audit
  if (req.method === "GET" && pathname === "/api/agent-os/leads/audit") {
    const limitParam = Number.parseInt(url.searchParams.get("limit") || "", 10);
    return jsonResponse({ ok: true, data: { entries: service.listAudit(Number.isFinite(limitParam) ? limitParam : 50) } }, 200, req, {});
  }

  // 25. GET /api/agent-os/leads/costs
  if (req.method === "GET" && pathname === "/api/agent-os/leads/costs") {
    return jsonResponse({ ok: true, data: { summary: service.costSummary() } }, 200, req, {});
  }

  return null;
}
