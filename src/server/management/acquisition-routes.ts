// Phase 20.95 — Content Acquisition Gateway routes (/api/agent-os/acquisition/*).

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getAcquisitionGateway } from "../../agent-os/acquisition/service";
import { inferIntent } from "../../agent-os/acquisition/classify";
import { AcquisitionError, looksLikeSecretPayload } from "../../agent-os/acquisition/types";
import { acquisitionEnabled } from "../../agent-os/acquisition/flags";
import type { AcquisitionIntent, AcquisitionRequest } from "../../agent-os/acquisition/types";

function fail(req: Request, err: unknown): Response {
  if (err instanceof AcquisitionError) {
    return jsonResponse({ error: { code: err.code, message: err.message, detail: err.detail } }, err.httpStatus, req, {});
  }
  return jsonResponse({ error: { code: "INTERNAL", message: err instanceof Error ? err.message : "internal_error" } }, 500, req, {});
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body as Record<string, unknown> : {};
  } catch { return {}; }
}

function actor(ctx: ManagementContext, body?: Record<string, unknown>): string {
  return String(body?.actor ?? ctx.req.headers.get("x-pao-actor") ?? "operator").slice(0, 64);
}

function requestFromBody(body: Record<string, unknown>): AcquisitionRequest {
  if (looksLikeSecretPayload(body) || looksLikeSecretPayload(body.authContext) || "cookies" in body || "cookie" in body) {
    throw new AcquisitionError("SECRET_IN_REQUEST", 400, "raw cookies/credentials must not appear on acquisition requests");
  }
  const source = String(body.source ?? body.url ?? "");
  const intent = (typeof body.intent === "string" ? body.intent : inferIntent(source + " " + String(body.prompt ?? ""))) as AcquisitionIntent;
  const prompt = String(body.prompt ?? "");
  return {
    actor: { type: "user", id: String(body.actor ?? "operator") },
    source: { kind: Array.isArray(body.urls) ? "batch" : "url", value: Array.isArray(body.urls) ? body.urls.map(String) : source },
    intent,
    options: {
      transcribe: body.transcribe === true || intent === "research" || intent === "transcribe",
      summarize: body.summarize === true || intent === "research",
      ingestKnowledge: body.ingestKnowledge === true || /คลังความรู้|ingestKnowledge/.test(prompt),
      audioOnly: body.audioOnly === true,
      preserveOriginal: body.preserveOriginal === true || /เก็บต้นฉบับ|preserveOriginal/.test(prompt),
      maxItems: typeof body.maxItems === "number" ? body.maxItems : undefined,
    },
    authContext: typeof body.browserSessionRef === "string" ? { browserSessionRef: body.browserSessionRef } : undefined,
    policyContext: { workspaceId: String(body.workspaceId ?? "default"), purpose: (body.purpose as AcquisitionRequest["policyContext"]["purpose"]) ?? "research" },
  };
}

export async function handleAcquisitionRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  if (pathname !== "/api/agent-os/acquisition" && !pathname.startsWith("/api/agent-os/acquisition/")) return null;
  if (!acquisitionEnabled()) {
    return jsonResponse({ error: { code: "DISABLED", message: "acquisition gateway disabled" } }, 403, req, {});
  }
  const gw = getAcquisitionGateway();
  try {
    if (req.method === "GET" && pathname === "/api/agent-os/acquisition/health") {
      return jsonResponse(await gw.health(), 200, req, {});
    }
    if (req.method === "GET" && pathname === "/api/agent-os/acquisition/adapters/health") {
      const health = await gw.health();
      return jsonResponse({ ok: true, adapters: health.adapters }, 200, req, {});
    }
    if (req.method === "GET" && pathname === "/api/agent-os/acquisition/doctor") {
      return jsonResponse(await gw.doctor(), 200, req, {});
    }
    if (req.method === "GET" && pathname === "/api/agent-os/acquisition/jobs") {
      return jsonResponse({ ok: true, jobs: gw.listJobs() }, 200, req, {});
    }
    if (req.method === "GET" && pathname === "/api/agent-os/acquisition/capabilities") {
      return jsonResponse({ ok: true, capabilities: await gw.capabilities() }, 200, req, {});
    }
    if (req.method === "GET" && pathname === "/api/agent-os/acquisition/sessions") {
      return jsonResponse({ ok: true, sessions: gw.listSessions() }, 200, req, {});
    }
    if (req.method === "POST" && pathname === "/api/agent-os/acquisition/plan") {
      const body = await readJson(req);
      return jsonResponse({ ok: true, ...(await gw.plan(requestFromBody(body))) }, 200, req, {});
    }
    if (req.method === "POST" && pathname === "/api/agent-os/acquisition/jobs") {
      const body = await readJson(req);
      const result = await gw.submit(requestFromBody(body), actor(ctx, body));
      return jsonResponse({ ok: true, ...result }, 201, req, {});
    }
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/acquisition/session-refs/") && pathname.endsWith("/revoke")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/acquisition/session-refs/".length, -"/revoke".length));
      gw.revokeSession(id);
      return jsonResponse({ ok: true, revoked: id }, 200, req, {});
    }
    if (req.method === "POST" && pathname === "/api/agent-os/acquisition/session-refs") {
      const body = await readJson(req);
      const session = gw.issueSession({
        provider: String(body.provider ?? "browser"),
        domains: Array.isArray(body.domains) ? body.domains.map(String) : [String(body.domain ?? "")],
        ownerActorId: actor(ctx, body),
        secretRef: String(body.secretRef ?? "secret://browser/session-store"),
      });
      return jsonResponse({ ok: true, session: { ...session, secretRef: session.secretRef } }, 201, req, {});
    }
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/acquisition/jobs/") && pathname.endsWith("/cancel")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/acquisition/jobs/".length, -"/cancel".length));
      return jsonResponse({ ok: true, job: gw.cancel(id, actor(ctx)) }, 200, req, {});
    }
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/acquisition/jobs/") && pathname.endsWith("/pause")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/acquisition/jobs/".length, -"/pause".length));
      return jsonResponse({ ok: true, job: gw.pause(id, actor(ctx)) }, 200, req, {});
    }
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/acquisition/jobs/") && pathname.endsWith("/resume")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/acquisition/jobs/".length, -"/resume".length));
      return jsonResponse({ ok: true, job: gw.resume(id, actor(ctx)) }, 200, req, {});
    }
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/acquisition/jobs/") && pathname.endsWith("/retry")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/acquisition/jobs/".length, -"/retry".length));
      return jsonResponse({ ok: true, job: await gw.retry(id, actor(ctx)) }, 200, req, {});
    }
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/acquisition/jobs/") && pathname.endsWith("/approve")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/acquisition/jobs/".length, -"/approve".length));
      return jsonResponse({ ok: true, job: await gw.decideApproval(id, true, actor(ctx)) }, 200, req, {});
    }
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/acquisition/jobs/") && pathname.endsWith("/deny")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/acquisition/jobs/".length, -"/deny".length));
      return jsonResponse({ ok: true, job: await gw.decideApproval(id, false, actor(ctx)) }, 200, req, {});
    }
    if (req.method === "GET" && pathname.startsWith("/api/agent-os/acquisition/jobs/") && pathname.endsWith("/artifacts")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/acquisition/jobs/".length, -"/artifacts".length));
      return jsonResponse({ ok: true, artifacts: gw.getJob(id).artifacts }, 200, req, {});
    }
    if (req.method === "GET" && pathname.startsWith("/api/agent-os/acquisition/jobs/")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/acquisition/jobs/".length));
      if (id.includes("/")) return jsonResponse({ error: { code: "not_found", message: "unknown job subroute" } }, 404, req, {});
      return jsonResponse({ ok: true, ...gw.getJob(id) }, 200, req, {});
    }
    return jsonResponse({ error: { code: "not_found", message: "unknown acquisition route" } }, 404, req, {});
  } catch (err) {
    return fail(req, err);
  }
}
