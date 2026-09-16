// Phase 20.21 — Pao-hubPro x OpenAI Codex Native Runtime Integration
// Management REST API Routes.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getCodexRuntimeService } from "../../agent-os/codex-runtime";
import type { CodexPolicyProfile, CodexRuntimeMode } from "../../agent-os/codex-runtime/types";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_request", message } }, 400, req, {});
}

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function handleCodexRuntimeRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  const service = getCodexRuntimeService();

  // 1. GET /api/agent-os/codex-runtime/status
  if (req.method === "GET" && pathname === "/api/agent-os/codex-runtime/status") {
    const status = await service.getStatus();
    return jsonResponse({ status }, 200, req, {});
  }

  // 2. GET /api/agent-os/codex-runtime/health
  if (req.method === "GET" && pathname === "/api/agent-os/codex-runtime/health") {
    const adapter = service.router.resolveAdapter();
    const health = await adapter.health();
    return jsonResponse({ health }, 200, req, {});
  }

  // 3. GET /api/agent-os/codex-runtime/capabilities
  if (req.method === "GET" && pathname === "/api/agent-os/codex-runtime/capabilities") {
    const capabilities = service.detector.detectCapabilities();
    return jsonResponse({ capabilities }, 200, req, {});
  }

  // 4. POST /api/agent-os/codex-runtime/schema/sync
  if (req.method === "POST" && pathname === "/api/agent-os/codex-runtime/schema/sync") {
    const body = await readJsonBody(req);
    const experimental = Boolean(body.experimental);
    const syncResult = service.syncSchema(experimental);
    return jsonResponse({ result: syncResult }, 200, req, {});
  }

  // 5. GET /api/agent-os/codex-runtime/nodes
  if (req.method === "GET" && pathname === "/api/agent-os/codex-runtime/nodes") {
    const nodes = service.nodes.listNodes();
    return jsonResponse({ nodes }, 200, req, {});
  }

  // 6. POST /api/agent-os/codex-runtime/nodes
  if (req.method === "POST" && pathname === "/api/agent-os/codex-runtime/nodes") {
    const body = await readJsonBody(req);
    const id = typeof body.id === "string" ? body.id : "";
    const name = typeof body.name === "string" ? body.name : "";
    if (!id || !name) {
      return badRequest(req, "Fields 'id' and 'name' are required");
    }
    const node = service.nodes.registerNode({
      id,
      name,
      platform: (body.platform as any) || "linux",
      hostname: typeof body.hostname === "string" ? body.hostname : "unknown",
      runtimeMode: (body.runtimeMode as any) || "auto",
      policyProfile: (body.policyProfile as any) || "NORMAL",
    });
    return jsonResponse({ node }, 201, req, {});
  }

  // 7. GET /api/agent-os/codex-runtime/sessions
  if (req.method === "GET" && pathname === "/api/agent-os/codex-runtime/sessions") {
    const limit = Number(url.searchParams.get("limit") || "100");
    const sessions = service.listSessions(limit);
    return jsonResponse({ sessions }, 200, req, {});
  }

  // 8. GET /api/agent-os/codex-runtime/session
  if (req.method === "GET" && pathname === "/api/agent-os/codex-runtime/session") {
    const id = url.searchParams.get("id");
    if (!id) return badRequest(req, "Query param 'id' is required");
    const session = service.getSession(id);
    if (!session) return notFound(req, `Session ${id} not found`);
    const events = service.store.listEventsForSession(id);
    const jobs = service.store.listJobsForSession(id);
    return jsonResponse({ session, events, jobs }, 200, req, {});
  }

  // 9. POST /api/agent-os/codex-runtime/sessions
  if (req.method === "POST" && pathname === "/api/agent-os/codex-runtime/sessions") {
    const body = await readJsonBody(req);
    const workspaceRoot = typeof body.workspaceRoot === "string" ? body.workspaceRoot : process.cwd();
    const title = typeof body.title === "string" ? body.title : undefined;
    const policyProfile = (body.policyProfile as CodexPolicyProfile) || "NORMAL";
    const runtimeMode = (body.runtimeMode as CodexRuntimeMode) || "auto";

    try {
      const session = service.createSession({
        workspaceRoot,
        title,
        policyProfile,
        runtimeMode,
      });
      return jsonResponse({ session }, 201, req, {});
    } catch (err: unknown) {
      return badRequest(req, err instanceof Error ? err.message : String(err));
    }
  }

  // 10. POST /api/agent-os/codex-runtime/sessions/resume
  if (req.method === "POST" && pathname === "/api/agent-os/codex-runtime/sessions/resume") {
    const body = await readJsonBody(req);
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    if (!sessionId) return badRequest(req, "Field 'sessionId' is required");
    const session = service.getSession(sessionId);
    if (!session) return notFound(req, `Session ${sessionId} not found`);

    if (session.threadId) {
      const adapter = service.router.resolveAdapter(session.runtimeMode);
      await adapter.resumeThread(sessionId, session.threadId);
      service.store.updateSessionStatus(sessionId, "idle");
    }
    return jsonResponse({ resumed: true, sessionId }, 200, req, {});
  }

  // 11. POST /api/agent-os/codex-runtime/turns/start
  if (req.method === "POST" && pathname === "/api/agent-os/codex-runtime/turns/start") {
    const body = await readJsonBody(req);
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    if (!sessionId || !prompt) {
      return badRequest(req, "Fields 'sessionId' and 'prompt' are required");
    }

    try {
      const turn = await service.executeTurn(sessionId, prompt);
      return jsonResponse({ turn }, 200, req, {});
    } catch (err: unknown) {
      return badRequest(req, err instanceof Error ? err.message : String(err));
    }
  }

  // 12. POST /api/agent-os/codex-runtime/turns/cancel
  if (req.method === "POST" && pathname === "/api/agent-os/codex-runtime/turns/cancel") {
    const body = await readJsonBody(req);
    const turnId = typeof body.turnId === "string" ? body.turnId : "";
    if (!turnId) return badRequest(req, "Field 'turnId' is required");
    const cancelled = service.cancelTurn(turnId);
    return jsonResponse({ cancelled, turnId }, 200, req, {});
  }

  // 13. GET /api/agent-os/codex-runtime/approvals
  if (req.method === "GET" && pathname === "/api/agent-os/codex-runtime/approvals") {
    const statusParam = url.searchParams.get("status");
    const approvals = service.store.listApprovals(statusParam as any);
    return jsonResponse({ approvals }, 200, req, {});
  }

  // 14. POST /api/agent-os/codex-runtime/approvals/resolve
  if (req.method === "POST" && pathname === "/api/agent-os/codex-runtime/approvals/resolve") {
    const body = await readJsonBody(req);
    const approvalId = typeof body.approvalId === "string" ? body.approvalId : "";
    const decision = body.decision === "allow" ? "allow" : body.decision === "cancel" ? "cancel" : "deny";
    const operator = typeof body.operator === "string" ? body.operator : "operator";

    if (!approvalId) return badRequest(req, "Field 'approvalId' is required");
    const success = service.resolveApproval(approvalId, decision, operator);
    return jsonResponse({ resolved: success, approvalId, decision }, 200, req, {});
  }

  // 15. GET /api/agent-os/codex-runtime/policies
  if (req.method === "GET" && pathname === "/api/agent-os/codex-runtime/policies") {
    const ruleSet = service.policy.getRuleSet();
    return jsonResponse({ policy: ruleSet }, 200, req, {});
  }

  // 16. POST /api/agent-os/codex-runtime/policies/unlock
  if (req.method === "POST" && pathname === "/api/agent-os/codex-runtime/policies/unlock") {
    const body = await readJsonBody(req);
    const operator = typeof body.operator === "string" ? body.operator : "";
    const ttlSeconds = typeof body.ttlSeconds === "number" ? body.ttlSeconds : 900;
    if (!operator) return badRequest(req, "Field 'operator' is required to unlock FULL_ACCESS");

    try {
      const unlock = service.unlockFullAccess(operator, ttlSeconds);
      return jsonResponse({ unlock }, 200, req, {});
    } catch (err: unknown) {
      return badRequest(req, err instanceof Error ? err.message : String(err));
    }
  }

  // 17. GET /api/agent-os/codex-runtime/tools
  if (req.method === "GET" && pathname === "/api/agent-os/codex-runtime/tools") {
    const tools = service.listTools();
    return jsonResponse({ tools }, 200, req, {});
  }

  // 18. GET /api/agent-os/codex-runtime/audit
  if (req.method === "GET" && pathname === "/api/agent-os/codex-runtime/audit") {
    const limit = Number(url.searchParams.get("limit") || "100");
    const logs = service.listAuditLogs(limit);
    return jsonResponse({ logs }, 200, req, {});
  }

  // 19. GET /api/agent-os/codex-runtime/daemon/status
  if (req.method === "GET" && pathname === "/api/agent-os/codex-runtime/daemon/status") {
    const daemonStatus = service.daemon.getStatus();
    return jsonResponse({ daemon: daemonStatus }, 200, req, {});
  }

  return null;
}
