// Phase 20.62 — Code Intelligence store (ci_* tables, schema v50).
//
// Canonical Pao-hubPro records: repository registrations, workspace
// membership, graph builds, evidence, impact reports, provider status.
// Static SQL literals with bound parameters; wide rows insert in two short
// statements. The graft/ cache directory is regenerable and never canonical.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import type {
  CodeIntelEvidence, CodeIntelOperation, FreshnessReport, GraphState,
  ImpactReport, RegisteredRepository, RiskLevel, TrustLevel, WorkspaceMembership,
} from "./types";

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

type Row = Record<string, unknown>;

function str(row: Row, key: string): string {
  const v = row[key];
  return v === null || v === undefined ? "" : String(v);
}

function strOrNull(row: Row, key: string): string | null {
  const v = row[key];
  return v === null || v === undefined ? null : String(v);
}

function numOrNull(row: Row, key: string): number | null {
  const v = row[key];
  return v === null || v === undefined ? null : Number(v);
}

function json<T>(row: Row, key: string, fallback: T): T {
  const raw = row[key];
  if (raw === null || raw === undefined) return fallback;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}

function rowToRepository(row: Row): RegisteredRepository {
  return {
    id: str(row, "id"),
    name: str(row, "name"),
    canonicalPath: str(row, "canonical_path"),
    repoType: str(row, "repo_type") as RegisteredRepository["repoType"],
    vcsType: str(row, "vcs_type"),
    remoteUrl: strOrNull(row, "remote_url"),
    defaultBranch: strOrNull(row, "default_branch"),
    trustLevel: str(row, "trust_level") as TrustLevel,
    sensitivity: str(row, "sensitivity") as RegisteredRepository["sensitivity"],
    indexingEnabled: Number(row["indexing_enabled"] ?? 1) === 1,
    deepEnrichmentEnabled: Number(row["deep_enrichment_enabled"] ?? 0) === 1,
    providerKey: str(row, "provider_key"),
    graphState: str(row, "graph_state") as GraphState,
    lastBuildAt: strOrNull(row, "last_build_at"),
    lastFingerprint: strOrNull(row, "last_fingerprint"),
    createdAt: str(row, "created_at"),
    updatedAt: str(row, "updated_at"),
  };
}

function rowToImpact(row: Row): ImpactReport {
  return {
    id: str(row, "id"),
    repositoryId: str(row, "repository_id"),
    taskId: strOrNull(row, "task_id"),
    worktreePath: strOrNull(row, "worktree_path"),
    requestedBy: str(row, "requested_by"),
    targetType: str(row, "target_type") as ImpactReport["targetType"],
    targetRef: str(row, "target_ref"),
    direction: str(row, "direction") as ImpactReport["direction"],
    depth: Number(row["depth"] ?? 1),
    graphBuildId: strOrNull(row, "graph_build_id"),
    freshnessState: str(row, "freshness_state") as FreshnessReport["state"],
    fingerprint: strOrNull(row, "fingerprint"),
    directDependencyCount: Number(row["direct_dependency_count"] ?? 0),
    transitiveDependencyCount: Number(row["transitive_dependency_count"] ?? 0),
    crossRepoDependencyCount: Number(row["cross_repo_dependency_count"] ?? 0),
    affectedTests: json<string[]>(row, "affected_tests_json", []),
    protectedMatches: json<string[]>(row, "protected_json", []),
    riskScore: Number(row["risk_score"] ?? 0),
    riskLevel: str(row, "risk_level") as RiskLevel,
    policyDecision: str(row, "policy_decision") as ImpactReport["policyDecision"],
    factors: json<ImpactReport["factors"]>(row, "factors_json", []),
    provider: str(row, "provider"),
    reducedConfidence: Number(row["reduced_confidence"] ?? 0) === 1,
    createdAt: str(row, "created_at"),
  };
}

function rowToEvidence(row: Row): CodeIntelEvidence {
  return {
    id: str(row, "id"),
    repositoryId: str(row, "repository_id"),
    graphBuildId: strOrNull(row, "graph_build_id"),
    operation: str(row, "operation") as CodeIntelOperation,
    requestFingerprint: str(row, "request_fingerprint"),
    normalizedRequest: json<Record<string, unknown>>(row, "request_json", {}),
    resultDigest: str(row, "result_digest"),
    resultMetadata: json<Record<string, unknown>>(row, "metadata_json", {}),
    freshnessState: str(row, "freshness_state") as CodeIntelEvidence["freshnessState"],
    provider: str(row, "provider"),
    providerVersion: strOrNull(row, "provider_version"),
    actorId: str(row, "actor_id"),
    taskId: strOrNull(row, "task_id"),
    createdAt: str(row, "created_at"),
  };
}

export class CodeIntelStore {
  // --- repositories ---

  insertRepository(repo: RegisteredRepository): boolean {
    const result = openAgentOsDb()
      .query(
        "INSERT OR IGNORE INTO ci_repositories (id, name, canonical_path, repo_type, vcs_type, remote_url, default_branch, trust_level, sensitivity, indexing_enabled, deep_enrichment_enabled, provider_key, graph_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uninitialized', ?, ?)",
      )
      .run(
        repo.id, repo.name, repo.canonicalPath, repo.repoType, repo.vcsType, repo.remoteUrl,
        repo.defaultBranch, repo.trustLevel, repo.sensitivity, repo.indexingEnabled ? 1 : 0,
        repo.deepEnrichmentEnabled ? 1 : 0, repo.providerKey, repo.createdAt, repo.updatedAt,
      );
    return Number(result.changes) > 0;
  }

  getRepository(id: string): RegisteredRepository | null {
    const row = openAgentOsDb().query("SELECT * FROM ci_repositories WHERE id = ?").get(id) as Row | null;
    if (!row) return null;
    return rowToRepository(row);
  }

  findRepositoryByPath(canonicalPath: string): RegisteredRepository | null {
    const row = openAgentOsDb().query("SELECT * FROM ci_repositories WHERE canonical_path = ?").get(canonicalPath) as Row | null;
    if (!row) return null;
    return rowToRepository(row);
  }

  listRepositories(): RegisteredRepository[] {
    const rows = openAgentOsDb().query("SELECT * FROM ci_repositories ORDER BY name").all();
    return (rows as Row[]).map(rowToRepository);
  }

  updateRepository(id: string, patch: { graphState?: GraphState; lastBuildAt?: string | null; lastFingerprint?: string | null; deepEnrichmentEnabled?: boolean }): void {
    const repo = this.getRepository(id);
    if (!repo) return;
    openAgentOsDb()
      .query("UPDATE ci_repositories SET graph_state = ?, last_build_at = ?, last_fingerprint = ?, deep_enrichment_enabled = ?, updated_at = ? WHERE id = ?")
      .run(
        patch.graphState ?? repo.graphState,
        patch.lastBuildAt !== undefined ? patch.lastBuildAt : repo.lastBuildAt,
        patch.lastFingerprint !== undefined ? patch.lastFingerprint : repo.lastFingerprint,
        (patch.deepEnrichmentEnabled ?? repo.deepEnrichmentEnabled) ? 1 : 0,
        nowIso(),
        id,
      );
  }

  // --- workspace membership ---

  insertMembership(m: WorkspaceMembership): boolean {
    const result = openAgentOsDb()
      .query(
        "INSERT OR IGNORE INTO ci_workspace_repositories (id, workspace_id, repository_id, alias, cross_repo_trace_enabled, trust_boundary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(m.id, m.workspaceId, m.repositoryId, m.alias, m.crossRepoTraceEnabled ? 1 : 0, m.trustBoundary, m.createdAt);
    return Number(result.changes) > 0;
  }

  getMembership(workspaceId: string, repositoryId: string): WorkspaceMembership | null {
    const row = openAgentOsDb().query("SELECT * FROM ci_workspace_repositories WHERE workspace_id = ? AND repository_id = ?").get(workspaceId, repositoryId) as Row | null;
    if (!row) return null;
    return {
      id: str(row, "id"),
      workspaceId: str(row, "workspace_id"),
      repositoryId: str(row, "repository_id"),
      alias: strOrNull(row, "alias"),
      crossRepoTraceEnabled: Number(row["cross_repo_trace_enabled"] ?? 0) === 1,
      trustBoundary: str(row, "trust_boundary"),
      createdAt: str(row, "created_at"),
    };
  }

  listWorkspaceRepositories(workspaceId: string): WorkspaceMembership[] {
    const rows = openAgentOsDb().query("SELECT * FROM ci_workspace_repositories WHERE workspace_id = ?").all(workspaceId);
    return (rows as Row[]).map((row) => ({
      id: str(row, "id"),
      workspaceId: str(row, "workspace_id"),
      repositoryId: str(row, "repository_id"),
      alias: strOrNull(row, "alias"),
      crossRepoTraceEnabled: Number(row["cross_repo_trace_enabled"] ?? 0) === 1,
      trustBoundary: str(row, "trust_boundary"),
      createdAt: str(row, "created_at"),
    }));
  }

  // --- graph builds ---

  insertGraphBuild(build: {
    id: string; repositoryId: string; provider: string; providerVersion: string | null;
    buildMode: string; status: string; fingerprint: string | null; startedAt: string;
    completedAt: string | null; durationMs: number | null; indexedFiles: number | null;
    indexedSymbols: number | null; errorCode: string | null; errorSummary: string | null;
  }): void {
    openAgentOsDb()
      .query(
        "INSERT INTO ci_graph_builds (id, repository_id, provider, provider_version, build_mode, status, fingerprint, started_at, completed_at, duration_ms, indexed_files, indexed_symbols, error_code, error_summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        build.id, build.repositoryId, build.provider, build.providerVersion, build.buildMode,
        build.status, build.fingerprint, build.startedAt, build.completedAt, build.durationMs,
        build.indexedFiles, build.indexedSymbols, build.errorCode, build.errorSummary,
      );
  }

  latestGraphBuild(repositoryId: string): Row | null {
    return openAgentOsDb().query("SELECT * FROM ci_graph_builds WHERE repository_id = ? ORDER BY started_at DESC LIMIT 1").get(repositoryId) as Row | null;
  }

  // --- evidence ---

  insertEvidence(evidence: CodeIntelEvidence): boolean {
    const result = openAgentOsDb()
      .query(
        "INSERT OR IGNORE INTO ci_evidence (id, repository_id, graph_build_id, operation, request_fingerprint, request_json, result_digest, metadata_json, freshness_state, provider, provider_version, actor_id, task_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        evidence.id, evidence.repositoryId, evidence.graphBuildId, evidence.operation,
        evidence.requestFingerprint, JSON.stringify(evidence.normalizedRequest), evidence.resultDigest,
        JSON.stringify(evidence.resultMetadata), evidence.freshnessState, evidence.provider,
        evidence.providerVersion, evidence.actorId, evidence.taskId, evidence.createdAt,
      );
    return Number(result.changes) > 0;
  }

  getEvidence(id: string): CodeIntelEvidence | null {
    const row = openAgentOsDb().query("SELECT * FROM ci_evidence WHERE id = ?").get(id) as Row | null;
    if (!row) return null;
    return rowToEvidence(row);
  }

  listEvidence(repositoryId: string, limit = 100): CodeIntelEvidence[] {
    const rows = openAgentOsDb().query("SELECT * FROM ci_evidence WHERE repository_id = ? ORDER BY created_at DESC LIMIT ?").all(repositoryId, limit);
    return (rows as Row[]).map(rowToEvidence);
  }

  // --- impact reports ---

  insertImpactReport(report: ImpactReport): void {
    openAgentOsDb()
      .query(
        "INSERT INTO ci_impact_reports (id, repository_id, task_id, worktree_path, requested_by, target_type, target_ref, direction, depth, graph_build_id, freshness_state, fingerprint, direct_dependency_count, transitive_dependency_count, cross_repo_dependency_count, affected_tests_json, protected_json, risk_score, risk_level, policy_decision, factors_json, provider, reduced_confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        report.id, report.repositoryId, report.taskId, report.worktreePath, report.requestedBy,
        report.targetType, report.targetRef, report.direction, report.depth, report.graphBuildId,
        report.freshnessState, report.fingerprint, report.directDependencyCount,
        report.transitiveDependencyCount, report.crossRepoDependencyCount,
        JSON.stringify(report.affectedTests), JSON.stringify(report.protectedMatches),
        report.riskScore, report.riskLevel, report.policyDecision, JSON.stringify(report.factors),
        report.provider, report.reducedConfidence ? 1 : 0, report.createdAt,
      );
  }

  getImpactReport(id: string): ImpactReport | null {
    const row = openAgentOsDb().query("SELECT * FROM ci_impact_reports WHERE id = ?").get(id) as Row | null;
    if (!row) return null;
    return rowToImpact(row);
  }

  listImpactReports(repositoryId?: string, limit = 100): ImpactReport[] {
    const rows = repositoryId
      ? openAgentOsDb().query("SELECT * FROM ci_impact_reports WHERE repository_id = ? ORDER BY created_at DESC LIMIT ?").all(repositoryId, limit)
      : openAgentOsDb().query("SELECT * FROM ci_impact_reports ORDER BY created_at DESC LIMIT ?").all(limit);
    return (rows as Row[]).map(rowToImpact);
  }

  // --- provider status ---

  upsertProviderStatus(status: {
    providerKey: string; repositoryId: string | null; detectedVersion: string | null;
    expectedVersionRange: string | null; runtimeVersion: string | null; state: string;
    lastErrorCode: string | null; lastErrorSummary: string | null; capabilitiesJson: string;
  }): void {
    const existing = openAgentOsDb().query("SELECT id FROM ci_provider_status WHERE provider_key = ? AND repository_id IS ?").get(status.providerKey, status.repositoryId) as Row | null;
    if (existing) {
      openAgentOsDb()
        .query("UPDATE ci_provider_status SET detected_version = ?, expected_version_range = ?, runtime_version = ?, status = ?, last_health_check_at = ?, last_error_code = ?, last_error_summary = ?, capabilities_json = ?, updated_at = ? WHERE id = ?")
        .run(
          status.detectedVersion, status.expectedVersionRange, status.runtimeVersion, status.state,
          nowIso(), status.lastErrorCode, status.lastErrorSummary, status.capabilitiesJson, nowIso(),
          str(existing, "id"),
        );
      return;
    }
    openAgentOsDb()
      .query(
        "INSERT INTO ci_provider_status (id, provider_key, repository_id, detected_version, expected_version_range, runtime_version, status, last_health_check_at, last_error_code, last_error_summary, capabilities_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        newId("cip"), status.providerKey, status.repositoryId, status.detectedVersion,
        status.expectedVersionRange, status.runtimeVersion, status.state, nowIso(),
        status.lastErrorCode, status.lastErrorSummary, status.capabilitiesJson, nowIso(), nowIso(),
      );
  }

  getProviderStatus(providerKey: string): Row | null {
    return openAgentOsDb().query("SELECT * FROM ci_provider_status WHERE provider_key = ? AND repository_id IS NULL").get(providerKey) as Row | null;
  }

  // --- audit ---

  appendAudit(entry: { action: string; decision: string; repositoryId?: string | null; actorId: string; details?: Record<string, unknown> }): void {
    openAgentOsDb()
      .query(
        "INSERT INTO ci_audit (id, action, decision, repository_id, actor_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(newId("cia"), entry.action, entry.decision, entry.repositoryId ?? null, entry.actorId, JSON.stringify(entry.details ?? {}), nowIso());
  }

  listAudit(limit = 200): Array<Record<string, unknown>> {
    const rows = openAgentOsDb().query("SELECT * FROM ci_audit ORDER BY created_at DESC LIMIT ?").all(limit);
    return (rows as Row[]).map((row) => ({
      id: str(row, "id"),
      action: str(row, "action"),
      decision: str(row, "decision"),
      repositoryId: strOrNull(row, "repository_id"),
      actorId: str(row, "actor_id"),
      details: json<Record<string, unknown>>(row, "details_json", {}),
      createdAt: str(row, "created_at"),
    }));
  }
}
