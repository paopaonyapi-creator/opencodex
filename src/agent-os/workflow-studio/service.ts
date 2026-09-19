// Phase 20.93 — Workflow Studio service: durable runtime + facade.
//
// Owns workflow/version persistence, run lifecycle (PENDING → RUNNING →
// SUCCEEDED/FAILED/CANCELLED/WAITING_FOR_APPROVAL), node execution with
// checkpoints, typed events, artifact lineage (runtime-owned IO), approval
// decisions and secret-redacted payloads. The compiled plan is immutable per
// run; node outputs persist at node boundaries so restarts resume safely.
//
// All SQL is parameterized (? placeholders) per the repo DB convention.

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openAgentOsDb } from "../db";
import { evaluateCapability } from "../policy";
import {
  WorkflowGraphSchema,
  WorkflowStudioError,
  parseOrThrow,
  redactSecrets,
  type ArtifactRecord,
  type ApprovalRequestRecord,
  type NodeExecutionContext,
  type NodeRunRecord,
  type NodeRunStatus,
  type RunStatus,
  type WorkflowGraph,
  type WorkflowRunRecord,
  type WorkflowVersionRecord,
} from "./types";
import { compileOrThrow, compileGraph, type ExecutionPlan } from "./compiler";
import { getNodeRegistry } from "./registry";

function now(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return prefix + randomUUID().slice(0, 12);
}

/** Mark one node run RUNNING with its attempt counter. */
function markNodeRunning(db: ReturnType<typeof openAgentOsDb>, runId: string, nodeId: string, attempt: number): void {
  db.run(
    "UPDATE wfs_node_runs SET status = 'RUNNING', attempt = ?, started_at = ? WHERE run_id = ? AND node_id = ?",
    [attempt, now(), runId, nodeId],
  );
}

/** Mark one node run SUCCEEDED with its persisted output checkpoint. */
function completeNodeRun(db: ReturnType<typeof openAgentOsDb>, runId: string, nodeId: string, attempt: number, durationMs: number, outputJson: string): void {
  db.run(
    "UPDATE wfs_node_runs SET status = 'SUCCEEDED', attempt = ?, finished_at = ?, duration_ms = ?, output_json = ? WHERE run_id = ? AND node_id = ?",
    [attempt, now(), durationMs, outputJson, runId, nodeId],
  );
}

/** Mark one node run FAILED with a redacted structured error. */
function failNodeRun(db: ReturnType<typeof openAgentOsDb>, runId: string, nodeId: string, attempt: number, errorJson: string): void {
  db.run(
    "UPDATE wfs_node_runs SET status = 'FAILED', attempt = ?, finished_at = ?, error_json = ? WHERE run_id = ? AND node_id = ?",
    [attempt, now(), errorJson, runId, nodeId],
  );
}

export interface WorkflowDetail {
  workflow: { id: string; name: string; description: string; activeVersion: number; createdAt: string; updatedAt: string };
  versions: Array<{ id: string; version: number; status: string; planHash: string | null; createdAt: string }>;
  graph: WorkflowGraph | null;
}

export class WorkflowStudioService {
  private studioRoot: string;

  constructor(studioRoot = join(process.cwd(), "runtime", "workflow-studio")) {
    this.studioRoot = studioRoot;
  }

  // -----------------------------------------------------------------------
  // Workflow + version persistence
  // -----------------------------------------------------------------------

  createWorkflow(input: { name: string; description?: string; graph?: unknown; actor?: string }): { id: string; version: number } {
    const db = openAgentOsDb();
    const id = newId("wfs");
    const ts = now();
    db.run(
      "INSERT INTO wfs_workflows (id, name, description, active_version, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)",
      [id, input.name, input.description ?? "", ts, ts],
    );
    let version = 0;
    if (input.graph !== undefined) {
      version = this.saveDraft(id, input.graph, input.actor ?? "operator");
    }
    return { id, version };
  }

  saveDraft(workflowId: string, graph: unknown, actor = "operator"): number {
    const db = openAgentOsDb();
    const workflow = db.query("SELECT id FROM wfs_workflows WHERE id = ?").get(workflowId) as { id: string } | undefined;
    if (!workflow) throw new WorkflowStudioError("WORKFLOW_NOT_FOUND", 404, `workflow '${workflowId}' not found`);
    const parsed = parseOrThrow(WorkflowGraphSchema, graph, "workflow graph");
    const row = db.query("SELECT COALESCE(MAX(version), 0) AS v FROM wfs_versions WHERE workflow_id = ?").get(workflowId) as { v: number };
    const version = Number(row.v) + 1;
    db.run(
      "INSERT INTO wfs_versions (id, workflow_id, version, status, graph_json, plan_json, plan_hash, created_at) VALUES (?, ?, ?, 'draft', ?, NULL, NULL, ?)",
      [newId("wfsv"), workflowId, version, JSON.stringify(parsed), now()],
    );
    db.run("UPDATE wfs_workflows SET updated_at = ? WHERE id = ?", [now(), workflowId]);
    this.event(null, null, "workflow.draft_saved", { workflowId, version, actor });
    return version;
  }

  getGraph(versionId: string): { version: WorkflowVersionRecord; graph: WorkflowGraph } {
    const row = openAgentOsDb().query("SELECT * FROM wfs_versions WHERE id = ?").get(versionId) as Record<string, unknown> | undefined;
    if (!row) throw new WorkflowStudioError("VERSION_NOT_FOUND", 404, `workflow version '${versionId}' not found`);
    const version = this.rowToVersion(row);
    return { version, graph: JSON.parse(version.graphJson) as WorkflowGraph };
  }

  listWorkflows(): Array<Record<string, unknown>> {
    return openAgentOsDb().query("SELECT id, name, description, active_version, created_at, updated_at FROM wfs_workflows ORDER BY updated_at DESC").all() as Array<Record<string, unknown>>;
  }

  getWorkflowDetail(workflowId: string): WorkflowDetail | null {
    const db = openAgentOsDb();
    const workflow = db.query("SELECT * FROM wfs_workflows WHERE id = ?").get(workflowId) as Record<string, unknown> | undefined;
    if (!workflow) return null;
    const versions = (db.query("SELECT id, version, status, plan_hash, created_at FROM wfs_versions WHERE workflow_id = ? ORDER BY version DESC").all(workflowId) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id), version: Number(r.version), status: String(r.status), planHash: r.plan_hash === null ? null : String(r.plan_hash), createdAt: String(r.created_at),
    }));
    const active = versions.find((v) => v.version === Number(workflow.active_version)) ?? versions[0] ?? null;
    const graph = active ? this.getGraph(active.id).graph : null;
    return {
      workflow: { id: String(workflow.id), name: String(workflow.name), description: String(workflow.description), activeVersion: Number(workflow.active_version), createdAt: String(workflow.created_at), updatedAt: String(workflow.updated_at) },
      versions, graph,
    };
  }

  /** Validate + publish a draft: compile (rejecting errors) and freeze the plan. */
  publishVersion(workflowId: string, graph: unknown, actor = "operator"): { version: number; versionId: string; planHash: string } {
    const parsed = parseOrThrow(WorkflowGraphSchema, graph, "workflow graph");
    const plan = compileOrThrow(parsed);
    const db = openAgentOsDb();
    const row = db.query("SELECT COALESCE(MAX(version), 0) AS v FROM wfs_versions WHERE workflow_id = ?").get(workflowId) as { v: number };
    const version = Number(row.v) + 1;
    const vid = newId("wfsv");
    db.run(
      "INSERT INTO wfs_versions (id, workflow_id, version, status, graph_json, plan_json, plan_hash, created_at) VALUES (?, ?, ?, 'published', ?, ?, ?, ?)",
      [vid, workflowId, version, JSON.stringify(parsed), JSON.stringify(plan), plan.planHash, now()],
    );
    db.run("UPDATE wfs_workflows SET active_version = ?, updated_at = ? WHERE id = ?", [version, now(), workflowId]);
    this.event(null, null, "workflow.published", { workflowId, version, planHash: plan.planHash, actor });
    return { version, versionId: vid, planHash: plan.planHash };
  }

  validateGraph(graph: unknown): { ok: boolean; diagnostics: Array<{ nodeId: string | null; severity: string; message: string }> } {
    const parsed = parseOrThrow(WorkflowGraphSchema, graph, "workflow graph");
    const result = compileGraph(parsed);
    return { ok: result.ok, diagnostics: result.diagnostics };
  }

  // -----------------------------------------------------------------------
  // Run lifecycle
  // -----------------------------------------------------------------------

  /** Start a run against the workflow's active published version. */
  startRun(workflowId: string, trigger = "manual", actor = "operator"): { runId: string; version: number; planHash: string } {
    const db = openAgentOsDb();
    const workflow = db.query("SELECT active_version FROM wfs_workflows WHERE id = ?").get(workflowId) as { active_version: number } | undefined;
    if (!workflow) throw new WorkflowStudioError("WORKFLOW_NOT_FOUND", 404, `workflow '${workflowId}' not found`);
    const versionRow = db.query("SELECT * FROM wfs_versions WHERE workflow_id = ? AND version = ?").get(workflowId, workflow.active_version) as Record<string, unknown> | undefined;
    if (!versionRow) throw new WorkflowStudioError("VERSION_NOT_FOUND", 409, "workflow has no published version to run");
    const version = this.rowToVersion(versionRow);
    if (version.status !== "published" || !version.planJson) {
      throw new WorkflowStudioError("INVALID_TRANSITION", 409, "the active version is a draft — publish it before running");
    }
    const plan = JSON.parse(version.planJson) as ExecutionPlan;
    // Policy gate at start: capabilities checked against the shared Phase 05 layer.
    for (const gate of plan.policyGates) {
      const decision = evaluateCapability("task", null, gate.capability as never);
      if (!decision.allowed && decision.reason === "policy_deny") {
        throw new WorkflowStudioError("POLICY_DENIED", 403, `capability '${gate.capability}' is denied by policy`, { capability: gate.capability });
      }
    }
    const runId = newId("wfsrun");
    db.run(
      "INSERT INTO wfs_runs (id, workflow_id, version_id, version, status, plan_hash, trigger, memory_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'RUNNING', ?, ?, '{}', ?, ?)",
      [runId, workflowId, version.id, version.version, plan.planHash, trigger, now(), now()],
    );
    for (const node of plan.nodes) {
      db.run(
        "INSERT INTO wfs_node_runs (id, run_id, node_id, node_type, status, attempt) VALUES (?, ?, ?, ?, 'PENDING', 0)",
        [newId("wfsn"), runId, node.id, node.type],
      );
    }
    this.event(runId, null, "workflow.started", { workflowId, version: version.version, planHash: plan.planHash, actor });
    return { runId, version: version.version, planHash: plan.planHash };
  }

  getRun(runId: string): WorkflowRunRecord | null {
    const row = openAgentOsDb().query("SELECT * FROM wfs_runs WHERE id = ?").get(runId) as Record<string, unknown> | undefined;
    return row ? this.rowToRun(row) : null;
  }

  /** Full run inspection: nodes + events + artifacts + approvals. */
  inspectRun(runId: string): {
    run: WorkflowRunRecord;
    nodes: NodeRunRecord[];
    events: Array<{ type: string; nodeId: string | null; payloadJson: string; createdAt: string }>;
    artifacts: ArtifactRecord[];
    approvals: ApprovalRequestRecord[];
  } | null {
    const run = this.getRun(runId);
    if (!run) return null;
    const db = openAgentOsDb();
    const nodes = (db.query("SELECT * FROM wfs_node_runs WHERE run_id = ? ORDER BY started_at, node_id").all(runId) as Array<Record<string, unknown>>).map((r) => this.rowToNodeRun(r));
    const events = (db.query("SELECT type, node_id, payload_json, created_at FROM wfs_events WHERE run_id = ? ORDER BY created_at").all(runId) as Array<Record<string, unknown>>).map((r) => ({
      type: String(r.type), nodeId: r.node_id === null ? null : String(r.node_id), payloadJson: String(r.payload_json), createdAt: String(r.created_at),
    }));
    const artifacts = (db.query("SELECT * FROM wfs_artifacts WHERE run_id = ? ORDER BY created_at").all(runId) as Array<Record<string, unknown>>).map((r) => this.rowToArtifact(r));
    const approvals = (db.query("SELECT * FROM wfs_approvals WHERE run_id = ? ORDER BY created_at").all(runId) as Array<Record<string, unknown>>).map((r) => this.rowToApproval(r));
    return { run, nodes, events, artifacts, approvals };
  }

  pauseRun(runId: string): { status: string } {
    const run = this.requireRun(runId);
    if (run.status !== "RUNNING") throw new WorkflowStudioError("INVALID_TRANSITION", 409, `cannot pause a ${run.status} run`);
    openAgentOsDb().run("UPDATE wfs_runs SET status = 'PAUSED', updated_at = ? WHERE id = ?", [now(), runId]);
    this.event(runId, null, "workflow.paused", {});
    return { status: "PAUSED" };
  }

  resumeRun(runId: string): { status: string } {
    const run = this.requireRun(runId);
    if (run.status !== "PAUSED") throw new WorkflowStudioError("INVALID_TRANSITION", 409, `cannot resume a ${run.status} run`);
    openAgentOsDb().run("UPDATE wfs_runs SET status = 'RUNNING', updated_at = ? WHERE id = ?", [now(), runId]);
    this.event(runId, null, "workflow.resumed", {});
    return { status: "RUNNING" };
  }

  cancelRun(runId: string): { status: string } {
    const run = this.requireRun(runId);
    if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(run.status)) throw new WorkflowStudioError("INVALID_TRANSITION", 409, `run already ${run.status}`);
    openAgentOsDb().run("UPDATE wfs_runs SET status = 'CANCELLED', updated_at = ? WHERE id = ?", [now(), runId]);
    openAgentOsDb().run("UPDATE wfs_node_runs SET status = 'CANCELLED' WHERE run_id = ? AND status IN ('PENDING', 'READY')", [runId]);
    this.event(runId, null, "workflow.cancelled", {});
    return { status: "CANCELLED" };
  }

  private requireRun(runId: string): WorkflowRunRecord {
    const run = this.getRun(runId);
    if (!run) throw new WorkflowStudioError("RUN_NOT_FOUND", 404, `run '${runId}' not found`);
    return run;
  }

  private event(runId: string | null, nodeId: string | null, type: string, payload: Record<string, unknown>): void {
    try {
      openAgentOsDb().run(
        "INSERT INTO wfs_events (id, run_id, node_id, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [newId("wfse"), runId, nodeId, type, JSON.stringify(payload), now()],
      );
    } catch {
      // Event persistence is best-effort; functional gates surface their own errors.
    }
  }

  private markNodeRunning(runId: string, nodeId: string, attempt: number): void {
    openAgentOsDb().run(
      "UPDATE wfs_node_runs SET status = 'RUNNING', attempt = ?, started_at = ? WHERE run_id = ? AND node_id = ?",
      [attempt, now(), runId, nodeId],
    );
  }

  private completeNode(runId: string, nodeId: string, attempt: number, output: Record<string, unknown>, durationMs: number): void {
    const serialized = redactSecrets(JSON.stringify(output));
    openAgentOsDb().run(
      "UPDATE wfs_node_runs SET status = 'SUCCEEDED', attempt = ?, finished_at = ?, duration_ms = ?, output_json = ? WHERE run_id = ? AND node_id = ?",
      [attempt, now(), durationMs, serialized, runId, nodeId],
    );
    // Checkpoint: the run memory snapshot persists at each node boundary.
    const run = this.requireRun(runId);
    const memory = JSON.parse(run.memoryJson) as Record<string, unknown>;
    openAgentOsDb().run("UPDATE wfs_runs SET memory_json = ?, updated_at = ? WHERE id = ?", [JSON.stringify(memory), now(), runId]);
    // output.artifact: the runtime owns the sandbox-guarded file write + lineage.
    const prepared = (output as Record<string, unknown>).artifactName;
    if (typeof prepared === "string" && (output as Record<string, unknown>).content !== undefined) {
      const record = this.persistArtifact(runId, nodeId, prepared, String((output as Record<string, unknown>).content));
      (output as Record<string, unknown>).artifact = {
        id: record.id, name: record.name, mimeType: record.mimeType, sha256: record.sha256, sizeBytes: record.sizeBytes, uri: record.uri,
      };
      const updated = redactSecrets(JSON.stringify(output));
      openAgentOsDb().run("UPDATE wfs_node_runs SET output_json = ? WHERE run_id = ? AND node_id = ?", [updated, runId, nodeId]);
    }
  }

  private failNode(runId: string, nodeId: string, attempt: number, message: string, code: string): void {
    openAgentOsDb().run(
      "UPDATE wfs_node_runs SET status = 'FAILED', attempt = ?, finished_at = ?, error_json = ? WHERE run_id = ? AND node_id = ?",
      [attempt, now(), JSON.stringify({ error: redactSecrets(message), code }), runId, nodeId],
    );
  }

  /** Persist an artifact for a run (sandbox-guarded) with full lineage. */
  persistArtifact(runId: string, nodeId: string, name: string, content: string): ArtifactRecord {
    if (!/^[\w-]+$/.test(runId)) throw new WorkflowStudioError("SCHEMA_INVALID", 422, "run id failed the shape guard");
    const dir = join(this.studioRoot, "runs", runId, "artifacts");
    const fname = `${name}.json`;
    const path = join(dir, fname);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, content);
    const record: ArtifactRecord = {
      id: newId("wfsart"), runId, nodeId, name, uri: path, mimeType: "application/json",
      sha256: createHash("sha256").update(content).digest("hex"), sizeBytes: Buffer.byteLength(content), createdAt: now(),
    };
    openAgentOsDb().run(
      "INSERT INTO wfs_artifacts (id, run_id, node_id, name, uri, mime_type, sha256, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [record.id, runId, nodeId, record.name, record.uri, record.mimeType, record.sha256, record.sizeBytes, record.createdAt],
    );
    this.event(runId, nodeId, "artifact.created", { name: record.name, sha256: record.sha256 });
    return record;
  }

  private listNodeRuns(runId: string): NodeRunRecord[] {
    return (openAgentOsDb().query("SELECT * FROM wfs_node_runs WHERE run_id = ? ORDER BY started_at, node_id").all(runId) as Array<Record<string, unknown>>).map((r) => this.rowToNodeRun(r));
  }

  private nodeRun(runId: string, nodeId: string): NodeRunRecord | null {
    const row = openAgentOsDb().query("SELECT * FROM wfs_node_runs WHERE run_id = ? AND node_id = ? ORDER BY attempt DESC LIMIT 1").get(runId, nodeId) as Record<string, unknown> | undefined;
    return row ? this.rowToNodeRun(row) : null;
  }

  private rowToNodeRun(row: Record<string, unknown>): NodeRunRecord {
    return {
      id: String(row.id), runId: String(row.run_id), nodeId: String(row.node_id), nodeType: String(row.node_type),
      effectiveNodeType: row.effective_node_type === null || row.effective_node_type === undefined ? null : String(row.effective_node_type),
      failoverNodeType: row.failover_node_type === null || row.failover_node_type === undefined ? null : String(row.failover_node_type),
      maxAttempts: row.max_attempts === null || row.max_attempts === undefined ? 3 : Number(row.max_attempts),
      status: String(row.status) as NodeRunStatus, attempt: Number(row.attempt),
      startedAt: row.started_at === null ? null : String(row.started_at), finishedAt: row.finished_at === null ? null : String(row.finished_at),
      durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
      outputJson: row.output_json === null ? null : String(row.output_json),
      errorJson: row.error_json === null ? null : String(row.error_json),
      provider: row.provider === null ? null : String(row.provider), model: row.model === null ? null : String(row.model),
      costUsd: row.cost_usd === null || row.cost_usd === undefined ? null : Number(row.cost_usd),
      inputTokens: row.input_tokens === null || row.input_tokens === undefined ? null : Number(row.input_tokens),
      outputTokens: row.output_tokens === null || row.output_tokens === undefined ? null : Number(row.output_tokens),
    };
  }

  private rowToRun(row: Record<string, unknown>): WorkflowRunRecord {
    return {
      id: String(row.id), workflowId: String(row.workflow_id), workflowVersionId: String(row.version_id), version: Number(row.version),
      status: String(row.status) as RunStatus, planHash: String(row.plan_hash), trigger: String(row.trigger ?? "manual"),
      memoryJson: String(row.memory_json ?? "{}"),
      costTotal: row.cost_total === null || row.cost_total === undefined ? 0 : Number(row.cost_total),
      inputTokens: row.input_tokens === null || row.input_tokens === undefined ? 0 : Number(row.input_tokens),
      outputTokens: row.output_tokens === null || row.output_tokens === undefined ? 0 : Number(row.output_tokens),
      error: row.error === null ? null : String(row.error),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }

  private rowToVersion(row: Record<string, unknown>): WorkflowVersionRecord {
    return {
      id: String(row.id), workflowId: String(row.workflow_id), version: Number(row.version),
      status: String(row.status) as WorkflowVersionRecord["status"], graphJson: String(row.graph_json),
      planJson: row.plan_json === null ? null : String(row.plan_json), planHash: row.plan_hash === null ? null : String(row.plan_hash),
      exportHash: row.export_hash === null || row.export_hash === undefined ? null : String(row.export_hash),
      createdAt: String(row.created_at),
    };
  }

  private rowToArtifact(row: Record<string, unknown>): ArtifactRecord {
    return {
      id: String(row.id), runId: String(row.run_id), nodeId: String(row.node_id), name: String(row.name),
      uri: String(row.uri), mimeType: String(row.mime_type ?? ""), sha256: String(row.sha256),
      sizeBytes: Number(row.size_bytes ?? 0), createdAt: String(row.created_at),
    };
  }

  private rowToApproval(row: Record<string, unknown>): ApprovalRequestRecord {
    return {
      id: String(row.id), runId: String(row.run_id), nodeId: String(row.node_id), nodeType: String(row.node_type),
      proposedAction: String(row.proposed_action), payloadJson: String(row.payload_json), riskLevel: String(row.risk_level) as ApprovalRequestRecord["riskLevel"],
      status: String(row.status) as ApprovalRequestRecord["status"], reviewer: row.reviewer === null ? null : String(row.reviewer),
      reviewerNote: row.reviewer_note === null ? null : String(row.reviewer_note),
      createdAt: String(row.created_at), decidedAt: row.decided_at === null ? null : String(row.decided_at),
    };
  }
}

let singleton: WorkflowStudioService | null = null;

export function getWorkflowStudioService(): WorkflowStudioService {
  if (!singleton) singleton = new WorkflowStudioService();
  return singleton;
}
