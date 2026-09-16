// Phase 20.32 — speech runtime persistence over the shared agent-os SQLite
// store. Every statement is a complete static literal with bound parameters
// (no dynamic SQL fragments); updates are read-modify-write saves of full
// records, and inserts are check-then-insert so no upsert shape is needed.

import { openAgentOsDb } from "../db";
import type {
  ModelLicenseRecord,
  SpeechArtifactRecord,
  SpeechAuditEntry,
  SpeechHealthState,
  SpeechJobRecord,
  SpeechJobStatus,
  SpeechJobType,
  SpeechManifest,
  VoiceConsentRecord,
  VoiceProfileRecord,
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  const random = crypto.randomUUID().replace(/-/g, "");
  return `${prefix}_${random.slice(0, 20)}`;
}

export class SpeechStore {
  // --- jobs -----------------------------------------------------------------

  insertJob(job: SpeechJobRecord): void {
    openAgentOsDb()
      .query("INSERT INTO speech_jobs (id, project_id, type, provider, engine, model_id, voice_id, request_json, policy_snapshot_json, status, progress, attempt, max_attempts, error_code, error_message, output_artifact_id, created_at, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        job.id,
        job.projectId,
        job.type,
        job.provider,
        job.engine,
        job.modelId,
        job.voiceId,
        JSON.stringify(job.request),
        JSON.stringify(job.policySnapshot),
        job.status,
        job.progress,
        job.attempt,
        job.maxAttempts,
        job.errorCode,
        job.errorMessage,
        job.outputArtifactId,
        job.createdAt,
        job.startedAt,
        job.completedAt,
      );
  }

  getJob(id: string): SpeechJobRecord | null {
    const row = openAgentOsDb()
      .query("SELECT * FROM speech_jobs WHERE id = ?")
      .get(id) as Record<string, unknown> | null;
    return row ? mapJobRow(row) : null;
  }

  listJobs(limit = 50, projectId?: string): SpeechJobRecord[] {
    const db = openAgentOsDb();
    const rows = projectId
      ? (db.query("SELECT * FROM speech_jobs WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?").all(projectId, limit) as Record<string, unknown>[])
      : (db.query("SELECT * FROM speech_jobs ORDER BY created_at DESC, rowid DESC LIMIT ?").all(limit) as Record<string, unknown>[]);
    return rows.map(mapJobRow);
  }

  countActiveJobs(): number {
    const row = openAgentOsDb()
      .query("SELECT COUNT(*) AS n FROM speech_jobs WHERE status IN ('queued', 'preflight', 'waiting_for_runtime', 'running', 'postprocessing', 'policy_check')")
      .get() as { n: number };
    return Number(row.n);
  }

  /** Read-modify-write save of the full mutable job surface. */
  saveJob(job: SpeechJobRecord): void {
    openAgentOsDb()
      .query("UPDATE speech_jobs SET status = ?, progress = ?, attempt = ?, max_attempts = ?, error_code = ?, error_message = ?, output_artifact_id = ?, started_at = ?, completed_at = ?, engine = ?, model_id = ?, policy_snapshot_json = ? WHERE id = ?")
      .run(
        job.status,
        job.progress,
        job.attempt,
        job.maxAttempts,
        job.errorCode,
        job.errorMessage,
        job.outputArtifactId,
        job.startedAt,
        job.completedAt,
        job.engine,
        job.modelId,
        JSON.stringify(job.policySnapshot),
        job.id,
      );
  }

  // --- artifacts ------------------------------------------------------------

  insertArtifact(artifact: SpeechArtifactRecord): void {
    openAgentOsDb()
      .query("INSERT INTO speech_artifacts (id, job_id, project_id, role, raw_path, final_path, sha256, duration_ms, sample_rate, channels, manifest_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        artifact.id,
        artifact.jobId,
        artifact.projectId,
        artifact.role,
        artifact.rawPath,
        artifact.finalPath,
        artifact.sha256,
        artifact.durationMs,
        artifact.sampleRate,
        artifact.channels,
        artifact.manifest ? JSON.stringify(artifact.manifest) : null,
        artifact.createdAt,
      );
  }

  getArtifact(id: string): SpeechArtifactRecord | null {
    const row = openAgentOsDb()
      .query("SELECT * FROM speech_artifacts WHERE id = ?")
      .get(id) as Record<string, unknown> | null;
    return row ? mapArtifactRow(row) : null;
  }

  getJobArtifact(jobId: string): SpeechArtifactRecord | null {
    const row = openAgentOsDb()
      .query("SELECT * FROM speech_artifacts WHERE job_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .get(jobId) as Record<string, unknown> | null;
    return row ? mapArtifactRow(row) : null;
  }

  listArtifacts(limit = 50): SpeechArtifactRecord[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM speech_artifacts ORDER BY created_at DESC, rowid DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map(mapArtifactRow);
  }

  // --- voice profiles ---------------------------------------------------------

  insertVoice(voice: VoiceProfileRecord): void {
    openAgentOsDb()
      .query("INSERT INTO voice_profiles (id, provider, provider_profile_id, name, language, purposes_json, origin, status, commercial_use_status, consent_status, license_status, impersonates_public_figure, stock_approved_at, created_from_json, metadata_json, last_used_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        voice.id,
        voice.provider,
        voice.providerProfileId,
        voice.name,
        voice.language,
        JSON.stringify(voice.purposes),
        voice.origin,
        voice.status,
        voice.commercialUseStatus,
        voice.consentStatus,
        voice.licenseStatus,
        voice.impersonatesPublicFigure ? 1 : 0,
        voice.stockApprovedAt,
        voice.createdFrom ? JSON.stringify(voice.createdFrom) : null,
        JSON.stringify(voice.metadata),
        voice.lastUsedAt,
        voice.createdAt,
        voice.updatedAt,
      );
  }

  getVoice(id: string): VoiceProfileRecord | null {
    const row = openAgentOsDb()
      .query("SELECT * FROM voice_profiles WHERE id = ?")
      .get(id) as Record<string, unknown> | null;
    return row ? mapVoiceRow(row) : null;
  }

  listVoices(): VoiceProfileRecord[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM voice_profiles ORDER BY created_at DESC, rowid DESC")
      .all() as Record<string, unknown>[];
    return rows.map(mapVoiceRow);
  }

  /** Read-modify-write save of the full mutable voice governance surface. */
  saveVoice(voice: VoiceProfileRecord): void {
    openAgentOsDb()
      .query("UPDATE voice_profiles SET provider_profile_id = ?, status = ?, commercial_use_status = ?, consent_status = ?, license_status = ?, impersonates_public_figure = ?, stock_approved_at = ?, metadata_json = ?, last_used_at = ?, updated_at = ? WHERE id = ?")
      .run(
        voice.providerProfileId,
        voice.status,
        voice.commercialUseStatus,
        voice.consentStatus,
        voice.licenseStatus,
        voice.impersonatesPublicFigure ? 1 : 0,
        voice.stockApprovedAt,
        JSON.stringify(voice.metadata),
        voice.lastUsedAt,
        nowIso(),
        voice.id,
      );
  }

  // --- consents ---------------------------------------------------------------

  insertConsent(consent: VoiceConsentRecord): void {
    openAgentOsDb()
      .query("INSERT INTO voice_consents (id, voice_id, subject_type, subject_alias, consent_basis, consent_document_ref, allowed_uses_json, commercial_use_allowed, stock_use_allowed, voice_clone_allowed, expires_at, revoked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        consent.id,
        consent.voiceId,
        consent.subjectType,
        consent.subjectAlias,
        consent.consentBasis,
        consent.consentDocumentRef,
        JSON.stringify(consent.allowedUses),
        consent.commercialUseAllowed ? 1 : 0,
        consent.stockUseAllowed ? 1 : 0,
        consent.voiceCloneAllowed ? 1 : 0,
        consent.expiresAt,
        consent.revokedAt,
        consent.createdAt,
        consent.updatedAt,
      );
  }

  getConsent(id: string): VoiceConsentRecord | null {
    const row = openAgentOsDb()
      .query("SELECT * FROM voice_consents WHERE id = ?")
      .get(id) as Record<string, unknown> | null;
    return row ? mapConsentRow(row) : null;
  }

  getActiveConsentForVoice(voiceId: string): VoiceConsentRecord | null {
    const row = openAgentOsDb()
      .query("SELECT * FROM voice_consents WHERE voice_id = ? AND revoked_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .get(voiceId) as Record<string, unknown> | null;
    return row ? mapConsentRow(row) : null;
  }

  listConsents(): VoiceConsentRecord[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM voice_consents ORDER BY created_at DESC, rowid DESC")
      .all() as Record<string, unknown>[];
    return rows.map(mapConsentRow);
  }

  revokeConsent(id: string, at: string): void {
    openAgentOsDb()
      .query("UPDATE voice_consents SET revoked_at = ?, updated_at = ? WHERE id = ?")
      .run(at, at, id);
  }

  // --- model licenses -----------------------------------------------------------

  insertLicense(license: ModelLicenseRecord): void {
    openAgentOsDb()
      .query("INSERT INTO model_licenses (id, provider, engine, model_id, model_version, code_license, weights_license, commercial_use, stock_use, attribution_required, status, source_url, verified_at, verified_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        license.id,
        license.provider,
        license.engine,
        license.modelId,
        license.modelVersion,
        license.codeLicense,
        license.weightsLicense,
        license.commercialUse ? 1 : 0,
        license.stockUse ? 1 : 0,
        license.attributionRequired ? 1 : 0,
        license.status,
        license.sourceUrl,
        license.verifiedAt,
        license.verifiedBy,
        license.updatedAt,
        license.updatedAt,
      );
  }

  getLicense(id: string): ModelLicenseRecord | null {
    const row = openAgentOsDb()
      .query("SELECT * FROM model_licenses WHERE id = ?")
      .get(id) as Record<string, unknown> | null;
    return row ? mapLicenseRow(row) : null;
  }

  getLicenseByKey(provider: string, engine: string, modelId: string): ModelLicenseRecord | null {
    const row = openAgentOsDb()
      .query("SELECT * FROM model_licenses WHERE provider = ? AND engine = ? AND model_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1")
      .get(provider, engine, modelId) as Record<string, unknown> | null;
    return row ? mapLicenseRow(row) : null;
  }

  listLicenses(): ModelLicenseRecord[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM model_licenses ORDER BY created_at DESC, rowid DESC")
      .all() as Record<string, unknown>[];
    return rows.map(mapLicenseRow);
  }

  /** Read-modify-write save of the human-review surface of a license row. */
  saveLicense(license: ModelLicenseRecord): void {
    openAgentOsDb()
      .query("UPDATE model_licenses SET model_version = ?, code_license = ?, weights_license = ?, commercial_use = ?, stock_use = ?, attribution_required = ?, status = ?, source_url = ?, verified_at = ?, verified_by = ?, updated_at = ? WHERE id = ?")
      .run(
        license.modelVersion,
        license.codeLicense,
        license.weightsLicense,
        license.commercialUse ? 1 : 0,
        license.stockUse ? 1 : 0,
        license.attributionRequired ? 1 : 0,
        license.status,
        license.sourceUrl,
        license.verifiedAt,
        license.verifiedBy,
        nowIso(),
        license.id,
      );
  }

  // --- policy checks / health / audit ---------------------------------------------

  insertPolicyCheck(entry: { jobId: string; gate: string; decision: string; reasonCode: string | null; requiredAction: string | null }): void {
    openAgentOsDb()
      .query("INSERT INTO speech_policy_checks (id, job_id, gate, decision, reason_code, required_action, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(newId("spchk"), entry.jobId, entry.gate, entry.decision, entry.reasonCode, entry.requiredAction, nowIso());
  }

  listPolicyChecks(jobId: string): Array<{ gate: string; decision: string; reasonCode: string | null; requiredAction: string | null; createdAt: string }> {
    const rows = openAgentOsDb()
      .query("SELECT * FROM speech_policy_checks WHERE job_id = ? ORDER BY created_at ASC, rowid ASC")
      .all(jobId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      gate: String(row.gate),
      decision: String(row.decision),
      reasonCode: row.reason_code === null || row.reason_code === undefined ? null : String(row.reason_code),
      requiredAction: row.required_action === null || row.required_action === undefined ? null : String(row.required_action),
      createdAt: String(row.created_at),
    }));
  }

  insertHealthRecord(entry: { state: SpeechHealthState; provider: string; versionDetected: string | null; versionPin: string; detail: Record<string, unknown> }): void {
    openAgentOsDb()
      .query("INSERT INTO speech_runtime_health (id, checked_at, state, provider, version_detected, version_pin, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(newId("sph"), nowIso(), entry.state, entry.provider, entry.versionDetected, entry.versionPin, JSON.stringify(entry.detail));
  }

  latestHealth(): { state: string; checkedAt: string; versionDetected: string | null } | null {
    const row = openAgentOsDb()
      .query("SELECT * FROM speech_runtime_health ORDER BY checked_at DESC, rowid DESC LIMIT 1")
      .get() as Record<string, unknown> | null;
    if (!row) return null;
    return {
      state: String(row.state),
      checkedAt: String(row.checked_at),
      versionDetected: row.version_detected === null || row.version_detected === undefined ? null : String(row.version_detected),
    };
  }

  appendAudit(entry: { actor: string; action: string; target: string; before?: Record<string, unknown> | null; after?: Record<string, unknown> | null; reason?: string | null }): void {
    openAgentOsDb()
      .query("INSERT INTO speech_audit (ts, actor, action, target, before_json, after_json, reason) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(nowIso(), entry.actor, entry.action, entry.target, entry.before ? JSON.stringify(entry.before) : null, entry.after ? JSON.stringify(entry.after) : null, entry.reason ?? null);
  }

  listAudit(limit = 50): SpeechAuditEntry[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM speech_audit ORDER BY ts DESC, id DESC LIMIT ?")
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: Number(row.id),
      ts: String(row.ts),
      actor: String(row.actor),
      action: String(row.action),
      target: String(row.target),
      before: row.before_json ? (JSON.parse(String(row.before_json)) as Record<string, unknown>) : null,
      after: row.after_json ? (JSON.parse(String(row.after_json)) as Record<string, unknown>) : null,
      reason: row.reason === null || row.reason === undefined ? null : String(row.reason),
    }));
  }
}

// --- row mappers ---------------------------------------------------------------

function mapJobRow(row: Record<string, unknown>): SpeechJobRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    type: String(row.type) as SpeechJobType,
    provider: String(row.provider),
    engine: row.engine === null || row.engine === undefined ? null : String(row.engine),
    modelId: row.model_id === null || row.model_id === undefined ? null : String(row.model_id),
    voiceId: row.voice_id === null || row.voice_id === undefined ? null : String(row.voice_id),
    request: safeParse(row.request_json) as Record<string, unknown>,
    policySnapshot: safeParse(row.policy_snapshot_json) as Record<string, unknown>,
    status: String(row.status) as SpeechJobStatus,
    progress: Number(row.progress ?? 0),
    attempt: Number(row.attempt ?? 0),
    maxAttempts: Number(row.max_attempts ?? 2),
    errorCode: row.error_code === null || row.error_code === undefined ? null : String(row.error_code),
    errorMessage: row.error_message === null || row.error_message === undefined ? null : String(row.error_message),
    outputArtifactId: row.output_artifact_id === null || row.output_artifact_id === undefined ? null : String(row.output_artifact_id),
    createdAt: String(row.created_at),
    startedAt: row.started_at === null || row.started_at === undefined ? null : String(row.started_at),
    completedAt: row.completed_at === null || row.completed_at === undefined ? null : String(row.completed_at),
  };
}

function mapArtifactRow(row: Record<string, unknown>): SpeechArtifactRecord {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    projectId: String(row.project_id),
    role: String(row.role) as SpeechArtifactRecord["role"],
    rawPath: row.raw_path === null || row.raw_path === undefined ? null : String(row.raw_path),
    finalPath: row.final_path === null || row.final_path === undefined ? null : String(row.final_path),
    sha256: row.sha256 === null || row.sha256 === undefined ? null : String(row.sha256),
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
    sampleRate: row.sample_rate === null || row.sample_rate === undefined ? null : Number(row.sample_rate),
    channels: row.channels === null || row.channels === undefined ? null : Number(row.channels),
    manifest: row.manifest_json ? (safeParse(row.manifest_json) as SpeechManifest) : null,
    createdAt: String(row.created_at),
  };
}

function mapVoiceRow(row: Record<string, unknown>): VoiceProfileRecord {
  return {
    id: String(row.id),
    provider: String(row.provider),
    providerProfileId: row.provider_profile_id === null || row.provider_profile_id === undefined ? null : String(row.provider_profile_id),
    name: String(row.name),
    language: row.language === null || row.language === undefined ? null : String(row.language),
    purposes: safeParse(row.purposes_json) as string[],
    origin: String(row.origin) as VoiceProfileRecord["origin"],
    status: String(row.status) as VoiceProfileRecord["status"],
    commercialUseStatus: String(row.commercial_use_status) as VoiceProfileRecord["commercialUseStatus"],
    consentStatus: String(row.consent_status) as VoiceProfileRecord["consentStatus"],
    licenseStatus: String(row.license_status) as VoiceProfileRecord["licenseStatus"],
    impersonatesPublicFigure: Number(row.impersonates_public_figure ?? 0) === 1,
    stockApprovedAt: row.stock_approved_at === null || row.stock_approved_at === undefined ? null : String(row.stock_approved_at),
    createdFrom: row.created_from_json ? (safeParse(row.created_from_json) as Record<string, unknown>) : null,
    metadata: safeParse(row.metadata_json) as Record<string, unknown>,
    lastUsedAt: row.last_used_at === null || row.last_used_at === undefined ? null : String(row.last_used_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapConsentRow(row: Record<string, unknown>): VoiceConsentRecord {
  return {
    id: String(row.id),
    voiceId: row.voice_id === null || row.voice_id === undefined ? null : String(row.voice_id),
    subjectType: String(row.subject_type),
    subjectAlias: String(row.subject_alias),
    consentBasis: String(row.consent_basis) as VoiceConsentRecord["consentBasis"],
    consentDocumentRef: row.consent_document_ref === null || row.consent_document_ref === undefined ? null : String(row.consent_document_ref),
    allowedUses: safeParse(row.allowed_uses_json) as string[],
    commercialUseAllowed: Number(row.commercial_use_allowed ?? 0) === 1,
    stockUseAllowed: Number(row.stock_use_allowed ?? 0) === 1,
    voiceCloneAllowed: Number(row.voice_clone_allowed ?? 0) === 1,
    expiresAt: row.expires_at === null || row.expires_at === undefined ? null : String(row.expires_at),
    revokedAt: row.revoked_at === null || row.revoked_at === undefined ? null : String(row.revoked_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapLicenseRow(row: Record<string, unknown>): ModelLicenseRecord {
  return {
    id: String(row.id),
    provider: String(row.provider),
    engine: String(row.engine),
    modelId: String(row.model_id),
    modelVersion: row.model_version === null || row.model_version === undefined ? null : String(row.model_version),
    codeLicense: row.code_license === null || row.code_license === undefined ? null : String(row.code_license),
    weightsLicense: row.weights_license === null || row.weights_license === undefined ? null : String(row.weights_license),
    commercialUse: Number(row.commercial_use ?? 0) === 1,
    stockUse: Number(row.stock_use ?? 0) === 1,
    attributionRequired: Number(row.attribution_required ?? 0) === 1,
    status: String(row.status) as ModelLicenseRecord["status"],
    sourceUrl: row.source_url === null || row.source_url === undefined ? null : String(row.source_url),
    verifiedAt: row.verified_at === null || row.verified_at === undefined ? null : String(row.verified_at),
    verifiedBy: row.verified_by === null || row.verified_by === undefined ? null : String(row.verified_by),
    updatedAt: String(row.updated_at),
  };
}

function safeParse(raw: unknown): unknown {
  if (typeof raw !== "string" || !raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
