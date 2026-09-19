// Phase 20.96 — MCP Fabric / AnythingMCP control plane. Mock-only: no live AnythingMCP.

import { describe, expect, it } from "bun:test";
import { AGENT_OS_SCHEMA_VERSION, openAgentOsDb } from "../src/agent-os/db";
import { issueLease, putSecret, revealForProviderCall } from "../src/agent-os/enzo-workspace";
import {
  AnythingMcpHttpAdapter,
  McpFabricError,
  McpFabricService,
  classifyOperation,
  classifySql,
  createMcpFabricMcpTools,
  getMcpFabricService,
  normalizeOpenApi,
  resetMcpFabricServiceForTests,
  shapeResponse,
} from "../src/agent-os/mcp-fabric";

resetMcpFabricServiceForTests();
const svc = getMcpFabricService();

const OPENAPI = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "CRM", version: "1" },
  paths: {
    "/customers/{id}": {
      get: { operationId: "getCustomer", summary: "Get customer" },
      delete: { operationId: "deleteCustomer", summary: "Delete customer", destructiveHint: false },
    },
    "/invoices": {
      post: { operationId: "createInvoiceDraft", summary: "Create invoice draft" },
    },
  },
});

function mcpBridge(handler: (req: Request, body: Record<string, unknown>) => Response | Promise<Response>) {
  return Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/health") return new Response("ok");
      if (url.pathname === "/mcp" && req.method === "POST") {
        const body = await req.json().catch(() => ({})) as Record<string, unknown>;
        return handler(req, body);
      }
      return new Response("missing", { status: 404 });
    },
  });
}

describe("phase 20.96 — schema", () => {
  it("migrates Agent OS schema to v67 with amf_* tables", () => {
    expect(AGENT_OS_SCHEMA_VERSION).toBeGreaterThanOrEqual(67);
    const db = openAgentOsDb();
    const tables = (db.query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'amf_%'").all() as { name: string }[]).map((r) => r.name);
    for (const name of ["amf_connectors", "amf_tools", "amf_executions", "amf_approvals", "amf_kg_candidates", "amf_skill_candidates"]) {
      expect(tables).toContain(name);
    }
  });
});

describe("phase 20.96 — classification", () => {
  it("overrides destructiveHint=false on delete to R4", () => {
    const cls = classifyOperation({ name: "deleteCustomer", method: "DELETE", path: "/customers/1", upstreamDestructiveHint: false });
    expect(cls.risk).toBe("R4");
    expect(cls.destructiveHint).toBe(true);
  });

  it("classifies OpenAPI tools with canonical names", () => {
    const tools = normalizeOpenApi("crm", OPENAPI);
    expect(tools.some((t) => t.canonicalName === "crm.customers.getcustomer")).toBe(true);
    expect(tools.find((t) => t.method === "DELETE")?.risk).toBe("R4");
    expect(tools.find((t) => t.method === "POST")?.risk).toBe("R4");
  });

  it("SQL guard allows SELECT/WITH and denies writes without relying only on a single regex", () => {
    expect(classifySql("SELECT sku, qty FROM inventory WHERE qty > 0").allow).toBe(true);
    expect(classifySql("WITH x AS (SELECT 1 AS n) SELECT * FROM x").allow).toBe(true);
    expect(classifySql("INSERT INTO inventory VALUES (1)").allow).toBe(false);
    expect(classifySql("SELECT 1; DROP TABLE inventory").allow).toBe(false);
    expect(classifySql("UPDATE inventory SET qty=0").allow).toBe(false);
  });
});

describe("phase 20.96 — privacy", () => {
  it("masks PII, drops credentials, and fail-closes rather than returning raw", () => {
    const shaped = shapeResponse({ risk: "R2", payload: { email: "ada@example.com", token: "sk-live-secret", sku: "A-1" } });
    const vis = shaped.visible as Record<string, unknown>;
    expect(String(vis.email)).not.toContain("ada@example.com");
    expect(vis.token).toBeUndefined();
    expect(vis.sku).toBe("A-1");
    expect(shaped.fallbackToRaw).toBe(false);
  });
});

describe("phase 20.96 — connector lifecycle", () => {
  it("imports as draft and never auto-publishes", () => {
    const { connector, tools } = svc.importConnector({ kind: "openapi", name: "crm", raw: OPENAPI, actor: "tester" });
    expect(connector.lifecycle).toBe("POLICY_REVIEW");
    expect(tools.every((t) => t.published === false)).toBe(true);
    expect(tools.every((t) => t.enabled === false)).toBe(true);
  });

  it("rejects raw secrets and SSRF targets on import", () => {
    expect(() => svc.importConnector({ kind: "curl", name: "bad", raw: "curl http://127.0.0.1/admin", actor: "tester" })).toThrow(/SSRF|INVALID/i);
    try {
      svc.importConnector({ kind: "openapi", name: "leak", raw: OPENAPI, credentialRef: "sk-live-not-a-ref", actor: "tester" });
    } catch (err) {
      expect((err as McpFabricError).code).toBe("SECRET_IN_REQUEST");
    }
  });

  it("publishes only after approval and can disable immediately", () => {
    const { connector } = svc.importConnector({ kind: "openapi", name: "crm2", raw: OPENAPI, actor: "tester" });
    const approved = svc.approveConnector(connector.id, "reviewer", "ok");
    expect(approved.lifecycle).toBe("APPROVED");
    const published = svc.publishConnector(connector.id, "paohub-admin", "reviewer");
    expect(["PUBLISHED", "MONITORED"]).toContain(published.lifecycle);
    expect(svc.listTools(connector.id).some((t) => t.published)).toBe(true);
    const disabled = svc.disableConnector(connector.id, "reviewer");
    expect(disabled.lifecycle).toBe("DISABLED");
  });

  it("freezes on breaking schema drift", () => {
    const { connector } = svc.importConnector({ kind: "openapi", name: "crm3", raw: OPENAPI, actor: "tester" });
    svc.approveConnector(connector.id, "reviewer", "ok");
    svc.publishConnector(connector.id, "paohub-readonly", "reviewer");
    const drift = svc.detectDrift(connector.id, OPENAPI.replace("getCustomer", "getCustomerV2"), "tester");
    expect(drift.breaking).toBe(true);
    expect(svc.requireConnector(connector.id).lifecycle).toBe("DEGRADED");
  });
});

describe("phase 20.96 — execution policy", () => {
  it("executes a published read tool through the gateway and tags output untrusted", async () => {
    const { connector } = svc.importConnector({ kind: "openapi", name: "crm4", raw: OPENAPI, actor: "tester" });
    svc.approveConnector(connector.id, "reviewer", "ok");
    svc.publishConnector(connector.id, "paohub-admin", "reviewer");
    const read = svc.listTools(connector.id).find((t) => t.canonicalName.includes("getcustomer"));
    expect(read).toBeTruthy();
    const result = await svc.execute({ toolId: read!.id, args: { id: "c1" }, actor: "tester", profile: "paohub-admin" });
    expect(result.ok).toBe(true);
    expect((result.result as { trust?: string }).trust).toBe("untrusted_external_content");
    expect(result.correlationId).toBeTruthy();
    expect(result.engine).toBe("mock");
  });

  it("requires approval for R4 and refuses unpublished tools", async () => {
    const { connector, tools } = svc.importConnector({ kind: "openapi", name: "crm5", raw: OPENAPI, actor: "tester" });
    const del = tools.find((t) => t.risk === "R4")!;
    await expect(svc.execute({ toolId: del.id, args: { id: "c1" }, actor: "tester", profile: "paohub-admin" })).rejects.toBeInstanceOf(McpFabricError);
    svc.approveConnector(connector.id, "reviewer", "ok");
    svc.publishConnector(connector.id, "paohub-admin", "reviewer");
    const publishedDel = svc.listTools(connector.id).find((t) => t.risk === "R4")!;
    try {
      await svc.execute({ toolId: publishedDel.id, args: { id: "c1" }, actor: "tester", profile: "paohub-admin" });
      throw new Error("expected approval");
    } catch (err) {
      expect((err as McpFabricError).code).toBe("APPROVAL_REQUIRED");
      const approvalId = String((err as McpFabricError).detail.approvalId);
      svc.decideApproval(approvalId, true, "human");
      const done = await svc.execute({ toolId: publishedDel.id, args: { id: "c1" }, actor: "tester", profile: "paohub-admin", approvalId });
      expect(done.ok).toBe(true);
    }
  });

  it("denies dangerous SQL on database connectors", async () => {
    const { connector } = svc.importConnector({ kind: "postgres", name: "inventory", raw: "{}", actor: "tester" });
    svc.approveConnector(connector.id, "reviewer", "ok");
    svc.publishConnector(connector.id, "paohub-research", "reviewer");
    const tool = svc.listTools(connector.id)[0]!;
    await expect(svc.execute({ toolId: tool.id, args: { sql: "DELETE FROM inventory" }, actor: "tester", profile: "paohub-research" })).rejects.toMatchObject({ code: "SQL_DENIED" });
    const ok = await svc.execute({ toolId: tool.id, args: { sql: "SELECT sku FROM inventory" }, actor: "tester", profile: "paohub-research" });
    expect(ok.ok).toBe(true);
  });
});

describe("phase 20.96 — additional sources and MCP facade", () => {
  it("imports graphql, wsdl, postman, curl, and mcp descriptors", () => {
    expect(svc.importConnector({ kind: "graphql", name: "shop", raw: "type Query { order(id: ID!): Order } type Mutation { refundOrder(id: ID!): Order }", actor: "t" }).tools.length).toBe(2);
    expect(svc.importConnector({ kind: "wsdl", name: "legacy", raw: '<wsdl:operation name="GetStatus"></wsdl:operation>', actor: "t" }).tools.length).toBe(1);
    expect(svc.importConnector({ kind: "postman", name: "pm", raw: JSON.stringify({ item: [{ name: "list", request: { method: "GET", url: "https://example.com/v1/items" } }] }), actor: "t" }).tools.length).toBe(1);
    expect(svc.importConnector({ kind: "curl", name: "curl", raw: "curl -X GET https://example.com/v1/status", actor: "t" }).tools.length).toBe(1);
    expect(svc.importConnector({ kind: "mcp", name: "dhl", raw: JSON.stringify({ tools: [{ name: "dhl.shipments.track", description: "track", destructiveHint: false }] }), actor: "t" }).tools.length).toBe(1);
  });

  it("pao.connector.invoke rejects secrets", async () => {
    const tools = createMcpFabricMcpTools();
    const invoke = tools.find((t) => t.name === "pao.connector.invoke")!;
    const denied = await invoke.handler({ canonicalName: "crm.customers.get", args: { apiKey: "secret" } });
    expect(denied.ok).toBe(false);
  });
});

describe("phase 20.96 — AnythingMCP adapter contract, credentials, SkillsGate, rollback", () => {
  it("probes /health and executes via MCP tools/call, never faking success", async () => {
    let hitCall = false;
    const server = mcpBridge((_req, body) => {
      if (body.method === "initialize") {
        return Response.json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "mock-amcp", version: "test" } } });
      }
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "tools/call") {
        hitCall = true;
        const params = body.params as { name?: string };
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: { content: [{ type: "text", text: JSON.stringify({ live: true, echo: "from-bridge", tool: params?.name }) }] },
        });
      }
      return new Response("nope", { status: 404 });
    });
    try {
      const adapter = new AnythingMcpHttpAdapter(["http://127.0.0.1:" + server.port]);
      const health = await adapter.probe();
      expect(health.status).toBe("healthy");
      expect(health.configured).toBe(true);
      const result = await adapter.execute({ tool: "get_post", args: { id: 1 } });
      expect(hitCall).toBe(true);
      expect((result.payload as { live?: boolean }).live).toBe(true);
    } finally {
      server.stop(true);
    }
    const down = new AnythingMcpHttpAdapter(["http://127.0.0.1:9"]);
    await expect(down.execute({ tool: "x.y.z", args: {} })).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE" });
  });

  it("distinguishes unconfigured, unhealthy, timeout, and auth_failed health", async () => {
    const bare = new AnythingMcpHttpAdapter();
    const skipped = await bare.probe();
    expect(skipped.status).toBe("unconfigured");

    const unhealthy = Bun.serve({ port: 0, fetch: () => new Response("no", { status: 500 }) });
    const auth = Bun.serve({ port: 0, fetch: () => new Response("no", { status: 401 }) });
    const hanging = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) });
    try {
      expect((await new AnythingMcpHttpAdapter(["http://127.0.0.1:" + unhealthy.port]).probe()).status).toBe("unhealthy");
      expect((await new AnythingMcpHttpAdapter(["http://127.0.0.1:" + auth.port]).probe()).status).toBe("auth_failed");
      expect((await new AnythingMcpHttpAdapter(["http://127.0.0.1:" + hanging.port], { probeMs: 80 }).probe()).status).toBe("timeout");
    } finally {
      unhealthy.stop(true);
      auth.stop(true);
      hanging.stop(true);
    }
  });

  it("fails closed on MCP 5xx and does not treat it as success", async () => {
    const server = mcpBridge(() => new Response("boom", { status: 500 }));
    try {
      const adapter = new AnythingMcpHttpAdapter(["http://127.0.0.1:" + server.port]);
      await expect(adapter.execute({ tool: "get_post", args: { id: 1 } })).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE" });
    } finally {
      server.stop(true);
    }
  });

  it("does not invent a mock engine when only the AnythingMCP adapter is registered", async () => {
    const isolated = new McpFabricService([new AnythingMcpHttpAdapter(["http://127.0.0.1:9"])]);
    const { connector } = isolated.importConnector({ kind: "openapi", name: "crm-live-no-mock", raw: OPENAPI, actor: "tester" });
    isolated.approveConnector(connector.id, "reviewer", "ok");
    isolated.publishConnector(connector.id, "paohub-admin", "reviewer");
    const tool = isolated.listTools(connector.id).find((t) => t.canonicalName.includes("getcustomer"))!;
    await expect(isolated.execute({ toolId: tool.id, args: { id: "c1" }, actor: "tester", profile: "paohub-admin" })).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE" });
  });

  it("fail-closes when a tool is bound to a missing secret:// ref", async () => {
    const { connector } = svc.importConnector({
      kind: "openapi",
      name: "crm-secret",
      raw: OPENAPI,
      credentialRef: "secret://workspace/main/crm/missing",
      actor: "tester",
    });
    svc.approveConnector(connector.id, "reviewer", "ok");
    svc.publishConnector(connector.id, "paohub-admin", "reviewer");
    const tool = svc.listTools(connector.id).find((t) => t.canonicalName.includes("getcustomer"))!;
    try {
      await svc.execute({ toolId: tool.id, args: { id: "c1" }, actor: "tester", profile: "paohub-admin" });
      throw new Error("expected credential deny");
    } catch (err) {
      expect((err as McpFabricError).code).toBe("CREDENTIAL_DENIED");
    }
  });

  it("accepts a valid secret:// lease, denies wrong scope, and rejects an expired lease", async () => {
    const secretRef = "secret://workspace/main/crm/valid-lease";
    putSecret({ secretRef, secret: "mcp-test-token-not-for-logs", scopes: ["provider.call"], provider: "anythingmcp" });
    const { connector } = svc.importConnector({ kind: "openapi", name: "crm-lease-ok", raw: OPENAPI, credentialRef: secretRef, actor: "tester" });
    svc.approveConnector(connector.id, "reviewer", "ok");
    svc.publishConnector(connector.id, "paohub-admin", "reviewer");
    const tool = svc.listTools(connector.id).find((t) => t.canonicalName.includes("getcustomer"))!;
    const ok = await svc.execute({ toolId: tool.id, args: { id: "c1" }, actor: "tester", profile: "paohub-admin" });
    expect(ok.ok).toBe(true);

    const wrongRef = "secret://workspace/main/crm/wrong-scope";
    putSecret({ secretRef: wrongRef, secret: "mcp-test-token-not-for-logs", scopes: ["other.scope"], provider: "anythingmcp" });
    const wrong = svc.importConnector({ kind: "openapi", name: "crm-lease-scope", raw: OPENAPI, credentialRef: wrongRef, actor: "tester" });
    svc.approveConnector(wrong.connector.id, "reviewer", "ok");
    svc.publishConnector(wrong.connector.id, "paohub-admin", "reviewer");
    const wrongTool = svc.listTools(wrong.connector.id).find((t) => t.canonicalName.includes("getcustomer"))!;
    try {
      await svc.execute({ toolId: wrongTool.id, args: { id: "c1" }, actor: "tester", profile: "paohub-admin" });
      throw new Error("expected wrong-scope deny");
    } catch (err) {
      expect((err as McpFabricError).code).toBe("CREDENTIAL_DENIED");
    }

    const expiredRef = "secret://workspace/main/crm/expired-lease";
    putSecret({ secretRef: expiredRef, secret: "mcp-test-token-not-for-logs", scopes: ["provider.call"] });
    const lease = issueLease({ secretRef: expiredRef, runId: "run-expired", principal: "tester", ttlMs: 1, scopes: ["provider.call"] });
    await Bun.sleep(20);
    expect(() => revealForProviderCall(lease.leaseId)).toThrow(/expired|LEASE/i);
  });

  it("promotes a learned skill into SkillsGate without publishing it", async () => {
    const { connector } = svc.importConnector({ kind: "openapi", name: "crm-skill", raw: OPENAPI, actor: "tester" });
    svc.approveConnector(connector.id, "reviewer", "ok");
    svc.publishConnector(connector.id, "paohub-admin", "reviewer");
    const tool = svc.listTools(connector.id).find((t) => t.canonicalName.includes("getcustomer"))!;
    await svc.execute({ toolId: tool.id, args: { id: "c1" }, actor: "tester", profile: "paohub-admin" });
    const candidate = svc.listSkills()[0];
    expect(candidate).toBeTruthy();
    const promoted = await svc.promoteSkill(String(candidate!.id), "reviewer");
    expect(promoted.ok).toBe(true);
    expect(promoted.published).toBe(false);
    expect(promoted.skillId).toBeTruthy();
  });

  it("rolls a tool back to a retained version hash", () => {
    const { tools } = svc.importConnector({ kind: "openapi", name: "crm-rb", raw: OPENAPI, actor: "tester" });
    const tool = tools[0]!;
    const rolled = svc.rollbackTool(tool.id, 1, "reviewer");
    expect(rolled.version).toBe(1);
    expect(rolled.schemaHash).toBe(tool.schemaHash);
    expect(rolled.frozen).toBe(false);
  });
});
