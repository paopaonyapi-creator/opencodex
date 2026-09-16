/**
 * Pao Market Signal Control Plane — HTTP server (Phase 20.52 §43).
 *
 * Standalone Bun server on 127.0.0.1 (default 8790), mirroring the AI Gateway
 * server conventions. Two auth domains:
 *
 * - Webhook ingress (/api/market/webhooks/:provider): provider-key auth via
 *   the adapter's signature/token verification. No session auth here.
 * - Everything else: Bearer MARKET_ADMIN_KEY. Approval resolution additionally
 *   requires the acting user to appear in MARKET_APPROVER_ACTORS (empty by
 *   default — fail closed).
 *
 * Webhook handlers read the RAW request bytes before any JSON parsing so
 * HMAC verification sees exactly what the provider signed.
 */

import type { MarketConfig } from "./config";
import { loadMarketConfig, LIVE_EXECUTION_DISABLED } from "./config";
import { MarketService } from "./service";
import { ApprovalError } from "./approvals/service";
import type { ActorRef, IncomingWebhookRequest } from "./types";
import type { Server } from "bun";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "X-Pao-Market": "1" },
  });
}

function errorResponse(code: string, message: string, status: number, correlationId?: string): Response {
  return jsonResponse({ error: { code, message, correlationId } }, status);
}

let requestCounter = 0;
function nextRequestId(): string {
  return `mktreq-${Date.now()}-${++requestCounter}`;
}

function headersToObject(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

interface ServerState {
  readonly config: MarketConfig;
  readonly service: MarketService;
  readonly startedAt: string;
  expiryTimer: ReturnType<typeof setInterval> | null;
}

function resolveAdminActor(state: ServerState, req: Request): ActorRef | null {
  const adminKey = process.env[state.config.adminKeyEnv];
  const header = req.headers.get("authorization");
  if (!adminKey || !header) return null;
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : header.trim();
  if (!token || token !== adminKey) return null;
  return { type: "user", id: "admin" };
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleWebhook(state: ServerState, req: Request, providerId: string): Promise<Response> {
  const correlationId = nextRequestId();
  const rawBody = new Uint8Array(await req.arrayBuffer());
  const request: IncomingWebhookRequest = {
    providerId,
    rawBody,
    headers: headersToObject(req),
    receivedAt: new Date().toISOString(),
  };
  const outcome = await state.service.ingest.ingestWebhook(providerId, request);
  if (!outcome.ok) {
    return errorResponse(outcome.errorCode ?? "MARKET_WEBHOOK_REJECTED", outcome.message ?? "Webhook rejected", outcome.httpStatus, correlationId);
  }
  return jsonResponse({ accepted: true, signalId: outcome.signalId, correlationId }, outcome.httpStatus);
}

async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await req.json()) as unknown;
    return body !== null && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function actorError(err: unknown): Response | null {
  if (err instanceof ApprovalError) {
    return errorResponse(err.code, err.message, err.httpStatus);
  }
  const httpStatus = (err as { httpStatus?: number }).httpStatus;
  if (typeof httpStatus === "number") {
    return errorResponse((err as Error).message.split(":")[0] ?? "MARKET_FORBIDDEN", (err as Error).message, httpStatus);
  }
  return null;
}

async function handleRoutes(state: ServerState, req: Request, url: URL): Promise<Response | null> {
  const correlationId = nextRequestId();
  const { service } = state;
  const path = url.pathname;
  const method = req.method;
  const segments = path.split("/").filter(Boolean);

  // Health is open (no secrets, spec §97).
  if (path === "/api/market/health" && method === "GET") {
    return jsonResponse(service.health());
  }
  if (path === "/api/market/metrics" && method === "GET") {
    const health = service.health();
    return jsonResponse({
      circuitBreaker: health.circuitBreaker,
      pendingApprovals: health.pendingApprovals,
      providers: health.providers,
      executionMode: health.executionMode,
      liveExecution: LIVE_EXECUTION_DISABLED ? "disabled" : "disabled",
    });
  }

  // Webhook ingress — provider-key auth (handled by the pipeline/adapters).
  if (segments[2] === "webhooks" && segments.length === 4 && method === "POST") {
    return handleWebhook(state, req, segments[3]!);
  }

  // Everything below requires the admin bearer key.
  const actor = resolveAdminActor(state, req);
  if (!actor) {
    return errorResponse("MARKET_UNAUTHORIZED", "Admin authorization required", 401);
  }

  if (segments[2] === "signals") {
    const signalId = segments[3];
    if (!signalId) {
      if (method === "GET") {
        const status = url.searchParams.get("status") ?? undefined;
        const symbol = url.searchParams.get("symbol") ?? undefined;
        const signals = service.store.listSignals({
          status: status as never,
          symbol: symbol ?? undefined,
          limit: Number(url.searchParams.get("limit")) || 100,
        });
        return jsonResponse({ signals });
      }
      if (method === "POST" && path === "/api/market/signals/manual") {
        const body = await readJsonBody(req);
        if (!body) return errorResponse("MARKET_WEBHOOK_SCHEMA_INVALID", "Invalid JSON body", 400);
        const outcome = await service.ingest.ingestManual(actor, body);
        if (!outcome.ok) {
          return errorResponse(outcome.errorCode ?? "MARKET_SIGNAL_REJECTED", outcome.message ?? "Manual signal rejected", outcome.httpStatus, correlationId);
        }
        return jsonResponse({ accepted: true, signalId: outcome.signalId, correlationId }, outcome.httpStatus ?? 201);
      }
      return errorResponse("not_found", "Unknown market endpoint", 404);
    }

    const sub = segments[4];
    if (!sub && method === "GET") {
      const entry = service.store.getSignal(signalId);
      if (!entry) return errorResponse("not_found", "Signal not found", 404);
      return jsonResponse({ ...entry, quality: service.qualityOf(entry.signal) });
    }
    if (sub === "audit" && method === "GET") {
      return jsonResponse({ audit: service.auditTrail({ resourceType: "signal", resourceId: signalId }) });
    }
    if (sub === "analysis" && method === "GET") {
      return jsonResponse({ analysis: service.store.getAnalysisBySignal(signalId) });
    }
    if (sub === "risk" && method === "GET") {
      return jsonResponse({ risk: service.store.getRiskAssessmentBySignal(signalId) });
    }
    if (sub === "analyze" && method === "POST") {
      try {
        const analysis = await service.analyzeSignal(signalId, actor, correlationId);
        return jsonResponse({ analysis });
      } catch (err) {
        const handled = actorError(err);
        if (handled) return handled;
        return errorResponse("MARKET_ANALYSIS_FAILED", err instanceof Error ? err.message : "analysis failed", 500, correlationId);
      }
    }
    if (sub === "risk-check" && method === "POST") {
      try {
        const risk = service.runRiskCheck(signalId, actor, correlationId);
        return jsonResponse({ risk });
      } catch (err) {
        const handled = actorError(err);
        if (handled) return handled;
        return errorResponse("MARKET_RISK_DATA_MISSING", err instanceof Error ? err.message : "risk check failed", 500, correlationId);
      }
    }
    if (sub === "propose" && method === "POST") {
      try {
        const proposal = service.createProposal(signalId, actor, correlationId);
        return jsonResponse({ proposal }, 201);
      } catch (err) {
        const handled = actorError(err);
        if (handled) return handled;
        return errorResponse("MARKET_PROPOSAL_NOT_READY", err instanceof Error ? err.message : "proposal creation failed", 409, correlationId);
      }
    }
    return errorResponse("not_found", "Unknown market endpoint", 404);
  }

  if (segments[2] === "approvals") {
    const approvalId = segments[3];
    if (!approvalId && method === "GET") {
      return jsonResponse({ approvals: service.store.listPendingApprovals() });
    }
    if (approvalId && method === "GET") {
      const approval = service.store.getApproval(approvalId);
      if (!approval) return errorResponse("not_found", "Approval not found", 404);
      return jsonResponse({ approval });
    }
    if (approvalId && segments[4] === "approve" && method === "POST") {
      const body = await readJsonBody(req);
      try {
        const approval = service.approveProposal(approvalId, actor, body?.editedFields as Record<string, unknown> | undefined);
        return jsonResponse({ approval });
      } catch (err) {
        const handled = actorError(err);
        return handled ?? errorResponse("MARKET_APPROVAL_FORBIDDEN", err instanceof Error ? err.message : "approval failed", 403);
      }
    }
    if (approvalId && segments[4] === "reject" && method === "POST") {
      const body = await readJsonBody(req);
      const reason = typeof body?.reason === "string" && body.reason.trim() !== "" ? body.reason : "rejected by operator";
      try {
        const approval = service.rejectProposal(approvalId, actor, reason);
        return jsonResponse({ approval });
      } catch (err) {
        const handled = actorError(err);
        return handled ?? errorResponse("MARKET_APPROVAL_FORBIDDEN", err instanceof Error ? err.message : "rejection failed", 403);
      }
    }
    return errorResponse("not_found", "Unknown market endpoint", 404);
  }

  if (segments[2] === "providers") {
    const providerId = segments[3];
    if (!providerId && method === "GET") {
      return jsonResponse({ providers: service.store.listProviders().map(p => ({ ...p, secretConfigured: !!service.config.providers[p.providerId]?.secretEnv && !!process.env[service.config.providers[p.providerId]!.secretEnv] })) });
    }
    if (providerId && segments[4] && method === "POST") {
      const enable = segments[4] === "enable";
      if (!enable && segments[4] !== "disable") return errorResponse("not_found", "Unknown provider action", 404);
      try {
        service.setProviderEnabled(providerId, enable, actor);
        return jsonResponse({ providerId, enabled: enable });
      } catch (err) {
        const handled = actorError(err);
        return handled ?? errorResponse("MARKET_FORBIDDEN", err instanceof Error ? err.message : "provider action failed", 403);
      }
    }
    return errorResponse("not_found", "Unknown market endpoint", 404);
  }

  if (segments[2] === "circuit-breaker") {
    if (segments.length === 3 && method === "GET") {
      return jsonResponse({ circuitBreaker: service.breaker.current() });
    }
    if (segments[3] === "pause" && method === "POST") {
      try {
        service.setBreakerState("PAUSED", actor, "operator pause");
        return jsonResponse({ circuitBreaker: service.breaker.current() });
      } catch (err) {
        const handled = actorError(err);
        return handled ?? errorResponse("MARKET_FORBIDDEN", err instanceof Error ? err.message : "pause failed", 403);
      }
    }
    if (segments[3] === "reset" && method === "POST") {
      try {
        service.setBreakerState("ACTIVE", actor, "operator reset");
        return jsonResponse({ circuitBreaker: service.breaker.current() });
      } catch (err) {
        const handled = actorError(err);
        return handled ?? errorResponse("MARKET_FORBIDDEN", err instanceof Error ? err.message : "reset failed", 403);
      }
    }
    if (segments[3] === "lock" && method === "POST") {
      try {
        service.setBreakerState("LOCKED", actor, "operator lock");
        return jsonResponse({ circuitBreaker: service.breaker.current() });
      } catch (err) {
        const handled = actorError(err);
        return handled ?? errorResponse("MARKET_FORBIDDEN", err instanceof Error ? err.message : "lock failed", 403);
      }
    }
    return errorResponse("not_found", "Unknown market endpoint", 404);
  }

  if (segments[2] === "paper-orders") {
    if (segments.length === 3 && method === "GET") {
      return jsonResponse({
        openPositions: service.store.listOpenPositions(),
        results: service.store.listTradeResults(),
      });
    }
    if (segments[3] && segments[4] === "close" && method === "POST") {
      const body = await readJsonBody(req);
      const exitPrice = Number(body?.exitPrice);
      if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
        return errorResponse("MARKET_PAPER_EXECUTION_FAILED", "exitPrice must be a positive number", 422);
      }
      try {
        const result = service.closePosition(segments[3], exitPrice, actor);
        return jsonResponse({ result });
      } catch (err) {
        return errorResponse("MARKET_PAPER_EXECUTION_FAILED", err instanceof Error ? err.message : "close failed", 409);
      }
    }
    if (segments[3] && method === "GET") {
      const proposal = service.store.getProposal(segments[3]);
      const order = proposal ? service.store.getPaperOrderByProposal(proposal.id) : null;
      if (!order) return errorResponse("not_found", "Paper order not found", 404);
      return jsonResponse({ order });
    }
    return errorResponse("not_found", "Unknown market endpoint", 404);
  }

  if (segments[2] === "proposals") {
    const proposalId = segments[3];
    if (!proposalId && method === "GET") {
      return jsonResponse({ proposals: service.store.listProposals() });
    }
    if (proposalId && method === "GET") {
      const proposal = service.store.getProposal(proposalId);
      if (!proposal) return errorResponse("not_found", "Proposal not found", 404);
      return jsonResponse({ proposal });
    }
    if (proposalId && segments[4] === "execute" && method === "POST") {
      try {
        const { orderId } = await service.executeProposal(proposalId, actor);
        return jsonResponse({ orderId, mode: "paper" });
      } catch (err) {
        return errorResponse("MARKET_PAPER_EXECUTION_FAILED", err instanceof Error ? err.message : "execution failed", 409);
      }
    }
    return errorResponse("not_found", "Unknown market endpoint", 404);
  }

  if (segments[2] === "notifications" && method === "GET") {
    return jsonResponse({ notifications: service.notifications(Number(url.searchParams.get("limit")) || 100) });
  }

  if (segments[2] === "events" && method === "GET") {
    return jsonResponse({ events: service.bus.recent(Number(url.searchParams.get("limit")) || 100) });
  }

  return null;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export interface MarketServerHandle {
  server: Server<unknown>;
  config: MarketConfig;
  stop(): void;
}

export async function startMarketServer(rootDir: string): Promise<MarketServerHandle> {
  const config = loadMarketConfig();
  if (!config.enabled) {
    throw new Error("Pao Market Control Plane is not enabled. Set MARKET_MODULE_ENABLED=true to activate.");
  }

  const service = new MarketService({ config });
  const state: ServerState = {
    config,
    service,
    startedAt: new Date().toISOString(),
    expiryTimer: null,
  };

  // Approval-expiry scheduler (unref: never holds the process open).
  state.expiryTimer = setInterval(() => {
    try {
      service.expireStaleApprovals();
    } catch {
      // Expiry sweep failures are isolated; the next cycle retries.
    }
  }, 60_000);
  state.expiryTimer.unref?.();

  const server = Bun.serve({
    port: config.port,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      try {
        if (url.pathname === "/health" || url.pathname === "/healthz") {
          return jsonResponse({ status: "ok", module: "market", executionMode: "paper", startedAt: state.startedAt });
        }
        if (!url.pathname.startsWith("/api/market/")) {
          return errorResponse("not_found", "Not found", 404);
        }
        const handled = await handleRoutes(state, req, url);
        return handled ?? errorResponse("not_found", "Not found", 404);
      } catch (err) {
        // Never leak internals or secrets to clients.
        return errorResponse("market_internal_error", "Internal market module error", 500, nextRequestId());
      }
    },
  });

  return {
    server,
    config,
    stop() {
      if (state.expiryTimer) clearInterval(state.expiryTimer);
      server.stop(true);
    },
  };
}
