// Phase 20.93 — Durable run engine: persistence + callbacks around the pure
// scheduler (catalog.advanceRunDeps).
//
// Owns run lifecycle persistence (start/pause/resume/cancel/retry), approval
// requests and decisions, artifact lineage (runtime-owned IO), typed events
// and the run memory checkpoint at every node boundary.
//
// All SQL is parameterized (? placeholders) per the repo DB convention.

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openAgentOsDb } from "../db";
import { evaluateCapability } from "../policy";
import {
  WorkflowStudioError,
  redactSecrets,
  type ArtifactRecord,
  type ApprovalRequestRecord,
  type NodeExecutionContext,
  type NodeRunRecord,
  type NodeRunStatus,
  type RunStatus,
  type WorkflowRunRecord,
  type WorkflowVersionRecord,
} from "./types";
import { compileOrThrow, type ExecutionPlan } from "./compiler";
export type { ExecutionPlan };
import { definitionFor } from "./catalog";
import type { WorkflowStudioService } from "./service";

function now(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return prefix + randomUUID().slice(0, 12);
}

function markNodeRunning(runId: string, nodeId: string, attempt: number): void {
  openAgentOsDb().run(
    "UPDATE wfs_node_runs SET status = 'RUNNING', attempt = ?, started_at = ? WHERE run_id = ? AND node_id = ?",
    [attempt, now(), runId, nodeId],
  );
}

function failNodeRunRow(runId: string, nodeId: string, attempt: number, errorJson: string): void {
  openAgentOsDb().run(
    "UPDATE wfs_node_runs SET status = 'FAILED', attempt = ?, finished_at = ?, error_json = ? WHERE run_id = ? AND node_id = ?",
    [attempt, now(), errorJson, runId, nodeId],
  );
}

function markRunRunning(runId: string): void {
  openAgentOsDb().run("UPDATE wfs_runs SET status = 'RUNNING', updated_at = ? WHERE id = ?", [now(), runId]);
}

function markRunFailed(runId: string, message: string): void {
  openAgentOsDb().run("UPDATE wfs_runs SET status = 'FAILED', error = ?, updated_at = ? WHERE id = ?", [redactSecrets(message), now(), runId]);
}

function markRunSucceeded(runId: string): void {
  openAgentOsDb().run("UPDATE wfs_runs SET status = 'SUCCEEDED', updated_at = ? WHERE id = ?", [now(), runId]);
}

/** Bind a node type to its registered handler (same pattern as nodes.ts). */
function nodeHandler(nodeType: string): (context: NodeExecutionContext) => Promise<Record<string, unknown>> {
  const definition = definitionFor(nodeType);
  return definition.execute.bind(definition);
}

export class WorkflowRunEngine {
  private service: WorkflowStudioService;
  private studioRoot: string;

  constructor(service: WorkflowStudioService, studioRoot: string) {
    this.service = service;
    this.studioRoot = studioRoot;
  }

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

  /** Advance a run via the pure scheduler (catalog.advanceRunDeps) with this
   * engine's persistence callbacks injected. */
  async advanceRun(runId: string, actor = "operator"): Promise<{ status: RunStatus; executed: string[]; paused: boolean }> {
    const { advanceRunDeps } = require("./catalog") as typeof import("./catalog");
    const run = this.requireRun(runId);
    const plan = JSON.parse(this.planJsonFor(run.workflowVersionId)) as ExecutionPlan;
    return await advanceRunDeps(
      {
        plan,
        listNodeRuns: (rid) => this.listNodeRuns(rid),
        nodeRun: (rid, nodeId) => this.nodeRun(rid, nodeId),
        markNodeRunning: (rid, nodeId, attempt) => markNodeRunning(rid, nodeId, attempt),
        completeNode: (rid, nodeId, attempt, output, durationMs) => this.completeNode(rid, nodeId, attempt, output, durationMs),
        failNode: (rid, nodeId, attempt, message, code) => failNodeRunRow(rid, nodeId, attempt, JSON.stringify({ error: redactSecrets(message), code })),
        markRunRunning: (rid) => markRunRunning(rid),
        markRunFailed: (rid, message) => markRunFailed(rid, message),
        markRunSucceeded: (rid) => markRunSucceeded(rid),
        event: (rid, nodeId, type, payload) => this.event(rid, nodeId, type, payload),
        runMemory: JSON.parse(run.memoryJson) as Record<string, unknown>,
        persistMemory: (rid, mem) => openAgentOsDb().run("UPDATE wfs_runs SET memory_json = ?, updated_at = ? WHERE id = ?", [JSON.stringify(mem), now(), rid]),
        invokeNode: async (nodeType, context) => nodeHandler(nodeType)(context),
        requestApproval: (rid, nodeId, nodeType, proposedAction, payload, riskLevel) => {
          this.requestApproval(rid, nodeId, nodeType, proposedAction, payload, riskLevel);
        },
        hasApprovalDecision: (memory, nodeId) => {
          for (const [k, v] of Object.entries(memory)) {
            if (k === `__approval_${nodeId}` && (v === "APPROVED" || v === "REJECTED")) return true;
          }
          return false;
        },
        actor,
        studioRoot: this.studioRoot,
        currentStatus: run.status,
      },
      runId,
    );
  }

  /** Compiled plan JSON for a workflow version (published versions only). */
  private planJsonFor(versionId: string): string {
    const row = openAgentOsDb().query("SELECT plan_json FROM wfs_versions WHERE id = ?").get(versionId) as { plan_json?: string | null } | undefined;
    if (!row?.plan_json) throw new WorkflowStudioError("VERSION_NOT_FOUND", 404, "workflow version has no compiled plan");
    return row.plan_json;
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

  /** Retry a failed node (attempt + 1) and continue the run from it. */
  async retryNode(runId: string, nodeId: string): Promise<{ status: RunStatus; executed: string[]; paused: boolean }> {
    const nodeRun = this.nodeRun(runId, nodeId);
    if (!nodeRun) throw new WorkflowStudioError("RUN_NOT_FOUND", 404, `node '${nodeId}' not found in run`);
    if (nodeRun.status !== "FAILED") throw new WorkflowStudioError("INVALID_TRANSITION", 409, `node is ${nodeRun.status} — only FAILED nodes retry`);
    openAgentOsDb().run("UPDATE wfs_node_runs SET status = 'PENDING', attempt = ?, error_json = NULL WHERE run_id = ? AND node_id = ?", [nodeRun.attempt + 1, runId, nodeId]);
    openAgentOsDb().run("UPDATE wfs_runs SET status = 'RUNNING', error = NULL, updated_at = ? WHERE id = ?", [now(), runId]);
    this.event(runId, nodeId, "node.retrying", { attempt: nodeRun.attempt + 1 });
    return await this.advanceRun(runId);
  }

  // -----------------------------------------------------------------------
  // Approvals (human gate)
  // -----------------------------------------------------------------------

  /** Intercept an approval node: create the request and pause the run. */
  requestApproval(runId: string, nodeId: string, nodeType: string, proposedAction: string, payload: unknown, riskLevel: string): ApprovalRequestRecord {
    const db = openAgentOsDb();
    const id = newId("wfsapr");
    const payloadJson = redactSecrets(JSON.stringify(payload ?? null));
    db.run(
      "INSERT INTO wfs_approvals (id, run_id, node_id, node_type, proposed_action, payload_json, risk_level, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)",
      [id, runId, nodeId, nodeType, proposedAction, payloadJson, riskLevel, now()],
    );
    db.run("UPDATE wfs_node_runs SET status = 'WAITING_FOR_APPROVAL' WHERE run_id = ? AND node_id = ?", [runId, nodeId]);
    db.run("UPDATE wfs_runs SET status = 'WAITING_FOR_APPROVAL', updated_at = ? WHERE id = ?", [now(), runId]);
    this.event(runId, nodeId, "approval.requested", { proposedAction, riskLevel });
    return this.getApproval(id);
  }

  decideApproval(approvalId: string, approve: boolean, reviewer: string, note?: string): ApprovalRequestRecord {
    const db = openAgentOsDb();
    const row = db.query("SELECT * FROM wfs_approvals WHERE id = ?").get(approvalId) as Record<string, unknown> | undefined;
    if (!row) throw new WorkflowStudioError("RUN_NOT_FOUND", 404, `approval '${approvalId}' not found`);
    if (String(row.status) !== "PENDING") throw new WorkflowStudioError("APPROVAL_NOT_PENDING", 409, "approval already decided");
    const status = approve ? "APPROVED" : "REJECTED";
    db.run("UPDATE wfs_approvals SET status = ?, reviewer = ?, reviewer_note = ?, decided_at = ? WHERE id = ?", [status, reviewer, note ?? null, now(), approvalId]);
    const runId = String(row.run_id);
    const nodeId = String(row.node_id);
    // Decision flows into run memory; the approval node resolves on next advance.
    const run = this.requireRun(runId);
    const memory = JSON.parse(run.memoryJson) as Record<string, unknown>;
    memory[`__approval_${nodeId}`] = status;
    db.run("UPDATE wfs_runs SET memory_json = ?, status = 'RUNNING', updated_at = ? WHERE id = ?", [JSON.stringify(memory), now(), runId]);
    this.event(runId, nodeId, approve ? "approval.approved" : "approval.rejected", { reviewer });
    return this.getApproval(approvalId);
  }

  listPendingApprovals(): ApprovalRequestRecord[] {
    return (openAgentOsDb().query("SELECT * FROM wfs_approvals WHERE status = 'PENDING' ORDER BY created_at").all() as Array<Record<string, unknown>>).map((r) => this.rowToApproval(r));
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private completeNode(runId: string, nodeId: string, attempt: number, output: Record<string, unknown>, durationMs: number): void {
    const serialized = redactSecrets(JSON.stringify(output));
    completeNodeRunRowSql(runId, nodeId, attempt, durationMs, serialized);
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
      completeNodeRunRowSql(runId, nodeId, attempt, durationMs, updated);
    }
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

  private getApproval(approvalId: string): ApprovalRequestRecord {
    const row = openAgentOsDb().query("SELECT * FROM wfs_approvals WHERE id = ?").get(approvalId) as Record<string, unknown> | undefined;
    if (!row) throw new WorkflowStudioError("RUN_NOT_FOUND", 404, `approval '${approvalId}' not found`);
    return this.rowToApproval(row);
  }

  private requireRun(runId: string): WorkflowRunRecord {
    const run = this.getRun(runId);
    if (!run) throw new WorkflowStudioError("RUN_NOT_FOUND", 404, `run '${runId}' not found`);
    return run;
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
      status: String(row.status) as NodeRunStatus, attempt: Number(row.attempt),
      startedAt: row.started_at === null ? null : String(row.started_at), finishedAt: row.finished_at === null ? null : String(row.finished_at),
      durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
      outputJson: row.output_json === null ? null : String(row.output_json),
      errorJson: row.error_json === null ? null : String(row.error_json),
      provider: row.provider === null ? null : String(row.provider), model: row.model === null ? null : String(row.model),
    };
  }

  private rowToRun(row: Record<string, unknown>): WorkflowRunRecord {
    return {
      id: String(row.id), workflowId: String(row.workflow_id), workflowVersionId: String(row.version_id), version: Number(row.version),
      status: String(row.status) as RunStatus, planHash: String(row.plan_hash), trigger: String(row.trigger ?? "manual"),
      memoryJson: String(row.memory_json ?? "{}"), error: row.error === null ? null : String(row.error),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }

  private rowToVersion(row: Record<string, unknown>): WorkflowVersionRecord {
    return {
      id: String(row.id), workflowId: String(row.workflow_id), version: Number(row.version),
      status: String(row.status) as WorkflowVersionRecord["status"], graphJson: String(row.graph_json),
      planJson: row.plan_json === null ? null : String(row.plan_json), planHash: row.plan_hash === null ? null : String(row.plan_hash),
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

function completeNodeRunRowSql(runId: string, nodeId: string, attempt: number, durationMs: number, outputJson: string): void {
  openAgentOsDb().run(
    "UPDATE wfs_node_runs SET status = 'SUCCEEDED', attempt = ?, finished_at = ?, duration_ms = ?, output_json = ? WHERE run_id = ? AND node_id = ?",
    [attempt, now(), durationMs, outputJson, runId, nodeId],
  );
}

let singleton: WorkflowRunEngine | null = null;

export function getWorkflowRunEngine(service: WorkflowStudioService, studioRoot?: string): WorkflowRunEngine {
  if (!singleton) {
    singleton = new WorkflowRunEngine(service, studioRoot ?? join(process.cwd(), "runtime", "workflow-studio"));
  }
  return singleton;
}
