// Phase 20.38 — vault persistence over the shared agent-os SQLite store
// (spec §9 mapped to the repo's SQLite conventions: TEXT keys, JSON-as-text,
// additive migration). Static single-line SQL, bound parameters.

import { openAgentOsDb } from "../db";
import type { ArtifactRecord, DependencyGraph, PackageRecord, TrustState } from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

export class VaultStore {
  // --- packages / artifacts ---------------------------------------------------

  upsertPackage(pkg: { key: string; name: string; version: string; registry: string }): void {
    const db = openAgentOsDb();
    const existing = db.query("SELECT package_key FROM dv_packages WHERE package_key = ?").get(pkg.key);
    if (existing) {
      db.query("UPDATE dv_packages SET name = ?, version = ?, registry = ?, updated_at = ? WHERE package_key = ?")
        .run(pkg.name, pkg.version, pkg.registry, nowIso(), pkg.key);
      return;
    }
    db.query("INSERT INTO dv_packages (id, name, version, registry, package_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("dvp_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20), pkg.name, pkg.version, pkg.registry, pkg.key, nowIso(), nowIso());
  }

  listPackages(): PackageRecord[] {
    const rows = openAgentOsDb().query("SELECT * FROM dv_packages ORDER BY created_at DESC, rowid DESC").all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id), name: String(row.name), version: String(row.version),
      registry: String(row.registry), packageKey: String(row.package_key),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }));
  }

  countPackages(): number {
    const row = openAgentOsDb().query("SELECT COUNT(*) AS n FROM dv_packages").get() as { n: number };
    return Number(row.n);
  }

  putArtifact(artifact: {
    packageKey: string; tarballUrl: string | null; registryOrigin: string;
    integrity: string | null; sha512Hex: string | null; sizeBytes: number;
    storagePath: string | null; trustState: TrustState; verifiedAt?: string | null;
    downloadedAt?: string | null; quarantineReason?: string | null;
  }): ArtifactRecord {
    const db = openAgentOsDb();
    const existing = artifact.sha512Hex
      ? db.query("SELECT id, pinned, pinned_by, created_at FROM dv_artifacts WHERE sha512 = ?").get(artifact.sha512Hex) as { id: string; pinned: number; pinned_by: string | null; created_at: string } | null
      : null;
    const now = nowIso();
    if (existing) {
      db.query("UPDATE dv_artifacts SET package_key = ?, trust_state = ?, storage_path = ?, verified_at = ?, downloaded_at = COALESCE(downloaded_at, ?), quarantine_reason = ?, size_bytes = ?, updated_at = ? WHERE id = ?")
        .run(artifact.packageKey, artifact.trustState, artifact.storagePath, artifact.verifiedAt ?? null, artifact.downloadedAt ?? null, artifact.quarantineReason ?? null, artifact.sizeBytes, now, existing.id);
      return this.getArtifact(existing.id)!;
    }
    const id = "dva_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
    db.query("INSERT INTO dv_artifacts (id, package_key, tarball_url, registry_origin, integrity, sha512, size_bytes, storage_path, trust_state, pinned, pinned_by, verified_at, downloaded_at, quarantine_reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?)")
      .run(id, artifact.packageKey, artifact.tarballUrl, artifact.registryOrigin, artifact.integrity, artifact.sha512Hex, artifact.sizeBytes, artifact.storagePath, artifact.trustState, artifact.verifiedAt ?? null, artifact.downloadedAt ?? null, artifact.quarantineReason ?? null, now, now);
    return this.getArtifact(id)!;
  }

  /** Trust-state transition helper (§8): creates a minimal artifact row when
   *  none exists yet so every state change is durable and auditable. */
  upsertArtifactState(entry: { packageKey: string; trustState: TrustState; quarantineReason: string | null; sizeBytes: number | null }): void {
    const db = openAgentOsDb();
    const existing = db.query("SELECT id, sha512, size_bytes FROM dv_artifacts WHERE package_key = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1").get(entry.packageKey) as { id: string; sha512: string | null; size_bytes: number } | null;
    if (existing) {
      db.query("UPDATE dv_artifacts SET trust_state = ?, quarantine_reason = ?, size_bytes = COALESCE(?, size_bytes), updated_at = ? WHERE id = ?")
        .run(entry.trustState, entry.quarantineReason, entry.sizeBytes, nowIso(), existing.id);
      return;
    }
    db.query("INSERT INTO dv_artifacts (id, package_key, registry_origin, trust_state, size_bytes, quarantine_reason, created_at, updated_at) VALUES (?, ?, 'unknown', ?, ?, ?, ?, ?)")
      .run("dva_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20), entry.packageKey, entry.trustState, entry.sizeBytes ?? 0, entry.quarantineReason, nowIso(), nowIso());
  }

  getArtifact(id: string): ArtifactRecord | null {
    const row = openAgentOsDb().query("SELECT * FROM dv_artifacts WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? mapArtifactRow(row) : null;
  }

  findArtifactByPackageKey(packageKey: string): ArtifactRecord | null {
    const row = openAgentOsDb().query("SELECT * FROM dv_artifacts WHERE package_key = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1").get(packageKey) as Record<string, unknown> | null;
    return row ? mapArtifactRow(row) : null;
  }

  listArtifacts(): ArtifactRecord[] {
    const rows = openAgentOsDb().query("SELECT * FROM dv_artifacts ORDER BY updated_at DESC, rowid DESC").all() as Array<Record<string, unknown>>;
    return rows.map(mapArtifactRow);
  }

  // --- projects -----------------------------------------------------------------

  saveProject(graph: DependencyGraph): void {
    const db = openAgentOsDb();
    const existing = db.query("SELECT id FROM dv_projects WHERE project_key = ?").get(graph.projectKey) as { id: string } | null;
    const id = existing?.id ?? ("dprj_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20));
    if (existing) {
      db.query("UPDATE dv_projects SET project_path = ?, package_manager = ?, lockfile_type = ?, lockfile_hash = ?, last_resolved_at = ?, updated_at = ? WHERE id = ?")
        .run(graph.projectPath, graph.packageManager, graph.lockfileType, graph.lockfileHash, nowIso(), nowIso(), id);
    } else {
      db.query("INSERT INTO dv_projects (id, project_key, project_path, package_manager, lockfile_type, lockfile_hash, last_resolved_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, graph.projectKey, graph.projectPath, graph.packageManager, graph.lockfileType, graph.lockfileHash, nowIso(), nowIso(), nowIso());
    }
    db.query("DELETE FROM dv_project_items WHERE project_id = ?").run(id);
    for (const node of graph.nodes) {
      db.query("INSERT INTO dv_project_items (id, project_id, package_name, version, integrity, direct, dev, optional, peer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run("dpi_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20), id, node.name, node.version, node.integrity, node.direct ? 1 : 0, node.dev ? 1 : 0, node.optional ? 1 : 0, node.peer ? 1 : 0);
    }
  }

  listProjectItems(projectKey: string): Array<{ packageName: string; version: string; integrity: string | null }> {
    const rows = openAgentOsDb().query("SELECT pi.package_name, pi.version, pi.integrity FROM dv_project_items pi JOIN dv_projects p ON pi.project_id = p.id WHERE p.project_key = ?").all(projectKey) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ packageName: String(row.package_name), version: String(row.version), integrity: row.integrity ? String(row.integrity) : null }));
  }

  // --- bundles / policy decisions / audit ------------------------------------------

  recordBundle(entry: { bundleId: string; name: string; manifestHash: string; outputPath: string; packageCount: number; totalSizeBytes: number }): void {
    openAgentOsDb()
      .query("INSERT INTO dv_bundles (id, bundle_id, name, manifest_hash, output_path, package_count, total_size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("dbun_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20), entry.bundleId, entry.name, entry.manifestHash, entry.outputPath, entry.packageCount, entry.totalSizeBytes, nowIso());
  }

  countBundles(): number {
    const row = openAgentOsDb().query("SELECT COUNT(*) AS n FROM dv_bundles").get() as { n: number };
    return Number(row.n);
  }

  recordPolicyDecision(entry: { action: string; subjectType: string; subjectKey: string; decision: string; reason: string; policyRule: string; actor: string }): void {
    openAgentOsDb()
      .query("INSERT INTO dv_policy_decisions (id, action, subject_type, subject_key, decision, reason, policy_rule, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run("dpd_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20), entry.action, entry.subjectType, entry.subjectKey, entry.decision, entry.reason, entry.policyRule, entry.actor, nowIso());
  }

  listPolicyDecisions(limit = 50): Array<Record<string, unknown>> {
    return openAgentOsDb().query("SELECT * FROM dv_policy_decisions ORDER BY created_at DESC, rowid DESC LIMIT ?").all(Math.min(limit, 200)) as Array<Record<string, unknown>>;
  }

  appendAudit(entry: { eventType: string; packageKey?: string | null; projectKey?: string | null; metadata?: Record<string, unknown> }): void {
    openAgentOsDb()
      .query("INSERT INTO dv_audit_events (id, event_type, actor_type, actor_id, project_key, package_key, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("dae_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20), entry.eventType, "system", null, entry.projectKey ?? null, entry.packageKey ?? null, JSON.stringify(entry.metadata ?? {}).slice(0, 4000), nowIso());
  }

  listAudit(limit = 50): Array<Record<string, unknown>> {
    return openAgentOsDb().query("SELECT * FROM dv_audit_events ORDER BY created_at DESC, rowid DESC LIMIT ?").all(Math.min(limit, 200)) as Array<Record<string, unknown>>;
  }
}

function mapArtifactRow(row: Record<string, unknown>): ArtifactRecord {
  return {
    id: String(row.id),
    packageKey: String(row.package_key),
    tarballUrl: row.tarball_url ? String(row.tarball_url) : null,
    registryOrigin: String(row.registry_origin ?? ""),
    integrity: row.integrity ? String(row.integrity) : null,
    sha512Hex: row.sha512 ? String(row.sha512) : null,
    sizeBytes: Number(row.size_bytes ?? 0),
    storagePath: row.storage_path ? String(row.storage_path) : null,
    trustState: String(row.trust_state) as TrustState,
    pinned: Number(row.pinned ?? 0) === 1,
    pinnedBy: row.pinned_by ? String(row.pinned_by) : null,
    verifiedAt: row.verified_at ? String(row.verified_at) : null,
    downloadedAt: row.downloaded_at ? String(row.downloaded_at) : null,
    quarantineReason: row.quarantine_reason ? String(row.quarantine_reason) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
