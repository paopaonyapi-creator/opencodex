// Phase 20.64 — Visual Compute store (vc_* tables, schema v52).
//
// Shader registry with immutable versions, persisted jobs, artifact metadata
// (hashes only — binaries live under the artifact storage key), worker +
// capability snapshots, and persisted policy decisions. Static SQL literals
// with bound parameters.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import type {
  GpuCapabilitySnapshot, ShaderDiagnostic, ShaderReflection, ShaderStatus,
  VisualArtifact, VisualGpuJob, VisualJobStatus, VisualJobType, VisualPolicyDecision, VisualRisk, VisualShader, VisualShaderVersion,
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

function rowToShader(row: Row): VisualShader {
  return {
    id: str(row, "id"),
    name: str(row, "name"),
    slug: str(row, "slug"),
    description: strOrNull(row, "description"),
    status: str(row, "status") as ShaderStatus,
    riskClass: str(row, "risk_class") as VisualShader["riskClass"],
    currentVersionId: strOrNull(row, "current_version_id"),
    currentVersionNo: Number(row["current_version_no"] ?? 0),
    createdBy: str(row, "created_by"),
    createdAt: str(row, "created_at"),
    updatedAt: str(row, "updated_at"),
  };
}

function rowToVersion(row: Row): VisualShaderVersion {
  return {
    id: str(row, "id"),
    shaderId: str(row, "shader_id"),
    versionNo: Number(row["version_no"] ?? 1),
    source: str(row, "source"),
    sourceHash: str(row, "source_hash"),
    reflectionJson: json<ShaderReflection>(row, "reflection_json", { entryPoints: [], bindings: [], workgroupDeclared: false, imports: [] }),
    validationJson: json<ShaderDiagnostic[]>(row, "validation_json", []),
    vgpuVersion: str(row, "vgpu_version"),
    executedAt: strOrNull(row, "executed_at"),
    createdBy: str(row, "created_by"),
    createdAt: str(row, "created_at"),
  };
}

function rowToJob(row: Row): VisualGpuJob {
  return {
    id: str(row, "id"),
    type: str(row, "type") as VisualJobType,
    status: str(row, "status") as VisualJobStatus,
    shaderVersionId: str(row, "shader_version_id"),
    runtimePreference: str(row, "runtime_preference") as VisualGpuJob["runtimePreference"],
    assignedRuntime: strOrNull(row, "assigned_runtime") as VisualGpuJob["assignedRuntime"],
    requestedByType: str(row, "requested_by_type") as VisualGpuJob["requestedByType"],
    requestedById: str(row, "requested_by_id"),
    width: Number(row["width"] ?? 0),
    height: Number(row["height"] ?? 0),
    inputs: json<Record<string, unknown>>(row, "inputs_json", {}),
    outputFormat: str(row, "output_format") as VisualGpuJob["outputFormat"],
    policyDecisionId: strOrNull(row, "policy_decision_id"),
    errorCode: strOrNull(row, "error_code"),
    errorMessage: strOrNull(row, "error_message"),
    fingerprint: strOrNull(row, "fingerprint"),
    createdAt: str(row, "created_at"),
    startedAt: strOrNull(row, "started_at"),
    finishedAt: strOrNull(row, "finished_at"),
  };
}

function rowToArtifact(row: Row): VisualArtifact {
  return {
    id: str(row, "id"),
    jobId: str(row, "job_id"),
    type: str(row, "type") as VisualArtifact["type"],
    mimeType: str(row, "mime_type"),
    storageKey: strOrNull(row, "storage_key"),
    sha256: str(row, "sha256"),
    byteSize: Number(row["byte_size"] ?? 0),
    width: numOrNull(row, "width"),
    height: numOrNull(row, "height"),
    metadataJson: json<Record<string, unknown>>(row, "metadata_json", {}),
    createdAt: str(row, "created_at"),
  };
}

export class VisualComputeStore {
  // --- shaders ---

  insertShader(shader: VisualShader): boolean {
    const result = openAgentOsDb()
      .query("INSERT OR IGNORE INTO vc_shaders (id, name, slug, description, status, risk_class, current_version_id, current_version_no, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(shader.id, shader.name, shader.slug, shader.description, shader.status, shader.riskClass, shader.currentVersionId, shader.currentVersionNo, shader.createdBy, shader.createdAt, shader.updatedAt);
    return Number(result.changes) > 0;
  }

  getShader(id: string): VisualShader | null {
    const row = openAgentOsDb().query("SELECT * FROM vc_shaders WHERE id = ?").get(id) as Row | null;
    if (!row) return null;
    return rowToShader(row);
  }

  findShaderBySlug(slug: string): VisualShader | null {
    const row = openAgentOsDb().query("SELECT * FROM vc_shaders WHERE slug = ?").get(slug) as Row | null;
    if (!row) return null;
    return rowToShader(row);
  }

  listShaders(): VisualShader[] {
    const rows = openAgentOsDb().query("SELECT * FROM vc_shaders ORDER BY updated_at DESC LIMIT 500").all();
    return (rows as Row[]).map(rowToShader);
  }

  updateShader(id: string, patch: { status?: ShaderStatus; currentVersionId?: string | null; currentVersionNo?: number; riskClass?: VisualShader["riskClass"]; description?: string | null }): void {
    const shader = this.getShader(id);
    if (!shader) return;
    openAgentOsDb()
      .query("UPDATE vc_shaders SET status = ?, current_version_id = COALESCE(?, current_version_id), current_version_no = COALESCE(?, current_version_no), risk_class = ?, description = ?, updated_at = ? WHERE id = ?")
      .run(
        patch.status ?? shader.status,
        patch.currentVersionId !== undefined ? patch.currentVersionId : shader.currentVersionId,
        patch.currentVersionNo !== undefined ? patch.currentVersionNo : shader.currentVersionNo,
        patch.riskClass ?? shader.riskClass,
        patch.description !== undefined ? patch.description : shader.description,
        nowIso(),
        id,
      );
  }

  nextVersionNo(shaderId: string): number {
    const row = openAgentOsDb().query("SELECT MAX(version_no) AS max FROM vc_shader_versions WHERE shader_id = ?").get(shaderId) as Row | null;
    return (row && row["max"] !== null && row["max"] !== undefined ? Number(row["max"]) : 0) + 1;
  }

  insertShaderVersion(version: VisualShaderVersion): boolean {
    const result = openAgentOsDb()
      .query("INSERT OR IGNORE INTO vc_shader_versions (id, shader_id, version_no, source, source_hash, reflection_json, validation_json, vgpu_version, executed_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(version.id, version.shaderId, version.versionNo, version.source, version.sourceHash, JSON.stringify(version.reflectionJson), JSON.stringify(version.validationJson), version.vgpuVersion, version.executedAt, version.createdBy, version.createdAt);
    return Number(result.changes) > 0;
  }

  getShaderVersion(id: string): VisualShaderVersion | null {
    const row = openAgentOsDb().query("SELECT * FROM vc_shader_versions WHERE id = ?").get(id) as Row | null;
    if (!row) return null;
    return rowToVersion(row);
  }

  listShaderVersions(shaderId: string): VisualShaderVersion[] {
    const rows = openAgentOsDb().query("SELECT * FROM vc_shader_versions WHERE shader_id = ? ORDER BY version_no DESC").all(shaderId);
    return (rows as Row[]).map(rowToVersion);
  }

  /** Version immutability (spec §60): stamp executed_at exactly once. */
  markVersionExecuted(id: string): void {
    openAgentOsDb().query("UPDATE vc_shader_versions SET executed_at = COALESCE(executed_at, ?) WHERE id = ?").run(nowIso(), id);
  }

  // --- jobs ---

  insertJob(job: VisualGpuJob): boolean {
    const result = openAgentOsDb()
      .query("INSERT OR IGNORE INTO vc_jobs (id, type, status, shader_version_id, runtime_preference, assigned_runtime, requested_by_type, requested_by_id, width, height, inputs_json, output_format, policy_decision_id, error_code, error_message, fingerprint, created_at, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(job.id, job.type, job.status, job.shaderVersionId, job.runtimePreference, job.assignedRuntime, job.requestedByType, job.requestedById, job.width, job.height, JSON.stringify(job.inputs), job.outputFormat, job.policyDecisionId, job.errorCode, job.errorMessage, job.fingerprint, job.createdAt, job.startedAt, job.finishedAt);
    return Number(result.changes) > 0;
  }

  getJob(id: string): VisualGpuJob | null {
    const row = openAgentOsDb().query("SELECT * FROM vc_jobs WHERE id = ?").get(id) as Row | null;
    if (!row) return null;
    return rowToJob(row);
  }

  listJobs(filter?: { status?: string; requestedById?: string }): VisualGpuJob[] {
    if (filter?.status && filter.requestedById) {
      const both = openAgentOsDb().query("SELECT * FROM vc_jobs WHERE status = ? AND requested_by_id = ? ORDER BY created_at DESC LIMIT 200").all(filter.status, filter.requestedById);
      return (both as Row[]).map(rowToJob);
    }
    if (filter?.status) {
      const byStatus = openAgentOsDb().query("SELECT * FROM vc_jobs WHERE status = ? ORDER BY created_at DESC LIMIT 200").all(filter.status);
      return (byStatus as Row[]).map(rowToJob);
    }
    if (filter?.requestedById) {
      const byActor = openAgentOsDb().query("SELECT * FROM vc_jobs WHERE requested_by_id = ? ORDER BY created_at DESC LIMIT 200").all(filter.requestedById);
      return (byActor as Row[]).map(rowToJob);
    }
    const rows = openAgentOsDb().query("SELECT * FROM vc_jobs ORDER BY created_at DESC LIMIT 200").all();
    return (rows as Row[]).map(rowToJob);
  }

  updateJob(id: string, patch: Partial<Pick<VisualGpuJob, "status" | "assignedRuntime" | "policyDecisionId" | "errorCode" | "errorMessage" | "startedAt" | "finishedAt">>): void {
    const job = this.getJob(id);
    if (!job) return;
    openAgentOsDb()
      .query("UPDATE vc_jobs SET status = ?, assigned_runtime = ?, policy_decision_id = ?, error_code = ?, error_message = ?, started_at = ?, finished_at = ?, updated_at = ? WHERE id = ?")
      .run(
        patch.status ?? job.status,
        patch.assignedRuntime !== undefined ? patch.assignedRuntime : job.assignedRuntime,
        patch.policyDecisionId !== undefined ? patch.policyDecisionId : job.policyDecisionId,
        patch.errorCode !== undefined ? patch.errorCode : job.errorCode,
        patch.errorMessage !== undefined ? patch.errorMessage : job.errorMessage,
        patch.startedAt !== undefined ? patch.startedAt : job.startedAt,
        patch.finishedAt !== undefined ? patch.finishedAt : job.finishedAt,
        nowIso(),
        id,
      );
  }

  countQueuedByActor(actorId: string): number {
    const row = openAgentOsDb().query("SELECT COUNT(*) AS n FROM vc_jobs WHERE requested_by_id = ? AND status IN ('queued', 'policy_check', 'awaiting_approval', 'scheduled', 'running')").get(actorId) as Row | null;
    return row ? Number(row["n"]) : 0;
  }

  // --- artifacts ---

  insertArtifact(artifact: VisualArtifact): void {
    openAgentOsDb()
      .query("INSERT INTO vc_artifacts (id, job_id, type, mime_type, storage_key, sha256, byte_size, width, height, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(artifact.id, artifact.jobId, artifact.type, artifact.mimeType, artifact.storageKey, artifact.sha256, artifact.byteSize, artifact.width, artifact.height, JSON.stringify(artifact.metadataJson), artifact.createdAt);
  }

  getArtifact(id: string): VisualArtifact | null {
    const row = openAgentOsDb().query("SELECT * FROM vc_artifacts WHERE id = ?").get(id) as Row | null;
    if (!row) return null;
    return rowToArtifact(row);
  }

  listArtifacts(jobId?: string): VisualArtifact[] {
    const rows = jobId
      ? openAgentOsDb().query("SELECT * FROM vc_artifacts WHERE job_id = ? ORDER BY created_at").all(jobId)
      : openAgentOsDb().query("SELECT * FROM vc_artifacts ORDER BY created_at DESC LIMIT 200").all();
    return (rows as Row[]).map(rowToArtifact);
  }

  // --- workers + capability snapshots ---

  upsertWorker(worker: { id: string; name: string; runtime: string; status: string; softwareRenderer: boolean; capabilitySnapshotId: string | null; metadataJson: string }): void {
    openAgentOsDb()
      .query("INSERT INTO vc_workers (id, name, runtime, status, software_renderer, capability_snapshot_id, last_heartbeat_at, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, software_renderer = excluded.software_renderer, capability_snapshot_id = excluded.capability_snapshot_id, last_heartbeat_at = excluded.last_heartbeat_at, metadata_json = excluded.metadata_json, updated_at = excluded.updated_at")
      .run(worker.id, worker.name, worker.runtime, worker.status, worker.softwareRenderer ? 1 : 0, worker.capabilitySnapshotId, nowIso(), worker.metadataJson, nowIso(), nowIso());
  }

  listWorkers(): Array<Record<string, unknown>> {
    const rows = openAgentOsDb().query("SELECT * FROM vc_workers ORDER BY name").all() as Row[];
    return rows.map((row) => ({
      id: str(row, "id"),
      name: str(row, "name"),
      runtime: str(row, "runtime"),
      status: str(row, "status"),
      softwareRenderer: Number(row["software_renderer"] ?? 0) === 1,
      capabilitySnapshotId: strOrNull(row, "capability_snapshot_id"),
      lastHeartbeatAt: str(row, "last_heartbeat_at"),
      metadata: json<Record<string, unknown>>(row, "metadata_json", {}),
    }));
  }

  insertCapabilitySnapshot(snapshot: { id: string; workerId: string; runtime: string; snapshot: GpuCapabilitySnapshot }): void {
    openAgentOsDb()
      .query("INSERT OR IGNORE INTO vc_capability_snapshots (id, worker_id, runtime, adapter_name, backend, features_json, limits_json, software_renderer, vgpu_version, detected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(snapshot.id, snapshot.workerId, snapshot.runtime, snapshot.snapshot.adapterName, snapshot.snapshot.backend, JSON.stringify(snapshot.snapshot.features), JSON.stringify(snapshot.snapshot.limits), snapshot.snapshot.softwareRenderer ? 1 : 0, snapshot.snapshot.vgpuVersion, snapshot.snapshot.detectedAt);
  }

  // --- policy decisions ---

  insertPolicyDecision(decision: VisualPolicyDecision): void {
    openAgentOsDb()
      .query("INSERT INTO vc_policy_decisions (id, job_id, actor_type, actor_id, effect, risk, reasons_json, rules_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(decision.id, decision.jobId, decision.actorId.includes(":") ? "agent" : "user", decision.actorId, decision.effect, decision.risk, JSON.stringify(decision.reasons), JSON.stringify(decision.evaluatedRules), decision.createdAt);
  }

  getPolicyDecision(id: string): VisualPolicyDecision | null {
    const row = openAgentOsDb().query("SELECT * FROM vc_policy_decisions WHERE id = ?").get(id) as Row | null;
    if (!row) return null;
    return {
      id: str(row, "id"),
      jobId: strOrNull(row, "job_id"),
      effect: str(row, "effect") as VisualPolicyDecision["effect"],
      risk: str(row, "risk") as VisualRisk,
      reasons: json<string[]>(row, "reasons_json", []),
      evaluatedRules: json<VisualPolicyDecision["evaluatedRules"]>(row, "rules_json", []),
      actorId: str(row, "actor_id"),
      createdAt: str(row, "created_at"),
    };
  }

  // --- audit ---

  appendAudit(entry: { action: string; decision: string; actorId: string; details?: Record<string, unknown> }): void {
    openAgentOsDb()
      .query("INSERT INTO vc_audit (id, action, decision, actor_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(newId("vca"), entry.action, entry.decision, entry.actorId, JSON.stringify(entry.details ?? {}), nowIso());
  }

  listAudit(limit = 200): Array<Record<string, unknown>> {
    const rows = openAgentOsDb().query("SELECT * FROM vc_audit ORDER BY created_at DESC LIMIT ?").all(limit) as Row[];
    return rows.map((row) => ({
      id: str(row, "id"),
      action: str(row, "action"),
      decision: str(row, "decision"),
      actorId: str(row, "actor_id"),
      details: json<Record<string, unknown>>(row, "details_json", {}),
      createdAt: str(row, "created_at"),
    }));
  }
}
