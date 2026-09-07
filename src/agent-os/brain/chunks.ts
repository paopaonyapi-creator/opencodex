// Phase 20.5 — Section-Aware & Anchored Chunking Engine

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import { computeContentHash } from "./sources";
import type { NormalizedDocument, ParsedSection } from "./parsers";
import type { SourceChunk } from "./types";

export interface ChunkOptions {
  maxChunkChars?: number;
  overlapChars?: number;
}

export function chunkDocument(
  doc: NormalizedDocument,
  sourceVersionId: string,
  options: ChunkOptions = {},
): SourceChunk[] {
  const maxChars = options.maxChunkChars ?? 1200;
  const overlap = options.overlapChars ?? 150;
  const chunks: SourceChunk[] = [];
  let chunkIndex = 0;

  for (const sec of doc.sections) {
    const text = sec.content.trim();
    if (!text) continue;

    const sectionPath = sec.title;
    if (text.length <= maxChars) {
      const hash = computeContentHash(text);
      chunks.push({
        id: `chk_${randomUUID().slice(0, 10)}`,
        sourceVersionId,
        chunkIndex: chunkIndex++,
        sectionPath,
        startOffset: 0,
        endOffset: text.length,
        lineStart: sec.lineStart,
        lineEnd: sec.lineEnd,
        page: null,
        contentHash: hash,
        text,
        metadata: { sectionLevel: sec.level },
        heading: sectionPath,
        chunk_sha256: hash,
        start_line: sec.lineStart,
        end_line: sec.lineEnd,
      });
      continue;
    }

    // Split long section content on paragraph boundaries (\n\n) or line boundaries
    const paragraphs = text.split(/\n\s*\n/);
    let currentBuffer = "";
    let startLine = sec.lineStart;
    let lineCounter = sec.lineStart;

    for (const para of paragraphs) {
      const paraLines = para.split(/\r?\n/).length;

      if ((currentBuffer.length + para.length + 2) > maxChars && currentBuffer.length > 0) {
        const hash = computeContentHash(currentBuffer);
        chunks.push({
          id: `chk_${randomUUID().slice(0, 10)}`,
          sourceVersionId,
          chunkIndex: chunkIndex++,
          sectionPath,
          startOffset: 0,
          endOffset: currentBuffer.length,
          lineStart: startLine,
          lineEnd: lineCounter,
          page: null,
          contentHash: hash,
          text: currentBuffer,
          metadata: { sectionLevel: sec.level },
          heading: sectionPath,
          chunk_sha256: hash,
          start_line: startLine,
          end_line: lineCounter,
        });

        // Keep trailing overlap if feasible
        const keepLen = Math.min(overlap, currentBuffer.length);
        currentBuffer = currentBuffer.slice(-keepLen) + "\n\n" + para;
        startLine = lineCounter;
      } else {
        currentBuffer = currentBuffer ? currentBuffer + "\n\n" + para : para;
      }

      lineCounter += paraLines + 1;
    }

    if (currentBuffer.trim().length > 0) {
      const hash = computeContentHash(currentBuffer);
      chunks.push({
        id: `chk_${randomUUID().slice(0, 10)}`,
        sourceVersionId,
        chunkIndex: chunkIndex++,
        sectionPath,
        startOffset: 0,
        endOffset: currentBuffer.length,
        lineStart: startLine,
        lineEnd: sec.lineEnd,
        page: null,
        contentHash: hash,
        text: currentBuffer,
        metadata: { sectionLevel: sec.level },
        heading: sectionPath,
        chunk_sha256: hash,
        start_line: startLine,
        end_line: sec.lineEnd,
      });
    }
  }

  return chunks;
}

export function saveChunks(chunks: SourceChunk[]): void {
  const db = openAgentOsDb();
  db.exec("BEGIN");
  try {
    const stmt = db.prepare(`
      INSERT INTO source_chunks (
        id, source_version_id, chunk_index, section_path, start_offset,
        end_offset, line_start, line_end, page, content_hash, text, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        content_hash = excluded.content_hash,
        text = excluded.text,
        metadata_json = excluded.metadata_json
    `);

    for (const chk of chunks) {
      stmt.run(
        chk.id,
        chk.sourceVersionId,
        chk.chunkIndex,
        chk.sectionPath,
        chk.startOffset,
        chk.endOffset,
        chk.lineStart ?? null,
        chk.lineEnd ?? null,
        chk.page ?? null,
        chk.contentHash,
        chk.text,
        JSON.stringify(chk.metadata),
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function getChunksForVersion(sourceVersionId: string): SourceChunk[] {
  const db = openAgentOsDb();
  const rows = db
    .query("SELECT * FROM source_chunks WHERE source_version_id = ? ORDER BY chunk_index ASC")
    .all(sourceVersionId) as Record<string, unknown>[];

  return rows.map((r) => ({
    id: String(r.id),
    sourceVersionId: String(r.source_version_id),
    chunkIndex: Number(r.chunk_index),
    sectionPath: String(r.section_path),
    startOffset: Number(r.start_offset),
    endOffset: Number(r.end_offset),
    lineStart: r.line_start !== null ? Number(r.line_start) : null,
    lineEnd: r.line_end !== null ? Number(r.line_end) : null,
    page: r.page !== null ? Number(r.page) : null,
    contentHash: String(r.content_hash),
    text: String(r.text),
    metadata: r.metadata_json ? JSON.parse(String(r.metadata_json)) : {},
  }));
}

export function chunkSourceDocument(
  sourceVersionId: string,
  content: string,
  options: ChunkOptions = {},
): SourceChunk[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { parseMarkdown } = require("./parsers");
  const doc = parseMarkdown(content);
  const chunks = chunkDocument(doc, sourceVersionId, options);
  saveChunks(chunks);
  return chunks;
}
