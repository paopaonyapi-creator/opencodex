// Phase 20.92 — Video Studio management routes (/api/agent-os/video-studio/*).
//
// Follows the repo's route conventions: literal `pathname ===` guards with a
// method clause on the same line for registered literal routes; `{id}` slices
// for parameterized paths. Mutating operations traverse the service's gates
// (locks, budget, approvals) and error codes are machine-readable.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getVideoStudioService } from "../../agent-os/video-studio/service";
import { VideoStudioError } from "../../agent-os/video-studio/types";

function fail(req: Request, err: unknown): Response {
  if (err instanceof VideoStudioError) {
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

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export async function handleVideoStudioRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  const service = getVideoStudioService();

  try {
    // 1. GET /api/agent-os/video-studio/health
    if (req.method === "GET" && pathname === "/api/agent-os/video-studio/health") {
      const db = (await import("../../agent-os/db")).openAgentOsDb();
      const projects = (db.query("SELECT COUNT(*) AS n FROM vs_projects").get() as { n: number }).n;
      const assets = (db.query("SELECT COUNT(*) AS n FROM vs_assets").get() as { n: number }).n;
      return jsonResponse({ ok: true, phase: "20.92", engine: "ffmpeg", remotionInstalled: false, counts: { projects, assets } }, 200, req, {});
    }

    // 2. GET /api/agent-os/video-studio/projects
    if (req.method === "GET" && pathname === "/api/agent-os/video-studio/projects") {
      const projects = service.listProjects();
      return jsonResponse({ ok: true, count: projects.length, projects }, 200, req, {});
    }

    // 3. POST /api/agent-os/video-studio/projects
    if (req.method === "POST" && pathname === "/api/agent-os/video-studio/projects") {
      const body = await readJson(req);
      const project = service.createProject({
        title: String(body.title ?? "Untitled"),
        sourceType: (str(body.sourceType) as never) ?? "script",
        rawInput: String(body.script ?? body.rawInput ?? ""),
        aspectRatio: (str(body.aspectRatio) as never) ?? "16:9",
        fps: typeof body.fps === "number" ? body.fps : 30,
        language: str(body.language) ?? "en",
        quality: (str(body.quality) as never) ?? "BALANCED",
      }, actor(ctx, body));
      return jsonResponse({ ok: true, project }, 201, req, {});
    }

    // 4. GET /api/agent-os/video-studio/templates
    if (req.method === "GET" && pathname === "/api/agent-os/video-studio/templates") {
      return jsonResponse({ ok: true, templates: service.listTemplates() }, 200, req, {});
    }

    // 5. GET /api/agent-os/video-studio/projects/{id}
    if (req.method === "GET" && pathname.startsWith("/api/agent-os/video-studio/projects/")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/video-studio/projects/".length));
      const detail = service.getProject(id);
      if (!detail) {
        return jsonResponse({ error: { code: "PROJECT_NOT_FOUND", message: `project '${id}' not found` } }, 404, req, {});
      }
      return jsonResponse({ ok: true, ...detail }, 200, req, {});
    }

    // 6. POST /api/agent-os/video-studio/projects/{id}/script
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/video-studio/projects/") && pathname.endsWith("/script")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/video-studio/projects/".length, -"/script".length));
      const body = await readJson(req);
      const result = service.setScript(id, String(body.script ?? ""), { targetScenes: typeof body.targetScenes === "number" ? body.targetScenes : undefined, actor: actor(ctx, body) });
      return jsonResponse({ ok: true, ...result }, 200, req, {});
    }

    // 7. POST /api/agent-os/video-studio/projects/{id}/plan
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/video-studio/projects/") && pathname.endsWith("/plan")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/video-studio/projects/".length, -"/plan".length));
      const body = await readJson(req);
      return jsonResponse({ ok: true, scenes: service.planAllScenes(id, actor(ctx, body)) }, 200, req, {});
    }

    // 8. POST /api/agent-os/video-studio/projects/{id}/resolve-assets
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/video-studio/projects/") && pathname.endsWith("/resolve-assets")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/video-studio/projects/".length, -"/resolve-assets".length));
      const body = await readJson(req);
      return jsonResponse({ ok: true, ...(await service.resolveAssets(id, actor(ctx, body))) }, 200, req, {});
    }

    // 9. POST /api/agent-os/video-studio/projects/{id}/voice
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/video-studio/projects/") && pathname.endsWith("/voice")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/video-studio/projects/".length, -"/voice".length));
      const body = await readJson(req);
      return jsonResponse({ ok: true, ...(await service.generateVoiceAndCaptions(id, actor(ctx, body))) }, 200, req, {});
    }

    // 10. POST /api/agent-os/video-studio/projects/{id}/timeline
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/video-studio/projects/") && pathname.endsWith("/timeline")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/video-studio/projects/".length, -"/timeline".length));
      const body = await readJson(req);
      return jsonResponse({ ok: true, timeline: service.buildProjectTimeline(id, actor(ctx, body)) }, 200, req, {});
    }

    // 11. POST /api/agent-os/video-studio/projects/{id}/qa
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/video-studio/projects/") && pathname.endsWith("/qa")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/video-studio/projects/".length, -"/qa".length));
      const body = await readJson(req);
      return jsonResponse({ ok: true, report: service.runProjectQA(id, actor(ctx, body)) }, 200, req, {});
    }

    // 12. POST /api/agent-os/video-studio/projects/{id}/render
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/video-studio/projects/") && pathname.endsWith("/render")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/video-studio/projects/".length, -"/render".length));
      const body = await readJson(req);
      const profile = (str(body.profile) ?? "PREVIEW_720P") as import("../../agent-os/video-studio/types").RenderConfig["profile"];
      return jsonResponse({ ok: true, ...(await service.renderProject(id, profile, actor(ctx, body))) }, 200, req, {});
    }

    // 13. POST /api/agent-os/video-studio/projects/{id}/approve
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/video-studio/projects/") && pathname.endsWith("/approve")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/video-studio/projects/".length, -"/approve".length));
      const body = await readJson(req);
      const kind = (str(body.kind) as never) ?? "DRAFT_VIDEO_APPROVAL";
      if (body.decide === true || str(body.approver)) {
        return jsonResponse({ ok: true, ...(await Promise.resolve(service.decideApproval(id, kind, body.approve === true, String(body.approver ?? actor(ctx, body))))) }, 200, req, {});
      }
      return jsonResponse({ ok: true, ...(await Promise.resolve(service.requestApproval(id, kind, actor(ctx, body)))) }, 200, req, {});
    }

    // 14. POST /api/agent-os/video-studio/projects/{id}/auto-build
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/video-studio/projects/") && pathname.endsWith("/auto-build")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/video-studio/projects/".length, -"/auto-build".length));
      const body = await readJson(req);
      return jsonResponse({ ok: true, ...(await Promise.resolve(service.startAutoBuild(id, actor(ctx, body)))) }, 201, req, {});
    }

    // 15. POST /api/agent-os/video-studio/auto-build/{jobId}/step
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/video-studio/auto-build/") && pathname.endsWith("/step")) {
      const jobId = decodeURIComponent(pathname.slice("/api/agent-os/video-studio/auto-build/".length, -"/step".length));
      const body = await readJson(req);
      return jsonResponse({ ok: true, ...(await service.runNextStep(jobId, actor(ctx, body))) }, 200, req, {});
    }

    // 16. GET /api/agent-os/video-studio/auto-build/{jobId}
    if (req.method === "GET" && pathname.startsWith("/api/agent-os/video-studio/auto-build/")) {
      const jobId = decodeURIComponent(pathname.slice("/api/agent-os/video-studio/auto-build/".length));
      return jsonResponse({ ok: true, ...service.jobStatus(jobId) }, 200, req, {});
    }

    // 17. POST /api/agent-os/video-studio/projects/{id}/scenes/{sceneId}/lock
    if (req.method === "POST" && pathname.includes("/scenes/") && pathname.endsWith("/lock")) {
      const rest = pathname.slice("/api/agent-os/video-studio/projects/".length, -"/lock".length);
      const [projectId, sceneId] = rest.split("/scenes/");
      const body = await readJson(req);
      const scene = service.updateSceneLocks(decodeURIComponent(projectId ?? ""), decodeURIComponent(sceneId ?? ""), (body.locks ?? {}) as never, actor(ctx, body));
      return jsonResponse({ ok: true, locks: scene.locks }, 200, req, {});
    }

    // 18. POST /api/agent-os/video-studio/projects/{id}/scenes/{sceneId}/regenerate
    if (req.method === "POST" && pathname.includes("/scenes/") && pathname.endsWith("/regenerate")) {
      const rest = pathname.slice("/api/agent-os/video-studio/projects/".length, -"/regenerate".length);
      const [projectId, sceneId] = rest.split("/scenes/");
      const body = await readJson(req);
      const what = (str(body.what) as "visual" | "motion" | "narration" | "all") ?? "visual";
      return jsonResponse({ ok: true, scene: service.regenerateScene(decodeURIComponent(projectId ?? ""), decodeURIComponent(sceneId ?? ""), what, actor(ctx, body)) }, 200, req, {});
    }

    // 19. POST /api/agent-os/video-studio/projects/{id}/scenes/{sceneId}/narration
    if (req.method === "POST" && pathname.includes("/scenes/") && pathname.endsWith("/narration")) {
      const rest = pathname.slice("/api/agent-os/video-studio/projects/".length, -"/narration".length);
      const [projectId, sceneId] = rest.split("/scenes/");
      const body = await readJson(req);
      return jsonResponse({ ok: true, scene: service.updateSceneNarration(decodeURIComponent(projectId ?? ""), decodeURIComponent(sceneId ?? ""), String(body.narrationText ?? ""), actor(ctx, body)) }, 200, req, {});
    }

    // 20. POST /api/agent-os/video-studio/projects/{id}/scenes/reorder
    if (req.method === "POST" && pathname.endsWith("/scenes/reorder")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/video-studio/projects/".length, -"/scenes/reorder".length));
      const body = await readJson(req);
      const ids = Array.isArray(body.orderedSceneIds) ? (body.orderedSceneIds as string[]) : [];
      return jsonResponse({ ok: true, scenes: service.reorderScenes(id, ids, actor(ctx, body)) }, 200, req, {});
    }

    return null;
  } catch (err) {
    return fail(req, err);
  }
}
