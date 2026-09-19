// Phase 20.94 — adaptive lesson distillation.
// Does not create a second memory database. Candidates live in enzo_lessons;
// accepted lessons may be forwarded to Memory Plane when that plane is enabled.

import { createHash, randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import { EnzoWorkspaceError, type AgentLesson, type LessonStatus } from "./types";

export interface DistillInput {
  runId: string;
  agentSlug: string;
  domain: string;
  outcome: "success" | "failure";
  statements: string[];
  evidenceRefs: string[];
  humanCorrection?: string;
}

export function distillLessons(input: DistillInput): AgentLesson[] {
  const lessons: AgentLesson[] = [];
  const statements = input.humanCorrection ? [input.humanCorrection, ...input.statements] : input.statements;
  for (const statement of statements) {
    const trimmed = statement.trim();
    if (trimmed.length < 12) continue;
    const sourced = input.evidenceRefs.length > 0;
    const confidence = input.humanCorrection === trimmed
      ? 0.99
      : sourced
        ? input.outcome === "success" ? 0.72 : 0.55
        : 0.2;
    const status: LessonStatus = !sourced && !input.humanCorrection
      ? "quarantined"
      : confidence >= 0.95
        ? "accepted"
        : "candidate";
    const lesson = persistLesson({
      agentSlug: input.agentSlug,
      domain: input.domain,
      statement: trimmed,
      evidenceRefs: input.evidenceRefs,
      runRefs: [input.runId],
      confidence,
      status,
    });
    lessons.push(lesson);
  }
  return lessons;
}

export function persistLesson(input: Omit<AgentLesson, "id" | "createdAt"> & { id?: string }): AgentLesson {
  const existing = findDuplicate(input.agentSlug, input.statement);
  if (existing) {
    const confidence = Math.max(existing.confidence, input.confidence);
    const status = mergeStatus(existing.status, input.status);
    const evidence = unique([...existing.evidenceRefs, ...input.evidenceRefs]);
    const runs = unique([...existing.runRefs, ...input.runRefs]);
    openAgentOsDb().run(
      "UPDATE enzo_lessons SET confidence = ?, status = ?, evidence_json = ?, run_refs_json = ?, last_validated_at = ? WHERE id = ?",
      [confidence, status, JSON.stringify(evidence), JSON.stringify(runs), now(), existing.id],
    );
    return { ...existing, confidence, status, evidenceRefs: evidence, runRefs: runs, lastValidatedAt: now() };
  }
  const lesson: AgentLesson = {
    id: input.id ?? "les_" + randomUUID().slice(0, 12),
    agentSlug: input.agentSlug,
    domain: input.domain,
    statement: input.statement,
    evidenceRefs: input.evidenceRefs,
    runRefs: input.runRefs,
    confidence: input.confidence,
    status: input.status,
    createdAt: now(),
  };
  openAgentOsDb().run(
    "INSERT INTO enzo_lessons (id, agent_slug, domain, statement, evidence_json, run_refs_json, confidence, status, created_at, last_validated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)",
    [lesson.id, lesson.agentSlug, lesson.domain, lesson.statement, JSON.stringify(lesson.evidenceRefs), JSON.stringify(lesson.runRefs), lesson.confidence, lesson.status, lesson.createdAt],
  );
  return lesson;
}

export function setLessonStatus(id: string, status: LessonStatus): AgentLesson {
  const lesson = getLesson(id);
  openAgentOsDb().run("UPDATE enzo_lessons SET status = ?, last_validated_at = ? WHERE id = ?", [status, now(), id]);
  return { ...lesson, status, lastValidatedAt: now() };
}

export function getLesson(id: string): AgentLesson {
  const row = openAgentOsDb().query("SELECT * FROM enzo_lessons WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) throw new EnzoWorkspaceError("LESSON_NOT_FOUND", 404, "lesson not found: " + id);
  return rowToLesson(row);
}

export function searchLessons(query: string, agentSlug?: string): AgentLesson[] {
  const rows = openAgentOsDb()
    .query("SELECT * FROM enzo_lessons WHERE status IN ('accepted','candidate') AND (? IS NULL OR agent_slug = ?) ORDER BY confidence DESC")
    .all(agentSlug ?? null, agentSlug ?? null) as Record<string, unknown>[];
  const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 3);
  return rows
    .map(rowToLesson)
    .filter((l) => terms.length === 0 || terms.some((t) => l.statement.toLowerCase().includes(t) || l.domain.toLowerCase().includes(t)))
    .slice(0, 20);
}

function findDuplicate(agentSlug: string, statement: string): AgentLesson | null {
  const hash = normalize(statement);
  const rows = openAgentOsDb().query("SELECT * FROM enzo_lessons WHERE agent_slug = ?").all(agentSlug) as Record<string, unknown>[];
  for (const row of rows) {
    const lesson = rowToLesson(row);
    if (normalize(lesson.statement) === hash) return lesson;
  }
  return null;
}

function mergeStatus(a: LessonStatus, b: LessonStatus): LessonStatus {
  if (a === "retired" || b === "retired") return "retired";
  if (a === "quarantined" || b === "quarantined") return "quarantined";
  if (a === "accepted" || b === "accepted") return "accepted";
  return "candidate";
}

function rowToLesson(row: Record<string, unknown>): AgentLesson {
  return {
    id: String(row.id),
    agentSlug: String(row.agent_slug),
    domain: String(row.domain),
    statement: String(row.statement),
    evidenceRefs: JSON.parse(String(row.evidence_json ?? "[]")) as string[],
    runRefs: JSON.parse(String(row.run_refs_json ?? "[]")) as string[],
    confidence: Number(row.confidence),
    status: String(row.status) as LessonStatus,
    createdAt: String(row.created_at),
    lastValidatedAt: row.last_validated_at ? String(row.last_validated_at) : undefined,
    expiresAt: row.expires_at ? String(row.expires_at) : undefined,
  };
}

function normalize(statement: string): string {
  return createHash("sha256").update(statement.toLowerCase().replace(/\s+/g, " ").trim()).digest("hex");
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

function now(): string {
  return new Date().toISOString();
}
