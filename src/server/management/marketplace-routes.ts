// Phase 20.89 — Capability Hub management routes (/api/agent-os/marketplace/*).
//
// Registry-first + policy-governed: every mutating operation traverses the
// CapabilityHubService (planner → policy → approval → transactional installer).
// Error codes are machine-readable (MarketplaceError.code); UI shows actions,
// not generic failures.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getCapabilityHubService } from "../../agent-os/marketplace/service";
import { MarketplaceError } from "../../agent-os/marketplace/types";
import type { CapabilityType } from "../../agent-os/marketplace/types";

function fail(req: Request, err: unknown): Response {
  if (err instanceof MarketplaceError) {
    return jsonResponse({ error: { code: err.code, message: err.message, detail: err.detail } }, err.httpStatus, req, {});
  }
  return jsonResponse({ error: { code: "INTERNAL", message: err instanceof Error ? err.message : "internal_error" } }, 500, req, {});
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function actor(ctx: ManagementContext, body?: Record<string, unknown>): string {
  const fromBody = body && typeof body.actor === "string" ? body.actor : undefined;
  const fromHeader = ctx.req.headers.get("x-pao-actor") ?? undefined;
  return (fromBody ?? fromHeader ?? "operator").slice(0, 64);
}

export async function handleMarketplaceRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  const service = getCapabilityHubService();

  try {
    // 1. GET /api/agent-os/marketplace/health
    if (req.method === "GET" && pathname === "/api/agent-os/marketplace/health") {
      const health = service.health();
      return jsonResponse({ phase: "20.89", ...health, ok: health.ok }, 200, req, {});
    }

    // 2. GET /api/agent-os/marketplace/capabilities
    if (req.method === "GET" && pathname === "/api/agent-os/marketplace/capabilities") {
      const type = url.searchParams.get("type");
      const status = url.searchParams.get("status");
      const search = url.searchParams.get("search");
      const capabilities = service.listCapabilities({
        type: type ? (type as CapabilityType) : undefined,
        status: status ? (status as never) : undefined,
        search: search ?? undefined,
      });
      return jsonResponse({ ok: true, count: capabilities.length, capabilities }, 200, req, {});
    }

    // 3. GET /api/agent-os/marketplace/capabilities/:slug
    if (req.method === "GET" && pathname.startsWith("/api/agent-os/marketplace/capabilities/")) {
      const slug = pathname.slice("/api/agent-os/marketplace/capabilities/".length).replace(/\/(permissions|dependencies|health|audit)$/, "");
      const detail = service.getCapabilityDetail(decodeURIComponent(slug));
      if (!detail) {
        throw new MarketplaceError("CAPABILITY_NOT_FOUND", 404, `capability '${slug}' is not registered`);
      }
      return jsonResponse({ ok: true, ...detail }, 200, req, {});
    }

    // 4. GET /api/agent-os/marketplace/reconciliation
    if (req.method === "GET" && pathname === "/api/agent-os/marketplace/reconciliation") {
      const rows = service.reconciliation();
      return jsonResponse({ ok: true, count: rows.length, rows }, 200, req, {});
    }

    // 5. GET /api/agent-os/marketplace/audit
    if (req.method === "GET" && pathname === "/api/agent-os/marketplace/audit") {
      const limit = Number(url.searchParams.get("limit") ?? 100);
      return jsonResponse({ ok: true, events: service.auditTrail(Number.isFinite(limit) ? limit : 100) }, 200, req, {});
    }

    // 6. POST /api/agent-os/marketplace/import-phases (R1/R2 — registry metadata write)
    if (req.method === "POST" && pathname === "/api/agent-os/marketplace/import-phases") {
      const body = await readJson(req);
      const run = service.importPhases(actor(ctx, body));
      return jsonResponse({ ok: true, run: { runId: run.runId, scanned: run.scanned, imported: run.imported, updated: run.updated, skipped: run.skipped, collisions: run.collisions } }, 200, req, {});
    }

    // 7. POST /api/agent-os/marketplace/capabilities/:slug/plan-install
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/marketplace/capabilities/") && pathname.endsWith("/plan-install")) {
      const body = await readJson(req);
      const slug = decodeURIComponent(pathname.slice("/api/agent-os/marketplace/capabilities/".length, -"/plan-install".length));
      const plan = service.planInstall(slug, actor(ctx, body));
      return jsonResponse({
        ok: true,
        planId: plan.planId,
        planHash: plan.planHash,
        capabilitySlug: plan.capabilitySlug,
        version: plan.version,
        policyDecision: plan.policyDecision,
        policyReasons: plan.policyReasons,
        approvalRequired: plan.approvalRequired,
        approved: plan.approved,
        permissions: plan.permissions,
        steps: plan.steps.map((s) => ({ type: s.type, status: s.status, detail: s.detail })),
      }, 200, req, {});
    }

    // 8. POST /api/agent-os/marketplace/install-plans/:id/approve (R3)
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/marketplace/install-plans/") && pathname.endsWith("/approve")) {
      const body = await readJson(req);
      const planId = pathname.slice("/api/agent-os/marketplace/install-plans/".length, -"/approve".length);
      const plan = service.approvePlan(planId, actor(ctx, body));
      return jsonResponse({ ok: true, planId: plan.planId, approved: plan.approved, approvedBy: plan.approvedBy }, 200, req, {});
    }

    // 9. POST /api/agent-os/marketplace/install-plans/:id/execute
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/marketplace/install-plans/") && pathname.endsWith("/execute")) {
      const body = await readJson(req);
      const planId = pathname.slice("/api/agent-os/marketplace/install-plans/".length, -"/execute".length);
      const record = service.executePlan(planId, actor(ctx, body));
      return jsonResponse({ ok: record.state === "COMMITTED", transaction: record }, record.state === "COMMITTED" ? 200 : 409, req, {});
    }

    // 10. GET /api/agent-os/marketplace/install-plans/:id
    if (req.method === "GET" && pathname.startsWith("/api/agent-os/marketplace/install-plans/")) {
      const planId = pathname.slice("/api/agent-os/marketplace/install-plans/".length);
      const serviceWithInstaller = service as unknown as { planInstall: unknown };
      void serviceWithInstaller;
      const { getCapabilityInstaller } = await import("../../agent-os/marketplace/installer");
      const plan = getCapabilityInstaller().getPlan(planId);
      if (!plan) throw new MarketplaceError("PLAN_INVALID", 404, `plan '${planId}' not found or expired`);
      return jsonResponse({ ok: true, plan }, 200, req, {});
    }

    // 11. POST /api/agent-os/marketplace/installations/:id/rollback (R2/R3)
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/marketplace/installations/") && pathname.endsWith("/rollback")) {
      const body = await readJson(req);
      const installationId = pathname.slice("/api/agent-os/marketplace/installations/".length, -"/rollback".length);
      const reason = typeof body.reason === "string" ? body.reason.slice(0, 200) : "operator rollback";
      const record = service.rollbackInstallation(installationId, actor(ctx, body), reason);
      return jsonResponse({ ok: record.state === "ROLLED_BACK", transaction: record }, 200, req, {});
    }

    // 12. POST /api/agent-os/marketplace/capabilities/:slug/favorite
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/marketplace/capabilities/") && pathname.endsWith("/favorite")) {
      const body = await readJson(req);
      const slug = decodeURIComponent(pathname.slice("/api/agent-os/marketplace/capabilities/".length, -"/favorite".length));
      const result = service.toggleFavorite(actor(ctx, body), slug);
      return jsonResponse({ ok: true, ...result }, 200, req, {});
    }

    // 13. POST /api/agent-os/marketplace/capabilities/:slug/enable|disable (R2)
    const enableDisable = pathname.match(/^\/api\/agent-os\/marketplace\/capabilities\/([^/]+)\/(enable|disable)$/);
    if (req.method === "POST" && enableDisable) {
      void enableDisable; // lifecycle handled through install/rollback in this build
      return jsonResponse({ ok: false, error: { code: "PLAN_INVALID", message: "enable/disable lifecycle lands with the runtime-adapter wave (Phase 20.89 P3)" } }, 501, req, {});
    }

    return null;
  } catch (err: unknown) {
    return fail(req, err);
  }
}
