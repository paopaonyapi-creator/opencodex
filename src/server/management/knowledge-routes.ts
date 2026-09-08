// Phase 21 — Knowledge Gateway Management REST API Routes (spec sections 44, 56(Q)).
//
// Endpoints mounted under /api/knowledge/* and /api/agent-os/knowledge/*
// Exposes grounded search, claim verification, evidence packs, phase dependency graphs,
// provider health checks, and document indexing.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getKnowledgeGateway } from "../../agent-os/knowledge/gateway";
import { getKnowledgeConfig } from "../../agent-os/knowledge/config";
import type { KnowledgeDocType, TaskRiskLevel } from "../../agent-os/knowledge/types";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_request", message } }, 400, req, {});
}

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

export async function handleKnowledgeRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;

  let path = "";
  if (url.pathname.startsWith("/api/knowledge/")) {
    path = url.pathname.slice("/api/knowledge/".length);
  } else if (url.pathname === "/api/knowledge") {
    path = "";
  } else if (url.pathname.startsWith("/api/agent-os/knowledge/")) {
    path = url.pathname.slice("/api/agent-os/knowledge/".length);
  } else if (url.pathname === "/api/agent-os/knowledge") {
    path = "";
  } else {
    return null;
  }

  const gw = getKnowledgeGateway();
  const config = getKnowledgeConfig();

  // 1. GET /api/knowledge/status or /api/knowledge
  if (path === "" || path === "status") {
    if (req.method === "GET") {
      const health = await gw.getHealth();
      return jsonResponse(
        {
          status: "online",
          version: "21.0.0",
          enabled: config.enabled,
          healthStatus: health.status,
          stats: health.stats,
          providers: health.providers,
        },
        200,
        req,
        {},
      );
    }
    return null;
  }

  // 2. GET /api/knowledge/health
  if (path === "health") {
    if (req.method === "GET") {
      const health = await gw.getHealth();
      return jsonResponse(health, 200, req, {});
    }
    return null;
  }

  // 3. POST /api/knowledge/search
  if (path === "search") {
    if (req.method === "POST") {
      let body: any = {};
      try {
        body = await req.json();
      } catch {
        return badRequest(req, "Invalid JSON body");
      }

      if (!body.query || typeof body.query !== "string") {
        return badRequest(req, "Missing required string field 'query'");
      }

      const res = await gw.search({
        query: body.query,
        types: Array.isArray(body.types) ? (body.types as KnowledgeDocType[]) : undefined,
        limit: body.limit ? Number(body.limit) : 10,
      });

      return jsonResponse(res, 200, req, {});
    }
    return null;
  }

  // 4. POST /api/knowledge/verify
  if (path === "verify") {
    if (req.method === "POST") {
      let body: any = {};
      try {
        body = await req.json();
      } catch {
        return badRequest(req, "Invalid JSON body");
      }

      if (!body.claim || typeof body.claim !== "string") {
        return badRequest(req, "Missing required string field 'claim'");
      }

      const verification = await gw.verifyClaim(body.claim);
      return jsonResponse(verification, 200, req, {});
    }
    return null;
  }

  // 5. POST /api/knowledge/evidence
  if (path === "evidence") {
    if (req.method === "POST") {
      let body: any = {};
      try {
        body = await req.json();
      } catch {
        return badRequest(req, "Invalid JSON body");
      }

      if (!body.task || typeof body.task !== "string") {
        return badRequest(req, "Missing required string field 'task'");
      }

      const pack = await gw.buildEvidencePack({
        title: body.task,
        description: body.description,
        riskLevel: body.risk_level as TaskRiskLevel,
        targetComponents: body.components,
      });

      return jsonResponse(pack, 200, req, {});
    }
    return null;
  }

  // 6. GET /api/knowledge/phases and /api/knowledge/phases/:id
  if (path === "phases" || path.startsWith("phases/")) {
    if (req.method === "GET") {
      if (path === "phases") {
        const searchRes = await gw.search({ query: "phase", types: ["phase"], limit: 50 });
        return jsonResponse({ phases: searchRes.results, count: searchRes.results.length }, 200, req, {});
      }

      const phaseId = path.slice("phases/".length);
      const phase = await gw.getPhase(phaseId);
      if (!phase) {
        return notFound(req, `Phase "${phaseId}" not found`);
      }
      return jsonResponse({ phase }, 200, req, {});
    }
    return null;
  }

  // 7. POST /api/knowledge/compare
  if (path === "compare") {
    if (req.method === "POST") {
      let body: any = {};
      try {
        body = await req.json();
      } catch {
        return badRequest(req, "Invalid JSON body");
      }

      if (!body.phase_a || !body.phase_b) {
        return badRequest(req, "Missing required fields 'phase_a' and 'phase_b'");
      }

      const comp = await gw.comparePhases(String(body.phase_a), String(body.phase_b));
      return jsonResponse(comp, 200, req, {});
    }
    return null;
  }

  // 8. GET /api/knowledge/dependencies/:id
  if (path.startsWith("dependencies/")) {
    if (req.method === "GET") {
      const target = path.slice("dependencies/".length);
      const deps = await gw.getDependencies(target);
      return jsonResponse(deps, 200, req, {});
    }
    return null;
  }

  // 9. POST /api/knowledge/refresh
  if (path === "refresh") {
    if (req.method === "POST") {
      const res = gw.refreshKnowledge();
      return jsonResponse(res, 200, req, {});
    }
    return null;
  }

  return null;
}
