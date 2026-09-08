// Phase 20.14 — Pao-hubPro Browser Remote Worker MCP Tools
//
// 10 Canonical `browser.remote.*` MCP tools allowing AI models
// (Codex, Claude, ChatGPT, Local AI) to register, monitor, and dispatch
// tasks to distributed browser worker nodes on VPS, Cloud VMs, and RunPod.

import type { McpToolDefinition } from "../mcp-tools";
import { getFleetDispatcher } from "./fleet-dispatcher";
import { getRemoteWorkerRegistry } from "./worker-registry";
import type { JobType, WorkerStatus } from "./types";

export function getRemoteWorkerMcpTools(): McpToolDefinition[] {
  const registry = getRemoteWorkerRegistry();
  const dispatcher = getFleetDispatcher();

  return [
    {
      name: "browser.remote.worker.register",
      description: "Registers a new remote browser worker node on VPS, Cloud VM, or RunPod instance.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Optional explicit worker ID" },
          name: { type: "string", description: "Human-readable worker name" },
          endpointUrl: { type: "string", description: "Worker HTTP endpoint URL (e.g. http://10.0.0.5:18090)" },
          authToken: { type: "string", description: "Secret token for authenticating RPC calls" },
          geoRegion: { type: "string", description: "Geographic region (e.g. us-east, eu-west, global)" },
          maxConcurrentJobs: { type: "number", description: "Maximum concurrent jobs", default: 3 },
          capabilities: { type: "object", description: "Worker hardware/browser capabilities" },
        },
        required: ["name", "endpointUrl"],
      },
      handler: (args: any) => {
        const result = registry.registerWorker(args);
        // Cache token in dispatcher for seamless dispatching
        dispatcher.registerWorkerToken(result.worker.id, result.rawToken);
        return {
          worker: result.worker,
          authToken: result.rawToken,
        };
      },
    },
    {
      name: "browser.remote.worker.list",
      description: "Lists registered remote browser workers with optional status and region filters.",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["online", "busy", "draining", "offline"] },
          geoRegion: { type: "string", description: "Filter by geographic region" },
        },
      },
      handler: (args: { status?: WorkerStatus; geoRegion?: string }) => ({
        workers: registry.listWorkers(args),
      }),
    },
    {
      name: "browser.remote.worker.get",
      description: "Retrieves status and configuration details for a specific remote worker node.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Worker ID" },
        },
        required: ["id"],
      },
      handler: (args: { id: string }) => {
        const worker = registry.getWorker(args.id);
        if (!worker) return { error: `Worker '${args.id}' not found` };
        return { worker };
      },
    },
    {
      name: "browser.remote.worker.heartbeat",
      description: "Sends a heartbeat ping from a remote worker node to renew its active lease.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Worker ID" },
          status: { type: "string", enum: ["online", "busy", "draining", "offline"] },
          activeJobs: { type: "number", description: "Current active jobs count" },
        },
        required: ["id"],
      },
      handler: (args: { id: string; status?: WorkerStatus; activeJobs?: number }) => ({
        success: registry.heartbeat(args.id, args.status, args.activeJobs),
      }),
    },
    {
      name: "browser.remote.worker.drain",
      description: "Puts a remote worker into draining mode so it finishes existing jobs but takes no new ones.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Worker ID" },
        },
        required: ["id"],
      },
      handler: (args: { id: string }) => ({
        success: registry.drainWorker(args.id),
      }),
    },
    {
      name: "browser.remote.worker.delete",
      description: "Unregisters and removes a remote browser worker from the fleet.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Worker ID" },
        },
        required: ["id"],
      },
      handler: (args: { id: string }) => ({
        success: registry.deleteWorker(args.id),
      }),
    },
    {
      name: "browser.remote.dispatch",
      description: "Dispatches a browser command, workflow, or multi-agent mission to a remote worker node.",
      inputSchema: {
        type: "object",
        properties: {
          jobType: { type: "string", enum: ["action", "workflow", "mission"], default: "action" },
          method: { type: "string", description: "RPC method (e.g. browser.navigate, browser.snapshot, browser.workflow.run)" },
          params: { type: "object", description: "Method arguments" },
          targetDomain: { type: "string", description: "Target website domain" },
          geoRegion: { type: "string", description: "Preferred worker geographic region" },
          targetWorkerId: { type: "string", description: "Explicit worker node ID (optional)" },
          authToken: { type: "string", description: "Explicit auth token (optional if registered)" },
        },
        required: ["method", "params"],
      },
      handler: async (args: {
        jobType?: JobType;
        method: string;
        params: Record<string, unknown>;
        targetDomain?: string;
        geoRegion?: string;
        targetWorkerId?: string;
        authToken?: string;
      }) => {
        const res = await dispatcher.dispatchJob({
          jobType: args.jobType || "action",
          method: args.method,
          params: args.params,
          targetDomain: args.targetDomain,
          geoRegion: args.geoRegion,
          targetWorkerId: args.targetWorkerId,
          authToken: args.authToken,
        });
        return res;
      },
    },
    {
      name: "browser.remote.job.get",
      description: "Checks execution status, duration, and output results of a dispatched remote job.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Job dispatch ID" },
        },
        required: ["id"],
      },
      handler: (args: { id: string }) => {
        const job = dispatcher.getJob(args.id);
        if (!job) return { error: `Job '${args.id}' not found` };
        return { job };
      },
    },
    {
      name: "browser.remote.job.list",
      description: "Lists dispatched remote browser jobs with optional worker and status filters.",
      inputSchema: {
        type: "object",
        properties: {
          workerId: { type: "string", description: "Filter by worker ID" },
          status: {
            type: "string",
            enum: ["pending", "dispatched", "running", "completed", "failed", "cancelled"],
          },
          limit: { type: "number", default: 50 },
        },
      },
      handler: (args: any) => ({
        jobs: dispatcher.listJobs(args),
      }),
    },
    {
      name: "browser.remote.fleet.status",
      description: "Returns aggregated health, capacity, active jobs, and regional breakdown across the remote fleet.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      handler: () => ({
        fleet: registry.getFleetStatus(),
      }),
    },
  ];
}
