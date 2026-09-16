// Phase 20.23 — Pao-hubPro Unified Notification Gateway × Discord Webhook Reliability Layer
// Management REST API Routes.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getNotificationService } from "../../agent-os/notifications";

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

export async function handleNotificationRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  const service = getNotificationService();

  // 1. GET /api/agent-os/notifications/status
  if (req.method === "GET" && pathname === "/api/agent-os/notifications/status") {
    const status = await service.getStatus();
    return jsonResponse({ status }, 200, req, {});
  }

  // 2. GET /api/agent-os/notifications/metrics
  if (req.method === "GET" && pathname === "/api/agent-os/notifications/metrics") {
    const metrics = service.getMetrics();
    return jsonResponse({ metrics }, 200, req, {});
  }

  // 3. GET /api/agent-os/notifications/destinations
  if (req.method === "GET" && pathname === "/api/agent-os/notifications/destinations") {
    const destinations = service.listDestinationsPublic();
    return jsonResponse({ destinations }, 200, req, {});
  }

  // 4. POST /api/agent-os/notifications/destinations
  if (req.method === "POST" && pathname === "/api/agent-os/notifications/destinations") {
    const body = await readJsonBody(req);
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const secretRef = typeof body.secretRef === "string" ? body.secretRef.trim() : "";
    if (!id || !name || !secretRef) {
      return badRequest(req, "Fields 'id', 'name', and 'secretRef' are required");
    }
    try {
      const destination = service.upsertDestination({
        id,
        provider: "discord_webhook",
        name,
        secretRef,
        environment: typeof body.environment === "string" ? (body.environment as any) : "all",
        channelClass: typeof body.channelClass === "string" ? (body.channelClass as any) : "general",
        enabled: body.enabled !== false,
      });
      return jsonResponse({ destination }, 200, req, {});
    } catch (err) {
      return badRequest(req, err instanceof Error ? err.message : String(err));
    }
  }

  // 5. POST /api/agent-os/notifications/destinations/enable
  if (req.method === "POST" && pathname === "/api/agent-os/notifications/destinations/enable") {
    const body = await readJsonBody(req);
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return badRequest(req, "Field 'id' is required");
    const destination = service.enableDestination(id);
    if (!destination) return notFound(req, `Destination '${id}' not found`);
    return jsonResponse({ destination }, 200, req, {});
  }

  // 6. POST /api/agent-os/notifications/destinations/disable
  if (req.method === "POST" && pathname === "/api/agent-os/notifications/destinations/disable") {
    const body = await readJsonBody(req);
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return badRequest(req, "Field 'id' is required");
    const destination = service.disableDestination(id);
    if (!destination) return notFound(req, `Destination '${id}' not found`);
    return jsonResponse({ destination }, 200, req, {});
  }

  // 7. POST /api/agent-os/notifications/destinations/test
  if (req.method === "POST" && pathname === "/api/agent-os/notifications/destinations/test") {
    const body = await readJsonBody(req);
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return badRequest(req, "Field 'id' is required");
    try {
      const receipt = await service.testDestination(id);
      return jsonResponse({ receipt }, 200, req, {});
    } catch (err) {
      return badRequest(req, err instanceof Error ? err.message : String(err));
    }
  }

  // 8. GET /api/agent-os/notifications/events
  if (req.method === "GET" && pathname === "/api/agent-os/notifications/events") {
    const limit = Number(url.searchParams.get("limit") || 100);
    const source = url.searchParams.get("source") || undefined;
    const eventType = url.searchParams.get("eventType") || undefined;
    const events = service.listEvents({ limit, source, eventType });
    return jsonResponse({ events }, 200, req, {});
  }

  // 9. POST /api/agent-os/notifications/events
  if (req.method === "POST" && pathname === "/api/agent-os/notifications/events") {
    const body = await readJsonBody(req);
    try {
      const receipt = service.emitEvent(body as any);
      return jsonResponse({ receipt }, 200, req, {});
    } catch (err) {
      return badRequest(req, err instanceof Error ? err.message : String(err));
    }
  }

  // 10. POST /api/agent-os/notifications/send
  if (req.method === "POST" && pathname === "/api/agent-os/notifications/send") {
    const body = await readJsonBody(req);
    const title = typeof body.title === "string" ? body.title : "";
    if (!title.trim()) return badRequest(req, "Field 'title' is required");
    try {
      const receipt = service.send(body as any);
      return jsonResponse({ receipt }, 200, req, {});
    } catch (err) {
      return badRequest(req, err instanceof Error ? err.message : String(err));
    }
  }

  // 11. GET /api/agent-os/notifications/deliveries
  if (req.method === "GET" && pathname === "/api/agent-os/notifications/deliveries") {
    const limit = Number(url.searchParams.get("limit") || 100);
    const status = url.searchParams.get("status") || undefined;
    const destinationId = url.searchParams.get("destinationId") || undefined;
    const deliveries = service.listDeliveries({ limit, status: status as any, destinationId });
    return jsonResponse({ deliveries }, 200, req, {});
  }

  // 12. GET /api/agent-os/notifications/delivery
  if (req.method === "GET" && pathname === "/api/agent-os/notifications/delivery") {
    const id = url.searchParams.get("id");
    if (!id) return badRequest(req, "Query parameter 'id' is required");
    const record = service.getDelivery(id);
    if (!record) return notFound(req, `Delivery '${id}' not found`);
    return jsonResponse(record, 200, req, {});
  }

  // 13. POST /api/agent-os/notifications/deliveries/retry
  if (req.method === "POST" && pathname === "/api/agent-os/notifications/deliveries/retry") {
    const body = await readJsonBody(req);
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return badRequest(req, "Field 'id' is required");
    const delivery = service.retryDelivery(id);
    if (!delivery) return notFound(req, `Delivery '${id}' not found`);
    return jsonResponse({ delivery }, 200, req, {});
  }

  // 14. GET /api/agent-os/notifications/dead-letters
  if (req.method === "GET" && pathname === "/api/agent-os/notifications/dead-letters") {
    const limit = Number(url.searchParams.get("limit") || 100);
    const status = url.searchParams.get("status") || undefined;
    const deadLetters = service.listDeadLetters({ limit, status });
    return jsonResponse({ deadLetters }, 200, req, {});
  }

  // 15. POST /api/agent-os/notifications/dead-letters/retry
  if (req.method === "POST" && pathname === "/api/agent-os/notifications/dead-letters/retry") {
    const body = await readJsonBody(req);
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return badRequest(req, "Field 'id' is required");
    const deadLetter = service.retryDeadLetter(id);
    if (!deadLetter) return notFound(req, `Dead letter '${id}' not found`);
    return jsonResponse({ deadLetter }, 200, req, {});
  }

  // 16. POST /api/agent-os/notifications/dead-letters/dismiss
  if (req.method === "POST" && pathname === "/api/agent-os/notifications/dead-letters/dismiss") {
    const body = await readJsonBody(req);
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return badRequest(req, "Field 'id' is required");
    const deadLetter = service.dismissDeadLetter(id);
    if (!deadLetter) return notFound(req, `Dead letter '${id}' not found`);
    return jsonResponse({ deadLetter }, 200, req, {});
  }

  // 17. GET /api/agent-os/notifications/rate-limits
  if (req.method === "GET" && pathname === "/api/agent-os/notifications/rate-limits") {
    const data = service.listRateLimits();
    return jsonResponse(data, 200, req, {});
  }

  return null;
}
