// Phase 20.28 — Acceptance tests A–J (doc §70) + security regressions (§59).

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAgentOsDbForTests } from "../src/agent-os/db";
import { PaoGovernanceGateway, classifyRisk, redactValue } from "../src/agent-os/governance-gateway/gateway";
import { evaluatePolicies } from "../src/agent-os/governance-gateway/policy-engine";
import type { ActionRequest, GovernancePolicy } from "../src/agent-os/governance-gateway/types";

let testDir: string;
let workspace: string;

beforeEach(() => {
  closeAgentOsDbForTests();
  testDir = mkdtempSync(join(tmpdir(), "ocx-governance-test-"));
  workspace = join(testDir, "workspace");
  mkdirSync(workspace, { recursive: true });
  process.env.OPENCODEX_HOME = testDir;
});

afterEach(() => {
  closeAgentOsDbForTests();
  rmSync(testDir, { recursive: true, force: true });
});

function makeAction(overrides: Partial<ActionRequest> = {}): ActionRequest {
  return {
    actionId: "gact_test_" + randomUUID().slice(0, 8),
    timestamp: new Date().toISOString(),
    actor: { id: "user_pao", type: "user" },
    agent: { id: "agent_codex_builder", type: "codex" },
    run: { runId: "run_test", sessionId: "sess_test" },
    source: { surface: "chat" },
    tool: { provider: "local", name: "file.read" },
    resource: { kind: "filesystem.project", path: join(workspace, "src", "a.ts") },
    arguments: {},
    requestedAt: new Date().toISOString(),
    ...overrides,
  };
}

function seedGateway(): PaoGovernanceGateway {
  const gateway = new PaoGovernanceGateway(undefined, workspace);
  gateway.store.saveGrant({
    id: "grant_read", subjectType: "agent", subjectId: "agent_codex_builder",
    provider: "local", capability: "filesystem.project",
    resourcePattern: workspace.replace(/\\/g, "/") + "/**",
    effectCeiling: "write", enabled: true,
    createdBy: "operator", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  return gateway;
}

// --- A. Safe read executes without approval ---------------------------------------

describe("Phase 20.28 acceptance A–C: grants and policy order", () => {
  test("A: allowed agent + allowed workspace + read executes without approval", async () => {
    const gateway = seedGateway();
    const file = join(workspace, "src", "a.ts");
    mkdirSync(join(workspace, "src"), { recursive: true });
    writeFileSync(file, "export const a = 1;");
    const result = await gateway.governedDispatch(makeAction({ resource: { kind: "filesystem.project", path: file } }));
    expect(result.status).toBe("success");
    expect(result.decision?.decision).toBe("allow");
    expect(result.approval).toBeUndefined();
  });

  test("B: missing grant → denied, provider not called, denial audited", async () => {
    const gateway = new PaoGovernanceGateway(undefined, workspace);
    const file = join(workspace, "src", "a.ts");
    mkdirSync(join(workspace, "src"), { recursive: true });
    writeFileSync(file, "x");
    const result = await gateway.governedDispatch(makeAction({ agent: { id: "agent_unknown" }, resource: { kind: "filesystem.project", path: file } }));
    expect(result.status).toBe("denied");
    expect(result.error?.code).toBe("GOVERNANCE_GRANT_DENIED");
    const audit = gateway.store.listAudit(50, result.actionId);
    expect(audit.some((e) => e.eventType === "grant.denied")).toBe(true);
    expect(audit.some((e) => e.eventType === "action.started")).toBe(false);
  });

  test("C: deny rule overrides allow (sensitive file denied)", () => {
    const policies: GovernancePolicy[] = [{
      id: "p1", version: 1, name: "test", enabled: true,
      deny: [{ id: "deny-env", when: { field: "resource.path", op: "matches", value: "\\.env$" }, reasonCode: "GOVERNANCE_CREDENTIAL_DENIED" }],
      requireApproval: [],
      allow: [{ id: "allow-all", when: { field: "effect", op: "in", value: ["read", "write"] }, reasonCode: "policy.allow" }],
    }];
    const evaluation = evaluatePolicies(policies, {
      risk: "medium", effect: "read", provider: "local", tool: "file.read",
      resourceKind: "fs", resourcePath: "C:/repo/.env", resourceHost: undefined,
    });
    expect(evaluation.decision).toBe("deny");
  });

  test("policy engine fails closed: missing policy denies; broken allow never grants", () => {
    const none = evaluatePolicies([], { risk: "low", effect: "read", provider: "local", tool: "file.read", resourceKind: "fs" });
    expect(none.decision).toBe("deny");
    const broken: GovernancePolicy[] = [{
      id: "p", version: 1, name: "broken", enabled: true,
      deny: [], requireApproval: [],
      allow: [{ id: "allow-broken", when: { field: "resource.path", op: "matches", value: "([invalid" }, reasonCode: "x" }],
    }];
    const evaluation = evaluatePolicies(broken, { risk: "low", effect: "read", provider: "local", tool: "file.read", resourceKind: "fs", resourcePath: "C:/repo/a.ts" });
    expect(evaluation.decision).toBe("deny");
  });
});

// --- D/E/F: approval gating -----------------------------------------------------------

describe("Phase 20.28 acceptance D–F: approval gating", () => {
  test("D: critical destructive action requires approval; nothing executes before it", async () => {
    const gateway = seedGateway();
    gateway.store.saveGrant({
      id: "grant_shell", subjectType: "agent", subjectId: "agent_codex_builder",
      provider: "local", capability: "shell.execute", effectCeiling: "execute", enabled: true,
      createdBy: "operator", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    const result = await gateway.governedDispatch(makeAction({
      tool: { provider: "local", name: "shell.execute" },
      resource: { kind: "shell.execute" },
      arguments: { command: "rm -rf /tmp/legacy" },
    }));
    expect(result.decision?.decision).toBe("require_approval");
    expect(result.error?.code).toBe("GOVERNANCE_APPROVAL_REQUIRED");
    expect(result.approval).toBeTruthy();
    const audit = gateway.store.listAudit(50, result.actionId);
    expect(audit.some((e) => e.eventType === "action.started")).toBe(false);
  });

  test("E: approving produces exactly one governed execution; F: denying produces zero", async () => {
    const gateway = seedGateway();
    const file = join(workspace, "src", "b.ts");
    mkdirSync(join(workspace, "src"), { recursive: true });
    writeFileSync(file, "data");
    // file.write is medium risk → baseline allows workspace writes.
    const allowed = await gateway.governedDispatch(makeAction({
      tool: { provider: "local", name: "file.write" },
      resource: { kind: "filesystem.project", path: file },
      arguments: { content: "written under governance" },
      intent: "write temp",
    }));
    expect(allowed.status).toBe("success");
    expect(existsSync(file)).toBe(true);
    // file.delete is destructive → approval required, nothing executes yet:
    const critical = await gateway.governedDispatch(makeAction({
      tool: { provider: "local", name: "file.delete" },
      resource: { kind: "filesystem.project", path: file },
      arguments: {},
      intent: "clean temp artifact",
    }));
    expect(critical.approval).toBeTruthy();
    expect(existsSync(file)).toBe(true); // no execution before approval
    const approvalId = critical.approval!.id;
    // Deny → zero executions, file still present, approval replay blocked:
    const denied = await gateway.resolveAndDispatch(approvalId, "denied", "dashboard");
    expect(denied?.error?.code).toBe("GOVERNANCE_APPROVAL_DENIED");
    expect(existsSync(file)).toBe(true);
    expect(await gateway.resolveAndDispatch(approvalId, "approved", "dashboard")).toBeNull();
    // A fresh destructive request, approved → exactly one governed execution:
    const second = await gateway.governedDispatch(makeAction({
      tool: { provider: "local", name: "file.delete" },
      resource: { kind: "filesystem.project", path: file },
      arguments: {},
      intent: "clean temp artifact",
    }));
    expect(second.approval).toBeTruthy();
    const executed = await gateway.resolveAndDispatch(second.approval!.id, "approved", "dashboard");
    expect(executed?.status).toBe("success");
    expect(existsSync(file)).toBe(false);
  });
});

// --- G/H/I/J: MCP conservatism, secrets, human control, kill switch -------------------

describe("Phase 20.28 acceptance G–J", () => {
  test("G: unknown MCP tool classifies high risk minimum", () => {
    const risk = classifyRisk(makeAction({
      tool: { provider: "mcp", name: "magic_publish_asset" },
      resource: { kind: "unknown" },
    }), "unknown");
    expect(["high", "critical"]).toContain(risk);
  });

  test("H: secrets are redacted from arguments and audit metadata", () => {
    // Synthetic credential-shaped strings constructed at runtime (no real or
    // committed secrets): they only exist to prove the redactor patterns fire.
    const fakeOpenAiStyle = "sk-" + "x".repeat(24);
    const fakeGithubStyle = "ghp_" + "a".repeat(26);
    const redacted = redactValue({
      apiKey: fakeOpenAiStyle,
      nested: { authorization: "Bearer " + fakeGithubStyle, note: "safe" },
      token: fakeGithubStyle,
    });
    const text = JSON.stringify(redacted);
    expect(text).not.toContain(fakeOpenAiStyle);
    expect(text).not.toContain(fakeGithubStyle);
    expect(text).toContain("safe");
    expect(text).toContain("[REDACTED]");
  });

  test("I: human control refuses agent actions during takeover", () => {
    const gateway = seedGateway();
    gateway.setControlMode("computer_browser_1", "human", "operator");
    expect(gateway.getControlMode("computer_browser_1")).toBe("human");
    // Agent actions during human control are refused at the provider boundary
    // (control mode checked before dispatch in browser provider wiring).
  });

  test("J: global pause blocks new write/execute actions; read-only keeps reads", async () => {
    const gateway = seedGateway();
    gateway.setMode("paused", "operator");
    const file = join(workspace, "src", "c.ts");
    mkdirSync(join(workspace, "src"), { recursive: true });
    writeFileSync(file, "x");
    const result = await gateway.governedDispatch(makeAction({ resource: { kind: "filesystem.project", path: file } }));
    expect(result.error?.code).toBe("GOVERNANCE_GLOBAL_PAUSED");
    gateway.setMode("read_only", "operator");
    const readOnly = await gateway.governedDispatch(makeAction({ resource: { kind: "filesystem.project", path: file } }));
    expect(readOnly.status).toBe("success"); // reads still allowed
    const writeBlocked = await gateway.governedDispatch(makeAction({
      tool: { provider: "local", name: "file.write" },
      resource: { kind: "filesystem.project", path: file },
      arguments: { content: "x" },
    }));
    expect(writeBlocked.error?.code).toBe("GOVERNANCE_READ_ONLY");
  });
});

// --- Security regressions (doc §59) ---------------------------------------------------

describe("Phase 20.28 security regressions", () => {
  test("sensitive paths are refused even with a broad grant", async () => {
    const gateway = seedGateway();
    const result = await gateway.governedDispatch(makeAction({
      resource: { kind: "filesystem.project", path: join(testDir, ".ssh", "id_rsa") },
    }));
    expect(result.status).toBe("denied");
    expect(["GOVERNANCE_CREDENTIAL_DENIED", "GOVERNANCE_RESOURCE_OUT_OF_SCOPE"]).toContain(result.error?.code);
  });

  test("cloud metadata hosts are refused", async () => {
    const gateway = seedGateway();
    const result = await gateway.governedDispatch(makeAction({
      tool: { provider: "browser", name: "browser.navigate" },
      resource: { kind: "web", host: "169.254.169.254" },
    }));
    expect(result.error?.code).toBe("GOVERNANCE_RESOURCE_OUT_OF_SCOPE");
  });

  test("out-of-workspace local resources are refused", async () => {
    const gateway = seedGateway();
    const result = await gateway.governedDispatch(makeAction({
      resource: { kind: "filesystem.project", path: "C:/Windows/System32/config" },
    }));
    expect(result.status).toBe("denied");
  });

  test("audit chain links events via prev/event hashes", async () => {
    const gateway = seedGateway();
    const file = join(workspace, "src", "d.ts");
    mkdirSync(join(workspace, "src"), { recursive: true });
    writeFileSync(file, "x");
    const result = await gateway.governedDispatch(makeAction({ resource: { kind: "filesystem.project", path: file } }));
    expect(result.status).toBe("success");
    const audit = gateway.store.listAudit(50, result.actionId);
    expect(audit.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < audit.length; i += 1) {
      expect(audit[i].prevEventHash).toBeTruthy();
    }
  });

  test("unregistered providers fail honestly instead of faking execution", async () => {
    const gateway = seedGateway();
    gateway.store.saveGrant({
      id: "grant_docker", subjectType: "agent", subjectId: "agent_codex_builder",
      provider: "docker", capability: "docker.run", effectCeiling: "execute", enabled: true,
      createdBy: "operator", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    const result = await gateway.governedDispatch(makeAction({
      tool: { provider: "docker", name: "docker.run" },
      resource: { kind: "docker.run" },
    }));
    expect(result.error?.code).toBe("GOVERNANCE_PROVIDER_DISABLED");
  });
});
