// Phase Navop & 21.03 — Host-Authoritative Operations Management API Routes.
// Endpoint base: /api/agent-os/navop/*

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getNavopRuntimeService } from "../../agent-os/navop/service";
import { navopRuntimeEnabled } from "../../agent-os/navop/flags";

export async function handleNavopRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;

  if (!pathname.startsWith("/api/agent-os/navop")) {
    return null;
  }

  if (!navopRuntimeEnabled()) {
    return jsonResponse({ error: { code: "DISABLED", message: "Pao Navop Host Runtime is disabled" } }, 403, req, {});
  }

  const svc = getNavopRuntimeService();

  try {
    // GET /api/agent-os/navop/resources
    if (req.method === "GET" && pathname === "/api/agent-os/navop/resources") {
      const type = url.searchParams.get("type") || undefined;
      return jsonResponse({ ok: true, resources: svc.listResources(type) }, 200, req, {});
    }

    // POST /api/agent-os/navop/resources
    if (req.method === "POST" && pathname === "/api/agent-os/navop/resources") {
      const body = await req.json().catch(() => ({})) as any;
      const res = svc.registerResource({
        resourceUri: String(body.resourceUri),
        resourceType: body.resourceType || "host",
        displayName: String(body.displayName),
        adapterType: String(body.adapterType || "ssh"),
        credentialRef: body.credentialRef,
        config: body.config || {},
        labels: body.labels || {},
        enabled: body.enabled !== false,
      });
      return jsonResponse({ ok: true, resource: res }, 201, req, {});
    }

    // GET /api/agent-os/navop/capabilities
    if (req.method === "GET" && pathname === "/api/agent-os/navop/capabilities") {
      return jsonResponse({ ok: true, capabilities: svc.listCapabilities() }, 200, req, {});
    }

    // POST /api/agent-os/navop/sessions
    if (req.method === "POST" && pathname === "/api/agent-os/navop/sessions") {
      const body = await req.json().catch(() => ({})) as any;
      const sess = svc.createSession(String(body.agentKey || "agent"), body.profile, body.sessionType);
      return jsonResponse({ ok: true, session: sess }, 201, req, {});
    }

    // POST /api/agent-os/navop/execute
    if (req.method === "POST" && pathname === "/api/agent-os/navop/execute") {
      const body = await req.json().catch(() => ({})) as any;
      const res = await svc.requestExecution({
        sessionId: String(body.sessionId),
        capabilityName: String(body.capabilityName),
        resourceUri: body.resourceUri ? String(body.resourceUri) : undefined,
        input: body.input || {},
        dryRun: Boolean(body.dryRun),
      });
      return jsonResponse({ ok: true, ...res }, 200, req, {});
    }

    // POST /api/agent-os/navop/approvals/:id/resolve
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/navop/approvals/") && pathname.endsWith("/resolve")) {
      const id = pathname.slice("/api/agent-os/navop/approvals/".length, -"/resolve".length);
      const body = await req.json().catch(() => ({})) as any;
      const app = svc.resolveApproval(id, body.decision, String(body.by || "operator"), body.note);
      return jsonResponse({ ok: true, approval: app }, 200, req, {});
    }

    // GET /api/agent-os/navop/providers (CC-Switch)
    if (req.method === "GET" && pathname === "/api/agent-os/navop/providers") {
      return jsonResponse({ ok: true, providers: svc.listProviders() }, 200, req, {});
    }

    // GET /api/agent-os/navop/runtimes (CC-Switch)
    if (req.method === "GET" && pathname === "/api/agent-os/navop/runtimes") {
      return jsonResponse({ ok: true, runtimes: svc.listRuntimes() }, 200, req, {});
    }

    // GET /api/agent-os/navop/audit
    if (req.method === "GET" && pathname === "/api/agent-os/navop/audit") {
      return jsonResponse({ ok: true, audit: svc.listAudit() }, 200, req, {});
    }

    return jsonResponse({ error: { code: "NOT_FOUND", message: "Unknown Navop route" } }, 404, req, {});
  } catch (err: any) {
    return jsonResponse({ error: { code: "INTERNAL_ERROR", message: err.message || String(err) } }, 500, req, {});
  }
}
