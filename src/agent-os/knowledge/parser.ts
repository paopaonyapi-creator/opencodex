// Phase 21 — Markdown & Metadata Parser (spec sections 8, 9, 26).
//
// Extracts YAML front-matter, structural headings, line ranges, and SHA-256 content hashes.

import { createHash } from "node:crypto";
import type { KnowledgeDocType, KnowledgeDocument, KnowledgeSection } from "./types";

export interface ParsedDocumentResult {
  document: KnowledgeDocument;
  sections: KnowledgeSection[];
}

export function computeSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Extracts front-matter key/values from markdown text.
 */
export function extractFrontMatter(rawContent: string): {
  frontMatter: Record<string, any>;
  body: string;
} {
  const trimmed = rawContent.trimStart();
  if (!trimmed.startsWith("---")) {
    return { frontMatter: {}, body: rawContent };
  }

  const endIdx = trimmed.indexOf("\n---", 3);
  if (endIdx === -1) {
    return { frontMatter: {}, body: rawContent };
  }

  const yamlBlock = trimmed.slice(3, endIdx).trim();
  const body = trimmed.slice(endIdx + 4).trimStart();

  const frontMatter: Record<string, any> = {};
  let currentKey = "";
  for (const rawLine of yamlBlock.split("\n")) {
    const line = rawLine.trimEnd();
    const trimmedLine = line.trim();

    // Check for list item: "  - value"
    if (trimmedLine.startsWith("- ") && currentKey) {
      let itemVal = trimmedLine.slice(2).trim();
      if ((itemVal.startsWith('"') && itemVal.endsWith('"')) || (itemVal.startsWith("'") && itemVal.endsWith("'"))) {
        itemVal = itemVal.slice(1, -1);
      }
      if (!Array.isArray(frontMatter[currentKey])) {
        frontMatter[currentKey] = [];
      }
      frontMatter[currentKey].push(itemVal);
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      let val = line.slice(colonIdx + 1).trim();
      currentKey = key;

      if (val.length === 0) {
        frontMatter[key] = [];
        continue;
      }

      // Inline array: "[a, b]"
      if (val.startsWith("[") && val.endsWith("]")) {
        const items = val
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
        frontMatter[key] = items;
        continue;
      }

      // Simple unquoting and scalar parsing
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (val === "true") frontMatter[key] = true;
      else if (val === "false") frontMatter[key] = false;
      else if (/^\d+$/.test(val)) frontMatter[key] = Number(val);
      else frontMatter[key] = val;
    }
  }

  return { frontMatter, body };
}

/**
 * Derives document type and default priority from file path or front matter.
 */
export function inferDocTypeAndPriority(filePath: string, frontMatter: Record<string, any>): {
  type: KnowledgeDocType;
  priority: number;
} {
  const norm = filePath.toLowerCase().replace(/\\/g, "/");

  if (frontMatter.type) {
    const t = String(frontMatter.type).toLowerCase() as KnowledgeDocType;
    let prio = 50;
    if (t === "decision") prio = 95;
    else if (t === "architecture") prio = 90;
    else if (t === "phase") prio = 80;
    else if (t === "operation") prio = 70;
    else if (t === "research") prio = 60;
    return { type: t, priority: Number(frontMatter.source_priority ?? prio) };
  }

  if (norm.includes("/decisions/") || norm.includes("adr-")) {
    return { type: "decision", priority: 95 };
  }
  if (norm.includes("/architecture/") || norm.includes("arch-")) {
    return { type: "architecture", priority: 90 };
  }
  if (norm.includes("/phases/") || norm.includes("phase_") || norm.includes("phase-")) {
    return { type: "phase", priority: 80 };
  }
  if (norm.includes("/specifications/") || norm.includes("/specs/")) {
    return { type: "specification", priority: 85 };
  }
  if (norm.includes("/operations/") || norm.includes("/runbooks/")) {
    return { type: "operation", priority: 70 };
  }
  if (norm.includes("/research/")) {
    return { type: "research", priority: 60 };
  }
  if (norm.includes("/integrations/")) {
    return { type: "integration", priority: 65 };
  }

  return { type: "general", priority: 50 };
}

/**
 * Parses a markdown document into document metadata and structured sections.
 */
export function parseMarkdownDocument(filePath: string, rawContent: string): ParsedDocumentResult {
  const hash = computeSha256(rawContent);
  const { frontMatter, body } = extractFrontMatter(rawContent);

  const { type, priority } = inferDocTypeAndPriority(filePath, frontMatter);
  const now = new Date().toISOString();

  // Extract ID
  const fileName = filePath.replace(/\\/g, "/").split("/").pop()?.replace(/\.md$/i, "") || "doc";
  const docId = String(frontMatter.id || fileName.toLowerCase());

  // Extract Title: front matter title OR first heading OR file name
  let title = frontMatter.title ? String(frontMatter.title) : "";
  if (!title) {
    const firstHeading = body.match(/^#+\s+(.+)$/m);
    title = firstHeading ? firstHeading[1].trim() : fileName;
  }

  const document: KnowledgeDocument = {
    id: docId,
    type,
    title,
    path: filePath.replace(/\\/g, "/"),
    hash,
    version: Number(frontMatter.version || 1),
    status: (frontMatter.status as any) || "active",
    sourcePriority: Number(frontMatter.source_priority || priority),
    tags: Array.isArray(frontMatter.tags) ? frontMatter.tags.map(String) : [],
    metadata: frontMatter,
    createdAt: frontMatter.created_at ? String(frontMatter.created_at) : now,
    updatedAt: frontMatter.updated_at ? String(frontMatter.updated_at) : now,
    indexedAt: now,
  };

  // Split into sections by Markdown headings (#, ##, ###)
  const lines = rawContent.split("\n");
  const sections: KnowledgeSection[] = [];

  let currentHeading = title;
  let currentLines: string[] = [];
  let sectionStartLine = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(#{1,3})\s+(.+)$/);

    if (match && currentLines.length > 0) {
      const sectionText = currentLines.join("\n").trim();
      if (sectionText.length > 0) {
        sections.push({
          id: `${docId}#sec_${sections.length + 1}`,
          documentId: docId,
          heading: currentHeading,
          content: sectionText,
          startLine: sectionStartLine,
          endLine: i,
          contentHash: computeSha256(sectionText),
        });
      }
      currentHeading = match[2].trim();
      currentLines = [];
      sectionStartLine = i + 1;
    }

    currentLines.push(line);
  }

  if (currentLines.length > 0) {
    const sectionText = currentLines.join("\n").trim();
    if (sectionText.length > 0) {
      sections.push({
        id: `${docId}#sec_${sections.length + 1}`,
        documentId: docId,
        heading: currentHeading,
        content: sectionText,
        startLine: sectionStartLine,
        endLine: lines.length,
        contentHash: computeSha256(sectionText),
      });
    }
  }

  return { document, sections };
}
