/**
 * Phase 18 — SEO project store & recommendation inbox over the Agent OS store.
 * Same persistence rules as every other Agent OS ledger: local SQLite under
 * OPENCODEX_HOME, no new process, no external database.
 */
import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import { DEFAULT_SEO_POLICY, type SeoProjectContext, type SeoRecommendation, type SeoPolicy, type SeoRecommendationStatus } from "./types";

interface SeoProjectRow {
  id: string;
  domain: string;
  display_name: string | null;
  country: string | null;
  language: string | null;
  business_type: string | null;
  business_description: string | null;
  goals_json: string;
  primary_topics_json: string;
  seed_keywords_json: string;
  competitors_json: string;
  key_pages_json: string;
  brand_terms_json: string;
  negative_keywords_json: string;
  policy_json: string;
  created_at: string;
  updated_at: string;
}

function rowToProject(row: SeoProjectRow): SeoProjectContext {
  const parse = <T,>(json: string, fallback: T): T => {
    try { return JSON.parse(json) as T; } catch { return fallback; }
  };
  return {
    id: row.id,
    domain: row.domain,
    ...(row.display_name ? { displayName: row.display_name } : {}),
    ...(row.country ? { country: row.country } : {}),
    ...(row.language ? { language: row.language } : {}),
    ...(row.business_type ? { businessType: row.business_type } : {}),
    ...(row.business_description ? { businessDescription: row.business_description } : {}),
    goals: parse<string[]>(row.goals_json, []),
    primaryTopics: parse<string[]>(row.primary_topics_json, []),
    seedKeywords: parse<string[]>(row.seed_keywords_json, []),
    competitors: parse<string[]>(row.competitors_json, []),
    keyPages: parse<SeoProjectContext["keyPages"]>(row.key_pages_json, []),
    brandTerms: parse<string[]>(row.brand_terms_json, []),
    negativeKeywords: parse<string[]>(row.negative_keywords_json, []),
    policy: { ...DEFAULT_SEO_POLICY, ...parse<Partial<SeoPolicy>>(row.policy_json, {}) },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createSeoProject(input: {
  id?: string;
  domain: string;
  displayName?: string;
  country?: string;
  language?: string;
  businessType?: string;
  businessDescription?: string;
  goals?: string[];
  primaryTopics?: string[];
  seedKeywords?: string[];
  competitors?: string[];
  keyPages?: SeoProjectContext["keyPages"];
  brandTerms?: string[];
  negativeKeywords?: string[];
  policy?: Partial<SeoPolicy>;
}): SeoProjectContext {
  const domain = input.domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!domain || !domain.includes(".")) throw new Error("a valid domain is required");
  const db = openAgentOsDb();
  const id = input.id ?? `seo_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const policy = { ...DEFAULT_SEO_POLICY, ...input.policy };
  db.query(
    `INSERT INTO seo_projects (id, domain, display_name, country, language, business_type, business_description,
      goals_json, primary_topics_json, seed_keywords_json, competitors_json, key_pages_json, brand_terms_json,
      negative_keywords_json, policy_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, domain, input.displayName ?? null, input.country ?? null, input.language ?? null,
    input.businessType ?? null, input.businessDescription ?? null,
    JSON.stringify(input.goals ?? []), JSON.stringify(input.primaryTopics ?? []),
    JSON.stringify(input.seedKeywords ?? []), JSON.stringify(input.competitors ?? []),
    JSON.stringify(input.keyPages ?? []), JSON.stringify(input.brandTerms ?? []),
    JSON.stringify(input.negativeKeywords ?? []), JSON.stringify(policy), now, now,
  );
  return getSeoProject(id)!;
}

export function getSeoProject(id: string): SeoProjectContext | null {
  const row = openAgentOsDb().query("SELECT * FROM seo_projects WHERE id = ?").get(id) as SeoProjectRow | undefined;
  return row ? rowToProject(row) : null;
}

export function listSeoProjects(): SeoProjectContext[] {
  const rows = openAgentOsDb().query("SELECT * FROM seo_projects ORDER BY created_at DESC, id").all() as SeoProjectRow[];
  return rows.map(rowToProject);
}

export function updateSeoProject(id: string, patch: Partial<Omit<SeoProjectContext, "id" | "createdAt">>): SeoProjectContext | null {
  const existing = getSeoProject(id);
  if (!existing) return null;
  const merged: SeoProjectContext = {
    ...existing,
    ...patch,
    policy: { ...existing.policy, ...(patch.policy ?? {}) },
    updatedAt: new Date().toISOString(),
  };
  const db = openAgentOsDb();
  db.query(
    `UPDATE seo_projects SET domain = ?, display_name = ?, country = ?, language = ?, business_type = ?,
      business_description = ?, goals_json = ?, primary_topics_json = ?, seed_keywords_json = ?,
      competitors_json = ?, key_pages_json = ?, brand_terms_json = ?, negative_keywords_json = ?,
      policy_json = ?, updated_at = ? WHERE id = ?`,
  ).run(
    merged.domain, merged.displayName ?? null, merged.country ?? null, merged.language ?? null,
    merged.businessType ?? null, merged.businessDescription ?? null,
    JSON.stringify(merged.goals), JSON.stringify(merged.primaryTopics), JSON.stringify(merged.seedKeywords),
    JSON.stringify(merged.competitors), JSON.stringify(merged.keyPages), JSON.stringify(merged.brandTerms),
    JSON.stringify(merged.negativeKeywords), JSON.stringify(merged.policy), merged.updatedAt, id,
  );
  return getSeoProject(id);
}

export function deleteSeoProject(id: string): boolean {
  return openAgentOsDb().query("DELETE FROM seo_projects WHERE id = ?").run(id).changes > 0;
}

interface SeoRecommendationRow {
  id: string;
  project_id: string;
  area: string;
  title: string;
  detail: string;
  impact: string;
  effort: string;
  status: string;
  requires_approval: number;
  evidence_json: string;
  created_at: string;
}

function rowToRecommendation(row: SeoRecommendationRow): SeoRecommendation {
  return {
    id: row.id,
    projectId: row.project_id,
    area: row.area as SeoRecommendation["area"],
    title: row.title,
    detail: row.detail,
    impact: row.impact as SeoRecommendation["impact"],
    effort: row.effort as SeoRecommendation["effort"],
    status: row.status as SeoRecommendationStatus,
    requiresApproval: row.requires_approval === 1,
    evidenceJson: row.evidence_json,
    createdAt: row.created_at,
  };
}

export function addSeoRecommendation(input: {
  id?: string;
  projectId: string;
  area: SeoRecommendation["area"];
  title: string;
  detail?: string;
  impact?: SeoRecommendation["impact"];
  effort?: SeoRecommendation["effort"];
  requiresApproval?: boolean;
  evidence?: Record<string, unknown>;
}): SeoRecommendation {
  const db = openAgentOsDb();
  const existing = db.query(
    "SELECT * FROM seo_recommendations WHERE project_id = ? AND area = ? AND title = ? AND status = 'open' ORDER BY created_at DESC, id LIMIT 1",
  ).get(input.projectId, input.area, input.title) as SeoRecommendationRow | undefined;
  if (existing) {
    db.query(
      "UPDATE seo_recommendations SET detail = ?, impact = ?, effort = ?, requires_approval = ?, evidence_json = ? WHERE id = ?",
    ).run(
      input.detail ?? "",
      input.impact ?? "medium",
      input.effort ?? "medium",
      input.requiresApproval ? 1 : 0,
      JSON.stringify(input.evidence ?? {}),
      existing.id,
    );
    const updated = db.query("SELECT * FROM seo_recommendations WHERE id = ?").get(existing.id) as SeoRecommendationRow;
    return rowToRecommendation(updated);
  }
  const rec: SeoRecommendation = {
    id: input.id ?? `rec_${randomUUID().slice(0, 8)}`,
    projectId: input.projectId,
    area: input.area,
    title: input.title,
    detail: input.detail ?? "",
    impact: input.impact ?? "medium",
    effort: input.effort ?? "medium",
    status: "open",
    requiresApproval: input.requiresApproval ?? false,
    evidenceJson: JSON.stringify(input.evidence ?? {}),
    createdAt: new Date().toISOString(),
  };
  db.query(
    "INSERT INTO seo_recommendations (id, project_id, area, title, detail, impact, effort, status, requires_approval, evidence_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(rec.id, rec.projectId, rec.area, rec.title, rec.detail, rec.impact, rec.effort, rec.status, rec.requiresApproval ? 1 : 0, rec.evidenceJson, rec.createdAt);
  return rec;
}

export function listSeoRecommendations(projectId: string, status?: SeoRecommendationStatus): SeoRecommendation[] {
  const db = openAgentOsDb();
  const rows = status
    ? (db.query("SELECT * FROM seo_recommendations WHERE project_id = ? AND status = ? ORDER BY created_at, id").all(projectId, status) as SeoRecommendationRow[])
    : (db.query("SELECT * FROM seo_recommendations WHERE project_id = ? ORDER BY created_at, id").all(projectId) as SeoRecommendationRow[]);
  return rows.map(rowToRecommendation);
}

export function updateSeoRecommendationStatus(id: string, status: SeoRecommendationStatus): boolean {
  return openAgentOsDb().query("UPDATE seo_recommendations SET status = ? WHERE id = ?").run(status, id).changes > 0;
}

export function recordSeoRun(input: {
  id?: string;
  projectId: string;
  kind: string;
  status?: "succeeded" | "failed" | "policy_denied";
  provider?: string;
  provenance?: string;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
  startedMs: number;
  durationMs?: number;
}): string {
  const db = openAgentOsDb();
  const id = input.id ?? `run_${randomUUID().slice(0, 8)}`;
  db.query(
    "INSERT INTO seo_runs (id, project_id, kind, status, provider, provenance, result_json, error_json, started_ms, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id, input.projectId, input.kind, input.status ?? "succeeded", input.provider ?? "mock",
    input.provenance ?? "mock", JSON.stringify(input.result ?? {}),
    input.error ? JSON.stringify(input.error) : null, input.startedMs, input.durationMs ?? null,
  );
  return id;
}

export function listSeoRuns(projectId: string, limit = 20): Array<Record<string, unknown>> {
  return openAgentOsDb()
    .query("SELECT id, project_id, kind, status, provider, provenance, started_ms, duration_ms FROM seo_runs WHERE project_id = ? ORDER BY started_ms DESC, id LIMIT ?")
    .all(projectId, limit) as Array<Record<string, unknown>>;
}

export interface SeoRunSnapshot {
  id: string;
  projectId: string;
  kind: string;
  status: string;
  provider: string;
  provenance: string;
  result: Record<string, unknown>;
  startedMs: number;
  durationMs: number | null;
}

export function latestSeoRunSnapshot(projectId: string, kind?: string): SeoRunSnapshot | null {
  const row = (kind
    ? openAgentOsDb().query("SELECT * FROM seo_runs WHERE project_id = ? AND kind = ? ORDER BY started_ms DESC, id DESC LIMIT 1").get(projectId, kind)
    : openAgentOsDb().query("SELECT * FROM seo_runs WHERE project_id = ? ORDER BY started_ms DESC, id DESC LIMIT 1").get(projectId)
  ) as {
    id: string; project_id: string; kind: string; status: string; provider: string;
    provenance: string; result_json: string; started_ms: number; duration_ms: number | null;
  } | undefined;
  if (!row) return null;
  let result: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.result_json) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) result = parsed as Record<string, unknown>;
  } catch { /* corrupted historical result degrades to an empty snapshot */ }
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    status: row.status,
    provider: row.provider,
    provenance: row.provenance,
    result,
    startedMs: row.started_ms,
    durationMs: row.duration_ms,
  };
}
