// Phase 20.99 — Secure transport core and strict host-key verification (§2.5, §17, §18).
//
// Key requirements:
// - Strict host-key checking: known_good → allow; unknown → explicit approval; changed → HARD FAIL.
// - ProxyJump / bastion chain: every hop has separate trust verification.
// - Tailscale-compatible addressing (e.g. 100.x.y.z or *.ts.net).
// - Connection generation counter: stale callbacks from older generations are dropped.

import { sha256Hex } from "../agent-runtime/hash";
import { newWhipId, nowIso, WhipStore } from "./store";
import { type KeyTrustStatus, type TrustedHostKey, type WhipHost, WhipError } from "./types";

export interface HostConnectionResult {
  hostId: string;
  generation: number;
  status: WhipHost["status"];
  connectedAt: string;
  hopFingerprints: string[];
}

export class SecureTransportCore {
  private readonly store: WhipStore;

  constructor(store?: WhipStore) {
    this.store = store ?? new WhipStore();
  }

  /**
   * Verify an observed host key against trusted keys.
   * Fails closed if host key changed (spec §2.5, §17).
   */
  verifyHostKey(
    hostId: string,
    hopIndex: number,
    algorithm: string,
    fingerprintSha256: string,
  ): { status: KeyTrustStatus; approved: boolean; trustedKey?: TrustedHostKey } {
    const trustedKeys = this.store.getTrustedKeys(hostId);
    const existing = trustedKeys.find((k) => k.hopIndex === hopIndex);

    if (!existing) {
      return { status: "unknown", approved: false };
    }

    if (existing.fingerprintSha256 === fingerprintSha256) {
      if (existing.trustStatus === "revoked") {
        throw new WhipError("HOST_KEY_CHANGED", "host key has been explicitly revoked");
      }
      return { status: "known_good", approved: true, trustedKey: existing };
    }

    // Key changed: HARD FAIL (no silent replacement)
    throw new WhipError(
      "HOST_KEY_CHANGED",
      `POSSIBLE MITM ATTACK: host key for hop ${hopIndex} changed from ${existing.fingerprintSha256} to ${fingerprintSha256}`,
      { hostId, hopIndex, oldFingerprint: existing.fingerprintSha256, newFingerprint: fingerprintSha256 },
    );
  }

  /**
   * Explicitly approve an unknown host key (TOFU with user verification).
   */
  approveHostKey(hostId: string, hopIndex: number, algorithm: string, fingerprintSha256: string, approver: string): TrustedHostKey {
    const key: TrustedHostKey = {
      id: newWhipId("whpk"),
      hostId,
      hopIndex,
      algorithm,
      fingerprintSha256,
      trustStatus: "known_good",
      approvedAt: nowIso(),
      approvedBy: approver,
    };
    this.store.upsertTrustedKey(key);
    return key;
  }

  /**
   * Connect to a host with generation tracking and strict multi-hop key checks.
   */
  async connectHost(
    hostId: string,
    observedHopFingerprints: Array<{ hopIndex: number; algorithm: string; fingerprint: string }>,
  ): Promise<HostConnectionResult> {
    const host = this.store.getHost(hostId);
    if (!host) {
      throw new WhipError("HOST_NOT_FOUND", `host profile not found: ${hostId}`);
    }

    // Verify all hops along the route
    for (const hop of observedHopFingerprints) {
      const v = this.verifyHostKey(hostId, hop.hopIndex, hop.algorithm, hop.fingerprint);
      if (!v.approved) {
        throw new WhipError(
          "HOST_KEY_UNKNOWN",
          `unknown host key at hop ${hop.hopIndex} (fingerprint: ${hop.fingerprint}); explicit approval required`,
          { hostId, hopIndex: hop.hopIndex, fingerprint: hop.fingerprint },
        );
      }
    }

    // Increment runtime generation counter on reconnect (§23)
    const updated = this.store.updateHostStatus(hostId, "online", true)!;

    return {
      hostId: updated.id,
      generation: updated.runtimeGeneration,
      status: updated.status,
      connectedAt: updated.lastConnectedAt!,
      hopFingerprints: observedHopFingerprints.map((h) => h.fingerprint),
    };
  }

  /**
   * Generation guard helper (§2.4, §23).
   * Drops callbacks or stream events originating from superseded connection epochs.
   */
  isGenerationValid(hostId: string, eventGeneration: number): boolean {
    const host = this.store.getHost(hostId);
    if (!host) return false;
    return host.runtimeGeneration === eventGeneration;
  }
}
