// Phase 21.01 — Parley Multi-Agent Work Room routes (/api/agent-os/parley/*).

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { ParleyRoomEngine } from "../../agent-os/parley/room-engine";
import { ParleyStore } from "../../agent-os/parley/store";
import { parleyEnabled } from "../../agent-os/parley/flags";

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function handleParleyRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  if (pathname !== "/api/agent-os/parley" && !pathname.startsWith("/api/agent-os/parley/")) return null;

  if (!parleyEnabled()) {
    return jsonResponse(
      { error: { code: "DISABLED", message: "Phase 21.01 Parley Multi-Agent Work Room is disabled" } },
      403,
      req,
      {},
    );
  }

  const store = new ParleyStore();
  const engine = new ParleyRoomEngine(store);

  try {
    // Rooms
    if (req.method === "GET" && pathname === "/api/agent-os/parley/rooms") {
      return jsonResponse({ ok: true, rooms: engine.listRooms() }, 200, req, {});
    }
    if (req.method === "POST" && pathname === "/api/agent-os/parley/rooms") {
      const body = await readJson(req);
      const room = engine.createRoom({
        name: String(body.name ?? "New Room"),
        workspacePath: String(body.workspacePath ?? "."),
        mode: (body.mode as any) ?? "WORK",
        permissionProfile: (body.permissionProfile as any) ?? "workspace-write",
        budgetLimitUsd: typeof body.budgetLimitUsd === "number" ? body.budgetLimitUsd : undefined,
      });
      return jsonResponse({ ok: true, room }, 201, req, {});
    }

    // Room detail & subresources
    if (pathname.startsWith("/api/agent-os/parley/rooms/")) {
      const sub = pathname.slice("/api/agent-os/parley/rooms/".length);
      const parts = sub.split("/");
      const roomId = decodeURIComponent(parts[0]);

      if (parts.length === 1 && req.method === "GET") {
        const room = engine.getRoom(roomId);
        if (!room) return jsonResponse({ error: { code: "NOT_FOUND", message: "room not found" } }, 404, req, {});
        return jsonResponse({ ok: true, room }, 200, req, {});
      }

      if (parts.length === 2 && req.method === "GET" && parts[1] === "messages") {
        return jsonResponse({ ok: true, messages: engine.listMessages(roomId) }, 200, req, {});
      }

      if (parts.length === 2 && req.method === "POST" && parts[1] === "messages") {
        const body = await readJson(req);
        const res = engine.postMessage({
          roomId,
          senderType: (body.senderType as any) ?? "user",
          senderId: String(body.senderId ?? "user_api"),
          senderDisplayName: String(body.senderDisplayName ?? "User"),
          content: String(body.content ?? ""),
        });
        return jsonResponse({ ok: true, ...res }, 201, req, {});
      }

      if (parts.length === 2 && req.method === "GET" && parts[1] === "agents") {
        return jsonResponse({ ok: true, agents: engine.listRoomAgents(roomId) }, 200, req, {});
      }

      if (parts.length === 2 && req.method === "POST" && parts[1] === "agents") {
        const body = await readJson(req);
        const ag = engine.addAgentToRoom(roomId, {
          agentId: String(body.agentId),
          displayName: String(body.displayName ?? body.agentId),
          role: (body.role as any) ?? "builder",
          provider: String(body.provider ?? "openai"),
          actualModelId: String(body.actualModelId ?? "gpt-4o"),
          endpointProfile: typeof body.endpointProfile === "string" ? body.endpointProfile : undefined,
        });
        return jsonResponse({ ok: true, agent: ag }, 201, req, {});
      }

      if (parts.length === 2 && req.method === "GET" && parts[1] === "export") {
        const md = engine.exportTranscriptMarkdown(roomId);
        return jsonResponse({ ok: true, markdown: md }, 200, req, {});
      }
    }

    // Run Inspector
    if (req.method === "GET" && pathname.startsWith("/api/agent-os/parley/runs/") && pathname.endsWith("/inspector")) {
      const runId = decodeURIComponent(pathname.slice("/api/agent-os/parley/runs/".length, -"/inspector".length));
      const inspector = engine.getRunInspector(runId);
      return jsonResponse({ ok: true, inspector }, 200, req, {});
    }

    return jsonResponse({ error: { code: "not_found", message: "unknown parley route" } }, 404, req, {});
  } catch (err) {
    return jsonResponse(
      { error: { code: "INTERNAL", message: err instanceof Error ? err.message : "Parley request failed" } },
      500,
      req,
      {},
    );
  }
}
