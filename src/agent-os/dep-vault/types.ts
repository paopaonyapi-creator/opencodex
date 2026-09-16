// Phase 20.38 — Pao-hubPro × OFFPack-inspired Dependency Vault: canonical
// contracts. CLEAN-ROOM: OFFPack is an architectural reference (fetch once →
// local cache → install offline); all code is original to this repository.
//
// Reuse map: shared SQLite store (additive v38), Phase 20.24 URL policy for
// registry SSRF/HTTPS validation, Phase 20.33 allowlisted process runner for
// package-manager commands, Phase 20.35 redaction, established MCP/routes/GUI
// patterns. Package managers (npm/pnpm/bun) remain the authoritative
// installers — the Vault owns acquisition, integrity, policy, CAS, profiles,
// bundles, SBOM and audit (spec §4, §47).

export type TrustState =
  | "DISCOVERED" | "DOWNLOADING" | "DOWNLOADED" | "VERIFYING"
  | "VERIFIED" | "QUARANTINED" | "BLOCKED" | "DELETED";

/** DOWNLOADED != VERIFIED: only VERIFIED artifacts may install (§8). */
export const INSTALLABLE_STATES: readonly TrustState[] = ["VERIFIED"];

export type InstallMode = "ONLINE" | "OFFLINE" | "OFFLINE_PREFERRED" | "STRICT_AIR_GAP";

export interface VaultPolicy {
  version: number;
  registries: { default: string; allow: string[]; deny: string[] };
  security: {
    requireIntegrity: boolean;
    requireHttps: boolean;
    requireLockfileForOfflineInstall: boolean;
    quarantineIntegrityMismatch: boolean;
  };
  downloads: { maxConcurrency: number; timeoutSeconds: number; maxPackageSizeMb: number };
  installation: { allowLifecycleScripts: boolean; allowNetworkFallback: boolean };
  bundles: { requireManifestHash: boolean; rejectUnknownManifestVersion: boolean };
}

export interface PackageRecord {
  id: string;
  name: string;
  version: string;
  registry: string;
  packageKey: string; // registry|name|version
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactRecord {
  id: string;
  packageKey: string;
  tarballUrl: string | null;
  registryOrigin: string;
  /** npm integrity format: sha512-<base64>. Null until known. */
  integrity: string | null;
  sha512Hex: string | null;
  sizeBytes: number;
  storagePath: string | null; // relative CAS path once VERIFIED
  trustState: TrustState;
  pinned: boolean;
  pinnedBy: string | null;
  verifiedAt: string | null;
  downloadedAt: string | null;
  quarantineReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DependencyNode {
  name: string;
  version: string;
  integrity: string | null;
  resolved: string | null;
  direct: boolean;
  dev: boolean;
  optional: boolean;
  peer: boolean;
}

export interface DependencyGraph {
  projectKey: string;
  projectPath: string;
  packageManager: "npm" | "pnpm" | "bun";
  lockfileType: "package-lock" | "npm-shrinkwrap" | "pnpm-lock" | "bun-lock";
  lockfileHash: string;
  nodes: DependencyNode[];
}

export interface ProfileDefinition {
  id: string;
  name: string;
  version: number;
  packageManager: "npm" | "pnpm" | "bun";
  packages: Array<{ name: string; version: string }>;
  capabilities: string[];
}

export interface BundleManifest {
  format: "pao-offpack";
  version: 1;
  bundleId: string;
  createdAt: string;
  project: { name: string; packageManager: string };
  packageCount: number;
  blobs: Array<{ sha512Hex: string; sizeBytes: number; packageKeys: string[] }>;
  manifestHash: string;
}

export interface DependencyOperationResult {
  ok: boolean;
  succeeded: string[];
  failed: Array<{ package: string; code: string; message: string }>;
  warnings: string[];
}

export interface PolicyDecision {
  allowed: boolean;
  decision: "allow" | "deny" | "quarantine";
  reason: string;
  rule: string;
}
