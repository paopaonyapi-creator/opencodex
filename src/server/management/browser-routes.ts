// Phase 20.11 — Pao-hubPro Browser Management REST API Routes
//
// Endpoints mounted under /api/browser/* and /api/agent-os/browser/*
// Exposes browser status, tab management, navigation, page extraction,
// action execution, approval workflows, and emergency kill switch.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getBrowserBridge } from "../../agent-os/browser/bridge/browser-bridge";
import { getBrowserApprovalManager } from "../../agent-os/browser/security/approval-manager";
import { getBrowserKillSwitch } from "../../agent-os/browser/security/kill-switch";
import { getBrowserAuditLogger } from "../../agent-os/browser/security/audit-log";
import type { ActionProposal } from "../../agent-os/browser/types";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_request", message } }, 400, req, {});
}

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

export async function handleBrowserRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;

  let path = "";
  if (url.pathname.startsWith("/api/browser/")) {
    path = url.pathname.slice("/api/browser/".length);
  } else if (url.pathname === "/api/browser") {
    path = "";
  } else if (url.pathname.startsWith("/api/agent-os/browser/")) {
    path = url.pathname.slice("/api/agent-os/browser/".length);
  } else if (url.pathname === "/api/agent-os/browser") {
    path = "";
  } else {
    return null;
  }

  const bridge = getBrowserBridge();
  const killSwitch = getBrowserKillSwitch();
  const approvalManager = getBrowserApprovalManager();
  const auditLogger = getBrowserAuditLogger();

  // Workflow Intelligence Subsystem routes
  if (path === "workflows" || path.startsWith("workflows/")) {
    const { handleWorkflowRoutes } = await import("./workflow-routes");
    return handleWorkflowRoutes(ctx);
  }

  // Multi-Agent Web Operations routes
  if (path === "missions" || path.startsWith("missions/")) {
    const { handleMultiAgentRoutes } = await import("./multi-agent-routes");
    return handleMultiAgentRoutes(ctx);
  }

  // 1. GET /api/browser/status or /api/browser
  if (path === "" || path === "status") {
    if (req.method === "GET") {
      const status = bridge.getStatus();
      return jsonResponse(status, 200, req, {});
    }
    return null;
  }

  // 2. GET /api/browser/tabs & POST /api/browser/tabs
  if (path === "tabs") {
    if (req.method === "GET") {
      const tabs = bridge.listTabs();
      return jsonResponse({ tabs }, 200, req, {});
    }
    if (req.method === "POST") {
      let body: any = {};
      try {
        body = await req.json();
      } catch {
        // empty body allowed
      }
      const tab = bridge.newTab(body?.url);
      return jsonResponse({ success: true, tab }, 201, req, {});
    }
    return null;
  }

  // 3. POST /api/browser/tabs/:id/activate & DELETE /api/browser/tabs/:id
  const tabMatch = /^tabs\/([^/]+)(?:\/activate)?$/.exec(path);
  if (tabMatch) {
    const tabId = tabMatch[1];
    if (path.endsWith("/activate") && req.method === "POST") {
      const success = bridge.activateTab(tabId);
      if (!success) return notFound(req, `Tab ${tabId} not found`);
      return jsonResponse({ success: true, tabId }, 200, req, {});
    }
    if (req.method === "DELETE") {
      const success = bridge.closeTab(tabId);
      if (!success) return notFound(req, `Tab ${tabId} not found`);
      return jsonResponse({ success: true, tabId }, 200, req, {});
    }
  }

  // 4. POST /api/browser/navigate
  if (path === "navigate") {
    if (req.method !== "POST") return null;
    let body: any;
    try {
      body = await req.json();
    } catch {
      return badRequest(req, "Invalid JSON body");
    }
    if (!body?.url || typeof body.url !== "string") {
      return badRequest(req, "Missing or invalid 'url' field");
    }

    try {
      const res = await bridge.navigate(body.url, body.tabId);
      return jsonResponse(res, 200, req, {});
    } catch (err: any) {
      return jsonResponse({ error: { message: err.message } }, 400, req, {});
    }
  }

  // 5. POST /api/browser/reload
  if (path === "reload") {
    if (req.method !== "POST") return null;
    let body: any = {};
    try {
      body = await req.json();
    } catch {}
    try {
      const res = await bridge.reload(body?.tabId);
      return jsonResponse(res, 200, req, {});
    } catch (err: any) {
      return jsonResponse({ error: { message: err.message } }, 400, req, {});
    }
  }

  // 6. GET /api/browser/read
  if (path === "read") {
    if (req.method !== "GET") return null;
    const tabId = url.searchParams.get("tabId") || undefined;
    try {
      const res = bridge.readPage(tabId);
      return jsonResponse(res, 200, req, {});
    } catch (err: any) {
      return jsonResponse({ error: { message: err.message } }, 400, req, {});
    }
  }

  // 7. POST /api/browser/snapshot
  if (path === "snapshot") {
    if (req.method !== "POST" && req.method !== "GET") return null;
    let tabId: string | undefined;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        tabId = body?.tabId;
      } catch {}
    } else {
      tabId = url.searchParams.get("tabId") || undefined;
    }

    try {
      const snapshot = bridge.getSnapshot(tabId);
      return jsonResponse(snapshot, 200, req, {});
    } catch (err: any) {
      return jsonResponse({ error: { message: err.message } }, 400, req, {});
    }
  }

  // 8. POST /api/browser/action
  if (path === "action") {
    if (req.method !== "POST") return null;
    let proposal: ActionProposal;
    try {
      proposal = await req.json();
    } catch {
      return badRequest(req, "Invalid JSON body");
    }
    if (!proposal?.tool) {
      return badRequest(req, "Missing 'tool' property in proposal");
    }

    try {
      const result = await bridge.executeAction(proposal);
      return jsonResponse(result, 200, req, {});
    } catch (err: any) {
      return jsonResponse({ error: { message: err.message } }, 400, req, {});
    }
  }

  // 9. GET /api/browser/screenshot
  if (path === "screenshot") {
    if (req.method !== "GET") return null;
    const tabId = url.searchParams.get("tabId") || undefined;
    try {
      const img = bridge.captureScreenshot(tabId);
      return jsonResponse(img, 200, req, {});
    } catch (err: any) {
      return jsonResponse({ error: { message: err.message } }, 400, req, {});
    }
  }

  // 10. GET /api/browser/downloads
  if (path === "downloads") {
    if (req.method !== "GET") return null;
    const downloads = bridge.getDownloads();
    return jsonResponse({ downloads }, 200, req, {});
  }

  // 11. GET /api/browser/approvals
  if (path === "approvals") {
    if (req.method !== "GET") return null;
    const pending = approvalManager.listPending();
    return jsonResponse({ pending }, 200, req, {});
  }

  // 12. POST /api/browser/approvals/:id/approve & reject
  const apprMatch = /^approvals\/([^/]+)\/(approve|reject)$/.exec(path);
  if (apprMatch && req.method === "POST") {
    const id = apprMatch[1];
    const decision = apprMatch[2];
    let body: any = {};
    try {
      body = await req.json();
    } catch {}

    if (decision === "approve") {
      const success = approvalManager.approve(id, body?.mode || "once", body?.reviewer || "admin");
      return jsonResponse({ success, id, status: "approved" }, 200, req, {});
    } else {
      const success = approvalManager.reject(id, body?.reviewer || "admin");
      return jsonResponse({ success, id, status: "rejected" }, 200, req, {});
    }
  }

  // 13. POST /api/browser/stop (Kill Switch)
  if (path === "stop") {
    if (req.method !== "POST") return null;
    let reason = "Manual STOP AGENT invoked via Management API";
    try {
      const body = await req.json();
      if (body?.reason) reason = body.reason;
    } catch {}
    killSwitch.trigger(reason);
    return jsonResponse({ success: true, killSwitchActive: true, reason }, 200, req, {});
  }

  // 14. POST /api/browser/resume
  if (path === "resume") {
    if (req.method !== "POST") return null;
    killSwitch.reset();
    return jsonResponse({ success: true, killSwitchActive: false }, 200, req, {});
  }

  // 15. GET /api/browser/audit
  if (path === "audit") {
    if (req.method !== "GET") return null;
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);
    const logs = auditLogger.getRecentLogs(limit);
    return jsonResponse({ logs }, 200, req, {});
  }

  return null;
}
