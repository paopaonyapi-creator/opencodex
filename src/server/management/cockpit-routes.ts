// Phase 20.27 — Pao-hubPro × VibeRaven Agent Cockpit & Production Readiness
// Control Plane: Management REST API routes (/api/agent-os/cockpit/*).
// The control plane is a privileged surface: mutating routes respect the same
// human-only rules the service layer enforces (approvals, release marks,
// provider attestation, access-mode changes).

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getAgentCockpitService } from "../../agent-os/control-plane/cockpit-facade";
import type { AccessMode, AgentType, GateProfile } from "../../agent-os/control-plane/cockpit-types";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_request", message } }, 400, req, {});
}

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

function invariantError(req: Request, err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  const status = message.startsWith("invariant:") ? 403 : 422;
  return jsonResponse({ error: { code: message.startsWith("invariant:") ? "invariant_violation" : "cockpit_error", message } }, status, req, {});
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function handleCockpitRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  const service = getAgentCockpitService();

  // 1. GET /api/agent-os/cockpit/overview
  if (req.method === "GET" && pathname === "/api/agent-os/cockpit/overview") {
    return jsonResponse({ overview: await service.overview() }, 200, req, {});
  }

  // 2. GET /api/agent-os/cockpit/agents
  if (req.method === "GET" && pathname === "/api/agent-os/cockpit/agents") {
    return jsonResponse({ agents: await service.listAgents() }, 200, req, {});
  }

  // 3. POST /api/agent-os/cockpit/agents/doctor
  if (req.method === "POST" && pathname === "/api/agent-os/cockpit/agents/doctor") {
    const body = await readJsonBody(req);
    const agentType = String(body.agentType ?? "") as AgentType;
    if (!agentType) return badRequest(req, "Field 'agentType' is required");
    return jsonResponse({ doctor: await service.agentDoctor(agentType) }, 200, req, {});
  }

  // 4. POST /api/agent-os/cockpit/agents/access-mode
  if (req.method === "POST" && pathname === "/api/agent-os/cockpit/agents/access-mode") {
    const body = await readJsonBody(req);
    const agentType = String(body.agentType ?? "") as AgentType;
    const mode = String(body.mode ?? "") as AccessMode;
    const actor = typeof body.actor === "string" ? body.actor : "dashboard";
    if (!agentType || !mode) return badRequest(req, "Fields 'agentType' and 'mode' are required");
    try {
      await service.setAccessMode(agentType, mode, actor);
      return jsonResponse({ ok: true, agentType, mode }, 200, req, {});
    } catch (err) {
      return invariantError(req, err);
    }
  }

  // 5. POST /api/agent-os/cockpit/sessions (start a session)
  if (req.method === "POST" && pathname === "/api/agent-os/cockpit/sessions") {
    const body = await readJsonBody(req);
    const agentType = String(body.agentType ?? "") as AgentType;
    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    if (!agentType || !prompt.trim()) return badRequest(req, "Fields 'agentType' and 'prompt' are required");
    try {
      const session = await service.startSession({
        agentType,
        prompt,
        taskId: typeof body.taskId === "string" ? body.taskId : undefined,
        requestedBy: typeof body.requestedBy === "string" ? body.requestedBy : "dashboard",
      });
      return jsonResponse({ session }, 201, req, {});
    } catch (err) {
      return invariantError(req, err);
    }
  }

  // 6. GET /api/agent-os/cockpit/sessions
  if (req.method === "GET" && pathname === "/api/agent-os/cockpit/sessions") {
    return jsonResponse({ sessions: service.store.listSessions() }, 200, req, {});
  }

  // 7. GET /api/agent-os/cockpit/session
  if (req.method === "GET" && pathname === "/api/agent-os/cockpit/session") {
    const id = url.searchParams.get("id");
    if (!id) return badRequest(req, "Query parameter 'id' is required");
    const session = service.store.getSession(id);
    if (!session) return notFound(req, "Session not found");
    return jsonResponse({ session, events: service.sessionEvents(id) }, 200, req, {});
  }

  // 8. POST /api/agent-os/cockpit/sessions/cancel
  if (req.method === "POST" && pathname === "/api/agent-os/cockpit/sessions/cancel") {
    const body = await readJsonBody(req);
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return badRequest(req, "Field 'id' is required");
    const session = service.cancelSession(id, typeof body.actor === "string" ? body.actor : "dashboard");
    if (!session) return notFound(req, "Session not found");
    return jsonResponse({ session }, 200, req, {});
  }

  // 9. GET /api/agent-os/cockpit/approvals
  if (req.method === "GET" && pathname === "/api/agent-os/cockpit/approvals") {
    const status = (url.searchParams.get("status") ?? undefined) as never;
    return jsonResponse({ approvals: service.store.listApprovals(status) }, 200, req, {});
  }

  // 10. POST /api/agent-os/cockpit/approvals
  if (req.method === "POST" && pathname === "/api/agent-os/cockpit/approvals") {
    const body = await readJsonBody(req);
    const action = typeof body.action === "string" ? body.action : "";
    const risk = String(body.risk ?? "R3") as never;
    if (!action) return badRequest(req, "Field 'action' is required");
    const approval = service.requestApproval({
      action,
      agentId: typeof body.agentId === "string" ? body.agentId : undefined,
      sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
      resource: typeof body.resource === "string" ? body.resource : undefined,
      risk,
      reason: typeof body.reason === "string" ? body.reason : "",
      preview: typeof body.preview === "string" ? body.preview : undefined,
      scope: (typeof body.scope === "string" ? body.scope : "once") as never,
      requestedBy: typeof body.requestedBy === "string" ? body.requestedBy : "agent",
    });
    return jsonResponse({ approval }, 201, req, {});
  }

  // 11. POST /api/agent-os/cockpit/approvals/resolve
  if (req.method === "POST" && pathname === "/api/agent-os/cockpit/approvals/resolve") {
    const body = await readJsonBody(req);
    const id = typeof body.id === "string" ? body.id : "";
    const decision = body.decision === "approved" ? "approved" : body.decision === "rejected" ? "rejected" : null;
    const decidedBy = typeof body.decidedBy === "string" ? body.decidedBy : "dashboard";
    if (!id || !decision) return badRequest(req, "Fields 'id' and decision (approved|rejected) are required");
    try {
      const approval = service.resolveApproval(id, decision, decidedBy);
      if (!approval) return notFound(req, "Pending approval not found");
      return jsonResponse({ approval }, 200, req, {});
    } catch (err) {
      return invariantError(req, err);
    }
  }

  // 12. POST /api/agent-os/cockpit/gate
  if (req.method === "POST" && pathname === "/api/agent-os/cockpit/gate") {
    const body = await readJsonBody(req);
    const profile = (typeof body.profile === "string" ? body.profile : "dev") as GateProfile;
    try {
      const run = await service.runGate(profile);
      return jsonResponse({ gate: run }, 200, req, {});
    } catch (err) {
      return invariantError(req, err);
    }
  }

  // 13. GET /api/agent-os/cockpit/gate
  if (req.method === "GET" && pathname === "/api/agent-os/cockpit/gate") {
    const gate = service.latestGate();
    if (!gate) return notFound(req, "No gate run recorded yet");
    return jsonResponse({ gate }, 200, req, {});
  }

  // 14. GET /api/agent-os/cockpit/evidence
  if (req.method === "GET" && pathname === "/api/agent-os/cockpit/evidence") {
    const limit = Number(url.searchParams.get("limit") || 100);
    return jsonResponse({ evidence: service.listEvidence(limit) }, 200, req, {});
  }

  // 15. GET /api/agent-os/cockpit/providers
  if (req.method === "GET" && pathname === "/api/agent-os/cockpit/providers") {
    return jsonResponse({ providers: await service.refreshProviders() }, 200, req, {});
  }

  // 16. POST /api/agent-os/cockpit/providers/verify
  if (req.method === "POST" && pathname === "/api/agent-os/cockpit/providers/verify") {
    const body = await readJsonBody(req);
    const providerId = typeof body.providerId === "string" ? body.providerId : "";
    const attestedBy = typeof body.attestedBy === "string" ? body.attestedBy : "dashboard";
    const note = typeof body.note === "string" ? body.note : "";
    if (!providerId) return badRequest(req, "Field 'providerId' is required");
    try {
      const provider = service.verifyProvider(providerId, attestedBy, note);
      if (!provider) return notFound(req, "Provider not found");
      return jsonResponse({ provider }, 200, req, {});
    } catch (err) {
      return invariantError(req, err);
    }
  }

  // 17. POST /api/agent-os/cockpit/releases/compare
  if (req.method === "POST" && pathname === "/api/agent-os/cockpit/releases/compare") {
    return jsonResponse({ comparison: await service.compareWithKnownGood() }, 200, req, {});
  }

  // 18. POST /api/agent-os/cockpit/releases/mark
  if (req.method === "POST" && pathname === "/api/agent-os/cockpit/releases/mark") {
    const body = await readJsonBody(req);
    const sha = typeof body.sha === "string" ? body.sha : "";
    const state = String(body.state ?? "") as "known_good" | "known_bad" | "unknown";
    const markedBy = typeof body.markedBy === "string" ? body.markedBy : "dashboard";
    if (!sha || !state) return badRequest(req, "Fields 'sha' and 'state' are required");
    try {
      const mark = service.markRelease(sha, state, markedBy, typeof body.reason === "string" ? body.reason : undefined);
      return jsonResponse({ mark }, 200, req, {});
    } catch (err) {
      return invariantError(req, err);
    }
  }

  // 19. POST /api/agent-os/cockpit/context-snapshot
  if (req.method === "POST" && pathname === "/api/agent-os/cockpit/context-snapshot") {
    const body = await readJsonBody(req);
    const attachments = Array.isArray(body.attachments)
      ? (body.attachments as Array<{ kind?: unknown; ref?: unknown }>).map((a) => ({ kind: String(a.kind ?? "generic"), ref: String(a.ref ?? "") }))
      : [];
    const snapshot = await service.createContextSnapshot(attachments);
    return jsonResponse({ snapshot }, 201, req, {});
  }

  // 20. GET /api/agent-os/cockpit/context-snapshot
  if (req.method === "GET" && pathname === "/api/agent-os/cockpit/context-snapshot") {
    const id = url.searchParams.get("id");
    if (!id) return badRequest(req, "Query parameter 'id' is required");
    const snapshot = service.getContextSnapshot(id);
    if (!snapshot) return notFound(req, "Snapshot not found");
    return jsonResponse({ snapshot }, 200, req, {});
  }

  // 21. POST /api/agent-os/cockpit/reviews
  if (req.method === "POST" && pathname === "/api/agent-os/cockpit/reviews") {
    const body = await readJsonBody(req);
    const findings = Array.isArray(body.findings) ? (body.findings as never[]) : [];
    const run = service.submitReview(
      findings.map((f) => {
        const record = f as Record<string, unknown>;
        return {
          reviewer: String(record.reviewer ?? "unknown"),
          verdict: (record.verdict === "pass" || record.verdict === "pass_with_warning" ? record.verdict : "changes_required") as never,
          confidence: typeof record.confidence === "number" ? record.confidence : 0.5,
          severity: (["info", "warning", "blocker", "critical"].includes(String(record.severity)) ? record.severity : "warning") as never,
          title: String(record.title ?? "review finding"),
          needsVerification: record.needsVerification === true,
          evidenceRefs: Array.isArray(record.evidenceRefs) ? record.evidenceRefs.map(String) : [],
          model: typeof record.model === "string" ? record.model : undefined,
        };
      }),
      typeof body.contextSnapshotId === "string" ? body.contextSnapshotId : undefined,
      typeof body.diffSummary === "string" ? body.diffSummary : undefined,
    );
    return jsonResponse({ review: run }, 201, req, {});
  }

  // 22. GET /api/agent-os/cockpit/reviews
  if (req.method === "GET" && pathname === "/api/agent-os/cockpit/reviews") {
    return jsonResponse({ reviews: service.store.listReviewRuns() }, 200, req, {});
  }

  // 23. GET /api/agent-os/cockpit/tasks
  if (req.method === "GET" && pathname === "/api/agent-os/cockpit/tasks") {
    const status = (url.searchParams.get("status") ?? undefined) as never;
    return jsonResponse({ tasks: service.listTasks(status) }, 200, req, {});
  }

  // 24. POST /api/agent-os/cockpit/tasks
  if (req.method === "POST" && pathname === "/api/agent-os/cockpit/tasks") {
    const body = await readJsonBody(req);
    const title = typeof body.title === "string" ? body.title : "";
    if (!title.trim()) return badRequest(req, "Field 'title' is required");
    const task = service.createTask({
      title,
      ownerAgentId: typeof body.ownerAgentId === "string" ? body.ownerAgentId : undefined,
      risk: (typeof body.risk === "string" ? body.risk : "R2") as never,
      requiredGateProfile: (typeof body.requiredGateProfile === "string" ? body.requiredGateProfile : undefined) as never,
    });
    return jsonResponse({ task }, 201, req, {});
  }

  return null;
}
