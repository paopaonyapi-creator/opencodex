// Phase 20.28 — Governance Gateway REST routes (/api/agent-os/governance/*).

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { PaoGovernanceGateway } from "../../agent-os/governance-gateway/gateway";
import { newGovId, type ActionRequest, type GovernanceMode } from "../../agent-os/governance-gateway/types";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_request", message } }, 400, req, {});
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

let gatewaySingleton: PaoGovernanceGateway | null = null;

function getGateway(): PaoGovernanceGateway {
  if (!gatewaySingleton) gatewaySingleton = new PaoGovernanceGateway();
  return gatewaySingleton;
}

/** Shared singleton for sibling surfaces — the Phase 20.33 AI workspace MCP
 *  gateway dispatches through the SAME gateway instance so policy, approvals,
 *  grants and audit stay coherent across surfaces. */
export function getSharedGovernanceGateway(): PaoGovernanceGateway {
  return getGateway();
}

/** Test seam. */
export function resetGovernanceGatewayForTests(): void {
  gatewaySingleton = null;
}

export async function handleGovernanceRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  const gateway = getGateway();

  // 1. GET /api/agent-os/governance/status
  if (req.method === "GET" && pathname === "/api/agent-os/governance/status") {
    return jsonResponse({
      mode: gateway.getMode(),
      providers: [{ id: "local", available: true }],
      policies: gateway.getPolicySet().length,
    }, 200, req, {});
  }

  // 1b. GET /api/agent-os/governance/policies
  if (req.method === "GET" && pathname === "/api/agent-os/governance/policies") {
    return jsonResponse({ policies: gateway.store.listPolicies() }, 200, req, {});
  }

  // 1c. POST /api/agent-os/governance/policies (save + activate; malformed packs keep baseline)
  if (req.method === "POST" && pathname === "/api/agent-os/governance/policies") {
    const body = await readJsonBody(req);
    const policy = body.policy as import("../../agent-os/governance-gateway/types").GovernancePolicy | undefined;
    if (!policy || typeof policy.id !== "string" || typeof policy.name !== "string"
      || !Array.isArray(policy.deny) || !Array.isArray(policy.requireApproval) || !Array.isArray(policy.allow)) {
      return badRequest(req, "Field 'policy' (GovernancePolicy with deny/requireApproval/allow arrays) is required");
    }
    gateway.store.savePolicy(policy, typeof body.createdBy === "string" ? body.createdBy : "dashboard");
    gateway.setPolicies(gateway.store.listPolicies());
    return jsonResponse({ saved: true, active: gateway.getPolicySet().length }, 200, req, {});
  }

  // 1d. POST /api/agent-os/governance/policies/test — simulate WITHOUT executing (doc §43)
  if (req.method === "POST" && pathname === "/api/agent-os/governance/policies/test") {
    const body = await readJsonBody(req);
    const action = body.action as ActionRequest | undefined;
    if (!action?.actionId || !action.agent || !action.tool) {
      return badRequest(req, "Field 'action' (ActionRequest) is required");
    }
    return jsonResponse({ simulation: gateway.simulate(action) }, 200, req, {});
  }

  // 2. POST /api/agent-os/governance/dispatch (internal governed execution)
  if (req.method === "POST" && pathname === "/api/agent-os/governance/dispatch") {
    const body = await readJsonBody(req);
    const action = body.action as ActionRequest | undefined;
    if (!action?.actionId || !action.agent || !action.tool) {
      return badRequest(req, "Field 'action' (ActionRequest) is required");
    }
    try {
      const result = await gateway.governedDispatch(action);
      return jsonResponse({ result }, 200, req, {});
    } catch (err) {
      return jsonResponse({ error: { code: "governance_error", message: err instanceof Error ? err.message : String(err) } }, 500, req, {});
    }
  }

  // 3. GET /api/agent-os/governance/grants
  if (req.method === "GET" && pathname === "/api/agent-os/governance/grants") {
    return jsonResponse({ grants: gateway.store.listGrants({ subjectId: url.searchParams.get("subjectId") ?? undefined, provider: url.searchParams.get("provider") ?? undefined }) }, 200, req, {});
  }

  // 4. POST /api/agent-os/governance/grants
  if (req.method === "POST" && pathname === "/api/agent-os/governance/grants") {
    const body = await readJsonBody(req);
    const subjectId = typeof body.subjectId === "string" ? body.subjectId : "";
    const provider = typeof body.provider === "string" ? body.provider : "";
    const capability = typeof body.capability === "string" ? body.capability : "";
    if (!subjectId || !provider || !capability) return badRequest(req, "Fields 'subjectId', 'provider', and 'capability' are required");
    const now = new Date().toISOString();
    const grant = {
      id: newGovId("grant"),
      subjectType: (typeof body.subjectType === "string" ? body.subjectType : "agent") as never,
      subjectId, provider, capability,
      resourcePattern: typeof body.resourcePattern === "string" ? body.resourcePattern : undefined,
      effectCeiling: (typeof body.effectCeiling === "string" ? body.effectCeiling : undefined) as never,
      expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : undefined,
      enabled: body.enabled !== false,
      createdBy: typeof body.createdBy === "string" ? body.createdBy : "dashboard",
      createdAt: now, updatedAt: now,
    };
    gateway.store.saveGrant(grant);
    return jsonResponse({ grant }, 201, req, {});
  }

  // 5. DELETE /api/agent-os/governance/grants
  if (req.method === "DELETE" && pathname === "/api/agent-os/governance/grants") {
    const id = url.searchParams.get("id");
    if (!id) return badRequest(req, "Query parameter 'id' is required");
    return jsonResponse({ deleted: gateway.store.deleteGrant(id) }, 200, req, {});
  }

  // 6. GET /api/agent-os/governance/approvals
  if (req.method === "GET" && pathname === "/api/agent-os/governance/approvals") {
    const status = (url.searchParams.get("status") ?? undefined) as never;
    return jsonResponse({ approvals: gateway.store.listApprovals(status) }, 200, req, {});
  }

  // 7. POST /api/agent-os/governance/approvals/resolve
  if (req.method === "POST" && pathname === "/api/agent-os/governance/approvals/resolve") {
    const body = await readJsonBody(req);
    const id = typeof body.id === "string" ? body.id : "";
    const decision = body.decision === "approved" ? "approved" : body.decision === "denied" ? "denied" : null;
    const resolvedBy = typeof body.resolvedBy === "string" ? body.resolvedBy : "dashboard";
    if (!id || !decision) return badRequest(req, "Fields 'id' and decision (approved|denied) are required");
    try {
      const result = await gateway.resolveAndDispatch(id, decision, resolvedBy);
      return jsonResponse({ result }, 200, req, {});
    } catch (err) {
      return jsonResponse({ error: { code: "governance_error", message: err instanceof Error ? err.message : String(err) } }, 422, req, {});
    }
  }

  // 8. GET /api/agent-os/governance/audit
  if (req.method === "GET" && pathname === "/api/agent-os/governance/audit") {
    const limit = Number(url.searchParams.get("limit") || 100);
    const actionId = url.searchParams.get("actionId") ?? undefined;
    return jsonResponse({ events: gateway.store.listAudit(limit, actionId) }, 200, req, {});
  }

  // 9. POST /api/agent-os/governance/emergency
  if (req.method === "POST" && pathname === "/api/agent-os/governance/emergency") {
    const body = await readJsonBody(req);
    const mode = String(body.mode ?? "") as GovernanceMode;
    if (!["normal", "read_only", "paused"].includes(mode)) {
      return badRequest(req, "Field 'mode' must be normal|read_only|paused");
    }
    gateway.setMode(mode, typeof body.actor === "string" ? body.actor : "dashboard");
    return jsonResponse({ mode: gateway.getMode() }, 200, req, {});
  }

  // 10. POST /api/agent-os/governance/computers/control
  if (req.method === "POST" && pathname === "/api/agent-os/governance/computers/control") {
    const body = await readJsonBody(req);
    const computerId = typeof body.computerId === "string" ? body.computerId : "";
    const mode = String(body.mode ?? "");
    if (!computerId || !["agent", "human", "paused"].includes(mode)) {
      return badRequest(req, "Fields 'computerId' and mode (agent|human|paused) are required");
    }
    gateway.setControlMode(computerId, mode as never, typeof body.actor === "string" ? body.actor : "dashboard");
    return jsonResponse({ computerId, mode: gateway.getControlMode(computerId) }, 200, req, {});
  }

  return null;
}
