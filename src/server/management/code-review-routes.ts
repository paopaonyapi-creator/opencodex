// GOLD slice #1 & #3 — Deterministic code review runtime management routes.
//
// Equality-guard dispatcher matching the management surface pattern
// (ecc-routes / social-routes precedent). Reconciled against route-registry
// and driven by the `ocx review` CLI capability. All review operations are
// read-only over the target repository.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getCodeReviewService } from "../../agent-os/code-review/service";
import { ReviewError } from "../../agent-os/code-review/types";

function fail(req: Request, err: unknown): Response {
  if (err instanceof ReviewError) {
    return jsonResponse({ error: { code: err.code, message: err.message } }, err.httpStatus, req, {});
  }
  return jsonResponse(
    { error: { code: "review_internal_error", message: err instanceof Error ? err.message : "internal_error" } },
    500,
    req,
    {},
  );
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readRequestFields(body: Record<string, unknown>): {
  repositoryPath: string;
  mode: "workspace" | "commit" | "range";
  from?: string;
  to?: string;
  commit?: string;
} {
  const repositoryPath = String(body.repositoryPath ?? body.repository_path ?? "").trim();
  const mode = String(body.mode ?? "workspace");
  if (!repositoryPath) throw new ReviewError("REVIEW_INVALID_REQUEST", 400, "repositoryPath is required");
  if (mode !== "workspace" && mode !== "commit" && mode !== "range") {
    throw new ReviewError("REVIEW_INVALID_REQUEST", 400, "mode must be workspace, commit, or range");
  }
  const parsed: { repositoryPath: string; mode: "workspace" | "commit" | "range"; from?: string; to?: string; commit?: string } = {
    repositoryPath,
    mode,
  };
  if (typeof body.from === "string" && body.from) parsed.from = body.from;
  if (typeof body.to === "string" && body.to) parsed.to = body.to;
  if (typeof body.commit === "string" && body.commit) parsed.commit = body.commit;
  return parsed;
}

export async function handleCodeReviewRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  const service = getCodeReviewService();

  try {
    // 1. GET /api/agent-os/code-review
    if (req.method === "GET" && pathname === "/api/agent-os/code-review") {
      const sessions = service.listSessions(50);
      return jsonResponse({
        ok: true,
        phase: "20.81-slice1",
        engine: "pao-deterministic-review",
        sessions: sessions.length,
        completed: sessions.filter((s) => s.status === "completed").length,
        failed: sessions.filter((s) => s.status === "failed").length,
        gateBreakdown: {
          PASS: sessions.filter((s) => s.gate === "PASS").length,
          WARN: sessions.filter((s) => s.gate === "WARN").length,
          REQUIRE_FIX: sessions.filter((s) => s.gate === "REQUIRE_FIX").length,
          HUMAN_APPROVAL: sessions.filter((s) => s.gate === "HUMAN_APPROVAL").length,
          BLOCK: sessions.filter((s) => s.gate === "BLOCK").length,
        },
      }, 200, req, {});
    }

    // 2. POST /api/agent-os/code-review/preview
    if (req.method === "POST" && pathname === "/api/agent-os/code-review/preview") {
      const body = await readJson(req);
      const fields = readRequestFields(body);
      const preview = await service.preview({
        repositoryPath: fields.repositoryPath,
        mode: fields.mode,
        from: fields.from,
        to: fields.to,
        commit: fields.commit,
        requestedBy: String(body.actorId ?? "operator"),
      });
      return jsonResponse({ ok: true, preview }, 200, req, {});
    }

    // 3. POST /api/agent-os/code-review/run
    if (req.method === "POST" && pathname === "/api/agent-os/code-review/run") {
      const body = await readJson(req);
      const fields = readRequestFields(body);
      const result = await service.runReview({
        repositoryPath: fields.repositoryPath,
        mode: fields.mode,
        from: fields.from,
        to: fields.to,
        commit: fields.commit,
        requestedBy: String(body.actorId ?? "operator"),
        delegate: body.delegate === true,
      });
      return jsonResponse({
        ok: true,
        session: result.session,
        gate: result.gate,
        findings: result.findings,
        reused: result.reused,
      }, 200, req, {});
    }

    // 4. GET /api/agent-os/code-review/sessions
    if (req.method === "GET" && pathname === "/api/agent-os/code-review/sessions") {
      const limit = Number(url.searchParams.get("limit") ?? 20);
      return jsonResponse({ ok: true, sessions: service.listSessions(Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 20) }, 200, req, {});
    }

    // 5. GET /api/agent-os/code-review/sessions/{id} (slice decode)
    if (req.method === "GET" && pathname.startsWith("/api/agent-os/code-review/sessions/")) {
      const sessionId = pathname.slice("/api/agent-os/code-review/sessions/".length);
      if (!sessionId) return null;
      const session = service.getSession(sessionId);
      if (!session) {
        return jsonResponse({ error: { code: "REVIEW_SESSION_NOT_FOUND", message: "no such review session" } }, 404, req, {});
      }
      return jsonResponse({
        ok: true,
        session,
        gate: service.loadGate(sessionId),
        findings: service.listFindings(sessionId),
      }, 200, req, {});
    }

    return null;
  } catch (error) {
    return fail(req, error);
  }
}
