// Phase 20.38 — vault policy engine (spec §10, §39), error codes (§38) and
// secret redaction. Fail-closed by default: unknown registry, plain HTTP,
// missing integrity and oversized packages are refused unless explicitly
// permitted by policy.

import { redactSecrets as unifiedRedact } from "../unified-runtime/security";
import type { InstallMode, PackageRecord, PolicyDecision, VaultPolicy } from "./types";

export type DependencyErrorCode =
  | "DEPENDENCY_LOCKFILE_NOT_FOUND"
  | "DEPENDENCY_UNSUPPORTED_LOCKFILE"
  | "DEPENDENCY_REGISTRY_BLOCKED"
  | "DEPENDENCY_DOWNLOAD_FAILED"
  | "DEPENDENCY_INTEGRITY_MISMATCH"
  | "DEPENDENCY_ARCHIVE_UNSAFE"
  | "DEPENDENCY_QUARANTINED"
  | "DEPENDENCY_NOT_CACHED"
  | "DEPENDENCY_OFFLINE_MISS"
  | "DEPENDENCY_BUNDLE_INVALID"
  | "DEPENDENCY_BUNDLE_TAMPERED"
  | "DEPENDENCY_POLICY_DENIED"
  | "DEPENDENCY_INSTALL_FAILED"
  | "DEPENDENCY_PACKAGE_MANAGER_MISSING"
  | "NOT_FOUND";

export class DependencyVaultError extends Error {
  readonly code: DependencyErrorCode;

  constructor(code: DependencyErrorCode, message: string) {
    super(`[${code}] ${unifiedRedact(message)}`);
    this.name = "DependencyVaultError";
    this.code = code;
  }
}

export function defaultPolicy(): VaultPolicy {
  return {
    version: 1,
    registries: {
      default: process.env.DEPENDENCY_VAULT_REGISTRY || "https://registry.npmjs.org",
      allow: [process.env.DEPENDENCY_VAULT_REGISTRY || "https://registry.npmjs.org"],
      deny: [],
    },
    security: {
      requireIntegrity: true,
      requireHttps: true,
      requireLockfileForOfflineInstall: true,
      quarantineIntegrityMismatch: true,
    },
    downloads: {
      maxConcurrency: Number(process.env.DEPENDENCY_VAULT_MAX_CONCURRENCY || 8),
      timeoutSeconds: 60,
      maxPackageSizeMb: Number(process.env.DEPENDENCY_VAULT_MAX_PACKAGE_MB || 512),
    },
    installation: {
      allowLifecycleScripts: process.env.DEPENDENCY_VAULT_ALLOW_SCRIPTS === "true",
      allowNetworkFallback: process.env.DEPENDENCY_VAULT_ALLOW_NETWORK_FALLBACK === "true",
    },
    bundles: { requireManifestHash: true, rejectUnknownManifestVersion: true },
  };
}

/** Registry origin check (§39): allowlist wins, denylist wins harder, plain
 *  HTTP is refused unless policy explicitly disables requireHttps. */
export function evaluateRegistry(policy: VaultPolicy, registryOrigin: string): PolicyDecision {
  const origin = registryOrigin.replace(/\/+$/, "").toLowerCase();
  if (policy.registries.deny.some((denied) => origin === denied.replace(/\/+$/, "").toLowerCase())) {
    return { allowed: false, decision: "deny", reason: "registry is explicitly denied by policy", rule: "registry.deny" };
  }
  const allowed = policy.registries.allow.some((entry) => origin === entry.replace(/\/+$/, "").toLowerCase());
  if (!allowed) {
    return { allowed: false, decision: "deny", reason: "registry is not in the policy allowlist (unknown registries fail closed)", rule: "registry.allow" };
  }
  if (policy.security.requireHttps && !origin.startsWith("https://")) {
    return { allowed: false, decision: "deny", reason: "plain-HTTP registries are refused by policy", rule: "security.require_https" };
  }
  return { allowed: true, decision: "allow", reason: "registry allowed by policy", rule: "registry.allow" };
}

/** Air-gap enforcement (§24, §39): OFFLINE and STRICT_AIR_GAP never touch the
 *  network; STRICT_AIR_GAP must fail rather than fall back. */
export function evaluateNetworkMode(mode: InstallMode, cached: boolean): PolicyDecision {
  if (cached) return { allowed: true, decision: "allow", reason: "artifact served from vault cache", rule: "cache.hit" };
  if (mode === "OFFLINE") {
    return { allowed: false, decision: "deny", reason: "offline mode makes no network requests", rule: "install.offline" };
  }
  if (mode === "STRICT_AIR_GAP") {
    return { allowed: false, decision: "deny", reason: "strict air-gap fails on cache miss (no fallback)", rule: "install.strict_air_gap" };
  }
  if (mode === "OFFLINE_PREFERRED" && !policyAllowsFallback()) {
    return { allowed: false, decision: "deny", reason: "offline-preferred without an approved network fallback policy", rule: "installation.allow_network_fallback" };
  }
  return { allowed: true, decision: "allow", reason: "online acquisition permitted", rule: "install.online" };
}

function policyAllowsFallback(): boolean {
  return process.env.DEPENDENCY_VAULT_ALLOW_NETWORK_FALLBACK === "true";
}

/** Quarantined/BLOCKED artifacts can never install (§39 invariant 1). */
export function evaluateInstallability(trustState: PackageRecord["updatedAt"] extends never ? never : import("./types").TrustState): PolicyDecision {
  if (trustState === "VERIFIED") {
    return { allowed: true, decision: "allow", reason: "artifact is VERIFIED", rule: "trust.verified" };
  }
  if (trustState === "QUARANTINED") {
    return { allowed: false, decision: "quarantine", reason: "artifact is QUARANTINED — manual review required", rule: "trust.quarantined" };
  }
  if (trustState === "BLOCKED") {
    return { allowed: false, decision: "deny", reason: "artifact is BLOCKED", rule: "trust.blocked" };
  }
  return { allowed: false, decision: "deny", reason: `artifact is ${trustState}, not VERIFIED — unverified artifacts cannot install`, rule: "trust.unverified" };
}

export function redactVaultLog(text: string, maxChars = 2000): string {
  const redacted = unifiedRedact(text).replace(/\/\/[^\s@]*@[^\s/]*/g, "//[REDACTED-creds]");
  return redacted.length > maxChars ? redacted.slice(0, maxChars) + "…[truncated]" : redacted;
}
