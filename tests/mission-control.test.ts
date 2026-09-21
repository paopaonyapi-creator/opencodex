// Phase 21.02 — Pao-hubPro Multi-Agent Mission Control test suite.

import { describe, expect, it } from "bun:test";
import { openAgentOsDb, AGENT_OS_SCHEMA_VERSION } from "../src/agent-os/db";
import {
  getMissionControlService,
  MissionControlService,
  MissionControlStore,
  createMissionControlMcpTools,
} from "../src/agent-os/mission-control";

describe("Phase 21.02 — Multi-Agent Mission Control", () => {
  // -------------------------------------------------------------------------
  // 1. Schema & DB State Plane (§20)
  // -------------------------------------------------------------------------
  describe("Schema & DB State Plane", () => {
    it("reports schema version at least 72", () => {
      expect(AGENT_OS_SCHEMA_VERSION).toBeGreaterThanOrEqual(72);
    });

    it("verifies all mc_* tables exist and accept queries", () => {
      const db = openAgentOsDb();
      const tables = [
        "mc_agents",
        "mc_runs",
        "mc_run_events",
        "mc_approvals",
        "mc_cost_usage",
        "mc_queues",
        "mc_dlq",
        "mc_incidents",
        "mc_audit_logs",
      ];
      for (const table of tables) {
        const row = db.query(`SELECT COUNT(*) as count FROM ${table}`).get() as any;
        expect(row).toBeDefined();
        expect(typeof row.count).toBe("number");
      }
    });
  });

  // -------------------------------------------------------------------------
  // 2. Agent Supervision & State Machine (§4.1, §12)
  // -------------------------------------------------------------------------
  describe("Agent Supervision & State Machine", () => {
    it("registers an agent and tracks status transitions", () => {
      const svc = getMissionControlService();
      const agent = svc.registerAgent({
        id: "ag_test_01",
        name: "Test Architect Agent",
        agentType: "builder",
        status: "IDLE",
        hostId: "local-main",
        provider: "openai",
        model: "gpt-4o",
        queueDepth: 0,
        activeTools: ["git", "bash"],
        capabilities: ["code-edit"],
        skills: ["tdd"],
        mcpServers: ["filesystem"],
        allowedProviders: ["openai", "anthropic"],
        allowedHosts: ["local-main"],
        riskCeiling: "HIGH",
        takeoverState: "AUTONOMOUS",
        totalTokens: 1000,
        estimatedCost: 0.05,
      });

      expect(agent.id).toBe("ag_test_01");
      expect(agent.status).toBe("IDLE");

      // Pause agent
      const paused = svc.pauseAgent("ag_test_01", "operator", "Testing pause");
      expect(paused.status).toBe("PAUSED");

      // Resume agent
      const resumed = svc.resumeAgent("ag_test_01", "operator", "Testing resume");
      expect(resumed.status).toBe("IDLE");

      // Quarantine agent
      const quarantined = svc.quarantineAgent("ag_test_01", "security", "Suspicious activity");
      expect(quarantined.status).toBe("QUARANTINED");

      // Human takeover
      const takenOver = svc.takeoverAgent("ag_test_01", "admin", "Emergency human inspection");
      expect(takenOver.takeoverState).toBe("HUMAN_CONTROL");
      expect(takenOver.status).toBe("PAUSED");
    });
  });

  // -------------------------------------------------------------------------
  // 3. Run Controller & Timeline (§6, §7, §37)
  // -------------------------------------------------------------------------
  describe("Run Controller & Timeline", () => {
    it("creates, pauses, resumes, and cancels a run with timeline events", () => {
      const svc = getMissionControlService();
      const run = svc.createRun({
        id: "run_test_01",
        workflowId: "wf_01",
        agentId: "ag_test_01",
        status: "RUNNING",
        priority: 100,
        provider: "anthropic",
        model: "claude-3-5-sonnet",
        host: "local-main",
        currentStep: "step-1",
        inputTokens: 500,
        outputTokens: 200,
        cachedTokens: 0,
        reasoningTokens: 0,
        estimatedCost: 0.02,
        retryCount: 0,
        maxRetries: 3,
      });

      expect(run.status).toBe("RUNNING");

      // Pause run
      const paused = svc.pauseRun("run_test_01", "operator", "Pausing run");
      expect(paused.status).toBe("PAUSED");

      // Resume run
      const resumed = svc.resumeRun("run_test_01", "operator", "Resuming run");
      expect(resumed.status).toBe("RUNNING");

      // Cancel run
      const cancelled = svc.cancelRun("run_test_01", "operator", "User cancel");
      expect(cancelled.status).toBe("CANCELLED");

      // Verify timeline events recorded
      const timeline = svc.listRunTimeline("run_test_01");
      expect(timeline.length).toBeGreaterThanOrEqual(4);
      const eventTypes = timeline.map((e) => e.eventType);
      expect(eventTypes).toContain("run.created");
      expect(eventTypes).toContain("run.paused");
      expect(eventTypes).toContain("run.resumed");
      expect(eventTypes).toContain("run.cancelled");
    });

    it("routes failed runs exceeding maxRetries to Dead Letter Queue (DLQ)", () => {
      const svc = getMissionControlService();
      const run = svc.createRun({
        id: "run_test_dlq",
        status: "FAILED",
        priority: 100,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
        estimatedCost: 0,
        retryCount: 3,
        maxRetries: 3,
        errorMessage: "Upstream timeout",
      });

      expect(() => svc.retryRun("run_test_dlq", "operator", "Retry failed run")).toThrow(/Dead Letter Queue/);

      const dlq = svc.listDlq();
      expect(dlq.some((d) => d.runId === "run_test_dlq")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Approval Inbox & Policy Actions (§8, §9)
  // -------------------------------------------------------------------------
  describe("Approval Inbox & Policy Actions", () => {
    it("creates, lists, and resolves human approvals", () => {
      const svc = getMissionControlService();
      const approval = svc.requestApproval({
        runId: "run_test_01",
        agentId: "ag_test_01",
        action: "rm -rf /dist",
        riskLevel: "HIGH",
        policyRule: "R3_SENSITIVE_DELETE",
        requestedBy: "agent",
      });

      expect(approval.status).toBe("PENDING");

      const pendingList = svc.listApprovals("PENDING");
      expect(pendingList.some((a) => a.id === approval.id)).toBe(true);

      // Resolve approval
      const resolved = svc.resolveApproval(approval.id, "APPROVED", "security-officer", "Verified clean build target");
      expect(resolved.status).toBe("APPROVED");
      expect(resolved.resolvedBy).toBe("security-officer");
    });
  });

  // -------------------------------------------------------------------------
  // 5. Emergency Stop & Incident Mode (§24, §25)
  // -------------------------------------------------------------------------
  describe("Emergency Stop & Incident Mode", () => {
    it("triggers emergency stop and transitions to LOCKDOWN, blocking new runs", () => {
      const svc = getMissionControlService();
      const incident = svc.triggerEmergencyStop("admin", "Unidentified tool loop detected");
      expect(incident.mode).toBe("LOCKDOWN");

      const kpis = svc.getOverview();
      expect(kpis.incidentMode).toBe("LOCKDOWN");

      // Resolve incident
      const resolved = svc.resolveIncident(incident.id, "admin", "Root cause isolated and fixed");
      expect(resolved.mode).toBe("NORMAL");
      expect(svc.getOverview().incidentMode).toBe("NORMAL");
    });
  });

  // -------------------------------------------------------------------------
  // 6. Audit Trail & MCP Tools Integration (§23, §21)
  // -------------------------------------------------------------------------
  describe("Audit Trail & MCP Tools Integration", () => {
    it("logs control plane mutations into append-only audit trail", () => {
      const svc = getMissionControlService();
      const audits = svc.listAudit(50);
      expect(audits.length).toBeGreaterThan(0);
      const actions = audits.map((a) => a.action);
      expect(actions).toContain("agent.pause");
      expect(actions).toContain("run.pause");
    });

    it("registers and executes Mission Control MCP tools", async () => {
      const tools = createMissionControlMcpTools();
      expect(tools.length).toBe(5);

      const overviewTool = tools.find((t) => t.name === "pao.mission_control.overview");
      expect(overviewTool).toBeDefined();
      const result = await overviewTool!.handler({});
      expect(result.ok).toBe(true);
      expect(result.kpis).toBeDefined();
    });
  });
});
