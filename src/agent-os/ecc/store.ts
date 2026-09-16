// Phase 20.20 — Pao-hubPro × ECC Agent Harness OS
// Storage layer: SQLite schema, migrations, and CRUD helpers

import { openAgentOsDb } from "../db";
import type {
  AuditRecord,
  InstinctRecord,
  MemoryRecord,
  SkillDescriptor,
  AgentDescriptor,
  VerificationState,
} from "./types";

export interface EccRunRecord {
  id: string;
  taskId: string;
  harness: string;
  goal: string;
  status: VerificationState;
  agentRole: string;
  skillsJson: string;
  planJson: string;
  evidenceJson: string;
  reviewJson: string;
  createdAt: string;
  completedAt?: string;
}

let initialized = false;

export function ensureEccTables(dir?: string): void {
  const db = openAgentOsDb(dir);
  db.run(`
    CREATE TABLE IF NOT EXISTS ecc_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      harness TEXT NOT NULL DEFAULT 'codex',
      goal TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      agent_role TEXT NOT NULL,
      skills_json TEXT NOT NULL DEFAULT '[]',
      plan_json TEXT NOT NULL DEFAULT '{}',
      evidence_json TEXT NOT NULL DEFAULT '{}',
      review_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ecc_runs_status ON ecc_runs(status);
    CREATE INDEX IF NOT EXISTS idx_ecc_runs_created ON ecc_runs(created_at);

    CREATE TABLE IF NOT EXISTS ecc_skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source TEXT NOT NULL,
      version TEXT,
      description TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      risk TEXT NOT NULL DEFAULT 'low',
      required_tools_json TEXT NOT NULL DEFAULT '[]',
      supported_harnesses_json TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      trusted INTEGER NOT NULL DEFAULT 1,
      load_mode TEXT NOT NULL DEFAULT 'on_demand',
      content_hash TEXT,
      source_path TEXT,
      body TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ecc_skills_source ON ecc_skills(source);
    CREATE INDEX IF NOT EXISTS idx_ecc_skills_enabled ON ecc_skills(enabled);

    CREATE TABLE IF NOT EXISTS ecc_agents (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'pao',
      description TEXT NOT NULL DEFAULT '',
      read_only INTEGER NOT NULL DEFAULT 0,
      allowed_risk_classes_json TEXT NOT NULL DEFAULT '["A"]',
      allowed_tools_json TEXT NOT NULL DEFAULT '[]',
      required_skills_json TEXT NOT NULL DEFAULT '[]',
      is_security_critical INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ecc_memories (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      project TEXT NOT NULL DEFAULT 'pao-hubpro',
      summary TEXT NOT NULL,
      detail TEXT,
      confidence REAL NOT NULL DEFAULT 1.0,
      source TEXT NOT NULL,
      sensitive INTEGER NOT NULL DEFAULT 0,
      tags_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ecc_memories_type ON ecc_memories(type);
    CREATE INDEX IF NOT EXISTS idx_ecc_memories_created ON ecc_memories(created_at);

    CREATE TABLE IF NOT EXISTS ecc_instincts (
      id TEXT PRIMARY KEY,
      trigger_condition TEXT NOT NULL,
      pattern TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5,
      success_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      promotable INTEGER NOT NULL DEFAULT 0,
      candidate_skill_id TEXT,
      promoted_to_skill INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ecc_instincts_promotable ON ecc_instincts(promotable);

    CREATE TABLE IF NOT EXISTS ecc_audit_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      parent_id TEXT,
      harness TEXT NOT NULL,
      model TEXT,
      agent_role TEXT NOT NULL,
      selected_skills_json TEXT NOT NULL DEFAULT '[]',
      requested_tool TEXT NOT NULL,
      risk_class TEXT NOT NULL,
      policy_decision TEXT NOT NULL,
      approval_state TEXT NOT NULL DEFAULT 'none',
      action_summary TEXT NOT NULL,
      files_changed_json TEXT NOT NULL DEFAULT '[]',
      test_result TEXT,
      review_result TEXT,
      secret_redacted INTEGER NOT NULL DEFAULT 0,
      final_state TEXT NOT NULL DEFAULT 'PENDING',
      timestamp TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ecc_audit_run ON ecc_audit_events(run_id);
    CREATE INDEX IF NOT EXISTS idx_ecc_audit_time ON ecc_audit_events(timestamp);
  `);
  initialized = true;
}

export class EccStore {
  constructor(private readonly dir?: string) {
    ensureEccTables(this.dir);
  }

  private get db() {
    return openAgentOsDb(this.dir);
  }

  // --- Runs ---
  createRun(run: EccRunRecord): void {
    this.db.query(`
      INSERT INTO ecc_runs (
        id, task_id, harness, goal, status, agent_role, skills_json, plan_json, evidence_json, review_json, created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.id,
      run.taskId,
      run.harness,
      run.goal,
      run.status,
      run.agentRole,
      run.skillsJson,
      run.planJson,
      run.evidenceJson,
      run.reviewJson,
      run.createdAt,
      run.completedAt ?? null,
    );
  }

  updateRunStatus(id: string, status: VerificationState, completedAt?: string): void {
    this.db.query(`
      UPDATE ecc_runs SET status = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?
    `).run(status, completedAt ?? null, id);
  }

  getRun(id: string): EccRunRecord | null {
    const row = this.db.query("SELECT * FROM ecc_runs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      taskId: String(row.task_id),
      harness: String(row.harness),
      goal: String(row.goal),
      status: row.status as VerificationState,
      agentRole: String(row.agent_role),
      skillsJson: String(row.skills_json),
      planJson: String(row.plan_json),
      evidenceJson: String(row.evidence_json),
      reviewJson: String(row.review_json),
      createdAt: String(row.created_at),
      completedAt: row.completed_at ? String(row.completed_at) : undefined,
    };
  }

  listRuns(limit = 50): EccRunRecord[] {
    const rows = this.db.query("SELECT * FROM ecc_runs ORDER BY created_at DESC LIMIT ?").all(limit) as Record<string, unknown>[];
    return rows.map(row => ({
      id: String(row.id),
      taskId: String(row.task_id),
      harness: String(row.harness),
      goal: String(row.goal),
      status: row.status as VerificationState,
      agentRole: String(row.agent_role),
      skillsJson: String(row.skills_json),
      planJson: String(row.plan_json),
      evidenceJson: String(row.evidence_json),
      reviewJson: String(row.review_json),
      createdAt: String(row.created_at),
      completedAt: row.completed_at ? String(row.completed_at) : undefined,
    }));
  }

  // --- Skills ---
  upsertSkill(skill: SkillDescriptor, body?: string): void {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO ecc_skills (
        id, name, source, version, description, tags_json, risk, required_tools_json,
        supported_harnesses_json, enabled, trusted, load_mode, content_hash, source_path, body, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        source = excluded.source,
        version = excluded.version,
        description = excluded.description,
        tags_json = excluded.tags_json,
        risk = excluded.risk,
        required_tools_json = excluded.required_tools_json,
        supported_harnesses_json = excluded.supported_harnesses_json,
        enabled = excluded.enabled,
        trusted = excluded.trusted,
        load_mode = excluded.load_mode,
        content_hash = excluded.content_hash,
        source_path = excluded.source_path,
        body = COALESCE(excluded.body, ecc_skills.body),
        updated_at = excluded.updated_at
    `).run(
      skill.id,
      skill.name,
      skill.source,
      skill.version ?? null,
      skill.description,
      JSON.stringify(skill.tags),
      skill.risk,
      JSON.stringify(skill.requiredTools),
      JSON.stringify(skill.supportedHarnesses),
      skill.enabled ? 1 : 0,
      skill.trusted ? 1 : 0,
      skill.loadMode,
      skill.contentHash ?? null,
      skill.sourcePath ?? null,
      body ?? null,
      now,
    );
  }

  listSkills(): SkillDescriptor[] {
    const rows = this.db.query("SELECT * FROM ecc_skills ORDER BY source, name").all() as Record<string, unknown>[];
    return rows.map(r => ({
      id: String(r.id),
      name: String(r.name),
      source: r.source as SkillDescriptor["source"],
      version: r.version ? String(r.version) : undefined,
      description: String(r.description),
      tags: JSON.parse(String(r.tags_json)) as string[],
      risk: r.risk as SkillDescriptor["risk"],
      requiredTools: JSON.parse(String(r.required_tools_json)) as string[],
      supportedHarnesses: JSON.parse(String(r.supported_harnesses_json)) as string[],
      enabled: Number(r.enabled) === 1,
      trusted: Number(r.trusted) === 1,
      loadMode: r.load_mode as SkillDescriptor["loadMode"],
      contentHash: r.content_hash ? String(r.content_hash) : undefined,
      sourcePath: r.source_path ? String(r.source_path) : undefined,
    }));
  }

  getSkillBody(id: string): string | null {
    const row = this.db.query("SELECT body FROM ecc_skills WHERE id = ?").get(id) as { body?: string } | undefined;
    return row?.body ?? null;
  }

  setSkillEnabled(id: string, enabled: boolean): void {
    this.db.query("UPDATE ecc_skills SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
  }

  // --- Agents ---
  upsertAgent(agent: AgentDescriptor): void {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO ecc_agents (
        id, role, name, source, description, read_only, allowed_risk_classes_json,
        allowed_tools_json, required_skills_json, is_security_critical, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(role) DO UPDATE SET
        name = excluded.name,
        source = excluded.source,
        description = excluded.description,
        read_only = excluded.read_only,
        allowed_risk_classes_json = excluded.allowed_risk_classes_json,
        allowed_tools_json = excluded.allowed_tools_json,
        required_skills_json = excluded.required_skills_json,
        is_security_critical = excluded.is_security_critical,
        updated_at = excluded.updated_at
    `).run(
      agent.id,
      agent.role,
      agent.name,
      agent.source,
      agent.description,
      agent.readOnly ? 1 : 0,
      JSON.stringify(agent.allowedRiskClasses),
      JSON.stringify(agent.allowedTools),
      JSON.stringify(agent.requiredSkills),
      agent.isSecurityCritical ? 1 : 0,
      now,
    );
  }

  listAgents(): AgentDescriptor[] {
    const rows = this.db.query("SELECT * FROM ecc_agents ORDER BY role").all() as Record<string, unknown>[];
    return rows.map(r => ({
      id: String(r.id),
      role: String(r.role),
      name: String(r.name),
      source: r.source as AgentDescriptor["source"],
      description: String(r.description),
      readOnly: Number(r.read_only) === 1,
      allowedRiskClasses: JSON.parse(String(r.allowed_risk_classes_json)),
      allowedTools: JSON.parse(String(r.allowed_tools_json)),
      requiredSkills: JSON.parse(String(r.required_skills_json)),
      isSecurityCritical: Number(r.is_security_critical) === 1,
    }));
  }

  // --- Memories ---
  saveMemory(mem: MemoryRecord): void {
    this.db.query(`
      INSERT INTO ecc_memories (
        id, type, project, summary, detail, confidence, source, sensitive, tags_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        summary = excluded.summary,
        detail = excluded.detail,
        confidence = excluded.confidence,
        tags_json = excluded.tags_json
    `).run(
      mem.id,
      mem.type,
      mem.project,
      mem.summary,
      mem.detail ?? null,
      mem.confidence,
      mem.source,
      mem.sensitive ? 1 : 0,
      JSON.stringify(mem.tags),
      mem.createdAt,
    );
  }

  listMemories(limit = 50): MemoryRecord[] {
    const rows = this.db.query("SELECT * FROM ecc_memories ORDER BY created_at DESC LIMIT ?").all(limit) as Record<string, unknown>[];
    return rows.map(r => ({
      id: String(r.id),
      type: r.type as MemoryRecord["type"],
      project: String(r.project),
      summary: String(r.summary),
      detail: r.detail ? String(r.detail) : undefined,
      confidence: Number(r.confidence),
      source: String(r.source),
      sensitive: Number(r.sensitive) === 1,
      tags: JSON.parse(String(r.tags_json)),
      createdAt: String(r.created_at),
    }));
  }

  // --- Instincts ---
  upsertInstinct(instinct: InstinctRecord): void {
    this.db.query(`
      INSERT INTO ecc_instincts (
        id, trigger_condition, pattern, confidence, success_count, failure_count, promotable,
        candidate_skill_id, promoted_to_skill, last_used_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        trigger_condition = excluded.trigger_condition,
        pattern = excluded.pattern,
        confidence = excluded.confidence,
        success_count = excluded.success_count,
        failure_count = excluded.failure_count,
        promotable = excluded.promotable,
        candidate_skill_id = excluded.candidate_skill_id,
        promoted_to_skill = excluded.promoted_to_skill,
        last_used_at = excluded.last_used_at,
        updated_at = excluded.updated_at
    `).run(
      instinct.id,
      instinct.trigger,
      instinct.pattern,
      instinct.confidence,
      instinct.successCount,
      instinct.failureCount,
      instinct.promotable ? 1 : 0,
      instinct.candidateSkillId ?? null,
      instinct.promotedToSkill ? 1 : 0,
      instinct.lastUsedAt ?? null,
      instinct.createdAt,
      instinct.updatedAt,
    );
  }

  listInstincts(limit = 50): InstinctRecord[] {
    const rows = this.db.query("SELECT * FROM ecc_instincts ORDER BY confidence DESC, updated_at DESC LIMIT ?").all(limit) as Record<string, unknown>[];
    return rows.map(r => ({
      id: String(r.id),
      trigger: String(r.trigger_condition),
      pattern: String(r.pattern),
      confidence: Number(r.confidence),
      successCount: Number(r.success_count),
      failureCount: Number(r.failure_count),
      promotable: Number(r.promotable) === 1,
      candidateSkillId: r.candidate_skill_id ? String(r.candidate_skill_id) : undefined,
      promotedToSkill: Number(r.promoted_to_skill) === 1,
      lastUsedAt: r.last_used_at ? String(r.last_used_at) : undefined,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }));
  }

  // --- Audit Events ---
  recordAuditEvent(audit: AuditRecord): void {
    this.db.query(`
      INSERT INTO ecc_audit_events (
        id, run_id, parent_id, harness, model, agent_role, selected_skills_json,
        requested_tool, risk_class, policy_decision, approval_state, action_summary,
        files_changed_json, test_result, review_result, secret_redacted, final_state, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      audit.id,
      audit.runId,
      audit.parentId ?? null,
      audit.harness,
      audit.model ?? null,
      audit.agentRole,
      JSON.stringify(audit.selectedSkills),
      audit.requestedTool,
      audit.riskClass,
      audit.policyDecision,
      audit.approvalState,
      audit.actionSummary,
      JSON.stringify(audit.filesChanged),
      audit.testResult ?? null,
      audit.reviewResult ?? null,
      audit.secretRedacted ? 1 : 0,
      audit.finalState,
      audit.timestamp,
    );
  }

  listAuditEvents(limit = 100): AuditRecord[] {
    const rows = this.db.query("SELECT * FROM ecc_audit_events ORDER BY timestamp DESC LIMIT ?").all(limit) as Record<string, unknown>[];
    return rows.map(r => ({
      id: String(r.id),
      runId: String(r.run_id),
      parentId: r.parent_id ? String(r.parent_id) : undefined,
      harness: String(r.harness),
      model: r.model ? String(r.model) : undefined,
      agentRole: String(r.agent_role),
      selectedSkills: JSON.parse(String(r.selected_skills_json)),
      requestedTool: String(r.requested_tool),
      riskClass: r.risk_class as AuditRecord["riskClass"],
      policyDecision: r.policy_decision as AuditRecord["policyDecision"],
      approvalState: r.approval_state as AuditRecord["approvalState"],
      actionSummary: String(r.action_summary),
      filesChanged: JSON.parse(String(r.files_changed_json)),
      testResult: r.test_result ? String(r.test_result) : undefined,
      reviewResult: r.review_result ? String(r.review_result) : undefined,
      secretRedacted: Number(r.secret_redacted) === 1,
      finalState: r.final_state as VerificationState,
      timestamp: String(r.timestamp),
    }));
  }
}
