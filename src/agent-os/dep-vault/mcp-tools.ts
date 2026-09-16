// Phase 20.38 — WebMCP tools for the Dependency Vault (spec §20-§21).
// Permission classes: READ / SAFE_WRITE / NETWORK / DESTRUCTIVE / ADMIN.
// Destructive and admin tools require explicit human approval inside the
// service (invariant violations otherwise) and are audited.

import { getDependencyVaultService } from "./vault";
import type { WebMcpToolDefinition } from "../video/mcp-tools";
import type { InstallMode } from "./types";

function modeFrom(args: Record<string, unknown>): InstallMode {
  const mode = args.mode;
  if (mode === "ONLINE" || mode === "OFFLINE" || mode === "OFFLINE_PREFERRED" || mode === "STRICT_AIR_GAP") return mode;
  return "OFFLINE_PREFERRED";
}

export const DEPENDENCY_VAULT_MCP_TOOLS: WebMcpToolDefinition[] = [
  {
    name: "dependency_vault_status",
    description: "Vault overview: package/artifact counts, trust states, cache size (READ).",
    riskTier: "R0", readOnly: true,
    execute: () => getDependencyVaultService().status(),
  },
  {
    name: "dependency_vault_scan_project",
    description: "Parse a project lockfile into the normalized dependency graph and index it (READ).",
    riskTier: "R0", readOnly: true,
    execute: (args) => {
      const graph = getDependencyVaultService().scanProject(String(args.projectDir ?? ""), (args.packageManager as never) ?? "npm");
      return { projectKey: graph.projectKey, lockfileType: graph.lockfileType, lockfileHash: graph.lockfileHash, packages: graph.nodes.length };
    },
  },
  {
    name: "dependency_vault_ensure_project",
    description: "Acquire + verify every lockfile dependency for a project (NETWORK; respects install mode).",
    riskTier: "R2", readOnly: false,
    execute: async (args) => {
      const result = await getDependencyVaultService().ensureProject({
        projectDir: String(args.projectDir ?? ""),
        packageManager: args.packageManager as never,
        mode: modeFrom(args),
        actor: typeof args.actor === "string" ? args.actor : "agent",
      });
      return { ok: result.ok, succeeded: result.succeeded.length, failed: result.failed, warnings: result.warnings };
    },
  },
  {
    name: "dependency_vault_install_project",
    description: "Offline-first install: verifies every dependency is VERIFIED in the vault before the package manager runs (SAFE_WRITE).",
    riskTier: "R2", readOnly: false,
    execute: (args) => getDependencyVaultService().installProject({
      projectDir: String(args.projectDir ?? ""),
      mode: modeFrom(args),
      actor: typeof args.actor === "string" ? args.actor : "agent",
    }),
  },
  {
    name: "dependency_vault_cache_stats",
    description: "Cache statistics: states, bytes, deduplicated blobs (READ).",
    riskTier: "R0", readOnly: true,
    execute: () => getDependencyVaultService().status(),
  },
  {
    name: "dependency_vault_verify_cache",
    description: "Recompute SHA-512 for all VERIFIED blobs and report mismatches (READ-only over bytes).",
    riskTier: "R1", readOnly: true,
    execute: () => getDependencyVaultService().verifyCache(),
  },
  {
    name: "dependency_vault_prewarm_profile",
    description: "Pre-acquire a dependency profile (NETWORK).",
    riskTier: "R2", readOnly: false,
    execute: async (args) => {
      const result = await getDependencyVaultService().ensureProfile(String(args.profileId ?? ""), modeFrom(args), typeof args.actor === "string" ? args.actor : "agent");
      return { ok: result.ok, succeeded: result.succeeded, failed: result.failed };
    },
  },
  {
    name: "dependency_vault_list_profiles",
    description: "List the seeded dependency profiles (READ).",
    riskTier: "R0", readOnly: true,
    execute: () => getDependencyVaultService().listProfiles(),
  },
  {
    name: "dependency_vault_export_bundle",
    description: "Export verified artifacts into a .offpack bundle tree (SAFE_WRITE).",
    riskTier: "R2", readOnly: false,
    execute: (args) => {
      const bundle = getDependencyVaultService().exportBundle({ name: String(args.name ?? "bundle"), projectDir: args.projectDir ? String(args.projectDir) : undefined, actor: "agent" });
      return { bundleId: bundle.bundleId, outputDir: bundle.outputDir, packageCount: bundle.manifest.packageCount };
    },
  },
  {
    name: "dependency_vault_import_bundle",
    description: "Import a .offpack bundle: verifies manifest, checksums and every blob before CAS insertion (SAFE_WRITE).",
    riskTier: "R2", readOnly: false,
    execute: (args) => {
      const result = getDependencyVaultService().importBundle({ bundleDir: String(args.bundleDir ?? ""), actor: "agent" });
      return { ok: result.ok, succeeded: result.succeeded.length, failed: result.failed };
    },
  },
  {
    name: "dependency_vault_generate_sbom",
    description: "Generate a CycloneDX SBOM from the project lockfile graph (READ).",
    riskTier: "R0", readOnly: true,
    execute: (args) => getDependencyVaultService().generateSbom(String(args.projectDir ?? ""), (args.packageManager as never) ?? "npm"),
  },
  {
    name: "dependency_vault_audit_project",
    description: "Recent dependency-vault audit events (READ).",
    riskTier: "R0", readOnly: true,
    execute: (args) => getDependencyVaultService().listAudit(typeof args.limit === "number" ? args.limit : 30),
  },
  {
    name: "dependency_vault_inspect_package",
    description: "Inspect one package artifact: trust state, integrity, size, storage path (READ).",
    riskTier: "R0", readOnly: true,
    execute: (args) => {
      const packageKey = String(args.packageKey ?? "");
      const artifact = getDependencyVaultService().findArtifactByPackageKey(packageKey);
      return artifact ?? { packageKey, note: "not in vault" };
    },
  },
];
