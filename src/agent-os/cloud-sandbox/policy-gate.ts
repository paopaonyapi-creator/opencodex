// Phase 20.15 M2 — Cloud Sandbox Plane: policy gate adapter.
//
// Translates the shared Phase 05 capability verdict into the cloud policy shape. It exists as its
// own module so `SandboxManager` stays free of the central store handle and can be tested with an
// injected stub, while the real enforcement point remains the single deny-by-default
// `evaluateCapability()` the rest of Agent OS already answers to -- source spec §17 asks for a
// policy decision per infrastructure action, not a second parallel policy engine.

import { evaluateCapability, type Capability } from "../policy";
import type { CloudPolicyVerdict } from "./types";

export type CloudGateCapability = Extract<Capability, "cloud.sandbox" | "cloud.iac.local">;

export function cloudPolicyVerdict(
  actorId: string,
  capability: CloudGateCapability,
): CloudPolicyVerdict {
  const decision = evaluateCapability("agent", actorId, capability);

  if (decision.allowed) {
    return { allowed: true, decision: "allow", reason: decision.reason };
  }
  if (decision.reason === "approval_required") {
    return {
      allowed: false,
      decision: "approval_required",
      code: "CLOUD_APPROVAL_REQUIRED",
      reason: `${capability} needs a human-granted permit before it can run.`,
    };
  }
  return {
    allowed: false,
    decision: "deny",
    code: "CLOUD_POLICY_DENIED",
    reason: `${capability} denied for agent ${actorId}: ${decision.reason}`,
  };
}

export function createCloudPolicyGate(): (actorId: string, capability: CloudGateCapability) => CloudPolicyVerdict {
  return (actorId, capability) => cloudPolicyVerdict(actorId, capability);
}
