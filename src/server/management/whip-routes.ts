// Phase 20.99 — Whip Mobile Operations Plane routes (/api/agent-os/whip/*).

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { WhipStore, newWhipId, nowIso } from "../../agent-os/whip/store";
import { SecureTransportCore } from "../../agent-os/whip/transport";
import { UnifiedFleetManager } from "../../agent-os/whip/fleet";
import { RemoteFileWorkspace, TerminalGateway } from "../../agent-os/whip/workspace";
import { DevicePairingManager, OfflineCommandQueue } from "../../agent-os/whip/queue-pairing";
import { WhipApprovalEngine } from "../../agent-os/whip/approval-engine";
import { whipEnabled } from "../../agent-os/whip/flags";
import { WhipError } from "../../agent-os/whip/types";

function fail(req: Request, err: unknown): Response {
  if (err instanceof WhipError) {
    return jsonResponse(
      { error: { code: err.code, message: err.message, detail: err.detail } },
      err.httpStatus,
      req,
      {},
    );
  }
  return jsonResponse(
    { error: { code: "INTERNAL", message: err instanceof Error ? err.message : "Whip request failed" } },
    500,
    req,
    {},
  );
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function handleWhipRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  if (pathname !== "/api/agent-os/whip" && !pathname.startsWith("/api/agent-os/whip/")) return null;

  if (!whipEnabled()) {
    return jsonResponse(
      { error: { code: "DISABLED", message: "Phase 20.99 Whip mobile operations plane is disabled" } },
      403,
      req,
      {},
    );
  }

  const store = new WhipStore();
  const transport = new SecureTransportCore(store);
  const fleet = new UnifiedFleetManager(store);
  const terminal = new TerminalGateway(store);
  const workspace = new RemoteFileWorkspace();
  const queue = new OfflineCommandQueue(store);
  const pairing = new DevicePairingManager(store);
  const approvals = new WhipApprovalEngine(store);

  try {
    // Hosts
    if (req.method === "GET" && pathname === "/api/agent-os/whip/hosts") {
      return jsonResponse({ ok: true, hosts: store.listHosts() }, 200, req, {});
    }
    if (req.method === "POST" && pathname === "/api/agent-os/whip/hosts") {
      const body = await readJson(req);
      const host = {
        id: newWhipId("whph"),
        displayName: String(body.displayName ?? "host"),
        host: String(body.host),
        port: typeof body.port === "number" ? body.port : 22,
        username: String(body.username ?? "operator"),
        credentialRef: typeof body.credentialRef === "string" ? body.credentialRef : null,
        jumpRoute: Array.isArray(body.jumpRoute) ? body.jumpRoute.map(String) : [],
        tailscaleIp: typeof body.tailscaleIp === "string" ? body.tailscaleIp : null,
        status: "offline" as const,
        runtimeGeneration: 1,
        lastConnectedAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      store.insertHost(host);
      return jsonResponse({ ok: true, host }, 201, req, {});
    }

    // Fleet
    if (req.method === "GET" && pathname === "/api/agent-os/whip/fleet") {
      const hostId = url.searchParams.get("hostId") ?? undefined;
      const status = url.searchParams.get("status") ?? undefined;
      return jsonResponse({ ok: true, fleet: fleet.listFleet({ hostId, status: status as any }) }, 200, req, {});
    }

    // Transcripts
    if (req.method === "GET" && pathname === "/api/agent-os/whip/transcripts") {
      const agentId = url.searchParams.get("agentId");
      const sessionId = url.searchParams.get("sessionId");
      if (!agentId || !sessionId) {
        return jsonResponse({ error: { code: "INVALID_INPUT", message: "agentId and sessionId required" } }, 400, req, {});
      }
      return jsonResponse({ ok: true, transcript: fleet.getOrCreateTranscript(agentId, sessionId) }, 200, req, {});
    }
    if (req.method === "POST" && pathname === "/api/agent-os/whip/transcripts/turn") {
      const body = await readJson(req);
      const tr = fleet.appendTurn(String(body.agentId), String(body.sessionId), {
        kind: (body.kind as any) ?? "user",
        content: String(body.content ?? ""),
      });
      return jsonResponse({ ok: true, transcript: tr }, 200, req, {});
    }

    // Terminals
    if (req.method === "GET" && pathname === "/api/agent-os/whip/terminals") {
      const hostId = url.searchParams.get("hostId") ?? undefined;
      return jsonResponse({ ok: true, terminals: terminal.listTerminals(hostId) }, 200, req, {});
    }
    if (req.method === "POST" && pathname === "/api/agent-os/whip/terminals") {
      const body = await readJson(req);
      const term = terminal.openTerminal({
        hostId: String(body.hostId),
        agentId: typeof body.agentId === "string" ? body.agentId : undefined,
        sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
        cwd: typeof body.cwd === "string" ? body.cwd : undefined,
      });
      return jsonResponse({ ok: true, terminal: term }, 201, req, {});
    }

    // Pairing
    if (req.method === "POST" && pathname === "/api/agent-os/whip/pairing/create") {
      const body = await readJson(req);
      const res = pairing.createPairingSession(
        String(body.hostHint ?? "127.0.0.1"),
        typeof body.port === "number" ? body.port : 22,
      );
      return jsonResponse({ ok: true, ...res }, 201, req, {});
    }
    if (req.method === "POST" && pathname === "/api/agent-os/whip/pairing/complete") {
      const body = await readJson(req);
      const dev = pairing.completePairing(String(body.pairingCode), {
        label: String(body.label ?? "Mobile Device"),
        publicKey: String(body.publicKey),
        platform: (body.platform as any) ?? "android",
        biometricEnabled: body.biometricEnabled === true,
      });
      return jsonResponse({ ok: true, device: dev }, 200, req, {});
    }

    // Approvals
    if (req.method === "GET" && pathname === "/api/agent-os/whip/approvals") {
      const status = url.searchParams.get("status") ?? undefined;
      return jsonResponse({ ok: true, approvals: store.listApprovals(status as any) }, 200, req, {});
    }
    if (req.method === "POST" && pathname.startsWith("/api/agent-os/whip/approvals/") && pathname.endsWith("/decide")) {
      const id = decodeURIComponent(pathname.slice("/api/agent-os/whip/approvals/".length, -"/decide".length));
      const body = await readJson(req);
      const res = approvals.decideApproval({
        approvalId: id,
        decision: body.decision === "approved" ? "approved" : "denied",
        decidedBy: String(body.decidedBy ?? "operator"),
        biometricVerified: body.biometricVerified === true,
        reason: typeof body.reason === "string" ? body.reason : undefined,
      });
      return jsonResponse({ ok: true, approval: res }, 200, req, {});
    }

    // Queue
    if (req.method === "GET" && pathname === "/api/agent-os/whip/queue") {
      const hostId = url.searchParams.get("hostId") ?? undefined;
      return jsonResponse({ ok: true, queue: queue.listQueuedIntents(hostId) }, 200, req, {});
    }
    if (req.method === "POST" && pathname === "/api/agent-os/whip/queue") {
      const body = await readJson(req);
      const intent = queue.enqueueIntent({
        hostId: String(body.hostId),
        deviceId: String(body.deviceId),
        targetRef: (body.targetRef as any) ?? {},
        semanticAction: String(body.semanticAction),
        payload: (body.payload as any) ?? {},
        contextRevision: typeof body.contextRevision === "number" ? body.contextRevision : 1,
        riskClass: (body.riskClass as any) ?? "R1",
      });
      return jsonResponse({ ok: true, intent }, 201, req, {});
    }

    // Audit
    if (req.method === "GET" && pathname === "/api/agent-os/whip/audit") {
      const hostId = url.searchParams.get("hostId") ?? undefined;
      const correlationId = url.searchParams.get("correlationId") ?? undefined;
      return jsonResponse({ ok: true, events: approvals.listAuditEvents({ hostId, correlationId }) }, 200, req, {});
    }

    return jsonResponse({ error: { code: "not_found", message: "unknown whip route" } }, 404, req, {});
  } catch (err) {
    return fail(req, err);
  }
}
