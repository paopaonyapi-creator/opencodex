// Canonical MCP Tools for Phase 20.12 Pao-hubPro × Google ARTEMIS Mobile Agent Gateway

import { getMobileDeviceRegistry } from "./device-registry";
import { getMobileTaskManager } from "./task-manager";
import { getArtemisProvider } from "./artemis-adapter";
import { getMobileConfig } from "./config";
import type { TaskProfile, VerificationLevel } from "./types";

export interface MobileToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: any) => Promise<any>;
}

export function createMobileMcpTools(): MobileToolDefinition[] {
  const registry = getMobileDeviceRegistry();
  const taskManager = getMobileTaskManager();
  const provider = getArtemisProvider();

  return [
    {
      name: "pao_mobile_list_devices",
      description: "Lists all registered Android mobile devices, emulators, trust levels, and availability.",
      parameters: {
        type: "object",
        properties: {},
      },
      handler: async () => {
        const config = getMobileConfig();
        if (!config.enabled) {
          return { error: "Pao-hubPro Mobile Subsystem is disabled via feature flag" };
        }
        const devices = registry.listDevices();
        return {
          devices: devices.map((d) => ({
            id: d.id,
            alias: d.alias,
            deviceType: d.deviceType,
            trustLevel: d.trustLevel,
            status: d.status,
            allowAgent: d.allowAgent,
            requiresApproval: d.requiresApproval,
            labels: d.labels,
            maskedSerial: registry.maskSerial(d.providerDeviceId),
            lastSeenAt: d.lastSeenAt,
          })),
        };
      },
    },

    {
      name: "pao_mobile_get_device",
      description: "Gets detailed configuration, status, and health for a specific device by ID or alias.",
      parameters: {
        type: "object",
        properties: {
          deviceId: { type: "string", description: "Device ID or logical alias (e.g. android-test-01)" },
        },
        required: ["deviceId"],
      },
      handler: async (args: { deviceId: string }) => {
        const device = registry.getDevice(args.deviceId);
        if (!device) {
          return { error: `Device ${args.deviceId} not found` };
        }
        return {
          device: {
            ...device,
            maskedSerial: registry.maskSerial(device.providerDeviceId),
          },
        };
      },
    },

    {
      name: "pao_mobile_run_task",
      description: "Executes an Android automation task on a target device with risk classification (R0-R4), policy checks, and profile routing (Flash/Pro).",
      parameters: {
        type: "object",
        properties: {
          goal: { type: "string", description: "Goal or instructions for the mobile task" },
          deviceId: { type: "string", description: "Optional device ID or logical alias (defaults to ready test emulator)" },
          profile: { type: "string", enum: ["auto", "flash", "pro"], description: "Execution profile (auto, flash, pro)" },
          verificationLevel: { type: "string", enum: ["off", "final", "checkpoints", "strict"], description: "Verification rigor level" },
          timeoutSec: { type: "number", description: "Execution timeout in seconds" },
        },
        required: ["goal"],
      },
      handler: async (args: {
        goal: string;
        deviceId?: string;
        profile?: TaskProfile;
        verificationLevel?: VerificationLevel;
        timeoutSec?: number;
      }) => {
        try {
          const task = await taskManager.runTask({
            goal: args.goal,
            deviceId: args.deviceId,
            profile: args.profile,
            verificationLevel: args.verificationLevel,
            timeoutSec: args.timeoutSec,
            requestedByType: "agent",
            requestedById: "mcp_caller",
          });

          return {
            taskId: task.id,
            deviceId: task.deviceId,
            goal: task.goal,
            status: task.status,
            riskLevel: task.riskLevel,
            profile: task.profile,
            resolvedProfile: task.resolvedProfile,
            traceId: task.traceId,
            resultSummary: task.resultSummary,
            errorMessage: task.errorMessage,
          };
        } catch (err: any) {
          return { error: err.message };
        }
      },
    },

    {
      name: "pao_mobile_manage_task",
      description: "Controls an active or pending mobile task (status, stop, inject, approve, reject).",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Task ID (mtask_...)" },
          action: {
            type: "string",
            enum: ["status", "stop", "inject", "approve", "reject"],
            description: "Management action to perform",
          },
          instruction: { type: "string", description: "Instruction payload for inject action" },
          reason: { type: "string", description: "Rejection reason if action is reject" },
        },
        required: ["taskId", "action"],
      },
      handler: async (args: {
        taskId: string;
        action: "status" | "stop" | "inject" | "approve" | "reject";
        instruction?: string;
        reason?: string;
      }) => {
        const task = taskManager.getTask(args.taskId);
        if (!task) return { error: `Task ${args.taskId} not found` };

        if (args.action === "status") {
          return { task };
        }

        if (args.action === "stop") {
          const stopped = await taskManager.stopTask(args.taskId);
          return { success: stopped, status: "CANCELLED" };
        }

        if (args.action === "inject") {
          if (!args.instruction) return { error: "Instruction required for inject action" };
          const injected = await taskManager.injectInstruction(args.taskId, args.instruction);
          return { success: injected };
        }

        if (args.action === "approve") {
          try {
            const resumedTask = await taskManager.approveTask(args.taskId, "mcp_operator");
            return { success: true, task: resumedTask };
          } catch (err: any) {
            return { error: err.message };
          }
        }

        if (args.action === "reject") {
          const rejectedTask = await taskManager.rejectTask(args.taskId, "mcp_operator", args.reason);
          return { success: true, task: rejectedTask };
        }

        return { error: `Unsupported action: ${args.action}` };
      },
    },

    {
      name: "pao_mobile_get_device_state",
      description: "Captures live device observation: screen dimensions, foreground app, UI hierarchy, and screenshot base64.",
      parameters: {
        type: "object",
        properties: {
          deviceId: { type: "string", description: "Device ID or alias" },
        },
        required: ["deviceId"],
      },
      handler: async (args: { deviceId: string }) => {
        const device = registry.getDevice(args.deviceId);
        if (!device) return { error: `Device ${args.deviceId} not found` };
        const state = await provider.getDeviceState(device.providerDeviceId);
        return {
          state: {
            ...state,
            deviceId: device.id,
            alias: device.alias,
          },
        };
      },
    },

    {
      name: "pao_mobile_inspect_trace",
      description: "Retrieves complete action step trace, before/after screenshots, and checker evaluations for a mobile task.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Mobile task ID" },
        },
        required: ["taskId"],
      },
      handler: async (args: { taskId: string }) => {
        const trace = await taskManager.getTrace(args.taskId);
        if (!trace) return { error: `Trace for task ${args.taskId} not found` };
        return { trace };
      },
    },
  ];
}
