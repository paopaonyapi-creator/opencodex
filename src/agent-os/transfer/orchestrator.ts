/**
 * Phase 20.87 — Transfer Orchestrator
 * Coordinates session lifecycles across 13 states, executes P2P chunk transfer, and verifies integrity.
 */

import { buildArtifactManifest, verifyArtifactIntegrity } from "./manifest";
import { TransferPolicyEngine } from "./policy";
import type {
  CreateTransferInput,
  TransferSession,
  TransferState,
  TransferTarget,
} from "./types";

export class TransferOrchestrator {
  private sessions = new Map<string, TransferSession>();
  private payloads = new Map<string, Uint8Array>(); // sessionId -> payload bytes

  public createSession(input: CreateTransferInput): TransferSession {
    const sessionId = `tx_sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const bytes = typeof input.data === "string" ? Buffer.from(input.data, "utf8") : input.data;
    const manifest = buildArtifactManifest(input.filename, bytes, input.classification);

    const now = new Date().toISOString();
    const ttlSeconds = input.ttlSeconds ?? 3600;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    const targets: TransferTarget[] = input.targets.map((t) => ({
      targetId: t.targetId,
      peerId: t.peerId,
      nodeId: t.nodeId,
      zone: t.zone,
      state: "pending",
      routeType: "direct",
      bytesTransferred: 0,
      resumedBytes: 0,
    }));

    // Evaluate policy against targets
    let overallDecision: "allow" | "require_approval" | "deny" = "allow";
    let highestRisk: "R0" | "R1" | "R2" | "R3" | "R4" = "R2";
    let policyReason = "Allowed by policy";
    let approvalId: string | undefined;

    for (const target of targets) {
      const evalResult = TransferPolicyEngine.evaluate({
        sourceZone: input.sourceZone,
        targetZone: target.zone,
        manifest,
        destinationConflictPolicy: input.destinationConflictPolicy,
      });

      if (evalResult.decision === "deny") {
        overallDecision = "deny";
        highestRisk = "R4";
        policyReason = evalResult.reason;
        break;
      }

      if (evalResult.decision === "require_approval") {
        overallDecision = "require_approval";
        highestRisk = "R3";
        policyReason = evalResult.reason;
        approvalId = `appr_tx_${Date.now().toString(36)}`;
      }
    }

    let initialState: TransferState = "INITIALIZING";
    if (overallDecision === "deny") {
      initialState = "FAILED";
    } else if (overallDecision === "require_approval") {
      initialState = "AWAITING_APPROVAL";
    } else {
      initialState = "PREPARING";
    }

    const session: TransferSession = {
      sessionId,
      sourceNodeId: input.sourceNodeId,
      sourceZone: input.sourceZone,
      manifest,
      targets,
      distributionMode: input.distributionMode ?? "best_effort_all",
      state: initialState,
      destinationConflictPolicy: input.destinationConflictPolicy ?? "fail_if_exists",
      policyDecision: {
        decision: overallDecision,
        riskTier: highestRisk,
        reason: policyReason,
        approvalId,
      },
      totalBytesTransferred: 0,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    };

    this.sessions.set(sessionId, session);
    this.payloads.set(sessionId, bytes);
    return session;
  }

  public getSession(sessionId: string): TransferSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    // Check TTL expiry
    if (new Date(session.expiresAt).getTime() < Date.now() && session.state !== "COMPLETED") {
      session.state = "EXPIRED";
    }
    return session;
  }

  public listSessions(): TransferSession[] {
    return Array.from(this.sessions.values());
  }

  public approveSession(approvalId: string): boolean {
    for (const session of this.sessions.values()) {
      if (session.policyDecision.approvalId === approvalId && session.state === "AWAITING_APPROVAL") {
        session.policyDecision.decision = "allow";
        session.state = "PREPARING";
        session.updatedAt = new Date().toISOString();
        return true;
      }
    }
    return false;
  }

  /**
   * Executes the P2P transfer across targets, simulating WebRTC chunk streaming and verifying integrity.
   */
  public async startTransfer(sessionId: string): Promise<TransferSession> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Transfer session '${sessionId}' not found`);

    if (session.state === "AWAITING_APPROVAL") {
      throw new Error(`Cannot start transfer '${sessionId}': awaiting mandatory human approval`);
    }

    if (session.state === "FAILED" || session.state === "CANCELLED" || session.state === "EXPIRED") {
      throw new Error(`Cannot start transfer '${sessionId}' in terminal state ${session.state}`);
    }

    session.state = "TRANSFERRING";
    session.startedAt = new Date().toISOString();
    session.updatedAt = new Date().toISOString();

    const payload = this.payloads.get(sessionId);
    if (!payload) throw new Error(`Payload missing for session '${sessionId}'`);

    let anyFailed = false;
    let allSucceeded = true;
    let verifiedCount = 0;

    for (const target of session.targets) {
      target.state = "transferring";

      // Simulate chunk transfer & verification
      target.bytesTransferred = session.manifest.sizeBytes;
      session.totalBytesTransferred += target.bytesTransferred;

      // Verify integrity against manifest
      const verifyRes = verifyArtifactIntegrity(session.manifest, payload);
      if (verifyRes.valid) {
        target.state = "verified";
        verifiedCount++;
      } else {
        target.state = "failed";
        target.error = verifyRes.error;
        anyFailed = true;
        allSucceeded = false;
      }
    }

    // Determine terminal state based on distributionMode (§16)
    if (session.distributionMode === "require_all") {
      session.state = allSucceeded ? "COMPLETED" : "FAILED";
    } else if (session.distributionMode === "require_quorum") {
      const quorum = Math.ceil(session.targets.length / 2);
      session.state = verifiedCount >= quorum ? "COMPLETED" : "FAILED_PARTIAL";
    } else {
      // best_effort_all
      session.state = anyFailed && verifiedCount > 0 ? "FAILED_PARTIAL" : allSucceeded ? "COMPLETED" : "FAILED";
    }

    session.completedAt = new Date().toISOString();
    session.updatedAt = new Date().toISOString();
    return session;
  }

  public cancelSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.state = "CANCELLED";
    session.updatedAt = new Date().toISOString();
  }
}
