import { describe, expect, it } from "bun:test";
import {
  ManagedZCodeRuntimeAdapter,
  ZCodeMcpSkillsBridge,
  ZCodePermissionBridge,
  ZCodeProviderBridge,
  ZCodeWorkflowBridge,
} from "../src/agent-os/zcode";

describe("Phase 20.100 — Pao-hubPro × ZCode Integration", () => {
  describe("ZCodeProviderBridge", () => {
    it("creates, tracks, and limits provider leases", () => {
      const bridge = new ZCodeProviderBridge();
      const lease = bridge.createLease({
        providerId: "openai",
        modelId: "gpt-5.6-sol",
        credentialRef: "cred_ref_01",
        maxCostUsd: 1.0,
      });

      expect(lease.providerId).toBe("openai");
      expect(lease.modelId).toBe("gpt-5.6-sol");
      expect(lease.activeCostUsd).toBe(0);

      bridge.recordUsage(lease.leaseId, 1000, 0.05);
      const updated = bridge.getLease(lease.leaseId);
      expect(updated?.activeCostUsd).toBe(0.05);

      // Exceed budget triggers error
      expect(() => bridge.recordUsage(lease.leaseId, 50000, 1.5)).toThrow(/exceeded cost budget/);
    });

    it("handles audited provider failover", () => {
      const bridge = new ZCodeProviderBridge();
      const lease = bridge.createLease({
        providerId: "anthropic",
        modelId: "claude-sonnet-4-6",
        credentialRef: "cred_ref_02",
        fallbackChain: ["openai/gpt-5.6-sol", "google-antigravity/gemini-3.7-flash"],
      });

      const failedOver = bridge.failover(lease.leaseId, "rate_limit_429");
      expect(failedOver.modelId).toBe("openai/gpt-5.6-sol");

      const logs = bridge.listFailoverLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].fromModel).toBe("claude-sonnet-4-6");
      expect(logs[0].toModel).toBe("openai/gpt-5.6-sol");
      expect(logs[0].reason).toBe("rate_limit_429");
    });
  });

  describe("ZCodePermissionBridge", () => {
    it("denies hard policy violations (destructive commands, path traversal, credential access)", async () => {
      const bridge = new ZCodePermissionBridge();

      // Destructive command
      const res1 = await bridge.evaluateTool({
        sessionId: "sess_1",
        toolName: "shell",
        args: { command: "rm -rf /" },
        runtimeMode: "BUILD",
        workspacePath: "/workspace",
        sideEffectScope: "shell.local",
      });
      expect(res1.decision).toBe("deny");
      expect(res1.riskLevel).toBe("critical");

      // Path traversal
      const res2 = await bridge.evaluateTool({
        sessionId: "sess_1",
        toolName: "read_file",
        args: { path: "../../etc/passwd" },
        runtimeMode: "BUILD",
        workspacePath: "/workspace",
        sideEffectScope: "read.files",
      });
      expect(res2.decision).toBe("deny");

      // Credential file access
      const res3 = await bridge.evaluateTool({
        sessionId: "sess_1",
        toolName: "read_file",
        args: { path: "admin-api-token" },
        runtimeMode: "BUILD",
        workspacePath: "/workspace",
        sideEffectScope: "credentials.read",
      });
      expect(res3.decision).toBe("deny");
    });

    it("enforces SAFE mode constraints (strictly read-only)", async () => {
      const bridge = new ZCodePermissionBridge();

      const writeRes = await bridge.evaluateTool({
        sessionId: "sess_safe",
        toolName: "write_file",
        args: { path: "test.txt", content: "data" },
        runtimeMode: "SAFE",
        workspacePath: "/workspace",
        sideEffectScope: "write.files",
      });
      expect(writeRes.decision).toBe("deny");
      expect(writeRes.reason).toContain("SAFE mode strictly denies");

      const readRes = await bridge.evaluateTool({
        sessionId: "sess_safe",
        toolName: "read_file",
        args: { path: "README.md" },
        runtimeMode: "SAFE",
        workspacePath: "/workspace",
        sideEffectScope: "read.files",
      });
      expect(readRes.decision).toBe("allow");
    });

    it("enqueues human approval and allows session grants after resolution", async () => {
      const bridge = new ZCodePermissionBridge();

      const res = await bridge.evaluateTool({
        sessionId: "sess_appr",
        toolName: "git_push",
        args: { remote: "origin", branch: "main" },
        runtimeMode: "BUILD",
        workspacePath: "/workspace",
        sideEffectScope: "git.push",
      });

      expect(res.decision).toBe("ask");
      expect(res.ruleId).toBeDefined();

      const pending = bridge.getPendingApprovals();
      expect(pending).toHaveLength(1);
      expect(pending[0].toolName).toBe("git_push");

      // Approve
      const resolved = bridge.resolveApproval(pending[0].approvalId, true);
      expect(resolved).toBe(true);

      // Subsequent evaluation in same session is auto-allowed by session grant
      const resAfter = await bridge.evaluateTool({
        sessionId: "sess_appr",
        toolName: "git_push",
        args: { remote: "origin", branch: "main" },
        runtimeMode: "BUILD",
        workspacePath: "/workspace",
        sideEffectScope: "git.push",
      });
      expect(resAfter.decision).toBe("allow");
    });
  });

  describe("ManagedZCodeRuntimeAdapter Lifecycle & Execution", () => {
    it("starts runtime, creates session, and executes turns with idempotency", async () => {
      const adapter = new ManagedZCodeRuntimeAdapter();
      const runtime = await adapter.startRuntime({
        workspacePath: "C:\\projects\\demo",
        workspaceIdentity: "ws_demo_01",
        mode: "BUILD",
      });

      expect(runtime.status).toBe("ready");
      expect(runtime.version).toBe("3.14.2");

      const lease = adapter.providerBridge.createLease({
        providerId: "openai",
        modelId: "gpt-5.6-sol",
        credentialRef: "cred_ref",
      });

      const session = await adapter.createSession({
        runtimeId: runtime.runtimeId,
        providerLeaseId: lease.leaseId,
      });

      expect(session.status).toBe("active");

      // Execute turn 1
      const turn1 = await adapter.executeTurn({
        sessionId: session.sessionId,
        prompt: "Check project status",
        idempotencyKey: "idem_turn_1",
      });

      expect(turn1.status).toBe("completed");
      expect(turn1.output).toContain("processed successfully");

      // Re-executing same idempotency key returns cached result
      const turn1Replay = await adapter.executeTurn({
        sessionId: session.sessionId,
        prompt: "Check project status again",
        idempotencyKey: "idem_turn_1",
      });

      expect(turn1Replay.turnId).toBe(turn1.turnId);

      // Tool listing reflects mode
      const tools = await adapter.listTools(session.sessionId);
      expect(tools.length).toBeGreaterThan(3);

      // Health
      const health = await adapter.getRuntimeHealth(runtime.runtimeId);
      expect(health.status).toBe("healthy");
      expect(health.activeSessions).toBe(1);

      await adapter.stopRuntime(runtime.runtimeId);
    });
  });

  describe("ZCodeWorkflowBridge & Reviewer Council Gate", () => {
    it("appends events and deterministically reconstructs workflow state", () => {
      const bridge = new ZCodeWorkflowBridge();
      const runId = bridge.createWorkflowRun({
        workflowId: "feature-build",
        sessionId: "sess_wf_1",
      });

      bridge.appendEvent({
        workflowRunId: runId,
        eventType: "subagent.spawned",
        actorType: "subagent",
        payload: { role: "coder_1" },
        traceId: "tr_1",
      });

      bridge.appendEvent({
        workflowRunId: runId,
        eventType: "step.completed",
        actorType: "lead_agent",
        payload: { stepId: "plan", nextStep: "implement" },
        traceId: "tr_2",
      });

      const projection = bridge.projectWorkflow(runId);
      expect(projection.currentStep).toBe("implement");
      expect(projection.stepsCompleted).toEqual(["plan"]);
      expect(projection.activeSubagents).toEqual(["coder_1"]);
      expect(projection.eventCount).toBe(3);
    });

    it("Reviewer Council gate blocks patches touching credentials or destructive commands", () => {
      const bridge = new ZCodeWorkflowBridge();

      const badPatch = "diff --git a/.env b/.env\n+API_SECRET=12345";
      const verdictBad = bridge.evaluateReviewerCouncilGate(badPatch);
      expect(verdictBad.verdict).toBe("block");
      expect(verdictBad.reasons[0]).toContain("credential");

      const goodPatch = "diff --git a/src/math.ts b/src/math.ts\n+export function add(a, b) { return a + b; }";
      const verdictGood = bridge.evaluateReviewerCouncilGate(goodPatch);
      expect(verdictGood.verdict).toBe("approve");
      expect(verdictGood.scores.security).toBeGreaterThan(0.9);
    });
  });

  describe("ZCodeMcpSkillsBridge", () => {
    it("projects valid MCP configuration and excludes untrusted servers without embedding credentials", () => {
      const bridge = new ZCodeMcpSkillsBridge();
      bridge.registerMcpServer({
        id: "mcp_untrusted",
        name: "Shady MCP",
        transport: "stdio",
        status: "connected",
        toolsCount: 2,
        trustLevel: "UNTRUSTED",
      });

      const config = bridge.generateZCodeMcpConfig();
      expect(config.mcpServers["pao-core-mcp"]).toBeDefined();
      expect(config.mcpServers["mcp_untrusted"]).toBeUndefined();
      expect(JSON.stringify(config)).not.toContain("password");
      expect(JSON.stringify(config)).not.toContain("secret");
    });
  });
});
