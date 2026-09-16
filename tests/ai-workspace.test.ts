// Phase 20.33 — Pao-hubPro × Open WebUI AI workspace & MCP control plane tests.
// Covers the MCP JSON-RPC handshake and catalog (doc §49), governed tool
// execution through the Phase 20.28 pipeline (read allowed, write audited,
// destructive/execute approval-gated), fail-closed grants, workspace and
// protected-path invariants, argv shell discipline, secret redaction, pin
// guard, and degraded-not-dead aggregate health (doc §34).

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAgentOsDbForTests } from "../src/agent-os/db";
import { AiWorkspaceGateway, resetAiWorkspaceGatewayForTests } from "../src/agent-os/ai-workspace/gateway";
import { getSharedGovernanceGateway, resetGovernanceGatewayForTests } from "../src/server/management/governance-routes";
import { handleMcpRpc } from "../src/server/management/mcp-gateway-protocol";
import { PAO_TOOL_CATALOG } from "../src/agent-os/ai-workspace/catalog";
import type { CapabilityGrant } from "../src/agent-os/governance-gateway/types";

let scratch: string;
let originalCwd: string;
let gateway: AiWorkspaceGateway;

const ACTOR = "openwebui-user";

beforeEach(() => {
  closeAgentOsDbForTests();
  resetGovernanceGatewayForTests();
  resetAiWorkspaceGatewayForTests();
  const outer = mkdtempSync(join(tmpdir(), "ocx-aiws-home-"));
  process.env.OPENCODEX_HOME = outer;
  delete process.env.OPEN_WEBUI_INTERNAL_URL;
  delete process.env.OPEN_WEBUI_IMAGE;
  delete process.env.PAO_ALLOWED_WORKSPACE_ROOTS;
  // The governance gateway binds the process cwd as its workspace scope.
  originalCwd = process.cwd();
  scratch = join(originalCwd, ".tmp", "aiws-" + Date.now().toString(36));
  mkdirSync(scratch, { recursive: true });
  process.chdir(scratch);
  gateway = new AiWorkspaceGateway();
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(scratch, { recursive: true, force: true });
  closeAgentOsDbForTests();
  resetGovernanceGatewayForTests();
  resetAiWorkspaceGatewayForTests();
});

function grant(effect: string, provider: string, capability: string): void {
  const now = new Date().toISOString();
  const record: CapabilityGrant = {
    id: "gnt_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    subjectType: "user",
    subjectId: ACTOR,
    provider,
    capability,
    effectCeiling: effect as CapabilityGrant["effectCeiling"],
    enabled: true,
    createdBy: "operator",
    createdAt: now,
    updatedAt: now,
  };
  getSharedGovernanceGateway().store.saveGrant(record);
}

// --- Catalog & MCP protocol -----------------------------------------------------

describe("Phase 20.33 pao.* catalog and MCP protocol", () => {
  test("catalog carries risk metadata and never embeds secret material", () => {
    expect(PAO_TOOL_CATALOG.length).toBeGreaterThan(10);
    for (const entry of PAO_TOOL_CATALOG) {
      expect(entry.name.startsWith("pao.")).toBe(true);
      expect(["read", "write-low", "write-high", "execute", "network", "deploy", "delete", "credential"]).toContain(entry.risk);
      expect(entry.audit).toBe(true);
      if (entry.executor === "governed") {
        expect(entry.provider).toBeTruthy();
        expect(entry.capability).toBeTruthy();
        expect(entry.effect).toBeTruthy();
      } else {
        expect(entry.availableVia).toBeTruthy();
      }
    }
    expect(JSON.stringify(PAO_TOOL_CATALOG).toLowerCase()).not.toContain("apikey=");
  });

  test("MCP initialize and tools/list speak JSON-RPC", async () => {
    const init = await handleMcpRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
    const initResult = (init as { result?: Record<string, unknown> })?.result as Record<string, unknown> | undefined;
    expect(initResult?.serverInfo).toBeTruthy();

    const listing = await handleMcpRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const tools = ((listing as { result?: { tools?: Array<Record<string, unknown>> } })?.result?.tools ?? []) as Array<Record<string, unknown>>;
    expect(tools.length).toBe(PAO_TOOL_CATALOG.length);
    const read = tools.find((tool) => tool.name === "pao.files.read") as Record<string, unknown>;
    expect((read.annotations as Record<string, unknown>).risk).toBe("read");
    expect((read.annotations as Record<string, unknown>).executable).toBe(true);

    const notification = await handleMcpRpc({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(notification).toBeNull();

    const bad = await handleMcpRpc({ jsonrpc: "2.0", id: 3, method: "definitely/not/a/method" });
    expect((bad as { error?: { code: number } }).error?.code).toBe(-32601);
  });

  test("unknown tools and surface tools fail honestly", async () => {
    const unknown = await gateway.callTool({ name: "pao.doesnotexist", args: {}, actor: ACTOR });
    expect(unknown.status).toBe("unknown_tool");
    const surface = await gateway.callTool({ name: "pao.video.generate", args: { subject: "x" }, actor: ACTOR });
    expect(surface.status).toBe("surface");
    expect(surface.availableVia).toContain("Video Factory");
  });
});

// --- Governed execution -------------------------------------------------------------

describe("Phase 20.33 governed tool execution", () => {
  test("fail-closed: no grant means denial even for reads", async () => {
    const outcome = await gateway.callTool({ name: "pao.system.health", args: {}, actor: ACTOR });
    expect(outcome.status).toBe("denied");
    expect(outcome.error?.code).toBe("GOVERNANCE_GRANT_DENIED");
  });

  test("read tool executes when granted; write is allowed and audited in-scope", async () => {
    grant("read", "pao-meta", "system.health");
    const health = await gateway.callTool({ name: "pao.system.health", args: {}, actor: ACTOR });
    expect(health.status).toBe("success");
    expect((health.output as Record<string, unknown>).governanceMode).toBe("normal");

    writeFileSync(join(scratch, "hello.txt"), "hello pao", "utf8");
    grant("read", "local", "file.read");
    const read = await gateway.callTool({ name: "pao.files.read", args: { path: join(scratch, "hello.txt") }, actor: ACTOR });
    expect(read.status).toBe("success");
    expect((read.output as Record<string, unknown>).preview).toContain("hello pao");

    grant("write", "local", "file.write");
    const write = await gateway.callTool({ name: "pao.files.write", args: { path: join(scratch, "out.txt"), content: "written" }, actor: ACTOR });
    expect(write.status).toBe("success");
    const audit = getSharedGovernanceGateway().store.listAudit(5);
    expect(audit.some((entry) => entry.eventType === "action.succeeded")).toBe(true);
  });

  test("out-of-scope and protected paths are denied before execution", async () => {
    grant("read", "local", "file.read");
    const outside = await gateway.callTool({ name: "pao.files.read", args: { path: join(tmpdir(), "definitely-outside.txt") }, actor: ACTOR });
    expect(outside.status).toBe("denied");
    expect(outside.error?.code).toBe("GOVERNANCE_RESOURCE_OUT_OF_SCOPE");

    const envFile = join(scratch, ".env");
    writeFileSync(envFile, "SECRET=1", "utf8");
    const protectedPath = await gateway.callTool({ name: "pao.files.read", args: { path: envFile }, actor: ACTOR });
    expect(protectedPath.status).toBe("denied");
    expect(protectedPath.error?.code).toBe("GOVERNANCE_CREDENTIAL_DENIED");
  });

  test("destructive and execute tools require human approval; approval re-call executes once", async () => {
    grant("destructive", "local", "file.delete");
    grant("execute", "pao-shell", "shell.execute");
    writeFileSync(join(scratch, "doomed.txt"), "bye", "utf8");

    const del = await gateway.callTool({ name: "pao.files.delete", args: { path: join(scratch, "doomed.txt") }, actor: ACTOR });
    expect(del.status).toBe("approval_required");
    expect(del.approvalId).toBeTruthy();

    // Re-call with a bogus/mismatched approval is refused.
    const badRe = await gateway.callTool({ name: "pao.files.delete", args: { path: join(scratch, "doomed.txt") }, actor: ACTOR, approvalId: "gappr_nonexistent" });
    expect(badRe.status).toBe("approval_invalid");

    // Human resolves via the governance surface (dashboard); the re-call
    // must present the SAME arguments and the SAME approval id.
    const gov = getSharedGovernanceGateway();
    const approval = gov.store.getApproval(del.approvalId!)!;
    gov.store.saveApproval({ ...approval, status: "approved", resolvedAt: new Date().toISOString(), resolvedBy: "dashboard" });
    const executed = await gateway.callTool({ name: "pao.files.delete", args: { path: join(scratch, "doomed.txt") }, actor: ACTOR, approvalId: del.approvalId });
    expect(executed.status).toBe("success");

    // Shell execute: approval first…
    const shell = await gateway.callTool({ name: "pao.shell.execute", args: { binary: "bun", args: "[\"--version\"]", cwd: scratch }, actor: ACTOR });
    expect(shell.status).toBe("approval_required");
    const shellApproval = gov.store.getApproval(shell.approvalId!)!;
    gov.store.saveApproval({ ...shellApproval, status: "approved", resolvedAt: new Date().toISOString(), resolvedBy: "dashboard" });
    const shellRun = await gateway.callTool({ name: "pao.shell.execute", args: { binary: "bun", args: "[\"--version\"]", cwd: scratch }, actor: ACTOR, approvalId: shell.approvalId });
    expect(shellRun.status).toBe("success");
    expect((shellRun.output as Record<string, unknown>).exitCode).toBe(0);
  });

  test("shell provider enforces argv discipline, cwd containment and interpreter ban", async () => {
    grant("execute", "pao-shell", "shell.execute");
    const gov = getSharedGovernanceGateway();
    const requestShell = async (args: Record<string, unknown>) => {
      const outcome = await gateway.callTool({ name: "pao.shell.execute", args, actor: ACTOR });
      expect(outcome.status).toBe("approval_required");
      const approval = gov.store.getApproval(outcome.approvalId!)!;
      gov.store.saveApproval({ ...approval, status: "approved", resolvedAt: new Date().toISOString(), resolvedBy: "dashboard" });
      return gateway.callTool({ name: "pao.shell.execute", args, actor: ACTOR, approvalId: outcome.approvalId });
    };

    const interpreter = await requestShell({ binary: "bash", args: "[-c, id]", cwd: scratch });
    expect(interpreter.status).toBe("failed");
    expect((interpreter.output as Record<string, unknown>)?.["output"]).toBeUndefined();

    const badArgs = await requestShell({ binary: "bun", args: "bun --version", cwd: scratch });
    expect(badArgs.status).toBe("failed");

    const outsideCwd = await requestShell({ binary: "bun", args: "[\"--version\"]", cwd: tmpdir() });
    expect(outsideCwd.status).toBe("failed");

    // Approval previews are redacted: a credential-shaped argument never
    // reaches the approval record in clear (doc §28).
    const secret = "sk-" + "roundedsecret123";
    const secretOutcome = await gateway.callTool({ name: "pao.shell.execute", args: { binary: "bun", args: JSON.stringify(["run", secret]), cwd: scratch }, actor: ACTOR });
    const preview = JSON.stringify(getSharedGovernanceGateway().store.getApproval(secretOutcome.approvalId!)?.argumentPreview);
    expect(preview).not.toContain(secret);
  });
});

// --- Health & Open WebUI status ---------------------------------------------------------

describe("Phase 20.33 aggregate health and pin guard", () => {
  test("health degrades optional components without dying (doc §34)", async () => {
    const health = await gateway.health();
    const components = health.components as Record<string, Record<string, unknown>>;
    expect(health.overall).toBe("healthy");
    expect(components.governance.state).toBe("healthy");
    expect(components.llmRouter.state).toBe("healthy");
    expect((components.openWebui as Record<string, unknown>).reachable).toBeNull();
    expect((components.optional as Record<string, unknown>).douyinProvider).toBeDefined();
  });

  test("rolling image tags are flagged; the pinned default is v0.11.3", async () => {
    process.env.OPEN_WEBUI_IMAGE = "ghcr.io/open-webui/open-webui:main";
    const rolling = await gateway.openWebuiStatus();
    expect(rolling.versionPinned).toBe(false);
    expect((rolling.problems as string[]).length).toBeGreaterThan(0);

    delete process.env.OPEN_WEBUI_IMAGE;
    const pinned = await gateway.openWebuiStatus();
    expect(pinned.version).toBe("v0.11.3");
    expect(pinned.versionPinned).toBe(true);
  });
});
