// Phase 20.94 — canonical run orchestrator.
// ASK -> PLAN -> EXECUTE -> VERIFY -> LEARN, with policy, budget, and audit.

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openAgentOsDb } from "../db";
import { getMcpToolGateway } from "../mcp-gateway/gateway";
import { redactBrokerText } from "./broker";
import { applyCodingEdits, createCodingSession, reviewCodingSession, testCodingSession, type CodingSession } from "./coding";
import { composeSkills } from "./composer";
import { draftAgent } from "./factory";
import { classifyIntent } from "./intent";
import { distillLessons, searchLessons } from "./memory";
import { routeModel } from "./models";
import { decidePolicy } from "./policy-plane";
import { evidenceHash, runResearch } from "./research";
import {
  EnzoWorkspaceError,
  defaultBudget,
  emptyUsage,
  redactJson,
  type AgentBlueprint,
  type ArtifactRecord,
  type ApprovalRecord,
  type Budget,
  type PolicyProfile,
  type RunMode,
  type RunStatus,
  type SkillCompositionPlan,
  type WorkspaceRun,
} from "./types";

function now(): string {
  return new Date().toISOString();
}
function newId(prefix: string): string {
  return prefix + randomUUID().replace(/-/g, "").slice(0, 12);
}

export interface CreateRunInput {
  request: string;
  mode?: RunMode;
  actor?: string;
  profile?: PolicyProfile;
  budget?: Partial<Budget>;
  workspaceRoot?: string;
}

export interface RunInspection {
  run: WorkspaceRun;
  events: Array<{ seq: number; type: string; actor: string; payload: Record<string, unknown>; createdAt: string }>;
  artifacts: ArtifactRecord[];
  approvals: ApprovalRecord[];
  agent?: AgentBlueprint | null;
  skills?: SkillCompositionPlan | null;
  research?: Record<string, unknown> | null;
  coding?: CodingSession | null;
  lessons?: Array<{ id: string; statement: string; status: string; confidence: number }>;
}

export class EnzoOrchestrator {
  constructor(private readonly studioRoot = join(process.cwd(), "runtime", "enzo-workspace")) {
    mkdirSync(this.studioRoot, { recursive: true });
  }

  createRun(input: CreateRunInput): WorkspaceRun {
    const intent = classifyIntent(input.request);
    const mode = input.mode && input.mode !== "auto" ? input.mode : intent.mode;
    const id = newId("run");
    const createdAt = now();
    const budget = defaultBudget(input.budget ?? {});
    const run: WorkspaceRun = {
      id,
      mode,
      status: "CREATED",
      requestText: input.request,
      agentId: null,
      policyProfile: input.profile ?? "safe-personal",
      budget,
      usage: emptyUsage(),
      plan: { intent },
      startedAt: null,
      completedAt: null,
      createdAt,
      error: null,
    };
    this.insertRun(run);
    this.event(id, "run.created", input.actor ?? "operator", { mode, risk: intent.risk });
    return run;
  }

  async executeRun(runId: string, actor = "operator", opts?: { workspaceRoot?: string }): Promise<RunInspection> {
    const run = this.requireRun(runId);
    if (run.status !== "CREATED" && run.status !== "PLANNING") {
      throw new EnzoWorkspaceError("INVALID_TRANSITION", 409, "run is not executable from " + run.status);
    }
    this.setStatus(runId, "PLANNING", { startedAt: now() });
    this.event(runId, "run.planned", actor, { mode: run.mode });

    const intent = classifyIntent(run.requestText);
    const draft = draftAgent(run.requestText);
    this.saveAgent(draft.blueprint, actor);
    this.event(runId, "agent.drafted", actor, { slug: draft.blueprint.slug, version: draft.blueprint.version, passes: 2 });

    const lessons = searchLessons(run.requestText, draft.blueprint.slug);
    this.event(runId, "memory.read", actor, { count: lessons.length, ids: lessons.map((l) => l.id) });

    const skills = composeSkills(intent);
    this.event(runId, "skill.resolved", actor, skills);

    const model = routeModel({
      requirements: draft.blueprint.modelPolicy.requiredCapabilities,
      tools: true,
      structuredOutput: true,
      localOnly: draft.blueprint.modelPolicy.localOnly,
      maxCostUsd: draft.blueprint.modelPolicy.maxCostUsd,
    });
    this.event(runId, "model.candidate_selected", actor, model);

    const policy = decidePolicy({ runId, action: run.mode + ".execute", profile: run.policyProfile });
    this.persistPolicy(policy);
    this.event(runId, "policy.checked", actor, policy);

    if (policy.decision === "deny") {
      this.fail(runId, policy.reason);
      return this.inspect(runId);
    }
    if (policy.decision === "require_approval") {
      this.requestApproval(runId, policy.action, policy.risk, { request: run.requestText });
      this.setStatus(runId, "WAITING_FOR_APPROVAL");
      this.event(runId, "approval.requested", actor, { action: policy.action, risk: policy.risk });
      return this.inspect(runId);
    }

    this.setStatus(runId, "RUNNING");
    openAgentOsDb().run("UPDATE enzo_runs SET agent_id = ?, plan_json = ? WHERE id = ?", [
      draft.blueprint.id,
      JSON.stringify({ intent, analysis: draft.analysis, blueprint: draft.blueprint, skills, model }),
      runId,
    ]);

    try {
      if (run.mode === "research" || run.mode === "agent" || intent.domains.includes("adobe-stock")) {
        await this.runResearchSlice(runId, actor, draft.blueprint);
      }
      if (run.mode === "coding") {
        this.runCodingSlice(runId, actor, opts?.workspaceRoot);
      }
      if (this.requireRun(runId).status === "WAITING_FOR_APPROVAL") {
        return this.inspect(runId);
      }
      if (run.mode === "chat") {
        this.writeArtifact(runId, "chat", "response.md", "# Chat\n\n" + run.requestText + "\n\nRouted model: " + model.actualId + "\n");
      }

      this.setStatus(runId, "VERIFYING");
      const outcome = "success";
      const inspection = this.inspect(runId);
      const evidenceRefs = inspection.artifacts.map((a) => a.sha256);
      const distilled = distillLessons({
        runId,
        agentSlug: draft.blueprint.slug,
        domain: draft.analysis.domain,
        outcome,
        statements: lessonStatements(run, inspection),
        evidenceRefs,
      });
      this.event(runId, "memory.candidate_created", actor, { count: distilled.length, ids: distilled.map((l) => l.id) });
      this.setStatus(runId, "COMPLETED", { completedAt: now() });
      this.event(runId, "run.completed", actor, { model: model.actualId, skills: skills.selected.map((s) => s.id) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.fail(runId, redactBrokerText(message));
    }
    return this.inspect(runId);
  }

  cancel(runId: string, actor = "operator"): WorkspaceRun {
    const run = this.requireRun(runId);
    if (run.status === "COMPLETED" || run.status === "FAILED" || run.status === "CANCELLED") {
      throw new EnzoWorkspaceError("INVALID_TRANSITION", 409, "cannot cancel " + run.status);
    }
    this.setStatus(runId, "CANCELLED", { completedAt: now() });
    this.event(runId, "run.cancelled", actor, {});
    return this.requireRun(runId);
  }

  async replay(runId: string, mode: "inspect-only" | "re-run-same-plan", actor = "operator"): Promise<RunInspection> {
    const original = this.inspect(runId);
    if (mode === "inspect-only") return original;
    const policy = decidePolicy({
      runId,
      action: original.run.mode + ".replay",
      profile: original.run.policyProfile,
      replay: true,
      irreversible: original.approvals.some((a) => a.riskLevel === "R3" || a.riskLevel === "R4"),
    });
    if (policy.decision === "require_approval" || policy.decision === "deny") {
      throw new EnzoWorkspaceError("REPLAY_BLOCKED", 409, policy.reason, { policy });
    }
    const created = this.createRun({
      request: original.run.requestText,
      mode: original.run.mode,
      actor,
      profile: original.run.policyProfile,
      budget: original.run.budget,
    });
    this.event(created.id, "run.replayed", actor, { from: runId, mode });
    return this.executeRun(created.id, actor);
  }

  async decideApproval(approvalId: string, approve: boolean, actor: string, note?: string): Promise<RunInspection> {
    const row = openAgentOsDb().query("SELECT * FROM enzo_approvals WHERE id = ?").get(approvalId) as Record<string, unknown> | undefined;
    if (!row) throw new EnzoWorkspaceError("APPROVAL_NOT_FOUND", 404, "approval not found");
    if (String(row.status) !== "PENDING") throw new EnzoWorkspaceError("APPROVAL_NOT_PENDING", 409, "approval is " + String(row.status));
    const status = approve ? "APPROVED" : "DENIED";
    openAgentOsDb().run(
      "UPDATE enzo_approvals SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ?",
      [status, actor, now(), approvalId],
    );
    const runId = String(row.run_id);
    this.event(runId, "approval.resolved", actor, { approvalId, status, note: note ?? null });
    if (!approve) {
      this.fail(runId, "approval denied");
      return this.inspect(runId);
    }
    const run = this.requireRun(runId);
    if (run.status === "WAITING_FOR_APPROVAL") {
      return this.resumeAfterApproval(runId, actor);
    }
    return this.inspect(runId);
  }

  inspect(runId: string): RunInspection {
    const run = this.requireRun(runId);
    const db = openAgentOsDb();
    const events = (db.query("SELECT seq, event_type, actor, payload_json, created_at FROM enzo_run_events WHERE run_id = ? ORDER BY seq").all(runId) as Record<string, unknown>[]).map((row) => ({
      seq: Number(row.seq),
      type: String(row.event_type),
      actor: String(row.actor),
      payload: JSON.parse(String(row.payload_json ?? "{}")) as Record<string, unknown>,
      createdAt: String(row.created_at),
    }));
    const artifacts = (db.query("SELECT * FROM enzo_artifacts WHERE run_id = ?").all(runId) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      runId,
      type: String(row.type),
      name: String(row.name),
      uri: String(row.uri),
      sha256: String(row.sha256),
      metadata: JSON.parse(String(row.metadata_json ?? "{}")) as Record<string, unknown>,
      createdAt: String(row.created_at),
    }));
    const approvals = (db.query("SELECT * FROM enzo_approvals WHERE run_id = ?").all(runId) as Record<string, unknown>[]).map(rowToApproval);
    const lessons = (db.query("SELECT id, statement, status, confidence FROM enzo_lessons WHERE run_refs_json LIKE ?").all("%" + runId + "%") as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      statement: String(row.statement),
      status: String(row.status),
      confidence: Number(row.confidence),
    }));
    const plan = run.plan as Record<string, unknown>;
    return {
      run,
      events,
      artifacts,
      approvals,
      agent: (plan.blueprint as AgentBlueprint) ?? null,
      skills: (plan.skills as SkillCompositionPlan) ?? null,
      research: (plan.research as Record<string, unknown>) ?? null,
      coding: (plan.coding as CodingSession) ?? null,
      lessons,
    };
  }

  listRuns(limit = 50): WorkspaceRun[] {
    const rows = openAgentOsDb().query("SELECT * FROM enzo_runs ORDER BY created_at DESC LIMIT ?").all(limit) as Record<string, unknown>[];
    return rows.map((row) => this.rowToRun(row));
  }

  listApprovals(status = "PENDING"): ApprovalRecord[] {
    const rows = openAgentOsDb().query("SELECT * FROM enzo_approvals WHERE status = ? ORDER BY created_at DESC").all(status) as Record<string, unknown>[];
    return rows.map(rowToApproval);
  }

  async invokeTool(input: {
    runId: string;
    toolName: string;
    args: Record<string, unknown>;
    actor: string;
    workspacePath: string;
    approved?: boolean;
  }): Promise<Record<string, unknown>> {
    const policy = decidePolicy({
      runId: input.runId,
      action: "mcp." + input.toolName,
      profile: this.requireRun(input.runId).policyProfile,
    });
    this.persistPolicy(policy);
    this.event(input.runId, "policy.checked", input.actor, policy);
    if (policy.decision === "deny") throw new EnzoWorkspaceError("TOOL_DENIED", 403, policy.reason, { policy });
    if (policy.decision === "require_approval" && !input.approved) {
      this.requestApproval(input.runId, "mcp." + input.toolName, policy.risk, { toolName: input.toolName, args: redactJson(input.args) as Record<string, unknown> });
      return { ok: false, status: "awaiting_approval", policy };
    }
    const gw = getMcpToolGateway();
    const result = await gw.execute({
      requestId: newId("mcp"),
      toolName: input.toolName,
      actorId: input.actor,
      workspacePath: input.workspacePath,
      arguments: input.args,
      humanApproved: Boolean(input.approved) || policy.decision === "allow" || policy.decision === "allow_with_restrictions",
    });
    this.addUsage(input.runId, { toolCalls: 1 });
    this.event(input.runId, "tool.called", input.actor, { toolName: input.toolName, args: redactJson(input.args) });
    this.event(input.runId, "tool.completed", input.actor, { toolName: input.toolName, status: result.status, policyDecision: result.policyDecision });
    return result as unknown as Record<string, unknown>;
  }

  private async runResearchSlice(runId: string, actor: string, blueprint: AgentBlueprint): Promise<void> {
    const run = this.requireRun(runId);
    const result = await runResearch({ question: run.requestText, budget: blueprint.executionBudget });
    this.addUsage(runId, result.usage);
    const uri = this.writeArtifact(runId, "research", "research.md", result.synthesis);
    const plan = run.plan;
    plan.research = { ...result, synthesisHash: evidenceHash(result), artifact: uri };
    openAgentOsDb().run("UPDATE enzo_runs SET plan_json = ? WHERE id = ?", [JSON.stringify(plan), runId]);
    this.event(runId, "research.completed", actor, {
      queries: result.queries.length,
      sources: result.sources.map((s) => s.sourceId),
      stopReason: result.stopReason,
      status: result.status,
    });
  }

  private runCodingSlice(runId: string, actor: string, workspaceRoot?: string): void {
    const root = workspaceRoot ?? join(this.studioRoot, "sandboxes", runId);
    mkdirSync(root, { recursive: true });
    const run = this.requireRun(runId);
    let session = createCodingSession({ id: newId("code"), runId, workspaceRoot: root, request: run.requestText });
    this.event(runId, "coding.planned", actor, { plan: session.plan, root });
    const target = join("README.md");
    session = applyCodingEdits(session, [{ path: target, content: "# Change\n\n" + run.requestText.slice(0, 400) + "\n" }], {
      profile: run.policyProfile,
    });
    if (session.status === "awaiting_approval") {
      this.requestApproval(runId, "code.apply.source", "R2", { files: ["README.md"] });
      this.setStatus(runId, "WAITING_FOR_APPROVAL");
      const plan = run.plan;
      plan.coding = session;
      openAgentOsDb().run("UPDATE enzo_runs SET plan_json = ? WHERE id = ?", [JSON.stringify(plan), runId]);
      this.event(runId, "approval.requested", actor, { action: "code.apply.source" });
      return;
    }
    session = testCodingSession(session);
    session = reviewCodingSession(session);
    const plan = this.requireRun(runId).plan;
    plan.coding = session;
    openAgentOsDb().run("UPDATE enzo_runs SET plan_json = ? WHERE id = ?", [JSON.stringify(plan), runId]);
    this.writeArtifact(runId, "diff", "coding.diff", session.diff || "(no diff)");
    this.event(runId, "coding.completed", actor, { files: session.changedFiles, review: session.review });
  }

  private async resumeAfterApproval(runId: string, actor: string): Promise<RunInspection> {
    const run = this.requireRun(runId);
    const coding = run.plan.coding as CodingSession | undefined;
    if (coding && coding.status === "awaiting_approval") {
      const session = applyCodingEdits(coding, [{ path: "README.md", content: "# Change\n\n" + run.requestText.slice(0, 400) + "\n" }], {
        profile: run.policyProfile,
        approved: true,
      });
      const tested = reviewCodingSession(testCodingSession(session));
      const plan = run.plan;
      plan.coding = tested;
      openAgentOsDb().run("UPDATE enzo_runs SET plan_json = ? WHERE id = ?", [JSON.stringify(plan), runId]);
      this.writeArtifact(runId, "diff", "coding.diff", tested.diff || "(no diff)");
      this.setStatus(runId, "COMPLETED", { completedAt: now() });
      this.event(runId, "run.completed", actor, { resumed: true });
      return this.inspect(runId);
    }
    this.setStatus(runId, "CREATED");
    return await this.executeRun(runId, actor);
  }

  private saveAgent(blueprint: AgentBlueprint, actor: string): void {
    const db = openAgentOsDb();
    const existing = db.query("SELECT version FROM enzo_agents WHERE slug = ? ORDER BY version DESC LIMIT 1").get(blueprint.slug) as { version: number } | undefined;
    const version = existing ? Number(existing.version) + 1 : 1;
    blueprint.version = version;
    db.run(
      "INSERT INTO enzo_agents (id, slug, version, name, blueprint_json, status, drafted_by, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)",
      [blueprint.id + "-v" + version, blueprint.slug, version, blueprint.name, JSON.stringify(blueprint), blueprint.draftedBy, actor, now()],
    );
  }

  private requestApproval(runId: string, action: string, risk: string, payload: Record<string, unknown>): string {
    const id = newId("appr");
    openAgentOsDb().run(
      "INSERT INTO enzo_approvals (id, run_id, action_type, risk_level, request_payload_json, status, resolved_by, resolved_at, created_at, expires_at) VALUES (?, ?, ?, ?, ?, 'PENDING', NULL, NULL, ?, NULL)",
      [id, runId, action, risk, JSON.stringify(redactJson(payload)), now()],
    );
    return id;
  }

  private persistPolicy(decision: ReturnType<typeof decidePolicy>): void {
    openAgentOsDb().run(
      "INSERT INTO enzo_policy_decisions (id, run_id, action, risk, decision, rules_json, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [decision.decisionId, decision.runId, decision.action, decision.risk, decision.decision, JSON.stringify(decision.rulesMatched), decision.reason, now()],
    );
  }

  private writeArtifact(runId: string, type: string, name: string, content: string): string {
    const dir = join(this.studioRoot, "artifacts", runId);
    mkdirSync(dir, { recursive: true });
    const uri = join(dir, name);
    const body = redactBrokerText(content);
    writeFileSync(uri, body, "utf8");
    const sha256 = createHash("sha256").update(body).digest("hex");
    const id = newId("art");
    openAgentOsDb().run(
      "INSERT INTO enzo_artifacts (id, run_id, type, name, uri, sha256, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, runId, type, name, uri, sha256, JSON.stringify({ bytes: body.length }), now()],
    );
    this.event(runId, "artifact.created", "system", { name, sha256, type });
    return uri;
  }

  event(runId: string, type: string, actor: string, payload: unknown): void {
    const db = openAgentOsDb();
    const row = db.query("SELECT COALESCE(MAX(seq), 0) AS seq FROM enzo_run_events WHERE run_id = ?").get(runId) as { seq: number };
    const seq = Number(row.seq) + 1;
    const redacted = redactJson(payload);
    const text = redactBrokerText(JSON.stringify(redacted));
    db.run(
      "INSERT INTO enzo_run_events (id, run_id, seq, event_type, actor, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [newId("evt"), runId, seq, type, actor, text, now()],
    );
  }

  private insertRun(run: WorkspaceRun): void {
    openAgentOsDb().run(
      "INSERT INTO enzo_runs (id, mode, status, request_text, agent_id, policy_profile, budget_json, usage_json, plan_json, started_at, completed_at, created_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [run.id, run.mode, run.status, run.requestText, run.agentId, run.policyProfile, JSON.stringify(run.budget), JSON.stringify(run.usage), JSON.stringify(run.plan), run.startedAt, run.completedAt, run.createdAt, run.error],
    );
  }

  private setStatus(runId: string, status: RunStatus, extra?: { startedAt?: string; completedAt?: string }): void {
    const sets = ["status = ?"];
    const args: Array<string | number | null> = [status];
    if (extra?.startedAt) { sets.push("started_at = ?"); args.push(extra.startedAt); }
    if (extra?.completedAt) { sets.push("completed_at = ?"); args.push(extra.completedAt); }
    args.push(runId);
    openAgentOsDb().run("UPDATE enzo_runs SET " + sets.join(", ") + " WHERE id = ?", args);
  }

  private addUsage(runId: string, delta: Partial<WorkspaceRun["usage"]>): void {
    const run = this.requireRun(runId);
    const usage = { ...run.usage };
    for (const [k, v] of Object.entries(delta)) {
      (usage as Record<string, number>)[k] = ((usage as Record<string, number>)[k] ?? 0) + Number(v ?? 0);
    }
    openAgentOsDb().run("UPDATE enzo_runs SET usage_json = ? WHERE id = ?", [JSON.stringify(usage), runId]);
  }

  private fail(runId: string, error: string): void {
    openAgentOsDb().run("UPDATE enzo_runs SET status = 'FAILED', error = ?, completed_at = ? WHERE id = ?", [error, now(), runId]);
    this.event(runId, "run.failed", "system", { error });
  }

  requireRun(runId: string): WorkspaceRun {
    const row = openAgentOsDb().query("SELECT * FROM enzo_runs WHERE id = ?").get(runId) as Record<string, unknown> | undefined;
    if (!row) throw new EnzoWorkspaceError("RUN_NOT_FOUND", 404, "run not found: " + runId);
    return this.rowToRun(row);
  }

  private rowToRun(row: Record<string, unknown>): WorkspaceRun {
    return {
      id: String(row.id),
      mode: String(row.mode) as RunMode,
      status: String(row.status) as RunStatus,
      requestText: String(row.request_text),
      agentId: row.agent_id ? String(row.agent_id) : null,
      policyProfile: String(row.policy_profile) as PolicyProfile,
      budget: JSON.parse(String(row.budget_json ?? "{}")) as Budget,
      usage: JSON.parse(String(row.usage_json ?? "{}")) as WorkspaceRun["usage"],
      plan: JSON.parse(String(row.plan_json ?? "{}")) as Record<string, unknown>,
      startedAt: row.started_at ? String(row.started_at) : null,
      completedAt: row.completed_at ? String(row.completed_at) : null,
      createdAt: String(row.created_at),
      error: row.error ? String(row.error) : null,
    };
  }
}

function rowToApproval(row: Record<string, unknown>): ApprovalRecord {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    actionType: String(row.action_type),
    riskLevel: String(row.risk_level) as ApprovalRecord["riskLevel"],
    requestPayload: JSON.parse(String(row.request_payload_json ?? "{}")) as Record<string, unknown>,
    status: String(row.status) as ApprovalRecord["status"],
    resolvedBy: row.resolved_by ? String(row.resolved_by) : null,
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
    createdAt: String(row.created_at),
    expiresAt: row.expires_at ? String(row.expires_at) : null,
  };
}

function lessonStatements(run: WorkspaceRun, inspection: RunInspection): string[] {
  const out = ["Run mode " + run.mode + " completed with status path recorded in events."];
  if (inspection.skills?.selected.length) {
    out.push("Minimal skill set for this domain: " + inspection.skills.selected.map((s) => s.id).join(", "));
  }
  return out;
}

let singleton: EnzoOrchestrator | null = null;
export function getEnzoOrchestrator(root?: string): EnzoOrchestrator {
  if (!singleton || root) singleton = new EnzoOrchestrator(root ?? join(process.cwd(), "runtime", "enzo-workspace"));
  return singleton;
}
export function resetEnzoOrchestratorForTests(): void {
  singleton = null;
}
