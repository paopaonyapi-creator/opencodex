/**
 * Pao SEO Agent OS — Management API routes (Phase 18).
 *
 * Endpoints under /api/agent-os/seo/* for provider health, project CRUD,
 * analysis runs, and the recommendation inbox. Read endpoints are open to a
 * dashboard session; mutation endpoints follow the same admin-principal rule
 * as the rest of the management API. No endpoint ever returns or logs the
 * OPENSEO_API_KEY.
 */
import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import {
  createSeoProject, deleteSeoProject, getSeoProject, listSeoProjects,
  updateSeoProject, listSeoRecommendations, updateSeoRecommendationStatus, listSeoRuns,
} from "../../agent-os/seo/seo-models";
import { resolveSeoProvider } from "../../agent-os/seo/seo-provider";
import { runSeoAnalysis, SeoPolicyViolationError } from "../../agent-os/seo/seo-orchestrator";

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_body", message } }, 400, req, {});
}

export async function handleSeoRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  if (!url.pathname.startsWith("/api/agent-os/seo/")) return null;
  const subPath = url.pathname.slice("/api/agent-os/seo/".length);

  // 1. Provider health & capabilities (never includes secrets).
  if (subPath === "provider/health" && req.method === "GET") {
    const resolution = resolveSeoProvider();
    const health = await resolution.provider.healthCheck();
    return jsonResponse({ ...health, activeMode: resolution.mode }, 200, req, {});
  }
  if (subPath === "provider/capabilities" && req.method === "GET") {
    const resolution = resolveSeoProvider();
    const capabilities = await resolution.provider.listCapabilities();
    return jsonResponse({ provider: resolution.provider.id, capabilities }, 200, req, {});
  }

  // 2. Projects.
  if (subPath === "projects") {
    if (req.method === "GET") return jsonResponse({ projects: listSeoProjects() }, 200, req, {});
    if (req.method === "POST") {
      const body = await req.json().catch(() => null) as Record<string, unknown> | null;
      if (!body || typeof body.domain !== "string" || !body.domain.trim()) return badRequest(req, "domain is required");
      try {
        const project = createSeoProject({
          domain: body.domain,
          ...(typeof body.displayName === "string" ? { displayName: body.displayName } : {}),
          ...(typeof body.country === "string" ? { country: body.country } : {}),
          ...(typeof body.language === "string" ? { language: body.language } : {}),
          ...(typeof body.businessType === "string" ? { businessType: body.businessType } : {}),
          ...(typeof body.businessDescription === "string" ? { businessDescription: body.businessDescription } : {}),
          ...(Array.isArray(body.goals) ? { goals: body.goals.filter((g): g is string => typeof g === "string") } : {}),
          ...(Array.isArray(body.primaryTopics) ? { primaryTopics: body.primaryTopics.filter((g): g is string => typeof g === "string") } : {}),
          ...(Array.isArray(body.seedKeywords) ? { seedKeywords: body.seedKeywords.filter((g): g is string => typeof g === "string") } : {}),
          ...(Array.isArray(body.competitors) ? { competitors: body.competitors.filter((g): g is string => typeof g === "string") } : {}),
          ...(Array.isArray(body.brandTerms) ? { brandTerms: body.brandTerms.filter((g): g is string => typeof g === "string") } : {}),
          ...(Array.isArray(body.negativeKeywords) ? { negativeKeywords: body.negativeKeywords.filter((g): g is string => typeof g === "string") } : {}),
        });
        return jsonResponse({ project }, 201, req, {});
      } catch (error) {
        return badRequest(req, error instanceof Error ? error.message : "invalid project");
      }
    }
  }
  const projectMatch = subPath.match(/^projects\/([^/]+)$/);
  if (projectMatch) {
    const id = projectMatch[1]!;
    if (req.method === "GET") {
      const project = getSeoProject(id);
      return project ? jsonResponse({ project }, 200, req, {}) : notFound(req, "unknown project");
    }
    if (req.method === "PATCH") {
      const body = await req.json().catch(() => null) as Record<string, unknown> | null;
      if (!body) return badRequest(req, "invalid body");
      const project = updateSeoProject(id, body as never);
      return project ? jsonResponse({ project }, 200, req, {}) : notFound(req, "unknown project");
    }
    if (req.method === "DELETE") {
      return jsonResponse({ deleted: deleteSeoProject(id) }, deleteSeoProject(id) ? 200 : 404, req, {});
    }
  }

  // 3. Analysis runs.
  const runMatch = subPath.match(/^projects\/([^/]+)\/analyze$/);
  if (runMatch && req.method === "POST") {
    const project = getSeoProject(runMatch[1]!);
    if (!project) return notFound(req, "unknown project");
    const resolution = resolveSeoProvider();
    try {
      const result = await runSeoAnalysis({ project, provider: resolution.provider });
      return jsonResponse(result, 200, req, {});
    } catch (error) {
      if (error instanceof SeoPolicyViolationError) {
        return jsonResponse({ error: { code: "policy_denied", message: error.message } }, 403, req, {});
      }
      return jsonResponse({ error: { code: "seo_run_failed", message: "analysis failed" } }, 502, req, {});
    }
  }
  const runsMatch = subPath.match(/^projects\/([^/]+)\/runs$/);
  if (runsMatch && req.method === "GET") {
    if (!getSeoProject(runsMatch[1]!)) return notFound(req, "unknown project");
    return jsonResponse({ runs: listSeoRuns(runsMatch[1]!) }, 200, req, {});
  }

  // 4. Recommendation inbox.
  const recsMatch = subPath.match(/^projects\/([^/]+)\/recommendations$/);
  if (recsMatch && req.method === "GET") {
    if (!getSeoProject(recsMatch[1]!)) return notFound(req, "unknown project");
    return jsonResponse({ recommendations: listSeoRecommendations(recsMatch[1]!) }, 200, req, {});
  }
  const recMatch = subPath.match(/^recommendations\/([^/]+)\/status$/);
  if (recMatch && req.method === "POST") {
    const body = await req.json().catch(() => null) as { status?: unknown } | null;
    const status = body?.status;
    if (status !== "open" && status !== "approved" && status !== "dismissed" && status !== "fix_planned") {
      return badRequest(req, "status must be open|approved|dismissed|fix_planned");
    }
    return jsonResponse({ updated: updateSeoRecommendationStatus(recMatch[1]!, status) }, 200, req, {});
  }

  return notFound(req, "unknown SEO endpoint");
}
