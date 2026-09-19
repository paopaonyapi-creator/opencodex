// Phase 20.94 — unified workspace management routes (/api/agent-os/enzo-workspace/*).

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getEnzoWorkspaceService } from "../../agent-os/enzo-workspace/service";
import { EnzoWorkspaceError } from "../../agent-os/enzo-workspace/types";
import { enzoWorkspaceEnabled } from "../../agent-os/enzo-workspace/flags";

function fail(req: Request, err: unknown): Response {
  if (err instanceof EnzoWorkspaceError) {
    return jsonResponse({ error: { code: err.code, message: err.message, detail: err.detail } }, err.httpStatus, req, {});
  }
  return jsonResponse({ error: { code: "INTERNAL", message: err instanceof Error ? err.message : "internal_error" } }, 500, req, {});
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body as Record<string, unknown> : {};
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

export async function handleEnzoWorkspaceRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  if (pathname !== "/api/agent-os/enzo-workspace" && !pathname.startsWith("/api/agent-os/enzo-workspace/")) return null;
  if (!enzoWorkspaceEnabled()) {
    return jsonResponse({ error: { code: "DISABLED", message: "Phase 20.94 workspace is disabled (PAO_ENZO_WORKSPACE=0)" } }, 403, req, {});
  }
  const service = getEnzoWorkspaceService();

  try {
    if (req.method === "GET" && pathname === "/api/agent-os/enzo-workspace/health") {
      return jsonResponse(service.health(), 200, req, {});
    }
    if (req.method === "GET" && pathname === "/api/agent-os/enzo-workspace/models") {
      return jsonResponse({ ok: true, models: service.models() }, 200, req, {});
    }
    if (req.method === "POST" && pathname === "/api/agent-os/enzo-workspace/models/route") {
      const body = await readJson(req);
      return jsonResponse({ ok: true, route: service.route({
        requirements: Array.isArray(body.requirements) ? body.requirements.map(String) : ["text.chat"],
        tools: body.tools === true,
        structuredOutput: body.structuredOutput === true,
        reasoning: body.reasoning === true,
        localOnly: body.localOnly === true,
        maxCostUsd: typeof body.maxCostUsd === "number" ? body.maxCostUsd : undefined,
        denyProviders: Array.isArray(body.denyProviders) ? body.denyProviders.map(String) : undefined,
        allowProviders: Array.isArray(body.allowProviders) ? body.allowProviders.map(String) : undefined,
        requestedId: str(body.requestedId),
      }) }, 200, req, {});
    }
    if (req.method === "GET" && pathname === "/api/agent-os/enzo-workspace/agents") {
      return jsonResponse({ ok: true, agents: service.listAgents() }, 200, req, {});
    }
    if (req.method === "POST" && pathname === "/api/agent-os/enzo-workspace/agents/draft") {
      const body = await readJson(req);
      const drafted = service.draft(String(body.request ?? ""), str(body.slug));
      return jsonResponse({ ok: true, ...drafted }, 200, req, {});
    }
    if (req.method === "POST" && pathname === "/api/agent-os/enzo-workspace/agents") {
      const body = await readJson(req);
      const drafted = service.draft(String(body.request ?? ""), str(body.slug));
      const saved = service.saveDraft(drafted.blueprint, actor(ctx, body));
      return jsonResponse({ ok: true, agent: saved, analysis: drafted.analysis }, 201, req, {});
    }
    if (req.method === "GET" && pathname === "/api/agent-os/enzo-workspace/skills") {
      const resolved = service.resolveSkills("list");
      return jsonResponse({ ok: true, composition: resolved.composition }, 200, req, {});
    }
    if (req.method === "POST" && pathname === "/api/agent-os/enzo-workspace/skills/resolve") {
      const body = await readJson(req);
      return jsonResponse({ ok: true, ...service.resolveSkills(String(body.request ?? "")) }, 200, req, {});
    }
    if (req.method === "GET" && pathname === "/api/agent-os/enzo-workspace/runs") {
      return jsonResponse({ ok: true, runs: service.listRuns() }, 200, req, {});
    }
    if (req.method === "POST" && pathname === "/api/agent-os/enzo-workspace/runs") {
      const body = await readJson(req);
      const inspection = await service.createAndRun({
        request: String(body.request ?? ""),
        mode: str(body.mode) as never,
        actor: actor(ctx, body),
        profile: str(body.profile) as never,
        workspaceRoot: str(body.workspaceRoot),
      });
      return jsonResponse({ ok: true, ...inspection }, 201, req, {});
    }
    if (req.method === "GET" && pathname === "/api/agent-os/enzo-workspace/approvals") {
      return jsonResponse({ ok: true, approvals: service.approvals() }, 200, req, {});
    }
    if (req.method === "POST" && pathname === "/api/agent-os/enzo-workspace/research") {
      const body = await readJson(req);
      const result = await service.research(String(body.question ?? body.request ?? ""));
      return jsonResponse({ ok: true, result }, 201, req, {});
    }
    if (req.method === "GET" && pathname === "/api/agent-os/enzo-workspace/memory/search") {
      const q = url.searchParams.get("q") ?? "";
      return jsonResponse({ ok: true, lessons: service.memorySearch(q, url.searchParams.get("agent") ?? undefined) }, 200, req, {});
    }
    if (req.method === "POST" && pathname === "/api/agent-os/enzo-workspace/credentials") {
      const body = await readJson(req);
      const saved = service.putSecret({ secretRef: String(body.secretRef ?? ""), provider: str(body.provider), secret: String(body.secret ?? ""), scopes: Array.isArray(body.scopes) ? body.scopes.map(String) : undefined });
      return jsonResponse({ ok: true, secretRef: saved.secretRef, hash: saved.hash }, 201, req, {});
    }
    if (req.method === "POST" && pathname === "/api/agent-os/enzo-workspace/credentials/lease") {
      const body = await readJson(req);
      const lease = service.issueLease({
        secretRef: String(body.secretRef ?? ""),
        runId: String(body.runId ?? "none"),
        principal: actor(ctx, body),
        scopes: Array.isArray(body.scopes) ? body.scopes.map(String) : undefined,
        ttlMs: typeof body.ttlMs === "number" ? body.ttlMs : undefined,
        maxUses: typeof body.maxUses === "number" ? body.maxUses : undefined,
        provider: str(body.provider),
      });
      return jsonResponse({ ok: true, lease }, 201, req, {});
    }
    if (req.method === "POST" && pathname === "/api/agent-os/enzo-workspace/tools/invoke") {
      const body = await readJson(req);
      const result = await service.invokeTool({
        runId: String(body.runId ?? ""),
        toolName: String(body.toolName ?? ""),
        args: (body.args && typeof body.args === "object" ? body.args as Record<string, unknown> : {}),
        actor: actor(ctx, body),
        workspacePath: String(body.workspacePath ?? process.cwd()),
        approved: body.approved === true,
      });
      return jsonResponse({ ok: true, result }, 200, req, {});
    }

    // Parameterized slices
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/enzo-workspace/approvals/") && pathname.endsWith("/approve")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/enzo-workspace/approvals/".length, -"/approve".length));
      const body = await readJson(req);
      return jsonResponse({ ok: true, ...await service.decideApproval(id, true, actor(ctx, body), str(body.note)) }, 200, req, {});
    }
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/enzo-workspace/approvals/") && pathname.endsWith("/deny")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/enzo-workspace/approvals/".length, -"/deny".length));
      const body = await readJson(req);
      return jsonResponse({ ok: true, ...await service.decideApproval(id, false, actor(ctx, body), str(body.note)) }, 200, req, {});
    }
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/enzo-workspace/memory/lessons/") && pathname.endsWith("/accept")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/enzo-workspace/memory/lessons/".length, -"/accept".length));
      return jsonResponse({ ok: true, lesson: service.lessonStatus(id, "accepted") }, 200, req, {});
    }
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/enzo-workspace/memory/lessons/") && pathname.endsWith("/quarantine")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/enzo-workspace/memory/lessons/".length, -"/quarantine".length));
      return jsonResponse({ ok: true, lesson: service.lessonStatus(id, "quarantined") }, 200, req, {});
    }
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/enzo-workspace/runs/") && pathname.endsWith("/cancel")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/enzo-workspace/runs/".length, -"/cancel".length));
      return jsonResponse({ ok: true, run: service.cancel(id, actor(ctx)) }, 200, req, {});
    }
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/enzo-workspace/runs/") && pathname.endsWith("/replay")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/enzo-workspace/runs/".length, -"/replay".length));
      const body = await readJson(req);
      const mode = body.mode === "re-run-same-plan" ? "re-run-same-plan" : "inspect-only";
      return jsonResponse({ ok: true, ...await service.replay(id, mode, actor(ctx, body)) }, 200, req, {});
    }
    if (req.method === "GET" && pathname.startsWith("/api/agent-os/enzo-workspace/runs/") && pathname.endsWith("/events")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/enzo-workspace/runs/".length, -"/events".length));
      const inspection = service.inspect(id);
      return jsonResponse({ ok: true, events: inspection.events }, 200, req, {});
    }
    if (req.method === "GET" && pathname.startsWith("/api/agent-os/enzo-workspace/runs/")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/enzo-workspace/runs/".length));
      if (id.includes("/")) return jsonResponse({ error: { code: "not_found", message: "unknown run subroute" } }, 404, req, {});
      return jsonResponse({ ok: true, ...service.inspect(id) }, 200, req, {});
    }
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/enzo-workspace/agents/") && pathname.endsWith("/run")) {
      const rest = decodeURIComponent(pathname.slice("/api/agent-os/enzo-workspace/agents/".length, -"/run".length));
      const [slug, version] = rest.split("/");
      const blueprint = service.getAgent(slug ?? "", Number(version ?? 1));
      const body = await readJson(req);
      const inspection = await service.createAndRun({ request: str(body.request) ?? blueprint.objective, mode: "agent", actor: actor(ctx, body) });
      return jsonResponse({ ok: true, ...inspection }, 201, req, {});
    }
    if (req.method === "GET" && pathname.startsWith("/api/agent-os/enzo-workspace/agents/")) {
      const rest = decodeURIComponent(pathname.slice("/api/agent-os/enzo-workspace/agents/".length));
      const [slug, version] = rest.split("/");
      return jsonResponse({ ok: true, agent: service.getAgent(slug ?? "", Number(version ?? 1)) }, 200, req, {});
    }

    return jsonResponse({ error: { code: "not_found", message: "unknown enzo-workspace route" } }, 404, req, {});
  } catch (err) {
    return fail(req, err);
  }
}
