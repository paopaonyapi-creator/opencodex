// Mobile Agent Gateway — Management API Routes
// Phase 20.12 Pao-hubPro × Google ARTEMIS Mobile Agent Gateway

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { getMobileDeviceRegistry } from "../../agent-os/mobile/device-registry";
import { getMobileTaskManager } from "../../agent-os/mobile/task-manager";
import { getArtemisProvider } from "../../agent-os/mobile/artemis-adapter";
import { getMobileConfig } from "../../agent-os/mobile/config";
import type { RegisterDeviceInput, RunTaskInput } from "../../agent-os/mobile/types";

function notFound(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "not_found", message } }, 404, req, {});
}

function badRequest(req: Request, message: string): Response {
  return jsonResponse({ error: { code: "invalid_body", message } }, 400, req, {});
}

export async function handleMobileRoutes(
  ctx: ManagementContext,
): Promise<Response | null> {
  const { url, req } = ctx;

  let subPath = "";
  if (url.pathname.startsWith("/api/mobile/")) {
    subPath = url.pathname.slice("/api/mobile/".length);
  } else if (url.pathname.startsWith("/api/agent-os/mobile/")) {
    subPath = url.pathname.slice("/api/agent-os/mobile/".length);
  } else if (url.pathname === "/api/mobile" || url.pathname === "/api/agent-os/mobile") {
    subPath = "";
  } else {
    return null;
  }

  const config = getMobileConfig();
  const registry = getMobileDeviceRegistry();
  const taskManager = getMobileTaskManager();
  const provider = getArtemisProvider();

  // GET /api/mobile/health
  if (req.method === "GET" && subPath === "health") {
    const devices = registry.listDevices();
    return jsonResponse(
      {
        ok: true,
        enabled: config.enabled,
        provider: config.provider,
        devicesCount: devices.length,
        readyDevicesCount: devices.filter((d) => d.status === "ready").length,
        defaults: {
          profile: config.defaultProfile,
          verification: config.defaultVerification,
          allowPhysical: config.allowPhysical,
        },
      },
      200,
      req,
      {},
    );
  }

  // GET /api/mobile/provider/health
  if (req.method === "GET" && subPath === "provider/health") {
    const health = await provider.health();
    return jsonResponse(health, health.ok ? 200 : 503, req, {});
  }

  // GET /api/mobile/devices
  if (req.method === "GET" && subPath === "devices") {
    const devices = registry.listDevices();
    return jsonResponse(
      {
        devices: devices.map((d) => ({
          ...d,
          maskedSerial: registry.maskSerial(d.providerDeviceId),
        })),
      },
      200,
      req,
      {},
    );
  }

  // POST /api/mobile/devices
  if (req.method === "POST" && subPath === "devices") {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return badRequest(req, "Invalid JSON body");
    }

    if (!body.alias || typeof body.alias !== "string") {
      return badRequest(req, "alias is required");
    }
    if (!body.providerDeviceId || typeof body.providerDeviceId !== "string") {
      return badRequest(req, "providerDeviceId is required");
    }

    const device = registry.registerDevice(body as unknown as RegisterDeviceInput);
    return jsonResponse(
      {
        device: {
          ...device,
          maskedSerial: registry.maskSerial(device.providerDeviceId),
        },
      },
      201,
      req,
      {},
    );
  }

  // Single Device Routes: /api/mobile/devices/:id/*
  if (subPath.startsWith("devices/")) {
    const rest = subPath.slice("devices/".length);
    const slashIdx = rest.indexOf("/");
    const deviceId = slashIdx >= 0 ? rest.slice(0, slashIdx) : rest;
    const action = slashIdx >= 0 ? rest.slice(slashIdx + 1) : "";

    const device = registry.getDevice(deviceId);
    if (!device) {
      return notFound(req, `Device ${deviceId} not found`);
    }

    // GET /api/mobile/devices/:id
    if (req.method === "GET" && action === "") {
      return jsonResponse(
        {
          device: {
            ...device,
            maskedSerial: registry.maskSerial(device.providerDeviceId),
          },
        },
        200,
        req,
        {},
      );
    }

    // POST /api/mobile/devices/:id/enable
    if (req.method === "POST" && action === "enable") {
      registry.setAgentAccess(device.id, true);
      return jsonResponse({ success: true, allowAgent: true }, 200, req, {});
    }

    // POST /api/mobile/devices/:id/disable
    if (req.method === "POST" && action === "disable") {
      registry.setAgentAccess(device.id, false);
      return jsonResponse({ success: true, allowAgent: false }, 200, req, {});
    }

    // GET /api/mobile/devices/:id/state
    if (req.method === "GET" && action === "state") {
      const state = await provider.getDeviceState(device.providerDeviceId);
      return jsonResponse({ state: { ...state, deviceId: device.id, alias: device.alias } }, 200, req, {});
    }
  }

  // GET /api/mobile/tasks
  if (req.method === "GET" && subPath === "tasks") {
    const tasks = taskManager.listTasks(100);
    return jsonResponse({ tasks }, 200, req, {});
  }

  // POST /api/mobile/tasks
  if (req.method === "POST" && subPath === "tasks") {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return badRequest(req, "Invalid JSON body");
    }

    if (!body.goal || typeof body.goal !== "string") {
      return badRequest(req, "goal is required");
    }

    try {
      const task = await taskManager.runTask({
        goal: body.goal.trim(),
        deviceId: typeof body.deviceId === "string" ? body.deviceId : undefined,
        profile: typeof body.profile === "string" ? (body.profile as any) : undefined,
        verificationLevel: typeof body.verificationLevel === "string" ? (body.verificationLevel as any) : undefined,
        timeoutSec: typeof body.timeoutSec === "number" ? body.timeoutSec : undefined,
        requestedByType: "api",
        requestedById: "dashboard",
      });

      return jsonResponse({ task }, task.status === "BLOCKED_BY_POLICY" ? 403 : 201, req, {});
    } catch (err: any) {
      return jsonResponse({ error: { code: "task_error", message: err.message } }, 500, req, {});
    }
  }

  // Single Task Routes: /api/mobile/tasks/:id/*
  if (subPath.startsWith("tasks/")) {
    const rest = subPath.slice("tasks/".length);
    const slashIdx = rest.indexOf("/");
    const taskId = slashIdx >= 0 ? rest.slice(0, slashIdx) : rest;
    const action = slashIdx >= 0 ? rest.slice(slashIdx + 1) : "";

    const task = taskManager.getTask(taskId);
    if (!task) {
      return notFound(req, `Task ${taskId} not found`);
    }

    // GET /api/mobile/tasks/:id
    if (req.method === "GET" && action === "") {
      return jsonResponse({ task }, 200, req, {});
    }

    // POST /api/mobile/tasks/:id/stop
    if (req.method === "POST" && action === "stop") {
      const stopped = await taskManager.stopTask(task.id);
      return jsonResponse({ success: stopped, status: "CANCELLED" }, 200, req, {});
    }

    // POST /api/mobile/tasks/:id/inject
    if (req.method === "POST" && action === "inject") {
      let body: Record<string, unknown> = {};
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        return badRequest(req, "Invalid JSON body");
      }
      if (!body.instruction || typeof body.instruction !== "string") {
        return badRequest(req, "instruction is required");
      }
      const injected = await taskManager.injectInstruction(task.id, body.instruction);
      return jsonResponse({ success: injected }, 200, req, {});
    }

    // GET /api/mobile/tasks/:id/trace
    if (req.method === "GET" && action === "trace") {
      const trace = await taskManager.getTrace(task.id);
      return jsonResponse({ trace }, 200, req, {});
    }

    // GET /api/mobile/tasks/:id/artifacts
    if (req.method === "GET" && action === "artifacts") {
      const artifacts = taskManager.getTaskArtifacts(task.id);
      return jsonResponse({ artifacts }, 200, req, {});
    }

    // GET /api/mobile/tasks/:id/events
    if (req.method === "GET" && action === "events") {
      const events = taskManager.getTaskEvents(task.id);
      return jsonResponse({ events }, 200, req, {});
    }

    // POST /api/mobile/tasks/:id/approve
    if (req.method === "POST" && action === "approve") {
      try {
        const approvedTask = await taskManager.approveTask(task.id, "dashboard_operator");
        return jsonResponse({ task: approvedTask }, 200, req, {});
      } catch (err: any) {
        return badRequest(req, err.message);
      }
    }

    // POST /api/mobile/tasks/:id/reject
    if (req.method === "POST" && action === "reject") {
      let body: Record<string, unknown> = {};
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        // empty body ok
      }
      const reason = typeof body.reason === "string" ? body.reason : "Operator rejected";
      const rejectedTask = await taskManager.rejectTask(task.id, "dashboard_operator", reason);
      return jsonResponse({ task: rejectedTask }, 200, req, {});
    }
  }

  return null;
}
