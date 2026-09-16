// Phase 20.24 — Pao-hubPro × OmniGet Local Media Acquisition & MCP Engine
// Local Bridge Security & Browser Extension Pairing Layer

import { createHmac, randomBytes } from "node:crypto";
import type { BridgePairingRequest, BridgePairingResponse, BridgeDispatchRequest } from "./types";
import { MediaError } from "./errors";

export class LocalBridgeSecurity {
  private serverSecret = randomBytes(32).toString("hex");
  private activeSessions = new Map<string, { extensionId: string; expiresAtMs: number }>();
  private seenNonces = new Set<string>();

  pair(request: BridgePairingRequest): BridgePairingResponse {
    const now = Date.now();
    // Validate timestamp within 60s skew
    if (Math.abs(now - request.timestamp) > 60_000) {
      throw new MediaError("MEDIA_PERMISSION_DENIED", "Bridge pairing failed: Timestamp out of valid window.");
    }

    if (this.seenNonces.has(request.clientNonce)) {
      throw new MediaError("MEDIA_PERMISSION_DENIED", "Bridge pairing failed: Nonce replay detected.");
    }
    this.seenNonces.add(request.clientNonce);

    const serverNonce = randomBytes(16).toString("hex");
    const installationToken = `pao_inst_${randomBytes(24).toString("hex")}`;
    const sessionToken = `pao_sess_${randomBytes(24).toString("hex")}`;
    const expiresAtMs = now + 24 * 60 * 60 * 1000; // 24 hours

    this.activeSessions.set(sessionToken, {
      extensionId: request.extensionId,
      expiresAtMs,
    });

    return {
      installationToken,
      sessionToken,
      serverNonce,
      expiresAtMs,
    };
  }

  verifyRequest(request: BridgeDispatchRequest): boolean {
    const session = this.activeSessions.get(request.sessionToken);
    if (!session) {
      throw new MediaError("MEDIA_PERMISSION_DENIED", "Invalid or expired local bridge session token.");
    }

    if (session.extensionId !== request.extensionId) {
      throw new MediaError("MEDIA_PERMISSION_DENIED", "Bridge extension identity mismatch.");
    }

    if (Date.now() > session.expiresAtMs) {
      this.activeSessions.delete(request.sessionToken);
      throw new MediaError("MEDIA_PERMISSION_DENIED", "Bridge session token has expired.");
    }

    return true;
  }
}
