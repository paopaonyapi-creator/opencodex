// Phase 20.5 — Living Markdown Wiki Storage Layer

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../../config";
import { openAgentOsDb } from "../db";
import type { WikiPage, WikiPageStatus, WikiPageType, WikiRevision } from "./types";

export function getWikiStorageDir(): string {
  // Configurable or defaults to getConfigDir()/wiki
  const dir = process.env.PAO_BRAIN_WIKI_DIR ?? join(getConfigDir(), "wiki");
  mkdirSync(dir, { recursive: true });
  for (const sub of [
    "projects", "phases", "technologies", "workflows",
    "decisions", "tools", "issues", "solutions", "concepts",
  ]) {
    mkdirSync(join(dir, sub), { recursive: true });
  }
  return dir;
}

export function wikiFilePath(slug: string, pageType: WikiPageType): string {
  const dir = getWikiStorageDir();
  const subFolder = mapPageTypeToFolder(pageType);
  const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  return join(dir, subFolder, `${cleanSlug}.md`);
}

function mapPageTypeToFolder(pageType: WikiPageType): string {
  switch (pageType) {
    case "PROJECT": return "projects";
    case "PHASE": return "phases";
    case "TECHNOLOGY": return "technologies";
    case "WORKFLOW": return "workflows";
    case "DECISION": return "decisions";
    case "TOOL": return "tools";
    case "ISSUE": return "issues";
    case "SOLUTION": return "solutions";
    default: return "concepts";
  }
}

export function writeWikiMarkdownAtomic(filePath: string, markdown: string): void {
  const tmpPath = `${filePath}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, markdown, "utf8");
  try {
    renameSync(tmpPath, filePath);
  } catch {
    // Fallback if cross-device or permission hiccup
    writeFileSync(filePath, markdown, "utf8");
    if (existsSync(tmpPath)) {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }
}

export function readWikiMarkdown(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

export function getWikiPage(idOrSlug: string): WikiPage | null {
  const db = openAgentOsDb();
  const row = db
    .query("SELECT * FROM wiki_pages WHERE id = ? OR slug = ? LIMIT 1")
    .get(idOrSlug, idOrSlug) as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapWikiPageRow(row);
}

export function listWikiPages(filters?: {
  pageType?: WikiPageType;
  status?: WikiPageStatus;
  limit?: number;
}): WikiPage[] {
  const db = openAgentOsDb();
  let sql = "SELECT * FROM wiki_pages WHERE 1=1";
  const bindings: (string | number)[] = [];

  if (filters?.pageType) {
    sql += " AND page_type = ?";
    bindings.push(filters.pageType);
  }
  if (filters?.status) {
    sql += " AND status = ?";
    bindings.push(filters.status);
  }

  sql += " ORDER BY updated_at DESC";
  if (filters?.limit) {
    sql += " LIMIT ?";
    bindings.push(filters.limit);
  }

  const rows = db.query(sql).all(...bindings) as Record<string, unknown>[];
  return rows.map(mapWikiPageRow);
}

export function getWikiRevision(revisionId: string): WikiRevision | null {
  const db = openAgentOsDb();
  const row = db.query("SELECT * FROM wiki_revisions WHERE id = ?").get(revisionId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapWikiRevisionRow(row);
}

export function listWikiRevisions(pageId: string): WikiRevision[] {
  const db = openAgentOsDb();
  const rows = db
    .query("SELECT * FROM wiki_revisions WHERE page_id = ? ORDER BY revision_number DESC")
    .all(pageId) as Record<string, unknown>[];
  return rows.map(mapWikiRevisionRow);
}

function mapWikiPageRow(row: Record<string, unknown>): WikiPage {
  const meta = row.metadata_json ? JSON.parse(String(row.metadata_json)) : {};
  const storagePath = row.storage_path ? String(row.storage_path) : null;
  const isHumanCurated = Number(meta.isHumanCurated ?? meta.is_human_curated ?? 0) === 1 || meta.isHumanCurated === true;

  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    pageType: row.page_type as WikiPageType,
    canonicalEntityId: row.canonical_entity_id ? String(row.canonical_entity_id) : null,
    status: (row.status as WikiPageStatus) ?? "CURRENT",
    currentRevisionId: row.current_revision_id ? String(row.current_revision_id) : null,
    storagePath,
    filePath: storagePath,
    file_path: storagePath,
    isHumanCurated,
    is_human_curated: isHumanCurated ? 1 : 0,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    metadata: meta,
  };
}

function mapWikiRevisionRow(row: Record<string, unknown>): WikiRevision {
  return {
    id: String(row.id),
    pageId: String(row.page_id),
    revisionNumber: Number(row.revision_number),
    contentHash: String(row.content_hash),
    markdown: String(row.markdown),
    compilerVersion: String(row.compiler_version ?? "1.0.0"),
    sourceSetHash: String(row.source_set_hash ?? ""),
    summary: String(row.summary ?? ""),
    createdAt: String(row.created_at),
  };
}
