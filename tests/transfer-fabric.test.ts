import { describe, expect, it } from "bun:test";
import {
  TransferOrchestrator,
  TransferPolicyEngine,
  buildArtifactManifest,
  createTransferMcpTools,
  detectClassification,
  sanitizeFilename,
  verifyArtifactIntegrity,
} from "../src/agent-os/transfer";

describe("Phase 20.87 — Pao-hubPro × FileSync P2P Artifact Transfer Fabric", () => {
  describe("Manifest Builder & Cryptographic Verification", () => {
    it("sanitizes filenames and rejects path traversal sequences and reserved names", () => {
      expect(sanitizeFilename("report.pdf")).toBe("report.pdf");
      expect(sanitizeFilename("../../etc/passwd/image.png")).toBe("image.png");
      expect(sanitizeFilename("C:\\workspace\\build.zip")).toBe("build.zip");

      expect(() => sanitizeFilename("")).toThrow();
      expect(() => sanitizeFilename("..")).toThrow(/path traversal/);
      expect(() => sanitizeFilename("test\0bad.txt")).toThrow(/NUL byte/);
      expect(() => sanitizeFilename("con.txt")).toThrow(/reserved device name/);
      expect(() => sanitizeFilename("nul.txt")).toThrow(/reserved device name/);
    });

    it("detects artifact classifications including secret_like files", () => {
      expect(detectClassification("model.safetensors")).toBe("model");
      expect(detectClassification("setup.exe")).toBe("executable");
      expect(detectClassification("script.sh")).toBe("script");
      expect(detectClassification("video.mp4")).toBe("video");
      expect(detectClassification(".env.production")).toBe("secret_like");
      expect(detectClassification("id_rsa")).toBe("secret_like");
    });

    it("computes root SHA-256 and chunk hashes and verifies integrity", () => {
      const payload = "Pao-hubPro High Performance P2P WebRTC Transfer Payload Data 2026";
      const manifest = buildArtifactManifest("data.txt", payload);

      expect(manifest.filename).toBe("data.txt");
      expect(manifest.sizeBytes).toBe(Buffer.byteLength(payload));
      expect(manifest.sha256).toBeDefined();
      expect(manifest.chunks).toHaveLength(1);

      // Verify authentic payload
      const validRes = verifyArtifactIntegrity(manifest, Buffer.from(payload, "utf8"));
      expect(validRes.valid).toBe(true);

      // Corrupt payload detected
      const corruptPayload = Buffer.from(payload.replace("Pao", "Bad"), "utf8");
      const invalidRes = verifyArtifactIntegrity(manifest, corruptPayload);
      expect(invalidRes.valid).toBe(false);
      expect(invalidRes.error).toContain("hash mismatch");

      // Truncated payload detected
      const truncPayload = Buffer.from(payload.slice(0, 10), "utf8");
      const truncRes = verifyArtifactIntegrity(manifest, truncPayload);
      expect(truncRes.valid).toBe(false);
      expect(truncRes.error).toContain("Size mismatch");
    });
  });

  describe("Transfer Policy Engine", () => {
    it("strictly denies outbound secret_like artifacts with R4 risk", () => {
      const manifest = buildArtifactManifest(".env.secrets", "API_KEY=12345");
      const evalRes = TransferPolicyEngine.evaluate({
        sourceZone: "LOCAL_PRIVATE",
        targetZone: "TRUSTED_PEER",
        manifest,
      });

      expect(evalRes.decision).toBe("deny");
      expect(evalRes.riskTier).toBe("R4");
      expect(evalRes.reason).toContain("secret_like artifacts is strictly denied");
    });

    it("requires human approval for inbound executables from non-local zones", () => {
      const manifest = buildArtifactManifest("agent_worker.exe", "MZ9000", "executable");
      const evalRes = TransferPolicyEngine.evaluate({
        sourceZone: "EXTERNAL_UNTRUSTED",
        targetZone: "LOCAL_PRIVATE",
        manifest,
      });

      expect(evalRes.decision).toBe("require_approval");
      expect(evalRes.riskTier).toBe("R3");
      expect(evalRes.quarantineRequired).toBe(true);
    });

    it("requires human approval when destination policy is overwrite", () => {
      const manifest = buildArtifactManifest("data.csv", "a,b,c");
      const evalRes = TransferPolicyEngine.evaluate({
        sourceZone: "LOCAL_PRIVATE",
        targetZone: "LOCAL_PRIVATE",
        manifest,
        destinationConflictPolicy: "overwrite",
      });

      expect(evalRes.decision).toBe("require_approval");
      expect(evalRes.riskTier).toBe("R3");
    });

    it("allows trusted zone transfers with R2 classification", () => {
      const manifest = buildArtifactManifest("render.png", "PNGDATA");
      const evalRes = TransferPolicyEngine.evaluate({
        sourceZone: "LOCAL_PRIVATE",
        targetZone: "MANAGED_VPS",
        manifest,
      });

      expect(evalRes.decision).toBe("allow");
      expect(evalRes.riskTier).toBe("R2");
    });
  });

  describe("Transfer Orchestrator Lifecycle & Execution", () => {
    it("creates, streams, and completes multi-target transfer with integrity verification", async () => {
      const orchestrator = new TransferOrchestrator();
      const content = "Large dataset chunk content distributed to multiple GPU nodes";

      const session = orchestrator.createSession({
        sourceNodeId: "node_master",
        sourceZone: "LOCAL_PRIVATE",
        filename: "dataset.parquet",
        data: content,
        targets: [
          { targetId: "t1", peerId: "peer_gpu1", nodeId: "gpu1", zone: "CLOUD_GPU" },
          { targetId: "t2", peerId: "peer_gpu2", nodeId: "gpu2", zone: "CLOUD_GPU" },
        ],
        distributionMode: "require_all",
      });

      expect(session.state).toBe("PREPARING");
      expect(session.targets).toHaveLength(2);

      const completedSession = await orchestrator.startTransfer(session.sessionId);
      expect(completedSession.state).toBe("COMPLETED");
      expect(completedSession.targets.every((t) => t.state === "verified")).toBe(true);
      expect(completedSession.totalBytesTransferred).toBe(Buffer.byteLength(content) * 2);
    });

    it("enforces human approval gate and resumes transfer once approved", async () => {
      const orchestrator = new TransferOrchestrator();
      const session = orchestrator.createSession({
        sourceNodeId: "external_node",
        sourceZone: "EXTERNAL_UNTRUSTED",
        filename: "helper.sh",
        data: "#!/bin/bash\necho test",
        targets: [{ targetId: "t_local", peerId: "peer_loc", nodeId: "loc", zone: "LOCAL_PRIVATE" }],
      });

      expect(session.state).toBe("AWAITING_APPROVAL");
      expect(session.policyDecision.approvalId).toBeDefined();

      // Refuses to start without approval
      await expect(orchestrator.startTransfer(session.sessionId)).rejects.toThrow(/awaiting mandatory human approval/);

      // Approve
      const approved = orchestrator.approveSession(session.policyDecision.approvalId!);
      expect(approved).toBe(true);

      const runningSession = await orchestrator.startTransfer(session.sessionId);
      expect(runningSession.state).toBe("COMPLETED");
    });

    it("cancels transfer session and marks terminal state", () => {
      const orchestrator = new TransferOrchestrator();
      const session = orchestrator.createSession({
        sourceNodeId: "node_1",
        sourceZone: "LOCAL_PRIVATE",
        filename: "draft.zip",
        data: "zipdata",
        targets: [{ targetId: "t1", peerId: "p1", nodeId: "n1", zone: "TRUSTED_PEER" }],
      });

      orchestrator.cancelSession(session.sessionId);
      const updated = orchestrator.getSession(session.sessionId);
      expect(updated?.state).toBe("CANCELLED");
    });
  });

  describe("Transfer MCP Tools", () => {
    it("creates, inspects, and manages transfer through MCP tool interfaces", async () => {
      const tools = createTransferMcpTools();
      expect(tools).toHaveLength(4);

      const createTool = tools.find((t) => t.name === "artifact_transfer.create")!;
      const createRes = await createTool.handler({
        filename: "artifact.tar.gz",
        data: "mock tar bytes",
        sourceZone: "LOCAL_PRIVATE",
        targetNodeId: "node_vps_1",
        targetZone: "MANAGED_VPS",
      });

      expect(createRes.ok).toBe(true);
      expect(createRes.sessionId).toBeDefined();

      const statusTool = tools.find((t) => t.name === "artifact_transfer.status")!;
      const statusRes = await statusTool.handler({ sessionId: createRes.sessionId });
      expect(statusRes.ok).toBe(true);
      expect(statusRes.state).toBe("PREPARING");

      const startTool = tools.find((t) => t.name === "artifact_transfer.start")!;
      const startRes = await startTool.handler({ sessionId: createRes.sessionId });
      expect(startRes.ok).toBe(true);
      expect(startRes.state).toBe("COMPLETED");
    });
  });
});
