// Phase 21 — Local Knowledge Provider (spec sections 15, 16).
//
// Indexes local markdown files, ADRs, architecture docs, and phase specs into SQLite
// with full incremental SHA-256 hash checks and sensitive secret exclusion.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { openAgentOsDb } from "../../db";
import { getKnowledgeConfig } from "../config";
import { parseMarkdownDocument } from "../parser";
import { isPathExcluded, scanSensitiveContent } from "../security";
import type { KnowledgeDocType, KnowledgeDocument, KnowledgeQuery, ProviderHealth, SearchResult } from "../types";
import type { KnowledgeProvider } from "./provider-interface";

export class LocalKnowledgeProvider implements KnowledgeProvider {
  readonly name = "local";

  constructor() {
    this.refreshIndex();
  }

  /**
   * Scans directories and indexes markdown files incrementally into SQLite.
   */
  refreshIndex(workspaceRoot = process.cwd()): { indexed: number; skipped: number; sensitiveBlocked: number } {
    const db = openAgentOsDb();
    const config = getKnowledgeConfig();

    let indexed = 0;
    let skipped = 0;
    let sensitiveBlocked = 0;

    for (const relDir of config.rootDirectories) {
      const fullDir = join(workspaceRoot, relDir);
      if (!existsSync(fullDir)) continue;

      const files = this.collectMarkdownFiles(fullDir);
      for (const filePath of files) {
        const relativePath = filePath.replace(workspaceRoot, "").replace(/^[/\\]+/, "").replace(/\\/g, "/");

        if (isPathExcluded(relativePath)) {
          skipped++;
          continue;
        }

        let content = "";
        try {
          content = readFileSync(filePath, "utf8");
        } catch {
          skipped++;
          continue;
        }

        // Secret Exclusion Scan
        const scan = scanSensitiveContent(content);
        if (!scan.safe) {
          sensitiveBlocked++;
          // Record audit event
          const auditId = `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
          db.query(`INSERT INTO kg_audit_events (
            id, agent, action, query, sources_json, result, error_code, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
            auditId,
            "local_indexer",
            "blocked_sensitive_source",
            relativePath,
            JSON.stringify([relativePath]),
            scan.reason || "Sensitive pattern detected",
            "SENSITIVE_CONTENT",
            new Date().toISOString(),
          );
          continue;
        }

        const parsed = parseMarkdownDocument(relativePath, content);

        // Check incremental hash
        const existing = db.query("SELECT hash FROM kg_documents WHERE id = ?").get(parsed.document.id) as { hash: string } | null;
        if (existing && existing.hash === parsed.document.hash) {
          skipped++;
          continue;
        }

        // Upsert Document
        db.query(`INSERT INTO kg_documents (
          id, doc_type, title, path, hash, version, status, source_priority,
          tags_json, metadata_json, created_at, updated_at, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          doc_type = excluded.doc_type,
          title = excluded.title,
          path = excluded.path,
          hash = excluded.hash,
          version = excluded.version,
          status = excluded.status,
          source_priority = excluded.source_priority,
          tags_json = excluded.tags_json,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at,
          indexed_at = excluded.indexed_at
        `).run(
          parsed.document.id,
          parsed.document.type,
          parsed.document.title,
          parsed.document.path,
          parsed.document.hash,
          parsed.document.version,
          parsed.document.status,
          parsed.document.sourcePriority,
          JSON.stringify(parsed.document.tags),
          JSON.stringify(parsed.document.metadata),
          parsed.document.createdAt,
          parsed.document.updatedAt,
          parsed.document.indexedAt,
        );

        // Replace Sections
        db.query("DELETE FROM kg_sections WHERE document_id = ?").run(parsed.document.id);
        for (const sec of parsed.sections) {
          db.query(`INSERT INTO kg_sections (
            id, document_id, heading, content, start_line, end_line, content_hash
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
            sec.id,
            sec.documentId,
            sec.heading,
            sec.content,
            sec.startLine,
            sec.endLine,
            sec.contentHash,
          );
        }

        indexed++;
      }
    }

    return { indexed, skipped, sensitiveBlocked };
  }

  private collectMarkdownFiles(dirPath: string): string[] {
    const results: string[] = [];
    if (!existsSync(dirPath)) return results;

    const entries = readdirSync(dirPath);
    for (const entry of entries) {
      if (isPathExcluded(entry)) continue;
      const fullPath = join(dirPath, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        results.push(...this.collectMarkdownFiles(fullPath));
      } else if (stat.isFile() && (entry.endsWith(".md") || entry.endsWith(".markdown"))) {
        results.push(fullPath);
      }
    }

    return results;
  }

  async search(query: KnowledgeQuery): Promise<SearchResult[]> {
    const db = openAgentOsDb();
    const limit = query.limit || 10;
    const STOP_WORDS = new Set(["is", "in", "the", "a", "an", "and", "to", "for", "with", "of", "on", "at", "by", "from", "as", "it", "or", "be"]);
    let tokens = query.query
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.replace(/[^a-z0-9_\-]/g, ""))
      .filter((t) => t.length > 1 && !STOP_WORDS.has(t));

    if (tokens.length === 0) {
      tokens = query.query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
    }
    if (tokens.length === 0) return [];

    let typeFilterSql = "";
    const params: any[] = [];
    if (query.types && query.types.length > 0) {
      const placeholders = query.types.map(() => "?").join(",");
      typeFilterSql = `AND d.doc_type IN (${placeholders})`;
      params.push(...query.types);
    }

    // Query documents and sections
    const sql = `
      SELECT
        d.id as doc_id,
        d.doc_type,
        d.title as doc_title,
        d.path as doc_path,
        d.source_priority,
        s.id as sec_id,
        s.heading as sec_heading,
        s.content as sec_content
      FROM kg_documents d
      JOIN kg_sections s ON d.id = s.document_id
      WHERE d.status != 'deprecated'
      ${typeFilterSql}
    `;

    const rows = db.query(sql).all(...params) as Record<string, unknown>[];
    const scored: SearchResult[] = [];

    for (const r of rows) {
      const title = String(r.doc_title);
      const heading = String(r.sec_heading);
      const content = String(r.sec_content);
      const prio = Number(r.source_priority);
      const docType = String(r.doc_type) as KnowledgeDocType;

      const haystack = [title, heading, content].join(" ").toLowerCase();
      let matchCount = 0;
      for (const token of tokens) {
        if (haystack.includes(token)) matchCount++;
      }

      // Require at least 25% of query tokens to match
      const tokenScore = matchCount / tokens.length;
      if (matchCount > 0 && tokenScore >= 0.25) {
        const priorityFactor = prio / 100;
        const score = Math.min(1.0, Math.round((tokenScore * 0.80 + priorityFactor * 0.20) * 100) / 100);

        // Extract snippet around first match
        let snippet = content.slice(0, 240);
        for (const token of tokens) {
          const idx = content.toLowerCase().indexOf(token);
          if (idx !== -1) {
            const start = Math.max(0, idx - 40);
            const end = Math.min(content.length, idx + 160);
            snippet = (start > 0 ? "..." : "") + content.slice(start, end).replace(/\s+/g, " ") + (end < content.length ? "..." : "");
            break;
          }
        }

        scored.push({
          documentId: String(r.doc_id),
          title,
          type: docType,
          path: String(r.doc_path),
          section: heading,
          snippet,
          score,
          provider: this.name,
          sourcePriority: prio,
        });
      }
    }

    // Sort descending by score, then by sourcePriority
    scored.sort((a, b) => b.score - a.score || b.sourcePriority - a.sourcePriority);
    return scored.slice(0, limit);
  }

  async getDocument(id: string): Promise<KnowledgeDocument | null> {
    const db = openAgentOsDb();
    const r = db.query("SELECT * FROM kg_documents WHERE id = ?").get(id) as Record<string, unknown> | null;
    if (!r) return null;

    return {
      id: String(r.id),
      type: String(r.doc_type) as KnowledgeDocType,
      title: String(r.title),
      path: String(r.path),
      hash: String(r.hash),
      version: Number(r.version),
      status: String(r.status) as any,
      sourcePriority: Number(r.source_priority),
      tags: JSON.parse(String(r.tags_json || "[]")),
      metadata: JSON.parse(String(r.metadata_json || "{}")),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      indexedAt: String(r.indexed_at),
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    const started = Date.now();
    try {
      const db = openAgentOsDb();
      const countRow = db.query("SELECT COUNT(*) as count FROM kg_documents").get() as { count: number };
      const documentCount = countRow ? countRow.count : 0;
      return {
        provider: this.name,
        status: "healthy",
        latencyMs: Date.now() - started,
        documentCount,
      };
    } catch (err: any) {
      return {
        provider: this.name,
        status: "unavailable",
        latencyMs: Date.now() - started,
        documentCount: 0,
        error: err?.message || String(err),
      };
    }
  }
}
