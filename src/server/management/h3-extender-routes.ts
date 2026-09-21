// Phase 21.02 — MiniMax H3 Extender Management API Routes.
// Endpoint base: /api/video/h3/*

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getH3ExtenderService } from "../../agent-os/h3-extender/service";
import { h3ExtenderEnabled } from "../../agent-os/h3-extender/flags";

export async function handleH3ExtenderRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;

  if (!pathname.startsWith("/api/video/h3")) {
    return null;
  }

  if (!h3ExtenderEnabled()) {
    return jsonResponse({ error: { code: "DISABLED", message: "MiniMax H3 Extender is disabled" } }, 403, req, {});
  }

  const svc = getH3ExtenderService();

  try {
    // GET /api/video/h3/projects
    if (req.method === "GET" && pathname === "/api/video/h3/projects") {
      return jsonResponse({ ok: true, projects: svc.listProjects() }, 200, req, {});
    }

    // POST /api/video/h3/projects
    if (req.method === "POST" && pathname === "/api/video/h3/projects") {
      const body = await req.json().catch(() => ({})) as any;
      const p = svc.createProject(String(body.name), body.productionMode || "continuous", body.budgetLimit ? Number(body.budgetLimit) : undefined);
      return jsonResponse({ ok: true, project: p }, 201, req, {});
    }

    // GET /api/video/h3/projects/:id/clips
    if (req.method === "GET" && pathname.startsWith("/api/video/h3/projects/") && pathname.endsWith("/clips")) {
      const projectId = pathname.slice("/api/video/h3/projects/".length, -"/clips".length);
      return jsonResponse({ ok: true, clips: svc.listClips(projectId) }, 200, req, {});
    }

    // POST /api/video/h3/projects/:id/clips
    if (req.method === "POST" && pathname.startsWith("/api/video/h3/projects/") && pathname.endsWith("/clips")) {
      const projectId = pathname.slice("/api/video/h3/projects/".length, -"/clips".length);
      const body = await req.json().catch(() => ({})) as any;
      const c = svc.addClip(projectId, Number(body.sequenceIndex), body.prompt || {}, body.duration ? Number(body.duration) : 5.0, body.seed ? String(body.seed) : undefined);
      return jsonResponse({ ok: true, clip: c }, 201, req, {});
    }

    // POST /api/video/h3/clips/:clipId/generate
    if (req.method === "POST" && pathname.startsWith("/api/video/h3/clips/") && pathname.endsWith("/generate")) {
      const clipId = pathname.slice("/api/video/h3/clips/".length, -"/generate".length);
      const attempt = svc.generateClip(clipId);
      return jsonResponse({ ok: true, attempt }, 200, req, {});
    }

    // POST /api/video/h3/clips/:clipId/validate
    if (req.method === "POST" && pathname.startsWith("/api/video/h3/clips/") && pathname.endsWith("/validate")) {
      const clipId = pathname.slice("/api/video/h3/clips/".length, -"/validate".length);
      const body = await req.json().catch(() => ({})) as any;
      const c = svc.validateClip(clipId, body.validatorId ? String(body.validatorId) : "human-operator");
      return jsonResponse({ ok: true, clip: c }, 200, req, {});
    }

    return jsonResponse({ error: { code: "NOT_FOUND", message: "Unknown H3 Extender route" } }, 404, req, {});
  } catch (err: any) {
    return jsonResponse({ error: { code: "INTERNAL_ERROR", message: err.message || String(err) } }, 500, req, {});
  }
}
