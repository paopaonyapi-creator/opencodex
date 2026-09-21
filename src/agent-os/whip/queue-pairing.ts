// Phase 20.99 — Offline-Safe Command Queue, Biometric Credential Vault & QR Pairing (§13, §15, §16).
//
// Key principles:
// - Queued intent is NOT pre-approved intent: policy must be rechecked upon reconnect.
// - Prohibited from silent offline replay: destructive deletes, git reset, force push, deploy.
// - If host/session/context revision changed while offline → mark NEEDS_REVIEW.
// - QR Pairing payload carries only short-lived ephemeral bootstrap keys; no permanent master secrets.
// - Revoked mobile devices cannot establish new authorized sessions.

import { sha256Hex } from "../agent-runtime/hash";
import { newWhipId, nowIso, WhipStore } from "./store";
import {
  type PairingSession,
  type QrPairingPayload,
  type QueuedIntent,
  type WhipDevice,
  type WhipRiskClass,
  WhipError,
} from "./types";

export class OfflineCommandQueue {
  private readonly store: WhipStore;

  constructor(store?: WhipStore) {
    this.store = store ?? new WhipStore();
  }

  enqueueIntent(input: {
    hostId: string;
    deviceId: string;
    targetRef: Record<string, unknown>;
    semanticAction: string;
    payload: Record<string, unknown>;
    contextRevision: number;
    riskClass?: WhipRiskClass;
  }): QueuedIntent {
    const payloadStr = JSON.stringify(input.payload);
    const hash = sha256Hex(payloadStr);
    const risk = input.riskClass ?? "R1";

    const intent: QueuedIntent = {
      id: newWhipId("whpi"),
      hostId: input.hostId,
      deviceId: input.deviceId,
      targetRefJson: JSON.stringify(input.targetRef),
      semanticAction: input.semanticAction,
      payloadHash: hash,
      encryptedPayloadRef: `payload_ref_${hash.slice(0, 12)}`,
      contextRevision: input.contextRevision,
      riskClass: risk,
      state: "queued_local",
      rejectionReason: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    this.store.insertQueuedIntent(intent);
    return intent;
  }

  /**
   * Reconnect replay evaluator (spec §13.3, §13.4).
   * Must recheck context revision, session identity, and risk.
   * High-risk actions (R3/R4) or changed context MUST NOT silently replay.
   */
  evaluateQueuedIntentOnReconnect(
    intentId: string,
    currentContextRevision: number,
  ): { readyToSend: boolean; state: QueuedIntent["state"]; reason?: string } {
    const intent = this.store.getQueuedIntent(intentId);
    if (!intent) {
      throw new WhipError("INVALID_INPUT", `queued intent not found: ${intentId}`);
    }

    // 1. Prohibit silent replay of R3/R4 high-risk actions
    if (intent.riskClass === "R3" || intent.riskClass === "R4") {
      this.store.updateQueuedIntentState(
        intentId,
        "needs_review",
        `high-risk ${intent.riskClass} action '${intent.semanticAction}' requires explicit operator re-approval`,
      );
      return {
        readyToSend: false,
        state: "needs_review",
        reason: "high-risk action prohibited from silent offline replay",
      };
    }

    // 2. Check if context/session revision changed while offline
    if (currentContextRevision !== intent.contextRevision) {
      this.store.updateQueuedIntentState(
        intentId,
        "needs_review",
        `context revision changed from ${intent.contextRevision} to ${currentContextRevision} while offline`,
      );
      return {
        readyToSend: false,
        state: "needs_review",
        reason: "context revision mismatch; operator review required",
      };
    }

    // 3. Safe to proceed to policy recheck / dispatch
    this.store.updateQueuedIntentState(intentId, "policy_recheck");
    return { readyToSend: true, state: "policy_recheck" };
  }

  listQueuedIntents(hostId?: string): QueuedIntent[] {
    return this.store.listQueuedIntents({ hostId });
  }
}

export class DevicePairingManager {
  private readonly store: WhipStore;

  constructor(store?: WhipStore) {
    this.store = store ?? new WhipStore();
  }

  /**
   * Host CLI: `pao pair mobile` creates a short-lived pairing session (spec §16.2).
   */
  createPairingSession(hostHint: string, port = 22, ttlMinutes = 5): { session: PairingSession; qrPayload: QrPairingPayload } {
    const id = newWhipId("whpps");
    const pairingCode = crypto.randomUUID().slice(0, 8);
    const nonce = crypto.randomUUID().replace(/-/g, "");
    const ephemeralPublicKey = sha256Hex(`eph_${id}_${nonce}`);
    const randomSuffix = crypto.getRandomValues(new Uint32Array(1))[0] % 90 + 10;
    const words = ["FROST", "MANGO", "RIVER", randomSuffix.toString()];
    const verificationPhrase = words.join("-");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000).toISOString();

    const session: PairingSession = {
      id,
      pairingCode,
      verificationPhrase,
      hostHint,
      port,
      ephemeralPublicKey,
      nonce,
      state: "pending",
      createdAt: now.toISOString(),
      expiresAt,
    };

    this.store.insertPairingSession(session);

    const qrPayload: QrPairingPayload = {
      v: 1,
      pairing_id: id,
      host_hint: hostHint,
      port,
      ephemeral_public_key: ephemeralPublicKey,
      nonce,
      expires_at: expiresAt,
    };

    return { session, qrPayload };
  }

  /**
   * Mobile client scans QR and completes handshake (spec §16.4).
   */
  completePairing(
    pairingCode: string,
    deviceInfo: { label: string; publicKey: string; platform: WhipDevice["platform"]; biometricEnabled?: boolean },
  ): WhipDevice {
    const session = this.store.getPairingSession(pairingCode);
    if (!session) {
      throw new WhipError("PAIRING_INVALID", "pairing code not found or invalid");
    }
    if (session.state !== "pending") {
      throw new WhipError("PAIRING_INVALID", `pairing session is already ${session.state}`);
    }
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      throw new WhipError("PAIRING_EXPIRED", "pairing session has expired (5-minute window passed)");
    }

    const device: WhipDevice = {
      id: newWhipId("whpdev"),
      label: deviceInfo.label,
      publicKey: deviceInfo.publicKey,
      platform: deviceInfo.platform,
      deviceModelHint: "Mobile Agent Console",
      biometricEnabled: deviceInfo.biometricEnabled ?? false,
      status: "active",
      policyScope: ["*"],
      createdAt: nowIso(),
      lastSeenAt: nowIso(),
      revokedAt: null,
    };

    this.store.insertDevice(device);
    this.store.markPairingCompleted(session.id);
    return device;
  }

  /**
   * Revoke paired device (spec §16.5).
   */
  revokeDevice(deviceId: string): void {
    const dev = this.store.getDevice(deviceId);
    if (!dev) {
      throw new WhipError("DEVICE_NOT_FOUND", `device not found: ${deviceId}`);
    }
    this.store.revokeDevice(deviceId);
  }

  isDeviceAuthorized(deviceId: string): boolean {
    const dev = this.store.getDevice(deviceId);
    return dev !== null && dev.status === "active";
  }
}
