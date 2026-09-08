// Phase 20.14 — Pao-hubPro Browser Remote Worker REST API Routes
//
// Endpoints mounted under /api/browser/remote/* and /api/agent-os/browser/remote/*
// Exposes fleet health, worker node registration, heartbeat leases, job dispatches,
// and distributed browser execution status.

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getRemoteWorkerRegistry } from "../../agent-os/browser/remote/worker-registry";
import { getFleetDispatcher } from "../../agent-os/browser/remote/fleet-dispatcher";
import type { JobType, WorkerStatus } from "../../agent-os/browser/remote/types";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_request", message } }, 400, req, {});
}

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

export async function handleRemoteWorkerRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;

  let path = "";
  if (url.pathname.startsWith("/api/browser/remote/")) {
    path = url.pathname.slice("/api/browser/remote/".length);
  } else if (url.pathname === "/api/browser/remote") {
    path = "";
  } else if (url.pathname.startsWith("/api/agent-os/browser/remote/")) {
    path = url.pathname.slice("/api/agent-os/browser/remote/".length);
  } else if (url.pathname === "/api/agent-os/browser/remote") {
    path = "";
  } else {
    return null;
  }

  const registry = getRemoteWorkerRegistry();
  const dispatcher = getFleetDispatcher();

  // 1. GET /api/browser/remote/fleet or /api/browser/remote
  if (path === "" || path === "fleet") {
    if (req.method === "GET") {
      const fleet = registry.getFleetStatus();
      return jsonResponse({ fleet }, 200, req, {});
    }
    return null;
  }

  // 2. GET /api/browser/remote/workers & POST /api/browser/remote/workers
  if (path === "workers") {
    if (req.method === "GET") {
      const status = (url.searchParams.get("status") as WorkerStatus) || undefined;
      const geoRegion = url.searchParams.get("geoRegion") || undefined;
      const workers = registry.listWorkers({ status, geoRegion });
      return jsonResponse({ workers }, 200, req, {});
    }

    if (req.method === "POST") {
      let body: any;
      try {
        body = await req.json();
      } catch {
        return badRequest(req, "Invalid JSON body");
      }

      if (!body.name || !body.endpointUrl) {
        return badRequest(req, "Missing required fields: 'name', 'endpointUrl'");
      }

      const result = registry.registerWorker({
        id: body.id,
        name: body.name,
        endpointUrl: body.endpointUrl,
        authToken: body.authToken,
        geoRegion: body.geoRegion,
        maxConcurrentJobs: body.maxConcurrentJobs,
        capabilities: body.capabilities,
      });

      dispatcher.registerWorkerToken(result.worker.id, result.rawToken);
      return jsonResponse({ success: true, worker: result.worker, authToken: result.rawToken }, 201, req, {});
    }

    return null;
  }

  // 3. POST /api/browser/remote/dispatch
  if (path === "dispatch" && req.method === "POST") {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return badRequest(req, "Invalid JSON body");
    }

    if (!body.method || !body.params) {
      return badRequest(req, "Missing required fields: 'method', 'params'");
    }

    try {
      const result = await dispatcher.dispatchJob({
        jobType: (body.jobType as JobType) || "action",
        method: body.method,
        params: body.params,
        targetDomain: body.targetDomain,
        geoRegion: body.geoRegion,
        targetWorkerId: body.targetWorkerId,
        authToken: body.authToken,
      });

      return jsonResponse({ success: true, ...result }, 200, req, {});
    } catch (err: any) {
      return badRequest(req, err.message);
    }
  }

  // 4. GET /api/browser/remote/jobs
  if (path === "jobs") {
    if (req.method === "GET") {
      const workerId = url.searchParams.get("workerId") || undefined;
      const status = (url.searchParams.get("status") as any) || undefined;
      const limit = Number(url.searchParams.get("limit") || "50");
      const jobs = dispatcher.listJobs({ workerId, status, limit });
      return jsonResponse({ jobs }, 200, req, {});
    }
    return null;
  }

  // Parse path segments: /workers/:id, /workers/:id/heartbeat, /workers/:id/drain, /jobs/:id
  const parts = path.split("/");

  // /workers/:id or /workers/:id/action
  if (parts[0] === "workers" && parts.length >= 2) {
    const workerId = parts[1];

    if (parts.length === 2) {
      if (req.method === "GET") {
        const worker = registry.getWorker(workerId);
        if (!worker) return notFound(req, `Worker '${workerId}' not found`);
        return jsonResponse({ worker }, 200, req, {});
      }

      if (req.method === "DELETE") {
        const deleted = registry.deleteWorker(workerId);
        return jsonResponse({ success: deleted, id: workerId }, 200, req, {});
      }
    }

    if (parts.length === 3) {
      const action = parts[2];

      if (action === "heartbeat" && req.method === "POST") {
        let body: any = {};
        try {
          body = await req.json();
        } catch {
          // empty body acceptable
        }
        const success = registry.heartbeat(workerId, body.status, body.activeJobs);
        return jsonResponse({ success, id: workerId }, 200, req, {});
      }

      if (action === "drain" && req.method === "POST") {
        const success = registry.drainWorker(workerId);
        return jsonResponse({ success, id: workerId }, 200, req, {});
      }
    }
  }

  // /jobs/:id
  if (parts[0] === "jobs" && parts.length === 2) {
    const jobId = parts[1];
    if (req.method === "GET") {
      const job = dispatcher.getJob(jobId);
      if (!job) return notFound(req, `Job '${jobId}' not found`);
      return jsonResponse({ job }, 200, req, {});
    }
  }

  return null;
}
