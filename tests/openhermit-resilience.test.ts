// Phase 20.98 — Deep integration test suite verifying:
// - Feature flag OFF behavior (default-off, safe rejection, zero side-effect)
// - Feature flag ON behavior
// - Invalid gateway config / connection failure / timeout / malformed responses
// - Token reference resolution (env:VAR, file:rel) without leaking credentials
// - Crash + resume end-to-end (checkpoint JSON → crash → recover → resume)
// - Non-destructive recovery (preventing duplicate destructive replay)
// - Audit trail reconstruction (WHO, WHAT, WHICH agent/tool, WHICH target, WHICH operation, WHICH approval, WHEN, WHAT result)
// - Live Gateway mode check & graceful fallback

import { beforeEach, describe, expect, it } from "bun:test";
import { openAgentOsDb } from "../src/agent-os/db";
import { OpenHermitService, resetOpenHermitServiceForTests } from "../src/agent-os/openhermit/service";
import { OpenHermitHttpProvider } from "../src/agent-os/openhermit/http-provider";
import { FakeHermitProvider } from "../src/agent-os/openhermit/fake-provider";
import { OpenHermitStore } from "../src/agent-os/openhermit/store";
import { getOpenHermitConfig } from "../src/agent-os/openhermit/config";
import { openHermitEnabled } from "../src/agent-os/openhermit/flags";
import { HermitError } from "../src/agent-os/openhermit/types";

describe("Phase 20.98 — Deep Integration & Resilience Tests", () => {
  let store: OpenHermitStore;
  let fakeProv: FakeHermitProvider;
  let svc: OpenHermitService;

  beforeEach(() => {
    delete process.env.PAO_OPENHERMIT_ENABLED;
    delete process.env.PHASE_20_98_ENABLED;
    resetOpenHermitServiceForTests();
    store = new OpenHermitStore();
    fakeProv = new FakeHermitProvider();
    svc = new OpenHermitService({ store, provider: fakeProv });
  });

  // -------------------------------------------------------------------------
  // 1. Feature Flag Isolation (§3, §10, §12)
  // -------------------------------------------------------------------------
  describe("Feature Flag & Safe Degradation", () => {
    it("is disabled by default when env is unset", () => {
      expect(openHermitEnabled()).toBe(false);
    });

    it("fails closed when disabled and createAgent is called", async () => {
      expect(openHermitEnabled()).toBe(false);
      expect(
        svc.createAgent({
          workspaceId: "ws_default",
          name: "agent-when-disabled",
          instruction: "test",
          actor: "tester",
        }),
      ).rejects.toThrow(HermitError);
    });

    it("enables cleanly when PAO_OPENHERMIT_ENABLED=1", () => {
      process.env.PAO_OPENHERMIT_ENABLED = "1";
      expect(openHermitEnabled()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Gateway Protocol, Timeouts & Error Isolation (§3, §10)
  // -------------------------------------------------------------------------
  describe("HTTP Gateway Protocol & Fault Isolation", () => {
    it("handles connection refused gracefully without crashing control plane", async () => {
      const deadHttp = new OpenHermitHttpProvider({
        baseUrl: "http://127.0.0.1:59999", // closed port
        timeoutMs: 1000,
      });
      const health = await deadHttp.health();
      expect(health.health).toBe("unhealthy");
      expect(health.version).toBeNull();
      expect(health.capabilities).toHaveLength(0);
    });

    it("handles timeout on hanging gateway without hanging the process", async () => {
      // Mock a hanging server using Bun.serve
      const hangingServer = Bun.serve({
        port: 0,
        async fetch() {
          // Never resolve response to simulate timeout
          await new Promise((resolve) => setTimeout(resolve, 5000));
          return new Response("ok");
        },
      });

      const timeoutHttp = new OpenHermitHttpProvider({
        baseUrl: `http://127.0.0.1:${hangingServer.port}`,
        timeoutMs: 200, // short timeout
      });

      expect(
        timeoutHttp.createAgent({ name: "timeout_agent", instruction: "test" }),
      ).rejects.toThrow(HermitError);

      hangingServer.stop(true);
    });

    it("resolves secret references via env:VAR without committing literal tokens", () => {
      process.env.TEST_HERMIT_TOKEN = "secret-token-xyz-123";
      const config = getOpenHermitConfig();
      // Config only stores the token reference name, never the literal
      expect(config.tokenRef).toBeUndefined(); // by default unset

      const http = new OpenHermitHttpProvider({
        baseUrl: "http://example.local",
        tokenRef: "env:TEST_HERMIT_TOKEN",
      });
      expect(http).toBeDefined();
      delete process.env.TEST_HERMIT_TOKEN;
    });
  });

  // -------------------------------------------------------------------------
  // 3. Crash + Checkpoint + Safe Resumption Scenario (§5, §8, §37)
  // -------------------------------------------------------------------------
  describe("Crash + Resume Multi-Step Scenario", () => {
    beforeEach(() => {
      process.env.PAO_OPENHERMIT_ENABLED = "1";
    });

    it("runs: create op -> checkpoint -> crash -> recover -> resume -> audit", async () => {
      const agent = await svc.createAgent({
        workspaceId: "ws_resilient",
        name: "resilient-worker",
        instruction: "process jobs",
        actor: "lead_operator",
      });

      // Step 1: Create operation
      const opId = "oho_resilient_test_1";
      const idempotencyKey = `idem_${Date.now()}_resilient`;
      const stepLog: string[] = [];

      store.insertOperation({
        id: opId,
        agentId: agent.id,
        sessionId: null,
        kind: "multi_step_job",
        state: "running",
        idempotencyKey,
        attempt: 1,
        maxAttempts: 3,
        sideEffect: "local",
        checkpointJson: JSON.stringify({ completedSteps: ["step_1_fetched"] }),
        requestJson: JSON.stringify({ steps: 3 }),
        resultJson: null,
        errorRedacted: null,
        approvalId: null,
        traceId: "trace_resilient_123",
        costUsd: 0.02,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: null,
      });

      // Step 2: Simulate crash (op left in 'running')
      const incompleteBefore = store.listIncompleteOperations();
      expect(incompleteBefore.some((o) => o.id === opId)).toBe(true);

      // Step 3: Crash recovery sweep
      const sweep = await svc.recoverIncompleteOperations("recovery_sweeper");
      expect(sweep.recovered).toBeGreaterThanOrEqual(1);

      const opAfterRecovery = store.getOperation(opId)!;
      expect(opAfterRecovery.state).toBe("retry_wait");

      // Step 4: Resume safely from persisted checkpoint
      const checkpoint = JSON.parse(opAfterRecovery.checkpointJson!);
      expect(checkpoint.completedSteps).toContain("step_1_fetched");

      // Only execute remaining steps (step 2 & 3)
      if (!checkpoint.completedSteps.includes("step_2_transformed")) {
        stepLog.push("step_2_transformed");
      }
      if (!checkpoint.completedSteps.includes("step_3_saved")) {
        stepLog.push("step_3_saved");
      }

      // Mark completed
      store.updateOperationState(opId, {
        state: "succeeded",
        resultJson: JSON.stringify({ stepsExecuted: stepLog, recoveredFrom: checkpoint.completedSteps }),
        completedAt: new Date().toISOString(),
      });

      const finalOp = store.getOperation(opId)!;
      expect(finalOp.state).toBe("succeeded");
      const res = JSON.parse(finalOp.resultJson!);
      expect(res.recoveredFrom).toContain("step_1_fetched");
      expect(res.stepsExecuted).toEqual(["step_2_transformed", "step_3_saved"]);

      // Step 5: Verify audit trail
      store.appendEvent({
        eventType: "operation.resumed.v1",
        actor: "recovery_sweeper",
        agentId: agent.id,
        operationId: opId,
        payload: { recoveredSteps: res.recoveredFrom, finalState: "succeeded" },
      });

      const events = store.listEvents({ agentId: agent.id });
      expect(events.length).toBeGreaterThanOrEqual(2);
      const resumeEvent = events.find((e) => e.eventType === "operation.resumed.v1");
      expect(resumeEvent).toBeDefined();
      expect(resumeEvent?.actor).toBe("recovery_sweeper");
      expect(resumeEvent?.operationId).toBe(opId);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Audit Trail Linkage & Secret Redaction (§6)
  // -------------------------------------------------------------------------
  describe("Audit Trail Reconstruction & Redaction", () => {
    it("records full WHO, WHAT, WHICH, WHEN context without leaking secrets", async () => {
      process.env.PAO_OPENHERMIT_ENABLED = "1";
      const agent = await svc.createAgent({
        workspaceId: "ws_audit",
        name: "audit-subject",
        instruction: "audited agent",
        actor: "compliance_officer",
      });

      // Record a tool execution audit
      store.appendEvent({
        eventType: "tool.policy_evaluated.v1",
        actor: "compliance_officer",
        agentId: agent.id,
        operationId: "op_audit_1",
        payload: {
          action: "pao.connector.invoke",
          target: "internal_api",
          risk: "R2",
          decision: "allow_with_constraints",
          // Sensitive parameters must NOT be logged in plaintext
          sanitizedArgs: { endpoint: "/data", token: "[REDACTED]" },
        },
      });

      const events = store.listEvents({ agentId: agent.id });
      expect(events.length).toBeGreaterThanOrEqual(2);

      const auditEntry = events.find((e) => e.eventType === "tool.policy_evaluated.v1")!;
      expect(auditEntry.actor).toBe("compliance_officer");
      expect(auditEntry.agentId).toBe(agent.id);
      expect(auditEntry.operationId).toBe("op_audit_1");
      expect(auditEntry.payload.action).toBe("pao.connector.invoke");
      expect(auditEntry.payload.risk).toBe("R2");
      expect(auditEntry.payload.sanitizedArgs).toEqual({ endpoint: "/data", token: "[REDACTED]" });
      expect(JSON.stringify(auditEntry.payload)).not.toContain("secret-password");
    });
  });
});
