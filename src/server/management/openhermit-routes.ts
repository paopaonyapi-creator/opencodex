// Phase 20.98 — OpenHermit control plane routes (/api/agent-os/openhermit/*).

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getOpenHermitService } from "../../agent-os/openhermit/service";
import { DeepResearchRuntime } from "../../agent-os/openhermit/research";
import { HermitGovernanceBridge } from "../../agent-os/openhermit/governance-bridge";
import { openHermitEnabled } from "../../agent-os/openhermit/flags";
import { HermitError, type FleetAction } from "../../agent-os/openhermit/types";

function fail(req: Request, err: unknown): Response {
  if (err instanceof HermitError) {
    return jsonResponse(
      { error: { code: err.code, message: err.message, detail: err.detail } },
      err.httpStatus,
      req,
      {},
    );
  }
  return jsonResponse(
    { error: { code: "INTERNAL", message: err instanceof Error ? err.message : "OpenHermit request failed" } },
    500,
    req,
    {},
  );
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
  return String(body?.actor ?? ctx.req.headers.get("x-pao-actor") ?? "operator").slice(0, 64);
}

export async function handleOpenHermitRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  if (pathname !== "/api/agent-os/openhermit" && !pathname.startsWith("/api/agent-os/openhermit/")) return null;

  if (!openHermitEnabled()) {
    return jsonResponse(
      { error: { code: "DISABLED", message: "Phase 20.98 OpenHermit runtime is disabled" } },
      403,
      req,
      {},
    );
  }

  const svc = getOpenHermitService();
  const research = new DeepResearchRuntime();
  const gov = new HermitGovernanceBridge();

  try {
    // Health & doctor
    if (req.method === "GET" && pathname === "/api/agent-os/openhermit/health") {
      return jsonResponse(await svc.health(), 200, req, {});
    }
    if (req.method === "GET" && pathname === "/api/agent-os/openhermit/compatibility") {
      return jsonResponse({ ok: true, compatibility: await svc.checkCompatibility() }, 200, req, {});
    }

    // Agents
    if (req.method === "GET" && pathname === "/api/agent-os/openhermit/agents") {
      const ws = url.searchParams.get("workspaceId") ?? undefined;
      return jsonResponse({ ok: true, agents: svc.listAgents(ws) }, 200, req, {});
    }
    if (req.method === "POST" && pathname === "/api/agent-os/openhermit/agents") {
      const body = await readJson(req);
      const agent = await svc.createAgent({
        workspaceId: String(body.workspaceId ?? "default"),
        name: String(body.name ?? "agent"),
        kind: (body.kind as any) ?? "generalist",
        instruction: String(body.instruction ?? ""),
        policyProfile: typeof body.policyProfile === "string" ? body.policyProfile : undefined,
        approvalProfile: typeof body.approvalProfile === "string" ? body.approvalProfile : undefined,
        actor: actor(ctx, body),
      });
      return jsonResponse({ ok: true, agent }, 201, req, {});
    }
    if (pathname.startsWith("/api/agent-os/openhermit/agents/")) {
      const sub = pathname.slice("/api/agent-os/openhermit/agents/".length);
      const parts = sub.split("/");
      const agentId = decodeURIComponent(parts[0]);

      if (parts.length === 1 && req.method === "GET") {
        return jsonResponse({ ok: true, agent: svc.requireAgent(agentId) }, 200, req, {});
      }
      if (parts.length === 2 && req.method === "POST" && parts[1] === "start") {
        const a = await svc.startAgent(agentId, actor(ctx));
        return jsonResponse({ ok: true, agent: a }, 200, req, {});
      }
      if (parts.length === 2 && req.method === "POST" && parts[1] === "stop") {
        const body = await readJson(req);
        const a = await svc.stopAgent(agentId, actor(ctx, body), String(body.reason ?? "user_stop"));
        return jsonResponse({ ok: true, agent: a }, 200, req, {});
      }
      if (parts.length === 2 && req.method === "POST" && parts[1] === "restart") {
        const a = await svc.restartAgent(agentId, actor(ctx));
        return jsonResponse({ ok: true, agent: a }, 200, req, {});
      }
      if (parts.length === 2 && req.method === "POST" && parts[1] === "reconcile") {
        const r = await svc.reconcileAgent(agentId, actor(ctx));
        return jsonResponse({ ok: true, ...r }, 200, req, {});
      }
      if (parts.length === 2 && req.method === "GET" && parts[1] === "sessions") {
        return jsonResponse({ ok: true, sessions: svc.listSessionsForAgent(agentId) }, 200, req, {});
      }
      if (parts.length === 2 && req.method === "GET" && parts[1] === "skills") {
        return jsonResponse({ ok: true, skills: gov.listAgentSkills(agentId) }, 200, req, {});
      }
      if (parts.length === 2 && req.method === "GET" && parts[1] === "mcp") {
        return jsonResponse({ ok: true, mcp: gov.listAgentMcp(agentId) }, 200, req, {});
      }
    }

    // Sessions
    if (req.method === "POST" && pathname === "/api/agent-os/openhermit/sessions") {
      const body = await readJson(req);
      const sess = await svc.createSession(
        String(body.agentId),
        actor(ctx, body),
        typeof body.traceId === "string" ? body.traceId : undefined,
      );
      return jsonResponse({ ok: true, session: sess }, 201, req, {});
    }
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/openhermit/sessions/") && pathname.endsWith("/message")) {
      const sid = decodeURIComponent(pathname.slice("/api/agent-os/openhermit/sessions/".length, -"/message".length));
      const body = await readJson(req);
      const res = await svc.sendMessage(sid, String(body.message ?? ""), actor(ctx, body));
      return jsonResponse({ ok: true, ...res }, 200, req, {});
    }
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/openhermit/sessions/") && pathname.endsWith("/checkpoint")) {
      const sid = decodeURIComponent(pathname.slice("/api/agent-os/openhermit/sessions/".length, -"/checkpoint".length));
      const res = await svc.checkpointSession(sid, actor(ctx));
      return jsonResponse({ ok: true, ...res }, 200, req, {});
    }
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/openhermit/sessions/") && pathname.endsWith("/resume")) {
      const sid = decodeURIComponent(pathname.slice("/api/agent-os/openhermit/sessions/".length, -"/resume".length));
      const s = await svc.resumeSession(sid, actor(ctx));
      return jsonResponse({ ok: true, session: s }, 200, req, {});
    }
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/openhermit/sessions/") && pathname.endsWith("/close")) {
      const sid = decodeURIComponent(pathname.slice("/api/agent-os/openhermit/sessions/".length, -"/close".length));
      await svc.closeSession(sid, actor(ctx));
      return jsonResponse({ ok: true }, 200, req, {});
    }

    // Approvals
    if (req.method === "GET" && pathname === "/api/agent-os/openhermit/approvals") {
      const state = url.searchParams.get("state") ?? undefined;
      const agentId = url.searchParams.get("agentId") ?? undefined;
      return jsonResponse({ ok: true, approvals: svc.listApprovals({ state: state as any, agentId }) }, 200, req, {});
    }
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/openhermit/approvals/") && pathname.endsWith("/approve")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/openhermit/approvals/".length, -"/approve".length));
      const body = await readJson(req);
      const appr = svc.decideApproval(id, "approved", actor(ctx, body), typeof body.reason === "string" ? body.reason : undefined);
      return jsonResponse({ ok: true, approval: appr }, 200, req, {});
    }
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/openhermit/approvals/") && pathname.endsWith("/reject")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/openhermit/approvals/".length, -"/reject".length));
      const body = await readJson(req);
      const appr = svc.decideApproval(id, "rejected", actor(ctx, body), typeof body.reason === "string" ? body.reason : undefined);
      return jsonResponse({ ok: true, approval: appr }, 200, req, {});
    }

    // Fleet bulk actions
    if (req.method === "POST" && pathname === "/api/agent-os/openhermit/fleet/impact") {
      const body = await readJson(req);
      const impact = svc.calculateFleetImpact(
        String(body.action) as FleetAction,
        Array.isArray(body.agentIds) ? body.agentIds.map(String) : [],
      );
      return jsonResponse({ ok: true, impact }, 200, req, {});
    }
    if (req.method === "POST" && pathname === "/api/agent-os/openhermit/fleet/execute") {
      const body = await readJson(req);
      const res = await svc.executeFleetAction(
        String(body.action) as FleetAction,
        Array.isArray(body.agentIds) ? body.agentIds.map(String) : [],
        actor(ctx, body),
        typeof body.approvalId === "string" ? body.approvalId : undefined,
      );
      return jsonResponse({ ok: true, ...res }, 200, req, {});
    }

    // Deep Research
    if (req.method === "POST" && pathname === "/api/agent-os/openhermit/research/create") {
      const body = await readJson(req);
      const run = research.createRun({
        question: String(body.question ?? ""),
        agentId: typeof body.agentId === "string" ? body.agentId : undefined,
        actor: actor(ctx, body),
      });
      return jsonResponse({ ok: true, run }, 201, req, {});
    }
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/openhermit/research/") && pathname.endsWith("/approve")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/openhermit/research/".length, -"/approve".length));
      const run = research.approvePlan(id, actor(ctx));
      return jsonResponse({ ok: true, run }, 200, req, {});
    }
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/openhermit/research/") && pathname.endsWith("/execute")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/openhermit/research/".length, -"/execute".length));
      const report = await research.executeRun(id, actor(ctx));
      return jsonResponse({ ok: true, report }, 200, req, {});
    }

    // Skills & MCP assignment
    if (req.method === "POST" && pathname === "/api/agent-os/openhermit/skills/assign") {
      const body = await readJson(req);
      const skill = await gov.assignSkill({
        agentId: String(body.agentId),
        skillId: String(body.skillId),
        version: typeof body.version === "string" ? body.version : undefined,
        actor: actor(ctx, body),
      });
      return jsonResponse({ ok: true, skill }, 201, req, {});
    }
    if (req.method === "POST" && pathname === "/api/agent-os/openhermit/mcp/assign") {
      const body = await readJson(req);
      const mcp = await gov.assignMcp({
        agentId: String(body.agentId),
        serverId: String(body.serverId),
        toolName: typeof body.toolName === "string" ? body.toolName : undefined,
        actor: actor(ctx, body),
      });
      return jsonResponse({ ok: true, mcp }, 201, req, {});
    }

    // Events
    if (req.method === "GET" && pathname === "/api/agent-os/openhermit/events") {
      const agentId = url.searchParams.get("agentId") ?? undefined;
      const eventType = url.searchParams.get("eventType") ?? undefined;
      return jsonResponse({ ok: true, events: svc.listEvents({ agentId, eventType }) }, 200, req, {});
    }

    return jsonResponse({ error: { code: "not_found", message: "unknown openhermit route" } }, 404, req, {});
  } catch (err) {
    return fail(req, err);
  }
}
