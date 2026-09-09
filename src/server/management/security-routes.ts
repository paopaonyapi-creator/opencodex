// Phase 25 — Pao Autonomous Security & Zero-Trust Threat Immunity Shield (ASTIS)
// REST Management API Endpoints
// Accessible via /api/agent-os/security/* and /api/security/*

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import {
  getThreatDetector,
  getActionAuthenticator,
  getQuarantineGuard,
  getSecurityVault,
  inspectAgentExecution,
  type ThreatCategory,
  type ThreatSeverity,
  type ActionProof,
} from "../../agent-os/security";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_request", message } }, 400, req, {});
}

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

export async function handleSecurityRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;

  let path = "";
  if (url.pathname.startsWith("/api/agent-os/security/")) {
    path = url.pathname.slice("/api/agent-os/security/".length);
  } else if (url.pathname === "/api/agent-os/security") {
    path = "";
  } else if (url.pathname.startsWith("/api/security/")) {
    path = url.pathname.slice("/api/security/".length);
  } else if (url.pathname === "/api/security") {
    path = "";
  } else {
    return null;
  }

  const detector = getThreatDetector();
  const authenticator = getActionAuthenticator();
  const guard = getQuarantineGuard();
  const vault = getSecurityVault();

  // 1. GET /metrics or GET /
  if (path === "metrics" || path === "metrics/" || path === "") {
    if (req.method === "GET") {
      const agents = guard.listAgentRecords();
      const activeCount = agents.filter((a) => a.state === "active" || a.state === "monitored").length;
      const quarantinedCount = agents.filter((a) => a.state === "quarantined" || a.state === "revoked").length;
      const metrics = vault.getMetrics(activeCount, quarantinedCount, detector.getTripwiresCount());

      return jsonResponse({ metrics }, 200, req, {});
    }
    return badRequest(req, `Method ${req.method} not allowed for metrics.`);
  }

  // 2. GET /incidents
  if (path === "incidents" || path === "incidents/") {
    if (req.method === "GET") {
      const category = (url.searchParams.get("category") as ThreatCategory) || undefined;
      const severity = (url.searchParams.get("severity") as ThreatSeverity) || undefined;
      const agentId = url.searchParams.get("agentId") || undefined;
      const limitRaw = url.searchParams.get("limit");
      const limit = limitRaw ? parseInt(limitRaw, 10) : 50;

      const incidents = vault.listIncidents({ category, severity, agentId, limit });
      return jsonResponse({ incidents }, 200, req, {});
    }
    return badRequest(req, `Method ${req.method} not allowed for incidents.`);
  }

  // 3. POST /inspect
  if (path === "inspect" || path === "inspect/") {
    if (req.method === "POST") {
      try {
        const body = (await req.json()) as {
          content?: string;
          payload?: string | Record<string, unknown>;
          agentId?: string;
          actionType?: string;
          context?: "prompt" | "command" | "output";
          proof?: ActionProof;
          secret?: string;
        };

        const rawContent = body.content ?? body.payload;
        if (rawContent === undefined || rawContent === null) {
          return badRequest(req, "Field 'content' or 'payload' is required for threat inspection.");
        }

        const agentId = body.agentId ?? "agent-lead-architect";
        const actionType = body.actionType ?? "general_execution";

        const result = inspectAgentExecution({
          agentId,
          actionType,
          payload: rawContent,
          proof: body.proof,
          secret: body.secret,
          context: body.context,
        });

        return jsonResponse({ inspection: result }, 200, req, {});
      } catch (e) {
        return badRequest(req, `Invalid JSON body: ${(e as Error).message}`);
      }
    }
    return badRequest(req, `Method ${req.method} not allowed for inspect.`);
  }

  // 4. GET /agents
  if (path === "agents" || path === "agents/") {
    if (req.method === "GET") {
      const agents = guard.listAgentRecords();
      return jsonResponse({ agents }, 200, req, {});
    }
    return badRequest(req, `Method ${req.method} not allowed for agents.`);
  }

  // 5. POST /quarantine
  if (path === "quarantine" || path === "quarantine/") {
    if (req.method === "POST") {
      try {
        const body = (await req.json()) as {
          agentId?: string;
          action?: "quarantine" | "release" | "revoke";
          reason?: string;
        };

        if (!body.agentId || !body.action) {
          return badRequest(req, "Fields 'agentId' and 'action' ('quarantine' | 'release' | 'revoke') are required.");
        }

        let updated;
        if (body.action === "quarantine") {
          updated = guard.quarantineAgent(body.agentId, body.reason ?? "Manual operator isolation.");
        } else if (body.action === "release") {
          updated = guard.releaseAgent(body.agentId);
        } else if (body.action === "revoke") {
          updated = guard.revokeAgent(body.agentId, body.reason ?? "Manual operator revocation.");
        } else {
          return badRequest(req, `Unknown action '${body.action}'. Must be 'quarantine', 'release', or 'revoke'.`);
        }

        return jsonResponse({ success: true, agent: updated }, 200, req, {});
      } catch (e) {
        return badRequest(req, `Invalid JSON body: ${(e as Error).message}`);
      }
    }
    return badRequest(req, `Method ${req.method} not allowed for quarantine.`);
  }

  // 6. POST /verify-proof
  if (path === "verify-proof" || path === "verify-proof/") {
    if (req.method === "POST") {
      try {
        const body = (await req.json()) as {
          proof?: ActionProof;
          expectedAgentId?: string;
          payload?: unknown;
          secret?: string;
        };

        if (!body.proof || !body.expectedAgentId || body.payload === undefined || !body.secret) {
          return badRequest(req, "Fields 'proof', 'expectedAgentId', 'payload', and 'secret' are required.");
        }

        const verification = authenticator.verifyProof(
          body.proof,
          body.expectedAgentId,
          body.payload,
          body.secret
        );

        return jsonResponse({ verification }, 200, req, {});
      } catch (e) {
        return badRequest(req, `Invalid JSON body: ${(e as Error).message}`);
      }
    }
    return badRequest(req, `Method ${req.method} not allowed for verify-proof.`);
  }

  return notFound(req, `Security endpoint '/${path}' not found.`);
}
