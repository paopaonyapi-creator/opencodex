import { afterEach, describe, expect, it } from "bun:test";
import { AnythingMcpHttpAdapter } from "../src/agent-os/mcp-fabric/adapters";
import { McpFabricError } from "../src/agent-os/mcp-fabric/types";
import { McpFabricService } from "../src/agent-os/mcp-fabric/service";
import { MockAnythingMcpAdapter } from "../src/agent-os/mcp-fabric/adapters";
import { shapeResponse } from "../src/agent-os/mcp-fabric/privacy";
import { openAgentOsDb } from "../src/agent-os/db";
import { anythingMcpLiveRequested, mcpFabricMockForced } from "../src/agent-os/mcp-fabric/flags";

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.stop(true); });

function bridge(reply: (body: Record<string, unknown>, req: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    if (new URL(req.url).pathname === "/health") return Response.json({ status: "ok" });
    const body = await req.json() as Record<string, unknown>;
    if (body.method === "initialize") return Response.json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } } });
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    return reply(body, req);
  } });
  servers.push(server);
  return new AnythingMcpHttpAdapter([server.url.origin], { executeMs: 150 });
}

describe("MCP Fabric transport hardening (local protocol fixtures)", () => {
  it("live request takes precedence over an inherited mock flag", () => {
    const previous = { live: process.env.PAO_MCP_FABRIC_LIVE, mock: process.env.PAO_MCP_FABRIC_MOCK };
    try {
      process.env.PAO_MCP_FABRIC_LIVE = "1";
      process.env.PAO_MCP_FABRIC_MOCK = "1";
      expect(anythingMcpLiveRequested()).toBe(true);
      expect(mcpFabricMockForced()).toBe(false);
    } finally {
      if (previous.live === undefined) delete process.env.PAO_MCP_FABRIC_LIVE; else process.env.PAO_MCP_FABRIC_LIVE = previous.live;
      if (previous.mock === undefined) delete process.env.PAO_MCP_FABRIC_MOCK; else process.env.PAO_MCP_FABRIC_MOCK = previous.mock;
    }
  });
  for (const malformed of ["not json", "{}", '{"result":{"content":[]}}', '{"jsonrpc":"2.0","id":"wrong","result":{"content":[]}}']) {
    it("rejects malformed or uncorrelated MCP response " + malformed, async () => {
      const adapter = bridge(() => new Response(malformed, { headers: { "content-type": "application/json" } }));
      await expect(adapter.execute({ tool: "get_record", args: {} })).rejects.toMatchObject({ code: "SCHEMA_INVALID" });
    });
  }
  it("does not echo upstream error messages containing credentials", async () => {
    const token = "private-canary-value-2096";
    const adapter = bridge(body => Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32602, message: "invalid argument " + token } }));
    const error = await adapter.execute({ tool: "get_record", args: {} }).catch(e => e);
    expect(error).toBeInstanceOf(McpFabricError);
    expect(error.code).toBe("SCHEMA_INVALID");
    expect(error.message + JSON.stringify(error.detail)).not.toContain(token);
  });
  it("preserves structured result ahead of text and strips protocol metadata", async () => {
    const adapter = bridge(body => Response.json({ jsonrpc: "2.0", id: body.id, result: { structuredContent: { id: 1 }, content: [{ type: "text", text: "debug only" }], _meta: { private: "internal" } } }));
    expect((await adapter.execute({ tool: "get_record", args: {} })).payload).toEqual({ id: 1 });
  });
  it("denies reflected runtime credentials even inside otherwise public data", async () => {
    const token = "runtime-opaque-canary-2096";
    const adapter = bridge(body => Response.json({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify({ description: token }) }] } }));
    await expect(adapter.execute({ tool: "get_record", args: {}, credentialHeader: "Bearer " + token })).rejects.toMatchObject({ code: "SECRET_IN_RESPONSE" });
  });
  it("keeps the deadline through body consumption", async () => {
    const adapter = bridge(() => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"jsonrpc":"2.0",')); } }), { headers: { "content-type": "application/json" } }));
    await expect(adapter.execute({ tool: "get_record", args: {} })).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE", httpStatus: 504 });
  });
  it("rejects oversized upstream bodies", async () => {
    const adapter = bridge(body => Response.json({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "x".repeat(1_100_000) }] } }));
    await expect(adapter.execute({ tool: "get_record", args: {} })).rejects.toMatchObject({ code: "SCHEMA_INVALID" });
  });
  it("never follows an upstream redirect with credentials", async () => {
    let secondHits = 0;
    const target = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { secondHits++; return Response.json({ result: { content: [] } }); } });
    servers.push(target);
    const adapter = bridge(() => Response.redirect(target.url.href, 307));
    await expect(adapter.execute({ tool: "get_record", args: {}, credentialHeader: "Bearer redirect-canary" })).rejects.toBeInstanceOf(McpFabricError);
    expect(secondHits).toBe(0);
  });
  it("keeps MCP sessions isolated across concurrent credentials", async () => {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
      if (new URL(req.url).pathname === "/health") return Response.json({ status: "ok" });
      const request = await req.json() as Record<string, unknown>;
      const auth = req.headers.get("authorization") ?? "";
      const session = auth.endsWith("alpha") ? "session-alpha" : "session-beta";
      if (request.method === "initialize") return Response.json({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "fixture", version: "1" } } }, { headers: { "mcp-session-id": session } });
      if (req.headers.get("mcp-session-id") !== session) return new Response(null, { status: 403 });
      if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
      return Response.json({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: '{"id":1}' }] } });
    } });
    servers.push(server);
    const adapter = new AnythingMcpHttpAdapter([server.url.origin]);
    const results = await Promise.all(["alpha", "beta"].map(token => adapter.execute({ tool: "get_record", args: {}, credentialHeader: "Bearer " + token })));
    expect(results.map(result => result.payload)).toEqual([{ id: 1 }, { id: 1 }]);
  });
});

describe("MCP Fabric publication and privacy boundaries", () => {
  function published(service: McpFabricService) {
    const item = service.importConnector({ kind: "mcp", name: "hardening_" + crypto.randomUUID(), raw: JSON.stringify({ tools: [{ name: "get_record", inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"], additionalProperties: false }, outputSchema: { type: "object", properties: { id: { type: "integer" } } } }] }) });
    service.approveConnector(item.connector.id, "reviewer", "fixture");
    service.publishConnector(item.connector.id, "paohub-readonly", "reviewer");
    return service.listTools(item.connector.id)[0]!;
  }
  it("rejects invalid arguments before adapter execution", async () => {
    let calls = 0;
    const adapter = new MockAnythingMcpAdapter();
    adapter.execute = async () => { calls++; return { ok: true, payload: { id: 1 } }; };
    const svc = new McpFabricService([adapter]);
    const tool = published(svc);
    await expect(svc.execute({ toolId: tool.id, actor: "tester", args: { id: "1" } })).rejects.toMatchObject({ code: "SCHEMA_INVALID" });
    expect(calls).toBe(0);
  });
  it("rejects injected privileged metadata and nested credentials before storing args", async () => {
    const svc = new McpFabricService([new MockAnythingMcpAdapter()]);
    const tool = published(svc);
    for (const args of [{ id: 1, _meta: { roles: ["admin"] } }, { id: 1, headers: { Authorization: "Bearer private-canary" } }]) {
      await expect(svc.execute({ toolId: tool.id, actor: "tester", args })).rejects.toBeInstanceOf(McpFabricError);
    }
    const rows = openAgentOsDb().query("SELECT args_redacted_json FROM amf_executions WHERE tool_id = ?").all(tool.id);
    expect(JSON.stringify(rows)).not.toContain("private-canary");
  });
  it("retains input and output schemas on enumeration", () => {
    const svc = new McpFabricService();
    const tool = published(svc) as unknown as Record<string, unknown>;
    expect(tool.inputSchema).toMatchObject({ required: ["id"] });
    expect(tool.outputSchema).toMatchObject({ properties: { id: { type: "integer" } } });
  });
  it("rejects deterministic canonical name collisions without partial imports", () => {
    const svc = new McpFabricService();
    const name = "collision_" + crypto.randomUUID();
    const raw = JSON.stringify({ tools: [{ name: "get_record" }] });
    svc.importConnector({ kind: "mcp", name, raw });
    const before = svc.listConnectors().length;
    expect(() => svc.importConnector({ kind: "mcp", name, raw })).toThrow(McpFabricError);
    expect(svc.listConnectors().length).toBe(before);
  });
  it("removes private transport fields while preserving structured data", () => {
    const shaped = shapeResponse({ risk: "R2", payload: { id: 1, nested: { accessToken: "opaque-canary", "set-cookie": "session=private" }, headers: { server: "private" }, _meta: { tenant: "private" }, connectorPrivate: { route: "private" } } });
    expect(shaped.visible).toEqual({ id: 1, nested: {} });
    expect(shaped.fallbackToRaw).toBe(false);
  });
  it("records correlated failure without storing payload or stack", async () => {
    const adapter = new MockAnythingMcpAdapter();
    adapter.execute = async () => { throw new McpFabricError("ADAPTER_UNAVAILABLE", 503, "failed"); };
    const svc = new McpFabricService([adapter]);
    const tool = published(svc);
    const error = await svc.execute({ toolId: tool.id, actor: "tester", args: { id: 1 } }).catch(e => e);
    expect(error.detail.correlationId).toBeString();
    const row = openAgentOsDb().query("SELECT status FROM amf_executions WHERE correlation_id = ?").get(error.detail.correlationId);
    expect(row).toMatchObject({ status: "failed" });
  });
  it("reports liveness separately from authenticated readiness", async () => {
    const adapter = bridge(() => new Response(null, { status: 401 }));
    const svc = new McpFabricService([adapter]);
    const health = await svc.health();
    expect(health).toMatchObject({ ok: false, ready: false, engine: "anythingmcp", readiness: { status: "auth_failed" } });
    expect((health.adapters as Array<Record<string, unknown>>)[0]?.status).toBe("healthy");
  });
});
