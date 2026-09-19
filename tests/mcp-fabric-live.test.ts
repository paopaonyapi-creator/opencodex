// Phase 20.96 — LIVE AnythingMCP integration. Skipped unless LIVE_ANYTHINGMCP=1 and PAO_ANYTHINGMCP_URL are set.
// CI stays on tests/mcp-fabric.test.ts (mock). This file must reach a real AnythingMCP process.

import { describe, expect, it } from "bun:test";
import { issueLease, putSecret, revealForProviderCall } from "../src/agent-os/enzo-workspace";
import {
  AnythingMcpHttpAdapter,
  McpFabricError,
  McpFabricService,
  resetMcpFabricServiceForTests,
} from "../src/agent-os/mcp-fabric";
import { anythingMcpLogin, provisionJsonPlaceholderConnector } from "./helpers/anythingmcp-live";
import { handleMcpFabricRoutes } from "../src/server/management/mcp-fabric-routes";
import type { ManagementContext } from "../src/server/management/context";

function managementCtx(path: string): ManagementContext {
  const req = new Request("http://127.0.0.1" + path);
  return {
    req,
    url: new URL(req.url),
    config: {} as never,
    deps: {} as never,
    convergeCodexCatalog: async () => ({}) as never,
    syncClaudeAgentDefsBestEffort: async () => {},
  };
}

const LIVE = (process.env.LIVE_ANYTHINGMCP ?? "").trim() === "1" && Boolean((process.env.PAO_ANYTHINGMCP_URL ?? "").trim());
const BASE = (process.env.PAO_ANYTHINGMCP_URL ?? "").trim().replace(/\/+$/, "");

describe.skipIf(!LIVE)("phase 20.96 — LIVE AnythingMCP", () => {
  it("probes real /health, registers a read-only connector, and executes tools/call end-to-end", async () => {
    process.env.PAO_MCP_FABRIC_LIVE = "1";
    process.env.PAO_MCP_FABRIC_MOCK = "0";
    resetMcpFabricServiceForTests();

    const adapter = new AnythingMcpHttpAdapter();
    const health = await adapter.probe();
    expect(health.status).toBe("healthy");
    expect(health.configured).toBe(true);
    expect(health.endpoint).toContain("127.0.0.1");
    resetMcpFabricServiceForTests();
    const healthRes = await handleMcpFabricRoutes(managementCtx("/api/agent-os/mcp-fabric/health"));
    expect(healthRes).toBeTruthy();
    expect(healthRes!.status).toBe(200);
    const healthBody = await healthRes!.json() as { adapters?: Array<{ id?: string; status?: string; configured?: boolean }> };
    const liveAdapter = healthBody.adapters?.find((a) => a.id === "anythingmcp");
    expect(liveAdapter?.configured).toBe(true);
    expect(liveAdapter?.status).toBe("healthy");

    const email = process.env.PAO_ANYTHINGMCP_ADMIN_EMAIL;
    const password = process.env.PAO_ANYTHINGMCP_ADMIN_PASSWORD;
    if (!email || !password) throw new Error("PAO_ANYTHINGMCP_ADMIN_EMAIL/PASSWORD required for live provision");
    const token = await anythingMcpLogin(BASE, email, password);
    const provisioned = await provisionJsonPlaceholderConnector({ baseUrl: BASE, accessToken: token });

    process.env.PAO_ANYTHINGMCP_TOKEN = token;

    const svc = new McpFabricService();
    const imported = svc.importConnector({
      kind: "mcp",
      name: "jsonplaceholder",
      raw: JSON.stringify({
        tools: [{ name: provisioned.toolName, description: "Read-only JSONPlaceholder record", destructiveHint: false, inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } }],
      }),
      actor: "live-tester",
    });
    svc.approveConnector(imported.connector.id, "reviewer", "live jsonplaceholder");
    svc.publishConnector(imported.connector.id, "paohub-readonly", "reviewer");
    const tool = svc.listTools(imported.connector.id)[0]!;

    const started = Date.now();
    const result = await svc.execute({
      toolId: tool.id,
      args: { id: 1 },
      actor: "live-tester",
      profile: "paohub-readonly",
    });
    const durationMs = Date.now() - started;
    expect(result.ok).toBe(true);
    expect(result.engine).toBe("anythingmcp");
    expect(result.engine).not.toBe("mock");
    expect(result.correlationId).toBeTruthy();
    expect(result.policy).toBe("allow");
    expect(Number(result.durationMs)).toBeGreaterThan(0);
    expect(Number((result.upstream as { httpStatus?: number }).httpStatus)).toBe(200);
    expect(Number((result.upstream as { durationMs?: number }).durationMs)).toBeGreaterThan(0);
    const visible = (result.result as { content?: Record<string, unknown>; trust?: string }).content ?? result.result;
    const payload = typeof visible === "object" && visible ? visible as Record<string, unknown> : {};
    const inner = (payload.content && typeof payload.content === "object" ? payload.content : payload) as Record<string, unknown>;
    expect(Number(inner.id)).toBe(1);
    expect(Number(inner.userId)).toBe(1);
    expect(String(inner.title)).toContain("sunt aut facere");
    expect(durationMs).toBeGreaterThan(0);

    const row = (await import("../src/agent-os/db")).openAgentOsDb()
      .query("SELECT correlation_id, status, duration_ms FROM amf_executions WHERE id = ?")
      .get(String(result.executionId)) as { correlation_id: string; status: string; duration_ms: number };
    expect(row.status).toBe("success");
    expect(row.correlation_id).toBe(String(result.correlationId));
    expect(Number(row.duration_ms)).toBeGreaterThan(0);

    await expect(svc.execute({ canonicalName: "jsonplaceholder.missing.tool", args: { id: 1 }, actor: "live-tester", profile: "paohub-readonly" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const unpublished = svc.importConnector({
      kind: "mcp",
      name: "jsonplaceholder-unpublished",
      raw: JSON.stringify({ tools: [{ name: "get_post", description: "not published", destructiveHint: false }] }),
      actor: "live-tester",
    }).tools[0]!;
    await expect(svc.execute({ toolId: unpublished.id, args: { id: 1 }, actor: "live-tester", profile: "paohub-readonly" })).rejects.toMatchObject({ code: "UNPUBLISHED" });
    svc.disableConnector(imported.connector.id, "reviewer");
    await expect(svc.execute({ toolId: tool.id, args: { id: 1 }, actor: "live-tester", profile: "paohub-readonly" })).rejects.toMatchObject({ code: "POLICY_DENIED" });

    const candidate = svc.listSkills()[0];
    expect(candidate).toBeTruthy();
    const promoted = await svc.promoteSkill(String(candidate!.id), "reviewer");
    expect(promoted.published).toBe(false);
    expect(String(promoted.skillGate ?? "")).not.toMatch(/published|active/i);
    const rolled = svc.rollbackTool(tool.id, 1, "reviewer");
    expect(rolled.version).toBe(1);
    expect(rolled.schemaHash).toBe(tool.schemaHash);
  });

  it("wrong URL and down instance fail closed; missing MCP token is an auth failure", async () => {
    const wrong = new AnythingMcpHttpAdapter(["http://127.0.0.1:9"]);
    expect((await wrong.probe()).status).not.toBe("healthy");
    await expect(wrong.execute({ tool: "get_post", args: { id: 1 } })).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE" });

    const prevToken = process.env.PAO_ANYTHINGMCP_TOKEN;
    delete process.env.PAO_ANYTHINGMCP_TOKEN;
    try {
      const authed = new AnythingMcpHttpAdapter();
      try {
        await authed.execute({ tool: "get_post", args: { id: 1 } });
        throw new Error("expected auth failure");
      } catch (err) {
        expect(["CREDENTIAL_DENIED", "ADAPTER_UNAVAILABLE"]).toContain((err as McpFabricError).code);
      }
    } finally {
      if (prevToken !== undefined) process.env.PAO_ANYTHINGMCP_TOKEN = prevToken;
    }
  });

  it("secret:// lease is required, wrong scope is denied, expired lease cannot be revealed", async () => {
    const secretRef = "secret://workspace/main/anythingmcp/mcp-bearer";
    const token = process.env.PAO_ANYTHINGMCP_TOKEN;
    if (!token) throw new Error("PAO_ANYTHINGMCP_TOKEN required for lease live test");
    putSecret({ secretRef, secret: token, scopes: ["provider.call"], provider: "anythingmcp" });
    const svc = new McpFabricService();
    const imported = svc.importConnector({
      kind: "mcp",
      name: "jsonplaceholder-leased",
      raw: JSON.stringify({ tools: [{ name: process.env.PAO_ANYTHINGMCP_TOOL_NAME || "get_post", description: "leased", destructiveHint: false }] }),
      credentialRef: secretRef,
      actor: "live-tester",
    });
    svc.approveConnector(imported.connector.id, "reviewer", "ok");
    svc.publishConnector(imported.connector.id, "paohub-readonly", "reviewer");
    const tool = svc.listTools(imported.connector.id)[0]!;
    const ok = await svc.execute({ toolId: tool.id, args: { id: 1 }, actor: "live-tester", profile: "paohub-readonly" });
    expect(ok.engine).toBe("anythingmcp");

    const missing = svc.importConnector({
      kind: "mcp",
      name: "jsonplaceholder-missing-lease",
      raw: JSON.stringify({ tools: [{ name: "get_post", description: "missing", destructiveHint: false }] }),
      credentialRef: "secret://workspace/main/anythingmcp/missing",
      actor: "live-tester",
    });
    svc.approveConnector(missing.connector.id, "reviewer", "ok");
    svc.publishConnector(missing.connector.id, "paohub-readonly", "reviewer");
    await expect(svc.execute({ toolId: svc.listTools(missing.connector.id)[0]!.id, args: { id: 1 }, actor: "live-tester", profile: "paohub-readonly" })).rejects.toMatchObject({ code: "CREDENTIAL_DENIED" });

    const expiredRef = "secret://workspace/main/anythingmcp/expired";
    putSecret({ secretRef: expiredRef, secret: token, scopes: ["provider.call"] });
    const lease = issueLease({ secretRef: expiredRef, runId: "live-expired", principal: "live-tester", ttlMs: 1 });
    await Bun.sleep(20);
    expect(() => revealForProviderCall(lease.leaseId)).toThrow(/expired|LEASE/i);
  });
 
  it("times out a hanging upstream instead of returning success", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname === "/health") return new Response("ok");
        return new Promise<Response>(() => {});
      },
    });
    try {
      const adapter = new AnythingMcpHttpAdapter(["http://127.0.0.1:" + server.port], { probeMs: 200, executeMs: 80 });
      await expect(adapter.execute({ tool: "get_post", args: { id: 1 } })).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE", httpStatus: 504 });
    } finally {
      server.stop(true);
    }
  });
});
