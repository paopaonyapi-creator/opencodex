// Phase 20.8 — Agency Intelligence Layer Management API Routes
// REST endpoints under /api/agency/* and /api/agent-os/agency/*

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import {
  getAgentRegistry,
  getAgentSearchEngine,
  getLazyAgentLoader,
  getDynamicTeamBuilder,
  getPresetLoader,
  getAgencyOrchestrator,
  getAgencySyncService,
  getCodexAgencyAdapter,
} from "../../agent-os/agency";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_request", message } }, 400, req, {});
}

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

export async function handleAgencyRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;

  let path = "";
  if (url.pathname.startsWith("/api/agency/")) {
    path = url.pathname.slice("/api/agency/".length);
  } else if (url.pathname === "/api/agency") {
    path = "";
  } else if (url.pathname.startsWith("/api/agent-os/agency/")) {
    path = url.pathname.slice("/api/agent-os/agency/".length);
  } else if (url.pathname === "/api/agent-os/agency") {
    path = "";
  } else {
    return null;
  }

  const registry = getAgentRegistry();
  const searchEngine = getAgentSearchEngine();
  const syncService = getAgencySyncService();
  const orchestrator = getAgencyOrchestrator();
  const teamBuilder = getDynamicTeamBuilder();
  const presetLoader = getPresetLoader();
  const codexAdapter = getCodexAgencyAdapter();

  // 1. GET /api/agency/status
  if ((path === "status" || path === "") && req.method === "GET") {
    const status = syncService.getStatus();
    return jsonResponse({ success: true, ...status }, 200, req, {});
  }

  // 2. POST /api/agency/sync
  if (path === "sync" && req.method === "POST") {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // Empty body allowed
    }
    const syncResult = await syncService.sync({
      forceSnapshot: Boolean(body.forceSnapshot),
    });
    return jsonResponse({ success: true, result: syncResult }, 200, req, {});
  }

  // 3. GET /api/agency/divisions
  if (path === "divisions" && req.method === "GET") {
    const divs = registry.listDivisions();
    return jsonResponse({ success: true, divisions: divs }, 200, req, {});
  }

  // 4. GET /api/agency/agents
  if (path === "agents" && req.method === "GET") {
    const division = url.searchParams.get("division") ?? undefined;
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;
    const agents = registry.listAgents({ division, limit, enabledOnly: false });
    return jsonResponse({ success: true, count: agents.length, agents }, 200, req, {});
  }

  // 5. GET /api/agency/agents/:slug
  if (path.startsWith("agents/") && req.method === "GET") {
    const slug = path.slice("agents/".length);
    const includeBody = url.searchParams.get("includeBody") === "true";

    const agent = registry.getAgentBySlug(slug);
    if (!agent) {
      return notFound(req, `Agent '${slug}' not found`);
    }

    if (includeBody) {
      const loader = getLazyAgentLoader();
      const withBody = await loader.loadAgentWithBody(slug, { sanitize: true });
      return jsonResponse({ success: true, agent: withBody }, 200, req, {});
    }

    return jsonResponse({ success: true, agent }, 200, req, {});
  }

  // 6. POST /api/agency/search
  if (path === "search" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as any;
    if (!body.query) {
      return badRequest(req, "Missing 'query' in search request");
    }

    const results = searchEngine.search({
      query: String(body.query),
      division: body.division ? String(body.division) : undefined,
      limit: body.limit ? Number(body.limit) : 6,
    });

    return jsonResponse({ success: true, count: results.length, results }, 200, req, {});
  }

  // 7. POST /api/agency/teams/build
  if (path === "teams/build" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as any;
    if (!body.mission) {
      return badRequest(req, "Missing 'mission' in build team request");
    }

    const team = await teamBuilder.buildTeam(String(body.mission), {
      maxAgents: body.maxAgents ? Number(body.maxAgents) : undefined,
      presetId: body.presetId ? String(body.presetId) : undefined,
    });

    return jsonResponse({ success: true, team }, 200, req, {});
  }

  // 8. GET /api/agency/teams/presets
  if (path === "teams/presets" && req.method === "GET") {
    const presets = presetLoader.listPresets();
    return jsonResponse({ success: true, presets }, 200, req, {});
  }

  // 9. POST /api/agency/runs
  if (path === "runs" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as any;
    if (!body.mission) {
      return badRequest(req, "Missing 'mission' in run request");
    }

    const run = await orchestrator.createAndExecuteRun({
      mission: String(body.mission),
      presetId: body.presetId ? String(body.presetId) : undefined,
      maxAgents: body.maxAgents ? Number(body.maxAgents) : undefined,
      mode: body.mode,
      autoApprove: Boolean(body.autoApprove),
    });

    return jsonResponse({ success: true, run }, 200, req, {});
  }

  // 10. GET /api/agency/runs
  if (path === "runs" && req.method === "GET") {
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : 20;
    const status = url.searchParams.get("status") as any;
    const runs = orchestrator.listRuns(limit, status);
    return jsonResponse({ success: true, count: runs.length, runs }, 200, req, {});
  }

  // 11. GET /api/agency/runs/:id
  if (path.startsWith("runs/") && req.method === "GET") {
    const id = path.slice("runs/".length);
    const run = orchestrator.getRun(id);
    if (!run) {
      return notFound(req, `Run '${id}' not found`);
    }
    return jsonResponse({ success: true, run }, 200, req, {});
  }

  // 12. POST /api/agency/runs/:id/approve
  if (path.startsWith("runs/") && path.endsWith("/approve") && req.method === "POST") {
    const id = path.slice("runs/".length, -"/approve".length);
    const body = (await req.json().catch(() => ({}))) as any;
    try {
      const run = await orchestrator.approveRun(id, body.operator ?? "web-operator");
      return jsonResponse({ success: true, run }, 200, req, {});
    } catch (err) {
      return badRequest(req, String(err));
    }
  }

  // 13. POST /api/agency/runs/:id/cancel
  if (path.startsWith("runs/") && path.endsWith("/cancel") && req.method === "POST") {
    const id = path.slice("runs/".length, -"/cancel".length);
    const cancelled = orchestrator.cancelRun(id);
    return jsonResponse({ success: cancelled }, 200, req, {});
  }

  // 14. POST /api/agency/export/codex
  if (path === "export/codex" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as any;
    if (!body.team) {
      return badRequest(req, "Missing 'team' in export request");
    }

    const exportResult = await codexAdapter.exportTeamToCodexToml(body.team);
    return jsonResponse({ success: true, result: exportResult }, 200, req, {});
  }

  return notFound(req, `Unknown agency endpoint: ${path}`);
}
