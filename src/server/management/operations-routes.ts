// Phase 23 — Pao Autonomous Operations & Self-Healing Fleet (AOF)
// REST Management API Endpoints
// Accessible via /api/agent-os/operations/* and /api/operations/*

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import {
  getFleetManager,
  getFailoverEngine,
  getSloGovernor,
  getSwarmBus,
  type NodeStatus,
  type JobStatus,
  type NodeType,
  type JobPriority,
  type NodeHeartbeatInput,
} from "../../agent-os/operations";

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_request", message } }, 400, req, {});
}

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

export async function handleOperationsRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req } = ctx;

  let path = "";
  if (url.pathname.startsWith("/api/agent-os/operations/")) {
    path = url.pathname.slice("/api/agent-os/operations/".length);
  } else if (url.pathname === "/api/agent-os/operations") {
    path = "";
  } else if (url.pathname.startsWith("/api/operations/")) {
    path = url.pathname.slice("/api/operations/".length);
  } else if (url.pathname === "/api/operations") {
    path = "";
  } else {
    return null;
  }

  const fleetManager = getFleetManager();
  const failoverEngine = getFailoverEngine();
  const sloGovernor = getSloGovernor();
  const swarmBus = getSwarmBus();

  // 1. /fleet endpoints
  if (path === "fleet" || path === "fleet/") {
    if (req.method === "GET") {
      // Evaluate timeouts on query
      fleetManager.evaluateHealth();
      const statusFilter = url.searchParams.get("status") as NodeStatus | null;
      const nodes = fleetManager.listNodes(statusFilter ?? undefined);
      return jsonResponse({ nodes }, 200, req, {});
    }
  }

  if (path === "fleet/register" && req.method === "POST") {
    const body = (await req.json().catch(() => null)) as {
      id?: string;
      name?: string;
      nodeType?: NodeType;
      capabilities?: string[];
      endpointUrl?: string;
      maxConcurrency?: number;
      metadata?: Record<string, unknown>;
    } | null;

    if (!body?.name || !body?.nodeType || !Array.isArray(body?.capabilities)) {
      return badRequest(req, "Missing required fields: name, nodeType, capabilities");
    }

    const node = fleetManager.registerNode({
      id: body.id,
      name: body.name,
      nodeType: body.nodeType,
      capabilities: body.capabilities,
      endpointUrl: body.endpointUrl,
      maxConcurrency: body.maxConcurrency,
      metadata: body.metadata,
    });

    return jsonResponse({ node }, 201, req, {});
  }

  if (path.startsWith("fleet/")) {
    const segments = path.slice("fleet/".length).split("/");
    const id = decodeURIComponent(segments[0]);
    const action = segments[1];

    if (!action && req.method === "GET") {
      const node = fleetManager.getNode(id);
      if (!node) return notFound(req, `Node '${id}' not found`);
      return jsonResponse({ node }, 200, req, {});
    }

    if (!action && req.method === "DELETE") {
      const deleted = fleetManager.deregisterNode(id);
      return jsonResponse({ deleted }, deleted ? 200 : 404, req, {});
    }

    if (action === "heartbeat" && req.method === "POST") {
      try {
        const body = (await req.json().catch(() => ({}))) as NodeHeartbeatInput;
        const node = fleetManager.recordHeartbeat(id, body);
        return jsonResponse({ node }, 200, req, {});
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return notFound(req, msg);
      }
    }

    if (action === "drain" && req.method === "POST") {
      try {
        const node = fleetManager.drainNode(id);
        return jsonResponse({ node }, 200, req, {});
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return notFound(req, msg);
      }
    }
  }

  // 2. /jobs endpoints
  if (path === "jobs" || path === "jobs/") {
    if (req.method === "GET") {
      const statusFilter = url.searchParams.get("status") as JobStatus | null;
      const jobs = failoverEngine.listJobs(statusFilter ?? undefined);
      return jsonResponse({ jobs }, 200, req, {});
    }

    if (req.method === "POST") {
      const body = (await req.json().catch(() => null)) as {
        id?: string;
        taskType?: string;
        priority?: JobPriority;
        payload?: Record<string, unknown>;
        requiredCapabilities?: string[];
        maxRetries?: number;
        autoDispatch?: boolean;
      } | null;

      if (!body?.taskType || !body?.payload) {
        return badRequest(req, "Missing required fields: taskType, payload");
      }

      const job = failoverEngine.enqueueJob({
        id: body.id,
        taskType: body.taskType,
        priority: body.priority,
        payload: body.payload,
        requiredCapabilities: body.requiredCapabilities,
        maxRetries: body.maxRetries,
      });

      let dispatchResult = null;
      if (body.autoDispatch !== false) {
        dispatchResult = failoverEngine.dispatchJob(job.id);
      }

      return jsonResponse({ job, dispatched: dispatchResult?.dispatched ?? false }, 201, req, {});
    }
  }

  if (path.startsWith("jobs/")) {
    const segments = path.slice("jobs/".length).split("/");
    const id = decodeURIComponent(segments[0]);
    const action = segments[1];

    const job = failoverEngine.getJob(id);
    if (!job) return notFound(req, `Job '${id}' not found`);

    if (!action && req.method === "GET") {
      return jsonResponse({ job }, 200, req, {});
    }

    if (action === "dispatch" && req.method === "POST") {
      const result = failoverEngine.dispatchJob(id);
      return jsonResponse(result, 200, req, {});
    }

    if (action === "checkpoint" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const updated = failoverEngine.updateCheckpoint(id, body);
      return jsonResponse({ job: updated }, 200, req, {});
    }

    if (action === "complete" && req.method === "POST") {
      const updated = failoverEngine.completeJob(id);
      sloGovernor.recordRequest(true);
      return jsonResponse({ job: updated }, 200, req, {});
    }

    if (action === "fail" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { error?: string };
      const updated = failoverEngine.failJob(id, body.error ?? "Job execution failed");
      sloGovernor.recordRequest(false);
      return jsonResponse({ job: updated }, 200, req, {});
    }
  }

  // 3. /slo endpoints
  if (path === "slo" || path === "slo/") {
    if (req.method === "GET") {
      const metrics = sloGovernor.getMetrics();
      return jsonResponse({ metrics }, 200, req, {});
    }

    if (req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        success?: boolean;
        latencyMs?: number;
      };
      sloGovernor.recordRequest(body.success ?? true, body.latencyMs ?? 120);
      return jsonResponse({ metrics: sloGovernor.getMetrics() }, 200, req, {});
    }
  }

  // 4. /failovers endpoint
  if (path === "failovers" || path === "failovers/") {
    if (req.method === "GET") {
      const events = failoverEngine.listFailoverEvents();
      return jsonResponse({ events }, 200, req, {});
    }
  }

  if (path === "failover/trigger" && req.method === "POST") {
    const body = (await req.json().catch(() => null)) as {
      nodeId?: string;
      reason?: string;
    } | null;

    if (!body?.nodeId) {
      return badRequest(req, "nodeId is required");
    }

    const event = failoverEngine.triggerFailover(body.nodeId, body.reason ?? "Manual operator failover triggered");
    return jsonResponse({ event }, 200, req, {});
  }

  // 5. /swarm endpoints
  if (path === "swarm/messages" && req.method === "GET") {
    const topic = url.searchParams.get("topic") ?? undefined;
    const limit = Number(url.searchParams.get("limit") ?? "50");
    const messages = swarmBus.getRecentMessages(topic, limit);
    return jsonResponse({ messages }, 200, req, {});
  }

  if (path === "swarm/publish" && req.method === "POST") {
    const body = (await req.json().catch(() => null)) as {
      topic?: string;
      senderAgentId?: string;
      payload?: Record<string, unknown>;
      correlationId?: string;
    } | null;

    if (!body?.topic || !body?.senderAgentId || !body?.payload) {
      return badRequest(req, "Missing required fields: topic, senderAgentId, payload");
    }

    const message = swarmBus.publish(body.topic, body.senderAgentId, body.payload, body.correlationId);
    return jsonResponse({ message }, 201, req, {});
  }

  return notFound(req, `Unknown operations route: /${path}`);
}
