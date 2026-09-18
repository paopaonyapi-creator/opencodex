// Phase 20.89 — Capability Registry service (SQLite via the agent-os DB).
//
// Owns the canonical capability records: capabilities, versions, manifests,
// sources, dependencies, permissions, installations, transactions, health,
// audits, collections, favorites, phase blueprints, and phase imports.
// Schema is additive (agent-os v57).
//
// SQL discipline: every statement in this file is a fixed string with `?`
// placeholders. There is deliberately NO dynamic SQL assembly anywhere in
// the marketplace module; result shaping happens in TypeScript.

import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { openAgentOsDb } from "../db";
import type {
  CapabilityLifecycleState,
  CapabilityType,
  HealthState,
  MarketplaceAuditEvent,
  MarketplaceAuditRecord,
  PolicyDecision,
} from "./types";
import type { PaoCapabilityManifest } from "./manifest";

export interface CapabilityRow {
  id: string;
  slug: string;
  phaseId: string | null;
  name: string;
  type: CapabilityType;
  summary: string;
  status: CapabilityLifecycleState;
  trustState: string;
  riskClass: string;
  repositoryUrl: string | null;
  licenseSpdx: string;
  blueprintPath: string | null;
  blueprintStatus: string | null;
  latestVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CapabilityVersionRow {
  id: string;
  capabilityId: string;
  version: string;
  sourceRef: string | null;
  manifestJson: string;
  manifestHash: string;
  checksumSha256: string | null;
  createdAt: string;
}

export interface InstallationRow {
  id: string;
  capabilityId: string;
  versionId: string;
  state: InstallState;
  enabled: boolean;
  installedAt: string;
  lastHealthState: HealthState;
  lastHealthAt: string | null;
  snapshotRef: string | null;
}

export type InstallState =
  | "PLANNED"
  | "APPROVED"
  | "INSTALLING"
  | "INSTALLED"
  | "ROLLED_BACK"
  | "FAILED"
  | "UNINSTALLED";

export interface CapabilityFilter {
  type?: CapabilityType;
  status?: CapabilityLifecycleState;
  search?: string;
  limit?: number;
}

function rowToCapability(r: Record<string, unknown>): CapabilityRow {
  return {
    id: r.id as string,
    slug: r.slug as string,
    phaseId: (r.phase_id as string | null) ?? null,
    name: r.name as string,
    type: r.type as CapabilityType,
    summary: (r.summary as string | null) ?? "",
    status: r.status as CapabilityLifecycleState,
    trustState: r.trust_state as string,
    riskClass: r.risk_class as string,
    repositoryUrl: (r.repository_url as string | null) ?? null,
    licenseSpdx: (r.license_spdx as string | null) ?? "unknown",
    blueprintPath: (r.blueprint_path as string | null) ?? null,
    blueprintStatus: (r.blueprint_status as string | null) ?? null,
    latestVersionId: (r.latest_version_id as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

function rowToVersion(r: Record<string, unknown>): CapabilityVersionRow {
  return {
    id: r.id as string,
    capabilityId: r.capability_id as string,
    version: r.version as string,
    sourceRef: (r.source_ref as string | null) ?? null,
    manifestJson: r.manifest_json as string,
    manifestHash: r.manifest_hash as string,
    checksumSha256: (r.checksum_sha256 as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

export class CapabilityRegistry {
  /** Upserts a capability + its version from a validated manifest. */
  upsertFromManifest(input: {
    manifest: PaoCapabilityManifest;
    phaseId: string | null;
    blueprintPath: string | null;
    blueprintStatus: string | null;
    manifestYamlText: string;
    sourceRef: string | null;
    checksumSha256: string | null;
    trustState?: string;
    actor: string;
  }): { capabilityId: string; versionId: string; created: boolean } {
    const db = openAgentOsDb();
    const now = new Date().toISOString();
    const slug = input.manifest.metadata.slug || input.manifest.metadata.id;
    const manifestJson = JSON.stringify(input.manifest);
    const manifestHash = `sha256:${createHash("sha256").update(manifestJson).digest("hex")}`;
    const existing = db.query("SELECT id FROM mk_capabilities WHERE slug = ? LIMIT 1").get(slug) as { id: string } | undefined;

    let capabilityId: string;
    let created = false;
    if (existing) {
      capabilityId = existing.id;
      db.run(
        "UPDATE mk_capabilities SET name = ?, type = ?, summary = ?, trust_state = ?, repository_url = ?, license_spdx = ?, blueprint_path = COALESCE(?, blueprint_path), blueprint_status = COALESCE(?, blueprint_status), phase_id = COALESCE(?, phase_id), updated_at = ? WHERE id = ?",
        [input.manifest.metadata.name, input.manifest.spec.type, input.manifest.metadata.description, input.trustState ?? "unverified", input.manifest.metadata.sourceUrl || null, input.manifest.metadata.license, input.blueprintPath, input.blueprintStatus, input.phaseId, now, capabilityId],
      );
    } else {
      capabilityId = `cap_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
      created = true;
      db.run(
        "INSERT INTO mk_capabilities (id, slug, phase_id, name, type, summary, status, visibility, repository_url, license_spdx, publisher_name, trust_state, risk_class, blueprint_path, blueprint_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'DISCOVERED', 'private', ?, ?, ?, ?, 'unknown', ?, ?, ?, ?)",
        [capabilityId, slug, input.phaseId, input.manifest.metadata.name, input.manifest.spec.type, input.manifest.metadata.description, input.manifest.metadata.sourceUrl || null, input.manifest.metadata.license, (input.manifest.metadata.authors[0] as string) ?? null, input.trustState ?? "unverified", input.blueprintPath, input.blueprintStatus, now, now],
      );
    }

    const existingVersion = db.query("SELECT id FROM mk_capability_versions WHERE capability_id = ? AND version = ? LIMIT 1").get(capabilityId, input.manifest.spec.version) as { id: string } | undefined;
    let versionId: string;
    if (existingVersion) {
      versionId = existingVersion.id;
      db.run("UPDATE mk_capability_versions SET manifest_json = ?, manifest_hash = ?, source_ref = COALESCE(?, source_ref), checksum_sha256 = COALESCE(?, checksum_sha256) WHERE id = ?", [manifestJson, manifestHash, input.sourceRef, input.checksumSha256, versionId]);
    } else {
      versionId = `capv_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
      db.run(
        "INSERT INTO mk_capability_versions (id, capability_id, version, source_ref, manifest_json, manifest_hash, checksum_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [versionId, capabilityId, input.manifest.spec.version, input.sourceRef, manifestJson, manifestHash, input.checksumSha256, now],
      );
      db.run("UPDATE mk_capabilities SET latest_version_id = ?, status = CASE WHEN status IN ('DISCOVERED','IMPORTED') THEN 'NORMALIZED' ELSE status END, updated_at = ? WHERE id = ?", [versionId, now, capabilityId]);
    }

    // Dependencies + permissions: deterministic replace via fixed statements.
    db.run("DELETE FROM mk_capability_dependencies WHERE capability_id = ?", [capabilityId]);
    for (const dep of input.manifest.spec.dependencies.required) {
      db.run("INSERT INTO mk_capability_dependencies (id, capability_id, kind, ref, required, state) VALUES (?, ?, ?, ?, 1, 'MISSING')", [`capd_${randomUUID().replace(/-/g, "").slice(0, 16)}`, capabilityId, dep.kind, dep.ref]);
    }
    for (const dep of input.manifest.spec.dependencies.optional) {
      db.run("INSERT INTO mk_capability_dependencies (id, capability_id, kind, ref, required, state) VALUES (?, ?, ?, ?, 0, 'OPTIONAL')", [`capd_${randomUUID().replace(/-/g, "").slice(0, 16)}`, capabilityId, dep.kind, dep.ref]);
    }

    db.run("DELETE FROM mk_capability_permissions WHERE capability_id = ?", [capabilityId]);
    const permissionRows: Array<[string, string]> = [];
    for (const scope of input.manifest.spec.permissions.filesystem.read) permissionRows.push(["filesystem.read", scope]);
    for (const scope of input.manifest.spec.permissions.filesystem.write) permissionRows.push(["filesystem.write", scope]);
    if (input.manifest.spec.permissions.shell.allowed) permissionRows.push(["shell.execute", "*"]);
    for (const scope of input.manifest.spec.permissions.network.outbound) permissionRows.push(["network.outbound", scope]);
    for (const secret of input.manifest.spec.permissions.secrets) permissionRows.push(["credential.use", secret]);
    for (const [permission, scope] of permissionRows) {
      db.run("INSERT INTO mk_capability_permissions (id, capability_id, permission, scope, origin) VALUES (?, ?, ?, ?, 'manifest')", [`capp_${randomUUID().replace(/-/g, "").slice(0, 16)}`, capabilityId, permission, scope]);
    }

    this.appendAudit({
      eventType: created ? "CAPABILITY_IMPORTED" : "CAPABILITY_UPDATED",
      actor: input.actor,
      capabilitySlug: slug,
      version: input.manifest.spec.version,
      operation: "registry.upsert",
      planId: null,
      policyDecision: null,
      approvalId: null,
      result: created ? "created" : "updated",
      detailsJson: JSON.stringify({ manifestHash, phaseId: input.phaseId }),
    });

    return { capabilityId, versionId, created };
  }

  listCapabilities(filter?: CapabilityFilter): CapabilityRow[] {
    // Fixed statement + in-process shaping: no dynamic SQL assembly.
    const rows = openAgentOsDb()
      .query("SELECT * FROM mk_capabilities ORDER BY updated_at DESC LIMIT 1000")
      .all() as Array<Record<string, unknown>>;
    let out = rows.map(rowToCapability);
    if (filter?.type) out = out.filter((c) => c.type === filter.type);
    if (filter?.status) out = out.filter((c) => c.status === filter.status);
    if (filter?.search) {
      const needle = filter.search.toLowerCase();
      out = out.filter((c) => c.slug.toLowerCase().includes(needle) || c.name.toLowerCase().includes(needle) || c.summary.toLowerCase().includes(needle) || (c.phaseId ?? "").includes(filter.search as string));
    }
    return out.slice(0, Math.min(filter?.limit ?? 200, 1000));
  }

  getCapabilityBySlug(slug: string): CapabilityRow | null {
    const row = openAgentOsDb().query("SELECT * FROM mk_capabilities WHERE slug = ? LIMIT 1").get(slug) as Record<string, unknown> | undefined;
    return row ? rowToCapability(row) : null;
  }

  getCapabilityById(id: string): CapabilityRow | null {
    const row = openAgentOsDb().query("SELECT * FROM mk_capabilities WHERE id = ? LIMIT 1").get(id) as Record<string, unknown> | undefined;
    return row ? rowToCapability(row) : null;
  }

  getLatestVersion(capabilityId: string): CapabilityVersionRow | null {
    const row = openAgentOsDb()
      .query("SELECT * FROM mk_capability_versions WHERE capability_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(capabilityId) as Record<string, unknown> | undefined;
    return row ? rowToVersion(row) : null;
  }

  getVersionById(versionId: string): CapabilityVersionRow | null {
    const row = openAgentOsDb().query("SELECT * FROM mk_capability_versions WHERE id = ? LIMIT 1").get(versionId) as Record<string, unknown> | undefined;
    return row ? rowToVersion(row) : null;
  }

  getManifest(versionId: string): PaoCapabilityManifest | null {
    const version = this.getVersionById(versionId);
    if (!version) return null;
    try {
      return JSON.parse(version.manifestJson) as PaoCapabilityManifest;
    } catch {
      return null;
    }
  }

  getDependencies(capabilityId: string): Array<{ id: string; kind: string; ref: string; required: boolean; state: string }> {
    const rows = openAgentOsDb().query("SELECT id, kind, ref, required, state FROM mk_capability_dependencies WHERE capability_id = ? ORDER BY kind, ref").all(capabilityId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({ id: r.id as string, kind: r.kind as string, ref: r.ref as string, required: r.required === 1, state: r.state as string }));
  }

  getPermissions(capabilityId: string): Array<{ permission: string; scope: string; origin: string }> {
    const rows = openAgentOsDb().query("SELECT permission, scope, origin FROM mk_capability_permissions WHERE capability_id = ? ORDER BY permission, scope").all(capabilityId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({ permission: r.permission as string, scope: r.scope as string, origin: r.origin as string }));
  }

  setLifecycleState(capabilityId: string, state: CapabilityLifecycleState): void {
    openAgentOsDb().run("UPDATE mk_capabilities SET status = ?, updated_at = ? WHERE id = ?", [state, new Date().toISOString(), capabilityId]);
  }

  // --- installations -------------------------------------------------------

  createInstallation(capabilityId: string, versionId: string, snapshotRef: string | null): string {
    const id = `inst_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    openAgentOsDb().run(
      "INSERT INTO mk_capability_installations (id, capability_id, version_id, state, enabled, installed_at, last_health_state, snapshot_ref) VALUES (?, ?, ?, 'INSTALLING', 0, ?, 'UNKNOWN', ?)",
      [id, capabilityId, versionId, new Date().toISOString(), snapshotRef],
    );
    return id;
  }

  updateInstallationState(installationId: string, state: InstallState, patch?: { enabled?: boolean; snapshotRef?: string | null }): void {
    if (patch?.enabled !== undefined && patch?.snapshotRef !== undefined) {
      openAgentOsDb().run("UPDATE mk_capability_installations SET state = ?, enabled = ?, snapshot_ref = ? WHERE id = ?", [state, patch.enabled ? 1 : 0, patch.snapshotRef, installationId]);
      return;
    }
    if (patch?.enabled !== undefined) {
      openAgentOsDb().run("UPDATE mk_capability_installations SET state = ?, enabled = ? WHERE id = ?", [state, patch.enabled ? 1 : 0, installationId]);
      return;
    }
    if (patch?.snapshotRef !== undefined) {
      openAgentOsDb().run("UPDATE mk_capability_installations SET state = ?, snapshot_ref = ? WHERE id = ?", [state, patch.snapshotRef, installationId]);
      return;
    }
    openAgentOsDb().run("UPDATE mk_capability_installations SET state = ? WHERE id = ?", [state, installationId]);
  }

  getInstallation(installationId: string): InstallationRow | null {
    const row = openAgentOsDb().query("SELECT * FROM mk_capability_installations WHERE id = ? LIMIT 1").get(installationId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      capabilityId: row.capability_id as string,
      versionId: row.version_id as string,
      state: row.state as InstallState,
      enabled: row.enabled === 1,
      installedAt: row.installed_at as string,
      lastHealthState: (row.last_health_state as HealthState) ?? "UNKNOWN",
      lastHealthAt: (row.last_health_at as string | null) ?? null,
      snapshotRef: (row.snapshot_ref as string | null) ?? null,
    };
  }

  getInstallationByCapability(capabilityId: string): InstallationRow | null {
    const row = openAgentOsDb()
      .query("SELECT id FROM mk_capability_installations WHERE capability_id = ? AND state IN ('INSTALLED','INSTALLING') ORDER BY installed_at DESC LIMIT 1")
      .get(capabilityId) as { id: string } | undefined;
    return row ? this.getInstallation(row.id) : null;
  }

  recordHealth(capabilityId: string, checkType: string, state: HealthState, detail: Record<string, unknown>): void {
    const now = new Date().toISOString();
    openAgentOsDb().run(
      "INSERT INTO mk_capability_health (id, capability_id, check_type, state, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [`caph_${randomUUID().replace(/-/g, "").slice(0, 16)}`, capabilityId, checkType, state, JSON.stringify(detail), now],
    );
    openAgentOsDb().run("UPDATE mk_capability_installations SET last_health_state = ?, last_health_at = ? WHERE capability_id = ? AND state = 'INSTALLED'", [state, now, capabilityId]);
    openAgentOsDb().run("UPDATE mk_capabilities SET status = ?, updated_at = ? WHERE id = ? AND status IN ('INSTALLED','HEALTHY','DEGRADED')", [state === "HEALTHY" ? "HEALTHY" : state === "UNHEALTHY" ? "DEGRADED" : state, now, capabilityId]);
  }

  // --- audit ---------------------------------------------------------------

  appendAudit(record: Omit<MarketplaceAuditRecord, "createdAt">): void {
    try {
      openAgentOsDb().run(
        "INSERT INTO mk_capability_audits (id, event_type, actor, capability_slug, version, operation, plan_id, policy_decision, approval_id, result, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          `capa_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
          record.eventType,
          record.actor,
          record.capabilitySlug,
          record.version,
          record.operation,
          record.planId,
          record.policyDecision,
          record.approvalId,
          record.result,
          record.detailsJson,
          new Date().toISOString(),
        ],
      );
    } catch {
      // audit best-effort; never blocks the marketplace path
    }
  }

  listAudit(limit = 100): Array<MarketplaceAuditRecord & { id: string }> {
    const rows = openAgentOsDb().query("SELECT * FROM mk_capability_audits ORDER BY created_at DESC LIMIT ?").all(Math.min(limit, 1000)) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as string,
      eventType: r.event_type as MarketplaceAuditEvent,
      actor: r.actor as string,
      capabilitySlug: (r.capability_slug as string | null) ?? null,
      version: (r.version as string | null) ?? null,
      operation: r.operation as string,
      planId: (r.plan_id as string | null) ?? null,
      policyDecision: (r.policy_decision as PolicyDecision | null) ?? null,
      approvalId: (r.approval_id as string | null) ?? null,
      result: r.result as string,
      detailsJson: (r.details_json as string) ?? "{}",
      createdAt: r.created_at as string,
    }));
  }

  // --- phase blueprints ----------------------------------------------------

  upsertPhaseBlueprint(input: { phaseId: string; title: string; blueprintPath: string; blueprintStatus: string; capabilityId: string | null; supersedesPhase?: string | null; supersededByPhase?: string | null; note?: string }): { created: boolean } {
    const db = openAgentOsDb();
    const now = new Date().toISOString();
    const existing = db.query("SELECT id FROM mk_phase_blueprints WHERE phase_id = ? LIMIT 1").get(input.phaseId) as { id: string } | undefined;
    if (existing) {
      db.run("UPDATE mk_phase_blueprints SET title = ?, blueprint_path = ?, blueprint_status = ?, capability_id = COALESCE(?, capability_id), supersedes_phase = ?, superseded_by_phase = ?, note = ?, scanned_at = ? WHERE phase_id = ?", [input.title, input.blueprintPath, input.blueprintStatus, input.capabilityId, input.supersedesPhase ?? null, input.supersededByPhase ?? null, input.note ?? null, now, input.phaseId]);
      return { created: false };
    }
    db.run("INSERT INTO mk_phase_blueprints (id, phase_id, title, blueprint_path, blueprint_status, capability_id, supersedes_phase, superseded_by_phase, note, scanned_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [`pbp_${randomUUID().replace(/-/g, "").slice(0, 20)}`, input.phaseId, input.title, input.blueprintPath, input.blueprintStatus, input.capabilityId, input.supersedesPhase ?? null, input.supersededByPhase ?? null, input.note ?? null, now]);
    return { created: true };
  }

  listPhaseBlueprints(): Array<{ phaseId: string; title: string; blueprintPath: string; blueprintStatus: string; capabilityId: string | null; note: string | null }> {
    const rows = openAgentOsDb().query("SELECT phase_id, title, blueprint_path, blueprint_status, capability_id, note FROM mk_phase_blueprints ORDER BY phase_id").all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({ phaseId: r.phase_id as string, title: r.title as string, blueprintPath: r.blueprint_path as string, blueprintStatus: r.blueprint_status as string, capabilityId: (r.capability_id as string | null) ?? null, note: (r.note as string | null) ?? null }));
  }

  // --- favorites ------------------------------------------------------------

  toggleFavorite(actor: string, capabilityId: string): { favorite: boolean } {
    const db = openAgentOsDb();
    const existing = db.query("SELECT id FROM mk_favorites WHERE actor = ? AND capability_id = ? LIMIT 1").get(actor, capabilityId) as { id: string } | undefined;
    if (existing) {
      db.run("DELETE FROM mk_favorites WHERE id = ?", [existing.id]);
      return { favorite: false };
    }
    db.run("INSERT INTO mk_favorites (id, actor, capability_id, pinned, created_at) VALUES (?, ?, ?, 0, ?)", [`capf_${randomUUID().replace(/-/g, "").slice(0, 16)}`, actor, capabilityId, new Date().toISOString()]);
    return { favorite: true };
  }

  counts(): { capabilities: number; versions: number; installations: number; phaseBlueprints: number } {
    const db = openAgentOsDb();
    const one = (sql: string): number => (db.query(sql).get() as { n: number }).n;
    return {
      capabilities: one("SELECT COUNT(*) AS n FROM mk_capabilities"),
      versions: one("SELECT COUNT(*) AS n FROM mk_capability_versions"),
      installations: one("SELECT COUNT(*) AS n FROM mk_capability_installations WHERE state = 'INSTALLED'"),
      phaseBlueprints: one("SELECT COUNT(*) AS n FROM mk_phase_blueprints"),
    };
  }
}

export type PhaseBlueprintStatusInput = "DRAFT" | "SPEC_COMPLETE" | "IMPLEMENTING" | "IMPLEMENTED" | "VALIDATED";

let defaultRegistry: CapabilityRegistry | null = null;

export function getCapabilityRegistry(): CapabilityRegistry {
  if (!defaultRegistry) defaultRegistry = new CapabilityRegistry();
  return defaultRegistry;
}
