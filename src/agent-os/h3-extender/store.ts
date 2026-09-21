// Phase 21.02 — H3 Extender Database Store.

import { openAgentOsDb } from "../db";
import type {
  H3Approval,
  H3Asset,
  H3AuditEvent,
  H3Clip,
  H3ClipAttempt,
  H3ExtenderJob,
  H3Project,
} from "./types";

export function nowIso(): string {
  return new Date().toISOString();
}

export function newH3Id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export class H3Store {
  // -------------------------------------------------------------------------
  // Projects
  // -------------------------------------------------------------------------
  upsertProject(p: H3Project): void {
    openAgentOsDb()
      .query(`
        INSERT INTO h3_projects (
          id, name, status, production_mode, workflow_template_id, workflow_template_ver,
          upstream_version, model_id, budget_limit, estimated_cost, actual_cost,
          project_artifact_id, created_by_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          status = excluded.status,
          production_mode = excluded.production_mode,
          workflow_template_id = excluded.workflow_template_id,
          workflow_template_ver = excluded.workflow_template_ver,
          upstream_version = excluded.upstream_version,
          model_id = excluded.model_id,
          budget_limit = excluded.budget_limit,
          estimated_cost = excluded.estimated_cost,
          actual_cost = excluded.actual_cost,
          project_artifact_id = excluded.project_artifact_id,
          updated_at = excluded.updated_at
      `)
      .run(
        p.id,
        p.name,
        p.status,
        p.productionMode,
        p.workflowTemplateId ?? null,
        p.workflowTemplateVer,
        p.upstreamVersion,
        p.modelId ?? null,
        p.budgetLimit ?? null,
        p.estimatedCost,
        p.actualCost,
        p.projectArtifactId ?? null,
        p.createdById ?? null,
        p.createdAt,
        p.updatedAt,
      );
  }

  getProject(id: string): H3Project | null {
    const r = openAgentOsDb().query("SELECT * FROM h3_projects WHERE id = ?").get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      productionMode: r.production_mode,
      workflowTemplateId: r.workflow_template_id,
      workflowTemplateVer: Number(r.workflow_template_ver || 1),
      upstreamVersion: r.upstream_version,
      modelId: r.model_id,
      budgetLimit: r.budget_limit != null ? Number(r.budget_limit) : null,
      estimatedCost: Number(r.estimated_cost || 0),
      actualCost: Number(r.actual_cost || 0),
      projectArtifactId: r.project_artifact_id,
      createdById: r.created_by_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  listProjects(): H3Project[] {
    const rows = openAgentOsDb().query("SELECT * FROM h3_projects ORDER BY updated_at DESC").all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      productionMode: r.production_mode,
      workflowTemplateId: r.workflow_template_id,
      workflowTemplateVer: Number(r.workflow_template_ver || 1),
      upstreamVersion: r.upstream_version,
      modelId: r.model_id,
      budgetLimit: r.budget_limit != null ? Number(r.budget_limit) : null,
      estimatedCost: Number(r.estimated_cost || 0),
      actualCost: Number(r.actual_cost || 0),
      projectArtifactId: r.project_artifact_id,
      createdById: r.created_by_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  // -------------------------------------------------------------------------
  // Clips
  // -------------------------------------------------------------------------
  upsertClip(c: H3Clip): void {
    openAgentOsDb()
      .query(`
        INSERT INTO h3_clips (
          id, project_id, sequence_index, name, state, mode, duration_seconds,
          prompt_structured_json, prompt_final, seed, model_id, generation_hash,
          validated_hash, validated_at, validated_by_id, active_attempt_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, sequence_index) DO UPDATE SET
          name = excluded.name,
          state = excluded.state,
          mode = excluded.mode,
          duration_seconds = excluded.duration_seconds,
          prompt_structured_json = excluded.prompt_structured_json,
          prompt_final = excluded.prompt_final,
          seed = excluded.seed,
          model_id = excluded.model_id,
          generation_hash = excluded.generation_hash,
          validated_hash = excluded.validated_hash,
          validated_at = excluded.validated_at,
          validated_by_id = excluded.validated_by_id,
          active_attempt_id = excluded.active_attempt_id,
          updated_at = excluded.updated_at
      `)
      .run(
        c.id,
        c.projectId,
        c.sequenceIndex,
        c.name ?? null,
        c.state,
        c.mode,
        c.durationSeconds,
        JSON.stringify(c.promptStructured || {}),
        c.promptFinal ?? null,
        c.seed ?? null,
        c.modelId ?? null,
        c.generationHash ?? null,
        c.validatedHash ?? null,
        c.validatedAt ?? null,
        c.validatedById ?? null,
        c.activeAttemptId ?? null,
        c.createdAt,
        c.updatedAt,
      );
  }

  getClip(id: string): H3Clip | null {
    const r = openAgentOsDb().query("SELECT * FROM h3_clips WHERE id = ?").get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      projectId: r.project_id,
      sequenceIndex: Number(r.sequence_index),
      name: r.name,
      state: r.state,
      mode: r.mode,
      durationSeconds: Number(r.duration_seconds || 5),
      promptStructured: JSON.parse(r.prompt_structured_json || "{}"),
      promptFinal: r.prompt_final,
      seed: r.seed,
      modelId: r.model_id,
      generationHash: r.generation_hash,
      validatedHash: r.validated_hash,
      validatedAt: r.validated_at,
      validatedById: r.validated_by_id,
      activeAttemptId: r.active_attempt_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  listClips(projectId: string): H3Clip[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM h3_clips WHERE project_id = ? ORDER BY sequence_index ASC")
      .all(projectId) as any[];
    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      sequenceIndex: Number(r.sequence_index),
      name: r.name,
      state: r.state,
      mode: r.mode,
      durationSeconds: Number(r.duration_seconds || 5),
      promptStructured: JSON.parse(r.prompt_structured_json || "{}"),
      promptFinal: r.prompt_final,
      seed: r.seed,
      modelId: r.model_id,
      generationHash: r.generation_hash,
      validatedHash: r.validated_hash,
      validatedAt: r.validated_at,
      validatedById: r.validated_by_id,
      activeAttemptId: r.active_attempt_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  // -------------------------------------------------------------------------
  // Attempts
  // -------------------------------------------------------------------------
  createAttempt(att: H3ClipAttempt): void {
    openAgentOsDb()
      .query(`
        INSERT INTO h3_clip_attempts (
          id, clip_id, attempt_number, generation_hash, status, remote_prompt_id,
          worker_id, preview_asset_id, output_asset_id, failure_class, failure_code,
          failure_message, estimated_cost, actual_cost, started_at, finished_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        att.id,
        att.clipId,
        att.attemptNumber,
        att.generationHash,
        att.status,
        att.remotePromptId ?? null,
        att.workerId ?? null,
        att.previewAssetId ?? null,
        att.outputAssetId ?? null,
        att.failureClass ?? null,
        att.failureCode ?? null,
        att.failureMessage ?? null,
        att.estimatedCost,
        att.actualCost,
        att.startedAt ?? null,
        att.finishedAt ?? null,
        att.createdAt,
      );
  }

  listAttempts(clipId: string): H3ClipAttempt[] {
    const rows = openAgentOsDb()
      .query("SELECT * FROM h3_clip_attempts WHERE clip_id = ? ORDER BY attempt_number ASC")
      .all(clipId) as any[];
    return rows.map((r) => ({
      id: r.id,
      clipId: r.clip_id,
      attemptNumber: Number(r.attempt_number),
      generationHash: r.generation_hash,
      status: r.status,
      remotePromptId: r.remote_prompt_id,
      workerId: r.worker_id,
      previewAssetId: r.preview_asset_id,
      outputAssetId: r.output_asset_id,
      failureClass: r.failure_class,
      failureCode: r.failure_code,
      failureMessage: r.failure_message,
      estimatedCost: Number(r.estimated_cost || 0),
      actualCost: Number(r.actual_cost || 0),
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      createdAt: r.created_at,
    }));
  }

  // -------------------------------------------------------------------------
  // Jobs, Approvals & Audits
  // -------------------------------------------------------------------------
  createJob(job: H3ExtenderJob): void {
    openAgentOsDb()
      .query(`
        INSERT INTO h3_extender_jobs (
          id, project_id, clip_id, type, state, worker_id, remote_job_id, retry_count,
          estimated_cost, actual_cost, error_code, error_message, metadata_json,
          started_at, finished_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        job.id,
        job.projectId,
        job.clipId ?? null,
        job.type,
        job.state,
        job.workerId ?? null,
        job.remoteJobId ?? null,
        job.retryCount,
        job.estimatedCost,
        job.actualCost,
        job.errorCode ?? null,
        job.errorMessage ?? null,
        JSON.stringify(job.metadata || {}),
        job.startedAt ?? null,
        job.finishedAt ?? null,
        job.createdAt,
      );
  }

  createApproval(app: H3Approval): void {
    openAgentOsDb()
      .query(`
        INSERT INTO h3_approvals (id, project_id, clip_id, stage, decision, decided_by_id, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        app.id,
        app.projectId,
        app.clipId ?? null,
        app.stage,
        app.decision,
        app.decidedById ?? null,
        app.note ?? null,
        app.createdAt,
      );
  }

  addAuditEvent(evt: H3AuditEvent): void {
    openAgentOsDb()
      .query(`
        INSERT INTO h3_audit_events (
          id, project_id, actor_id, event_type, target_type, target_id, before_json, after_json, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        evt.id,
        evt.projectId,
        evt.actorId ?? null,
        evt.eventType,
        evt.targetType ?? null,
        evt.targetId ?? null,
        evt.before ? JSON.stringify(evt.before) : null,
        evt.after ? JSON.stringify(evt.after) : null,
        JSON.stringify(evt.metadata || {}),
        evt.createdAt,
      );
  }
}
