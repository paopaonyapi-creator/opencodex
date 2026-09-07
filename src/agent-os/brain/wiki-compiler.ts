// Phase 20.5 — Living Markdown Wiki Compiler Engine
// Deterministic compilation with human-curated region preservation.

import { createHash, randomUUID } from "node:crypto";
import { openAgentOsDb } from "../db";
import { listClaims } from "./claims";
import { getEntity, listEntities } from "./entities";
import { listRelations } from "./relations";
import { computeContentHash, getLatestSourceVersion, getSource } from "./sources";
import type { KnowledgeClaim, KnowledgeEntity, KnowledgeRelation, WikiPage, WikiPageType, WikiRevision } from "./types";
import { getWikiPage, getWikiRevision, readWikiMarkdown, wikiFilePath, writeWikiMarkdownAtomic } from "./wiki-storage";

export const HUMAN_START_MARKER = "<!-- PAO:HUMAN-START -->";
export const HUMAN_END_MARKER = "<!-- PAO:HUMAN-END -->";

export function extractHumanCuratedSection(markdown: string): string | null {
  const startIdx = markdown.indexOf(HUMAN_START_MARKER);
  const endIdx = markdown.indexOf(HUMAN_END_MARKER);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return markdown.slice(startIdx + HUMAN_START_MARKER.length, endIdx).trim();
  }
  return null;
}

export interface CompilePageOptions {
  slug: string;
  title: string;
  pageType: WikiPageType;
  canonicalEntityId?: string | null;
  sourceIds?: string[];
  humanNotes?: string;
}

export function compileWikiPage(slugOrOptions: string | CompilePageOptions): {
  page: WikiPage;
  revision: WikiRevision;
  isNew: boolean;
  content: string;
  is_human_curated: number;
} {
  const db = openAgentOsDb();

  let options: CompilePageOptions;
  if (typeof slugOrOptions === "string") {
    const slug = slugOrOptions;
    const ent = getEntity(slug);
    const title = ent?.canonicalName ?? (slug.startsWith("phase-") ? slug.replace("phase-", "Phase ") : slug);
    const pageType: WikiPageType = ent?.entityType === "PHASE" ? "PHASE" : "PROJECT";
    options = {
      slug,
      title,
      pageType,
      canonicalEntityId: ent?.id,
    };
  } else {
    options = slugOrOptions;
  }

  const existingPage = getWikiPage(options.slug);
  const pageId = existingPage ? existingPage.id : `page_${randomUUID().slice(0, 10)}`;
  const now = new Date().toISOString();
  const filePath = existingPage?.storagePath ?? wikiFilePath(options.slug, options.pageType);

  // Preserve human-curated section from disk file first, then existing revision, then options
  let humanContent = options.humanNotes ?? "";
  if (!humanContent) {
    const diskMarkdown = readWikiMarkdown(filePath);
    if (diskMarkdown) {
      const extracted = extractHumanCuratedSection(diskMarkdown);
      if (extracted && !extracted.startsWith("*Add operator observations")) {
        humanContent = extracted;
      }
    }
  }
  if (!humanContent && existingPage?.currentRevisionId) {
    const rev = getWikiRevision(existingPage.currentRevisionId);
    if (rev?.markdown) {
      const extracted = extractHumanCuratedSection(rev.markdown);
      if (extracted && !extracted.startsWith("*Add operator observations")) {
        humanContent = extracted;
      }
    }
  }

  // Gather entity, claims, and relations
  let entity: KnowledgeEntity | null = null;
  if (options.canonicalEntityId) {
    entity = getEntity(options.canonicalEntityId);
  } else {
    entity = getEntity(options.slug);
  }

  const claims = entity
    ? listClaims({ subjectEntityId: entity.id, status: "ACTIVE" })
    : [];

  const outgoingRels = entity ? listRelations({ fromEntityId: entity.id, status: "ACTIVE" }) : [];
  const incomingRels = entity ? listRelations({ toEntityId: entity.id, status: "ACTIVE" }) : [];

  // Compute source set hash
  const sourceIds = options.sourceIds ?? [];
  const sourceHashes: string[] = [];
  const sourceVersionLinks: Array<{ sourceId: string; versionId: string }> = [];

  for (const sid of sourceIds) {
    const src = getSource(sid);
    const ver = getLatestSourceVersion(sid);
    if (src && ver) {
      sourceHashes.push(ver.contentHash);
      sourceVersionLinks.push({ sourceId: src.id, versionId: ver.id });
    }
  }
  const sourceSetHash = createHash("sha256").update(sourceHashes.sort().join(":")).digest("hex");

  // Build Markdown Document
  const frontmatter = [
    "---",
    `id: ${pageId}`,
    `slug: ${options.slug}`,
    `title: "${options.title.replace(/"/g, '\\"')}"`,
    `type: ${options.pageType.toLowerCase()}`,
    `status: current`,
    `updated_at: "${now}"`,
    `source_set_hash: "${sourceSetHash}"`,
    entity ? `entity_id: "${entity.id}"` : null,
    entity?.aliases && entity.aliases.length > 0
      ? `aliases:\n${entity.aliases.map((a) => `  - "${a}"`).join("\n")}`
      : null,
    "---",
  ].filter(Boolean).join("\n");

  const sections: string[] = [frontmatter, "", `# ${options.title}`, ""];

  // 1. Summary
  sections.push("## Summary", "");
  sections.push(
    entity?.description
      ? entity.description
      : `Compiled knowledge documentation for ${options.title}.`,
    "",
  );

  // 2. Active Claims & Key Facts
  if (claims.length > 0) {
    sections.push("## Key Claims & Decisions", "");
    for (const claim of claims) {
      const provNote = claim.provenance && claim.provenance.length > 0
        ? ` *(source: ${claim.provenance[0]!.sourceVersionId})*`
        : "";
      sections.push(`- **${claim.predicate}:** ${claim.objectValue}${provNote}`);
    }
    sections.push("");
  }

  // 3. Relationships & Dependencies
  if (outgoingRels.length > 0 || incomingRels.length > 0) {
    sections.push("## Relationships", "");
    for (const rel of outgoingRels) {
      const targetEnt = getEntity(rel.toEntityId);
      const targetName = targetEnt ? targetEnt.canonicalName : rel.toEntityId;
      sections.push(`- **${rel.relationType}** → [[${targetName}]]`);
    }
    for (const rel of incomingRels) {
      const srcEnt = getEntity(rel.fromEntityId);
      const srcName = srcEnt ? srcEnt.canonicalName : rel.fromEntityId;
      sections.push(`- **${rel.relationType}** ← [[${srcName}]]`);
    }
    sections.push("");
  }

  // 4. Human-Curated Notes Section (Protected)
  sections.push("## Operator & Human Notes", "");
  sections.push(HUMAN_START_MARKER);
  if (humanContent) {
    sections.push(humanContent);
  } else {
    sections.push("*Add operator observations, architectural rationale, or manual overrides here. This block is preserved across automatic compilations.*");
  }
  sections.push(HUMAN_END_MARKER);
  sections.push("");

  // 5. Source Evidence
  if (sourceVersionLinks.length > 0) {
    sections.push("## Source Evidence", "");
    for (const link of sourceVersionLinks) {
      const src = getSource(link.sourceId);
      sections.push(`- **${src?.title ?? link.sourceId}** (${src?.uriOrPath ?? "unknown path"}, version \`${link.versionId}\`)`);
    }
    sections.push("");
  }

  const finalMarkdown = sections.join("\n");
  const contentHash = computeContentHash(finalMarkdown);
  const hasHumanNotes = Boolean(humanContent && !humanContent.startsWith("*Add operator observations"));

  // Check if identical to current revision
  if (existingPage?.currentRevisionId) {
    const currRev = getWikiRevision(existingPage.currentRevisionId);
    if (currRev && currRev.contentHash === contentHash) {
      return {
        page: existingPage,
        revision: currRev,
        isNew: false,
        content: finalMarkdown,
        is_human_curated: hasHumanNotes ? 1 : 0,
      };
    }
  }

  const latestRevs = existingPage ? db.query("SELECT MAX(revision_number) as max_rev FROM wiki_revisions WHERE page_id = ?").get(pageId) as { max_rev: number | null } : null;
  const nextRevNum = (latestRevs?.max_rev ?? 0) + 1;
  const revisionId = `rev_${randomUUID().slice(0, 10)}`;

  db.exec("BEGIN");
  try {
    // 1. Upsert wiki page first to satisfy foreign key constraint on wiki_revisions.page_id
    let canonicalEntityId = options.canonicalEntityId ?? null;
    if (canonicalEntityId && !getEntity(canonicalEntityId)) {
      canonicalEntityId = null;
    }

    const pageMeta = { ...(existingPage?.metadata ?? {}), isHumanCurated: hasHumanNotes, is_human_curated: hasHumanNotes ? 1 : 0 };
    db.query(`
      INSERT INTO wiki_pages (
        id, slug, title, page_type, canonical_entity_id, status,
        current_revision_id, storage_path, created_at, updated_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, 'CURRENT', ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        page_type = excluded.page_type,
        canonical_entity_id = excluded.canonical_entity_id,
        status = 'CURRENT',
        current_revision_id = excluded.current_revision_id,
        storage_path = excluded.storage_path,
        updated_at = excluded.updated_at,
        metadata_json = excluded.metadata_json
    `).run(
      pageId,
      options.slug,
      options.title,
      options.pageType,
      canonicalEntityId,
      revisionId,
      filePath,
      existingPage ? existingPage.createdAt : now,
      now,
      JSON.stringify(pageMeta),
    );

    // 2. Insert revision
    db.query(`
      INSERT INTO wiki_revisions (
        id, page_id, revision_number, content_hash, markdown, compiler_version,
        source_set_hash, summary, created_at
      ) VALUES (?, ?, ?, ?, ?, '1.0.0', ?, ?, ?)
    `).run(
      revisionId,
      pageId,
      nextRevNum,
      contentHash,
      finalMarkdown,
      sourceSetHash,
      `Compiled revision ${nextRevNum}`,
      now,
    );

    // 3. Link sources
    for (const link of sourceVersionLinks) {
      db.query(`
        INSERT INTO wiki_source_links (page_id, source_id, source_version_id)
        VALUES (?, ?, ?)
        ON CONFLICT(page_id, source_id) DO UPDATE SET source_version_id = excluded.source_version_id
      `).run(pageId, link.sourceId, link.versionId);
    }

    // 4. Write markdown file atomically
    writeWikiMarkdownAtomic(filePath, finalMarkdown);

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  const updatedPage = getWikiPage(pageId)!;
  const revision = getWikiRevision(revisionId)!;
  return {
    page: updatedPage,
    revision,
    isNew: true,
    content: finalMarkdown,
    is_human_curated: hasHumanNotes ? 1 : 0,
  };
}
