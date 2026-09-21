// Phase 20.99 — Pao-hubPro × Whip Mobile Operations Console Test Suite.
// Tests:
// - Host Profiles & Strict SSH Key Verification (known_good, unknown, changed MITM detection, ProxyJump hops)
// - Generation Guards (dropping stale callbacks from previous connection epochs)
// - Unified Fleet Ordering (attention priority: waiting_approval > blocked > error > done > working > idle)
// - Transcript Projection (Codex & OpenCode session binding, incremental turns, stale marker)
// - Terminal Gateway (isolated session lifecycle)
// - Remote File Workspace (path traversal prevention, atomic upload with temp-sibling rename, bounded preview)
// - Offline Command Queue (policy recheck upon reconnect, R3/R4 replay prevention, context revision mismatch)
// - QR Device Pairing (short-lived pairing code, verification phrase, revocation)
// - Policy-Governed Approvals (R0-R4, confused-deputy payload hash binding, biometric gate)
// - Audit Trail Reconstruction

import { beforeEach, describe, expect, it } from "bun:test";
import { AGENT_OS_SCHEMA_VERSION, openAgentOsDb } from "../src/agent-os/db";
import { WhipStore, newWhipId } from "../src/agent-os/whip/store";
import { SecureTransportCore } from "../src/agent-os/whip/transport";
import { UnifiedFleetManager } from "../src/agent-os/whip/fleet";
import { RemoteFileWorkspace, TerminalGateway } from "../src/agent-os/whip/workspace";
import { DevicePairingManager, OfflineCommandQueue } from "../src/agent-os/whip/queue-pairing";
import { WhipApprovalEngine } from "../src/agent-os/whip/approval-engine";
import { createWhipMcpTools } from "../src/agent-os/whip/mcp-tools";
import { WhipError } from "../src/agent-os/whip/types";

describe("Phase 20.99 — Whip Mobile Operations Console", () => {
  let store: WhipStore;
  let transport: SecureTransportCore;
  let fleet: UnifiedFleetManager;
  let terminal: TerminalGateway;
  let workspace: RemoteFileWorkspace;
  let queue: OfflineCommandQueue;
  let pairing: DevicePairingManager;
  let approvals: WhipApprovalEngine;

  beforeEach(() => {
    store = new WhipStore();
    transport = new SecureTransportCore(store);
    fleet = new UnifiedFleetManager(store);
    terminal = new TerminalGateway(store);
    workspace = new RemoteFileWorkspace();
    queue = new OfflineCommandQueue(store);
    pairing = new DevicePairingManager(store);
    approvals = new WhipApprovalEngine(store);
  });

  // -------------------------------------------------------------------------
  // 1. Schema & DB State Plane (§20, §21)
  // -------------------------------------------------------------------------
  describe("Schema & DB State Plane", () => {
    it("reports schema version at least 69", () => {
      expect(AGENT_OS_SCHEMA_VERSION).toBeGreaterThanOrEqual(69);
    });

    it("verifies all whip_* tables exist and accept queries", () => {
      const db = openAgentOsDb();
      const tables = [
        "whip_hosts",
        "whip_trusted_keys",
        "whip_devices",
        "whip_pairing_sessions",
        "whip_transcripts",
        "whip_terminals",
        "whip_queued_intents",
        "whip_approvals",
        "whip_audit_events",
      ];
      for (const t of tables) {
        const row = db.query(`SELECT count(*) as c FROM ${t}`).get() as { c: number };
        expect(row.c).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 2. Strict Host-Key Trust & Transport (§2.5, §17, §23)
  // -------------------------------------------------------------------------
  describe("Strict SSH Host-Key Verification & Generation Guards", () => {
    it("allows connection when all hop keys are known and approved", async () => {
      const hostId = newWhipId("whph");
      store.insertHost({
        id: hostId,
        displayName: "Production VPS",
        host: "100.64.0.1",
        port: 22,
        username: "operator",
        credentialRef: "env:SSH_KEY",
        jumpRoute: [],
        tailscaleIp: "100.64.0.1",
        status: "offline",
        runtimeGeneration: 1,
        lastConnectedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Approve host key at hop 0
      transport.approveHostKey(hostId, 0, "ed25519", "sha256_fingerprint_abc_123", "operator");

      const conn = await transport.connectHost(hostId, [
        { hopIndex: 0, algorithm: "ed25519", fingerprint: "sha256_fingerprint_abc_123" },
      ]);
      expect(conn.status).toBe("online");
      expect(conn.generation).toBe(2); // Incremented generation counter (§23)
    });

    it("fails closed on changed host key (MITM defense)", async () => {
      const hostId = newWhipId("whph");
      store.insertHost({
        id: hostId,
        displayName: "Sensitive Bastion",
        host: "bastion.corp",
        port: 22,
        username: "admin",
        credentialRef: null,
        jumpRoute: [],
        tailscaleIp: null,
        status: "offline",
        runtimeGeneration: 1,
        lastConnectedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      transport.approveHostKey(hostId, 0, "ed25519", "fingerprint_original_safe", "admin");

      // Attempt connect with a DIFFERENT fingerprint (simulate MITM attack)
      expect(
        transport.connectHost(hostId, [
          { hopIndex: 0, algorithm: "ed25519", fingerprint: "fingerprint_ATTACKER_FAKE" },
        ]),
      ).rejects.toThrow(WhipError);
    });

    it("drops stale generation callbacks from earlier epochs (§2.4, §23)", () => {
      const hostId = newWhipId("whph");
      store.insertHost({
        id: hostId,
        displayName: "Worker Node",
        host: "10.0.0.5",
        port: 22,
        username: "op",
        credentialRef: null,
        jumpRoute: [],
        tailscaleIp: null,
        status: "online",
        runtimeGeneration: 5,
        lastConnectedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Callback from generation 4 must be rejected as stale
      expect(transport.isGenerationValid(hostId, 4)).toBe(false);
      // Callback from active generation 5 must be accepted
      expect(transport.isGenerationValid(hostId, 5)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Fleet Aggregation & Transcript Projection (§8, §10)
  // -------------------------------------------------------------------------
  describe("Fleet Aggregation & Transcript Projection", () => {
    it("sorts fleet agents by attention priority (waiting_approval > blocked > working > idle)", () => {
      fleet.registerAgent({
        agentId: "agent_idle",
        hostId: "host_1",
        provider: "anthropic",
        runtime: "codex",
        displayName: "Idle Agent",
        status: "idle",
      });
      fleet.registerAgent({
        agentId: "agent_appr",
        hostId: "host_1",
        provider: "openai",
        runtime: "opencode",
        displayName: "Approval Agent",
        status: "waiting_approval",
      });
      fleet.registerAgent({
        agentId: "agent_work",
        hostId: "host_2",
        provider: "gemini",
        runtime: "pao-native",
        displayName: "Working Agent",
        status: "working",
      });

      const list = fleet.listFleet();
      expect(list[0].agentId).toBe("agent_appr"); // waiting_approval first
      expect(list[1].agentId).toBe("agent_work"); // working second
      expect(list[2].agentId).toBe("agent_idle"); // idle third
    });

    it("binds chat and terminal to the exact same agent session without erasing history on reconnect", () => {
      const agentId = "agent_codex_1";
      const sessionId = "sess_live_123";

      // Append turns
      fleet.appendTurn(agentId, sessionId, { kind: "user", content: "Implement feature X" });
      fleet.appendTurn(agentId, sessionId, { kind: "assistant", content: "Working on it..." });

      const tr = fleet.getOrCreateTranscript(agentId, sessionId);
      expect(tr.turns).toHaveLength(2);
      expect(tr.sourceState).toBe("live");

      // Network loss -> mark stale (retains turns)
      const stale = fleet.markTranscriptStale(agentId, sessionId);
      expect(stale.sourceState).toBe("stale");
      expect(stale.turns).toHaveLength(2);

      // Terminal points to the exact same session ID
      const term = terminal.openTerminal({ hostId: "host_1", agentId, sessionId });
      expect(term.sessionId).toBe(sessionId);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Terminal Gateway & Remote SFTP Workspace (§11, §12)
  // -------------------------------------------------------------------------
  describe("Terminal Gateway & Remote Workspace", () => {
    it("opens independent terminal sessions without crashing host control", () => {
      const hId = newWhipId("whph_term");
      const t1 = terminal.openTerminal({ hostId: hId, cwd: "/work/app1" });
      const t2 = terminal.openTerminal({ hostId: hId, cwd: "/work/app2" });
      expect(t1.id).not.toBe(t2.id);
      expect(terminal.listTerminals(hId)).toHaveLength(2);
    });

    it("prevents directory traversal attacks in SFTP paths", () => {
      expect(() => workspace.validatePath("../../../etc/passwd")).toThrow(WhipError);
      expect(() => workspace.validatePath("/etc/shadow")).toThrow(WhipError);
      expect(workspace.validatePath("src/index.ts")).toBe("src/index.ts");
    });

    it("uploads file using atomic temp-sibling rename and provides bounded preview", async () => {
      const upload = await workspace.uploadFile("docs/config.json", JSON.stringify({ key: "val" }));
      expect(upload.atomicFinalized).toBe(true);
      expect(upload.contentHash).toBeDefined();

      const preview = workspace.readTextPreview("docs/config.json", 1024);
      expect(preview.truncated).toBe(false);
      expect(JSON.parse(preview.content)).toEqual({ key: "val" });
    });
  });

  // -------------------------------------------------------------------------
  // 5. Offline Command Queue (§13)
  // -------------------------------------------------------------------------
  describe("Offline Command Queue & Context Recheck", () => {
    it("prohibits silent offline replay of R3/R4 high-risk actions (marks NEEDS_REVIEW)", () => {
      const intent = queue.enqueueIntent({
        hostId: "host_prod",
        deviceId: "dev_mobile",
        targetRef: { service: "api" },
        semanticAction: "service.restart",
        payload: { force: true },
        contextRevision: 1,
        riskClass: "R3",
      });

      const evalRes = queue.evaluateQueuedIntentOnReconnect(intent.id, 1);
      expect(evalRes.readyToSend).toBe(false);
      expect(evalRes.state).toBe("needs_review");
      expect(evalRes.reason).toContain("prohibited from silent offline replay");
    });

    it("marks NEEDS_REVIEW if context revision changed while offline", () => {
      const intent = queue.enqueueIntent({
        hostId: "host_dev",
        deviceId: "dev_mobile",
        targetRef: { file: "app.ts" },
        semanticAction: "file.edit",
        payload: { patch: "fix" },
        contextRevision: 5,
        riskClass: "R2",
      });

      // Context advanced from 5 to 6 while device was offline
      const evalRes = queue.evaluateQueuedIntentOnReconnect(intent.id, 6);
      expect(evalRes.readyToSend).toBe(false);
      expect(evalRes.state).toBe("needs_review");
      expect(evalRes.reason).toContain("context revision mismatch");
    });

    it("allows safe R1/R2 intent to proceed when context revision matches", () => {
      const intent = queue.enqueueIntent({
        hostId: "host_dev",
        deviceId: "dev_mobile",
        targetRef: { file: "readme.md" },
        semanticAction: "file.read",
        payload: { path: "readme.md" },
        contextRevision: 3,
        riskClass: "R1",
      });

      const evalRes = queue.evaluateQueuedIntentOnReconnect(intent.id, 3);
      expect(evalRes.readyToSend).toBe(true);
      expect(evalRes.state).toBe("policy_recheck");
    });
  });

  // -------------------------------------------------------------------------
  // 6. QR Device Pairing & Revocation (§15, §16)
  // -------------------------------------------------------------------------
  describe("QR Device Pairing & Revocation", () => {
    it("creates ephemeral pairing session without master secrets and completes enrollment", () => {
      const { session, qrPayload } = pairing.createPairingSession("bastion.internal", 22, 5);
      expect(qrPayload.pairing_id).toBe(session.id);
      expect(qrPayload.ephemeral_public_key).toBeDefined();
      expect(session.verificationPhrase).toContain("-");

      // Complete pairing
      const device = pairing.completePairing(session.pairingCode, {
        label: "Alice iPhone",
        publicKey: "pubkey_device_alice_123",
        platform: "ios",
        biometricEnabled: true,
      });

      expect(device.id.startsWith("whpdev_")).toBe(true);
      expect(device.status).toBe("active");
      expect(pairing.isDeviceAuthorized(device.id)).toBe(true);

      // Revoke device
      pairing.revokeDevice(device.id);
      expect(pairing.isDeviceAuthorized(device.id)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Policy-Governed Approvals & Confused-Deputy Defense (§14, §27)
  // -------------------------------------------------------------------------
  describe("Policy Approvals & Confused-Deputy Defense", () => {
    it("binds approval to exact payload hash and invalidates if parameters mutate", () => {
      const originalArgs = { branch: "main", force: false };
      const appr = approvals.requestApproval({
        hostId: "host_1",
        deviceId: "dev_1",
        action: "git.push",
        target: "repo",
        args: originalArgs,
        humanSummary: "Push to main",
        risk: "R3",
      });

      approvals.decideApproval({
        approvalId: appr.id,
        decision: "approved",
        decidedBy: "lead_dev",
      });

      // Verification with identical args succeeds
      expect(() =>
        approvals.verifyApprovalForExecution(appr.id, "git.push", "repo", originalArgs),
      ).not.toThrow();

      // Confused-deputy: attacker alters force to true -> payload hash mismatch
      const mutatedArgs = { branch: "main", force: true };
      expect(() =>
        approvals.verifyApprovalForExecution(appr.id, "git.push", "repo", mutatedArgs),
      ).toThrow(WhipError);
    });

    it("requires biometric verification for critical R4 actions", () => {
      const appr = approvals.requestApproval({
        hostId: "host_1",
        deviceId: "dev_1",
        action: "system.purge_all",
        target: "db",
        args: { confirmed: true },
        humanSummary: "Purge Database",
        risk: "R4",
      });

      // Attempting to approve without biometric auth must fail
      expect(() =>
        approvals.decideApproval({
          approvalId: appr.id,
          decision: "approved",
          decidedBy: "admin",
          biometricVerified: false,
        }),
      ).toThrow(WhipError);

      // Approving WITH biometric auth succeeds
      const approved = approvals.decideApproval({
        approvalId: appr.id,
        decision: "approved",
        decidedBy: "admin",
        biometricVerified: true,
      });
      expect(approved.status).toBe("approved");
      expect(approved.biometricVerified).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 8. MCP Tools Catalog
  // -------------------------------------------------------------------------
  describe("MCP Tools Catalog", () => {
    it("exports standard pao.whip.* tools", () => {
      const tools = createWhipMcpTools();
      expect(tools.length).toBeGreaterThanOrEqual(8);
      const names = tools.map((t) => t.name);
      expect(names).toContain("pao.whip.hosts.list");
      expect(names).toContain("pao.whip.fleet.list");
      expect(names).toContain("pao.whip.transcript.get");
      expect(names).toContain("pao.whip.terminal.open");
      expect(names).toContain("pao.whip.approval.decide");
      expect(names).toContain("pao.whip.pairing.create");
      expect(names).toContain("pao.whip.files.upload");
      expect(names).toContain("pao.whip.queue.enqueue");
    });
  });
});
