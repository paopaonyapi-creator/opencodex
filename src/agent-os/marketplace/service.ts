// Phase 20.89 — Capability Hub service facade.
// Single entry point for management routes, MCP tools, and CLI.

import { getCapabilityRegistry, type CapabilityRow } from "./registry";
import { getCapabilityInstaller, type InstallPlan, type InstallTransactionRecord } from "./installer";
import { getPhaseImporter, buildReconciliationRows, type PhaseImportRun } from "./phase-importer";
import { assertNoCanonicalCollisions, listCanonicalPhases, RESERVED_PHASES } from "./canonical-phases";
import { evaluatePolicy } from "./policy";
import { MarketplaceError } from "./types";
import type { CapabilityType, PolicyDecision } from "./types";

export interface MarketplaceCounts {
  capabilities: number;
  versions: number;
  installations: number;
  phaseBlueprints: number;
  canonicalPhases: number;
  reservedPhases: number;
}

export class CapabilityHubService {
  listCapabilities(filter?: { type?: CapabilityType; status?: string; search?: string; limit?: number }): CapabilityRow[] {
    return getCapabilityRegistry().listCapabilities(filter as never);
  }

  getCapabilityDetail(slug: string): {
    capability: CapabilityRow;
    manifest: import("./manifest").PaoCapabilityManifest | null;
    dependencies: Array<{ kind: string; ref: string; required: boolean; state: string }>;
    permissions: Array<{ permission: string; scope: string; origin: string }>;
    policy: { decision: PolicyDecision; reasons: string[]; approvalRequired: boolean };
    installation: { id: string; state: string; enabled: boolean; lastHealthState: string } | null;
  } | null {
    const registry = getCapabilityRegistry();
    const capability = registry.getCapabilityBySlug(slug);
    if (!capability) return null;
    const version = registry.getLatestVersion(capability.id);
    const manifest = version ? registry.getManifest(version.id) : null;
    let policy: { decision: PolicyDecision; reasons: string[]; approvalRequired: boolean } = { decision: "ALLOW_WITH_APPROVAL", reasons: ["no manifest version"], approvalRequired: true };
    if (manifest) {
      const evaluation = evaluatePolicy({ manifest, trustState: capability.trustState, resolvedSourceRef: version?.sourceRef ?? null });
      policy = { decision: evaluation.decision, reasons: evaluation.reasons, approvalRequired: evaluation.approvalRequired };
    }
    const installation = registry.getInstallationByCapability(capability.id);
    return {
      capability,
      manifest,
      dependencies: registry.getDependencies(capability.id),
      permissions: registry.getPermissions(capability.id),
      policy,
      installation: installation ? { id: installation.id, state: installation.state, enabled: installation.enabled, lastHealthState: installation.lastHealthState } : null,
    };
  }

  importPhases(actor: string): PhaseImportRun {
    assertNoCanonicalCollisions();
    return getPhaseImporter().importAll(actor);
  }

  planInstall(slug: string, actor: string): InstallPlan {
    return getCapabilityInstaller().planInstall({ slug, actor });
  }

  approvePlan(planId: string, approver: string): InstallPlan {
    return getCapabilityInstaller().approvePlan(planId, approver);
  }

  executePlan(planId: string, actor: string): InstallTransactionRecord {
    return getCapabilityInstaller().executePlan(planId, actor);
  }

  rollbackInstallation(installationId: string, actor: string, reason: string): InstallTransactionRecord {
    return getCapabilityInstaller().rollbackInstallation(installationId, actor, reason);
  }

  toggleFavorite(actor: string, slug: string): { favorite: boolean } {
    const registry = getCapabilityRegistry();
    const capability = registry.getCapabilityBySlug(slug);
    if (!capability) throw new MarketplaceError("CAPABILITY_NOT_FOUND", 404, `capability '${slug}' is not registered`);
    return registry.toggleFavorite(actor, capability.id);
  }

  health(): {
    ok: boolean;
    registry: MarketplaceCounts;
    invariantCheck: "pass";
  } {
    // Canonical-lock invariant: throws on corruption (mission regression law).
    assertNoCanonicalCollisions();
    const registry = getCapabilityRegistry();
    const counts = registry.counts();
    return {
      ok: true,
      registry: { ...counts, canonicalPhases: listCanonicalPhases().length, reservedPhases: RESERVED_PHASES.length },
      invariantCheck: "pass",
    };
  }

  reconciliation(): ReturnType<typeof buildReconciliationRows> {
    return buildReconciliationRows();
  }

  auditTrail(limit?: number) {
    return getCapabilityRegistry().listAudit(limit);
  }
}

let defaultService: CapabilityHubService | null = null;

export function getCapabilityHubService(): CapabilityHubService {
  if (!defaultService) defaultService = new CapabilityHubService();
  return defaultService;
}
