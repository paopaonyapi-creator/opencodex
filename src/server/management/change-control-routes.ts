// Phase 22 — Pao-hubPro Autonomous Change Control (ACC)
// REST Management API Endpoints
// Accessible via /api/change-control/* and /api/agent-os/change-control/*

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import {
  getChangeControlController,
  getChangeWatchdog,
  type CreateProposalInput,
  type ProposalStatus,
} from "../../agent-os/change-control";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_request", message } }, 400, req, {});
}

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

export async function handleChangeControlRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;

  let path = "";
  if (url.pathname.startsWith("/api/agent-os/change-control/")) {
    path = url.pathname.slice("/api/agent-os/change-control/".length);
  } else if (url.pathname === "/api/agent-os/change-control") {
    path = "";
  } else if (url.pathname.startsWith("/api/change-control/")) {
    path = url.pathname.slice("/api/change-control/".length);
  } else if (url.pathname === "/api/change-control") {
    path = "";
  } else {
    return null;
  }

  const controller = getChangeControlController();
  const watchdog = getChangeWatchdog();

  // 1. GET /proposals - List all proposals
  if (path === "proposals" || path === "") {
    if (req.method === "GET") {
      const status = url.searchParams.get("status") as ProposalStatus | null;
      const proposals = controller.listProposals(status ?? undefined);
      return jsonResponse({ proposals }, 200, req, {});
    }

    // 2. POST /proposals - Create new proposal
    if (req.method === "POST") {
      const body = (await req.json().catch(() => null)) as Partial<CreateProposalInput> | null;
      if (!body?.title || !body?.author || !body?.sourceBranch || !Array.isArray(body?.files)) {
        return badRequest(req, "Missing required fields: title, author, sourceBranch, files");
      }

      const proposal = controller.createProposal({
        title: body.title,
        description: body.description ?? "",
        author: body.author,
        sourceBranch: body.sourceBranch,
        targetBranch: body.targetBranch ?? "dev",
        intentCategory: body.intentCategory ?? "feature",
        files: body.files,
        diffText: body.diffText,
      });

      return jsonResponse({ proposal }, 201, req, {});
    }
  }

  // 3. Proposal sub-routes: /proposals/:id/*
  if (path.startsWith("proposals/")) {
    const segments = path.slice("proposals/".length).split("/");
    const id = decodeURIComponent(segments[0]);
    const action = segments[1];

    const proposal = controller.getProposal(id);
    if (!proposal) {
      return notFound(req, `Proposal '${id}' not found`);
    }

    // GET /proposals/:id
    if (!action && req.method === "GET") {
      const watchMetrics = watchdog.getWatchStatus(id);
      return jsonResponse({ proposal, watchdog: watchMetrics ?? null }, 200, req, {});
    }

    // POST /proposals/:id/sandbox
    if (action === "sandbox" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { mockResults?: any };
      const updated = await controller.executeSandbox(id, body.mockResults);
      return jsonResponse({ proposal: updated }, 200, req, {});
    }

    // POST /proposals/:id/audit
    if (action === "audit" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        overrideVerdict?: "APPROVED" | "CHANGES_REQUESTED" | "BLOCKED" | "HUMAN_CONFIRMATION_REQUIRED";
      };
      const updated = controller.executeCouncilAudit(id, { overrideVerdict: body.overrideVerdict });
      return jsonResponse({ proposal: updated }, 200, req, {});
    }

    // POST /proposals/:id/gate
    if (action === "gate" && req.method === "POST") {
      const decision = controller.evaluateDecisionGate(id);
      if (decision.action === "auto_merge") {
        watchdog.startWatch(id);
      }
      return jsonResponse(decision, 200, req, {});
    }

    // POST /proposals/:id/approve
    if (action === "approve" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { operator?: string };
      const updated = controller.approve(id, body.operator ?? "operator");
      watchdog.startWatch(id);
      return jsonResponse({ proposal: updated }, 200, req, {});
    }

    // POST /proposals/:id/reject
    if (action === "reject" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { operator?: string; reason?: string };
      const updated = controller.reject(id, body.operator ?? "operator", body.reason ?? "Rejected by operator");
      return jsonResponse({ proposal: updated }, 200, req, {});
    }

    // POST /proposals/:id/rollback
    if (action === "rollback" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { operator?: string };
      const updated = controller.rollback(id, body.operator ?? "operator");
      watchdog.stopWatch(id);
      return jsonResponse({ proposal: updated }, 200, req, {});
    }
  }

  // 4. Watchdog metrics report / query: /watchdog/:id
  if (path.startsWith("watchdog/")) {
    const id = decodeURIComponent(path.slice("watchdog/".length));
    if (req.method === "GET") {
      const metrics = watchdog.getWatchStatus(id);
      if (!metrics) {
        return notFound(req, `No active watchdog for proposal '${id}'`);
      }
      return jsonResponse({ proposalId: id, metrics }, 200, req, {});
    }

    if (req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as any;
      const result = watchdog.reportMetrics(id, body);
      return jsonResponse(result, 200, req, {});
    }
  }

  return notFound(req, `Unknown change control route: /${path}`);
}
