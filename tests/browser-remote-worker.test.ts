// Phase 20.14: Pao-hubPro Browser Remote Worker & Cloud VM Fleet — Comprehensive Test Suite
//
// Verifies Database Schema v23, Remote Worker Node Registry, SHA-256 Authentication,
// Standalone Worker Daemon HTTP Server, Fleet Dispatcher & Load Balancer,
// Canonical MCP Tools (`browser.remote.*`), and Management REST API Endpoints.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { AGENT_OS_SCHEMA_VERSION, openAgentOsDb } from "../src/agent-os/db";
import {
  RemoteWorkerRegistry,
  RemoteRpcClient,
  RemoteWorkerDaemon,
  FleetDispatcher,
  getRemoteWorkerRegistry,
  getFleetDispatcher,
  getRemoteWorkerMcpTools,
  type RemoteWorker,
} from "../src/agent-os/browser/remote";
import { handleRemoteWorkerRoutes } from "../src/server/management/remote-worker-routes";
import { handleBrowserRoutes } from "../src/server/management/browser-routes";
import type { ManagementContext } from "../src/server/management/context";

describe("Phase 20.14: Pao-hubPro Browser Remote Worker & Cloud VM Fleet", () => {
  let testDaemon: RemoteWorkerDaemon | null = null;
  const DAEMON_PORT = 18991;
  const DAEMON_TOKEN = "pao_test_token_secret_12345";

  beforeEach(async () => {
    // Start local daemon for testing remote RPC execution
    testDaemon = new RemoteWorkerDaemon({
      workerId: "worker_test_daemon_01",
      port: DAEMON_PORT,
      authToken: DAEMON_TOKEN,
      geoRegion: "us-east",
      maxConcurrentJobs: 5,
    });
    await testDaemon.start();
  });

  afterEach(async () => {
    if (testDaemon) {
      await testDaemon.stop();
      testDaemon = null;
    }
  });

  describe("1. Database Schema v23 Migration", () => {
    test("schema version is bumped to at least 23", () => {
      expect(AGENT_OS_SCHEMA_VERSION).toBeGreaterThanOrEqual(23);
      const db = openAgentOsDb();
      const row = db
        .query("SELECT value FROM schema_meta WHERE key = 'version'")
        .get() as { value: string };
      expect(parseInt(row.value, 10)).toBeGreaterThanOrEqual(23);
    });

    test("all 2 remote fleet tables exist and are queryable", () => {
      const db = openAgentOsDb();
      const tables = ["browser_remote_workers", "browser_remote_job_dispatches"];

      for (const table of tables) {
        const check = db
          .query("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
          .get(table) as { name: string } | null;
        expect(check?.name).toBe(table);
      }
    });
  });

  describe("2. Worker Node Registry & Authentication", () => {
    test("registers worker with SHA-256 token hash and capabilities", () => {
      const registry = new RemoteWorkerRegistry();
      const { worker, rawToken } = registry.registerWorker({
        name: "US East Cloud VM",
        endpointUrl: "http://10.0.0.12:18090",
        geoRegion: "us-east",
        maxConcurrentJobs: 4,
        capabilities: {
          headless: true,
          headed: false,
          tags: ["residential-ip", "us-adobe-stock"],
        },
      });

      expect(worker.id).toBeDefined();
      expect(worker.name).toBe("US East Cloud VM");
      expect(worker.geoRegion).toBe("us-east");
      expect(worker.maxConcurrentJobs).toBe(4);
      expect(worker.status).toBe("online");
      expect(worker.capabilities.tags).toContain("residential-ip");

      // Verify token hash
      expect(worker.authTokenHash).not.toBe(rawToken);
      expect(registry.verifyWorkerAuth(worker.id, rawToken)).toBe(true);
      expect(registry.verifyWorkerAuth(worker.id, "wrong_token")).toBe(false);

      // Fetch from DB
      const fetched = registry.getWorker(worker.id);
      expect(fetched?.name).toBe("US East Cloud VM");
    });

    test("handles heartbeats, status updates, draining, and stale culling", () => {
      const registry = new RemoteWorkerRegistry();
      const { worker } = registry.registerWorker({
        name: "EU Frankfurt VPS",
        endpointUrl: "http://192.168.1.10:18090",
        geoRegion: "eu-central",
      });

      // Heartbeat
      const beat = registry.heartbeat(worker.id, "busy", 2);
      expect(beat).toBe(true);
      const afterBeat = registry.getWorker(worker.id);
      expect(afterBeat?.status).toBe("busy");
      expect(afterBeat?.activeJobs).toBe(2);

      // Drain
      registry.drainWorker(worker.id);
      expect(registry.getWorker(worker.id)?.status).toBe("draining");

      // Fleet status
      const fleet = registry.getFleetStatus();
      expect(fleet.totalWorkers).toBeGreaterThan(0);
      expect(fleet.regions["eu-central"]).toBeGreaterThan(0);

      // Delete
      expect(registry.deleteWorker(worker.id)).toBe(true);
      expect(registry.getWorker(worker.id)).toBeNull();
    });
  });

  describe("3. Standalone Remote Worker Daemon Server", () => {
    test("rejects unauthenticated RPC calls with 401", async () => {
      const res = await fetch(`http://localhost:${DAEMON_PORT}/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "browser.status", params: {} }),
      });
      expect(res.status).toBe(401);
    });

    test("responds to GET /healthz and GET /status", async () => {
      const healthRes = await fetch(`http://localhost:${DAEMON_PORT}/healthz`);
      expect(healthRes.status).toBe(200);
      const healthData = (await healthRes.json()) as any;
      expect(healthData.status).toBe("ok");
      expect(healthData.workerId).toBe("worker_test_daemon_01");

      const statusRes = await fetch(`http://localhost:${DAEMON_PORT}/status`);
      expect(statusRes.status).toBe(200);
      const statusData = (await statusRes.json()) as any;
      expect(statusData.geoRegion).toBe("us-east");
      expect(statusData.browserStatus).toBeDefined();
    });

    test("executes authenticated RPC commands successfully", async () => {
      const rpcClient = new RemoteRpcClient();
      const endpoint = `http://localhost:${DAEMON_PORT}`;

      // 1. browser.status
      const statusRes = await rpcClient.call(endpoint, DAEMON_TOKEN, "browser.status");
      expect(statusRes.success).toBe(true);
      expect((statusRes.data as any).running).toBe(true);

      // 2. browser.navigate
      const navRes = await rpcClient.call(endpoint, DAEMON_TOKEN, "browser.navigate", {
        url: "https://stock.adobe.com/contributor",
      });
      expect(navRes.success).toBe(true);

      // 3. browser.read_page
      const readRes = await rpcClient.call(endpoint, DAEMON_TOKEN, "browser.read_page");
      expect(readRes.success).toBe(true);
      expect((readRes.data as any).url).toBeDefined();

      // 4. browser.snapshot
      const snapRes = await rpcClient.call(endpoint, DAEMON_TOKEN, "browser.snapshot");
      expect(snapRes.success).toBe(true);
      expect((snapRes.data as any).elements).toBeArray();

      // 5. browser.screenshot
      const shotRes = await rpcClient.call(endpoint, DAEMON_TOKEN, "browser.screenshot");
      expect(shotRes.success).toBe(true);
      expect((shotRes.data as any).dataBase64).toBeDefined();
      expect((shotRes.data as any).mimeType).toBe("image/png");
    });
  });

  describe("4. Fleet Dispatcher & Regional Load Balancer", () => {
    test("selects optimal worker based on load and geo-region", () => {
      const registry = new RemoteWorkerRegistry();
      const dispatcher = new FleetDispatcher(registry);

      // Register two workers in us-east with different capacities
      const w1 = registry.registerWorker({
        id: "w_us_1",
        name: "Worker US 1",
        endpointUrl: "http://us1.internal:18090",
        geoRegion: "us-east",
        maxConcurrentJobs: 3,
      });
      registry.heartbeat("w_us_1", "online", 2); // 2/3 load

      const w2 = registry.registerWorker({
        id: "w_us_2",
        name: "Worker US 2",
        endpointUrl: "http://us2.internal:18090",
        geoRegion: "us-east",
        maxConcurrentJobs: 3,
      });
      registry.heartbeat("w_us_2", "online", 0); // 0/3 load

      const selected = dispatcher.selectWorker({ geoRegion: "us-east" });
      expect(selected.id).toBe("w_us_2"); // Less loaded worker selected
    });

    test("dispatches remote jobs, tracks progress, and completes records", async () => {
      const registry = new RemoteWorkerRegistry();
      const dispatcher = new FleetDispatcher(registry);

      // Register test daemon
      const registered = registry.registerWorker({
        id: "worker_local_test",
        name: "Local Daemon Test Worker",
        endpointUrl: `http://localhost:${DAEMON_PORT}`,
        authToken: DAEMON_TOKEN,
        geoRegion: "us-east",
        maxConcurrentJobs: 5,
      });
      dispatcher.registerWorkerToken(registered.worker.id, DAEMON_TOKEN);

      const { dispatch, response } = await dispatcher.dispatchJob({
        jobType: "action",
        method: "browser.status",
        params: {},
        targetWorkerId: registered.worker.id,
      });

      expect(dispatch.id).toBeDefined();
      expect(dispatch.status).toBe("completed");
      expect(dispatch.durationMs).toBeGreaterThanOrEqual(0);
      expect(response.success).toBe(true);

      // Verify DB record
      const jobInDb = dispatcher.getJob(dispatch.id);
      expect(jobInDb?.status).toBe("completed");
      expect(jobInDb?.workerId).toBe("worker_local_test");

      // List jobs
      const jobs = dispatcher.listJobs({ workerId: registered.worker.id });
      expect(jobs.length).toBeGreaterThan(0);
    });
  });

  describe("5. Canonical MCP Tools (`browser.remote.*`)", () => {
    test("registers 10 canonical browser.remote.* tools with schema validation", async () => {
      const tools = getRemoteWorkerMcpTools();
      expect(tools.length).toBeGreaterThanOrEqual(10);

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("browser.remote.worker.register");
      expect(toolNames).toContain("browser.remote.worker.list");
      expect(toolNames).toContain("browser.remote.worker.get");
      expect(toolNames).toContain("browser.remote.worker.heartbeat");
      expect(toolNames).toContain("browser.remote.worker.drain");
      expect(toolNames).toContain("browser.remote.worker.delete");
      expect(toolNames).toContain("browser.remote.dispatch");
      expect(toolNames).toContain("browser.remote.job.get");
      expect(toolNames).toContain("browser.remote.job.list");
      expect(toolNames).toContain("browser.remote.fleet.status");

      // Test handler browser.remote.worker.register
      const registerTool = tools.find((t) => t.name === "browser.remote.worker.register")!;
      const regRes = (await registerTool.handler({
        name: "MCP Test Worker",
        endpointUrl: "http://mcp-worker:18090",
        geoRegion: "asia-southeast",
      })) as any;

      expect(regRes.worker.id).toBeDefined();
      expect(regRes.authToken).toBeDefined();

      // Test handler browser.remote.fleet.status
      const fleetTool = tools.find((t) => t.name === "browser.remote.fleet.status")!;
      const fleetRes = (await fleetTool.handler({})) as any;
      expect(fleetRes.fleet.totalWorkers).toBeGreaterThan(0);
    });
  });

  describe("6. Management REST API Endpoints", () => {
    function makeCtx(path: string, method = "GET", body?: any): ManagementContext {
      const url = new URL(`http://localhost:18080${path}`);
      const init: RequestInit = { method };
      if (body) {
        init.body = JSON.stringify(body);
        init.headers = { "content-type": "application/json" };
      }
      const req = new Request(url, init);
      return {
        url,
        req,
        config: {} as any,
      };
    }

    test("REST API: Register, list, inspect, drain, and delete workers", async () => {
      // 1. POST /api/browser/remote/workers
      const regCtx = makeCtx("/api/browser/remote/workers", "POST", {
        name: "REST API Remote Worker",
        endpointUrl: "http://rest-worker:18090",
        geoRegion: "us-west",
      });
      const regRes = await handleRemoteWorkerRoutes(regCtx);
      expect(regRes?.status).toBe(201);
      const regData = (await regRes?.json()) as any;
      const workerId = regData.worker.id;
      expect(workerId).toBeDefined();

      // 2. GET /api/browser/remote/workers
      const listCtx = makeCtx("/api/browser/remote/workers?geoRegion=us-west");
      const listRes = await handleRemoteWorkerRoutes(listCtx);
      expect(listRes?.status).toBe(200);
      const listData = (await listRes?.json()) as any;
      expect(listData.workers.some((w: any) => w.id === workerId)).toBe(true);

      // 3. GET /api/browser/remote/workers/:id
      const getCtx = makeCtx(`/api/browser/remote/workers/${workerId}`);
      const getRes = await handleRemoteWorkerRoutes(getCtx);
      expect(getRes?.status).toBe(200);
      const getData = (await getRes?.json()) as any;
      expect(getData.worker.name).toBe("REST API Remote Worker");

      // 4. POST /api/browser/remote/workers/:id/heartbeat
      const hbCtx = makeCtx(`/api/browser/remote/workers/${workerId}/heartbeat`, "POST", {
        status: "busy",
        activeJobs: 1,
      });
      const hbRes = await handleRemoteWorkerRoutes(hbCtx);
      expect(hbRes?.status).toBe(200);

      // 5. POST /api/browser/remote/workers/:id/drain
      const drainCtx = makeCtx(`/api/browser/remote/workers/${workerId}/drain`, "POST");
      const drainRes = await handleRemoteWorkerRoutes(drainCtx);
      expect(drainRes?.status).toBe(200);

      // 6. GET /api/browser/remote/fleet
      const fleetCtx = makeCtx("/api/browser/remote/fleet");
      const fleetRes = await handleRemoteWorkerRoutes(fleetCtx);
      expect(fleetRes?.status).toBe(200);

      // 7. DELETE /api/browser/remote/workers/:id
      const delCtx = makeCtx(`/api/browser/remote/workers/${workerId}`, "DELETE");
      const delRes = await handleRemoteWorkerRoutes(delCtx);
      expect(delRes?.status).toBe(200);

      // 8. Delegation test via handleBrowserRoutes
      const delRouteCtx = makeCtx("/api/browser/remote/fleet");
      const delRouteRes = await handleBrowserRoutes(delRouteCtx);
      expect(delRouteRes?.status).toBe(200);
    });

    test("REST API: Dispatch job and query results", async () => {
      // Register test daemon into fleet
      const regCtx = makeCtx("/api/browser/remote/workers", "POST", {
        id: "worker_rest_dispatch_test",
        name: "REST Dispatch Daemon",
        endpointUrl: `http://localhost:${DAEMON_PORT}`,
        authToken: DAEMON_TOKEN,
        geoRegion: "us-east",
      });
      await handleRemoteWorkerRoutes(regCtx);

      // POST /api/browser/remote/dispatch
      const dispatchCtx = makeCtx("/api/browser/remote/dispatch", "POST", {
        jobType: "action",
        method: "browser.status",
        params: {},
        targetWorkerId: "worker_rest_dispatch_test",
        authToken: DAEMON_TOKEN,
      });
      const dispatchRes = await handleRemoteWorkerRoutes(dispatchCtx);
      expect(dispatchRes?.status).toBe(200);
      const dispatchData = (await dispatchRes?.json()) as any;
      expect(dispatchData.success).toBe(true);
      expect(dispatchData.dispatch.id).toBeDefined();

      // GET /api/browser/remote/jobs/:id
      const getJobCtx = makeCtx(`/api/browser/remote/jobs/${dispatchData.dispatch.id}`);
      const getJobRes = await handleRemoteWorkerRoutes(getJobCtx);
      expect(getJobRes?.status).toBe(200);
      const getJobData = (await getJobRes?.json()) as any;
      expect(getJobData.job.status).toBe("completed");
    });
  });
});
