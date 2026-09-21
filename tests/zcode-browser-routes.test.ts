import { describe, expect, it } from "bun:test";
import { handleZCodeRoutes } from "../src/server/management/zcode-routes";
import { handleBrowserControlRoutes } from "../src/server/management/browser-control-routes";
import type { ManagementContext } from "../src/server/management/context";

function makeContext(method: string, path: string, body?: unknown): ManagementContext {
  const url = new URL(`http://127.0.0.1:10100${path}`);
  const req = new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  return {
    url,
    req,
    loadConfig: () => ({ port: 10100, providers: {} } as never),
    saveConfig: () => {},
  } as unknown as ManagementContext;
}

describe("Phase 20.100 & 20.101 — Management API Routes", () => {
  describe("ZCode Routes (/api/agent-os/zcode/*)", () => {
    it("returns health status via GET /api/agent-os/zcode/health", async () => {
      const ctx = makeContext("GET", "/api/agent-os/zcode/health");
      const res = await handleZCodeRoutes(ctx);
      expect(res?.status).toBe(200);

      const data = await res?.json();
      expect(data.ok).toBe(true);
      expect(data.health.version).toBe("3.14.2");
    });

    it("creates a runtime handle via POST /api/agent-os/zcode/runtimes", async () => {
      const ctx = makeContext("POST", "/api/agent-os/zcode/runtimes", {
        workspacePath: "/test/workspace",
        workspaceIdentity: "ws_01",
        mode: "BUILD",
      });
      const res = await handleZCodeRoutes(ctx);
      expect(res?.status).toBe(201);

      const data = await res?.json();
      expect(data.ok).toBe(true);
      expect(data.runtime.workspaceIdentity).toBe("ws_01");
      expect(data.runtime.mode).toBe("BUILD");
    });

    it("lists available tools and pending approvals", async () => {
      const ctxTools = makeContext("GET", "/api/agent-os/zcode/tools");
      const resTools = await handleZCodeRoutes(ctxTools);
      const dataTools = await resTools?.json();
      expect(dataTools.ok).toBe(true);
      expect(dataTools.count).toBeGreaterThan(0);

      const ctxAppr = makeContext("GET", "/api/agent-os/zcode/approvals");
      const resAppr = await handleZCodeRoutes(ctxAppr);
      const dataAppr = await resAppr?.json();
      expect(dataAppr.ok).toBe(true);
      expect(Array.isArray(dataAppr.pending)).toBe(true);
    });
  });

  describe("Browser Control Routes (/api/agent-os/browser-control/*)", () => {
    it("returns fleet health via GET /api/agent-os/browser-control/fleet", async () => {
      const ctx = makeContext("GET", "/api/agent-os/browser-control/fleet");
      const res = await handleBrowserControlRoutes(ctx);
      expect(res?.status).toBe(200);

      const data = await res?.json();
      expect(data.ok).toBe(true);
      expect(data.fleet["local-chrome"]).toBeDefined();
      expect(data.fleet["oya"]).toBeDefined();
    });

    it("leases browser through POST /api/agent-os/browser-control/lease", async () => {
      const ctx = makeContext("POST", "/api/agent-os/browser-control/lease", {
        workloadType: "research",
        sensitivity: "low",
      });
      const res = await handleBrowserControlRoutes(ctx);
      expect(res?.status).toBe(201);

      const data = await res?.json();
      expect(data.ok).toBe(true);
      expect(data.lease.providerId).toBe("oya");
      expect(data.routing.selectedProvider.id).toBe("oya");
    });

    it("manages personas via GET & POST /api/agent-os/browser-control/personas", async () => {
      const ctxList = makeContext("GET", "/api/agent-os/browser-control/personas");
      const resList = await handleBrowserControlRoutes(ctxList);
      const dataList = await resList?.json();
      expect(dataList.ok).toBe(true);
      expect(dataList.count).toBeGreaterThanOrEqual(1);

      const ctxCreate = makeContext("POST", "/api/agent-os/browser-control/personas", {
        name: "Route Test Persona",
        owner: "tester",
        locale: "en-GB",
      });
      const resCreate = await handleBrowserControlRoutes(ctxCreate);
      expect(resCreate?.status).toBe(201);
      const dataCreate = await resCreate?.json();
      expect(dataCreate.ok).toBe(true);
      expect(dataCreate.persona.name).toBe("Route Test Persona");
    });
  });
});
