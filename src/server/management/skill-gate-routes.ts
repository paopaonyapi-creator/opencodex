// Phase 20.57 — Skill Gate management routes
// (/api/agent-os/skill-gate/*).
//
// Equality-guard dispatcher matching the management surface pattern
// (external-apis / code-review precedent). Governs sources, skills,
// versions, import, publish, and deployment.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getSkillGateService } from "../../agent-os/skill-gate/service";
import { SkillGateHttpError, type SkillScope, type SkillStatus } from "../../agent-os/skill-gate/types";

function fail(req: Request, err: unknown): Response {
  if (err instanceof SkillGateHttpError) {
    return jsonResponse({ error: { code: err.code, message: err.message } }, err.httpStatus, req, {});
  }
  return jsonResponse(
    { error: { code: "skill_gate_error", message: err instanceof Error ? err.message : "internal_error" } },
    500,
    req,
    {},
  );
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function handleSkillGateRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  const service = getSkillGateService();

  try {
    // 1. GET /api/agent-os/skill-gate/health
    if (req.method === "GET" && pathname === "/api/agent-os/skill-gate/health") {
      const skills = service.listSkills();
      const sources = service.listSources();
      return jsonResponse({
        ok: true,
        phase: "20.57",
        skillsCount: skills.length,
        sourcesCount: sources.length,
        publishedSkills: skills.filter((s) => s.status === "published").length,
        quarantinedSkills: skills.filter((s) => s.status === "quarantined").length,
      }, 200, req, {});
    }

    // 2. GET /api/agent-os/skill-gate/sources
    if (req.method === "GET" && pathname === "/api/agent-os/skill-gate/sources") {
      return jsonResponse({ ok: true, sources: service.listSources() }, 200, req, {});
    }

    // 3. GET /api/agent-os/skill-gate/skills
    if (req.method === "GET" && pathname === "/api/agent-os/skill-gate/skills") {
      const status = url.searchParams.get("status") as SkillStatus | null;
      const namespace = url.searchParams.get("namespace") ?? undefined;
      return jsonResponse({
        ok: true,
        skills: service.listSkills({ status: status ?? undefined, namespace }),
      }, 200, req, {});
    }

    // 4. POST /api/agent-os/skill-gate/import
    if (req.method === "POST" && pathname === "/api/agent-os/skill-gate/import") {
      const body = await readJsonBody(req);
      const dir = typeof body.path === "string" ? body.path : typeof body.directoryPath === "string" ? body.directoryPath : "";
      if (!dir) {
        return jsonResponse({ error: { code: "VALIDATION_ERROR", message: "directory path is required" } }, 400, req, {});
      }
      const result = await service.importFromDirectory({
        directoryPath: dir,
        sourceType: typeof body.sourceType === "string" ? body.sourceType : "local",
        sourceDisplayName: typeof body.sourceDisplayName === "string" ? body.sourceDisplayName : undefined,
        trustLevel: typeof body.trustLevel === "string" ? (body.trustLevel as any) : undefined,
        actorId: typeof body.actorId === "string" ? body.actorId : "operator",
      });
      return jsonResponse({ ok: true, ...result }, 200, req, {});
    }

    // 5. POST /api/agent-os/skill-gate/publish
    if (req.method === "POST" && pathname === "/api/agent-os/skill-gate/publish") {
      const body = await readJsonBody(req);
      const skillId = typeof body.skillId === "string" ? body.skillId : "";
      const version = typeof body.version === "string" ? body.version : "";
      if (!skillId || !version) {
        return jsonResponse({ error: { code: "VALIDATION_ERROR", message: "skillId and version are required" } }, 400, req, {});
      }
      const result = service.publishVersion(skillId, version, String(body.actorId ?? "operator"));
      return jsonResponse({ ok: true, ...result }, 200, req, {});
    }

    // 6. POST /api/agent-os/skill-gate/deploy
    if (req.method === "POST" && pathname === "/api/agent-os/skill-gate/deploy") {
      const body = await readJsonBody(req);
      const skillId = typeof body.skillId === "string" ? body.skillId : "";
      const agentId = typeof body.agentId === "string" ? body.agentId : "";
      const scope = (typeof body.scope === "string" ? body.scope : "project") as SkillScope;
      if (!skillId || !agentId) {
        return jsonResponse({ error: { code: "VALIDATION_ERROR", message: "skillId and agentId are required" } }, 400, req, {});
      }
      const result = service.deploySkill({
        skillId,
        agentId,
        scope,
        versionStr: typeof body.version === "string" ? body.version : undefined,
        projectPath: typeof body.projectPath === "string" ? body.projectPath : undefined,
        actorId: String(body.actorId ?? "operator"),
      });
      return jsonResponse({ ok: true, ...result }, 200, req, {});
    }

    // 7. GET /api/agent-os/skill-gate/skills/{id}
    if (req.method === "GET" && pathname.startsWith("/api/agent-os/skill-gate/skills/")) {
      const skillId = pathname.slice("/api/agent-os/skill-gate/skills/".length);
      const skill = service.getSkill(skillId);
      if (!skill) return jsonResponse({ error: { code: "NOT_FOUND", message: "skill not found" } }, 404, req, {});
      const versions = service.listVersions(skillId);
      return jsonResponse({ ok: true, skill, versions }, 200, req, {});
    }

    return null;
  } catch (error) {
    return fail(req, error);
  }
}
