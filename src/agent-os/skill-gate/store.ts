// Phase 20.57 — persistence for the skill control plane. Single-line bound SQL
// over the sg_* tables (repo store precedent); every statement is parameterized
// with `?` placeholders and literal SQL text; JSON payload columns carry the
// manifest/plan structures; every mutation lands in sg_audit via appendAudit.

import { openAgentOsDb } from "../db";
import type {
  DeploymentRecord,
  DeploymentStatus,
  DriftEventRecord,
  DriftType,
  ScanFinding,
  SkillAgentRecord,
  SkillFileEntry,
  SkillManifest,
  SkillNode,
  SkillRecord,
  SkillReviewRecord,
  SkillSource,
  SkillStatus,
  SkillVersion,
  SnapshotRecord,
  TrustLevel,
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export interface AuditInput {
  eventType: string;
  actorType: string;
  actorId?: string | null;
  skillId?: string | null;
  skillVersionId?: string | null;
  deploymentId?: string | null;
  nodeId?: string | null;
  metadata?: Record<string, unknown>;
}

export class SkillGateStore {
  // --- sources ---------------------------------------------------------

  insertSource(source: SkillSource): void {
    openAgentOsDb()
      .query(
        "INSERT INTO sg_sources (id, source_type, display_name, repository_url, default_ref, trust_level, enabled, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        source.id,
        source.sourceType,
        source.displayName,
        source.repositoryUrl,
        source.defaultRef,
        source.trustLevel,
        source.enabled ? 1 : 0,
        JSON.stringify(source.metadata),
        source.createdAt,
        source.updatedAt,
      );
  }

  listSources(): SkillSource[] {
    const rows = openAgentOsDb().query("SELECT * FROM sg_sources ORDER BY created_at DESC LIMIT 200").all() as Record<string, unknown>[];
    return rows.map(rowToSource);
  }

  getSource(id: string): SkillSource | null {
    const row = openAgentOsDb().query("SELECT * FROM sg_sources WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? rowToSource(row) : null;
  }

  // --- skills ----------------------------------------------------------

  insertSkill(skill: SkillRecord): void {
    openAgentOsDb()
      .query(
        "INSERT INTO sg_skills (id, namespace, slug, display_name, description, source_id, status, current_version, publisher, license_spdx, trust_level, risk_level, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        skill.id,
        skill.namespace,
        skill.slug,
        skill.displayName,
        skill.description,
        skill.sourceId,
        skill.status,
        skill.currentVersion,
        skill.publisher,
        skill.licenseSpdx,
        skill.trustLevel,
        skill.riskLevel,
        JSON.stringify(skill.tags),
        skill.createdAt,
        skill.updatedAt,
      );
  }

  updateSkillStatus(skillId: string, status: SkillStatus, currentVersion: string | null, riskLevel: string | null): void {
    openAgentOsDb()
      .query("UPDATE sg_skills SET status = ?, current_version = COALESCE(?, current_version), risk_level = COALESCE(?, risk_level), updated_at = ? WHERE id = ?")
      .run(status, currentVersion, riskLevel, nowIso(), skillId);
  }

  getSkill(id: string): SkillRecord | null {
    const row = openAgentOsDb().query("SELECT * FROM sg_skills WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? rowToSkill(row) : null;
  }

  getSkillBySlug(namespace: string, slug: string): SkillRecord | null {
    const row = openAgentOsDb().query("SELECT * FROM sg_skills WHERE namespace = ? AND slug = ?").get(namespace, slug) as Record<string, unknown> | null;
    return row ? rowToSkill(row) : null;
  }

  listSkills(filters: { status?: string; search?: string; limit?: number } = {}): SkillRecord[] {
    const limit = Math.min(filters.limit ?? 200, 500);
    const rows = openAgentOsDb()
      .query("SELECT * FROM sg_skills ORDER BY updated_at DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    let skills = rows.map(rowToSkill);
    if (filters.status) skills = skills.filter((skill) => skill.status === filters.status);
    if (filters.search) {
      const needle = filters.search.toLowerCase();
      skills = skills.filter(
        (skill) =>
          skill.displayName.toLowerCase().includes(needle) ||
          skill.slug.toLowerCase().includes(needle) ||
          skill.namespace.toLowerCase().includes(needle) ||
          (skill.description ?? "").toLowerCase().includes(needle) ||
          skill.tags.some((tag) => tag.toLowerCase().includes(needle)),
      );
    }
    return skills;
  }

  // --- versions --------------------------------------------------------

  insertVersion(version: SkillVersion): void {
    openAgentOsDb()
      .query(
        "INSERT INTO sg_skill_versions (id, skill_id, version, source_ref, source_commit, source_path, manifest_json, content_sha256, snapshot_dir, scanner_version, scan_status, risk_score, risk_level, approval_status, immutable, created_by, created_at, published_at, published_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        version.id,
        version.skillId,
        version.version,
        version.sourceRef,
        version.sourceCommit,
        version.sourcePath,
        JSON.stringify(version.manifest),
        version.contentSha256,
        version.snapshotDir,
        version.scannerVersion,
        version.scanStatus,
        version.riskScore,
        version.riskLevel,
        version.approvalStatus,
        version.immutable ? 1 : 0,
        version.createdBy,
        version.createdAt,
        version.publishedAt,
        version.publishedBy,
      );
  }

  getVersion(id: string): SkillVersion | null {
    const row = openAgentOsDb().query("SELECT * FROM sg_skill_versions WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? rowToVersion(row) : null;
  }

  getLatestVersion(skillId: string): SkillVersion | null {
    const row = openAgentOsDb()
      .query("SELECT * FROM sg_skill_versions WHERE skill_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(skillId) as Record<string, unknown> | null;
    return row ? rowToVersion(row) : null;
  }

  listVersions(skillId: string): SkillVersion[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM sg_skill_versions WHERE skill_id = ? ORDER BY created_at DESC LIMIT 100")
      .all(skillId) as Record<string, unknown>[];
    return rows.map(rowToVersion);
  }

  markVersionPublished(versionId: string, publishedBy: string): void {
    openAgentOsDb()
      .query("UPDATE sg_skill_versions SET immutable = 1, published_at = ?, published_by = ? WHERE id = ?")
      .run(nowIso(), publishedBy, versionId);
  }

  setVersionApprovalStatus(versionId: string, approvalStatus: string): void {
    openAgentOsDb()
      .query("UPDATE sg_skill_versions SET approval_status = ? WHERE id = ?")
      .run(approvalStatus, versionId);
  }

  // --- files + findings ------------------------------------------------

  insertFile(skillVersionId: string, file: SkillFileEntry): void {
    openAgentOsDb()
      .query("INSERT OR IGNORE INTO sg_skill_files (id, skill_version_id, relative_path, size_bytes, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(newId("sgf"), skillVersionId, file.relativePath, file.sizeBytes, file.sha256, nowIso());
  }

  listFiles(skillVersionId: string): SkillFileEntry[] {
    const rows = openAgentOsDb()
      .query("SELECT relative_path, size_bytes, sha256 FROM sg_skill_files WHERE skill_version_id = ? ORDER BY relative_path")
      .all(skillVersionId) as Record<string, unknown>[];
    return rows.map((row) => ({
      relativePath: String(row.relative_path),
      sizeBytes: Number(row.size_bytes),
      sha256: String(row.sha256),
    }));
  }

  insertFinding(skillVersionId: string, finding: ScanFinding): void {
    openAgentOsDb()
      .query("INSERT INTO sg_scan_findings (id, skill_version_id, rule_id, severity, file_path, line_start, line_end, evidence_hash, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(newId("sgfnd"), skillVersionId, finding.ruleId, finding.severity, finding.filePath, finding.lineStart, finding.lineEnd, finding.evidenceHash, finding.message, nowIso());
  }

  listFindings(skillVersionId: string): ScanFinding[] {
    const rows = openAgentOsDb()
      .query("SELECT rule_id, severity, file_path, line_start, line_end, evidence_hash, message FROM sg_scan_findings WHERE skill_version_id = ? ORDER BY severity DESC, file_path, line_start")
      .all(skillVersionId) as Record<string, unknown>[];
    return rows.map((row) => ({
      ruleId: String(row.rule_id),
      severity: String(row.severity) as ScanFinding["severity"],
      filePath: String(row.file_path ?? ""),
      lineStart: Number(row.line_start ?? 0),
      lineEnd: Number(row.line_end ?? 0),
      evidenceHash: String(row.evidence_hash ?? ""),
      message: String(row.message ?? ""),
    }));
  }

  // --- agents + nodes ----------------------------------------------------

  upsertAgent(record: SkillAgentRecord): void {
    openAgentOsDb()
      .query(
        "INSERT INTO sg_agents (id, agent_type, display_name, adapter_version, enabled, detected, capabilities_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(agent_type) DO UPDATE SET display_name = excluded.display_name, adapter_version = excluded.adapter_version, detected = excluded.detected, updated_at = excluded.updated_at",
      )
      .run(
        `sga_${record.agentType}`,
        record.agentType,
        record.displayName,
        record.adapterVersion,
        record.enabled ? 1 : 0,
        record.detected ? 1 : 0,
        JSON.stringify(record.capabilities),
        nowIso(),
        nowIso(),
      );
  }

  listAgents(): SkillAgentRecord[] {
    const rows = openAgentOsDb().query("SELECT * FROM sg_agents ORDER BY agent_type").all() as Record<string, unknown>[];
    return rows.map((row) => ({
      agentType: String(row.agent_type),
      displayName: String(row.display_name),
      adapterVersion: String(row.adapter_version),
      enabled: Number(row.enabled) === 1,
      detected: Number(row.detected) === 1,
      capabilities: JSON.parse(String(row.capabilities_json ?? "{}")) as Record<string, unknown>,
      updatedAt: String(row.updated_at),
    }));
  }

  insertNode(node: SkillNode): void {
    openAgentOsDb()
      .query(
        "INSERT INTO sg_nodes (id, name, kind, hostname, port, username, auth_ref, host_key_fingerprint, environment, status, allowed_roots_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        node.id,
        node.name,
        node.kind,
        node.hostname,
        node.port,
        node.username,
        node.authRef,
        node.hostKeyFingerprint,
        node.environment,
        node.status,
        JSON.stringify(node.allowedRoots),
        node.createdAt,
        node.updatedAt,
      );
  }

  listNodes(): SkillNode[] {
    const rows = openAgentOsDb().query("SELECT * FROM sg_nodes ORDER BY name").all() as Record<string, unknown>[];
    return rows.map(rowToNode);
  }

  getNode(id: string): SkillNode | null {
    const row = openAgentOsDb().query("SELECT * FROM sg_nodes WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? rowToNode(row) : null;
  }

  // --- deployments -------------------------------------------------------

  insertDeployment(deployment: DeploymentRecord, plan: Record<string, unknown>): void {
    openAgentOsDb()
      .query(
        "INSERT INTO sg_deployments (id, skill_version_id, node_id, agent_type, scope, project_path, target_path, desired_sha256, actual_sha256, status, managed, deployed_by, deployed_at, verified_at, plan_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        deployment.id,
        deployment.skillVersionId,
        deployment.nodeId,
        deployment.agentType,
        deployment.scope,
        deployment.projectPath,
        deployment.targetPath,
        deployment.desiredSha256,
        deployment.actualSha256,
        deployment.status,
        deployment.managed ? 1 : 0,
        deployment.deployedBy,
        deployment.deployedAt,
        deployment.verifiedAt,
        JSON.stringify(plan),
        deployment.updatedAt,
      );
  }

  updateDeploymentStatus(id: string, status: DeploymentStatus, actualSha256: string | null, verified: boolean): void {
    openAgentOsDb()
      .query("UPDATE sg_deployments SET status = ?, actual_sha256 = COALESCE(?, actual_sha256), verified_at = COALESCE(?, verified_at), updated_at = ? WHERE id = ?")
      .run(status, actualSha256, verified ? nowIso() : null, nowIso(), id);
  }

  getDeployment(id: string): DeploymentRecord | null {
    const row = openAgentOsDb().query("SELECT * FROM sg_deployments WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? rowToDeployment(row) : null;
  }

  listDeployments(filters: { skillId?: string; agentType?: string; status?: string; limit?: number } = {}): DeploymentRecord[] {
    const limit = Math.min(filters.limit ?? 200, 500);
    const rows = openAgentOsDb()
      .query("SELECT * FROM sg_deployments ORDER BY updated_at DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    let deployments = rows.map(rowToDeployment);
    if (filters.agentType) deployments = deployments.filter((deployment) => deployment.agentType === filters.agentType);
    if (filters.status) deployments = deployments.filter((deployment) => deployment.status === filters.status);
    if (filters.skillId) {
      const versionIds = new Set(this.listVersions(filters.skillId).map((version) => version.id));
      deployments = deployments.filter((deployment) => versionIds.has(deployment.skillVersionId));
    }
    return deployments;
  }

  // --- snapshots + drift --------------------------------------------------

  insertSnapshot(snapshot: SnapshotRecord): void {
    openAgentOsDb()
      .query("INSERT INTO sg_snapshots (id, deployment_id, reason, file_index_json, snapshot_dir, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(snapshot.id, snapshot.deploymentId, snapshot.reason, JSON.stringify(snapshot.fileIndex), snapshot.snapshotDir, snapshot.createdBy, snapshot.createdAt);
  }

  latestSnapshot(deploymentId: string): SnapshotRecord | null {
    const row = openAgentOsDb()
      .query("SELECT * FROM sg_snapshots WHERE deployment_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(deploymentId) as Record<string, unknown> | null;
    return row
      ? {
          id: String(row.id),
          deploymentId: String(row.deployment_id),
          reason: String(row.reason),
          fileIndex: JSON.parse(String(row.file_index_json ?? "[]")) as SnapshotRecord["fileIndex"],
          snapshotDir: String(row.snapshot_dir),
          createdBy: row.created_by == null ? null : String(row.created_by),
          createdAt: String(row.created_at),
        }
      : null;
  }

  insertDriftEvent(event: DriftEventRecord): void {
    openAgentOsDb()
      .query("INSERT INTO sg_drift_events (id, deployment_id, drift_type, expected_sha256, actual_sha256, details_json, status, detected_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(event.id, event.deploymentId, event.driftType, event.expectedSha256, event.actualSha256, JSON.stringify(event.details), event.status, event.detectedAt, event.resolvedAt);
  }

  openDriftEvents(deploymentId: string): DriftEventRecord[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM sg_drift_events WHERE deployment_id = ? AND status = 'open' ORDER BY detected_at DESC")
      .all(deploymentId) as Record<string, unknown>[];
    return rows.map(rowToDrift);
  }

  resolveDriftEvents(deploymentId: string): void {
    openAgentOsDb()
      .query("UPDATE sg_drift_events SET status = 'resolved', resolved_at = ? WHERE deployment_id = ? AND status = 'open'")
      .run(nowIso(), deploymentId);
  }

  listOpenDriftEvents(limit: number): DriftEventRecord[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM sg_drift_events WHERE status = 'open' ORDER BY detected_at DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map(rowToDrift);
  }

  listAllDriftEvents(limit: number): DriftEventRecord[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM sg_drift_events ORDER BY detected_at DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map(rowToDrift);
  }

  // --- reviews -------------------------------------------------------------

  insertReview(review: SkillReviewRecord): void {
    openAgentOsDb()
      .query(
        "INSERT INTO sg_reviews (id, skill_version_id, requested_action, requested_targets_json, risk_snapshot_json, status, requested_by, reviewed_by, decision_reason, constraints_json, created_at, decided_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        review.id,
        review.skillVersionId,
        review.requestedAction,
        JSON.stringify(review.requestedTargets),
        JSON.stringify(review.riskSnapshot),
        review.status,
        review.requestedBy,
        review.reviewedBy,
        review.decisionReason,
        JSON.stringify(review.constraints),
        review.createdAt,
        review.decidedAt,
        review.expiresAt,
      );
  }

  getReview(id: string): SkillReviewRecord | null {
    const row = openAgentOsDb().query("SELECT * FROM sg_reviews WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? rowToReview(row) : null;
  }

  latestReviewForVersion(skillVersionId: string): SkillReviewRecord | null {
    const row = openAgentOsDb()
      .query("SELECT * FROM sg_reviews WHERE skill_version_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(skillVersionId) as Record<string, unknown> | null;
    return row ? rowToReview(row) : null;
  }

  listReviews(filters: { status?: string; limit?: number } = {}): SkillReviewRecord[] {
    const limit = Math.min(filters.limit ?? 200, 500);
    const rows = openAgentOsDb()
      .query("SELECT * FROM sg_reviews ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    let reviews = rows.map(rowToReview);
    if (filters.status) reviews = reviews.filter((review) => review.status === filters.status);
    return reviews;
  }

  decideReview(id: string, status: string, reviewedBy: string, reason: string | null, decidedAt: string): void {
    openAgentOsDb()
      .query("UPDATE sg_reviews SET status = ?, reviewed_by = ?, decision_reason = ?, decided_at = ? WHERE id = ?")
      .run(status, reviewedBy, reason, decidedAt, id);
  }

  // --- audit ---------------------------------------------------------------

  appendAudit(input: AuditInput): void {
    openAgentOsDb()
      .query("INSERT INTO sg_audit (id, event_type, actor_type, actor_id, skill_id, skill_version_id, deployment_id, node_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(newId("sga"), input.eventType, input.actorType, input.actorId ?? null, input.skillId ?? null, input.skillVersionId ?? null, input.deploymentId ?? null, input.nodeId ?? null, JSON.stringify(input.metadata ?? {}), nowIso());
  }

  listAudit(filters: { skillId?: string; limit?: number } = {}): Array<Record<string, unknown>> {
    const limit = Math.min(filters.limit ?? 200, 500);
    const rows = openAgentOsDb()
      .query("SELECT event_type, actor_type, actor_id, skill_id, skill_version_id, deployment_id, node_id, metadata_json, created_at FROM sg_audit ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    let events = rows;
    if (filters.skillId) events = events.filter((event) => event.skill_id === filters.skillId);
    return events;
  }
}

// --- row mappers ---------------------------------------------------------

function rowToSource(row: Record<string, unknown>): SkillSource {
  return {
    id: String(row.id),
    sourceType: String(row.source_type) as SkillSource["sourceType"],
    displayName: String(row.display_name),
    repositoryUrl: row.repository_url == null ? null : String(row.repository_url),
    defaultRef: row.default_ref == null ? null : String(row.default_ref),
    trustLevel: String(row.trust_level ?? "unknown") as TrustLevel,
    enabled: Number(row.enabled ?? 1) === 1,
    metadata: JSON.parse(String(row.metadata_json ?? "{}")) as Record<string, unknown>,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToSkill(row: Record<string, unknown>): SkillRecord {
  return {
    id: String(row.id),
    namespace: String(row.namespace),
    slug: String(row.slug),
    displayName: String(row.display_name),
    description: row.description == null ? null : String(row.description),
    sourceId: row.source_id == null ? null : String(row.source_id),
    status: String(row.status) as SkillStatus,
    currentVersion: row.current_version == null ? null : String(row.current_version),
    publisher: row.publisher == null ? null : String(row.publisher),
    licenseSpdx: row.license_spdx == null ? null : String(row.license_spdx),
    trustLevel: String(row.trust_level ?? "unknown") as TrustLevel,
    riskLevel: row.risk_level == null ? null : (String(row.risk_level) as SkillRecord["riskLevel"]),
    tags: JSON.parse(String(row.tags_json ?? "[]")) as string[],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToVersion(row: Record<string, unknown>): SkillVersion {
  return {
    id: String(row.id),
    skillId: String(row.skill_id),
    version: String(row.version),
    sourceRef: row.source_ref == null ? null : String(row.source_ref),
    sourceCommit: row.source_commit == null ? null : String(row.source_commit),
    sourcePath: row.source_path == null ? null : String(row.source_path),
    manifest: JSON.parse(String(row.manifest_json ?? "{}")) as SkillManifest,
    contentSha256: String(row.content_sha256),
    snapshotDir: String(row.snapshot_dir),
    scannerVersion: row.scanner_version == null ? null : String(row.scanner_version),
    scanStatus: String(row.scan_status) as SkillVersion["scanStatus"],
    riskScore: row.risk_score == null ? 0 : Number(row.risk_score),
    riskLevel: String(row.risk_level ?? "low") as SkillVersion["riskLevel"],
    approvalStatus: String(row.approval_status ?? "not_required") as SkillVersion["approvalStatus"],
    immutable: Number(row.immutable ?? 0) === 1,
    createdBy: row.created_by == null ? null : String(row.created_by),
    createdAt: String(row.created_at),
    publishedAt: row.published_at == null ? null : String(row.published_at),
    publishedBy: row.published_by == null ? null : String(row.published_by),
  };
}

function rowToNode(row: Record<string, unknown>): SkillNode {
  return {
    id: String(row.id),
    name: String(row.name),
    kind: String(row.kind ?? "ssh"),
    hostname: row.hostname == null ? null : String(row.hostname),
    port: row.port == null ? null : Number(row.port),
    username: row.username == null ? null : String(row.username),
    authRef: row.auth_ref == null ? null : String(row.auth_ref),
    hostKeyFingerprint: row.host_key_fingerprint == null ? null : String(row.host_key_fingerprint),
    environment: row.environment == null ? null : String(row.environment),
    status: String(row.status ?? "unknown") as SkillNode["status"],
    allowedRoots: JSON.parse(String(row.allowed_roots_json ?? "[]")) as string[],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToDeployment(row: Record<string, unknown>): DeploymentRecord {
  return {
    id: String(row.id),
    skillVersionId: String(row.skill_version_id),
    nodeId: row.node_id == null ? null : String(row.node_id),
    agentType: String(row.agent_type),
    scope: String(row.scope) as DeploymentRecord["scope"],
    projectPath: row.project_path == null ? null : String(row.project_path),
    targetPath: String(row.target_path),
    desiredSha256: String(row.desired_sha256),
    actualSha256: row.actual_sha256 == null ? null : String(row.actual_sha256),
    status: String(row.status) as DeploymentStatus,
    managed: Number(row.managed ?? 1) === 1,
    deployedBy: row.deployed_by == null ? null : String(row.deployed_by),
    deployedAt: row.deployed_at == null ? null : String(row.deployed_at),
    verifiedAt: row.verified_at == null ? null : String(row.verified_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToDrift(row: Record<string, unknown>): DriftEventRecord {
  return {
    id: String(row.id),
    deploymentId: String(row.deployment_id),
    driftType: String(row.drift_type) as DriftType,
    expectedSha256: row.expected_sha256 == null ? null : String(row.expected_sha256),
    actualSha256: row.actual_sha256 == null ? null : String(row.actual_sha256),
    details: JSON.parse(String(row.details_json ?? "{}")) as Record<string, unknown>,
    status: String(row.status) as DriftEventRecord["status"],
    detectedAt: String(row.detected_at),
    resolvedAt: row.resolved_at == null ? null : String(row.resolved_at),
  };
}

function rowToReview(row: Record<string, unknown>): SkillReviewRecord {
  return {
    id: String(row.id),
    skillVersionId: String(row.skill_version_id),
    requestedAction: String(row.requested_action),
    requestedTargets: JSON.parse(String(row.requested_targets_json ?? "[]")) as SkillReviewRecord["requestedTargets"],
    riskSnapshot: JSON.parse(String(row.risk_snapshot_json ?? "{}")) as SkillReviewRecord["riskSnapshot"],
    status: String(row.status) as SkillReviewRecord["status"],
    requestedBy: String(row.requested_by ?? ""),
    reviewedBy: row.reviewed_by == null ? null : String(row.reviewed_by),
    decisionReason: row.decision_reason == null ? null : String(row.decision_reason),
    constraints: JSON.parse(String(row.constraints_json ?? "{}")) as SkillReviewRecord["constraints"],
    createdAt: String(row.created_at),
    decidedAt: row.decided_at == null ? null : String(row.decided_at),
    expiresAt: row.expires_at == null ? null : String(row.expires_at),
  };
}

export { newId, nowIso };
