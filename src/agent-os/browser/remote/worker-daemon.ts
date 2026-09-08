// Phase 20.14 — Standalone Remote Browser Worker Daemon
//
// Standalone HTTP server process that runs on remote instances (VPS, Cloud VM, RunPod)
// and handles authenticated RPC execution against local BrowserBridge.

import { openAgentOsDb } from "../../db";
import { getBrowserBridge } from "../bridge/browser-bridge";
import { UploadWebAgent } from "../multi-agent/agents/upload-agent";
import { getWorkflowExecutor } from "../workflow/executor";
import { getBrowserMultiAgentCoordinator } from "../multi-agent/coordinator";
import type { RemoteRpcRequest, RemoteRpcResponse, WorkerCapabilities } from "./types";

export interface WorkerDaemonOptions {
  port: number;
  workerId: string;
  authToken: string;
  hubUrl?: string;
  geoRegion?: string;
  maxConcurrentJobs?: number;
  capabilities?: Partial<WorkerCapabilities>;
}

export class RemoteWorkerDaemon {
  public readonly workerId: string;
  public readonly port: number;
  private authToken: string;
  private hubUrl?: string;
  private geoRegion: string;
  private maxConcurrentJobs: number;
  private capabilities: WorkerCapabilities;
  private activeJobs = 0;
  private server: ReturnType<typeof Bun.serve> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private startedAt = Date.now();

  constructor(options: WorkerDaemonOptions) {
    this.workerId = options.workerId;
    this.port = options.port;
    this.authToken = options.authToken;
    this.hubUrl = options.hubUrl?.replace(/\/$/, "");
    this.geoRegion = options.geoRegion || "global";
    this.maxConcurrentJobs = options.maxConcurrentJobs || 3;
    this.capabilities = {
      headless: options.capabilities?.headless ?? true,
      headed: options.capabilities?.headed ?? false,
      os: options.capabilities?.os || process.platform,
      proxy: options.capabilities?.proxy,
      tags: options.capabilities?.tags || [],
      browserVersion: options.capabilities?.browserVersion || "1.0.0",
      platform: "pao-browser-remote-daemon",
    };
  }

  /**
   * Starts the worker HTTP server and heartbeat loop.
   */
  public async start(): Promise<void> {
    if (this.server) return;

    this.server = Bun.serve({
      port: this.port,
      fetch: async (req: Request) => this.handleRequest(req),
    });

    this.startedAt = Date.now();

    // Start heartbeat timer if hubUrl is provided
    if (this.hubUrl) {
      await this.sendHeartbeatToHub();
      this.heartbeatTimer = setInterval(() => {
        void this.sendHeartbeatToHub();
      }, 20000);
    }
  }

  /**
   * Stops the worker HTTP server and heartbeat loop.
   */
  public async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.server) {
      this.server.stop();
      this.server = null;
    }
  }

  /**
   * Dispatches periodic heartbeats back to central Pao-hubPro hub.
   */
  public async sendHeartbeatToHub(): Promise<boolean> {
    if (!this.hubUrl) return false;
    try {
      const res = await fetch(
        `${this.hubUrl}/api/browser/remote/workers/${this.workerId}/heartbeat`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.authToken}`,
          },
          body: JSON.stringify({
            status: this.activeJobs >= this.maxConcurrentJobs ? "busy" : "online",
            activeJobs: this.activeJobs,
          }),
        },
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Main HTTP request router for daemon.
   */
  public async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // 1. Health check
    if (url.pathname === "/healthz") {
      return Response.json({
        status: "ok",
        workerId: this.workerId,
        uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      });
    }

    // 2. Status inspection
    if (url.pathname === "/status") {
      const bridge = getBrowserBridge();
      return Response.json({
        workerId: this.workerId,
        geoRegion: this.geoRegion,
        activeJobs: this.activeJobs,
        maxConcurrentJobs: this.maxConcurrentJobs,
        capabilities: this.capabilities,
        browserStatus: bridge.getStatus(),
      });
    }

    // 3. Authenticated RPC endpoint
    if (url.pathname === "/rpc" && req.method === "POST") {
      // Check auth header
      const auth = req.headers.get("authorization");
      if (!auth || !auth.startsWith("Bearer ") || auth.slice(7) !== this.authToken) {
        return Response.json({ error: "UNAUTHORIZED_RPC_ACCESS" }, { status: 401 });
      }

      let rpcReq: RemoteRpcRequest;
      try {
        rpcReq = (await req.json()) as RemoteRpcRequest;
      } catch {
        return Response.json({ error: "INVALID_JSON_BODY" }, { status: 400 });
      }

      const start = Date.now();
      this.activeJobs++;

      try {
        const result = await this.executeRpcMethod(rpcReq.method, rpcReq.params || {});
        const durationMs = Date.now() - start;
        return Response.json({
          id: rpcReq.id,
          success: true,
          data: result,
          durationMs,
        });
      } catch (err: any) {
        const durationMs = Date.now() - start;
        return Response.json(
          {
            id: rpcReq.id,
            success: false,
            error: err.message,
            durationMs,
          },
          { status: 500 },
        );
      } finally {
        this.activeJobs = Math.max(0, this.activeJobs - 1);
      }
    }

    return new Response("Not Found", { status: 404 });
  }

  /**
   * Executes RPC commands locally on the worker node.
   */
  private async executeRpcMethod(method: string, params: Record<string, any>): Promise<any> {
    const bridge = getBrowserBridge();

    switch (method) {
      case "browser.status":
        return bridge.getStatus();

      case "browser.list_tabs":
        return bridge.listTabs();

      case "browser.new_tab":
        return bridge.newTab(params.url);

      case "browser.close_tab":
        return bridge.closeTab(params.tabId);

      case "browser.navigate":
        return await bridge.navigate(params.url, params.tabId);

      case "browser.read_page":
        return bridge.readPage(params.tabId);

      case "browser.snapshot":
        return bridge.getSnapshot(params.tabId);

      case "browser.screenshot":
        return await bridge.captureScreenshot(params.tabId);

      case "browser.click":
        return await bridge.executeAction({
          tool: "browser.click",
          target: params.target,
          tabId: params.tabId,
        });

      case "browser.type":
        return await bridge.executeAction({
          tool: "browser.type",
          target: params.target,
          text: params.text,
          tabId: params.tabId,
        });

      case "browser.upload": {
        const uploadAgent = new UploadWebAgent();
        return await uploadAgent.executeUpload(
          params.filePaths,
          params.targetSelector,
          params.tabId,
        );
      }

      case "browser.workflow.run": {
        const executor = getWorkflowExecutor();
        if (params.workflow) {
          return await executor.runWorkflow(params.workflow, params.parameters, {
            runId: params.runId,
            resumeFromStep: params.resumeFromStep,
          });
        }
        const db = openAgentOsDb();
        const row = db.query("SELECT * FROM browser_workflows WHERE id = ?").get(params.workflowId) as any;
        if (!row) throw new Error(`Workflow '${params.workflowId}' not found`);
        const wf = {
          id: row.id,
          name: row.name,
          description: row.description,
          version: row.version,
          steps: JSON.parse(row.dsl_json || "[]"),
          parameters: JSON.parse(row.parameters_schema_json || "{}"),
          tags: JSON.parse(row.tags_json || "[]"),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
        return await executor.runWorkflow(wf, params.parameters, {
          runId: params.runId,
          resumeFromStep: params.resumeFromStep,
        });
      }

      case "browser.agent.mission.execute": {
        const coordinator = getBrowserMultiAgentCoordinator();
        return await coordinator.executeFullMission(params.missionId, {
          url: params.url,
          assetConcept: params.assetConcept,
          files: params.files,
          targetSelector: params.targetSelector,
          tabId: params.tabId,
        });
      }

      default:
        throw new Error(`UNSUPPORTED_RPC_METHOD: '${method}' is not implemented by worker.`);
    }
  }
}
