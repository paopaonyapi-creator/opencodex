// Phase 20.24 — Pao-hubPro × OmniGet Local Media Acquisition & MCP Engine
// Management REST API Routes.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getMediaAcquisitionService } from "../../agent-os/media-acquisition";

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

export async function handleMediaRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;
  const pathname = url.pathname;
  const service = getMediaAcquisitionService();

  // 1. GET /api/agent-os/media/status
  if (req.method === "GET" && pathname === "/api/agent-os/media/status") {
    const status = service.getStatus();
    return jsonResponse({ status }, 200, req, {});
  }

  // 2. GET /api/agent-os/media/health
  if (req.method === "GET" && pathname === "/api/agent-os/media/health") {
    const health = await service.getHealth();
    return jsonResponse({ health }, 200, req, {});
  }

  // 3. GET /api/agent-os/media/providers
  if (req.method === "GET" && pathname === "/api/agent-os/media/providers") {
    const providers = service.router.listProviders().map((p) => p.name);
    return jsonResponse({ providers }, 200, req, {});
  }

  // 4. POST /api/agent-os/media/inspect
  if (req.method === "POST" && pathname === "/api/agent-os/media/inspect") {
    const body = await readJsonBody(req);
    const mediaUrl = typeof body.url === "string" ? body.url.trim() : "";
    if (!mediaUrl) return badRequest(req, "Field 'url' is required");
    try {
      const result = await service.inspect({
        url: mediaUrl,
        preferredProvider: typeof body.preferredProvider === "string" ? (body.preferredProvider as any) : undefined,
      });
      return jsonResponse({ result }, 200, req, {});
    } catch (err) {
      return badRequest(req, err instanceof Error ? err.message : String(err));
    }
  }

  // 5. POST /api/agent-os/media/jobs
  if (req.method === "POST" && pathname === "/api/agent-os/media/jobs") {
    const body = await readJsonBody(req);
    const mediaUrl = typeof body.url === "string" ? body.url.trim() : "";
    if (!mediaUrl) return badRequest(req, "Field 'url' is required");
    try {
      const job = await service.enqueueDownload({
        url: mediaUrl,
        preset: typeof body.preset === "string" ? (body.preset as any) : undefined,
        priority: typeof body.priority === "string" ? (body.priority as any) : undefined,
        usageClass: typeof body.usageClass === "string" ? (body.usageClass as any) : undefined,
        requestedBy: typeof body.requestedBy === "string" ? body.requestedBy : "dashboard",
      });
      return jsonResponse({ job }, 201, req, {});
    } catch (err) {
      return badRequest(req, err instanceof Error ? err.message : String(err));
    }
  }

  // 6. POST /api/agent-os/media/jobs/batch
  if (req.method === "POST" && pathname === "/api/agent-os/media/jobs/batch") {
    const body = await readJsonBody(req);
    const urls = Array.isArray(body.urls) ? body.urls.map(String) : [];
    if (urls.length === 0) return badRequest(req, "Field 'urls' must be a non-empty array");
    try {
      const result = await service.batchDownload({
        urls,
        preset: typeof body.preset === "string" ? (body.preset as any) : undefined,
        priority: typeof body.priority === "string" ? (body.priority as any) : undefined,
        requestedBy: typeof body.requestedBy === "string" ? body.requestedBy : "dashboard",
      });
      return jsonResponse({ result }, 201, req, {});
    } catch (err) {
      return badRequest(req, err instanceof Error ? err.message : String(err));
    }
  }

  // 7. GET /api/agent-os/media/jobs
  if (req.method === "GET" && pathname === "/api/agent-os/media/jobs") {
    const status = url.searchParams.get("status");
    const jobs = service.queue.listJobs(status ? (status as any) : undefined);
    return jsonResponse({ jobs }, 200, req, {});
  }

  // 8. GET /api/agent-os/media/job
  if (req.method === "GET" && pathname === "/api/agent-os/media/job") {
    const id = url.searchParams.get("id");
    if (!id) return badRequest(req, "Query param 'id' is required");
    const job = service.queue.getJob(id);
    if (!job) return notFound(req, `Job '${id}' not found`);
    return jsonResponse({ job }, 200, req, {});
  }

  // 9. POST /api/agent-os/media/jobs/pause
  if (req.method === "POST" && pathname === "/api/agent-os/media/jobs/pause") {
    const body = await readJsonBody(req);
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return badRequest(req, "Field 'id' is required");
    const job = service.queue.getJob(id);
    if (!job) return notFound(req, `Job '${id}' not found`);
    service.queue.updateJob(id, { status: "queued" });
    return jsonResponse({ job: service.queue.getJob(id) }, 200, req, {});
  }

  // 10. POST /api/agent-os/media/jobs/resume
  if (req.method === "POST" && pathname === "/api/agent-os/media/jobs/resume") {
    const body = await readJsonBody(req);
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return badRequest(req, "Field 'id' is required");
    const job = service.queue.getJob(id);
    if (!job) return notFound(req, `Job '${id}' not found`);
    service.queue.updateJob(id, { status: "queued" });
    return jsonResponse({ job: service.queue.getJob(id) }, 200, req, {});
  }

  // 11. POST /api/agent-os/media/jobs/cancel
  if (req.method === "POST" && pathname === "/api/agent-os/media/jobs/cancel") {
    const body = await readJsonBody(req);
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return badRequest(req, "Field 'id' is required");
    try {
      const job = service.queue.cancelJob(id);
      return jsonResponse({ job }, 200, req, {});
    } catch (err) {
      return badRequest(req, err instanceof Error ? err.message : String(err));
    }
  }

  // 12. POST /api/agent-os/media/jobs/retry
  if (req.method === "POST" && pathname === "/api/agent-os/media/jobs/retry") {
    const body = await readJsonBody(req);
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return badRequest(req, "Field 'id' is required");
    try {
      const job = service.queue.retryJob(id);
      return jsonResponse({ job }, 200, req, {});
    } catch (err) {
      return badRequest(req, err instanceof Error ? err.message : String(err));
    }
  }

  // 13. GET /api/agent-os/media/artifacts
  if (req.method === "GET" && pathname === "/api/agent-os/media/artifacts") {
    const artifacts = service.registry.listArtifacts();
    return jsonResponse({ artifacts }, 200, req, {});
  }

  // 14. GET /api/agent-os/media/metrics
  if (req.method === "GET" && pathname === "/api/agent-os/media/metrics") {
    const metrics = service.metrics.getSnapshot(service.queue.getQueueDepth());
    return jsonResponse({ metrics }, 200, req, {});
  }

  // 15. POST /api/agent-os/media/bridge/pair
  if (req.method === "POST" && pathname === "/api/agent-os/media/bridge/pair") {
    const body = await readJsonBody(req);
    const extensionId = typeof body.extensionId === "string" ? body.extensionId.trim() : "";
    const clientNonce = typeof body.clientNonce === "string" ? body.clientNonce.trim() : "";
    const timestamp = typeof body.timestamp === "number" ? body.timestamp : 0;
    if (!extensionId || !clientNonce || !timestamp) {
      return badRequest(req, "Fields 'extensionId', 'clientNonce', and 'timestamp' are required");
    }
    try {
      const response = service.bridge.pair({
        extensionId,
        extensionVersion: typeof body.extensionVersion === "string" ? body.extensionVersion : "1.0.0",
        clientNonce,
        timestamp,
      });
      return jsonResponse({ response }, 200, req, {});
    } catch (err) {
      return badRequest(req, err instanceof Error ? err.message : String(err));
    }
  }

  // 16. POST /api/agent-os/media/bridge/dispatch
  if (req.method === "POST" && pathname === "/api/agent-os/media/bridge/dispatch") {
    const body = await readJsonBody(req);
    const action = typeof body.action === "string" ? body.action : "";
    const mediaUrl = typeof body.url === "string" ? body.url.trim() : "";
    const extensionId = typeof body.extensionId === "string" ? body.extensionId : "";
    const sessionToken = typeof body.sessionToken === "string" ? body.sessionToken : "";
    if (!action || !mediaUrl || !sessionToken) {
      return badRequest(req, "Fields 'action', 'url', and 'sessionToken' are required");
    }
    try {
      service.bridge.verifyRequest({
        action: action as any,
        url: mediaUrl,
        extensionId,
        sessionToken,
        timestamp: typeof body.timestamp === "number" ? body.timestamp : Date.now(),
        signature: typeof body.signature === "string" ? body.signature : "",
      });

      if (action === "inspect") {
        const result = await service.inspect({ url: mediaUrl });
        return jsonResponse({ result }, 200, req, {});
      } else {
        const job = await service.enqueueDownload({
          url: mediaUrl,
          preset: typeof body.preset === "string" ? (body.preset as any) : undefined,
          requestedBy: `extension:${extensionId}`,
        });
        return jsonResponse({ job }, 201, req, {});
      }
    } catch (err) {
      return badRequest(req, err instanceof Error ? err.message : String(err));
    }
  }

  return null;
}
