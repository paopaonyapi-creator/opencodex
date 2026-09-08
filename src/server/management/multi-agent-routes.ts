// Phase 20.13 — Pao-hubPro Browser Multi-Agent REST API Routes
//
// Endpoints mounted under /api/browser/missions/* and /api/agent-os/browser/missions/*
// Exposes mission CRUD, step-by-step agent dispatches, cross-agent handshakes,
// QA evaluations, approval gates, and complete end-to-end pipeline execution.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getBrowserMultiAgentCoordinator } from "../../agent-os/browser/multi-agent/coordinator";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_request", message } }, 400, req, {});
}

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

export async function handleMultiAgentRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;

  let path = "";
  if (url.pathname.startsWith("/api/browser/missions/")) {
    path = url.pathname.slice("/api/browser/missions/".length);
  } else if (url.pathname === "/api/browser/missions") {
    path = "";
  } else if (url.pathname.startsWith("/api/agent-os/browser/missions/")) {
    path = url.pathname.slice("/api/agent-os/browser/missions/".length);
  } else if (url.pathname === "/api/agent-os/browser/missions") {
    path = "";
  } else {
    return null;
  }

  const coordinator = getBrowserMultiAgentCoordinator();

  // 1. GET /api/browser/missions & POST /api/browser/missions
  if (path === "") {
    if (req.method === "GET") {
      const targetDomain = url.searchParams.get("targetDomain") || undefined;
      const status = (url.searchParams.get("status") as any) || undefined;
      const limit = Number(url.searchParams.get("limit") || "50");
      const missions = coordinator.listMissions({ targetDomain, status, limit });
      return jsonResponse({ missions }, 200, req, {});
    }

    if (req.method === "POST") {
      let body: any;
      try {
        body = await req.json();
      } catch {
        return badRequest(req, "Invalid JSON body");
      }

      if (!body.name || !body.targetDomain || !body.goal) {
        return badRequest(req, "Missing required fields: 'name', 'targetDomain', 'goal'");
      }

      const mission = coordinator.createMission({
        name: body.name,
        targetDomain: body.targetDomain,
        goal: body.goal,
        assignedAgents: body.assignedAgents,
        contextData: body.contextData,
        evidencePackId: body.evidencePackId,
      });

      return jsonResponse({ success: true, mission }, 201, req, {});
    }

    return null;
  }

  // Parse path segments: :id, :id/action
  const parts = path.split("/");
  const missionId = parts[0];
  const subAction = parts[1];

  // 2. GET /api/browser/missions/:id & DELETE /api/browser/missions/:id
  if (parts.length === 1) {
    if (req.method === "GET") {
      const mission = coordinator.getMission(missionId);
      if (!mission) return notFound(req, `Mission '${missionId}' not found`);

      const dispatches = coordinator.listDispatches(missionId);
      const handshakes = coordinator.getHandshakes(missionId);
      const qaEvaluations = coordinator.getQAEvaluations(missionId);

      return jsonResponse(
        {
          mission,
          dispatches,
          handshakes,
          qaEvaluations,
        },
        200,
        req,
        {},
      );
    }

    if (req.method === "DELETE") {
      const deleted = coordinator.deleteMission(missionId);
      return jsonResponse({ success: deleted, id: missionId }, 200, req, {});
    }

    return null;
  }

  // 3. Sub-resource operations on mission
  if (parts.length === 2) {
    // GET /api/browser/missions/:id/dispatches
    if (subAction === "dispatches" && req.method === "GET") {
      const dispatches = coordinator.listDispatches(missionId);
      return jsonResponse({ dispatches }, 200, req, {});
    }

    // GET & POST /api/browser/missions/:id/handshakes
    if (subAction === "handshakes") {
      if (req.method === "GET") {
        const handshakes = coordinator.getHandshakes(missionId);
        return jsonResponse({ handshakes }, 200, req, {});
      }
      if (req.method === "POST") {
        let body: any;
        try {
          body = await req.json();
        } catch {
          return badRequest(req, "Invalid JSON body");
        }
        if (!body.fromAgent || !body.toAgent || !body.artifactType || !body.payload) {
          return badRequest(
            req,
            "Missing required fields: 'fromAgent', 'toAgent', 'artifactType', 'payload'",
          );
        }
        const handshake = coordinator.sendHandshake({
          missionId,
          fromAgent: body.fromAgent,
          toAgent: body.toAgent,
          artifactType: body.artifactType,
          payload: body.payload,
        });
        return jsonResponse({ success: true, handshake }, 201, req, {});
      }
    }

    // GET & POST /api/browser/missions/:id/qa
    if (subAction === "qa") {
      if (req.method === "GET") {
        const evaluations = coordinator.getQAEvaluations(missionId);
        return jsonResponse({ evaluations }, 200, req, {});
      }
      if (req.method === "POST") {
        let body: any = {};
        try {
          body = await req.json();
        } catch {
          // empty body acceptable
        }
        try {
          const evaluation = await coordinator.runQAStep(
            missionId,
            body.stepIndex || 1,
            body.tabId,
          );
          return jsonResponse({ success: true, evaluation }, 200, req, {});
        } catch (err: any) {
          return badRequest(req, err.message);
        }
      }
    }

    // POST /api/browser/missions/:id/pause
    if (subAction === "pause" && req.method === "POST") {
      let body: any = {};
      try {
        body = await req.json();
      } catch {
        // empty body is fine
      }
      const updated = coordinator.pauseMission(missionId, body.reason);
      return jsonResponse({ success: true, mission: updated }, 200, req, {});
    }

    // POST /api/browser/missions/:id/resume
    if (subAction === "resume" && req.method === "POST") {
      const updated = coordinator.resumeMission(missionId);
      return jsonResponse({ success: true, mission: updated }, 200, req, {});
    }

    // POST /api/browser/missions/:id/cancel
    if (subAction === "cancel" && req.method === "POST") {
      let body: any = {};
      try {
        body = await req.json();
      } catch {
        // empty body is fine
      }
      const updated = coordinator.cancelMission(missionId, body.reason);
      return jsonResponse({ success: true, mission: updated }, 200, req, {});
    }

    // POST /api/browser/missions/:id/approve
    if (subAction === "approve" && req.method === "POST") {
      let body: any;
      try {
        body = await req.json();
      } catch {
        return badRequest(req, "Invalid JSON body");
      }
      const decision = body.decision || "approve";
      const scope = body.scope || "once";
      const updated = coordinator.submitApproval(missionId, decision, scope);
      return jsonResponse({ success: true, mission: updated }, 200, req, {});
    }

    // POST /api/browser/missions/:id/research
    if (subAction === "research" && req.method === "POST") {
      let body: any;
      try {
        body = await req.json();
      } catch {
        return badRequest(req, "Invalid JSON body");
      }
      if (!body.url) return badRequest(req, "Missing required field: 'url'");

      try {
        const brief = await coordinator.runResearchStep(
          missionId,
          body.url,
          body.topic,
          body.tabId,
        );
        return jsonResponse({ success: true, research: brief }, 200, req, {});
      } catch (err: any) {
        return badRequest(req, err.message);
      }
    }

    // POST /api/browser/missions/:id/metadata
    if (subAction === "metadata" && req.method === "POST") {
      let body: any;
      try {
        body = await req.json();
      } catch {
        return badRequest(req, "Invalid JSON body");
      }
      if (!body.assetConcept) return badRequest(req, "Missing required field: 'assetConcept'");

      try {
        const metadata = await coordinator.runMetadataStep(missionId, body.assetConcept, {
          maxKeywords: body.maxKeywords,
          category: body.category,
          autofillTabId: body.autofillTabId,
        });
        return jsonResponse({ success: true, metadata }, 200, req, {});
      } catch (err: any) {
        return badRequest(req, err.message);
      }
    }

    // POST /api/browser/missions/:id/upload
    if (subAction === "upload" && req.method === "POST") {
      let body: any;
      try {
        body = await req.json();
      } catch {
        return badRequest(req, "Invalid JSON body");
      }
      if (!body.filePaths || !Array.isArray(body.filePaths)) {
        return badRequest(req, "Missing required array: 'filePaths'");
      }

      try {
        const upload = await coordinator.runUploadStep(
          missionId,
          body.filePaths,
          body.targetSelector,
          body.tabId,
        );
        return jsonResponse({ success: true, upload }, 200, req, {});
      } catch (err: any) {
        return badRequest(req, err.message);
      }
    }

    // POST /api/browser/missions/:id/review
    if (subAction === "review" && req.method === "POST") {
      let body: any;
      try {
        body = await req.json();
      } catch {
        return badRequest(req, "Invalid JSON body");
      }
      if (!body.action || !body.url) {
        return badRequest(req, "Missing required fields: 'action', 'url'");
      }

      try {
        const proposal = await coordinator.runReviewStep(
          missionId,
          body.action,
          body.url,
          body.affectedData || {},
        );
        return jsonResponse({ success: true, proposal }, 200, req, {});
      } catch (err: any) {
        return badRequest(req, err.message);
      }
    }

    // POST /api/browser/missions/:id/execute
    if (subAction === "execute" && req.method === "POST") {
      let body: any;
      try {
        body = await req.json();
      } catch {
        return badRequest(req, "Invalid JSON body");
      }
      if (!body.url || !body.assetConcept) {
        return badRequest(req, "Missing required fields: 'url', 'assetConcept'");
      }

      try {
        const result = await coordinator.executeFullMission(missionId, {
          url: body.url,
          assetConcept: body.assetConcept,
          files: body.files,
          targetSelector: body.targetSelector,
          tabId: body.tabId,
        });
        return jsonResponse({ success: true, ...result }, 200, req, {});
      } catch (err: any) {
        return badRequest(req, err.message);
      }
    }
  }

  return null;
}
