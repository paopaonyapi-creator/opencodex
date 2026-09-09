/**
 * Phase 25 — Pao Autonomous Security & Zero-Trust Threat Immunity Shield (ASTIS)
 * Action Authenticator: Cryptographic Action Proofs (HMAC-SHA256) & Replay Defense
 */

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { ActionProof } from "./types";

export interface VerificationResult {
  valid: boolean;
  reason?: string;
  proof?: ActionProof;
}

export class ActionAuthenticator {
  private seenNonces: Map<string, number> = new Map();
  private maxProofAgeMs: number;

  constructor(maxProofAgeMs: number = 60_000) {
    this.maxProofAgeMs = maxProofAgeMs;
  }

  public hashPayload(payload: unknown): string {
    const raw = typeof payload === "string" ? payload : JSON.stringify(payload ?? "");
    return createHash("sha256").update(raw).digest("hex");
  }

  /**
   * Generates a cryptographically signed ActionProof for an agent action.
   */
  public createProof(
    agentId: string,
    actionType: string,
    payload: unknown,
    secret: string
  ): ActionProof {
    const payloadHash = this.hashPayload(payload);
    const nonce = randomUUID();
    const timestamp = Date.now();
    const id = `prf_${nonce.slice(0, 12)}`;

    const message = `${agentId}:${actionType}:${payloadHash}:${nonce}:${timestamp}`;
    const signature = createHmac("sha256", secret).update(message).digest("hex");

    return {
      id,
      agentId,
      actionType,
      payloadHash,
      timestamp,
      nonce,
      signature,
    };
  }

  /**
   * Cleans up expired nonces beyond maxProofAgeMs window.
   */
  private pruneNonces(now: number): void {
    for (const [nonce, ts] of this.seenNonces.entries()) {
      if (now - ts > this.maxProofAgeMs * 2) {
        this.seenNonces.delete(nonce);
      }
    }
  }

  /**
   * Verifies an ActionProof for validity, freshness, replay defense, and payload integrity.
   */
  public verifyProof(
    proof: ActionProof,
    expectedAgentId: string,
    payload: unknown,
    secret: string,
    now: number = Date.now()
  ): VerificationResult {
    this.pruneNonces(now);

    if (!proof || typeof proof !== "object") {
      return { valid: false, reason: "Missing or malformed ActionProof." };
    }

    if (proof.agentId !== expectedAgentId) {
      return {
        valid: false,
        reason: `Agent mismatch: proof belongs to '${proof.agentId}', expected '${expectedAgentId}'.`,
      };
    }

    // Check proof freshness
    const age = now - proof.timestamp;
    if (age < -5000) {
      return { valid: false, reason: "Proof timestamp is in the future." };
    }
    if (age > this.maxProofAgeMs) {
      return { valid: false, reason: `Proof expired: age (${age}ms) exceeds limit (${this.maxProofAgeMs}ms).` };
    }

    // Replay attack defense
    if (this.seenNonces.has(proof.nonce)) {
      return { valid: false, reason: `Replay attack detected: nonce '${proof.nonce}' has already been used.` };
    }

    // Payload integrity
    const computedPayloadHash = this.hashPayload(payload);
    if (computedPayloadHash !== proof.payloadHash) {
      return { valid: false, reason: "Payload integrity violation: hash does not match ActionProof." };
    }

    // Cryptographic signature check
    const message = `${proof.agentId}:${proof.actionType}:${proof.payloadHash}:${proof.nonce}:${proof.timestamp}`;
    const expectedSig = createHmac("sha256", secret).update(message).digest("hex");

    const sigBuf = Buffer.from(proof.signature, "utf-8");
    const expBuf = Buffer.from(expectedSig, "utf-8");

    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false, reason: "Cryptographic signature verification failed: invalid secret or tampered token." };
    }

    // Register nonce as used
    this.seenNonces.set(proof.nonce, proof.timestamp);

    return { valid: true, proof };
  }
}
