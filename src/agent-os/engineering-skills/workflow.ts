// Phase 20.91b — Engineering Skill Runtime: durable Workflow State Machine.
//
// Canonical lifecycle (source §9): INTAKE → DEFINE → PLAN → BUILD → VERIFY →
// REVIEW → READY_TO_SHIP → SHIP → OBSERVE → DONE, plus exceptional states.
// Every transition is evidence-gated: an agent's claim moves nothing — the
// gate consults runtime-captured evidence only. Transitions are transactional
// and audited; invalid ones fail with the missing gate, never a generic error.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import { getEvidenceCollector, type EvidenceRecord } from "./evidence";
import { getReviewerCouncil, requiredReviewLanes, type ReviewFinding } from "./review";
import { getSkillRouter } from "./router";
import { recordPolicyDecision } from "./policy";
import type { EngineeringSkillsAuditEvent, RiskLevel, SkipRequestReply, WorkflowStatus } from "./types";

const CANONICAL_ORDER: WorkflowStatus[] = ["INTAKE", "DEFINE", "PLAN", "BUILD", "VERIFY", "REVIEW", "READY_TO_SHIP", "SHIP", "OBSERVE", "DONE"];

/** Evidence each stage exit requires before the transition is granted (source §9.1). */
const STAGE_EXIT_EVIDENCE: Partial<Record<WorkflowStatus, { types: Array<EvidenceRecord["type"]>; label: string }>> = {
  DEFINE: { types: ["artifact_exists"], label: "spec artifact with objective/scope/non-goals/acceptance criteria" },
  PLAN: { types: ["artifact_exists"], label: "plan artifact with atomic ordered tasks and rollback strategy" },
  BUILD: { types: ["diff"], label: "changed-files record (diff evidence from runtime)" },
  VERIFY: { types: ["test_result"], label: "test command executed with captured exit code 0" },
};

export interface WorkflowRecord {
  id: string;
  taskId: string | null;
  title: string;
  taskText: string;
  status: WorkflowStatus;
  currentStage: WorkflowStatus;
  provider: string | null;
  model: string | null;
  risk: RiskLevel;
  route: { intent: string; selected: string[]; rejected: string[]; stagesCovered: string[] };
  stopReason: string | null;
  rollbackTarget: string | null;
  startedAt: string;
  completedAt: string | null;
  updatedAt: string;
}

export interface TransitionResult {
  workflow: WorkflowRecord;
  transitioned: boolean;
  missingGate: { types: EvidenceRecord["type"][]; label: string } | null;
  reason: string;
}

export class WorkflowEngine {
  startWorkflow(input: { taskText: string; title?: string; taskId?: string; provider?: string; model?: string; actor?: string }): WorkflowRecord {
    const router = getSkillRouter();
    const route = router.routeTask(input.taskText, { provider: input.provider });
    const id = `eskw_${randomUUID().slice(0, 16)}`;
    const now = new Date().toISOString();
    const db = openAgentOsDb();
    db.run(
      "INSERT INTO esk_workflows (id, task_id, title, task_text, status, current_stage, provider, model, route_json, risk_level, stop_reason, rollback_target, started_at, completed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, input.taskId ?? null, input.title ?? input.taskText.slice(0, 80), input.taskText, "INTAKE", "INTAKE", input.provider ?? null, input.model ?? null, JSON.stringify(route.explanation), route.risk.risk, null, null, now, null, now],
    );
    this.audit("workflow.started", input.actor ?? "operator", id, { intent: route.intent, risk: route.risk.risk, skills: route.skills.map((s) => s.slug) });
    recordPolicyDecision({ workflowId: id, policyId: "workflow.start", action: "start_workflow", decision: "ALLOW", reason: `route '${route.intent}' risk '${route.risk.risk}' gate '${route.risk.gate}'` });
    return this.getWorkflow(id)!;
  }

  getWorkflow(id: string): WorkflowRecord | null {
    const db = openAgentOsDb();
    const row = db.query("SELECT * FROM esk_workflows WHERE id = ? LIMIT 1").get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    const explanation = JSON.parse(String(row.route_json)) as { intent: string; selected: Array<{ slug: string }>; rejected: Array<{ slug: string }>; stagesCovered: string[] };
    return {
      id: String(row.id),
      taskId: row.task_id === null ? null : String(row.task_id),
      title: String(row.title),
      taskText: String(row.task_text),
      status: String(row.status) as WorkflowStatus,
      currentStage: String(row.current_stage) as WorkflowStatus,
      provider: row.provider === null ? null : String(row.provider),
      model: row.model === null ? null : String(row.model),
      risk: String(row.risk_level) as RiskLevel,
      route: {
        intent: explanation.intent,
        selected: explanation.selected.map((s) => s.slug),
        rejected: explanation.rejected.map((s) => s.slug),
        stagesCovered: explanation.stagesCovered,
      },
      stopReason: row.stop_reason === null ? null : String(row.stop_reason),
      rollbackTarget: row.rollback_target === null ? null : String(row.rollback_target),
      startedAt: String(row.started_at),
      completedAt: row.completed_at === null ? null : String(row.completed_at),
      updatedAt: String(row.updated_at),
    };
  }

  listWorkflows(filter?: { status?: string }): WorkflowRecord[] {
    const db = openAgentOsDb();
    const rows = db.query("SELECT id FROM esk_workflows ORDER BY started_at DESC").all() as Array<{ id: string }>;
    const records = rows.map((r) => this.getWorkflow(r.id)!);
    return filter?.status ? records.filter((w) => w.status === filter.status) : records;
  }

  /**
   * Attempt to advance the workflow out of its current stage. The gate is
   * evidence-based; when unmet, the transition is refused WITH the missing
   * gate (source §13.2) — the caller can show the agent exactly what to run.
   */
  advance(workflowId: string, actor = "operator"): TransitionResult {
    const workflow = this.getWorkflow(workflowId);
    if (!workflow) throw new Error(`workflow '${workflowId}' not found`);
    const terminal: WorkflowStatus[] = ["DONE", "CANCELLED", "FAILED_VERIFICATION", "FAILED_REVIEW"];
    if (terminal.includes(workflow.status)) {
      return { workflow, transitioned: false, missingGate: null, reason: `workflow is terminal (${workflow.status})` };
    }

    // Interrupt states resume to their canonical stage first.
    if (["BLOCKED", "NEEDS_HUMAN", "ROLLBACK_REQUIRED"].includes(workflow.status)) {
      return { workflow, transitioned: false, missingGate: null, reason: `workflow is ${workflow.status} — resolve the stop condition before advancing` };
    }

    const evidence = getEvidenceCollector();
    const council = getReviewerCouncil();

    // REVIEW exit: required lanes submitted, zero unresolved blocking findings.
    if (workflow.status === "REVIEW") {
      const lanes = requiredReviewLanes(workflow.risk, [workflow.taskText]);
      const held = new Set(evidence.list(workflowId).filter((e) => e.type === "review_verdict" && e.verified).map((e) => e.producer));
      const missingLanes = lanes.filter((lane) => !held.has(`reviewer:${lane}`));
      if (missingLanes.length > 0) {
        return { workflow, transitioned: false, missingGate: null, reason: `REVIEW exit requires verdicts from: ${missingLanes.join(", ")}` };
      }
      if (council.hasUnresolvedBlocking(workflowId)) {
        const next = this.setStatus(workflowId, "FAILED_REVIEW", "unresolved blocking review finding");
        return { workflow: next, transitioned: true, missingGate: null, reason: "blocking finding unresolved → FAILED_REVIEW" };
      }
      return { workflow: this.setStatus(workflowId, "READY_TO_SHIP", "review complete, no blocking findings"), transitioned: true, missingGate: null, reason: "review gate satisfied" };
    }

    // READY_TO_SHIP exit: human approval recorded via approveShip (evidence type
    // deployment_result/health_check absent) — the approval itself is the gate.
    if (workflow.status === "READY_TO_SHIP") {
      return { workflow, transitioned: false, missingGate: null, reason: "ship requires explicit approval (approveShip) — deploy is never implicit" };
    }

    const gate = STAGE_EXIT_EVIDENCE[workflow.status];
    if (!gate) {
      // INTAKE → DEFINE is unconditional; OBSERVE → DONE is unconditional.
      const next = this.nextCanonical(workflow.status);
      if (!next) return { workflow, transitioned: false, missingGate: null, reason: "no further canonical stage" };
      return { workflow: this.setStatus(workflowId, next, "canonical advance"), transitioned: true, missingGate: null, reason: `advanced to ${next}` };
    }

    const check = evidence.hasVerifiedEvidence(workflowId, gate.types);
    if (!check.satisfied) {
      // Fake "tests passed" without evidence lands here (source test G).
      const extra: string[] = [];
      if (workflow.status === "VERIFY") {
        const testRows = evidence.list(workflowId).filter((e) => e.type === "test_result");
        if (testRows.length > 0 && testRows.every((e) => !e.verified)) extra.push(" (a test_result claim exists but carries no runtime exit code — model text is not evidence)");
      }
      return { workflow, transitioned: false, missingGate: { types: check.missing, label: gate.label }, reason: `${workflow.status} exit requires ${gate.label}${extra.join()}` };
    }
    if (workflow.status === "VERIFY") {
      const failedTests = evidence.list(workflowId).some((e) => e.type === "test_result" && e.verified && e.exitCode !== 0);
      if (failedTests) {
        const next = this.setStatus(workflowId, "FAILED_VERIFICATION", "captured test exit code non-zero");
        return { workflow: next, transitioned: true, missingGate: null, reason: "tests failed → FAILED_VERIFICATION" };
      }
    }
    const next = this.nextCanonical(workflow.status);
    if (!next) return { workflow, transitioned: false, missingGate: null, reason: "no further canonical stage" };
    return { workflow: this.setStatus(workflowId, next, `evidence gate satisfied: ${gate.label}`), transitioned: true, missingGate: null, reason: `advanced to ${next}` };
  }

  /**
   * Human ship approval (source §9.1 READY_TO_SHIP→SHIP): policy approval +
   * recorded rollback target. Critical/high risk always requires this explicit
   * call — the transition is never implicit, and deploy execution itself stays
   * outside the runtime (R4; only the gate is modeled here).
   */
  approveShip(workflowId: string, approver: string, rollbackTarget: string): TransitionResult {
    const workflow = this.getWorkflow(workflowId);
    if (!workflow) throw new Error(`workflow '${workflowId}' not found`);
    if (workflow.status !== "READY_TO_SHIP") {
      throw new Error(`workflow is ${workflow.status} — approveShip is only valid from READY_TO_SHIP`);
    }
    if (!rollbackTarget) {
      throw new Error("rollback target must be recorded before ship (source §9.1)");
    }
    const db = openAgentOsDb();
    const now = new Date().toISOString();
    db.run("UPDATE esk_workflows SET rollback_target = ?, stop_reason = NULL, updated_at = ? WHERE id = ?", [rollbackTarget, now, workflowId]);
    getEvidenceCollector().record({
      workflowId,
      type: "health_check",
      producer: `approver:${approver}`,
      command: "workflow.approveShip",
      exitCode: 0,
      metadata: { approver, rollbackTarget, risk: workflow.risk },
    });
    recordPolicyDecision({ workflowId, policyId: "ship.approval", action: "approve_ship", decision: "ALLOW", reason: `human approval by ${approver}; rollback target recorded` });
    this.audit("approval.granted", approver, workflowId, { rollbackTarget });
    const next = this.setStatus(workflowId, "SHIP", `approved by ${approver}`);
    return { workflow: next, transitioned: true, missingGate: null, reason: "ship approved; rollback target recorded" };
  }

  cancel(workflowId: string, reason: string, actor = "operator"): WorkflowRecord {
    return this.setStatus(workflowId, "CANCELLED", reason);
  }

  /** Anti-rationalization enforcement (source §13): skip attempts are denied with the missing gate. */
  requestSkip(workflowId: string, step: string, reason: string): SkipRequestReply {
    const required: SkipRequestReply["required_evidence"] = step === "verify" ? ["test_result"] : step === "review" ? ["review_verdict"] : ["artifact_exists"];
    const message = reason.toLowerCase().includes("small") && step === "verify"
      ? "size of the change does not waive verification — run the tests and record the exit code"
      : `step '${step}' cannot be skipped — required evidence: ${required.join(", ")}`;
    recordPolicyDecision({ workflowId, policyId: "anti_rationalization", action: `skip:${step}`, decision: "DENY", reason: `${reason} → ${message}` });
    this.audit("workflow.step.blocked", "runtime", workflowId, { step, reason });
    return { event: "workflow_step_skip_requested", step, reason, policy_decision: "deny", required_evidence: required, message };
  }

  private nextCanonical(status: WorkflowStatus): WorkflowStatus | null {
    const idx = CANONICAL_ORDER.indexOf(status);
    if (idx < 0 || idx >= CANONICAL_ORDER.length - 1) return null;
    return CANONICAL_ORDER[idx + 1]!;
  }

  private setStatus(workflowId: string, status: WorkflowStatus, reason: string): WorkflowRecord {
    const db = openAgentOsDb();
    const now = new Date().toISOString();
    const completed = status === "DONE" ? now : null;
    db.run("UPDATE esk_workflows SET status = ?, current_stage = ?, stop_reason = ?, completed_at = COALESCE(?, completed_at), updated_at = ? WHERE id = ?", [status, status, reason, completed, now, workflowId]);
    if (["DONE", "CANCELLED", "FAILED_VERIFICATION", "FAILED_REVIEW"].includes(status)) {
      this.audit(status === "DONE" ? "ship.completed" : "ship.failed", "runtime", workflowId, { status, reason });
    }
    return this.getWorkflow(workflowId)!;
  }

  private audit(event: EngineeringSkillsAuditEvent, actor: string, workflowId: string, details: Record<string, unknown>): void {
    try {
      const db = openAgentOsDb();
      db.run(
        "INSERT INTO esk_audit (id, event_type, actor, pack_id, skill_id, workflow_id, operation, result, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [`eska_${randomUUID().slice(0, 16)}`, event, actor, null, null, workflowId, event, "ok", JSON.stringify(details), new Date().toISOString()],
      );
    } catch {
      // Same best-effort contract as the registry audit sink.
    }
  }
}

let singleton: WorkflowEngine | null = null;

export function getWorkflowEngine(): WorkflowEngine {
  if (!singleton) singleton = new WorkflowEngine();
  return singleton;
}

export type { ReviewFinding };
