// Phase 20.91b — Engineering Skill Runtime management routes
// (/api/agent-os/engineering-skills/*).
//
// Every mutating operation traverses the EngineeringSkillsService; error codes
// are machine-readable (EngineeringSkillsError.code). Route guards follow the
// static-scanner contract: `pathname === "…"` with a method clause on the same
// line, one pair per registered route.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getEngineeringSkillsService } from "../../agent-os/engineering-skills/service";
import { EngineeringSkillsError } from "../../agent-os/engineering-skills/types";

function fail(req: Request, err: unknown): Response {
  if (err instanceof EngineeringSkillsError) {
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

export async function handleEngineeringSkillsRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  const service = getEngineeringSkillsService();

  try {
    // 1. GET /api/agent-os/engineering-skills/health
    if (req.method === "GET" && pathname === "/api/agent-os/engineering-skills/health") {
      const health = service.health();
      return jsonResponse({ ...health, phase: "20.91b" }, 200, req, {});
    }

    // 2. GET /api/agent-os/engineering-skills/packs
    if (req.method === "GET" && pathname === "/api/agent-os/engineering-skills/packs") {
      const packs = service.listPacks();
      return jsonResponse({ ok: true, count: packs.length, packs }, 200, req, {});
    }

    // 3. GET /api/agent-os/engineering-skills/packs/{id}
    if (req.method === "GET" && pathname.startsWith("/api/agent-os/engineering-skills/packs/")) {
      const id = pathname.slice("/api/agent-os/engineering-skills/packs/".length);
      const detail = service.getPackDetail(decodeURIComponent(id));
      if (!detail) {
        return jsonResponse({ error: { code: "PACK_NOT_FOUND", message: `pack '${id}' is not registered` } }, 404, req, {});
      }
      return jsonResponse({ ok: true, ...detail }, 200, req, {});
    }

    // 4. POST /api/agent-os/engineering-skills/packs/import
    if (req.method === "POST" && pathname === "/api/agent-os/engineering-skills/packs/import") {
      const body = await readJson(req);
      const result = service.importPack(
        {
          name: String(body.name ?? ""),
          sourceUrl: str(body.sourceUrl),
          sourceType: (str(body.sourceType) ?? "inline") as "inline" | "local" | "git",
          version: str(body.version),
          resolvedCommit: str(body.resolvedCommit),
          license: str(body.license),
          localPath: str(body.localPath),
          note: str(body.note),
          skills: Array.isArray(body.skills) ? (body.skills as never) : undefined,
        },
        actor(ctx, body),
      );
      return jsonResponse({ ok: true, ...result }, 201, req, {});
    }

    // 5. POST /api/agent-os/engineering-skills/packs/{id}/validate
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/engineering-skills/packs/") && pathname.endsWith("/validate")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/engineering-skills/packs/".length, -"/validate".length));
      const body = await readJson(req);
      const validation = service.validatePack(id, actor(ctx, body));
      return jsonResponse({ ...validation, ok: validation.ok }, 200, req, {});
    }

    // 6. POST /api/agent-os/engineering-skills/packs/{id}/promote
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/engineering-skills/packs/") && pathname.endsWith("/promote")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/engineering-skills/packs/".length, -"/promote".length));
      const body = await readJson(req);
      return jsonResponse({ ok: true, pack: service.promotePack(id, actor(ctx, body), str(body.note)) }, 200, req, {});
    }

    // 7. POST /api/agent-os/engineering-skills/packs/{id}/rollback
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/engineering-skills/packs/") && pathname.endsWith("/rollback")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/engineering-skills/packs/".length, -"/rollback".length));
      const body = await readJson(req);
      return jsonResponse({ ok: true, pack: service.rollbackPack(id, actor(ctx, body), str(body.reason) ?? "operator rollback") }, 200, req, {});
    }

    // 8. POST /api/agent-os/engineering-skills/packs/{id}/disable | /enable
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/engineering-skills/packs/") && (pathname.endsWith("/disable") || pathname.endsWith("/enable"))) {
      const suffix = pathname.endsWith("/enable") ? "/enable" : "/disable";
      const id = decodeURIComponent(pathname.slice("/api/agent-os/engineering-skills/packs/".length, -suffix.length));
      const body = await readJson(req);
      return jsonResponse({ ok: true, pack: service.setPackEnabled(id, pathname.endsWith("/enable"), actor(ctx, body)) }, 200, req, {});
    }

    // 9. GET /api/agent-os/engineering-skills/skills
    if (req.method === "GET" && pathname === "/api/agent-os/engineering-skills/skills") {
      const enabledOnly = url.searchParams.get("enabled") === "1";
      const skills = service.listSkills(enabledOnly);
      return jsonResponse({ ok: true, count: skills.length, skills }, 200, req, {});
    }

    // 10. POST /api/agent-os/engineering-skills/routes/explain (Routing Inspector)
    if (req.method === "POST" && pathname === "/api/agent-os/engineering-skills/routes/explain") {
      const body = await readJson(req);
      const task = str(body.task);
      if (!task) return jsonResponse({ error: { code: "ROUTE_FAILED", message: "task text required" } }, 422, req, {});
      const route = service.routeTask(task, str(body.provider));
      return jsonResponse({ ok: true, intent: route.intent, risk: route.risk, explanation: route.explanation, skills: route.skills.map((s) => ({ slug: s.slug, stages: s.lifecycleStages, permissions: s.permissions })) }, 200, req, {});
    }

    // 11. GET /api/agent-os/engineering-skills/workflows
    if (req.method === "GET" && pathname === "/api/agent-os/engineering-skills/workflows") {
      const status = url.searchParams.get("status") ?? undefined;
      const workflows = service.listWorkflows(status);
      return jsonResponse({ ok: true, count: workflows.length, workflows }, 200, req, {});
    }

    // 12. POST /api/agent-os/engineering-skills/workflows
    if (req.method === "POST" && pathname === "/api/agent-os/engineering-skills/workflows") {
      const body = await readJson(req);
      const task = str(body.task);
      if (!task) return jsonResponse({ error: { code: "ROUTE_FAILED", message: "task text required" } }, 422, req, {});
      const workflow = service.startWorkflow({ taskText: task, title: str(body.title), taskId: str(body.taskId), provider: str(body.provider), actor: actor(ctx, body) });
      return jsonResponse({ ok: true, workflow }, 201, req, {});
    }

    // 13. GET /api/agent-os/engineering-skills/workflows/{id}[/evidence|/reviews]
    if (req.method === "GET" && pathname.startsWith("/api/agent-os/engineering-skills/workflows/")) {
      const rest = pathname.slice("/api/agent-os/engineering-skills/workflows/".length);
      const [id, sub] = rest.split("/");
      const workflow = service.getWorkflow(decodeURIComponent(id ?? ""));
      if (!workflow) {
        return jsonResponse({ error: { code: "WORKFLOW_NOT_FOUND", message: `workflow '${id}' not found` } }, 404, req, {});
      }
      if (sub === "evidence") {
        return jsonResponse({ ok: true, workflowId: workflow.id, evidence: service.listEvidence(workflow.id) }, 200, req, {});
      }
      if (sub === "reviews") {
        return jsonResponse({ ok: true, workflowId: workflow.id, requiredLanes: service.requiredLanes(workflow.id), findings: service.listReviews(workflow.id) }, 200, req, {});
      }
      return jsonResponse({ ok: true, workflow }, 200, req, {});
    }

    // 14. POST /api/agent-os/engineering-skills/workflows/{id}/evidence
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/engineering-skills/workflows/") && pathname.endsWith("/evidence")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/engineering-skills/workflows/".length, -"/evidence".length));
      const body = await readJson(req);
      const record = service.recordEvidence({
        workflowId: id,
        type: String(body.type ?? "artifact_exists") as never,
        producer: String(body.producer ?? "operator"),
        command: str(body.command) ?? null,
        exitCode: typeof body.exitCode === "number" ? body.exitCode : null,
        output: typeof body.output === "string" ? body.output : null,
        artifactUri: str(body.artifactUri) ?? null,
        metadata: typeof body.metadata === "object" && body.metadata !== null ? (body.metadata as Record<string, unknown>) : {},
      });
      return jsonResponse({ ok: true, evidence: record }, 201, req, {});
    }

    // 15. POST /api/agent-os/engineering-skills/workflows/{id}/reviews
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/engineering-skills/workflows/") && pathname.endsWith("/reviews")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/engineering-skills/workflows/".length, -"/reviews".length));
      const body = await readJson(req);
      const result = service.submitReview({
        workflowId: id,
        reviewerType: String(body.reviewerType ?? "code_reviewer") as never,
        reviewerIdentity: String(body.reviewerIdentity ?? "anonymous"),
        verdict: String(body.verdict ?? "pass") as never,
        findings: Array.isArray(body.findings) ? (body.findings as never) : [],
      });
      return jsonResponse({ ok: true, ...result }, 201, req, {});
    }

    // 16. POST /api/agent-os/engineering-skills/workflows/{id}/approve
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/engineering-skills/workflows/") && pathname.endsWith("/approve")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/engineering-skills/workflows/".length, -"/approve".length));
      const body = await readJson(req);
      const result = service.approveShip(id, String(body.approver ?? actor(ctx, body)), String(body.rollbackTarget ?? "previous-release"));
      return jsonResponse({ ok: true, ...result }, 200, req, {});
    }

    // 17. POST /api/agent-os/engineering-skills/workflows/{id}/advance
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/engineering-skills/workflows/") && pathname.endsWith("/advance")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/engineering-skills/workflows/".length, -"/advance".length));
      const body = await readJson(req);
      return jsonResponse({ ok: true, ...service.advanceWorkflow(id, actor(ctx, body)) }, 200, req, {});
    }

    // 18. POST /api/agent-os/engineering-skills/workflows/{id}/cancel
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/engineering-skills/workflows/") && pathname.endsWith("/cancel")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/engineering-skills/workflows/".length, -"/cancel".length));
      const body = await readJson(req);
      return jsonResponse({ ok: true, workflow: service.cancelWorkflow(id, str(body.reason) ?? "operator cancel", actor(ctx, body)) }, 200, req, {});
    }

    // 19. POST /api/agent-os/engineering-skills/workflows/{id}/skip-request (anti-rationalization probe)
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/engineering-skills/workflows/") && pathname.endsWith("/skip-request")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/engineering-skills/workflows/".length, -"/skip-request".length));
      const body = await readJson(req);
      const reply = service.requestSkip(id, String(body.step ?? "verify"), String(body.reason ?? "unspecified"));
      return jsonResponse({ ok: true, reply }, 200, req, {});
    }

    // 20. GET /api/agent-os/engineering-skills/policy-decisions
    if (req.method === "GET" && pathname === "/api/agent-os/engineering-skills/policy-decisions") {
      const db = (await import("../../agent-os/db")).openAgentOsDb();
      const rows = db.query("SELECT * FROM esk_policy_decisions ORDER BY created_at DESC LIMIT 200").all() as Array<Record<string, unknown>>;
      return jsonResponse({ ok: true, count: rows.length, decisions: rows }, 200, req, {});
    }

    // 21. GET /api/agent-os/engineering-skills/audit
    if (req.method === "GET" && pathname === "/api/agent-os/engineering-skills/audit") {
      const rows = service.listAudit(200);
      return jsonResponse({ ok: true, count: rows.length, audit: rows }, 200, req, {});
    }

    return null;
  } catch (err) {
    return fail(req, err);
  }
}
