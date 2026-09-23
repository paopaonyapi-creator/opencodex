// Phase 20.15 — Cloud Sandbox Plane: feature flags and trust-zone gating.
//
// Follows the repository's existing opt-in convention (`PAO_MOBILE_ENABLED`,
// `PAO_KNOWLEDGE_ENABLED`, `VIDEO_INTELLIGENCE_LOCAL_ONLY`) rather than the YAML flag
// block in source spec §68: there is no feature-flag framework in `src/agent-os/`, and
// building one for a single subsystem would be a rung-7 addition where rung-2 reuse fits.
//
// Every flag defaults to the safe side. A process that sets nothing runs no cloud code.

import { CloudSandboxError, type CloudSandboxErrorCode } from "./errors";
import type { CloudEnvironment } from "./types";

export interface CloudSandboxFlags {
  enabled: boolean;
  localOnly: boolean;
  flociImage: string | null;
  flociEndpoint: string;
  dockerControlEnabled: boolean;
  iacEnabled: boolean;
  productionPromotionEnabled: boolean;
  multiCloudEnabled: boolean;
  dbPathOverride: string | null;
}

export const DEFAULT_FLOCI_ENDPOINT = "http://127.0.0.1:4566";

function isTruthy(value: string | undefined): boolean {
  if (value === undefined) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

/** Inverted default: `PAO_CLOUD_SANDBOX_LOCAL_ONLY` is ON unless explicitly switched off. */
function isTruthyByDefault(value: string | undefined): boolean {
  if (value === undefined) return true;
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function readString(env: NodeJS.ProcessEnv, key: string): string | null {
  const raw = env[key];
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function readCloudSandboxFlags(env: NodeJS.ProcessEnv = process.env): CloudSandboxFlags {
  return {
    enabled: isTruthy(env.PAO_CLOUD_SANDBOX_ENABLED),
    localOnly: isTruthyByDefault(env.PAO_CLOUD_SANDBOX_LOCAL_ONLY),
    flociImage: readString(env, "PAO_CLOUD_FLOCI_IMAGE"),
    flociEndpoint: readString(env, "PAO_CLOUD_FLOCI_ENDPOINT") ?? DEFAULT_FLOCI_ENDPOINT,
    dockerControlEnabled: isTruthy(env.PAO_CLOUD_DOCKER_CONTROL_ENABLED),
    iacEnabled: isTruthy(env.PAO_CLOUD_IAC_ENABLED),
    productionPromotionEnabled: isTruthy(env.PAO_CLOUD_PRODUCTION_PROMOTION_ENABLED),
    multiCloudEnabled: isTruthy(env.PAO_CLOUD_MULTI_CLOUD_ENABLED),
    dbPathOverride: readString(env, "PAO_CLOUD_SANDBOX_DB"),
  };
}

/**
 * Source spec §66: no floating `latest` in a release path.
 *
 * A bare image name is rejected too — Docker resolves it to `:latest` implicitly, so
 * accepting it would defeat the rule while looking compliant.
 */
export function validatePinnedImage(image: string | null): { ok: true } | { ok: false; reason: string } {
  if (!image) {
    return { ok: false, reason: "PAO_CLOUD_FLOCI_IMAGE is not set; a pinned image or digest is required." };
  }
  if (image.includes("@sha256:")) return { ok: true };

  const lastSegment = image.slice(image.lastIndexOf("/") + 1);
  const tagMatch = /:([^:]+)$/.exec(lastSegment);
  if (!tagMatch) {
    return { ok: false, reason: `Image "${image}" carries no explicit tag, which resolves to :latest.` };
  }
  if (tagMatch[1] === "latest") {
    return { ok: false, reason: `Image "${image}" uses the floating :latest tag.` };
  }
  return { ok: true };
}

export interface EnvironmentGate {
  allowed: boolean;
  target: CloudEnvironment;
  errorCode?: CloudSandboxErrorCode;
  reason?: string;
}

/**
 * Two independent switches must both be flipped to reach production.
 *
 * Source spec §5.6 treats production as a different trust zone and §68 opens promotion
 * last. Requiring `localOnly=false` AND `productionPromotionEnabled=true` means neither a
 * stray flag nor a copied env file can open the production path on its own.
 */
export function evaluateEnvironmentGate(
  flags: CloudSandboxFlags,
  target: CloudEnvironment,
): EnvironmentGate {
  if (!flags.enabled) {
    return {
      allowed: false,
      target,
      errorCode: "FEATURE_DISABLED",
      reason: "PAO_CLOUD_SANDBOX_ENABLED is not set; the Cloud Sandbox Plane is inactive.",
    };
  }

  if (target === "local") return { allowed: true, target };

  if (flags.localOnly) {
    return {
      allowed: false,
      target,
      errorCode: "CLOUD_POLICY_DENIED",
      reason: `PAO_CLOUD_SANDBOX_LOCAL_ONLY is active, so "${target}" is unreachable.`,
    };
  }

  if (target === "production" && !flags.productionPromotionEnabled) {
    return {
      allowed: false,
      target,
      errorCode: "PRODUCTION_GATE_DENIED",
      reason: "PAO_CLOUD_PRODUCTION_PROMOTION_ENABLED is not set.",
    };
  }

  return { allowed: true, target };
}

/** Throws rather than returning, for call sites where a disabled plane is a hard stop. */
export function assertCloudSandboxEnabled(flags: CloudSandboxFlags): void {
  if (!flags.enabled) {
    throw new CloudSandboxError(
      "FEATURE_DISABLED",
      "Cloud Sandbox Plane is disabled; set PAO_CLOUD_SANDBOX_ENABLED to activate it.",
      { operation: "flags.assertCloudSandboxEnabled" },
    );
  }
}
