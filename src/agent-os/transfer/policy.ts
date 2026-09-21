/**
 * Phase 20.87 — Transfer Policy Engine
 * Governs risk tiers (R0-R4), trust zone matrices, and approval requirements.
 */

import type {
  ArtifactClassification,
  ArtifactManifest,
  DestinationConflictPolicy,
  TransferTrustZone,
} from "./types";

export interface TransferPolicyEvaluation {
  decision: "allow" | "require_approval" | "deny";
  riskTier: "R0" | "R1" | "R2" | "R3" | "R4";
  reason: string;
  quarantineRequired: boolean;
}

export class TransferPolicyEngine {
  public static evaluate(input: {
    sourceZone: TransferTrustZone;
    targetZone: TransferTrustZone;
    manifest: ArtifactManifest;
    destinationConflictPolicy?: DestinationConflictPolicy;
  }): TransferPolicyEvaluation {
    const { sourceZone, targetZone, manifest, destinationConflictPolicy } = input;

    // 1. Hard Deny: secret_like artifacts outbound
    if (manifest.classification === "secret_like") {
      return {
        decision: "deny",
        riskTier: "R4",
        reason: "Security policy violation: outbound transfer of secret_like artifacts is strictly denied.",
        quarantineRequired: true,
      };
    }

    // 2. Destructive destination conflict policy
    if (destinationConflictPolicy === "overwrite") {
      return {
        decision: "require_approval",
        riskTier: "R3",
        reason: "Destination conflict policy 'overwrite' requires explicit human confirmation.",
        quarantineRequired: false,
      };
    }

    // 3. Executable or Script inbound from any non-local zone
    if (
      (manifest.classification === "executable" || manifest.classification === "script") &&
      sourceZone !== "LOCAL_PRIVATE"
    ) {
      return {
        decision: "require_approval",
        riskTier: "R3",
        reason: `Inbound ${manifest.classification} from non-local zone '${sourceZone}' requires human approval and quarantine scan.`,
        quarantineRequired: true,
      };
    }

    // 4. Untrusted / External Zone boundaries
    if (sourceZone === "EXTERNAL_UNTRUSTED" || targetZone === "EXTERNAL_UNTRUSTED") {
      return {
        decision: "require_approval",
        riskTier: "R3",
        reason: "Transfer crosses into or from EXTERNAL_UNTRUSTED zone; human approval required.",
        quarantineRequired: sourceZone === "EXTERNAL_UNTRUSTED",
      };
    }

    // 5. Quarantined Zone transfers
    if (sourceZone === "QUARANTINED" || targetZone === "QUARANTINED") {
      return {
        decision: "deny",
        riskTier: "R4",
        reason: "Transfers involving QUARANTINED zone are blocked until scan release.",
        quarantineRequired: true,
      };
    }

    // 6. Trusted zone internal transfers
    return {
      decision: "allow",
      riskTier: "R2",
      reason: `Trusted zone transfer (${sourceZone} -> ${targetZone}) permitted with cryptographic audit.`,
      quarantineRequired: false,
    };
  }
}
