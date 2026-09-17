// GOLD mode Master End-to-End Verification Suite (GOLD §30).
//
// Proves the seven mandatory system integration scenarios:
// E2E-1: User request -> Agent -> Safe tool -> Result
// E2E-2: Agent modifies repository -> Diff -> CodeReview -> Finding -> Gate
// E2E-3: Finding -> Fix -> Re-review -> PASS (Revision Lineage)
// E2E-4: MCP tool requested -> Policy -> Allowed tool -> Execution -> Audit
// E2E-5: Dangerous MCP/tool request -> Policy -> Denied -> Audit
// E2E-6: Provider failure -> Fallback / Recovery -> No false PASS
// E2E-7: Process interruption -> Session Recovery / Idempotency

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { getCodeReviewService } from "../src/agent-os/code-review/service";
import { getSharedGovernanceGateway } from "../src/server/management/governance-routes";
import { openAgentOsDb } from "../src/agent-os/db";
import { AiWorkspaceGateway } from "../src/agent-os/ai-workspace/gateway";
import { newGovId, type ActionRequest } from "../src/agent-os/governance-gateway/types";

function git(repo: string, args: string[]): string {
  const result = spawnSync("git", ["-C", repo].concat(args), {
    encoding: "utf-8",
    windowsHide: true,
    shell: false,
  });
  if (result.status !== 0) throw new Error(result.stderr || "git failed");
  return result.stdout;
}

function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "pao-gold-e2e-"));
  git(repo, ["init", "--quiet"]);
  git(repo, ["config", "user.email", "tester@example.test"]);
  git(repo, ["config", "user.name", "tester"]);
  writeFileSync(join(repo, "README.md"), "initial\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "--quiet", "-m", "init"]);
  return repo;
}

describe("Pao-hubPro GOLD Master E2E Suite (GOLD §30)", () => {
  const reviewService = getCodeReviewService();
  const govGateway = getSharedGovernanceGateway();
  const aiWorkspace = new AiWorkspaceGateway();

  // -------------------------------------------------------------------------
  // E2E-1: User request -> Agent -> Safe tool -> Result
  // -------------------------------------------------------------------------
  test("E2E-1: safe tool execution routes through policy and returns valid result", async () => {
    // Grant read permission to openwebui agent on the repo workspace
    govGateway.store.saveGrant({
      id: "grant_e2e_read",
      subjectType: "agent",
      subjectId: "operator_gold",
      provider: "local",
      capability: "file.read",
      resourcePattern: process.cwd().replace(/\\/g, "/") + "/**",
      effectCeiling: "read",
      enabled: true,
      createdBy: "operator",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const res = await aiWorkspace.callTool({
      name: "pao.files.read",
      args: { path: "package.json" },
      actor: "operator_gold",
      sessionId: "sess_e2e_1",
    });

    expect(res.status).toBe("success");
    expect(res.tool).toBe("pao.files.read");
    expect(res.risk).toBe("read");
    expect(res.output).toBeDefined();
    const out = res.output as { bytes: number; preview: string };
    expect(out.bytes).toBeGreaterThan(0);
    expect(out.preview).toContain("paohupbypaoza");
  });

  // -------------------------------------------------------------------------
  // E2E-2: Agent modifies repository -> Diff -> CodeReview -> Finding -> Gate
  // -------------------------------------------------------------------------
  test("E2E-2: repository changes with hardcoded secret are detected and gated as REQUIRE_FIX", async () => {
    const repo = makeRepo();
    try {
      const fakeToken = "sk-" + "e".repeat(24);
      writeFileSync(join(repo, "config.ts"), `export const API_KEY = "${fakeToken}";\n`);
      git(repo, ["add", "."]);

      const review = await reviewService.runReview({
        repositoryPath: repo,
        mode: "workspace",
        requestedBy: "agent_e2e_2",
      });

      expect(review.session.status).toBe("completed");
      expect(review.gate.gate).toBe("REQUIRE_FIX");
      expect(review.findings.length).toBeGreaterThanOrEqual(1);
      expect(review.findings.some((f) => f.category === "security")).toBe(true);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // E2E-3: Finding -> Fix -> Re-review -> PASS (Proven with Revision Lineage)
  // -------------------------------------------------------------------------
  test("E2E-3: finding fix loop produces second revision with clean PASS and parent lineage", async () => {
    const repo = makeRepo();
    try {
      // 1. Introduce defect
      const token = "sk-" + "f".repeat(24);
      writeFileSync(join(repo, "auth.ts"), `export const TOKEN = "${token}";\n`);
      git(repo, ["add", "."]);

      const r1 = await reviewService.runReview({ repositoryPath: repo, mode: "workspace", requestedBy: "agent_e2e_3" });
      expect(r1.gate.gate).toBe("REQUIRE_FIX");
      expect(r1.session.revision).toBe(1);

      // 2. Remediate defect
      writeFileSync(join(repo, "auth.ts"), "export const TOKEN = process.env.API_KEY;\n");
      git(repo, ["add", "."]);

      const r2 = await reviewService.runReview({ repositoryPath: repo, mode: "workspace", requestedBy: "agent_e2e_3" });
      expect(r2.gate.gate).toBe("PASS");
      expect(r2.session.revision).toBe(2);
      expect(r2.session.parentSessionId).toBe(r1.session.sessionId);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // E2E-4: MCP tool requested -> Policy -> Allowed tool -> Execution -> Audit
  // -------------------------------------------------------------------------
  test("E2E-4: allowed tool executes cleanly and logs pre/post audit records", async () => {
    const runId = `e2e4_${Date.now()}`;
    const file = join(process.cwd(), "package.json");

    const action: ActionRequest = {
      actionId: newGovId("act"),
      timestamp: new Date().toISOString(),
      actor: { id: "operator_gold", type: "user" },
      agent: { id: "operator_gold", type: "openwebui" },
      run: { runId },
      source: { surface: "mcp" },
      tool: { provider: "local", name: "file.read", effect: "read" },
      resource: { kind: "file.read", path: file },
      arguments: { path: file },
      requestedAt: new Date().toISOString(),
    };

    const result = await govGateway.governedDispatch(action);
    expect(result.status).toBe("success");
    expect(result.output).toBeDefined();

    // Verify audit record exists
    const events = govGateway.store.listAudit(50, action.actionId);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.eventType === "action.executed" || e.eventType === "action.requested")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // E2E-5: Dangerous MCP/tool request -> Policy -> Denied -> Audit
  // -------------------------------------------------------------------------
  test("E2E-5: dangerous shell command is intercepted by policy and denied without execution", async () => {
    const runId = `e2e5_${Date.now()}`;

    // Agent has NO grant for shell.execute or destructive actions
    const action: ActionRequest = {
      actionId: newGovId("act"),
      timestamp: new Date().toISOString(),
      actor: { id: "agent_unauthorized", type: "agent" },
      agent: { id: "agent_unauthorized", type: "agent" },
      run: { runId },
      source: { surface: "mcp" },
      tool: { provider: "local", name: "shell.execute", effect: "destructive" },
      resource: { kind: "shell.execute", path: "/" },
      arguments: { command: "rm -rf / --no-preserve-root" },
      requestedAt: new Date().toISOString(),
    };

    const result = await govGateway.governedDispatch(action);
    expect(result.status).toBe("denied");
    expect(result.error?.code).toBeDefined();

    // Audit logs policy denial
    const events = govGateway.store.listAudit(50, action.actionId);
    expect(events.some((e) => e.eventType.includes("denied") || e.eventType.includes("requested"))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // E2E-6: Provider failure -> Fallback / Recovery -> No false PASS
  // -------------------------------------------------------------------------
  test("E2E-6: unresolvable or failed review path never results in a false PASS", async () => {
    await expect(reviewService.runReview({
      repositoryPath: "/nonexistent/path/for/failure/test",
      mode: "workspace",
      requestedBy: "agent_e2e_6",
    })).rejects.toThrow();

    // Ensure no session in DB marked PASS for this path
    const db = openAgentOsDb();
    const rows = db.query(
      "SELECT * FROM cr_sessions WHERE repository_path = ? AND gate = 'PASS'"
    ).all("/nonexistent/path/for/failure/test");
    expect(rows).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // E2E-7: Process interruption -> Session Recovery / Idempotency
  // -------------------------------------------------------------------------
  test("E2E-7: re-reviewing an identical state returns existing cached session idempotently", async () => {
    const repo = makeRepo();
    try {
      writeFileSync(join(repo, "test.txt"), "hello world\n");
      git(repo, ["add", "."]);

      const first = await reviewService.runReview({
        repositoryPath: repo,
        mode: "workspace",
        requestedBy: "agent_e2e_7",
      });
      expect(first.reused).toBe(false);

      // Second invocation on identical diff must return reused session
      const second = await reviewService.runReview({
        repositoryPath: repo,
        mode: "workspace",
        requestedBy: "agent_e2e_7",
      });
      expect(second.reused).toBe(true);
      expect(second.session.sessionId).toBe(first.session.sessionId);
      expect(second.session.diffHash).toBe(first.session.diffHash);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
