// Phase 30.36 — Pao Business Builder routes (repo convention:
// /api/agent-os/business/*). Full-literal pathname guards; ids in the JSON
// body (repo precedent); imported content is treated as untrusted data.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getBusinessBuilderService } from "../../agent-os/business-builder/service";
import { BusinessError } from "../../agent-os/business-builder/sources";

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
  const status = code === "NOT_FOUND" ? 404 : code === "VALIDATION_ERROR" || code === "BUDGET_EXCEEDED" ? 400 : code === "POLICY_BLOCKED" ? 403 : 422;
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

export async function handleBusinessBuilderRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  const service = getBusinessBuilderService();

  // 1. GET /api/agent-os/business/opportunities
  if (req.method === "GET" && pathname === "/api/agent-os/business/opportunities") {
    const limitParam = Number.parseInt(url.searchParams.get("limit") || "", 10);
    return jsonResponse({ ok: true, data: { opportunities: service.listOpportunities({
      status: url.searchParams.get("status") || undefined,
      market: url.searchParams.get("market") || undefined,
      limit: Number.isFinite(limitParam) ? limitParam : 100,
    }) } }, 200, req, {});
  }

  // 2. POST /api/agent-os/business/opportunities (manual create)
  if (req.method === "POST" && pathname === "/api/agent-os/business/opportunities") {
    const body = await readJsonBody(req);
    try {
      const opportunity = service.upsertManual({ opportunity: body.opportunity as Record<string, never>, actor: typeof body.actor === "string" ? body.actor : "dashboard", reason: typeof body.reason === "string" ? body.reason : undefined });
      return jsonResponse({ ok: true, data: { opportunity } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 3. POST /api/agent-os/business/opportunities/detail
  if (req.method === "POST" && pathname === "/api/agent-os/business/opportunities/detail") {
    const body = await readJsonBody(req);
    if (typeof body.opportunityId !== "string") return badRequest(req, "Field 'opportunityId' is required");
    const opportunity = service.getOpportunity(body.opportunityId);
    if (!opportunity) return notFound(req, `Opportunity not found: ${body.opportunityId}`);
    return jsonResponse({ ok: true, data: { opportunity, versions: service.listOpportunityVersions(body.opportunityId) } }, 200, req, {});
  }

  // 4. POST /api/agent-os/business/opportunities/score
  if (req.method === "POST" && pathname === "/api/agent-os/business/opportunities/score") {
    const body = await readJsonBody(req);
    if (typeof body.opportunityId !== "string") return badRequest(req, "Field 'opportunityId' is required");
    try {
      const score = service.score(body.opportunityId, typeof body.actor === "string" ? body.actor : "dashboard");
      const opportunity = service.getOpportunity(body.opportunityId)!;
      return jsonResponse({ ok: true, data: { score, paoFit: opportunity.paoFitScore } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 5. POST /api/agent-os/business/opportunities/pao-fit
  if (req.method === "POST" && pathname === "/api/agent-os/business/opportunities/pao-fit") {
    const body = await readJsonBody(req);
    if (typeof body.opportunityId !== "string") return badRequest(req, "Field 'opportunityId' is required");
    try {
      return jsonResponse({ ok: true, data: service.computePaoFitFor(body.opportunityId) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 6. POST /api/agent-os/business/opportunities/compliance
  if (req.method === "POST" && pathname === "/api/agent-os/business/opportunities/compliance") {
    const body = await readJsonBody(req);
    if (typeof body.opportunityId !== "string") return badRequest(req, "Field 'opportunityId' is required");
    try {
      if (body.review === true) {
        return jsonResponse({ ok: true, data: service.reviewCompliance(body.opportunityId, typeof body.actor === "string" ? body.actor : "dashboard") }, 200, req, {});
      }
      return jsonResponse({ ok: true, data: service.checkCompliance(body.opportunityId) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 7. POST /api/agent-os/business/opportunities/cost
  if (req.method === "POST" && pathname === "/api/agent-os/business/opportunities/cost") {
    const body = await readJsonBody(req);
    if (typeof body.opportunityId !== "string") return badRequest(req, "Field 'opportunityId' is required");
    try {
      return jsonResponse({ ok: true, data: service.estimateCostFor(body.opportunityId, (body.apiMonthly ?? {}) as Record<string, number>) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 8. POST /api/agent-os/business/opportunities/compare
  if (req.method === "POST" && pathname === "/api/agent-os/business/opportunities/compare") {
    const body = await readJsonBody(req);
    if (!Array.isArray(body.opportunityIds)) return badRequest(req, "Field 'opportunityIds' (2–5 ids) is required");
    try {
      return jsonResponse({ ok: true, data: service.compare(body.opportunityIds as string[]) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 9. POST /api/agent-os/business/opportunities/compile
  if (req.method === "POST" && pathname === "/api/agent-os/business/opportunities/compile") {
    const body = await readJsonBody(req);
    if (typeof body.opportunityId !== "string") return badRequest(req, "Field 'opportunityId' is required");
    try {
      const spec = service.compileMvp(body.opportunityId, typeof body.actor === "string" ? body.actor : "dashboard");
      return jsonResponse({ ok: !spec.blocked, data: { spec } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 10. POST /api/agent-os/business/opportunities/codex-pack
  if (req.method === "POST" && pathname === "/api/agent-os/business/opportunities/codex-pack") {
    const body = await readJsonBody(req);
    if (typeof body.opportunityId !== "string") return badRequest(req, "Field 'opportunityId' is required");
    try {
      const pack = service.generateCodexPack(body.opportunityId, typeof body.actor === "string" ? body.actor : "dashboard");
      return jsonResponse({ ok: true, data: { slug: pack.slug, outputDir: pack.outputDir, artifacts: pack.artifacts } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 11. POST /api/agent-os/business/opportunities/archive
  if (req.method === "POST" && pathname === "/api/agent-os/business/opportunities/archive") {
    const body = await readJsonBody(req);
    if (typeof body.opportunityId !== "string") return badRequest(req, "Field 'opportunityId' is required");
    service.archive(body.opportunityId, typeof body.actor === "string" ? body.actor : "dashboard");
    return jsonResponse({ ok: true, data: { archived: true } }, 200, req, {});
  }

  // 12. POST /api/agent-os/business/import/playbooks
  if (req.method === "POST" && pathname === "/api/agent-os/business/import/playbooks") {
    const body = await readJsonBody(req);
    try {
      return jsonResponse({ ok: true, data: service.importPlaybooks({
        dryRun: body.dryRun === true,
        sourceDir: typeof body.sourceDir === "string" ? body.sourceDir : undefined,
        actor: typeof body.actor === "string" ? body.actor : "dashboard",
      }) }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 13. GET /api/agent-os/business/import/history
  if (req.method === "GET" && pathname === "/api/agent-os/business/import/history") {
    const limitParam = Number.parseInt(url.searchParams.get("limit") || "", 10);
    return jsonResponse({ ok: true, data: { imports: service.listImportHistory(Number.isFinite(limitParam) ? limitParam : 20) } }, 200, req, {});
  }

  // 14. GET /api/agent-os/business/capabilities
  if (req.method === "GET" && pathname === "/api/agent-os/business/capabilities") {
    return jsonResponse({ ok: true, data: { capabilities: service.listCapabilities() } }, 200, req, {});
  }

  // 15. POST /api/agent-os/business/capabilities/refresh
  if (req.method === "POST" && pathname === "/api/agent-os/business/capabilities/refresh") {
    return jsonResponse({ ok: true, data: { capabilities: service.refreshCapabilities() } }, 200, req, {});
  }

  // 16. GET /api/agent-os/business/experiments
  if (req.method === "GET" && pathname === "/api/agent-os/business/experiments") {
    return jsonResponse({ ok: true, data: { experiments: service.listExperiments(url.searchParams.get("opportunityId") || undefined) } }, 200, req, {});
  }

  // 17. POST /api/agent-os/business/experiments
  if (req.method === "POST" && pathname === "/api/agent-os/business/experiments") {
    const body = await readJsonBody(req);
    if (typeof body.opportunityId !== "string") return badRequest(req, "Field 'opportunityId' is required");
    try {
      const experiment = service.createExperiment({
        opportunityId: body.opportunityId,
        hypothesis: typeof body.hypothesis === "string" ? body.hypothesis : "",
        customerSegment: typeof body.customerSegment === "string" ? body.customerSegment : "",
        offer: typeof body.offer === "string" ? body.offer : "",
        price: typeof body.price === "number" ? body.price : 0,
        currency: typeof body.currency === "string" ? body.currency : undefined,
        acquisitionChannel: typeof body.acquisitionChannel === "string" ? body.acquisitionChannel : undefined,
        landingPageUrl: typeof body.landingPageUrl === "string" ? body.landingPageUrl : undefined,
        actor: typeof body.actor === "string" ? body.actor : "dashboard",
      });
      return jsonResponse({ ok: true, data: { experiment } }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 18. POST /api/agent-os/business/experiments/metrics
  if (req.method === "POST" && pathname === "/api/agent-os/business/experiments/metrics") {
    const body = await readJsonBody(req);
    if (typeof body.experimentId !== "string" || !(body.metrics && typeof body.metrics === "object")) {
      return badRequest(req, "Fields 'experimentId' and 'metrics' are required");
    }
    try {
      return jsonResponse({ ok: true, data: service.updateMetrics(body.experimentId, body.metrics as Record<string, number>, typeof body.actor === "string" ? body.actor : "dashboard") }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 19. POST /api/agent-os/business/experiments/evaluate
  if (req.method === "POST" && pathname === "/api/agent-os/business/experiments/evaluate") {
    const body = await readJsonBody(req);
    if (typeof body.experimentId !== "string") return badRequest(req, "Field 'experimentId' is required");
    try {
      return jsonResponse({ ok: true, data: service.evaluateExperiment(body.experimentId, typeof body.actor === "string" ? body.actor : "dashboard") }, 200, req, {});
    } catch (err) {
      return errorResponse(req, err);
    }
  }

  // 20. GET /api/agent-os/business/audit
  if (req.method === "GET" && pathname === "/api/agent-os/business/audit") {
    const limitParam = Number.parseInt(url.searchParams.get("limit") || "", 10);
    return jsonResponse({ ok: true, data: { entries: service.listAudit(Number.isFinite(limitParam) ? limitParam : 50) } }, 200, req, {});
  }

  return null;
}

// BusinessError re-exported for typed handling in the chain.
export { BusinessError };
