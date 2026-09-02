/**
 * Phase 18.1 — GEO Management API routes under /api/agent-os/seo/geo/*.
 * Extends the Phase 18 SEO routes; no new auth model. Read endpoints GET,
 * audit endpoint POST; nothing here ever writes to the audited website.
 */
import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getSeoProject, listSeoRecommendations } from "../../agent-os/seo/seo-models";
import { runGeoAudit, GeoDisabledError } from "../../agent-os/seo/geo/geo-orchestrator";
import { generateLlmsTxtProposal } from "../../agent-os/seo/geo/llms-proposal";

export async function handleGeoRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  if (!url.pathname.startsWith("/api/agent-os/seo/geo/")) return null;
  const subPath = url.pathname.slice("/api/agent-os/seo/geo/".length);

  const auditMatch = subPath.match(/^projects\/([^/]+)\/audit$/);
  if (auditMatch && req.method === "POST") {
    const project = getSeoProject(auditMatch[1]!);
    if (!project) return jsonResponse({ error: { code: "not_found", message: "unknown project" } }, 404, req, {});
    try {
      const result = await runGeoAudit({ project });
      return jsonResponse(result, 200, req, {});
    } catch (error) {
      if (error instanceof GeoDisabledError) {
        return jsonResponse({ error: { code: "geo_disabled", message: error.message } }, 409, req, {});
      }
      return jsonResponse({ error: { code: "geo_audit_failed", message: "GEO audit failed" } }, 502, req, {});
    }
  }

  const recsMatch = subPath.match(/^projects\/([^/]+)\/recommendations$/);
  if (recsMatch && req.method === "GET") {
    if (!getSeoProject(recsMatch[1]!)) return jsonResponse({ error: { code: "not_found", message: "unknown project" } }, 404, req, {});
    const all = listSeoRecommendations(recsMatch[1]!);
    return jsonResponse({ recommendations: all.filter(rec => rec.title.startsWith("[GEO]")) }, 200, req, {});
  }

  const proposalMatch = subPath.match(/^projects\/([^/]+)\/llms-txt\/proposal$/);
  if (proposalMatch) {
    if (req.method !== "GET") {
      return jsonResponse({ error: { code: "method_not_allowed", message: "llms.txt proposal is read-only; deployment requires a separate approved workflow" } }, 405, req, {});
    }
    const project = getSeoProject(proposalMatch[1]!);
    if (!project) return jsonResponse({ error: { code: "not_found", message: "unknown project" } }, 404, req, {});
    const proposal = generateLlmsTxtProposal({
      domain: project.domain,
      displayName: project.displayName,
      businessDescription: project.businessDescription,
      keyPages: project.keyPages,
      primaryTopics: project.primaryTopics,
    });
    return jsonResponse({
      proposal,
      policy: { deploymentAllowed: false, humanApprovalRequired: true },
    }, 200, req, {});
  }

  return jsonResponse({ error: { code: "not_found", message: "unknown GEO endpoint" } }, 404, req, {});
}
