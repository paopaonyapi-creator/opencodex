// Phase 20.54 — Pao Agent Platform management routes.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getAgentPlatform, PlatformError, type AgentManifest } from "../../agent-os/agent-platform";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_body", message } }, 400, req, {});
}

function platformError(req: Request, err: unknown): Response {
  if (err instanceof PlatformError) {
    return jsonResponse({ error: { code: err.code, message: err.message, details: err.details ?? null } }, err.httpStatus, req, {});
  }
  const message = err instanceof Error ? err.message : "internal_error";
  const status = message.startsWith("APPROVAL_FORBIDDEN") ? 403 : 500;
  return jsonResponse({ error: { code: "internal_error", message } }, status, req, {});
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function handleAgentPlatformRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  let subPath = "";
  if (url.pathname.startsWith("/api/agent-os/agent-platform/")) {
    subPath = url.pathname.slice("/api/agent-os/agent-platform/".length);
  } else if (url.pathname === "/api/agent-os/agent-platform") {
    subPath = "";
  } else {
    return null;
  }

  const platform = getAgentPlatform();

  if (req.method === "GET" && (subPath === "" || subPath === "health")) {
    return jsonResponse({
      ok: true,
      phase: "20.54",
      agents: platform.listAgents().length,
      patterns: platform.patternCatalog().length,
      capabilities: platform.listCapabilities().length,
      pendingApprovals: platform.listApprovals().filter((a) => a.status === "pending").length,
    }, 200, req, {});
  }

  if (req.method === "GET" && subPath === "agents") {
    return jsonResponse({
      agents: platform.listAgents().map((a) => ({
        id: a.manifest.metadata.id,
        name: a.manifest.metadata.name,
        version: a.manifest.metadata.version,
        enabled: a.enabled,
        patterns: a.manifest.spec.patterns,
        capabilities: a.manifest.spec.capabilities.required,
        registeredAt: a.registeredAt,
      })),
    }, 200, req, {});
  }

  if (req.method === "GET" && subPath.startsWith("agents/") && subPath.endsWith("/card")) {
    const id = subPath.slice("agents/".length, -"/card".length);
    try {
      return jsonResponse({ card: platform.agentCard(id, `/api/agent-os/agent-platform/agents/${id}`) }, 200, req, {});
    } catch (err) {
      return platformError(req, err);
    }
  }

  if (req.method === "GET" && subPath.startsWith("agents/")) {
    const id = subPath.slice("agents/".length);
    const agent = platform.getAgent(id);
    if (!agent) return jsonResponse({ error: { code: "AGENT_NOT_FOUND" } }, 404, req, {});
    return jsonResponse({ agent }, 200, req, {});
  }

  if (req.method === "POST" && subPath === "agents") {
    const body = await readJson(req);
    try {
      const registered = platform.registerAgent(body as unknown as AgentManifest);
      return jsonResponse({ agent: registered }, 201, req, {});
    } catch (err) {
      return platformError(req, err);
    }
  }

  if (req.method === "POST" && subPath.startsWith("agents/") && subPath.endsWith("/enable")) {
    const id = subPath.slice("agents/".length, -"/enable".length);
    try {
      platform.setAgentEnabled(id, true);
      return jsonResponse({ ok: true, id, enabled: true }, 200, req, {});
    } catch (err) {
      return platformError(req, err);
    }
  }

  if (req.method === "POST" && subPath.startsWith("agents/") && subPath.endsWith("/disable")) {
    const id = subPath.slice("agents/".length, -"/disable".length);
    try {
      platform.setAgentEnabled(id, false);
      return jsonResponse({ ok: true, id, enabled: false }, 200, req, {});
    } catch (err) {
      return platformError(req, err);
    }
  }

  if (req.method === "GET" && subPath === "patterns") {
    return jsonResponse({ patterns: platform.listPatterns() }, 200, req, {});
  }

  if (req.method === "GET" && subPath === "capabilities") {
    return jsonResponse({ capabilities: platform.listCapabilities() }, 200, req, {});
  }

  if (req.method === "GET" && subPath === "approvals") {
    return jsonResponse({ approvals: platform.listApprovals() }, 200, req, {});
  }

  if (req.method === "POST" && subPath.startsWith("approvals/") && subPath.endsWith("/resolve")) {
    const id = subPath.slice("approvals/".length, -"/resolve".length);
    const body = await readJson(req);
    const actor = typeof body.actorId === "string" ? body.actorId : "admin";
    const decision = body.decision === "rejected" ? "rejected" : "approved";
    try {
      const record = platform.resolveApproval(id, actor, decision);
      return jsonResponse({ approval: record }, 200, req, {});
    } catch (err) {
      return platformError(req, err);
    }
  }

  if (req.method === "POST" && subPath === "run") {
    const body = await readJson(req);
    try {
      const result = await platform.runCapability({
        taskId: String(body.taskId ?? `task-${Date.now()}`),
        agentId: String(body.agentId ?? ""),
        capability: String(body.capability ?? ""),
        toolId: String(body.toolId ?? body.capability ?? ""),
        args: (body.args && typeof body.args === "object") ? body.args as Record<string, unknown> : {},
        resource: typeof body.resource === "string" ? body.resource : undefined,
        approvalId: typeof body.approvalId === "string" ? body.approvalId : undefined,
      });
      return jsonResponse(result, 200, req, {});
    } catch (err) {
      return platformError(req, err);
    }
  }

  if (req.method === "GET" && subPath === "receipts") {
    const agentId = url.searchParams.get("agentId") ?? undefined;
    return jsonResponse({ receipts: platform.listReceipts(agentId) }, 200, req, {});
  }

  if (req.method === "POST" && subPath === "receipts/verify") {
    const body = await readJson(req);
    const record = body.record as Parameters<typeof platform.verifyReceipt>[0] | undefined;
    if (!record) return badRequest(req, "record is required");
    return jsonResponse(platform.verifyReceipt(record), 200, req, {});
  }

  if (req.method === "GET" && subPath === "receipts/chain") {
    const agentId = url.searchParams.get("agentId") ?? "";
    if (!agentId) return badRequest(req, "agentId is required");
    return jsonResponse(platform.verifyReceiptChain(agentId), 200, req, {});
  }

  if (req.method === "GET" && subPath === "audit") {
    return jsonResponse({ events: platform.readAudit(200) }, 200, req, {});
  }

  if (req.method === "POST" && subPath === "validate") {
    const body = await readJson(req);
    return jsonResponse({ issues: platform.validateManifest(body) }, 200, req, {});
  }

  return jsonResponse({ error: { code: "not_found", message: "unknown agent-platform route" } }, 404, req, {});
}

