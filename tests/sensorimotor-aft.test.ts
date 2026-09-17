// Phase 20.82 — CortexKit AFT Extended Test Suite
//
// Covers git.mutate handler, perception REST routes, readiness diagnostics,
// MCP tool registration, and decision engine integration.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addPolicy, clearPolicies } from "../src/agent-os/policy";
import { openAgentOsDb } from "../src/agent-os/db";
import { getSensorimotorService } from "../src/agent-os/sensorimotor/service";
import { createSensorimotorMcpTools } from "../src/agent-os/sensorimotor/mcp-tools";
import { SensorimotorError } from "../src/agent-os/sensorimotor/types";
import { handleSensorimotorRoutes } from "../src/server/management/sensorimotor-routes";
import type { ManagementContext } from "../src/server/management/context";
import { getMcpToolGateway } from "../src/agent-os/mcp-gateway/gateway";
import { getDecisionEngine } from "../src/agent-os/decision/engine";

function grantApproval(capability: string): void {
  openAgentOsDb().run(
    "INSERT INTO approvals (id, capability, reason, status, requested_ms, decided_ms, decided_by) VALUES (?, ?, ?, 'granted', ?, ?, 'test')",
    [`appr_aft_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, capability, "aft test", Date.now(), Date.now()],
  );
}

function makeCtx(method: string, path: string, body?: unknown): ManagementContext {
  const req = new Request(`http://localhost:10100${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
  });
  return {
    req,
    url: new URL(req.url),
    config: {} as never,
    deps: {} as never,
  } as unknown as ManagementContext;
}

describe("Phase 20.82 — CortexKit AFT: git.mutate handler", () => {
  let wsRoot: string;

  beforeEach(() => {
    wsRoot = mkdtempSync(join(tmpdir(), "pao-aft-git-"));
    clearPolicies();
    openAgentOsDb().exec("DELETE FROM approvals");
  });

  afterEach(() => {
    rmSync(wsRoot, { recursive: true, force: true });
  });

  it("executes a safe git command (git status) successfully", async () => {
    addPolicy({ subjectType: "global", capability: "shell.exec", effect: "allow" });
    grantApproval("shell.exec");

    const { SafeImplementationRunner } = await import("../src/agent-os/sdlc/runner");
    await SafeImplementationRunner.runCommand(["git", "init"], { cwd: wsRoot });

    const service = getSensorimotorService();
    const session = service.createSession({ workspaceRoot: wsRoot, actorId: "tester" });

    const outcome = await service.executeAction({
      sessionId: session.id,
      kind: "git.mutate",
      target: "git",
      content: "status",
      maxAttempts: 1,
    });

    expect(outcome.status).toBe("succeeded");
    expect(outcome.kind).toBe("git.mutate");
  });

  it("blocks git push as a destructive subcommand", async () => {
    addPolicy({ subjectType: "global", capability: "shell.exec", effect: "allow" });
    grantApproval("shell.exec");

    const service = getSensorimotorService();
    const session = service.createSession({ workspaceRoot: wsRoot, actorId: "tester" });

    const outcome = await service.executeAction({
      sessionId: session.id,
      kind: "git.mutate",
      target: "git",
      content: "push origin main",
      maxAttempts: 1,
    });

    expect(outcome.status).toBe("failed");
    expect(outcome.error?.code).toBe("SENSORIMOTOR_POLICY_DENIED");
  });

  it("blocks git reset --hard", async () => {
    addPolicy({ subjectType: "global", capability: "shell.exec", effect: "allow" });
    grantApproval("shell.exec");

    const service = getSensorimotorService();
    const session = service.createSession({ workspaceRoot: wsRoot, actorId: "tester" });

    const outcome = await service.executeAction({
      sessionId: session.id,
      kind: "git.mutate",
      target: "git",
      content: "reset --hard HEAD~1",
      maxAttempts: 1,
    });

    expect(outcome.status).toBe("failed");
    expect(outcome.error?.code).toBe("SENSORIMOTOR_POLICY_DENIED");
  });

  it("rejects non-git target binary for git.mutate", async () => {
    addPolicy({ subjectType: "global", capability: "shell.exec", effect: "allow" });
    grantApproval("shell.exec");

    const service = getSensorimotorService();
    const session = service.createSession({ workspaceRoot: wsRoot, actorId: "tester" });

    const outcome = await service.executeAction({
      sessionId: session.id,
      kind: "git.mutate",
      target: "rm",
      content: "-rf /",
      maxAttempts: 1,
    });

    expect(outcome.status).toBe("failed");
    expect(["SENSORIMOTOR_INVALID_ACTION", "SENSORIMOTOR_PATH_OUTSIDE_WORKSPACE"]).toContain(outcome.error?.code);
  });

  it("allows git add and git commit (non-destructive)", async () => {
    addPolicy({ subjectType: "global", capability: "shell.exec", effect: "allow" });
    grantApproval("shell.exec");

    const { SafeImplementationRunner } = await import("../src/agent-os/sdlc/runner");
    await SafeImplementationRunner.runCommand(["git", "init"], { cwd: wsRoot });
    await SafeImplementationRunner.runCommand(["git", "config", "user.email", "test@test.com"], { cwd: wsRoot });
    await SafeImplementationRunner.runCommand(["git", "config", "user.name", "Test"], { cwd: wsRoot });
    writeFileSync(join(wsRoot, "file.txt"), "content");

    const service = getSensorimotorService();
    const session = service.createSession({ workspaceRoot: wsRoot, actorId: "tester" });

    const addOutcome = await service.executeAction({
      sessionId: session.id,
      kind: "git.mutate",
      target: "git",
      content: "add -A",
      maxAttempts: 1,
    });
    expect(addOutcome.status).toBe("succeeded");

    const commitOutcome = await service.executeAction({
      sessionId: session.id,
      kind: "git.mutate",
      target: "git",
      content: "commit -m aft-test-commit",
      maxAttempts: 1,
    });
    expect(commitOutcome.status).toBe("succeeded");
  });
});

describe("Phase 20.82 — CortexKit AFT: perception + readiness REST routes", () => {
  let wsRoot: string;

  beforeEach(() => {
    wsRoot = mkdtempSync(join(tmpdir(), "pao-aft-routes2-"));
    clearPolicies();
    openAgentOsDb().exec("DELETE FROM approvals");
  });

  afterEach(() => {
    rmSync(wsRoot, { recursive: true, force: true });
  });

  it("perceives workspace via REST and retrieves stored perception", async () => {
    writeFileSync(join(wsRoot, "hello.ts"), "export const x = 1;\n");

    const createRes = await handleSensorimotorRoutes(
      makeCtx("POST", "/api/agent-os/sensorimotor/sessions", { workspaceRoot: wsRoot, actorId: "perceiver" }),
    );
    const { session } = (await createRes!.json()) as { session: { id: string } };

    const perceiveRes = await handleSensorimotorRoutes(
      makeCtx("POST", "/api/agent-os/sensorimotor/perceive", { sessionId: session.id, kind: "tree" }),
    );
    expect(perceiveRes!.status).toBe(200);
    const pBody = (await perceiveRes!.json()) as { ok: boolean; perception: { perceptionId: string; fileCount: number } };
    expect(pBody.ok).toBe(true);
    expect(pBody.perception.fileCount).toBeGreaterThanOrEqual(1);

    const getRes = await handleSensorimotorRoutes(
      makeCtx("GET", `/api/agent-os/sensorimotor/perceptions/${pBody.perception.perceptionId}`),
    );
    expect(getRes!.status).toBe(200);
    const gBody = (await getRes!.json()) as { ok: boolean; perception: { contentHash: string } };
    expect(gBody.ok).toBe(true);
    expect(gBody.perception.contentHash).toBeTruthy();
  });

  it("returns component readiness matrix with OmniRoute and TypeSafe Jev status", async () => {
    const res = await handleSensorimotorRoutes(makeCtx("GET", "/api/agent-os/sensorimotor/readiness"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as {
      ok: boolean;
      phase: string;
      traceId: string;
      components: {
        sensorimotorRuntime: { status: string };
        omniroute: { status: string; detail: string };
        typesafeJev: { status: string; detail: string; meta: { mode: string } };
      };
      mcp: { toolCount: number | null };
    };
    expect(body.phase).toBe("20.82");
    expect(body.traceId).toMatch(/^aft_rdy_/);
    expect(body.components.sensorimotorRuntime.status).toBe("ok");
    // No OmniRoute daemon in test env → degraded, never unavailable/dead
    expect(body.components.omniroute.status).toBe("degraded");
    expect(body.components.omniroute.detail).toContain("local-only");
    expect(body.components.typesafeJev.detail).not.toContain("TODO_PROVIDER_SCHEMA");
    expect(body.components.typesafeJev.meta.mode).toBe("simulated");
    expect(body.mcp.toolCount).toBeGreaterThan(0);
  });

  it("rejects perceive without sessionId", async () => {
    const res = await handleSensorimotorRoutes(
      makeCtx("POST", "/api/agent-os/sensorimotor/perceive", { kind: "tree" }),
    );
    expect(res!.status).toBe(400);
  });
});

describe("Phase 20.82 — CortexKit AFT: MCP tool registration", () => {
  it("registers sensorimotor tools in the MCP gateway", () => {
    const gateway = getMcpToolGateway();
    const allTools = gateway.listTools();
    const aftTools = allTools.filter((t) => t.name.startsWith("pao.aft."));
    expect(aftTools.length).toBeGreaterThanOrEqual(3);
    expect(aftTools.some((t) => t.name === "pao.aft.health")).toBe(true);
    expect(aftTools.some((t) => t.name === "pao.aft.perceive")).toBe(true);
    expect(aftTools.some((t) => t.name === "pao.aft.act")).toBe(true);
  });

  it("creates MCP tools with correct risk tiers", () => {
    const service = getSensorimotorService();
    const mcpTools = createSensorimotorMcpTools(service);
    const health = mcpTools.find((t) => t.name === "pao.aft.health");
    const shell = mcpTools.find((t) => t.name === "pao.aft.shell");
    const git = mcpTools.find((t) => t.name === "pao.aft.git");
    expect(health?.riskTier).toBe("R0");
    expect(shell?.riskTier).toBe("R3");
    expect(git?.riskTier).toBe("R3");
  });

  it("health MCP tool returns valid runtime data", async () => {
    const service = getSensorimotorService();
    const mcpTools = createSensorimotorMcpTools(service);
    const healthTool = mcpTools.find((t) => t.name === "pao.aft.health")!;
    const result = await healthTool.handler({});
    expect(result.ok).toBe(true);
    expect(result.policyVersion).toBe("aft-1");
  });
});

describe("Phase 20.82 — CortexKit AFT: Decision Engine integration", () => {
  it("registers the mode-aware Jev provider set in the engine", () => {
    const engine = getDecisionEngine();
    const providers = (engine as unknown as { providerRegistry: Record<string, unknown> }).providerRegistry;
    expect(Object.keys(providers)).toContain("typesafe-jev"); // real (structured-unavailable without creds/schema)
    expect(Object.keys(providers)).toContain("typesafe-jev-simulated");
    expect(Object.keys(providers)).toContain("deterministic");
    expect(engine.providerMode).toBe("simulated");
  });

  it("simulated provider answers by default in test configuration", async () => {
    const engine = getDecisionEngine();
    const result = await engine.evaluate({
      requestId: "test-aft-decision-1",
      contractId: "agent.route",
      state: { context: "sensorimotor-test" },
    });
    expect(result.disposition).toBe("allow");
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.provider).toBe("typesafe-jev-simulated");
  });
});
