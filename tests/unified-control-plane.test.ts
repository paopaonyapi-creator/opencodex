// Phase 21.00 — Unified Agent Operations Control Plane Test Suite.
// Covers:
// - Schema v70 & uap_* table presence
// - Unified Agent Registry (provider-neutral, status transitions, quarantine)
// - Unified Host Registry (heterogeneous hosts, trust levels, quarantine enforcement)
// - Durable Job State Machine (queued → awaiting_approval → approved → running)
// - Cross-host runtime federation & job submission
// - Human Approval Fabric (exact context hash binding, R3/R4 mandatory approval)
// - Offline Replay Safety (context mismatch on high-risk jobs transitions to needs_review)
// - Idempotency (duplicate submission returns existing job without re-executing)
// - End-to-end Audit Stream Correlation (correlation_id preserved across events)
// - Centralized MCP & Skill Governance

import { beforeEach, describe, expect, it } from "bun:test";
import { AGENT_OS_SCHEMA_VERSION, openAgentOsDb } from "../src/agent-os/db";
import { UnifiedControlPlaneStore } from "../src/agent-os/control-plane/unified-store";
import {
  UnifiedAgentOperationsControlPlane,
  resetUnifiedControlPlaneForTests,
} from "../src/agent-os/control-plane/unified-service";
import { createUnifiedControlPlaneMcpTools } from "../src/agent-os/control-plane/unified-mcp-tools";
import { UapError } from "../src/agent-os/control-plane/unified-types";

describe("Phase 21.00 — Unified Agent Operations Control Plane", () => {
  let store: UnifiedControlPlaneStore;
  let uap: UnifiedAgentOperationsControlPlane;

  beforeEach(() => {
    resetUnifiedControlPlaneForTests();
    store = new UnifiedControlPlaneStore();
    uap = new UnifiedAgentOperationsControlPlane(store);
  });

  // -------------------------------------------------------------------------
  // 1. Schema & DB State Plane (§29, §30)
  // -------------------------------------------------------------------------
  describe("Schema & DB State Plane", () => {
    it("reports schema version at least 70", () => {
      expect(AGENT_OS_SCHEMA_VERSION).toBeGreaterThanOrEqual(70);
    });

    it("verifies all uap_* tables exist and accept queries", () => {
      const db = openAgentOsDb();
      const tables = [
        "uap_agents",
        "uap_hosts",
        "uap_jobs",
        "uap_mcp_servers",
        "uap_mcp_tools",
        "uap_skills",
        "uap_approvals",
        "uap_audit_events",
        "uap_idempotency_keys",
      ];
      for (const t of tables) {
        const row = db.query(`SELECT count(*) as c FROM ${t}`).get() as { c: number };
        expect(row.c).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 2. Unified Agent Registry & Quarantine (§6.1)
  // -------------------------------------------------------------------------
  describe("Unified Agent Registry", () => {
    it("registers agent with stable identity across runtimes and emits audit event", () => {
      const agent = uap.registerAgent({
        displayName: "Research Agent",
        runtimeType: "openhermit",
        provider: "anthropic",
        model: "claude-3-5-sonnet",
        hostId: "vps_us_east",
        capabilities: ["web_search", "code_exec"],
      });
      expect(agent.agentId.startsWith("uap_ag_")).toBe(true);
      expect(agent.status).toBe("ready");

      const fetched = uap.getAgent(agent.agentId);
      expect(fetched?.displayName).toBe("Research Agent");

      // Verify audit trail
      const audits = uap.listAuditEvents(`corr_reg_${agent.agentId}`);
      expect(audits.length).toBeGreaterThanOrEqual(1);
      expect(audits[0].eventType).toBe("agent.registered.v1");
    });

    it("quarantines an agent and rejects new job submissions", async () => {
      const host = uap.registerHost({
        displayName: "Worker Node",
        hostType: "remote_linux",
        osFamily: "linux",
        architecture: "x86_64",
        connectionMode: "direct",
      });

      const agent = uap.registerAgent({
        displayName: "Flaky Agent",
        runtimeType: "custom",
        provider: "local",
        hostId: host.hostId,
      });

      // Quarantine agent
      uap.setAgentStatus(agent.agentId, "quarantined", "sec_team");
      expect(uap.getAgent(agent.agentId)?.status).toBe("quarantined");

      // Submitting job to quarantined agent must fail closed
      expect(
        uap.submitJob({
          jobType: "eval",
          requestedBy: "tester",
          hostId: host.hostId,
          agentId: agent.agentId,
        }),
      ).rejects.toThrow(UapError);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Unified Host Registry & Trust Levels (§6.2, §25)
  // -------------------------------------------------------------------------
  describe("Unified Host Registry & Trust Enforcement", () => {
    it("registers host with trust classification and enforces quarantine", async () => {
      const host = uap.registerHost({
        displayName: "Production VPS",
        hostType: "vps",
        osFamily: "linux",
        architecture: "x86_64",
        connectionMode: "tailscale",
        trustLevel: "TRUSTED_PRIVATE",
      });
      expect(host.trustLevel).toBe("TRUSTED_PRIVATE");

      // Quarantine host
      uap.setHostTrust(host.hostId, "QUARANTINED", "admin");
      expect(uap.getHost(host.hostId)?.status).toBe("quarantined");

      // Submitting job to quarantined host must fail closed
      expect(
        uap.submitJob({
          jobType: "deploy",
          requestedBy: "tester",
          hostId: host.hostId,
        }),
      ).rejects.toThrow(UapError);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Durable Job State Machine & Approval Gating (§7, §8, §12)
  // -------------------------------------------------------------------------
  describe("Durable Job State Machine & Approval Gating", () => {
    it("automatically starts low-risk R1 jobs", async () => {
      const host = uap.registerHost({
        displayName: "Dev Machine",
        hostType: "local_pc",
        osFamily: "darwin",
        architecture: "arm64",
        connectionMode: "direct",
      });

      const job = await uap.submitJob({
        jobType: "run_lint",
        requestedBy: "ci",
        hostId: host.hostId,
        riskClass: "R1_LOW_RISK",
      });

      expect(job.status).toBe("running");
      expect(job.approvalId).toBeNull();
    });

    it("requires approval for high-risk R3/R4 jobs and transitions correctly upon decision", async () => {
      const host = uap.registerHost({
        displayName: "Cluster 1",
        hostType: "remote_linux",
        osFamily: "linux",
        architecture: "x86_64",
        connectionMode: "direct",
      });

      const job = await uap.submitJob({
        jobType: "system_deploy",
        requestedBy: "devops",
        hostId: host.hostId,
        riskClass: "R3_SENSITIVE",
        payload: { target: "prod", version: "2.0" },
      });

      expect(job.status).toBe("awaiting_approval");
      expect(job.approvalId).not.toBeNull();

      // Approve job
      const appr = uap.decideApproval(job.approvalId!, "approved", "lead_admin", "verified build");
      expect(appr.status).toBe("approved");

      // Linked job should transition to approved
      const updatedJob = uap.getJob(job.jobId);
      expect(updatedJob?.status).toBe("approved");
    });
  });

  // -------------------------------------------------------------------------
  // 5. Offline Replay Safety & Context Recheck (§5.4, §14.1)
  // -------------------------------------------------------------------------
  describe("Offline Replay Safety", () => {
    it("transitions to needs_review if host identity changed during replay", async () => {
      const hostA = uap.registerHost({
        displayName: "Host Alpha",
        hostType: "vps",
        osFamily: "linux",
        architecture: "x86_64",
        connectionMode: "direct",
      });

      const job = await uap.submitJob({
        jobType: "task_a",
        requestedBy: "op",
        hostId: hostA.hostId,
      });

      // Attempt replay with a different host ID (e.g. host replaced while offline)
      const replay = uap.evaluateReplay(job.jobId, {
        hostId: "host_replaced_beta",
        payload: {},
      });
      expect(replay.canReplay).toBe(false);
      expect(replay.status).toBe("needs_review");
    });

    it("transitions to needs_review if high-risk payload context hash changed", async () => {
      const host = uap.registerHost({
        displayName: "Host Gamma",
        hostType: "vps",
        osFamily: "linux",
        architecture: "x86_64",
        connectionMode: "direct",
      });

      const originalPayload = { config: "v1" };
      const job = await uap.submitJob({
        jobType: "apply_config",
        requestedBy: "op",
        hostId: host.hostId,
        riskClass: "R3_SENSITIVE",
        payload: originalPayload,
      });

      // Modify payload during offline replay
      const alteredPayload = { config: "v2_malicious" };
      const replay = uap.evaluateReplay(job.jobId, {
        hostId: host.hostId,
        payload: alteredPayload,
      });
      expect(replay.canReplay).toBe(false);
      expect(replay.status).toBe("needs_review");
    });
  });

  // -------------------------------------------------------------------------
  // 6. Idempotency (§21)
  // -------------------------------------------------------------------------
  describe("Idempotency", () => {
    it("returns existing job record on duplicate submission with matching idempotency key", async () => {
      const host = uap.registerHost({
        displayName: "Host I",
        hostType: "local_pc",
        osFamily: "linux",
        architecture: "x86_64",
        connectionMode: "direct",
      });

      const key = `idem_${Date.now()}_uap`;
      const first = await uap.submitJob({
        jobType: "sync",
        requestedBy: "worker",
        hostId: host.hostId,
        idempotencyKey: key,
      });

      const second = await uap.submitJob({
        jobType: "sync",
        requestedBy: "worker",
        hostId: host.hostId,
        idempotencyKey: key,
      });

      expect(second.jobId).toBe(first.jobId);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Centralized MCP & Skill Registries (§9, §10)
  // -------------------------------------------------------------------------
  describe("Centralized MCP & Skill Governance", () => {
    it("registers MCP server and tools with risk classification", () => {
      uap.registerMcpServer({
        mcpServerId: "db_mcp",
        name: "PostgreSQL Connector",
        transport: "stdio",
        endpointRef: null,
        authRef: null,
        trustLevel: "high",
        environment: "production",
        status: "active",
        toolCount: 1,
        policyProfileId: "default",
        source: "internal",
        version: "1.0.0",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastVerifiedAt: new Date().toISOString(),
      });

      uap.registerMcpTool({
        toolId: "tool_drop_db",
        mcpServerId: "db_mcp",
        name: "drop_database",
        description: "Drop database",
        riskClass: "R4_PRIVILEGED",
        requiresApproval: true,
        allowedAgentClasses: ["admin"],
        allowedHostClasses: ["db_host"],
        inputSchemaHash: "hash_in",
        outputSchemaHash: "hash_out",
        enabled: true,
      });

      const tools = uap.listMcpTools();
      expect(tools.some((t) => t.name === "drop_database" && t.riskClass === "R4_PRIVILEGED")).toBe(true);
    });

    it("registers and lists verified skills with checksums", () => {
      uap.registerSkill({
        skillId: "skill_audit",
        name: "Audit Pipeline",
        version: "1.2.0",
        source: "pao/skills",
        runtime: "bun",
        entrypoint: "audit.ts",
        capabilityTags: ["audit", "compliance"],
        riskClass: "R1_LOW_RISK",
        requiredTools: [],
        requiredCredentials: [],
        allowedAgents: ["*"],
        allowedHosts: ["*"],
        policyProfileId: "default",
        status: "verified",
        checksum: "sha256_checksum_123",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const skills = uap.listSkills();
      expect(skills.some((s) => s.skillId === "skill_audit" && s.status === "verified")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 8. MCP Tools Catalog
  // -------------------------------------------------------------------------
  describe("MCP Tools Catalog", () => {
    it("exports standard pao.uap.* tools", () => {
      const tools = createUnifiedControlPlaneMcpTools();
      expect(tools.length).toBeGreaterThanOrEqual(7);
      const names = tools.map((t) => t.name);
      expect(names).toContain("pao.uap.agents.list");
      expect(names).toContain("pao.uap.hosts.list");
      expect(names).toContain("pao.uap.jobs.submit");
      expect(names).toContain("pao.uap.approvals.decide");
      expect(names).toContain("pao.uap.mcp.tools");
      expect(names).toContain("pao.uap.skills.list");
      expect(names).toContain("pao.uap.audit.list");
    });
  });
});
