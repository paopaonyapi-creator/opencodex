// Phase 20.1 — Pao ComfyUI Smart Queue Management API Routes.
//
// Endpoints under /api/generation/smart-queue/*:
// - status: Overall Smart Queue state, burst mode, metrics, provider lanes
// - snapshot: Live native ComfyUI queue snapshots (running / pending)
// - plan: Latest capacity scaling plan (explainability, cost, recommendation)
// - plan/refresh: Trigger immediate re-evaluation and produce fresh ScalePlan
// - plan/approve: Operator approval for assisted/manual burst plans
// - dispatch/pause: Pause bounded dispatch window
// - dispatch/resume: Resume bounded dispatch window
// - burst/mode: Set burst automation policy (OFF, MANUAL, ASSISTED, AUTO)
// - providers/:id/drain: Gracefully drain a provider lane and idle down
// - reconciliation: State drift inspection records between SQLite and ComfyUI
// - reconciliation/:id/resolve: Acknowledge or resolve a reconciliation anomaly

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getGenerationOrchestrator } from "../../agent-os/generation/orchestrator";
import { openAgentOsDb } from "../../agent-os/db";
import { recordGenerationAudit } from "../../agent-os/generation/queue";
import type { BurstMode } from "../../agent-os/generation/smart-queue/types";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_body", message } }, 400, req, {});
}

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

function forbidden(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "forbidden", message } }, 403, req, {});
}

function actorOf(ctx: ManagementContext): string {
  const principal = ctx.principal ?? "admin-token";
  if (typeof principal === "string") return principal;
  const role = (principal as { role?: string }).role;
  return role ? `session:${role}` : "session";
}

function requireMutationPrincipal(ctx: ManagementContext): Response | null {
  const principal = ctx.principal ?? "admin-token";
  const isStringPrincipal = typeof principal === "string";
  const isGuiOrAdmin = isStringPrincipal
    ? principal === "admin-token" || principal === "gui-session"
    : (principal as { role?: string }).role === "admin" ||
      (principal as { role?: string }).role === "reviewer" ||
      (principal as { role?: string }).role === "creator";
  if (isGuiOrAdmin) return null;
  return forbidden(ctx.req, "principal cannot mutate smart queue scheduling settings");
}

export async function handleSmartQueueRoutes(
  ctx: ManagementContext,
  subPath: string,
): Promise<Response | null> {
  const { req, url } = ctx;
  const orchestrator = getGenerationOrchestrator();
  const smartQueue = orchestrator.smartQueue;

  if (!smartQueue) {
    return jsonResponse(
      { error: { code: "smart_queue_disabled", message: "Smart Queue is disabled in configuration" } },
      503,
      req,
      {},
    );
  }

  // ---------------------------------------------------------- GET status
  if (subPath === "smart-queue/status" && req.method === "GET") {
    const db = openAgentOsDb();
    const leases = db.query(`
      SELECT * FROM gen_dispatch_leases
      WHERE expires_at > ?
      ORDER BY provider_id ASC, slot_index ASC
    `).all(Date.now()) as Array<{
      id: string;
      provider_id: string;
      slot_index: number;
      job_id: string | null;
      attempt_id: string | null;
      acquired_at: number;
      expires_at: number;
    }>;

    const queuedCount = (db.query("SELECT COUNT(*) as c FROM gen_jobs WHERE status = 'queued' AND cancel_requested = 0").get() as { c: number }).c;
    const snapshots = smartQueue.getAllSnapshots();
    const latestPlan = smartQueue.getLatestPlan();

    return jsonResponse({
      enabled: smartQueue.config.enabled,
      paused: smartQueue.paused,
      burstMode: smartQueue.config.burstMode,
      config: {
        burstSoftDepth: smartQueue.config.burstSoftDepth,
        burstHardDepth: smartQueue.config.burstHardDepth,
        targetDrainMinutes: smartQueue.config.targetDrainMinutes,
        maxPrefetchJobsPerProvider: smartQueue.config.maxPrefetchJobsPerProvider,
        minBurstTimeSavingPercent: smartQueue.config.minBurstTimeSavingPercent,
      },
      backlog: {
        queuedCount,
        activeLeasesCount: leases.length,
      },
      leases,
      snapshots,
      latestPlan,
    }, 200, req, {});
  }

  // ---------------------------------------------------------- GET snapshots
  if (subPath === "smart-queue/snapshot" && req.method === "GET") {
    return jsonResponse({ snapshots: smartQueue.getAllSnapshots() }, 200, req, {});
  }

  // ---------------------------------------------------------- GET latest plan
  if (subPath === "smart-queue/plan" && req.method === "GET") {
    return jsonResponse({ plan: smartQueue.getLatestPlan() }, 200, req, {});
  }

  // ---------------------------------------------------------- POST plan/refresh
  if (subPath === "smart-queue/plan/refresh" && req.method === "POST") {
    const guard = requireMutationPrincipal(ctx);
    if (guard) return guard;

    const tickResult = await smartQueue.tick();
    return jsonResponse({
      plan: tickResult.plan,
      scaleActionResult: tickResult.scaleActionResult,
      snapshots: tickResult.snapshots,
    }, 200, req, {});
  }

  // ---------------------------------------------------------- POST plan/approve
  if (subPath === "smart-queue/plan/approve" && req.method === "POST") {
    const guard = requireMutationPrincipal(ctx);
    if (guard) return guard;

    let body: { planId?: string } = {};
    try { body = await req.json(); } catch { return badRequest(req, "JSON body required"); }
    if (!body.planId) return badRequest(req, "planId is required");

    const result = await smartQueue.approvePlan(body.planId);
    recordGenerationAudit({
      actor: actorOf(ctx),
      action: "smart_queue.plan.approve",
      subjectType: "scale_plan",
      subjectId: body.planId,
      details: result,
    });

    return jsonResponse(result, result.success ? 200 : 400, req, {});
  }

  // ---------------------------------------------------------- POST dispatch/pause
  if (subPath === "smart-queue/dispatch/pause" && req.method === "POST") {
    const guard = requireMutationPrincipal(ctx);
    if (guard) return guard;

    smartQueue.pauseDispatch();
    recordGenerationAudit({
      actor: actorOf(ctx),
      action: "smart_queue.dispatch.pause",
      subjectType: "dispatch_window",
      subjectId: "all",
      details: {},
    });
    return jsonResponse({ ok: true, paused: true }, 200, req, {});
  }

  // ---------------------------------------------------------- POST dispatch/resume
  if (subPath === "smart-queue/dispatch/resume" && req.method === "POST") {
    const guard = requireMutationPrincipal(ctx);
    if (guard) return guard;

    smartQueue.resumeDispatch();
    recordGenerationAudit({
      actor: actorOf(ctx),
      action: "smart_queue.dispatch.resume",
      subjectType: "dispatch_window",
      subjectId: "all",
      details: {},
    });
    return jsonResponse({ ok: true, paused: false }, 200, req, {});
  }

  // ---------------------------------------------------------- POST burst/mode
  if (subPath === "smart-queue/burst/mode" && req.method === "POST") {
    const guard = requireMutationPrincipal(ctx);
    if (guard) return guard;

    let body: { mode?: string } = {};
    try { body = await req.json(); } catch { return badRequest(req, "JSON body required"); }
    const rawMode = body.mode?.toUpperCase();
    if (!rawMode || !["OFF", "MANUAL", "ASSISTED", "AUTO"].includes(rawMode)) {
      return badRequest(req, "mode must be one of: OFF, MANUAL, ASSISTED, AUTO");
    }

    const mode = rawMode as BurstMode;
    smartQueue.setBurstMode(mode);
    recordGenerationAudit({
      actor: actorOf(ctx),
      action: "smart_queue.burst_mode.update",
      subjectType: "burst_policy",
      subjectId: mode,
      details: { mode },
    });
    return jsonResponse({ ok: true, mode }, 200, req, {});
  }

  // ---------------------------------------------------------- POST providers/:id/drain
  if (subPath.startsWith("smart-queue/providers/") && subPath.endsWith("/drain") && req.method === "POST") {
    const guard = requireMutationPrincipal(ctx);
    if (guard) return guard;

    const parts = subPath.split("/");
    const providerId = parts[2];
    if (!providerId) return badRequest(req, "providerId is required");

    const result = await smartQueue.drainProvider(providerId);
    recordGenerationAudit({
      actor: actorOf(ctx),
      action: "smart_queue.provider.drain",
      subjectType: "provider",
      subjectId: providerId,
      details: result,
    });
    return jsonResponse(result, result.success ? 200 : 400, req, {});
  }

  // ---------------------------------------------------------- GET reconciliation
  if (subPath === "smart-queue/reconciliation" && req.method === "GET") {
    const db = openAgentOsDb();
    const status = url.searchParams.get("status") ?? undefined;
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);

    let query = "SELECT * FROM gen_queue_reconciliations";
    const params: Array<string | number> = [];
    if (status) {
      query += " WHERE resolution_status = ?";
      params.push(status);
    }
    query += " ORDER BY detected_at DESC LIMIT ?";
    params.push(limit);

    const rows = db.query(query).all(...params) as Array<{
      id: string;
      native_prompt_id: string;
      pao_job_id: string | null;
      provider_id: string;
      mismatch_type: string;
      resolution_status: string;
      details_json: string;
      detected_at: string;
      resolved_at: string | null;
    }>;

    const records = rows.map(r => ({
      id: r.id,
      nativePromptId: r.native_prompt_id,
      paoJobId: r.pao_job_id,
      providerId: r.provider_id,
      mismatchType: r.mismatch_type,
      resolutionStatus: r.resolution_status,
      details: JSON.parse(r.details_json || "{}"),
      detectedAt: r.detected_at,
      resolvedAt: r.resolved_at,
    }));

    return jsonResponse({ reconciliations: records }, 200, req, {});
  }

  // ---------------------------------------------------------- POST reconciliation/:id/resolve
  if (subPath.startsWith("smart-queue/reconciliation/") && subPath.endsWith("/resolve") && req.method === "POST") {
    const guard = requireMutationPrincipal(ctx);
    if (guard) return guard;

    const parts = subPath.split("/");
    const recordId = parts[2];
    if (!recordId) return badRequest(req, "reconciliation record id required");

    let body: { action?: string } = {};
    try { body = await req.json(); } catch { /* optional body */ }

    const db = openAgentOsDb();
    const now = new Date().toISOString();
    const res = db.query(`
      UPDATE gen_queue_reconciliations
      SET resolution_status = 'resolved', resolved_at = ?
      WHERE id = ?
    `).run(now, recordId);

    if (res.changes === 0) {
      return notFound(req, `Reconciliation record ${recordId} not found`);
    }

    recordGenerationAudit({
      actor: actorOf(ctx),
      action: "smart_queue.reconciliation.resolve",
      subjectType: "queue_reconciliation",
      subjectId: recordId,
      details: { action: body.action ?? "acknowledged" },
    });

    return jsonResponse({ ok: true, resolvedId: recordId }, 200, req, {});
  }

  return null;
}
