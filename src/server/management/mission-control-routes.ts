// Phase 21.02 — Mission Control Management API Routes.
// Endpoint base: /api/agent-os/mission-control/*

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getMissionControlService } from "../../agent-os/mission-control/service";
import { missionControlEnabled } from "../../agent-os/mission-control/flags";

export async function handleMissionControlRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;

  if (!pathname.startsWith("/api/agent-os/mission-control")) {
    return null;
  }

  if (!missionControlEnabled()) {
    return jsonResponse({ error: { code: "DISABLED", message: "Mission Control is disabled" } }, 403, req, {});
  }

  const svc = getMissionControlService();

  try {
    // GET /api/agent-os/mission-control/overview
    if (req.method === "GET" && pathname === "/api/agent-os/mission-control/overview") {
      return jsonResponse({ ok: true, overview: svc.getOverview() }, 200, req, {});
    }

    // GET /api/agent-os/mission-control/agents
    if (req.method === "GET" && pathname === "/api/agent-os/mission-control/agents") {
      return jsonResponse({ ok: true, agents: svc.listAgents() }, 200, req, {});
    }

    // POST /api/agent-os/mission-control/agents/:id/pause
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/mission-control/agents/") && pathname.endsWith("/pause")) {
      const id = pathname.slice("/api/agent-os/mission-control/agents/".length, -"/pause".length);
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const updated = svc.pauseAgent(id, String(body.actor || "operator"), String(body.reason || "Management pause"));
      return jsonResponse({ ok: true, agent: updated }, 200, req, {});
    }

    // POST /api/agent-os/mission-control/agents/:id/resume
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/mission-control/agents/") && pathname.endsWith("/resume")) {
      const id = pathname.slice("/api/agent-os/mission-control/agents/".length, -"/resume".length);
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const updated = svc.resumeAgent(id, String(body.actor || "operator"), String(body.reason || "Management resume"));
      return jsonResponse({ ok: true, agent: updated }, 200, req, {});
    }

    // POST /api/agent-os/mission-control/agents/:id/quarantine
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/mission-control/agents/") && pathname.endsWith("/quarantine")) {
      const id = pathname.slice("/api/agent-os/mission-control/agents/".length, -"/quarantine".length);
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const updated = svc.quarantineAgent(id, String(body.actor || "operator"), String(body.reason || "Security quarantine"));
      return jsonResponse({ ok: true, agent: updated }, 200, req, {});
    }

    // POST /api/agent-os/mission-control/agents/:id/takeover
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/mission-control/agents/") && pathname.endsWith("/takeover")) {
      const id = pathname.slice("/api/agent-os/mission-control/agents/".length, -"/takeover".length);
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const updated = svc.takeoverAgent(id, String(body.actor || "operator"), String(body.reason || "Human takeover requested"));
      return jsonResponse({ ok: true, agent: updated }, 200, req, {});
    }

    // GET /api/agent-os/mission-control/runs
    if (req.method === "GET" && pathname === "/api/agent-os/mission-control/runs") {
      return jsonResponse({ ok: true, runs: svc.listRuns() }, 200, req, {});
    }

    // GET /api/agent-os/mission-control/runs/:id/timeline
    if (req.method === "GET" && pathname.startsWith("/api/agent-os/mission-control/runs/") && pathname.endsWith("/timeline")) {
      const id = pathname.slice("/api/agent-os/mission-control/runs/".length, -"/timeline".length);
      return jsonResponse({ ok: true, timeline: svc.listRunTimeline(id) }, 200, req, {});
    }

    // POST /api/agent-os/mission-control/runs/:id/pause
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/mission-control/runs/") && pathname.endsWith("/pause")) {
      const id = pathname.slice("/api/agent-os/mission-control/runs/".length, -"/pause".length);
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const updated = svc.pauseRun(id, String(body.actor || "operator"), String(body.reason || "Management pause"));
      return jsonResponse({ ok: true, run: updated }, 200, req, {});
    }

    // POST /api/agent-os/mission-control/runs/:id/resume
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/mission-control/runs/") && pathname.endsWith("/resume")) {
      const id = pathname.slice("/api/agent-os/mission-control/runs/".length, -"/resume".length);
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const updated = svc.resumeRun(id, String(body.actor || "operator"), String(body.reason || "Management resume"));
      return jsonResponse({ ok: true, run: updated }, 200, req, {});
    }

    // POST /api/agent-os/mission-control/runs/:id/cancel
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/mission-control/runs/") && pathname.endsWith("/cancel")) {
      const id = pathname.slice("/api/agent-os/mission-control/runs/".length, -"/cancel".length);
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const updated = svc.cancelRun(id, String(body.actor || "operator"), String(body.reason || "Management cancel"));
      return jsonResponse({ ok: true, run: updated }, 200, req, {});
    }

    // POST /api/agent-os/mission-control/runs/:id/retry
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/mission-control/runs/") && pathname.endsWith("/retry")) {
      const id = pathname.slice("/api/agent-os/mission-control/runs/".length, -"/retry".length);
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const updated = svc.retryRun(id, String(body.actor || "operator"), String(body.reason || "Management retry"));
      return jsonResponse({ ok: true, run: updated }, 200, req, {});
    }

    // GET /api/agent-os/mission-control/approvals
    if (req.method === "GET" && pathname === "/api/agent-os/mission-control/approvals") {
      const status = url.searchParams.get("status") || undefined;
      return jsonResponse({ ok: true, approvals: svc.listApprovals(status) }, 200, req, {});
    }

    // POST /api/agent-os/mission-control/approvals/:id/resolve
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/mission-control/approvals/") && pathname.endsWith("/resolve")) {
      const id = pathname.slice("/api/agent-os/mission-control/approvals/".length, -"/resolve".length);
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const decision = body.decision as "APPROVED" | "REJECTED" | "ESCALATED";
      const updated = svc.resolveApproval(id, decision, String(body.actor || "operator"), body.reason ? String(body.reason) : undefined);
      return jsonResponse({ ok: true, approval: updated }, 200, req, {});
    }

    // GET /api/agent-os/mission-control/queues
    if (req.method === "GET" && pathname === "/api/agent-os/mission-control/queues") {
      return jsonResponse({ ok: true, queues: svc.listQueues() }, 200, req, {});
    }

    // GET /api/agent-os/mission-control/dlq
    if (req.method === "GET" && pathname === "/api/agent-os/mission-control/dlq") {
      return jsonResponse({ ok: true, dlq: svc.listDlq() }, 200, req, {});
    }

    // POST /api/agent-os/mission-control/emergency-stop
    if (req.method === "POST" && pathname === "/api/agent-os/mission-control/emergency-stop") {
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      const inc = svc.triggerEmergencyStop(String(body.actor || "operator"), String(body.reason || "Emergency Stop"));
      return jsonResponse({ ok: true, incident: inc }, 200, req, {});
    }

    // GET /api/agent-os/mission-control/audit
    if (req.method === "GET" && pathname === "/api/agent-os/mission-control/audit") {
      return jsonResponse({ ok: true, logs: svc.listAudit() }, 200, req, {});
    }

    return jsonResponse({ error: { code: "NOT_FOUND", message: "Unknown Mission Control route" } }, 404, req, {});
  } catch (err: any) {
    return jsonResponse({ error: { code: "INTERNAL_ERROR", message: err.message || String(err) } }, 500, req, {});
  }
}
